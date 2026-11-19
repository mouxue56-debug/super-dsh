#!/bin/bash
# 停掉演示实例的全部进程，并确认端口已释放。只按目标目录里记下的 pid 停，且核对命令行含该目录，不按进程名杀。
# 用法：scripts/stop.sh --target <绝对路径的演示实例目录>
set -eu
. "$(dirname "$0")/lib.sh"

TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) die "不认识的参数：$1" ;;
  esac
done
check_target_arg "$TARGET"
[ -d "$TARGET/run" ] || { say "$TARGET 里没有运行记录，没什么可停的"; exit 0; }
load_ports "$TARGET"

# 停一个进程：先让它自己退，等不到再强停；一并处理它的子进程。
stop_one() { # $1 名字  $2 命令行特征串  $3 端口
  local f="$TARGET/run/$1.pid" pid
  if pid_is_ours "$f" "$2" "$3"; then
    pid="$(cat "$f")"
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    if kill -0 "$pid" 2>/dev/null; then
      pkill -KILL -P "$pid" 2>/dev/null || true
      kill -KILL "$pid" 2>/dev/null || true
    fi
    say "已停 $1（${pid}）"
    rm -f "$f"
  elif [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then
    say "$1：记录的进程还在，但身份对不上（命令行或端口不符），不动它；请自己核对 $f"
  else
    say "$1 不在运行"
    rm -f "$f"
  fi
}
stop_one stack demo-stack.mjs "$STACK_PORT"
stop_one kernel "--profile web" "$KERNEL_PORT"
sleep 0.5
RC=0
for p in "$STACK_PORT" "$KERNEL_PORT"; do
  if port_busy "$p"; then say "端口 $p 仍被占用"; RC=1; else say "端口 $p 已释放"; fi
done
exit "$RC"
