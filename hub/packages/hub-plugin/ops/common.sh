#!/bin/bash
set -eu
umask 077
HUB_HOME="${HUB_HOME:-$HOME/dsh-work}"
ROOT="${HUB_REPO:-$HUB_HOME/dsh-hub}"
SCRATCH="${HUB_SCRATCH:-$HUB_HOME/tmp/r26-B/runtime}"
TEST_CONFIG="$ROOT/packages/hub-plugin/ops/r26-test-config.json"
DSH_PORT="$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["dshPort"])' "$TEST_CONFIG")"
FAKE_PORT="$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["fakePort"])' "$TEST_CONFIG")"
NODE="$HOME/.local/bin/node"
check_main() {
 ps -o pid,lstart -p 11400,11416
 ps -o pid=,lstart= -p 11400,11416 | awk 'BEGIN{a=0;b=0} $1==11400 && $2=="Tue" && $3=="Nov" && $4==17 && $5=="15:01:39" && $6==2026 {a=1} $1==11416 && $2=="Tue" && $3=="Nov" && $4==17 && $5=="15:01:40" && $6==2026 {b=1} END{exit !(a && b)}' || { echo '主线变了'; exit 90; }
}
port_pids() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u || true; }
identity() {
 P="$1";PORT="$2"
 case "$P" in ''|*[!0-9]*|0|1|11400|11416|88915|89022|89051|22071) return 1;; esac
 kill -0 "$P" 2>/dev/null || return 1
 [ "$(port_pids "$PORT")" = "$P" ] || return 1
 [ "$(lsof -a -p "$P" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$SCRATCH" ] || return 1
 CMD="$(ps -o command= -p "$P")"
 case "$PORT" in
 "$DSH_PORT") case "$CMD" in *dsh-desktop-host/lib/cli.js*'--profile web'*"--patch $SCRATCH/fake.patch.yml"*"--port $DSH_PORT"*) return 0;;*)return 1;;esac;;
 "$FAKE_PORT") case "$CMD" in *"$ROOT/packages/fake-model/echo.mjs $FAKE_PORT "*)return 0;;*)return 1;;esac;;
 *)return 1;;
 esac
}
