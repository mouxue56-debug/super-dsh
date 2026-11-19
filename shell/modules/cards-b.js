
(function () {
  'use strict';
  const H = window.Hub, P = 'm-cards-b-';
  function speak(value) {
    var fn = window.HubPlainTalk && window.HubPlainTalk.humanize;
    if (!fn || value == null || value === false) return value;
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map(speak);
    return value;
  }
  function spokenAttrs(attrs) {
    var copy = Object.assign({}, attrs || {});
    var fn = window.HubPlainTalk && window.HubPlainTalk.humanize;
    if (fn) ['aria-label', 'title', 'placeholder'].forEach(function (key) {
      if (typeof copy[key] === 'string') copy[key] = fn(copy[key]);
    });
    return copy;
  }
  function showLevel() {
    return !(window.HubPlainTalk && window.HubPlainTalk.realMode && window.HubPlainTalk.realMode());
  }
  // Every local node has a private class; CSS never selects shell classes or tags.
  const h = (name, attrs, children) => {
    var copy = spokenAttrs(attrs);
    copy.class = [P + 'node', P + 'el-' + name, attrs && attrs.class].filter(Boolean).join(' ');
    return H.h(name, copy, speak(children));
  };
  const localIcon = (name,options) => {const node = H.icon(name,options); node.classList.add(P + 'el-svg'); return node;};
  const featureAssistantId = id => H.featureOwner(id)?.id;
  const memory = new Map();
  const media = new Set();
  H.on('render', () => {media.forEach(entry => {if (!entry.root.isConnected) entry.dispose();});});
  let serial = 0;
  const cls = name => P + name;
  // Shell primitives carry the theme; private classes only arrange this module.
  const shared = {card: 'pop-card', head: 'pop-card-head', tag: 'badge', sticker: 'sticker bot',
    preview: 'pop-card', hero: 'pop-card', tile: 'pop-card', option: 'pop-card',
    select: 'pop-input', copyarea: 'pop-input', check: 'toggle-row',
    file: 'btn-tertiary', thumb: 'btn-secondary', shot: 'btn-secondary'};
  const el = (tag, name, children, attrs) => h(tag, Object.assign({}, attrs || {}, {
    class: [cls(name), shared[name], attrs && attrs.class, attrs && attrs.class === 'btn-primary' ? cls('button-primary') : null].filter(Boolean).join(' ')
  }), ['title', 'note', 'tag', 'prose', 'cell', 'source', 'muted', 'handoff-text', 'compare-heading', 'grow', 'readout', 'summary'].includes(name) ? keepUnits(children) : children);
  // Keep measurements and whole words before separators together; preserve source text.
  function keepUnits(text) {
    if (typeof text !== 'string') return text;
    const nodes = [], units = /[ \u00a0]*[^\s·]+[ \u00a0]*·|\d+(?:,\d{3})*(?:\.\d+)?(?:[ \u00a0]*(?:k[ \u00a0]+)?token\b|[ \u00a0]*(?:分钟|小时|毫秒|秒|分|项|次|轮|张|条|人|种|%|％)|[ \u00a0]*[KMG]?B\b)(?:[ \u00a0]*·)?/g;
    let end = 0;
    for (const match of text.matchAll(units)) {
      const before = text.slice(end, match.index), spacing = /^[ \u00a0]*$/.test(before);
      if (before && !spacing) nodes.push(before);
      
      nodes.push(el('span', 'unit', (spacing ? before : '') + match[0]));
      end = match.index + match[0].length;
    }
    const tail = text.slice(end);
    if (tail && /^[ \u00a0]+$/.test(tail) && nodes.length) nodes[nodes.length - 1].append(tail);
    else if (tail) nodes.push(tail);
    return nodes;
  }
  const note = text => el('p', 'note', text);
  const tag = text => el('span', 'tag', (text.match(/[^·]*·|[^·]+$/g) || []).flatMap((part, i) => [
    i ? el('wbr', 'unit-break') : null, el('span', 'unit', part)
  ]));
  const row = children => el('div', 'row', children);
  const button = (text, fn, icon, attrs) => el('button', 'button', [icon ? localIcon(icon) : null, text],
    Object.assign({type: 'button', onClick: fn, class: ['copy', 'retry'].includes(icon) ? 'btn-tertiary' : 'btn-secondary'}, attrs || {}));
  const detail = (title, body) => H.sheet({title, body: el('div', 'detail', body)});
  const list = items => el('ul', 'list', items.map(x => h('li', {}, keepUnits(x))));
  function state(d, init) {
    if (!memory.has(d)) memory.set(d, init());
    return memory.get(d);
  }
  function card(d, fallback, body) {
    return el('section', 'card', [
      el('header', 'head', [el('h3', 'title', d.title || fallback), el('span', 'sticker', '演示')]),
      body,
      el('footer', 'foot', [d.source ? el('span', 'source', '来自：' + d.source) : null,
        el('span', 'muted', '假数据 · 仅本页')])
    ]);
  }
  async function copy(text) { return H.copyText(text); }
  function svg(tagName, attrs, children) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tagName);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v)));
    n.setAttribute('class', [cls('node'), cls('el-' + tagName), attrs && attrs.class].filter(Boolean).join(' '));
    (children || []).forEach(c => n.append(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  function picture(index, label) {
    const scene = index % 3;
    const shapes = scene === 0 ? [
      svg('path', {d: 'M104 140 L105 77 L131 96 Q158 83 181 96 L205 76 L211 142 Q209 186 159 189 Q109 187 104 140', fill: 'var(--elev)', stroke: 'var(--lemon)', 'stroke-width': 3}),
      svg('path', demoFixture("cards-b.shapes.1"))
    ] : scene === 1 ? [
      svg('path', {d: 'M0 178 L80 85 L127 144 L206 51 L320 184 Z', fill: 'var(--bot-soft)', stroke: 'var(--bot-strong)', 'stroke-width': 2}),
      svg('path', {d: 'M0 201 Q98 154 174 186 T320 165 L320 240 L0 240Z', fill: 'var(--elev-2)'}),
      svg('path', {d: 'M150 180 Q157 143 165 180 L182 214 L134 214Z', fill: 'var(--lemon)'}),
      svg('circle', {cx: 158, cy: 143, r: 9, fill: 'var(--ink)'})
    ] : [
      svg('rect', {x: 48, y: 58, width: 224, height: 132, rx: 18, fill: 'var(--elev)', stroke: 'var(--bot-strong)', 'stroke-width': 2}),
      svg('path', demoFixture("cards-b.shapes.2")),
      svg('path', demoFixture("cards-b.shapes.3"))
    ];
    return svg('svg', {viewBox: '0 0 320 240', class: cls('picture'), role: 'img', 'aria-label': label + ' · SVG 占位示意'}, [
      svg('rect', {width: 320, height: 240, rx: 16, fill: 'var(--fill)'}),
      svg('circle', {cx: 253, cy: 50, r: 22, fill: 'var(--pink)'}), ...shapes
    ]);
  }
  function fullscreen(title, build) {
    const previous = document.activeElement;
    const dialog = el('dialog', 'fullscreen', null, {'aria-label': title, style: H.botStyle(H.state.bot)});
    const close = button('关闭', () => dialog.close(), 'close');
    dialog.append(el('header', 'fullhead', [el('strong', 'grow', title), close]));
    const body = el('div', 'fullbody');
    dialog.append(body);
    build(body, dialog);
    dialog.addEventListener('close', () => {dialog.remove(); if (previous && previous.isConnected) previous.focus({preventScroll:true});}, {once: true});
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') {dialog.showModal(); close.focus({preventScroll:true});}
    else {dialog.remove(); detail(title, [note('当前环境不支持全屏预览，以下为内容。'), body]);}
    return dialog;
  }
  function register(type, title, render) {
    H.registerCard('cards-b-' + type, {title, render: (data, ctx) => {
      const d = data || {};
      const body = render(d, ctx);
      const levels = demoFixture("cards-b.levels.4");
      return card(d, title, levels[type] && showLevel() ? [H.levelSticker(levels[type], {
        action: title + ' · 本页演示', scope: title + ' · 本页卡片', bot: d.bot || ctx.bot.id
      }), body] : body);
    }, quoteLabel: d => title + '：' + ((d || {}).title || title)});
  }

  H.addStyle((demoText("cards-b.sample.5")));

  register('page', '页面预览', d => {
    const status = note('预览中的按钮可操作 · HTML 示例，未发布');
    const show = () => fullscreen(d.title || '示例页', body => {
      const saved = state(d, () => ({saved: false}));
      const action = button(saved.saved ? '已留在本页' : '收藏本页示例', () => {saved.saved = !saved.saved; action.setAttribute('aria-pressed', saved.saved); action.textContent = saved.saved ? '已留在本页' : '收藏本页示例'; H.toast('仅更新当前页收藏状态');}, 'pin', {class: 'btn-primary', 'aria-pressed': saved.saved});
      body.append(el('article', 'page', [el('div', 'hero', [el('span', 'sticker', demoText("cards-b.show.6")), h('h2', {}, '今天，先看值得你判断的事。'),
        note('资料 → 人选题与立场 → 发布包。所有数字均为演示；公开发布需另行批准。'), action]),
        el('div', 'grid', ['进行中 · 2', '待看 · 3', '待办 · 1'].map(t => el('div', 'tile', t))),
        h('h3', {}, '这一期的交接'), note(demoText("cards-b.show.7")),
        el('details', 'details', [el('summary', 'summary', '查看来源口径'), note(demoText("cards-b.show.8")), note('这里只复用历史流程，未读取当前任务或真实平台状态。')])]));
    });
    return el('div', 'body', [el('div', 'preview', [tag('review-demo.html'), h('h4', {}, demoText("cards-b.sample.9")), note('一页看见选题、待审稿和四平台状态。'),
      row([button('试选一个选题', () => {status.replaceChildren(...keepUnits('已选择「本地模型的工作边界」· 仅演示'));}, 'check'), button('全屏打开', show, 'link', {class: 'btn-primary'})])]),
      status, el('div', 'filebar', [localIcon('file'), el('span', 'grow', d.file || 'review-demo.html · 单文件示例'), button('打开页面', show, 'file')])]);
  });

  
  function demoBuffer(context) {
    const rate = 8000, seconds = 12, count = rate * seconds;
    const buffer = context.createBuffer(1, count, rate), samples = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) {
      const t = i / rate, phase = t % 1.5;
      const envelope = phase < .28 ? Math.sin(Math.PI * phase / .28) : 0;
      samples[i] = .055 * envelope * Math.sin(2 * Math.PI * (220 + 55 * (Math.floor(t / 1.5) % 3)) * t);
    }
    return buffer;
  }
  register('voice', '语音消息', d => {
    const s = state(d, () => ({time: 0, speed: 1}));
    const body = el('div', 'body');
    let context = null, buffer = null, source = null, timer = null, playing = false, pending = false, started = 0, offset = 0;
    const time = el('span', 'muted', demoText("cards-b.time.10"));
    const wave = el('div', 'wave', null, {'aria-hidden': true});
    const bars = Array.from({length: 44}, (_, i) => el('span', 'wavebar', null, {style: {height: (8 + ((i * 17 + i * i) % 29)) + 'px'}}));
    wave.append(...bars);
    const seek = el('input', 'range', null, {type: 'range', min: 0, max: 12, step: .1, value: s.time, 'aria-label': '语音播放进度（秒）', onInput: e => {s.time = Number(e.target.value); if (playing) {if (s.time >= 12) dispose(); else startSource();} paint();}});
    function paint() {seek.value = s.time; time.textContent = '00:' + String(Math.floor(s.time)).padStart(2, '0') + demoText("cards-b.sample.11"); bars.forEach((b, i) => {b.dataset.played = i / bars.length < s.time / 12;});}
    function sync() {if (playing && context) s.time = Math.min(12, offset + (context.currentTime - started) * s.speed);}
    function stopSource() {if (source) {source.onended = null; source.stop(); source.disconnect(); source = null;}}
    const resource = {root: body, dispose: () => dispose()};
    function dispose() {
      playing = false; pending = false; stopSource(); clearInterval(timer); timer = null;
      if (context) {context.close().catch(() => {}); context = null; buffer = null;}
      media.delete(resource); play.textContent = '播放';
    }
    function startSource() {
      stopSource(); source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = s.speed;
      source.connect(context.destination); offset = s.time; started = context.currentTime;
      source.onended = () => {s.time = 12; paint(); dispose();}; source.start(0, s.time);
    }
    const play = button('播放', async () => {
      if (pending) {H.toast('声音正在准备'); return;}
      if (playing) {sync(); dispose(); paint(); return;}
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error('Web Audio unavailable');
        pending = true; context = new Audio(); buffer = demoBuffer(context); media.add(resource);
        await context.resume();
        if (!body.isConnected || !context) {dispose(); return;}
        pending = false; playing = true;
        if (s.time >= 12) s.time = 0;
        startSource();
        play.textContent = '暂停';
        timer = setInterval(() => {if (!body.isConnected) {sync(); dispose(); return;} sync(); paint();}, 150);
      } catch (_) {dispose(); play.textContent = '播放'; H.toast('浏览器未允许音频播放；可展开文字稿');}
    }, 'play', {class: 'btn-primary'});
    const speed = button(s.speed + '×', () => {sync(); s.speed = s.speed === 1 ? 1.5 : s.speed === 1.5 ? 2 : 1; if (playing) startSource(); speed.textContent = s.speed + '×'; paint();}, null, {'aria-label': '切换语音倍速'});
    const transcript = el('details', 'details', [el('summary', 'summary', '展开文字稿'), el('p', 'prose', d.transcript || '今天先检查素材与来源，再把需要你判断的内容留成草稿。')]);
    body.append(row([play, speed, time]), wave, seek, note('本地提示音占位 · 不是真人语音，文字稿为独立示例'), transcript);
    paint();
    return body;
  });

  register('flow', '流程图', d => {
    const nodes = d.nodes || ['资讯池', '人选题', '发布包', '留回执'];
    const width = 280, height = nodes.length * 85;
    const graphic = svg('svg', {viewBox: '0 0 ' + width + ' ' + height, class: cls('flow'), role: 'img', 'aria-label': nodes.join(' → ')});
    const positions = nodes.map((_, i) => ({x: 10, y: 10 + i * 85}));
    positions.forEach((p, i) => {
      if (i === 0) return;
      const previous = positions[i - 1];
      graphic.append(svg('path', {d: `M${previous.x + 130} ${previous.y + 52} V${p.y}`, fill: 'none', stroke: 'var(--bot-strong)', 'stroke-width': 2}));
      graphic.append(svg('text', {x: p.x + 130, y: p.y - 1, 'text-anchor': 'middle'}, ['⌄']));
    });
    const readout = el('div', 'readout', '依次点击节点，查看每一步的边界。', {'aria-live': 'polite'});
    nodes.forEach((name, i) => {
      const p = positions[i];
      const node = svg('g', {class: cls('flow-node'), tabindex: 0, role: 'button', 'aria-label': name}, [
        svg('rect', {x: p.x, y: p.y, width: 260, height: 52, rx: 14, fill: 'var(--bot-soft)', stroke: demoText("cards-b.stroke.12"), 'stroke-width': demoText("cards-b.sample.13")}),
        svg('text', {x: p.x + 130, y: p.y + 31, 'text-anchor': 'middle'}, [(i + 1) + ' · ' + name])]);
      const show = () => {readout.textContent = name + '：' + ((d.descriptions || [])[i] || '演示节点；需要相应证据才能进入下一步。');};
      node.addEventListener('click', show);
      node.addEventListener('keydown', e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); show();}});
      graphic.append(node);
    });
    return el('div', 'body', [graphic, readout]);
  });

  register('formula', '公式', () => el('div', 'body', [
    h('p', {}, ['行内：官网咨询率 ', el('span', demoText("cards-b.sample.14"), 'r = q / s × 100%'), '，分子、分母必须来自同一时间窗。']),
    el('div', 'formula', ['r = ', h('span', {}, '6 / 240'), ' × 100% = 2.5%'], {role: 'math', 'aria-label': '六次已确认咨询除以二百四十次官网会话乘百分之一百，等于百分之二点五'}),
    note(demoText("cards-b.sample.15"))
  ]));

  register('table', '可排序表格', d => {
    const cols = d.columns || ['平台', '候选数', '交接状态'];
    const rows = d.rows || demoFixture("cards-b.rows.16");
    const s = state(d, () => ({column: -1, direction: 1}));
    const host = el('div', 'body');
    function draw() {
      host.replaceChildren();
      const table = el('table', 'table', [h('caption', {class: cls('note')}, '点击列名排序 · 窄屏可横向滑动')]);
      const heading = h('tr');
      cols.forEach((col, index) => heading.append(el('th', 'th', button([col,' ',localIcon(s.column === index ? s.direction > 0 ? 'caret-up' : 'down' : 'funnel',{fill:s.column===index})], () => {
        s.direction = s.column === index ? -s.direction : 1; s.column = index; draw();
      }), {scope: 'col', 'aria-sort': s.column === index ? s.direction > 0 ? 'ascending' : 'descending' : 'none'})));
      table.append(h('thead', {}, heading));
      const sorted = rows.slice();
      if (s.column >= 0) sorted.sort((a, b) => {
        const x = a[s.column], y = b[s.column];
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-Hans', {numeric: true})) * s.direction;
      });
      table.append(h('tbody', {}, sorted.map(r => h('tr', {}, r.map(value => el('td', 'cell', String(value)))))));
      host.append(el('div', 'scroll', table, {tabIndex: 0, role: 'region', 'aria-label': '可横向滚动的表格'}));
    }
    draw(); return host;
  });

  register('checklist', '清单', d => {
    const items = d.items || ['核对内容指纹', '逐图检查最终预览', '回读实际配文', '保存逐平台回执'];
    const s = state(d, () => ({checked: items.map((_, i) => i === 0)}));
    const body = el('div', 'body'), status = el('p', 'note', null, {'aria-live': 'polite'});
    const fill = el('div', 'meterfill'), meter = el('div', 'meter', fill, {role: 'progressbar', 'aria-label': '清单完成度', 'aria-valuemin': 0, 'aria-valuemax': items.length});
    const labels = [];
    function paint() {const done = s.checked.filter(Boolean).length; status.replaceChildren(...keepUnits(done + ' / ' + items.length + ' 已勾选 · 不代表真实验收或发布授权')); fill.style.width = (items.length ? done / items.length * 100 : 0) + '%'; meter.setAttribute('aria-valuenow', done); labels.forEach((n, i) => {n.dataset.done = s.checked[i];});}
    body.append(status, meter);
    items.forEach((text, i) => {
      const input = h('input', {type: 'checkbox', checked: s.checked[i], onChange: e => {s.checked[i] = e.target.checked; paint();}});
      const label = el('label', 'check', [input, el('span', 'grow', text)]); labels.push(label); body.append(label);
    });
    body.append(button('重置清单', () => {s.checked.fill(false); labels.forEach(n => {n.querySelector('input').checked = false;}); paint(); H.toast('本页清单已重置为全部未勾选；未修改真实任务。');}, 'retry'));
    paint(); return body;
  });

  register('chart', '图表', d => {
    const values = d.values || [120, 175, 148, 210, 240];
    const labels = d.labels || ['周一', '周二', '周三', '周四', '周五'];
    const s = state(d, () => ({mode: d.mode || 'bar'}));
    const host = el('div', 'body'), plot = el('div', 'plot');
    const readout = el('div', 'readout', '悬停、点按或用 Tab 聚焦图形，查看读数。', {'aria-live': 'polite'});
    const tools = el('div', 'chart-modes', [], {class: 'segmented', role: 'group', 'aria-label': '图表样式'}), buttons = [];
    const selected = i => {readout.replaceChildren(...keepUnits(labels[i] + ' · ' + values[i] + ' ' + (d.unit || '次官网会话') + (s.mode === 'donut' ? ' · 占比 ' + (values[i] / (values.reduce((a, b) => a + b, 0) || 1) * 100).toFixed(1) + '%' : '')));};
    function hit(mark, i) {
      const node = svg('g', {class:cls('chart-hit'), tabindex:0, role:'button', 'aria-pressed':'false', 'aria-label':labels[i] + '：' + values[i]});
      if (s.mode === 'donut') {
        node.append(svg('circle', {cx:160, cy:115, r:72, fill:'none', stroke:'var(--elev)', 'stroke-opacity':0, 'stroke-width':96,
          pathLength:100, 'stroke-dasharray':mark.getAttribute('stroke-dasharray'), 'stroke-dashoffset':mark.getAttribute('stroke-dashoffset'), transform:'rotate(-90 160 115)', 'pointer-events':'stroke'}));
      } else {
        const x = Number(mark.getAttribute('cx') || Number(mark.getAttribute('x')) + 20), y = Number(mark.getAttribute('cy') || mark.getAttribute('y'));
        node.append(svg('rect', {x:x-48, y:Math.max(0,Math.min(144,y-48)), width:96, height:96, fill:'var(--elev)', 'fill-opacity':0, 'pointer-events':'all'}));
      }
      node.append(mark, svg('title', {}, [labels[i] + '：' + values[i]]));
      const choose = () => {
        selected(i);
        plot.querySelectorAll('[aria-pressed]').forEach(target => target.setAttribute('aria-pressed', target === node));
        H.toast('图表读数 · ' + readout.textContent + '（演示数据）');
      };
      ['mouseenter', 'focus'].forEach(event => node.addEventListener(event, () => selected(i)));
      node.addEventListener('click', choose);
      node.addEventListener('keydown', e => {if (e.key === ' ' || e.key === 'Enter') {e.preventDefault(); choose();}});
      return node;
    }
    function draw() {
      plot.replaceChildren(); readout.textContent = '悬停、点按或用 Tab 聚焦图形，查看读数。';
      buttons.forEach(([b, mode]) => {b.setAttribute('aria-pressed', s.mode === mode); b.classList.toggle('on', s.mode === mode);});
      const chart = svg('svg', {viewBox: '0 0 520 240', class: cls('chart'), role: 'group', 'aria-label': (d.title || '官网会话') + ' · ' + s.mode});
      const max = Math.max(1, ...values), sum = values.reduce((a, b) => a + b, 0) || 1;
      if (s.mode === 'donut') {
        let start = 0;
        const colors = ['--bot', '--sky', '--lemon', '--mint', '--pink'];
        values.forEach((v, i) => {
          const length = v / sum * 100;
          const ring = svg('circle', {cx: 160, cy: 115, r: 72, fill: 'none', stroke: 'var(' + colors[i % colors.length] + ')', 'stroke-width': 28, pathLength: 100, 'stroke-dasharray': length + ' ' + (100 - length), 'stroke-dashoffset': -start, transform: 'rotate(-90 160 115)'});
          chart.append(hit(ring, i), svg('text', {x: 284, y: 47 + i * 31}, [labels[i] + ' · ' + v])); start += length;
        });
        chart.append(svg('text', {x: 160, y: 118, 'text-anchor': 'middle'}, [String(sum)]));
      } else {
        [0, .5, 1].forEach(f => {const y = 195 - f * 160; chart.append(svg(demoText("cards-b.sample.17"), {x1: 45, x2: 500, y1: y, y2: y, stroke: 'var(--sep)'}), svg('text', {x: 4, y: y + 4}, [String(Math.round(max * f))]));});
        const points = values.map((v, i) => ({x: 85 + i * (380 / Math.max(1, values.length - 1)), y: 195 - v / max * 160}));
        if (s.mode === demoText("cards-b.sample.18")) chart.append(svg(demoText("cards-b.sample.19"), {points: points.map(p => p.x + ',' + p.y).join(' '), stroke: 'var(--bot-strong)', 'stroke-width': 3, fill: 'none'}));
        points.forEach((p, i) => {
          const mark = s.mode === 'bar' ? svg('rect', {x: p.x - 20, y: p.y, width: 40, height: Math.max(2, 195 - p.y), rx: 7, fill: 'var(--bot-strong)'}) : svg('circle', {cx: p.x, cy: p.y, r: 11, fill: 'var(--bot-strong)', stroke: 'var(--elev)', 'stroke-width': 3});
          chart.append(hit(mark, i), svg('text', {x: p.x, y: 225, 'text-anchor': 'middle'}, [labels[i]]));
        });
      }
      plot.append(chart);
    }
    demoFixture("cards-b.sample.20").forEach(([label, mode]) => {const b = button(label, () => {s.mode = mode; draw();}, null, {'aria-pressed': s.mode === mode}); buttons.push([b, mode]); tools.append(b);});
    host.append(tools, plot, readout,
      el('details', 'details', [el('summary', 'summary', '查看数据 · 触屏读数'), row(labels.map((label, i) => button(label + ' · ' + values[i], () => selected(i))))]),
      note(d.note || '统计窗口：演示周一至周五；官网会话不等于咨询或成交。'));
    draw(); return host;
  });

  register('compare', '方案对比', d => {
    const options = d.options || demoFixture("cards-b.options.21");
    const s = state(d, () => ({selected: -1}));
    const status = note('仅选择本页候选，不发起模型调用。');
    const host = el('div', 'compare'), tiles = [];
    options.forEach((o, i) => {
      const tile = el('section', 'option', [h('h4', {}, o.name), note('适合 · ' + o.good), note('留意 · ' + o.weak),
        button('选作候选', () => {s.selected = i; tiles.forEach((t, j) => {t.dataset.selected = j === i; t.querySelector('button').setAttribute('aria-pressed', j === i);}); status.replaceChildren(...keepUnits('本页候选：' + o.name + demoText("cards-b.tile.22")));}, 'check', {'aria-pressed': s.selected === i, class: 'btn-primary'})], {dataset: {selected: s.selected === i}});
      tiles.push(tile); host.append(tile);
    });
    if (s.selected >= 0) status.replaceChildren(...keepUnits('本页候选：' + options[s.selected].name + demoText("cards-b.sample.23")));
    return el('div', 'body', [host, status]);
  });

  register(demoText("cards-b.sample.24"), '时间线', d => {
    const events = d.events || demoFixture("cards-b.events.25");
    return el('ol', demoText("cards-b.sample.26"), events.map(e => el('li', 'event', [el('time', 'time', e.time), el('div', 'grow', [h('strong', {}, e.title), note(e.text), button('看证据', () => detail(e.title, [tag('演示证据'), note(e.text), note('没有真实平台回执，不能据此认定已发布。')]), 'file')])])));
  });

  register('progress', '多步骤进度', d => {
    const steps = d.steps || ['计划', '本地实现', '核验', '待验收'];
    const s = state(d, () => ({current: 1})), host = el('div', 'body');
    function draw() {
      const pct = Math.round(s.current / Math.max(1, steps.length - 1) * 100);
      host.replaceChildren(note('当前：' + steps[s.current] + ' · ' + (s.current + 1) + '/' + steps.length),
        el('div', 'meter', el('div', 'meterfill', null, {style: {width: pct + '%'}}), {role: 'progressbar', 'aria-label': '演示阶段', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct}),
        el('div', 'steps', steps.map((t, i) => button([i < s.current ? localIcon('check',{fill:true}) : null,t], () => detail('阶段 · ' + t, [note(i < s.current ? '本页演示已走过此阶段。' : i === s.current ? '本页演示正在此阶段。' : '本页演示尚未开始此阶段。'), note('阶段进度与用户验收、远端送达分别记录。')]), null, {'aria-current': i === s.current ? 'step' : null}))),
        row([button('上一步', () => {if (s.current === 0) H.toast('已在第一步'); else {s.current--; draw();}}, 'back'),
          button(s.current === steps.length - 1 ? '查看待验收项' : '模拟下一步', () => {if (s.current < steps.length - 1) {s.current++; draw();} else detail('等待验收', [note(demoText("cards-b.sample.27"))]);}, 'chevron', {class: 'btn-primary'})]));
    }
    draw(); return host;
  });

  function codeblock(code, diff) {
    const lines = String(code || '').split('\n');
    return el('div', 'scroll', el('pre', 'code', lines.map((line, i) => el('span', demoText("cards-b.sample.28") + (diff ? line.startsWith('+') ? ' ' + cls('added') : line.startsWith('-') ? ' ' + cls('removed') : '' : ''), [
      el('span', demoText("cards-b.sample.29"), String(i + 1), {'aria-hidden': true}), el('code', 'codecontent', line || ' ')
    ]))), {tabIndex: 0, role: 'region', 'aria-label': diff ? '代码差异，可横向滚动' : '代码，可横向滚动'});
  }
  register('code', '代码块', d => {
    const code = d.code || "const receipt = { status: 'draft', evidence: [] };\n// 本地成功不等于已送达\nconst delivered = ['pushed', 'up_to_date'].includes(receipt.status);\nconsole.log({ delivered });";
    return el('div', 'body', [row([tag(d.language || 'JavaScript'), el('span', 'grow', d.file || 'demo/receipt.js'), button('复制代码', () => copy(code), 'copy')]), codeblock(code)]);
  });
  register('diff', '差异', d => {
    const code = d.diff || "  function displayReceipt(receipt) {\n-   return receipt.exitCode === 0 ? '已送达' : '失败';\n+   return ['pushed', 'up_to_date'].includes(receipt.status)\n+     ? '已送达' : '待同步 / 失败';\n  }";
    return el('div', 'body', [row([tag('+ 2 / − 1'), button('复制 diff', () => copy(code), 'copy')]),
      el('details', 'details', [el('summary', 'summary', '展开差异 · ' + (d.file || 'demo/receipt.js')), note('− 删除行 / + 新增行，颜色同时配合前缀识别'), codeblock(code, true)])]);
  });
  register('terminal', '终端输出', d => {
    const initial = d.output || '$ node --check modules/cards-b.js\n[演示] syntax: passed\n[演示] remote receipt: not checked\n本地检查与远端送达分开记录。';
    const s = state(d, () => ({output: initial})), output = codeblock(s.output);
    return el('div', 'body', [row([tag(demoText("cards-b.sample.30")), button('复制输出', () => copy(s.output), 'copy'),
      button('模拟重跑', () => {s.output = initial + '\n[演示] replay completed · 未执行 shell'; output.replaceChildren(codeblock(s.output)); H.toast('已重放假日志，未运行命令');}, 'retry')]), output]);
  });
  register('tree', '文件树', d => {
    const files = d.files || demoFixture("cards-b.files.31");
    function branch(nodes) {return el('div', 'tree', nodes.map(n => n.children ? el('details', 'details', [el('summary', 'summary', [localIcon('folder'), ' ' + n.name]), branch(n.children)], {open: true}) :
      el('button', 'file', [localIcon('file'), n.name], {type: 'button', onClick: () => detail(n.name, [tag('虚拟文件 · 未读本机文件'), el('p', 'prose', n.content || '此文件为演示占位。'), button('复制内容', () => copy(n.content || ''), 'copy')])})));}
    return branch(files);
  });

  function gallery(d, initial) {
    const images = d.images || demoFixture("cards-b.images.32");
    let index = initial;
    fullscreen('图片浏览 · SVG 占位', body => {
      const host = el('div', 'gallerylarge');
      function draw() {
        host.replaceChildren(picture(index, images[index]), note((index + 1) + ' / ' + images.length + ' · ' + images[index]),
          row([button('上一张', () => {index = (index + images.length - 1) % images.length; draw();}, 'back'), button('下一张', () => {index = (index + 1) % images.length; draw();}, 'chevron')]),
          note(demoText("cards-b.sample.33")));
      }
      body.append(host); draw();
    });
  }
  register('images', '图片组', d => {
    const images = d.images || demoFixture("cards-b.images.34");
    return el('div', 'body', [el('div', 'gallery', images.map((name, i) => el('button', 'thumb', [picture(i, name), h('span', {}, name)], {type: 'button', onClick: () => gallery(d, i), 'aria-label': '放大查看：' + name}))),
      note('SVG 占位插画 · 点开可逐张浏览，不代表可发布素材。')]);
  });

  register('video', '视频与分镜', d => {
    const shots = d.shots || ['建立空间', '人物动作', '情绪落点'];
    const duration = 15, s = state(d, () => ({time: 0}));
    const host = el('div', 'body'), cover = el('div', 'video'), frame = el('div', 'videoframe', null, {style: {height: '100%'}});
    let timer = null, playing = false, shown = -1;
    const seek = el('input', 'range', null, {type: 'range', min: 0, max: duration, step: .1, value: s.time, 'aria-label': '分镜模拟播放头（秒）', onInput: e => {s.time = Number(e.target.value); paint();}});
    const readout = note(''), strip = el('div', 'filmstrip'), shotButtons = [];
    const resource = {root: host, dispose: () => stop()};
    function stop() {playing = false; clearInterval(timer); timer = null; media.delete(resource); play.textContent = '播放分镜模拟';}
    function paint() {const index = Math.min(shots.length - 1, Math.floor(s.time / (duration / shots.length))); if (index !== shown) {frame.replaceChildren(picture(index, shots[index])); shown = index;} seek.value = s.time; readout.replaceChildren(...keepUnits(s.time.toFixed(1) + ' 秒 / 15.0 秒 · ' + shots[index])); shotButtons.forEach((b, i) => b.setAttribute('aria-pressed', i === index));}
    const play = button('播放分镜模拟', () => {
      if (playing) {stop(); return;}
      if (s.time >= duration) s.time = 0;
      playing = true; play.textContent = '暂停模拟';
      media.add(resource);
      let previous = Date.now();
      timer = setInterval(() => {if (!host.isConnected) {stop(); return;} const now = Date.now(); s.time = Math.min(duration, s.time + (now - previous) / 1000); previous = now; paint(); if (s.time >= duration) stop();}, 120);
    }, 'play', {class: 'btn-primary'});
    cover.append(frame, el('div', 'videoctrl', play));
    shots.forEach((name, i) => {const b = el('button', 'shot', [picture(i, name), h('span', {}, String(Math.round(i * duration / shots.length)).padStart(2, '0') + 's · ' + name)], {type: 'button', 'aria-pressed': false, onClick: () => {s.time = i * duration / shots.length; paint(); H.toast('分镜已定位 · ' + name + ' · ' + s.time.toFixed(1) + ' 秒（本页模拟）');}}); shotButtons.push(b); strip.append(b);});
    host.append(cover, readout, seek, strip, note('15 秒分镜占位 · 模拟播放头，不含真实视频或生成任务。'));
    paint(); return host;
  });

  register('prompt', '提示词', d => {
    const text = d.text || demoText("cards-b.text.35");
    const tools = d.tools || demoFixture("cards-b.tools.36");
    const select = el('select', 'select', tools.map(t => h('option', {value: t}, t)), {'aria-label': '选择提示词草稿目标'});
    return el('div', 'body', [row([tag(d.kind || '图片 / 视频草稿'), tag(demoText("cards-b.sample.37"))]),
      el('details', 'details', [el('summary', 'summary', '查看完整提示词'), el('p', 'prose', text)], {open: true}),
      select, row([button('复制提示词', () => copy(text), 'copy'), button('送到工具草稿', () => detail('工具草稿 · ' + select.value, [tag('本页草稿 · 未提交'), note('已放入本页工具草稿，不调用模型，不消耗生成额度。'), el('p', 'prose', text), button('复制交接内容', () => copy(select.value + '\n' + text), 'copy')]), 'tools', {class: 'btn-primary'})])]);
  });

  const sourceDefaults = demoFixture("cards-b.sourceDefaults.38");
  function showSource(source, index) {detail('[' + (index + 1) + '] ' + source.title, [tag('历史摘录 · 当前正本未核验'), el('code', 'path', source.path), note('原资料日期：' + source.date), el('p', 'prose', source.text), note('用户确认状态与当前事实核验分开记录：确认范围待核；本页仅复用历史流程。'), note('来自：' + (source.project || source.title)), button('复制来源路径', () => copy(source.path), 'copy')]);}
  register('sources', '引用来源', d => {
    const sources = d.sources || sourceDefaults;
    const paragraph = h('p', {}, ['发布包要有逐平台回执 ', button('[1]', () => showSource(sources[0], 0), null, {'aria-label': '查看来源 1'}), '，选题状态与发布状态分开记录 ',
      sources[1] ? button('[2]', () => showSource(sources[1], 1), null, {'aria-label': '查看来源 2'}) : null, '。']);
    return el('div', 'body', [paragraph, ...sources.map((s, i) => el('div', 'citation', [button('[' + (i + 1) + '] ' + s.title, () => showSource(s, i), 'file'), el('code', 'path', s.path), note('资料日期 ' + s.date + ' · 来自：' + (s.project || s.title))]))]);
  });
  register('article', '长文', d => el('div', 'body', [
    el('p', 'prose', d.summary || '这一期先回答一个问题：哪些模型能力已经被验证，哪些只是候选？'),
    el('details', 'details', [el('summary', 'summary', '展开全文 · 约 1 分钟'), el('p', 'prose', d.text || '演示正文\n\n1. 从具体任务出发\n文字整理、源码改动与视觉判断分别选择执行路径，保留版本与观察日期。\n\n2. 把证据写到结论旁边\n命令退出成功只能说明进程走完；产物正确、真实使用和业务结果要另外核验。\n\n3. 先形成可审查的发布包\n资讯池经过人的选题与立场判断，再整理成片和文案。公开提交前逐平台确认；结果未知先回查。\n\n这份文字是样张，不是实时研究结论。')])
  ]));
  register('link', '链接预览', d => {
    const url = 'https://example.com/ai-brief/demo';
    return el('div', 'preview', [tag('example.com · 占位链接'), h('h4', {}, d.heading || demoText("cards-b.sample.39")), note('摘要、来源日期和交接范围集中在一页。'),
      el('code', 'path', url), button('打开本地预览', () => detail('链接预览 · 离线', [tag('未访问外网'), h('h3', {}, d.heading || demoText("cards-b.sample.40")), note('这是占位链接的本地预览；当前页面不联网。'), button('复制示例链接', () => copy(url), 'copy')]), 'link')]);
  });
  register('knowledge', '知识库条目', d => {
    const path = d.path || demoText("cards-b.path.41");
    return el('div', 'body', [row([tag('确认状态待核'), tag('历史资料 · 未刷新')]), el('code', 'path', path),
      note(demoText("cards-b.sample.42")),
      row([button('打开摘录', () => detail('知识条目 · 来源与确认', [tag('仅本地摘录'), el('code', 'path', path), note('来源：历史知识库摘录；所载原资料日期：2026-10-15。'),
        el('p', 'prose', demoText("cards-b.sample.43")), note('当前正本与核验日期：未读取；本页展示不构成知识库写入。')]), 'memory'), button('复制路径', () => copy(path), 'copy')])]);
  });
  register('alert', '错误与告警', d => {
    const s = state(d, () => ({checked: false})), status = note('');
    function paint() {status.textContent = s.checked ? '已模拟只读回查：仍未知，保持暂停提交。' : '结果未知，先回查；不提供重复提交。';}
    const body = el('div', 'body', [el('div', 'alert', [h('strong', {}, d.message || '提交结果未知 · 等待回查'), note(d.detail || '演示：下载端未拿到成片，只有任务标识。任务标识不能证明作品完成。')]), status,
      row([button('模拟只读回查', () => {s.checked = true; paint(); H.toast('本页回查演示完成，未访问服务');}, 'search'), button('查看处理办法', () => detail('未知结果如何处理', [list(['保留已有标识与提交时间。', '先查看服务端任务状态与产物。', '未核实前暂停重复提交。', '下载、验片与用户验收分别留证据。']), note('这里只演示处理流程。')]), 'shield')])]);
    paint(); return body;
  });
  register('metrics', '数字指标', d => {
    const values = d.metrics || demoFixture("cards-b.values.44");
    return el('div', 'body', [el('div', 'grid', values.map(m => el('div', 'tile', [el('span', 'muted', m.label), el('strong', 'big', m.value), button('口径', () => detail(m.label + ' · 口径', [note(m.detail), tag('演示数据 · 非实时')]), null, {'aria-label': m.label + '的指标口径'})]))), note(demoText("cards-b.sample.45"))]);
  });

  function part(type, data) {return {type: 'cards-b-' + type, data: data || {}};}
  // Round 7: all actions below are local demonstrations, never desktop control.
  const demoLabel = '本页演示，未真实执行';
  const liveRules = ['只出草稿', '发送前先问', '控制节奏', '遇验证码即停', '主账号不碰'];
  function postDemo(conversation, bot, parts) {
    return H.postMessage(conversation, {from: bot, time: '演示', parts: [{type: 'text', md: demoLabel}, ...parts]});
  }
  function childOf(parent, preferred) {
    const children = H.subBots(parent);
    return preferred ? children.find(b => b.id === preferred) : children[0];
  }
  const liveSteps = ['核对演示会话与授权', '打开演示客户端', '读取待审草稿', '遇到验证码', '预览草稿（不发送）'];
  register('live-op', '操作直播', (d, ctx) => {
    const steps = Array.isArray(d.steps) && d.steps.length ? d.steps.map(x => typeof x === 'string' ? x : String(x.label || x.title || '演示步骤')) : liveSteps;
    const initial = Number.isInteger(d.step) ? Math.max(0, Math.min(steps.length - 1, d.step)) : Math.max(0, steps.indexOf(d.step));
    const phases = ['idle', 'watching', 'asking', 'acting', 'background', 'refused'];
    const permission = d.permission === 'L0' ? 'L0' : 'L3';
    const tier = ['green', 'yellow', 'red'].includes(d.tier) ? d.tier : 'yellow';
    const tierLabel = {green:'绿 · 只看', yellow:'黄 · 每次先问', red:'红 · 每步批准'}[tier];
    const s = state(d, () => ({index: initial, mode: ['running','paused','takeover','done'].includes(d.state) ? d.state : 'paused',
      // Incoming acting cannot grant a step: every action needs a local approval click.
      phase: d.phase === 'acting' ? 'asking' : phases.includes(d.phase) ? d.phase : 'idle',
      started: initial > 0 || ['running','takeover','done'].includes(d.state) || (phases.includes(d.phase) && d.phase !== 'idle'), posted: false, live: null,
      background: d.background && d.background.summary || '尚未交给后台'}));
    if (s.live) s.live.dispose();
    const conversation = ctx.conversation, bot = d.bot || ctx.bot.id, app = d.app || d.foregroundApp || '演示客户端';
    const canAct = permission === 'L3' && tier !== 'green';
    const status = el('p', 'readout', '', {role:'status', 'aria-live':'polite'});
    const background = note(''), screenText = el('strong', 'window-label');
    const screen = el('div', 'screen', [
      el('div', 'window-bar', [el('span', 'window-dot'), el('span', 'window-dot'), el('span', 'window-dot'), el('span', 'grow', app + ' · 离线演示窗口')]),
      el('div', 'window-content', [el('span', demoText("cards-b.screen.46")), el('span', demoText("cards-b.screen.47")), screenText, el('span', 'window-cursor', null, {'aria-hidden':'true'})])
    ], {role:'img', 'aria-label': d.screenLabel || '纯 CSS 屏幕缩略占位，没有读取真实屏幕'});
    const stepList = el('ol', 'live-steps');
    const start = button('开始演示', () => observe(true), 'play', {class:'btn-primary', 'data-cards-b-live':'start'});
    const look = button('看一眼', () => observe(false), 'search', {'data-screen-action':'look'});
    const allow = button('允许这一步', () => {
      if (s.phase !== 'asking' || !canAct || terminal()) return;
      if (blocked()) {requestTakeover('遇到验证码或异常，自动停下。'); return;}
      s.mode = 'running'; phase('acting'); paint(); schedule('action');
    }, 'check', {class:'btn-primary', 'data-screen-action':'allow'});
    const stop = button('停', () => {
      if (terminal()) return;
      cancel(); s.mode = 'paused'; s.background = '已停止本页后台与前台演示，尚未真实执行'; phase('idle'); paint();
    }, 'stop', {'data-screen-action':'stop', 'data-cards-b-live':'pause'});
    const back = button('交给后台', () => {
      if (terminal()) return;
      cancel(); s.mode = 'paused'; s.background = '后台只整理演示摘要，不执行键鼠，不代批下一步'; phase('background'); paint();
    }, 'jobs', {'data-screen-action':'background'});
    const take = button('我来接手', () => requestTakeover('你选择接手；演示操作已暂停。'), 'shield', {'data-screen-action':'takeover', 'data-cards-b-live':'takeover'});
    const root = el('div', 'body', [tag(demoLabel),
      note(d.task || '在演示会话里检查待发草稿'), tag('应用 · ' + app),
      row([tag('应用档位 · ' + tierLabel), showLevel()
        ? H.levelSticker(permission, {action:'屏幕操作演示', scope:app, bot}) : null]),
      el('p', 'tier-note', '档位看这个应用 · L 级看这一步动作'),
      note('只批准当前一步，不会自动批准后续步骤。'), screen, status, stepList,
      row([start, look, allow, stop, back, take]), background,
      d.demoHandoff ? row([button('模拟分 bot 回报', () => {
        if (s.reported) {H.toast(demoText("cards-b.root.48")); return;}
        s.reported = true;
        const child = childOf(demoText("cards-b.child.49"), demoText("cards-b.child.50"));
        postDemo(conversation, demoText("cards-b.root.51"), [part('handoff-mini', {parent:demoText("cards-b.parent.52"), bot:child ? child.id : demoText("cards-b.bot.53"), direction:'report', task:demoText("cards-b.task.54"), summary:'草稿已整理，停在待审；没有发送。', status:'待审'})]);
      }, 'check')]) : null, el('p', 'rules', liveRules.flatMap((text, i) => [
        el('span', 'unit', text + (i < liveRules.length - 1 ? ' ·' : '')), i < liveRules.length - 1 ? ' ' : ''
      ]))]);
    let timer = null, disposed = false;
    const entry = {root, dispose() {
      disposed = true; cancel(); media.delete(entry);
      if (s.live === entry) {s.live = null; if (['acting','watching'].includes(s.phase)) {s.mode = 'paused'; phase('idle');}}
    }};
    s.live = entry; media.add(entry);
    function cancel() {if (timer !== null) clearTimeout(timer); timer = null;}
    function terminal() {return s.mode === 'takeover' || s.mode === 'done' || s.phase === 'refused';}
    function blocked() {return /验证码|异常/.test(steps[s.index]);}
    function phase(next) {
      if (s.phase === next) return;
      s.phase = next;
      H.emit('screen:phase', {phase:next, permission, bot});
    }
    function observe(fromStart) {
      if (terminal() || s.phase === 'acting') return;
      cancel(); s.started = true; s.mode = 'paused'; phase('watching'); paint();
      if (blocked()) {requestTakeover('看见验证码或异常，自动停止；不会绕过。'); return;}
      if (fromStart || canAct) schedule('observe');
    }
    function paint() {
      const names = {idle:s.started ? '已停止' : '尚未开始', watching:'只看演示窗口', asking:'等待批准当前一步', acting:'当前一步正在演示', background:'已交后台 · 不代批', refused:'已拒绝'};
      status.replaceChildren(...keepUnits((s.mode === 'takeover' ? '已自动停下 / 等待接管' : s.mode === 'done' ? '演示结束 · 草稿未发送' : names[s.phase]) +
        ' · 当前步骤 ' + (s.index + 1) + '/' + steps.length + '：' + steps[s.index]));
      status.dataset.screenPhase = s.phase;
      screenText.replaceChildren(...keepUnits(s.mode === 'takeover' ? '验证码 / 接管占位 · 已停' : steps[s.index]));
      screen.dataset.state = s.mode;
      background.replaceChildren(...keepUnits('后台摘要 · ' + s.background));
      stepList.replaceChildren(...steps.map((text, i) => el('li', 'live-step', [el('span', 'step-mark', localIcon(i < s.index ? 'check' : i === s.index ? 'chevron' : 'check-circle',{fill:i<=s.index})), text], {'aria-current':i === s.index ? 'step' : null, dataset:{done:i < s.index}})));
      start.textContent = s.started ? '继续演示' : '开始演示';
      start.disabled = terminal() || ['acting','watching','asking'].includes(s.phase);
      look.disabled = terminal() || s.phase === 'acting';
      allow.disabled = terminal() || s.phase !== 'asking' || !canAct;
      stop.disabled = s.mode === 'done' || s.mode === 'takeover' || s.phase === 'idle' || s.phase === 'refused';
      take.disabled = terminal(); back.disabled = terminal() || s.phase === 'background';
    }
    function requestTakeover(reason) {
      cancel(); s.mode = 'takeover'; s.started = true; phase('idle'); paint();
      if (s.posted) return;
      s.posted = true;
      postDemo(conversation, bot, [{type:'cards-a-takeover', data:{id:'cards-b-takeover-' + (++serial), bot, app, tier,
        step:steps[s.index], reason, screenLabel:'演示客户端 · 验证码或接管占位，不含真实屏幕', state:'waiting'}}]);
    }
    function schedule(kind) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        if (disposed || !root.isConnected || H.state.conversation !== conversation) return;
        if (kind === 'observe' && s.phase === 'watching') {
          if (canAct) phase('asking');
          paint(); return;
        }
        if (kind !== 'action' || s.phase !== 'acting') return;
        if (blocked()) {requestTakeover('遇到验证码或异常，已自动停下；不会填写、绕过或继续发送。'); return;}
        if (s.index >= steps.length - 1) {s.mode = 'done'; phase('idle'); paint(); return;}
        s.index++; s.mode = 'paused';
        if (blocked()) {requestTakeover('遇到验证码，已自动停下；不会填写、绕过或继续发送。'); return;}
        phase('asking'); paint();
      }, kind === 'action' ? 1100 : 350);
    }
    paint();
    return root;
  });

  // Round 8: the sole owners of these three chat types; capabilities live elsewhere.
  const knownNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  function tokenText(value) {return knownNumber(value) ? (value / 1000).toLocaleString('zh-CN', {maximumFractionDigits:3}) + 'k token' : 'token 未知';}
  function msText(value) {return knownNumber(value) ? (value / 1000).toLocaleString('zh-CN', {maximumFractionDigits:2}) + ' 秒' : '耗时未知';}
  function estimateText(value) {
    if (typeof value === 'string' && value.trim()) return value;
    if (knownNumber(value)) return tokenText(value);
    if (value && typeof value === 'object') {
      return [tokenText(value.tokens), msText(value.ms), value.note || ''].filter(Boolean).join(' · ');
    }
    return '未知，尚无对照估算';
  }
  register('teacher-student', '老师—学生分工', d => {
    function lane(label, data) {
      const person = data || {}, steps = Array.isArray(person.steps) ? person.steps : [];
      const total = field => steps.length && steps.every(step => knownNumber(step[field])) ? steps.reduce((n, step) => n + step[field], 0) : null;
      return el('section', 'compare-column', [el('h4', 'compare-heading', label + ' · ' + (person.model || '模型待核')),
        row([tag(tokenText(total('tokens'))), tag(msText(total('ms')))]),
        steps.length ? el('ol', 'list', steps.map(step => h('li', {}, [h('strong', {}, step.name || '步骤待核'), note(tokenText(step.tokens) + ' · ' + msText(step.ms))]))) : note('没有步骤回执，不能据此判断执行。')]);
    }
    const handbacks = Array.isArray(d.handbacks) ? d.handbacks : [];
    return el('div', 'body', [tag(demoLabel), el('p', 'prose', d.task || '任务待补'),
      el('div', 'receipt-compare', [lane('云端老师 · 规划与复核', d.teacher), lane('本地学生 · 执行', d.student)]),
      el('div', 'readout', [h('strong', {}, '与「全用云端」对比 · 估算'), note('全云端基线：' + estimateText(d.baseline)),
        note('预计节省：' + estimateText(d.saved)), note('token 是各自消耗；本地 token 不等于云端计费，估算不代表实付费用。')]),
      el('h4', 'compare-heading', '失败时交回老师'), handbacks.length ? list(handbacks.map(item =>
        (item.step || '步骤待核') + '｜原因：' + (item.reason || '待核') + '｜老师处理：' + (item.result || '尚无结果'))) : note('无交回记录；不代表所有步骤已通过。')]);
  });

  H.registerCard('cards-b-background-report', {title:'后台回报', quoteLabel:d => '后台回报：' + ((d || {}).summary || '结果待核'), render(data) {
    const d = data || {}, source = (H.state.bots.find(bot => bot.id === d.sourceBot) || {}).name || '来源助理待核';
    const details = Array.isArray(d.detail) ? d.detail : [];
    return el('section', 'background-report', [row([el('strong', 'grow', '后台回报 · ' + source), tag(d.elapsed == null ? '耗时未知' : '耗时 · ' + d.elapsed)]),
      note(demoLabel), h('strong', {}, d.task || '后台任务'), el('p', 'prose', d.summary || '尚无摘要，结果待核'),
      el('details', 'details', [el('summary', 'summary', '展开回报详情'), details.length ? list(details.map(String)) : note('没有补充详情。'),
        d.conversation ? button('打开来源会话', () => H.navigate({view:'chat', conversation:d.conversation}), 'chat', {'data-background-action':'open'}) : null])], {class:'pop-card'});
  }});

  const voiceStates = {draft:'草稿 · 未开训', blocked:'缺授权 · 已阻止', 'needs-approval':'待批准开训', running:'流程演示中',
    'stop-requested':'已请求停止 · 尚未确认', stopped:'已确认停止', listen:'产物待试听验收', accepted:'试听验收通过（演示）', adopted:'已采用本页候选', failed:'任务失败 · 未采用'};
  const voiceSources = ['本人录音', '已授权音色', '开源许可明确'];
  const voiceStages = ['素材接入', '整理', '质检', '训练', '产物'];
  const voiceCandidates = new Map();
  register('voice-job', '音色任务', (d, ctx) => {
    const bot = d.botId || 'chief', voiceName = d.voiceName || '我自己的录音 · 候选音色';
    const licensed = voiceSources.includes(d.source) && typeof d.licenseNote === 'string' && !!d.licenseNote.trim();
    const s = state(d, () => {
      const mode = !licensed ? 'blocked' : Object.prototype.hasOwnProperty.call(voiceStates, d.state) ? d.state : 'draft';
      const ready = ['listen','accepted','adopted'].includes(mode);
      return {mode, stage:ready ? 4 : mode === 'running' ? 1 : 0, artifact:!!d.artifactReady,
        quality:!!d.qualityAccepted && ['accepted','adopted'].includes(mode), compatible:!!d.playbackCompatible,
        listened:false, job:d.jobId || '尚未开训', logs:[demoLabel + '；未连接训练或播放引擎']};
    });
    const status = el('p', 'readout', '', {role:'status', 'aria-live':'polite'}), flow = el('ol', 'live-steps');
    const gates = el('div', 'row'), logs = el('div', 'body'), receipt = el('div', 'body');
    const receiptBox = el('details', 'details', [el('summary', 'summary', '任务回执 · 卡内展开'), receipt]);
    const listenNote = note('尚未试听；本页不播放真实人声，也不把原音当作产物验收。');
    const action = (label, id, run, primary) => button(label, run, null, {class:primary ? 'btn-primary' : 'ghostbtn', 'data-voice-action':id});
    const plan = action('拟计划', 'plan', () => {
      if (!licensed || ['running','stop-requested','adopted'].includes(s.mode)) return;
      s.stage = 0; s.artifact = false; s.quality = false; s.compatible = false; s.listened = false;
      s.job = '尚未开训'; change('needs-approval', '计划：我自己的录音 → 整理切片 → 质检 → 训练 → 产物试听；等待单独批准。');
    });
    const approve = action('批准开训（演示）', 'approve', () => {
      if (!licensed || s.mode !== 'needs-approval') return;
      s.job = 'cards-b-voice-demo-' + (++serial); s.stage = 1;
      change('running', '已批准本页流程演示，进入整理；没有启动真实训练。');
    }, true);
    const refresh = action('刷新状态', 'refresh', () => {
      if (s.mode === 'stop-requested') {change('stopped', '已确认停止本页任务；没有真实进程。'); return;}
      if (s.mode !== 'running') {s.logs.push('只刷新本页状态，未读取真实日志。'); paint(); return;}
      s.stage = Math.min(4, s.stage + 1);
      if (s.stage === 4) {
        s.artifact = true; s.compatible = true; s.quality = false;
        change('listen', '演示产物就绪、演示播放适配通过；训练完成不等于听感验收。');
      } else {s.logs.push('进入' + voiceStages[s.stage] + '（演示）；没有写盘。'); paint();}
    });
    const stop = action('请求停止', 'stop', () => {if (s.mode === 'running') change('stop-requested', '已请求停止，需刷新状态确认；不提前宣称已停。');});
    const showReceipt = action('看回执', 'receipt', () => {
      receiptBox.open = !receiptBox.open;
      showReceipt.textContent = receiptBox.open ? '收起回执' : '看回执';
      if (receiptBox.open) {
        if (receiptBox.closest('.thread')) {
          H.reading && H.reading.locate(receiptBox, {block:'nearest', reason:'receipt'});
        } else {
          // 非聊天，豁免：面板内仍使用本地定位。
          receiptBox.scrollIntoView({block:'nearest', behavior:'instant'});
        }
      }
    });
    receiptBox.addEventListener('toggle', () => {showReceipt.textContent = receiptBox.open ? '收起回执' : '看回执';});
    const listen = action('试听（演示）', 'listen', () => {
      if (s.mode !== 'listen' || !s.artifact) return;
      s.listened = true; s.logs.push('已查看成品试听位置（演示），没有播放原音或真实成品。'); paint();
    });
    const accept = action('试听验收通过（演示）', 'accept', () => {
      if (!licensed || s.mode !== 'listen' || !s.listened || !s.artifact) return;
      s.quality = true; change('accepted', '已单独确认试听验收通过（演示）；仍需明确采用到 bot。');
    });
    const adopt = action('采用到这个 bot', 'adopt', () => {
      if (!canAdopt()) return;
      voiceCandidates.set(bot, voiceName); change('adopted', '仅将候选音色记到本页 bot，未更换真实播放引擎。');
      H.emit('voice:adopted', {bot, voiceName});
    }, true);
    function canAdopt() {return licensed && s.mode === 'accepted' && s.artifact && s.quality && s.compatible;}
    function change(mode, line) {s.mode = mode; s.logs.push(line); paint();}
    function paint() {
      status.replaceChildren(...keepUnits(voiceStates[s.mode] + ' · ' + demoLabel));
      status.dataset.voiceState = s.mode;
      flow.replaceChildren(...voiceStages.map((stage, i) => el('li', 'live-step', [el('span', 'step-mark', localIcon(i < s.stage ? 'check' : i === s.stage ? 'chevron' : 'check-circle',{fill:i<=s.stage})), stage], {'aria-current':i === s.stage ? 'step' : null})));
      gates.replaceChildren(tag('授权 · ' + (licensed ? '演示说明齐全' : '缺失 / 无效')), tag('产物 · ' + (s.artifact ? '演示就绪' : '未就绪')),
        tag('听感 · ' + (s.quality ? '演示验收通过' : '未验收')), tag('播放适配 · ' + (s.compatible ? '演示通过' : '未通过')));
      logs.replaceChildren(list(s.logs));
      receipt.replaceChildren(note('任务 · ' + (s.job === '尚未开训' ? '尚未开训' : '本页音色训练演示')), note('回执 · ' + (d.receiptLabel || '本页演示回执，未写盘')),
        note('状态 · ' + voiceStates[s.mode]), note('素材 · 我自己的录音'), note('候选采用 · ' + (voiceCandidates.get(bot) || '未采用')),
        note('任务成功、登记权重和原音试听均不能代替成品听感验收；未接通真实引擎。'));
      plan.disabled = !licensed || ['running','stop-requested','adopted'].includes(s.mode);
      approve.disabled = !licensed || s.mode !== 'needs-approval';
      stop.disabled = s.mode !== 'running'; refresh.disabled = s.mode === 'adopted';
      listen.disabled = s.mode !== 'listen' || !s.artifact;
      accept.disabled = !licensed || s.mode !== 'listen' || !s.listened || !s.artifact;
      adopt.disabled = !canAdopt();
      listenNote.textContent = s.listened ? '已查看成品试听占位；请另点「试听验收通过（演示）」。没有播放真实人声。' : '尚未试听；本页不播放真实人声，也不把原音当作产物验收。';
    }
    paint();
    return el('div', 'body', [tag(demoLabel), showLevel()
      ? H.levelSticker('L3', {action:'音色开训与采用演示', scope:'当前音色任务', bot:ctx.bot.id})
      : null,
      el('h4', 'compare-heading', voiceName), note('挂到 · ' + ((H.state.bots.find(item => item.id === bot) || {}).name || '助理待核')),
      note('素材 · 我自己的录音'), note('来源 · ' + (voiceSources.includes(d.source) ? d.source : '未声明有效来源')),
      note('授权说明 · ' + (d.licenseNote || '缺失；不能开训或采用')),
      note('播放引擎 · ' + (d.playEngine || '未接通')), note('训练引擎 · ' + (d.trainEngine || '未接入')),
      status, flow, gates, row([plan, approve, refresh, stop, showReceipt]), row([listen, accept, adopt]), listenNote,
      note('重新拟计划会清除本卡旧产物与验收；刷新页面复原。数值质检门槛不作为通用标准。'),
      el('details', 'details', [el('summary', 'summary', '展开流程日志'), logs]), receiptBox]);
  });

  function receiptText(receipt) {
    if (Array.isArray(receipt)) return receipt.map(String).join('\n');
    if (receipt && typeof receipt === 'object') return JSON.stringify(receipt, null, 2);
    return String(receipt == null ? '回执待补；不能据此判断完成。' : receipt);
  }
  const dispatchRounds = demoFixture("cards-b.dispatchRounds.55");
  register(demoText("cards-b.sample.56"), '派工时间线', (d, ctx) => {
    const rounds = Array.isArray(d.rounds) ? d.rounds : dispatchRounds;
    function compare(round, workers, leftIndex, rightIndex) {
      const left = workers[leftIndex], right = workers[rightIndex];
      const a = receiptText(left.receipt).split('\n'), b = receiptText(right.receipt).split('\n');
      const columns = [left, right].map((worker, col) => el('section', 'compare-column', [
        el('h4', 'compare-heading', worker.name + ' · ' + worker.model),
        ...Array.from({length: Math.max(a.length, b.length)}, (_, i) => {
          const different = a[i] !== b[i];
          return el('p', demoText("cards-b.columns.57"), [el('span', 'diff-mark', different ? '≠' : '='),
            el('span', 'grow', (col ? b[i] : a[i]) ?? '（此路无对应行）')], {dataset: {different}});
        })
      ]));
      detail('第 ' + round.round + ' 轮 · 两路回执对比', [tag(demoLabel), note('≠ 为差异行；并排逐行比较，不代表已核验哪一路正确。'), el('div', 'receipt-compare', columns)]);
    }
    return el('div', 'body', [tag(demoLabel), note('任务：' + (/[\u3400-\u9fff]/.test(d.taskId || '') ? d.taskId : '草稿交接演示')),
      ...rounds.map(round => {
        const workers = Array.isArray(round.workers) ? round.workers : [];
        const left = el('select', 'select', workers.map((w, i) => h('option', {value: String(i)}, w.name)), {'aria-label': '左路工人'});
        const right = el('select', 'select', workers.map((w, i) => h('option', {value: String(i)}, w.name)), {'aria-label': '右路工人'});
        left.value = '0'; right.value = workers.length > 1 ? '1' : '0';
        const compareButton = button('对比两路的结果', () => {
          const a = Number(left.value), b = Number(right.value);
          if (a === b) {H.toast('请选择同一轮中不同的两路'); return;}
          if (workers[a] && workers[b]) compare(round, workers, a, b);
        }, 'branch', {disabled: workers.length < 2});
        return el('section', 'dispatch-round', [el('h4', 'compare-heading', '第 ' + round.round + ' 轮'),
          ...workers.map(w => el('section', 'worker', [
            row([el('strong', 'grow', w.name || '演示工人'), tag(w.status || '待核')]),
            row([tag('模型 · ' + (w.model || '待核')), tag('耗时 · ' + (w.elapsed ?? '待计时')), tag(w.tokens == null ? 'token · 未知' : w.tokens + ' token')]),
            el('details', 'details', [el('summary', 'summary', '查看回执 · ' + (w.name || '演示工人')), el('p', 'prose', receiptText(w.receipt))])
          ])),
          workers.length > 1 ? el('div', 'compare-pickers', [left, right]) : note('本轮不足两路，待有同轮回执后再比较。'),
          compareButton
        ]);
      }), rounds.length ? null : note('尚未派工；没有可比较的回执。'),
      d.demoFollowups ? button('模拟交付体检与纪要', () => {
        const s = state(d, () => ({delivered: false}));
        if (s.delivered) {H.toast('本页演示回执已交付，请在下方查看'); return;}
        s.delivered = true;
        postDemo(ctx.conversation, ctx.bot.id, [part('checkup', demoFixture("cards-b.sample.58")),
          part('call-summary', {bot: ctx.bot.id, duration: 184, summary: '两路草稿需要复核；先核来源与预览，再由你决定是否发送。',
            decisions: ['仅整理草稿，未启动任何工人'], todos: ['核对两路差异', '核验备份恢复点']})]);
      }, 'file') : null]);
  });

  const checkupItems = demoFixture("cards-b.checkupItems.59");
  register('checkup', '设备体检', d => {
    const items = Array.isArray(d.items) ? d.items : checkupItems;
    const s = state(d, () => ({checked: 0}));
    const checks = el('ul', 'checkup-list'), progress = el('p', 'readout', '', {role: 'status', 'aria-live': 'polite'});
    function paint() {
      progress.replaceChildren(...keepUnits('已演示核对 ' + s.checked + '/' + items.length + ' 项 · 警告 ' + items.filter(x => x.status !== 'ok').length + ' 项'));
      checks.replaceChildren(...items.map((item, i) => {
        const done = i < s.checked, secret = /密钥|凭据|令牌/.test(item.label);
        const label = item.status === 'ok' ? '通过' : item.status === 'fail' ? '需处理' : '待核';
        return el('li', 'checkup-item', [
          el('span', 'step-mark', localIcon(done ? item.status === 'ok' ? 'check' : 'warning' : 'check-circle',{fill:done})),
          el('div', 'grow', [h('strong', {}, item.label), note(done ? secret ? item.status === 'ok' ? '在位' : '缺失' : item.detail || label : '待演示核对')]),
          tag(done ? label : '待检查')
        ], {dataset: {warning: done && item.status !== 'ok'}});
      }));
      next.disabled = s.checked >= items.length;
      next.textContent = s.checked >= items.length ? '逐项核对完成' : '核对下一项';
    }
    const next = button('核对下一项', () => {if (s.checked < items.length) s.checked++; paint();}, 'check', {class: 'btn-primary'});
    const exportButton = button('导出脱敏诊断包', () => detail(d.diagnosticLabel || '脱敏诊断包 · 内容预览', [
      tag(demoLabel), note('仅展示清单，不生成文件、不真正下载。'),
      h('h4', {}, '将包含'), list(['演示设备名称、检查时间与项目标签', '服务 / 端口 / 磁盘 / 备份 / 连通的状态和警告计数', '密钥仅记录在位 / 缺失；未知时先核实']),
      h('h4', {}, '将排除'), list(['密钥、令牌、Cookie、口令及其片段', '账号、邮箱、手机号、网络地址与机器标识', '聊天正文、截图、完整路径、原始日志与私有文件']),
      note('在真实导出前仍需重新核对脱敏范围。本页没有收集任何设备数据。')
    ]), 'file');
    paint();
    return el('div', 'body', [tag(demoLabel), h('strong', {}, d.device || demoText("cards-b.sample.60")), progress, checks, row([next, exportButton])]);
  });

  register('call-summary', '通话纪要', (d, ctx) => {
    const seconds = Number.isFinite(d.duration) ? Math.max(0, Math.round(d.duration)) : 184;
    const summary = d.summary || '确认先核草稿来源与最终预览，再由你决定是否发送。';
    const decisions = Array.isArray(d.decisions) ? d.decisions : ['仅整理草稿，发送前另行确认'];
    const todos = Array.isArray(d.todos) ? d.todos : ['核对来源日期', '检查最终预览'];
    const s = state(d, () => ({converted: false}));
    const convert = button(s.converted ? '已转成本页任务草稿' : '转成任务', () => {
      if (s.converted) return;
      s.converted = true; convert.disabled = true; convert.textContent = '已转成本页任务草稿';
      postDemo(ctx.conversation, d.bot || ctx.bot.id, [
        {type: 'text', md: '通话待办已整理为本页任务草稿，尚未派工：\n' + (todos.length ? todos.map(t => '· ' + t).join('\n') : '待你补充待办。')},
        part(demoText("cards-b.convert.61"), {title: '通话待办 · 待派工草稿', taskId: '通话待办（演示）', rounds: []})
      ]);
    }, 'task', {class: 'btn-primary', disabled: s.converted || todos.length === 0});
    return el('div', 'body', [tag(demoLabel), row([tag('时长 · ' + Math.floor(seconds / 60) + ' 分 ' + seconds % 60 + ' 秒'), tag('待办 · ' + todos.length + ' 项')]),
      h('h4', {}, '要点'), el('p', 'prose', summary), h('h4', {}, '决定'), list(decisions), h('h4', {}, '待办'), list(todos),
      convert, note('转成任务只追加本页任务草稿；不会启动工人，也不会修改看板。')]);
  });

  H.registerCard('cards-b-handoff-mini', {title: '分派 / 回报', quoteLabel: d => '演示交接：' + ((d || {}).summary || '草稿待审'), render(data) {
    const d = data || {}, parent = d.parent || demoText("cards-b.parent.62"), child = childOf(parent, d.bot);
    const parentName = (H.state.bots.find(b => b.id === parent) || {}).name || '主助理';
    const childName = child ? child.name : '分 bot（演示，未找到）';
    const reporting = d.direction === 'report';
    return el('section', 'handoff-mini', [
      el('div', demoText("cards-b.render.63"), [el('strong', 'grow', (reporting ? childName + ' → ' + parentName : parentName + ' → ' + childName) + '：' + (reporting ? '回报' : '分派')), tag(d.status || '演示')]),
      el('p', 'handoff-text', [...keepUnits((d.task ? d.task + ' · ' : '') + (d.summary || '仅整理待审草稿') + ' ·'), ' ', el('span', 'unit', '演示，未真实执行')])
    ], {class: 'pop-card', style: H.botStyle(child ? child.id : parent)});
  }});

  // These settings and receipts are fixtures, shared only within this page.
  const receiptPreference = {compact: false, revision: 0};
  const preferenceChanges = new Map();
  register('usage-alert', '用量提醒卡', d => {
    const percentage = Number.isFinite(d.percent) ? Math.max(0, Math.min(100, d.percent)) : 38;
    return el('div', 'body', [tag('演示用量 · 非账户读数'),
      h('strong', {}, keepUnits((d.window || '5 小时') + ' · ' + percentage + '%')),
      el('div', 'meter', el('div', 'meterfill', null, {style: {width: percentage + '%'}}), {
        role: 'progressbar', 'aria-label': '演示用量', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percentage
      }),
      note(percentage >= 80 ? '已达到演示提醒线 80%；先核实真实额度，再决定是否换模型。' : '尚未达到演示提醒线 80%。'),
      note('本页未查询订阅、余额或积分，也未切换模型。'),
      row([button('看 token 账本', () => H.navigate({view: 'ledger'}), 'usage'),
        button('恢复正常用量样例', () => H.postMessage(H.state.conversation, {from: H.state.bot, time: '刚刚', parts: [part('usage-alert', {title: '用量提醒 · 本页样例', percent: 38})]}), 'retry')])]);
  });
  register('capability-status', '能力状态卡', d => {
    const transaction = preferenceChanges.get(d.changeId), confirmation = note('');
    const undo = button('撤销本次修改', () => {
      if (!transaction || transaction.undone) return;
      if (receiptPreference.revision !== transaction.revision) {
        confirmation.textContent = '已有后续修改；请在对话里重新指定回执偏好。';
        undo.disabled = true;
        return;
      }
      receiptPreference.compact = transaction.before;
      receiptPreference.revision++;
      transaction.undone = true;
      paint();
      H.toast('已撤销本页回执偏好，刷新后复原');
    }, 'retry');
    const values = el('div', 'row');
    function paint() {
      values.replaceChildren(...[
        {label: '格式', value: receiptPreference.compact ? '精简版' : '完整版'},
        {label: '范围', value: '仅本页'}, {label: '持久化', value: '未写入'}
      ].map(item => tag(item.label + ' · ' + item.value)));
      confirmation.replaceChildren(...keepUnits(transaction ? transaction.undone ? '已撤销 · 当前偏好已恢复' : '已改好 · 仅修改本页回执偏好' : '当前偏好 · 尚未修改'));
      undo.disabled = !transaction || transaction.undone;
    }
    paint();
    return el('div', 'body', [note('说一句就能改回执格式；不改真实派工配置。'), values,
      el('div', 'readout', confirmation, {role: 'status', 'aria-live': 'polite'}), transaction ? row([undo]) : null]);
  });
  register('dispatch-receipt', '派工回执卡', d => el('div', 'body', [
    tag('虚构回执 · 未启动 CLI / 模型'),
    row([tag('工人 · ' + (d.worker || demoText("cards-b.sample.64"))), tag('模型 · ' + (d.model || 'Sol'))]),
    row([tag('耗时 · 6.2 秒'), tag('1,240 token')]),
    el('p', 'prose', d.summary || '演示任务：整理本地检查输出，形成一份可审查的结果摘要。'),
    note('结果：样例整理完成；真实执行、测试与用户验收均未发生。'),
    d.compact ? null : list(['输入 980 token，输出 260 token，均为演示值。', '没有读写项目文件，没有发出网络请求。', '工人、模型是回执样例，不代表当前可用状态。']),
    button('复制回执摘要', () => copy('虚构派工回执｜' + (d.worker || demoText("cards-b.sample.65")) + '｜' + (d.model || 'Sol') + '｜6.2 秒｜1,240 token｜未真实派工'), 'copy')
  ]));
  H.registerCapability({
    id: 'cards-b-receipt-preference', title: '回执偏好', icon: 'check', steward: 'pm', group: '工程回执',
    oneLine: '一句话改回执的详略，只在本页生效并可撤销。',
    status: () => [{label: '格式', value: receiptPreference.compact ? '精简版' : '完整版'}, {label: '作用范围', value: '本页演示'}],
    phrases: ['查看回执偏好', '把回执改成精简版', '把回执恢复为完整版'],
    reply(phrase) {
      let changeId;
      if (phrase !== '查看回执偏好') {
        const next = phrase === '把回执改成精简版';
        if (next !== receiptPreference.compact) {
          changeId = 'cards-b-preference-' + (++serial);
          preferenceChanges.set(changeId, {before: receiptPreference.compact, revision: ++receiptPreference.revision, undone: false});
          receiptPreference.compact = next;
        }
      }
      return [part('capability-status', {title: '回执偏好 · 本页状态', changeId})];
    }
  });
  H.registerCapability({
    id: 'cards-b-dispatch-receipt', title: '派工回执演示', icon: 'jobs', steward: 'pm', group: '工程回执',
    oneLine: '看清工人、模型、耗时、token 与结果，再决定真实派工。',
    status: () => [{label: '样例', value: '2 种工人'}, {label: '真实派工', value: '0 次'}, {label: '格式', value: receiptPreference.compact ? '精简版' : '完整版'}],
    phrases: demoFixture("cards-b.phrases.66"),
    reply(phrase) {
      if (phrase === '这份回执证明了什么') return [part('dispatch-receipt', {title: '回执证据边界', compact: receiptPreference.compact,
        summary: '这张卡只演示字段与结果摘要，不能证明工人运行、产物正确或用户验收；需要真实输出与产物另行核验。'})];
      return [part('dispatch-receipt', {title: '派工回执 · 离线样例', worker: phrase === '看看本地工人的回执' ? '本地工人' : demoText("cards-b.worker.67"),
        model: phrase === '看看本地工人的回执' ? demoText("cards-b.model.68") : 'Sol', compact: receiptPreference.compact}),
        part(demoText("cards-b.reply.69"), {taskId: '回执能力 · 派工轮次演示'})];
    }
  });
  function message(bot, title, parts) {return {id: 'cards-b-message-' + (++serial), from: bot, time: '演示', parts: [{type: 'text', md: title}, ...parts]};}
  H.registerConversation('pm', {id:'cards-b-pm-r8', title:'第八轮 · 分工与后台回报', messages:[
    demoFixture("cards-b.messages.70"),
    message('pm', '本页演示，未真实执行。云端与本地的步骤、消耗和交回记录如下；节省量是对照估算。', [
      part('teacher-student', demoFixture("cards-b.messages.71"))]),
    message('pm', '本页演示，未真实执行。后台摘要留在聊天里，点开小卡才看详情。', [
      part('background-report', {sourceBot:'content', task:'交接草稿整理', elapsed:'8 秒（演示）', summary:'草稿已整理为待审摘要，来源日期仍待核；没有发布。',
        detail:['只整理了本页假数据，未读取真实文件。', '来源日期待核，不能把回执当作已验收。', '没有发送、训练或调用模型。'], conversation:'cards-b-content'})])
  ]});

  H.registerFeatureSection('devices', {id:'cards-b-devices-log',kind:'log',title:'音色与屏幕操作记录',render(container) {
    container.append(el('p','note','原设备样例的音色计划、缺授权卡与逐步批准卡均保留；由设备负责助理回话，产物就绪与验收、采用分别记录。'),
      h('button',{class:'ghostbtn','data-hub-conversation':'cards-b-machine-r8'},'查看音色计划与逐步批准记录'));
  }});

  H.registerConversation(featureAssistantId('devices'), {featureId:'devices',id:'cards-b-machine-r8', title:'第八轮 · 音色与屏幕动手', messages:[
    {from:'user', time:'演示', parts:[{type:'text', md:'用我自己的录音走一遍音色计划，再演示逐步批准屏幕操作。'}]},
    message(featureAssistantId('devices'), '本页演示，未真实执行。拟计划后批准本页流程；刷新到产物，再分别试听、验收、采用。', [
      part('voice-job', {botId:'chief', voiceName:'我自己的录音 · 日常候选', source:'本人录音', licenseNote:'演示声明：我自己的录音，仅供指定 bot 的本页候选。',
        playEngine:'未接通', trainEngine:'未接入', state:'draft', artifactReady:false, qualityAccepted:false, playbackCompatible:false, receiptLabel:'本人录音流程 · 本页回执'})]),
    message(featureAssistantId('devices'), '本页演示，未真实执行。这张卡缺少授权说明，即使传入产物就绪，也不能开训或采用。', [
      part('voice-job', {botId:'chief', voiceName:'我自己的录音 · 授权待补', source:'本人录音', licenseNote:'', state:'accepted', artifactReady:true, qualityAccepted:true, playbackCompatible:true})]),
    message(featureAssistantId('devices'), '本页演示，未真实执行。点开始演示或看一眼，等到待批后只允许当前一步；第三步做完遇验证码即停。', [
      part('live-op', {bot:featureAssistantId('devices'), task:'演示客户端 · 草稿预检', app:'演示客户端', tier:'yellow', permission:'L3', phase:'idle', step:0,
        background:{summary:'尚未交给后台；不自动放行审批'}})])
  ]});
  H.registerConversation('pm', {id: 'cards-b-pm', title: demoText("cards-b.title.72"), messages: [
    {from: 'user', time: '演示', parts: [{type: 'text', md: '把 DSH 本地候选的流程、变更和证据整理给我看。'}]},
    message('pm', demoText("cards-b.messages.73"), [
      part('progress', demoFixture("cards-b.messages.74")),
      part('compare', {title: '执行模型候选'}),
      part('flow', {title: '贡献与整理的证据链', source: '知识贡献与整理', nodes: ['记录贡献', '投递记录', '核对回执', '整理入库'], descriptions: ['记录贡献与原始证据。', '投递由知识库工具完成，非本页实际操作。', '以送达或已同步的回执为准，不能只看进程退出成功。', '整理者核来源；已送达不等于已被采用。']})]),
    message('pm', '**变更可直接检查。** 下面的文件、代码与输出均为虚拟示例。', [
      part('tree', demoFixture("cards-b.messages.75")),
      part('code', {title: '回执显示逻辑', source: '知识库投递工具'}), part('diff', {title: '修正成功口径', source: '知识库投递工具'}),
      part('terminal', {title: '本地检查输出'})]),
    message('pm', '**最后看来源与缺口。** 回执、确认和事实核验各有状态。', [
      part('knowledge', {title: '来源与用户确认', source: '来源与确认标签'}),
      part('alert', {title: '远端结果待核', source: '生图与视频生成台账'})])
  ]});
  H.registerConversation(demoText("cards-b.sample.76"), {id: demoText("cards-b.id.77"), title: demoText("cards-b.title.78"), messages: [
    demoFixture("cards-b.messages.79"),
    message(demoText("cards-b.messages.80"), demoText("cards-b.messages.81"), [
      part('handoff-mini', demoFixture("cards-b.messages.82")),
      part('live-op', demoFixture("cards-b.messages.83"))]),
    message(demoText("cards-b.messages.84"), '演示，未真实执行。分 bot 回报在主 bot 会话内留一条简短交接；也可点上方「模拟分 bot 回报」。', [
      part('handoff-mini', demoFixture("cards-b.messages.85"))])
  ]});
  H.registerConversation('pm', {id: 'cards-b-pm-r7', title: '第七轮 · 派工、体检与通话', messages: [
    {from: 'user', time: '演示', parts: [{type: 'text', md: '看看派工轮次、设备体检和通话纪要。'}]},
    message('pm', '演示，未真实执行。点开每一路看回执；只比较同一轮的结果。也可模拟追加体检与纪要。', [
      part(demoText("cards-b.messages.86"), {taskId: '草稿交接（演示）', demoFollowups: true})]),
    message('pm', '演示，未真实执行。逐项核对后看警告；导出按钮只展示脱敏范围，不下载。', [
      part('checkup', {device: demoText("cards-b.device.87"), items: checkupItems})]),
    message('pm', '演示，未真实执行。通话纪要可转成本页任务草稿，待你决定真实派工。', [
      part('call-summary', {bot: 'pm', duration: 184, summary: '两路草稿存在审查顺序差异；设备备份校验仍待核。',
        decisions: ['发送前先问', '验证码交给你接管'], todos: ['核对两路差异', '复核备份恢复点']})])
  ]});
  H.registerConversation('content', {id: 'cards-b-content', title: demoText("cards-b.title.88"), messages: [
    demoFixture("cards-b.messages.89"),
    message('content', '**先看数据口径，再看选题。** 访问、咨询、成交分开记录。', [
      part('metrics', demoFixture("cards-b.messages.90")),
      part('chart', demoFixture("cards-b.messages.91")),
      part('formula', demoFixture("cards-b.messages.92"))]),
    message('content', '**这期的交接包。** 选题、预览和每个平台的回执分别检查。', [
      part('page', demoFixture("cards-b.messages.93")),
      part('table', demoFixture("cards-b.messages.94")),
      part('checklist', demoFixture("cards-b.messages.95")),
      part(demoText("cards-b.messages.96"), demoFixture("cards-b.messages.97"))]),
    message('content', '**正文和来源一起保留。** 语音位置使用本地提示音演示。', [
      part('voice', demoFixture("cards-b.messages.98")),
      part('article', demoFixture("cards-b.messages.99")),
      part('sources', {title: '文中引用与资料日期', source: '来源与确认标签'}),
      part('link', {title: '阅读页链接 · 离线预览'})])
  ]});
  H.registerConversation('art', {id: 'cards-b-art', title: demoText("cards-b.title.100"), messages: [
    {from: 'user', time: '演示', parts: [{type: 'text', md: '先把参考、分镜和工具草稿放在一起，给我看得见的版本。'}]},
    message('art', demoText("cards-b.messages.101"), [
      part('images', demoFixture("cards-b.messages.102")),
      part('video', demoFixture("cards-b.messages.103")),
      part('prompt', demoFixture("cards-b.messages.104"))]),
    message('art', '**保留审核节点。** 下载与验片通过后才进入下一段。', [
      part('checklist', demoFixture("cards-b.messages.105")),
      part('progress', demoFixture("cards-b.messages.106"))])
  ]});
})();
