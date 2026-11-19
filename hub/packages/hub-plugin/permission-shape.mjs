// 把分类器已经切开的参数收成结构：程序、子命令、选项、操作数。
// 不读原始命令的相邻字样，也不改分类器的拒绝或询问结论。
const fold = (value) => String(value ?? '').normalize('NFKC').normalize('NFC').toLowerCase();
const WRAP = new Set([
  'env', 'command', 'builtin', 'xargs', 'nohup', 'setsid', 'timeout', 'nice', 'time',
]);
const MAX_WRAP = 4;

function wordsOf(args) {
  const words = [];
  for (const token of args ?? []) {
    const value = typeof token === 'string' ? token : token?.value;
    if (typeof value === 'string') words.push(value);
  }
  return words;
}

function blank(program, words, extra = {}) {
  return {
    program, sub: '', options: [], operands: [], sends: false, opaque: false,
    remote: false, uncertain: false, words, inner: null, ...extra,
  };
}

function scan(words, spec) {
  const options = [];
  const operands = [];
  let uncertain = false;
  let ended = false;
  const shortArg = spec.shortArg ?? new Set();
  const longArg = spec.longArg ?? new Set();
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (ended || word === '-' || !word.startsWith('-')) {
      operands.push(word);
      continue;
    }
    if (word === '--') {
      ended = true;
      continue;
    }
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const bare = (eq === -1 ? word.slice(2) : word.slice(2, eq)).toLowerCase();
      let value = eq === -1 ? null : word.slice(eq + 1);
      if (value === null && longArg.has(bare)) {
        const next = words[i + 1];
        if (next !== undefined && !next.startsWith('-')) value = words[++i];
        else uncertain = true;
      }
      if (spec.knownLong && !spec.knownLong.has(bare)) uncertain = true;
      options.push({ name: '--' + bare, value });
      continue;
    }
    const body = word.slice(1);
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (shortArg.has(ch)) {
        const rest = body.slice(k + 1);
        let value = rest || null;
        if (value === null) {
          const next = words[i + 1];
          if (next !== undefined && !next.startsWith('-')) value = words[++i];
          else uncertain = true;
        }
        options.push({ name: '-' + ch, value });
        break;
      }
      if (spec.knownShort && !spec.knownShort.has(ch)) uncertain = true;
      options.push({ name: '-' + ch, value: null });
    }
  }
  return { options, operands, uncertain };
}

function parseGit(words) {
  const options = [];
  const operands = [];
  const longArg = new Set([
    'git-dir', 'work-tree', 'namespace', 'exec-path', 'config-env', 'super-prefix', 'list-cmds',
  ]);
  let sub = '';
  let i = 0;
  let uncertain = false;
  while (i < words.length && !sub) {
    const word = words[i];
    if (word === '--') {
      i += 1;
      break;
    }
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const bare = eq === -1 ? word.slice(2) : word.slice(2, eq);
      let value = eq === -1 ? null : word.slice(eq + 1);
      if (value === null && longArg.has(bare.toLowerCase())) {
        const next = words[i + 1];
        if (next !== undefined && !next.startsWith('-')) value = words[++i];
        else uncertain = true;
      }
      options.push({ name: '--' + bare.toLowerCase(), value, global: true });
      i += 1;
      continue;
    }
    if (word.startsWith('-') && word.length > 1) {
      const flag = word[1];
      if (flag === 'C' || flag === 'c') {
        let value = word.length > 2 ? word.slice(2) : null;
        if (value === null) {
          if (words[i + 1] === undefined) uncertain = true;
          else value = words[++i];
        }
        options.push({ name: '-' + flag, value, global: true });
        i += 1;
        continue;
      }
      options.push({ name: word, value: null, global: true });
      i += 1;
      continue;
    }
    sub = word;
    i += 1;
  }
  while (i < words.length) {
    const word = words[i];
    if (word === '--') {
      operands.push(...words.slice(i + 1));
      break;
    }
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      if (eq > 0) options.push({ name: word.slice(0, eq).toLowerCase(), value: word.slice(eq + 1) });
      else options.push({ name: word.toLowerCase(), value: null });
      i += 1;
      continue;
    }
    if (word.startsWith('-') && word !== '-') {
      options.push({ name: word, value: null });
      i += 1;
      continue;
    }
    operands.push(word);
    i += 1;
  }
  return { sub: fold(sub), options, operands, uncertain };
}

const CURL_SHORT_ARG = new Set('dFTXoOHuAebcCDEKmnQrtwxyzU'.split(''));
const CURL_SEND_SHORT = new Set(['d', 'F', 'T']);
const WRITE_METHOD = /^(?:post|put|patch|delete)$/iu;

function methodSends(value) {
  return typeof value === 'string' && WRITE_METHOD.test(value.trim());
}

