import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHandler} from '../lib/ext/exposure.mjs';
import {markExposed} from '../lib/bot-exposure.mjs';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fixj-ext-'));
  fs.mkdirSync(path.join(home, 'config'));
  return {home, handler: createHandler({hubHome: home, roster: {bots: [{id: 'writer'}, {id: 'helper'}]}})};
}

async function call(handler, method, url, body, device) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, {method, url, headers: device ? {'x-hub-device': device} : {}});
  const res = {writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); }};
  assert.equal(await handler(req, res), true);
  return res;
}

test('列表可读，确认卡和解除只认主人设备头', async () => {
  const {home, handler} = fixture();
  markExposed(home, 'writer', {why: '网页', source: 'read', session: 'a'});
  const list = await call(handler, 'GET', '/exposure');
  assert.equal(list.status, 200);
  assert.equal(list.body.bots.find(b => b.bot === 'writer').exposed, true);
  assert.equal(list.body.bots.find(b => b.bot === 'helper').exposed, false);
  assert.equal((await call(handler, 'POST', '/exposure/writer/card')).status, 403);
  assert.equal((await call(handler, 'POST', '/exposure/writer/clear', {digest: 'x', approved: true})).status, 403);
  const card = await call(handler, 'POST', '/exposure/writer/card', undefined, 'phone');
  assert.equal(card.status, 200);
  assert.deepEqual(Object.keys(card.body).sort(), ['bot', 'broken', 'count', 'digest', 'notice', 'reasons', 'since']);
  assert.equal(card.body.broken, false);
  assert.match(card.body.notice, /新开会话/u);
  const unapproved = await call(handler, 'POST', '/exposure/writer/clear', {digest: card.body.digest}, 'phone');
  assert.equal(unapproved.status, 400);
  const conflict = await call(handler, 'POST', '/exposure/writer/clear', {digest: 'old', approved: true}, 'phone');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.message, '状态已变，请重新出确认卡');
  assert.equal((await call(handler, 'POST', '/exposure/writer/clear',
    {digest: card.body.digest, approved: true}, 'phone')).status, 200);
  const missing = await call(handler, 'POST', '/exposure/writer/card', undefined, 'phone');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.message, '这位助理没有接触外部内容的状态');
});

test('损坏文件出卡并可按原始字节摘要解除', async () => {
  const {home, handler} = fixture();
  fs.mkdirSync(path.join(home, 'config', 'exposure'));
  fs.writeFileSync(path.join(home, 'config', 'exposure', 'writer.json'), '{坏');
  const card = await call(handler, 'POST', '/exposure/writer/card', undefined, 'phone');
  assert.equal(card.body.broken, true);
  assert.equal(card.body.since, null);
  assert.deepEqual(card.body.reasons, []);
  assert.equal((await call(handler, 'POST', '/exposure/writer/clear',
    {digest: card.body.digest, approved: true}, 'phone')).status, 200);
  assert.equal(fs.readFileSync(path.join(home, 'config', 'exposure-clears.log'), 'utf8').trim().split('\n').length, 1);
});
