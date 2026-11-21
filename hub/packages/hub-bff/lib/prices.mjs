import { readFileSync } from 'node:fs';

const fields = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];
const referenceFields = fields.map((k) => `reference${k[0].toUpperCase()}${k.slice(1)}`);
const dateValid = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function yaml(text) {
  const rows = [];
  let current = null, header = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i], quote = null, cut = line.length;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (quote) { if (c === quote && (quote !== '"' || line[j - 1] !== '\\')) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '#' && (j === 0 || /\s/.test(line[j - 1]))) {
        cut = j;
        break;
      }
    }
    if (quote) throw new Error(`line ${i + 1}: unterminated quote`);
    line = line.slice(0, cut);
    if (!line.trim()) continue;
    if (!header) {
      if (line.trim() !== 'prices:' || /^\s/.test(line)) throw new Error(`line ${i + 1}: expected prices:`);
      header = true;
      continue;
    }
    const m = line.match(/^(?:  (-)\s+|    (?!-))([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/);
    if (!m) throw new Error(`line ${i + 1}: unsupported YAML`);
    if (m[1]) {
      current = {};
      rows.push(current);
    } else if (!current) throw new Error(`line ${i + 1}: expected list item`);
    const key = m[2], raw = m[3];
    if (Object.hasOwn(current, key)) throw new Error(`line ${i + 1}: duplicate key`);
    let value;
    if (!raw || raw === 'null' || raw === '~') value = null;
    else if (raw[0] === '"') {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(`line ${i + 1}: invalid quoted value`);
      }
    } else if (raw[0] === "'") {
      if (!/^'(?:[^']|'')*'$/.test(raw)) throw new Error(`line ${i + 1}: invalid quoted value`);
      value = raw.slice(1, -1).replace(/''/g, "'");
    } else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) value = Number(raw);
    else if (/[\[\]{}&*!|>@`]/.test(raw) || /:\s/.test(raw)) {
      throw new Error(`line ${i + 1}: unsupported YAML value`);
    } else value = raw;
    current[key] = value;
  }
  if (!header) throw new Error('line 1: expected prices:');
  return rows;
}

// 解析价格表。
export function parsePriceTable(text, { format } = {}) {
  if (typeof text !== 'string') throw new TypeError('price table must be text');
  format ??= /^[\s\uFEFF]*[\[{]/.test(text) ? 'json' : 'yaml';
  let rows;
  if (format === 'json') {
    const obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.prices)) throw new Error('prices must be an array');
    rows = obj.prices;
  } else if (format === 'yaml') rows = yaml(text);
  else throw new Error('unsupported format');
  return rows.map((raw, i) => {
    const fail = (message) => {
      throw new Error(`row ${i + 1}: ${message}`);
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('expected object');
    const allowed = [
      'channel',
      'model',
      'mode',
      'currency',
      'perTokens',
      ...fields,
      'source',
      'checkedAt',
      'expiresAt',
      ...referenceFields,
      'referenceCurrency',
    ];
    for (const k of Object.keys(raw)) if (!allowed.includes(k)) fail(`unsupported field ${k}`);
    const r = { ...raw, mode: raw.mode ?? 'metered', perTokens: raw.perTokens ?? 1000000 };
    for (const k of ['channel', 'model']) if (typeof r[k] !== 'string' || !r[k].trim()) fail(`${k} required`);
    if (!['metered', 'plan', 'local'].includes(r.mode)) fail('invalid mode');
    if (typeof r.perTokens !== 'number' || !Number.isFinite(r.perTokens) || r.perTokens <= 0) {
      fail('invalid perTokens');
    }
    for (const k of [...fields, ...referenceFields]) {
      r[k] ??= null;
      if (r[k] !== null && (typeof r[k] !== 'number' || !Number.isFinite(r[k]) || r[k] < 0)) {
        fail(`invalid ${k}`);
      }
    }
    for (const k of ['currency', 'source', 'referenceCurrency']) {
      if (r[k] != null && (typeof r[k] !== 'string' || !r[k].trim())) fail(`invalid ${k}`);
    }
    for (const k of ['checkedAt', 'expiresAt']) if (r[k] != null && !dateValid(r[k])) fail(`invalid ${k}`);
    if (r.mode === 'metered') {
      for (const k of ['currency', 'source', 'checkedAt', 'expiresAt']) if (!r[k]) fail(`${k} required`);
    }
    if (r.mode === 'plan' && referenceFields.some((k) => r[k] !== null) && !r.referenceCurrency) {
      fail('referenceCurrency required');
    }
    return r;
  });
}

// 创建价格索引。
export function createPriceBook(rows) {
  const index = new Map();
  for (const r of rows) {
    let models = index.get(r.channel);
    if (!models) index.set(r.channel, models = new Map());
    if (models.has(r.model)) throw new Error('duplicate channel and model');
    models.set(r.model, r);
  }
  return { find: (channel, model) => index.get(channel)?.get(model) };
}

const nativeRates = JSON.parse(readFileSync(new URL('../native-rates.json', import.meta.url), 'utf8'));
const nativeFields = Object.keys(nativeRates.rates);
const flashModels = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4.1-flash'];
const nativePrice = Object.freeze({ mode: 'metered', currency: nativeRates.currency, native: true });
const usageOnly = Object.freeze({ mode: 'local' });
const nativeModels = new Map([
  ['deepseek-official', flashModels],
  ['deepseek-account', flashModels],
  ['deepseek', flashModels],
  ['opencode-go', ['deepseek-v4.1-flash']],
]);

export function createNativePriceBook(configuredBook) {
  return {
    find(channel, model) {
      if (nativeModels.get(channel)?.includes(model)) return nativePrice;
      return configuredBook?.find(channel, model) ?? usageOnly;
    },
  };
}

function nativeCost(tokens, time) {
  const { rates, perTokens, peak } = nativeRates;
  const jst = new Date(time + peak.utcOffsetMinutes * 60_000);
  const hour = jst.getUTCHours();
  const isPeak = peak.weekdays.includes(jst.getUTCDay()) &&
    peak.windows.some(([start, end]) => start <= hour && hour < end);
  const base = nativeFields.reduce((sum, field) => sum + (tokens?.[field] ?? 0) * rates[field], 0);
  return (isPeak ? peak.multiplier : 1) * base / perTokens;
}

// 计算调用成本。
export function computeCost(callRow, priceBook, nowMs = Date.now()) {
  const p = priceBook.find(callRow.channel, callRow.model);
  const result = {
    status: 'pending',
    amount: null,
    currency: p?.currency ?? null,
    reference: null,
    referenceCurrency: p?.referenceCurrency ?? null,
    missing: [],
    unreported: fields.filter((k) => callRow.tokens?.[k] == null),
  };
  if (!p) return result;
  if (p.mode === 'local') return { ...result, status: 'local', amount: 0 };
  if (p.native) {
    if (nativeFields.every(field => callRow.tokens?.[field] == null)) return result;
    return { ...result, status: 'ok', amount: nativeCost(callRow.tokens, callRow.tsMs) };
  }
  const calc = (names) => {
    let micro = 0;
    const missing = [];
    for (let i = 0; i < fields.length; i++) {
      const n = callRow.tokens?.[fields[i]] ?? 0, price = p[names[i]];
      if (n > 0 && price == null) missing.push(fields[i]);
      else if (n > 0) micro += Math.round(n * price / p.perTokens * 1e6);
    }
    return { amount: micro / 1e6, missing };
  };
  if (p.mode === 'plan') {
    const ref = calc(referenceFields);
    return {
      ...result,
      status: 'plan',
      reference: referenceFields.some((k) =>
          p[k] != null
        ) && ref.missing.length === 0 && result.unreported.length < fields.length
        ? ref.amount
        : null,
    };
  }
  const calculated = calc(fields);
  result.missing = calculated.missing;
  if (result.missing.length || result.unreported.length === fields.length) return result;
  result.amount = calculated.amount;
  result.status = nowMs > Date.parse(`${p.expiresAt}T23:59:59.999Z`) ? 'expired' : 'ok';
  return result;
}