function parseCurl(words, kind) {
  const parsed = scan(words, { shortArg: kind === 'curl' ? CURL_SHORT_ARG : new Set(['O', 'o', 'P', 'a']) });
  let sends = false;
  for (const option of parsed.options) {
    const name = option.name;
    if (kind === 'curl' && name.length === 2 && CURL_SEND_SHORT.has(name[1])) sends = true;
    if (kind === 'curl' && name === '-X' && methodSends(option.value)) sends = true;
    if (name.startsWith('--')) {
      const bare = name.slice(2);
      if (kind === 'curl' && /^(?:data|data-ascii|data-binary|data-raw|data-urlencode)$/u.test(bare)) {
        sends = true;
      }
      if (kind === 'curl' && /^(?:form|form-string|form-escape|upload-file)$/u.test(bare)) sends = true;
      if (kind === 'wget' && /^(?:post-data|post-file|body-data|body-file)$/u.test(bare)) sends = true;
      if ((bare === 'request' || bare === 'method') && methodSends(option.value)) sends = true;
    }
  }
  return { ...parsed, sends };
}

function parseGh(words) {
  const parsed = scan(words, {
    shortArg: new Set(['R', 'C']),
    longArg: new Set(['repo', 'hostname', 'jq', 'template']),
  });
  const noun = parsed.operands[0] ?? '';
  const verb = parsed.operands[1] ?? '';
  const sub = [noun, verb].filter(Boolean).join(' ');
  const publish = new Set(['create', 'comment', 'edit', 'close', 'delete', 'merge', 'upload']);
  return { ...parsed, sub: fold(sub), sends: publish.has(fold(verb)) };
}

function parseNpm(words) {
  const parsed = scan(words, {
    shortArg: new Set(['C']),
    longArg: new Set(['prefix', 'userconfig', 'cache', 'registry', 'tag', 'otp']),
  });
  const sub = fold(parsed.operands[0] ?? '');
  const sends = sub === 'publish' || sub === 'unpublish' || sub === 'owner' || sub === 'access';
  return { ...parsed, sub, sends };
}

function parseDocker(words) {
  const parsed = scan(words, {
    shortArg: new Set(['H', 'c', 'l']),
    longArg: new Set(['host', 'context', 'config', 'log-level']),
  });
  let index = 0;
  const ops = parsed.operands;
  if (ops[0] && /^-/.test(ops[0]) === false && ['container', 'image', 'compose'].includes(fold(ops[0]))) {
    index = 1;
  }
  const sub = fold(ops[index] ?? '');
  return { ...parsed, sub, sends: sub === 'push' || sub === 'login' };
}

const COPY_SPEC = {
  cp: {
    shortArg: new Set(['t', 'S']),
    knownShort: new Set('aAfinpRrvLPHdlsuxcb'.split('')),
    longArg: new Set(['target-directory', 'suffix']),
    knownLong: new Set([
      'archive', 'recursive', 'force', 'no-clobber', 'interactive', 'verbose', 'link',
      'symbolic-link', 'dereference', 'no-dereference', 'preserve', 'parents', 'update',
      'strip-trailing-slashes', 'remove-destination', 'backup', 'target-directory',
      'suffix', 'no-target-directory',
    ]),
  },
  mv: {
    shortArg: new Set(['t', 'S']),
    knownShort: new Set('finvubSTt'.split('')),
    longArg: new Set(['target-directory', 'suffix']),
    knownLong: new Set([
      'force', 'interactive', 'no-clobber', 'verbose', 'update', 'backup',
      'target-directory', 'suffix', 'no-target-directory', 'strip-trailing-slashes',
    ]),
  },
  ln: {
    shortArg: new Set(['t', 'S']),
    knownShort: new Set('sfinvbhPLFrtST'.split('')),
    longArg: new Set(['target-directory', 'suffix']),
    knownLong: new Set([
      'symbolic', 'force', 'interactive', 'no-dereference', 'verbose', 'backup',
      'logical', 'physical', 'relative', 'target-directory', 'suffix', 'no-target-directory',
    ]),
  },
  install: {
    shortArg: new Set(['m', 'o', 'g', 't', 'S']),
    knownShort: new Set('bcdpsvCDtTmoSgS'.split('')),
    longArg: new Set(['mode', 'owner', 'group', 'target-directory', 'suffix', 'strip-program']),
    knownLong: new Set([
      'backup', 'compare', 'directory', 'preserve-timestamps', 'verbose', 'strip',
      'target-directory', 'no-target-directory', 'mode', 'owner', 'group', 'suffix',
    ]),
  },
  rsync: {
    shortArg: new Set(['e', 'f', 'B']),
    knownShort: new Set('avrlptgoDHznuqhP'.split('')),
    longArg: new Set(['rsh', 'files-from', 'exclude', 'include', 'chmod', 'chown', 'max-size']),
    knownLong: new Set([
      'archive', 'verbose', 'recursive', 'links', 'perms', 'times', 'group', 'owner',
      'devices', 'specials', 'compress', 'dry-run', 'update', 'human-readable', 'delete',
      'progress', 'partial', 'rsh', 'protect-args',
    ]),
  },
};

function parseCopy(program, words) {
  const spec = COPY_SPEC[program];
  const parsed = scan(words, spec);
  const remote = program === 'rsync' && parsed.operands.some((item) => item.includes(':'));
  return { ...parsed, remote };
}

