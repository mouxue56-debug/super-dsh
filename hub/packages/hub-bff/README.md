# hub-bff ·

源码正本：<host> `~/dsh-work/dsh-hub/packages/hub-bff/`，分支 `r24-act`。只用 Node 内置模块，不安装依赖。主线、旧 3290–3292、静态 8912、正在使用的 3390–3392 均不由 B 路起停。下列运行步骤交监工执行。

连接为 `/connect?token=…&interactions=answer` → HttpOnly cookie → `/api/remote.mux` → 同 Peer 的 `$events` ready → `/api/$events/result` 应答。令牌和 cookie 仅在运行进程内使用，不输出。所有 BFF 路由先核验 `X-Hub-Bff-Key`，不放行 CORS；审批回答还必须有 `X-Hub-Device`。

## 环境变量与切换

| 变量 | 默认 / r23 兼容值 |
| --- | --- |
| `DSH_URL` | 默认 `http://127.0.0.1:3290`；监工现有 r23 脚本设为 3390；B 联调只用 3490 |
| `DSH_TOKEN_FILE` | 必填的 0600 凭据路径，由原有运行读取器使用；执行者不打印内容 |
| `BFF_KEY_FILE` | 默认 `run/bff.key`；r23 脚本设为 `run-r23/bff.key` |
| `HOST` / `BFF_HOST` | 只允许 `127.0.0.1` |
| `PORT` / `BFF_PORT` | 默认 3291；r23 为 3391，B 联调为 3491 |
| `HUB_BFF_STORE` | 默认 `run/store.json`；r23 原值 `run-r23/store.json` |
| `HUB_BFF_CALL_LOG` | 默认 `run/calls.log`；r23 原值 `run-r23/calls.log` |
| `HUB_BOTS_DIR` | 默认 `$HUB_HOME/bots`（`HUB_HOME` 缺省为 `~/dsh-work`） |
| `HUB_CONFIG_DIR` | **新增可选**；默认 `~/dsh-work/config`，放 `approvals.log`、`bot-status.json`、`bff-heartbeat.json` |
| `HUB_TICKETS_DIR` | **新增可选**；默认 `~/dsh-work/tickets` |
| `HUB_BFF_TEST_TMP` | 离线夹具目录，默认包内 `test/.tmp/` |

现有 r23 环境变量可原样使用；两个新增变量的默认即公共契约路径。短语文件固定读取 `packages/devinst/presets-r24.phrases.json`，缺失/损坏时各 bot 返回 `[]`，不改该文件。`health.api` 为兼容已有消费者保留 `r23`，不把参考源码版本冒充运行版本。

监工核对插件配置和真实链路发布授权、备份 `run-r23/store.json` 后，可使用现有带 PID/命令/cwd/端口身份校验的命令，只重启 BFF：

```bash
ssh <host> 'HUB_CONFIG_DIR="$HOME/dsh-work/config" HUB_TICKETS_DIR="$HOME/dsh-work/tickets" "$HOME/dsh-work/dsh-hub/packages/hub-web/ops/r23-up.sh" restart-bff'
```

B 路未执行此命令。需要隔离演练时，store/calls/config/tickets 全部指定到包内 `run-r24test/`；该目录只留测试产物且已忽略版本管理。**不得用测试脚本指向真实模型或生产端口。**

## 接口

| 方法 / 路径 | 行为 |
| --- | --- |
| `GET /bff/health` | 只读连接与 modelCatalog，保留 `{ok,dsh,model?,api:'r23'}`，追加下述全部心跳字段 |
| `GET /bff/presets` | 六助理固定顺序，原 bot/preset/name/cwd 加 `phrases`（最多三条） |
| `GET /bff/status` | 原 running/runningSessionId/unread；每 bot 加 pending、delegated，顶层 pendingTotal |
| `GET /bff/events` | 全局 SSE；初始 status、后续 status/card，15 秒心跳，慢消费者关闭 |
| `GET /bff/sessions?bot=…` | 只读本 BFF 持久清单，不激活未知上游会话 |
| `POST /bff/sessions` | 指定 bot 的 preset/cwd 建会话，保存真实 sessionId |
| `GET /bff/sessions/:id/history` | 分页 session/events 重建用户/助理文本及工具元数据，保留原始 seq/可信 ts，排除内部上下文 |
| `POST /bff/sessions/:id/messages` | `{text,idem?}` 或 `Idempotency-Key`；sessionId+号在 10 分钟内去重；首次 202，重复 200 accepted/requestId/duplicate |
| `GET /bff/sessions/:id/stream` | 原 state/delta/message/done/error，另推 tool 与本会话 card，快照正文不重复推送 |
| `POST /bff/sessions/:id/cancel` | 只承诺取消接纳，不重放 prompt |
| `POST /bff/sessions/:id/read` | 未读归零，保留 running |
| `GET /bff/sessions/:id/cards` | 审批和派活卡（含结束卡），按 createdAt 升序 |
| `GET /bff/approvals` | 仅 pending 审批卡 |
| `POST /bff/delegations/:ticketId/continue` | 空对象；必须带设备；仅步数上限失败工单；200含card/continuedBy/continuation，同张重复409 |
| `POST /bff/approvals/:id/answer` | approve/reject/revise；缺设备 400，不存在 404，已答/超时 409 already-answered；note ≤500 字 |

