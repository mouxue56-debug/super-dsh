#!/bin/bash
# 体检：只读，不改任何东西。说清演示实例跑起来还缺什么，每条失败都带「怎么办」。
# 用法：scripts/doctor.sh --target <绝对路径的演示实例目录> [--port N] [--kernel-port N]
# DSH 版本不在实测区间时算失败；确认过要用，设 HUB_DEMO_FORCE=1 降为警告。
set -eu
. "$(dirname "$0")/lib.sh"

TARGET=""; PORT_ARG=""; KPORT_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --port) PORT_ARG="${2:-}"; shift 2 ;;
    --kernel-port) KPORT_ARG="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "不认识的参数：$1" ;;
  esac
done
check_target_arg "$TARGET"
load_ports "$TARGET"
STACK_PORT="${PORT_ARG:-${HUB_DEMO_PORT:-$STACK_PORT}}"
KERNEL_PORT="${KPORT_ARG:-${HUB_DEMO_KERNEL_PORT:-$KERNEL_PORT}}"

FAILS=0; WARNS=0
ok()   { say "通过  $*"; }
warn() { say "警告  $*"; WARNS=$((WARNS+1)); }
bad()  { say "失败  $*"; say "      怎么办：$2"; FAILS=$((FAILS+1)); }

NODE="$(find_node)"
if [ -z "$NODE" ]; then
  bad "找不到 node" "装 Node 22 或更新，或用 NODE_BIN 指定程序路径"
else
  major="$("$NODE" -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 22 ]; then ok "node $major"; else bad "node $major 太旧" "换成 Node 22 或更新"; fi
fi

DSH="$(find_dsh)"
if [ -z "$DSH" ]; then
  bad "找不到 DSH 内核" "装好 DSH，或用 DSH_BIN 指定它的程序路径（没有内核就起不来真实对话，演示也要它）"
else
  ver="$(dsh_version "$DSH")"
  if [ -z "$ver" ]; then
    warn "读不到 DSH 版本（$DSH --version 没输出版本号）；实测区间 $COMPAT_RANGE"
  elif version_in_range "$ver"; then
    ok "DSH 版本 $ver 在实测区间 $COMPAT_RANGE 内"
  elif [ "${HUB_DEMO_FORCE:-0}" = 1 ]; then
    warn "DSH 版本 $ver 不在实测区间 ${COMPAT_RANGE}（已设 HUB_DEMO_FORCE=1）"
  else
    bad "DSH 版本 $ver 不在实测区间 $COMPAT_RANGE" "换成区间内的版本；确认过要用就设 HUB_DEMO_FORCE=1"
  fi
fi

for rel in packages/hub-plugin/index.mjs packages/hub-bff/server.mjs packages/hub-web/server.mjs \
  packages/hub-web/shell/DSH-Hub.html defaults/demo/presets.patch.yml defaults/demo/board/tickets; do
  if [ -e "$REPO/$rel" ]; then ok "仓库文件 $rel"; else bad "仓库缺少 $rel" "重新取一份完整的代码"; fi
done

if [ -e "$TARGET" ] && ! target_usable "$TARGET"; then
  bad "$TARGET 已存在且不是演示实例目录" "换一个新目录；start.sh 不会往不是演示实例的非空目录里写"
elif [ -f "$TARGET/.hub-demo-instance" ]; then
  ok "演示实例目录已建好：$TARGET"
else
  ok "$TARGET 还没建（start.sh --demo 会建）"
fi

if pid_is_ours "$TARGET/run/stack.pid" demo-stack.mjs "$STACK_PORT" &&
  pid_is_ours "$TARGET/run/kernel.pid" "--profile web" "$KERNEL_PORT"; then
  ok "演示实例正在运行（端口 ${STACK_PORT}、${KERNEL_PORT}）"
  if [ -n "$NODE" ] && "$NODE" -e '
    fetch(process.argv[1]).then(r => process.exit(r.status === 401 || r.status === 200 ? 0 : 1), () => process.exit(1));
  ' "http://127.0.0.1:$STACK_PORT/"; then
    ok "网页端口有响应"
  else
    bad "网页端口没有响应" "scripts/stop.sh 后重新 start.sh；看 $TARGET/run/stack.log"
  fi
else
  for p in "$STACK_PORT" "$KERNEL_PORT"; do
    if port_busy "$p"; then
      bad "端口 $p 被别的程序占用" "用 --port / --kernel-port 换一个空闲端口（lsof -nP -iTCP:$p -sTCP:LISTEN 看是谁）"
    else
      ok "端口 $p 空闲"
    fi
  done
  if [ -f "$TARGET/run/stack.pid" ] || [ -f "$TARGET/run/kernel.pid" ]; then
    warn "留有旧的运行记录但进程不在了；scripts/stop.sh --target $TARGET 可清理"
  fi
fi
say "结果：失败 ${FAILS}，警告 $WARNS"
[ "$FAILS" -eq 0 ]
