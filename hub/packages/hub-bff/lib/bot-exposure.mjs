import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';

const dirOf = home => path.join(home, 'config', 'exposure');
const validBot = bot => typeof bot === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(bot);
const fileOf = (home, bot) => path.join(dirOf(home), bot + '.json');
const inside = (p, root) => p === root || p.startsWith(root + path.sep);
const hash = data => createHash('sha256').update(data).digest('hex');

function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = file + '.' + randomBytes(12).toString('hex') + '.tmp';
  fs.writeFileSync(temp, data, {mode: 0o600, flag: 'wx'});
  fs.renameSync(temp, file);
}

function readRaw(home, bot) {
  if (!validBot(bot)) throw Error('助理编号无效');
  const dir = dirOf(home);
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory() || (stat.mode & 0o444) === 0) throw Error('状态目录不可读');
    fs.accessSync(dir, fs.constants.R_OK);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return fs.readFileSync(fileOf(home, bot));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function parse(raw, bot) {
  const state = JSON.parse(raw.toString());
  if (!state || state.v !== 1 || state.bot !== bot || typeof state.since !== 'string' ||
      !Array.isArray(state.reasons) || !Number.isSafeInteger(state.count) || state.count < 1 ||
      state.reasons.length < 1 || state.reasons.length > 20 || state.count < state.reasons.length ||
      !state.reasons.every(r => r && ['ts', 'why', 'source', 'session'].every(k => typeof r[k] === 'string'))) {
    throw Error('状态格式无效');
  }
  return state;
}

// 读取助理状态，异常按已接触处理。
export function readExposure(home, bot) {
  try {
    const raw = readRaw(home, bot);
    if (!raw) return {exposed: false, since: null, reasons: [], count: 0, broken: false};
    const state = parse(raw, bot);
    return {exposed: true, since: state.since, reasons: state.reasons, count: state.count, broken: false};
  } catch {
    return {exposed: true, since: null, reasons: [], count: 0, broken: true};
  }
}

// 将一次外部接触原子写入状态文件。
export function markExposed(home, bot, {why, source, session, ts} = {}) {
  try {
    const old = readExposure(home, bot);
    const stamp = String(ts ?? new Date().toISOString());
    const reason = {ts: stamp, why: String(why ?? ''), source: String(source ?? '').slice(0, 200),
      session: String(session ?? '')};
    const reasons = old.broken || !old.exposed ? [reason] : [...old.reasons, reason];
    const kept = reasons.length > 20 ? [reasons[0], ...reasons.slice(-19)] : reasons;
    const state = {v: 1, bot, since: old.since ?? stamp, reasons: kept, count: old.count + 1};
    if (!validBot(bot)) return false;
    atomic(fileOf(home, bot), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// 读取共享区记号，异常按整个共享区处理。
export function readSharedMarks(home) {
  const root = path.resolve(home, 'shared');
  try {
    const dir = dirOf(home);
    try {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory() || (stat.mode & 0o444) === 0) throw Error('状态目录不可读');
      fs.accessSync(dir, fs.constants.R_OK);
    } catch (error) {
      if (error.code === 'ENOENT') return {paths: [], broken: false};
      throw error;
    }
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, 'shared-marks.json'), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return {paths: [], broken: false};
      throw error;
    }
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.paths) || data.paths.length > 500 ||
        !data.paths.every(p => typeof p === 'string' && path.isAbsolute(p) && inside(path.resolve(p), root))) {
      throw Error('共享区记号格式无效');
    }
    return {paths: data.paths.map(p => path.resolve(p)), broken: false};
  } catch {
    return {paths: [root], broken: true};
  }
}

// 合并共享区记号，过多时粗化为共享区根。
export function addSharedMarks(home, paths) {
  try {
    const root = path.resolve(home, 'shared');
    const marks = readSharedMarks(home);
    let merged = [...marks.paths];
    for (const value of paths) {
      const p = path.resolve(value);
      if (!inside(p, root)) continue;
      if (merged.some(existing => inside(p, existing))) continue;
      merged = merged.filter(existing => !inside(existing, p));
      merged.push(p);
    }
    if (merged.length > 500) merged = [root];
    atomic(path.join(dirOf(home), 'shared-marks.json'), JSON.stringify({v: 1, paths: merged}));
    return true;
  } catch {
    return false;
  }
}

// 生成含当前文件摘要的解除确认卡。
export function exposureCard(home, bot) {
  const raw = readRaw(home, bot);
  if (!raw) throw Error('这位助理没有接触外部内容的状态');
  try {
    const state = parse(raw, bot);
    return {bot, since: state.since, reasons: state.reasons, count: state.count, digest: hash(raw), broken: false};
  } catch {
    return {bot, since: null, reasons: [], count: 0, digest: hash(raw), broken: true};
  }
}

// 核对摘要并先留痕，再解除当前状态。
export function clearExposure(home, bot, {by, digest, ts} = {}) {
  const card = exposureCard(home, bot);
  if (digest !== card.digest) throw Error('状态已变，请重新出确认卡');
  const log = path.join(home, 'config', 'exposure-clears.log');
  const line = JSON.stringify({v: 1, bot, by: String(by ?? ''), digest, ts: String(ts ?? new Date().toISOString())});
  fs.appendFileSync(log, line + '\n', {mode: 0o600});
  if (exposureCard(home, bot).digest !== digest) throw Error('状态已变，请重新出确认卡');
  fs.unlinkSync(fileOf(home, bot));
  return true;
}
