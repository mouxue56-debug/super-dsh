# hub-web · B2 交付回执

来源：`b/B2-web.md`、`b/COMMON-B.md`（2026-11-16）。本目录是本轮唯一源码写入范围；临时测试文件只在 `r16/tmp/`。未修改 H 的样张源码、DSH、生产服务或其它包；未部署、未调用模型、未安装依赖。

## 启动与停止

只依赖 Node 内置模块；目标 Node v24，本机实测 v22.22.3。无需 npm install。

在本目录启动，由监工准备真实 BFF 的 key 文件路径：

```sh
HUB_WEB_HOSTS=127.0.0.1 \
HUB_WEB_PORT=13292 \
HUB_WEB_KEY_FILE="$R/tmp/b2-web.key" \
BFF_KEY_FILE="$R/tmp/b2-bff.key" \
BFF_URL=http://127.0.0.1:13291 \
node server.mjs
```

上面的 `$R` 指 `.../hub/supervisor/r16`，须先在当前终端设置为实际绝对路径。真实部署由监工执行；本轮没有执行部署。目标机器的参数是 `HUB_WEB_HOSTS=127.0.0.1,<本机尾网地址>`、`HUB_WEB_PORT=3292`、`BFF_URL=http://127.0.0.1:3291`，key 路径由监工指定。

首次从受控浏览器访问 `http://<监听地址>:<端口>/?key=K`，K 由程序读取 `HUB_WEB_KEY_FILE`，不要把实际值写进聊天、日志、截图或回执。服务器校验后设置 HttpOnly、SameSite=Strict、Path=/ 的会话 cookie，并 303 到 `/`，页面 URL 不再含 key。日志不会输出启动密钥。未认证的页面、脚本与 `/bff/*` 均返回 401。

前台进程按 Ctrl-C 停止，或只向本次启动的 hub-web PID 发 SIGTERM。服务器关闭自己的监听、连接和代理请求，不停止 BFF 或 DSH。两项自动化测试与 E2E 脚本均会关闭自己启动的服务。

| 环境变量 | 默认 / 规则 |
| --- | --- |
| `HUB_WEB_HOSTS` | `127.0.0.1`；逗号分隔的明确 IP；拒绝 `0.0.0.0`、IPv6 通配地址及等价写法 |
| `HUB_WEB_PORT` | `3292` |
| `HUB_WEB_KEY_FILE` | 本目录 `run/hub-web.key`；缺失则随机生成，0600 |
| `BFF_URL` | `http://127.0.0.1:3291`；只接受 127.0.0.1 的纯 HTTP origin |
| `BFF_KEY_FILE` | 必填，必须已存在；读取后作为代理请求的 `X-Hub-Bff-Key`；不会下发给浏览器 |

两个 key 文件必须为当前运行用户所有的 0600 普通文件；拒绝符号链接、空值或无效权限。web 会话 cookie 随 web key 变化而失效。服务校验请求 Host，BFF 请求校验 Origin/跨站来源；不向浏览器转发 BFF 的 cookie 或鉴权头。

## 界面与接口

顶端始终可见「演示 / 真实连接」两个 44px 触控按钮和范围说明。默认演示不访问 BFF，保留原壳与 interact 的发送、流式演示、其它 bot 和业务模块。真实模式仅把首席聊天接入 BFF，明确显示「其余模块为演示」。演示消息与真实消息分开保存于当前页内存，切回演示恢复原对话；真实历史来自 BFF。

模式存于 `hub-web-mode-v1`，原生首席会话 ID 到 BFF 会话 ID 的映射存于 `hub-web-sessions-v1`，默认原生会话 `chief-013`。所有 localStorage 读写有 try/catch；禁用存储时降为当前页内存，不保证刷新后复用。首次进入真实首席会话通过 POST 创建 BFF 会话，刷新复用映射并读取历史。映射失效或网络错误如实报错，不自动重发、不用样例兜底。

