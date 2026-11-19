import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// 隔离运行真实的实例判定函数，用内存文件树表示配置丢失但助理数据仍在的旧实例。
test('旧实例仍有助理数据时配置目录空缺不能判为全新全开', () => {
  const src=readFileSync(new URL('../../../scripts/demo-prepare.mjs',import.meta.url),'utf8');
  const begin=src.indexOf('function pathExists('), end=src.indexOf('// 只在全新实例',begin);
  assert.ok(begin>=0 && end>begin);
  const dirs=new Set(['/instance/hub/config','/instance/hub/bots','/instance/hub/bots/writer']);
  const fs={lstatSync(p){if(!dirs.has(p)){const e=new Error('missing');e.code='ENOENT';throw e;} return {isSymbolicLink:()=>false,isDirectory:()=>true};},readdirSync(p){return p==='/instance/hub/config'?[]:['writer'];}};
  const fresh=vm.runInNewContext(src.slice(begin,end)+'\nfreshDemoInstance', {fs,path});
  assert.equal(fresh('/instance'),false);
});
