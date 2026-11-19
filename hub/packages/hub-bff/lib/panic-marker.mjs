// 一键全停标记放在哪、怎么算「停着」，后端各扩展与插件只认这一处。
// 位置的唯一定义：安装配置 panic.stateDir（绝对路径）优先；否则 <数据目录>/panic。
// 数据目录与后端 server.mjs 同序：HUB_DATA_DIR 环境变量 > 安装配置 data_dir（可写 ~/、$HOME/、$HUB_HOME/）
// > <HUB_HOME>/hub-data。读不到、算不出一律按「停着」。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandConfiguredPath } from '../../hub-plugin/hub-config.mjs';

export const MARKER_NAME = 'stopped.flag';
export const STATE_NAME = 'state.json';

// 配置里的路径展开成绝对路径；不是合格绝对路径就返回 undefined。
function absolute(value, { home, hubHome }) {
  if (typeof value !== 'string' || !value) return undefined;
  let result;
  try {
    result = expandConfiguredPath(value, { home: home ?? os.homedir(), hubHome });
  } catch {
    return undefined;
  }
  return path.isAbsolute(result) && !/[\0\r\n]/u.test(result) ? result : undefined;
}

// 自定义的停机状态目录（panic.stateDir）；没写或不合格返回 undefined。
export function customStateDir(hubConfig, { home, hubHome } = {}) {
  return absolute(hubConfig?.panic?.stateDir, { home, hubHome });
}

// 后端：已经算好数据目录时，停机状态目录在哪。
export function panicStateDir({ dataDir, hubConfig, home, hubHome }) {
  const custom = customStateDir(hubConfig, { home, hubHome });
  if (custom) return custom;
  return typeof dataDir === 'string' && path.isAbsolute(dataDir) ? path.join(dataDir, 'panic') : undefined;
}

// 插件或别的进程：从安装配置推出所有可能的停机状态目录（第一个是与后端同序推出的那个）。
// 环境变量不一定两边都有，所以配置推出的与默认位置也一并列上，任一处停着都算停着（只会多拒）。
export function panicStateDirs({ hubHome, home, hubConfig, env = process.env }) {
  const dirs = [];
  const custom = customStateDir(hubConfig, { home, hubHome });
  if (custom) dirs.push(custom);
  const fromEnv = absolute(env?.HUB_DATA_DIR, { home, hubHome });
  const fromConfig = absolute(hubConfig?.data_dir, { home, hubHome });
  const fallback = typeof hubHome === 'string' && path.isAbsolute(hubHome) ? path.join(hubHome, 'hub-data') : undefined;
  for (const dataDir of [fromEnv, fromConfig, fallback]) {
    if (dataDir) dirs.push(path.join(dataDir, 'panic'));
  }
  return [...new Set(dirs)];
}

// 这个状态目录是不是停着：标记文件在（或读不了）就是停着；state.json 坏了或写着 stopped 也算停着。
export function stoppedAt(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return true;
  try {
    fs.lstatSync(path.join(dir, MARKER_NAME));
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') return true;
  }
  let text;
  try {
    text = fs.readFileSync(path.join(dir, STATE_NAME), 'utf8');
  } catch (error) {
    return error.code !== 'ENOENT';
  }
  try {
    const state = JSON.parse(text);
    if (!state || typeof state !== 'object' || Array.isArray(state)) return true;
    return state.stopped === true;
  } catch {
    return true;
  }
}

// 一组目录里任一处停着就算停着；一个目录都算不出来也按停着。
export function anyStopped(dirs) {
  if (!Array.isArray(dirs) || dirs.length === 0) return true;
  return dirs.some(stoppedAt);
}

// 后端各「会起动作」的入口共用的判断。注入的 deps.panic.isStopped 与磁盘任一说停就是停；
// 判断出错按停着。算不出状态目录时：一键全停本身也落不了盘（panic 扩展会拒），由 whenUnknown 决定，默认按停着。
export function depsStopped(deps, { whenUnknown = true } = {}) {
  try {
    if (typeof deps?.panic?.isStopped === 'function' && deps.panic.isStopped()) return true;
  } catch {
    return true;
  }
  const dir = panicStateDir({ dataDir: deps?.dataDir, hubConfig: deps?.hubConfig, hubHome: deps?.hubHome });
  return dir ? stoppedAt(dir) : whenUnknown;
}

export const STOPPED_TEXT = '已一键全停，恢复后再运行';