| 请求 | 用途 |
| --- | --- |
| `GET /bff/health` | 进入真实模式及前台每 15 秒检测；根据 `ok` 与 `dsh.connected` 显示连接状态 |
| `POST /bff/sessions {title}` | 首次建立真实首席会话，保留返回的 `id` |
| `GET /bff/sessions/:id/history` | 加载已提交的 user/assistant 文本；历史不作为新消息重发 |
| `POST /bff/sessions/:id/messages {text}` | 发送文本；核对 `accepted` 与 `requestId` |
| `GET /bff/sessions/:id/stream` | fetch 流读取 SSE；delta 追加、assistant message 替换定稿文本、done 结束、error 报错 |
| `POST /bff/sessions/:id/cancel` | 每条真实回复的「停止」入口；接纳后显示「已请求停止」 |
| `GET /bff/sessions` | 代理与 fake BFF 支持；本轮界面不新增真实会话管理页 |

流式文本与定稿始终是首席的一条消息。出错保留已收到的部分，显示失败及不自动重发。停止会等待当前发送的接纳阶段，再请求取消；取消失败保留重试停止入口，不声称已取消。切回演示前先请求停止真实生成；未获取消回执则保留真实模式。演示首席仍在生成时先提示停止演示，再切真实连接。

## 与原样张的适配边界

- `shell/DSH-Hub.html` 是 H/dist 的逐字节副本。服务启动只读取这份副本，不读 H，不构建或修改 H。
- 响应仅把内嵌 CSP 的 `connect-src 'none'` 改为 `'self'`，并在 `</body>` 前注入 `/hub-real.js`。CSP 若保持离线值，浏览器会阻止同源 BFF 请求。修改只在 HTTP 响应内进行。
- 依据 `H/CONTRACT.md` 与 `H/js/core.js:649` 的 postMessage/message 事件，以及 `core.js:1014` 的 setMessageStatus。流式卡按现有模块方式更新自己的 DOM；完整刷新调用壳现有经典脚本 `window.render()`，不替换该函数。
- 壳的 `core.js:584` 有 send/runReply 演示路径，`modules/interact.js:505`、`:542` 有 runPayload/sendMessage，且在 document capture 处理发送。增量脚本用 window capture 先截获真实首席的 Enter/发送按钮；默认演示直接放行。
- interact 的 message 监听器会在 `modules/interact.js:254` 延迟插入后台演示回报，persona 也会自动回复新 bot 草案。真实首席过滤这些模块通过 `Hub.postMessage` 发出的演示回复，只允许真实桥接消息进入真实对话；其它 bot 原样放行。
- 其它能力、看板、工具、设置、附件、语音、引用等仍是演示。本轮真实 BFF 只传输入框的纯文本，不上传附件、不连接模型配置或其它业务数据。顶部范围说明持续可见。

## 自测命令

```sh
node --test test/server.test.mjs test/client.test.mjs
node test/e2e.cjs
```

`server.test.mjs` 与 `client.test.mjs` 使用空闲的随机回环端口，不连接真实 DSH。`client.test.mjs` 在 Node VM 中执行本目录样张的实际内联脚本和真实增量脚本，经 hub-web HTTP 代理对接 fake BFF；DOM double 取自 H/verify.cjs 的只读适配，不运行 H 的验证程序，不在 H 生成文件。它不证明浏览器布局或真实触控。

`test/e2e.cjs` 自行启动 fake BFF `127.0.0.1:13291` 与 hub-web `127.0.0.1:13292`，采用指定的本机 playwright-core 和已存在的 chromium_headless_shell-1243，显式传 executablePath；不下载浏览器。脚本覆盖原演示回复、真实 partial→done、无演示回报混入、停止、其它 bot 演示、模式/会话持久化、历史、断线，以及 390×844 和 1440×900 截图。预期截图：

```text
$R/tmp/b2-shots/mobile-390x844.png
$R/tmp/b2-shots/desktop-1440x900.png
```

