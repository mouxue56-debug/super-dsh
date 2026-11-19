# 角色素材来源与许可（pets/）

本目录共六位角色，全部是社区对 AI 产品的**拟人同人形象**，非官方，与各 AI 公司无关。**一律按 CC BY-NC-SA 4.0 分发：署名、非商业、相同方式共享。**
「Claude」「GPT」「Grok」「Gemini」「千问/Qwen」「DeepSeek」等是各自公司的商标。如果你是原作者并对使用方式有异议，请在本仓库提 issue，我们会第一时间修改或移除。

## 一览（逐位一行）
| 角色包 | 演示里的助理 | 形象来源与取用方式 | 原设（形象设计） | 许可 | 来源地址 | 我们做的改动 |
| --- | --- | --- | --- | --- | --- | --- |
| `dsh/` 蓝毛小女仆 | 总管（首席） | 动画取自 dsh-pet，经 aboutme-pets 转码为透明 WebP，再由我们裁段与超分 | B 站 @ZipZipPipe（DeepSeek 版女仆鲸鱼娘「大肥鱼」）；原型「溟月」：B 站 @上善无形 | CC BY-NC-SA 4.0（形象授权声明原文见下） | <https://github.com/PC2005-cloud/dsh-pet> · <https://github.com/hunmer/aboutme-pets> | 选段裁切、4 倍超分、统一画布、重编码（详见下） |
| `grok/` Grok 哥特小恶魔 | 调研助理 | CrossPet 立绘**原文件** | 哥特小恶魔女王：B 站 @ZipZipPipe（性格与专属动作为 CrossPet 二创） | CC BY-NC-SA 4.0（CrossPet `characters/LICENSE.md`） | <https://github.com/lokicorvus/crosspet> | 无（字节未改，只挑选了 19 张） |
| `gpt/` GPT 白龙御姐 | 设计助理 | 同上 | 「御姐白龙」：B 站 @ZipZipPipe | 同上 | 同上 | 无 |
| `claude/` Claude 橙花书卷 | 协调助理 | 同上 | 社区流行的 Claude 娘设定（铜橙色长发、橙花发饰、书） | 同上 | 同上 | 无 |
| `qwen/` 千问 国风千金 | 整理助理 | 同上 | 国风千金：B 站 @ZipZipPipe（性格与专属动作为 CrossPet 二创） | 同上 | 同上 | 无 |
| `gemini/` Gemini 猫耳娘 | 写作助理 | 同上 | 社区流行的 Gemini 娘设定（猫耳、异色瞳、四芒星发饰） | 同上 | 同上 | 无 |

## CrossPet 五位（`grok/ gpt/ claude/ qwen/ gemini/`）
- **来源**：CrossPet（lokicorvus 和 CrossPet 贡献者），<https://github.com/lokicorvus/crosspet>，版本 1.3.10，提交 `8954eb8f7f69fcfb8d35e9deceeb78e10c804402`。
  立绘由 CrossPet 用 AI 生图工具按上表的设定重新绘制。
- **许可**：CrossPet 仓库 `characters/LICENSE.md` 写明：`characters/` 里的角色立绘与设定采用 CC BY-NC-SA 4.0，「可以自由地转载、修改、二次创作」，须署名 CrossPet 与原作者、非商业、衍生品相同方式共享。
  该文件**原样**放在本目录：[LICENSE-crosspet-characters.md](LICENSE-crosspet-characters.md)。CrossPet 的代码是另一个 MIT 许可（只管代码，不管这些图）。
- **取了哪些文件**：每位 19 张，都来自 CrossPet 仓库里 `characters/<角色>/`（git 跟踪的文件）：`avatar idle idle-2 idle-3 pat greet_noon thinking writing running searching reading happy proud dizzy oops listening yawn tired sleeping`
  （Claude 的 `pat / happy / reading / sleeping` 在 CrossPet 里叫 `pat-2 / happy-2 / reading-2 / sleeping-2`）。
  逐个文件的 SHA-256、字节数、尺寸和它在 CrossPet 里的路径见 [MANIFEST-crosspet.txt](MANIFEST-crosspet.txt)，任何人都能对照 CrossPet 仓库核对「一字节没改」。
- **改动**：没有改动任何图片。我们只写了 `pack.json`，把这些静态姿态对应到界面状态（待机、思考、干活、查资料、完成、困惑、等待、犯困、睡着），仅此而已。
- **没有取**：CrossPet 里的其它角色、节日款、成对动作、`portrait` 大图、`docs/images`；也**没有**取 hunmer/aboutme-pets 里为这些角色另外生成的动作包（那批没有许可声明）。

## 蓝毛小女仆（`dsh/`）
| 项 | 内容 |
| --- | --- |
| 形象设计 | B 站 @ZipZipPipe（DeepSeek 版女仆鲸鱼娘）；原型「溟月」出自 B 站 @上善无形 |
| 形象授权 | CC BY-NC-SA 4.0。设计者声明（经上游 README 转引）：「大肥鱼是遵守 CC BY-NC-SA 4.0 协议的形象，不可以以任何形式商业化。」原文：<https://www.bilibili.com/opus/1247156596114456581> |
| 动画素材 | PC2005-cloud/dsh-pet：<https://github.com/PC2005-cloud/dsh-pet>（固定提交 `b78e3fcf92ac78cee569aed7cc27eeb2a8d51757`） |
| 汇集与转码 | hunmer/aboutme-pets：<https://github.com/hunmer/aboutme-pets>（把上游视频转成透明 WebP 精灵图） |
| 上游对素材的说法 | 上游 README「许可」一节：素材（动画/提示词/源视频）**允许开源使用，具体授权参考角色原型的形象授权**（即上面的 CC BY-NC-SA 4.0）；二创在 GitHub 仓库、产品官网等公开渠道须附上原作者 GitHub 地址（即上面那个）。汇集页另写「素材禁止商用」。原样保留的声明见 `dsh/NOTICE.txt`、`dsh/SOURCE-upstream.txt` |
| 说明 | 上游仓库的 LICENSE 文件只覆盖代码（MIT），素材条款写在它的 README 里，不是单独的许可证文件。**我们按「可非商业二创并署名、相同方式共享」理解这些条款**；上游若有异议，请提 issue |

### 我们做了什么改动（衍生作品，同样适用 CC BY-NC-SA 4.0）
- 从上游精灵图里挑选了若干动作并裁出帧区间；
- 用 realesrgan-x4plus-anime 做 4 倍超分，再缩放成 256 / 216 / 360 三档人物高度；
- 统一画布、重新编码为有损透明 WebP，生成静态首帧与头像；
- 没有改动角色的设计，也没有新增任何画面内容。
