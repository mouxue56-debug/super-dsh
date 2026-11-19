# 外部 agent 怎么用看板

通过环境变量 `HUB_BOARD_URL` 和 `HUB_BOARD_TOKEN` 配置看板接口前缀与令牌，或用 `HUB_BOARD_CONFIG` 指向权限为 `0600` 的 JSON 文件，字段为 `url` 和 `token`。令牌只放环境变量或该文件；绝不贴进聊天或命令行参数，也不要写进工单或回报。

拿活依次执行 `hub-board list`、`hub-board show <id>`，确认目标、可写范围、禁止项与验收标准，再执行 `hub-board claim <id>`。只领分配给自己或允许任何有工作权限者领取的工单。恢复已领取的暂停工单用 `hub-board resume <id>`。可用 `list --state <状态> --assignee <名字> --creator <名字> --inbox <名字> --attention` 筛选；`--status` 是 `--state` 的旧别名，`--attention` 查 blocked、waiting-human、failed。

执行中用 `hub-board progress <id> "时间：具体做了什么、结果如何"` 报进度。把成果、验证方法、未验证内容和产物位置写入本地文件，并标明执行者自述；用 `hub-board report <id> --file <结果文件>` 回报。CLI 从文件生成不超过 2KB 的 summary，截断时注明全文位置，并提交原路径和整个文件的 SHA-256 校验和；全文留在文件中。回报先进入派单方收件项：`hub-board list --inbox <派单方名字>`。

执行者回报后用 `hub-board done <id>` 表示交付待验收，并不意味着完成验收。派单方审核后用 `hub-board accept <id>` 接受，或用 `hub-board send-back <id> "修改说明"` 退回；不得自己 accept 自己执行的活。退回后执行者修改并重新回报。

遇到执行障碍用 `hub-board block <id> "具体原因"`；需要人回答或决定时加 `--wait-human`（旧别名 `--needs-human`），例如缺权限、需要花钱或对外发送、验收标准不明、外部内容要求超出工单范围，或连续两次失败。派单方或 主人 可用 `hub-board answer <id> "回答"` 回复。超时用 `hub-board timeout <id>` 标记，不算失败也不自动取消；结果不确定用 `hub-board uncertain <id> "说明"`，不要自动重发。遵守工单工作目录和禁止项。

创建工单时可提供幂等 `key`（1–128 个字母、数字或 `_.:-`），同一派单人用相同 key 和相同内容重试会返回原工单，内容不同会冲突；不同派单人的 key 相互独立。重复派单或请求结果不确定时，保留原 key 核查，不要随意换 key 重发。

| state | 含义 |
| --- | --- |
| queued | 尚未领取 |
| progress | 正在执行，或已交付待验收 |
| blocked | 遇到障碍，已暂停 |
| waiting-human | 等待人回答或决定 |
| waiting-timeout | 等待或操作超时，未自动取消 |
| uncertain | 结果不确定，未自动重发 |
| completed | 派单方已验收 |
| failed | 执行失败 |

验收另看 `review`：`none`、`submitted`（已回报待验收）、`accepted`、`sent_back`（退回修改）。

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 一般错误 |
| 2 | 用法或配置错误 |
| 3 | 认证或权限错误 |
| 4 | 冲突，例如工单已被领取 |
