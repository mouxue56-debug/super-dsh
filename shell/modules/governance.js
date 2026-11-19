/*
 * 注册点（保留原有 id）：
 * 1. registerView('ledger')：三层账本；control 隐藏，保留程序兼容入口。
 * 2. registerPanel('governance-detail')：审批改稿、权限改级及治理详情抽屉。
 * 3. registerSettingsPage('governance-settings')：预算与额度规则，入口「设置」。
 * 4. registerStatusChip('governance-status')：输入区待批数，点击询问权限负责助理。
 * 5. registerCard('governance-approval')：消息中的审批卡，点击查看对应待拍板。
 * 6. governance-keys：密钥与待输入；governance-pending-summary：实时清单摘要。
 * 7. governance-input-demo：私密卡演示；3 项待输入、审批/放权/L3 与 L1 活动。
 * 8. governance-context-mix / governance-delegation：构成与放权卡，各有演示会话。
 * 9. governance-costliest：账本会话/轮次费用排序，未知单列。
 * 全部数字、引文、记录与操作结果为本页内存样张，刷新复原；来源标签仅表示
 * 复用流程/字段，不证明当前已接通。真实审批执行、订阅查询、密钥安装、端口
 * 探测、健康检查、文件导出、升级与一键回滚均为占位，不联网、不落盘。
 */
