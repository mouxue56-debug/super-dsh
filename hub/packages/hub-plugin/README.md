# Hub 权限插件

来源：项目默认值。

`HUB_HOME` 缺省为 `os.homedir() + '/dsh-work'`。安装配置读 `$HUB_HOME/config/hub.yaml`，严格平面 YAML（每值单行紧凑 JSON），包括 `version / kb / heartbeat / grants / bots / names / chief / kb_allow`。缺失的可选路径由 HUB_HOME 推出；坏配置失败关闭。名册、名字与角色优先读 `$HUB_HOME/config/bots.yaml`，按 inode、mtime、ctime、大小缓存，下一次判定即更新。文件缺失时按 hub.yaml 的名单、名字和首席角色回退；坏名册、非本用户0600普通文件、重复键或重名均失败关闭。执行代码不写死六个 id 与名字。

权限表读 `$HUB_HOME/config/tool-levels.yaml`，启动读取一次。bash 的各区域值必须为 CMD，并统一交给 `classifyCommand`。放行名单只能是内置的子集，禁止/先问名单只能是超集，超时、输出、放权天数只能降低，其他旧边界保持相等；错误即全 L4。命令输入最多 2000 字；`sandbox_permissions / justification / run_in_background` 只要出现就问前拒绝，不锁会话。

rc.1 的基座已提供 `sandbox / sandboxPolicy / shell / shellEnv`，默认 workspace-write。预设重复注册服务会被内核拒绝，所以旧 hub 预设与通用 hub-bot 预设分别以 Cordis group 隔离 `shell / shellEnv`，在组内挂 `dsh-shell-env + dsh-bash-sandbox + dsh-tool-bash + hub-permissions`；复用基座 sandbox 与 sandboxPolicy，不改变其他预设的服务。命令默认 60 秒，上限 10 分钟，内核输出缓冲每流 1MB。不新增 jobs 插件；背景执行与超时转背景都关闭。

执行前复查 mode、同一次命令和目录及能力快照，再以 AsyncLocalStorage 向 A 的 `installCommandSandbox` 传入 own、readable、denyRead、network、extraWrite、own/.tmp。shell.resolve 只在该次异步链覆盖已判定的 cwd 和 timeout，保证收紧后的配置真正传到执行器。confine 未被调用会 error，并禁用该插件实例此后全部 bash，直到重启。非 hub 执行链不会拿到本次 sandbox 上下文。

L3 沿用原审批监听、心跳、拒批锁和10分30秒兜底。卡片的 HUBAPPROVAL1 含完整 command、cwd、why、timeoutMs、caps、grantable 与可选 grantKey。执行前再次判定；变更即拒绝。正在审批的命令仍按未放权状态复判，BFF 在“以后这类不用问”时新写的放权只影响下一次命令，避免本次卡片与复判结果跳变。

放行表 `$HUB_HOME/config/command-grants.json` 由 BFF 写，本插件只读，每次现读。O_NOFOLLOW、0600、本用户普通文件、不超过64KB；坏表、重复键、坏条目均按空表处理并记 error。表不存在按空表处理。永拒不受放权影响。

每个 agent 的 pre-step 从 `ctx.tools.view(agent).visible` 取真实工具名，对照按 `chief` / `bot` 角色登记的 expected_tools。多出任意工具则该插件实例所有工具拒绝，记 error 并追加 alerts.log；缺少只 warn。后续 pre-step 继续对照，可捕获运行中新增的工具。无法列举也失败关闭。

bash 成功派发后的结果追加 L1 或 L3-approved 痕迹。超限输出存入 `bots/<id>/outputs/cmd-YYYYMMDD-HHMMSS-xxxx.txt`（0600），对话保留前4KB；若权限表进一步收紧输出上限则采用更小值。日志只写 cwd 与程序名列表，不记录命令全文。内核 stream 已截断时从其可信 spillPath 恢复；达到64MB的 spill 文件会拒绝处理，不把不完整内容冒称全文。超时保留原始标记并提示已停止。

## 生成、验证、安装