测试临时目录默认由脚本相对本目录定位到 `$R/tmp`；可用 `B2_TMP` 覆盖 E2E 临时根，用 `B2_FAKE_PORT`、`B2_WEB_PORT` 改测试端口，`B2_CHROMIUM` 仅指定另一份已安装的浏览器可执行文件。部署不需要 Playwright。

仅手动检查离线服务时，先在另一个终端启动 fake BFF，再用同一个 key 路径启动 web：

```sh
FAKE_BFF_PORT=13291 BFF_KEY_FILE="$R/tmp/b2-bff.key" node test/fake-bff.mjs
```

fake BFF 只在 127.0.0.1 监听，缺失 key 时生成 0600 文件；实现 health/sessions/history/messages/stream/cancel，与工单约定形状一致。文本含「慢」时每段延迟 400ms。它是离线测试 fixture，不是接入 DSH 的真实 BFF。

## 实际验证回执（2026-11-16）

最终命令 `node --test packages/hub-web/test/server.test.mjs packages/hub-web/test/client.test.mjs`，从 W 执行的实际输出摘要：

```text
ok 1 - actual bundled shell + bridge: offline VM integration (not browser/layout acceptance)
ok 2 - auth bootstrap, key modes, protected routes, proxy streaming, cancel and host/origin boundaries
# tests 2
# pass 2
# fail 0
# cancelled 0
# skipped 0
# duration_ms 3856.677125
```

已核验：默认不调用 BFF、发送捕获、delta 分段、单消息定稿、persona/延迟后台演示回复隔离、演示消息恢复、其它 bot 不发 BFF、正常停止、发送接纳前立即停止竞态、断线报错；鉴权换 cookie、匿名 401、跨源与 Host 拒绝、0600 与生成 key、通配地址拒绝、SSE 在定稿前到达、cancel、上游断开 502。7 个 JS 文件全部通过 `node --check`。

样张副本核对实际输出：

```text
H/dist/DSH-Hub.html bytes=1104600
shell/DSH-Hub.html bytes=1104600
sha256=efa205b9f2d813bda115a6df106a61860ea955490db16000cafc3d981ee6b89e
PASS 7 JavaScript syntax checks; shell copy byte-identical
```

浏览器命令 `node packages/hub-web/test/e2e.cjs` 已尝试，启动失败、退出码 1，关键错误为：

```text
FAIL browserType.launch: Target page, context or browser has been closed
FATAL:base/apple/mach_port_rendezvous_mac.cc:159
bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.<pid>: Permission denied (1100)
```

**未验证**：真实浏览器内的默认演示一致性、真实 DOM/触控/滚动布局、390×844 与 1440×900 截图（未生成，目录已准备）、与 B1 真 BFF/真实测试 DSH 的端到端联调、<host> 的双地址监听。请监工在允许 Chromium 启动的执行环境运行已写好的 E2E；本轮不把 Node DOM double 的通过算作浏览器验收。

知识库只执行 reader boot；因工单仅授权本包与临时目录写入，未执行目录外的同步或记录投递。订阅额度查询接口不可用，未把积分或其它代理指标视作订阅剩余量。以上是技术验证事实，不等于 主人 的视觉或使用验收。

## r23（2026-11-17）

本节更新覆盖前文旧版登录与壳读取说明。只使用 Node 内置模块；A 路不启动 3392，不改旧 3290–3292 链路。

| 环境变量 | r23 规则 |
| --- | --- |
| `HUB_WEB_SHELL_DIR` | 可选，建议设为本目录 `shell-r23` 的绝对路径。设置后读 `index.html` 并按 mtime、大小与 inode 更新内存缓存；未设置时仍在启动时读旧 `shell/DSH-Hub.html`，旁挂资源路由不开放。 |
| `HUB_WEB_TRUST_TAILNET` | 只有精确值 `1` 开启设备免钥匙登录；默认关闭，仍只认钥匙或已有有效 cookie。 |
| `HUB_WEB_TRUSTED_FILE` | 可选的设备 IP 白名单文件，格式见 `trusted-devices.example.json`。必须是当前用户所有、0600 的普通文件，拒绝文件符号链接、无效 JSON 或大于 64 KiB 的文件；未配置则白名单为空。示例地址需按实际设备替换。 |
| `HUB_WEB_HOSTS` | 继续只认显式、非通配 IP；部署时设为 `127.0.0.1,<本机尾网地址>`（可写进 `config/hub-web.env`）。 |
| `HUB_WEB_PORT` / `BFF_URL` | r23 分别为 `3392` / `http://127.0.0.1:3391`，默认值仍保留旧版 `3292` / `3291`。 |

