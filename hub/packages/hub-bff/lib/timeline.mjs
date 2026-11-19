// 文件工具只投影元数据；命令工具按审批契约投影命令及最多 4KB 输出，不投影 reasoning。
const cut = (value,n=80) => Array.from(value ?? '').slice(0,n).join('');
export const validSeq = seq => Number.isSafeInteger(seq) && seq >= 0;
export function coordinates(event) {
  const ts = event?.time;
  return {...(validSeq(event?.seq) ? {seq:event.seq} : {}),
    ...(typeof ts === 'number' && Number.isFinite(new Date(ts).getTime()) && ts >= 0
      || typeof ts === 'string' && /^\d{4}-\d\d-\d\dT/u.test(ts) && Number.isFinite(Date.parse(ts)) ? {ts} : {})};
}
const textOf = message => (message?.content ?? []).filter(p=>p.type==='text' && typeof p.text==='string').map(p=>p.text).join('');
export function messageFromEvent(event) {
  if (!['user/message','assistant/message'].includes(event?.type)) return;
  const assistant = event.type === 'assistant/message';
  const message = assistant ? event.data?.message : event.data;
  if (!assistant && message?.source?.kind !== 'user') return;
  return {role:assistant ? 'assistant' : 'user',text:textOf(message),...coordinates(event),
    ...(validSeq(event.seq) ? {id:String(event.seq)} : typeof message?.id==='string' ? {id:message.id} : {}),
    ...(assistant ? {tools:[]} : {})};
}
export function lastSentence(text) {
  const sentence=(String(text ?? '').trim().match(/[^。！？!?\n]+[。！？!?]+/gu) ?? []).at(-1)?.trim() ?? '';
  return Array.from(sentence).length>80 ? cut(sentence)+'…' : sentence;
}
function argumentsOf(data) {
  try { const a=typeof data.arguments==='string' ? JSON.parse(data.arguments) : data.arguments; return a && typeof a==='object' && !Array.isArray(a) ? a : {}; } catch { return {}; }
}
function failureBrief(message) {
  const parts=(message?.content ?? []).filter(p=>p.type==='text' && typeof p.text==='string').map(p=>p.text.trim());
  const chinese=text=>/^(?:Error:\s*)?(?:[\p{Script=Han}（【]|主人 没批准)/u.test(text);
  // 内核英文拒绝后可能有插件追加的中文解释，优先保留这句。
  const text=(parts.find(p=>/^(?:Error:\s*)?(?:这件事我做不了：|主人 没批准|审批通道不在线|刚才这件事 主人)/u.test(p)) ?? parts.find(chinese) ?? parts[0] ?? '工具执行失败')
    .replace(/^Error:\s*/u,'');
  if(chinese(text))return cut(text.match(/^[^。！？!?\n]+[。！？!?]?/u)?.[0] ?? text);
  if(/\bthe user rejected tool\b/iu.test(text))return '主人 没批准';
  if(/\bapproval\b.*\bwas cancel(?:led|ed)\b/iu.test(text))return '审批取消了';
  if(/requires approval, but no approval channel is available|\bunavailable\b/iu.test(text))return '审批通道不在线';
  return '这一步没做成';
}

