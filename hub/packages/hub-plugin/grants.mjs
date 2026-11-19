import fs from 'node:fs';
import path from 'node:path';
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const abs=s=>typeof s==='string'&&path.isAbsolute(s)&&!/[\0\r\n]/.test(s);
// Strip only JSON whitespace outside strings. Comparing with JSON.stringify also rejects duplicate keys.
function compact(text){let out='',quoted=false,escaped=false;for(const c of text){if(quoted){out+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"'){quoted=true;out+=c;}else if(!/\s/.test(c))out+=c;}return out;}
export function readGrants(file,logger=console){
 let fd;
 try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const st=fs.fstatSync(fd);
  if(!st.isFile()||st.size>65536||(st.mode&0o777)!==0o600||process.getuid&&st.uid!==process.getuid())throw Error('文件须为本用户的0600普通文件且不超过64KB');
  const text=fs.readFileSync(fd,'utf8'),data=JSON.parse(text);
  if(JSON.stringify(data)!==compact(text)||data.v!==1||!Array.isArray(data.grants)||Object.keys(data).some(k=>!['v','grants'].includes(k)))throw Error('放行表格式错误');
  const ids=new Set(),keys=['id','bot','program','dir','caps','by','on','until','tag','createdAt','cardId','revokedAt'];
  for(const g of data.grants){
   if(!g||Object.keys(g).length!==keys.length||keys.some(k=>!Object.hasOwn(g,k))||!/^G-\d{8}-\d{6}-[a-f0-9]{4}$/.test(g.id)||ids.has(g.id)||typeof g.bot!=='string'||!g.bot||typeof g.program!=='string'||!g.program||/[\0\r\n\s]/.test(g.program)||!abs(g.dir)||!g.caps||Object.keys(g.caps).sort().join(',')!=='network,writeRoots'||typeof g.caps.network!=='boolean'||!Array.isArray(g.caps.writeRoots)||g.caps.writeRoots.some(p=>!abs(p))||g.by!=='owner'||!date(g.on)||!date(g.until)||g.until<g.on||g.tag!==`#by/owner #on/${g.on} #until/${g.until}`||typeof g.createdAt!=='string'||!Number.isFinite(Date.parse(g.createdAt))||typeof g.cardId!=='string'||!g.cardId||g.revokedAt!==null&&(typeof g.revokedAt!=='string'||!Number.isFinite(Date.parse(g.revokedAt))))throw Error('放行条目格式错误');
   ids.add(g.id);
  }
  return data.grants;
 }catch(e){if(e.code!=='ENOENT')logger.error?.('hub-plugin 放行表不可用，按空表先问：'+e.message);return [];}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
