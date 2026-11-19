import fs from 'node:fs';
import path from 'node:path';
export const INVENTORY_DENY='工具清单和权限表对不上，先全部停用，等监工核对';
export function inspectToolInventory(ctx,agent,expected){
 const view=ctx.tools.view(agent),visible=view?.visible;
 if(!(visible instanceof Map))throw Error('无法列举agent实际工具清单');
 const actual=[...visible.keys()].sort();
 return {actual,extra:actual.filter(n=>!expected.includes(n)),missing:expected.filter(n=>!actual.includes(n))};
}
export function appendInventoryAlert(hubHome,bot,extra){
 const dir=path.join(hubHome,'config');
 if(fs.realpathSync.native(dir)!==path.resolve(dir))throw Error('报警目录不能为链接');
 const fd=fs.openSync(path.join(dir,'alerts.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 try{fs.fchmodSync(fd,0o600);fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),bot,event:'tool-inventory-mismatch',extra})+'\n');}finally{fs.closeSync(fd);}
}
