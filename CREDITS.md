# 致谢与第三方清单

只列事实：谁的东西、什么许可、怎么用的。新增借鉴请当场追加到本页。

## 运行底座（不在本仓库里）

| 项目 | 许可证 | 关系 |
| --- | --- | --- |
| DeepSeek Harness（DSH）· DeepSeek | MIT | 本项目运行在它之上。**本仓库不含它的任何源码或程序**，只通过它公开的接口（`/connect`、`remote.mux`、会话控制）按协议自写了客户端（`hub/packages/hub-bff`，只用 Node 内置模块）。你需要自己安装它。 |

## 代码：改编或内联，随附许可证

| 项目 | 许可证 | 用在哪里 |
| --- | --- | --- |
| CrossPet · lokicorvus 和贡献者 | 代码 MIT（角色立绘另见下「素材」） | 站台桌宠的状态机、停留时间、动作曲线和甩动判定，改编进 `shell/js/r29-pet/` 和 `shell/css/r29-pet.css`（每个文件头有声明，版权全文在 `shell/js/r29-pet/LICENSE-crosspet.txt`）。**CrossPet 的角色图和角色设定是 CC BY-NC-SA 4.0，一张都没有拷进仓库。** |
| Phosphor Icons | MIT，Copyright (c) 2023 Phosphor Icons | 界面图标，只内联用到的 path；许可证原文 `shell/LICENSE-phosphor.txt`。 |

## 只学了做法，没有拷代码

| 项目 | 链接 | 许可证 | 学了什么 |
| --- | --- | --- | --- |
| Tobs（BotHarness/DeepSeekBot） | https://github.com/BotHarness/DeepSeekBot | MIT | 单一联系点转交；报告五态与「超时不是失败」；摘要与全文分离加校验和。 |
| DS Bot（Fei2411/DS-Bot） | https://github.com/Fei2411/DS-Bot | Apache-2.0 | 名册和查同事；忙闲处理；请求幂等与「不确定不重发」；群管理的几条规矩。 |
| Grok Bot（xAI，闭源） | https://docs.x.ai/grok-bot/overview | 产品文档，非开源 | 一个 bot 管一件事、找谁说话谁办的使用体验。只作体验参照，没有源码。 |
| dsh-orb-cordis · mini-yifan | https://github.com/mini-yifan/dsh-orb-cordis | MIT | 前台步骤、后台回报与权限状态的交互方向。 |
| dsh-see-now · SAOS-3624；dsh-see-now-extras · cxi16238-star | https://github.com/SAOS-3624/dsh-see-now | Apache-2.0 | 按画面变化观察、陪看状态与关闭停止；只做了占位卡。 |
| dsh-video-storyboard · SAOS-3624 | https://github.com/SAOS-3624/dsh-video-storyboard | Apache-2.0 | 可引用分镜、先估算再放大的交互方向。 |
| Cortico · Pal AI Lab | https://github.com/Pal-AI-Lab/Cortico | MIT | 安静节律、事件合批、结构化表情词表方向。 |
| Coopanion · Pal-AI-Lab | https://github.com/Pal-AI-Lab/Coopanion | AGPL-3.0-or-later（附 Steamworks 额外许可） | 多套装扮与统一选择的交互方向；**没有使用其代码**，用自绘 SVG 占位。 |
| dsh-anime-voice、dsh-advanced-training · InariNGT-Ofiicial | https://github.com/InariNGT-Ofiicial/dsh-anime-voice | 仓库内无许可证文件，状态未证实 | 授权素材、试听、训练与播放分开的流程；**没有拷任何代码**。 |
| py-xiaozhi · huangjunsen0406 | https://github.com/huangjunsen0406/py-xiaozhi | MIT | 字幕、表情与音量口型的接口方向。 |

## 素材

- **随仓库分发的角色素材（六位，CC BY-NC-SA 4.0，不在 MIT 范围内）**：`shell/pets/`。逐位的形象来源、原设、许可、来源地址和改动见 `shell/pets/CREDITS.md`。
  - 首席助理「蓝毛小女仆」：形象设计 B 站 @ZipZipPipe（原型「溟月」出自 B 站 @上善无形），动画素材 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，汇集转码 [hunmer/aboutme-pets](https://github.com/hunmer/aboutme-pets)；我们做了选段裁切与 4 倍超分。
  - Grok / GPT / Claude / 千问 / Gemini 五位：[CrossPet](https://github.com/lokicorvus/crosspet)（lokicorvus 和贡献者）1.3.10 的立绘原文件，许可见它的 `characters/LICENSE.md`（原样附在 `shell/pets/LICENSE-crosspet-characters.md`）；原设作者 B 站 @ZipZipPipe（GPT、千问、Grok），Claude、Gemini 为社区流行设定。我们没有改动图片。
  - 非官方同人形象，与各 AI 公司无关；各公司名称为其商标。
- **没有随仓库分发的**：hunmer/aboutme-pets 里为这些角色另外生成的动作包（没有许可声明）；CrossPet 里其它角色与节日款。想接自己的角色包，自己放图、自己负责授权（见 `docs/角色包怎么自备.md`）。
- **字体**：界面样式引用 `fonts/` 下的圆体字（Resource Han Rounded CN，Cyano Hao，基于思源黑体，SIL OFL 1.1），但字体文件**没有放进仓库**；缺失时回落系统字体。你若自己放字体，请带上它的许可证。
- **图标**：`shell/assets/icons/` 的团子图标由 `shell/tools/make_icons.py` 用纯 Python 画出（几何图形），随仓库许可证。

## 说明

- 本项目是非官方社区项目，与 DeepSeek、xAI 等公司没有隶属或背书关系，见 `hub/NOTICE`。
- 发现遗漏或许可证标错，请开 issue，我们当场改。
