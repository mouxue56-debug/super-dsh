#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo '用法：stage-shell.sh <源壳目录> <目标壳目录>' >&2
  exit 2
fi
web="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$(cd "$1" && pwd -P)"
target_parent="$(cd "$(dirname "$2")" && pwd -P)"
target="$target_parent/$(basename "$2")"
next="$target.next"
stamp="$(date +%Y%m%d-%H%M%S)-$$"
node="${NODE:-$(command -v node || true)}"
node="${node:-$HOME/.local/bin/node}"
if [ "$source_dir" = "$target" ] || [ -L "$1" ] || [ -L "$2" ] || [ -L "$next" ]; then
  echo '拒绝相同目录或符号链接' >&2
  exit 1
fi
case "$target/" in
  "$source_dir/"*) echo '拒绝目标位于源壳内部' >&2; exit 1 ;;
esac
if [ -n "$(find "$source_dir" -type l -print -quit)" ]; then
  echo '拒绝源壳中的符号链接' >&2
  exit 1
fi
for name in index.html manifest.webmanifest assets pets fonts; do
  if [ ! -e "$source_dir/$name" ]; then
    echo "源壳缺少：$name" >&2
    exit 1
  fi
done
if [ -e "$next" ]; then
  mv "$next" "$target.prev-$stamp-staging"
fi
mkdir "$next"
rsync -a --include='/index.html' --include='/manifest.webmanifest' \
  --include='/assets/***' --include='/pets/***' --include='/fonts/***' \
  --exclude='*' "$source_dir/" "$next/"
"$node" "$web/test/check-shell-contract.mjs" "$next/index.html"
"$node" "$web/ops/check-secure-context.mjs" "$web/hub-real.js" "$next/index.html"
previous=''
if [ -e "$target" ]; then
  previous="$target.prev-$stamp"
  mv "$target" "$previous"
fi
if ! mv "$next" "$target"; then
  if [ -n "$previous" ]; then mv "$previous" "$target"; fi
  echo '切换失败，已尝试恢复旧壳' >&2
  exit 1
fi
"$node" --input-type=module - "$target" <<'NODE'
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.argv[2];
let files = 0;
let bytes = 0;
async function walk(dir) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await lstat(path);
    if (info.isDirectory()) await walk(path);
    else { files++; bytes += info.size; }
  }
}
await walk(root);
const sha = createHash('sha256').update(await readFile(join(root, 'index.html'))).digest('hex');
console.log(`壳暂存完成 SHA256=${sha} 文件数=${files} 总大小=${bytes} 字节`);
NODE
