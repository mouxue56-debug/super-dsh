#!/bin/bash
source "$(dirname "$0")/common.sh"
check_main
trap 'check_main' EXIT
[ ! -L "$SCRATCH" ] && [ ! -L "$SCRATCH/run" ] || { echo '隔离目录是链接，停止';exit 1; }
for ITEM in dsh fake; do
 FILE="$SCRATCH/run/$ITEM.pid"
 if [ -e "$FILE" ];then
  [ -f "$FILE" ] && [ ! -L "$FILE" ] || { echo 'PID文件不安全';exit 1; }
  PREVIOUS="$(cat "$FILE")"
  case "$PREVIOUS" in ''|*[!0-9]*|0|1) echo '旧PID格式不安全';exit 1;;esac
  if kill -0 "$PREVIOUS" 2>/dev/null;then echo '本轮仍有存活PID，拒绝重复启动';exit 1;fi
 fi
done
for PORT in "$DSH_PORT" "$FAKE_PORT"; do [ -z "$(port_pids "$PORT")" ] || { echo "$PORT 已占用，拒绝启动";exit 1;};done
"$NODE" "$ROOT/packages/hub-plugin/ops/prepare.mjs"
cd "$SCRATCH"
for f in dsh.out fake.out; do if [ -e "run/$f" ];then mv "run/$f" "run/$f.previous.$(date +%s).$$";fi;done
nohup "$NODE" "$ROOT/packages/fake-model/echo.mjs" "$FAKE_PORT" "$SCRATCH/run/fake-requests.jsonl" > run/fake.out 2>&1 < /dev/null &
echo $! > run/fake.pid
DSH='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
nohup env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" LANG=en_US.UTF-8 PATH=/usr/bin:/bin:/usr/sbin:/sbin \
 DSH_HOME="$SCRATCH" DSH_AGENTS_HOME="$SCRATCH/agents" TMPDIR="$SCRATCH/tmp/" HUB_FAKE_KEY=not-a-real-key HUB_HOME="$SCRATCH/hub" \
 "$DSH" --profile web --patch "$SCRATCH/fake.patch.yml" --no-open --host 127.0.0.1 --port "$DSH_PORT" \
 > run/dsh.out 2>&1 < /dev/null &
echo $! > run/dsh.pid
chmod 600 run/*
echo '3490/3496 隔离假模型实例已发起启动；未显示认证信息。'
