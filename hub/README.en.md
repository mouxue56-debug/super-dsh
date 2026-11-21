# Assistant Hub (working title)

Fresh installations default to Full Access. The owner confirms spending, external sends or publishing,
deletion, and live service changes. Routine file work, commands, tests, and builds proceed directly.

> Unofficial: an independent community project, not affiliated with or endorsed by DeepSeek. The name is provisional.
> 中文：[README.md](README.md)

**In one line:** a phone-first multi-assistant UI on top of the DSH kernel, with permission levels, approvals, a ticket
board and a usage ledger, running on your own machine. (DSH is short for DeepSeek Harness; this project only uses it.)

## Demo mode: one command, no keys

The demo is a fully isolated instance: a fake model (it only echoes what you say), fictional data (four tickets) and
three sample assistants. Everything listens on 127.0.0.1 only. It never touches your existing kernel data or any
credentials.

Requirements: Node 22 or newer, and a DSH kernel on this machine
(tested range in [COMPAT.md](COMPAT.md): `>=0.2.2-rc.1 <0.2.3`). The kernel is looked up via `DSH_BIN`, then
`dsh` on PATH, then the desktop app's default location. You must pass an absolute target directory, preferably a
new one:

```sh
scripts/doctor.sh --target /abs/path/demo      # read-only check: what is missing and what to do
scripts/start.sh --demo --target /abs/path/demo  # start (about two seconds), prints the URL
scripts/stop.sh --target /abs/path/demo         # stop everything and confirm the ports are free
```

`start.sh` prints a URL like `http://127.0.0.1:18291/?key=...`; open it in a local browser (the key is exchanged for a
cookie once). The key is a throwaway value for this demo only.

- Ports: web, back end and fake model share one port (default 18291); the kernel uses another (default 18296).
  Change with `--port`, `--kernel-port`, or `HUB_DEMO_PORT`, `HUB_DEMO_KERNEL_PORT`.
- Running `start.sh` again does not start a second copy. It refuses to write into a non-empty directory that is
  not a demo.
- Verified path: home page loads, a message to any sample assistant gets the fake model's reply, the board shows
  four tickets, the ledger records the call, and stop releases the ports. `test/demo-e2e.test.mjs` runs this for
  real (it skips with a stated reason when no kernel is installed). Verified on macOS only.

## Not done yet

- A one-command start for a real model. Only `--demo` exists; see `packages/hub-plugin/README.md` for wiring the plugin
  into a kernel profile by hand.
- Phone UI, skins and role packs are not exercised in demo mode.

## Tests

```sh
node test/run-all.mjs
```

Offline, no keys. The demo end-to-end test starts a real demo instance (two ports; override with `HUB_DEMO_PORT`,
`HUB_DEMO_KERNEL_PORT`, `HUB_DEMO_TEST_TARGET`).

## Credits and license

See [CREDITS.md](CREDITS.md). The license is in LICENSE at the repository root.
