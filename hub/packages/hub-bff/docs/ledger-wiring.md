# 事件账接线说明（给集成轮；本线没改任何主文件）

基线 `e7d183a`。下面行号按该基线。新模块：`lib/ledger.mjs`、`lib/ledger-legacy.mjs`、`lib/prices.mjs`、`lib/ledger-summary.mjs`、`lib/ledger-http.mjs`、`bin/ledger-backfill.mjs`。

## 1. 实时记 call / approval 行（BFF）
- `lib/dsh-client.mjs` `follow()` 里的 `translate=event=>{…}`（约第 244 行）拿到的是**内核原始事件**（含 `data.usage`）。在 `lastSeq=event.seq` 之后加一行：`opts.onRawEvent?.(event)`；`follow(id,{cards,onRawEvent})` 的参数里加 `onRawEvent`。
- `server.mjs` 两处 `client.follow(id,{cards:…})`（第 75、284 行）加 `onRawEvent: ev => ledger.recordEvent(ev,{sessionId:id,bot:store.get(id)?.bot}).catch(()=>{})`。`ledger = createLedger({dir:<账本根目录配置>,utcOffsetMinutes:<配置>})` 在 `createHandler` 参数里新增 `ledger`、`priceBook` 两项由 `startServer` 注入（目录、时区、价表路径都走配置，别写死）。
- 记账失败**不得影响聊天**，所以上面是 `.catch(()=>{})`；失败计数可另记日志（本线没做）。
- 注意：`follow` 的 `seq<=lastSeq` 已去重；账本自己也按 key 去重，双保险。

## 2. 断线重连补读
- 重连后对每个在跑会话调用 `ledger.catchUp({sessionId,fetchSince:async since=>(await client.records(id)).map(r=>r.event).filter(e=>since==null||e.seq>since),ctx:{bot}})`。`client.records(id)`（dsh-client.mjs 第 205 行）是整段历史翻页读取，不改。
- 已知边界：重启后补读起点若越过 `step/start` / `approval/asked`，对应行的 `durationMs` 或审批的“问了什么”会是 null（不是 0）。

## 3. 审批行（approvals.log → 事件账）
- 写入点：`lib/runtime.mjs` `audit(card,device)`（第 58–66 行）与 `hub-plugin/tickets.mjs` `appendApproval`（第 52–57 行，插件在内核进程里，只在“审批前判拒/unavailable”时写）。
- 改法：`audit` 里把写 `approvals.log` 的那段换成 `ledger.record({kind:'approval',key:`approval:${card.sessionId}:${card.id}`,tsMs:now,bot:card.bot,sessionId:card.sessionId,approvalId:card.id,tool:card.tool,target:card.path,outcome:card.status,device:device??null})`（card.id 即内核审批 id，见 runtime.mjs `context.id`）。同 key 的内核 `approval/decided` 事件行会被去重——BFF 先写所以保留 device。旧 `approvals.log` 先继续双写一个版本再停。
- 插件进程里的 `appendApproval`：它在另一个进程，没有内核审批 id。需要时用 `kind:'approval', id:<随机>` 走 `ledger.record`（key=`approval:id:<id>`），outcome=`unavailable`；多进程追加用 O_APPEND 单行写是安全的，但去重索引是各进程自己的，所以不要让两个进程记同一条。

## 4. 动作行（actions.log → 事件账）
- 写入点：`hub-plugin/tickets.mjs` `appendAction`（第 8–11 行），被 `hub-plugin/index.mjs` 第 103、106 行调用（L3-approved、L1）。改成 `ledger.record({kind:'action',id:randomUUID(),tsMs,bot,tool,target,level})`；插件已知 `policy.base+'/config'`，账本根目录由同一配置给。

## 5. 派活与变更
- 派活：`server.mjs` 第 137–150 行 `callLog.prepare/append`（CallLog）是派活外包的现有记录点；在派活结束回调 `hooks.onComplete`（第 86–90、~110 行）里记 `kind:'dispatch'`：`worker`、`wallMs`、`exitCode`、`tokens`（拿不到就 `null`，**别写 0**）。
- 变更：名册/装备/权限的修改入口在集成轮定好后统一调 `ledger.record({kind:'change',id,what,subject,detail,actor})`；本线只给了格式。

## 6. HTTP
- `server.mjs` 的 handler（第 201 行起）在路由 `/bff/...` 前加：`if (await ledgerHandlers.handle(request,response)) return;`。`ledgerHandlers = createLedgerHandlers({ledger,priceBook,utcOffsetMinutes})`。路径是 `GET /api/ledger?from=&to=`、`/api/ledger/session/<id>`、`/api/ledger/today?bot=`；如要放进 `/bff/` 前缀下，在调用前把 `request.url` 去掉前缀即可。需要鉴权的话，按现有 handler 的鉴权位置放在鉴权之后。
- `ledger` 与 handlers 的 utcOffsetMinutes 必须一致。
- `package.json` 的 `test` 脚本里追加 `test/ledger.test.mjs test/ledger-summary.test.mjs`。

## 7. 旧记录一次性导入
`importLegacy(ledger,{approvalsText,actionsText})`（`lib/ledger-legacy.mjs`）只吃文本，不读也不改旧文件；由集成轮的一次性脚本自己读 `approvals.log`、`actions.log` 传入。每行按行内容 sha1 去重，可重复跑。旧文件没有会话与工单，导入行这两项是 null。