`hub-real.js` 每次请求检查 mtime，变化后重读，无需重启；首页和脚本都保持 `Cache-Control: no-store`。返回首页时只把 CSP meta 内的 `connect-src 'none'` 改成 `'self'`，并在 `</body>` 前注入同源脚本，不改磁盘壳文件。

所有旁挂资源都在认证之后开放，逐条正则匹配：`/manifest.webmanifest`、`/assets/icons/*.png`、`/pets/pack.json`、`/pets/<名字>/*.webp`、`/fonts/*.woff2`、`/fonts/fonts.css`、`/fonts/OFL-License.txt`、`/pets/CREDITS-pets.md`。宠物目录名字只许 `[a-z0-9_-]+`，资源文件名只许英文字母、数字、下划线、连字符及规定后缀。不开放其它文件或目录列表。原始路径中的 `..`、编码点／斜杠／反斜杠均拒绝，逐级 `lstat` 拒绝符号链接，打开后核对 inode 与最终路径仍在壳目录内。

资源按扩展名返回 MIME，以大小和 mtime 生成 ETag，支持 `If-None-Match` 的 304 以及 HEAD。pets/fonts 采用 `private, max-age=86400`；所有资源由文件流发送，不把宠物包读进内存缓存。

开启免钥匙登录时，只读取 `req.socket.remoteAddress`，去掉 `::ffff:` 前缀；不采用转发来源头。`127.0.0.1` 直接视为本机；CGNAT 段（`100.64` 起的 `/10`）或 `fd7a:115c:a1e0::/48` 地址经 Tailscale `whois --json` 查询来源与本机尾网地址的 `UserProfile.ID`，相同才可信，不写死邮箱。命令使用 `execFile` 参数数组，5 秒超时。已查明为不同用户时直接拒绝，查询失败／超时／解析失败才回退到白名单。成功或明确拒绝缓存 10 分钟，查询失败后的判定缓存 30 秒。

可信来源没有有效 cookie 时直接返回所请求页面并发 cookie；其余来源仍须走 `/?key=...`，无凭据返回 401。两种登录都发 `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`（30 天）的 cookie。免钥匙放行日志只记时间、socket IP 和 `whois`／`白名单`／`本机`，由 D 路启动脚本将标准输出重定向到 `run-r23/out.log`；不记录 cookie 或钥匙。

同步壳时，从仓库根运行：

```sh
bash packages/hub-web/ops/sync-shell.sh
```

脚本只从已验收的 `preview/art4/` 拷 `index.html`、`manifest.webmanifest`、`assets/`、`pets/`、`fonts/` 到 `shell-r23.next/`，`rsync -a --delete` 仅作用于新建暂存目录。旧的失败暂存先改名保留。必须通过 C 路 `ops/check-adapter-contract.mjs` 才切换；检查脚本不存在或检查失败时不碰当前壳。切换前将当前壳保留为 `shell-r23.prev-<时间>-<PID>/`，不删除备份；成功后打印首页 SHA256 前 8 位、文件数及总字节数。检查器收到暂存首页的绝对路径，避免调用目录歧义。同步不重启 hub-web；角色素材、字体及运行目录由包内 `.gitignore` 排除，不进入 git。

离线验证：

```sh
cd packages/hub-web
~/.local/bin/node --test test/server.test.mjs test/client.test.mjs
~/.local/bin/node --test test/*.test.mjs
```

