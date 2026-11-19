import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEventTranslator, createLedger } from '../lib/ledger.mjs';

// 执行账本回填命令。
export async function main(argv, { stdout = process.stdout } = {}) {
  const opts = {};
  const values = new Set(['--ledger', '--events', '--bot', '--bot-map', '--utc-offset-minutes']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dry = true;
    else if (values.has(arg) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[arg] = argv[++i];
    else throw new Error(`Invalid argument: ${arg}`);
  }
  if (!opts['--ledger'] || !opts['--events']) throw new Error('--ledger and --events are required');
  const offset = opts['--utc-offset-minutes'] === undefined ? 0 : Number(opts['--utc-offset-minutes']);
  if (!Number.isInteger(offset)) throw new Error('Invalid UTC offset');
  const botMap = opts['--bot-map'] ? JSON.parse(fs.readFileSync(opts['--bot-map'], 'utf8')) : {};
  const source = opts['--events'];
  const stat = fs.statSync(source);
  const files = stat.isDirectory()
    ? fs.readdirSync(source).filter((f) => f.endsWith('.jsonl')).sort().map((f) => path.join(source, f))
    : [source];
  const ledger = createLedger({ dir: opts['--ledger'], utcOffsetMinutes: offset });
  const result = { written: 0, duplicate: 0, skipped: 0 };
  const keys = opts.dry ? new Set((await ledger.readRows()).map((r) => r.key)) : null;
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    const events = lines.map(JSON.parse);
    if (events[0]?.type !== 'session' || !events[0].id) throw new Error(`Missing session header: ${file}`);
    const ctx = {
      sessionId: events[0].id,
      bot: botMap[events[0].agentPreset] ?? opts['--bot'] ?? null,
      backfill: true,
    };
    if (!opts.dry) {
      const r = await ledger.ingest(events, ctx);
      for (const k of Object.keys(result)) result[k] += r[k];
    } else {
      const translator = createEventTranslator();
      for (const event of events) {
        const row = translator.translate(event, ctx);
        if (!row) {
          result.skipped++;
          continue;
        }
        const key = row.key ?? `${row.kind}:${row.sessionId}:${row.seq}`;
        if (keys.has(key)) result.duplicate++;
        else {
          keys.add(key);
          result.written++;
        }
      }
    }
  }
  stdout.write(JSON.stringify(result) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
