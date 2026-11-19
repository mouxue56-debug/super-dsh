# art4 与真实适配层契约（r24，C 路）

本适配层只注入脚本，不修改壳。C7 对现用 `shell-r23/index.html`（SHA256 `2924f144c0d7b92b5ca3dd3dd08064b1eaef83e4805a526983b317fdb7ca4ea6`）与留存旧壳 `shell-r23.prev-20261117-201152-4145/index.html`（`a6ce9b75f467655c76da84fb4d217e1795a1fc15a7a20950c8bbf88396756912`）验证契约。两版只在独立假环境回归；本路不运行同步脚本、不切换现用壳、不重启现用链路。结构检查不能代替浏览器或真实链路验收。

| 接口/全局/选择器 | 用途 | 缺失后果 |
|---|---|---|
| window.Hub | 扩展入口 | 不接真实聊天 |
| Hub.h | 创建壳风格节点 | 卡片与面板失败 |
| Hub.on / Hub.emit | render/navigate 订阅与状态事件 | 导航恢复或角色观测失败 |
| Hub.navigate(route, {deferRender:true}) | 切换服务器会话对应的本地槽，再绑定隔离消息数组 | 无法打开会话或污染缓冲 |
| Hub.registerConversation | 为草稿/真实会话注册隔离槽 | 真实与样例可能混合 |
| Hub.postMessage | 追加用户及回复卡片；包裹阻止样例写入真实槽 | 无法安全显示真实消息 |
| Hub.registerCard | 注册安全 Markdown 回复卡片、审批信笺和派工卡 | 无法显示回复 |
| Hub.registerPanel / Hub.openPanel | 服务器会话列表、真实待批列表 | 无法选历史会话 |
| Hub.registerMoreItem({id,label,onClick}) | 新壳公开更多行注册；旧壳缺失时保留 DOM 回退 | 模式设置入口不可达 |
| Hub.setDemoContent(bot, enabled:boolean) | 新壳按助理切换演示装饰；真实会话 false，演示与能力样例 true | 演示信息混入真实会话 |
| Hub.setBotStatus(bot, {running,unread,pending}) | 新壳原生忙碌、未读与待批；旧壳只支持 active/paused，合法对象探测一次后走旧实现 | 跨助理状态不同步 |
| Hub.registerSettingsPage | 模式开关设置页 | 无法切换演示模式 |
| Hub.currentMessages / Hub.messageText | 消息内容兼容 | 历史与文本提取失败 |
| Hub.messageHTML / Hub.fromHTML / .bubble / .r22-nameplate / [data-nameplate-bot] / .r22-reply-status | 从壳的消息渲染接口取得助理气泡与身份名牌，清去样例状态字再填真实回复 | 真实回复缺失或样式偏离壳 |
| .r22-latest 及其 ::after | 沿用壳最新回复结尾的 ▼，由 measureDock 更新 | 最新回复缺少结束标识 |
| Hub.setMessageStatus | 回合消息状态 | 壳状态不同步 |
| Hub.measureDock | 更新输入区域尺寸 | 流式后底部布局不准 |
| Hub.toast | 简短操作反馈 | 反馈不可见 |
| Hub.petTurn / Hub.petState | 六角色 thinking/working/done/confused/idle | 角色不跟随真实状态 |
| Hub.conversationsHTML | 替换旧样例会话摘要 | 旧面板可能显示假列表 |
| Hub.runCapability | 包裹公开的能力演示入口，标记样例路由 | 六助理名下的能力可能触发历史读取 |
| Hub.reading.preserve / Hub.reading.release（state 供回归观测） | 流式局部写入进入壳的阅读事务，保留用户阅读位置 | 壳的锚点与增量更新竞争，可能抢滚动 |
| state.bot / state.view / state.detail / state.drawer | 判定当前助理、页面与面板 | 请求隔离或导航失败 |
| state.conversation / state.threads / state.sessionNames | 当前消息槽与会话标题 | 会话内容错位 |
| state.bots[*].unread | 六助理未读点 | 首页未读不同步 |
| state.running / state.emotion | 在想/在说/完成/出错状态 | 输入停止与表情不匹配 |
| state.input / state.settingsTab | 发送后清空草稿、打开模式设置 | 输入文字残留或模式入口失败 |
| window.render | 历史切换与模式刷新（流式禁止调用） | 导航页面无法刷新 |
| window.setChiefFace / window.animateChiefDone | 首席表情与一次完成动作 | 首席完成反馈缺失 |
| render / navigate 事件 | 渲染修饰、恢复与样例边界 | 跨页同步失效 |
| hub-real:state 自定义事件 | 每次角色转换的开发期证据；不依赖壳预置该事件 | 缺少观测记录，不影响请求 |
| [data-focus="composer"] / .composer-area | 捕获真实聊天输入 | 演示发送可能越界 |
| data-act=send/stop/sessions/new-session/bot | 接管发送、停止、列表及显式切换助理 | 操作退回样例路径 |
| data-act=retry-message/continue/branch-session/rename-session/archive-session/pin-session/session-open/create-session/extra-session | 截住旧壳的样例会话操作 | 样例标题/分叉进入真实槽 |
| 按钮 aria-label 中的重新生成/重试回复/失败处继续/从此处分叉 | 阻止 interact 的演示重烧入口 | 演示状态可能覆盖真实状态 |
| .title-model / .shell-title-meta | 标题旁显示未连接；新聊天标题无旧 label 时创建小 label | 健康状态不可见 |
| .thread-inner / .thread | 局部更新与滚动跟随 | 流式显示或阅读位置异常 |
| .bot-unread / [data-bot-tree] / .preview / .pin / .home-row-meta | 首页原有未读点、忙碌状态和服务器预览 | 跨助理状态不可见 |
| .setting-row / [data-hub-settings] | 设置页模式开关 | 模式入口丢失 |
| .capability-card / [data-capability-steward] | 能力样例角标 | 样例身份不明显 |
| [data-pet-stage] / chiefPet.sync/turn/state | 角色插槽及角色状态 | 视觉角色不更新 |
| .voicebtn / [data-pet-status] | 局部切换停止按钮、在想/在说标签 | 需要整页刷新才能反映回合状态 |
| .floatinghead .titlepill strong / .page-title h1,h2 / .drawer .dhead h2,strong | 看板/账本/审批等样例标题角标 | 样例身份不明显 |
| .shell-activity h3 / .shell-activity-column > h3 / .decision-shortcut strong / [data-activity-open] / .ledger-shortcut / .chat-quick-slot h3 | 活动、账本与聊天摘要的样例角标 | 样例身份不明显 |
| .bot-capabilities h3 / [data-capability-phrase] | 能力角标与样例点击隔离 | 六助理名下能力可能误读真实历史 |
| [data-activity-source] / [data-activity-target] / [data-activity-reply-send] / [data-r22-assistant] | 样例跳转保留隔离，显式切助理恢复真实路由 | 样例跳转可能触发 BFF |
| .r22-home-dock [data-act="more"] / .drawer .r22-sheet-content | 从底栏更多进入，在更多面板末尾追加连接设置行，真实和演示模式都保留 | 模式开关入口丢失 |
| .r22-tool-call | 隐藏壳硬编码的“查了知识库”示例 | 容易把样例引用当真实引用 |
| .m-persona-today / .chat-quick-slot / .hub-quick / .shell-memory-mount / .ledger-shortcut | 真实聊天隐藏演示摘要、演示快捷短语、记忆及账本环，chat-quick-slot 放服务器短语；演示模式仍保留 | 真实消息里混入演示内容或数字 |
| .composer-area .hub-status / [data-context-mix] / .queuebar / .thread [data-reply-wait] | 隐藏演示输入区数字、队列与重复停止入口 | 出现假数或两处停止按钮 |
| .thread-inner > .time-stamp / [data-message-id] / .message-meta | 隐藏固定日期，按每条消息 ts 插入真实分日与时刻；缺 ts 不编造 | 日期错误或出现假已读 |
| .message-footer .token / .hub-memory-tag | 隐藏壳固定 token、记忆数据 | 无真实来源的消息计量泄漏到真会话 |
| .home-top / .side-bottom / .compact-bots / .floatinghead | 顶栏按钮和聊天顶栏禁止插样例角标；进入具体页面后标注 | 角标遮数字或与标题抢视觉 |
| .pin > strong / .home-assistant-unread | 名字禁止收缩，轮询添加未读点沿用壳绝对定位 | 名字被流内未读点挤到 0px |
| .drawer [data-hub-panel]（无面板 ID 值） | 在 state.drawer=hub-real-sessions 时刷新已打开的服务器列表 | 新壳列表停在旧内容 |
| Hub.subBots(bot) / .home-child-count / .shell-sub-avatars / .r22-unread-dot | 有分助理时使用壳原生角落红点，清零后恢复分助理个数；无分助理沿用 .home-assistant-unread | 未读重复、漏报或错误覆盖名字 |
| .r22-home-busy | 只用最近一次 GET status 返回的六助理 running 数；零时隐藏；手机非首页沿用壳顶栏图标补活动入口，使跨页待批可见可点 | 留下演示忙碌数 |
| .r22-input-row / .voicebtn / data-act=send/stop/voice | 新 composer 发送保焦点、同一触摸的兼容 click 去重；按钮换节点时也不误停 | 键盘首点落空或重复发送 |
| data-act=session-menu/sessions / .drawer [data-hub-panel] | 新会话菜单进入服务器列表，按当前助理筛选及恢复历史 | 回到演示列表 |
| .r22-board-heading h1 / state.customTitle=活动中心 / .drawer .dhead h2 | 看板与活动页内加轻样例角标；App 图标行继续在名字旁标 | 新页漏标样例 |
| chief/support/content/pm/art/research | 唯一真实发送白名单 | 对应助理不可用 |
| </body> | 服务端注入锚点 | 脚本未注入 |

