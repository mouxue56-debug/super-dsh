import { open, constants } from 'node:fs/promises';
import { BffError } from './errors.mjs';
export async function readSecret(path) {
  if (typeof path !== 'string' || !path) throw new BffError('CONFIGURATION', 'Secret file required', 503);
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 16384) throw new Error('permissions');
    const value = (await file.readFile('utf8')).trim();
    if (!value || /[\r\n\x00]/.test(value)) throw new Error('invalid');
    return value;
  } catch { throw new BffError('CONFIGURATION', 'Secret file must be a readable regular file with mode 0600', 503); }
  finally { await file?.close(); }
}