新增测试用临时假壳、假脚本与注入 whois，不改 C 路脚本或真实密钥，不连接 DSH、不调用真实模型。任意来源的白名单／whois 登录用真实 HTTP handler 加 socket fixture 验证；回环 HTTP 请求另覆盖完整资源与 cookie 链路。真实 tailnet 设备身份、浏览器和 D 路 3392 运行实例仍需监工联调验收。


## r24（2026-11-17，执行者 C）

【Owner要求】来源：r24 公共工单与工单 C。此节覆盖上文同名 r23 行为。代码只改 hub-web；不改壳、不改真实 BFF/插件、不重启3392。

- 六助理会话新增 L3 审批信笺与派工时间线，采用 shell-r23 原有信笺、名牌、按钮、差异配色。审批按服务器结果结束，改稿提交一句意见；倒计时只显示剩余，不自行批准。
- `/bff/events` 全局 SSE 在任何页面保留一条；首页助理待批、角色“等你点头”、活动徽标来自真实 pending。活动弹层列待批并跳到发起会话；派工回报跳目标会话。
- 最近列表取真实会话按 updatedAt 排序，管家样例在后；打开助理默认最新服务器会话，菜单“新会话”开空白草稿。每助理三条 phrases 来自 presets，点击真发；空时隐藏。
- 每次发送的 idem 为 UUID，重试复用同号，BFF10分钟窗口内安全重试；有序列表跨段保号；管家聊天补轻样例标。
- 新设备 cookie 独立签名；反代每次注入稳定非密钥 X-Hub-Device 并丢弃客户端伪造头。BFF 的所有写请求必须有效 cookie + 同本站 Origin；Sec-Fetch-Site 若提供只能 same-origin。旧cookie在下一次GET升级；免钥匙设备也须先GET拿cookie才能写。

离线测试与服务：

```sh
node --test test/client.test.mjs test/server.test.mjs test/r23-server.test.mjs test/r24-server.test.mjs
node ops/check-adapter-contract.mjs shell-r23/index.html
node test/r24-preview.mjs
# <host> 用现有依赖，3592 通过 SSH 回环转发时：
HUB_R24_SHOTS=/绝对路径/shots node test/r24-browser.cjs
```

`test/mock-bff.mjs` 是本轮独立假 BFF，仅用回环3591、假卡、假派工和假回复；`test/r24-preview.mjs` 另起3592，不连接3391。预览中唯一登录常量 `r24-offline-web` 仅用于隔离假链路。做完终止该预览进程，3591/3592一起停止。测试临时文件保留在 test/scratch 或 test/r24-fixtures，不删除文件，不读取真实密钥，不下载依赖，不调用模型。

完整接口与降级说明见 `ADAPTER-CONTRACT.md`。浏览器截图为回归参考；真实 BFF联调、模拟器/真机验收与真实链路重启由监工负责。

## r26 · Tailscale Serve HTTPS（执行者 D，2026-11-17）

此节补充 r23/r24 的设备登录与来源校验。新增代码与启动参数已准备，真实 3392 未重启、Serve 映射未修改；模拟器 HTTPS / `window.isSecureContext` 验收由监工切换后执行。

| 环境变量 | 规则 |
| --- | --- |
| `HUB_WEB_SERVE_HOSTS` | 默认空（关闭 Serve 入口）；逗号分隔的规范 HTTPS authority，例 `hub.example.test:3443`。不带 scheme、路径、用户信息、查询或片段，域名使用小写，默认 443 省略端口。只在实际绑定 `127.0.0.1` 且 socket 来源为回环地址时接受；其它监听收到该 Host 一律 403。 |
| `HUB_WEB_SERVE_LOGINS` | 默认空（不允许 Serve 新设备登录）；逗号分隔，去掉两端空白，逐值精确匹配 Serve 注入的 `Tailscale-User-Login`。 |

