/* 确认卡说人话、项目页分三段。
 * 项目页渲染不在 js/core.js。适配层面板 hub-real-group-page 的函数是
 * renderGroupPage；这里在它登记之后包一层，改用 renderProject。
 * 线程里的确认卡同理，包住 hub-real-approval。抽屉仍走适配层自己的闭包。
 */
(function () {
  'use strict';
  var H = window.Hub;
  var HEADS = ['目标', '主人说过的', '已定的决定', '分工与谁来验', '进度', '卡点', '下一步'];

  function realMode() {
    try { return document.documentElement.dataset.hubMode === 'real'; }
    catch (err) { return false; }
  }

  function humanize(text) {
    if (typeof text !== 'string' || !realMode()) return text;
    return text
      .replace(/token\/s/gi, '每秒用量')
      .replace(/\bexit code\b/gi, '结束状态')
      .replace(/exitCode/g, '结束状态')
      .replace(/\bsandbox\b/gi, '隔离试跑区')
      .replace(/\bcwd\b/g, '所在文件夹')
      .replace(/\btokens?\b/gi, '用量')
      .replace(/L 级/g, '这一档')
      .replace(/\bL0\b/g, '只看不动')
      .replace(/\bL1\b/g, '记一笔就行')
      .replace(/\bL2\b/g, '先做完再告诉你')
      .replace(/\bL3\b/g, '先问你')
      .replace(/\bL4\b/g, '不能做')
      .replace(/\bdeleted\b/gi, '已删除')
      .replace(/\brestore\b/gi, '恢复')
      .replace(/\btrash\b/gi, '最近删除');
  }

  function clip(value, max) {
    return Array.from(String(value || '')).slice(0, max).join('');
  }

  function personName(card) {
    var name = card && (card.botName || card.name);
    if (typeof name !== 'string') return '';
    var trimmed = name.trim();
    return trimmed ? clip(trimmed, 24) : '';
  }

  function who(card) {
    return personName(card) || '助理';
  }

  function noun(value) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (!text || text.length > 16) return '';
    if (/[<>\\]|https?:|\/\//.test(text) || text.indexOf('/') !== -1) return '';
    return text;
  }

  function shortWhy(value) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (!text || Array.from(text).length > 24) return '';
    if (/[<>\\]|https?:|\/\//.test(text) || text.indexOf('/') !== -1) return '';
    return text;
  }

  function listCommand(command) {
    return /^\s*(ls|dir|get-childitem)\b/i.test(String(command || ''));
  }

  function kindOf(card) {
    if (!card || typeof card !== 'object') return 'ask';
    var tool = String(card.tool || '');
    var kind = String(card.kind || '');
    if (kind === 'group_plan' || tool === 'group_plan' || tool === 'group_create') return 'plan';
    if (kind === 'dispatch' || tool === 'dispatch' || tool === 'send_to_bot') return 'dispatch';
    if (kind === 'grant' || tool === 'grant' || tool === 'permission_grant') return 'grant';
    if (tool === 'read' || kind === 'read') return 'read';
    if (tool === 'write' || tool === 'edit' || kind === 'write') return 'write';
    if (tool === 'bash' || kind === 'command') {
      var net = !!(card.caps && card.caps.network);
      var writes = card.caps && Array.isArray(card.caps.writeRoots) && card.caps.writeRoots.length;
      if (net && !writes && !listCommand(card.command)) return 'net';
      return 'command';
    }
    if (card.caps && card.caps.network) return 'net';
    return 'ask';
  }

  function sharedPlace(path) {
    return /(?:^|\/)shared(?:\/|$)/i.test(String(path || '')) ? '共享文件夹' : '文件夹';
  }

  function headline(card) {
    var name = who(card);
    if (card.confirmationTotal || String(card.tool || '').indexOf('self_edit') === 0) {
      return String(card.title || card.action || name + '请你确认这次操作');
    }
    var kind = kindOf(card);
    if (kind === 'write') {
      var place = sharedPlace(card.path);
      if (String(card.tool) === 'edit' || card.diff) return name + '想改' + place + '里的一份文件';
      return name + '想把' + (noun(card.title) || noun(card.thing) || '一份文件') + '存到' + place;
    }
    if (kind === 'read') return name + '想查看' + (noun(card.title) || noun(card.thing) || '一份文件');
    if (kind === 'command') {
      var goal = shortWhy(card.why) || (listCommand(card.command) ? '查看文件列表' : '办一件事');
      return name + '想运行一条命令来' + goal;
    }
    if (kind === 'net') return name + '想联网' + (shortWhy(card.why) || '查看资料');
    if (kind === 'dispatch') {
      var task = noun(card.task) || noun(card.title) || '这件事';
      var target = noun(card.toName) || '另一位助理';
      return name + '想把' + task + '交给' + target;
    }
    if (kind === 'grant') return name + '想让以后这类事不用再问你';
    if (kind === 'plan') {
      var title = noun(card.plan && card.plan.title) || noun(card.title);
      return title ? name + '想按分工表做' + title : name + '想按分工表开工';
    }
    return (personName(card) || '某某') + '想做一件需要你点头的事';
  }

  function pending(card) {
    return !card.status || card.status === 'pending';
  }

  function hadEdit(card) {
    return pending(card) && card.confirm !== true;
  }

  function hadRemember(card) {
    if (!pending(card)) return false;
    if (card.tool === 'bash' && card.grantable === true) return true;
    if (card.rememberable === true) return true;
    return [card.actions, card.choices].some(function (list) {
      return Array.isArray(list) && list.some(function (item) { return item && item.id === 'approve-always'; });
    });
  }

  function el(tag, attrs, children) {
    return H.h(tag, attrs || {}, children);
  }

  function addText(node, value) {
    node.append(document.createTextNode(value == null ? '' : String(value)));
  }

  function avatarEl(botId) {
    var api = window.HubAvatars;
    if (!api || typeof api.html !== 'function' || typeof botId !== 'string' || !botId) return null;
    var html = api.html(botId, 32);
    if (typeof html !== 'string' || !html) return null;
    var holder = document.createElement('span');
    holder.setAttribute('class', 'm-plain-talk-avatar');
    holder.innerHTML = html;
    return holder;
  }

  function row(label, value) {
    var text = Array.isArray(value)
      ? value.map(function (item) { return String(item); }).filter(Boolean).join('、')
      : value;
    if (text == null || text === '') return null;
    var node = el('p', { class: 'm-plain-talk-row' });
    node.append(el('strong', {}, label + '：'));
    addText(node, text);
    return node;
  }

  var openDetails = {};

  function commandBlock(command) {
    var box = el('div', { class: 'm-plain-talk-row m-plain-talk-command' });
    box.append(el('strong', {}, '命令（完整）：'));
    var pre = el('pre', { class: 'm-plain-talk-fullcmd', 'data-r30-full-command': '', tabindex: '0' });
    pre.textContent = String(command);
    box.append(pre);
    return box;
  }

  function clipped(card) {
    var kind = kindOf(card);
    if (kind !== 'command' && kind !== 'net') return false;
    var text = card.command != null && String(card.command) !== '' ? String(card.command) : String(card.url || '');
    return Array.from(text).length > 80;
  }

  function detailRows(card) {
    var rows = [];
    function push(label, value) { var node = row(label, value); if (node) rows.push(node); }
    // 批准前必须看得到全部：完整命令放在这里，可换行、可滚动；外面那一行只是摘要。
    if (card.command != null && String(card.command) !== '') rows.push(commandBlock(card.command));
    push('网址', card.url);
    push('所在文件夹', card.cwd || card.workdir);
    push('文件', card.path);
    push('为什么', card.why);
    if (card.caps && Array.isArray(card.caps.writeRoots) && card.caps.writeRoots.length) {
      push('要写的文件夹', card.caps.writeRoots.map(String));
    }
    if (card.caps && typeof card.caps.network === 'boolean') {
      push('联网', card.caps.network ? '要联网' : '不联网');
    }
    if (card.caps && card.caps.longRunning) push('时长', '会跑很久');
    push('预览', card.preview);
    push('改动', card.diff);
    if (card.plan && typeof card.plan === 'object') {
      var plan = [];
      if (card.plan.host) plan.push('主持：' + String(card.plan.host));
      (Array.isArray(card.plan.members) ? card.plan.members : []).slice(0, 12).forEach(function (member) {
        var bot = typeof member === 'string' ? member : (member && (member.name || member.bot)) || '';
        var role = member && member.role ? ' · ' + member.role : '';
        if (bot) plan.push(String(bot) + role);
      });
      (Array.isArray(card.plan.tickets) ? card.plan.tickets : []).slice(0, 12).forEach(function (ticket) {
        if (ticket && ticket.title) plan.push(String(ticket.title));
      });
      push('分工', plan);
    }
    return rows;
  }

  function remainText(card) {
    var at = typeof card.expiresAt === 'number' ? card.expiresAt : Date.parse(card.expiresAt);
    if (!Number.isFinite(at)) return '等你点头';
    var minutes = Math.ceil((at - Date.now()) / 60000);
    return minutes > 0 ? '还剩 ' + minutes + ' 分钟' : '没等到你点头，这一步先停着';
  }

  function resultText(card) {
    return ({
      approved: '已同意',
      rejected: '已拒绝',
      revised: '已让它改',
      timeout: '没等到你点头，这一步先停着',
      unavailable: '这一步没做成'
    })[card.status] || '这张卡已经处理过了';
  }

  function button(label, decision, card, cls) {
    return el('button', {
      type: 'button',
      class: cls + ' m-plain-talk-btn',
      'data-real-answer': decision,
      'data-real-approval': card.id || ''
    }, label);
  }

  function clip80(value) {
    var chars = Array.from(String(value == null ? '' : value));
    if (chars.length <= 80) return chars.join('');
    return chars.slice(0, 40).join('') + '…已省略 ' + (chars.length - 80) + ' 字…' + chars.slice(-40).join('');
  }

  function objectText(card) {
    var kind = kindOf(card);
    var tool = String(card.tool || '');
    var raw = String(card.kind || '');
    var command = card.command == null ? '' : String(card.command);
    if (kind === 'command' || kind === 'net') {
      if (command) {
        var programs = command.split(/&&|\|\||[;|\n]/).map(function (part) {
          var match = part.trim().match(/^(?:[A-Za-z_][\w]*=\S+\s+)*([^\s]+)/);
          return match ? match[1] : '';
        }).filter(Boolean);
        var targets = [];
        command.replace(/(?:^|[^<])>{1,2}\s*([^\s;|&]+)|\btee\s+(?:-[^\s]+\s+)*([^\s;|&]+)/g,
          function (_, redirect, tee) { targets.push(redirect || tee); return _; });
        return clip80(command) + (programs.length > 1 ? '；各段程序：' + programs.join('、') : '') +
          (targets.length ? '；写入目标：' + targets.join('、') : '');
      }
      return card.url ? clip80(card.url) : '';
    }
    if (kind === 'read') return card.path ? String(card.path) : '';
    if (kind === 'plan') {
      var plan = card.plan || {};
      var members = (Array.isArray(plan.members) ? plan.members : []).map(function (item) {
        return typeof item === 'string' ? item : item && (item.name || item.bot || item.id);
      }).filter(Boolean);
      var tickets = (Array.isArray(plan.tickets) ? plan.tickets : []).map(function (item) {
        return typeof item === 'string' ? item : item && item.title;
      }).filter(Boolean);
      return '成员：' + (members.join('、') || '暂无') + '；工单：' + (tickets.join('、') || '暂无');
    }
    if (kind === 'write' || tool === 'delete' || tool === 'unlink' || raw === 'delete') {
      return card.path ? clip80(card.path) : '';
    }
    if (kind === 'dispatch') {
      var who = card.toName || card.to || card.recipient || '';
      return who ? clip80(who) : '';
    }
    if (tool === 'send' || tool === 'email' || raw === 'send' || raw === 'outbound') {
      var target = card.to || card.recipient || card.toName || card.url || '';
      return target ? clip80(target) : '';
    }
    return '';
  }

  function pushNote(list, text) {
    if (list.indexOf(text) < 0) list.push(text);
  }

  function riskNotes(card) {
    var command = String(card.command || '');
    var tool = String(card.tool || '') + ' ' + String(card.kind || '');
    var notes = [];
    if (/\b(?:bash|sh|zsh|dash|ksh)\s+[^\n]*-c\b|\beval\b|\$\(|`|<<|\b(?:base64|xxd|openssl)\b/i.test(command)) {
      pushNote(notes, '这条命令的实际动作看不出来，有风险');
    }
    if (/(?:^|[^<])>{1,2}\s*[^\s]|\btee\b/i.test(command)) pushNote(notes, '这一步会写入或覆盖文件');
    if (/\b(rm|rmdir|unlink|shred)\b|\bdel\b|git\s+clean|drop\s+table/i.test(command) ||
        /\b(delete|unlink)\b/i.test(tool)) {
      pushNote(notes, '这一步会删除');
    }
    if (/\b(mv|cp|dd|tee|truncate)\b|sed\s+-i|git\s+checkout\s+--/i.test(command)) {
      pushNote(notes, '这一步会覆盖');
    }
    if (/\b(curl|wget|scp|rsync|sendmail|nc|mail)\b|git\s+push/i.test(command) ||
        kindOf(card) === 'net') {
      pushNote(notes, '这一步会对外发送');
    }
    if (/\b(sudo|doas|pkexec|chmod|chown)\b|\bsu\s/i.test(command)) {
      pushNote(notes, '这一步会提权');
    }
    return notes;
  }

  function confirmationDetails(data) {
    if (!data.confirmationTotal && !data.consequence && !data.targets) return null;
    var box = el('section', {class: 'm-plain-talk-confirmation', 'data-confirmation-details': ''});
    if (data.confirmationTotal === 2) {
      var phase = data.confirmationStep === 2 ? '再次确认 · 请核对下面的对象和数量' : '先确认这件事 · 下一步核对对象';
      box.append(el('p', {class: 'm-plain-talk-row', role: 'status'}, phase));
    }
    if (data.consequence) box.append(el('p', {class: 'm-plain-talk-row'}, String(data.consequence)));
    if (data.rollback) box.append(el('p', {class: 'm-plain-talk-row'}, String(data.rollback)));
    var targets = Array.isArray(data.targets) ? data.targets : [];
    if (targets.length || Number.isInteger(data.targetCount)) {
      var count = Number.isInteger(data.targetCount) ? data.targetCount : targets.length;
      box.append(el('p', {class: 'm-plain-talk-row', 'data-confirmation-count': ''}, '涉及 ' + count + ' 个对象'));
      var list = el('ul', {class: 'm-plain-talk-list', 'data-confirmation-targets': ''});
      targets.forEach(function (target) { list.append(el('li', {}, String(target))); });
      box.append(list);
    }
    return box;
  }

  function renderCard(card) {
    var data = card && typeof card === 'object' ? card : {};
    var root = el('section', {
      class: 'mcard r22-letter hub-real-letter m-plain-talk-card',
      'data-real-card': data.id || '',
      'data-plain-kind': kindOf(data)
    });
    root.dataset.realCardStatus = data.status || '';
    var line = el('h3', { class: 'm-plain-talk-line' });
    var face = avatarEl(data.bot);
    if (face) line.append(face);
    var sentence = el('span', { 'data-plain-line': '' });
    addText(sentence, headline(data));
    line.append(sentence);
    if (pending(data)) {
      var fact = objectText(data);
      if (fact) {
        var factNode = el('span', { class: 'm-plain-talk-fact' });
        addText(factNode, fact);
        line.append(factNode);
      }
      if (clipped(data)) {
        var more = el('button', { type: 'button', class: 'm-plain-talk-more', 'data-r30-open-details': '' },
          '已省略，点开看全');
        if (typeof more.addEventListener === 'function') more.addEventListener('click', function () {
          var box = root.querySelector('[data-plain-details]');
          if (!box) return;
          box.open = true;
          if (data.id) openDetails[String(data.id)] = true;
          if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
        });
        line.append(more);
      }
      var why = typeof data.why === 'string' ? data.why.trim() : '';
      if (why) {
        var whyNode = el('span', { class: 'm-plain-talk-why' });
        addText(whyNode, '它说是为了：' + why);
        line.append(whyNode);
      }
      riskNotes(data).forEach(function (note) {
        var warn = el('strong', { class: 'm-plain-talk-warn', role: 'status' });
        addText(warn, note);
        line.append(warn);
      });
    }
    root.append(line);
    if (!pending(data)) {
      var done = el('p', { class: 'm-plain-talk-row', role: 'status' });
      addText(done, resultText(data));
      if (data.status === 'revised' && data.note) addText(done, '：' + data.note);
      root.append(done);
      return root;
    }
    var details = el('details', { class: 'm-plain-talk-details', 'data-plain-details': '' });
    // 卡会因轮询、倒计时、新消息被重画；点开过的细节要记住，不能自己合上。
    var cardKey = String(data.id || '');
    if (cardKey && openDetails[cardKey]) details.open = true;
    if (typeof details.addEventListener === 'function') {
      details.addEventListener('toggle', function () {
        if (cardKey) openDetails[cardKey] = !!details.open;
      });
    }
    details.append(el('summary', {}, '查看细节'));
    detailRows(data).forEach(function (node) { details.append(node); });
    if (hadEdit(data)) {
      var edit = el('div', { class: 'm-plain-talk-edit' });
      edit.append(el('p', { class: 'm-plain-talk-row' }, '改一下'));
      edit.append(el('textarea', {
        class: 'pop-input',
        maxlength: '500',
        'data-real-revision': data.id || '',
        'aria-label': '改一下的意见'
      }));
      edit.append(button('提交意见', 'revise', data, 'primary'));
      details.append(edit);
    }
    var countdown = el('p', {
      class: 'mini-note m-plain-talk-row',
      'data-real-countdown': data.id || ''
    });
    addText(countdown, remainText(data));
    details.append(countdown);
    root.append(details);
    var confirmation = confirmationDetails(data);
    if (confirmation) root.append(confirmation);
    var actions = el('div', { class: 'actions m-plain-talk-actions' });
    var agree = data.confirmationTotal === 2 ?
      (data.confirmationStep === 2 ? '对象和数量已核对，确认执行' : '继续核对对象') : '同意';
    actions.append(button(agree, 'approve', data, 'primary'));
    actions.append(button('拒绝', 'reject', data, 'ghostbtn'));
    if (data.scopeGrantable === true) {
      actions.append(button('这一次这类都同意', 'approve-task', data, 'ghostbtn'));
      root.append(el('p', {class: 'm-plain-talk-row'}, '只限当前这件事、这一类操作，授权到期后会再问。'));
    } else if (hadRemember(data)) actions.append(button('以后这类不用问', 'remember', data, 'ghostbtn'));
    root.append(actions);
    return root;
  }

  function plainItem(value) {
    var raw = String(value || '').trim();
    var text = raw.replace(/^\s*[\[〔]#?\d+[\]〕]\s*/, '').trim();
    return text || raw;
  }

  function parseProject(text) {
    var raw = typeof text === 'string' ? text : '';
    var sections = {};
    var current = '';
    var saw = false;
    var names = '目标|主人说过的|已定的决定|分工与谁来验|进度|卡点|下一步';
    var head = new RegExp('^#{1,6}[ \\t]*(' + names + ')(?:[ \\t]*[：:][ \\t]*(.*))?$');
    raw.split(/\r?\n/).forEach(function (line) {
      var found = line.match(head);
      if (found && HEADS.indexOf(found[1]) !== -1) {
        current = found[1];
        sections[current] = sections[current] || [];
        saw = true;
        if (found[2] && found[2].trim()) sections[current].push(found[2].trim());
        return;
      }
      if (!current) return;
      var item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
      var body = item ? item[1].trim() : line.trim();
      if (body) sections[current].push(body);
    });
    if (!saw) return { ok: false, raw: raw };
    var block = sections['卡点'] || [];
    var next = sections['下一步'] || [];
    return {
      ok: true,
      raw: raw,
      goal: sections['目标'] || [],
      decided: sections['已定的决定'] || [],
      waiting: block.concat(next)
    };
  }

  function list(items) {
    var box = el('ul', { class: 'm-plain-talk-list' });
    var rows = items.length ? items.map(plainItem) : ['暂无'];
    rows.forEach(function (item) {
      var li = el('li', { class: 'm-plain-talk-item' });
      addText(li, item);
      box.append(li);
    });
    return box;
  }

  function renderProject(text) {
    var parsed = parseProject(text);
    var root = el('div', {
      class: 'm-plain-talk-page',
      'data-plain-page': parsed.ok ? 'sections' : 'raw'
    });
    if (!parsed.ok) {
      var raw = el('div', { class: 'm-plain-talk-raw' });
      raw.textContent = parsed.raw.trim() ? parsed.raw : '暂无';
      root.append(raw);
      return root;
    }
    [['目标', parsed.goal], ['已定的', parsed.decided], ['等你处理', parsed.waiting]].forEach(function (pair) {
      var sec = el('section', { class: 'm-plain-talk-sec', 'data-plain-section': pair[0] });
      sec.append(el('h3', { class: 'm-plain-talk-h' }, pair[0]));
      sec.append(list(pair[1]));
      root.append(sec);
    });
    var details = el('details', { class: 'm-plain-talk-details', 'data-plain-original': '' });
    details.append(el('summary', {}, '看原文'));
    var pre = el('pre', { class: 'm-plain-talk-raw' });
    pre.textContent = parsed.raw;
    details.append(pre);
    root.append(details);
    return root;
  }

  function normalPage() {
    return [
      '# 项目页：示例',
      '## 目标',
      '- 把摘要收成一页',
      '- 两人交叉看一遍',
      '## 主人说过的',
      '- [#1] 先写短的',
      '## 已定的决定',
      '- [#2] 不补原文',
      '- [#3] 只写事实',
      '## 分工与谁来验',
      '- 甲写，乙看',
      '## 进度',
      '- 已有提纲',
      '## 卡点',
      '- 共享区还是空的',
      '## 下一步',
      '- 等你点头再写'
    ].join('\n');
  }

  function sampleCards() {
    return [
      { id: 'write-shared', bot: 'sample-bot', botName: '调研员', tool: 'write', title: '摘要',
        path: 'shared/notes/digest.md', why: '方便以后一起看', status: 'pending' },
      { id: 'read-file', bot: 'sample-bot', botName: '资料员', tool: 'read', title: '摘要',
        path: 'shared/notes/digest.md', status: 'pending' },
      { id: 'run-list', bot: 'sample-bot', botName: '首席助理', tool: 'bash', command: 'ls',
        cwd: 'workspace/docs', why: '查看文件列表', grantable: true,
        caps: { network: false, writeRoots: ['shared'] }, status: 'pending' },
      { id: 'go-online', bot: 'sample-bot', botName: '调研员', tool: 'bash', command: 'curl https://example.com',
        why: '查一份公开资料', caps: { network: true }, status: 'pending' },
      { id: 'hand-off', bot: 'sample-bot', botName: '首席助理', kind: 'dispatch', confirm: true,
        task: '核对摘要', toName: '调研员', status: 'pending' },
      { id: 'let-go', bot: 'sample-bot', botName: '首席助理', tool: 'grant', kind: 'grant', status: 'pending' },
      { id: 'work-split', bot: 'sample-bot', botName: '首席助理', kind: 'group_plan', tool: 'group_plan',
        confirm: true, plan: { title: '整理摘要', host: '主持', members: [], tickets: [] }, status: 'pending' },
      { id: 'need-yes', botName: '<img src=x onerror="window.__hit=1">', tool: 'mystery',
        command: '<script>alert(1)</script>', why: '<b>不要执行</b>', status: 'pending' }
    ];
  }

  function samplePages() {
    return [
      { name: '正常', text: normalPage() },
      { name: '缺段', text: ['## 目标', '- 先把摘要收成一页', '## 主人说过的'].join('\n') },
      { name: '乱格式', text: '随便写的一段\n<script>alert(1)</script>\n没有固定小标题' }
    ];
  }

  function mountSamples(host) {
    var board = el('div', { class: 'm-plain-talk-board' });
    board.append(el('h2', { class: 'm-plain-talk-h' }, '确认卡'));
    sampleCards().forEach(function (card) { board.append(renderCard(card)); });
    board.append(el('h2', { class: 'm-plain-talk-h' }, '项目页'));
    samplePages().forEach(function (page) {
      board.append(el('h3', { class: 'm-plain-talk-h' }, page.name));
      board.append(renderProject(page.text));
    });
    host.append(board);
    return board;
  }

  function softenProject(host) {
    if (!host || typeof host.querySelector !== 'function') return;
    var node = host.querySelector('.hub-real-text');
    if (!node) return;
    var trimmed = String(node.textContent || '').trim();
    if (trimmed === '正在读取项目页…' || trimmed.indexOf('暂时读不到') !== -1) return;
    var view = renderProject(node.textContent || '');
    if (typeof node.replaceWith === 'function') node.replaceWith(view);
    else host.append(view);
  }

  function hookRegistry() {
    if (!H || H.__plainTalkHooked) return;
    H.__plainTalkHooked = true;
    var regCard = typeof H.registerCard === 'function' ? H.registerCard.bind(H) : null;
    var regPanel = typeof H.registerPanel === 'function' ? H.registerPanel.bind(H) : null;
    if (regCard) {
      H.registerCard = function (id, spec) {
        if (id === 'hub-real-approval' && spec && typeof spec.render === 'function') {
          var original = spec.render;
          return regCard(id, Object.assign({}, spec, {
            render: function (data, ctx) {
              try {
                if (data && typeof data === 'object') return renderCard(data, ctx);
              } catch (err) { /* 拼不出来就退回适配层原卡 */ }
              return original.call(spec, data, ctx);
            },
            quoteLabel: function (data) {
              try { return headline(data); }
              catch (err) {
                return typeof spec.quoteLabel === 'function' ? spec.quoteLabel(data) : '要你点头';
              }
            }
          }));
        }
        return regCard(id, spec);
      };
    }
    if (regPanel) {
      H.registerPanel = function (id, spec) {
        if (id === 'hub-real-group-page' && spec && typeof spec.render === 'function') {
          var original = spec.render;
          return regPanel(id, Object.assign({}, spec, {
            render: function (host) {
              var finish = function () { try { softenProject(host); } catch (err) {} };
              try {
                var ret = original.call(spec, host);
                if (ret && typeof ret.then === 'function') return ret.then(finish, finish);
                finish();
                return ret;
              } catch (err) {
                finish();
                throw err;
              }
            }
          }));
        }
        return regPanel(id, spec);
      };
    }
  }

  var api = {
    realMode: realMode,
    humanize: humanize,
    kindOf: kindOf,
    headline: headline,
    parseProject: parseProject,
    renderCard: renderCard,
    confirmationDetails: confirmationDetails,
    renderProject: renderProject,
    sampleCards: sampleCards,
    samplePages: samplePages,
    mountSamples: mountSamples
  };
  window.HubPlainTalk = api;

  if (H && typeof H.addStyle === 'function') {
    H.addStyle([
      '.m-plain-talk-card{padding:14px 16px;margin:0 0 12px}',
      '.m-plain-talk-line{display:flex;flex-wrap:wrap;align-items:flex-start;',
      'gap:8px;margin:0 0 8px;font-size:17px;line-height:1.45}',
      '.m-plain-talk-fact,.m-plain-talk-why,.m-plain-talk-warn{flex:1 0 100%;',
      'overflow-wrap:anywhere}',
      '.m-plain-talk-warn{font-weight:700}',
      '.m-plain-talk-avatar{display:inline-flex;flex:none;width:32px;height:32px}',
      '.m-plain-talk-details{margin:8px 0}',
      '.m-plain-talk-row{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.m-plain-talk-fullcmd{margin:4px 0 0;padding:8px 10px;max-height:40vh;overflow:auto;',
      'white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;border-radius:10px;',
      'background:rgba(0,0,0,.06);font:13px/1.5 ui-monospace,Menlo,monospace;user-select:text}',
      '.m-plain-talk-more{flex:1 0 100%;text-align:left;min-height:32px;font-weight:700;',
      'text-decoration:underline}',
      '.m-plain-talk-confirmation{overflow-wrap:anywhere}',
      '.m-plain-talk-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
      '#app .m-plain-talk-card .m-plain-talk-btn{min-height:44px;height:auto}',
      '.m-plain-talk-page{margin:0 0 16px}',
      '.m-plain-talk-sec{margin:8px 0}',
      '.m-plain-talk-list{margin:4px 0 0;padding-left:1.2em}',
      '.m-plain-talk-raw{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}',
      '.m-plain-talk-board{max-width:420px;margin:0 auto;padding:16px}',
      '.m-plain-talk-h{margin:16px 0 8px}'
    ].join(''));
  }
  if (document.head && !document.getElementById('m-plain-talk-level-hide')) {
    var style = document.createElement('style');
    style.setAttribute('id', 'm-plain-talk-level-hide');
    style.textContent = [
      ':root[data-hub-mode="real"] :is(.mcard,.pop-card,.hub-real-letter,.r22-letter)',
      ' .shell-level-sticker{display:none !important}'
    ].join('');
    document.head.append(style);
  }
  hookRegistry();
})();
