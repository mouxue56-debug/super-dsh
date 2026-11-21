// 模型密钥：优先读配置里的文件（必须是 0600 普通文件、属当前用户、不是链接）。
// 没配文件时仍接受环境变量，并给出警告。报错和警告里不出现密钥内容。
import { lstatSync, readFileSync } from 'node:fs';

export class ModelKeyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const refuse = (message, code) => {
  throw new ModelKeyError(message, code);
};

// 配置里如果误把密钥本身写成路径，报错时不能把那段再打印出来。
function asPath(file) {
  const text = String(file ?? '').trim();
  if (!text) return '';
  if (text.length > 400 || /[\r\n\u0000]/.test(text) || (!text.includes('/') && text.length > 32)) {
    refuse('apiKeyFile 要写成文件路径，不要把密钥写进配置', 'BAD_CONFIG');
  }
  return text;
}

export function resolveModelKey({ file = '', envName = 'HUB_OPENCODE_KEY', env = process.env,
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  lstat = lstatSync, readFile = readFileSync } = {}) {
  const name = typeof envName === 'string' && envName ? envName : 'HUB_OPENCODE_KEY';
  const path = asPath(file);
  if (path) {
    let st;
    try { st = lstat(path); }
    catch { refuse(`模型密钥文件不存在或读不到：${path}`, 'MISSING'); }
    if (typeof st.isSymbolicLink === 'function' ? st.isSymbolicLink() : false) {
      refuse(`模型密钥文件不能是链接：${path}`, 'BAD_FILE');
    }
    if (typeof st.isFile === 'function' && !st.isFile()) refuse(`模型密钥文件必须是普通文件：${path}`, 'BAD_FILE');
    const mode = st.mode & 0o7777;
    if (mode !== 0o600) {
      refuse(`模型密钥文件权限必须是 0600，现在是 ${mode.toString(8).padStart(4, '0')}：${path}`, 'BAD_MODE');
    }
    if (uid != null && st.uid !== uid) refuse(`模型密钥文件必须属于当前用户：${path}`, 'BAD_FILE');
    let raw;
    try { raw = readFile(path, 'utf8'); }
    catch { refuse(`模型密钥文件读不到：${path}`, 'BAD_FILE'); }
    const value = String(raw).replace(/[\r\n ]/g, '');
    if (!value) refuse(`模型密钥文件是空的：${path}`, 'EMPTY');
    return { value, source: 'file', warning: null };
  }
  const fromEnv = env?.[name];
  if (typeof fromEnv === 'string' && fromEnv.length) {
    return { value: fromEnv, source: 'env', warning:
      `模型密钥来自环境变量 ${name}。请改成在配置里写 apiKeyFile，指向权限为 0600 的文件。` };
  }
  refuse(`没有模型密钥：配置里没写 apiKeyFile，环境变量 ${name} 也是空的。`, 'ENV_MISSING');
}

// 只认两行：apiKeyFile、apiKeyEnv。注释和别的行忽略。不执行配置内容。
export function readKeyConfig(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\n/u)) {
    const stripped = line.replace(/#.*$/u, '').trim();
    if (!stripped) continue;
    const match = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/u.exec(stripped);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  try {
    let file = arg('--file') ?? '';
    let envName = arg('--env-name') || 'HUB_OPENCODE_KEY';
    const configPath = arg('--config');
    if (configPath) {
      let text;
      try { text = readFileSync(configPath, 'utf8'); }
      catch { refuse(`模型密钥配置读不到：${configPath}`, 'BAD_CONFIG'); }
      const config = readKeyConfig(text);
      if (config.apiKeyEnv) envName = config.apiKeyEnv;
      if (config.apiKeyFile) file = config.apiKeyFile;
    }
    const fallback = process.argv.includes('--fallback-env') && !arg('--config');
    let result;
    try {
      result = resolveModelKey({ file, envName });
    } catch (error) {
      if (!(fallback && error?.code === 'MISSING')) throw error;
      result = resolveModelKey({ envName });
    }
    if (result.warning) process.stderr.write(result.warning + '\n');
    process.stdout.write(result.value);
  } catch (error) {
    process.stderr.write(String(error?.message || '模型密钥读不了') + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('model-key.mjs')) main();