function isInterpreter(name) {
  return /^(?:python[\d.]*|node|perl|ruby|sh|bash|zsh|dash|ksh)$/u.test(name);
}

function looksInline(name, words) {
  if (!isInterpreter(name)) return false;
  return words.some((word) => word === '-c' || word === '-e' || word === '--eval' || word === '--print'
    || /^-c./u.test(word) || /^-e./u.test(word));
}

// 解释器后面跟着脚本或代码时，调用方看不清会写到哪。
function looksScript(name, words) {
  if (!isInterpreter(name)) return false;
  return words.some((word) => word !== '' && !word.startsWith('-'));
}

function unwrap(program, words) {
  if (program === 'env') {
    let i = 0;
    while (i < words.length) {
      const word = words[i];
      if (word === '--') return words.slice(i + 1);
      if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) {
        i += 1;
        continue;
      }
      if (word.startsWith('-')) {
        if (word === '-u' || word === '--unset' || word === '-S' || word === '--split-string'
          || word === '--chdir' || word === '-C') {
          i += word.includes('=') ? 1 : 2;
          continue;
        }
        i += 1;
        continue;
      }
      break;
    }
    return words.slice(i);
  }
  if (program === 'command' || program === 'builtin') {
    let i = 0;
    while (i < words.length && words[i].startsWith('-') && words[i] !== '-') {
      if (words[i] === '--') return words.slice(i + 1);
      i += 1;
    }
    return words.slice(i);
  }
  if (program === 'xargs') {
    const parsed = scan(words, {
      shortArg: new Set(['n', 'I', 'P', 'L', 's', 'E', 'a', 'd', 'J', 'p']),
      knownShort: new Set('0tnrxo'.split('')),
    });
    return parsed.uncertain ? null : parsed.operands;
  }
  if (program === 'timeout' || program === 'nice' || program === 'nohup' || program === 'setsid'
    || program === 'time') {
    const parsed = scan(words, {
      shortArg: new Set(['k', 's', 'n']),
      knownShort: new Set('fv'.split('')),
    });
    const rest = [];
    let skipped = false;
    for (const item of parsed.operands) {
      if (!skipped && /^\d+(?:\.\d+)?[smhd]?$/u.test(item)) {
        skipped = true;
        continue;
      }
      rest.push(item);
      skipped = true;
    }
    return parsed.uncertain ? null : rest;
  }
  return null;
}

// 深度用来打断 env env … 这种套娃。看不清就标 uncertain，调用方按会覆盖处理。
export function commandShape(program, args, flags = {}, depth = 0) {
  const words = wordsOf(args);
  const name = fold(pathBasename(program));
  if (!name) return blank('', words, { uncertain: true });
  if (WRAP.has(name)) {
    if (depth >= MAX_WRAP) return blank(name, words, { uncertain: true });
    const rest = unwrap(name, words);
    const inner = Array.isArray(rest) && rest.length
      ? commandShape(rest[0], rest.slice(1), {}, depth + 1)
      : null;
    return blank(name, words, { uncertain: !inner, inner });
  }
  let parsed = { options: [], operands: words, uncertain: false, sends: false, sub: '', remote: false };
  if (name === 'git') parsed = { sends: false, remote: false, ...parseGit(words) };
  else if (name === 'curl' || name === 'wget') parsed = { sub: '', remote: false, ...parseCurl(words, name) };
  else if (name === 'gh') parsed = { remote: false, ...parseGh(words) };
  else if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
    parsed = { remote: false, ...parseNpm(words) };
  } else if (name === 'docker' || name === 'podman') parsed = { remote: false, ...parseDocker(words) };
  else if (COPY_SPEC[name]) parsed = { sends: false, sub: '', ...parseCopy(name, words) };
  else if (name === 'find') {
    parsed = {
      options: words.filter((word) => word.startsWith('-')).map((word) => ({ name: word, value: null })),
      operands: words.filter((word) => !word.startsWith('-')),
      uncertain: false, sends: false, sub: '', remote: false,
    };
  } else parsed = { ...scan(words, {}), sends: false, sub: '', remote: false };
  const opaque = flags.inline === true || flags.script === true
    || looksInline(name, words) || looksScript(name, words);
  return blank(name, words, {
    sub: parsed.sub ?? '',
    options: parsed.options ?? [],
    operands: parsed.operands ?? [],
    sends: parsed.sends === true,
    opaque,
    remote: parsed.remote === true,
    uncertain: parsed.uncertain === true,
  });
}

function pathBasename(value) {
  const text = String(value ?? '');
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return cut === -1 ? text : text.slice(cut + 1);
}

// find -exec / -execdir / -ok 后面直到 ; 或 + 的那一段，是另一条命令。
export function findExecs(words) {
  const found = [];
  const list = words ?? [];
  for (let i = 0; i < list.length; i++) {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(list[i])) continue;
    const cmd = [];
    for (i += 1; i < list.length; i++) {
      if (list[i] === ';' || list[i] === '+') break;
      cmd.push(list[i]);
    }
    found.push(cmd);
  }
  return found;
}
