#!/bin/bash
# 安装:把运行目录(HUB_HOME)准备好。默认只演练,打印要做什么;加 --apply 才落盘。
# 用法: scripts/install.sh --target <绝对路径的运行目录> [--demo] [--apply]
# 不会做的事:不改 DSH 的 profile、不联网、不装依赖、不覆盖已有文件。
set -eu
. "$(dirname "$0")/lib.sh"

TARGET=""; APPLY=0; DEMO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --demo) DEMO=1; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "不认识的参数:$1" ;;
  esac
done
check_target_arg "$TARGET"

NODE="$(find_node)"
[ -n "$NODE" ] || die "找不到 node(需要 22 或更新)"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "node 版本太旧:$NODE_MAJOR,需要 22 或更新"

if [ "$APPLY" -eq 1 ]; then say "【真装】目标:$TARGET"; else say "【演练,不落盘;加 --apply 才真装】目标:$TARGET"; fi

# 动作:建目录。
make_dir() {
  if [ -d "$TARGET/$1" ]; then say "已有  目录  $1"; return; fi
  say "新建  目录  $1"
  if [ "$APPLY" -eq 1 ]; then mkdir -p "$TARGET/$1" && chmod 700 "$TARGET/$1"; fi
}

# 动作:写文件(已存在则不动)。参数:相对路径、内容来源文件("-" 表示标准输入)、权限。
put_file() {
  local rel="$1" src="$2" mode="$3" tmp=""
  if [ -e "$TARGET/$rel" ]; then say "已有  文件  $rel(不动)"; return; fi
  say "新建  文件  $rel"
  if [ "$APPLY" -eq 1 ]; then
    tmp="$TARGET/$rel.tmp-$$"
    if [ "$src" = "-" ]; then cat > "$tmp"; else cp "$src" "$tmp"; fi
    chmod "$mode" "$tmp"; mv "$tmp" "$TARGET/$rel"
  else
    if [ "$src" = "-" ]; then cat > /dev/null; fi
  fi
}

# 目录里已有条目就返回 0。没有这个目录、或是空目录，返回 1。
# 是链接、不是目录、读不了，按已有处理（返回 0）。
dir_has_entry() {
  local name
  if [ -L "$1" ]; then return 0; fi
  if [ ! -e "$1" ]; then return 1; fi
  if [ ! -d "$1" ]; then return 0; fi
  for name in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    if [ -e "$name" ] || [ -L "$name" ]; then return 0; fi
  done
  return 1
}

# 全新运行目录才写全开档。演示标记、配置里已有文件、配置是链接，
# 或者已经有助理目录、数据目录、会话、工单，都不补。拿不准按已有实例。
fresh_hub_instance() {
  local name rel
  if [ -e "$TARGET/.hub-demo-instance" ] || [ -L "$TARGET/.hub-demo-instance" ]; then
    return 1
  fi
  if [ -L "$TARGET/config" ]; then return 1; fi
  if [ -d "$TARGET/config" ]; then
    for name in "$TARGET"/config/* "$TARGET"/config/.[!.]* "$TARGET"/config/..?*; do
      if [ -e "$name" ] || [ -L "$name" ]; then return 1; fi
    done
  elif [ -e "$TARGET/config" ]; then
    return 1
  fi
  for rel in bots tickets board hub-data ledger kb run sessions shared data; do
    if dir_has_entry "$TARGET/$rel"; then return 1; fi
  done
  return 0
}

# 复用插件的写入：紧凑一行，原子替换，权限 0600。演练只打印，不落盘。
seed_fresh_open_mode() {
  say "新建  文件  config/permission-mode.json"
  if [ "$APPLY" -ne 1 ]; then return; fi
  "$NODE" --input-type=module -e \
    'import {pathToFileURL} from "node:url";
const mod = await import(pathToFileURL(process.argv[1]).href);
mod.writePermissionMode(process.argv[2], "open");' \
    "$REPO/packages/hub-plugin/permission-mode.mjs" \
    "$TARGET/config/permission-mode.json"
}

if [ "$APPLY" -eq 1 ]; then mkdir -p "$TARGET" && chmod 700 "$TARGET"; fi
for d in config bots tickets board ledger hub-data run kb; do make_dir "$d"; done
if fresh_hub_instance; then FRESH_HUB=1; else FRESH_HUB=0; fi

put_file config/hub.yaml - 600 <<YAML
# 安装级配置;严格平面 YAML,每个值单行紧凑 JSON。
version: 1
kb: "$TARGET/kb"
bots: ["chief","writer","research"]
names: {"chief":"总管","writer":"写作","research":"调研"}
chief: "chief"
kb_allow: {}
YAML
put_file config/bots.yaml "$REPO/defaults/bots.example.yaml" 600
sed "s|@HUB_HOME@|$TARGET|g" "$REPO/defaults/tool-levels.example.yaml" | put_file config/tool-levels.yaml - 600
if [ "$FRESH_HUB" -eq 1 ]; then
  seed_fresh_open_mode
elif [ -e "$TARGET/config/permission-mode.json" ] || [ -L "$TARGET/config/permission-mode.json" ]; then
  say "已有  文件  config/permission-mode.json(不动)"
else
  say "已有实例没有可用的权限档，保持原样"
fi

# 助理人设与手册:交给已有的内容安装脚本(它自己有备份和演练)。
CONTENT_CFG="$TARGET/config/content.install.json"
case "$REPO" in *\"*|*\\*) die "仓库路径含引号或反斜杠,无法生成配置" ;; esac
CONTENT_JSON="$(cat <<JSON
{"placeholders":{"owner":"你","speech":"简短、直接","duty":"见人设","not_duty":"见人设"},
 "bots":{
  "chief":{"name":"总管","persona_file":"$REPO/defaults/personas/chief.md"},
  "writer":{"name":"写作","persona_file":"$REPO/defaults/personas/writer.md"},
  "research":{"name":"调研","persona_file":"$REPO/defaults/personas/research.md"}}}
JSON
)"
printf '%s\n' "$CONTENT_JSON" | put_file config/content.install.json - 600
if [ "$APPLY" -eq 1 ]; then
  "$NODE" "$REPO/packages/hub-plugin/ops/install-content.mjs" --target "$TARGET" --config "$CONTENT_CFG" --apply
else
  say "演练  人设与手册:真装时会调用 packages/hub-plugin/ops/install-content.mjs(它自己也先演练)"
fi

if [ "$DEMO" -eq 1 ]; then
  make_dir board/tickets
  for f in "$REPO"/defaults/demo/board/tickets/*.json; do
    put_file "board/tickets/$(basename "$f")" "$f" 600
  done
  say "演示数据:四张虚构工单(演示模式,不含任何真实资料)"
else
  say "未加 --demo:不放演示数据"
fi

say ""
say "下一步:"
say "  1. 接入内核:把 packages/hub-plugin 作为插件接进你的 DSH profile(目前是手工一步,见 README 第 4 步)。"
say "  2. 体检:scripts/doctor.sh --target $TARGET"
say "  3. 启动:scripts/start.sh --target $TARGET $( [ "$DEMO" -eq 1 ] && printf %s '--demo ')--apply"