所有清单外 sessionId 均先返回 404，不打开上游资源。所有消息只发一次；接纳回执丢失也不自动重试。幂等号在上游发送前持久保留，同号并发复用同一个任务；尚未送上游的忙碌等前置失败释放号码。

## 审批与持久化

原因串严格解析 `HUBAPPROVAL1 ` + 单行 JSON，核验 v/bot/level/path/tool/action/chars/preview；缺字段、bot 与 BFF 清单不符、sessionId 不符、实际 toolName 不符均拒绝。卡的 bot 取原因串，再对服务端会话清单核验。

官方 waterfall 请求不含 ApprovalRequestId。BFF 用该 agentId 对应会话的最近 200 个 session/events，精确匹配尚未 decided 的 approval/asked（toolName/callId/reason），取得内核 ID；取不到则仅留 `unavailable:<eventId>` 诊断卡，绝不开放批准。这是保守检索上限，超出窗口会拒绝。

最近 15 分钟收到有效设备头才算在场，仅写入 devicePresent 信息；无设备或手机锁屏仍正常等待。BFF审批通道在线时等待满 10 分钟自动 timeout/rejected；通道失效继续立即拒绝。单卡先同步抢占状态，再异步落盘，并发只允许一个回答成功。approve 映射 allowed-once；其余映射 rejected。内核取消/连接断开结束 pending 卡。user-questions/request 和未知 waterfall 直接 next，不挂起。

每次应答追加 `config/approvals.log`（ISO、bot、tool、path、结果、设备），不记正文，0600。卡/会话/幂等号在同一 store，0600 临时写后 rename；存储失败只能拒绝，不能把未落盘的允许发给内核。BFF 重启把遗留 pending 结束为 unavailable，running 归 false，保留历史卡及近 10 分钟幂等号。损坏清单保全为 `.corrupt-时间`，不删除。

revise 先拒绝原工具，再在 BFF 按会话排队 `（改一下）<note>`；上一回合结束后以正常 user prompt、mode=queue 接纳，并在 calls.log 第五列记 revise。这个待发队列在内存中，BFF 在发送前重启可能丢失待发改稿；卡及审批结果仍保留。普通消息维持一会话同一时刻只接纳一轮的既有行为。

status 每次变化和查询时把六助理的 running/pending/delegated 原子写入 config/bot-status.json，供插件只读。

## B2：审批通道心跳

初始化时与此后每 5 秒，BFF 将同一份状态写入 `${HUB_CONFIG_DIR}/bff-heartbeat.json`；同目录临时文件以 0600 写入、sync 后 rename，覆盖既有文件也保持 0600。连接就绪、断线、订阅失败以及有效设备请求会额外立即触发写入，不等待下个周期。所有心跳写入串行，退出前的 false 不会被旧的 true 覆盖。

```json
{"v":1,"ts":1794900000000,"pid":12345,"dshConnected":true,"answering":true,"devicePresent":true,"deviceLastSeen":1794900000000}
```

- `v` 为格式版本 1；`ts` 为本次快照的 Unix 毫秒时间；`pid` 为当前 BFF 进程 PID。
- `dshConnected` 只有 WebSocket 已认证且同 Peer 的 `$events` 已收到有效 ready 才为 true；刚打开 WebSocket 时仍为 false。
- `answering` 还要求已通过 `interactions=answer` 建立审批订阅、处理循环有效且 BFF 未进入关闭流程。`interactions:false` 的离线夹具始终为 false。无设备时它可以为 true，由 `devicePresent` 独立表达设备条件。
- `devicePresent` 表示最近 15 分钟内收到过带合法 `X-Hub-Device` 的已鉴权 BFF 请求；`deviceLastSeen` 是最近一次有效设备请求的 Unix 毫秒时间，从未出现则 null，过期后保留原时间。
- `GET /bff/health` 顶层追加完全相同的七个字段。旧的 `ok` / `dsh.connected` 保留原连接语义，审批是否可应答要看新增字段。

