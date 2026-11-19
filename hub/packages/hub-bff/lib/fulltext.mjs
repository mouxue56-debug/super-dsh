// 确认卡的「看全文」：卡上只放摘要，全文按内容的 sha256 存一份，卡上带这个校验和；
// 批准后真正执行的那一方重算校验和，对不上就不执行。讨论组分工表卡与外包任务书卡共用。
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_BYTES = 262144;

// 算一段文字的校验和（sha256 十六进制）。
export function textDigest(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// 判断是不是合法的校验和写法。
export function isDigest(value) {
  return typeof value === 'string' && DIGEST.test(value);
}

// 建全文存放处；dir 必须是绝对路径（一般是 <数据目录>/fulltext）。
export function createFullTextStore(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('全文目录必须是绝对路径');
  return {
    // 存一份全文，返回校验和；同样的内容只存一次。
    put(text) {
      if (typeof text !== 'string' || !text) throw new Error('全文不能为空');
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('全文太长');
      const digest = textDigest(text);
      const file = path.join(dir, digest + '.txt');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!fs.existsSync(file)) {
        const tmp = file + '.' + randomBytes(6).toString('hex');
        fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
        fs.renameSync(tmp, file);
      }
      return digest;
    },
    // 按校验和取全文；文件被改过（校验和对不上）或不存在都返回 null。
    get(digest) {
      if (!isDigest(digest)) return null;
      let text;
      try {
        const file = path.join(dir, digest + '.txt');
        if (!fs.lstatSync(file).isFile()) return null;
        text = fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
      return textDigest(text) === digest ? text : null;
    },
  };
}

// 把长文切成卡上的摘要：不超过 max 字，超了在末尾注明「看全文」。
export function cardSummary(text, max = 900) {
  const chars = [...String(text)];
  if (chars.length <= max) return { text: chars.join(''), truncated: false };
  const tail = '\n…（卡上放不下，点「看全文」看完整内容；批准的就是全文这一份）';
  return { text: chars.slice(0, max - [...tail].length).join('') + tail, truncated: true };
}