## 壳钩子需求

C6 已消费新壳公开的 `registerMoreItem`，同一 id 更新标签，不再在新壳查询或追加 `.drawer .r22-sheet-content`。旧壳缺少接口时仍在该容器末尾追加设置入口；两版共用 `registerSettingsPage` 的「连接模式」设置页。下表的演示隐藏清单和忙碌文本选择器仅用于旧壳回退；新壳对应规则以文末 C6 为准。
角色的公开状态名 working 对应「在说」；现有角色包把 talking 归并为 working。适配层不修改素材或角色状态实现。

## 检查脚本

`node ops/check-adapter-contract.mjs <index.html路径>`

只读输入、只用 Node 内置模块；逐条报告缺项，全部存在退出 0，缺任一项或读取失败退出 1。

## 数据、网络与行为边界

- 默认真实；localStorage 只保存连接模式，不保存正文、会话列表或未读计数。
- 使用 GET health/status/sessions/history/stream/presets/events/cards/approvals 与 POST sessions/messages/cancel/read、approvals/:id/answer。唯一 messages 入口先断言六助理白名单；只由明确的聊天输入或回复下方手动重试触发，不订阅壳 message 事件来发真实请求。
- 新会话先在内存注册草稿，首次发话才 POST sessions；标题/预览/未读来自服务器。服务端未提供改名/分叉/归档协议，本轮截住旧壳的这些演示操作。
- 流式只替换当前回复节点，80ms 节流；整页 render 只用于导航和历史恢复。仅当更新前距底部不超过 80px 时跟随。
- 首个 delta 先同步切角色到 speaking/working 及「在说」，再安排文字绘制，角色不受 80ms 节流影响。
- 发送键在捕获阶段 pointerdown 保持输入焦点，pointerup 发送；兼容 click 去重，取消/拖出不发送。无 PointerEvent 才用非 passive touchstart/end 回退。只处理 .composer-area 内 data-act=send，停止、语音及其他控件沿用原有事件。
- pointerup 触发的发送延到下一任务执行，让原生 touchend 先抵达壳，再换按钮图标；否则触摸目标 SVG 脱离 DOM，壳会误以为仍有手指按住并挂起历史重绘。适配层不读写壳的内部触摸状态。
- 右下角发送键是唯一停止入口；气泡中仅显示轻进行中指示或人话错误与重试。完成不显示「已保存」「回复完成」，只有消息时间。
- 真实日期来自历史消息 ts 或本次消息的本机发生时刻；历史 ts 缺失时不补假日期。服务器会话预览转成纯文字，气泡正文仍安全 Markdown。
- SSE 重连只重新订阅，绝不自动重发 messages；退避 1/2/4/8/8 秒，首次断线起总重试预算不超过 30 秒，state.partial 替换当前文本。超过预算显示“连接断了，回复可能没收全”和重新加载。
- 页面可见时每 5 秒取健康、状态和会话列表；后台停止轮询，前台按服务器 running 决定续流或历史恢复。
- 首页先加载完清单再打开助理，也应将自动空草稿接回按 updatedAt 最新的服务器会话；用户点「新会话」得到的 fresh 草稿例外，不抢走。
- 样例点击保持 sampleRoute，六助理名下的能力演示也不读真实历史或发真实消息；只有显式切助理/打开真实服务器会话才恢复真实路由。
- HubReal.state() 和 hub-real:state 是只读开发期观测；HubReal.sendText 的非六助理断言在任何 fetch 之前抛错。不会暴露服务钥匙。

## F 路失败与恢复约定

- 发送入口先追加用户消息及回复位；历史加载失败不在入口挡住发送。确需先恢复历史时在接纳任务内进行，失败也显示出错角色与中文反馈。
- 创建会话/加载历史失败、或明确服务不可用时，显示「没连上服务，这句没发出去。请重试。」；重试复用同一未发出气泡，按钮绑定该条回复 ID，不会错发另一条提示。
- 请求超时、接纳结果无效等无法确认送达的情况，明确说明「这句可能已经送达」，手动重试沿用原 idem，不重复追加用户气泡；不自动重发用户消息。原始英文错误体不进入界面。
- 任一成功 JSON 请求或 SSE 建连即时显示已连接；失败即时显示未连接，不等待五秒健康轮询。这里只代表最近一次服务通信的结果。
- 未加载的历史恢复后，再接上当前用户消息和回复位，不丢这次输入；刷新/换设备只恢复服务端实际保存的内容，未发出输入不持久化正文。
- 顶栏在跑数只取 status；本地尚待接纳的回合可让相应角色卡先显示忙碌。接纳/完成时补取一次 status，其余仍按五秒轮询。

- 真实回合的两个角色状态标签都按在想／在说／做好了／出错显示。只观察标签自身的文字变化，防止壳动画把错误提示改回「没听懂」；不修改角色动画或壳源码。


## r24 增量接口与结构

【Owner要求】来源：公共工单与工单 C。以下实现与技术检查不等于 主人 真机验收。

| 新依赖 | 用途与约束 |
| --- | --- |
| Hub.avatar / Hub.botStyle / Hub.icon | 最近会话与派工目标沿用壳的角色头像、颜色；不新造头像 |
| Hub.registerActivity / Hub.completeActivity / Hub.clearActivities / Hub.restoreActivities | 将真实待批登记成活动；真实模式的活动入口展示独立真实待批面板，避免样例“标为已处理”冒充审批；切换演示时暂时清理真实活动，切回恢复 |
| .mcard.r22-letter > .r22-nameplate / h3 / .params dt,dd / .actions / .result | 直接复用壳审批信笺 DOM 与类名；审批和派工都通过 registerCard 挂载 |
| .shell-level-sticker[data-level-sticker] / .diff .add,.del,.ctx | 复用 L3 贴纸、等宽差异和壳已有绿/红配色变量 |
| .home-recent-list / .conversation / .line / .preview / .home-row-meta | 真实模式替换最近列表内容，只列六助理服务器会话；演示模式由壳原样渲染 |
| [data-activity-open] / [data-r22-activity-total] / .r22-badge / .iconbtn.r22-round / .floatinghead | 将底栏与更多活动入口的徽标替换为 status.pendingTotal；零时隐藏；手机非首页沿用壳顶栏图标补活动入口，使跨页待批可见可点 |
| .chat-quick-slot / .ghostbtn | presets.phrases 的三条短语，点即 sendText；空时整行隐藏 |
| .pop-input / data-focus | 改稿输入沿用输入样式；全页渲染时通过壳焦点恢复约定保留光标 |
| .shell-title-meta | 仅真实六助理聊天设置标题和连接状态；C2 撤掉非真实聊天页新增的“样例”标 |