- 生成：`node packages/devinst/ops/generate-r26.mjs`，只读 r24 预设与 r26 替换表，输出 `presets-r26.patch.yml`。r24 文件不改。
- 单测：`node --test packages/hub-plugin/test/*.test.mjs`。所有 B 测试临时文件在 `$HOME/dsh-work/tmp/r26-B/`，A 的在 r26-A；E1 的在 r26-E1，原有测试继续覆盖。
- 隔离实测：`R26_PROBE=1 bash packages/hub-plugin/ops/scratch-up.sh`，随后 `node packages/hub-plugin/ops/r26-live.mjs`。端口与对照预设从 `ops/r26-test-config.json` 读；隔离根可用 HUB_SCRATCH 覆盖。假模型已有 TOOL/TOOLS 协议，直接支持 bash，无需修改共享 fake-model。
- 多工具故障测试：停隔离实例后以 `R26_PROBE=1 R26_EXTRA_TOOL=1` 启动，再用 `R26_EXTRA_TOOL=1 node packages/hub-plugin/ops/r26-live.mjs`。测试结束调用 scratch-down.sh，校验 PID/端口/cwd/命令行后只终止本轮实例。
- 显式安装：监工先备份并切换两份配置草稿，再运行 `ops/install-r23.sh`；可用 HUB_PROFILE_DIR 指向隔离 profile 验证。脚本先为 package.json / cordis.patch.yml / 既有插件链接留 `.bak-r26-<时间戳>`，保留原模型路由，不重启。真实 DSH 重启只由监工在授权后进行。
- 回滚：恢复同一时间戳的配置、profile 两文件和插件链接，并恢复上一版插件源码；配置与代码需成对恢复。重启后旧会话可能保留旧预设修订，应新建会话重新核对工具清单。

## 名册与助理资料（E1）

权限表去掉 `bots` 和 `chief` 键；名单和角色以名册为准，表中 `expected_tools` 只列 `bot`、`chief` 两类。`bot_list` 为 L0；`bot_create / bot_update / bot_set_status` 都固定 L3。更新人读表和 YAML 草稿后由监工成对安装，旧表不能与新插件混用。

`hub-bot` 配置 `bot: "*"`，每次从会话 cwd 的 realpath 取得身份，必须正好是 HUB_HOME/bots/<名册id>，名册 preset=hub-bot、role=bot；子目录、越界链接或冒用旧预设全部拒绝。通用助理的知识库白名单固定为空。所有预设 prefix 都把名字职责交给工作目录 AGENTS.md；名单用 bot_list 查询。停用助理的全部工具拒绝。

普通助理有 bot_list 和 bot_update；首席按 role 另有 bot_create、bot_set_status 和 delegate_to_bot。派活接受 id 或当前名字，停用助理和首席不能作为派活目标。资料文字不会改变工具或可读写目录。

管理工具先校验名字、重名（含停用）、12个启用上限、职责60字、不管120字、恰好3条各20字的短语、形象与颜色清单；同值不出卡。形象清单从 config/avatar-kinds.json 读，读不到就用插件 avatar-defaults.json 的图形和颜色，禁止角色及上传形象。新建的名牌色取图形颜色或清单首色。why 用模型提出的职责或改动项组成一句原因，不新增隐藏参数。

审批卡使用契约的 target、before、after、why；有拒批锁和心跳校验。BFF 必须在批准前完成备份、名册/目录/AGENTS.md和变更日志落盘。插件不写这些文件，执行只核对本次 after 已生效；不匹配就报「批准了但没改成，请 主人 看看」。管理参数和卡片被改动也拒绝。

E1隔离验收：`node packages/hub-plugin/ops/r26-roster-live.mjs`。端口读既有测试配置；默认根 `$HUB_HOME/tmp/r26-E1/live`，重跑可把 HUB_SCRATCH 指向本轮 tmp 的新子目录。脚本使用真实内核、假模型、tmp中的BFF Roster，不启真实BFF服务，不调用真实模型；finally 停本轮两个子进程，并核对主线。prepare.mjs 会保留复制profile的旧插件链接并指向本次 HUB_REPO，避免误测旧仓库。

实测边界：同一会话下一轮可收到新版 AGENTS.md，历史上下文仍可含旧名字；不宣称能抹去历史。安装 patch 和插件代码需要由监工重启真实 DSH；切换完成后新建、改名、职责更新与停用恢复通过名册动态生效，新建助理无需再次重启。

已存在的工具权限、共享区单次写根、工单归属、首席每轮最多3次派活、派活会话8步上限及拒批锁继续生效。
