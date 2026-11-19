# shellcheck shell=bash
# start.sh、stop.sh、doctor.sh 共用的小函数。只被 source，不单独运行。
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPAT_RANGE=">=0.2.2-rc.1 <0.2.3"    # 实测过的内核区间（暂定）
STACK_PORT_DEFAULT=18291              # 演示实例的网页/后端/假模型共用端口（暂定，可改）
KERNEL_PORT_DEFAULT=18296             # 演示实例的内核端口（暂定，可改）
DSH_APP_BIN="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"

say() { printf '%s\n' "$*"; }
die() { printf '失败：%s\n' "$*" >&2; exit 1; }

# 找 node：先看环境变量 NODE_BIN，再看 PATH。
find_node() {
  if [ -n "${NODE_BIN:-}" ]; then printf '%s' "$NODE_BIN"; else command -v node || true; fi
}

# 找 dsh：先看环境变量 DSH_BIN，再看 PATH，最后看桌面版的默认位置。找不到返回空。
find_dsh() {
  if [ -n "${DSH_BIN:-}" ]; then [ -x "$DSH_BIN" ] && printf '%s' "$DSH_BIN"; return 0; fi
  if command -v dsh >/dev/null 2>&1; then command -v dsh; return 0; fi
  [ -x "$DSH_APP_BIN" ] && printf '%s' "$DSH_APP_BIN"
  return 0
}

# 读 dsh 版本（--version 的第一个版本号）；读不到返回空。
dsh_version() {
  [ -n "${1:-}" ] || return 0
  "$1" --version 2>/dev/null | head -1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?' | head -1 || true
}

# 判断版本是否在兼容区间内（>=0.2.2-rc.1 <0.2.3）：0.2.2，或 0.2.2-rc.N 且 N>=1。
version_in_range() {
  local v="${1#v}"
  if [[ "$v" =~ ^0\.2\.2$ ]]; then return 0; fi
  if [[ "$v" =~ ^0\.2\.2-rc\.([0-9]+)$ ]] && [ "${BASH_REMATCH[1]}" -ge 1 ]; then return 0; fi
  return 1
}

# 目标目录必须显式给、是绝对路径、不含引号等特殊字符、不是系统目录。
check_target_arg() {
  [ -n "${1:-}" ] || die "必须用 --target <目录> 显式给出演示实例目录（绝对路径）"
  case "$1" in /*) ;; *) die "--target 必须是绝对路径：$1" ;; esac
  case "$1" in *\"*|*\\*|*'|'*|*'&'*|*"'"*|*' '*|*$'\n'*|*$'\r'*|*$'\t'*)
    die "--target 含不允许的字符（引号、反斜杠、竖线、&、空格、控制字符）" ;; esac
  case "$1" in /|/etc*|/usr*|/bin*|/sbin*|/System*|/Library*|/var/root*|/private/etc*)
    die "--target 不能是系统目录：$1" ;; esac
}

# 端口必须是 1024–65535 的数字。
check_port() {
  case "$1" in ''|*[!0-9]*) die "端口必须是数字：$1" ;; esac
  [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] || die "端口超出 1024–65535：$1"
}

# 端口上有没有东西在听（试连本机；连得上就算占用）。
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# 目标目录是否可以作为演示实例用：不存在、空目录，或带演示标记。
target_usable() {
  [ ! -e "$1" ] && return 0
  [ -d "$1" ] || return 1
  [ -f "$1/.hub-demo-instance" ] && return 0
  [ -z "$(ls -A "$1" 2>/dev/null)" ]
}

# 某个 pid 文件记录的进程还活着、命令行里含有给定的 ASCII 特征串、并且正在听给定端口（防止误停别的进程）。
# 不拿目标目录路径去比命令行：ps 在非终端输出里会把非 ASCII 字符转义，含中文的目录比不上。
pid_is_ours() { # $1 pid 文件  $2 命令行特征串（ASCII）  $3 端口
  [ -f "$1" ] || return 1
  local pid
  pid="$(cat "$1")"
  case "$pid" in ''|*[!0-9]*|0|1) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -qF -- "$2" || return 1
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -a -p "$pid" -iTCP:"$3" -sTCP:LISTEN -t >/dev/null 2>&1 || return 1
  fi
}

# 读 run/ports.env 里的两个端口；没有就用默认值。
load_ports() { # $1 目标目录
  STACK_PORT="$STACK_PORT_DEFAULT"; KERNEL_PORT="$KERNEL_PORT_DEFAULT"
  if [ -f "$1/run/ports.env" ]; then
    # shellcheck disable=SC1091
    . "$1/run/ports.env"
  fi
}
