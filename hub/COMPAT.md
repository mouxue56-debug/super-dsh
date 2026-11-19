# 内核兼容说明（COMPAT）

对象：DeepSeek Harness 内核 0.2.2-rc.1（桌面版包内 `package.json` 与 `runtime.json` 均标 0.2.2-rc.1）。
状态： 写成。

## 怎么读这页
- 方法：只读解开桌面应用包里的 `app.asar`（不改应用、不碰任何用户配置目录），对照我们每处用法逐条读源码。
  **全是静态阅读，没有在任何实例上跑过**；「有」只表示代码在包里、形状与我们的用法对得上。
- 结果记号：`对`＝包内有且与我们用法一致；`冲突`＝包内有但与我们现在的用法有出入；`？`＝没核到，不推测。
- 位置缩写（都在包内 `dsh/node_modules/@deepseek-ai/` 下）：
  - SC＝`dsh-api-session-controller/lib/typert.host.js`（括号里是行号）；SCI＝同包 `lib/index.js`
  - GW＝`dsh-api-gateway/lib/index.js`；CC＝`dsh-client-connection/lib/index.js`
  - LOOP＝`dsh-agent-loop/lib/index.js`；TP＝`dsh-tools/lib/pipeline.js`；TI＝`dsh-tools/lib/index.js`
  - SES＝`dsh-session/lib/index.js`；PER＝`dsh-session-persistence/lib/index.js`
  - UA＝`dsh-user-approval/lib/index.js`；AI＝`dsh-agent-instructions`；SKF＝`dsh-skill-filesystem/lib/index.js`
- 仓库文件缩写：client＝`hub-bff/lib/dsh-client.mjs`；plugin＝`hub-plugin/index.mjs`；ledger＝`hub-bff/lib/ledger.mjs`；
  timeline＝`hub-bff/lib/timeline.mjs`；msel＝`hub-bff/lib/model-select.mjs`；srv＝`hub-bff/server.mjs`。
- 探针：`packages/hub-plugin/ops/kernel-contract-probe.mjs`（用法见文末）。「探针 P04」等是它的项目编号。

## 先看这四条（静态读出的、会出事的地方）
1. **`hub-plugin/notice` 事件可能让会话以后读不回来（严重，要先定）。** plugin 在被派会话超过 8 步时调
   `agent.session.append('hub-plugin/notice', …)`，client 也读它。但内核重新载入已存会话时，
   凡是「本版不认识、又没标 `ignorable: true`」的事件类型一律拒绝载入（PER `validateStoredEvents`，第 182 行起）。
   公开的 `append` 不能给事件打 `ignorable`（SES `append`，第 1524 行：只带 `sourceEventSeqs`、`surfaceOp`），
   而插件专用记录入口 `appendPluginRecord` 的说明写明只许内核自己的实验包调用。
   → 上线前必须在测试实例上验：让一个被派会话超 8 步 → 重启内核 → 再打开该会话。验不过就把这条提示改成
   已知事件类型或只走 BFF 一侧的记录，别写进会话日志。
2. **家规（全家共用 `AGENTS.md`）按现在的装法进不了指令链。** 预设配 `projectRootMarkers: [AGENTS.md]`，而内核
   按「从会话目录往上找第一个含标记文件的目录」定项目根（AI `findProjectRoot`，第 649 行）。助理目录自己就有
   `AGENTS.md`，项目根就是助理目录本身，上一层运行目录根的 `AGENTS.md` 不在链里。内核另有「用户全局链」：
   `$DSH_HOME/AGENTS.md`、再 `<agentsHome>/AGENTS.md`（AI README「What the agent gets」），这才是放全家共用规矩的地方。
3. **手册目录对不上。** 安装脚本把手册装到 `bots/<id>/skills/<名>/SKILL.md`；内核扫的是
   `<项目根>/.dsh/skills`、`<项目根>/.agents/skills`、配置里的 `customSkillDirs`、`$DSH_HOME/skills`、
   `<agentsHome>/skills`（SKF `roots`，第 160–197 行）。项目根＝往上找 `.git`，没有就是会话目录本身。
   所以 `bots/<id>/skills` 不会被扫到；要么装到 `bots/<id>/.agents/skills`，要么配 `customSkillDirs`（全局的，不分助理）。