(function () {
  'use strict';
  var H = window.Hub, h = H.h;
  var prefix = 'm-governance-';
  function featureOwnerId(feature) { var owner = H.featureOwner(feature); return owner ? owner.id : ''; }
  function featureOwnerName(feature) { var owner = H.featureOwner(feature); return owner ? owner.name : '待指定负责助理'; }
  function featureDraft(feature, text) {
    var owner = H.featureOwner(feature);
    if (!owner) { H.toast('负责助理未指定或存在多位，请先核对名册'); return false; }
    return H.fillDraft(owner.id, text || '');
  }
  var quota = H.state.ledgerDemo || (H.state.ledgerDemo = demoFixture("governance.quota.1"));
  var tabs = ['审批', '权限', '用量', '安全', '维护', '规则'];
  var levels = ['L0', 'L1', 'L2', 'L3', 'L4'];
  var levelDescriptions = demoFixture("governance.levelDescriptions.2");
  var levelSummary = levels.map(function (level) { return levelDescriptions[level]; }).join('｜');
  var delegationLabels = { proposed: '待批准', approved: '已批准 · 仅本页', rejected: '已拒绝', revoked: '已收回' };
  var mounts = new Map();
  var chips = new Set();
  var state = {
    tab: '审批', filter: '全部', bot: '全部', logFilter: '全部',
    window: '5 小时', allocation: '按 bot', session: null,
    plans: {}, selected: {}, editing: {}, drafts: {}, grantHistory: [], serial: 7,
    budget: 100, threshold: 80, fallback: true, guard: true, budgetStop: true,
    usageProbe: quota.usageProbe, preview: '', ledgerFocus: '', receipt: '',
    lock: true, backup: 'B-DEMO-113', rollback: '', drillRuns: 0,
    checks: {}, contractRun: false, upgrade: '', ruleProject: '全部',
    securityHistory: [], healthRuns: 0, keyGuide: '', incidentFilter: '全部',
    grants: demoFixture("governance.grants.3"),
    approvals: demoFixture("governance.approvals.4"),
    logs: demoFixture("governance.logs.5")
  };
  // 两模块只持有同一份占用/阈值，旧消息保留其操作时快照标签。
  ['usageProbe', 'threshold'].forEach(function (key) {
    Object.defineProperty(state, key, { enumerable: true, get: function () { return quota[key]; }, set: function (value) { quota[key] = value; } });
  });
  var permissions = demoFixture("governance.permissions.6");
  var windows = demoFixture("governance.windows");
  var allocations = demoFixture("governance.allocations.7");
  var ledger = demoFixture("governance.ledger.8");
  var rounds = demoFixture("governance.rounds.9");
  state.session=Object.keys(rounds)[0];
  var safety = demoFixture("governance.safety.10");
  var ports = demoFixture("governance.ports.11");
  var health = demoFixture("governance.health.12");
  var incidents = demoFixture("governance.incidents.13");
  var backups = demoFixture("governance.backups.14");
  var drills = [
    '2026-11-13 · 凌晨备份 → 隔离测试区 · 4.2 秒 · 假数据校验通过',
    '2026-11-12 · 夜间备份 → 隔离测试区 · 5.0 秒 · 假数据配置一致',
    '2026-11-11 · 夜间备份 → 隔离测试区 · 3.8 秒 · 旧插件兼容待复核'
  ];
  var rulesData = demoFixture("governance.rulesData.15");

  var sharedClasses = {
    card: 'pop-card', item: 'pop-card', 'section-head': 'pop-card-head',
    segment: 'segmented', field: 'pop-input', label: 'field', badge: 'badge', source: 'badge',
    notice: 'pop-card', editor: 'pop-card', metric: 'pop-card', chart: 'pop-card', stamp: 'sticker bot'
  };
  var botIds = demoFixture("governance.botIds.16");
  function botAttrs(bot) {
    var id = botIds[bot] || bot;
    return id && H.botStyle ? { style: H.botStyle(id) } : {};
  }
  function levelMark(level, action, scope, bot) {
    if (window.HubPlainTalk && window.HubPlainTalk.realMode && window.HubPlainTalk.realMode()) return null;
    return H.levelSticker(level, { action: action, scope: scope || '仅本页演示', bot: botIds[bot] || bot || featureOwnerId('permissions') });
  }
  // Display-only spacing: keep small numeric quantities and their units together.
  function tidyCopy(value) {
    if (Array.isArray(value)) return value.map(tidyCopy);
    if (typeof value !== 'string') return value;
    var spaced = value.replace(
      /(\d[\d,.]*)[ \u00a0]+(token(?:\/s)?|MB|小时|分钟|毫秒|秒|天|轮|次|条|项|张|单|份|个|字|美元|片)/g,
      demoText("governance.sample.17"));
    var fn = window.HubPlainTalk && window.HubPlainTalk.humanize;
    return fn ? fn(spaced) : spaced;
  }
  function botName(value) {
    var bot = H.state.bots.find(function (item) { return item.id === (botIds[value] || value); });
    return bot ? bot.name : '演示助理';
  }
  function conversationName(id) {
    var demos = { 'governance-context-demo': featureOwnerName('ledger') + ' · 上下文构成演示', 'governance-delegation-demo': featureOwnerName('permissions') + ' · 放权提议', 'governance-input-demo': featureOwnerName('permissions') + ' · 密钥与待输入' };
    if (demos[id]) return demos[id];
    var bot = H.state.bots.find(function (item) { return item.id + '-013' === id; });
    return bot ? bot.name + ' · ' + (H.state.sessionNames[bot.id] || '今日会话') : '演示会话';
  }
  function backupName(id) {
    var backup = backups.find(function (item) { return item.id === id; });
    return backup ? backup.date + ' 的备份' : '演示备份';
  }
  function el(tag, cls, children, attrs) {
    var common = sharedClasses[(cls || '').split(' ')[0]];
    var extra = Object.assign({}, attrs || {});
    var fn = window.HubPlainTalk && window.HubPlainTalk.humanize;
    if (fn) ['aria-label', 'title', 'placeholder'].forEach(function (key) {
      if (typeof extra[key] === 'string') extra[key] = fn(extra[key]);
    });
    var klass = (cls ? prefix + cls : '') + (common ? ' ' + common : '');
    return h(tag, Object.assign({ class: klass }, extra), tidyCopy(children));
  }
  function btn(label, fn, style, attrs) {
    var tier = style === 'primary' ? 'btn-primary' : style === 'tertiary' ? 'btn-tertiary' : 'btn-secondary';
    return el('button', 'btn ' + tier + (style ? ' ' + prefix + style : ''), label,
      Object.assign({ type: 'button', onClick: fn }, attrs || {}));
  }
  function note(text) { return el('p', 'note', text); }
  function source(text) { return el('span', 'source', '来自：' + text); }
  function badge(text, tone) {
    return el('span', 'badge ' + prefix + (tone || toneFor(text)), [el('i', 'dot'), text]);
  }
  function toneFor(text) {
    if (/已批|正常|已上主线|已结案|有效|通过/.test(text)) return 'good';
    if (/已拒|未做|超时|暂停|收回/.test(text)) return 'bad';
    return 'warm';
  }
  function actions(items) { return el('div', 'actions', items); }
  function row(title, detail, controls, bot, extraClass) {
    return el('div', 'row' + (extraClass ? ' ' + prefix + extraClass : ''), [
      el('div', 'grow', [el('strong', 'title', title), el('div', 'sub', detail)]),
      controls ? actions(controls) : null
    ], botAttrs(bot));
  }
  function card(title, provenance, children) {
    return el('section', 'card', [
      el('div', 'section-head', [el('h2', 'h2', title), source(provenance)]), children
    ]);
  }
  function segment(label, value, options, onChange) {
    return el('div', 'segment', options.map(function (option) {
      return btn(option === '按 bot' ? '按助理' : label === '按助理筛选权限' && option !== '全部' ? botName(option) : option, function () {
        if (option === value) H.toast(label + '：当前已选「' + option + '」 · 本页演示');
        else onChange(option);
      }, option === value ? 'active on' : '', {
        'aria-pressed': String(option === value)
      });
    }), { role: 'group', 'aria-label': label });
  }
  function toggle(label, checked, onChange) {
    return el('div', 'toggle toggle-row', [el('span', 'grow', label),
      el('button', demoText("governance.sample.18") + (checked ? ' on' : ''), el('i', 'knob'), {
        type: 'button', role: demoText("governance.role.19"), 'aria-label': label, 'aria-checked': String(checked),
        onClick: function () { onChange(!checked); }
      })
    ]);
  }
  function progress(value, label) {
    return el('div', 'progress', el('span', 'progress-fill', null, { style: { width: Math.min(100, value) + '%' } }), {
      role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(value)
    });
  }
  function mount(root, painter) {
    mounts.set(root, painter);
    root.replaceChildren();
    painter(root);
  }
  function refresh(root) {
    mounts.forEach(function (paint, target) {
      if (target === root || target.isConnected) {
        target.replaceChildren();
        paint(target);
      } else {
        mounts.delete(target);
      }
    });
    chips.forEach(function (chip) {
      if (chip.isConnected) paintChip(chip);
      else chips.delete(chip);
    });
  }
  function audit(what, result, detail, feature) {
    var labels = { budget: '预算上限', allocation: '费用分摊方式', fallback: '自动换便宜模型', usageProbe: '演示额度占用', permission: '改级草案', active: '放权状态', hardening: '加固复核计划', isolated: '隔离标记', rollback: '恢复计划', upgrade: '升级审阅计划', healthRuns: '健康模拟轮次', status: '事故状态' };
    var entry = { who: '用户（演示）', time: new Date().toLocaleString('zh-CN'), what: labels[what] || what, result: result, detail: detail || '只改变本页内存；未执行真实动作', feature: feature || 'permissions' };
    state.logs.unshift(entry);
    H.featureRecord(entry.feature, { time: entry.time, title: entry.what + ' · ' + result, text: entry.who + ' · ' + entry.what + ' · ' + result + ' · ' + entry.detail });
  }
  function pending() { return state.approvals.filter(function (a) { return a.status === '待批'; }); }
  function findApproval(id) { return state.approvals.find(function (a) { return a.id === id; }); }
  function decide(a, result) {
    if (a.status !== '待批') return false;
    a.status = result;
    a.expires = '已结案';
    a.receipt = 'DEMO-RECEIPT-' + a.id;
    if (result === '已批' && a.permissionId) {
      var permission = permissions.find(function (p) { return p.id === a.permissionId; });
      if (permission.level !== a.oldLevel) {
        a.status = '超时';
        a.expires = '基础等级已改变，请重新申请';
        audit(a.action, '超时', a.action + '：基础等级冲突；未修改演示权限');
        delete state.selected[a.id];
        H.completeActivity('governance-activity-' + a.id);
        return false;
      }
      permission.level = a.newLevel;
    }
    audit(a.action, result, a.action + ' · 影响：' + a.scope + ' · 参数快照：' + a.params + ' · 仅演示回执');
    delete state.selected[a.id];
    delete state.editing[a.id];
    delete state.drafts[a.id];
    H.completeActivity('governance-activity-' + a.id);
    return true;
  }
  function saveDraft(a, approve, root) {
    var text = (state.drafts[a.id] === undefined ? a.params : state.drafts[a.id]).trim();
    if (!text || text.length > 2000) {
      state.receipt = '参数需为 1–2000 字，尚未保存';
      refresh(root);
      return;
    }
    var before = a.params;
    a.params = text;
    audit(a.action, '改稿', a.action + ' · 原参数：' + before + ' · 新参数：' + text);
    if (approve) decide(a, '已批');
    else state.editing[a.id] = false;
    state.receipt = a.action + (approve ? ' 已改稿并登记批准（演示）' : ' 已保存本页改稿');
    refresh(root);
  }
  function approvalCard(a, root) {
    var editable = a.status === '待批';
    var editor = editable && state.editing[a.id];
    return el('article', 'item', [
      el('div', demoText("governance.sample.20"), [el('h3', 'h3', a.action), badge(a.status)]),
      editable ? levelMark('L3', a.action, a.scope, a.bot) : null,
      note(botName(a.bot) + ' · ' + a.created + ' · ' + a.expires),
      el('p', 'sub', '影响范围：' + a.scope),
      el('pre', 'params', a.params),
      a.permissionId ? note('目标等级已绑定结构化申请；正文改稿不会改变目标等级。需改等级请重新申请。') : null,
      a.receipt ? badge('已登记演示回执', 'good') : null,
      actions([
        editable ? btn(state.selected[a.id] ? ['已选择 ',H.icon('check',{fill:true})] : '选择', function () {
          state.selected[a.id] = !state.selected[a.id]; refresh(root);
        }, state.selected[a.id] ? 'active' : '', { 'aria-pressed': String(!!state.selected[a.id]) }) : null,
        editable ? btn(editor ? '收起改稿' : '改稿后批', function () {
          state.editing[a.id] = !editor; refresh(root);
        }) : null,
        editable ? btn('批准', function () {
          decide(a, '已批'); refresh(root);
        }, 'primary', { disabled: !!editor }) : null,
        editable ? btn('拒绝', function () { decide(a, '已拒'); refresh(root); }) : null,
        btn('详情', function () { H.openPanel('governance-detail', { id: a.id }); H.toast('已打开「' + a.action + '」的审批详情 · 本页演示，未真实执行'); }, 'tertiary')
      ]),
      editor ? el('div', 'editor', [
        el('label', 'label', ['可编辑参数（仅本页）', el('textarea', 'field', null, {
          value: state.drafts[a.id] === undefined ? a.params : state.drafts[a.id], rows: 4, maxLength: 2000,
          'aria-label': a.action + ' · 审批参数', onInput: function (e) { state.drafts[a.id] = e.target.value; }
        })]),
        actions([
          btn('保存改稿', function () { saveDraft(a, false, root); }),
          btn('保存并批准', function () { saveDraft(a, true, root); }, 'primary')
        ])
      ]) : null
    ], botAttrs(a.bot));
  }
  function batch(result, root) {
    var items = pending().filter(function (a) { return state.selected[a.id]; });
    if (!items.length) state.receipt = '请先选择至少一张待批卡';
    else if (items.some(function (a) { return state.editing[a.id]; })) {
      state.receipt = '所选卡有未保存改稿，请先保存或收起再批量处理';
    } else {
      var count = items.filter(function (a) { return decide(a, result); }).length;
      state.receipt = '批量登记 ' + count + ' 张' + result + '，未执行真实动作';
    }
    refresh(root);
  }
  function filteredLogs() {
    return state.logs.filter(function (log) { return state.logFilter === '全部' || log.result === state.logFilter; });
  }
  function exportPreview(root) {
    function csvCell(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
    var rows = filteredLogs().map(function (x) { return [x.time, x.who, x.what, x.result, x.detail].map(csvCell).join(','); });
    state.preview = '时间,操作者,对象,结果,详情\n' + rows.join('\n');
    H.toast('模拟生成审批日志 CSV · ' + rows.length + ' 条；仅预览，不落盘');
    refresh(root);
  }
  function inbox(root) {
    var filtered = state.approvals.filter(function (a) { return state.filter === '全部' || a.status === state.filter; });
    var selectedCount = pending().filter(function (a) { return state.selected[a.id]; }).length;
    return [
      card('审批收件箱', '项目总管「今天」· 审批流程', [
        note('待批 ' + pending().length + ' 张 · 所有批准只登记假回执；外发、付费、部署均未执行。'),
        segment('审批状态', state.filter, ['全部', '待批', '已批', '已拒', '超时'], function (v) { state.filter = v; refresh(root); }),
        actions([
          btn('选择全部待批', function () { pending().forEach(function (a) { state.selected[a.id] = true; }); refresh(root); }),
          btn('清空选择', function () { state.selected = {}; refresh(root); }, 'tertiary'),
          btn('批量批准 · ' + selectedCount, function () { batch('已批', root); }, 'primary'),
          btn('批量拒绝 · ' + selectedCount, function () { batch('已拒', root); })
        ]),
        filtered.length ? filtered.map(function (a) { return approvalCard(a, root); }) : note('此状态暂无审批，切换「全部」查看其余卡片。')
      ]),
      card('审批历史与审计日志', '项目总管「今天」· 追加式决策回执', [
        note('保留谁、何时、对什么、参数快照与结果。筛选结果同时决定导出预览范围。'),
        segment('日志结果', state.logFilter, ['全部', '已批', '已拒', '超时', '改稿', '申请', '收回'], function (v) {
          state.logFilter = v; state.preview = ''; refresh(root);
        }),
        actions([btn('导出 CSV 预览', function () { exportPreview(root); }),
          state.preview ? btn('收起预览', function () { state.preview = ''; refresh(root); }) : null]),
        note('当前 ' + filteredLogs().length + ' 条 / 总计 ' + state.logs.length + ' 条'),
        filteredLogs().length ? filteredLogs().map(function (x) {
          return row(x.what, [x.who + ' · ' + x.time, el('p', 'sub', x.detail)], [badge(x.result)]);
        }) : note('没有匹配的日志。'),
        state.preview ? el('div', 'editor', [el('h3', 'h3', '审批日志 · CSV 演示预览'), el('pre', 'params', state.preview)]) : null
      ])
    ];
  }

  function permissionsPage(root) {
    return [
      card('工具权限分级表', demoText("governance.sample.21"), [
        el('div', 'notice', '未标级工具一律按 L3 待审批处理。' + levelSummary + '；本表仅样张。'),
        note('页面改级只能发起请求；原等级保持，只有用户明确批准后才变更本页演示等级。L4 不能通过改级或放权绕过。'),
        segment('按助理筛选权限', state.bot, demoFixture("governance.sample.22"), function (v) { state.bot = v; refresh(root); }),
        permissions.filter(function (p) { return state.bot === '全部' || p.bot === state.bot; }).map(function (p) {
          return row(p.tool + ' · ' + (p.level || '未标级 → L3'), [
            botName(p.bot) + ' · ' + p.scope, source(p.source), p.request ? note('最近申请：' + (findApproval(p.request) ? findApproval(p.request).action : '改级申请')) : null
          ], [levelMark(p.level || 'L3', p.tool, p.scope, p.bot), btn('申请改级', function () { H.openPanel('governance-detail', { permission: p.id }); }, '', { disabled: p.level === 'L4' })], p.bot);
        })
      ]),
      card('放权记录', demoText("governance.sample.23"), [
        note(demoText("governance.sample.24")),
        state.grants.map(function (g) {
          return row(g.action, [
            botName(g.bot) + ' · ' + g.date + ' · 范围：' + g.scope,
            el('blockquote', 'quote', '假引文：“' + g.quote + '”'),
            note('原话出处（虚构）：' + g.source + ' · ' + g.date.slice(0, 10)),
            g.revokedAt ? note('收回时间：' + g.revokedAt + ' · 原记录保留') : null
          ], [g.active ? levelMark('L1', '收回演示放权记录', g.scope, g.bot) : null, badge(g.active ? '演示有效' : '已收回'), btn('收回', function () {
            g.active = false;
            g.revokedAt = new Date().toLocaleString('zh-CN');
            state.grantHistory.unshift(g.action + ' · ' + g.revokedAt + demoText("governance.sample.25"));
            audit(g.action, '收回', '保留原话出处：' + g.source + '；不改变真实授权');
            refresh(root);
          }, '', { disabled: !g.active })], g.bot);
        }),
        state.grantHistory.length ? el('div', 'notice', state.grantHistory.map(note)) : note('尚无本页收回记录。')
      ])
    ];
  }
  var permissionEdits = new Map();
  function requestPermission(c, p) {
    if (!permissionEdits.has(p.id)) permissionEdits.set(p.id, {
      selected: p.level || 'L3', reason: '演示申请：仅限本项目与本工具，不扩大外发或付费范围。', created: ''
    });
    var draft = permissionEdits.get(p.id);
    function paint(root) {
      root.append(el('div', 'panel', [
        note(p.tool + ' · ' + botName(p.bot) + ' · 当前 ' + (p.level || '未标级，默认 L3')),
        levelMark('L3', '申请改级 · ' + p.tool, p.scope, p.bot),
        note(levelSummary),
        source(p.source),
        segment('申请目标等级', draft.selected, levels, function (v) { draft.selected = v; refresh(root); }),
        el('label', 'label', ['改级理由', el('textarea', 'field', null, { value: draft.reason, rows: 3, maxLength: 1000,
          onInput: function (e) { draft.reason = e.target.value; } })]),
        note('页面只能发起改级请求；原等级保持，只有用户在审批处明确批准才更新本页演示等级。L4 不可绕过，真实权限未连接。'),
        btn('生成待拍板', function () {
          if (p.level === 'L4') { draft.created = 'L4 直接拒绝，不可经改级申请绕过'; refresh(root); return; }
          if (draft.selected === (p.level || 'L3')) { draft.created = '请选择不同于当前有效等级的目标'; refresh(root); return; }
          if (!draft.reason.trim()) { draft.created = '请填写改级理由'; refresh(root); return; }
          var existing = pending().find(function (a) { return a.permissionId === p.id; });
          if (existing) { draft.created = '已有待批的「' + existing.action + '」申请，请先处理'; refresh(root); return; }
          var id = 'A-' + String(state.serial++).padStart(3, '0');
          state.approvals.unshift({ id: id, bot: p.bot, action: '更改工具权限等级 · ' + p.tool,
            params: '工具：' + p.tool + '\n等级：' + (p.level || '默认 L3') + ' → ' + draft.selected + '\n理由：' + draft.reason,
            permissionId: p.id, oldLevel: p.level, newLevel: draft.selected, scope: botName(p.bot) + ' · ' + p.scope,
            status: '待批', created: new Date().toLocaleString('zh-CN'), expires: '演示剩余 30 分钟' });
          p.request = id;
          draft.created = '已生成「' + p.tool + '」改级申请 · 待用户拍板（演示）';
          registerApprovalActivity(findApproval(id));
          audit(p.tool, '申请', '目标等级：' + (p.level || '默认 L3') + ' → ' + draft.selected);
          refresh(root);
        }, 'primary', { disabled: p.level === 'L4' }),
        el('p', 'notice', draft.created || '尚未生成申请', { role: 'status' }),
        btn('查看审批收件箱', function () { askSafety(); })
      ], botAttrs(p.bot)));
    }
    mount(c, paint);
  }

  function svgNode(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    node.setAttribute('class', prefix + tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }
  function barChart(data) {
    var svg = svgNode('svg', { viewBox: '0 0 320 140', role: 'img', 'aria-label': state.window + ' 用量柱状图，虚构美元' });
    var max = Math.max.apply(null, data.bars);
    data.bars.forEach(function (value, i) {
      var slot = 300 / data.bars.length, height = 82 * value / max, x = 10 + i * slot;
      svg.append(svgNode('rect', { x: x + 5, y: 106 - height, width: slot - 12, height: height,
        fill: 'var(--bot)', stroke: demoText("governance.stroke.26"), 'stroke-width': demoText("governance.sample.27") }));
      var amount = svgNode('text', { x: x + slot / 2, y: 98 - height, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 11 });
      amount.textContent = value.toFixed(2);
      var label = svgNode('text', { x: x + slot / 2, y: 128, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 11 });
      label.textContent = data.labels[i];
      svg.append(amount, label);
    });
    return svg;
  }
  function ringChart(items, total) {
    var svg = svgNode('svg', { viewBox: '0 0 160 140', role: 'img', 'aria-label': state.allocation + ' 费用占比：' + items.map(function (x) { return x.join(' ') + '%'; }).join('，') });
    var offset = 0, colors = ['--bot', '--sky', '--pink', '--mint'];
    items.forEach(function (item, i) {
      svg.append(svgNode('circle', { cx: 80, cy: 68, r: 45, fill: 'none', stroke: 'var(' + colors[i % colors.length] + ')',
        'stroke-width': 17, pathLength: 100, 'stroke-dasharray': item[1] + ' ' + (100 - item[1]),
        'stroke-dashoffset': -offset, transform: 'rotate(-90 80 68)' }));
      offset += item[1];
    });
    var text = svgNode('text', { x: 80, y: 73, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 18 });
    text.textContent = '$' + total.toFixed(2);
    svg.append(text);
    return svg;
  }
  function amount(value, currency) { return value === null ? '未知' : (currency || '$') + value.toFixed(2); }
  function metric(label, value, sub) { return el('div', 'metric', [note(label), el('strong', 'big', value), note(sub)]); }
  function sampledLedger() {
    var hours = state.window === '5 小时' ? 5 : state.window === '7 天' ? 168 : 720;
    return ledger.filter(function (item) { return item.ageHours <= hours; });
  }
  function routeStatus() {
    var occupied = Math.max(state.usageProbe, quota.sevenDay);
    return occupied >= 100 ? '暂停新增工作' : !state.fallback ? '仅提醒，等待选择' :
      occupied >= state.threshold ? demoText("governance.sample.28") : '等待达到阈值';
  }
  function askSafety() { H.runCapability('governance-approvals', '看看待批与审批历史'); }
  function usage(root) {
    var items = sampledLedger(), grouped = {}, unknown = 0;
    items.forEach(function (item) {
      var key = state.allocation === '按 bot' ? item.bot : state.allocation === '按模型' ? item.model : item.project;
      if (item.cost === null) { unknown++; return; }
      grouped[key] = (grouped[key] || 0) + item.cost;
    });
    var total = Object.keys(grouped).reduce(function (n, key) { return n + grouped[key]; }, 0);
    var parts = Object.keys(grouped).map(function (key) { return [key, total ? grouped[key] / total * 100 : 0]; });
    function windowMetric(label, value, sub) {
      return el('div', 'metric', [note(label), el('strong', 'big', value + '%'), progress(value, label + '演示占用'), note(sub)]);
    }
    return [
      card('额度与余额', '离线样张 · 不是提供方账单', [
        note('四项独立口径；全部为演示值。真实订阅窗口无法核验，现金与赠送余额不能推算订阅剩余。'),
        el('div', 'ledger-metrics', [
          windowMetric('5 小时', state.usageProbe, '订阅占用 · 演示基准 ' + quota.snapshotAt),
          windowMetric('7 天', quota.sevenDay, '订阅占用 · 演示基准 ' + quota.snapshotAt),
          windowMetric('30 天', Math.round(35 / state.budget * 100), demoText("governance.sample.29") + amount(state.budget)),
          el('div', 'metric', [note('现金余额'), el('strong', 'big', demoText("governance.sample.30")), progress(65.2, demoText("governance.sample.31")), note(demoText("governance.sample.32"))])
        ]),
        row('到 ' + state.threshold + '% 自动换便宜模型',
          demoText("governance.sample.33") + state.usageProbe + '% · ' + routeStatus() + '；仅模拟文字任务路由',
          [badge(state.fallback ? '规则开启 · 演示' : '规则关闭 · 演示'), btn('问 ' + featureOwnerName('ledger'), function () { featureDraft('ledger', '到80%自动换便宜模型'); })], null, 'routing-row'),
        note('100% 优先暂停；额外积分另行授权。不会连接真实账单或更改真实模型。')
      ]),
      card('费用分摊', '只汇总下方同窗口样本中已知的估算费用', [
        segment('流水窗口', state.window, Object.keys(windows), function (v) { state.window = v; refresh(root); }),
        segment('用量分摊维度', state.allocation, Object.keys(allocations), function (v) { state.allocation = v; refresh(root); }),
        el('figure', 'chart', [el('figcaption', 'sub', state.window + ' · ' + (state.allocation === '按 bot' ? '按助理' : state.allocation) + ' · 已知样本合计 ' + amount(total)), ringChart(parts, total)]),
        parts.map(function (item) { return row(state.allocation === '按 bot' ? botName(item[0]) : item[0], item[1].toFixed(1) + '% · ' + amount(grouped[item[0]])); }),
        note('费用未知 ' + unknown + ' 单，未纳入分摊；样本合计不是订阅额度或全量账单。')
      ]),
      card('逐单流水', '演示调用凭证 · ' + state.window + '样本', [
        note('共 ' + items.length + ' 单 · ' + items.reduce(function (n, item) { return n + item.calls; }, 0) + ' 次调用。输入已含缓存读取，token 合计只算输入与输出。'),
        items.map(function (item) {
          return el('article', 'item', [
            row(item.layer + ' · ' + item.model,
              '所属任务：' + item.project + ' · ' + botName(item.bot) + ' · ' + item.ageHours + ' 小时前（演示）',
              [btn(state.ledgerFocus === item.id ? '收起凭证' : '查看凭证', function () { state.ledgerFocus = state.ledgerFocus === item.id ? '' : item.id; refresh(root); })]),
            note('调用 ' + item.calls + ' 次 · ' + tokenLabel(item.input + item.output) + ' · 估算费用 ' + amount(item.cost)),
            note('输入：' + tokenLabel(item.input) + '；输出：' + tokenLabel(item.output) + '；缓存读取：' + (item.cache === null ? '未知' : tokenLabel(item.cache))),
            state.ledgerFocus === item.id ? el('div', 'notice', [source(item.source), note('来源层：' + item.layer + demoText("governance.sample.34"))]) : null
          ]);
        }),
        btn('问逐单费用', function () { H.runCapability('governance-ledger', '看看逐单 token 费用'); })
      ]),
      el('details', 'item', [el('summary', 'summary', '展开会话级明细与生成验收台账'), sessionCard(root), productionCard(root)])
    ];
  }
  function ledgerRender(root) {
    mount(root, function (target) {
      var content = el('div', 'content');
      H.renderFeatureSections(content, 'ledger');
      target.append(el('div', 'wrap', [H.pageTitle('账本', '额度与费用 · 离线演示'), content]));
    });
  }
  function countdown() {
    
    var left = Math.max(0, 90 * 60 - Math.floor((Date.now() - startedAt) / 1000));
    return String(Math.floor(left / 3600)).padStart(2, '0') + ':' + String(Math.floor(left / 60) % 60).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  }
  var startedAt = Date.now();
  function sessionCard(root) {
    var items = rounds[state.session];
    return card('会话级明细', '会话统计、用量与费用估算', [
      note('本卡统一使用演示美元（USD），未连接提供方账单。'),
      el('h3', 'h3', '最贵会话 · 与费用排行共用回执'),
      costSessions.map(function (session) {
        var total = sessionCost(session);
        return row(session.title, [
          note(session.turns.map(function (turn) { return '第 ' + turn.turn + ' 轮 ' + demoFee(turn.cost); }).join(' + ')),
          note('会话合计：' + (knownCost(total) ? demoFee(total) : '未知（有轮次缺回执，不参与排名）'))
        ]);
      }),
      el('h3', 'h3', '峰谷定价演示 · 独立假设，未计入上述回执'),
      segment('会话', state.session, Object.keys(rounds), function (v) { state.session = v; refresh(root); }),
      el('div', 'notice', [
        demoText("governance.sample.35"),
        el('strong', 'countdown', countdown()),
        note('仅样张倒计时，按本页打开后的时间推进；点击刷新读取剩余时间，不代表实际模型定价。'),
        btn('刷新倒计时', function () { refresh(root); H.toast('已读取本页假时段倒计时：' + countdown() + ' · 不代表实际定价'); })
      ]),
      items.map(function (item, i) {
        var rate = item.cache === null ? null : Math.round(item.cache / item.input * 100);
        return row('第 ' + (i + 1) + ' 轮 · ' + item.model, [
          '输入：' + tokenLabel(item.input) + '；输出：' + tokenLabel(item.output) + '；缓存读取：' + (item.cache === null ? '未知' : tokenLabel(item.cache)),
          note('缓存命中率 ' + (rate === null ? '未知' : rate + '%') + '（缓存读取 ÷ 输入） · 速度 ' + item.speed + ' token/s'),
          note('峰价估算 ' + amount(item.peak) + ' / 谷价估算 ' + amount(item.valley))
        ], [badge(rate === null ? '缓存待核' : '缓存命中 ' + rate + '%', rate === null ? 'warm' : 'good')]);
      }),
      note('会话合计：峰价 $' + items.reduce(function (n, r) { return n + r.peak; }, 0).toFixed(2) + ' / 谷价 $' + items.reduce(function (n, r) { return n + r.valley; }, 0).toFixed(2) + ' · 非账单')
    ]);
  }
  function quotaCard(root) {
    var paused = Math.max(state.usageProbe, quota.sevenDay) >= 100;
    var cheap = state.fallback && Math.max(state.usageProbe, quota.sevenDay) >= state.threshold;
    var out = el('strong', 'big', state.threshold + '%');
    var slider = el('input', 'range', null, { type: 'range', min: 50, max: 95, step: 1, value: state.threshold,
      'aria-label': '切换便宜模型的额度阈值', onInput: function (e) {
        state.threshold = Number(e.target.value); out.textContent = state.threshold + '%';
      }, onChange: function () { audit('额度降级阈值', '设置', state.threshold + '%，仅本页'); refresh(root); }
    });
    return card('额度预警与自动降级规则', demoText("governance.sample.36"), [
      row('额度到 ' + state.threshold + '% 换便宜模型', demoText("governance.sample.37"), [out]),
      el('label', 'label', ['阈值滑块 · 50%–95%', slider]),
      toggle('达到阈值自动换便宜模型（演示）', state.fallback, function (v) { state.fallback = v; refresh(root); }),
      row('额度达到 100%：暂停新增工作', '优先级高于降级；额外积分、赠送余额均不作为默认续跑预算', [badge('固定暂停规则', 'good')]),
      row('订阅额度未知：标记无法核验', '真实窗口尚未连接，以下只测试假数据规则；不拿余额推算订阅剩余'),
      segment('模拟额度占用', String(state.usageProbe) + '%', [String(quota.usageProbe) + '%', '80%', '100%'].filter(function (v, i, list) { return list.indexOf(v) === i; }), function (v) { state.usageProbe = parseInt(v, 10); refresh(root); }),
      progress(state.usageProbe, '模拟额度占用'),
      el('div', 'notice', [badge(paused ? '暂停' : cheap ? '已模拟降级' : '原模型', paused ? 'bad' : 'good'),
        note('假输入 ' + state.usageProbe + '% → ' + (paused ? '停止新增工作，等待额度恢复或单独授权' : cheap ? demoText("governance.sample.38") : demoText("governance.sample.39")))])
    ]);
  }
  function budgetCard(root) {
    var field = el('input', 'field', null, { type: 'number', min: 1, max: 10000, step: 1, value: state.budget, 'aria-label': '30 天预算上限（演示美元）' });
    return card('预算上限设置', '费用估算 · 任务费用归集', [
      row('30 天总预算', amount(state.budget), [badge(state.budgetStop ? '到顶暂停' : '仅提醒')]),
      row('当前累计（虚构）', demoText("governance.sample.40") + amount(Math.max(0, state.budget - 35)), [badge(state.budget <= 35 ? '预算触顶' : '预算内', state.budget <= 35 ? 'bad' : 'good')]),
      row('预算归集范围', demoText("governance.sample.41")),
      progress(Math.round(35 / state.budget * 100), '30 天预算使用比例'),
      el('label', 'label', ['总上限 · USD · 1–10000 的整数', field]),
      toggle('预算到顶暂停新任务（演示）', state.budgetStop, function (v) { state.budgetStop = v; refresh(root); }),
      btn('保存预算上限', function () {
        var value = Number(field.value);
        if (!Number.isInteger(value) || value < 1 || value > 10000) {
          state.receipt = '预算需为 1–10000 的整数，未保存';
        } else {
          state.budget = value; state.receipt = '已保存演示预算 $' + value + '，真实计费与拦截未连接';
          audit('预算上限', '设置', '$' + value + ' / 30 天；仅本页');
        }
        refresh(root);
      }, 'primary')
    ]);
  }
  function productionCard(root) {
    var stages = ['计划', '生成', '审核', '提交', '下载', '验片'];
    if (!state.production) state.production = [0, 2, 4];
    return card('生成台账与验收阶段', demoText("governance.sample.42"), [
      note('流程样张，未调用图片或视频模型；任务编号不能证明下载、验片或公开。'),
      demoFixture("governance.sample.43").map(function (title, i) {
        return row(title, '当前：' + stages[state.production[i]] + ' · 付费授权：未连接 · 真实文件：未连接', [
          btn('模拟下一阶段', function () { state.production[i] = (state.production[i] + 1) % stages.length; refresh(root); })
        ]);
      })
    ]);
  }

  function security(root) {
    return [
      card('安全加固状态', demoText("governance.securityHeading"), [
        note('来源记录：四项仅在隔离测试分支验收，主线未上；今天未复核。三态按钮只切换假样张，不改变历史事实或实际部署。'),
        el('div', 'legend', [badge('已上主线', 'good'), badge('仅测试分支', 'warm'), badge('未做', 'bad')]),
        safety.map(function (item) {
          return el('div', 'item', [
            row(item.title, [item.evidence, note('下一步：' + item.next), source(item.source)], [badge((item.simulated ? '演示：' : '') + item.status)]),
            segment(item.title + ' 演示状态', item.status, ['已上主线', '仅测试分支', '未做'], function (v) {
              item.status = v; item.simulated = true;
              state.securityHistory.unshift(item.title + ' → ' + v + '（仅样张）');
              audit(item.title, '模拟状态', v + '，历史证据未改变'); refresh(root);
            })
          ]);
        }),
        state.securityHistory.length ? el('div', 'notice', state.securityHistory.slice(0, 3).map(note)) : null
      ]),
      card('监听端口与入口一览', demoText("governance.sample.44"), [
        note('端口与机器仅供示例映射；未扫描、未连接。隔离按钮只标记本页处置方案，不关闭真实服务。'),
        ports.map(function (p) {
          return row(p.name + ' · ' + p.endpoint, [p.machine + ' · ' + p.scope, note(p.isolated ? '本页处置：已标记待隔离复核' : '本页处置：待复核')], [
            btn(p.isolated ? '撤回隔离标记' : '标记待隔离', function () { p.isolated = !p.isolated; refresh(root); })
          ]);
        })
      ]),
      card('健康检查', demoText("governance.sample.45"), [
        note('真实状态均未知；模拟检查会填入预设灯号。轮次：' + state.healthRuns),
        btn('运行模拟检查', function () {
          state.healthRuns++;
          health.forEach(function (item) { item.result = item.after; });
          audit('健康检查', '模拟检查', '内核、中间层、助理、通道；假结果，无网络探测'); refresh(root);
        }, 'primary'),
        health.map(function (item) {
          return row(item.name, item.kind + ' · ' + item.machine + ' · ' + (state.healthRuns ? '本页模拟第 ' + state.healthRuns + ' 轮' : '从未检测'), [badge(item.result, item.result === '正常' ? 'good' : 'warm')]);
        })
      ]),
      card('事故记录', demoText("governance.sample.46"), [
        segment('事故状态', state.incidentFilter, ['全部', '处理中', '已结案'], function (v) { state.incidentFilter = v; refresh(root); }),
        incidents.filter(function (item) { return state.incidentFilter === '全部' || item.status === state.incidentFilter; }).map(function (item) {
          return row(item.title, [item.project + ' · ' + item.severity + '级 · ' + item.detail, note('下一步：' + item.next)], [
            badge(item.status), btn(item.status === '已结案' ? '重新打开' : '登记结案', function () {
              item.status = item.status === '已结案' ? '处理中' : '已结案';
              audit(item.title, '事故记录', item.status + '，仅演示处置'); refresh(root);
            })
          ]);
        })
      ])
    ];
  }
  function maintenance(root) {
    var checklist = ['备份 sqlite / profile / lock', '修复 skip 并检查插件加载', '隔离兼容与契约测试', '准备回滚并完成恢复演练'];
    var checked = checklist.filter(function (name) { return state.checks[name]; }).length;
    return [
      card('备份与回滚', 'DSH 备份、版本冻结与隔离恢复演练', [
        note('列表与校验和结果全为虚构；真实备份是否存在未知。按钮不读写备份、不恢复生产。'),
        backups.map(function (item) {
          return row(backupName(item.id), [item.version + ' · ' + item.size + ' · ' + item.content, note(item.result)], [
            btn(state.backup === item.id ? '已选为恢复源' : '选为恢复源', function () { state.backup = item.id; state.rollback = ''; refresh(root); }, state.backup === item.id ? 'active' : '', { 'aria-pressed': String(state.backup === item.id) })
          ]);
        }),
        toggle('版本锁 · 0.2.2-rc.1（演示）', state.lock, function (v) { state.lock = v; state.upgrade = ''; refresh(root); }),
        el('h3', 'h3', '恢复演练记录'),
        drills.map(function (text) { return row('隔离恢复演练', text); }),
        actions([
          btn('模拟隔离恢复演练', function () {
            state.drillRuns++;
            drills.unshift('本页第 ' + state.drillRuns + ' 次 · ' + backupName(state.backup) + ' → 隔离测试区 · 4.1 秒 · 模拟通过');
            audit('恢复演练', '模拟检查', backupName(state.backup) + '，没有恢复真实数据'); refresh(root);
          }),
          btn('一键回滚（占位）', function () {
            state.rollback = '回滚预览：' + backupName(state.backup) + ' → 隔离测试区；核验 sqlite / profile / lock，再比对版本与完整性。真实恢复未连接，未执行。';
            refresh(root);
          })
        ]),
        state.rollback ? el('div', 'notice', [el('h3', 'h3', '回滚计划预览'), note(state.rollback),
          btn('收起计划', function () { state.rollback = ''; refresh(root); })]) : null
      ]),
      card('升级中心', demoText("governance.upgradeHeading"), [
        row('当前版本', '0.2.2-rc.1 · 历史记录，当前运行未核验', [badge(state.lock ? '版本已锁' : '演示已解锁')]),
        row('可用候选', '0.2.2-rc.2 · 可用性与变更清单均为样张'),
        row('契约测试结果', state.contractRun ? '模拟结果：注册 5/5、参数隔离 3/3、拒绝路径 4/4；没有运行真实升级测试' : '尚未运行；先看隔离候选', [
          btn('模拟契约测试', function () { state.contractRun = true; state.upgrade = ''; audit('rc.2 契约', '模拟检查', '预设 12/12，不是实测通过'); refresh(root); })
        ]),
        note('升级前清单 · ' + checked + ' / ' + checklist.length + ' · 勾选只表示本页演示确认'),
        checklist.map(function (name) {
          return toggle(name, !!state.checks[name], function (v) { state.checks[name] = v; state.upgrade = ''; refresh(root); });
        }),
        btn('检查升级条件', function () {
          var missing = checklist.filter(function (name) { return !state.checks[name]; });
          state.upgrade = state.lock ? '版本锁未解除，候选继续暂存。' : !state.contractRun ? '缺少模拟契约结果。' : missing.length ? '还缺：' + missing.join('、') : '演示条件齐备：候选 rc.2 可提交人工审阅；真实升级仍未连接，未部署。';
          refresh(root);
        }, 'primary'),
        state.upgrade ? el('div', 'notice', state.upgrade, { role: 'status' }) : null
      ])
    ];
  }
  function rules(root) {
    return [
      card('红线与规则', '全局工作规则 · 来源与确认标签', [
        note('规则摘录与 AI 整理分别标记；提出者、日期和确认状态不由执行成功推定。'),
        segment('按项目看规则', state.ruleProject, demoFixture("governance.sample.47"), function (v) { state.ruleProject = v; refresh(root); }),
        rulesData.filter(function (r) { return state.ruleProject === '全部' || r.project === state.ruleProject; }).map(function (r, i) {
          return el('div', 'item', [
            row(r.project + ' · ' + r.title, [note(r.confirm + ' · ' + r.tag), source(r.source)], [
              btn(r.open ? '收起适用范围' : '看适用范围', function () { r.open = !r.open; refresh(root); })
            ]),
            r.open ? el('div', 'notice', r.detail) : null
          ]);
        })
      ]),
      card('密钥管理', demoText("governance.sample.48"), [
        note('只展示虚构键名与接入状态；不接收、不读取、不存储任何值。密钥应在本机隐藏输入，不能贴入聊天。'),
        ['模型服务密钥（演示）', '客服通道令牌（演示）', '视频服务令牌（演示）'].map(function (name) {
          return row(name, '已遮蔽 · 未连接 · 从实际运行配置取目标路径', [
            btn(state.keyGuide === name ? '收起放置说明' : '粘贴即放置说明', function () { state.keyGuide = state.keyGuide === name ? '' : name; refresh(root); })
          ]);
        }),
        state.keyGuide ? el('div', 'notice', [
          el('h3', 'h3', state.keyGuide + ' · 一键命令交接'),
          row('1 · 粘贴、回车', '由项目提供一键命令，read -s 隐藏输入；输入不进入参数、历史或临时文件。'),
          row('2 · 验证后放置', '先免费验证；从运行配置取目标；旧值备份后原子替换，权限 0600，远端用 SSH 标准输入。'),
          row('3 · 自检与恢复', '用服务读取函数自检；真实小额调用须另核授权；失败给回滚办法，匹配剪贴板后清空，不顺手重启。'),
          note(demoText("governance.sample.49"))
        ]) : null
      ])
    ];
  }

  function paintView(root) {
    root.append(H.pageTitle('权限', '现状与审批记录'));
    H.renderFeatureSections(root, 'permissions');
  }
  function render(root) { mount(root, paintView); }
  function panel(c, ctx) {
    var p = ctx.params || {}, a = findApproval(p.id);
    if (a) {
      mount(c, function (root) {
        root.append(el('div', 'panel', [note('本页审批详情 · 原参数与结果均不会送到执行器'), approvalCard(a, root),
          state.receipt ? el('p', 'notice', state.receipt, { role: 'status' }) : null,
          btn('打开审批收件箱', function () { askSafety(); })]));
      });
      return;
    }
    if (p.id) {
      mount(c, function (root) {
        root.append(el('div', 'panel', [note('未找到对应演示审批，请回收件箱核对。'),
          btn('打开收件箱核对', function () { askSafety(); })]));
      });
      return;
    }
    if (p.permission) {
      var permission = permissions.find(function (item) { return item.id === p.permission || item.tool === p.permission; });
      if (permission) { requestPermission(c, permission); return; }
    }
    settings(c);
  }
  function settings(c) {
    c.append(el('div', 'panel', [note('预算与预警请找账本负责助理；本页演示，刷新复原。'),
      row('30 天预算', amount(state.budget) + ' · 到 ' + state.threshold + '% 换便宜模型 · ' + routeStatus()),
      actions([btn('打开账本', function () { H.navigate({ view: 'ledger' }); }),
        btn('问额度规则', function () { H.runCapability('governance-routing', '到80%自动换便宜模型'); })])
    ]));
  }

  // Each reply is synchronous and only mutates this module's in-page demo state.
  var undoSerial = 0, undos = new Map();
  function statuses(items) { return items.map(function (item) { return { label: tidyCopy(item[0]), value: tidyCopy(item[1]), tone: item[2] || 'neutral' }; }); }
  function setDemo(object, key, value, feature) {
    var before = object[key];
    if (before === value) return null;
    object[key] = value;
    var id = 'governance-undo-' + (++undoSerial);
    undos.set(id, { object: object, key: key, before: before, after: value, used: false, feature: feature });
    audit(key, '对话修改', '仅本页演示值已修改，可撤销', feature);
    refresh();
    return id;
  }
  H.registerCard('governance-capability-status', { title: '治理能力状态', quoteLabel: function (d) { return d.title + '：' + d.summary; }, render: function (d) {
    var undo = d.undo && undos.get(d.undo);
    return el('section', 'card', [el('span', 'stamp', '助理回复 · 离线演示'), el('h3', 'h3', d.title), note('本页演示，未真实执行'), note(d.summary),
      undo && !undo.used ? levelMark('L1', d.title + ' · 撤销本页修改') : null,
      actions((d.items || []).slice(0, 3).map(function (item) { return badge(item.label + ' · ' + item.value); })),
      d.changed ? el('p', 'notice', '已改好 · 仅当前页内存，刷新复原；真实系统未修改。', { role: 'status' }) : null,
      actions([
        d.ledger ? btn('打开账本', function () { H.navigate({ view: 'ledger' }); }) : null,
        d.approvals ? btn('查看首张待批详情', function () {
          var a = pending()[0];
          if (a) H.openPanel('governance-detail', { id: a.id }); else H.toast('本页暂无待批');
        }) : null,
        d.permission ? btn('查看单项改级申请', function () { H.openPanel('governance-detail', { permission: 'draft' }); }) : null,
        undo ? btn(undo.used ? '已撤销' : '撤销这次修改', function (event) {
          if (undo.used) return;
          if (undo.object[undo.key] !== undo.after) { H.toast('此值后来已改变，请通过对话重新选择，避免覆盖'); return; }
          undo.object[undo.key] = undo.before; undo.used = true;
          audit(undo.key, '撤销', '仅撤销此条本页修改', undo.feature); refresh();
          event.target.textContent = '已撤销'; event.target.disabled = true;
          var replyCard = event.target.closest('.m-governance-card');
          var sticker = replyCard && replyCard.querySelector('[data-level-sticker]');
          if (sticker) sticker.remove();
          H.toast('已撤销本页修改');
        }, '', { disabled: undo.used }) : null
      ]), note('所有数值与回执均为样张；不连接设备、模型或提供方。')
    ]);
  } });
  function capability(spec) {
    H.registerCapability({ id: spec.id, title: spec.title, icon: spec.icon || 'shield',
      steward: featureOwnerId(spec.featureId || (spec.ledger ? 'ledger' : 'permissions')), featureId: spec.featureId || (spec.ledger ? 'ledger' : 'permissions'), group: spec.group || '安全与维护', oneLine: spec.oneLine,
      status: spec.status, phrases: spec.phrases, reply: function (phrase) {
        var change = spec.change ? spec.change(phrase) : null;
        return [{ type: 'governance-capability-status', data: { title: spec.title, summary: spec.describe(phrase),
          items: spec.status(), undo: change, changed: !!change, ledger: !!spec.ledger,
          approvals: spec.id === 'governance-approvals', permission: spec.id === 'governance-permissions' } }];
      }
    });
  }
  capability({ id: 'governance-ledger', title: 'token 与逐单费用', icon: 'usage', featureId: 'ledger', group: '账本', ledger: true,
    oneLine: '查三种时间窗口、费用分摊与逐单 token 凭证。',
    status: function () { return statuses([['5 小时', state.usageProbe + '%'], ['7 天', quota.sevenDay + '%'], ['样本', ledger.length + ' 单']]); },
    phrases: ['看看逐单 token 费用', '把账本切到按模型分摊', '把30天预算设为80美元'],
    change: function (p) { return p === this.phrases[1] ? setDemo(state, 'allocation', '按模型', 'ledger') : p === this.phrases[2] ? setDemo(state, 'budget', 80, 'ledger') : null; },
    describe: function (p) { return p === this.phrases[0] ? '账本含 5 小时、7 天、30 天与现金余额；流水列出层、模型、调用、token、估算费用与所属任务。费用未知保持「未知」。' : '本页账本现在' + (state.allocation === '按 bot' ? '按助理' : state.allocation) + '展示，30 天预算 ' + amount(state.budget) + '；可打开核对。'; }
  });
  capability({ id: 'governance-routing', title: '额度提醒与便宜模型', icon: 'usage', featureId: 'ledger', group: '额度规则', ledger: true,
    oneLine: '到80%自动换便宜模型，100%先暂停；仅演示路由。',
    status: function () { return statuses([['阈值', state.threshold + '%'], ['自动切换', state.fallback ? '开启' : '关闭'], ['当前', routeStatus()]]); },
    phrases: ['到80%自动换便宜模型', '本页改成仅提醒', '本页模拟额度达到80%'],
    change: function (p) {
      if (p === this.phrases[0]) return setDemo(state, 'fallback', true, 'ledger');
      return p === this.phrases[1] ? setDemo(state, 'fallback', false, 'ledger') : setDemo(state, 'usageProbe', 80, 'ledger');
    },
    describe: function () { return '5 小时样本占用 ' + state.usageProbe + '%，阈值 ' + state.threshold + '%；' + routeStatus() + demoText("governance.describe.50"); }
  });
  capability({ id: 'governance-permissions', title: '权限分级', group: '权限与审批',
    oneLine: '查看 L0–L4 五级权限，未标级按 L3，L4 直接拒绝。',
    status: function () { return statuses([['工具', permissions.length + ' 项'], ['未标级', permissions.filter(function (p) { return !p.level; }).length + ' 项'], ['改级申请', state.plans.permission ? '待拍板' : '未起草']]); },
    phrases: ['看看工具权限分级', '草拟草稿工具改为L0的申请', '取消这份改级草案'],
    change: function (p) { return p === this.phrases[0] ? null : setDemo(state.plans, 'permission', p === this.phrases[1]); },
    describe: function () { return levelSummary + '。编辑回复草稿当前 ' + permissions[1].level + '；改级草案' + (state.plans.permission ? '已暂存为 L0 候选，未批准' : '未暂存') + '，实际权限未变。'; }
  });
  capability({ id: 'governance-grants', title: '放权记录', group: '权限与审批',
    oneLine: '原话、出处与范围一起留存，收回也保留历史。',
    status: function () { return statuses([['记录', state.grants.length + ' 条'], ['演示有效', state.grants.filter(function (g) { return g.active; }).length + ' 条']]); },
    phrases: demoFixture("governance.phrases.51"),
    change: function (p) { return p === this.phrases[0] ? null : setDemo(state.grants[0], 'active', p === this.phrases[2]); },
    describe: function () { var g = state.grants[0]; return '虚构引文：“' + g.quote + '” · ' + g.source + ' · ' + g.date + ' · 范围：' + g.scope + '。当前' + (g.active ? '演示有效' : '演示已收回') + demoText("governance.describe.52"); }
  });
  capability({ id: 'governance-approvals', title: '待批与审批历史', group: '权限与审批',
    oneLine: '在对话看待批与决策，单张审批仍能打开详情。',
    status: function () { return statuses([['待批', pending().length + ' 张'], ['审批', state.approvals.length + ' 张'], ['历史', state.logs.length + ' 条']]); },
    phrases: ['看看待批与审批历史', '列出最近三条审批决定', '哪些审批已经超时'],
    describe: function (p) {
      return p === this.phrases[1] ? state.logs.slice(0, 3).map(function (x) { return x.who + ' · ' + x.time + ' · ' + x.what + ' · ' + x.result; }).join('；') :
        state.approvals.filter(function (a) { return a.status === (p === '哪些审批已经超时' ? '超时' : '待批'); }).map(function (a) { return a.action + ' · ' + a.scope; }).join('；') || '本页没有匹配的审批。';
    }
  });
  capability({ id: 'governance-hardening', title: '加固状态',
    oneLine: '区分测试分支、主线与未做，记录下一步复核。',
    status: function () { return statuses([['仅测试分支', '4 项'], ['未做', '2 项'], ['复核计划', state.plans.hardening ? '已列入' : '未列入']]); },
    phrases: ['检查加固状态', '把加固复核列入计划', '撤回加固复核计划'],
    change: function (p) { return p === this.phrases[0] ? null : setDemo(state.plans, 'hardening', p === this.phrases[1]); },
    describe: function () { return demoText("governance.describe.53") + (state.plans.hardening ? '已暂存' : '未暂存') + '，没有部署。'; }
  });
  capability({ id: 'governance-ports', title: '端口与入口',
    oneLine: '四个示例入口只做待隔离标记，不关闭真实服务。',
    status: function () { return statuses([['示例入口', ports.length + ' 个'], ['待隔离标记', ports.filter(function (p) { return p.isolated; }).length + ' 个'], ['扫描', '未执行']]); },
    phrases: ['看看监听端口与入口', '标记候选43191待隔离', '撤回43191隔离标记'],
    change: function (p) { return p === this.phrases[0] ? null : setDemo(ports[1], 'isolated', p === this.phrases[1]); },
    describe: function () { return ports.map(function (p) { return p.machine + ' · ' + p.endpoint + ' · ' + (p.isolated ? '标记待隔离' : '待复核'); }).join('；') + '。未扫描，未断开 SSH 或其他入口。'; }
  });
  capability({ id: 'governance-backup', title: '备份与回滚',
    oneLine: '查看三份样本，先准备隔离恢复计划再核验。',
    status: function () { return statuses([['样本备份', backups.length + ' 份'], ['恢复源', backupName(state.backup)], ['计划', state.plans.rollback ? '已暂存' : '未起草']]); },
    phrases: ['查看备份与回滚', '准备最新备份隔离恢复计划', '撤回隔离恢复计划'],
    change: function (p) { return p === this.phrases[0] ? null : setDemo(state.plans, 'rollback', p === this.phrases[1]); },
    describe: function () { return '11月13日凌晨备份 · 数据库、配置与版本锁 · 48 MB · 演示校验和匹配。隔离恢复计划' + (state.plans.rollback ? '已暂存：目标 sandbox，核验配置、版本、完整性' : '未暂存') + '。真实备份是否存在未知，没有恢复数据。'; }
  });
  capability({ id: 'governance-upgrade', title: '版本锁与升级',
    oneLine: '候选升级留在审阅计划，版本锁始终可见。',
    status: function () { return statuses([['版本', '0.2.2-rc.1 样张'], ['版本锁', state.lock ? '开启' : '关闭'], ['rc.2 审阅', state.plans.upgrade ? '已列入' : '未列入']]); },
    phrases: ['看看升级与版本锁', '把rc.2列入审阅计划', '撤回rc.2审阅计划'],
    change: function (p) { return p === this.phrases[0] ? null : setDemo(state.plans, 'upgrade', p === this.phrases[1]); },
    describe: function () { return 'rc.1 是历史样张，当前运行未核验；rc.2 仅候选。审阅计划' + (state.plans.upgrade ? '已列入' : '未列入') + '；备份、隔离契约测试、兼容与回滚演练仍待核，不解锁或升级系统。'; }
  });
  // Only non-secret metadata enters the shell registry, replies and quotations.
  var newKeySerial = 0;
  var inputFixtures = [
    { id: 'governance-input-flight', what: '机票比价服务的访问口令（演示）',
      forWhat: '机票观察员的离线连接预演', blocking: '比价连接预演等待输入',
      provider: '虚构机票服务（演示）', destination: '机票观察员的演示凭据槽位', minutes: 85 },
    { id: 'governance-input-nas', what: 'NAS 备份的验证码（演示）',
      forWhat: '备份恢复预演', blocking: '备份验证预演等待输入',
      provider: '虚构备份服务（演示）', destination: '备份预演的一次性验证槽位', minutes: 35 },
    { id: 'governance-input-new-key', what: '新模型连接密钥（演示）',
      forWhat: '新模型连接预演', blocking: '模型连接预演等待输入',
      provider: '虚构模型服务（演示）', destination: '由运行配置确认的演示凭据槽位', minutes: 12 }
  ];
  function registerDemoInput(fixture, id) {
    return H.registerPendingInput({ id: id || fixture.id, bot: featureOwnerId('permissions'), featureId: 'permissions', what: fixture.what,
      forWhat: fixture.forWhat, blocking: fixture.blocking, since: Date.now() - fixture.minutes * 60000,
      cardData: { provider: fixture.provider, destination: fixture.destination, masked: '末四位 ••••' } });
  }
  var demoInputs = inputFixtures.map(function (fixture) { return registerDemoInput(fixture); });
  function inputData(item) {
    return Object.assign({}, item.cardData, { pendingId: item.id, bot: item.bot, what: item.what,
      forWhat: item.forWhat, blocking: item.blocking, masked: '末四位 ••••' });
  }
  function inputWait(since) {
    var minutes = Math.max(0, Math.floor((Date.now() - since) / 60000));
    return tidyCopy(minutes >= 1440 ? Math.floor(minutes / 1440) + ' 天' : minutes >= 60 ? Math.floor(minutes / 60) + ' 小时' : minutes + ' 分钟');
  }
  function inputSummary() {
    var items = H.pendingInputs();
    return tidyCopy('待输入 ' + items.length + ' 项。' + (items.length ? '\n' + items.map(function (item) {
      var bot = H.state.bots.find(function (b) { return b.id === item.bot; });
      return '• ' + (bot ? bot.name : '待指定助理') + '：' + item.what + '；已等 ' + inputWait(item.since) + '；卡住：' + item.blocking;
    }).join('\n') : '全部演示项目已处理。'));
  }
  H.registerCard('governance-pending-summary', { title: '待输入清单摘要',
    quoteLabel: function () { return '待输入清单摘要 · 演示，未真实执行；仅含需求说明，不含输入值。'; },
    render: function (data) {
      data = data || {};
      var items = H.pendingInputs();
      return el('section', 'card', [el('div', 'section-head', [el('h3', 'h3', '还在等你输入'), badge(items.length + ' 项')]),
        el('span', 'stamp', '演示，未真实执行'),
        note('输入只在私密输入卡遮蔽接收；不要把值贴到聊天输入框。'),
        items.length ? items.map(function (item) {
          var bot = H.state.bots.find(function (b) { return b.id === item.bot; });
          return row(item.what, [(bot ? bot.name : '待指定助理') + ' · 已等 ' + inputWait(item.since),
            note('卡住：' + item.blocking)], [btn('打开私密输入卡', function () {
              if (H.openPendingInput(item.id)) H.toast('已定位私密输入卡：' + item.what + ' · 仅本页演示');
            })]);
        }) : note('没有待输入的演示项目。'),
        data.terminal ? el('div', 'notice', [el('h3', 'h3', '我去终端做'),
          note('先由实际项目提供一键命令；你只需在终端粘贴、回车。这里没有运行配置，不编造可执行命令。'),
          note('命令应隐藏接收 → 免费验证 → 从运行配置确定位置 → 备份旧值并原子写入 → 自检；仅当剪贴板仍是该值时清空。'),
          note('本页未打开终端、未验证服务、未写入文件、未清空剪贴板；选择终端说明不会移除待输入项。')]) : null
      ]);
    }
  });
  H.registerCapability({ id: 'governance-keys', title: '密钥与待输入', icon: 'shield',
    steward: featureOwnerId('permissions'), featureId: 'permissions', group: '安全与维护', oneLine: '看看谁在等输入，在私密卡放置或转到终端处理。',
    status: function () { return statuses([['待输入', H.pendingInputs().length + ' 项'], ['放置', '离线演示'], ['提供方', '未连接']]); },
    phrases: ['看看还在等我输入什么', '帮我放一把新密钥', '我去终端做'],
    reply: function (phrase) {
      var items = H.pendingInputs(), item;
      if (phrase === '帮我放一把新密钥') {
        item = items.find(function (p) { return p.id === 'governance-input-new-key' || p.id.indexOf('governance-input-new-key-') === 0; });
        if (!item) {
          item = registerDemoInput(Object.assign({}, inputFixtures[2], { minutes: 0 }), 'governance-input-new-key-' + (++newKeySerial));
        }
      } else item = items.find(function (p) { return p.bot === featureOwnerId('permissions'); }) || items[0];
      var parts = [{ type: 'text', md: '演示，未真实执行。\n' + inputSummary() },
        { type: 'governance-pending-summary', data: { terminal: phrase === '我去终端做' } }];
      if (item) parts.push({ type: 'cards-a-secret-input', data: inputData(item) });
      return parts;
    }
  });
  H.registerConversation(featureOwnerId('permissions'), { featureId:'permissions', id: 'governance-input-demo', title: '密钥与待输入 · 离线演示', messages: [
    { from: 'user', time: '演示', parts: [{ type: 'text', md: '看看还在等我输入什么' }] },
    { from: featureOwnerId('permissions'), time: '演示', parts: [{ type: 'text', md: '演示，未真实执行。三项安全待输入均为虚构；可从清单逐项打开私密输入卡。' },
      { type: 'governance-pending-summary', data: {} }, { type: 'cards-a-secret-input', data: inputData(demoInputs[0]) }] }
  ] });
  capability({ id: 'governance-health', title: '服务健康检查',
    oneLine: '七个内核、助理与通道样本；真实连接状态未知。',
    status: function () { return statuses([['服务样本', health.length + ' 个'], ['模拟轮次', state.healthRuns], ['真实探测', '未执行']]); },
    phrases: ['看看服务健康状态', '运行一轮离线健康模拟', '重置健康模拟轮次'],
    change: function (p) { return p === this.phrases[0] ? null : setDemo(state, 'healthRuns', p === this.phrases[1] ? state.healthRuns + 1 : 0); },
    describe: function () { return state.healthRuns ? '离线第 ' + state.healthRuns + ' 轮预设结果：' + health.map(function (x) { return x.name + ' · ' + x.after; }).join('；') + '。是假灯号，不证明设备在线。' : '尚未运行本页模拟；内核、中间层、助理与通道均未实际检测。'; }
  });
  capability({ id: 'governance-incidents', title: '事故与处置记录',
    oneLine: '三条演示事故保留原因与下一步，结案不等于修复。',
    status: function () { return statuses([['处理中', incidents.filter(function (x) { return x.status === '处理中'; }).length], ['已结案', incidents.filter(function (x) { return x.status === '已结案'; }).length]]); },
    phrases: ['看看事故与下一步', '登记插件事故演示结案', '重新打开插件事故记录'],
    change: function (p) { return p === this.phrases[0] ? null : setDemo(incidents[0], 'status', p === this.phrases[1] ? '已结案' : '处理中'); },
    describe: function () { return incidents.map(function (x) { return x.title + ' · ' + x.status + ' · 下一步：' + x.next; }).join('；') + '。登记只修改假记录，没有执行修复。'; }
  });
  capability({ id: 'governance-rules', title: '红线与来源规则', group: '权限与审批',
    oneLine: '保留来源、日期与确认状态，执行成功不等于用户确认。',
    status: function () { return statuses([['规则摘录', rulesData.length + ' 条'], ['执行范围', '当前页'], ['真实写入', '未连接']]); },
    phrases: ['看看执行红线', '哪些规则仍未确认', '订阅用尽该怎么办'],
    describe: function (p) { return p === this.phrases[1] ? demoText("governance.describe.54") : p === this.phrases[2] ? demoText("governance.describe.55") : demoText("governance.describe.56"); }
  });
  function registerApprovalActivity(a) {
    H.registerActivity({ id: 'governance-activity-' + a.id, kind: 'decide', bot: botIds[a.bot] || featureOwnerId('permissions'), featureId: 'permissions',
      title: '演示 · ' + (a.permissionId ? '放权申请' : a.id === 'A-002' ? 'L3 待批' : '审批') + '：' + a.action,
      detail: '演示，未真实执行。范围：' + a.scope + '。原审批 ' + a.id + '；活动归档不代表批准或执行。',
      time: a.created + '（演示）', actions: [
        { label: '查看审批详情', run: function () { H.openPanel('governance-detail', { id: a.id }); } },
        { label: '批准（仅本页）', run: function () { settleActivityApproval(a, '已批'); } },
        { label: '拒绝（仅本页）', run: function () { settleActivityApproval(a, '已拒'); } }
      ] });
  }
  function settleActivityApproval(a, result) {
    if (!decide(a, result)) { H.toast('该演示审批已结案或基础权限已变更，请查看详情'); return; }
    refresh();
    H.postMessage((botIds[a.bot] || featureOwnerId('permissions')) + '-013', {
      from: botIds[a.bot] || featureOwnerId('permissions'), time: '刚刚', parts: [
        { type: 'text', md: '演示，未真实执行。' + a.id + ' 已登记' + result + '，活动已归入已处理；未向执行器提交。' },
        { type: 'governance-approval', data: { id: a.id, action: a.action } }
      ]
    });
  }
  pending().forEach(registerApprovalActivity);
  H.registerActivity({ id: 'governance-activity-grant', kind: 'decide', bot: featureOwnerId('permissions'), featureId: 'permissions',
    title: '演示 · 放权：草稿工具是否降到 L0', time: '今天 · 演示',
    detail: '演示，未真实执行。只讨论本地草稿工具；当前保持 L1。改级须单独起草结构化申请，不含外发、付费或生产。',
    actions: [
      { label: '查看改级申请', run: function () { H.openPanel('governance-detail', { permission: 'draft' }); } },
      { label: '本页保留原权限', run: function (activity) {
        H.completeActivity(activity.id);
        audit('放权提议', '暂缓', '用户选择保留原权限，没有新增授权。');
        H.postMessage(featureOwnerId('permissions') + '-013', { from: featureOwnerId('permissions'), time: '刚刚', parts: [
          { type: 'text', md: '演示，未真实执行。已暂缓本条放权提议，原权限不变；没有新增授权。' }
        ] });
      } }
    ] });
  [
    demoFixture("governance.sample.57"),
    { id: 'governance-activity-l1-audit', bot: featureOwnerId('permissions'), featureId: 'permissions', title: '演示 · L1 已自动整理审批摘要',
      detail: '预设的审批记录摘要已整理，只留在本页内存；未读真实文件或写入账本。', time: '刚刚（演示）' }
  ].forEach(function (item) { H.registerActivity(Object.assign({ kind: 'inform' }, item, {
    detail: '演示，未真实执行。' + item.detail
  })); });
  function settleQuotaReminder(fallback) {
    var owner = H.featureOwner('ledger');
    if (!owner) { H.toast('负责助理未指定或存在多位，请先核对名册'); return; }
    state.fallback = fallback;
    audit('额度提醒处理', '已处理', owner.name + '登记用户选择：' +
      (fallback ? '达到提醒线时模拟换便宜模型' : '仅提醒，等待选择') +
      '；当前提醒线 ' + state.threshold + '%；100% 仍优先暂停；没有调用模型。', 'ledger');
    H.completeActivity('governance-ledger-threshold-example');
    refresh();
  }
  H.registerCard('governance-quota-choice', { title: '额度提醒与模型选择', quoteLabel: function () {
    return '额度提醒 · 演示基准 ' + quota.snapshotAt + ' · 5 小时 ' + state.usageProbe + '% / 7 天 ' + quota.sevenDay + '%';
  }, render: function () {
    return el('section', 'card', [el('span', 'stamp', featureOwnerName('ledger') + ' · 演示提醒'),
      el('h3', 'h3', '5 小时样本 ' + state.usageProbe + '% · 7 天样本 ' + quota.sevenDay + '%'),
      levelMark('L1', '修改本页额度提醒规则', '本页假规则', featureOwnerId('ledger')),
      note('演示基准：' + quota.snapshotAt + '；以下只修改本页规则，真实订阅额度未连接。'),
      note('达到 ' + state.threshold + '% 时模拟换便宜模型，或仅提醒？100% 仍优先暂停。'),
      actions([
        btn('达到提醒线时模拟换便宜模型', function () { settleQuotaReminder(true); }, '', { 'data-quota-choice': 'fallback' }),
        btn('本页改成仅提醒', function () { settleQuotaReminder(false); }, '', { 'data-quota-choice': 'remind' })
      ]), note('当前规则：' + (state.fallback ? '自动切换开启' : '仅提醒') + ' · ' + routeStatus())
    ]);
  } });
  H.featureRecord('ledger', { time: quota.snapshotAt, title: '原额度提醒 · 演示快照',
    text: '5 小时 ' + state.usageProbe + '%，7 天 ' + quota.sevenDay + '%；由负责助理发到活动，处理结果留在账本。',
    parts: [{ type: 'governance-quota-choice', data: {} }] });
  H.registerActivity({ id: 'governance-ledger-threshold-example', kind: 'inform', bot: featureOwnerId('ledger'), featureId: 'ledger',
    title: '7 天窗口已到 ' + quota.sevenDay + '%（演示）', time: quota.snapshotAt,
    detail: '离线样本：5 小时 ' + state.usageProbe + '%，7 天 ' + quota.sevenDay + '%；真实额度未连接。查看账本记录选择提醒方式。',
    actions: [{ label: '查看账本记录', run: function () { H.openFeature('ledger'); } }] });

  // R8: shared shell snapshots, never a second context meter or real compactor.
  var contextLabels = { system: '系统', memory: '记忆', files: '文件', chat: '对话', tools: '工具结果' };
  var contextChoices = new Map(), contextChanges = new Map(), contextSlices = new Map();
  function tokenLabel(n) { return tidyCopy(Number(n).toLocaleString('zh-CN') + ' token'); }
  function knownCost(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0; }
  function demoFee(n) { return knownCost(n) ? '$' + n.toFixed(2) : '—'; }
  function changeContext(conversation, key, compact) {
    var snap = H.contextSnapshot(conversation);
    if (!snap || key === 'system' || (compact && key === 'memory') ||
        (!compact && !['files', 'tools', 'memory'].includes(key))) return;
    var before = snap.total, value = snap.segments[key];
    if (!value) return;
    var after = compact ? Math.max(1, Math.floor(value * (key === 'chat' ? .22 : .7))) : 0;
    var change = { key: key, before: before, segmentBefore: value, segmentAfter: after,
      after: before - value + after, label: compact ? '压缩' : '卸下这段' };
    if (key === 'memory') {
      var slices = H.memoryMounts(snap.bot);
      var slice = slices.find(function (s) { return s.id === contextSlices.get(conversation); }) || slices[0];
      if (!slice) { H.toast('当前没有可卸下的挂载切片'); return; }
      change.label = '卸下记忆 · ' + slice.title;
      change.segmentAfter = Math.max(0, value - slice.tokens);
      change.after = before - value + change.segmentAfter;
      contextChanges.set(conversation, change);
      if (!H.unmountMemory(snap.bot, slice.id)) {
        contextChanges.delete(conversation); H.toast('该切片已卸下，请重新选择'); refresh(); return;
      }
      // unmountMemory is authoritative for memory; updateContext recounts the same snapshot.
      after = H.contextSnapshot(conversation).segments.memory;
    } else contextChanges.set(conversation, change);
    var patch = {}; patch[key] = after;
    var updated = H.updateContext(conversation, { segments: patch });
    if (updated) { change.after = updated.total; change.segmentAfter = updated.segments[key]; }
    audit(change.label, '本页估算', conversationName(conversation) + ' · ' + before + ' → ' + change.after + ' token；没有改写原文件或历史消息');
    refresh();
    H.toast('本页演示，未真实执行 · ' + change.label + '：' + tokenLabel(before) + ' → ' + tokenLabel(change.after));
  }
  H.registerCard('governance-context-mix', { title: '上下文构成',
    quoteLabel: function (d) { return '上下文构成 · ' + conversationName(d.conversation) + ' · 本页演示，数字为估算'; },
    render: function (d, ctx) {
      var conversation = d.conversation || ctx.conversation;
      var root = el('section', 'card', null, { 'data-governance-context': conversation });
      mount(root, function (target) {
        var snap = H.contextSnapshot(conversation);
        if (!snap) { target.append(note('会话不存在，无法估算上下文。'), btn('看账本', function () { H.navigate({ view: 'ledger' }); })); return; }
        var selected = contextChoices.get(conversation) || 'chat';
        var slices = H.memoryMounts(snap.bot);
        var sliceId = contextSlices.get(conversation);
        if (!slices.some(function (s) { return s.id === sliceId; })) sliceId = slices[0] && slices[0].id;
        var turn = snap.costliestTurn || {}, change = contextChanges.get(conversation);
        target.setAttribute('style', H.botStyle(snap.bot));
        target.append(el('div', 'section-head', [el('h3', 'h3', '上下文构成'), el('span', 'stamp', '估算')]),
          note('本页演示，未真实执行 · 当前会话窗口，不是累计计费 token。'),
          el('p', 'big', tokenLabel(snap.total) + ' / ' + tokenLabel(snap.max)),
          el('div', 'mix-bar', Object.keys(contextLabels).map(function (key) {
            return el('span', 'mix-part ' + prefix + 'mix-' + key, null, {
              style: { width: (snap.total ? snap.segments[key] / snap.total * 100 : 0) + '%' },
              title: contextLabels[key] + ' · ' + tokenLabel(snap.segments[key])
            });
          }), { role: 'img', 'aria-label': Object.keys(contextLabels).map(function (key) { return contextLabels[key] + ' ' + tokenLabel(snap.segments[key]); }).join('，') }),
          el('div', 'mix-choices segmented', Object.keys(contextLabels).map(function (key) {
            return btn(contextLabels[key] + ' · ' + tokenLabel(snap.segments[key]), function () {
              if (key === selected) H.toast('当前已选' + contextLabels[key] + '段 · ' + tokenLabel(snap.segments[key]) + '（本页估算）');
              else { contextChoices.set(conversation, key); refresh(target); }
            }, key === selected ? 'active on' : '', { 'aria-pressed': String(key === selected), 'data-context-segment': key });
          }), { role: 'group', 'aria-label': '选择要整理的上下文段' }),
          el('h4', 'h3', '最占地方的三样'),
          el('ol', 'mix-top', snap.top3.map(function (item) {
            return el('li', 'note', item.label + ' · ' + tokenLabel(item.tokens));
          })),
          el('h4', 'h3', '这次会话最贵的一轮'),
          note('会话：' + conversationName(turn.conversation || conversation) + ' · ' + (turn.turn == null ? '轮次 —' : '第 ' + turn.turn + ' 轮') +
            ' · 费用：' + demoFee(turn.cost) + ' · token：' + (turn.tokens == null ? '—' : tokenLabel(turn.tokens))),
          note(knownCost(turn.cost) ? '演示估算费用，未连接提供方账单。' : '费用未知，尚不能确认哪轮最贵；以上是壳提供的演示候选轮次，token 不等于费用。'),
          selected === 'memory' && slices.length ? el('label', 'label', ['本次卸下的记忆切片', el('select', 'field', slices.map(function (slice) {
            return h('option', { value: slice.id, selected: slice.id === sliceId }, slice.title + ' · ' + tokenLabel(slice.tokens));
          }), { value: sliceId, 'aria-label': '本次卸下的记忆切片', onChange: function (event) {
            contextSlices.set(conversation, event.target.value);
          } })]) : '',
          note(selected === 'system' ? '系统段受保护，不能压缩或卸下。' : selected === 'memory' ? '记忆按挂载切片卸下，胶囊提示和快照同步更新；不改写记忆原文。' : selected === 'chat' ? '对话只能压缩，保留约 22% 作为摘要估算（如 41k → 约 9k）；不改写历史消息。' : '压缩演示为当前段保留 70%；卸下只调整窗口估算，原文件保留。'),
          actions([
            btn('压缩', function () { changeContext(conversation, selected, true); }, 'primary', {
              disabled: selected === 'system' || selected === 'memory' || !snap.segments[selected], 'data-context-action': 'compact' }),
            btn('卸下这段', function () { changeContext(conversation, selected, false); }, '', {
              disabled: !['files', 'tools', 'memory'].includes(selected) || !snap.segments[selected] || (selected === 'memory' && !slices.length), 'data-context-action': 'unmount' }),
            btn('看账本', function () { H.navigate({ view: 'ledger' }); }, '', { 'data-context-ledger': '' })
          ]),
          change ? el('div', 'notice', [
            note(change.label + ' · ' + contextLabels[change.key] + '：' + tokenLabel(change.segmentBefore) + ' → ' + tokenLabel(change.segmentAfter)),
            note('总窗口前后：' + tokenLabel(change.before) + ' → ' + tokenLabel(change.after) + ' · 减少 ' + tokenLabel(Math.max(0, change.before - change.after)) + '（估算）')
          ], { role: 'status', 'data-context-comparison': '' }) : note('操作后在此显示前后估算数字；刷新复原。')
        );
      });
      return root;
    }
  });
  H.on('context:updated', function () { refresh(); });
  H.on('memory:unmounted', function () { refresh(); });

  var delegationGrants = new WeakMap();
  H.registerCard('governance-delegation', { title: '放权提议',
    quoteLabel: function (d) { return '放权提议 · ' + d.action + ' · ' + (delegationLabels[d.state || 'proposed'] || '未知状态') + ' · 本页演示，未真实执行'; },
    render: function (d) {
      var root = el('section', 'card', null, { 'data-governance-delegation': '' });
      function decideDelegation(next) {
        var current = d.state || 'proposed';
        if ((next === 'approved' && (current !== 'proposed' || d.level === 'L4' || !d.scope || !levels.includes(d.level))) ||
            (next === 'rejected' && current !== 'proposed') || (next === 'revoked' && current !== 'approved')) return;
        d.state = next;
        if (next === 'approved') {
          var g = { action: d.action, bot: d.bot || featureOwnerId('permissions'), date: new Date().toLocaleString('zh-CN'),
            quote: '本页点击批准提议（演示）', source: featureOwnerName('permissions') + ' · 本页放权卡', scope: d.scope, level: d.level, active: true };
          state.grants.push(g); delegationGrants.set(d, g);
        }
        if (next === 'revoked') {
          var grant = delegationGrants.get(d);
          if (grant) { grant.active = false; grant.revokedAt = new Date().toLocaleString('zh-CN'); }
        }
        audit('放权提议 · ' + d.action, delegationLabels[next], d.scope + ' · 只登记本页状态，不修改执行器权限');
        refresh(root);
      }
      mount(root, function (target) {
        var status = d.state || 'proposed', level = levels.includes(d.level) ? d.level : 'L3';
        var bot = H.state.bots.find(function (b) { return b.id === d.bot; });
        var labels = delegationLabels;
        var statusBadge = badge(labels[status] || '未知状态');
        statusBadge.setAttribute('role', 'status');
        statusBadge.setAttribute('data-delegation-state', status);
        target.append(el('div', 'section-head', [el('h3', 'h3', '放权提议'), statusBadge]),
          note('本页演示，未真实执行'),
          status === 'proposed' || status === 'approved' ? levelMark(level, d.action, d.scope, d.bot) : note(level + ' · ' + (labels[status] || '未知状态') + '，无有效放权'),
          note('动作：' + (d.action || '未指定') + ' · 助理：' + (bot ? bot.name : '未指定')),
          note('范围：' + (d.scope || '未指定，不能批准')),
          note(levelDescriptions[level]),
          note('批准只登记本页所列范围，不改变动作级别。'),
          actions([
            btn('批准', function () { decideDelegation('approved'); }, 'primary', {
              disabled: status !== 'proposed' || d.level === 'L4' || !d.scope || !levels.includes(d.level), 'data-delegation-action': 'approve' }),
            btn('拒绝', function () { decideDelegation('rejected'); }, '', { disabled: status !== 'proposed', 'data-delegation-action': 'reject' }),
            btn('收回', function () { decideDelegation('revoked'); }, '', { disabled: status !== 'approved', 'data-delegation-action': 'revoke' })
          ])
        );
      });
      return root;
    }
  });

  // Explicit fixture receipts: unknown/partial totals never join the known-cost ranking.
  var costSessions = demoFixture("governance.costSessions.58");
  function sessionCost(item) {
    return item.turns.every(function (turn) { return knownCost(turn.cost); }) ? item.turns.reduce(function (n, turn) { return n + turn.cost; }, 0) : null;
  }
  function rankKnown(items) {
    return items.filter(function (item) { return knownCost(item.cost); }).sort(function (a, b) { return b.cost - a.cost; });
  }
  H.registerCapability({ id: 'governance-costliest', title: '哪个会话最贵', icon: 'usage', steward: featureOwnerId('ledger'), featureId: 'ledger', group: '账本',
    oneLine: '按会话或轮次比较估算费用，未知项单列。',
    status: function () { return statuses([['演示会话', costSessions.length + ' 个'], ['总费用未知', costSessions.filter(function (s) { return sessionCost(s) === null; }).length + ' 个'], ['口径', '估算美元']]); },
    phrases: ['哪个会话最贵', '按轮次费用排一下', '哪些会话费用还不知道'],
    reply: function (phrase) {
      var sessions = costSessions.map(function (item) { return { conversation: item.conversation, title: item.title, turns: item.turns.length, cost: sessionCost(item) }; });
      var unknown = sessions.filter(function (item) { return !knownCost(item.cost); });
      var lines = ['本页演示，未真实执行。全部来自虚构回执，费用统一为演示美元（USD）；与账本「会话级明细」共用回执，合计由各轮相加，未连接提供方账单。'];
      if (phrase === '按轮次费用排一下') {
        var turns = [];
        costSessions.forEach(function (item) { item.turns.forEach(function (turn) { turns.push({ title: item.title, conversation: item.conversation, turn: turn.turn, cost: turn.cost }); }); });
        lines.push('已知轮次费用从高到低：');
        rankKnown(turns).forEach(function (item, i) { lines.push((i + 1) + '. 会话：' + item.title + '｜轮次：第 ' + item.turn + ' 轮｜费用：' + demoFee(item.cost)); });
        turns.filter(function (item) { return !knownCost(item.cost); }).forEach(function (item) { lines.push('未排名 · 会话：' + item.title + '｜轮次：第 ' + item.turn + ' 轮｜费用：—'); });
      } else {
        if (phrase !== '哪些会话费用还不知道') {
          lines.push('已知会话总费用从高到低：');
          rankKnown(sessions).forEach(function (item, i) { lines.push((i + 1) + '. 会话：' + item.title + '｜轮次：' + item.turns + ' 轮｜费用：' + demoFee(item.cost)); });
        }
        lines.push('费用未知，单列不参与排名：');
        unknown.forEach(function (item) { lines.push('未排名 · 会话：' + item.title + '｜轮次：' + item.turns + ' 轮｜费用：—（有轮次缺回执，合计未知）'); });
      }
      return [{ type: 'text', md: tidyCopy(lines.join('\n')) }];
    }
  });
  H.registerConversation('chief', { id: 'governance-context-demo', title: '上下文构成 · 估算演示', messages: [
    { from: 'user', time: '演示', parts: [{ type: 'text', md: '这次上下文都装了什么？' }] },
    { from: 'chief', time: '演示', parts: [{ type: 'text', md: '本页演示，未真实执行。选择分段后压缩或卸下，再看估算前后变化。系统段受保护；记忆可逐片卸下。' },
      { type: 'governance-context-mix', data: { conversation: 'governance-context-demo', bot: 'chief' } }] }
  ] });
  H.registerConversation(featureOwnerId('permissions'), { featureId:'permissions', id: 'governance-delegation-demo', title: '放权提议 · 批准与收回', messages: [
    { from: featureOwnerId('permissions'), time: '演示', parts: demoFixture("governance.parts.59") }
  ] });

  // 贡献给 A 路的三分区壳；原有卡片、申请与来源仍由本模块持有。
  function costliestSummary() {
    var known = rankKnown(costSessions.map(function (item) {
      return { title: item.title, cost: sessionCost(item), turns: item.turns.length };
    }));
    return card('最贵会话', '会话级明细共用回执 · 演示美元 USD', [
      known.map(function (item, i) { return row((i + 1) + ' · ' + item.title, item.turns + ' 轮 · ' + demoFee(item.cost)); }),
      costSessions.filter(function (item) { return sessionCost(item) === null; }).map(function (item) {
        return row(item.title, '费用未知 · 有轮次缺回执，不参与排名');
      }),
      note('只按完整的虚构费用回执排序；token 数量不能代替费用。')
    ]);
  }
  function backupStatus() {
    return card('备份状态', '原备份与隔离恢复演练样本 · 保留原始日期', [
      note('真实备份是否存在未知；以下均为历史演示记录。'),
      backups.map(function (item) { return row(item.date, item.version + ' · ' + item.size + ' · ' + item.result); })
    ]);
  }
  H.registerFeatureSection('ledger', { id: 'governance-ledger-now', kind: 'now', render: function (root) {
    mount(root, function (target) { target.append(...usage(target), costliestSummary()); });
  } });
  H.registerFeatureSection('ledger', { id: 'governance-ledger-log', kind: 'log', render: function (root) {
    root.append(note('额度提醒由负责助理发到活动；选择与撤销写入下方记录，不占一条会话。金额为演示美元，现金及赠送余额与订阅占用分开。'));
  } });
  H.registerFeatureSection('permissions', { id: 'governance-permissions-now', kind: 'now', render: function (root) {
    mount(root, function (target) { target.append(permissionsPage(target)[0], backupStatus()); });
  } });
  H.registerFeatureSection('permissions', { id: 'governance-permissions-log', kind: 'log', render: function (root) {
    mount(root, function (target) {
      target.append(card('审批记录', '原审批收件箱 · 仅本页演示状态', state.approvals.map(function (item) {
        return row(item.action, [item.created + ' · ' + item.status + ' · ' + item.scope,
          item.permissionId ? note('结构化改级：' + (item.oldLevel || '默认 L3') + ' → ' + item.newLevel) : null],
          [btn('查看审批详情', function () { H.openPanel('governance-detail', { id: item.id }); })]);
      })), card('原审批历史', '保留原始日期与演示确认状态', state.logs.filter(function (item) { return !item.feature; }).map(function (item) {
        return row(item.what, item.time + ' · ' + item.who + ' · ' + item.result + ' · ' + item.detail);
      })), permissionsPage(target)[1],
      card('隔离恢复记录', '原演练样本 · 不代表真实恢复', drills.map(function (text) { return note(text); })),
      card('待输入与放权会话', '原安全相关记录 · 现由功能负责助理接话', [
        note('待输入只显示阻塞与去处；私密内容仅在遮蔽卡中接收。'),
        H.pendingInputs().filter(function (item) { return item.featureId === 'permissions'; }).map(function (item) {
          return row(item.what, item.blocking + ' · 去处：' + item.cardData.destination,
            [btn('打开私密输入卡', function () { H.openPendingInput(item.id); })]);
        }),
        btn('查看原待输入问答', function () { H.navigate({ view: 'chat', conversation: 'governance-input-demo' }); }),
        btn('查看原放权与审批卡', function () { H.navigate({ view: 'chat', conversation: 'governance-delegation-demo' }); })
      ]));
    });
  } });
  H.on('pending-input', function (event) {
    if (event.resolved && inputFixtures.some(function (fixture) { return event.id.indexOf(fixture.id) === 0; })) {
      H.featureRecord('permissions', { time: new Date().toLocaleString('zh-CN'), title: '私密输入流程已处理（演示）',
        text: '对应阻塞项已从清单移出；记录仅含流程结果，不含输入值。' });
      refresh();
    }
  });

  H.addStyle((demoText("governance.sample.60")));
  H.registerView('ledger', { title: '账本', icon: 'usage', render: ledgerRender });
  H.registerView('control', { hidden: true, title: '权限与用量', icon: 'shield', render: render });
  H.registerPanel('governance-detail', { title: '治理详情', icon: 'shield', group: '权限与用量', render: panel });
  H.registerPanel('permission', { title: '权限', icon: 'shield', group: '权限与用量', render: function (root) { H.renderFeatureSections(root, 'permissions'); } });
  H.registerPanel('usage', { title: '额度与用量', icon: 'usage', group: '权限与用量', render: function (root) { mount(root, function (target) { target.append(...usage(target)); }); } });
  H.registerSettingsPage('governance-settings', { title: '预算与预警', icon: 'usage', group: '隐私与权限', order: 40, render: settings });
  function paintChip(chip) {var label='待批 '+pending().length;chip.textContent='';chip.append(H.icon('shield'),h('span',{},String(pending().length)));chip.setAttribute('aria-label',label);chip.setAttribute('title',label);}
  H.registerStatusChip({ id: 'governance-status', order: 40, render: function (c) {
    var chip = btn('待批 ' + pending().length, function () { askSafety(); });
    paintChip(chip); chips.add(chip); c.append(chip);
  } });
  H.registerCard('governance-approval', { title: '审批演示', render: function (data) {
    var a = findApproval(data.id);
    return el('div', 'card', [el('h3', 'h3', a ? a.action : data.action || '待审批操作'),
      note('本页演示，未真实执行'), note(a ? a.params.split(/\r?\n/).join(' · ') : '对应审批未载入；打开收件箱核对'),
      badge(a ? a.status : '未匹配'),
      btn('查看审批', function () { H.openPanel('governance-detail', { id: data.id || '未指定' }); }, 'primary')], botAttrs(a && a.bot));
  }, quoteLabel: function (data) { return '审批演示：' + (data.action || (findApproval(data.id) && findApproval(data.id).action) || '待审批操作'); } });
})();
