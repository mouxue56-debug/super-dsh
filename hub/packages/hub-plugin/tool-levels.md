# 权限

启动读取 $HUB_HOME/config/tool-levels.yaml；严格平面 YAML，值为单行紧凑 JSON。来源：项目默认值。

| 工具 | own | shared | tickets | kb白名单 | outside | 来源 |
|---|---|---|---|---|---|---|
| read / list_files | L0 | L0 | L0 | 白名单 L0 | L4 | 项目默认值 |
| write / edit | L1（根 AGENTS.md 除外） | L3 | L4 | L4 | L4 | 项目默认值 |
| ticket_create / update / move | — | — | 自建 L1，别人 L3，派活工单 L4 | — | — | 项目默认值 |
| bot_status | L0 | — | — | — | — | 项目默认值 |
| delegate_to_bot | — | — | 仅首席 L1 | — | — | 项目默认值 |
| bash | CMD | CMD | CMD | CMD | CMD | 项目默认值 |
| 其他工具 | L4 | L4 | L4 | L4 | L4 | 项目默认值 |

CMD 统一交给命令判定；取管道、串联中最严格等级。L0 只读；L1 直接做并留痕；L3 发手机审批卡；L4 永远拒绝。来源：项目默认值。

| 命令规则 | 内容 | 来源 |
|---|---|---|
| cmd_run | `ls`、`cat`、`head`、`tail`、`wc`、`grep`、`rg`、`find`、`sort`、`uniq`、`cut`、`sed`、`jq`、`date`、`pwd`、`echo`、`printf`、`diff`、`cmp`、`file`、`stat`、`du`、`tee` | 项目默认值 |
| cmd_git_readonly | `status`、`log`、`diff`、`show` | 项目默认值 |
| cmd_script | `python3`、`node`、`sh`、`bash` | 项目默认值 |
| cmd_ask_always | `codex`、`grok`、`opencode`、`kb-agent`、`cua-driver`、`osascript`、`open`、`curl`、`wget`、`git`、`npm`、`pnpm`、`yarn`、`pip`、`pip3`、`brew`、`gem`、`cargo`、`go`、`ssh`、`scp`、`rsync`、`nc`、`telnet`、`ping`、`awk`、`less`、`more`、`vi`、`vim`、`nano`、`env`、`command`、`builtin`、`nohup`、`setsid`、`disown`、`timeout`、`nice`、`time` | 项目默认值 |
| cmd_deny | `sudo`、`su`、`doas`、`launchctl`、`systemctl`、`service`、`shutdown`、`reboot`、`halt`、`diskutil`、`hdiutil`、`mount`、`umount`、`fdisk`、`newfs`、`mkfs`、`scutil`、`networksetup`、`pmset`、`csrutil`、`spctl`、`security`、`dscl`、`kill`、`killall`、`pkill`、`crontab`、`at`、`chflags`、`shred`、`srm`、`eval`、`exec`、`source`、`.` | 项目默认值 |
| cmd_timeout_ms | 60000 | 项目默认值 |
| cmd_timeout_max_ms | 600000 | 项目默认值 |
| cmd_output_bytes | 4096 | 项目默认值 |
| cmd_grant_days | 30 | 项目默认值 |
| 直接跑 | 只读程序必须使用只读选项，所有路径在可读根；自己的脚本仅在加严沙箱生效时直跑。重定向仅写 own。 | 项目默认值 |
| 先问 | 未列入放行且未禁止的命令；联网、外部写入、长跑、内联代码、不能完整解析的命令。 | 项目默认值 |
| 永远拒绝 | 提权、系统服务/磁盘/重启/设置、凭据/配置/主线/插件源码、外部删除或覆盖式移动/改权限、丢弃式 git、下载/解码后执行等。 | 项目默认值 |
| 权限表硬下限 | run/git_readonly/script 只能减；deny/ask_always 只能加；时间/输出/放权天数只能降低。旧权限键仍须相等；失败即全 L4。 | 项目默认值 |
| 路径黑名单 | `~/.secrets`、`~/.ssh`、`~/.gnupg`、`~/Library/Keychains`、`~/.config`、`~/.codex`、`~/.grok`、`~/.claude`、`~/.local/share/opencode`、`~/.dsh`、`~/.agents`、`$HUB_HOME/config`、`$HUB_HOME/dev-home*`、`$HUB_HOME/dsh-hub`、`/Applications/DeepSeek Harness.app`、`/Library/LaunchDaemons`、`/Library/LaunchAgents`、`~/Library/LaunchAgents`、`/etc`、`/System` | 项目默认值 |
| taint | cmd_taint_tools 默认 []。本轮成功执行其中的读取工具后，命令全部升为先问；下一轮重置。 | 项目默认值 |
| taint（修J 改） | 成功执行 cmd_taint_tools 里的工具后，这位助理进入「接触过外部内容」状态，所有会话命令先问，**不再下一轮重置**，直到主人解除（见 `讨论组.md` 修J 一节）。与测试「下一轮恢复」冲突，留红。 | 修J，监工按裁定定 |
| 工具清单 | expected_tools 为每个 bot 的实际期望清单；ctx.tools.view(agent).visible 比对，多一个即该插件实例全拒并写 alerts.log，少了只 warn。 | 项目默认值 |
| 放权 | 只读 command-grants.json，O_NOFOLLOW、0600、64KB；异常视空表。新规则从下次命令生效，在途审批仍按原卡复判；永拒不允许放权。 | 项目默认值 |
| 输出与日志 | 前4KB进对话，全文存 own/outputs 0600。actions.log 仅程序名列表、工作目录和级别，不记命令全文。 | 项目默认值 |
| 后台 | 不新增 jobs；命令工具 enableRunInBackground=false、promoteOnTimeout=false；run_in_background 参数存在即拒。 | 项目默认值 |
| 审批 | 沿用心跳、拒批锁与10分钟手机审批，插件10分30秒兜底；仅真实用户下一句清锁。 | 项目默认值 |
| 已有文件规则 | 逐段 realpath；只读知识库白名单；根 AGENTS.md 文件工具不可写；派活每轮最多3次、被派会话最多8步。 | 项目默认值 |

## 名册工具与角色（第三期 E1）

来源：项目默认值。下列为专用名册工具，目标是服务端名册，由BFF写入；不改变上表文件工具对config目录的拒绝规则。

| 工具 | 级别 | 可用角色与范围 | 执行边界 |
|---|---|---|---|
| bot_list | L0 | 全部启用助理 | 只返回启用助理的id、当前名字、职责 |
| bot_update | L3 | 普通助理只改自己；首席可改任何一位 | 问前校验，before/after卡，BFF先落盘，插件只读核对 |
| bot_create | L3 | 只有首席 | 名字不重名，启用最多12个；BFF生成id，新增preset=hub-bot/role=bot，KB白名单为空 |
| bot_set_status | L3 | 只有首席 | 只停用/恢复，不删除；不能停用自己，至少留一个启用 |
| delegate_to_bot | L1 | 首席派给启用的普通助理 | bot参数可用id或当前名字，工单存id，原每轮3次限制保留 |
| 停用助理 | L4 | 所有工具 | 下一次判定即拒绝「这个助理已停用」 |

YAML不再列bots/chief；实时名单、名字、角色由bots.yaml提供。expected_tools按chief/bot两种角色登记，新增助理不需要编辑权限表。角色由名册决定，职责文字不能增加权限。图形默认取值来自插件avatar-defaults.json，角色取值只认config/avatar-kinds.json。