`setBotStatus(id,status)` 已检查：当前壳仅支持 `active/paused`，不能传入等待审批；角色状态沿用 `[data-pet-status]` 显示“等你点头”，首页使用现有 `.pin > small`。未发现“更多菜单追加行”与“隐藏演示内容”公开开关，继续原有选择器注入。没有修改 `shell-r23/`。

### 状态与请求

- 真实模式在任何页面维持且仅维持一条 `EventSource('/bff/events')`；接收 status/card，后台也保留连接；切到演示时关闭。重连先取 pending 卡，再取已见会话卡以恢复 BFF 重启后结束的审批，状态从服务器取，不自行宣称获批。
- 打开远端会话读取 history 与 cards；以 createdAt 合并消息流，按 `type:id` 去重，状态更新复用同一数据对象；拒绝已结束审批回退 pending。倒计时每15秒更新，归零后等待服务器 timeout 结果，不伪造完成。
- 审批只 POST decision/note；note 最多500字，成功或409后读取服务器卡片；无成功回执不显示已批准。按钮在结束后消失；答题进行中禁用。
- 派工卡显示排队位次、模型步数、完成摘要/失败原因；点击回报按 toSession 打开目标助理会话。首页忙碌取 running 与 delegated，未读数取 status.unread；不把派工摘要当全文。
- 首页最近会话按 updatedAt 降序，含角色、最后一句、未读点；从首页点击助理总是选服务器最新会话。只有菜单“新会话”才打开 fresh 草稿；首次发送才创建服务器会话。
- 每次首次发送使用 `crypto.randomUUID()` 生成 idem，手动重试（含断线）沿用同号及同一用户气泡；自动 SSE 重连不发 messages。幂等保证依赖 BFF 的10分钟窗口。
- Markdown 有序列表用 start 和 li.value 保留原序号，跨段落也不回到1。正文、卡片预览、路径以 shared/... 等相对 ~/dsh-work/ 的形式显示；预览与差异均通过 textContent 或已有转义输出。
- 手机首页（detail=false）渲染不触发聊天恢复，避免活动弹层或 SSE 卡到来抢走首页。

### C2 首页依赖清单（2026-11-17）

【Owner要求】来源：`工单-C2-范围调整.md`。真实最近仅六助理会话，隐藏管家样例行；管家聊天页恢复 r23，不追加新标识。审批/派工通过 `registerCard` 放入六助理会话，审批活动通过 `registerActivity/completeActivity` 登记；不注册管家角色。切演示时壳重新渲染，原样例最近行保留。

【已核验】【Owner未确认验收】当前壳没有最近会话数据源、首页状态文案/未读/忙碌计数、活动入口/徽标或更多菜单扩展接口。已有语义匹配的公开接口均已使用；`setBotStatus(id,status)` 仅接受 `active/paused`，不用于忙碌或待批，以免改变启用状态。下表登记仍需保留的首页选择器；适配层自己的 `data-real-*` 与 `.hub-real-*` 不属于壳结构依赖。

| 首页选择器或结构 | 用途 | 公开接口与保留原因 |
| --- | --- | --- |
| `.home-recent-list`；渲染类 `.conversation/.grow/.line/.preview/.home-row-meta` | 将最近列表替换为真实会话；沿用壳排版 | `registerConversation` 已用于消息槽、`avatar/botStyle/h` 已用于节点；壳 sidebar 直接生成最近行，`conversationsHTML` 不负责这块，无最近列表接口 |
| `[data-bot-tree]`、其 `strong/.pin > small/.preview` | 识别助理、显示待批/忙碌/服务器预览；非六助理旧样例角标 | `setBotStatus` 只启用/暂停；没有运行、待批和预览写入接口。真实最近移除样例行后不会再渲染管家行 |
| `.home-row-meta/.pin`、`.bot-unread/.home-assistant-unread` | 给没有分助理角落的助理显示真实未读点 | 未读来自 status 写入 `Hub.state.bots[*].unread`，没有公开未读 setter；局部更新避免轮询重绘整页 |
| `:scope > .shell-sub-avatars .home-child-count`、`.r22-unread-dot`、`.pin .bot-unread` | 真实模式角落只显示 status.unread 红点，避免双红点，清零隐藏演示计数 | 壳的 `subBots` 包含演示子助理，不能作为真实数量；没有角落徽标更新接口 |
| `.r22-home-busy` | 顶栏在干活数量仅取 status.running，零时隐藏 | `petTurn` 已用于角色动作；没有首页忙碌数接口 |
| `[data-activity-open]`、`[data-r22-activity-total]`、`.r22-badge` | 活动入口转到真实待批面板，徽标取 pendingTotal | 活动数据用公开 `registerActivity/completeActivity/clearActivities/restoreActivities`，面板用 `registerPanel/openPanel`；壳徽标混算样例活动与 pendingInputs，公开活动 API 不能精确设置真实待批总数或替换入口 |
| `.floatinghead`、样式 `.iconbtn.r22-round` | 手机非首页补可见活动入口 | 头像/图标使用公开 `icon/h`；壳在非首页隐藏底栏，没有跨页入口挂载接口 |
| `.home-top/.side-bottom/.compact-bots/.floatinghead`、`.pin > strong` | 排除顶栏角标、保证名字不收缩 | 沿用 r23 展示保护，没有相应公开样式/角标排除接口 |
| `.drawer .r22-sheet-content`；壳按钮 `data-act=more` | 首页更多里追加连接模式入口 | 用公开 `registerSettingsPage` 注册实际设置页；没有更多菜单行注册接口 |
| 壳按钮 `[data-act=bot]/[data-r22-assistant]`、`data-id` | 点击六助理后打开服务器最新会话 | 实际导航用公开 `navigate`；没有首页助理点击前处理接口，保留捕获监听以阻止原样例导航 |

第四期/若提供上述接口，按语义替换对应条目即可；本轮不改壳、不新增壳 API，也不以停用助理或清理壳演示状态来消除选择器。

### 服务端设备与来源

`server.mjs` 为每个登录浏览器签发独立的随机 ID + HMAC cookie；`X-Hub-Device` 是 ID 的 SHA256 前16位，是非密钥标识。每次 BFF 反代仅从请求头白名单重建头，忽略客户端 X-Hub-Device；同一 cookie 的设备 ID 重启后稳定，不同登录 cookie 不同。tailnet/本机免钥匙首次 GET 也发同类 cookie。旧的 r23 cookie 只读访问升级，不允许直接写。

所有 BFF POST（并扩及其他非 GET/HEAD/OPTIONS）必须有有效的新设备 cookie、与实际 Host 一致的 http Origin，且 Sec-Fetch-Site 缺省或精确 same-origin。缺 Origin、无 cookie、伪造/重复 cookie、same-site/cross-site/none 均403，不抵达 BFF。浏览器同源 fetch 自动发送 Origin，390×844 实际浏览器已覆盖发送和审批。Idempotency-Key 在反代白名单内。

### 离线验证入口

- `node --test test/client.test.mjs test/server.test.mjs test/r23-server.test.mjs test/r24-server.test.mjs`：Node 内置模块，假 HTTP 服务/壳/信任查询。
- `node ops/check-adapter-contract.mjs shell-r23/index.html`：检查本页登记的公开接口和壳类名。
- `node test/r24-preview.mjs`：仅本机3591假 BFF + 3592 web，测试凭据是明确的离线常量，写入 test/r24-fixtures，不读取任何既有凭据；做完 SIGTERM 该进程。
- <host> `node test/r24-browser.cjs`：复用工单指定 playwright-core、Chromium；390×844，单浏览器串行；截图输出 HUB_R24_SHOTS（默认当前目录 shots）。所有非127.0.0.1请求拦截；假服务 fixture 控制路由只存在 mock-bff，不存在真实服务。


