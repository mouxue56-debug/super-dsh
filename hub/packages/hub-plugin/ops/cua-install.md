# 操作应用：安装片段（只说明，不改任何现有预设和脚本）

 【确认状态待核】 路 34。先读 `docs/操作应用.md`。

## 1. 内核档案层挂 MCP 客户端（`cordis.patch.yml`，不能放进任何助理预设）

```yaml
- insert:
    - id: mcp-cua
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: cua
        transport: stdio
        command: <cua-driver 的绝对路径，取自 `cua-driver mcp-config` 的输出>
        args: [mcp]
        toolCallTimeoutMs: 60000
        startupTimeoutMs: 20000
        failOnStartupError: false
```

写法（`insert` 包一层）照现有预设补丁的开头，集成时对着内核补丁语法核一遍。放进助理预设的话，
`restrict` 遮不掉它注册的工具，会让 62 个工具全进上下文，所以只能挂档案层。

## 2. 权限表启用名单（`tool-levels.yaml`）

在 `plugin_tools` 名单里加 `cua`（已有 `bots` 之类就并列）：`plugin_tools: ["bots","cua"]`。
这一行由 `policyText(..., {pluginTools: [...]})` 生成，别手改其他键。**默认名单里没有 `cua`。**

## 3. 安装配置（`hub.yaml`，一行紧凑 JSON）

`cua: {"allow_bots":["<助理id>"]}`；其余键见 `docs/操作应用.md` 第四节，都有默认值。

## 4. 放权文件（`<HUB_HOME>/config/cua-gate.json`，权限 0600，别人不可写）

```json
{"grants":[{"assistant":"<助理id>","app":"Calculator","until":"<首次验证当天或次日>"}]}
```

没有这个文件 = 没有任何放权（每步都先问）。

## 5. 宿主接线

见 `docs/操作应用.md` 第五节（注入 `cuaClient`、遮住 `mcp__cua__*`、可见性）。

## 6. 上线后第一次实机验证

只能在主人在场、一次一步时做；步骤和机器名写在交接回执里，不放进代码仓库。检查项：模型请求里可见的 cua 相关工具数、
`kill_app` 被拒、本地自建网页出现登录字样时停下、退出后没有遗留的驱动子进程。