SIGINT/SIGTERM 复用正常关闭路径：先停止周期、写 `answering:false`，再清理派活/会话和连接。心跳落盘失败记录固定错误码 `HUB_BFF_HEARTBEAT_FAILURE`；插件仍需按心跳过期拒绝。SIGKILL、崩溃、掉电不能写最终状态，也依赖插件检查 `ts`。本包只提供心跳，插件轮询与内核拒绝由 A 路负责，未在 B2 冒充端到端已验收。

## 派活

每两秒扫描 tickets/working 的标准 delegation Markdown；只处理 creator=chief、来源会话确属 chief、目标助理有效的严格格式。陌生文件、符号链接、非法 front matter 保留不动。对同一目标只跑一个派活，其余 queuePos 从 1 开始；目标有其他已知 running 会话也先排队。

开跑建目标 preset/cwd 会话，标题 `派工：<任务前16字>`，写 toSession/status/进度；第一句 `【首席派来的活 · 工单 <id>】<task>`，calls.log 第五列 delegate。首席会话只收派工卡，不自动补发模型消息。

计步采用有序持久 `step/start`，每次模型生成对应一条；按 seq 去重，不拿文本 delta 或一次工具结果算步数。发现第 9 个 step/start 立即请求 session/cancel，内部标记 `超过 8 步自动停`，对外使用下述完成件数原因，移 failed。远端事件到达前第 9 步可能已经开始，BFF 无法提供内核级“第9次请求绝不发出”的硬保证；严格8次预算还需内核 pre-step 门禁，由监工确认。

正常 turn/end completed 取最后一条 assistant 文本，去 Markdown、链接只留文字、换行压空格并限400个Unicode字符，写回报、移 done；错误/取消移 failed。目标会话完成累计一次未读。重启遇到 running 工单不重发，尝试取消旧会话后标失败。工单先同目录临时文件再 rename，结束再 rename 移栏，不删除文件。

## 源码依据

以下均为 本地检出的 DSH 源码（`<DSH 源码根>`） 的 **0.2.2-rc.2** 只读源码；工单声明实际实例 rc.1，差异以联调为准。

| 依据 | 文件与行号 |
| --- | --- |
| `$events` / `$events/result` / ready / waterfall / outcome 协议 | `packages/api/gateway/src/stream-protocol.ts:10,13,35,52,91,106` |
| 同 Peer 结果校验、ready、事件下发与处理 | `packages/api/gateway/src/index.ts:497,591,677,710` |
| interactions=answer 门禁 | 同文件 `:1243` |
| 审批和问答均 waterfall | `packages/api/remotes/src/remote-events.ts:29,57` |
| 审批请求没有 id、合法 outcome | `packages/interaction/user-approval/src/types.ts:36,79` |
| 内核审计 ID 与最终决定、无人应答 fallback | `packages/interaction/user-approval/src/index.ts:242,252,259,307` |
| 官方 UI 监听与 next | `packages/client/ui-approval/src/client/index.ts:50,63,124` |
| 官方回传完整 clientId/eventId/outcome | `packages/api/gateway/src/client/remote-events.ts:187,211,218` |
| step/start 与 turn/end 语义 | `packages/core/session/src/types.ts:207,303,305` |
| 会话 create/events/follow/prompt/cancel/catalog | `packages/api/session-controller/src/index.ts:306,543,610,467,519,343` |

## 验证与未通过项

在 <host> Node v24.22.1 运行：

```bash
cd ~/dsh-work/dsh-hub/packages/hub-bff
~/.local/bin/node --test --test-reporter=tap test/adapter.contract.test.js test/protocol.test.mjs test/r23.contract.test.mjs test/r24.contract.test.mjs test/r24.heartbeat.test.mjs test/r24.b3.test.mjs
```

最终统计见本轮 `回执-B.md`。显式列测试文件，排除需要隔离实例的 live 脚本。原有通用 HubAdapter 场景中28项继续跳过；r24 新接口以独立契约测试覆盖，不把跳过当通过。

