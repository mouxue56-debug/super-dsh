# 事件账行格式（v1）

一天一个文件：`<根目录>/events/YYYY-MM-DD.jsonl`（日界按创建账本时传入的 `utcOffsetMinutes`，默认 0）。一行一个 JSON，单行原子追加（O_APPEND 单次 write，0600；目录 0700）。

## 公共字段（每行都有）
- `v`: 1
- `kind`: `call` | `approval` | `action` | `change` | `dispatch`
- `ts`: ISO 时间串；`tsMs`: 毫秒整数
- `bot`: 助理标识（字符串，可 null）。代码里不认识任何具体助理名，全由调用方给。
- `sessionId`: 字符串或 null
- `ticket`: 关联工单号，字符串或 null
- `key`: 去重键，字符串。同一个 key 不重复记。有内核序号的事件：`<kind>:<sessionId>:<seq>`（approval 行例外：有内核审批 id 时用 `approval:<sessionId>:<approvalId>`，这样 BFF 自己记的审批行与内核 decided 事件行是同一条，先到先得）；旧记录导入：`legacy:<approval|action>:<行内容 sha1>`；其他调用方自己给 `id` 则 `<kind>:id:<id>`。
- `backfill`: 仅回补/导入的行写 `true`，实时写入的行没有这个字段

## kind = call（一次模型调用，来源：内核 `assistant/message` 事件）
- `seq`: 内核事件序号（整数）
- `channel`: 计费渠道，取事件 `data.message.source.provider`（字符串或 null）
- `model`: 取 `data.message.source.model`（字符串或 null）
- `tokens`: `{input, cacheRead, cacheWrite, output, reasoning}`，每项是非负整数或 **null**（事件里没有这个字段就是 null，不写 0——null 表示「未上报」）。映射：`data.usage.inputTokens`→input，`cacheReadTokens`→cacheRead，`cacheWriteTokens`→cacheWrite，`outputTokens`→output，`reasoningTokens`→reasoning。
- `totalTokens`: 取 `data.usage.totalTokens`，没有则 null（不自行相加）
- `durationMs`: 同一 turn/step 的 `step/start` 事件时间到本 `assistant/message` 事件时间之差；找不到对应 step/start 则 null
- `turn`, `step`: 取 `data.turn`、`data.step`，没有为 null
- 注意：fixture 里 usage 在 `data.usage`，不在事件顶层。

## kind = approval（一次审批已有结论）
- `seq`: 结论事件（`approval/decided`）的序号
- `approvalId`: 内核审批 id
- `tool`, `level`, `action`（问了什么，人话）, `target`（路径或对象）, `device`: 能拿到就填，拿不到 null。`approval/asked` 的 `data.reason` 以 `HUBAPPROVAL1 ` 开头，后面是 JSON，里面有 bot、level、action、tool、path。
- `outcome`: 字符串，如 `approved`/`rejected`/`unavailable`，取 `approval/decided` 的 `data.outcome`，旧记录取日志里的结果列
- `askedTsMs`: 问的时间，未知 null

## kind = action（一次留痕的动作）
- `tool`, `target`, `level`；旧 actions.log 一行对应一条

## kind = change（名册/装备/权限的一次变更）
- `what`: `roster` | `equipment` | `permission`；`subject`: 谁或什么；`detail`: 对象（变更内容，调用方给）；`actor`: 谁改的（可 null）

## kind = dispatch（一次派活/外包）
- `worker`: 工人名；`wallMs`: 墙钟毫秒（可 null）；`exitCode`: 整数或 null
- `tokens`: 同 call 的五项结构，**拿不到就整个写 null，或各项 null，绝不写 0**
- `parentSessionId`、`workerModel`: 可 null
