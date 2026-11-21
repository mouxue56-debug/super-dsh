import { open, mkdir, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BffError } from './errors.mjs';
import { BOT_ID } from './roster.mjs';
const failure = () => new BffError('STORAGE_FAILURE','放行规则没能保存，请稍后重试',503);
const text = v => typeof v==='string' && v.length>0 && !/[\u0000-\u001f\u007f]/u.test(v);
const path = v => text(v) && v.startsWith('/') && v.length<=4096;
const date = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/u.test(v) && Number.isFinite(Date.parse(v));
const iso = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}T/u.test(v) && Number.isFinite(Date.parse(v));
const taskTTL = 15 * 60 * 1000;
const valid = g => g && /^G-\d{8}-\d{6}-[a-f0-9]{4}$/u.test(g.id) && BOT_ID.test(g.bot ?? "") && text(g.program) && g.program.length<=128 && path(g.dir)
  && g.caps && Object.keys(g.caps).length===2 && typeof g.caps.network==='boolean' && Array.isArray(g.caps.writeRoots) && g.caps.writeRoots.length<=64 && g.caps.writeRoots.every(path)
  && g.by==='owner' && date(g.on) && date(g.until) && g.tag===`#by/owner #on/${g.on} #until/${g.until}` && iso(g.createdAt) && text(g.cardId) && (g.revokedAt===null || iso(g.revokedAt));
const local = now => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  return {on:`${parts.year}-${parts.month}-${parts.day}`,stamp:`${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`};
};
export class CommandGrants {
  constructor({configDir,now=Date.now,atomicFile,roster}) { Object.assign(this,{configDir,now,atomicFile,roster}); this.days=30; this.writes=Promise.resolve(); this.tasks=new Map(); }
  taskAllowed(turn,category) {
    return !!turn && (this.tasks.get(turn)?.get(category) ?? 0)>this.now();
  }
  allowTask(turn,category) {
    const entries=this.tasks.get(turn) ?? new Map();
    entries.set(category,this.now()+taskTTL);
    this.tasks.set(turn,entries);
  }
  endTask(turn) { this.tasks.delete(turn); }
  get file() { return join(this.configDir,'command-grants.json'); }
  async readSmall(file) {
    let f;
    try { f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW); const st=await f.stat(); if(!st.isFile() || st.size>65536)throw failure(); return await f.readFile('utf8'); }
    finally { await f?.close(); }
  }
  async readDays() {
    try { const raw=await this.readSmall(join(this.configDir,'tool-levels.yaml')),n=Number(raw.match(/^cmd_grant_days:\s*(\d+)\s*(?:#.*)?$/mu)?.[1]);this.days=Number.isSafeInteger(n)&&n>0&&n<=3650?n:30; }
    catch { this.days=30; }
    return this.days;
  }
  async read() {
    try { const value=JSON.parse(await this.readSmall(this.file)); if(value.v!==1 || !Array.isArray(value.grants) || !value.grants.every(valid) || new Set(value.grants.map(g=>g.id)).size!==value.grants.length)throw failure(); return value.grants; }
    catch(error) { if(error.code==='ENOENT')return []; throw failure(); }
  }
  status(g) { return g.revokedAt ? 'revoked' : local(this.now()).on>g.until ? 'expired' : 'active'; }
  async list() { await this.writes; return (await this.read()).map(g=>({...g,status:this.status(g)})); }
  change(fn) { const work=this.writes.then(fn); this.writes=work.catch(()=>{}); return work; }
  async log(action,g,device) {
    let f;
    try { await mkdir(this.configDir,{recursive:true,mode:0o700}); f=await open(join(this.configDir,'permissions.changes.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
      if(!(await f.stat()).isFile())throw failure(); await f.chmod(0o600);
      await f.writeFile([new Date(this.now()).toISOString(),action,g.bot,g.program,g.dir,g.until,device].join('\t')+'\n'); await f.sync();
    } finally { await f?.close(); }
  }
  async save(grants,before,action,g,device) {
    const value=JSON.stringify({v:1,grants})+'\n';if(Buffer.byteLength(value)>65536)throw failure();
    await this.atomicFile(this.file,value);
    try { await this.log(action,g,device); }
    catch { await this.atomicFile(this.file,JSON.stringify({v:1,grants:before})+'\n'); throw failure(); }
  }
  remember(card,device) { return this.change(async()=>{
    try {
      this.roster?.enabled(card.bot);
      const grants=await this.read(),before=structuredClone(grants),{on,stamp}=local(this.now()),days=await this.readDays();
      const until=new Date(Date.parse(on+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
      let g=grants.find(g=>g.bot===card.bot && g.program===card.grantKey.program && g.dir===card.grantKey.dir && this.status(g)==='active');
      const action=g?'grant-extend':'grant-add';
      if(g) { g.until=until>g.until?until:g.until; g.caps={network:card.caps.network,writeRoots:[...card.caps.writeRoots]}; }
      else { g={id:'G-'+stamp+'-'+randomBytes(2).toString('hex'),bot:card.bot,program:card.grantKey.program,dir:card.grantKey.dir,caps:{network:card.caps.network,writeRoots:[...card.caps.writeRoots]},by:'owner',on,until,createdAt:new Date(this.now()).toISOString(),cardId:card.id,revokedAt:null};grants.push(g); }
      g.tag=`#by/owner #on/${g.on} #until/${g.until}`;
      if(!valid(g))throw failure();await this.save(grants,before,action,g,device);return {...g,status:this.status(g)};
    } catch { throw failure(); }
  }); }
  revoke(id,device) { return this.change(async()=>{
    const grants=await this.read(),before=structuredClone(grants),g=grants.find(g=>g.id===id);
    if(!g)throw new BffError('NOT_FOUND','放行规则不存在',404);
    if(!g.revokedAt) {
      g.revokedAt=new Date(this.now()).toISOString();
      try {await this.save(grants,before,'grant-revoke',g,device);}catch{throw failure();}
    }
    return {...g,status:this.status(g)};
  }); }
}