export class Timeline {
  constructor(cards=()=>[]) { this.cards=typeof cards==='function' ? cards : ()=>cards; this.messages=[];this.calls=new Map();this.approvals=new Map();this.seen=new Set();this.texts=[]; }
  ingest(event) {
    if (!event) return {};
    if (validSeq(event.seq)) { if(this.seen.has(event.seq))return {};this.seen.add(event.seq); }
    const message=messageFromEvent(event), data=event.data ?? {};
    if (message) {
      if (event.surfaceOp && typeof event.surfaceOp==='object' && event.surfaceOp.op==='replace') {
        const {startSeq,endSeq}=event.surfaceOp;
        if (!validSeq(startSeq)||!validSeq(endSeq)) throw Error('Unsupported history replacement');
        const at=this.messages.findIndex(m=>m.seq>=startSeq);
        if(at>=0) { let count=0;while(this.messages[at+count]?.seq<=endSeq)count++;this.messages.splice(at,count,message); }
        else this.messages.push(message);
      } else this.messages.push(message);
      if(message.role==='assistant') {this.assistant={message,content:data.message?.content ?? [],turn:data.turn,step:data.step};if(message.text.trim())this.texts.push(this.assistant);}
      return {message};
    }
    let call;
    if(event.type==='tool/call' && typeof data.callId==='string' && typeof data.name==='string') {
      const args=argumentsOf(data), path=args.file_path ?? args.path;
      const tool={id:data.callId,name:data.name,status:'running',...coordinates(event),...(typeof path==='string'?{path}:{}),brief:'',...(data.name==='bash'?{command:typeof args.command==='string'?cut(args.command,2000):'',cwd:typeof args.workdir==='string'?args.workdir:''}:{})};
      const previous=[...this.messages].reverse().find(m=>m.role==='assistant' && this.callsForMessage(m,data.turn,data.step));
      const owner=previous ?? {role:'assistant',text:'',id:'tool:'+data.callId,...coordinates(event),tools:[]};
      if(!previous)this.messages.push(owner);
      owner.tools.push(tool);
      call={tool,owner,turn:data.turn,step:data.step,why:this.whyBefore(data)};
      this.calls.set(data.callId,call);
    } else if(event.type==='approval/asked') {
      call=this.calls.get(data.callId);
      if(call) {this.approvals.set(data.id,call);Object.assign(call.tool,{approvalId:data.id,level:'L3',status:'pending'});}
    } else if(event.type==='approval/decided') {
      call=this.approvals.get(data.id);
      if(call && !call.result) call.tool.status=({'allowed-once':'approved','allowed-session':'approved',rejected:'rejected',cancelled:'unavailable',unavailable:'unavailable',timeout:'timeout'})[data.outcome] ?? 'unavailable';
    } else if(event.type==='tool/result') {
      const m=data.message;call=this.calls.get(m?.toolCallId ?? m?.source?.callId);
      if(call) {
        call.result=true;
        if(call.tool.name==='bash') {
          const output=textOf(m),bytes=Buffer.from(output,'utf8');
          call.tool.output=new TextDecoder().decode(bytes.subarray(0,4096),{stream:true});
          call.tool.outputTruncated=bytes.length>4096 || /只显示前 4KB/u.test(output);
          const full=output.match(/全文在 (bots\/[^\r\n）]+)[）]?/u)?.[1];
          if(full)call.tool.outputPath=full;
        }
        // 缺失 isError 时无法证明成功。
        if(m.isError===false) {
          call.tool.status='ok';call.tool.brief='';
          const tail=m.content?.at(-1)?.text ?? '';
          if(['write','edit','delegate_to_bot','ticket_create','ticket_update','ticket_move'].includes(call.tool.name)
            && /^（已写入 [^\r\n]*，L1 已记录）$/u.test(tail)) {call.tool.level='L1';call.tool.brief='L1 已记录';}
        } else {
          const brief=failureBrief(m);call.tool.brief=brief;
          if(/审批通道不在线/u.test(brief)) call.tool.status='unavailable';
          else if(['rejected','timeout','unavailable','revised'].includes(call.tool.status)) {}
          else if(/这件事我做不了|主人 没批准|不在本轮授权范围/u.test(brief)) call.tool.status='denied';
          else call.tool.status='error';
        }
      }
    }
    return call ? {tool:this.publicTool(call)} : {};
  }
  callsForMessage(message,turn,step) { return message===this.assistant?.message && (turn===undefined || this.assistant.turn===turn) && (step===undefined || this.assistant.step===step); }
  whyBefore(data) {
    // 本步骤已有文字优先；否则只退到同轮的上一个 assistant 文本。
    const current=this.texts.findLast(p=>p.turn===data.turn && p.step===data.step);
    if(current) {
      const at=current.content.findIndex(p=>p.type==='tool-call' && p.id===data.callId);
      const before=(at<0?current.content:current.content.slice(0,at)).findLast(p=>p.type==='text' && p.text?.trim());
      if(before)return lastSentence(before.text);
    }
    const previous=this.texts.findLast(p=>p!==current && p.turn===data.turn);
    return previous ? lastSentence(previous.message.text) : '';
  }
  publicTool(call) {
    const tool={...call.tool};
    const card=this.cards().find(c=>c.type==='approval' && c.id===tool.approvalId);
    if(card) {
      tool.level='L3';
      if((!call.result || ['rejected','timeout','unavailable','revised'].includes(tool.status))
        && (card.status!=='pending' || ['running','pending'].includes(tool.status))) tool.status=card.status;
    }
    return tool;
  }
  surface() { return this.messages.map(m=>({...m,...(m.role==='assistant'?{tools:m.tools.map(t=>this.publicTool(this.calls.get(t.id)))}:{})})); }
}

export function project(records,cards=[]) {
  const timeline=new Timeline(cards);
  for(const record of records)timeline.ingest(record.event ?? record);
  return timeline;
}