`test/r24-live.mjs` 只接工单 A 的 3490 假模型，BFF 起3491，所有 BFF 运行数据放 run-r24test；认证地址只在进程内使用。`test/r24-live-diagnose.mjs` 只核对本轮测试会话并取消本轮悬挂测试。真实模型调用为0。

实际内核已核验 approve→allowed-once、reject→rejected，且卡ID等于 approval/asked 的真实ID。**批准后的共享区 write 被 FS_SANDBOX_DENIED 拦截**，因此共享写入端到端未通过；B 路没有修改 A 的插件/预设或扩大沙箱。无应答者测试未观测到预期 unavailable，后续审计为 cancelled，不能把参考源码 fallback 当作实例已验证行为。实际内核 revise、10分钟等待、8步截停与派活归档尚未联调，离线夹具已覆盖。

## B3：工具、卡片坐标与审批理由

`lib/timeline.mjs` 以事件为依据，history 与 stream 复用投影逻辑。所有可用 `seq` 都是当前 DSH 会话的原始 `event.seq`；`ts` 只取 `event.time` 的有效毫秒或 ISO 字符串。缺时间不补会话 updatedAt，不另起计数器。消息 `id=String(event.seq)`，老记录缺 seq 时只复用已有 message.id。

- 消息只提取 `user/message` 的真实 user 内容和 `assistant/message.data.message.content` 的 text。assistant 带 `tools` 数组；reasoning 与内部 user 上下文不输出。
- 工具 `id/name/seq/ts` 来自 `tool/call.data.callId/name` 及该事件坐标；只从参数提取 `file_path/path`，不输出参数正文。即使结果与审批后来发生，工具始终沿用调用的坐标。
- `approval/asked.data.callId/id` 关联工具，标记 L3/pending；`approval/decided.data.outcome` 更新 approved/rejected/unavailable。批准只表示获准，不代表执行成功。
- 只有 `tool/result.data.message.isError === false` 才为 ok；true 或缺失都不能当成功。成功不传结果原文，只识别已知写工具最后一个 content 中插件的 `（已写入 …，L1 已记录）`，转换成 L1 与固定短摘要。失败只取结果文本第一句（最多80字符），优先采用插件追加的中文拒绝/通道原因。存储卡可把内核笼统 rejected 补成 timeout/revised/unavailable。
- stream 的 `message` 透传 id/seq/ts/tools；新增 `event: tool` 推单个工具元数据，用同 id 更新。回放中重复 seq 不再产生第二条工具或第二次计步。
- 审批卡 `seq` 直接取精确匹配的 approval/asked.seq；createdAt 取该事件可信时间。`why` 取同一步骤里这次 tool-call 之前的最后一段可见 text 的末句，缺失再退到同轮上一条 assistant 文本，最多80字符；不借跨轮文本，没有就空串。状态更新不改变 seq/createdAt/why。
- 派工卡先从首席成功 tool/result 中精确匹配“工单 <id>”，再按 toolCallId 回查 delegate_to_bot 的 tool/call.seq。找到时沿用该调用的时间；无法精确匹配时只沿用工单 createdAt，seq 留空，不猜测。旧卡不回填编造的序号。插件建文件到产生 tool/result 之间若恰好被扫描，也会走此时间回退；这是明确的兼容限制。
- 插件 hub-plugin/notice 的“超过 8 步自动停”与 turn/end blocked 结合后，卡和工单均显示中文原因；即使缺 notice，blocked 且已观察到8步时仍按上限处理。G1起改用实际成功交付件数，不再把模型步数当交付件数。更早的 blocked 为“派活被权限规则拦下”，aborted/cancelled 为“派活已取消”，错误为“派活执行出错”。BFF 第9条 step/start 的旧兜底保留，不能代替插件 pre-step 的硬预算门。

## B3：自动重连与隔离验证

服务启动时启用单一 Reconnector，断线后按 1/2/4/8/16/30 秒退避，无限重试；每次 ±20% 抖动，实际等待也封顶30秒，成功后重置。health/普通请求不能绕过等待提前连接，任何用户消息或派工首句均不自动重发。SIGINT/SIGTERM 停止重试并唤醒/关闭等待中的订阅。

每次连接重新鉴权并订阅同 Peer 的 `$events`，必须收到 ready 才恢复 dshConnected/answering；断开立即失败关闭、结束 pending 审批为 unavailable 并追加审批审计。旧 Peer 的延迟 close/failure/异步应答不影响新连接，也不把旧批准回传到新 Peer。

