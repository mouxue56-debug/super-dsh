#!/bin/bash
source "$(dirname "$0")/common.sh"
check_main
trap 'check_main' EXIT
for SPEC in "dsh:$DSH_PORT" "fake:$FAKE_PORT"; do
 FILE="${SPEC%%:*}";PORT="${SPEC##*:}"
 [ -f "$SCRATCH/run/$FILE.pid" ] && [ ! -L "$SCRATCH/run/$FILE.pid" ] || { echo "$FILE 无可靠PID文件，跳过";continue; }
 P="$(cat "$SCRATCH/run/$FILE.pid")"
 if ! kill -0 "$P" 2>/dev/null;then echo "$FILE 已停止";continue;fi
 identity "$P" "$PORT" || { echo "$FILE 身份不符，拒绝停止";exit 1; }
 kill -TERM "$P"
 echo "已向本轮 $FILE $P 发送停止信号"
 for ATTEMPT in $(seq 1 50); do if ! kill -0 "$P" 2>/dev/null;then break;fi;sleep 0.1;done
 if kill -0 "$P" 2>/dev/null;then echo "本轮 $FILE 尚未退出；保留PID，不强杀";exit 1;fi
done
