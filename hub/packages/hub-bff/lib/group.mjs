import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** 群主标识。 */
export const OWNER = 'owner';
/** 群组默认限制。 */
export const DEFAULT_LIMITS = Object.freeze({
  contextMessages: 8,
  tokenBudget: 1200,
  summaryEveryN: 20,
  batchMessages: 5,
  batchSeconds: 30,
  idleLimit: 6,
  maxHandoffs: 4,
  maxChars: 150,
  pageMaxLines: 60,
  rejectLimit: 2,
  ackMinScore: 0.25,
});

/** 校验群组标识并生成目录路径。 */
const dir = (root, id) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    throw new Error('Invalid group id');
  }
  return path.join(root, 'groups', id);
};

/** 通过临时文件原子写入内容。 */
const atomic = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  }
};

/** 构造并校验群组，不写入文件。 */
export function createGroup(
  {
    id,
    name,
    goal,
    members,
    host,
    createdBy,
    convention = '',
    limits = {},
    pipeline,
    reviewer,
    now = Date.now(),
  },
) {
  dir('.', id);
  if (!Array.isArray(members) || !members.length) {
    throw new Error('Members required');
  }
  const ids = new Set();
  for (const m of members) {
    if (
      !m || typeof m.id !== 'string' || !m.id || m.id === OWNER || ids.has(m.id) ||
      !['assistant', 'external'].includes(m.kind) || !['host', 'member'].includes(m.role)
    ) {
      throw new Error('Invalid member');
    }
    ids.add(m.id);
  }
  // 成员名不许与别的成员 id 相同，也不许重名，否则 @ 点名会被截走
  const nameSeen = new Set();
  for (const m of members) {
    if (m.name !== undefined && m.name !== m.id) {
      if ((ids.has(m.name)) || nameSeen.has(m.name)) {
        throw new Error('Member name collides with another member');
      }
    }
    if (m.name !== undefined) {
      nameSeen.add(m.name);
    }
  }
  if (members.filter((m) => m.role === 'host').length > 1) {
    throw new Error('Multiple hosts');
  }
  const chosen = host ?? createdBy;
  if (!chosen || !ids.has(chosen)) {
    throw new Error('Host required');
  }
  const merged = { ...DEFAULT_LIMITS, ...limits };
  if (Object.values(merged).some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
    throw new Error('Invalid limits');
  }
  return {
    id,
    name,
    goal,
    members: members.map((m) => ({ ...m, role: m.id === chosen ? 'host' : 'member' })),
    host: chosen,
    convention,
    limits: merged,
    status: 'active',
    ...(pipeline !== undefined ? { pipeline } : {}),
    ...(reviewer !== undefined ? { reviewer } : {}),
    createdAt: now,
  };
}

/** 原子保存群组。 */
export function saveGroup(root, group) {
  atomic(path.join(dir(root, group.id), 'group.json'), JSON.stringify(group, null, 2) + '\n');
}

/** 读取群组，不存在时返回空值。 */
export function loadGroup(root, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(root, id), 'group.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }
    throw e;
  }
}