已有后台会话与页面 SSE 等待连接恢复后重新打开 session/follow；按断线前 seq 补读新快照中的漏事件，窗口不足时只读 session/events 分页补全（沿用100页上限）。页面 SSE 同时再次推送快照中的 activeAttempt partial，补回尚未形成持久消息的文字，已包含的 chunk 不重复追加。步骤去重、工具更新与 turn/end 均恢复处理；运行中的派工继续跟随，排队派工在连接恢复后恢复扫描。全局 `/bff/events` 在连接就绪状态变化时推一次 status。连接断开期间保留运行会话状态，等待内核真实的终态，不把暂时断线冒充派活完成。

离线专项覆盖真实样本、工具结果、why、坐标、派工终态、退避、断线拒绝、旧 Peer 隔离、跟随补读与队列恢复。额外回环测试使用 Node 内置 HTTP/WebSocket 假 DSH（随机空闲回环端口）与 BFF 3491；它实际停止/重启自建假服务，经历一次真实连接失败后验证恢复、审计、SSE与消息不重发：

```sh
~/.local/bin/node --test --test-reporter=tap test/r24.b3.loopback.test.mjs
```

回环测试凭据仅为测试自己写入的固定假值，运行数据在 test/.tmp，不读真实凭据、不调用真实 DSH 或模型。前述 B/B2 的旧链路端到端缺口是其历史验证状态；本次只补 BFF 源码及假环境证据，不把它们宣布为已完成真实验收。


## G1：终验收尾（来源：G1工单，Fable 定，Owner 未确认逐项实现）

- 审批不再以设备是否在场作拒绝门；插件只核验 v、ts≤15秒、dshConnected、answering。设备字段保留，正常10分钟等待、插件2秒复查及10分30秒兜底均保留。
- 派工步骤不再是“第几步”；每个模型步骤先显示“在写回复”，工具执行中/获批仍不标成功，真实结果到达后更新为“读了 notes/x.md”“写了 drafts/x.md”“列了 drafts/”“建了一张工单”“被拒：…”等。多工具同一步以分号相连，晚到结果按callId回到原步骤；保留派出/开始/完成。
- 上限原因、lastText和工单回报一致：`做了 8 步还没做完，按规矩先停了：已完成 N 件，剩 M 件`；无法核验总量则结尾为“剩下的没做”。N只数严格isError=false的write/edit与ticket_create，文件经真实路径（可解析时）、NFC与大小写归一后去重，同文件反复修改只算一件；读取、批准、失败及模型自称完成均不算。仅任务开头明确写出阿拉伯数字的“创建/写/生成 N 个文件/文档/工单”才推M，其余保守未知。卡补充`failureKind:'step-limit'`、`completed`、`remaining`（未知null）。插件原notice仍是内部标记。
- `POST /bff/delegations/:ticketId/continue`须鉴权和合法X-Hub-Device、空对象；原卡必须failed且原因可核验为步数上限，原failed工单须是非链接普通文件，身份须与首席来源及目标一致。只新建一张同目标、同首席来源的queued工单，原文逐字接在固定续做前缀后。返回`{ok:true,card:<原卡>,continuedBy:<新id>,continuation:<新卡>}`。原卡continuedBy持久化；并发/重启后重复都是409，非上限/未结束也是409，不存在404，坏输入或缺设备400。用户显式点击才续，不自动续。
- 续单先写不被扫描的`.新id.continue`，持久保存原卡continuedBy，再rename到working；中断后普通扫描补完晋升，避免跨store与工单写入的间隙丢单或重复。实际运行仍沿用同助理排队、8步上限与calls.log的delegate备注；断线不重发。续单没有首席tool/call来源seq，沿用可信createdAt，不伪造seq。
- 取消/停止回合（aborted/cancelled/canceled/interrupted/stopped）的会话lastText为“已停止”，错误仍“出错了”；派工卡保留具体中文失败原因。摘要在新生成及旧store加载时均去Markdown、压空白并限400个Unicode字符。

离线默认test已含`test/r24.g1.test.mjs`；旧断言仅随G1裁定更新，不移除用例。`r24.b3.loopback.test.mjs`继续覆盖原重连场景，并追加真实HTTP并发续做、队列派出、中文步骤/纯文字摘要SSE与delegate审计。监工先重启DSH使插件生效，再重启BFF；G1只交付源码和假环境证据，不执行现用链路重启。
