import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {HUB_R26_URL:url,HUB_R26_SHOTS:shots,HUB_EGO_SPACE:space,HUB_F4_PHASE:phase='after-new'}=process.env;
assert(url&&shots&&space,'需要假 URL、截图目录与 Ego 空间');
const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'3592');assert(/^[a-z-]+$/.test(phase));
const source=await readFile(new URL('./f4-roster-browser.ego.mjs',import.meta.url),'utf8');
process.stdout.write(source.replace('__CONFIG__',JSON.stringify({url,shots,phase,space:/^\d+$/.test(space)?Number(space):space})));
