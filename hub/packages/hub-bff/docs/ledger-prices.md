# 账本价表

SDS 默认使用 `../native-rates.json` 的 DeepSeek Harness 客户端价目。对外全名仍是 Super DeepSeek Harness Bot。
DeepSeek Flash 和 OpenCode Go 的 DeepSeek V4.1 Flash 按每次调用的日本时间计算人民币折算额。
现有安装价表仍可用于其他渠道和模型。无匹配价目的调用只累计次数和 token。

安装配置 `hub.yaml` 可以启用主人的插件账本（`cost-meter` / `quota-watch`），值写成单行紧凑 JSON。

```yaml
plugins: {"quotaWatchFile":"/quota-watch.json","costMeterUrl":"http://127.0.0.1:3390/plugins/cost-meter/status"}
```

省略整段会退回 Hub 事件账的「价目乘用量」估算。启用这一段后，如果未指定文件，使用 `$DSH_HOME/storages/quota-watch.json`。
如果未设 `DSH_HOME`，须显式指定文件才会读取样本。cost-meter 地址可省略，仅接受回环或私网 HTTP(S) 地址。
能读到时，顶部今天 / 近 7 天 / 本月改用插件给出的美元花费和次数，并显示一张额度卡；读不到时按价目估算，页面写明来源。
旧配置段 `nativeLedger` 仍兼容（优先级低于 `plugins`）。

价表是 JSON 对象 `{"prices":[]}`，或 YAML 顶层 `prices:` 列表。每项平铺填写 `channel`、`model`、`mode`（`metered`、`plan` 或 `local`；默认 `metered`）、`currency`、`perTokens`（默认 1000000）、`input`、`cacheRead`、`cacheWrite`、`output`、`reasoning`、`source`、`checkedAt`、`expiresAt`。价格字段为非负数字或 null；日期为 YYYY-MM-DD。YAML 仅支持简单标量与注释，不支持嵌套结构。测试目录中的示例价格均为虚构值。

`metered` 必须填写币种、来源地址、核对日期和到期日期。`plan` 可填写 `referenceInput`、`referenceCacheRead`、`referenceCacheWrite`、`referenceOutput`、`referenceReasoning` 和 `referenceCurrency`，参考价只用于折算展示，并非实际支出。`local` 只计用量。匹配使用渠道与模型的完整名称。

没有价格就待核，不估算。已用 token 对应的单价缺失、或所有用量均未上报时，按待核处理；部分未上报的字段另行标示。状态 `ok` 为有效价格，`expired` 为超过到期日 UTC 结束时间的价格（仍展示计算金额），`plan` 为套餐，`local` 为本地，`pending` 为待核。各币种分别汇总。金额按微单位四舍五入；套餐参考额不计入实际金额。

填写流程：先从提供方的公开价目核对渠道、完整模型名、计费模式、各 token 分类及计价单位，再填币种、来源网址、核对日期和自行设定的复核到期日；未找到的单价留 null。加载时遇到无效数据应修正整张表后重新加载。价格变更或到期后重新核对来源，再更新价表；不要把测试假价用于实际计算。