4. **选模型：内核会改全局默认，我们“还原”的那两个钩子没接。** `session/selectModel` 的说明写着
   「选会话级模型，并在后台保存为默认」（SC 2480）。msel 会调 `kernel.restoreDefault`、`kernel.discardSession`，
   但 srv 第 286–287 行给的 `kernel` 只有 `modelCatalog`、`createSession`、`selectModel`——这两个钩子不存在，
   现在等于没还原、选失败的空会话也没丢。msel 自己会量出 `defaultDrift` 并报出来，所以不会悄悄错，但要知道。

## 一、远程协议（后端 ↔ 内核）
| 编号 | 依赖点 | 谁在用 | rc.1 静态核对 | 上线怎么实测 |
|---|---|---|---|---|
| R01 | `GET /connect?token=&interactions=answer\|none` → 302 到 `./api/remote.mux` 加 Set-Cookie | client、探针 | 对。CC 507–535：只认 `answer`/`none`、令牌参数必须恰好一个。令牌在查询串里是内核协议本身的要求 | 探针 P01 |
| R02 | WebSocket 升级 `/api/remote.mux`，帧 `open/cancel/item/end/error` | client、探针 | 对（路径）。GW 141 与 `dsh-api-gateway/lib/types/stream-protocol.js:4`。帧的 JSON 形状我没逐字核 | 探针 P02 |
| R03 | 一次性 RPC：`POST /api/<端点>`，`{type:'client-request',rpcId,method,payload:{args}}` → `server-response` | client、探针 | 对。CC 631–645 信封 schema；参数名按端点形参名（如 `_request`、`request`） | 探针 P03 |
| R04 | `session/list`，参数 `{_request:{}}`，取 `items[].sessionId/updatedAt/projections.values.title` | client | 对。SC 2133、680–745。`title` 可为 `null`（client 已当「新会话」）；请求支持 `cursor`，client 只取第一页。列表含子代理会话（`origin:'subagent'`） | 探针 P04；会话多了看是否分页 |
| R05 | `session/create`，`{request:{cwd,agentPreset}}` → `{sessionId}` | client、srv | 对。SC 1987；`agentPreset` 缺省用配置的默认预设 | 探针 S01（`--with-session`） |
| R06 | `session/rename` `{request:{sessionId,title}}` | client | 对。SC 2415，返回 `{title,seq}` | 探针 S02 |
| R07 | `session/prompt` `{request:{sessionId,requestId,mode:'queue',content}}` → `{accepted:true}` | client | 对。SC 2382；`mode` 只有 `queue`/`steer` | 探针 S06 |
| R08 | `session/cancel` `{request:{sessionId}}` → `{accepted}` | client | 对。SC 1923；返回值类型写死 `true`。会话空闲时取消的行为没核 | 探针 S08 |
| R09 | `session/events` 翻页：`address`、`maxMessages`、`beforeSeq`、`throughSeq` → `{cursor,records,hasMore}` | client（`records`、审批上下文） | 对。SC 2019；记录是 `{type:'event',event:{type,seq,time,data,…}}` | 探针 S03 |
| R10 | `session/follow` 流：首帧 `snapshot`，之后 `event` 与 `assistant-stream` 帧 | client（`follow`） | 部分。请求字段 `address/assistantStream/maxMessages` 对（SC 2052）；首帧 `snapshot` 对（SCI 2509）；两种后续帧名在 SCI 1233、1678；帧内部字段（`activeAttempt`、`nextIndex`、`chunk.text-delta`）的类型被生成器截掉，**没核到** | 探针 S04 只验首帧；流式增量要在手机上看一次 |
| R11 | `session/modelCatalog` → `default{provider,model}`、`groups[{id,models[{id,name}]}]`、`failures[{id,message}]` | client、msel、srv | 对。SC 880–916。多出 `routableProviders` 我们没用 | 探针 P05 |
| R12 | `session/selectModel` `{request:{sessionId,provider,model,reasoningEffort?}}` → `{selected}` | client、msel | 对。SC 2480–2506。**但见上面第 4 条（改全局默认）** | 探针 S05（会报默认有没有被改） |
| R13 | `$events` 流（要 `interactions=answer`）：首帧 `ready{clientId}`，之后 `waterfall{event,eventId,agentId,request}`、`emit`、`cancel` | client | 对。GW 1033–1060、1121、1182；只有 owner 类 Peer 能答（GW 998–1003） | 探针 P06；真实审批卡要在手机上点一次 |
| R14 | `$events/result` `{clientId,eventId,outcome}`，`outcome` 为 `next`/`result`/`rejected` | client | 对。GW 150–180 的键是严格的，多一个键就拒（client 现在正好三个键） | 手机上点批准、点拒绝各一次 |
| R15 | 审批结局取值：我们只回 `allowed-once` 或 `rejected` | client | 对。TP 632–660 另认 `cancelled`、`unavailable`，别的值当拒绝 | 同上 |

