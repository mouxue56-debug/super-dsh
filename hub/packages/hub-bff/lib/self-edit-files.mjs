import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_TEXT = 128000;


export class EditError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const deny = message => new EditError('EDIT_PATH', message, 400);
export const isInside = (root, file) => file === root || file.startsWith(root + path.sep);

export function pathParts(value, rootAllowed = false) {
  if (value === '' && rootAllowed) return [];
  if (typeof value !== 'string' || value.length > 400 || /[\x00-\x1f\\:]/u.test(value)) {
    throw deny('请给源码目录内的相对路径。');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw deny('请给源码目录内的相对路径，不能用绝对路径或上级目录。');
  }
  return parts;
}

// 包含每个现有祖先在内，只接受真实目录与普通单链接文件。
export function checkedPath(root, parts, { missing = false } = {}) {
  if (fs.realpathSync(root) !== root || !fs.lstatSync(root).isDirectory()) {
    throw deny('源码目录位置发生变化，请让主人检查。');
  }
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let info;
    try { info = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && missing && index === parts.length - 1) return { file: current, info: null };
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw deny('找不到这个文件或目录。');
      throw error;
    }
    if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) {
      throw deny('不能通过符号链接、硬链接或特殊文件读取或写入。');
    }
    if (fs.realpathSync(current) !== current) throw deny('请使用源码目录里显示的路径。');
    if (!info.isDirectory() && index + 1 !== parts.length) throw deny('这条路径的上一级不是目录。');
    if (index + 1 === parts.length) return { file: current, info };
  }
  return { file: root, info: fs.lstatSync(root) };
}

export function readText(file, info) {
  if (!info.isFile() || info.size > MAX_TEXT) throw deny('只能读取不超过 128 KB 的普通文本文件。');
  const bytes = fs.readFileSync(file, { flag: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
  try {
    if (bytes.includes(0)) throw new Error();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw deny('只能读取 UTF-8 文本文件。');
  }
}

export function writeText(file, info, value) {
  if (info && !info.isFile()) throw deny('要写入的是一个文件，请给出文件名。');
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_TEXT || value.includes('\0')) {
    throw deny('写入内容必须是不超过 128 KB 的文本。');
  }
  if (info) readText(file, info);
  const tmp = path.join(path.dirname(file), '.r43-write-' + randomUUID());
  fs.writeFileSync(tmp, value, { flag: 'wx', mode: info ? info.mode & 0o777 : 0o600 });
  fs.renameSync(tmp, file);
}
