import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHandler} from '../lib/ext/settings.mjs';
import {currentMode} from '../lib/settings.mjs';

test('共享密钥持有者伪造设备头不能冒充主人切全开', async () => {
 const root=path.resolve(process.cwd(),'../review7-test-data');
 fs.mkdirSync(root,{recursive:true});
 const hubHome=fs.mkdtempSync(path.join(root,'review7-settings-'));
 const request=Readable.from([Buffer.from('{"mode":"open"}')]);
 request.url='/settings/permission'; request.method='PUT';
 request.headers={'x-hub-device':'fake-owner'};
 let status; const res={writeHead(s){status=s;},end(){}};
 await createHandler({hubHome,isTrusted:()=>true})(request,res);
 assert.equal(status,403);
 assert.equal(currentMode(hubHome),'ask');
});

