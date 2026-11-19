import fs from 'node:fs';
import path from 'node:path';
export const name='r26-probe';export const inject=['tools'];
export function apply(ctx){ctx.on('agent/pre-step',async(p,next)=>{
 const services=Object.fromEntries(['sandbox','sandboxPolicy','shell','shellEnv'].map(k=>{const s=ctx.get(k);return [k,{present:!!s,provider:s?.constructor?.name,mode:k==='sandboxPolicy'?s?.resolve({session:p.agent.session})?.mode:undefined}];}));
 const row={preset:p.agent.session.header.agentPreset,services,payloadKeys:Object.keys(p),tools:[...ctx.tools.view(p.agent).visible.keys()].sort()};
 const file=path.join(process.env.HUB_HOME,'../run/probe.jsonl');fs.appendFileSync(file,JSON.stringify(row)+'\n',{mode:0o600});return next();});}
