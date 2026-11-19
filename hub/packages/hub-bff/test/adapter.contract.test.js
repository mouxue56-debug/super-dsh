// Adapted from H/engineering/adapter/adapter.contract.test.js.
// Original scenario names retained. Applicable cases exercise the real DshClient and HTTP handler;
// broader HubAdapter scenarios explicitly skip with reasons. Scope differences are test diagnostics.
const {test} = require('node:test');
const scenarios = [
  "兼容性：运行版本未知时不得照抄参考源码版本",
  "列预设：保留默认项和损坏诊断，不静默切换默认预设",
  "列会话：只调用列表并按可证实的 bot 映射筛选，不激活会话",
  "列会话：缺少预设映射的会话保持未归属，不串入指定 bot",
  "建会话：同时传递明确预设与目录，并采用真实返回的会话标识",
  "建会话：目录与工作区同时出现时在调用前拒绝",
  "建会话：预设损坏或目录冲突不回退为其他 bot",
  "读历史：保留分页切点与顺序，读取不激活会话",
  "发消息：保留关联标识和排队模式，接纳不等于生成完成",
  "发消息：不把空白输入误变成上游空数组续跑",
  "发消息：接纳后回执丢失标为结果未知且不自动重发",
  "收流：请求快照与临时输出，不发送上游未定义的续传游标",
  "收流：相同持久序号重复到达只投递一次，不丢替换语义",
  "收流：临时片段没有持久游标，提交后不重复形成两条消息",
  "收流：未知可忽略事件透传，未知强制事件报告不兼容",
  "收流：关闭和切换会话后迟到帧不再投递，关闭不取消生成",
  "收流：重新订阅接收新代完整快照，旧代帧不能污染新会话",
  "取消：只承诺取消请求已接纳并保留队列",
  "取消：未挂载会话返回上游找不到错误，不伪造停止成功",
  "审批：订阅活跃应答链并一次性交回允许结果",
  "审批：拒绝通过应答链返回，审计记录不能充当待审批句柄",
  "审批：跨会话句柄、已撤回句柄与永久允许值都拒绝",
  "审批：断开订阅释放等待，不默认允许也不重新激活旧审批",
  "任务单：只读目录清单与正文，不把会话待办当目录工单",
  "任务单：插件未实现时读写均明确不支持，不回填样张数据",
  "任务单：版本一致才写入并返回新版本，旧版本不得覆盖",
  "任务单：新建条件冲突与目录穿越在写入前拒绝",
  "看板：拖拽只是草稿，调用提交后才一次写入并给出回执",
  "看板：任一版本冲突则整批不写，审批待定时也不提前落盘",
  "定时：分页和活动筛选透传，不激活目标或运行任务",
  "定时历史：保留历史缺失和裁剪标志，失效游标不伪装空列表",
  "用量：四桶 token 各自保留，缺少订阅数据保持未知",
  "用量：插件缺失和投影迁移不记零，不把缓存提示当实时数据",
  "能力卡：目录沿用一句话三句常用话，活跃插件不等于设备可用",
  "能力卡：失败与停用状态如实映射，未找到能力不能默认可用",
  "bot：读清单不把运行中的子代理或会话当常驻 bot",
  "bot：新增更新仅改变映射，新目录与预设不重写已有会话",
  "bot：预设不存在和旧版本冲突不写入映射",
  "bot：移除只停用映射，保留会话预设和文件",
  "bot：映射服务未实现时增改删均明确不支持",
  "释放：重复释放安全，后续调用拒绝且不存在残留订阅"
];
for (const name of scenarios) {
  test(name,{timeout:5000},async t => {
    const {cases,runCase,skipReason,semantics}=await import('./contract-cases.mjs');
    if (!cases[name]) { t.skip(skipReason(name)); return; }
    if (semantics[name]) { t.skip('原骨架完整语义超出本轮契约：'+semantics[name]+'；对应 BFF 子集另测'); return; }
    await runCase(name);
  });
}
test('BFF-specific contracts adapted from broader original scenarios',async t => {
  const {runCase,semantics}=await import('./contract-cases.mjs');
  for (const [name,scope] of Object.entries(semantics)) {
    await t.test(scope,{timeout:5000},async () => runCase(name));
  }
});
