import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fetchCostMeterStatus, readQuotaSamples, validateCostMeterUrl } from './native-ledger.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const DAY_MS = 86_400_000;
const PROVIDERS = ['opencode', 'deepseek', 'ollama'];
const PROVIDER_LABELS = { opencode: 'OpenCode Go', deepseek: 'DeepSeek', ollama: 'Ollama' };
const WINDOWS = [['h5', 5 * 3_600_000], ['d7', 7 * DAY_MS], ['d30', 30 * DAY_MS]];
const LIMITS = [
  ['h5', 'h5', '5 小时'],
  ['week', 'd7', '本周'],
  ['month', 'd30', '本月'],
];

function localDay(ms, offset) {
  return new Date(ms + offset * 60000).toISOString().slice(0, 10);
}

function dayStart(day, offset) {
  return Date.parse(`${day}T00:00:00Z`) - offset * 60000;
}

function emptyBucket() {
  return { calls: 0, usd: 0, byProvider: Object.create(null) };
}

function addSample(bucket, sample) {
  bucket.calls += 1;
  bucket.usd += sample.c;
  const provider = bucket.byProvider[sample.p] || (bucket.byProvider[sample.p] = { calls: 0, usd: 0 });
  provider.calls += 1;
  provider.usd += sample.c;
}

function summarizeSamples(samples, now, offset) {
  const today = localDay(now, offset);
  const weekStart = dayStart(today, offset) - 6 * DAY_MS;
  const monthStart = dayStart(`${today.slice(0, 7)}-01`, offset);
  const summary = { today: emptyBucket(), week: emptyBucket(), month: emptyBucket() };
  for (const sample of samples) {
    if (sample.t >= dayStart(today, offset)) addSample(summary.today, sample);
    if (sample.t >= weekStart) addSample(summary.week, sample);
    if (sample.t >= monthStart) addSample(summary.month, sample);
  }
  return summary;
}

function sampleWindows(samples, now) {
  const out = {};
  for (const provider of PROVIDERS) {
    out[provider] = {};
    for (const [key, span] of WINDOWS) {
      let calls = 0, usd = 0;
      for (const sample of samples) {
        if (sample.p === provider && sample.t >= now - span) {
          calls += 1;
          usd += sample.c;
        }
      }
      out[provider][key] = { calls, usd };
    }
  }
  return out;
}

function quotaOf(status, windows) {
  const quota = [];
  const limits = object(status?.limits) ? status.limits : {};
  const usage = object(status?.usage) ? status.usage : {};
  for (const provider of PROVIDERS) {
    const cap = limits[provider];
    if (!object(cap)) continue;
    const rows = [];
    for (const [capKey, usageKey, label] of LIMITS) {
      const limit = cap[capKey];
      if (!Number.isFinite(limit) || limit < 0) continue;
      const fromMeter = usage[provider]?.[usageKey];
      const used = Number.isFinite(fromMeter) ? fromMeter : windows[provider]?.[usageKey]?.usd;
      if (!Number.isFinite(used)) continue;
      rows.push({
        key: capKey,
        label,
        limit,
        used,
        remaining: Math.max(0, limit - used),
      });
    }
    if (rows.length) {
      quota.push({
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        currency: 'USD',
        windows: rows,
      });
    }
  }
  return quota;
}

// 没写 plugins 段时退回旧的 nativeLedger 段；再没有就只在 DSH_HOME 明确指向内核数据目录时探测。
export function resolvePluginSource(hubConfig, { env = process.env } = {}) {
  const explicit = hubConfig?.plugins;
  if (explicit !== undefined) {
    if (explicit === null || explicit === false) return undefined;
    return explicit;
  }
  const legacy = hubConfig?.nativeLedger;
  if (legacy !== undefined) {
    if (legacy === null || legacy === false) return undefined;
    return legacy;
  }
  const home = env.DSH_HOME;
  if (typeof home === 'string' && isAbsolute(home) && existsSync(join(home, 'storages', 'quota-watch.json'))) {
    const source = { quotaWatchFile: join(home, 'storages', 'quota-watch.json'), detected: true };
    try {
      const base = new URL(env.DSH_URL);
      if (base.protocol === 'http:' && base.hostname === '127.0.0.1' && !base.username &&
          !base.password && !base.search && !base.hash && base.pathname === '/') {
        source.costMeterUrl = new URL('/plugins/cost-meter/status', base).href;
      }
    } catch { /* 没有可用的 DSH_URL 就只读文件 */ }
    return source;
  }
  return undefined;
}

// 插件数据源：直接读 cost-meter / quota-watch 写出的样本与状态，不读任何凭据。
export async function readPluginLedger(config, { env = process.env, now = Date.now(), utcOffsetMinutes = 0 } = {}) {
  if (config === undefined || config === null || config === false) return undefined;
  if (!object(config)) return { ok: false, source: 'plugins', reasons: ['plugins 配置格式不对'] };

  const reasons = [];
  const tasks = [];
  let file = null;
  const configuredFile = config.quotaWatchFile;
  if (configuredFile !== undefined && configuredFile !== null && configuredFile !== '') {
    if (typeof configuredFile !== 'string' || !configuredFile.trim()) reasons.push('quota-watch 文件路径格式不对');
    else file = configuredFile;
  } else {
    const home = env.DSH_HOME;
    if (typeof home === 'string' && isAbsolute(home)) file = join(home, 'storages', 'quota-watch.json');
  }
  if (file !== null) tasks.push(['samples', () => readQuotaSamples(file)]);

  let url = null;
  const configuredUrl = config.costMeterUrl;
  if (configuredUrl !== undefined && configuredUrl !== null && configuredUrl !== '') {
    url = validateCostMeterUrl(configuredUrl);
    if (!url) reasons.push('cost-meter 地址无效：仅允许无凭据的回环或私网 HTTP(S) 地址');
    else tasks.push(['status', () => fetchCostMeterStatus(url)]);
  }

  if (!tasks.length) {
    return { ok: false, source: 'plugins', reasons: reasons.length ? reasons : ['没有找到插件数据位置'] };
  }

  const outcomes = await Promise.allSettled(tasks.map(([, run]) => run()));
  let samples = null, status = null;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      if (tasks[index][0] === 'samples') samples = outcome.value;
      else status = outcome.value;
    } else {
      reasons.push(outcome.reason?.nativeReason || '插件账本读取失败');
    }
  });
  if (samples === null && status === null) {
    return { ok: false, source: 'plugins', reasons };
  }

  const windows = sampleWindows(samples ?? [], now);
  const sources = [];
  if (status !== null) sources.push('cost-meter');
  if (samples !== null) sources.push('quota-watch');
  const result = {
    ok: true,
    at: now,
    source: status !== null ? 'cost-meter' : 'quota-watch',
    sources,
    currency: 'USD',
    windows,
    quota: quotaOf(status, windows),
    reasons,
  };
  if (samples !== null) result.summary = summarizeSamples(samples, now, utcOffsetMinutes);
  if (status !== null) {
    result.providers = status.providers;
    if (object(status.balance)) result.balance = status.balance;
  }
  return result;
}
