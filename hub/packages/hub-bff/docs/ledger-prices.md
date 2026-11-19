# 账本价表

价表是 JSON 对象 `{"prices":[]}`，或 YAML 顶层 `prices:` 列表。每项平铺填写 `channel`、`model`、`mode`（`metered`、`plan` 或 `local`；默认 `metered`）、`currency`、`perTokens`（默认 1000000）、`input`、`cacheRead`、`cacheWrite`、`output`、`reasoning`、`source`、`checkedAt`、`expiresAt`。价格字段为非负数字或 null；日期为 YYYY-MM-DD。YAML 仅支持简单标量与注释，不支持嵌套结构。测试目录中的示例价格均为虚构值。

`metered` 必须填写币种、来源地址、核对日期和到期日期。`plan` 可填写 `referenceInput`、`referenceCacheRead`、`referenceCacheWrite`、`referenceOutput`、`referenceReasoning` 和 `referenceCurrency`，参考价只用于折算展示，并非实际支出。`local` 只计用量。匹配使用渠道与模型的完整名称。

没有价格就待核，不估算。已用 token 对应的单价缺失、或所有用量均未上报时，按待核处理；部分未上报的字段另行标示。状态 `ok` 为有效价格，`expired` 为超过到期日 UTC 结束时间的价格（仍展示计算金额），`plan` 为套餐，`local` 为本地，`pending` 为待核。各币种分别汇总。金额按微单位四舍五入；套餐参考额不计入实际金额。

填写流程：先从提供方的公开价目核对渠道、完整模型名、计费模式、各 token 分类及计价单位，再填币种、来源网址、核对日期和自行设定的复核到期日；未找到的单价留 null。加载时遇到无效数据应修正整张表后重新加载。价格变更或到期后重新核对来源，再更新价表；不要把测试假价用于实际计算。
