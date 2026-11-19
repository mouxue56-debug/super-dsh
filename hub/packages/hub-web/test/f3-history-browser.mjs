import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {HUB_R26_URL:url,HUB_R26_SHOTS:shots,HUB_EGO_SPACE:space,HUB_F3_PHASE:phase='after',HUB_F3_PAGE:page='p1'}=process.env;
assert(url&&shots&&space,'需要假 URL、截图目录与 Ego 空间');
const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'3592');
assert(/^[a-z-]+$/.test(phase));assert(/^p[1-9][0-9]*$/.test(page));
const source=await readFile(new URL('./f3-history-browser.ego.mjs',import.meta.url),'utf8');
process.stdout.write(source.replace('__CONFIG__',JSON.stringify({url,shots,phase,page,space:/^\d+$/.test(space)?Number(space):space})));
