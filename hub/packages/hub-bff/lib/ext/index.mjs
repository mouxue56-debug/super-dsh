import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFlatYaml, expandConfiguredPath } from '../../../hub-plugin/hub-config.mjs';
import { parsePriceTable, createPriceBook } from '../prices.mjs';

// 读取安装级平面配置，缺失时返回空对象。
export function readHubYaml(configDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(configDir, 'hub.yaml'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    return { ...parseFlatYaml(text, '安装配置') };
  } catch {
    throw new Error('安装配置格式错误');
  }
}

// 展开配置路径并仅返回有效的绝对路径。
export function configuredPath(value, { home, hubHome }) {
  if (typeof value !== 'string') return undefined;
  try {
    const result = expandConfiguredPath(value, { home, hubHome });
    return path.isAbsolute(result) && !/[\0\r\n]/u.test(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

// 计算指定时区在给定时刻相对 UTC 的分钟数。
export function utcOffsetMinutes(timezone, nowMs = Date.now()) {
  const fallback = () => -new Date(nowMs).getTimezoneOffset();
  if (!timezone) return fallback();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' });
    const zone = formatter.formatToParts(new Date(nowMs)).find(part => part.type === 'timeZoneName')?.value;
    if (zone === 'GMT') return 0;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(zone ?? '');
    if (!match) return fallback();
    return (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return fallback();
  }
}

// 读取价表，缺失或无效时使用空价表。
export function loadPriceBook(file, logger = console) {
  if (!file) return createPriceBook([]);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return createPriceBook(parsePriceTable(text));
  } catch (error) {
    if (error.code !== 'ENOENT') logger.error('HUB_PRICE_TABLE_INVALID');
    return createPriceBook([]);
  }
}

// 给扩展的一步（创建、启动、停止）限时；超时按失败处理，不卡住整个后端。
function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('扩展超时')), ms);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

// 加载扩展并提供隔离的路由与生命周期接口。
export async function loadExtensions({ dir, deps, logger = console, ownAuth = ['board'], only, timeoutMs = 1000 }) {
  const modules = [];
  const failed = [];
  let files;
  try {
    files = await fs.promises.readdir(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    files = [];
  }
  for (const file of files.sort()) {
    if (!/^[a-z][a-z0-9-]{0,31}\.mjs$/u.test(file) || file === 'index.mjs') continue;
    const name = file.slice(0, -4);
    if (only && !only.includes(name)) continue;
    const fullPath = path.join(dir, file);
    try {
      if (!(await fs.promises.lstat(fullPath)).isFile()) continue;
      const mod = await withTimeout(import(pathToFileURL(fullPath).href), timeoutMs * 5);
      if (typeof mod.createHandler !== 'function') throw new Error('缺少处理器');
      const handler = await withTimeout(mod.createHandler(deps), timeoutMs);
      if (typeof handler !== 'function') throw new Error('处理器无效');
      modules.push({ name, mod, handler });
    } catch {
      failed.push({ name, reason: '加载或初始化失败' });
      logger.error('HUB_EXT_LOAD_FAILURE ' + name);
    }
  }
  const match = (entry, pathname, stage) => {
    const allowed = stage === 'public' ? ownAuth.includes(entry.name) :
      stage === 'private' && !ownAuth.includes(entry.name);
    return allowed && (pathname === '/' + entry.name || pathname.startsWith('/' + entry.name + '/'));
  };
  return {
    names: modules.map(entry => entry.name),
    failed,
    matches(pathname, stage) {
      return modules.some(entry => match(entry, pathname, stage));
    },
    module(name) {
      return modules.find(entry => entry.name === name)?.mod;
    },
    async handle(request, response, stage) {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      const entry = modules.find(item => match(item, pathname, stage));
      if (!entry) return false;
      try {
        return await entry.handler(request, response);
      } catch {
        logger.error('HUB_EXT_FAILURE ' + entry.name);
        if (!response.headersSent) {
          response.writeHead(500, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(JSON.stringify({ error: { code: 'EXTENSION_FAILURE', message: '扩展处理失败' } }));
        } else {
          response.end();
        }
        return true;
      }
    },
    async start() {
      // 一键全停（panic）最后启动：重启后它要能停住已经起来的定时模块。
      const ordered = [...modules.filter(e => e.name !== 'panic'), ...modules.filter(e => e.name === 'panic')];
      for (const entry of ordered) {
        try {
          if (typeof entry.mod.start === 'function') await withTimeout(entry.mod.start(deps), timeoutMs);
        } catch {
          logger.error('HUB_EXT_START_FAILURE ' + entry.name);
        }
      }
    },
    async stop() {
      for (const entry of modules) {
        try {
          if (typeof entry.mod.stop === 'function') await withTimeout(entry.mod.stop(), timeoutMs);
        } catch {
          logger.error('HUB_EXT_STOP_FAILURE ' + entry.name);
        }
      }
    },
  };
}
