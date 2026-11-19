#!/bin/bash
B="$HOME/dsh-work/dsh-hub/packages/fake-model"; mkdir -p "$B/run"
lsof -nP -iTCP:3296 -sTCP:LISTEN >/dev/null && { echo "3296 busy"; exit 1; }
nohup "$HOME/.local/bin/node" "$B/echo.mjs" 3296 "$B/run/requests.jsonl" > "$B/run/out.log" 2>&1 &
echo $! > "$B/fake-model.pid"; echo "started $(cat "$B/fake-model.pid")"
