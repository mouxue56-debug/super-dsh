/*
 * interact · 离线消息互动，所有数据仅存当前页内存，刷新复原。
 * 注册：12 个消息操作（回应/引用/子线程/复制/朗读/重试/分叉/任务/记忆/置顶/多选/更多）；
 * 6 个输入工具（附件/@/命令/通话/搜索/互动，听写入口已摘掉）；7 个 slash 命令；
 * 5 种卡片（流式回复/引用/附件/失败续接/出图任务）；5 个面板（互动/附件/搜索/记忆/通话）；
 * 2 个演示会话、1 个看板徽章。入口：现有聊天输入栏、消息操作菜单、+ 菜单。
 * 占位：bot 回复、ASR/TTS、电话字幕、相机/截屏、知识选择均为明确标识的本地演示；
 * 文件仅显示模拟附件，不读取设备；记忆只登记待投递，不写知识库；不调用模型或网络。
 * DOM 适配仅依赖当前壳的 data-message-id、data-focus=composer、data-act 与 .thread；
 * 缺少 editMessage / composer hook / task creation API，流式卡直接更新本模块 DOM，
 * 任务通过 ctx.state.cards 新增本地卡，滚动与输入捕获集中在下方适配段。
 */
(function () {
  'use strict';
  var H = window.Hub, h = H.h;
  // Public bot objects are writable at registration time. The shell alone renders
  // .hub-quick; keep steward wording aligned with its existing capability phrases.
  var conversations = new Map(), jobs = new Map(), memories = [], selected = new Set();
  var serial = 0, current = '', multi = false, reading = '', readTimer, voiceHold;
  var search = { conversation: '', query: '', index: 0 }, call = null, callTimer;
  var audioEpoch = 0, backgroundTimers = new Map(), imageTimers = new WeakMap();
  var selectionText = '', ignoreClickUntil = 0;
  var emoji = ['👍', '❤️', '🎉', '👀', '✅'];
  var actions = [
    ['react', 'chat', '表情回应'], ['quote', 'quote', '引用回复'], ['thread', 'chat', '分支回复'],
    ['copy', 'copy', '复制'], ['read', 'play', '朗读演示'], ['retry', 'retry', '重试回复'],
    ['fork', 'branch', '分叉会话'], ['task', 'task', '转成任务'], ['memory', 'memory', '存入记忆'],
    ['pin', 'pin', '置顶消息'], ['select', 'check', '多选消息'], ['more', 'more', '更多互动']
  ];
  var commands = demoFixture("interact.commands.1");
  function uid(kind) { return 'interact-' + kind + '-' + Date.now().toString(36) + '-' + (++serial); }
  function ctx() { return H.context(); }
  function local(id) {
    id = id || ctx().conversation;
    if (!conversations.has(id)) { var saved;try{saved=JSON.parse(localStorage.getItem('hub-r22-draft:'+id));}catch(e){}conversations.set(id, { draft: typeof saved?.draft==='string'?saved.draft:'', quote: saved?.quote&&typeof saved.quote.text==='string'?saved.quote:null, attachments: [], mentions: [], queue: [], meta: new Map(), saved: !!saved?.draft }); }
    return conversations.get(id);
  }
  function saveDrafts(){conversations.forEach((l,id)=>{try{localStorage.setItem('hub-r22-draft:'+id,JSON.stringify({draft:l.draft,quote:l.quote}));}catch(e){}});}
  window.addEventListener('pagehide',saveDrafts);H.on('navigate',saveDrafts);
  function meta(m, id) {
    var data = local(id).meta;
    if (!data.has(m.id)) data.set(m.id, { reactions: {}, replies: [], pin: false, expanded: false });
    return data.get(m.id);
  }
  function text(m) { return H.messageText ? H.messageText(m) : (m.parts || []).map(p => p.md || p.data?.title || '卡片').join('\n'); }
  function name(id) { return id === 'user' ? demoText("interact.sample.2") : (ctx().state.bots.find(b => b.id === id)?.name || '助理'); }
  function button(label, fn, icon, extra) {
    var attrs = Object.assign({ type: 'button', onClick: fn }, extra || {});
    var classes = attrs.class || 'btn-secondary';
    attrs.class = 'm-interact-btn ' + classes + (classes.split(/\s+/).includes('btn-secondary') ? ' m-interact-btn-secondary' : '');
    return h('button', attrs, [icon ? H.icon(icon) : null, label]);
  }
  function note(t) { return h('p', { class: 'm-interact-note' }, t); }
  function source(t) { return h('small', { class: 'm-interact-source badge' }, '来自：' + t); }
  function sticker(t) { return h('span', { class: 'sticker bot m-interact-label' }, t); }
  function panelHead(title, label) { return h('header', { class: 'pop-card-head m-interact-heading' }, [h('strong', {}, title), sticker(label)]); }
  function row(children) { return h('div', { class: 'm-interact-row' }, children); }
  function refresh() { enhance(); H.measureDock?.(); }
  function redraw() { var c = ctx(); H.navigate({ view: c.state.view, conversation: c.conversation }, { reading: 'preserve' }); }
  function preserveReading(fn, reason) { return H.reading ? H.reading.preserve(fn, { reason: reason }) : fn(); }
  function composerInput() { return document.querySelector('[data-focus="composer"]'); }
  function setInput(value) {
    var c = ctx(), l = local(); c.state.input = value; l.draft = value; l.saved = !!value; saveDrafts();
    var input = composerInput();
    if (input) { input.value = value; input.focus({ preventScroll: true }); input.dispatchEvent(new Event('input', { bubbles: true })); input.setSelectionRange(input.value.length, input.value.length); }
    refresh();
  }
  function goMessage(id, conversation, reason) {
    if ((conversation && conversation !== ctx().conversation) || ctx().state.drawer) H.navigate({ view: 'chat', conversation: conversation || ctx().conversation });
    var article = Array.from(document.querySelectorAll('[data-message-id]')).find(el => el.dataset.messageId === id);
    if (!article) return H.toast('原消息暂不可见，请回到来源会话');
    var m = H.currentMessages().find(item => item.id === id);
    preserveReading(() => { if (m) { meta(m).expanded = true; enhanceMessages(); } }, 'message-expand');
    H.reading && H.reading.locate(article, { block: 'center', reason: reason || 'quote' });
    article.classList.add('m-interact-highlight');
    setTimeout(() => article.classList.remove('m-interact-highlight'), 1500);
  }
  function quoteMessage(m) {
    local().quote = { id: m.id, conversation: ctx().conversation, author: name(m.from), text: text(m).slice(0, 240) };
    saveDrafts(); refresh(); composerInput()?.focus({ preventScroll: true });
  }
  function quoteBlock(q) {
    return button('', () => goMessage(q.id, q.conversation), null, { class: 'm-interact-quote btn-secondary', title: '回到原消息', 'aria-label': '引用 ' + q.author + '，回到原消息' });
  }
  H.registerCard('interact-quote', { title: '引用消息', quoteLabel: d => '引用 ' + d.author + '：' + d.text,
    render: function (d) { var el = quoteBlock(d); el.append(h('strong', {}, '↩ ' + d.author), h('span', {}, d.text)); return el; } });
  H.registerCard('interact-stream', { title: '示例回复', quoteLabel: d => d.text || d.status,
    render: function (d) {
      var el = h('div', { class: 'm-interact-stream pop-card', dataset: { stream: d.id } }, [
        h('p', { class: 'm-interact-streamtext' }, d.text), h('small', { class: 'sticker bot m-interact-label' }, d.status)]);
      var job = jobs.get(d.conversation);
      el.classList.toggle('m-interact-live', !!job && job.data.id === d.id);
      if (job && job.data.id === d.id) el.append(h('div', { class: 'm-interact-stream-controls' }, [H.levelSticker('L1', { action: '本页流式回复演示', scope: '仅当前会话内存', bot: job.payload.bot }), button('停止这条回复', () => finishJob(d.conversation, true), 'stop', { dataset: { interactStop: d.id } })]));
      return el;
    } });
  function failureCard(d) {
    var el = h('section', { class: 'm-interact-result pop-card', dataset: { interactFailure: d.id } });
    el.append(panelHead('这一轮停住了', d.state || '失败'), H.levelSticker('L1', { action: '续接本页模拟回复', scope: '仅本页内存，不调用模型', bot: d.bot }), note('原因：' + d.reason), note('模型：' + d.model), note('演示，未真实执行'));
    if (!d.state || d.state === '失败') el.append(row([
      button('继续', () => continueFailure(d, d.model), 'play', { class: 'btn-primary' }),
      button('换个模型继续', () => {
        var choices = h('div', { class: 'm-interact-panel' }, [note('从失败处续接，保留原消息。仅选择本轮演示模型。')]);
        demoFixture("interact.sample.3").forEach(model => choices.append(button(model, () => continueFailure(d, model), 'retry')));
        H.sheet({ title: '换个模型继续', body: choices });
      }, 'retry'),
      button('放弃', () => {
        if (d.state && d.state !== '失败') return;
        d.state = '已放弃'; redraw();
        H.postMessage(d.conversation, { from: d.bot, time: '刚刚', parts: [{ type: 'text', md: '这一轮已放弃，原消息保留。演示，未真实执行。' }] });
      }, 'close') ]));
    else el.append(note(d.state === '继续中' ? '正在续接；可在新回复上单独停止。' : '原失败回合保留供回看。'));
    return el;
  }
  H.registerCard('interact-failure', { title: '失败回合', quoteLabel: d => '失败原因：' + d.reason + ' · ' + (d.state || '失败') + ' · 演示，未真实执行', render: failureCard });
  function continueFailure(d, model) {
    if (d.state && d.state !== '失败') return H.toast('这轮已经处理，原记录保留');
    if (jobs.has(d.conversation)) return H.toast('请先停止该会话正在运行的回复');
    d.state = '继续中'; d.model = model;
    H.navigate({ view: 'chat', conversation: d.conversation });
    runPayload({ conversation: d.conversation, bot: d.bot, text: '从失败处继续：' + d.prompt, model: model, recovery: d, quote: null, attachments: [], mentions: [] });
  }
  H.registerConversation('chief', demoFixture("interact.sample.4"));
  H.registerCard('interact-attachments', { title: '本地附件', quoteLabel: d => d.files.map(f => f.name).join('、'),
    render: d => h('div', { class: 'm-interact-files' }, d.files.map(f => button(f.name + ' · 模拟附件', () => previewAttachment(f), f.kind === 'image' ? 'image' : 'file'))) });

  // One message, one mutable local job. No image URLs, files, model calls or charges.
  var imageTools = demoFixture("interact.imageTools.5");
  var imageStates = { prompt: '提示词与工具', running: '占位生成中', results: '四稿待选', review: '待演示审核', archived: '本页已入库' };
  function imageJobData(mode, prompt) {
    return { id: uid('image-job'), mode: mode, prompt: prompt, tools: imageTools.slice(), tool: demoText("interact.tool.6"), state: 'prompt', progress: 0, results: [], selectedId: null, delivery: null, version: 0 };
  }
  function paintImageJob(d, focusAction) {
    document.querySelectorAll('[data-interact-image-job]').forEach(el => {
      if (el.dataset.interactImageJob !== d.id) return;
      var hadFocus = el.contains(document.activeElement);
      var targetAction = focusAction || document.activeElement?.dataset?.imageAction;
      el.replaceChildren(...imageJobBody(d));
      if (hadFocus && targetAction) el.querySelector('[data-image-action="' + targetAction + '"]')?.focus({ preventScroll: true });
    });
  }
  function generateImages(d) {
    if (d.state === 'running' || !d.prompt.trim()) return;
    clearTimeout(imageTimers.get(d));
    d.version++; d.state = 'running'; d.progress = 0; d.results = []; d.selectedId = null; d.delivery = null;
    var version = d.version;
    function tick() {
      if (d.state !== 'running' || d.version !== version) return;
      d.progress = Math.min(100, d.progress + 25);
      if (d.progress === 100) {
        d.state = 'results';
        d.results = [1, 2, 3, 4].map(n => ({ id: 'v' + version + '-' + n, label: (d.mode === 'video' ? '短片方案 ' : '画面方案 ') + n }));
        imageTimers.delete(d);
      } else imageTimers.set(d, setTimeout(tick, 500));
      paintImageJob(d, d.state === 'results' ? 'select-1' : null);
    }
    imageTimers.set(d, setTimeout(tick, 500));
    paintImageJob(d, 'cancel');
  }
  function imageJobBody(d) {
    var video = d.mode === 'video';
    var body = [panelHead(video ? '对话内出视频' : '对话内出图', imageStates[d.state]),
      H.levelSticker(d.state === 'review' ? 'L3' : 'L1', { action: d.state === 'review' ? '演示审核后入库' : '本页生成与交付占位', scope: '本页内存；无文件写入或付费调用', bot: 'art' }),
      note('本页演示，未真实执行。只模拟流程，不生成图片或视频，不连接任何工具。')];
    if (d.state === 'prompt') {
      var input = h('textarea', { class: 'm-interact-image-prompt pop-input', rows: 3, value: d.prompt, 'aria-label': video ? '视频提示词' : '图片提示词' });
      var generate = button('开始占位生成', () => generateImages(d), 'play', { class: 'btn-primary', disabled: !d.prompt.trim(), dataset: { imageAction: 'generate' } });
      input.addEventListener('input', () => { d.prompt = input.value; generate.disabled = !d.prompt.trim(); });
      body.push(h('label', { class: 'm-interact-image-label' }, ['01 · 提示词', input]), note(demoText("interact.sample.7")),
        h('div', { class: 'm-interact-image-tools segmented', role: 'group', 'aria-label': '选择演示工具' }, imageTools.map(tool => button(tool, () => {
          d.tool = tool; paintImageJob(d, 'tool-' + imageTools.indexOf(tool));
          H.toast('已选择 ' + tool + ' · 仅演示工具选项，未连接服务');
        }, null, { class: tool === d.tool ? 'on ghostbtn' : 'ghostbtn', 'aria-pressed': String(tool === d.tool), dataset: { imageAction: 'tool-' + imageTools.indexOf(tool), imageTool: tool } }))), generate);
    } else {
      body.push(note('提示词：' + d.prompt), note('工具：' + d.tool + ' · 版本 v' + d.version));
      if (d.state === 'running') body.push(h('div', { class: 'm-interact-image-progress', role: 'status', 'aria-live': 'polite' }, [
        note('03 · 占位生成中 ' + d.progress + '%'), h('progress', { max: 100, value: d.progress, 'aria-label': '本页模拟生成进度' })]),
        button('停止占位生成', () => { clearTimeout(imageTimers.get(d)); imageTimers.delete(d); d.state = 'prompt'; d.progress = 0; paintImageJob(d, 'generate'); }, 'stop', { dataset: { imageAction: 'cancel' } }));
      if (d.state === 'results') {
        body.push(note('04 · 选择一张' + (video ? '短片方案占位；每格代表一版，不可播放。' : '画面占位；没有真实图片。')));
        // Build placeholders as labelled buttons so touch, keyboard and screen readers agree.
        var grid = h('div', { class: 'm-interact-image-grid', role: 'group', 'aria-label': '四格结果占位' });
        d.results.forEach((result, i) => {
          var tile = button('', () => { d.selectedId = result.id; paintImageJob(d, 'select-' + (i + 1)); H.toast('已选 ' + result.label + ' · 方案占位，可送去审'); }, null,
            { class: 'ghostbtn m-interact-image-tile', 'aria-label': '选一张：' + result.label, 'aria-pressed': String(d.selectedId === result.id), dataset: { imageAction: 'select-' + (i + 1) } });
          tile.append(h('span', { class: 'm-interact-image-mark', 'aria-hidden': 'true' }, ['◒', '◇', '◐', '○'][i]), h('strong', {}, result.label), h('span', { class: 'm-interact-image-caption' }, '画面占位'));
          if (d.selectedId === result.id) tile.append(h('span', { class: 'm-interact-image-selected' }, '已选'));
          grid.append(tile);
        });
        body.push(grid, row([button('再来一版', () => generateImages(d), 'retry', { dataset: { imageAction: 'regenerate' } }),
          button('送去审', () => { if (!d.selectedId) return; d.state = 'review'; paintImageJob(d, 'archive'); }, 'shield', { class: 'btn-primary', disabled: !d.selectedId, dataset: { imageAction: 'review' } }),
          button('改提示词或工具', () => { d.state = 'prompt'; paintImageJob(d, 'generate'); }, 'file', { dataset: { imageAction: 'edit' } })]));
      }
      if (d.state === 'review') body.push(note('05 · 已选 ' + d.results.find(r => r.id === d.selectedId)?.label + ' · 待审核。未发给外部审核人。'), row([
        button('演示审核通过并入库', () => {
          if (d.state !== 'review' || !d.selectedId) return;
          d.delivery = { filename: (video ? '短片方案' : '画面方案') + '_v' + d.version + '_' + d.selectedId.split('-').pop() + (video ? '.mp4' : '.png'), tool: d.tool, version: 'v' + d.version, review: '本页演示审核通过；未经真实验收' };
          d.state = 'archived'; paintImageJob(d, 'restart');
        }, 'check', { class: 'btn-primary', dataset: { imageAction: 'archive' } }),
        button('退回重选', () => { d.state = 'results'; paintImageJob(d, 'review'); }, 'back', { dataset: { imageAction: 'back' } })]));
      if (d.state === 'archived') body.push(h('div', { class: 'm-interact-image-delivery', role: 'status' }, [sticker('06 · 入库交付物 · 本页记录'),
        note('文件名：' + d.delivery.filename), note('工具：' + d.delivery.tool + ' · 版本：' + d.delivery.version), note('审核状态：' + d.delivery.review), note('文件名仅为占位；未写文件、未上传资产库。')]),
        button('再做一份', () => { d.state = 'prompt'; paintImageJob(d, 'generate'); }, 'plus', { dataset: { imageAction: 'restart' } }));
    }
    return body;
  }
  H.registerCard('interact-image-job', { title: '对话内出图 / 视频', quoteLabel: d => (d.mode === 'video' ? '视频' : '图片') + '任务：' + d.prompt + ' · ' + d.tool + ' · ' + (imageStates[d.state] || '提示词与工具') + ' · 本页演示，未真实执行', render: d => {
    if (!d.id) d.id = uid('image-job');
    if (!d.state) d.state = 'prompt';
    if (!imageTools.includes(d.tool)) d.tool = demoText("interact.render.8");
    d.tools = imageTools.slice(); d.prompt = d.prompt || ''; d.version = d.version || 0; d.results = d.results || [];
    return h('section', { class: 'm-interact-image-job pop-card', dataset: { interactImageJob: d.id } }, imageJobBody(d));
  } });
  H.registerConversation('art', { id: 'interact-r8-image-demo', title: '对话内出图', messages: [
    { from: 'user', parts: [{ type: 'text', md: '做一组抽象纸艺封面，先在对话里演示选工具、四稿选择和入库。' }] },
    { from: 'art', parts: [{ type: 'text', md: '本页演示，未真实执行。下面两张卡分别演示图片和视频；每一步都在原卡里完成。' },
      { type: 'interact-image-job', data: imageJobData('image', '抽象纸艺封面，圆形与折纸层次，预留标题区。') }] },
    { from: 'art', parts: [{ type: 'text', md: '视频简例：同一卡切成视频模式，结果仍是四个方案占位，不含真实片段。本页演示，未真实执行。' },
      { type: 'interact-image-job', data: imageJobData('video', '五秒纸艺片头，折纸缓慢展开，最后停在圆形构图。') }] }
  ] });
  function backgroundReport(conversation) {
    H.postMessage(conversation, { from: 'content', time: '刚刚', parts: [
      demoFixture("interact.parts.9"),
      { type: 'cards-b-background-report', data: { sourceBot: 'content', task: demoText("interact.task.10"), elapsed: '4\u00a0秒（模拟）', summary: '归纳了三条演示选题；尚未发布。', detail: ['来源：本页占位素材，未检索外部信息。', '结果：三条选题草稿，待你查看。', '本页演示，未真实执行；未调用模型、未外发。'], conversation: conversation } }
    ] }, { quiet: true });
  }
  function flushBackgroundReport(conversation) {
    var pending = backgroundTimers.get(conversation);
    if (!pending?.ready || jobs.has(conversation)) return;
    backgroundTimers.delete(conversation);
    backgroundReport(conversation);
  }
  function scheduleBackgroundReport(conversation) {
    if (backgroundTimers.has(conversation)) return;
    var pending = { ready: false };
    backgroundTimers.set(conversation, pending);
    setTimeout(() => {
      pending.ready = true;
      flushBackgroundReport(conversation);
    }, 3600);
  }
  H.addStyle((demoText("interact.sample.11")));

  function previewAttachment(f) {
    H.sheet({ title: f.name, body: h('div', { class: 'm-interact-panel' }, [
      source(f.source || demoText("interact.body.12")), note('模拟附件 · 未读取本机文件、相机或剪贴板，也未上传。'),
      h('div', { class: 'm-interact-result pop-card' }, f.summary || demoText("interact.body.13")),
      note(demoText("interact.body.14"))
    ]) });
  }
  function attach(kind, label) {
    var c = ctx(), l = local(), file = { id: uid('file'), kind: kind, name: label,
      source: kind === 'kb' ? '知识检索与来源记录' : demoText("interact.source.15"),
      summary: kind === 'kb' ? demoText("interact.summary.16") : demoText("interact.summary.17") };
    l.attachments.push(file); c.state.drawer = null; redraw(); H.toast('已添加模拟附件，可预览或移除');
  }
  function attachmentPanel(container) {
    container.classList.add('m-interact-panel'); container.append(panelHead('附件与素材', '本地演示'), note('离线素材选择 · 不请求设备权限'), source(demoText("interact.sample.18")));
    demoFixture("interact.sample.19").forEach(a => container.append(button(a[1], () => attach(a[0], a[2]), a[0] === 'image' ? 'image' : 'file')));
    container.append(button('从知识库选', () => H.sheet({ title: '选择知识条目 · 示例', body: h('div', { class: 'm-interact-panel' }, [source('知识检索与来源记录'), note('仅使用本地虚构摘要；未查询真实知识库。'), button(demoText("interact.body.20"), () => attach('kb', demoText("interact.body.21")), 'memory'), button(demoText("interact.body.22"), () => attach('kb', demoText("interact.body.23")), 'file')]) }), 'memory'),
      button('从看板选', () => H.sheet({ title: '引用本地看板', body: h('div', { class: 'm-interact-panel' }, ctx().state.cards.map(card => button(card.title, () => { local().attachments.push({ id: uid('board'), kind: 'board', name: card.title, summary: card.sub, source: '可领取销售任务池 / 本地看板' }); redraw(); }, 'board'))) }), 'board'), button('更多输入工具', () => H.openPanel('attachments'), 'tools'));
  }
  H.registerPanel('interact-attachments', { title: '添加附件', icon: 'plus', group: '消息互动', render: attachmentPanel });

  function taskFrom(m, raw) {
    var c = ctx(), title = (raw || text(m)).replace(/\s+/g, ' ').slice(0, 60), id = uid('task');
    c.state.cards.push({ id: id, col: 'new', title: title || '消息跟进', sub: '来自会话 · 待领取 / 待验收 · 演示', detail: raw || text(m), bot: c.bot.id, project: c.project.id, flag: 'L1 本地', time: '刚刚', interactSource: { message: m?.id, conversation: c.conversation } });
    // 看板定位：非聊天，豁免。
    H.sheet({ title: '已生成本地看板卡', body: h('div', { class: 'm-interact-panel' }, [source('可领取销售任务池'), h('strong', {}, title), note('新建 → 唯一领取人 → 结果 → 下一动作。仅本页卡片，未注册真实任务。'), button('在看板查看', () => { H.navigate({ view: 'kanban' }); setTimeout(() => { var el = Array.from(document.querySelectorAll('[data-id]')).find(n => n.dataset.id === id); el?.scrollIntoView(demoFixture("interact.body.24")); el?.classList.add('m-interact-highlight'); }, 0); }, 'board', { class: 'btn-primary' })]) });
  }
  H.registerBoardCardBadge(card => card.interactSource ? h('span', { class: 'm-interact-source badge' }, '来自：消息互动 · 可领取销售任务池') : null);
  function remember(m, raw) {
    var c = ctx();
    memories.push({ id: uid('memory'), text: raw || text(m), conversation: c.conversation, sourceLabel: c.bot.name + ' · ' + (c.state.sessionNames[c.bot.id] || '当前会话'), message: m?.id, sourceDate: '2026-11-13', status: demoText("interact.status.25"), receipt: '待投递 · 仅本页' });
    H.toast('已登记记忆草稿 · 未写入知识库');
  }
  H.registerPanel('interact-memory', { title: '本页记忆草稿', icon: 'memory', group: '消息互动', render: function (container) {
    container.classList.add('m-interact-panel'); container.append(panelHead('记忆草稿', '待投递'), source('知识整理流程'), note('来源、确认状态、事实核验与送达分开记录。这里仅保留本页草稿；刷新复原。'));
    if (!memories.length) container.append(note('还没有记忆草稿。可在消息「更多」中选择「存入记忆」。'));
    memories.forEach(item => container.append(h('section', { class: 'm-interact-result pop-card' }, [sticker('本页草稿'), h('p', {}, item.text), note(item.status + ' · 核验待核 · ' + item.receipt), note('来源日期：' + item.sourceDate + ' · 来源会话：' + item.sourceLabel), item.message ? button('回到来源', () => goMessage(item.message, item.conversation), 'quote') : null])));
  } });
  function fork(m) {
    var c = ctx(), messages = H.currentMessages(), end = m ? messages.findIndex(n => n.id === m.id) + 1 : 0, id = uid('chat');
    // Clone nested parts: a later streaming update must never mutate the original branch.
    H.registerConversation(c.bot.id, { id: id, title: m ? '分叉 · ' + text(m).slice(0, 22) : '新的协作 · 本地', messages: JSON.parse(JSON.stringify(messages.slice(0, end))) });
    H.navigate({ view: 'chat', conversation: id }); H.toast(m ? '已分叉，原会话保留' : '已创建本地新会话');
  }
  function copy(t) { return H.copyText(t); }
  function read(m) {
    clearTimeout(readTimer); reading = reading === m.id ? '' : m.id;
    if (reading) readTimer = setTimeout(() => { reading = ''; refresh(); }, 4500);
    refresh(); H.toast(reading ? '朗读播放态演示 · 未合成音频' : '已停止朗读');
  }
  function react(m, e) {
    var reactions = meta(m).reactions, users = reactions[e] || [];
    var removing = users.includes(demoText("interact.removing.26"));
    reactions[e] = removing ? users.filter(n => n !== demoText("interact.sample.27")) : users.concat(demoText("interact.sample.28")); refresh();
    H.toast((removing ? '已取消 ' : '已添加 ') + e + ' 回应 · 仅本页消息');
  }
  function reactionPicker(m) { H.sheet({ title: '表情回应', body: h('div', { class: 'm-interact-panel' }, [row(emoji.map(e => button(e, () => react(m, e)))), note(demoText("interact.body.29"))]) }); }
  function action(id, m) {
    switch (id) {
      case 'react': return reactionPicker(m);
      case 'quote': return quoteMessage(m);
      case 'thread': return H.openPanel('interact-center', { message: m.id, tab: 'thread' });
      case 'copy': return copy(text(m));
      case 'read': return read(m);
      case 'retry': return retry(m);
      case 'fork': return fork(m);
      case 'task': return taskFrom(m);
      case 'memory': return remember(m);
      case 'pin': meta(m).pin = !meta(m).pin; refresh(); return H.toast(meta(m).pin ? '已置顶 · 本页' : '已取消置顶');
      case 'select': multi = true; selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id); return refresh();
      case 'more': return H.openPanel('interact-center', { message: m.id });
    }
  }
  actions.forEach(a => H.registerMessageAction({ id: 'interact-' + a[0], icon: a[1], label: a[2], run: m => action(a[0], m) }));
  function threadBody(m) {
    var data = meta(m), list = h('div', { class: 'm-interact-thread pop-card' });
    list.append(note('围绕「' + text(m).slice(0, 42) + '」 · ' + data.replies.length + '\u00a0条回复'));
    data.replies.forEach(reply => list.append(h('div', {}, [note(reply.author + ' · 刚刚 · 本地'), h('p', {}, reply.text)])));
    var input = h('textarea', { class: 'm-interact-input pop-input', rows: 2, placeholder: '回复此线程，保留主会话', 'aria-label': '线程回复' });
    list.append(input, button('发送线程回复', () => {
      if (!input.value.trim()) return H.toast('先写一条回复');
      data.replies.push({ author: demoText("interact.author.30"), text: input.value.trim() }); input.value = ''; data.threadOpen = true;
      var next = threadBody(m); list.replaceWith(next); refresh(); H.toast('线程回复已保存 · 本页');
    }, 'send', { class: 'btn-primary' }));
    return list;
  }
  H.registerPanel('interact-center', { title: '消息互动', icon: 'chat', group: '消息互动', render: function (container, c) {
    container.classList.add('m-interact-panel'); container.append(panelHead('消息互动', '本页操作'));
    var m = H.currentMessages().find(item => item.id === c.params.message);
    if (m) { container.append(h('div', { class: 'm-interact-result pop-card' }, text(m).slice(0, 200))); if (c.params.tab === 'thread') { container.append(threadBody(m)); return; } container.append(row(emoji.map(e => button(e, () => react(m, e))))); actions.filter(a => a[0] !== 'more' && a[0] !== 'react').forEach(a => container.append(button(a[2], () => { if (['quote','select','pin','read'].includes(a[0])) { ctx().state.drawer = null; redraw(); } action(a[0], m); }, a[1]))); }
    else container.append(button('继续与通话 · 互动演示', () => H.navigate({ view: 'chat', conversation: 'interact-r7-demo' }), 'play', { class: 'btn-primary' }), note('悬停消息可回应；长按或点消息「更多」可查看全部操作。'), button('本页记忆草稿', () => H.openPanel('interact-memory'), 'memory'), button('会话内搜索', () => H.openPanel('interact-search'), 'search'), button('语音通话演示', startCall, 'headphones'));
  } });

  function reviseExampleDraft(payload) {
    if (payload.conversation !== demoText("interact.sample.31") || payload.bot !== demoText("interact.sample.32") || !payload.text.trim()) return false;
    var decision = H.state.decisions.find(d => d.id === 'd-draft');
    if (!decision || decision.status !== 'edit') return false;
    // The salutation precedes the body: keep it and the first body paragraph intact.
    var paragraphs = decision.jp.split('\n\n');
    paragraphs[2] = demoText("interact.sample.33");
    var draft = { bot: demoText("interact.bot.34"), channel: demoText("interact.channel.35"), level: 'L3',
      jaBody: paragraphs.join('\n\n'), zhNote: decision.zh,
      checks: [
        { label: '日期', value: '周六（具体日期未提供）', state: '待核' },
        { label: '时间', value: '下午（大概到店时间待客户回复）', state: '待核' },
        { label: '人数', value: '带孩子同行（具体人数未提供）', state: '待核' }
      ] };
    var part = { type: 'cards-a-customer-draft', data: draft };
    // messageText uses the card registry at reply time, including when cards-a is disabled.
    var registered = H.messageText && H.messageText({ parts: [part] }) !== '未知卡片';
    var parts = [{ type: 'text', md: '已按你的意见改了第二段，旧稿作废。新稿仍为 L3 待批，未发送。' }];
    parts.push(registered ? part : { type: 'text', md: demoText("interact.md.36") + draft.jaBody +
      '\n\n**中文说明**\n' + draft.zhNote + '\n\n**关键信息 · 独立核对**\n' +
      draft.checks.map(check => check.label + '：' + check.value + ' · ' + check.state).join('\n') + '\n\n仅草稿 · 未发送，等待批准。' });
    var revised = H.postMessage(payload.conversation, { from: demoText("interact.from.37"), time: '刚刚', parts: parts });
    if (typeof H.supersedeDecision === 'function') H.supersedeDecision('d-draft', { by: revised.id });
    return true;
  }
  function isChiefConfused(payload) {
    return payload.bot === 'chief' && ((payload.text || '').includes('？？') || (payload.text || '').includes('没听懂'));
  }
  function response(payload) {
    if (isChiefConfused(payload)) return '这句我没完全听懂，能换个说法吗？';
    var c = ctx(), bot = name(payload.bot);
    return bot + '收到。\n' + (payload.quote ? '我会围绕引用的消息继续整理。\n' : '') +
      (payload.attachments.length ? '已带上 ' + payload.attachments.length + '\u00a0个模拟附件；它们没有上传。\n' : '') +
      '这次先处理：「' + (payload.text || '查看附件').slice(0, 100) + '」。\n\n' +
      '下一步：把目标、已知证据和待确认项分开；形成可审查的本地草稿。\n示例回复完成 · 未调用模型、未外发。';
  }
  function syncRunning(face) {
    var c = ctx(), running = jobs.has(c.conversation), changed = c.state.running !== running;
    c.state.running = running;
    if (changed) H.emit('interact:running', { conversation: c.conversation, running: running });
    if (face || changed) H.updateChiefFace?.(c.conversation, face || (running ? 'thinking' : 'normal'));
  }
  function updateStream(job) {
    preserveReading(() => {
    document.querySelectorAll('[data-stream]').forEach(el => { if (el.dataset.stream === job.data.id) {
      var body = el.querySelector('.m-interact-streamtext'), previous = body.textContent;
      if (previous !== job.data.text) {
        if (body.firstChild?.nodeType === 3 && job.data.text.startsWith(previous)) body.firstChild.appendData(job.data.text.slice(previous.length));
        else body.textContent = job.data.text;
      }
      var label = el.querySelector('small'); if (label.textContent !== job.data.status) label.textContent = job.data.status;
      el.classList.toggle('m-interact-live', jobs.get(job.payload.conversation) === job);
      if (jobs.get(job.payload.conversation) !== job) el.querySelector('[data-interact-stop]')?.remove();
    } });
    }, 'stream-update');
  }
  function finishJob(id, stopped) {
    var job = jobs.get(id); if (!job) return;
    clearInterval(job.timer); job.pending.forEach(clearTimeout); jobs.delete(id);
    job.data.status = stopped ? '已停止 · 可重试 · 演示，未真实执行' : '回复完成 · 演示，未真实执行';
    if (!job.data.text) job.data.text = stopped ? '已取消本轮，原消息与排队消息保留。' : '演示回复完成。';
    if (job.payload.recovery) job.payload.recovery.state = stopped ? '续接已停止' : '续接完成';
    // A completed bot no longer carries thinking/tool labels; the user's read receipt stays.
    H.setMessageStatus(id, job.message.id, 'delivered');
    updateStream(job);
    var face = ctx().conversation === id ? (stopped ? 'normal' : isChiefConfused(job.payload) ? 'confused' : 'done') : undefined;
    syncRunning(face); refresh();
    if (ctx().conversation === id) H.reading && H.reading.release({ reason: 'turn-end' });
    var l = local(id);
    if (!stopped && l.queue.length) { var next = l.queue.shift(); runPayload(next); }
    // Deliver only after the last stream (including queued turns) has stopped
    // scrolling. Quiet insertion and its visible hint remain owned by the shell.
    flushBackgroundReport(id);
  }
  function runPayload(payload) {
    var id = payload.conversation;
    if (jobs.has(id)) return H.toast('该会话已有回复在运行');
    var parts = [];
    if (payload.quote) parts.push({ type: 'interact-quote', data: payload.quote });
    if (payload.text || payload.mentions.length) parts.push({ type: 'text', md: payload.mentions.map(b => '@' + name(b)).join(' ') + (payload.mentions.length ? '\n' : '') + payload.text });
    if (payload.attachments.length) parts.push({ type: 'interact-attachments', data: { files: payload.attachments } });
    var sent = H.postMessage(id, { from: 'user', time: '刚刚', status: 'delivered', parts: parts });
    // 监工合并小修（r7）：别的模块已同步回了结构化卡（如 persona 的新 bot 草案）时，不再追加通用流式回复。
    var lastMsg = ctx().conversation === id ? H.currentMessages().slice(-1)[0] : null;
    if (lastMsg && lastMsg.from !== 'user' && lastMsg.id !== sent.id) { H.setMessageStatus(id, sent.id, 'read'); return; }
    if (reviseExampleDraft(payload)) { H.setMessageStatus(id, sent.id, 'read'); return; }
    var data = { id: uid('stream'), conversation: id, text: '', status: '已送达 · 演示，未真实执行' };
    var full = (payload.model ? '本轮模型：' + payload.model + ' · 演示，未真实执行\n' : '') + response(payload);
    var job = { data: data, payload: payload, offset: 0, timer: null, pending: [], message: null };
    jobs.set(id, job); syncRunning();
    job.message = H.postMessage(id, { from: payload.bot, time: '刚刚', parts: [{ type: 'interact-stream', data: data }] });
    H.setMessageStatus(id, sent.id, 'delivered');
    function later(delay, fn) { job.pending.push(setTimeout(() => { if (jobs.get(id) === job) fn(); }, delay)); }
    later(500, () => { data.status = name(payload.bot) + '已读 · 演示，未真实执行'; H.setMessageStatus(id, sent.id, 'read'); updateStream(job); });
    later(1100, () => { data.status = '正在想… · 演示，未真实执行'; H.setMessageStatus(id, job.message.id, 'thinking'); updateStream(job); });
    later(1900, () => { data.status = '正在用工具：本地草稿整理 · 演示，未真实执行'; H.setMessageStatus(id, job.message.id, 'tool', '本地草稿整理（演示）'); updateStream(job); });
    later(2900, () => {
      data.status = '正在回复 · 演示，未真实执行'; H.setMessageStatus(id, job.message.id, 'delivered');
      job.timer = setInterval(() => {
        if (jobs.get(id) !== job) return;
        job.offset += 5; data.text = full.slice(0, job.offset); updateStream(job);
        if (job.offset >= full.length) finishJob(id, false);
      }, 65);
    });
    refresh();
  }
  function retry(m) {
    var c = ctx(); if (jobs.has(c.conversation)) return H.toast('请先停止当前回复再重试');
    var msgs = H.currentMessages(), index = msgs.findIndex(n => n.id === m.id), previous = msgs.slice(0, index + 1).reverse().find(n => n.from === 'user');
    runPayload({ conversation: c.conversation, bot: c.bot.id, text: '重新整理：' + text(previous || m), quote: null, attachments: [], mentions: [] });
  }
  function sendMessage() {
    if (!H.canSend()) return;
    var c = ctx(), l = local(), value = (composerInput()?.value ?? c.state.input ?? '').trim();
    if (value.startsWith('/')) {
      var matched = value.match(/^\/([^\s]+)\s*([\s\S]*)$/), def = matched && commands.find(cmd => matched[1] === cmd[1] || matched[1] === 'interact-' + cmd[0]);
      if (def) { setInput(''); executeCommand(def[0], matched[2]); return; }
      if (/^\/(context|plan|side)(?:\s|$)/.test(value)) return;
      return H.toast('未识别命令，输入 / 选择可用命令');
    }
    if (!value && !l.attachments.length && !l.mentions.length) return H.toast('先写消息或添加附件');
    var payload = { conversation: c.conversation, bot: l.mentions[0] || c.bot.id, text: value, quote: l.quote, attachments: l.attachments.slice(), mentions: l.mentions.slice() };
    function clearDraft() { l.quote = null; l.attachments = []; l.mentions = []; l.draft = ''; l.saved = false; c.state.input = ''; saveDrafts(); var input = composerInput(); if (input) H.clearComposer(); }
    if (jobs.has(c.conversation) || c.state.running) {
      H.sheet({ title: '助理还在回复', body: h('div', { class: 'm-interact-panel' }, [note('把新消息排到这轮之后，或停止这轮并插话。取消会保留完整草稿。'),
        button('排队 · 本轮完成后发送', () => { clearDraft(); c.state.drawer = null; if (jobs.has(c.conversation)) { l.queue.push(payload); redraw(); H.toast('已排队，可在输入栏上方编辑或移除'); } else runPayload(payload); }, 'clock', { class: 'btn-primary' }),
        button('插话 · 停止本轮并发送', () => { if (!jobs.has(c.conversation) && c.state.running) return H.toast('壳的运行演示请先点停止，草稿已保留'); finishJob(c.conversation, true); clearDraft(); c.state.drawer = null; runPayload(payload); }, 'send'),
        button('返回编辑', () => redraw(), 'back')]) }); return;
    }
    clearDraft(); runPayload(payload);
  }
  function executeCommand(id, args) {
    var c = ctx();
    if (id === 'compress') { c.state.context = Math.min(c.state.context, 48); c.state.compressed = true; H.postMessage(c.conversation, { from: c.bot.id, time: '刚刚', parts: [{ type: 'text', md: '**上下文压缩 · 演示**\n保留：当前目标、待办、来源与待确认项。原消息完整保留。' }] }); }
    if (id === 'new') fork();
    if (id === 'model') H.openPanel('model');
    if (id === 'remember') { if (args) remember(null, args); else H.openPanel('interact-memory'); }
    if (id === 'task') { if (args) taskFrom(null, args); else H.toast('用法：/任务 后面写任务内容'); }
    if (id === 'schedule') H.openPanel('schedule');
    if (id === 'background') backgroundReport(c.conversation);
  }
  commands.forEach(cmd => H.registerSlashCommand({ name: 'interact-' + cmd[0], hint: '/' + cmd[1] + ' · ' + cmd[2], run: args => executeCommand(cmd[0], args) }));

  function matches() { var q = search.query.trim().toLocaleLowerCase(); return q ? H.currentMessages().filter(m => text(m).toLocaleLowerCase().includes(q)) : []; }
  function findNext(direction) {
    var list = matches(); if (!list.length) return H.toast('当前会话没有匹配消息');
    search.index = (search.index + direction + list.length) % list.length;
    goMessage(list[search.index].id, null, 'search'); H.toast((search.index + 1) + ' / ' + list.length);
  }
  H.registerPanel('interact-search', { title: '会话内查找', icon: 'search', group: '消息互动', render: function (container) {
    container.classList.add('m-interact-panel'); if (search.conversation !== ctx().conversation) search = { conversation: ctx().conversation, query: '', index: 0 };
    var results = h('div', { class: 'm-interact-panel' });
    function paint() { results.replaceChildren(); var list = matches(); results.append(note(search.query ? list.length + '\u00a0条匹配消息' : '搜索文字或卡片标题')); list.forEach((m, i) => results.append(button(name(m.from) + ' · ' + text(m).slice(0, 130), () => { search.index = i; goMessage(m.id, null, 'search'); }, 'search'))); }
    container.append(panelHead('会话内查找', '当前会话'), h('input', { class: 'm-interact-input pop-input', type: 'search', value: search.query, placeholder: '搜索当前会话', 'aria-label': '搜索当前会话', onInput: e => { search.query = e.target.value; search.index = 0; paint(); } }), row([button('上一条', () => findNext(-1), 'back'), button('下一条', () => findNext(1), 'chevron')]), results); paint();
  } });

  function wave() { return h('div', { class: 'm-interact-wave', 'aria-label': '波形动画示意' }, Array.from({ length: 11 }, () => h('i'))); }
  function startVoice() { if (voiceHold) return; voiceHold = { started: Date.now(), conversation: ctx().conversation }; reading = ''; if (ctx().state.drawer) redraw(); else refresh(); }
  function finishVoice(cancel) {
    if (!voiceHold) return; var same = voiceHold.conversation === ctx().conversation; voiceHold = null;
    if (!cancel && same) setInput((composerInput()?.value || '') + demoText("interact.sample.38"));
    refresh(); H.toast(cancel ? '已取消听写' : '示例转写已放入草稿 · 未录音');
  }
  function syncCallAudio(active) {
    Object.assign(H.callState, { audioEpoch: active.audioEpoch, subtitle: active.caption, mouth: active.mouth, status: active.status });
  }
  function clearCallAudio(active) {
    clearInterval(callTimer);
    active.audioEpoch = ++audioEpoch; active.caption = ''; active.transcript = []; active.mouth = 0; active.turns = 0; active.status = 'listening';
    syncCallAudio(active);
  }
  function armCallCaptions() {
    clearInterval(callTimer);
    var active = call, epoch = active.audioEpoch;
    callTimer = setInterval(() => {
      // A callback already queued before clearInterval must also fail this fence.
      if (call !== active || active.audioEpoch !== epoch) return;
      if (ctx().bot.id !== active.bot || H.callState.bot !== active.bot) { discardCall(); return; }
      if (!active.mute) {
        var captions = ['你：先看今天需要拍板的事。', name(active.bot) + '：先整理待办，草稿留给你查看。', name(active.bot) + '：你可以随时打断，我在听。'];
        var turn = active.turns++ % captions.length;
        active.caption = captions[turn]; active.mouth = turn === 0 ? 0 : 1; active.status = turn === 0 ? 'listening' : 'speaking';
        active.transcript.push(active.caption); active.transcript = active.transcript.slice(-40);
      }
      syncCallAudio(active); paintCall();
    }, 2200);
  }
  function discardCall() {
    if (!call) return;
    var oldBot = call.bot;
    clearCallAudio(call); H.callState.status = 'stopped'; call = null;
    document.querySelector('.m-interact-callfull')?.remove();
    if (H.callState.bot === oldBot) H.hideFloatingCall();
    paintCall();
  }
  function startCall() {
    if (call && ctx().bot.id !== call.bot) discardCall();
    if (!call) {
      call = { bot: ctx().bot.id, started: Date.now(), mute: false, full: true, caption: '', turns: 0, conversation: ctx().conversation, transcript: [], audioEpoch: ++audioEpoch, mouth: 0, status: 'listening' };
      syncCallAudio(call); armCallCaptions();
      H.showFloatingCall(call.bot);
    }
    call.full = true; H.callState.minimized = false;
    H.navigate({ view: 'chat', conversation: call.conversation }); paintCall(true);
  }
  function minimizeCall() {
    if (!call) return;
    call.full = false; paintCall(); H.showFloatingCall(call.bot);
    document.querySelector('[data-floating-call]')?.focus({ preventScroll: true });
  }
  function endCall() {
    if (!call) return;
    var ended = call, summary = ended.transcript.filter(line => !line.startsWith('正在')).join('；');
    clearCallAudio(ended); H.callState.status = 'stopped'; call = null;
    document.querySelector('.m-interact-callfull')?.remove(); H.hideFloatingCall();
    H.postMessage(ended.conversation, { from: ended.bot, time: '刚刚', parts: [
      { type: 'text', md: '通话已结束。演示，未真实执行；未录音、未连接语音服务。' },
      { type: 'cards-b-call-summary', data: { bot: ended.bot, duration: Math.floor((Date.now() - ended.started) / 1000),
        summary: '演示，未真实执行。模拟字幕：' + (summary || '未形成对话内容。'),
        decisions: ['未形成实际批准或决定。'], todos: ['需要执行的事项请在会话里另行确认。'] } }
    ] });
    if (ctx().conversation === ended.conversation) composerInput()?.focus({ preventScroll: true });
    H.toast('通话纪要已放回原会话 · 演示，未真实执行');
  }
  function captionLog() {
    return h('div', { class: 'm-interact-transcript', role: 'log', 'aria-label': '滚动通话字幕', 'aria-live': 'polite', 'aria-relevant': 'additions text' }, call.transcript.map(line => h('p', demoFixture("interact.sample.39"), line)));
  }
  function callContent(full) {
    if (!call) return note('通话已结束');
    var el = h('div', { class: full ? 'm-interact-callfull' : 'm-interact-call pop-card', role: full ? 'dialog' : null, 'aria-modal': full ? 'true' : null, 'aria-label': name(call.bot) + ' · 语音通话演示', tabIndex: -1, dataset: { audioEpoch: call.audioEpoch } });
    var outfit = H.currentOutfit(call.bot), waveform = wave();
    var level = H.levelSticker('L1', { action: '通话字幕与嘴型演示', scope: '本页模拟，不访问麦克风', bot: call.bot });
    // The shell sheet sits below the full call overlay: minimize before opening it.
    if (full) level.addEventListener('click', minimizeCall, true);
    waveform.classList.toggle('m-interact-wave-idle', !call.mouth);
    if (H.botStyle) el.setAttribute('style', H.botStyle(call.bot));
    el.append(sticker('本页演示，未真实执行'), level, h('div', { class: 'm-interact-callavatar', 'aria-hidden': 'true' }, H.avatar(call.bot)),
      h('strong', {}, name(call.bot) + ' · 语音通话'), h('p', { class: 'm-interact-note m-interact-elapsed' }, '通话 ' + Math.floor((Date.now() - call.started) / 1000) + '\u00a0秒'),
      h('p', { class: 'm-interact-note m-interact-outfit', dataset: { callOutfit: outfit?.id || '' } }, '当前装扮：' + (outfit ? outfit.name + ' · ' + outfit.kind : '尚未配置') + ' · 形象占位'),
      h('p', { class: 'm-interact-note m-interact-callstatus' }, call.mute ? '已静音 · 演示' : call.status === 'speaking' ? '正在说话 · 演示' : '正在聆听，你可以随时打断 · 演示'),
      waveform, h('span', { class: 'm-interact-mouth', dataset: { mouth: call.mouth ? 'open' : 'closed' } }, call.mouth ? '口型：音量驱动占位，非音素级' : '口型：闭合 · 音量驱动占位，非音素级'), captionLog(), h('p', { class: 'm-interact-caption' }, call.caption), row([
        button(call.mute ? '取消静音' : '静音', () => { var muted = !call.mute; clearCallAudio(call); call.mute = muted; armCallCaptions(); paintCall(true, 'mute'); }, 'mic', { 'aria-pressed': String(call.mute), dataset: { interactCallAction: 'mute' } }),
        button('打断', () => { clearCallAudio(call); call.caption = '已打断 · 旧字幕与嘴型已清空，正在聆听 · 演示'; syncCallAudio(call); armCallCaptions(); paintCall(true, 'interrupt'); }, 'stop', { dataset: { interactCallAction: 'interrupt' } }),
        button('缩小', minimizeCall, 'down'),
        button('挂断', endCall, 'close', { class: 'btn-primary' })]), note('仅模拟字幕与状态；不访问麦克风、不合成声音。'));
    if (full) el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); minimizeCall(); }
      // 通话模态内焦点循环：非聊天，豁免。
      if (e.key === 'Tab') { var buttons = Array.from(el.querySelectorAll('button')), first = buttons[0], last = buttons[buttons.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    });
    return el;
  }
  function paintCall(focus, action) {
    var existing = document.querySelector('.m-interact-callfull'), host = document.querySelector('.m-interact-callhost');
    if (call && (H.callState.bot !== call.bot || ctx().bot.id !== call.bot)) { discardCall(); return; }
    if (host) host.replaceChildren(callContent(false));
    if (!call?.full) { existing?.remove(); return; }
    if (existing && !focus) {
      existing.dataset.audioEpoch = call.audioEpoch;
      existing.querySelector('.m-interact-caption').textContent = call.caption;
      existing.querySelector('.m-interact-callstatus').textContent = call.mute ? '已静音 · 演示' : call.status === 'speaking' ? '正在说话 · 演示' : '正在聆听，你可以随时打断 · 演示';
      var mouth = existing.querySelector('.m-interact-mouth'); mouth.dataset.mouth = call.mouth ? 'open' : 'closed';
      mouth.textContent = call.mouth ? '口型：音量驱动占位，非音素级' : '口型：闭合 · 音量驱动占位，非音素级';
      existing.querySelector('.m-interact-wave').classList.toggle('m-interact-wave-idle', !call.mouth);
      existing.querySelector('.m-interact-elapsed').textContent = '通话 ' + Math.floor((Date.now() - call.started) / 1000) + '\u00a0秒';
      // 通话字幕容器滚动：非聊天，豁免。
      var log = existing.querySelector('.m-interact-transcript');
      if (log.textContent !== call.transcript.join('')) { var next = captionLog(); log.replaceWith(next); next.scrollTop = next.scrollHeight; }
      return;
    }
    existing?.remove(); var full = callContent(true); document.body.append(full);
    // 通话字幕容器滚动：非聊天，豁免。
    var log = full.querySelector('.m-interact-transcript'); log.scrollTop = log.scrollHeight;
    (action ? full.querySelector('[data-interact-call-action="' + action + '"]') : full.querySelector('button'))?.focus({ preventScroll: true });
  }
  H.on('call:expand', () => { if (call) { call.full = true; H.navigate({ view: 'chat', conversation: call.conversation }); paintCall(true); } });
  H.on('call', () => { if (call && H.callState.bot !== call.bot) discardCall(); });
  H.on('navigate', () => { if (call && ctx().bot.id !== call.bot) discardCall(); });
  H.on('outfit', e => { if (call && call.bot === e.bot) paintCall(true); });
  H.registerPanel('interact-call', { title: '语音通话', icon: 'headphones', group: '消息互动', render: function (container) {
    container.classList.add('m-interact-panel'); var host = h('div', { class: 'm-interact-callhost' }); host.append(callContent(false));
    container.append(panelHead('语音通话', '离线演示'), host, !call ? button('开始通话演示', startCall, 'headphones', { class: 'btn-primary' }) : null);
  } });

  function picker(host, value) {
    var command = value.match(/^\/([^\s]*)$/), mention = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (!command && !mention) return;
    var menu = h('div', { class: 'm-interact-popup', role: 'group', 'aria-label': command ? '命令面板' : '提及助理' });
    if (command) commands.filter(cmd => cmd[1].includes(command[1]) || ('interact-' + cmd[0]).includes(command[1])).forEach(cmd => menu.append(button('/' + cmd[1] + ' · ' + cmd[2], () => {
      if (cmd[0] === 'task' || cmd[0] === 'remember') setInput('/' + cmd[1] + ' ');
      else { setInput(''); executeCommand(cmd[0], ''); }
    }, 'tools')));
    if (mention) ctx().state.bots.filter(bot => (bot.name + bot.id).toLowerCase().includes(mention[1].toLowerCase())).forEach(bot => menu.append(button('@' + bot.name + ' · ' + bot.duty, () => { var l = local(); if (!l.mentions.includes(bot.id)) l.mentions.push(bot.id); setInput(value.slice(0, value.lastIndexOf('@'))); }, 'chat')));
    if (menu.children.length) host.append(menu);
  }
  function renderDock(dock) {
    var l = local(), existing = dock.querySelector('.m-interact-dock'), box = h('div', { class: 'm-interact-dock' });
    var input = composerInput();
    if (l.quote) box.append(h('div', { class: 'm-interact-preview' }, [h('span', { class: 'm-interact-previewtext' }, [H.icon('quote'), ' ' + l.quote.author + '：' + l.quote.text]), button('取消', () => { l.quote = null; saveDrafts(); refresh(); }, 'close', { class: 'btn-tertiary' })]));
    if (l.mentions.length) box.append(row(l.mentions.map(id => button(['@' + name(id) + ' ',H.icon('close')], () => { l.mentions = l.mentions.filter(n => n !== id); refresh(); }, null, { 'aria-label': '移除提及 ' + name(id) }))));
    if (l.attachments.length) box.append(row(l.attachments.map(f => row([button(f.name, () => previewAttachment(f), f.kind === 'image' ? 'image' : 'file'), button('移除', () => { l.attachments = l.attachments.filter(item => item.id !== f.id); refresh(); }, 'close')]))));
    if (l.queue.length) {
      box.append(h('div', { class: 'm-interact-queue' }, [note('排队 ' + l.queue.length + '\u00a0条 · 按序处理，停止后保留'), ...l.queue.map((p, i) => row([h('span', { class: 'm-interact-previewtext' }, (i + 1) + ' · ' + (p.text || '附件消息')), button('编辑', () => { if (l.draft || l.attachments.length || l.quote || l.mentions.length) return H.toast('请先发送或清空当前草稿，再编辑队列'); l.queue.splice(i, 1); l.quote = p.quote; l.attachments = p.attachments; l.mentions = p.mentions; setInput(p.text); }, 'file'), button('移除', () => { l.queue.splice(i, 1); refresh(); }, 'close')])), !jobs.has(ctx().conversation) ? button('继续队列', () => runPayload(l.queue.shift()), 'play', { class: 'btn-primary' }) : null]));
    }
    // 旧的松手听写条停用。startVoice / finishVoice 还留着，但不再把示例文字写进输入框。
    picker(box, input?.value || '');
    // Bot-specific quick replies belong to the shell's single .hub-quick row.
    if (existing) existing.replaceWith(box); else dock.prepend(box);
    renderBottom(dock);
    var send = dock.querySelector('.voicebtn');
    if (send) { var filled = !!(input?.value.trim() || l.attachments.length || l.mentions.length), running = jobs.has(ctx().conversation); send.dataset.act = running ? 'stop' : filled ? 'send' : 'voice'; send.setAttribute('aria-label', running ? '停止生成' : filled ? '发送消息' : '开始语音通话'); send.replaceChildren(H.icon(running ? 'stop' : filled ? 'send' : 'wave')); }
    if (jobs.has(ctx().conversation) && (input?.value.trim() || l.attachments.length || l.mentions.length)) box.append(button('发送新消息 · 排队或插话', sendMessage, 'send', { class: 'btn-primary' }));
    if (search.conversation === ctx().conversation && search.query) box.append(row([note('查找「' + search.query + '」 · ' + matches().length + '\u00a0条'), button('上一条', () => findNext(-1), 'back'), button('下一条', () => findNext(1), 'chevron'), button('结束查找', () => { search.query = ''; refresh(); }, 'close', { class: 'btn-tertiary' })]));
    box.hidden = !box.children.length;
  }
  function renderBottom(dock) {
    var thread = document.querySelector('.thread'), state = H.reading && H.reading.state();
    document.querySelector('.m-interact-bottom')?.remove();
    if (!thread || !state?.showBottom) return;
    var jump = button('', () => { H.reading && H.reading.toBottom({ reason: 'bottom-button' }); }, 'down', {
      class: 'btn-primary m-interact-bottom', title: '到底部' + (state.unread ? ' · ' + state.unread + '\u00a0条新消息' : ''), 'aria-label': '到底部' + (state.unread ? '，' + state.unread + '\u00a0条未读' : '')
    });
    if (state.unread) jump.append(h('span', {class:'m-interact-bottom-count'}, state.unread > 99 ? '99+' : String(state.unread)));
    dock.parentNode.append(jump);
  }
  function renderUnread() {
    var state = H.reading && H.reading.state(), old = document.querySelector('.m-interact-unread');
    var first = state?.firstUnreadId ? Array.from(document.querySelectorAll('[data-message-id]')).find(el => el.dataset.messageId === state.firstUnreadId) : null;
    if (old && first && old.nextElementSibling === first) return;
    if (!old && !first) return;
    preserveReading(() => {
      old?.remove();
      first?.before(h('div', { class: 'm-interact-unread' }, '以下是新消息'));
    }, 'unread-divider');
  }
  function enhanceMessages() {
    return preserveReading(() => {
      var messages = H.currentMessages();
      document.querySelectorAll('[data-message-id]').forEach(article => {
        var m = messages.find(item => item.id === article.dataset.messageId); if (!m) return;
        article.classList.add('m-interact-article'); article.classList.toggle('m-interact-selected', selected.has(m.id));
        var data = meta(m), tools = h('div', { class: 'm-interact-tools' }), badges = h('div', { class: 'm-interact-badges' });
        Object.keys(data.reactions).forEach(e => { if (data.reactions[e].length) badges.append(button(e + ' ' + data.reactions[e].length + ' · ' + data.reactions[e].join('、'), () => react(m, e), null, { title: data.reactions[e].join('、') + ' 回应了；点击切换你的回应', 'aria-pressed': data.reactions[e].includes(demoText("interact.sample.40")) ? 'true' : 'false' })); });
        if (badges.children.length) tools.append(badges);
        if (data.replies.length) tools.append(button(data.replies.length + '\u00a0条回复', () => { data.threadOpen = !data.threadOpen; refresh(); }, 'chat'));
        if (data.pin) tools.append(button('已置顶', () => goMessage(m.id, null, 'pin'), 'pin'));
        if (reading === m.id) tools.append(button('停止朗读 · 演示', () => read(m), 'stop'));
        if (multi) tools.append(button(selected.has(m.id) ? '已选' : '选择', () => action('select', m), 'check', { 'aria-pressed': selected.has(m.id) ? 'true' : 'false' }));
        var long = text(m).length > 650;
        article.querySelectorAll('.hub-part,p').forEach(el => { if (el.closest('.m-interact-tools,.m-interact-thread,.m-interact-stream')) return; if (el.parentNode === article || el.classList.contains('hub-part')) el.classList.toggle('m-interact-collapsed', long && !data.expanded); });
        if (long) tools.append(button(data.expanded ? '收起长消息' : '展开完整消息', () => { data.expanded = !data.expanded; refresh(); }, 'down'));
        if (data.threadOpen) tools.append(threadBody(m));
        var old = article.querySelector('.m-interact-tools'); if (old) old.replaceWith(tools); else article.append(tools);
      });
      document.querySelector('.m-interact-pinbar')?.remove();
      var pins = messages.filter(m => meta(m).pin), thread = document.querySelector('.thread-inner');
      if (pins.length && thread) thread.prepend(h('div', { class: 'm-interact-pinbar' }, [sticker('置顶 ' + pins.length + '\u00a0条'), row(pins.map(m => button(text(m).slice(0, 40), () => goMessage(m.id, null, 'pin'), 'pin')))]));
      renderUnread();
    }, 'message-enhance');
  }
  function selectionBar(dock) {
    dock.querySelector('.m-interact-selection')?.remove(); if (!multi) return;
    dock.prepend(h('div', { class: 'm-interact-selection' }, [sticker('已选 ' + selected.size + '\u00a0条'), note('仅当前会话'), row([
      button('全选', () => { H.currentMessages().forEach(m => selected.add(m.id)); refresh(); }, 'check'),
      button('复制所选', () => { var list = H.currentMessages().filter(m => selected.has(m.id)); if (!list.length) return H.toast('请先选择消息'); copy(list.map(m => name(m.from) + '：' + text(m)).join('\n\n')); }, 'copy'),
      button('存为记忆', () => { var list = H.currentMessages().filter(m => selected.has(m.id)); if (!list.length) return H.toast('请先选择消息'); list.forEach(m => remember(m)); H.toast('已登记 ' + list.length + '\u00a0条本页记忆草稿'); }, 'memory'),
      button('完成', () => { multi = false; selected.clear(); refresh(); }, 'close')]) ]));
  }
  function enhance() {
    var c = ctx(), dock = document.querySelector('.composer-area');
    if (c.state.view !== 'chat' || !dock) return;
    if (current !== c.conversation) {
      if (current) { selected.clear(); multi = false; }
      current = c.conversation; var l = local(); c.state.input = l.draft; var input = composerInput(); if (input) { input.value = l.draft; input.setSelectionRange(input.value.length, input.value.length); }
    }
    dock.querySelectorAll('.inputpill button').forEach(el => el.classList.add('m-interact-target'));
    syncRunning(); renderDock(dock); selectionBar(dock); enhanceMessages();
    // The stream card owns typing feedback; suppress the shell's duplicate typing placeholder.
    document.querySelectorAll('.thread [data-act="stop"]').forEach(el => { var article = el.closest('article'); if (article && !article.dataset.messageId) article.classList.add('m-interact-hidden'); });
    var nativeMenu = document.querySelector('.atmenu'); if (nativeMenu && /(^\/|(?:^|\s)@[^\s]*$)/.test(c.state.input)) nativeMenu.hidden = true;
    renderBottom(dock);
  }
  H.on('render', () => { enhance(); if (call) paintCall(); });
  H.on('ready', enhance);
  H.on('reading:change', () => {
    var dock = document.querySelector('.composer-area');
    if (ctx().state.view !== 'chat' || !dock) return;
    renderBottom(dock); renderUnread();
  });
  H.on('message', e => {
    if (e.conversation === 'chief-013' && e.message.from === 'user' && !e.quiet && !backgroundTimers.has(e.conversation)) {
      scheduleBackgroundReport(e.conversation);
    }
    // The shell owns quiet insertion, focus, scroll and its background counter.
    if (e.quiet) return;
    refresh();
  });
  H.registerComposerTool({ id: 'interact-center-tool', icon: 'chat', label: '消息互动 · 本页', run: () => H.openPanel('interact-center') });
  [['attachments','plus','添加附件',() => H.openPanel('interact-attachments')],['mention','chat','@ 提及助理',() => setInput((composerInput()?.value || '') + ' @')],['commands','tools','/ 命令',() => setInput('/')],['call','headphones','语音通话演示',startCall],['search','search','会话内查找',() => H.openPanel('interact-search')]].forEach(tool => H.registerComposerTool({ id: 'interact-' + tool[0], icon: tool[1], label: tool[2], run: tool[3] }));

  // Capture the existing UI before the shell's demo handlers; never replace its global functions.
  function consume(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  document.addEventListener('click', e => {
    if (Date.now() < ignoreClickUntil && e.target.closest('[data-message-id],.micbtn')) { consume(e); return; }
    var el = e.target.closest('button'); if (!el || el.closest('.m-interact-tools,.m-interact-dock,.m-interact-selection,.m-interact-callfull')) return;
    var act = el.dataset.act, article = el.closest('[data-message-id]');
    if (act === 'send' && el.closest('.composer-area')) { if (/^\/(context|plan|side)(?:\s|$)/.test(composerInput()?.value.trim() || '')) return; consume(e); sendMessage(); }
    else if (act === 'stop' && jobs.has(ctx().conversation)) { consume(e); finishJob(ctx().conversation, true); H.toast('回复已停止，排队消息保留'); }
    else if (act === 'attachments' && el.closest('.composer-area')) { consume(e); H.openPanel('attachments'); }
    else if (act === 'mention-picker') { consume(e); setInput((composerInput()?.value || '') + ' @'); }
    else if (act === 'voice' && el.closest('.composer-area')) { consume(e); if (el.classList.contains('micbtn')) return; startCall(); }
    else if (article) { var m = H.currentMessages().find(item => item.id === article.dataset.messageId); var map = { '复制消息': 'copy', '朗读回复': 'read', '重新生成': 'retry', '从此处分叉': 'fork', '引用此消息': 'quote' }; var a = map[el.getAttribute('aria-label')]; if (m && a) { consume(e); action(a, m); } }
  }, true);
  document.addEventListener('keydown', e => {
    if (e.target.dataset?.focus !== 'composer') return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { if (/^\/(context|plan|side)(?:\s|$)/.test(e.target.value.trim())) return; consume(e); sendMessage(); }
    if (e.key === 'Escape') { var l = local(); l.quote = null; saveDrafts(); refresh(); }
  }, true);
  document.addEventListener('input', e => {
    if (e.target.dataset?.focus !== 'composer') return;
    var l = local(); l.draft = e.target.value; l.saved = !!l.draft; ctx().state.input = l.draft; saveDrafts();
    // Run after the shell paints its menu, retaining the existing textarea and caret.
    Promise.resolve().then(() => { if (e.target.isConnected) { var dock = document.querySelector('.composer-area'); if (dock) { renderDock(dock); var nativeMenu = document.querySelector('.atmenu'); if (nativeMenu) nativeMenu.hidden = true; H.measureDock?.(); } } });
  }, true);
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('.micbtn') && !e.target.closest('.drawer')) { e.stopImmediatePropagation(); return; }
  }, true);
  function release(e) { if (e.target.closest('.micbtn')) ignoreClickUntil = Date.now() + 400; }
  document.addEventListener('pointerup', release, true); document.addEventListener('pointercancel', release, true);
  function showSelection(event) {
    if (event?.target?.closest?.('.m-interact-selectionfloat')) return;
    var selection = window.getSelection?.(), chosen = selection?.toString().trim(), anchor = selection?.anchorNode, article = anchor?.parentElement?.closest('[data-message-id]');
    if (!chosen || !article) return;
    document.querySelector('.m-interact-selectionfloat')?.remove();
    selectionText = chosen.slice(0, 2000); var box = row(['追问', '解释', '翻译'].map(t => button(t, () => { var m = H.currentMessages().find(item => item.id === article.dataset.messageId); if (m) quoteMessage(m); setInput(t + '这段文字：\n「' + selectionText + '」'); box.remove(); })));
    box.classList.add('m-interact-selectionfloat'); article.append(box);
  }
  document.addEventListener('mouseup', showSelection);
  document.addEventListener('selectionchange', showSelection);
})();
