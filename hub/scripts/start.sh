#!/bin/bash
# 一条命令起一个隔离的演示实例：假模型 + 虚构数据 + 三个示例助理，全部只在本机（127.0.0.1）。
# 用法：scripts/start.sh --demo --target <绝对路径的新目录> [--port N] [--kernel-port N]
#   --port         网页、后端、假模型共用的端口（默认 18291，或环境变量 HUB_DEMO_PORT）
#   --kernel-port  内核端口（默认 18296，或环境变量 HUB_DEMO_KERNEL_PORT）
# 要求：Node 22 或更新；本机装了 DSH 内核（可用 DSH_BIN 指定，装在默认位置也行）。不需要任何钥匙。
# 先体检看缺什么：scripts/doctor.sh --target <目录>；停：scripts/stop.sh --target <目录>
set -eu
umask 077
. "$(dirname "$0")/lib.sh"

TARGET=""; DEMO=0
STACK_PORT="${HUB_DEMO_PORT:-$STACK_PORT_DEFAULT}"
KERNEL_PORT="${HUB_DEMO_KERNEL_PORT:-$KERNEL_PORT_DEFAULT}"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --demo) DEMO=1; shift ;;
    --port) STACK_PORT="${2:-}"; shift 2 ;;
    --kernel-port) KERNEL_PORT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "不认识的参数：$1" ;;
  esac
done
[ "$DEMO" -eq 1 ] || die "现在只支持演示模式，请加 --demo（接真实模型的一键启动还没做，见 README）"
check_target_arg "$TARGET"
check_port "$STACK_PORT"; check_port "$KERNEL_PORT"
[ "$STACK_PORT" != "$KERNEL_PORT" ] || die "两个端口不能相同"
target_usable "$TARGET" || die "$TARGET 已存在且不是演示实例目录（不为空也没有演示标记），请换一个新目录"

NODE="$(find_node)"; [ -n "$NODE" ] || die "找不到 node（需要 22 或更新）"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "node 版本太旧，需要 22 或更新"
DSH="$(find_dsh)"
[ -n "$DSH" ] || die "找不到 DSH 内核：请装好它，或用 DSH_BIN 指定程序路径（scripts/doctor.sh 能说明）"
VER="$(dsh_version "$DSH")"
if [ -n "$VER" ] && ! version_in_range "$VER" && [ "${HUB_DEMO_FORCE:-0}" != 1 ]; then
  die "DSH 版本 $VER 不在实测区间 ${COMPAT_RANGE}（确认过要用，请设 HUB_DEMO_FORCE=1 再来）"
fi
RUN="$TARGET/run"

# 已经在跑：不重复起，只告诉在哪。
WANT_STACK="$STACK_PORT"; WANT_KERNEL="$KERNEL_PORT"
load_ports "$TARGET"
if pid_is_ours "$RUN/stack.pid" demo-stack.mjs "$STACK_PORT" &&
  pid_is_ours "$RUN/kernel.pid" "--profile web" "$KERNEL_PORT"; then
  say "演示实例已在运行（端口 ${STACK_PORT}、${KERNEL_PORT}）。访问地址："
  say "  http://127.0.0.1:$STACK_PORT/?key=$(cat "$RUN/hub-web.key")"
  exit 0
fi
STACK_PORT="$WANT_STACK"; KERNEL_PORT="$WANT_KERNEL"
for f in stack kernel; do
  [ -f "$RUN/$f.pid" ] && kill -0 "$(cat "$RUN/$f.pid")" 2>/dev/null &&
    die "$f 的进程还在（但另一半没起来），请先 scripts/stop.sh --target $TARGET"
done
for p in "$STACK_PORT" "$KERNEL_PORT"; do
  if port_busy "$p"; then die "端口 $p 已被占用，请用 --port / --kernel-port 换一个"; fi
done

mkdir -p "$TARGET"
"$NODE" "$REPO/scripts/demo-prepare.mjs" --target "$TARGET" --port "$STACK_PORT" --kernel-port "$KERNEL_PORT" \
  --dsh-bin "$DSH" > "$TARGET/prepare.out" 2>&1 || { cat "$TARGET/prepare.out" >&2; die "准备演示目录失败"; }
rm -f "$TARGET/prepare.out"
cd "$RUN"
for f in kernel.log stack.log; do [ -e "$f" ] && mv "$f" "$f.prev"; done

