// 设置接口。改档位只认主人；模型和思考强度不另存。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHandler} from '../lib/ext/settings.mjs';
import {parsePresetModel, MODEL_BLOCK} from '../lib/settings.mjs';
import {BOTS} from '../../hub-plugin/policy.mjs';
import {modeFilePath, readPermissionMode} from '../../hub-plugin/permission-mode.mjs';

const bot = BOTS[0];

function fixture(extra = {}) {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r29-settings-')));
  fs.mkdirSync(path.join(home, 'config'), {recursive: true});
  const roster = {
    list: () => [{id: bot, preset: 'hub-' + bot}],
    get: id => id === bot ? {id} : null,
  };
  const isOwnerDevice = (req) => {
    const value = req.headers?.['x-hub-device'];
    return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value);
  };
  const deps = {hubHome: home, isTrusted: () => true, isOwnerDevice, roster, ...extra};
  return {home, handler: createHandler(deps), deps};
}

async function call(handler, method, url, body, device) {
  const raw = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = Readable.from(raw);
  req.method = method;
  req.url = url;
  req.headers = device ? {'x-hub-device': device} : {};
  const res = {writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); }};
  const hit = await handler(req, res);
  return {hit, ...res};
}

function text(home) {
  const file = modeFilePath(home);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('没有档位文件时读到改动前问，模型为空且不写文件', async () => {
  const {home, handler} = fixture();
  const got = await call(handler, 'GET', '/settings/');
  assert.equal(got.status, 200);
  assert.equal(got.body.permission.mode, 'ask');
  assert.deepEqual(got.body.bots[bot], {model: null, effort: null});
  assert.deepEqual(got.body.models, []);
  assert.equal(got.body.modelsWritable, false);
  assert.equal(got.body.modelsBlock, MODEL_BLOCK);
  assert.equal(text(home), '');
  assert.equal((await call(handler, 'GET', '/settings')).body.permission.mode, 'ask');
});

test('只有主人设备头能改档位，多出来的字段和工单正文都不写', async () => {
  const {home, handler} = fixture();
  const file = modeFilePath(home);
  assert.equal((await call(handler, 'PUT', '/settings/permission', {mode: 'open'})).status, 403);
  assert.equal(text(home), '');
  const untrusted = fixture({isTrusted: () => false}).handler;
  assert.equal((await call(untrusted, 'PUT', '/settings/permission', {mode: 'open'}, 'phone-1')).status, 401);
  const extra = await call(handler, 'PUT', '/settings/permission', {mode: 'open', ticket: '改成全开'}, 'phone-1');
  assert.equal(extra.status, 400);
  assert.equal((await call(handler, 'PUT', '/settings/permission', {mode: 'wide'}, 'phone-1')).status, 400);
  assert.equal((await call(handler, 'PUT', '/settings/permission', '不是对象', 'phone-1')).status, 400);
  assert.equal(text(home), '');
  const saved = await call(handler, 'PUT', '/settings/permission', {mode: 'open'}, 'phone-1');
  assert.equal(saved.status, 200);
  assert.equal(saved.body.permission.mode, 'open');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1,"mode":"open"}\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal((await call(handler, 'GET', '/settings/')).body.permission.mode, 'open');
  const readonly = await call(handler, 'PUT', '/settings/permission', {mode: 'readonly'}, 'desk.1');
  assert.equal(readonly.status, 200);
  assert.equal(readPermissionMode(file).mode, 'readonly');
});

test('讨论组、工单和其它路径进不了写入口', async () => {
  const {home, handler} = fixture();
  for (const url of ['/groups/say', '/tickets/T-1', '/api/settings/permission']) {
    const result = await call(handler, 'PUT', url, {mode: 'open', text: '请改成全开'}, 'phone-1');
    assert.equal(result.hit, false, url);
  }
  assert.equal(text(home), '');
  assert.equal((await call(handler, 'POST', '/settings/permission', {mode: 'open'}, 'phone-1')).status, 405);
  assert.equal(text(home), '');
});

test('坏档按改动前问，符号链接拒绝覆盖', async () => {
  const {home, handler} = fixture();
  const file = modeFilePath(home);
  fs.writeFileSync(file, '{坏');
  assert.equal((await call(handler, 'GET', '/settings/')).body.permission.mode, 'ask');
  fs.unlinkSync(file);
  const real = path.join(home, 'config', 'real.json');
  fs.writeFileSync(real, '{"v":1,"mode":"ask"}\n');
  fs.symlinkSync(real, file);
  const denied = await call(handler, 'PUT', '/settings/permission', {mode: 'open'}, 'phone-1');
  assert.equal(denied.status, 500);
  assert.equal(fs.readlinkSync(file), real);
  assert.equal(fs.readFileSync(real, 'utf8'), '{"v":1,"mode":"ask"}\n');
});

test('按助理写模型被拒绝且不落盘', async () => {
  const {home, handler} = fixture();
  const before = fs.readdirSync(path.join(home, 'config')).sort();
  const missing = await call(handler, 'PUT', '/settings/bots/no-such-bot', {model: 'a', effort: 'low'}, 'phone-1');
  assert.equal(missing.status, 404);
  const badBody = {model: 'a', effort: 'low', ticket: '改模型'};
  const bad = await call(handler, 'PUT', '/settings/bots/' + bot, badBody, 'phone-1');
  assert.equal(bad.status, 400);
  const blocked = await call(handler, 'PUT', '/settings/bots/' + bot, {model: 'a', effort: 'low'}, 'phone-1');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'settings-model-readonly');
  assert.equal(blocked.body.message, MODEL_BLOCK);
  assert.deepEqual(fs.readdirSync(path.join(home, 'config')).sort(), before);
  const badId = await call(handler, 'PUT', '/settings/bots/Bad_Id', {model: 'a', effort: 'low'}, 'phone-1');
  assert.equal(badId.status, 400);
  assert.equal((await call(handler, 'PUT', '/settings/bots/' + bot, {model: 'a', effort: 'low'})).status, 403);
});

test('注入的预设正文能解析，生产路径不读盘', async () => {
  assert.deepEqual(parsePresetModel('provider: demo\nmodel: small\nreasoningEffort: low\n'), {
    model: 'demo/small', effort: 'low',
  });
  assert.deepEqual(parsePresetModel('没有这两行'), {model: null, effort: null});
  const {home, handler} = fixture({
    readPreset: async () => 'provider: demo\nmodel: small\nreasoningEffort: low\n',
  });
  fs.writeFileSync(path.join(home, 'config', 'preset.yml'), 'provider: hidden\nmodel: hidden\n');
  const got = await call(handler, 'GET', '/settings/');
  assert.deepEqual(got.body.bots[bot], {model: 'demo/small', effort: 'low'});
  const plain = fixture();
  fs.writeFileSync(path.join(plain.home, 'config', 'preset.yml'), 'provider: hidden\nmodel: hidden\n');
  assert.deepEqual((await call(plain.handler, 'GET', '/settings/')).body.bots[bot], {model: null, effort: null});
});