## 二、会话事件（我们读的字段）
| 编号 | 依赖点 | 谁在用 | rc.1 静态核对 | 上线怎么实测 |
|---|---|---|---|---|
| E01 | `assistant/message`：`data.usage.{input,output,cacheRead,cacheWrite,reasoning}Tokens`、`data.message.source.{provider,model}`、`turn`、`step` | ledger | 对。LOOP 949–955；字段名见 `dsh-llm/lib/typert.host.js:632` 的 `TokenUsage`。`totalTokens`、缓存、推理三项**可选**，没有就记空 | 探针 S07 查三个必有项；事件账页面看一行真数 |
| E02 | `turn/start{turn}`、`step/start{turn,step}`、`turn/end{turn,reason{kind}}` | client、ledger | 对。LOOP 731、757、819。`reason.kind` 见到 `completed`、`blocked`、`error`、`max-tokens`；client 还判 `failed`，包里没找到（多判无害） | 探针 S07 |
| E03 | `user/message` 的 `data.source.kind==='user'` 区分真人消息；开工切片用自己的 kind | timeline、boot-slice-listener | 对。时间戳字段叫 `time`（毫秒数）；`surfaceOp` 为 `append` 或 `{op:'replace',startSeq,endSeq}`（SES 295、451） | 探针 S07、S09 |
| E04 | `tool/call{callId,name,arguments}`、`tool/result{message{toolCallId,isError,content}}` | timeline | 对。TP 188–199；`createToolResultMessage` 的字段名叫 `toolCallId`（`dsh-llm/lib/index.js`） | 跑一条会调工具的会话看时间线 |
| E05 | `approval/asked{id,toolName,callId,reason}`、`approval/decided{id,outcome}` | client、ledger、runtime | 对。UA 157–166；`asked` 事件里**没有** `displayReason`，只有 `reason`（我们靠 `reason` 里的 `HUBAPPROVAL1` 前缀） | 手机上点批准后，查 `session/events` 里 asked/decided 配对 |
| E06 | 自定义事件 `hub-plugin/notice`（plugin 写、client 读） | plugin、client | **冲突**，见上面第 1 条 | 超 8 步后重启内核再开会话 |

