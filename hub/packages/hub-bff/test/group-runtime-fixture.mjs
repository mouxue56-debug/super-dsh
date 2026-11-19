// 讨论组运行时测试用的假 deps（路 6）。不联网、不调模型。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 通用的五位助理名册（测试用）。 */
export const ROSTER = [
  { id: 'chief', name: '首席', role: 'chief', status: 'active' },
  { id: 'research', name: '调研员', role: 'bot', status: 'active' },
  { id: 'copy', name: '文案', role: 'bot', status: 'active' },
  { id: 'image', name: '出图', role: 'bot', status: 'active' },
  { id: 'exec', name: '执行', role: 'bot', status: 'active' },
];

/** 建临时数据目录。 */
export function tempDir(label = 'group-rt-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

/** 可手动拨的时钟。 */
export function fakeClock(start = Date.parse('2026-11-17T13:00:00Z')) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

/** 假会话：每位助理一个脚本函数，返回字符串就是它的回话；默认回「过」。 */
export function fakeSessions(script = {}) {
  const owners = new Map();
  const sent = [];
  let n = 0;
  return {
    sent,
    owners,
    async create(bot, opts = {}) {
      n++;
      const id = `s${n}`;
      owners.set(id, { bot, opts });
      return { id };
    },
    async send(sid, text) {
      const owner = owners.get(sid);
      if (!owner) {
        throw new Error('no such session');
      }
      sent.push({ sid, bot: owner.bot, purpose: owner.opts.purpose, groupId: owner.opts.groupId, text });
      const fn = script[owner.bot] ?? script['*'];
      if (owner.opts.purpose === 'group-summary') {
        return script.summary ? script.summary({ text, groupId: owner.opts.groupId }) : null;
      }
      return fn ? fn({ text, groupId: owner.opts.groupId, sid }) : '过';
    },
    list() {
      return [...owners.keys()];
    },
  };
}

/** 一份标准的四人分工表：两张工单（调研→文案验，文案→出图验）。 */
export function planInput(extra = {}) {
  return {
    by: 'chief',
    name: '新杯子宣传',
    goal: '推一款新杯子：调研、文案、出图、发出去',
    members: ['research', 'copy', 'image', 'exec'],
    tickets: [
      {
        title: '竞品调研',
        goal: '找三家竞品的卖点和价格',
        assignee: 'research',
        checklist: ['列出三家竞品', '每家写卖点和价格'],
      },
      {
        title: '宣传文案',
        goal: '写一段三十字内的宣传文案',
        assignee: 'copy',
        checklist: ['三十字以内', '用上调研里的一个卖点'],
      },
    ],
    ...extra,
  };
}

// 验收要求证据指到组文件夹里真实存在的文件。测试里替做的人把证据点到的相对路径文件建出来。
export function seedEvidence(dataDir, gid, verdicts) {
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    const found = String(v?.evidence ?? '').match(/[\w.-]+(?:\/[\w.-]+)*\.[A-Za-z]\w*/gu) ?? [];
    for (const rel of found) {
      if (rel.includes('..')) {
        continue;
      }
      const file = path.join(dataDir, 'groups', gid, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '产出\n');
      }
    }
  }
}

// 做的人产出文件的三行真话。第一行留给系统摘作例子，验收引第二行（原样引系统例子会被拒）。
export function outLines(tid = 'auto') {
  return [
    `${tid} 产出第一行：这一行留给系统摘作例子用`,
    `${tid} 核对要点：三家竞品的卖点和价格都已经逐一列清楚`,
    `${tid} 文案要点：三十字以内并用上了调研里的一个卖点`,
  ];
}

// 保证交单文件里有可引的原文（缺就写三行；已有但太短就追加三行）。
function ensureOut(file, tid) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!old.includes('核对要点')) {
    fs.writeFileSync(file, `${old}${outLines(tid).join('\n')}\n`);
  }
}

// 从文件里取验收要引的那句（第二条够长的行）。
function quoteFrom(file, index = 0) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => /核对要点|文案要点/u.test(l));
  return lines[index % lines.length] ?? '';
}