### C3 最近行布局与角标修正（2026-11-17）

【Owner要求】来源：`工单-C3-最近列表修正.md`。真实首页最近复用壳样例按钮的两行 DOM：`avatar + .grow(.line > strong 助理名、.preview 最后一句) + .home-row-meta(time、可选 .bot-unread)`。标题不单独展示，仍参与搜索；不新增高度或行高 CSS。名字、预览、时间与头像的位置全部交给壳现有样式。

【已核验】【Owner未确认验收】壳 `SUB_BOT_SRC` 中的 `support-line`、`support-sns` 令 `Hub.subBots('support').length` 为 2，原 `corner()` 在未读为零时生成“+2”；它是演示分助理数量，不是 BFF 未读。真实模式隐藏这类计数，只有 `/bff/status`（含全局 SSE status）的 `bots[bot].unread` 非零时沿用壳原角落红点；归零后隐藏且不还原“+N”。演示模式仍由壳原样生成。

离线浏览器回归支持 `HUB_R24_BROWSER=chromium|webkit`、`PLAYWRIGHT_CORE`、`WEBKIT` 与 `CHROMIUM`，均只复用本机已有版本，不下载；390×844、`deviceScaleFactor:3`。除截图外核对行框内文字/头像、相邻行不相叠、时间位置、预览省略、长标题/长预览、未读 0→2→0 及演示恢复。截图和几何数据写入 `HUB_R24_SHOTS`；`HUB_R24_PREFIX` 可区分浏览器。假服务 `__fixture` 的 session 分支只改本地假会话并推 status，不存在于真实 BFF。

`HUB_R24_LAYOUT_ONLY=1` 仅执行 C3 的首页布局、长文本与真实未读变化检查，结果为 `layout-results.json`；默认仍执行完整审批/派工/发送/演示切换回归。完整回归的失败不得以布局结果替代。

### C4 工具痕迹与统一时间轴（2026-11-17）

【Owner要求】来源：`工单-C4-会话内工具痕迹与卡片顺序.md`。以下是适配层已消费、假 BFF 已提供的最小接口提案；真实 BFF 尚须监工接入，不能将假环境验证视作真实完成。

- history 每条 `{role,text,seq,ts?,tools?}`；`seq` 必须是同一会话 DSH 事件的单调序号，消息来自 `event.seq`。`ts` 如有需为可信时间（epoch 毫秒或 ISO）；不得用会话 updatedAt 给整批消息伪造同一时间。工具步骤即使无正文也保留 `tools`，纯空正文且无工具不显示。
- `tools:[{id,name,path?,level?,status,brief?,approvalId?,seq,ts?}]`：`id` 使用稳定工具 callId；status 为 `running|pending|approved|ok|denied|rejected|error|timeout|unavailable|revised`。`ok` 只能来自实际执行成功；`approved` 只表示批准。brief 是短摘要/拒绝原因，不传原始工具输出、参数正文或隐藏推理。工具若晚于所属 assistant 消息，提供其自身 `seq`，不能借用更早正文的序号；更新同一 id 时保持第一次执行/请求坐标。
- 所有审批卡、派工卡补不可变 `seq`：审批对应 `approval/asked` 事件，派工对应创建工具事件。卡片状态更新沿用首次坐标，不能拿 resolvedAt/updatedAt 重排。若 BFF 无法把三类条目映射到同一 DSH 序号，则**全部条目**改用持久化、同源、可比较的 `ts/createdAt`，不能混用不同计数器。
- stream `message` 透传与 history 一致的 `seq/ts/tools`，并给文字消息稳定 `id`（建议字符串 event.seq）；新增 `event:tool`，data 为上面 tools 的单个对象，执行中/完成/拒绝更新沿用同一 id。历史与流式重复工具按 id 合并。现有 `card` 事件同样补 seq。
- 排序一次只用一种坐标：所有定稿条目都有 seq 时按 seq；否则所有条目都有可信时间时按时间，同毫秒保持稳定顺序。仍缺坐标的旧历史保留接收顺序，不以 0 或本机时间冒充历史发生时间；这类会话跨卡片的精确顺序仍需 BFF 补字段后验收。本机待接纳用户消息锚定在发送前最后已知序号之后，正在回复占位保留在已知序号末端；定稿从 history 恢复。
- 工具通过 `registerCard('hub-real-tool')` 展示为一行轻量痕迹；仅这些 article 用 `.hub-real-tool-message` 隐藏原消息操作栏，无气泡或名牌。读取、L1 写入、审批等待/批准/拒绝和 L4 原因区分显示；审批批准不冒充写入成功。
- 流式多步骤正文分别保留；回合完成后重取只读 history 作定稿，空完成占位移除。审批状态和工具状态变化保持原位置，切页/重载继续取服务端事实。

C4 验证入口：`node test/c4-browser.cjs`；WebKit 沿用 C3 的 PLAYWRIGHT_CORE/WEBKIT 路径及 `HUB_R24_BROWSER=webkit`。截图 `c4-chromium-*.png` / `c4-webkit-*.png`，390×844、3倍。mock-bff 的 `__fixture` timeline/events/finalMessages 仅为回环测试控制，不是正式接口。

## C5 · 审批人话、合并工具条与原壳开场胶囊（2026-11-17）

【Owner要求】来源：`工单-C5-卡片人话与工具条.md` 的 Fable 18:43 裁定。

【AI实现选择】【Owner未确认具体验收】审批标题按 tool、shared 区域及 edit/diff 信号生成动作；不查询文件、不从模型预览推断是否存在。write 无 diff 时使用“把一份文件写进共享区”，不声称已新建。去掉重复的“级别/动作”参数行，保留左上 L3、路径、字数、≤200字预览或≤600字 diff、可选 `why`（去空白后≤80字）、剩余时间。why 为空不画行；所有内容用文本节点渲染，按钮与结果文案沿用。

【接口消费】C5 仅新增消费审批对象 `why?:string`；假 BFF 已提供非空示例，真实 BFF 的来源与接入由 B3/监工负责。本实现不改真实 BFF，不从缺失 why 编造动机；工单类型使用 ticket_update / ticket_move 区分修改/移动。具体工具结果继续来自 C4 的 tools / tool 事件，不从模型自述生成成功记录。

【AI实现选择】【Owner未确认具体验收】复用只读壳中 chatView() 的 `<details class="r22-tool-call"><summary>图标、标题、small、chevron</summary><div class="r22-tool-body">…</div></details>`，保持其虚线边框与原生展开行为。相邻 hubToolId 消息合并为“做了 N 步”；不改变底层消息、seq、工具id或卡片，遇到正文、用户消息或卡片即断组。后续成员 article 隐藏，详情中每步仍有动作、完整路径（存在时）及结果。重绘按会话与首个稳定工具 id 保持展开；单步摘要长文省略，展开保留全文。批准不代表完成，运行/拒绝/失败不用完成语态。审批步骤依旧由原卡操作，工具详情只记状态。

【AI实现选择】【Owner未确认具体验收】开场短语恢复 `.chat-quick-slot > .hub-quick.hub-real-phrases > button.ghostbtn`。撤掉适配层对槽与按钮的自造尺寸，沿用壳的30px高度、500字重、滚动容器；真实胶囊去掉末尾渐隐以便滑到末尾时完整读第三条。演示 `.hub-quick` 与示例知识库条仍隐藏于真实聊天，真实工具条与真实短语除外。壳文件未写入。

验证入口（仅假 BFF 3591/web3592，使用已有浏览器）：

```sh
~/.local/bin/node --test test/client.test.mjs test/server.test.mjs test/r23-server.test.mjs test/r24-server.test.mjs
~/.local/bin/node ops/check-adapter-contract.mjs shell-r23/index.html
node test/c5-browser.cjs
HUB_R24_PREFIX=c5-c4-chromium- node test/c4-browser.cjs
```

