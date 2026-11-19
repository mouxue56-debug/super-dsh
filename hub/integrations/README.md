# 给外部 agent 的看板接入包

让 Claude Code、Codex、Grok Bot 这类外部 agent 通过命令行 `hub-board` 远程用中枢看板：拿活、领单、报进度、交结果。
看板接口、令牌、工单格式见 `packages/hub-bff/docs/`（`外部agent怎么用看板.md`、`工单格式.md`、`接线说明.md`）。

## 三份说明各给谁
| 文件 | 给谁 | 怎么放 |
| --- | --- | --- |
| `claude-code/skills/hub-board/SKILL.md` | Claude Code | 整个 `hub-board` 目录放进它的技能目录 |
| `codex/AGENTS.hub-board.md` | Codex | 内容并入工作目录或全局的 AGENTS 文件 |
| `grok-bot/看板用法.md` | Grok Bot | 把这一页交给它当用法说明 |

三份的骨架一样：拿活、领单、报进度、交结果（成果、怎么验的、没验的、产物在哪）、什么时候必须停下标阻断交给人、
换会话续做前先重新确认权限、只在三种情况发声（要人处理、有可用结果、被阻断）。

## 从零接入五步
每步写了谁来做。「主人」指拥有看板的人；「agent 端」指要接入的 Claude Code、Codex 或 Grok Bot 所在环境。

### 第 1 步　确认能连上（主人 + agent 端）
- 看板挂在中枢后端的 `/board/` 前缀下，走自己的令牌，不用后端的主密钥（接线见 `接线说明.md` 第 1 节）。
- 主人决定怎么让 agent 端够得着这个地址，并只放行 `/board/` 前缀。
- 网络是否可达待验：Claude Code 与 Codex 若在同机或同内网，通常可达；Grok Bot 在远端，是否够得着这台机器没验过。
- agent 端只做一件事验证：第 4 步的第一条命令能返回，而不是超时。

### 第 2 步　签令牌（主人）
在看板所在机器上，用管理命令签发，令牌名就是 agent 在看板上的名字（字母、数字、下划线、点、横线）：

```
hub-board-admin issue codex --scope work
hub-board-admin list
```

- `--scope`：`read` 只读（只看与自己有关的单）；`work` 可领单、报进度、交结果（默认给外部 agent 用这个）；
  `work+create` 还能建单、验收、退回、回答，只在这个 agent 要当派单方时给。
- 名字不得与名册里的助理重名（管理命令用 `--reserved` 或环境变量 `HUB_BOARD_RESERVED_NAMES` 传名册里的名字）。
- 管理命令需要知道配置目录：环境变量 `HUB_BOARD_CONFIG_DIR` 或 `--config-dir`。
- `hub-board-admin` 指 `packages/hub-bff/bin/hub-board-admin.mjs`，用 `node` 运行。
- 令牌只在签发时在标准输出出现一次。不要截屏、不要贴进聊天，直接用第 3 步的方式落到文件里。

### 第 3 步　令牌放哪、环境变量（主人签发后，由主人或 agent 端的管理者落地）
推荐放进权限 0600 的 JSON 文件，字段 `url`（看板地址，含 `/board` 前缀）和 `token`，再用环境变量指过去：
- `HUB_BOARD_CONFIG`：指向该 JSON 文件。
- 或者 `HUB_BOARD_URL` 加 `HUB_BOARD_TOKEN`，令牌来自安全的环境变量注入，而不是手敲。
- 令牌**不进命令行参数**（令牌当命令行参数传入会被命令行拒绝），**不写进任何文档、示例、工单、回报**。
- 把令牌文件送到远端时走加密通道（例如 scp 或密码管理器），不要走聊天。

签发时不让令牌露在屏幕上、直接写成配置文件的做法：

```
hub-board-admin issue codex --scope work | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>process.stdout.write(JSON.stringify({url:process.argv[1],token:t.trim()})+'\n'))" "$HUB_BOARD_URL" > hub-board.json
```

先用 `umask 077` 让输出文件是 0600，或写完立刻 `chmod 600 hub-board.json`。

### 第 4 步　第一条命令（agent 端）
命令行是单个零依赖脚本 `packages/hub-bff/bin/hub-board.mjs`，需要 Node 22。拷到 agent 端，再给它起个短名：

```
hub-board list --assignee codex
```

- 返回 JSON 即接通。退出码 3 是令牌或权限不对；2 是用法或配置错误（地址、令牌没配好）。next 没有可领的单是退出码 5，一键全停不领是退出码 6。
- 命令行的完整用法以 `node hub-board.mjs`（不带参数）打印的 Usage 为准。
- 注意：命令行目前没有建单和 `whoami`，建单只在后端内部与 HTTP 接口里。

### 第 5 步　撤销（主人）
agent 离开、令牌泄露、或不再需要时：

```
hub-board-admin revoke codex
hub-board-admin list
```

- 撤销后该令牌立刻失效，再用会得到退出码 3。
- 同一名字撤销后不能直接重新签发同名，需要换一个新名字（代码里按名字查重，含已撤销的）。
- 疑似泄露时先撤销，再重签；令牌若进过聊天记录，视为已泄露。

## 退出码与完整用法
完整用法以不带参数运行 `hub-board.mjs` 打印的 Usage 为准。
退出码：0 成功，1 一般错误，2 用法或配置错误，3 认证或权限错误，4 冲突。

## 接线说明（给集成轮；本包没有改任何现有文件）
1. 根目录 `.gitignore` 是白名单写法，`integrations/` 默认被忽略。集成时需要在 `.gitignore` 里加一行 `!/integrations/`，
   或沿用本包的做法用 `git add -f integrations` 提交。本包未改 `.gitignore`。
2. 测试放在 `test/integrations.test.mjs`（`/test/` 已在白名单内），运行：`node --test test/integrations.test.mjs`。
3. 令牌名要和名册助理名错开：集成轮在签发脚本里把名册名字作为 `--reserved` 传入。
4. 这一页和三份说明里没有任何令牌、真实地址、个人路径，发布前的开源卫生扫描不需要为它们加基线条目。

## 定时来看与条件触发
到点来读、按条件建单、撤销令牌，见 `全天候-定时与条件触发.md`。
那里的 launchd 和各家定时都只是样例，不会被安装或加载。

## 与 Super Agent 思想的对应（Owner 原话「把它融入 Super Agent 的思想」）
参考的是公开研究原型 dsh-superagent-prototype 的做法（只学做法，一行不拷；该原型自称非生产就绪）：
- 少占人的注意力：只在要人处理、有可用结果、被阻断时才发声。
- 授权与上下文分开：令牌范围由主人定，agent 的记忆不等于权限。
- 一单一任务，跨会话续跑，恢复前先重新确认授权。

## 看板交接
助理派卡给外部 agent、命令行 hub-handoff、条件叫醒的一页说明见 `docs/看板交接-给外部agent.md`，提示词见 `docs/看板交接-提示词.md`。
