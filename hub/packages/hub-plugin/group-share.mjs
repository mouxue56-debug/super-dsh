import fs from 'node:fs';
import path from 'node:path';

const gidPattern = /^g\d{14}[a-f0-9]{4}$/;
const memberPattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

function safeDirectory(dir) {
  try {
    return fs.lstatSync(dir).isDirectory() && fs.realpathSync.native(dir) === dir;
  } catch {
    return false;
  }
}

// 读取登记，无法核实则不给权限。
export function readGroupShares(hubHome) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(hubHome, 'config', 'group-shares.json'), 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.shares)) return [];
    const valid = data.shares.every((share) => share && gidPattern.test(share.group) &&
      share.dir === path.join(hubHome, 'group-work', share.group) && Array.isArray(share.members) &&
      share.members.every((member) => typeof member === 'string' && memberPattern.test(member)) &&
      ['active', 'ended'].includes(share.status) && typeof share.since === 'string' &&
      (share.endedAt === undefined || typeof share.endedAt === 'string'));
    if (!valid || new Set(data.shares.map((share) => share.group)).size !== data.shares.length) return [];
    return data.shares;
  } catch {
    return [];
  }
}

// 按组员身份和真实目录收窄读写范围。
export function groupAccess({ shares, bot, hubHome }) {
  const root = path.join(hubHome, 'group-work');
  const result = { root, read: [], write: [], ended: [] };
  if (!path.isAbsolute(hubHome) || !memberPattern.test(bot) || !Array.isArray(shares)) return result;
  for (const share of shares) {
    if (!share || !gidPattern.test(share.group) || !Array.isArray(share.members)) continue;
    if (!share.members.every((member) => typeof member === 'string' && memberPattern.test(member))) continue;
    const dir = path.join(root, share.group);
    if (share.dir !== dir || !safeDirectory(dir)) continue;
    if (share.status === 'ended') {
      result.ended.push(dir);
      continue;
    }
    if (share.status !== 'active' || !share.members.includes(bot)) continue;
    result.read.push(dir);
    const own = path.join(dir, bot);
    if (safeDirectory(own)) result.write.push(own);
  }
  return result;
}