C5 专项包括含/不含 why、已有文件 diff、改别人工单、原生点击收起/展开三步、分组边界、更新与重绘、真实结果、短语起点/末尾、长度与纯文本边界。`c4-browser.cjs` 已支持 `HUB_R24_PREFIX`，按合并展示读取各步骤，并在截图前展开祖先 details；C4 原有 seq、流式中间态、去重及审批真实性断言保留。WebKit 采用本机已有 playwright-core 1.60.0 与 webkit-2311；历史头像预取错误不得过滤或当作通过。实际运行结果及缺口以 `回执-C5.md` 为准。


## C6 · 同时跟随新旧壳（2026-11-17）

【Owner要求】来源：`工单-C6-跟上新壳.md`，新壳三个公开入口以暂存文件真实实现为准，保留现用旧壳兼容。

【AI实现选择】【Owner未确认验收】`registerMoreItem({id:'hub-real-mode',label,onClick})` 注册连接模式；`setDemoContent(bot,false)` 关闭六助理真实聊天的演示装饰，演示模式以及六助理名下的能力样例重新 true。新接口分支不注入旧版演示隐藏清单，也不使用 `.r22-tool-call:not(.hub-real-tool-trace)` 的 hidden 操作。旧壳缺方法才启用这些回退。

【已核对源码】【确认状态待核】新壳 `setBotStatus` 的对象分支只接收 `running:boolean`、`unread/pending:非负整数`；不支持 thinking/speaking/waiting/error 字符串。适配层仅在三个计数发生变化时调用，避免每次装饰重建 sidebar；调用后再填真实最近与角落红点。待批用 pending、在想/在说与派工排队时合成为 running；细分角色阶段继续 `petTurn`、`setChiefFace` 与 `[data-pet-status]` 标签。旧壳拒绝第一次合法对象探测后，本页不再用对象调用。

【AI实现选择】【Owner未确认验收】演示开关也会隐藏与真实内容共用的 `.r22-tool-call`、`.chat-quick-slot/.hub-quick`。新分支仅为 `.hub-real-tool-trace`、真实短语及其非 hidden 槽补可见性规则，不重新维护演示隐藏清单。真实工具展开仍由原生 details 提供，短语沿用壳布局。

仍然依赖的壳选择器：

- 首页 `.home-recent-list` 与最近行的 `.conversation/.grow/.line/.preview/.home-row-meta`：当前没有服务器最近列表注册接口，适配层继续用真会话填充。
- `[data-bot-tree] .shell-sub-avatars .home-child-count/.r22-unread-dot`：新状态接口传递真实 unread，但壳仍会显示演示分助理 +N，故真实模式继续清除假计数，未读归零隐藏角落。
- `.floatinghead`、`[data-activity-open]`、`[data-r22-activity-total]`：跨页真实待批入口与数字；新原生 running/pending 首页文案由壳负责。
- `.shell-title-meta`、`.thread-inner/[data-message-id]/.message-meta`、`.bubble/.r22-nameplate/.r22-latest`：真实会话标题、时间轴、气泡及完成标识。
- `.chat-quick-slot`、`.r22-tool-call` 及适配层自己的 `.hub-real-*`：复用真实短语和工具条外观；新壳只加上述可见性例外。
- `.composer-area/.voicebtn/[data-focus=composer]/.r22-input-row`、`[data-pet-status]`：输入、保焦点发送、停止与细分状态标签。
- 能力、活动、账本、抽屉等样例角标及原样例按钮隔离仍保留；新接口不提供这些业务数据。更多面板容器、旧演示隐藏清单、手动 `.pin > small/.hub-real-busy/.r22-home-busy` 状态文案仅旧壳使用。

契约识别任一新接口实现或对象状态分支后，要求三个接口成组导出，检查 running/unread/pending 校验、事件、菜单回调及布尔开关；旧壳允许两项新方法缺失，但仍检查 setBotStatus active/paused。`test/c6-contract.test.mjs` 对两份实际壳及删字段/删导出的反例验证，不能把契约通过当作行为通过。

假预览：`HUB_R24_SHELL=shell-r23|shell-r23.next node test/r24-preview.mjs`（只接受这两个目录，固定3591/3592）。四套既有脚本 r24/c4/c5/f1 串行运行；F1 增加与其他脚本一致的 `HUB_R24_BROWSER`/`WEBKIT`/`HUB_R24_PREFIX`，`HUB_R24_TIMELINE` 仅可指向本轮复制的只读 BFF timeline 模块供造假数据，默认仍用相邻包。C6 钩子专项还校验注册调用、双向模式切换、真实短语可见、未读与最近不丢失、旧壳探测一次和零外网请求。实际矩阵结果、失败与壳报警以 `回执-C6.md` 为准。


## C7 派工与发送状态

派工消费 `steps[].label` 的人话，独立的旧枚举作中文兜底，文件名不翻译。超过四个工作步骤用原生 details 折叠，派出/开始/完成在外层；展开状态按卡 id 在内存保留，不写正文缓存。摘要沿用 BFF 的 Markdown 清理和 Unicode 400 字上限。

仅 failed 且步数上限的卡可续做；`continuedBy` 表示已续过。POST `/bff/delegations/:id/continue` 用统一 api 的 same-origin cookie，hub-web 所有写请求的 cookie、Origin、Sec-Fetch-Site 校验覆盖此路由，设备头仍由代理重建。消费 `{ok,card,continuedBy,continuation}`，原卡与新卡分别去重更新。409 提示“已经续过一次了”并重新读取卡片；在途按钮禁用，服务端仍负责最终只续一次。

取消枚举由 done/error 的 reason 识别为已停止；重开会话由 lastRole=error、lastText=已停止、非 running 恢复终态，不把一般失败替换成停止。502/503 或 fetch 网络 TypeError 显示“没连上服务，这句没发出去”及重试；超时、中止、成功响应但回执缺失/无效仍提示先重新加载核对。浏览器无法单凭网络异常证明服务器没有接收；保留同一 idem 重试，不重复投递。

## C · 命令审批与权限（2026-11-17）

来源：`工单-公共.md`、`工单-C-审批卡与权限页.md`。实现与离线验证，不表示真实链路已切换或用户验收。

