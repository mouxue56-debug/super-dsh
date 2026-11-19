// 输出可交给 ego-browser nodejs 的脚本，不启动服务、不安装浏览器。
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {HUB_R26_URL:url,HUB_R26_SHOTS:shots,HUB_R26_IMAGE:image,HUB_EGO_SPACE:space}=process.env;
assert(url && shots && image && space,'请设置 HUB_R26_URL / HUB_R26_SHOTS / HUB_R26_IMAGE / HUB_EGO_SPACE');
const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'3592');
const source=await readFile(new URL('./r26-roster-browser.ego.mjs',import.meta.url),'utf8');
process.stdout.write(source.replace('__CONFIG__',JSON.stringify({url,shots,image,space:/^\d+$/.test(space)?Number(space):space})));