## 三、插件接口（hub-plugin 在内核里怎么挂）
| 编号 | 依赖点 | 谁在用 | rc.1 静态核对 | 上线怎么实测 |
|---|---|---|---|---|
| P01 | 插件模块导出 `name`、`inject`、`apply(ctx,config)`；作为档案依赖 `dsh-hub-plugin` 挂进预设 | plugin、ops/install-r23.sh | 对（形状）。内核包同样写法，如 SKF 29、44。档案目录放 `package.json` 依赖，见 `dsh` 包 README「Profile」一节 | 起实例看日志有没有「hub-plugin 安装配置错误」 |
| P02 | `ctx.on('agent/pre-step', fn, {prepend})`：收 `{agent,messages,turn,step,signal}`，返 `{kind:'enter'\|'reject',messages}` | plugin、boot-slice-listener | 对。LOOP 685–700；`reject` 与 `enter` 都在；`prepend` 选项有内核包在用（time-context） | 新会话第一步看开工切片是否注入一次（探针 S09）；`prepend` 的先后顺序要看一次真实日志 |
| P03 | `agent/inbox/inserted`（`{agent,message}`）、`agent/disposed`（`{agent}`） | plugin | 对。LOOP 200、1435；监听写法同别的包 | 多发两条消息看「刚才没批准」的锁有没有解开 |
| P04 | `tools/pre-execute`：返 `next()`（放行）、`{kind:'deny',reason}`、`{kind:'ask',reason,displayReason}` | plugin | 对。TP 386–402、608–631；`ask` 的 `reason` 与 `displayReason` 会原样交给审批服务；没有审批服务时 `ask` 变成拒绝 | 手机上一次批准、一次拒绝 |
| P05 | `approval/request`（`{agent,toolName,callId,reason,signal}`）返回结局字符串 | plugin | 对。UA 201；请求体字段与 TP 624–631 的一致 | 同上 |
| P06 | `tools/execute`、`tools/post-execute(exec,result,next)`、`tools/result` | plugin | 对。TP 492、673、586；`post-execute` 默认返 `{kind:'accept'}` | 跑一次 bash、一次写文件，看结果文字被改写 |
| P07 | `ctx.tools.guard(fn)`：返回字符串＝拒绝原因 | plugin | 对。TI 649–664，守卫在审批之后才算 | 审批通过后改命令，应被拒（「审批后命令已变化」） |
| P08 | `ctx.tools.register({name,description,parameters,output:{schema,render},execute})` | plugin、tools/*.mjs | 对。TI 433–452：`output.render` 必须是函数，工具名不许叫 `run_code` | 助理的工具清单里看到 `list_bots` 等 |
| P09 | `ctx.tools.view(agent).visible`（Map）做工具清单核对 | plugin（tool-inventory） | 对。TI 477–515 | 起实例看有没有「工具清单对不上」告警 |
| P10 | `ctx.get('sandbox'\|'sandboxPolicy'\|'shell')`；`sandbox.confine`；`shell.resolve({workdir,timeoutMs,…})`；`shell.sandboxMode`；`sandboxPolicy.resolve({session})` | plugin、command-sandbox、shared-grant | 对（都在）。`dsh-sandbox`（`confine`）、`dsh-bash-sandbox` 59–62（`resolve`、`sandboxMode`）、`dsh-sandbox-policy` 166（`resolve`）；bash 工具传的请求字段正是 `workdir`、`timeoutMs`（`dsh-tool-bash` 664–701）。**`registerWritableRoot` 包里没有**，shared-grant 走回退：包一层 `sandbox.resolve` 补额外可写根 | 在共享区写一个文件（要批准）；命令沙箱外的路径应写不进去 |
| P11 | `ctx.workingDirectory.get(session)`、`ctx.effect`、`ctx.logger` | plugin | 对。`dsh-working-directory` 80（`get`）、91（`ensure`）；`effect` 代码里按可选调用 | 无需单测 |
| P12 | `agent.session.append/seq/eventAt` | plugin、boot-slice-listener | 对（存在）。SES 1441、1479、1524。`append` 对未知类型的约束见第 1 条 | 同 E06 |
| P13 | 内核的 `createUserMessage`（`@deepseek-ai/dsh-llm`），解析不到就用等价实现 | tools/index.mjs | 对。`dsh-llm/lib/index.js:59`、导出在 2434；入参 `content`、`source`。插件从仓库链接进档案，包名多半解析不到，会走回退（有一行日志） | 看日志有没有「用等价的 createUserMessage」 |

## 四、配置层（预设与启动）
| 编号 | 依赖点 | 谁在用 | rc.1 静态核对 | 上线怎么实测 |
|---|---|---|---|---|
| C01 | 助理预设 `@deepseek-ai/dsh-agent-preset`：`id,name,description,order,plugins[]` | devinst 预设补丁 | 对。`dsh-agent-preset/lib/index.js` 14–18 | `dsh --profile web --patch <补丁> --dump-config`（只合成配置、不起服务）能先验一遍 |
| C02 | 预设里的 `dsh-persona`：`prefix` 必填、`includeRuntimeContext` | 预设补丁 | 对。`dsh-persona/lib/index.js` 24、27 | 同上 |
| C03 | `dsh-agent-instructions`：`projectRootMarkers`、`instructionFileCandidates`、`localInstructionFileCandidates`、`maxBytes` | 预设补丁 | 字段都对（AI README 配置表，`maxBytes` 必填）。**用法冲突见第 2 条**。另：内核默认就加载 `AGENTS.local.md` 叠加文件，我们预设把它清空了（`localInstructionFileCandidates: []`），要用叠加文件得改这里 | 在助理目录放一份带暗号的 `AGENTS.md`，新会话问暗号 |
| C04 | 技能：base 档案已含 `dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill` | defaults、ops/install-content.mjs | 有（`dsh-base/cordis.patch.yml` 313–319）；扫描目录**冲突**见第 3 条。目录里只给模型每个技能一行名字加截断描述，需要时才用 `skill` 工具载入全文 | 新会话问「你有哪些手册」；探针 S09 之外要单看 |
| C05 | `dsh-tool-fs`：`read/write/edit/readImage/applyPatch`；`dsh-tool-bash`：`enableRunInBackground`、`promoteOnTimeout`；`dsh-bash-sandbox`：`timeoutMs/maxTimeoutMs/maxOutputBytes` | 预设补丁 | 对。`dsh-tool-fs` 1954–1957；`dsh-tool-bash` 232–233；`dsh-bash-local` 52–54、71 | `--dump-config` |
| C06 | `dsh-agent-default-model`（`provider`、`model`）与 `llm-pi-ai` 的 `providers`（`apiKeyEnv`、`baseURL`、`api: openai-completions`、`compat.*`、`models[]`） | devinst 补丁 | 对（字段在）。`dsh-agent-default-model` 22–23；`dsh-llm-pi-ai` 399–451、692–694 | 探针 P05 看目录里有没有这个渠道 |
| C07 | 命令行 `dsh --profile web --patch <文件> --port --host --no-open`；补丁叠加顺序 | devinst/start*.sh、r23-up.sh | 对（`--profile`、`--patch`、`--port` 在 `dsh` README；`--host`、`--no-open` 在 `dsh-web-app/lib/startup.js` 的命令定义）。README 还写明叠加顺序：bundle → 档案补丁 → `$DSH_HOME` 补丁 → `--patch` | 起停脚本照跑 |
| C08 | 环境变量 `DSH_HOME`、`DSH_AGENTS_HOME` | devinst/start*.sh | 对。`dsh-home-paths/lib/index.js` 15、21 | 起实例后看数据落在指定目录 |
| C09 | 启动日志里的一行 `dsh web: http://<地址>:<端口>/?token=…`，脚本从日志里抠令牌 | r23-up.sh、ops/live*.mjs | 对。`dsh-web-app/lib/index.js` 162（`printUrl` 默认开）。这行把令牌写进日志，日志要 0600 | 起实例看日志 |
| C10 | `cordis:group` 带 `group: true` 与 `isolate: {服务名: true}`（我们隔离 `shell`、`shellEnv`、`compaction`） | 预设补丁 | 形状对：内核自带预设同样写法（`dsh-web-app/presets/cordis.patch.yml` 47–91，隔离 `planMode`、`compaction` 等）；`ctx.shell`、`ctx.shellEnv` 在 bash 工具里确实是这两个服务名（`dsh-tool-bash` 664–701）。**隔离后每个助理是否真的各有一份命令沙箱：？没核** | `--dump-config` 看合成树；起实例看每个助理的命令是否各走各的沙箱 |

## 五、没依赖但计划里提到的内核能力（备查）
| 编号 | 能力 | 仓库现状 | rc.1 静态核对 | 上线怎么实测 |
|---|---|---|---|---|
| S01 | 内核定时 `schedule_create/list/view/edit` | 仓库没用（晨会晚会、固定任务走后端进程内定时） | 有。`dsh-tool-schedule/lib/index.js` 6、518；按 `dsh-schedule` README「Known Limitations」：内核要常开，模型工具拒绝被委派的调用者 | 暂不需要 |
| S02 | MCP 客户端 `dsh-mcp-client`，工具名 `mcp__<服务名>__<原名>` | 只有 `cua-gate.mjs` 按这个前缀剥名字，没接线 | 有（0.2.2-rc.1，`dsh-mcp-client/lib/index.js` 58、97）；base 档案没挂它 | 接 Cua Driver 时再测 |
| S03 | 按会话限制工具 `ctx.tools.restrict({allow,deny})` | 仓库没用 | 有，是代码接口、不是配置项。TI 453；只遮「全局」工具，会话自己注册的遮不掉 | 接 Cua Driver 时再测 |
| S04 | 内核的 `dsh --dump-config` | 没用 | 有（`dsh` README）。**可以不起服务先验配置合成** | 上线前每改补丁先跑一遍 |

## 探针怎么用
```
export DSH_PROBE_TOKEN=<实例令牌>          # 只从环境变量读，不进命令行、不进输出
node packages/hub-plugin/ops/kernel-contract-probe.mjs <实例地址> [--json]
```
- 默认只发只读调用：`/connect` 换会话凭据（会在内核里新建一个 Peer，不改数据）、WebSocket 升级、`session/list`、
  `session/modelCatalog`。其余项一律标「没法只读探」。
- `--with-session` 要额外给 `DSH_PROBE_CWD`、`DSH_PROBE_PRESET`（指向假模型的预设名）、`DSH_PROBE_PROVIDER`、
  `DSH_PROBE_MODEL`，会在那个目录里建一个会话、发一条 `PROBE`、再取消。**只许对假模型实例用。**
  可选 `DSH_PROBE_EXPECT_BOOT_SLICE=1`（要求开工切片必须出现）。
- 退出码：没有「缺失」→0；有→1；参数或连接不对→2。输出里令牌与 cookie 一律脱敏。
- 探不到的东西（第二、三、四节大部分）靠起实例后看日志、事件与手机界面；每行最后一列写了看什么。