`ops/r23-up.sh` 从 `$HUB_HOME/config/hub-web.env`（个人层，0600，不进仓库）读 `HUB_WEB_SERVE_HOSTS` 与 `HUB_WEB_SERVE_LOGINS`；登录名取 `tailscale status --json` 里 Self 对应的 LoginName。

Serve 请求无有效设备 cookie 时，必须有允许的登录名，否则 403、不发 cookie。允许时仍签发既有格式的独立设备 cookie，日志方式为 `tailnet-serve`；签名与 BFF 的稳定 `X-Hub-Device` 计算沿用原实现。Serve 签发的每个 cookie（含钥匙入口）均加 `Secure`，保留 HttpOnly、SameSite=Lax、Path=/ 和 30 天期限。已有有效设备 cookie 沿用原验证规则；旧 cookie 或钥匙不能绕过 Serve 新设备登录白名单。

Serve 的 BFF Origin 为 `https://<当前配置 Host>`，直连 BFF Origin 仍为 `http://<监听 IP>:<端口>`；HTTPS Origin 不在直连入口通用。所有写请求仍须先有有效设备 cookie 和同源 Origin；Sec-Fetch-Site 若存在必须为 same-origin。非 Serve 请求的三个 `Tailscale-User-*` 头不参与身份，也不转发 BFF；100.x 直连继续按原 whois/白名单判定，回环直连继续按原配置处理。不会采用 X-Forwarded-For/Host/Proto 来决定身份、Host 或 HTTPS。

新增离线验证（不启动真实 BFF/DSH，不调用模型）：

```sh
cd "$HOME/dsh-work/dsh-hub"
"$HOME/.local/bin/node" --test packages/hub-web/test/https-*.test.mjs
```

测试目录使用 `${HUB_HOME:-$HOME/dsh-work}/tmp/r26-D/`，只有回环随机端口和假 BFF；100.x 监听与非回环来源通过 socket fixture 运行真实 handler。新增 14 项通过，覆盖合法/非法身份、监听与来源限制、伪造头、Secure cookie、HTTPS/HTTP Origin、设备签名与旧 HTTP 回归。

全量旧单测在 `~/dsh-work/tmp/r26-D/regression/` 镜像运行，避免原测试向 C 负责的 `test/scratch/` 写入。TMPDIR 也指向本轮临时根。镜像中的 `ops/sync-shell.sh` 仅去掉 rsync 的删除选项（每轮本来先新建空暂存目录），原仓库脚本和旧测试均未修改。结果为 **55 项中 54 通过、1 失败**；改动前 server 的独立基线复跑为 **41 项中 40 通过、同一项失败**。失败是 `r23-sync.test.mjs` 的 fixture 未准备 `ops/check-secure-context.mjs`，报 MODULE_NOT_FOUND；它不在 D 的修改范围。日志保留在上述临时根的 `https-tests.tap`、`regression.tap` 与 `baseline-regression.tap`。不能据此声称全量单测全绿。

监工确认后，在 <host> 执行（D 未执行）：

```sh
cd "$HOME/dsh-work/dsh-hub"
bash packages/hub-web/ops/r23-up.sh restart-web
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=3443 http://127.0.0.1:3392
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

保留原 443→3082 和 13443→13443 映射。切换后从模拟器打开 `https://<本机尾网域名>:3443/`，核对免钥匙、Secure cookie、`window.isSecureContext === true`，再核对旧 HTTP 地址与异用户拒绝。HTTP 旧入口不具备 Secure Context 能力。仅撤销新映射的命令是 `Tailscale serve --https=3443 off`（使用上述完整 CLI 路径），不要执行全局 reset。源码备份、逐文件校验值和完整回滚步骤见本轮 `回执-D.md`。

待参数化的既有值：server 中 whois 查询本机的旧 IP、旧默认端口/BFF origin/Tailscale CLI 路径，以及 r23 启动脚本的旧 ROOT、地址与端口；本轮按独占范围保留。新增个人 Host/登录值集中在启动配置中，未写进服务器逻辑。
