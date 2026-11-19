# 参与贡献

谢谢你愿意帮忙。English: [CONTRIBUTING.en.md](CONTRIBUTING.en.md)

先说三条底线:
1. 不要提交任何个人信息:真实姓名、店铺、设备名、地址、聊天记录、密钥。示例和演示数据一律虚构。
2. 一条命令能跑过全部测试才算完成:`npm test`(离线,不要钥匙)。
3. 只提交你有权再分发的东西。角色包、图片、字体要写清来源和许可证,不能再分发的不收。

许可证见仓库根目录的 [LICENSE](../LICENSE)。欢迎开 issue 讨论、提想法、写手册草稿，也欢迎直接提 PR。

## 从小到大的四级

### 第一级:手册(一页文字,最容易)

手册用 DSH 的技能格式:`defaults/manuals/<小写连字符名>/SKILL.md`,开头是 frontmatter,
有 `name`(小写连字符)和 `description`(一句话,80 字以内),正文告诉助理「什么时候用、怎么做、做完怎么说」。
写完在 `defaults/manifest.json` 登记一行。可以先看现有的六本,例如 `defaults/manuals/use-board/SKILL.md`。

### 第二级:角色包和皮肤

角色包是助理的形象素材,皮肤是界面的明暗配色。它们的格式设计在这里:
- 皮肤:`skins/<id>/skin.json`,只允许明暗两套颜色、圆角、字体名这类「令牌」,不允许放脚本或样式文件。
- 角色包:`characters/<id>/character.json`,写 `name`、`license`、`attribution`、`redistributable`、
  各状态(待机、思考、工作、完成、困惑)对应的文件和尺寸上限。`redistributable` 为 false 的只能放在你自己的运行目录,
  仓库不收。

目前**加载器还没有做**,这两级现在是设计和素材层面的贡献:欢迎先开 issue 对格式提意见。格式带 `schema: 1`,
以后改格式要升版本号。

### 第三级:助理模板

一个助理 = 名册里一行(`defaults/bots.example.yaml`)+ 一份人设(`defaults/personas/<id>.md`,不超过 900 字,
用 `{{owner}}`、`{{bot_name}}`、`{{manuals}}` 占位)+ 要带的手册。
请保持通用:不出现具体的人、店、业务词。看看现有的「总管」「写作」「调研」再动手。

### 第四级:代码

- 零依赖:只用 Node 内置模块(Node 22),不要引入 npm 包。
- 新功能尽量做成新文件、新函数,入参显式传目录和配置;代码里不写默认的个人路径、设备名、内网地址。
- 每个导出函数上面一行中文或英文注释;一条语句一行,每行不超过 120 列。
- 改动要带测试,测试只写临时目录。
- 脚本默认只演练,真动手要显式加 `--apply`,目标目录必须显式给。

## 提交之前

```sh
npm test
```

仓库里有一个「开源卫生」扫描(`test/publish-scan.test.mjs`),会查个人路径、内网地址、密钥形状和超大文件。
你的改动不能让它多出新的命中。

## 已知失败的老测试

在作者的机器上,下面三项在基线版本里就已经失败(原因待查,不是新增内容引起的):
- `packages/hub-bff/test/r23.contract.test.mjs`:「目录不存在报 BOTS_DIR_MISSING……」
- `packages/hub-web/test/c6-contract.test.mjs`(整个文件)
- `packages/hub-web/test/https-serve.test.mjs`:「HTTPS:Serve 写入必须已有有效 cookie……」

如果你的环境里它们是好的或坏法不同,请开 issue 告诉我们。

## 提问题

用 `.github/ISSUE_TEMPLATE/` 里的模板。安全问题不要公开提,见 [SECURITY.md](SECURITY.md)。
