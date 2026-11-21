import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { join } from 'node:path';

const MAX_SAMPLES = 60000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_HTTP_BYTES = 1024 * 1024;
const TIMEOUT_MS = 3000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = reason => Object.assign(new Error(reason), { nativeReason: reason });

function privateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  if (isIP(address) !== 6) return false;
  const host = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/u.test(host)) return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(host);
  if (!mapped) return false;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return privateAddress([high >> 8, high & 255, low >> 8, low & 255].join('.'));
}

// Only a configured private endpoint is read. Authentication and URL query strings are never forwarded.
export function validateCostMeterUrl(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return privateAddress(host) || host === 'localhost' || host.endsWith('.ts.net') ? url : null;
}

// Resolve once for this connection, inspect every answer, and use that same answer for the socket.
function privateLookup(hostname, options, callback) {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(item => !privateAddress(item.address))) {
      return callback(failure('cost-meter 地址解析到非私网'));
    }
    if (options.all) return callback(null, addresses);
    const address = addresses.find(item => !options.family || item.family === options.family) || addresses[0];
    callback(null, address.address, address.family);
  });
}

async function sampleText(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw failure('quota-watch 文件不可读');
    if (stat.size > MAX_FILE_BYTES) throw failure('quota-watch 格式不对：文件过大');
    const chunks = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_FILE_BYTES + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_FILE_BYTES) throw failure('quota-watch 格式不对：文件过大');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error.nativeReason) throw error;
    throw failure(error.code === 'ENOENT' ? 'quota-watch 文件不存在' : 'quota-watch 文件不可读');
  } finally {
    await handle?.close();
  }
}

export async function readQuotaSamples(file) {
  let samples;
  const text = await sampleText(file);
  try { samples = JSON.parse(text); } catch { throw failure('quota-watch 格式不对：JSON 无效'); }
  if (!Array.isArray(samples) || samples.length > MAX_SAMPLES) {
    throw failure('quota-watch 格式不对：须为最多 60000 条样本的数组');
  }
  for (const sample of samples) {
    if (!object(sample) || !Number.isFinite(sample.t) || !Number.isFinite(sample.c) || sample.c < 0 ||
        typeof sample.p !== 'string' || !sample.p.trim() || sample.p.length > 200) {
      throw failure('quota-watch 格式不对：样本须含有效 t、p、c');
    }
    const date = new Date(sample.t + JST_OFFSET_MS);
    if (Number.isNaN(date.getTime())) throw failure('quota-watch 格式不对：样本时间无效');
  }
  return samples;
}

async function quotaWatch(file) {
  const samples = await readQuotaSamples(file);
  const groups = new Map();
  let totalUsd = 0;
  for (const sample of samples) {
    const date = new Date(sample.t + JST_OFFSET_MS);
    const day = date.toISOString().slice(0, 10);
    const key = JSON.stringify([day, sample.p]);
    const group = groups.get(key) || { day, provider: sample.p, calls: 0, usd: 0 };
    group.calls += 1;
    group.usd += sample.c;
    groups.set(key, group);
    totalUsd += sample.c;
    if (!Number.isFinite(totalUsd)) throw failure('quota-watch 格式不对：金额超出范围');
  }
  const days = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) ||
    a.provider.localeCompare(b.provider));
  return { days, totalUsd, calls: samples.length };
}

export function fetchCostMeterStatus(url) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    let request;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(() => {
      const error = failure('cost-meter 超时（3 秒）');
      finish(error);
      request?.destroy(error);
    }, TIMEOUT_MS);
    const options = { lookup: privateLookup, agent: false, headers: { accept: 'application/json' } };
    request = transport.get(url, options,
      response => {
        if (response.statusCode !== 200) {
          const reason = response.statusCode >= 300 && response.statusCode < 400
            ? 'cost-meter 接口不通：不允许重定向'
            : `cost-meter 接口不通（HTTP ${response.statusCode}）`;
          finish(failure(reason));
          response.destroy();
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_HTTP_BYTES) {
            finish(failure('cost-meter 格式不对：响应过大'));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on('error', () => finish(failure('cost-meter 接口不通：响应中断')));
        response.on('end', () => {
          let value;
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
            return finish(failure('cost-meter 格式不对：JSON 无效'));
          }
          if (!object(value) || !object(value.usage) || !object(value.limits) || !object(value.providers) ||
              (value.balance !== undefined && value.balance !== null && !object(value.balance))) {
            return finish(failure('cost-meter 格式不对：缺少有效 usage、limits、providers 或 balance'));
          }
          const data = { usage: value.usage, limits: value.limits, providers: value.providers };
          if (value.balance !== undefined) data.balance = value.balance;
          finish(null, data);
        });
      });
    request.on('error', error => finish(error.nativeReason ? error : failure('cost-meter 接口不通')));
  });
}

// Missing configuration hides the comparison. An explicit object opts in to the DSH_HOME file default.
export async function readNativeLedger(config, { env = process.env } = {}) {
  if (config == null) return undefined;
  if (!object(config)) return { ok: false, reason: 'nativeLedger 配置格式不对' };
  const file = config.quotaWatchFile ?? (env.DSH_HOME ? join(env.DSH_HOME, 'storages', 'quota-watch.json') : null);
  const urlValue = config.costMeterUrl;
  const hasFile = file !== null && file !== '';
  const hasUrl = urlValue != null && urlValue !== '';
  if (!hasFile && !hasUrl) return undefined;
  const tasks = [];
  const reasons = [];
  const result = {};
  if (hasFile) {
    if (typeof file !== 'string' || !file.trim()) reasons.push('quota-watch 文件路径格式不对');
    else tasks.push(['quotaWatch', () => quotaWatch(file)]);
  }
  if (hasUrl) {
    const url = validateCostMeterUrl(urlValue);
    if (!url) reasons.push('cost-meter 地址无效：仅允许无凭据的回环或私网 HTTP(S) 地址');
    else tasks.push(['costMeter', () => fetchCostMeterStatus(url)]);
  }
  const outcomes = await Promise.allSettled(tasks.map(([, run]) => run()));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') result[tasks[index][0]] = outcome.value;
    else reasons.push(outcome.reason?.nativeReason || '本体账本读取失败');
  });
  return reasons.length ? { ...result, ok: false, reason: reasons.join('；') } : result;
}
