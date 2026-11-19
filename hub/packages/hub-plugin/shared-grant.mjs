import {AsyncLocalStorage} from 'node:async_hooks';
const KEY=Symbol('hub-plugin.shared-grant');
// rc.1只有resolve公开入口；按已批准execution的异步链补充shared写根，不写表、不改会话mode。
export function sharedGrant(ctx,sandbox) {
 if(!sandbox)return async(_session,_root,next)=>next();
 if(typeof sandbox.registerWritableRoot==='function')return async(session,root,next)=>{const dispose=sandbox.registerWritableRoot(session,root);try{return await next();}finally{await dispose();}};
 if(typeof sandbox.resolve!=='function')return async()=>{throw Error('这件事我做不了：本内核没有可用的共享区写根接口');};
 let state=sandbox[KEY];
 if(!state){
  const storage=new AsyncLocalStorage(),original=sandbox.resolve;
  const wrapped=function(request={}){
   const policy=Reflect.apply(original,this,[request]),grant=storage.getStore();
   if(!grant || request.session!==grant.session || policy.mode!=='workspace-write')return policy;
   return {...policy,additionalWritableRoots:[...new Set([...(policy.additionalWritableRoots??[]),grant.root])]};
  };
  state={storage,original,wrapped,refs:0};sandbox[KEY]=state;sandbox.resolve=wrapped;
 }
 state.refs++;
 ctx.effect?.(()=>()=>{if(--state.refs===0){if(sandbox.resolve===state.wrapped)sandbox.resolve=state.original;delete sandbox[KEY];}});
 return async(session,root,next)=>state.storage.run({session,root},next);
}
