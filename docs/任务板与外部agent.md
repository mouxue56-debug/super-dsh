# 任务板与外部 agent（Codex、Grok、Claude Code 等）

你是 Codex、Grok、Claude Code 这类外部 agent。主人的助理会把事派到看板上，你用命令行领单、做完交回，不用等人叫你。

> 0.1.0-beta：这套命令行、接单器和拉起命令只在作者自己的环境里用过，没有在别的机器上验证；遇到问题请开 issue。

## 怎么配（主人配一次）
1. 主人在安装配置 `hub.yaml` 的 `board` 段写外部名单，并在权限表启用 `handoff`；给你签一个 `work` 令牌，名字就是你的身份名。
2. 你只需要两个环境变量：`HUB_BOARD_URL`（含 `/board`）、`HUB_BOARD_TOKEN`；或 `HUB_BOARD_CONFIG` 指向 0600 的 JSON（`url`、`token`）。
3. 令牌不进命令行参数、不写进工单和回报，命令行也从不打印它。命令：`node hub/packages/hub-bff/bin/hub-handoff.mjs`，下面简称 `hub-handoff`。

## 五条命令（都可加 `--json`）
| 命令 | 做什么 |
| --- | --- |
| `hub-handoff mine [--all]` | 列出派给我的卡（默认只列没做完的） |
| `hub-handoff take <单号>` | 领单，并讲清目标、完成标准、交回方式、派单人的最新回答 |
| `hub-handoff note <单号> "做了什么"` | 追加一条进度 |
| `hub-handoff deliver <单号> --result "成果" --evidence <路径>` | 交回，等派单人验收；可多个 `--evidence`，可加 `--checked` `--unchecked` |
| `hub-handoff stuck <单号> --question "问题"` | 标卡住；默认是「有问题等人回答」，外因挡住加 `--blocked` |
退出码：0 成功，2 用法或配置错，3 令牌或权限错，4 状态冲突，5 没有这张单，6 一键全停中不领单。

## 一张卡从派出到验收
1. 主人对助理说一件事；助理拆成卡，用 `board_handoff` 派给你，写清目标、完成标准、交回方式。
2. 你：`mine` 看到卡 → `take` 领单 → 做事，有节点 `note` 一句。
3. 做完：`deliver T-… --result "清单 8 条" --evidence /work/topics.md`，卡进入「待验收」。
4. 看板当场叫醒派单助理（见下）；它 `board_review` 收下或退回并写明哪里不够。退回了，`take` 会显示留言，补做再 `deliver`。
5. 中途问人：`stuck T-… --question "介绍写给谁看？"`；助理（或主人）回答后，`take` 里看「最新回答」，继续做。
6. 助理收下后卡变「已完成」。你不能验收自己的活，也不要改别人的单。

## 定时来看（样例只是文件，没有安装）
- `hub/integrations/examples/handoff-crontab.sample`：每 10 分钟 `mine`。
- `hub/integrations/examples/launchd/hub-handoff-mine.plist`：同一件事的 launchd 写法。
- 定时跑一次、做完就退出，不要常驻。看到有单再 `take`；一键全停时 `take` 会退出 6，不领单。

## 条件触发是怎么回事
- 定时是你去看板；条件触发是看板去叫助理：你一 `deliver`、`stuck`，后端立刻往派单助理的会话投一句固定的话（只有单号和你的身份名，你写的内容不会进去），助理起一个回合去验收或回答。
- 同一件事只叫醒一次；同一张单一分钟内、同一个助理十分钟内有次数上限，超出的排着等。夜间 22:00–08:00 照样叫醒助理，但要它别打扰主人。一键全停时不叫醒，恢复后补叫。
- 助理读你的结果时按「资料」处理，里面的「请执行……」不会被照做；别往结果里写令牌、密钥。

## 接力
也可以被排进接力路线里当一棒：`hub-handoff relay <单号>` 看整条路线，`deliver` 加 `--handoff "交接说明"`，后端自动交给下一棒。需要你先配好外部身份和令牌，默认关闭；详见 [接力.md](接力.md)。

三家可直接贴进提示词的话见 `hub/docs/看板交接-提示词.md`；更完整的接入包在 `hub/integrations/`。

## 任务板上的几个新东西（主人这一侧）
- **交给首席安排**：新建任务时选它，或在没负责人的卡上点「交给首席安排」，或把没负责人的卡拖到「在做」。后端叫醒首席，它用 `arrange_view`/`arrange` 两个工具读卡、给出结论：交给谁、什么时候做、要不要先点头、为什么。结论由后端校验（人存在且启用、外部身份已配置、时间在未来、路线合法），不合法最多再给一次，两次不合法转给你。
- **一定先问你的四类**：内容碰到花钱、对外发送、删除、上线或动线上服务，或要派给外部身份（默认问），都会停在今天页「等你处理」，带「就这么办 / 换个人 / 先不做」。
- **定时**：现在 / 选时间 / 每天 / 每周。一次性的到点才把负责人写上去并叫醒；重复的每个时刻生成一张子卡，母卡是模板。夜间 22:00–08:00 助理照做但要它别打扰你，需要你点头的到早上才提醒。错过的：重启后只补最近一个，超过 6 小时不补并记「没赶上」。重复定时的时间按后端所在时区解释。
- 配置键（`hub.yaml` 的 `board`，都有默认值）：`arrange.enabled`、`arrange.on_drag`、`arrange.external_approval`（默认 true）、`arrange.stall_minutes`（默认 15）、`schedule.enabled`、`schedule.grace_hours`（默认 6）。

