import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('隔离准备不沿用复制profile指向旧仓库的插件链接，保留旧链接备份',()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),parent=path.join(os.homedir(),'dsh-work/tmp/r26-E1');fs.mkdirSync(parent,{recursive:true});
 const tmp=fs.realpathSync.native(fs.mkdtempSync(parent+'/prepare-')),base=tmp+'/home',scratch=tmp+'/scratch',source=base+'/dev-home-r23/profiles/web',old=tmp+'/old-plugin';
 fs.mkdirSync(source+'/node_modules',{recursive:true});fs.mkdirSync(old);fs.writeFileSync(source+'/package.json','{"dependencies":{}}');fs.writeFileSync(source+'/cordis.patch.yml','[]\n');fs.symlinkSync(old,source+'/node_modules/dsh-hub-plugin');
 const run=spawnSync(process.execPath,[root+'/packages/hub-plugin/ops/prepare.mjs'],{env:{...process.env,HUB_HOME:base,HUB_REPO:root,HUB_SCRATCH:scratch},encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const modules=scratch+'/profiles/web/node_modules';assert.equal(fs.realpathSync.native(modules+'/dsh-hub-plugin'),root+'/packages/hub-plugin');
 const backup=fs.readdirSync(modules).find(n=>n.startsWith('dsh-hub-plugin.bak-r26-'));assert.ok(backup);assert.equal(fs.realpathSync.native(modules+'/'+backup),old);
});
