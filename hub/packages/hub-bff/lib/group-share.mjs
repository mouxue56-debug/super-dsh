import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const gidPattern = /^g\d{14}[a-f0-9]{4}$/;
const memberPattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

function paths(hubHome, gid) {
  if (!path.isAbsolute(hubHome) || !gidPattern.test(gid)) throw Error('组文件夹路径无效');
  return { file: path.join(hubHome, 'config', 'group-shares.json'), dir: path.join(hubHome, 'group-work', gid) };
}

function read(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.shares)) throw Error('组文件夹登记无效');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, shares: [] };
    throw error;
  }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}

function directory(dir) {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(dir) !== dir) {
    throw Error('组文件夹不是安全目录');
  }
}

function iso(now) {
  return new Date(now === undefined ? Date.now() : now).toISOString();
}

// 建立组目录并登记放权。
export function openShare({ hubHome, gid, members, now }) {
  const { file, dir } = paths(hubHome, gid);
  if (!Array.isArray(members) || !members.length || members.some((id) => !memberPattern.test(id))) {
    throw Error('组员名单无效');
  }
  const data = read(file);
  directory(path.join(hubHome, 'group-work'));
  directory(dir);
  for (const member of members) directory(path.join(dir, member));
  data.shares = data.shares.filter((share) => share.group !== gid);
  data.shares.push({ group: gid, dir, members: [...members], status: 'active', since: iso(now) });
  write(file, data);
}

// 组员变动后更新已登记的名单，并给新成员建自己的格子；移出的人不再被放权，文件保留。
export function setShareMembers({ hubHome, gid, members, now }) {
  const { file, dir } = paths(hubHome, gid);
  if (!Array.isArray(members) || !members.length || members.some((id) => !memberPattern.test(id))) {
    throw Error('组员名单无效');
  }
  const data = read(file);
  const share = data.shares.find((item) => item.group === gid && item.status === 'active');
  if (!share || share.dir !== dir) return false;
  for (const member of members) directory(path.join(dir, member));
  share.members = [...members];
  share.changedAt = iso(now);
  write(file, data);
  return true;
}

// 结束登记并保留文件。
export function endShare({ hubHome, gid, now }) {
  const { file } = paths(hubHome, gid);
  const data = read(file);
  let changed = false;
  for (const share of data.shares) {
    if (share.group === gid && share.status === 'active') {
      share.status = 'ended';
      share.endedAt = iso(now);
      changed = true;
    }
  }
  if (changed) write(file, data);
}

// 启动时撤销不再进行中的组授权。
export function reconcileShares({ hubHome, statusOf }) {
  const { file } = paths(hubHome, 'g000000000000000000');
  const data = read(file);
  let changed = false;
  for (const share of data.shares) {
    if (share.status === 'active' && !['active', 'paused'].includes(statusOf(share.group))) {
      share.status = 'ended';
      share.endedAt = iso();
      changed = true;
    }
  }
  if (changed) write(file, data);
}

// 返回已登记组员的共享目录。
export function shareInfo({ hubHome, gid, member }) {
  const { file, dir } = paths(hubHome, gid);
  const share = read(file).shares.find((item) => item.group === gid && item.status === 'active');
  if (!share || share.dir !== dir || !Array.isArray(share.members) || !share.members.includes(member)) return null;
  return { dir, own: path.join(dir, member) };
}