// 把清单编号换成下标（与运行时 normalizeItems 同口径）。
function indexes(verdicts, n) {
  const nums = verdicts.map((v) => (typeof v?.item === 'string' && /^\d+$/u.test(v.item) ? Number(v.item) : v?.item));
  const oneBased = nums.every((x) => Number.isInteger(x) && x >= 1 && x <= n) && !nums.includes(0);
  return nums.map((x) => (oneBased ? x - 1 : x));
}

const LAZY = new Set(['', 'ok', '略', '同上', '无', '好的', 'none', '通过', 'done', 'lgtm']);

// 替验收人把「看了某文件第几段」改写成新规则要的样子：引交单文件里的原文、写明出处，原话留在后面；
// 退回理由补上是第几条。偷懒的证据（空、略、同上、ok）原样不动，照样该被拒。
export function quoteEvidence(dataDir, gid, ticketId, by, verdicts) {
  if (!Array.isArray(verdicts)) {
    return verdicts;
  }
  const gd = path.join(dataDir, 'groups', gid);
  let tickets = [];
  try {
    tickets = JSON.parse(fs.readFileSync(path.join(gd, 'tickets.json'), 'utf8'));
  } catch {
    return verdicts;
  }
  const ticket = tickets.find((t) => t.id === ticketId) ??
    tickets.find((t) => t.verifier === by && t.status === 'review');
  if (!ticket) {
    return verdicts;
  }
  // 有交单文件引文件第二行；没有文件（看板外部复核者交回）就引交单摘要。
  let file = ticket.report?.file;
  let quote = '';
  if (typeof file === 'string') {
    const abs = path.isAbsolute(file) ? file : path.join(gd, file);
    quote = fs.existsSync(abs) ? quoteFrom(abs) : '';
  } else if (typeof ticket.report?.summary === 'string') {
    file = '交单摘要';
    quote = ticket.report.summary;
  }
  const idx = indexes(verdicts, ticket.checklist?.length ?? 0);
  return verdicts.map((v, i) => {
    if (!v || typeof v !== 'object') {
      return v;
    }
    const lazy = typeof v.evidence !== 'string' || LAZY.has(v.evidence.trim().toLowerCase());
    if (v.verdict === 'pass' && !lazy && quote) {
      const chosen = file === '交单摘要' ? (quote.split('；')[i] ?? quote)
        : quoteFrom(path.isAbsolute(file) ? file : path.join(gd, file), i);
      return { ...v, evidence: `引自 ${file}：「${chosen}」；${v.evidence}` };
    }
    if (v.verdict === 'fail' && typeof v.reason === 'string' && v.reason.trim()) {
      return { ...v, reason: `${v.reason}（清单第 ${Number(idx[i]) + 1} 条没达到，请补齐后再交）` };
    }
    return v;
  });
}

// 包一层运行时的 verify，调用前先 seedEvidence；返回同一个运行时。
// 没配组文件夹时也包 submit：没给文件就替做的人在组目录 out/ 下写一份产出并登记；给了就保证里面有可引原文。
export function withEvidence(rt, dataDir) {
  const verify = rt.verify.bind(rt);
  const submit = rt.submit.bind(rt);
  rt.submit = async (gid, ticketId, body = {}) => {
    if (typeof gid === 'string' && /^g[0-9a-z]+$/u.test(gid) && body && typeof body === 'object') {
      const gd = path.join(dataDir, 'groups', gid);
      const rel = typeof body.file === 'string' ? body.file : `out/${ticketId ?? 'auto'}.md`;
      if (!path.isAbsolute(rel) && !rel.includes('..')) {
        ensureOut(path.join(gd, rel), ticketId ?? 'auto');
        body = { ...body, file: rel };
      }
    }
    return submit(gid, ticketId, body);
  };
  rt.verify = async (gid, ticketId, body = {}) => {
    if (typeof gid === 'string' && /^g[0-9a-z]+$/u.test(gid)) {
      seedEvidence(dataDir, gid, body.verdicts);
      body = { ...body, verdicts: quoteEvidence(dataDir, gid, ticketId, body.by, body.verdicts) };
    }
    return verify(gid, ticketId, body);
  };
  return rt;
}