/** 按标识顺序列出已保存的群组。 */
export function listGroups(root) {
  let names;
  try {
    names = fs.readdirSync(path.join(root, 'groups'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
  return names.filter((id) => /^[A-Za-z0-9_-]{1,40}$/.test(id)).map((id) => loadGroup(root, id))
    .filter(Boolean).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 将点名解析为成员标识。 */
export function parseMentions(text, members) {
  const found = [];
  const aliases = members.flatMap((m) =>
    [m.id, m.name].filter(Boolean).map((s) => ({ s, id: m.id }))
  ).sort((a, b) => b.s.length - a.s.length);
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '@') {
      const tail = text.slice(i + 1);
      const all = /^(?:全员|all)(?![\p{L}\p{N}_-])/iu.exec(tail);
      if (all) {
        return 'all';
      }
      const match = aliases.find((a) =>
        tail.startsWith(a.s) && !/[\p{L}\p{N}_-]/u.test(tail[a.s.length] ?? '')
      );
      if (match) {
        if (!found.includes(match.id)) {
          found.push(match.id);
        }
        i += match.s.length;
      }
    }
  }
  return found;
}

/** 解析消息中的固定标记。 */
export function parseMarks(text) {
  return {
    decision: text.includes('〔决定〕'),
    objection: text.includes('〔异议〕'),
    pass: /^(?:过|\[PASS\]|〔过〕)$/.test(text.replace(/\s/gu, '')),
  };
}

/** 读取指定标识之后的消息，可限制最近消息数量。 */
export function readMessages(root, groupId, { afterId = 0, limit } = {}) {
  let s;
  try {
    s = fs.readFileSync(path.join(dir(root, groupId), 'messages.jsonl'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
  const rows = [];
  for (const line of s.split('\n')) {
    if (!line) {
      continue;
    }
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue; // 残缺行（断电、截断）跳过，不拖垮整个组
    }
    if (m && typeof m === 'object' && Number.isInteger(m.id) && m.id > afterId) {
      rows.push(m);
    }
  }
  return limit === undefined ? rows : limit <= 0 ? [] : rows.slice(-limit);
}

/** 追加消息并分配递增标识。 */
export function appendMessage(root, groupId, { from, text, to, toolCalls = 0, ts = Date.now(), own, system, eventType }) {
  const group = loadGroup(root, groupId);
  if (!group) {
    throw new Error('Group not found');
  }
  if (from !== OWNER && !group.members.some((m) => m.id === from)) {
    throw new Error('Invalid sender');
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Empty message');
  }
  if (!Number.isInteger(toolCalls) || toolCalls < 0) {
    throw new Error('Invalid toolCalls');
  }
  const rows = readMessages(root, groupId);
  const msg = {
    id: rows.reduce((n, r) => Math.max(n, r.id), 0) + 1,
    ts,
    from,
    text,
    to: to ?? parseMentions(text, group.members),
    toolCalls,
    // 成员自己说的话标 own，运行时替人记的样板话标 system；只有为真时才写这个字段。
    ...(own === true ? { own: true } : {}),
    ...(system === true ? { system: true } : {}),
    // 结构化事件类型（主人拉人、请人出组）；只有系统消息才带。
    ...(system === true && typeof eventType === 'string' && eventType ? { eventType } : {}),
  };
  const file = path.join(dir(root, groupId), 'messages.jsonl');
  // 末行若被截断（无换行），先补换行，免得新消息接在残行后面读不出来
  let prefix = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) {
          prefix = '\n';
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }
  fs.appendFileSync(file, prefix + JSON.stringify(msg) + '\n');
  return msg;
}

/** 读取文本文件，不存在时返回空字符串。 */
const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return '';
    }
    throw e;
  }
};

/** 读取项目页。 */
export function readPage(root, groupId) {
  return read(path.join(dir(root, groupId), '项目页.md'));
}

/** 原子替换项目页。 */
export function writePage(root, groupId, content) {
  atomic(path.join(dir(root, groupId), '项目页.md'), content);
}

/** 读取归档。 */
export function readArchive(root, groupId) {
  return read(path.join(dir(root, groupId), '归档.md'));
}

/** 追加带时间戳的归档条目。 */
export function appendArchive(root, groupId, content, ts = Date.now()) {
  const folder = dir(root, groupId);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, '归档.md');
  const previous = read(file);
  fs.appendFileSync(
    file,
    `${previous && !previous.endsWith('\n') ? '\n' : ''}<!-- 归档 ${ts} -->\n${content}${
      content.endsWith('\n') ? '' : '\n'
    }`,
  );
}

/** 更新已保存群组的状态。 */
export function setGroupStatus(root, groupId, status, reason) {
  if (!['active', 'paused', 'done'].includes(status)) {
    throw new Error('Invalid status');
  }
  const group = loadGroup(root, groupId);
  if (!group) {
    throw new Error('Group not found');
  }
  group.status = status;
  if (status === 'paused' && reason !== undefined) {
    group.pausedReason = reason;
  } else {
    delete group.pausedReason;
  }
  saveGroup(root, group);
  return group;
}
