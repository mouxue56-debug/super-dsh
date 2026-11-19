import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {BffError} from './errors.mjs';
import {directory,atomic,readSmall} from './roster.mjs';
const run=promisify(execFile);
export const MAX_AVATAR=2*1024*1024;
const types={png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif'};
const fail=message=>new BffError('INVALID_INPUT',message,415);
export function imageType(b) {
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR')return 'png';
 if(b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255)return 'jpg';
 if(b.length>=16&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'&&b.readUInt32LE(4)+8===b.length)return 'webp';
 if(b.length>=13&&['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)))return 'gif';
 throw fail('只接受真实的 png、jpg、webp 或 gif 图片');
}
function cleanJpeg(b) {
 const out=[b.subarray(0,2)];let i=2;
 while(i<b.length) {
   if(b[i]!==255)throw fail('JPEG 图片损坏');const start=i;while(b[i]===255)i++;const marker=b[i++];
   if(marker===0xda||marker===0xd9){out.push(b.subarray(start));return Buffer.concat(out);}
   if(marker===0x01||marker>=0xd0&&marker<=0xd7){out.push(b.subarray(start,i));continue;}
   if(i+2>b.length)throw fail('JPEG 图片损坏');const n=b.readUInt16BE(i);if(n<2||i+n>b.length)throw fail('JPEG 图片损坏');
   // APP1/APP13/comment may retain EXIF/XMP/IPTC even after sips transcodes.
   if(![0xe1,0xed,0xfe].includes(marker))out.push(b.subarray(start,i+n));i+=n;
 }
 throw fail('JPEG 图片损坏');
}
function cleanPng(b) {
 const out=[b.subarray(0,8)];let i=8;
 while(i+12<=b.length){const n=b.readUInt32BE(i),type=b.toString('ascii',i+4,i+8),end=i+n+12;if(end>b.length)throw fail('PNG 图片损坏');if(!['eXIf','tEXt','zTXt','iTXt','tIME'].includes(type))out.push(b.subarray(i,end));i=end;if(type==='IEND')return Buffer.concat(out);}
 throw fail('PNG 图片损坏');
}
export async function uploadBody(req) {
 const contentType=req.headers['content-type']??'',multipart=/^multipart\/form-data;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))$/iu.exec(contentType),max=MAX_AVATAR+(multipart?65536:0),parts=[];let size=0;
 if(Number(req.headers['content-length'])>max)throw new BffError('INVALID_INPUT','图片不能超过 2MB',413);
 for await(const p of req){size+=p.length;if(size>max)throw new BffError('INVALID_INPUT','图片不能超过 2MB',413);parts.push(p);}
 let bytes=Buffer.concat(parts),filename='',mime=contentType.split(';')[0].toLowerCase();
 if(multipart){
   const boundary=multipart[1]??multipart[2];if(boundary.length>200)throw fail('上传格式无效');
   const first=Buffer.from('--'+boundary+'\r\n'),end=Buffer.from('\r\n--'+boundary+'--');
   if(!bytes.subarray(0,first.length).equals(first))throw fail('上传格式无效');const split=bytes.indexOf('\r\n\r\n',first.length),finish=bytes.indexOf(end,split+4);
   if(split<0||split>8192||finish<0||![0,2].includes(bytes.length-finish-end.length))throw fail('只可上传一个图片文件');
   const headers=bytes.toString('utf8',first.length,split);filename=/filename="([^"\r\n]+)"/iu.exec(headers)?.[1]??'';mime=/^Content-Type:\s*([^\r\n;]+)/imu.exec(headers)?.[1]?.trim().toLowerCase()??'';
   if(!filename||bytes.indexOf(Buffer.from('\r\n--'+boundary+'\r\n'))!==-1)throw fail('只可上传一个图片文件');bytes=bytes.subarray(split+4,finish);
 } else filename=/filename="([^"\r\n]+)"/iu.exec(req.headers['content-disposition']??'')?.[1]??'';
 if(bytes.length>MAX_AVATAR)throw new BffError('INVALID_INPUT','图片不能超过 2MB',413);
 const ext=imageType(bytes);if(mime!==types[ext])throw fail('图片类型与内容不符');
 if(filename){const supplied=/\.([a-z]+)$/iu.exec(filename)?.[1]?.toLowerCase();if((supplied==='jpeg'?'jpg':supplied)!==ext)throw fail('扩展名与图片内容不符');}
 return {bytes,ext};
}
export async function saveAvatar(roster,id,input,device) {
 if(!roster.get(id))throw new BffError('NOT_FOUND','助理不存在',404);
 const tmp=join(roster.hubHome,'tmp','avatar-upload');await directory(tmp);
 const token=randomBytes(8).toString('hex'),source=join(tmp,token+'.'+input.ext),ext=input.ext==='webp'?'png':input.ext,dest=join(tmp,token+'.encoded.'+ext);
 await atomic(source,input.bytes);
 if(input.ext==='gif') {
   const w=input.bytes.readUInt16LE(6),h=input.bytes.readUInt16LE(8);if(!w||!h||w>16384||h>16384||w*h>40000000)throw fail('图片尺寸无效或过大');
 } else {
   try {
     const info=await run('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight',source],{timeout:10000,maxBuffer:8192});
     const w=Number(/pixelWidth:\s*(\d+)/u.exec(info.stdout)?.[1]),h=Number(/pixelHeight:\s*(\d+)/u.exec(info.stdout)?.[1]);if(!w||!h||w>16384||h>16384||w*h>40000000)throw Error();
     await run('/usr/bin/sips',['-s','format',ext==='jpg'?'jpeg':ext,source,'--out',dest],{timeout:10000,maxBuffer:8192});
   }catch{throw fail('系统无法重新编码这张图片');}
 }
 let encoded=input.ext==='gif'?input.bytes:await readSmall(dest,16*1024*1024);
 if(imageType(encoded)!==ext)throw fail('重新编码后的图片类型无效');
 if(ext==='jpg')encoded=cleanJpeg(encoded);if(ext==='png')encoded=cleanPng(encoded);
 const avatar={kind:'upload',file:id+'.'+ext,v:roster.now()};
 return roster.mutate({actor:'owner',action:'上传形象',id,patch:{avatar},device,avatarFile:encoded});
}
export const avatarMime=file=>types[file.split('.').at(-1)];