- `GET /bff/status` 增加 `hubHome:string`、`commandGrantDays:number`。目录只在完整根边界内缩写；不从用户名猜目录。默认根来自 `HUB_HOME`，缺省 `os.homedir()/dsh-work`；旧的 BFF 显式配置目录参数仍保留供安装与隔离测试使用。
- 命令审批沿用已核验的审批 ID、会话、bot、tool 对齐；在原卡字段上增加 `command`、`cwd`、`why`、`timeoutMs`、`caps:{network,writeRoots,longRunning}`、`grantable`，可放行时有 `grantKey:{program,dir}`。命令与原因按 Unicode 字数限制 2000/200，超时为正整数且不超过 600000ms；新增字符串不接受换行、制表符与控制字符，目录须绝对路径；权限对象及程序/目录对象拒绝多余或缺失字段。坏卡继续失败关闭。普通文件卡契约保留。
- `POST /bff/approvals/:id/answer` 接受 `{decision:'approve'|'reject'|'revise',note?:string,remember?:boolean}`。`remember:true` 只给可放行的命令批准使用。写成功规则与权限日志后，再落审批审计/卡片并向内核答 `allowed-once`；保存放行规则失败返回 503，卡仍 pending，不向内核答批准。单卡在途锁拒绝竞争回答；普通审批沿用原行为。成功记忆的卡有 `remembered:true`，`approvals.log` 结果列为 `approved+remember`。
- 放行文件为配置目录下 `command-grants.json`，`{v:1,grants:[{id,bot,program,dir,caps:{network,writeRoots},by,on,until,tag,createdAt,cardId,revokedAt}]}`。原子写 0600；日志 `permissions.changes.log` 为 0600，依次追加 `grant-add|grant-extend|grant-revoke`。使用东京日期，天数取 `tool-levels.yaml` 的 `cmd_grant_days`，不可读或无效时 30。相同助理/程序/目录的有效规则更新期限，保留一个 ID。写日志失败尝试回滚该次规则变动，仍不批准。
- `GET /bff/grants` 返回 `{grants:[...全部记录, status:'active'|'expired'|'revoked']}`；到期日当天按东京日期仍有效，次日零点起显示过期，撤销优先。`POST /bff/grants/:id/revoke` 空对象请求，要求设备标识，返回 `{ok:true,grant:{...记录,status:'revoked'}}`；重复撤销不重复记日志。代理沿用所有写请求的 cookie/同源来源检查，设备标识由 web 重建，不接受客户端伪造值。
- 命令信笺不显示内部级别代号；全文用文本节点和可横向滚动的等宽块，目录、原因、权限及较长时限独立显示。可放行时增加「以后这类不用问」，原生确认展示助理、目录、程序、按当前配置天数算出的东京到期日，取消不发请求。
- 壳公开 `registerMoreItem({id:'hub-real-permissions',label:'权限',onClick})` 与 `registerPanel/openPanel` 注册权限页，不改壳。列出全部放行历史，状态用人话，有效行提供二次确认撤销；空表有明确提示。
- bash 轨迹新增 `command`、`cwd`、`output`、`outputTruncated`、`outputPath?`；输出只投影真实工具结果文本的 UTF8 前 4096 字节，识别插件「全文在 bots/...」回执。普通文件工具继续不投影参数/结果正文。前端再限制显示字节数，拒绝显示「这条命令没跑」，批准不冒充已执行。沿用相邻工具合并和原生 details，展开显示命令与输出。
- 回归：`test/r26.commands.test.mjs`、`test/r26-client.test.mjs`、`test/r26-browser.cjs`；浏览器脚本要求显式设置 `PLAYWRIGHT_CORE`、`CHROMIUM`、`HUB_R26_URL`（仅允许回环 3592）、`HUB_R26_SHOTS`，外部请求全部拦截。预览夹具读 `HUB_TEST_TMP`，不再默认写源码树。`r23-sync.test.mjs` 补齐原测试夹具遗漏的安全上下文检查器；只在其空暂存目录的脚本副本中去掉无作用的 rsync 删除参数。

验证范围与截图见本轮 `回执-C.md`。本路不启动或重启 3390/3391/3392，不连接真实模型，不发布。

## F · 服务端名册、助理确认卡与临时资料页

来源：本轮公共工单、第三期名册契约与 F 工单；以下为实现契约及假环境验证范围，不表示真实链路已切换或用户验收。

- `GET /bff/bots` 是真实助理集合与名字、形象、名牌色、职责、不管什么、三条开场短语及启用状态的来源。加载失败不使用壳的演示六助理作发送白名单；异常名册不应用。`roster` 全量事件沿用唯一 `/bff/events` 连接，重连补取名册。服务端 `role:chief` 定位首席，新增 id 直接进入真实发送断言；停用者仍在名册与旧会话清单中，但输入、创建和发送均拦截。
- 首页 `sidebar()` 内部 `assistants` 是固定六项；公开 `createBot` 只增加壳状态与最近列表，不扩首页格子。因此 F 使用契约规定的六格回退：适配层在已有 `.sidebar .pinned` 中沿用 `.shell-pinned-tree/.pin/.home-role/.r22-nameplate` 构造名册 order 前六位启用者；所有名册行通过 `registerMoreItem` 的「助理」面板可达。停用者灰色展示，并提供资料恢复入口。此桥接在新壳提供名册首页接口后应替换，不修改壳源文件。
- 名册事件经公开 `Hub.state.bots` 与 `createBot/registerConversation` 同步身份，经壳 reading.preserve 重绘保留当前消息、滚动与输入；资料编辑抽屉保持草稿，外部变化会在保存前核对正在修改的字段。`paintRecent` 将名册版本纳入缓存键，聊天标题、名牌、会话列表、输入框「向<名字>发消息」与短语随之更新。忙碌、未读与待批仍取 status，不由名册推测。
- `avatarKinds.roles/shapes/colors` 决定可选项，不在适配层维护助理 id 或角色对应表。角色图片地址与人话名称从同源只读 `/pets/pack.json` 的 assistants（兼容 roles）清单取得，支持角色键及素材 pack id；只接收安全相对图片路径。形象为角色图片、复用 SVG 团子形状与颜色，或登录后 `/bff/avatars/<file>?v=<v>` 的上传图片；不调用任何图像生成服务。素材包尚未接入的角色暂用团子回退，不伪造外网地址。
- `bot_create/bot_update/bot_set_status` 使用既有信笺卡。目标以 target 查询名册名称，标题为“某助理想新建一个助理 / 想改某助理的资料 / 想停用或恢复某助理”。before/after 仅展示有变化的允许字段，新建展示全部，形象含缩略图，均使用安全文本节点。按钮为「确认 / 改一下 / 不改」，分别走既有 approve / revise（带 note）/ reject；不增设批准通道。`failed` 及服务端明确的落盘失败原因显示「没改成：原因」，服务端 note 已有此前缀时不重复；批准按钮本身不代表保存成功。
- 「更多 → 助理资料」及真实聊天名牌打开临时资料面板。七类字段分别“改 → 预览 → 确认”，仅确认后 `PATCH /bff/bots/:id`，成功再读服务端名册。启用状态只接受 active / disabled，没有删除入口。名字前端按 Unicode 字数、控制字符、路径字符、首尾空白及 NFC/忽略大小写重名先挡一遍，后台为准。职责、短语等超限由后台给出最终判定。
- 换形象有「角色 / 图形 / 上传图片」三页签。上传用原生 `<input type=file>` + FileReader 预览 + fetch；前端拒绝空文件、超过 2MiB 与非 png/jpg/jpeg/webp/gif 或非相应 MIME。确认后 `POST /bff/bots/:id/avatar` 原始字节体及真实 Content-Type，走原有 same-origin cookie 代理，不自行构造设备头；实际魔数、尺寸、重新编码与去元数据归 BFF。测试 mock 只做内存存取与基本魔数，不代替 BFF 的 sips 验证。

F 新增测试：`test/r26-roster.test.mjs`（5 项，含真实 web 代理的登录、同源、设备头隔离与图片保护）及 `test/r26-roster-browser.ego.mjs`（由 runner 注入配置，使用已有 ego-browser）。浏览器只允许回环 3592，假 BFF 3591，现有 `r24-preview.mjs` 继续使用 `HUB_TEST_TMP` 指向本轮 tmp。复跑示例：

```sh
# 先在隔离副本启动 test/r24-preview.mjs；HUB_TEST_TMP/TMPDIR 均设到工单 tmp。
# HUB_R26_URL、HUB_R26_SHOTS、HUB_R26_IMAGE、HUB_EGO_SPACE 均由调用者配置。
node test/r26-roster-browser.mjs | ego-browser nodejs
```

浏览器脚本不自行结束 task space，便于失败后在同一空间检查；全部完成并观察结果后，调用者按 ego-browser 技能单独 finish。图片使用已有角色小图作上传夹具。截图以 `f-*.png` 命名；待替换的组件为：首页六格桥、名册列表、临时资料页/编辑预览、形象选择器与信笺内的前后对照。BFF 接口、确认语义与安全边界保持。


## F2 · 首页与含当天到期文案

来源：`工单-F2-新壳与到期文案.md`。实现与离线验证，未切换真实链路。