fail_and_stop() {
  say "失败：$1" >&2
  for f in kernel.log stack.log; do
    [ -f "$RUN/$f" ] || continue
    say "--- $f 末尾 ---" >&2
    tail -15 "$RUN/$f" | sed -E 's/token=[A-Za-z0-9_-]+/token=***/' >&2
  done
  # 刚刚由本脚本起的进程可能还没开始听端口，stop.sh 认不出来：这里按刚记下的 pid 直接收掉。
  for f in stack kernel; do
    [ -f "$RUN/$f.pid" ] || continue
    pkill -TERM -P "$(cat "$RUN/$f.pid")" 2>/dev/null || true
    kill -TERM "$(cat "$RUN/$f.pid")" 2>/dev/null || true
  done
  sleep 1
  "$REPO/scripts/stop.sh" --target "$TARGET" >/dev/null 2>&1 || true
  exit 1
}

# 内核：隔离的数据目录与假 HOME，只接假模型；环境变量清空后只给必要的几个。
# 演示用的假密钥仍放在环境变量里，不打印它的值。真模型请改用 0600 文件。
echo "演示实例的模型密钥仍在环境变量里。真模型请在配置里写 apiKeyFile，指向权限为 0600 的文件。" >&2
NODE_DIR="$(dirname "$NODE")"
nohup env -i HOME="$TARGET/kernel/fakehome" USER=demo LOGNAME=demo LANG=en_US.UTF-8 \
  PATH="$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin" DSH_HOME="$TARGET/kernel/home" DSH_AGENTS_HOME="$TARGET/hub" \
  TMPDIR="$TARGET/kernel/tmp/" HUB_FAKE_KEY=not-a-real-key HUB_HOME="$TARGET/hub" \
  "$DSH" --profile web --patch "$TARGET/kernel/demo-model.patch.yml" --no-open --host 127.0.0.1 --port "$KERNEL_PORT" \
  > kernel.log 2>&1 < /dev/null &
echo $! > kernel.pid
TOKEN=""
for _ in $(seq 1 200); do
  TOKEN="$(sed -nE "s#.*http://127\.0\.0\.1:$KERNEL_PORT/\?token=([A-Za-z0-9_-]+).*#\1#p" kernel.log | head -1)"
  [ -n "$TOKEN" ] && break
  kill -0 "$(cat kernel.pid)" 2>/dev/null || fail_and_stop "内核提前退出"
  sleep 0.2
done
[ -n "$TOKEN" ] || fail_and_stop "40 秒内没等到内核就绪"
printf '%s' "$TOKEN" > dsh.token

# 网页、后端、假模型：一个进程一个端口。
nohup env -i HOME="$TARGET/kernel/fakehome" LANG=en_US.UTF-8 PATH="$NODE_DIR:/usr/bin:/bin" \
  HUB_HOME="$TARGET/hub" DSH_URL="http://127.0.0.1:$KERNEL_PORT" DSH_TOKEN_FILE="$RUN/dsh.token" \
  BFF_KEY_FILE="$RUN/bff.key" HUB_BFF_STORE="$RUN/store.json" HUB_BFF_CALL_LOG="$RUN/calls.log" \
  HUB_WEB_KEY_FILE="$RUN/hub-web.key" \
  "$NODE" "$REPO/scripts/demo-stack.mjs" --target "$TARGET" --port "$STACK_PORT" > stack.log 2>&1 < /dev/null &
echo $! > stack.pid
for _ in $(seq 1 150); do
  grep -q "demo stack ready" stack.log 2>/dev/null && break
  kill -0 "$(cat stack.pid)" 2>/dev/null || fail_and_stop "网页/后端进程提前退出"
  sleep 0.2
done
grep -q "demo stack ready" stack.log 2>/dev/null || fail_and_stop "30 秒内没等到网页/后端就绪"

say "演示实例已启动（隔离在 ${TARGET}，只听 127.0.0.1，假模型、虚构数据，不需要任何钥匙）。"
say "在本机浏览器打开（首次带钥匙进入，之后靠 cookie）："
say "  http://127.0.0.1:$STACK_PORT/?key=$(cat "$RUN/hub-web.key")"
say "三个示例助理：总管、写作、调研。停止：scripts/stop.sh --target $TARGET"