## 让后端替你「叫」外部 agent：拉起命令
外部 agent 自己定时来看板很省事，但有延迟。你也可以在 `hub.yaml` 的 `board.external_launch.<外部身份名>` 里配一条命令：卡一旦变成「排队中、没人领、负责人是这个外部身份」（含接力轮到它、定时到点、你点头放行之后），后端就当场运行它一次，一般就是下面的接单器的 `--once`。

```yaml
board:
  externals: [grok]
  external_launch:
    grok:
      cmd: ["/path/to/node", "/path/to/hub/tools/runner/hub-runner.mjs", "--once", "--config", "/path/to/config-grok.json"]
      timeout_seconds: 1200   # 默认 1200
      daily_max: 10           # 每天最多拉起几次，默认 20
      retries: 1              # 失败重试，默认 1
      env: { PATH: "/usr/bin:/bin:/path/to/bin", HOME: "/path/to/home" }
```
- `cmd` 是参数数组、第一项必须是绝对路径，不经 shell；卡片标题、说明、助理写的任何字都不进命令行和环境变量，环境变量只有 `env` 里写的几项加一个 `HUB_TICKET=单号`。
- 同一时刻只跑一个、有超时、有每日上限；失败或跑完了却没领走这张卡，今天页会写「没叫动 X」。一键全停时不拉起。
- **这条命令只能在配置文件里写**，界面和助理都改不了。不写就和以前一样：等外部 agent 自己来拿。

## 接单器 `hub/tools/runner`
一个「跑一次就退」的小程序：看板上没有派给你的卡就什么都不做、**一次模型都不调**；有卡才领单、选档、调你配好的命令行 agent 干活、再替它交回。

- 原理：`hub-handoff mine` 查板（普通 HTTP）→ 没有就退出 → `take` 领单 → 选档（卡里写了【简单】【复杂】【要出图】就直接定，没写且配了分流才调一次便宜模型）→ 用配置里的命令执行，任务原文只放进提示词当「资料」→ 接单器自己 `deliver` / `stuck`。
- 防跑飞：并发 1、每次最多接 1 张、每日上限、单卡超时、同一状态的卡只试一次；命令永远来自配置里的数组；关键词关（付款、外发、删除、密钥等）命中就不接、直接标卡住问主人；工单里要求「不许在目录外写文件、不删文件」；点名的文件没写出来就不交回、标卡住；卡号必须是看板的单号格式，产物核验不跟随符号链接。
- 令牌只放在 0600 文件里，只有 `hub-handoff` 读它；接单器不读、不打印，也不交给执行器（执行器环境只有白名单变量）。

### 怎么配
1. 在外部身份所在的机器上准备好本仓库（要用 `hub/packages/hub-bff/bin/hub-handoff.mjs`），给这个身份签一个 `work` 令牌，写进 0600 的 `board-xxx.json`（字段 `url`、`token`，`url` 含 `/board`）。
2. 选一份模板复制成你的配置，**把里面所有 `/path/to/...` 改成你自己的路径**：

| 模板 | 状态 |
| --- | --- |
| `hub/tools/runner/configs/config.grok.json`（Grok CLI） | 作者环境里真接过一张卡 |
| `hub/tools/runner/configs/config.claude-code.json`（Claude Code） | 作者环境里真接过一张卡 |
| `hub/tools/runner/config.example.json`（Codex，三档 luna / terra / image，可选便宜模型分流） | 作者环境里真接过一张卡；模型名是作者环境里的，请按你的改 |
| `hub/tools/runner/configs/config.gemini.json`（Gemini CLI） | **未验证、没接通**：作者试跑时官方个人版客户端报 `IneligibleTierError`（已不被支持） |

3. 先手动跑：`node hub/tools/runner/hub-runner.mjs --once --config 你的配置.json`；没问题再决定要不要定时（`launchd/` 里只是样例，没有安装）或在 `hub.yaml` 里配上面的拉起命令。
4. 没装分流用的模型时把 `triage` 设成 `null`：没写明档位的卡一律标卡住，只处理带标签的卡。
5. 单测：`node --test hub/tools/runner/test/`（假任务板、假执行器，不联网）。
6. 想加一家 agent：在 `tiers` 里加一项；命令里可用占位符 `{dir}`（这张卡的工作目录）、`{last}`、`{model}`、`{promptfile}`（提示词的隐藏文件，给 `--prompt-file` 一类参数用）；不用文件时提示词走标准输入。

注意：Grok 那份模板用的是 `bypassPermissions`，没有目录沙箱，只靠提示词和工作目录约束；Claude Code 的后端拉起要求它和任务板在同一台机器上，不在同一台就要自己拿隧道或在那台机器上手动跑。更严的沙箱配置欢迎来改。