- 本轮指定新壳 `preview/art4/index.html` SHA256 为 `4e7ed34c2fddeee865dfadb5778517f763b498c1b698954e1de4f56eb4684d2e`；旧现用壳为 `2924f144c0d7b92b5ca3dd3dd08064b1eaef83e4805a526983b317fdb7ca4ea6`。两版仍使用既有三个公开接口。
- 以公开 `openFeature/featureOwner` 识别平铺首页；六格名册桥不再给这版壳补回分助理头像、+N 或旧角落红点，未读统一 `.bot-unread.home-assistant-unread`。旧版保留原分助理角落兼容；所有可缺省节点允许为空。项目选择器未列为依赖。
- `.home-recent-list` 与 `.conversation/.line/.preview/.home-row-meta` 继续使用。真实模式仍按 F 契约只渲染名册内的服务端会话；壳演示中的固定任务 id 不当作真实助理或 BFF 会话 id。演示模式保留壳原有六助理加固定任务的平铺行，固定任务用主助理头像。
- `[data-feature-phrase]` 与 `[data-feature-chat]` 按 `featureOwner(state.featureId)` 打开负责助理的服务端会话；前者只填草稿并把光标放到末尾，后者只开会话，两者都不发送。旧 `[data-capability-phrase]` 仍走原样例隔离，不合并语义。
- 新壳 `canSend()/clearComposer()` 可用时，真实发送先问组字状态，再通过壳接口清空草稿与保持焦点。旧壳没有这两个接口时继续原发送路径；壳捕获保护照常保留。
- 放行列表按后端 status 显示：有效行「到 11 月 X 日为止 · 有效」，过期行「已过期（到 11 月 X 日为止）」，撤销行「已撤销（到 11 月 X 日为止）」。跨东京当前年份显示年份；不在前端重判有效性。二次确认用东京当日加 `commandGrantDays` 算出同样的含当天日期，取消不发审批请求。
- 新门禁 `node test/check-shell-contract.mjs <index.html>` 复用旧 168 项检查并从实际导出表检查 Hub 方法，允许在 returnToBoard 前新增方法；平铺首页的三项退役结构可缺省。新壳另检查四个接口、功能页填草稿与组字保护，共 174 项。删导出反例仍失败。`ops/check-adapter-contract.mjs` 原文件保留，`ops/sync-shell.sh` 仅把门禁路径改到新兼容检查器。
- `test/r24-preview.mjs` 可用 `HUB_R24_SHELL_DIR` 指向新壳临时目录，要求解析后的目录在 `HUB_TEST_TMP` 内，拒绝真实链路目录与跳出测试根的符号链接。仍只监听原有假端口。

复跑：在隔离副本设置 `TMPDIR/HUB_WEB_TEST_TMP/HUB_TEST_TMP` 到本轮 tmp，`HUB_F2_OLD_SHELL/HUB_F2_NEW_SHELL` 为两版 HTML，再运行 `node --test test/*.test.mjs`；分别运行上述契约与 `ops/check-secure-context.mjs hub-real.js <旧壳> <新壳>`。`test/f2-shell-browser.ego.mjs` 由 runner 注入假 URL、Ego 空间与截图目录，完成后由调用者单独 finish。

监工切壳前先核对当前主线与源码版本，使用检查后的临时新壳；本轮不执行同步或切换。现工作树 `shell-r23` 是指向部署目录的符号链接，原同步脚本会拒绝它；不要绕过符号链接门禁或直接覆盖，按部署维护边界备份、暂存、检查后由监工切换。具体源路径、备份和回退步骤见本轮 F2 回执。

## 路 35 · 界面上缺的入口（只经适配层，不改壳）

全部在 `hub-real.js` 里，演示模式一个请求也不发；拿不到数据一律显示「暂无」，不白屏不报错。
来自工单、组消息、纪要、规矩页、全文、后端错误的文字一律用文本节点显示（不用 innerHTML、不走 markdown），
测试 `test/r28-entries.test.mjs` 里有一条静态检查守着这一点。**只做了契约测试和桩测试，没有在手机上验过。**

新依赖壳的接口（都是已有的，没新增）：`Hub.registerPanel`、`Hub.registerMoreItem`、`Hub.openPanel`、`Hub.toast`、
`Hub.reading.preserve`、`state.drawer`（选完模型置空来关面板）、`.shell-title-meta`（标题旁放「模型：…」入口，
和已有的「会话列表」小按钮并排）。壳里没有时：缺 registerMoreItem 就没有「更多」里的行；缺 registerPanel 就没有面板。
适配层自己在 `document.body` 末尾加一个 `.hub-real-banner`（一键全停横幅，`position:fixed` 贴顶，`role=alert`）。

| 入口 | 后端接口（经网页层 `/bff` 前缀转发） | 取不到时 |
|---|---|---|
| 新会话选模型 | `GET /models/bots/<助理>`（要有 `enabled:true`）；建会话 `POST /sessions {bot, model?}` | 不显示入口 |
| 今天 | `GET /today` | 暂无 |
| 一键全停 | `GET /panic/status`（每 20 秒、回到前台时读）、`POST /panic/stop`、`POST /panic/resume` | 保留上次状态；404/501 才清掉 |
| 固定任务 | `GET /routines`、`POST /routines/<id>/run|pause|resume`、`POST /routines/pause|resume` | 暂无 |
| 晨会晚会 | `GET /meetings/status`、`/meetings/today`、`/meetings/minutes?date=&type=`、`POST /meetings/run {type:'evening'}` | 暂无 |
| 规矩页 | `GET /rules`（后端还没有，形状见接线说明；网页层只放行 GET/HEAD） | 暂无 |
| 看全文 | `GET /bff/fulltext/<64 位校验和>`（卡上 `fullText` 字段） | 不画按钮 / 提示取不到 |

要点：
- 选模型：后端没写 `enabled:true` 一律当关着。选了模型建会话失败时把后端原因说给用户，**不偷偷换默认模型重试**。
- 一键全停：`partial`（503）也带说明，横幅逐条列出没停住的步骤；停与恢复、手动跑固定任务、开晚会都要点两下（第一下只换字）。
  停机状态下不发起手动跑、开晚会。连不上时只说「状态不明，按没停处理」，不说「已停」。
- 看全文：卡上带合法校验和才画；能用 `crypto.subtle`（安全上下文）就在本机重算校验码，对不上就拒绝显示并提示不要批准；
  非加密连接下重算不了，只提示「服务端读出和执行前会核对」。
- 外包工单确认卡（`confirm:true, tool:'confirm', kind:'dispatch'`）：标题用卡标题，不再套「写入一份文件」；按钮是「派出去 / 先不」，
  「以后这类不用问」暂不放（放权那条按钮路径目前只认三类已有确认卡）。其余 `tool:'confirm'` 的卡同样不再套文件卡样子。
- `window.HubRealR28`：只读观测与测试钩子（横幅、全停状态、选中的模型）。
- 网页层 `server.mjs`：新增 `READONLY_EXT_PREFIXES = ['rules']`（只读转发）；`EXT_PREFIXES` 不变，`dispatch` 仍不进网页层。

## 接收工新壳（新旧壳同一份适配层）

来源：任务书「接新壳」。新壳＝收工产物（`index.html` SHA256 `ae028c8c23f22b9be5227d35dcce38ed8b92f4ce57bcd2010cc69ecb5e8cdab7`），
旧壳＝稳定地址在用的 `shell-r23`（`2924f144…`）。适配层按壳里有没有标记分支，不按版本号；旧壳路径与行为不变。
实现与验证都在假后端加无头浏览器（手机视口）里做，**没有在 iPhone 或真机上验过**。

新壳标记（任一缺失就当旧壳）：`window.AssistantProfiles`（导出 propose/preview/confirm/undo/openProfile/openLibrary/drafts/catalog）
且 `Hub.registerFeatureSection`；平铺首页另认 `Hub.openFeature/featureOwner`。壳自带灵动的标记：`window.HubPetMotion`
或节点类 `r25-motion-body`——有就把 `HubLivelinessConfig.enabled` 置 false，不再叠注入的 `liveliness.js`（旧壳没有则照旧启用）。

