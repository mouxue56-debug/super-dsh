import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const mod=await import('../command-sandbox.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const base=path.join(process.env.HUB_HOME||path.join(os.homedir(),'dsh-work'),'tmp/r26-A2');fs.mkdirSync(base,{recursive:true});
const home=fs.mkdtempSync(base+'/sandbox-unit-'),own=home+'/own';fs.mkdirSync(own+'/.tmp',{recursive:true});
const build=(options={})=>{assert.equal(typeof mod.buildProfile,'function','缺少 profile 生成接口');return mod.buildProfile({home,hubHome:home+'/work',own,readable:[own],denyRead:[home+'/.secrets'],network:false,...options});};
test('profile拒绝默认写和联网且保护读禁区',()=>{const p=build();assert.match(p,/\(allow default\)/);assert.match(p,/\(deny file-write\*\)/);assert.match(p,/\(deny network\*\)/);assert.match(p,/\(deny file-read-data/);assert.ok(p.lastIndexOf('(deny file-read*')>p.indexOf('(allow file-read-data'));assert.ok(!p.includes('(subpath "/private/tmp")'));assert.ok(!p.includes('/dev/tty'));});
test('批准联网只改变对应profile开关',()=>assert.ok(!build({network:true}).includes('(deny network*)')));
test('profile转义SBPL字符串',()=>assert.match(build({readable:[own+'/a"b\\c']}),/a\\"b\\\\c/));
test('写根不能从批准参数打开敏感区',()=>assert.throws(()=>build({extraWrite:[home+'/.secrets']}),/禁止|敏感/));
test('profile不能允许把own放到家目录根',()=>assert.throws(()=>build({own:home}),/目录|根/));
function kernel(){return {argv:['/usr/bin/sandbox-exec','-p','old-profile','--','bash','-c','pwd'],enforcement:'full',denialSignatures:['operation not permitted'],runnerFailureRules:[{fatalSignatures:['sandbox-exec: ']}]};}
function install(service,getCall){assert.equal(typeof mod.installCommandSandbox,'function','缺少 confine 包装接口');return mod.installCommandSandbox({},service,{getCall});}
test('无getCall的非助理调用原样返回同一对象',async()=>{const expected=kernel(),service={async confine(){return expected;}};const dispose=install(service,()=>null);assert.equal(await service.confine(['bash','-c','pwd'],{}),expected);dispose();});
test('保留内核元信息和argv顺序，仅替换profile并插入TMPDIR',async()=>{const expected=kernel(),service={async confine(){return expected;}};const original=service.confine,dispose=install(service,()=>({home,hubHome:home+'/work',own,readable:[own],network:false,extraWrite:[],tmpdir:own+'/.tmp'}));const r=await service.confine(['bash','-c','pwd'],{});assert.deepEqual(r.argv.slice(3),['--','/usr/bin/env','TMPDIR='+own+'/.tmp','bash','-c','pwd']);assert.equal(r.enforcement,'full');assert.deepEqual(r.runnerFailureRules,expected.runnerFailureRules);assert.equal(expected.argv[2],'old-profile');assert.match(r.argv[2],/deny network/);dispose();assert.equal(service.confine,original);dispose();});
for(const argv of [['bash','-c','pwd'],['bwrap','--','bash','-c','pwd'],['sandbox-exec','-f','x','--','bash','-c','pwd'],['sandbox-exec','-p','x','--','python3','x']])test('未知内核argv失败关闭 '+JSON.stringify(argv),async()=>{const service={async confine(){return {...kernel(),argv};}},dispose=install(service,()=>({home,own,readable:[own]}));await assert.rejects(()=>service.confine(['bash','-c','pwd'],{}),/未知|无法|形状/);dispose();});
test('TMPDIR不能通过符号链接写出own',async()=>{fs.symlinkSync(base,own+'/outside-tmp');const service={async confine(){return kernel();}},dispose=install(service,()=>({home,own,readable:[own],tmpdir:own+'/outside-tmp'}));await assert.rejects(()=>service.confine(['bash','-c','pwd'],{}),/TMPDIR|目录/);dispose();});
test('内核异常保持失败，不降级为无沙箱',async()=>{const service={async confine(){throw Error('kernel unavailable');}},dispose=install(service,()=>({home,own,readable:[own]}));await assert.rejects(()=>service.confine([],{}),/kernel unavailable/);dispose();});


for(const network of [false,true])test('批准联网仍生成回环与Unix socket显式禁令 '+network,()=>{const p=build({network,selfAddrs:['192.0.2.45']});assert.match(p,/\(deny network-outbound \(remote ip "localhost:\*"\)\)/);assert.match(p,/\(deny network-outbound \(remote unix-socket\)\)/);assert.match(p,/192\.0\.2\.45/);});
for(const selfAddrs of ['192.0.2.45',[null],['bad-host'],['192.0.2.45\n(allow network*)']])test('profile selfAddrs非法就失败关闭 '+JSON.stringify(selfAddrs),()=>assert.throws(()=>build({network:true,selfAddrs}),/selfAddrs|地址/));
test('getCall的selfAddrs进入实际内核profile且命令不变',async()=>{const service={async confine(){return kernel();}},dispose=install(service,()=>({home,own,network:true,selfAddrs:['192.0.2.45']}));try{const r=await service.confine(['bash','-c','pwd'],{});assert.match(r.argv[2],/192\.0\.2\.45/);assert.match(r.argv[2],/deny network-outbound/);assert.deepEqual(r.argv.slice(-3),['bash','-c','pwd']);}finally{dispose();}});