| 新壳受影响点 | 适配层做法 | 缺失/失败时 |
|---|---|---|
| `[data-assistant-confirm]`（资料确认卡的「确认」） | 捕获阶段拦下；按草稿 `AssistantProfiles.drafts` 翻成 `PATCH /bff/bots/:id`（名字/职责/不管什么/短语/启用），成功后读回服务端名册再把草稿置 confirmed，撤销按钮失效 | 失败保持待确认并说「没改成：…」，壳里资料不动 |
| 新建助理草稿（`create`）、互换形象（多助理草稿） | 不在壳里生效；toast 引导「对首席说」「到更多→助理资料改」 | 草稿置 cancelled |
| `[data-avatar-library]`、`[data-profile-color]` | 拦下，改开适配层已有的真资料抽屉（角色/图形/上传图片，预览→确认→PATCH/POST avatar） | — |
| `assistant-change`、`assistant-chief-required` 卡型 | 真实会话里不出现（壳的本地聊天改资料被真实槽保护挡住）；后端 `bot_create/bot_update/bot_set_status` 审批卡照旧 | — |
| 助理名册→壳资料 | `applyRoster` 后映射 name/duty/notDuty/description/enabled/homeLabel/quickReplies/color/avatar；角色头像按名册角色→素材包（`pets/pack.json`）映射，保留壳原生形象；上传头像取 `/bff/avatars/…` 转 data URL | 取不到用默认图形 |
| `.r25-feature-header.r25-assistant-header`、`.r25-static-stage` | 只读，不依赖；静态形象节点不带 `data-pet-stage` | — |
| 七个功能页（`Hub.registerFeatureSection`、`[data-feature-section/contribution/phrase/chat/detail/capability/memory]`、`.r25-feature-record`） | 看板/账本/日程/权限接真数据；记忆/设备/连接显示「暂无」；壳种子摘要与演示记录、壳模块贡献、演示能力卡、记忆条目、「查看原有详情」在真实模式隐藏，切回演示恢复 | 后端取不到显示「暂无」 |
| `state.fixedTasks`、`state.pendingInputs`、`state.activities` | 真实模式暂存并清空（活动只留 id 以 `hub-real-` 开头的真实项，壳各模块启动时注册的治理/账本样例都算演示），切回演示还原 | — |
| 抽屉里标「演示」的按钮（会话菜单的语音演示、排队演示）、本机「新建固定任务」 | 真实模式用 `display:none` + `data-fs-hidden` 隐藏，切回演示恢复；适配层自己的按钮（`data-hub-mode`、`hub-real-*`、`data-real-*`）不动 | — |
| `Hub.createBot` 可超过六位 | 真实版六助理白名单不变；首页六格仍取名册前六位启用者，其余经「助理」目录进入 | — |
| 备用头像 `/pets/spare/<id>/avatar(-96\|-192).webp`、`/pets/spare/spare.json` | 网页层 `assetRules` 新增放行（其余白名单与穿越防护不变） | 不放行则备用角色头像 404 |

检查脚本：`test/check-shell-contract.mjs` 取 Hub 导出表改以 `returnToBoard` 为锚（新壳导出表首行不再以它开头），常用话「只填不发」改认
`fillDraft`；新壳（有 `AssistantProfiles` 与 `registerFeatureSection`）追加「新壳」项；旧壳 168/168，新壳 201/201。
`ops/stage-shell.sh <源壳目录> <目标壳目录>` 把新壳放进独立目录（白名单拷贝、两道检查都过才原子换入、旧目标保留为 `.prev-<时间>`），
不碰稳定地址在用的 `shell-r23`。

## 适配层钩子与会拆掉的挂点

真实模式才挂上 `window.HubUnread`、`window.HubVoiceSend`、`window.HubUpload`、`window.HubSettings`。
演示模式把这四个名字删掉，壳走自己的演示回退。请求都走网页层 `/bff`，前缀在 `R29_PREFIXES`
（`unread`、`voice`、`uploads`、`settings`），和旧的 `EXT_PREFIXES` 用同一套设备钥匙与同源校验。
旧测试把 `EXT_PREFIXES` 钉成八个名字，所以这四个不写进那份数组。后端 404 时：未读是空对象，
语音和上传是 `{ok:false,error:'not-ready'}`，设置 `get()` 带 `readonly:true` 且默认 `open`，
`setPermission` / `setBot` 直接返回 `{ok:false,error:'not-ready'}`，不再发写请求。

- `HubUnread.counts` / `subscribe`：`GET /bff/unread/`。完整回复结束且页面可见时再拉一次，并通知订阅者。
- `HubUnread.markRead(会话号)`：`POST /bff/unread/read`，体 `{conversation, upTo}`。
  `upTo` 是已载入消息的最大 seq；没有 seq 时用条数。打开会话且线程离底部不超过 80px，
  或用户把线程滚到底，也会调。
- `HubVoiceSend`：`POST /bff/voice/?conversation=&bot=`，体是音频，`content-type` 取 `audio/*`。
  成功后把转写文字交给现有 `sendText`。`asr-unavailable` 原样返回，不发消息。
- `HubUpload`：`POST /bff/uploads/?conversation=&bot=`，头 `x-filename`（百分号编码）。
  返回值仍是 `{ok,id,name,size,mime}`。`path` 用「（附了文件：<名字>，在 <path>）」接在主人消息后面。
- `HubSettings`：`GET /bff/settings/`、`PUT /bff/settings/permission`、`PUT /bff/settings/bots/<助理号>`。
  `mode` 只接受 `open`、`ask`、`readonly`。

文件附注：若上传发生在 `sendText` 之前，附注并进这一条；若发送监听先跑完（捕获阶段常见），
或助理正忙，就留到下一次 `sendText`，不忙时再单独发这一句。重试不重新拼附注。

这轮壳会拆掉的挂点，缺了也不抛：

- 对话页会话菜单（`data-act=session-menu`，`drawer===session-menu`）：菜单层还在就替换那一层；
  不在就直接开服务器会话。`openPanel` 不是函数就返回。
- 新建助理草稿确认卡（`[data-assistant-confirm]`）：`AssistantProfiles.drafts` 没有 `get` 就返回。
  新建草稿仍取消，不在壳里生效。
- 「更多」里的行（`registerMoreItem`，旧壳回退 `.drawer .r22-sheet-content`）：
  注册包在 try 里，抛了就跳过这一行。容器不在就不追加。

形象：首页六格在「角色 id 与助理号相同」时不再塞 `/pets/…/avatar-96.webp`。
已有的 `[data-pet-stage=home]` 挪进新格子；没有就留一个带 `data-pet-stage` 与 `data-bot-avatar` 的空槽，
并给每个新空槽调一次 `petTurn(id,'idle')` 让壳的引擎自己换上动图。对话舞台上已经有
`[data-pet-stage]` 时不再换成静态头像。适配层只在发现 `HubPetMotion` 或 `.r25-motion-body`
时把 `HubLivelinessConfig.enabled` 设为 false（那是叠加上去的呼吸层）。不调用 `HubPetMotion.hold`，
也不改角色媒体开关。

集成修（在上面的钩子上补，不改 `EXT_PREFIXES`）：

- 转发头增加 `x-request-id`。`x-filename` 仍转发。语音和上传的正文上限从 8MB 改为 25MB，
  与后端一致。其余请求仍是 512KB。四个新前缀继续放在 `R29_PREFIXES`，不并进 `EXT_PREFIXES`。
- 确认卡（含活动抽屉里直接画的那张）优先 `HubPlainTalk.renderCard`。没有或抛错就用原来的卡。
  项目页优先 `HubPlainTalk.renderProject`。加载中和「暂时读不到」这两句不改。
- 开始想、正在说、回完、出错时调用 `HubPetStage.event`（出错传 `error`），同时 `petTurn`
  （出错仍是 `confused`，说话是 `working`）。当前回合里工具做完再传 `tool-done`，
  检索类工具让舞台引擎走 `research`，别的走 `working`。历史重放不发这些事件。
- 真实模式挂 `HubGroups.list()`：`id`、`name`、成员助理号数组、`topic`、最后一句。演示模式删掉。
- `HubUnread.markRead` 先把这条会话和它的助理未读清成 0 并通知，再提交，然后重新拉。
  首页六格的 `+N` 读 `counts().bots`。
- 设置：`get()` 不写权限文件。后端给 `ask` 就显示 `ask`。`modelsWritable===false` 时
  `models` 交空数组，`setBot` 本地返回 `{ok:false,error:'readonly'}`，不发 PUT。
  这个字段不出现时，仍按原来的可写路径。
- 真实模式的发送若带了附件，先走 `HubUpload`，附注跟在这一句后面。没字只有文件时，
  正文是「已附上 N 个文件」再接附注。
