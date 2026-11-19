/* r24：只注入的 art4 真实聊天适配层。无依赖，不持久化正文。 */
// r24 监工：http 非本机地址不是安全上下文，Safari/Chrome 不提供 crypto.randomUUID；用 getRandomValues 生成同格式 UUID。
function hubIdem(){ if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20); }

(function () {
  'use strict';
  const BOTS = []; // 只由已加载的服务端名册填入；失败时不退回演示名单。
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function inline(raw) {
    // 先转义；生成的标签藏入占位槽，不再参与后续解析。
    const slots = [];
    const hold = html => '\u0000' + (slots.push(html) - 1) + '\u0000';
    let text = escapeHTML(raw).replace(/\u0000/g, '');
    text = text.replace(/`([^`\n]+)`/g, (_, code) => hold('<code>' + code + '</code>'));
    text = text.replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (all, label, href) => {
      label = label.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)]);
      if (!/^https?:\/\//i.test(href)) return label;
      const visible = label.replace(/<\/?code>/g, '');
      if (/^(?:https?:\/\/|www\.)/i.test(visible) && visible !== href) return label;
      return hold('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    });
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    return text.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)]);
  }
  function markdown(raw) {
    const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n'), out = [];
    const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        const code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        out.push('<pre><code>' + escapeHTML(code.join('\n')) + '</code></pre>'); continue;
      }
      if (!line.trim()) { i++; continue; }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) { out.push('<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>'); i++; continue; }
      if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]).every(c => /^:?-{3,}:?$/.test(c))) {
        const head = cells(line); i += 2;
        let table = '<div class="hub-real-table"><table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) table += '<tr>' + cells(lines[i++]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
        out.push(table + '</tbody></table></div>'); continue;
      }
      const item = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
      if (item) {
        const tag = item[1] ? 'ul' : 'ol'; let list = '<' + tag + (tag === 'ol' && Number(item[2]) !== 1 ? ' start="' + Number(item[2]) + '"' : '') + '>';
        while (i < lines.length) {
          const next = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(lines[i]);
          if (!next || (next[1] ? 'ul' : 'ol') !== tag) break;
          list += '<li' + (tag === 'ol' ? ' value="' + Number(next[2]) + '"' : '') + '>' + inline(next[3]) + '</li>'; i++;
        }
        out.push(list + '</' + tag + '>'); continue;
      }
      out.push('<p>' + inline(line) + '</p>'); i++;
    }
    return out.join('');
  }
  // 派工、交回这类系统固定话开头是「【工单 T-2026… 派给你了】」，首页「最近」的第二行不该露出单号，
  // 换成人话。只认这几种固定开头；其余原样走下面的纯文字整理。
  function systemLinePlain(raw) {
    const text = String(raw ?? '');
    const ticket = /^\s*【工单\s+[^\s】]+\s*([^】]{0,24})】/u.exec(text);
    if (ticket) {
      const phrase = ticket[1];
      if (/派给你/u.test(phrase)) return '你把这张卡交给了它';
      if (/交回/u.test(phrase)) return '它交回了一件事，等你看';
      if (/卡住/u.test(phrase)) return '它说卡住了';
      if (/做不了/u.test(phrase)) return '它说这件事做不了';
      if (/有结果/u.test(phrase)) return '有一件事有结果了';
      return '看板上有一张卡有新进展';
    }
    const sent = /^\s*【([^】\n]{1,24})派来的活\s*·\s*工单[^】]*】/u.exec(text);
    if (sent) return sent[1].trim() + '派来一件事';
    return null;
  }
  function previewText(raw) {
    const plain = systemLinePlain(raw);
    if (plain) return plain;
    return String(raw ?? '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  }
  // 派工旧卡也只展示纯文字；与 BFF 的摘要规则一致，不改原始卡片。
  function delegationSummary(value) {
    const text = String(value ?? ''), pattern = /!?\[([^\]\n]*)\]\(/gu;
    let out = '', cursor = 0, match;
    while ((match = pattern.exec(text))) {
      let end = pattern.lastIndex, depth = 1;
      for (; end < text.length && depth; end++) {
        if (text[end] === '\\') { end++; continue; }
        if (text[end] === '(') depth++; else if (text[end] === ')') depth--;
      }
      if (depth) continue;
      out += text.slice(cursor, match.index) + match[1]; cursor = end; pattern.lastIndex = end;
    }
    return Array.from((out + text.slice(cursor)).replace(/^\s*\[[^\]\n]+\]:\s+.*$/gmu, '')
      .replace(/\[([^\]\n]*)\]\[[^\]\n]*\]/gu, '$1').replace(/^\s*(?:```|~~~).*$/gmu, '')
      .replace(/^\s{0,3}#{1,6}\s*/gmu, '').replace(/[ \t]+#+[ \t]*$/gmu, '')
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu, '').replace(/^\s*>\s*/gmu, '')
      .replace(/\*\*|__|~~|`/gu, '').replace(/\*([^*\n]+)\*/gu, '$1')
      .replace(/(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, '$1')
      .replace(/\s+/gu, ' ').trim()).slice(0, 400).join('');
  }
  const legacyDelegationStates = { queued:'排队中', running:'在做', done:'完成', completed:'完成', failed:'没能完成', error:'没做成',
    pending:'等你点头', approved:'已批准', denied:'被拒', rejected:'被拒', revised:'按意见重做', timeout:'没等到你点头',
    unavailable:'这一步没做', aborted:'已停止', cancelled:'已停止', canceled:'已停止', interrupted:'已停止', stopped:'已停止',
    tool_use:'在处理工具', end_turn:'写完这一段', max_steps:'达到步数上限', step_limit:'达到步数上限', 'step-limit':'达到步数上限' };
  function delegationLabel(value) {
    // 文件名和路径中的 running.md / drafts/failed 等原样保留，只翻译独立枚举。
    return String(value ?? '').replace(/(?<![\w./-])(?:step-limit|[a-z][a-z_]*)(?![\w./-])/gi,
      token => legacyDelegationStates[token.toLowerCase()] || token);
  }
  const delegationMilestone = label => /^(?:派出|开始|完成)(?:$|[：:\s])/u.test(label);
  function delegationSteps(value) {
    const steps = (Array.isArray(value) ? value : []).filter(step => step && typeof step === 'object')
      .map(step => ({ ...step, label: delegationLabel(step.label) }));
    return { steps, count: steps.filter(step => !delegationMilestone(step.label)).length };
  }
  function canContinue(c) {
    return c.status === 'failed' && !c.continuedBy && (c.failureKind === 'step-limit' || c.reason === '超过 8 步自动停' ||
      /^做了 8 步还没做完，按规矩先停了：已完成 \d+ 件，(?:剩 \d+ 件|剩下的没做)$/.test(c.reason || ''));
  }
  const stoppedTurn = reason => ['aborted','cancelled','canceled','interrupted','stopped'].includes(String(reason?.kind || reason || '').toLowerCase());
  const stoppedSession = s => s?.lastText === '已停止' && s?.lastRole === 'error' && !s?.running;
  function messageDate(ts) {
    if (ts == null || ts === '') return null;
    const date = new Date(ts);
    if (!Number.isFinite(date.getTime())) return null;
    return { day: date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日',
      time: String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') };
  }
  function friendlyError(error, context = 'send') {
    if (context === 'history') return '没能加载之前的对话，请重新加载；也可以发送新的一句。';
    if (context === 'reply') return '助理这次没能完成回复，请重试。';
    if (error?.definitelyUnsent || [502, 503].includes(error?.status) || error?.name === 'TypeError') return '没连上服务，这句没发出去。请重试。';
    if (error?.status === 409) return '上一条还在回复，请重新加载后再试。';
    if (error?.status === 404) return '这个会话暂时找不到，请重新加载或新建会话。';
    if (error?.status === 401 || error?.status === 403) return '连接验证失效了，请刷新页面后再试。';
    return '没收到发送确认，这句可能已经送达。请先重新加载，确认后再重试。';
  }
  function eventParser(onEvent) {
    let buffer = '', type = 'message', data = [];
    const line = value => {
      if (!value) {
        if (data.length) onEvent(type, JSON.parse(data.join('\n')));
        type = 'message'; data = []; return;
      }
      if (value.startsWith('event:')) type = value.slice(6).trim();
      if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    };
    return chunk => {
      buffer += chunk;
      let match;
      while ((match = /\r\n|\n|\r(?!$)/.exec(buffer))) {
        line(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > 2_000_000) throw new Error('回复片段过大');
    };
  }
  const hasSeq = m => Number.isSafeInteger(m.seq) && m.seq >= 0;
  const timeValue = value => value == null || value === '' ? NaN : typeof value === 'number' ? value : Date.parse(value);
  function sortTimeline(entries) {
    // 一次排序只用一种坐标，避免混用 seq/时间造成非传递比较；缺坐标时保留接收顺序，不把未知时间当 0。
    const durable = entries.filter(m => !m.timelineLocal);
    const bySeq = durable.length > 0 && durable.every(hasSeq);
    if (!bySeq && !entries.every(m => Number.isFinite(timeValue(m.ts)))) return entries;
    const position = m => hasSeq(m) ? m.seq : Number.isFinite(m.timelineAfterSeq) ? m.timelineAfterSeq + 0.5 : Infinity;
    return entries.sort((a, b) => bySeq
      ? position(a) - position(b) || 0
      : timeValue(a.ts) - timeValue(b.ts) || (hasSeq(a) && hasSeq(b) ? a.seq - b.seq : 0));
  }
  function surfaceEntries(messages) {
    const out = [], tools = new Map();
    for (const m of messages) {
      if (!m || !['user', 'assistant'].includes(m.role)) continue;
      if (typeof m.text === 'string' && m.text.trim()) out.push({ ...m, text: m.role === 'user' ? userText(m.text) : m.text, kind: 'message' });
      if (m.role !== 'assistant' || !Array.isArray(m.tools)) continue;
      for (const t of m.tools) {
        if (!t || typeof t.id !== 'string' || !t.id || typeof t.name !== 'string') continue;
        const entry = { ...t, kind: 'tool', ts: t.ts ?? m.ts, seq: t.seq ?? m.seq };
        if (tools.has(t.id)) { const old = tools.get(t.id); Object.assign(old, entry, { ts: old.ts ?? entry.ts, seq: old.seq ?? entry.seq }); }
        else { tools.set(t.id, entry); out.push(entry); }
      }
    }
    return out;
  }
  function shortPath(path, root) {
    const value=String(path || ''), prefix=String(root || '').replace(/\/+$/u,'');
    return prefix && (value===prefix || value.startsWith(prefix+'/')) ? value.slice(prefix.length+1) || '.' : value;
  }
  function outputPreview(text) {
    let bytes=0,out='';
    for(const c of String(text || '')) { const p=c.codePointAt(0), n=p<128?1:p<2048?2:p<65536?3:4; if(bytes+n>4096)return {text:out,truncated:true}; bytes+=n;out+=c; }
    return {text:out,truncated:false};
  }
  // 热修：工具步骤说人话。键=工具原名，值=[正在做, 做完了]；不在表里的显示「在处理」，原名由界面小字另放。
  const TOOL_WORDS = {
    ticket_create: ['新建工单', '建了一张工单'], ticket_update: ['修改工单', '改了一张工单'],
    ticket_move: ['移动工单', '移动了一张工单'], bot_status: ['查看助理状态', '查看了助理状态'],
    delegate_to_bot: ['派任务', '派了一项任务'], bot_list: ['查看助理名册', '看了助理名册'],
    list_bots: ['查看助理名册', '看了助理名册'], bot_create: ['新建助理', '建了一个助理'],
    bot_update: ['修改助理资料', '改了助理资料'], bot_set_status: ['停用或恢复助理', '改了助理状态'],
    send_to_bot: ['转给别的助理', '转给了别的助理'], board_list: ['查看看板', '看了看板'],
    board_report: ['在看板上报进度', '在看板上报了进度'], board_review: ['验收工单', '验收了工单'],
    rules_read: ['查看规矩', '看了规矩'], rule_note: ['记一条规矩', '记了一条规矩'],
    rule_propose_shared: ['提议一条共用规矩', '提议了一条共用规矩'], dispatch_prepare: ['准备外派', '写好了外派任务书'],
    dispatch_external: ['外派给外部工人', '外派了出去'], group_create: ['拉讨论组', '拉了讨论组'],
    group_read: ['查看讨论组', '看了讨论组'], group_say: ['在讨论组发言', '在讨论组说了话'],
    group_ticket_accept: ['接组里的单', '接了组里的单'], group_ticket_submit: ['交组里的单', '交了组里的单'],
    group_ticket_verify: ['验组里的单', '验了组里的单'], skill: ['翻手册', '看了手册']
  };
  const KNOWN_TOOLS = new Set(['bash', 'read', 'write', 'edit', 'list_files', ...Object.keys(TOOL_WORDS)]);
  function unknownToolName(t) { return t && t.name && !KNOWN_TOOLS.has(t.name) ? String(t.name) : ''; }
  function toolText(t, approval) {
    if(t.name==='bash') {
      const status=['denied','rejected','error','timeout','unavailable','revised'].includes(t.status)?t.status:approval?.status || t.status;
      const command=Array.from(String(t.command || approval?.command || '')).slice(0,40).join('');
      if(['denied','rejected','unavailable','revised'].includes(status))return '这条命令没跑：'+(t.brief || approval?.note || approvalResult(approval || {status}) || '没有获得批准');
      if(status==='error' || status==='timeout')return '命令没跑完：'+(t.brief || '超过时限或执行失败');
      if(status==='ok')return '跑了命令：'+command;
      return (({pending:'等你点头：',approved:'已批准命令：',running:'正在跑命令：'})[status] || '正在处理命令：')+command;
    }
    const path = String(t.path || '').replace(/^\/Users\/example\/dsh-work\/bots\/[^/]+\//i, '').replace(/^\/Users\/example\/dsh-work\//i, '');
    const words = TOOL_WORDS[t.name];
    const action = ['write', 'edit'].includes(t.name) ? (path.startsWith('shared/') ? '写共享区' : '写入 ' + path) : t.name === 'read' ? '读取 ' + path : t.name === 'list_files' ? '查看目录 ' + path : words ? words[0] : '在处理';
    const done = t.name === 'read' ? '读了 ' + path : ['write', 'edit'].includes(t.name) && !path.startsWith('shared/') ? '写了 ' + path : words ? words[1] : action;
    const status = ['denied','rejected','error','timeout','unavailable','revised'].includes(t.status) ? t.status : approval?.status || t.status;
    if (['denied', 'rejected', 'error', 'timeout', 'unavailable', 'revised'].includes(status)) return action + ' · ' + ({ denied: '被拒', rejected: '被拒', error: '失败', timeout: '没等到你点头，这一步没做', unavailable: '无法审批，这一步没做', revised: '已让它改，这一步没做' })[status] + (t.brief ? '：' + t.brief : '');
    if (status === 'pending') return action + ' · 等你点头';
    if (t.status === 'ok') return done + (t.level === 'L1' ? ' · L1 已记录' : ' · 已完成');
    if (status === 'approved') return action + ' · 已批准';
    return action + ' · 处理中';
  }
  const rosterTool = c => ['bot_create','bot_update','bot_set_status'].includes(c.tool);
  const profileFields = { name:'名字', avatar:'形象', nameColor:'名牌色', duty:'职责一句话', notDuty:'不管什么', phrases:'开场短语', status:'状态' };
  function rosterChanges(before, after) {
    return Object.keys(profileFields).filter(key => Object.hasOwn(after || {}, key) &&
      (before == null || JSON.stringify(before[key]) !== JSON.stringify(after[key])))
      .map(key => ({key,label:profileFields[key],before:before?.[key],after:after[key]}));
  }
  function validateName(name, bots, currentId, max=8) {
    if (typeof name!=='string' || name!==name.trim() || Array.from(name).length<1 || Array.from(name).length>max || /[\\/:.~\p{Cc}\p{Zl}\p{Zp}]/u.test(name)) return '名字用 1–'+max+' 个字，不带路径符号、控制字符或首尾空格';
    return bots.some(b=>b.id!==currentId && b.name.normalize('NFC').toLowerCase()===name.normalize('NFC').toLowerCase()) ? '这个名字已有助理在用，停用的也不能重名' : '';
  }
  function validateAvatarFile(file) {
    if(!file || !file.size) return '请选择一张图片';
    if(file.size>2*1024*1024) return '图片不能超过 2MB';
    return /\.(png|jpe?g|webp|gif)$/i.test(file.name) && ['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) ? '' : '只收 png、jpg、webp 或 gif 图片';
  }
  function normalizeRoster(data) {
    if(!data || !Array.isArray(data.bots)) throw Error('助理名册暂不可用');
    const seen=new Set();
    const bots=data.bots.map(b=>{
      if(!b || !/^[a-z][a-z0-9-]{1,23}$/.test(b.id) || seen.has(b.id) || typeof b.name!=='string' || !['active','disabled'].includes(b.status) || !['chief','bot'].includes(b.role)) throw Error('助理名册格式有误');
      seen.add(b.id); return {...b};
    }).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
    return {bots,limits:data.limits||{},avatarKinds:data.avatarKinds||{roles:[],shapes:[],colors:[]}};
  }
  function approvalTitle(c) {
    if (rosterTool(c)) {
      const self=c.bot===c.target && !!c.bot, target=c.before?.name || c.targetName || '助理', who=(self?c.before?.name:'') || c.botName || '助理';
      return c.tool==='bot_create' ? who+'想新建一个助理' : c.tool==='bot_update' ? who+'想改'+(self?'自己':target)+'的资料' : who+'想'+(c.after?.status==='active'?'恢复':'停用')+target;
    }
    const plain = plainCardInfo(c);
    if (plain) return plain.title;
    if (c.tool === 'bash') return (c.botName || '助理') + '想跑一条命令';
    if (c.tool === 'ticket_move') return '移动别人建的工单';
    if (c.tool === 'ticket_update') return '改别人建的工单';
    const shared = /(?:^|\/)shared(?:\/|$)/i.test(String(c.path || ''));
    const existing = c.tool === 'edit' || !!c.diff;
    if (shared) return existing ? (/日志/.test(c.path) ? '改共享区里的项目日志' : '改共享区里的一份文件') : '把一份文件写进共享区';
    return existing ? '修改一份文件' : '写入一份文件';
  }
  function toolRun(messages, id) {
    const index = messages.findIndex(m => m.hubToolId === id);
    if (index < 0) return [];
    let start = index, end = index + 1;
    while (start > 0 && messages[start - 1].hubToolId) start--;
    while (end < messages.length && messages[end].hubToolId) end++;
    return messages.slice(start, end).map(m => m.parts[0].data);
  }
  function userText(text) {
    const prefix = '（改一下）主人 看了审批卡，要你按这条意见改完重做（重做照常走审批，这不算绕过）：';
    return text.startsWith(prefix) ? '改一下：' + text.slice(prefix.length) : text;
  }
  function approvalWhy(raw) {
    const chars = Array.from(String(raw || '').trim());
    return chars.length > 80 ? chars.slice(0, 80).join('') + '…' : chars.join('');
  }
  function approvalResult(c) {
    if(rosterTool(c) && ['failed','error','apply-failed'].includes(c.status) || rosterTool(c) && ['apply-failed','roster-write-failed','bot-write-failed'].includes(c.reason)) return '没改成：'+String(c.error?.message || c.failureReason || c.note || '保存资料时出了问题').replace(/^没改成[：:]\s*/, '');
    if (c.status === 'unavailable') return ({ 'no-device': '没有登录中的设备，这一步没做',
      'dsh-disconnected': '服务断开了，没等到你点头，这一步没做', 'bff-restart': '服务断开了，没等到你点头，这一步没做',
      'bad-request': '这张卡信息不全，已按拒绝处理' })[c.reason] || '没有登录中的设备，这一步没做';
    return ({ approved: '已批准', rejected: '已拒绝', revised: '已让它改：' + (c.note || ''),
      timeout: '没等到你点头，这一步没做' })[c.status] || '';
  }
  // 定义看板列及其显示顺序。
  const BOARD_COLUMNS = [
    { id: 'queued', label: '待领' },
    { id: 'progress', label: '在做' },
    { id: 'review', label: '待验收' },
    { id: 'attention', label: '要你看' },
    { id: 'done', label: '完成' },
    { id: 'failed', label: '失败' }
  ];
  const clip = (value, length) => Array.from(String(value || '')).slice(0, length).join('');
  const validTime = value => value == null || value === '' ? NaN : new Date(value).getTime();
  const sortRecent = (a, b) => (Number.isFinite(validTime(b.updatedAt)) ? validTime(b.updatedAt) : -Infinity) -
    (Number.isFinite(validTime(a.updatedAt)) ? validTime(a.updatedAt) : -Infinity) || 0;

  // 判断工单是否来自旧系统。
  function isLegacyTicket(t) {
    return !!t && (t.legacy === true || t.source === 'legacy' ||
      typeof t.id === 'string' && !t.id.startsWith('T-'));
  }

  // 按状态判断看板列。
  function boardColumn(t) {
    const state = t?.state;
    if (state === 'failed') return 'failed';
    if (state === 'completed') return 'done';
    if (['blocked', 'waiting-human', 'waiting-timeout', 'uncertain'].includes(state)) return 'attention';
    if (t?.review === 'submitted') return 'review';
    if (state === 'progress') return 'progress';
    return 'queued';
  }

  // 将有效工单按列和更新时间分组。
  function boardColumns(tickets) {
    const valid = (Array.isArray(tickets) ? tickets : [])
      .filter(t => t && typeof t === 'object' && typeof t.id === 'string').sort(sortRecent);
    return BOARD_COLUMNS.map(({ id, label }) => {
      const rows = valid.filter(t => boardColumn(t) === id);
      return { id, label, count: rows.length, tickets: rows };
    });
  }

  // 提取工单卡片的人话摘要。to 只是候选，不算接手；没有来源就不写发起人。
  function boardCardInfo(t, nameOf = id => id) {
    t = t && typeof t === 'object' ? t : {};
    const from = t.from?.name;
    const owner = t.claimedBy || (Array.isArray(t.to) && t.to.length ? t.to.join('、') : '谁都可以领');
    const report = Array.isArray(t.report) ? t.report.at(-1) : t.report;
    const progress = Array.isArray(t.progress) ? t.progress.at(-1) : null;
    const note = t.open_ask?.text ? '在问：' + t.open_ask.text : report?.summary ? '回报：' + report.summary :
      progress?.text ? '进度：' + progress.text : '';
    const view = boardCardView(t, nameOf);
    return { id: t.id, title: clip(t.title || '（无标题）', 40),
      who: (from ? '发起 ' + (from === 'owner' ? '你' : nameOf(from)) + ' · ' : '') + '领 ' + (owner === 'owner' ? '你' : owner),
      note: clip(note, 60), legacy: isLegacyTicket(t),
      hop: Number.isSafeInteger(t.hop) && t.hop >= 0 ? t.hop : 0, column: boardColumn(t),
      line: view.line, faces: view.faces, detail: view.detail };
  }

  // 从工单字段取出一个人。没有名字就当没有这个人。
  function boardActor(value, typeHint) {
    let id = '';
    let type = typeof typeHint === 'string' ? typeHint : '';
    if (typeof value === 'string') id = value.trim();
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value.name === 'string') id = value.name.trim();
      if (typeof value.type === 'string' && value.type) type = value.type;
    }
    return id ? { id, type } : null;
  }

  // 外部和本人只用自己的名字，不拿名册上别人的显示名。
  function boardShown(actor, nameOf) {
    if (!actor) return '';
    if (actor.type === 'external') return '外部 · ' + clip(actor.id, 24);
    if (actor.type === 'owner') return clip(actor.id, 24);
    let raw = '';
    try { raw = nameOf(actor.id); } catch { raw = ''; }
    const name = typeof raw === 'string' && raw.trim() ? raw.trim() : actor.id;
    return clip(name, 24);
  }

  function boardNames(t) {
    const to = Array.isArray(t.to) ? t.to.filter(item => typeof item === 'string' && item.trim()) : [];
    const claimType = typeof t.claimedByType === 'string' ? t.claimedByType : '';
    return { from: boardActor(t.from), claim: boardActor(t.claimedBy, claimType), candidates: to };
  }

  function boardStage(t, names) {
    const review = typeof t.review === 'string' ? t.review : '';
    const state = typeof t.state === 'string' ? t.state : '';
    if (review === 'accepted') return 'accepted';
    if (state === 'failed') return 'failed';
    if (review === 'submitted') return 'submitted';
    if (review === 'sent_back') return 'returned';
    if (state === 'completed') return 'completed';
    if (!names.claim) return names.candidates.length === 1 ? 'ask' : 'open';
    if (state === 'waiting-human') return 'waiting';
    if (state === 'blocked') return 'blocked';
    if (state === 'waiting-timeout') return 'timeout';
    if (state === 'uncertain') return 'uncertain';
    return 'claimed';
  }

  function boardWorker(stage, names) {
    if (stage === 'ask') return boardActor(names.candidates[0], '');
    const busy = ['claimed', 'failed', 'blocked', 'waiting', 'timeout', 'uncertain', 'submitted', 'returned'];
    return busy.includes(stage) ? names.claim : null;
  }

  // 验收只留发起人的脸；外部和本人不放进可画头像的名单。
  function boardFaces(stage, from, worker) {
    const rows = [];
    const push = (actor, role) => {
      if (!actor || actor.type === 'external' || actor.type === 'owner') return;
      rows.push({ id: actor.id, type: actor.type || '', role });
    };
    const both = stage === 'ask' || stage === 'submitted' || stage === 'returned' || stage === 'waiting';
    const onlyFrom = stage === 'accepted' || stage === 'open';
    const onlyWorker = ['claimed', 'failed', 'blocked', 'timeout', 'uncertain'].includes(stage);
    if (both || onlyFrom) push(from, 'from');
    const same = from && worker && worker.id === from.id && worker.type === from.type;
    if ((both || onlyWorker) && worker && !same) push(worker, 'to');
    return rows;
  }

  function boardLine(stage, jia, yi) {
    const j = jia || '';
    const y = yi || '';
    if (stage === 'ask') {
      if (j && y) return j + '请' + y + '帮忙';
      if (y) return '请' + y + '帮忙';
      return j ? j + '发出，还没人领' : '还没人领';
    }
    if (stage === 'claimed') return y ? y + '已接手' : '已接手';
    if (stage === 'submitted') {
      if (y && j) return y + '交回，等' + j + '看';
      if (y) return y + '交回，等验收';
      if (j) return '交回了，等' + j + '看';
      return '交回了，等验收';
    }
    if (stage === 'accepted') return j ? j + '已验收' : '已验收';
    if (stage === 'returned') {
      if (j && y) return j + '退回，等' + y + '再做';
      if (y) return '已退回，等' + y + '再做';
      if (j) return j + '退回了';
      return '已退回';
    }
    if (stage === 'failed') return y ? y + '这张没做成' : '这张没做成';
    if (stage === 'blocked') return y ? y + '卡住了' : '卡住了';
    if (stage === 'waiting') {
      if (y && j) return y + '在等' + j + '回话';
      if (y) return y + '在等人回话';
      return '等人回话';
    }
    if (stage === 'timeout') return y ? y + '这张过了时限' : '过了时限还在等';
    if (stage === 'uncertain') return y ? y + '拿不准' : '拿不准';
    if (stage === 'completed') return '已标完成';
    return j ? j + '发出，还没人领' : '还没人领';
  }

  function boardReportText(t) {
    const one = value => value && typeof value === 'object' && typeof value.summary === 'string' &&
      value.summary.trim() ? value : null;
    const report = one(Array.isArray(t.report) ? t.report.at(-1) : t.report);
    const picked = report || one(Array.isArray(t.reports) ? t.reports.at(-1) : null);
    return picked ? { text: picked.summary.trim(), own: picked.selfReported === true } : null;
  }

  function boardSummary(t) {
    const report = boardReportText(t);
    if (report) return clip(report.text, 300) + (report.own ? '（交回时自己写的）' : '');
    if (typeof t.goal === 'string' && t.goal.trim()) return clip(t.goal.trim(), 300);
    const progress = Array.isArray(t.progress) ? t.progress : [];
    for (let i = progress.length - 1; i >= 0; i -= 1) {
      const text = progress[i] && typeof progress[i].text === 'string' ? progress[i].text.trim() : '';
      if (text) return clip(text, 300);
    }
    return '没有';
  }

  function boardByType(t, by) {
    if (t.claimedBy === by && t.claimedByType === 'external') return 'external';
    if (t.from && typeof t.from === 'object' && t.from.name === by && t.from.type === 'external') return 'external';
    if (t.claimedBy === by && t.claimedByType === 'owner') return 'owner';
    if (t.from && typeof t.from === 'object' && t.from.name === by && t.from.type === 'owner') return 'owner';
    return '';
  }

  function boardVerified(t, nameOf) {
    const rows = Array.isArray(t.verification) ? t.verification.filter(item => item && typeof item === 'object') : [];
    if (!rows.length) return '还没有核验记录';
    const verdicts = { pass: '通过', fail: '没过', partial: '部分通过' };
    return rows.slice(-5).map(item => {
      const by = typeof item.by === 'string' ? item.by.trim() : '';
      const who = by ? boardShown(boardActor(by, boardByType(t, by)), nameOf) : '';
      const verdict = verdicts[item.verdict] || '结果不明';
      const note = typeof item.note === 'string' && item.note.trim() ? clip(item.note.trim(), 80) : '';
      return [who, verdict, note].filter(Boolean).join(' · ');
    }).join('；');
  }

  function boardChecks(t) {
    return (Array.isArray(t.acceptance) ? t.acceptance : []).map(item => {
      if (!item || typeof item !== 'object') return '';
      const check = typeof item.check === 'string' ? item.check.trim() : '';
      const expect = typeof item.expect === 'string' ? item.expect.trim() : '';
      if (!check && !expect) return '';
      const head = clip(check || '一项条件', 40);
      return expect ? head + '（应是 ' + clip(expect, 40) + '）' : head;
    }).filter(Boolean);
  }

  function boardUnmet(t, stage, names, nameOf) {
    const parts = [];
    const ask = t.open_ask && typeof t.open_ask === 'object' && typeof t.open_ask.text === 'string'
      ? t.open_ask.text.trim() : '';
    if (ask) parts.push('还在问：' + clip(ask, 80));
    if (stage === 'returned') parts.push('退回之后还没再交');
    if (stage === 'submitted') parts.push('还等发起的人看过');
    if (stage === 'ask') parts.push('点了名，还没接手');
    if (stage === 'open' && names.candidates.length) {
      const listed = names.candidates.map(id => boardShown(boardActor(id, ''), nameOf)).filter(Boolean);
      if (listed.length) parts.push('候选还没接手：' + listed.join('、'));
    }
    const checks = boardChecks(t);
    if (checks.length) parts.push('这些条件没有逐条核验记录：' + checks.join('、'));
    const rows = Array.isArray(t.verification) ? t.verification.filter(item => item && typeof item === 'object') : [];
    const last = rows.at(-1);
    if (last && (last.verdict === 'fail' || last.verdict === 'partial')) {
      const note = typeof last.note === 'string' && last.note.trim() ? '：' + clip(last.note.trim(), 80) : '';
      parts.push('最近一次没全部过' + note);
    }
    if (!parts.length) return stage === 'accepted' || rows.length ? '没有另列没验的' : '整单还没核验';
    return clip(parts.join('。'), 360);
  }

  function boardCardView(t, nameOf) {
    const names = boardNames(t);
    const stage = boardStage(t, names);
    const worker = boardWorker(stage, names);
    return {
      line: boardLine(stage, boardShown(names.from, nameOf), boardShown(worker, nameOf)),
      faces: boardFaces(stage, names.from, worker),
      detail: [
        { label: '摘要', text: boardSummary(t) },
        { label: '怎么验的', text: boardVerified(t, nameOf) },
        { label: '没验的', text: boardUnmet(t, stage, names, nameOf) }
      ]
    };
  }

  // 格式化已知 token 数。
  function formatTokenCount(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '未知';
    if (n < 10000) return n.toLocaleString('en-US');
    return String(Number((n / 10000).toFixed(1))) + ' 万';
  }

  // 区分已上报的用量和未知用量。
  function bucketTokens(bucket) {
    if (!bucket || typeof bucket !== 'object') return { known: false, total: null, unreported: 0, parts: {} };
    const keys = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];
    const parts = Object.fromEntries(keys.slice(0, 4).map(k => [k,
      typeof bucket.tokens?.[k] === 'number' && Number.isFinite(bucket.tokens[k]) ? bucket.tokens[k] : null]));
    const counts = keys.map(k => Number.isFinite(bucket.unreportedFields?.[k]) ? bucket.unreportedFields[k] : 0);
    // 只数缺输入或输出的调用。不少模型从不报缓存写、推理 token，按五项取最大会把每次都算成「没上报」。
    const unreported = Math.max(0, counts[0], counts[3]);
    const known = Number.isSafeInteger(bucket.calls) && bucket.calls > 0 && !counts.every(n => n >= bucket.calls);
    const sum = keys.reduce((n, k) => n + (Number.isFinite(bucket.tokens?.[k]) ? bucket.tokens[k] : 0), 0);
    const total = known ? sum : null;
    return { known, total, unreported, parts };
  }

  // 将账本费用翻译为可读文本。
  function bucketCost(bucket) {
    if (!bucket || !(bucket.calls > 0)) return [];
    const cost = bucket.cost || {};
    const amount = (currency, n) => {
      const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency + ' ';
      return symbol + (n > 0 && n < 0.01 ? '<0.01' : Number(n).toFixed(2));
    };
    const rows = [];
    for (const [currency, value] of Object.entries(cost.byCurrency || {})) {
      if (value?.ok > 0) rows.push(amount(currency, value.ok));
      if (value?.expired > 0) rows.push('价表过期 ' + amount(currency, value.expired));
    }
    if (cost.pendingCalls > 0) rows.push(cost.pendingCalls + ' 次待计价');
    if (cost.planCalls > 0) {
      rows.push('套餐内 ' + cost.planCalls + ' 次');
      const ref = cost.planReference;
      if (ref && typeof ref.currency === 'string' && Number.isFinite(ref.amount)) {
        rows.push('折算参考 ' + amount(ref.currency, ref.amount));
      }
    }
    if (cost.localCalls > 0) rows.push('本地 ' + cost.localCalls + ' 次');
    return rows.length ? rows : ['费用未知'];
  }

  // 显示单个会话的调用和用量。
  function usageLine(bucket) {
    if (!bucket || typeof bucket !== 'object') return '本会话用量暂无';
    if (bucket.calls === 0) return '本会话还没有模型调用';
    const usage = bucketTokens(bucket);
    const tokens = formatTokenCount(usage.total) +
      (usage.known && usage.unreported > 0 ? '（有 ' + usage.unreported + ' 次未上报）' : '');
    const costs = bucketCost(bucket);
    return '本会话已用 ' + tokens + ' token · ' + (bucket.calls ?? '未知') + ' 次调用' +
      (costs.length ? ' · ' + costs.join(' / ') : '');
  }

  // 按已知用量排序账本分组。
  function ledgerRows(group, nameOf = id => id, limit = Infinity) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return [];
    const aliases = { '(无助理)': '未归助理', '(无工单)': '未归工单', '(无会话)': '未归会话' };
    return Object.entries(group).map(([key, bucket]) => {
      const usage = bucketTokens(bucket);
      return { key, label: aliases[key] || nameOf(key), calls: bucket?.calls ?? '未知',
        tokens: formatTokenCount(usage.total), cost: bucketCost(bucket).join(' / '), total: usage.total };
    }).sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity) || 0)
      .slice(0, limit).map(({ total, ...row }) => row);
  }

  // 规范化讨论组列表。
  function normalizeGroups(data) {
    const rows = Array.isArray(data) ? data : data?.groups;
    if (!Array.isArray(rows)) return [];
    return rows.filter(g => g && typeof g.id === 'string' && g.status !== 'cancelled').map(g => ({
      id: g.id, title: g.name || g.title || '',
      status: ['active', 'paused', 'done'].includes(g.status) ? g.status : 'active',
      host: typeof g.host === 'string' ? g.host : '',
      members: (Array.isArray(g.members) ? g.members : []).map(m => typeof m === 'string' ? { bot: m } :
        { ...m, bot: m?.id || m?.bot })
        .filter(m => m && typeof m.bot === 'string').slice(0, 12),
      lastText: typeof g.lastText === 'string' ? g.lastText : '', updatedAt: g.updatedAt,
      unread: Number.isSafeInteger(g.unread) && g.unread >= 0 ? g.unread : 0
    })).sort(sortRecent);
  }

  // 规范化并稳定排序讨论组消息。
  function normalizeGroupMessages(data) {
    const rows = Array.isArray(data) ? data : data?.messages;
    if (!Array.isArray(rows)) return [];
    const safe = n => Number.isSafeInteger(n) && n >= 0;
    return rows.map((m, i) => {
      if (!m || typeof m.text !== 'string' || !m.text) return null;
      const seq = safe(m.seq) ? m.seq : safe(m.id) ? m.id : null;
      return { id: typeof m.id === 'string' ? m.id : seq !== null ? String(seq) : 'm' + i,
        seq, from: typeof m.from === 'string' ? m.from : 'system', text: clip(m.text, 4000),
        ts: m.ts, kind: typeof m.kind === 'string' ? m.kind : '' };
    }).filter(Boolean).sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || 0);
  }

  // 生成三类确认卡的人话与分工表。
  function plainCardInfo(c, nameOf) {
    if (!c || typeof c !== 'object') return null;
    const kind = c.kind === 'group_plan' || ['group_create', 'group_plan'].includes(c.tool) ? 'group' :
      ['meeting_run', 'meeting_morning', 'meeting_evening'].includes(c.tool) ? 'meeting' :
        ['kb_contribute', 'kb_submit', 'kb_deposit'].includes(c.tool) || c.kind === 'kb-submit' ? 'kb' : '';
    if (!kind) return null;
    const name = typeof nameOf === 'function' ? nameOf : id => id === c.bot ? c.botName || '助理' : id;
    const who = typeof nameOf === 'function' ? name(c.bot) : c.botName || '助理';
    const topic = c.plan?.title || c.title || '';
    const title = kind === 'group' ? who + '想拉一个讨论组' + (topic ? '：' + topic : '') :
      kind === 'meeting' ? who +
        (c.tool === 'meeting_morning' || c.kind === 'morning' ? '想开晨会' : '想开晚会') :
        who + '想把这份东西投进知识库';
    const defaults = kind === 'group' ?
      ['建一个组并按分工表开工', '讨论组里（项目页和工单都在组里）'] :
      kind === 'meeting' ? ['让每个助理说一条今天学到的', '各助理自己的会话里'] :
        ['把整理好的纪要投进知识库收件箱', '知识库收件箱（只投递，不直接改正文）'];
    const rows = [['做什么', c.what || c.action || defaults[0]], ['在哪做', c.where || c.path || defaults[1]],
      ['为什么', c.why || '助理没写原因']].map(([label, text]) =>
      [label, clip(text, 200).replace(new RegExp('^' + label + '\\s*[：:]\\s*'), '')]);
    let table = null;
    if (kind === 'group' && c.plan && typeof c.plan === 'object') {
      table = [{ kind: 'host', text: '主持：' + (name(c.plan.host) || '') }];
      for (const m of (Array.isArray(c.plan.members) ? c.plan.members : []).slice(0, 12)) {
        const bot = typeof m === 'string' ? m : m?.bot;
        table.push({ kind: 'member', text: (name(bot) || '') + (m?.role ? ' · ' + m.role : '') });
      }
      for (const t of (Array.isArray(c.plan.tickets) ? c.plan.tickets : []).slice(0, 12)) {
        const count = Array.isArray(t?.checklist) ? t.checklist.length : 0;
        const text = (t?.title || '') + '：' + (name(t?.assignee) || '') + ' 做，' +
          (name(t?.verifier) || '') + ' 验' + (count ? '，验收 ' + count + ' 条' : '');
        table.push({ kind: 'ticket', text });
      }
    }
    const always = [c.actions, c.choices].some(list =>
      Array.isArray(list) && list.some(a => a?.id === 'approve-always'));
    const preview = typeof c.bodyPreview === 'string' ? c.bodyPreview : '';
    return { kind, title, rows, table, preview, rememberable: c.rememberable === true || always };
  }

  // 读取当前助理的模型显示名称。
  // 入参是 GET /models/bots/<助理> 的返回 {default, options:[{ref,name,available}]}，兼容旧形状。
  function modelLabelFor(models, bot) {
    if (Array.isArray(models?.options)) {
      const hit = models.options.find(m => m && m.ref === models.default);
      if (typeof models.default !== 'string' || !hit || typeof hit.name !== 'string') return '';
      return clip(hit.name, 24) + (hit.available === false ? '（不在线）' : '');
    }
    const id = models?.defaults?.[bot];
    const item = Array.isArray(models?.models) ? models.models.find(m => m && m.id === id) : null;
    if (typeof id !== 'string' || !item || typeof item.label !== 'string') return '';
    return clip(item.label, 24) + (item.online === false ? '（不在线）' : '');
  }
  // until 是东京日历日期；该日期整天有效，显示时不转成本地时区的午夜。
  function grantUntil(days, now = Date.now()) {
    const day = new Date(Number(now) + 9 * 60 * 60 * 1000);
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
  }
  function grantDateText(until, now = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '') || !Number.isFinite(Date.parse(until + 'T00:00:00Z')) || new Date(until + 'T00:00:00Z').toISOString().slice(0, 10) !== until) return '到期日待核';
    const [year, month, day] = until.split('-').map(Number);
    const currentYear = new Date(Number(now) + 9 * 60 * 60 * 1000).getUTCFullYear();
    return '到 ' + (year !== currentYear ? year + ' 年 ' : '') + month + ' 月 ' + day + ' 日为止';
  }
  function permissionExpiry(grant, now = Date.now()) {
    const text = grantDateText(grant.until, now);
    return grant.status === 'expired' ? '已过期（' + text + '）' : grant.status === 'revoked' ? '已撤销（' + text + '）' : text + ' · 有效';
  }
  // ===== r28 路35：界面入口用的纯函数。后端来的文字（工单、组消息、纪要、规矩页、全文）一律只当纯文本。 =====
  const DIGEST_RE = /^[a-f0-9]{64}$/;
  // 判断是不是合法的全文校验和（sha256 十六进制）。
  function isDigest(value) { return typeof value === 'string' && DIGEST_RE.test(value); }
  // 去掉控制字符（保留换行与制表）并截断；只用于当文本显示。
  function plainText(value, length = 400) {
    return Array.from(String(value ?? '').replace(/(?![\n\t])[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')).slice(0, length).join('');
  }
  // 单行文字：先去掉控制字符与换行，再截断。
  function plainLine(value, length = 160) {
    return plainText(value, length * 4).replace(/\s+/g, ' ').trim().slice(0, length);
  }
  const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const asList = value => (Array.isArray(value) ? value : []);

  const PANIC_STEP_NAMES = { marker: '停机标记', state: '状态落盘', gate: '会话闸门', sessions: '在跑的会话',
    dispatch: '外包任务' };
  const PANIC_TIMER_NAMES = { meetings: '晨晚会定时', groups: '讨论组定时', routines: '固定任务定时' };
  // 一键全停的步骤名翻成人话；不认识的名字原样当文本显示。
  function panicStepName(key) {
    const text = String(key ?? '');
    if (Object.hasOwn(PANIC_STEP_NAMES, text)) return PANIC_STEP_NAMES[text];
    if (text.startsWith('timer:')) {
      const name = text.slice(6);
      return Object.hasOwn(PANIC_TIMER_NAMES, name) ? PANIC_TIMER_NAMES[name] : '定时：' + plainLine(name, 30);
    }
    return plainLine(text, 40) || '未知步骤';
  }
  // 整理 /panic/status（以及 stop/resume 的返回）。state 只认 running、stopped、partial，别的一律算「不明」。
  function panicView(data) {
    if (!isPlainObject(data) || !['running', 'stopped', 'partial'].includes(data.state)) return null;
    const steps = isPlainObject(data.steps) ? data.steps : {};
    const failed = Object.entries(steps).filter(([, step]) => step?.status === 'failed').slice(0, 12)
      .map(([key, step]) => ({ key: plainLine(key, 40), name: panicStepName(key),
        reason: plainLine(step?.detail, 120) }));
    const all = Object.entries(steps).slice(0, 20).map(([key, step]) => ({ key: plainLine(key, 40),
      name: panicStepName(key), status: ['ok', 'absent', 'failed'].includes(step?.status) ? step.status : 'unknown',
      detail: plainLine(step?.detail, 120) }));
    const live = isPlainObject(data.live) ? data.live : {};
    const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
    return { state: data.state, reason: plainLine(data.reason, 200), since: data.since ?? null, failed, steps: all,
      live: { sessions: count(live.runningSessions), external: count(live.runningExternal) } };
  }

  // 「今天」一页：把 /today 整理成若干段，每段 {id,title,available,note,lines,block}。数字都是后端算好的，这里只排版。
  function todayCostText(cost) {
    if (!isPlainObject(cost)) return '费用未知';
    const amounts = Object.entries(isPlainObject(cost.amounts) ? cost.amounts : {})
      .filter(([, value]) => Number.isFinite(value))
      .map(([currency, value]) => plainLine(currency, 8) + ' ' + String(Math.round(value * 100) / 100));
    const label = plainLine(cost.label, 20) || '费用未知';
    return (amounts.length ? amounts.join(' / ') + ' · ' : '') + label;
  }
  function todayUsageLine(row, label) {
    const tokens = Number.isFinite(row?.tokenTotal) ? formatTokenCount(row.tokenTotal) + ' token' : '未知 token';
    const missing = Number.isSafeInteger(row?.unreportedCalls) && row.unreportedCalls > 0
      ? '（' + row.unreportedCalls + ' 次没上报 token）' : '';
    const calls = Number.isSafeInteger(row?.calls) ? row.calls + ' 次调用' : '调用数未知';
    return [label, calls, tokens + missing, todayCostText(row?.cost)].join(' · ');
  }
  function todayView(data, nameOf = id => id) {
    if (!isPlainObject(data)) return null;
    const section = (id, title, source, build) => {
      if (!isPlainObject(source) || source.available === false) {
        return { id, title, available: false, note: '', lines: [], block: '' };
      }
      try {
        const built = build(source);
        return { id, title, available: true, note: built.note || '', lines: built.lines || [],
          block: built.block || '' };
      } catch {
        return { id, title, available: false, note: '', lines: [], block: '' };
      }
    };
    const who = id => plainLine(nameOf(id), 30) || '助理';
    const sections = [];
    sections.push(section('approvals', '等你点头', data.approvals, source => ({
      note: source.cardsSource === 'unavailable' ? '待批卡的通道没接通，这里的数字不全' : '',
      lines: [...asList(source.cards).slice(0, 30).map(card => who(card?.assistant) + ' · ' +
        (plainLine(card?.title, 80) || '（无标题）')),
      ...asList(source.kbDrafts).slice(0, 30).map(draft => '投知识库 · ' + (plainLine(draft?.project, 40) || '未分项目') +
        ' · ' + plainLine(draft?.summary, 100))]
    })));
    sections.push(section('waiting', '卡住的和等着的', data.waiting, source => {
      const row = (label, item) => label + ' · ' + who(item?.assistant) + ' · ' +
        (plainLine(item?.title, 60) || '（无标题）') + (item?.reason ? ' · ' + plainLine(item.reason, 80) : '');
      return { lines: [...asList(source.blocked).slice(0, 20).map(item => row('卡住', item)),
        ...asList(source.waitingAnswer).slice(0, 20).map(item => row('等你回答', item)),
        ...asList(source.awaitingReview).slice(0, 20).map(item => row('等验收', item))] };
    }));
    sections.push(section('done', '昨天做完的', data.yesterdayDone, source => ({
      note: '成果摘要是助理自述，没有自动验收',
      lines: asList(source.byAssistant).slice(0, 12).flatMap(group => [
        who(group?.id) + ' · ' + (Number(group?.count) || 0) + ' 件',
        ...asList(group?.items).slice(0, 10).map(item => '　' + (plainLine(item?.title, 60) || '（无标题）') +
          (item?.summary ? '：' + plainLine(item.summary, 100) : ''))])
    })));
    sections.push(section('usage', '昨天用量', data.yesterdayUsage, source => ({
      lines: [...asList(source.byAssistant).slice(0, 12).map(row => todayUsageLine(row, who(row?.id))),
        ...(isPlainObject(source.total) ? [todayUsageLine(source.total, '合计')] : [])]
    })));
    sections.push(section('minutes', '最近一次晚会纪要', data.lastEveningMinutes, source => ({
      note: source.date ? plainLine(source.date, 12) + (source.truncated ? '（太长，只显示前面一段）' : '') : '',
      block: plainText(source.text, 6000)
    })));
    sections.push(section('routines', '今天的固定任务', data.routines, source => ({
      note: source.paused === true ? '固定任务现在是暂停的' : '',
      lines: asList(source.items).slice(0, 30).map(item => (plainLine(item?.name, 40) || '（未命名）') + ' · ' +
        who(item?.assistant) + ' · ' + plainLine(item?.at, 8) + ' · ' + routineStateText(item))
    })));
    return { date: plainLine(data.date, 12), sections, lead: todayLead(data) };
  }

  // 首句只显示后端选中的一件。对不上、或缺了更高一档的数，就说读不到，不改口说没事。
  function todayLead(data) {
    const unread = { status: 'unread', text: '暂时读不到', id: '', place: '' };
    const clear = { status: 'clear', text: '今天没有等你处理的事', id: '', place: '' };
    const raw = isPlainObject(data?.headline) ? data.headline : null;
    if (!raw || raw.status === 'unread') return unread;
    const waiting = isPlainObject(data.waiting) ? data.waiting : null;
    const approvals = isPlainObject(data.approvals) ? data.approvals : null;
    const results = isPlainObject(data.checkedResults) ? data.checkedResults : null;
    const waitingOk = !!waiting && waiting.available === true && Array.isArray(waiting.waitingAnswer);
    const answers = waitingOk ? asList(waiting.waitingAnswer).filter(item => plainLine(item?.id, 80)) : [];
    const answerIds = waitingOk ? asList(waiting.waitingAnswer).map(item => plainLine(item?.id, 80)) : [];
    const nodsOk = !!approvals && approvals.available === true && approvals.cardsSource === 'live';
    const nodIds = nodsOk ? [...asList(approvals.cards), ...asList(approvals.kbDrafts)]
      .map(item => plainLine(item?.id, 80)).filter(Boolean) : [];
    const resultsOk = !!results && results.available === true && Array.isArray(results.items);
    const resultIds = resultsOk ? asList(results.items).map(item => plainLine(item?.id, 80)).filter(Boolean) : [];
    if (!waitingOk) return unread;
    if (raw.status === 'clear') {
      if (!nodsOk || !resultsOk || answers.length || nodIds.length || resultIds.length) return unread;
      return clear;
    }
    if (raw.status !== 'item') return unread;
    const id = plainLine(raw.id, 80);
    const place = ['question', 'card', 'result'].includes(raw.place) ? raw.place : '';
    const text = plainLine(raw.text, 400);
    const kind = plainLine(raw.kind, 20);
    if (!id || !place || !text) return unread;
    if (place === 'question') return answerIds.includes(id)
      ? { status: 'item', text, id, place, kind } : unread;
    if (place === 'card') {
      if (!nodsOk || answers.length || !nodIds.includes(id)) return unread;
      return { status: 'item', text, id, place, kind };
    }
    if (place === 'result') {
      if (!nodsOk || !resultsOk || answers.length || nodIds.length || !resultIds.includes(id)) return unread;
      return { status: 'item', text, id, place, kind };
    }
    return unread;
  }

  // 固定任务：今天的状态翻成人话。
  const ROUTINE_STATES = { pending: '还没到点', off: '今天不跑', started: '正在跑', reported: '已回报', blocked: '卡住了',
    incomplete: '没做完', timeout: '超时了', failed: '没跑成', interrupted: '被打断', 'skipped-quiet': '安静时段没跑',
    'skipped-busy': '上一份还在跑', 'skipped-paused': '暂停中没跑', 'skipped-duplicate': '今天已经跑过', missed: '错过了' };
  function routineStateText(item) {
    if (item?.paused === true) return '已暂停';
    if (item?.running === true) return '正在跑';
    const state = String(item?.todayState ?? '');
    return Object.hasOwn(ROUTINE_STATES, state) ? ROUTINE_STATES[state] : '状态未知';
  }
  const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
  function routineDaysText(days) {
    if (days === 'daily') return '每天';
    const list = asList(days).filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
    return list.length ? '每周' + list.map(day => WEEK_DAYS[day - 1]).join('、') : '';
  }
  const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
  // 整理 GET /routines；id 不合规矩的行只显示、不给按钮。
  function routineView(data, nameOf = id => id) {
    if (!isPlainObject(data) || !Array.isArray(data.items)) return null;
    const items = data.items.slice(0, 50).filter(isPlainObject).map(item => ({
      id: ID_RE.test(String(item.id ?? '')) ? String(item.id) : '',
      title: plainLine(item.name, 40) || '（未命名）', who: plainLine(nameOf(item.assistant), 30) || '助理',
      when: [routineDaysText(item.days), plainLine(item.at, 8)].filter(Boolean).join(' '),
      state: routineStateText(item), paused: item.paused === true, running: item.running === true,
      done: plainLine(item.done, 120), ticket: plainLine(item.todayTicket, 40) }));
    const invalid = asList(data.invalid).slice(0, 10).filter(isPlainObject)
      .map(row => plainLine(row.id, 30) + '：' + plainLine(row.reason, 80));
    return { paused: data.paused === true, enabled: data.enabled !== false, items, invalid };
  }
  // 手动跑一次、暂停、恢复的返回翻成一句人话。
  function routineActionText(action, status, data) {
    const state = isPlainObject(data) ? String(data.state ?? '') : '';
    if (status === 404 || state === 'not-found') return '没找到这条固定任务';
    if (action === 'pause') return state === 'paused' ? '已暂停' : '这次没暂停成';
    if (action === 'resume') return state === 'resumed' ? '已恢复' : '这次没恢复成';
    if (status === 200 && ['reported', 'started'].includes(state)) return '已经跑了一次，状态：' +
      (state === 'reported' ? '已回报' : '正在跑');
    if (Object.hasOwn(ROUTINE_STATES, state)) return '这次没有跑起来：' + ROUTINE_STATES[state];
    return status === 0 ? '没连上服务，状态不明，请刷新看看' : '这次没有跑起来';
  }

  // 晨会晚会：把 /meetings/status 与纪要整理成可显示的数据。
  const MEETING_LABELS = { morning: '晨会', evening: '晚会' };
  function meetingView(status, minutes) {
    if (!isPlainObject(status)) return null;
    const times = isPlainObject(status.times) ? status.times : {};
    const today = isPlainObject(status.today) ? status.today : {};
    return {
      times: { morning: plainLine(times.morning, 8), evening: plainLine(times.evening, 8) },
      done: { morning: today.morning === true, evening: today.evening === true },
      running: asList(status.running).length > 0,
      pending: Number.isSafeInteger(status.pendingCount) ? status.pendingCount : 0,
      minutes: asList(minutes).filter(isPlainObject).filter(item => MEETING_LABELS[item.type])
        .map(item => ({ type: item.type, label: MEETING_LABELS[item.type], text: plainText(item.text, 8000) }))
    };
  }
  // 晚会 run 的返回翻成一句话。
  function meetingRunText(status, data) {
    if (status === 409) return '这场已经在开了，请稍等';
    if (status === 200 && isPlainObject(data)) {
      if (!data.file) return '晚会开了，但没写出纪要（可能没配纪要目录）';
      const cards = asList(data.cards).length;
      return '晚会开完了，纪要已写' + (cards ? '；有 ' + cards + ' 张投知识库的卡等你点头' : '');
    }
    return status === 0 ? '没等到回执，晚会可能还在开，过一会儿再刷新看纪要' : '晚会没开成';
  }
  // 日期字符串前后挪几天（只处理 YYYY-MM-DD，其余返回空）。
  function shiftDate(date, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return '';
    const ms = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(ms)) return '';
    return new Date(ms + days * 86400000).toISOString().slice(0, 10);
  }

  // 规矩页（只读）：后端的真实读取接口还没有，这里按约定形状容错整理；形状不对就是 null（显示暂无）。
  function ruleLines(value) {
    const raw = typeof value === 'string' ? value.split('\n') : isPlainObject(value)
      ? ruleLines(value.lines ?? value.text ?? []) : asList(value);
    return raw.slice(0, 100).map(line => {
      if (typeof line === 'string') return plainLine(line, 400);
      if (!isPlainObject(line)) return '';
      return [plainLine(line.date, 12), plainLine(line.text ?? line.rule, 300),
        line.quote ? '「' + plainLine(line.quote, 200) + '」' : ''].filter(Boolean).join(' ');
    }).filter(Boolean);
  }
  function rulesView(data, nameOf = id => id) {
    if (!isPlainObject(data)) return null;
    const bots = Array.isArray(data.bots) ? data.bots : isPlainObject(data.bots)
      ? Object.entries(data.bots).map(([id, value]) =>
        ({ id, ...(isPlainObject(value) ? value : { lines: value }) })) : [];
    return { shared: ruleLines(data.shared),
      bots: bots.slice(0, 30).filter(isPlainObject).map(bot => ({ id: plainLine(bot.id, 30),
        name: plainLine(nameOf(bot.id) || bot.name, 30) || '助理', lines: ruleLines(bot.lines ?? bot.text) })) };
  }

  // 新会话选模型：只有后端明确说「开关开着」才给出可选项，没说或说关着一律不显示。
  function modelPickView(data) {
    if (!isPlainObject(data) || data.enabled !== true) return null;
    if (!Array.isArray(data.options) || !data.options.length) return null;
    return {
      default: typeof data.default === 'string' ? data.default : '',
      options: data.options.slice(0, 40).filter(item => isPlainObject(item) && typeof item.ref === 'string' && item.ref)
        .map(item => ({ ref: item.ref.slice(0, 200), name: plainLine(item.name ?? item.ref, 40),
          selectable: item.selectable === true, chatOnly: item.chatOnly === true,
          reason: plainLine(item.reason, 60),
          window: Number.isFinite(item.window) && item.window > 0 ? Math.round(item.window / 1000) + 'K' : '' }))
    };
  }
  // 建会话失败时给用户看的一句话（后端的错误文字当纯文本，截短）。
  function modelErrorText(error) {
    const message = plainLine(error?.payload?.error?.message, 80);
    return message ? '这个模型现在选不了：' + message : '这个模型现在选不了，会话没有建出来';
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { markdown, escapeHTML, previewText, messageDate, friendlyError, eventParser, sortTimeline, surfaceEntries, toolText, approvalTitle, toolRun, userText, approvalWhy, approvalResult, delegationSummary, delegationLabel, delegationSteps, canContinue, stoppedTurn, stoppedSession, shortPath, outputPreview, BOTS, rosterTool, rosterChanges, validateName, validateAvatarFile, normalizeRoster, grantUntil, grantDateText, permissionExpiry };
  if (typeof module !== 'undefined' && module.exports) Object.assign(module.exports, {
    isLegacyTicket, boardColumn, BOARD_COLUMNS, boardColumns, boardCardInfo, formatTokenCount, bucketTokens,
    bucketCost, usageLine, ledgerRows, normalizeGroups, normalizeGroupMessages, plainCardInfo, modelLabelFor
  });
  if (typeof module !== 'undefined' && module.exports) Object.assign(module.exports, {
    isDigest, plainText, plainLine, panicStepName, panicView, todayView, routineView, routineStateText,
    routineActionText, meetingView, meetingRunText, shiftDate, rulesView, modelPickView, modelErrorText
  });
  if (typeof window === 'undefined' || !window.Hub) return;
  const H = window.Hub, S = H.state;
  const flatHome = typeof H.openFeature === 'function' && typeof H.featureOwner === 'function';
  const extState = new Map();
  let groups = [];
  const modelsByBot = new Map();
  let groupTarget = '';
  let groupTimer = null;
  let groupRenderVersion = 0;
  // r28 路35：新入口的状态（选模型的选择、全停状态、全文缓存、两下确认）。
  const r28 = { pick: new Map(), pickTarget: '', panic: null, banner: null, armed: new Map(), busy: new Set(),
    fullText: new Map(), fullOpen: new Set(), hosts: new Map(), meetingDate: '', modelAsked: new Map() };

  async function extFetch(path, options = {}) {
    try {
      const headers = { ...options.headers };
      if (options.method === 'POST') headers['Content-Type'] = 'application/json';
      const response = await fetch('/bff' + path, {
        credentials: 'same-origin', cache: 'no-store', ...options, headers,
        signal: options.signal || AbortSignal.timeout(12000)
      });
      if (!response.ok) return { ok: false, status: response.status };
      try {
        return { ok: true, data: await response.json() };
      } catch {
        return { ok: false, status: -1 };
      }
    } catch {
      return { ok: false, status: 0 };
    }
  }

  async function extGet(name, path, { force = false, ttl = 10000 } = {}) {
    try {
      if (mode !== 'real') return { ok: false };
      const key = name + '|' + path;
      const state = extState.get(key) || { absentUntil: 0, at: 0, data: null };
      extState.set(key, state);
      const now = Date.now();
      if (!force && now < state.absentUntil) return { ok: false, skipped: true };
      if (!force && state.data !== null && now - state.at < ttl) {
        return { ok: true, data: state.data, cached: true };
      }
      const result = await extFetch(path);
      if (result.ok) {
        state.absentUntil = 0;
        state.at = Date.now();
        state.data = result.data;
      } else if ([0, 404, 501, 502, 503, -1].includes(result.status)) {
        state.absentUntil = Date.now() + 60000;
      }
      return result;
    } catch {
      return { ok: false };
    }
  }

  async function refreshGroups({ force = false } = {}) {
    try {
      const result = await extGet('groups', '/groups', { force, ttl: 4000 });
      if (result.ok && (Array.isArray(result.data) || Array.isArray(result.data?.groups))) {
        groups = normalizeGroups(result.data);
      }
    } catch {}
  }

  async function loadModels() {
    try {
      const bot = S.bot;
      if (!isBot(bot)) return;
      const result = await extGet('models', '/models/bots/' + encodeURIComponent(bot), { ttl: 30000 });
      if (result.ok) modelsByBot.set(bot, result.data);
    } catch {}
  }
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  let mode = read('hub-web-mode-v1', 'real') === 'demo' ? 'demo' : 'real';
  let r29Hooks = null;
  let r29ScrollOn = false;
  let r29HoldSend = false;
  let coldRoute = null;
  try { coldRoute = JSON.parse(read('hub-real-route-v1', 'null')); } catch {}
  const originals = { post: H.postMessage, conversations: H.conversationsHTML, navigate: H.navigate, capability: H.runCapability };
  const records = new Map(), remoteRecords = new Map(), selected = new Map(), jobs = new Map(), demo = new Map();
  const botPhase = new Map(), epochs = new Map(), turns = [];
  const serverRunning = new Map(), serverUnread = new Map(), serverPending = new Map(), delegated = new Map(), cards = new Map(), phrases = new Map();
  const cardNames = new Map();
  const cardMessages = new Map(), activities = new Map(), approvalDrafts = new Map(), answering = new Set(), openToolRuns = new Set();
  const openDelegations = new Set(), continuing = new Set(), continuationNotes = new Map();
  let globalEvents = null, pendingTotal = 0, hubHomePrefix = '', commandGrantDays = 30;
  const revoking = new Set();
  let shellStatusAvailable = typeof H.setBotStatus === 'function' ? null : false, modeEntryLabel = '';
  const shellCounts = new Map(), shellDemo = new Map();
  const observedPetLabels = new WeakSet();
  let sessions = [], online = false, serial = 0, opening = 0, pollTimer, pollBusy = false, switching = false, queued = false, sampleRoute = false;
  const uid = () => 'hub-real-' + Date.now().toString(36) + '-' + (++serial);
  const roster = new Map();
  let rosterReady=false, rosterVersion=0, rosterLoading=null, avatarKinds={roles:[],shapes:[],colors:[]}, rosterLimits={maxActive:12,nameMax:8};
  const shellBots=new Map(S.bots.map(b=>[b.id,{...b}]));
  const originalAvatar=H.avatar?.bind(H), petRoles=new Map();
  const chiefId=()=>[...roster.values()].find(b=>b.role==='chief')?.id;
  const isBot = bot => roster.has(bot);
  const isEnabled = bot => roster.get(bot)?.status==='active';
  const realChat = () => rosterReady && mode === 'real' && !sampleRoute && S.view === 'chat' && isBot(S.bot);
  const active = r => realChat() && (S.detail || window.innerWidth >= 700) && S.conversation === r.local;
  const current = () => records.get(S.conversation);
  const consume = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const redraw = () => window.render();
  const endpoint = (remote, tail) => '/sessions/' + encodeURIComponent(remote) + '/' + tail;
  function record(bot, remote = null, title = '新会话') {
    if (remote && remoteRecords.has(remote)) return remoteRecords.get(remote);
    const r = { bot, remote, local: uid(), title, messages: [], ready: !remote, loading: null };
    H.registerConversation(bot, { id: r.local, title, messages: r.messages });
    records.set(r.local, r); if (remote) remoteRecords.set(remote, r);
    return r;
  }
  H.navigate = function (route, options) {
    if (route?.bot && isBot(route.bot)) sampleRoute = false;
    return originals.navigate(route, options);
  };
  H.runCapability = function (...args) { sampleRoute = true; return originals.capability.apply(H, args); };
  // 唯一可产生真实发送的入口是 sendText；壳的能力演示及后台演示不订阅为真实请求。
  H.postMessage = function (conversation, message, options) {
    if (mode === 'real' && records.has(conversation) && !message.hubReal) return { ...message, id: uid() };
    return originals.post(conversation, message, options);
  };
  function post(r, message) {
    const ts = message.ts ?? Date.now();
    const optimistic = message.role === 'user' ? { timelineLocal: true, timelineAfterSeq: Math.max(-1, ...r.messages.filter(hasSeq).map(m => m.seq)) } : {};
    return H.postMessage(r.local, { ...optimistic, ...message, id: uid(), hubReal: true, ts, time: messageDate(ts)?.time || '' });
  }
  function assertBot(bot) {
    if (!isBot(bot)) throw new Error('样例隔离断言：名册以外的助理禁止发送');
    if (!isEnabled(bot)) throw new Error('这个助理已停用，只能查看旧会话');
  }
  async function api(path, options = {}) {
    try {
      let response;
      try {
        response = await fetch('/bff' + path, { credentials: 'same-origin', cache: 'no-store', ...options,
          headers: { 'Content-Type': 'application/json', ...options.headers }, signal: options.signal || AbortSignal.timeout(12000) });
      } catch (error) {
        // 网络失败与 502/503 表示本次未连上；超时/中止或已收到响应但回执不完整，仍须先核对历史。
        if (error.name === 'TypeError') error.definitelyUnsent = true;
        throw error;
      }
      if (!response.ok) {let payload;try{payload=await response.json();}catch{}throw Object.assign(new Error('服务请求失败'),{status:response.status,payload,definitelyUnsent:[502,503].includes(response.status)});}
      let data; try { data = await response.json(); } catch { throw new Error('服务返回无效内容'); }
      online = path === '/health' ? data.ok === true && data.dsh?.connected === true : true;
      decorate(); return data;
    } catch (error) { online = false; decorate(); throw error; }
  }
  function phase(bot, name, r) {
    if (botPhase.get(bot) === name) return;
    botPhase.set(bot, name);
    const petName = ({ thinking: 'thinking', speaking: 'working', done: 'done', error: 'confused', idle: 'idle' })[name];
    // 桌宠认 error；首页格子和对话舞台的引擎认 confused。两边都通知，不互相替代。
    const stageName = ({ thinking: 'thinking', speaking: 'working', done: 'done', error: 'error', idle: 'idle' })[name];
    try { window.HubPetStage?.event?.(bot, stageName); } catch { /* 桌宠没挂上就不打断回合 */ }
    H.petTurn(bot, petName);
    const entry = { bot, state: name, pet: petName, at: Date.now() };
    turns.push(entry); if (turns.length > 200) turns.shift(); H.emit('hub-real:state', entry);
    if (S.bot === bot) {
      S.running = name === 'thinking' || name === 'speaking';
      S.emotion = name === 'thinking' ? '思考' : name === 'error' ? '抱歉' : '开心';
      if (bot === chiefId()) {
        window.setChiefFace(name === 'error' ? 'confused' : name === 'done' ? 'done' : 'normal', 0, r?.local || S.conversation);
        if (name === 'done') window.animateChiefDone(r?.local || S.conversation);
      }
    }
    if (name === 'done' || name === 'error') {
      const epoch = (epochs.get(bot) || 0) + 1; epochs.set(bot, epoch);
      const started = Date.now();
      const settle = () => {
        if (epochs.get(bot) !== epoch || botPhase.get(bot) !== name) return;
        // 等壳的一次性动画走完；素材缺失时最多等 12 秒，不剪断已展示的动作。
        if (H.petState().actors?.[bot]?.once === petName && Date.now() - started < 12000) { setTimeout(settle, 120); return; }
        phase(bot, 'idle', r);
      };
      setTimeout(settle, name === 'done' ? 1700 : 2400);
    } else if (name !== 'idle') epochs.set(bot, (epochs.get(bot) || 0) + 1);
    decorate();
  }
  const css = document.createElement('style');
  css.textContent = `
    .hub-real-reply{min-width:0;overflow-wrap:anywhere}
    .hub-real-text{line-height:1.75;min-width:0}.hub-real-text p{margin:6px 0}
    .hub-real-text pre,.hub-real-table{overflow:auto;max-width:100%;padding:9px;background:var(--elev)}
    .hub-real-text code{font-family:monospace;white-space:pre-wrap}.hub-real-text pre code{white-space:pre}
    .hub-real-text table{border-collapse:collapse}.hub-real-text th,.hub-real-text td{padding:6px;border:1px solid var(--line)}
    #app .hub-real-command{display:block;max-width:100%;min-width:0;overflow-x:auto;white-space:pre;font-family:ui-monospace,monospace;font-size:12px;padding:8px;border-radius:6px;background:var(--bg-2,#f4f2ed);line-height:1.6;user-select:text}
    #app .hub-real-letter .params dd{min-width:0}
    #app .hub-real-permission{padding:12px 0;border-bottom:1px dashed var(--line,#ddd);overflow-wrap:anywhere}
    #app .hub-real-letter .actions{flex-wrap:wrap}
    .hub-real-status,.hub-real-busy,.hub-real-time{font-size:11px;color:var(--ink-3)}
    .hub-real-status:empty,.hub-real-actions:empty{display:none}
    .hub-real-actions{display:flex;gap:8px;flex-wrap:wrap}.hub-real-actions button{min-height:44px}
    #app .hub-real-tool-message{margin:7px 0}
    #app .hub-real-tool-message>.message-label,#app .hub-real-tool-message>.message-footer{display:none}
    #app .hub-real-tool-message[hidden]{display:none!important}
    #app .hub-real-tool-trace>summary>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #app .hub-real-tool-trace .hub-real-tool-step{overflow-wrap:anywhere;margin:6px 0}
    #app .hub-real-tool-trace .hub-real-tool-path{display:block;color:var(--ink-3);font-size:11px}
    #app .hub-real-sample{font-size:10px!important;font-weight:400!important;line-height:1.4;padding:0;margin-left:5px;border:0;background:none;box-shadow:none;color:var(--ink-3);white-space:nowrap;display:inline;vertical-align:baseline}
    #app .shell .pin>strong{flex-shrink:0}
    #app .shell-title-meta .hub-real-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #app .shell-title-meta .hub-real-health{flex:none;font-size:10px!important;color:var(--ink-3)}
    #app .shell-title-meta .hub-real-list-link{flex:none;min-height:14px;line-height:14px;padding:0;font-size:11px!important}
    .hub-real-empty{text-align:center;color:var(--ink-3);font-size:13px;padding:28px 8px}
    .hub-real-session{width:100%;text-align:left;display:block;padding:12px;border-bottom:1px solid var(--line);color:var(--ink)}
    .hub-real-session small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-2)}
    :root[data-hub-real-chat=true] #app .chat-quick-slot[hidden]{display:none!important}
    :root[data-hub-real-chat=true] #app .hub-real-phrases{mask-image:none}
    #app .hub-real-activity-entry{position:relative;flex:none}
    #app .hub-real-activity-entry[hidden]{display:none!important}
    #app .hub-real-activity-entry .r22-badge{position:absolute;top:0;right:0}
    #app .hub-real-letter{overflow-wrap:anywhere;min-width:0}
    #app .hub-real-letter .diff{max-width:100%;overflow:auto}
    #app .hub-real-letter .diff span{white-space:pre-wrap}
    #app .hub-real-letter .hub-real-preview{white-space:pre-wrap}
    #app .hub-real-letter textarea{width:100%;margin:8px 0}
    #app .hub-real-delegate-head .creature{width:32px;height:32px;flex:none}
    #app .hub-real-letter .hub-real-timeline{padding-left:16px;border-left:2px dashed var(--dash);list-style:none;margin:12px 0}
    #app .hub-real-letter .hub-real-timeline li{display:flex;gap:10px;margin:6px 0}
    #app .hub-real-letter .hub-real-timeline li:before{content:none}
    #app .hub-real-letter .hub-real-timeline time{color:var(--ink-3);white-space:nowrap}
    #app .hub-real-delegate-steps>summary{cursor:pointer;font-size:13px;color:var(--ink-2);padding:6px 0;list-style:none}
    #app .hub-real-delegate-steps>summary::-webkit-details-marker{display:none}
    #app .hub-real-delegate-steps>summary span{display:inline-block;margin-left:6px}
    #app .hub-real-delegate-steps[open]>summary span{transform:rotate(90deg)}
    #app .hub-real-letter .hub-real-timeline li>span{min-width:0;overflow-wrap:anywhere}
    #app .hub-real-letter .hub-real-continue{white-space:normal;text-align:left;max-width:100%}
    .hub-real-mode-row{font-size:13px}.hub-real-list-link{font-size:11px;margin-left:6px}
  `;
  if (typeof H.setDemoContent !== 'function') css.textContent += `
    :root[data-hub-real-chat=true] #app :is(.m-persona-today,.r22-tool-call:not(.hub-real-tool-trace),.hub-quick:not(.hub-real-phrases),.shell-memory-mount,.ledger-shortcut,.composer-area .hub-status,.composer-area [data-context-mix],.composer-area .queuebar,.thread [data-reply-wait],.thread .message-footer .token,.thread .hub-memory-tag){display:none!important}
    :root[data-hub-real-chat=true] #app .thread-inner>.time-stamp:not(.hub-real-date){display:none!important}
  `;
  else css.textContent += `
    :root[data-hub-real-chat=true] #app .chatview[data-demo=off] .hub-real-tool-trace{display:block!important}
    :root[data-hub-real-chat=true] #app .chatview[data-demo=off] .chat-quick-slot:not([hidden]),
    :root[data-hub-real-chat=true] #app .chatview[data-demo=off] .hub-real-phrases{display:flex!important}
  `;
  css.textContent += `
    .hub-real-board-root{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding-bottom:calc(32px + env(safe-area-inset-bottom))}
    .hub-real-kcol{padding:10px;border-bottom:1px solid var(--line)}
    .hub-real-kcard{margin:8px 0;padding:10px;background:var(--elev);border-radius:10px}
    .hub-real-kcard summary{min-height:44px;cursor:pointer}
    .hub-real-kcard summary small{display:block;color:var(--ink-2)}
    .hub-real-legacy{color:var(--ink-3);margin-left:8px}
    .hub-real-lrow{display:flex;justify-content:space-between;gap:12px;padding:6px 0}
    .hub-real-group-thread{max-height:55vh;overflow:auto}
    .hub-real-group-message{margin:10px 0;overflow-wrap:anywhere}
    .hub-real-group-owner{text-align:right}
    .hub-real-group-system{text-align:center;color:var(--ink-3)}
    .hub-real-group-bubble{display:inline-block;border-radius:12px;padding:8px;background:var(--elev)}
    .hub-real-plan{padding-left:20px;color:var(--ink-2)}
    .hub-real-board-root button,.hub-real-ledger-root button,.hub-real-usage-root button,
    .hub-real-group-thread button{min-height:44px}
  `;
  document.head.append(css);
  const botName = bot => S.bots.find(b => b.id === bot)?.name || '助理';
  const stampValue = value => Date.parse(value) || Number(value) || 0;
  function remaining(c) {
    const minutes = Math.ceil((stampValue(c.expiresAt) - Date.now()) / 60000);
    return minutes > 0 ? '剩余 ' + minutes + ' 分钟' : '正在等待审批结果，这一步尚未做';
  }
  // r26 临时名册桥：只消费公开 Hub 状态/面板；不改壳，不向人设推导权限。
  const choiceId = value => typeof value==='string' ? value : value?.id || value?.value || value?.name || '';
  const choiceLabel = value => typeof value==='string' ? value : value?.label || value?.name || choiceId(value);
  const colorLabels={yellow:'黄色',green:'绿色',blue:'蓝色',purple:'紫色',pink:'粉色',orange:'橙色',red:'红色',gray:'灰色',mint:'薄荷绿',peach:'蜜桃色'};
  const colorCSS={yellow:'var(--lemon,#f0d771)',green:'#85bda5',blue:'#9dbddd',purple:'#b7a5dc',pink:'#dfa8bc',orange:'#e4b083',red:'#d98f93',gray:'#aeb3bd',mint:'#96cbb4',peach:'#edb6a0'};
  function colorValue(value) { const item=avatarKinds.colors.find(c=>choiceId(c)===value);return /^#[0-9a-f]{6}$/i.test(item?.color || '')?item.color:colorCSS[value] || (/^#[0-9a-f]{6}$/i.test(value||'')?value:'var(--lemon,#f0d771)'); }
  function colorLabel(value) {const item=avatarKinds.colors.find(c=>choiceId(c)===value);return item && typeof item==='object'?choiceLabel(item):colorLabels[value] || '自选颜色';}
  const shapePaths={circle:'M60 10a50 50 0 1 1 0 100 50 50 0 1 1 0-100',round:'M60 10a50 50 0 1 1 0 100 50 50 0 1 1 0-100',square:'M30 12h60q18 0 18 18v60q0 18-18 18H30q-18 0-18-18V30q0-18 18-18Z',star:'M60 8 75 40 110 45 85 70 92 106 60 88 28 106 35 70 10 45 45 40Z',diamond:'M60 8 110 60 60 112 10 60Z',triangle:'M60 10 112 105H8Z',cloud:'M28 48Q15 15 48 22Q75 0 92 34Q121 36 108 72Q112 108 73 104Q29 119 16 90Q0 64 28 48Z'};
  function roleInfo(id) {return petRoles.get(id) || [...petRoles.values()].find(p=>p.pack===id);}
  function avatarText(a) {return a?.kind==='role' ? roleInfo(a.role)?.packName || '素材角色' : a?.kind==='shape' ? '图形头像 · '+colorLabel(a.color) : a?.kind==='upload' ? '上传的图片' : '未设置';}
  function avatarNode(a, bot) {
    if(a?.kind==='upload' && /^[a-z][a-z0-9-]{1,23}\.(?:png|jpe?g|webp|gif)$/.test(a.file || ''))return H.h('img',{class:'creature bot-avatar hub-real-avatar','data-real-avatar':bot || '',src:'/bff/avatars/'+encodeURIComponent(a.file)+'?v='+encodeURIComponent(a.v || ''),alt:'助理形象',width:96,height:96});
    if(a?.kind==='role') {
      const p=roleInfo(a.role), file=p?.avatar96 || p?.avatar;
      if(file && /^(?!\/)(?!.*(?:\.\.|[:?#\\]))[a-zA-Z0-9_\-/.]+$/.test(file))return H.h('img',{class:'creature bot-avatar hub-real-avatar','data-real-avatar':bot || '',src:'/pets/'+file,alt:p.packName || '素材角色',width:96,height:96});
      const shell=shellBots.get(a.role);if(shell && originalAvatar)return originalAvatar(shell.id);
    }
    const shape=avatarKinds.shapes.find(s=>choiceId(s)===a?.shape), shell=shellBots.get(a?.shape);
    const path=typeof shape==='object' && /^[Mm][\d\s,MLHVCSQTAZmlhvcsqtaz.e+\-]+$/.test(shape.path || '')?shape.path:shell?.avatarPath || shapePaths[a?.shape] || shapePaths.circle;
    return H.fromHTML('<svg class="creature bot-avatar hub-real-avatar" data-real-avatar="'+escapeHTML(bot || '')+'" viewBox="0 0 120 120" aria-label="图形头像"><path style="fill:'+escapeHTML(colorValue(a?.color))+'" d="'+escapeHTML(path)+'"/><circle cx="43" cy="58" r="4" fill="currentColor"/><circle cx="77" cy="58" r="4" fill="currentColor"/><path d="M49 76Q60 85 71 76" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>');
  }
  if(originalAvatar)H.avatar=bot=>roster.has(bot)?avatarNode(roster.get(bot).avatar,bot):originalAvatar(bot);
  async function loadRolePack() {
    try {const response=await fetch('/pets/pack.json',{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;const data=await response.json();for(const [id,p] of Object.entries(data.assistants || data.roles || {}))petRoles.set(id,p);if(rosterReady){rosterVersion++;if(mode==='real')r28a1MapRoster([...roster.values()]);decorate();}}catch{}
  }
  function rosterTitle(c) {
    const names=cardNames.get(c.id) || {botName:c.botName || (c.bot===c.target?c.before?.name:'') || botName(c.bot),targetName:c.before?.name || c.targetName || roster.get(c.target)?.name};
    return approvalTitle({...c,...names});
  }
  // 只滚动包含目标的面板；展开编辑后不让按钮留在输入区或软键盘后面。
  function revealEditor(target) {
    requestAnimationFrame(()=>{
      const node=typeof target==='string'?document.querySelector(target):target, pane=node?.closest('.thread,.r22-sheet-content');
      if(!node || !pane)return;
      if(pane.classList.contains('thread') && typeof H.reading.locate==='function'){H.reading.locate(node,{block:'center',reason:'real-revision'});return;}
      const rect=node.getBoundingClientRect(), bounds=pane.getBoundingClientRect(), viewport=window.visualViewport;
      const bottom=Math.min(bounds.bottom,viewport?viewport.offsetTop+viewport.height:innerHeight,
        pane.classList.contains('thread')?document.querySelector('.composer-area')?.getBoundingClientRect().top ?? innerHeight:innerHeight)-12;
      const top=Math.max(bounds.top,viewport?.offsetTop || 0)+12;
      if(rect.bottom>bottom)pane.scrollTop+=rect.bottom-bottom;
      else if(rect.top<top)pane.scrollTop-=top-rect.top;
    });
  }
  const revealActiveRevision=()=>{
    const editor=document.activeElement;
    if(editor?.hasAttribute('data-real-revision'))revealEditor(editor.parentElement.querySelector('[data-real-answer="revise"]'));
  };
  window.visualViewport?.addEventListener('resize',revealActiveRevision);
  window.addEventListener('resize',revealActiveRevision);
  function fieldNode(key,value) {
    if(key==='avatar')return H.h('div',{class:'hub-real-avatar-choice'},[avatarNode(value),H.h('span',{},avatarText(value))]);
    const text=key==='status'?(value==='active'?'启用':'停用'):key==='nameColor'?colorLabel(value):Array.isArray(value)?value.join('\n'):String(value ?? '—');
    return H.h('span',{class:'hub-real-field-value'},text || '—');
  }
  function appendChanges(root,before,after) {
    const list=H.h('div',{class:'hub-real-changes'});
    for(const row of rosterChanges(before,after)) {
      const item=H.h('section',{'data-real-change':row.key},H.h('strong',{},row.label));
      if(before!==null)item.append(H.h('div',{class:'hub-real-before'},[H.h('small',{},'原来'),fieldNode(row.key,row.before)]));
      item.append(H.h('div',{class:'hub-real-after'},[H.h('small',{},before===null?'新资料':'改为'),fieldNode(row.key,row.after)]));list.append(item);
    }
    root.append(list);
  }
  function applyRoster(raw) {
    const data=normalizeRoster(raw);
    r28a1PrepareRoster(data.bots);
    rosterLimits={maxActive:12,nameMax:8,...data.limits};avatarKinds={roles:[],shapes:[],colors:[],...data.avatarKinds};
    roster.clear();for(const b of data.bots)roster.set(b.id,b);
    BOTS.splice(0,BOTS.length,...roster.keys());rosterReady=false;rosterVersion++;
    for(const b of data.bots) {
      let shell=S.bots.find(s=>s.id===b.id);
      if(!shell) {
        if(typeof H.createBot==='function')shell=H.createBot({id:b.id,name:b.name,duty:b.duty || '等你安排职责'});
        else {shell={id:b.id,unread:0,custom:true};S.bots.push(shell);S.threads[b.id]=[];S.sessionNames[b.id]='新会话';}
      }
      if(!demo.has(b.id))demo.set(b.id,{messages:S.threads[b.id] || [],title:S.sessionNames[b.id] || '新会话',counts:{running:false,unread:0,pending:0}});
      const color=colorValue(b.nameColor);
      Object.assign(shell,{name:b.name,duty:b.duty,notDuty:b.notDuty,quickReplies:b.phrases || [],color,colorStrong:color,colorInk:'var(--ink)',status:b.status==='active'?(shell.running?'busy':'active'):'paused'});
      phrases.set(b.id,(b.phrases || []).filter(p=>typeof p==='string' && p.trim()).slice(0,3));
      if(!selected.has(b.id))selected.set(b.id,record(b.id));
      shellCounts.delete(b.id);
    }
    rosterReady=true;
    if (mode === 'real') r28a1MapRoster(data.bots);
    // 壳的演示名册被换成后端名册后，原来的当前助理可能已经不在列表里。
    // 不指回一个还在的人，下一次整页重绘会在取颜色时直接抛错。
    if (mode === 'real' && !S.bots.some(item => item && item.id === S.bot)) {
      const next = S.bots.find(item => item && item.id);
      if (next) S.bot = next.id;
    }
    if(mode==='real') {
      // 重绘在壳阅读事务中保留当前消息、滚动、草稿与焦点；不刷新页面。
      if(!S.drawer?.startsWith('hub-real-profile'))H.reading.preserve(redraw,{reason:'real-roster'});
      decorate();refreshRosterPanel();
    }
    connectEvents();
  }
  async function loadRoster() {
    if(rosterLoading)return rosterLoading;
    const at=rosterVersion;
    rosterLoading=api('/bots').then(data=>{if(mode==='real' && at===rosterVersion)applyRoster(data);return data;}).catch(error=>{if(!rosterReady){const grid=document.querySelector('.sidebar .pinned');if(grid)grid.replaceChildren(H.h('p',{role:'status'},'助理名册暂时没能读出来，请稍后重试'));}throw error;}).finally(()=>{rosterLoading=null;});
    return rosterLoading;
  }
  // 首页六格的状态句。壳的舞台引擎认 waiting/confused，桌宠的 event 没有「等」，等你点头时只让它停下。
  const R29_FACE = {
    thinking: { pet: 'thinking', stage: 'thinking' },
    working: { pet: 'working', stage: 'working' },
    waiting: { pet: 'waiting', stage: 'idle' },
    stuck: { pet: 'confused', stage: 'error' },
    done: { pet: 'done', stage: 'done' }
  };
  let r29PresenceBots = new Map();
  let r29NoticeNow = null;
  let r29NoticeView = null;
  let r29PresenceAt = 0;
  let r29PresenceFlight = null;
  const r29FaceAt = new Map();
  let r29RosterToken = 0;
  // 旧后端可能已经截出「原话转达：」。这里再剥一次套话，剥光了只留状态词。
  function r29StripBoiler(value) {
    let text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    let prev = '';
    while (text !== prev) {
      prev = text;
      text = text.replace(/^[\[【〔][^\]】〕]{0,40}[\]】〕]\s*/u, '');
    }
    text = text.replace(/^[A-Za-z][A-Za-z0-9_-]{0,40}\s*(?=原话转达)/u, '');
    text = text.replace(/^原话转达\s*[：:]?\s*/u, '');
    return text.trim();
  }
  function r29PresenceLine(row) {
    if (!row || typeof row.line !== 'string') return '';
    let clean = row.line.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/原话转达|[\[【〔]/u.test(clean)) {
      const prefix = row.state === 'stuck' ? '卡在' : row.state === 'done' ? '做完' :
        row.state === 'working' ? '在' : '';
      const fallback = row.state === 'stuck' ? '卡住了' : row.state === 'done' ? '刚做完' :
        row.state === 'working' ? '在干活' : row.state === 'waiting' ? '等你点头' :
          row.state === 'thinking' ? '在想' : '';
      const body = prefix && clean.startsWith(prefix) ? clean.slice(prefix.length).trim() : clean;
      const next = r29StripBoiler(body);
      clean = next ? (prefix && clean.startsWith(prefix) ? prefix + next : next) : (fallback || clean);
    }
    return Array.from(clean).slice(0, 12).join('');
  }
  function r29TakePresence(id, row) {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,23}$/.test(id)) return null;
    if (!row || typeof row !== 'object' || !R29_FACE[row.state]) return null;
    const line = r29PresenceLine(row);
    return line ? { state: row.state, line } : null;
  }
  function r29FallbackCaption(bot, pending, busy) {
    if (pending) return shellStatusAvailable ? '待批 ' + pending : '等你点头 · ' + pending + ' 项';
    if (busy) return shellStatusAvailable ? '在干活' : '忙碌';
    return (bot && bot.duty) || '随时接话';
  }
  function r29ApplyCaption(caption, id, bot, pending, busy) {
    const row = r29PresenceBots.get(id);
    const line = r29PresenceLine(row);
    caption.textContent = line || r29FallbackCaption(bot, pending, busy);
    if (line) caption.dataset.r29Presence = row.state;
    else delete caption.dataset.r29Presence;
    if (typeof caption.addEventListener === 'function') r29BindCaption(caption, id);
  }
  function r29SameNotice(id) {
    const notice = r29NoticeNow;
    if (!notice || notice.speakerId !== id) return null;
    if (notice.kind !== 'ask' && notice.kind !== 'result') return null;
    return notice;
  }
  function r29BindCaption(caption, id) {
    if (caption.dataset.r29NoticeBound === '1') return;
    caption.dataset.r29NoticeBound = '1';
    caption.addEventListener('click', event => {
      const notice = r29SameNotice(id);
      if (!notice) return;
      event.preventDefault();
      event.stopPropagation();
      void openOwnerNotice(notice);
    }, true);
  }
  function r29RosterBusy(id) {
    return serverRunning.get(id) || delegated.get(id)?.running || delegated.get(id)?.queued > 0
      || [...jobs.values()].some(job => job.r.bot === id);
  }
  function r29PaintPresenceCaptions() {
    document.querySelectorAll('.sidebar .pinned [data-bot-tree]').forEach(host => {
      const id = host.dataset.botTree;
      const caption = host.querySelector('small');
      if (!caption) return;
      r29ApplyCaption(caption, id, roster.get(id), serverPending.get(id) || 0, r29RosterBusy(id));
    });
  }
  function r29PokeFace(id, face, prevFace) {
    if (!prevFace || prevFace.stage !== face.stage) {
      try { window.HubPetStage?.event?.(id, face.stage); } catch { /* 桌宠没挂上就不打断格子 */ }
    }
    try { if (typeof H.petTurn === 'function') H.petTurn(id, face.pet); } catch { /* 舞台引擎没准备好 */ }
  }
  /* r29-stage-book:start */
  const r29StageBookParts = [
    "{\"总管\":{\"闲着\":[\"单子我看着呢\",\"要排先后就说\",\"我在，今天的事我盯着\"],\"在想\":[\"我排一下先后\",\"先想哪",
    "件最急\",\"两件事撞了，容我理理\"],\"在干活\":[\"我去分一下\",\"这件我盯着做\",\"先把顺序排出来\"],\"做完\":[\"排好了",
    "\",\"这件我收好了\",\"名单更新好了\"],\"出错\":[\"这件没排成\",\"我再理一遍\",\"卡住了，我改个顺序\"],\"被戳\":[\"嗯",
    "？我在\",\"叫我呀\",\"别急，我听着\"],\"被摸\":[\"好啦，我还在\",\"轻轻的就好\",\"我接着盯\"],\"被甩晕\":[\"晃晕了\"",
    ",\"先别晃\",\"头有点转\"],\"被哄好\":[\"好吧，不气了\",\"那我继续盯\",\"行，揭过去了\"],\"犯困\":[\"有点困了\",\"我",
    "眯一下\",\"眼睛有点沉\"],\"早上\":[\"早，今天先排三件\",\"早啊，我来排\",\"起来了，单子给我\"],\"夜里\":[\"夜深了，我",
    "小声守着\",\"夜里不吵你\",\"有急事再叫我\"]},\"调研\":{\"闲着\":[\"要查的我先放着\",\"有出处要核对吗\",\"我在，随时去",
    "查\"],\"在想\":[\"我先对一下说法\",\"让我找找来源\",\"这条还不确定\"],\"在干活\":[\"我去查一下\",\"对着出处看\",\"资",
    "料我翻一翻\"],\"做完\":[\"查到了\",\"出处对上了\",\"这页我看完了\"],\"出错\":[\"没查到靠得住的\",\"这条对不上\",\"我",
    "再找一圈\"],\"被戳\":[\"嗯？要查什么\",\"我在听\",\"你说关键词\"],\"被摸\":[\"好，我在\",\"不急，慢慢说\",\"我听着\"",
    "],\"被甩晕\":[\"晃得看不清字\",\"先停一下\",\"眼花了\"],\"被哄好\":[\"好吧，我再去查\",\"不气了\",\"那我继续对\"],",
    "\"犯困\":[\"字有点花\",\"我歇一眼\",\"困了，但还在\"],\"早上\":[\"早，今天查哪条\",\"早啊，把问题给我\",\"起来就对出处",
    "\"],\"夜里\":[\"夜里我小声查\",\"不吵你，有结果再说\",\"夜深了，先记着\"]},\"写作\":{\"闲着\":[\"稿子先搁这\",\"要",
    "改哪段跟我说\",\"我在，句子我看着\"],\"在想\":[\"这句话还不利落\",\"我换个说法\",\"让我再念一遍\"],\"在干活\":[\"我改",
    "这一段\",\"先写个草稿\",\"句子我顺一下\"],\"做完\":[\"改好了\",\"这版可以看\",\"写完这一段了\"],\"出错\":[\"这版没写",
    "顺\",\"我重来一句\",\"卡在这个词上\"],\"被戳\":[\"嗯？改哪里\",\"我在\",\"你点一句我改\"],\"被摸\":[\"好啦\",\"我还",
    "在稿子上\",\"轻轻的\"],\"被甩晕\":[\"字都晃乱了\",\"先别晃\",\"我找不着行了\"],\"被哄好\":[\"好，我接着写\",\"不气了",
    "\",\"那我把这句补上\"],\"犯困\":[\"眼皮沉了\",\"我歇一下笔\",\"有点写不动\"],\"早上\":[\"早，今天改哪篇\",\"早啊，稿",
    "子给我\",\"起来就先顺句子\"],\"夜里\":[\"夜里我小声改\",\"不吵你，改完留着\",\"夜深了，笔先放下\"]},\"推进\":{\"闲着",
    "\":[\"进度我记着\",\"要我催哪件\",\"我在，步骤没丢\"],\"在想\":[\"这件卡在哪一步\",\"我看看到哪了\",\"下一步该谁\"],",
    "\"在干活\":[\"我去推一步\",\"这件我接着办\",\"先把卡住的挪开\"],\"做完\":[\"推过去了\",\"这一步做完了\",\"进度我记下了",
    "\"],\"出错\":[\"这步没推成\",\"还卡着\",\"我换条路再试\"],\"被戳\":[\"嗯？催哪件\",\"我在\",\"你说做到哪\"],\"被摸",
    "\":[\"好，我在\",\"不急\",\"我接着盯进度\"],\"被甩晕\":[\"步骤晃乱了\",\"先别晃\",\"我重新对一下\"],\"被哄好\":[\"",
    "好，我继续推\",\"不气了\",\"那这件接着办\"],\"犯困\":[\"有点累了\",\"我歇一下\",\"进度先放着\"],\"早上\":[\"早，今天",
    "推哪件\",\"早啊，我先看进度\",\"起来就对下一步\"],\"夜里\":[\"夜里不催你\",\"进度我守着\",\"有变动再叫你\"]},\"视觉\"",
    ":{\"闲着\":[\"图先放一边\",\"要看画面就说\",\"我在，颜色我看着\"],\"在想\":[\"这里看着不顺\",\"我比一下构图\",\"让我",
    "再看一眼\"],\"在干活\":[\"我改这一处\",\"画面我调一下\",\"先看哪里别扭\"],\"做完\":[\"这处改好了\",\"画面顺了\",\"你",
    "再看一眼\"],\"出错\":[\"这版看着不对\",\"我重来一稿\",\"颜色没对上\"],\"被戳\":[\"嗯？看哪里\",\"我在\",\"你点一处\"",
    "],\"被摸\":[\"好啦\",\"我还看着图\",\"轻轻的\"],\"被甩晕\":[\"画面在转\",\"先别晃\",\"我看不清了\"],\"被哄好\":[",
    "\"好，我再改一处\",\"不气了\",\"那我继续看\"],\"犯困\":[\"眼睛酸了\",\"我歇一下\",\"图先放着\"],\"早上\":[\"早，今天",
    "看哪张\",\"早啊，图给我\",\"起来就先看画面\"],\"夜里\":[\"夜里把屏幕调暗\",\"不亮着吵你\",\"图我留到明天\"]},\"咨询\"",
    ":{\"闲着\":[\"问题我接着\",\"想问就说\",\"我在，你慢慢讲\"],\"在想\":[\"我听明白了，想一下\",\"先分清你在问什么\",\"",
    "让我理一下\"],\"在干活\":[\"我按你的情况说\",\"先给你一个办法\",\"这题我拆开看\"],\"做完\":[\"办法说完了\",\"你可以照",
    "这个试\",\"这题先到这\"],\"出错\":[\"我没说清\",\"我换种说法\",\"刚才那条不算\"],\"被戳\":[\"嗯？你说\",\"我在听\",",
    "\"想问什么\"],\"被摸\":[\"我在\",\"不急，说完\",\"好啦\"],\"被甩晕\":[\"晃得听不清\",\"先停一下\",\"你再说一遍\"],",
    "\"被哄好\":[\"好，我接着听\",\"不气了\",\"那我们继续\"],\"犯困\":[\"有点困\",\"我打起精神\",\"你说，我还在\"],\"早上",
    "\":[\"早，今天想问什么\",\"早啊，我听着\",\"起来就说你的事\"],\"夜里\":[\"夜里我小声答\",\"不吵人\",\"急的事我接着\"]",
    "},\"通用\":{\"闲着\":[\"我在，你说\",\"有事就叫我\",\"我在这儿\"],\"在想\":[\"让我想想\",\"稍等，我理一下\",\"还在",
    "想\"],\"在干活\":[\"我在做\",\"这件我接着办\",\"马上就好\"],\"做完\":[\"做好了\",\"这件完了\",\"你看一眼\"],\"出错",
    "\":[\"出错了\",\"我再试一次\",\"这件没做成\"],\"被戳\":[\"嗯？\",\"我在\",\"叫我呀\"],\"被摸\":[\"好啦\",\"我在呢",
    "\",\"轻轻就好\"],\"被甩晕\":[\"晕\",\"别晃了\",\"头好晕\"],\"被哄好\":[\"好吧\",\"不气了\",\"那我继续\"],\"犯困\"",
    ":[\"有点困了\",\"我眯一下\",\"眼睛睁不开\"],\"早上\":[\"早上好\",\"早啊\",\"新的一天\"],\"夜里\":[\"夜深了\",\"我",
    "小声待着\",\"你去休息\"]}}",
  ];
  /* r29-stage-book:end */
  const r29StagePoseMap = {
    idle: '闲着', listening: '在想', thinking: '在想',
    reading: '在干活', writing: '在干活', running: '在干活',
    searching: '在干活', delegating: '在干活', drawing: '在干活',
    happy: '做完', proud: '做完', oops: '出错', sorry: '出错',
    surprised: '被戳', pat: '被摸', dizzy: '被甩晕',
    coaxed: '被哄好', forgiven: '被哄好',
    tired: '犯困', yawn: '犯困', sleeping: '犯困', wake: '犯困',
    asking: '在想',
    greet_morning: '早上', greet_dawn: '早上', greet_noon: '早上',
    greet_afternoon: '早上', greet_evening: '夜里', greet_night: '夜里'
  };
  const r29StageExtraPoses = [
    'hum', 'stretch', 'annoyed', 'puffed', 'redhot', 'sulk',
    'busy_left', 'busy_right', 'swamped_left', 'swamped_right',
    'workAnnoyed', 'workPuffed', 'workRedhot', 'shakeMulti', 'shakeAsk', 'shakeWork'
  ];
  const r29StageKinds = [
    ['总管', /总管|调度|协调|排期|先后|待办|梳理/],
    ['调研', /调研|来源|出处|资料/],
    ['写作', /写作|写稿|文案|改稿|内容/],
    ['推进', /推进|项目|进度|验收|交付/],
    ['视觉', /视觉|配色|图形|画面|出图|看图|设计/],
    ['咨询', /咨询|预约|接待|答疑|问答/]
  ];
  let r29StageBookCache = null;
  let r29StageBooted = false;
  let r29StageSyncing = false;
  let r29StagePulling = false;
  let r29StagePullAt = 0;
  let r29StagePending = [];
  let r29StageView = '';
  let r29StageSoundObs = null;
  const r29StageSent = new Map();
  const r29StageSess = new Map();
  const r29StageSaid = new Map();
  function r29StageNow() {
    try {
      const hook = window.__r29StageNow;
      if (typeof hook === 'function') {
        const value = hook();
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
      }
    } catch { /* 没有测试钟就用本机时间 */ }
    return new Date();
  }
  function r29StageNight(date) {
    const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : r29StageNow();
    const hour = when.getHours();
    return hour >= 22 || hour < 8;
  }
  function r29StagePlain(value, max) {
    const text = String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[<>&]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/[\/~@\\]|[A-Za-z0-9._%+-]{16,}|[A-Za-z]:|https?:|www\./i.test(text)) return '';
    if (/[A-Za-z]|主人|你|自己/.test(text) || Array.from(text).length > max) return '';
    if (/^[在的了和与及把被将为给向从至于]|[在的了和与及把被将为给向从至于]$/.test(text)) return '';
    if (/[。！？，、；：!?,.;:]/.test(text)) return '';
    return text;
  }
  function r29StageKind(duty) {
    const text = String(duty || '');
    for (const row of r29StageKinds) if (row[1].test(text)) return row[0];
    return '通用';
  }
  function r29StageBook() {
    if (r29StageBookCache) return r29StageBookCache;
    try { r29StageBookCache = JSON.parse(r29StageBookParts.join('')); }
    catch { r29StageBookCache = {}; }
    return r29StageBookCache;
  }
  function r29StageLinesOf(cat, state) {
    return Array.isArray(cat[state]) ? cat[state].slice() : [];
  }
  function r29StageTable(kind, night) {
    const book = r29StageBook();
    const fallback = book['通用'] && typeof book['通用'] === 'object' ? book['通用'] : {};
    const cat = book[kind] && typeof book[kind] === 'object' ? book[kind] : fallback;
    const nightLines = r29StageLinesOf(cat, '夜里');
    const useNight = night && nightLines.length > 0;
    const table = {};
    for (const pose of Object.keys(r29StagePoseMap)) {
      const lines = useNight ? nightLines : r29StageLinesOf(cat, r29StagePoseMap[pose]);
      if (lines.length) table[pose] = lines.slice();
    }
    if (useNight) for (const pose of r29StageExtraPoses) table[pose] = nightLines.slice();
    return table;
  }
  function r29StageStamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return NaN;
  }
  function r29StageFresh(stamp, now) {
    if (!Number.isFinite(stamp)) return false;
    const skew = 5000;
    const span = 10 * 60 * 1000;
    if (stamp > now + skew) return false;
    if (now - stamp > span + skew) return false;
    return true;
  }
  function r29StageAskIds(bot) {
    const ids = new Set();
    const take = card => {
      if (!card || card.bot !== bot || card.status !== 'pending') return;
      if (card.type && card.type !== 'approval') return;
      if (typeof card.sessionId === 'string' && card.sessionId) ids.add(card.sessionId);
    };
    for (const card of cards.values()) take(card);
    for (const card of r29StagePending) take(card);
    return ids;
  }
  function r29StageWaiting(session, askIds) {
    if (!session || typeof session.id !== 'string') return false;
    if (askIds.has(session.id)) return true;
    return session.pending === true || session.waiting === true || session.ask === true;
  }
  function r29StagePoseList(bot) {
    const askIds = r29StageAskIds(bot);
    const list = [];
    const seen = new Set();
    for (const session of sessions) {
      if (!session || session.bot !== bot || typeof session.id !== 'string') continue;
      const ask = r29StageWaiting(session, askIds);
      const running = session.running === true;
      if (!ask && !running) continue;
      seen.add(session.id);
      list.push({ pose: ask ? 'asking' : 'writing', ask: ask });
      if (list.length >= 6) return list;
    }
    for (const id of askIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ pose: 'asking', ask: true });
      if (list.length >= 6) return list;
    }
    for (const job of jobs.values()) {
      const owner = job && job.r && job.r.bot;
      const remote = job && job.r && job.r.remote;
      if (owner !== bot || typeof remote !== 'string' || !remote || seen.has(remote)) continue;
      if (job.stopping) continue;
      seen.add(remote);
      list.push({ pose: 'writing', ask: false });
      if (list.length >= 6) return list;
    }
    return list;
  }
  function r29StageSessionDone(session) {
    if (!session || session.running === true) return false;
    const role = session.lastRole;
    return role === 'assistant' || role === 'done' || session.status === 'done';
  }
  function r29StageFreshTitle(bot) {
    const now = r29StageNow().getTime();
    let best = null;
    const consider = (stamp, title) => {
      const text = r29StagePlain(title, 12);
      if (!text || !r29StageFresh(stamp, now)) return;
      if (!best || stamp >= best.stamp) best = { stamp: stamp, text: text };
    };
    for (const session of sessions) {
      if (!session || session.bot !== bot || !r29StageSessionDone(session)) continue;
      consider(r29StageStamp(session.updatedAt), session.title);
    }
    const bags = [...cards.values(), ...r29StagePending];
    for (const card of bags) {
      if (!card || card.bot !== bot || card.status !== 'done') continue;
      const stamp = r29StageStamp(card.updatedAt || card.finishedAt || card.createdAt);
      consider(stamp, card.title || card.task || '');
    }
    return best;
  }
  function r29StageGuardSound(stage) {
    if (!stage || typeof stage.soundAllowed !== 'function') return;
    if (stage.soundAllowed.r29StageWrapped) return;
    const orig = stage.soundAllowed;
    function r29StageSound(date) {
      const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : r29StageNow();
      if (r29StageNight(when)) return false;
      try { return orig.call(stage, when); }
      catch { return true; }
    }
    r29StageSound.r29StageWrapped = true;
    stage.soundAllowed = r29StageSound;
  }
  function r29StageMute(night) {
    if (!night || typeof document === 'undefined') return;
    document.querySelectorAll('[data-r29-sound]').forEach(node => {
      if (node.getAttribute('data-r29-sound') !== '0') node.setAttribute('data-r29-sound', '0');
    });
    const slot = document.querySelector('[data-r29-pet-slot]');
    if (!slot) return;
    slot.querySelectorAll('audio, video').forEach(media => {
      try { media.muted = true; if (typeof media.pause === 'function') media.pause(); }
      catch { /* 这一下没能停声 */ }
    });
  }
  function r29StageWatchSound() {
    if (r29StageSoundObs || typeof MutationObserver !== 'function' || !document.body) return;
    r29StageSoundObs = new MutationObserver(() => {
      try { r29StageMute(r29StageNight(r29StageNow())); }
      catch { /* 静音失败就下一轮再试 */ }
    });
    r29StageSoundObs.observe(document.body, {
      subtree: true, attributes: true, attributeFilter: ['data-r29-sound']
    });
  }
  function r29StageViewKey() {
    try {
      if (S && S.view === 'stage' && typeof S.bot === 'string' && S.bot) return S.bot;
    } catch { /* 路由还没好 */ }
    return '';
  }
  function r29StageSig(kind, night, table) {
    return kind + '|' + (night ? '1' : '0') + '|' + JSON.stringify(table);
  }
  function r29StageAnnounce(bot) {
    const stage = window.HubPetStage;
    if (!stage || typeof stage.setLines !== 'function' || typeof stage.event !== 'function') return;
    const fresh = r29StageFreshTitle(bot);
    if (!fresh) return;
    const mark = fresh.stamp + '|' + fresh.text;
    if (r29StageSaid.get(bot) === mark) return;
    const kind = r29StageKind(roster.get(bot) && roster.get(bot).duty);
    const night = r29StageNight(r29StageNow());
    const table = r29StageTable(kind, night);
    const line = '刚把' + fresh.text + '做完了';
    const once = Object.assign({}, table, { happy: [line], proud: [line] });
    try { stage.setLines(bot, once); }
    catch { return; }
    // 已经停在做完姿势时，再发一次完成不会开口。先回到闲着，下一句才会换上。
    try { stage.event(bot, 'idle'); }
    catch { /* 闲着没换成也不拦那句完成 */ }
    try { stage.event(bot, 'done'); }
    catch { /* 句子已经放进台词，姿势没换也先把表放回去 */ }
    try { stage.setLines(bot, table); }
    catch { /* 下一轮再换回分类台词 */ }
    r29StageSaid.set(bot, mark);
    r29StageSent.set(bot, r29StageSig(kind, night, table));
  }
  function r29StageReleaseDemo() {
    if (!r29StageSent.size && !r29StageSess.size) return;
    const stage = window.HubPetStage;
    const ids = new Set([...r29StageSent.keys(), ...r29StageSess.keys()]);
    if (stage) {
      for (const id of ids) {
        try { if (typeof stage.setLines === 'function') stage.setLines(id, {}); }
        catch { /* 演示自己的句子留着 */ }
        try { if (typeof stage.sessions === 'function') stage.sessions(id, []); }
        catch { /* 会话条清不掉就先留着 */ }
      }
    }
    r29StageSent.clear();
    r29StageSess.clear();
    r29StageSaid.clear();
    r29StageView = '';
  }
  function r29StageApply() {
    const stage = window.HubPetStage;
    if (!stage || typeof stage.setLines !== 'function') return;
    r29StageGuardSound(stage);
    r29StageWatchSound();
    const night = r29StageNight(r29StageNow());
    for (const bot of [...roster.keys()]) {
      try {
        const kind = r29StageKind(roster.get(bot) && roster.get(bot).duty);
        const table = r29StageTable(kind, night);
        const sig = r29StageSig(kind, night, table);
        if (r29StageSent.get(bot) !== sig) {
          stage.setLines(bot, table);
          r29StageSent.set(bot, sig);
        }
        if (typeof stage.sessions === 'function') {
          const poses = r29StagePoseList(bot);
          const poseSig = JSON.stringify(poses);
          if (r29StageSess.get(bot) !== poseSig) {
            stage.sessions(bot, poses);
            r29StageSess.set(bot, poseSig);
          }
        }
      } catch { /* 这一位先跳过，下一轮再试 */ }
    }
    const view = r29StageViewKey();
    if (view !== r29StageView) {
      r29StageView = view;
      if (view) r29StageSaid.delete(view);
    }
    if (view) r29StageAnnounce(view);
    r29StageMute(night);
  }
  async function r29StagePull() {
    if (r29StagePulling || Date.now() - r29StagePullAt < 5000) return;
    r29StagePulling = true;
    r29StagePullAt = Date.now();
    try {
      const result = await extFetch('/approvals');
      const list = result && result.ok && result.data && Array.isArray(result.data.approvals)
        ? result.data.approvals : null;
      if (list) {
        r29StagePending = list.filter(item => item && typeof item === 'object').map(item => ({
          bot: typeof item.bot === 'string' ? item.bot : '',
          sessionId: typeof item.sessionId === 'string' ? item.sessionId : '',
          status: typeof item.status === 'string' ? item.status : '',
          type: typeof item.type === 'string' ? item.type : 'approval',
          title: typeof item.title === 'string' ? item.title : '',
          task: typeof item.task === 'string' ? item.task : '',
          updatedAt: item.updatedAt || item.finishedAt || item.createdAt || ''
        }));
      }
    } catch { /* 待批这次没读到，沿用上次 */ }
    finally { r29StagePulling = false; }
  }
  async function r29StageSync() {
    if (r29StageSyncing) return;
    if (mode !== 'real') { r29StageReleaseDemo(); return; }
    if (!rosterReady) return;
    r29StageSyncing = true;
    try {
      if (r29StageViewKey()) await r29StagePull();
      if (mode !== 'real' || !rosterReady) return;
      r29StageApply();
    } catch { /* 台词接不上也不打断页面 */ }
    finally { r29StageSyncing = false; }
  }
  function r29StageBoot() {
    if (r29StageBooted) return;
    r29StageBooted = true;
    try {
      if (typeof H.on === 'function') H.on('navigate', () => { void r29StageSync(); });
    } catch { /* 没有导航事件就靠定时 */ }
    try { setInterval(() => { void r29StageSync(); }, 1000); }
    catch { /* 定时器不可用 */ }
    try {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { void r29StageSync(); });
      }
    } catch { /* 没有动画帧 */ }
    void r29StageSync();
  }
  queueMicrotask(() => { try { r29StageBoot(); } catch { /* 桌宠台词不起步 */ } });
  function r29CorrectDrift(id, pet) {
    if (pet === 'done' || pet === 'confused') return;
    try {
      const actor = typeof H.petState === 'function' ? H.petState()?.actors?.[id] : null;
      if (actor && actor.base !== pet && actor.once !== pet && typeof H.petTurn === 'function') H.petTurn(id, pet);
    } catch { /* 读不到引擎就保持上次 */ }
  }
  function r29MarkHomeStage(id, pet) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;
    const node = document.querySelector('.sidebar .pinned [data-bot-tree="' + id + '"] [data-pet-stage="home"]');
    if (node && node.getAttribute('data-pet-state') !== pet) node.setAttribute('data-pet-state', pet);
  }
  function r29SyncOneFace(id, state) {
    const face = state === 'idle' ? { pet: 'idle', stage: 'idle' } : R29_FACE[state];
    if (!face) return;
    const prev = r29FaceAt.get(id);
    if (prev === undefined) {
      r29FaceAt.set(id, state);
      if (state !== 'idle') r29PokeFace(id, face, null);
    } else if (prev !== state) {
      const prevFace = prev === 'idle' ? { pet: 'idle', stage: 'idle' } : R29_FACE[prev];
      r29FaceAt.set(id, state);
      r29PokeFace(id, face, prevFace);
    } else r29CorrectDrift(id, face.pet);
    r29MarkHomeStage(id, face.pet);
  }
  function r29SyncRosterFaces() {
    const live = new Set(r29PresenceBots.keys());
    for (const id of live) r29SyncOneFace(id, r29PresenceBots.get(id).state);
    for (const id of [...r29FaceAt.keys()]) {
      if (live.has(id)) continue;
      r29SyncOneFace(id, 'idle');
      if (r29FaceAt.get(id) === 'idle') r29FaceAt.delete(id);
    }
  }
  function r29LoadPresence() {
    if (mode !== 'real' || r29PresenceFlight || Date.now() - r29PresenceAt < 4000) return;
    r29PresenceFlight = Promise.resolve().then(() => extCall('/presence')).then(result => {
      r29PresenceAt = Date.now();
      if (mode !== 'real' || result?.status !== 200 || result.data?.ok !== true) return;
      const raw = result.data.bots;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const next = new Map();
      for (const [id, row] of Object.entries(raw)) {
        const clean = r29TakePresence(id, row);
        if (clean) next.set(id, clean);
      }
      r29PresenceBots = next;
      r29PaintPresenceCaptions();
      r29SyncRosterFaces();
    }).catch(() => { /* 没读到就不编一句 */ }).finally(() => { r29PresenceFlight = null; });
  }
  function r29ScheduleRosterStatus() {
    const token = ++r29RosterToken;
    const run = () => {
      if (token !== r29RosterToken || mode !== 'real') return;
      r29PaintPresenceCaptions();
      r29SyncRosterFaces();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else setTimeout(run, 0);
  }
  function r29RosterStatus(id) {
    if (mode !== 'real' || typeof id !== 'string') return null;
    const row = r29PresenceBots.get(id);
    if (!row?.line) return null;
    return { state: row.state, line: row.line };
  }
  r29RosterStatus.snapshot = function () {
    if (mode !== 'real') return { bots: {} };
    const bots = {};
    for (const [id, row] of r29PresenceBots) {
      if (row?.line) bots[id] = { state: row.state, line: row.line };
    }
    return { bots };
  };
  window.HubRosterStatus = r29RosterStatus;
  function paintRoster() {
    if(mode!=='real')return;
    const grid=document.querySelector('.sidebar .pinned');
    if(!rosterReady){
      if(grid)grid.replaceChildren(H.h('p',{role:'status'},'正在读取助理名册…'));
      r29PaintNoticeView();
      return;
    }
    if(grid && grid.dataset.realRoster!==String(rosterVersion)) {
      const search=String(S.search || '').toLowerCase(), bots=[...roster.values()].filter(b=>b.status==='active').slice(0,6).filter(b=>!search || [b.name,b.duty].join(' ').toLowerCase().includes(search));
      let freshMotion = false;
      grid.replaceChildren(...bots.map(b => {
        const role = r29HomeRole(grid, b);
        if (role.fresh) freshMotion = true;
        return H.h('div',{class:'shell-pinned-tree','data-bot-tree':b.id},H.h('button',{type:'button',class:'pin'+(b.id===S.bot?' on':''),'data-act':'bot','data-id':b.id,style:H.botStyle(b.id)},[
          role.node,H.h('strong',{class:'r22-nameplate'},b.name),H.h('small',{'data-bot-status':''},b.duty || '随时接话')
        ]));
      }));
      // 新空槽没有静图，要叫壳的引擎自己把动图画上去。已有的舞台是挪过来的，不再按一次。
      if (freshMotion && typeof H.petTurn === 'function') {
        for (const item of bots) {
          if (!(item.avatar?.kind === 'role' && item.avatar.role === item.id)) continue;
          try { H.petTurn(item.id, 'idle'); } catch { /* 这名角色还没有演员时，壳会自己返回 */ }
        }
        try {
          const pet = window.chiefPet;
          if (pet && typeof pet.sync === 'function' && (typeof pet.active !== 'function' || pet.active())) pet.sync();
        } catch { /* 引擎没准备好就留空槽 */ }
      }
      if (!flatHome) grid.querySelectorAll('[data-bot-tree]').forEach(host=>{if(H.subBots?.(host.dataset.botTree)?.length)host.append(H.h('div',{class:'shell-sub-avatars'},H.h('span',{class:'home-child-count',style:'display:none'})));});
      grid.dataset.realRoster=String(rosterVersion);
    }
    grid?.querySelectorAll('[data-bot-tree]').forEach(host=>{const id=host.dataset.botTree,b=roster.get(id),caption=host.querySelector('small'),pending=serverPending.get(id)||0,busy=serverRunning.get(id)||delegated.get(id)?.running||delegated.get(id)?.queued>0||[...jobs.values()].some(j=>j.r.bot===id);if(caption)r29ApplyCaption(caption,id,b,pending,busy);const dot=host.querySelector('.bot-unread'),unread=serverUnread.get(id)||0;if(unread && !dot)host.querySelector('.pin').append(H.h('i',{class:'bot-unread home-assistant-unread','aria-label':'未读'}));if(!unread)dot?.remove();});
    grid?.querySelectorAll('[data-bot-tree]').forEach(host => r29PaintUnread(host));
    document.querySelectorAll('[data-nameplate-bot]').forEach(n=>{if(!isBot(n.dataset.nameplateBot))return;const b=roster.get(n.dataset.nameplateBot),suffix=n.textContent.includes(' · ')?' · '+n.textContent.split(' · ').slice(1).join(' · '):'';n.textContent=b.name+suffix;n.setAttribute('style',H.botStyle(b.id));});
    document.querySelectorAll('.compact-bots [data-act="bot"]').forEach(n=>{const b=roster.get(n.dataset.id);if(b){n.hidden=b.status!=='active';n.setAttribute('aria-label',b.name);n.replaceChildren(avatarNode(b.avatar,b.id));}else n.hidden=true;});
    // 壳自行生成头像与舞台；保留原角色原插槽，改过的形象以静态图/团子补位。
    // 讨论组新页的叠头像和发言头像留给壳，换掉就变成大图、也没有 r29-face。
    document.querySelectorAll('[data-bot-avatar]').forEach(n => {
      const id = n.dataset.botAvatar;
      const b = roster.get(id);
      const role = b && b.avatar?.kind === 'role' && b.avatar.role === id;
      const keep = !b || role || n.closest('.pinned') || n.closest('[data-real-avatar]') ||
        n.closest('.r29-group-page, .r29-group-head');
      if (keep) return;
      n.replaceWith(avatarNode(b.avatar, id));
    });
    const bot=roster.get(S.bot);
    if(realChat() && bot && !S.r29GroupFocus) {
      const title=document.querySelector('[data-shell-title] strong');if(title)title.textContent=bot.name;
      const input=document.querySelector('[data-focus="composer"]');if(input){input.placeholder='向'+bot.name+'发消息';input.disabled=bot.status!=='active';input.setAttribute('aria-label',bot.status==='active'?'向'+bot.name+'发消息':'这个助理已停用，旧会话只读');}
      document.querySelectorAll('.composer-area [data-act="send"],.composer-area [data-act="voice"]').forEach(n=>{n.disabled=bot.status!=='active';});
      const platform=document.querySelector('.r22-pet-platform');
      const nativeRole = bot.avatar?.kind === 'role' && bot.avatar.role === bot.id;
      const stageLeft = platform?.querySelector?.('[data-pet-stage]');
      if (platform && !stageLeft && !nativeRole && platform.dataset.realAvatarVersion !== String(rosterVersion)) {
        platform.replaceChildren(avatarNode(bot.avatar, bot.id));
        platform.dataset.realAvatarVersion = String(rosterVersion);
      }
    }
    r29LoadPresence();
    r29ScheduleRosterStatus();
    r29PaintNoticeView();
  }
  function noticeViewing() {
    try {
      if (S.view !== 'chat') return '';
      const remote = current()?.remote;
      return typeof remote === 'string' ? remote : '';
    } catch {
      return '';
    }
  }
  function noticeText(node, text) {
    node.textContent = String(text ?? '');
    return node;
  }
  async function openOwnerNotice(notice) {
    if (mode !== 'real' || !notice || typeof notice !== 'object') return;
    const entry = notice.entry;
    if (entry && entry.type === 'conversation' && typeof entry.id === 'string') {
      try { await refreshList(); } catch { /* 名单没刷新时改走今天这一页 */ }
      const meta = sessions.find(item => item && item.id === entry.id);
      if (meta && isBot(meta.bot)) {
        await open(record(meta.bot, meta.id, meta.title || '会话'));
        return;
      }
    }
    // 没有这段对话时，和「今天」首句落在同一页，不再打开看板。
    if (typeof H.openPanel === 'function') H.openPanel('hub-real-today');
  }
  // 首页六格上方一句。真实模式没有这句话就收起；读失败写「暂无」。
  // 壳每次整页重绘会丢掉适配层插进去的节点，所以读到的结果单独留着，重绘时再挂上。
  function paintOwnerNotice() {
    try {
      if (mode !== 'real') {
        r29NoticeNow = null;
        r29NoticeView = { kind: 'empty' };
        r29PaintNoticeView();
        return;
      }
      const grid = document.querySelector('.sidebar .pinned');
      if (!grid || !grid.parentNode) return;
      const viewing = noticeViewing();
      const query = viewing ? ('?viewing=' + encodeURIComponent(viewing)) : '';
      const seq = (paintOwnerNotice.seq = (paintOwnerNotice.seq || 0) + 1);
      extFetch('/notices/' + query).then(result => {
        if (seq !== paintOwnerNotice.seq || mode !== 'real') return;
        const data = result && result.data;
        if (!result || result.ok !== true || !data || data.ok !== true) {
          r29NoticeNow = null;
          r29NoticeView = { kind: 'fail' };
        } else {
          const notice = data.notice;
          if (!notice || typeof notice.text !== 'string' || !notice.text.trim()) {
            r29NoticeNow = null;
            r29NoticeView = { kind: 'empty' };
          } else {
            r29NoticeNow = notice;
            r29NoticeView = { kind: 'show', notice };
          }
        }
        r29PaintNoticeView();
      }).catch(() => {
        if (seq !== paintOwnerNotice.seq || mode !== 'real') return;
        r29NoticeNow = null;
        r29NoticeView = { kind: 'fail' };
        try { r29PaintNoticeView(); } catch { /* 页已拆 */ }
      });
    } catch {
      try { document.querySelector('[data-owner-notice]')?.remove(); } catch { /* 壳不齐 */ }
    }
  }
  function r29NoticeHost() {
    const grid = document.querySelector('.sidebar .pinned');
    if (!grid || !grid.parentNode) return null;
    let bar = document.querySelector('[data-owner-notice]');
    if (!bar) {
      bar = H.h('div', {
        class: 'hub-real-owner-notice', 'data-owner-notice': '', role: 'status',
      });
    }
    if (bar.parentNode !== grid.parentNode || bar.nextElementSibling !== grid) {
      grid.parentNode.insertBefore(bar, grid);
    }
    return bar;
  }
  function r29PaintNoticeView() {
    if (!r29NoticeView || mode !== 'real') return;
    if (r29NoticeView.kind === 'empty') {
      document.querySelector('[data-owner-notice]')?.remove();
      return;
    }
    const host = r29NoticeHost();
    if (!host) return;
    if (r29NoticeView.kind === 'fail') {
      host.replaceChildren(noticeText(H.h('p', {}), '这句话暂时读不到（暂无）'));
      return;
    }
    const notice = r29NoticeView.notice;
    const speaker = roster.get(notice.speakerId);
    const who = speaker && speaker.name ? speaker.name + '：' : '';
    const line = noticeText(H.h('p', {}), who + notice.text);
    const label = notice.entry && notice.entry.type === 'conversation'
      ? '回到这段对话' : '打开今天';
    const go = H.h('button', {
      type: 'button', class: 'ghostbtn', 'data-owner-notice-go': '',
    });
    go.textContent = label;
    if (typeof notice.ticketId === 'string') go.setAttribute('data-ticket', notice.ticketId);
    go.addEventListener('click', () => { void openOwnerNotice(notice); });
    host.replaceChildren(line, go);
  }
  try {
    if (mode === 'real') paintOwnerNotice();
    setInterval(() => {
      try {
        if (mode === 'real' && !document.hidden) paintOwnerNotice();
      } catch { /* 下一轮再试 */ }
    }, 300000);
    document.addEventListener('visibilitychange', () => {
      try {
        if (!document.hidden && mode === 'real') paintOwnerNotice();
      } catch { /* 下一轮再试 */ }
    });
  } catch { /* 壳不齐时不挡首页 */ }
  const profileDrafts=new Map();let profileTarget='',profileSelect=false,profileBusy=false;
  function renderBotList(host,profiles=false) {
    host.replaceChildren();
    if(!rosterReady){host.append(H.h('p',{role:'status'},'助理名册暂时没能读出来，请稍后重试'));return;}
    const enabled=[...roster.values()].filter(b=>b.status==='active').length;
    host.append(H.h('p',{class:'hub-real-roster-summary','data-real-roster-summary':'',role:'status'},roster.size+' 个助理 · '+enabled+' 个可接任务 · 向下滚动查看全部'));
    // 新建助理放进名册（沿用原来的「找首席建助理」流程，data-new-bot-open 由壳接走）。
    if(!profiles)host.append(H.h('button',{type:'button',class:'ghostbtn hub-real-roster-new','data-new-bot-open':'','data-real-roster-new':''},'＋ 新建助理'));
    for(const b of roster.values()) {
      const row=H.h('section',{class:'hub-real-bot-row'+(b.status==='active'?'':' hub-real-disabled'),'data-real-bot-row':b.id});
      row.append(avatarNode(b.avatar,b.id),H.h('div',{class:'grow'},[profiles?H.h('strong',{},b.name):H.h('button',{type:'button',class:'textbutton hub-real-bot-name','data-real-bot-name':b.id,onClick:()=>openProfile(b.id)},b.name),H.h('p',{},b.duty || '还没写职责'),H.h('small',{},b.status==='active'?'可接任务':'已停用 · 旧会话只读')]));
      if(profiles)row.append(H.h('button',{type:'button',class:'ghostbtn',onClick:()=>openProfile(b.id)},'查看资料'));
      else {const onHome=b.status==='active'&&!!document.querySelector('.sidebar .pinned [data-bot-tree="'+b.id+'"]');if(!onHome)row.append(H.h('button',{type:'button',class:'ghostbtn',disabled:b.status!=='active',onClick:()=>{S.drawer=null;let r=selected.get(b.id);const latest=sessions.find(s=>s.bot===b.id);if(latest && !r.fresh)r=record(b.id,latest.id,latest.title);void open(r);}},'聊天'));}
      host.append(row);
    }
  }
  H.registerPanel('hub-real-bots',{title:'助理',render:host=>renderBotList(host)});
  H.registerPanel('hub-real-profiles',{title:'助理资料',render:host=>{profileSelect=true;renderBotList(host,true);}});
  if(typeof H.registerMoreItem==='function' && !r28a1NewShell()) {
    r29More({id:'hub-real-bots',label:'助理',onClick:()=>openRosterPanel('hub-real-bots')});
    r29More({id:'hub-real-profiles',label:'助理资料',onClick:()=>openRosterPanel('hub-real-profiles')});
  }
  function openRosterPanel(panel) {
    if (typeof H.openPanel !== 'function') return;
    H.openPanel(panel);
    // 名册事件可能漏收；每次用户打开都核对服务端集合，不从壳名单猜测。
    void loadRoster().catch(()=>{if(S.drawer===panel)H.toast('名册刷新失败，暂时显示上次读到的资料');});
  }
  function openProfile(id) {
    profileTarget=id;profileSelect=false;
    if (typeof H.openPanel === 'function') H.openPanel('hub-real-profile');
  }
  function refreshRosterPanel() {
    const host=document.querySelector('.drawer [data-hub-panel]');if(!host)return;
    if(S.drawer==='hub-real-bots')renderBotList(host);
    if(S.drawer==='hub-real-profiles')renderBotList(host,true);
    if(S.drawer==='hub-real-profile')renderProfile(host);
  }
  function profileDraft(bot) {
    if(!profileDrafts.has(bot.id))profileDrafts.set(bot.id,{field:'',value:null,base:null,preview:false,tab:'role',file:null,fileURL:'',error:''});return profileDrafts.get(bot.id);
  }
  function renderProfile(host) {
    const b=roster.get(profileTarget);host.replaceChildren();if(!b){host.append(H.h('p',{},'这个助理的资料暂时没能读出来'));return;}
    let editSlot;
    const d=profileDraft(b), button=(label,run,cls='ghostbtn')=>H.h('button',{type:'button',class:cls,disabled:profileBusy,onClick:run},label);
    host.append(button('← 助理资料',()=>H.openPanel('hub-real-profiles'),'textbutton'),H.h('h3',{},b.name),H.h('div',{class:'hub-real-profile-avatar'},avatarNode(b.avatar,b.id)));
    if(d.error)host.append(H.h('p',{role:'alert','data-real-profile-error':''},d.error));
    for(const key of Object.keys(profileFields)) {
      if(d.field===key){editSlot=H.h('div',{});host.append(editSlot);continue;}
      const row=H.h('section',{class:'hub-real-profile-field','data-real-profile-field':key});
      row.append(H.h('strong',{},profileFields[key]),fieldNode(key,b[key]),button(key==='avatar'?'换形象':key==='status'?(b.status==='active'?'停用':'恢复'):'改',()=>{Object.assign(d,{field:key,value:key==='status'?(b.status==='active'?'disabled':'active'):key==='phrases'?[...(b.phrases || []),...Array(3).fill('')].slice(0,3):b[key],base:JSON.parse(JSON.stringify(b)),preview:false,error:'',file:null,fileURL:''});renderProfile(host);revealEditor('[data-real-profile-edit] h3');}));host.append(row);
    }
    if(!d.field)return;
    const edit=H.h('section',{class:'hub-real-profile-edit','data-real-profile-edit':d.field});edit.append(H.h('h3',{},'修改'+profileFields[d.field]));
    const error=text=>{d.error=text;renderProfile(host);};
    if(d.preview) {
      appendChanges(edit,{[d.field]:d.base[d.field]},{[d.field]:d.value});
      if(d.fileURL)edit.append(H.h('img',{src:d.fileURL,alt:'上传预览',class:'hub-real-upload-preview'}));
      edit.append(button('确认',()=>void saveProfile(host,b,d),'primary'),button('再改一下',()=>{d.preview=false;renderProfile(host);}));
    } else {
      if(d.field==='avatar') {
        const tabs=H.h('div',{class:'actions',role:'tablist'});
        for(const [tab,label] of [['role','角色'],['shape','图形'],['upload','上传图片']])tabs.append(H.h('button',{type:'button',role:'tab','aria-selected':String(d.tab===tab),onClick:()=>{d.tab=tab;d.file=null;d.fileURL='';d.value=b.avatar;renderProfile(host);}},label));edit.append(tabs);
        if(d.tab==='upload') {
          const file=H.h('input',{type:'file',accept:'.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif','aria-label':'选择头像图片','data-real-avatar-file':''});
          file.addEventListener('change',()=>{const value=file.files?.[0],message=validateAvatarFile(value);if(message)return error(message);const reader=new FileReader();reader.onload=()=>{d.file=value;d.fileURL=reader.result;d.value={kind:'upload',file:value.name};d.error='';renderProfile(host);};reader.onerror=()=>error('图片没能读出来，请重新选择');reader.readAsDataURL(value);});edit.append(file,H.h('p',{},'选 png、jpg、webp 或 gif，最多 2MB；先预览，再确认上传。'));
          if(d.fileURL)edit.append(H.h('img',{src:d.fileURL,alt:'已选择的图片',class:'hub-real-upload-preview'}));
        } else {
          const choices=H.h('div',{class:'hub-real-avatar-options'});
          if(d.tab==='role')for(const role of avatarKinds.roles){const id=choiceId(role),a={kind:'role',role:id};choices.append(button(roleInfo(id)?.packName || (typeof role==='object'?choiceLabel(role):'角色 '+(choices.children.length+1)),()=>{d.value=a;renderProfile(host);}));choices.lastChild.prepend(avatarNode(a));}
          if(d.tab==='shape') {
            for(const shape of avatarKinds.shapes){const id=choiceId(shape),a={kind:'shape',shape:id,color:d.value?.color || choiceId(avatarKinds.colors[0])};choices.append(button(typeof shape==='object'?choiceLabel(shape):'图形 '+(choices.children.length+1),()=>{d.value=a;renderProfile(host);}));choices.lastChild.prepend(avatarNode(a));}
            const colors=H.h('select',{'aria-label':'图形颜色'});for(const color of avatarKinds.colors){const id=choiceId(color);colors.append(H.h('option',{value:id,selected:d.value?.color===id},colorLabel(id)));}colors.addEventListener('change',()=>{d.value={kind:'shape',shape:d.value?.shape || choiceId(avatarKinds.shapes[0]),color:colors.value};renderProfile(host);});choices.append(colors);
          }
          edit.append(choices,fieldNode('avatar',d.value));
        }
      } else if(d.field==='nameColor') {
        const select=H.h('select',{'aria-label':'名牌色'});for(const item of avatarKinds.colors){const id=choiceId(item);select.append(H.h('option',{value:id,selected:d.value===id},colorLabel(id)));}select.addEventListener('change',()=>{d.value=select.value;});edit.append(select);
      } else if(d.field==='status')edit.append(H.h('p',{},d.value==='active'?'恢复后，这个助理可以继续聊天。':'停用后，保留全部旧会话，暂时不能再发消息。'));
      else for(let index=0;index<(d.field==='phrases'?3:1);index++) {
        const input=H.h(d.field==='name'?'input':'textarea',{class:'pop-input','data-focus':'real-profile-'+d.field+'-'+index,'aria-label':profileFields[d.field]+(d.field==='phrases'?' '+(index+1):''),value:d.field==='phrases'?d.value[index]:d.value || '',rows:2});
        if(d.field==='name')input.maxLength=rosterLimits.nameMax*2;
        input.addEventListener('input',()=>{if(d.field==='phrases')d.value[index]=input.value;else d.value=input.value;});edit.append(input);
      }
      edit.append(button('预览',()=>{
        if(d.field==='name'){const message=validateName(d.value,[...roster.values()],b.id,rosterLimits.nameMax);if(message)return error(message);}
        if(d.field==='avatar' && d.tab==='upload' && !d.file)return error('先选一张图片再预览');
        if(d.field==='avatar' && d.tab!=='upload' && d.value?.kind!==d.tab)return error('先选一个形象再预览');
        d.preview=true;d.error='';renderProfile(host);
      },'primary'));
    }
    edit.append(button('取消',()=>{Object.assign(d,{field:'',file:null,fileURL:'',error:''});renderProfile(host);}));editSlot.replaceWith(edit);
  }
  async function saveProfile(host,b,d) {
    if(profileBusy)return;
    if(JSON.stringify(roster.get(b.id)?.[d.field])!==JSON.stringify(d.base[d.field])){d.preview=false;d.base={...roster.get(b.id)};d.error='资料刚在别处改过，请核对后重新预览';renderProfile(host);return;}
    profileBusy=true;renderProfile(host);
    try {
      if(d.field==='avatar' && d.file)await api('/bots/'+encodeURIComponent(b.id)+'/avatar',{method:'POST',headers:{'Content-Type':d.file.type},body:d.file});
      else await api('/bots/'+encodeURIComponent(b.id),{method:'PATCH',body:JSON.stringify({[d.field]:d.value})});
      await loadRoster();const saved=roster.get(b.id);if(d.file ? saved?.avatar?.kind!=='upload' : JSON.stringify(saved?.[d.field])!==JSON.stringify(d.value))throw Error('保存结果未匹配');Object.assign(d,{field:'',preview:false,file:null,fileURL:'',error:''});H.toast('已改好');
    } catch(error) {d.error=error.status===400?'没改成：资料不符合要求，请核对名字、形象或启用人数':error.status===413?'没改成：图片超过 2MB':'没改成：没能确认保存结果，请核对资料后重试';}
    finally {profileBusy=false;renderProfile(host);}
  }
  H.registerPanel('hub-real-profile',{title:'助理资料',render:renderProfile});
  const rosterCSS=document.createElement('style');rosterCSS.textContent=`
    #app .hub-real-bot-row .hub-real-bot-name{font-weight:700;font-size:inherit;text-align:left;min-height:44px;padding:0;margin:0;color:inherit;background:none !important;border:0;box-shadow:none !important;border-radius:0;display:block}.hub-real-bot-name::after{content:' ›';color:var(--ink-2)}.hub-real-roster-new{width:100%;margin:8px 0 4px;min-height:48px}
    .hub-real-avatar{object-fit:contain;flex:none}.hub-real-avatar-choice{display:flex;align-items:center;gap:10px}.hub-real-avatar-choice .bot-avatar{width:54px;height:54px}
    .hub-real-bot-row{display:flex;align-items:center;gap:10px;padding:14px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}.hub-real-bot-row .bot-avatar{width:48px;height:48px}.hub-real-bot-row p{margin:4px 0}.hub-real-disabled{opacity:.6}
    .hub-real-profile-avatar{text-align:center}.hub-real-profile-avatar .bot-avatar{width:140px;height:140px}.hub-real-profile-field{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)}.hub-real-profile-field>span{flex:1;min-width:120px}#app .hub-real-profile-field>button{min-height:44px;min-width:64px}.hub-real-roster-summary{margin:8px 0;line-height:1.6}
    .hub-real-revision{display:flex;align-items:flex-end;gap:8px;margin-top:12px}.hub-real-revision textarea{flex:1;min-width:0;margin:0}#app .hub-real-revision>button{flex:none;min-height:44px;max-width:6em;white-space:normal}
    .hub-real-field-value{white-space:pre-wrap;overflow-wrap:anywhere}.hub-real-profile-edit{padding:14px 0}.hub-real-profile-edit .pop-input{display:block;width:100%;margin:10px 0}.hub-real-profile-edit button{margin:4px}
    .hub-real-avatar-options{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.hub-real-avatar-options .bot-avatar{display:block;width:64px;height:64px}.hub-real-upload-preview{display:block;max-width:180px;max-height:180px;margin:12px auto;object-fit:contain}
    .hub-real-changes section{padding:10px 0;border-bottom:1px dashed var(--line)}.hub-real-before,.hub-real-after{display:flex;gap:10px;align-items:center;padding:5px 0}.hub-real-before{opacity:.65}.hub-real-before>small,.hub-real-after>small{flex:none;min-width:3em}.hub-real-letter .hub-real-changes .bot-avatar{width:48px;height:48px}
    .r22-pet-platform>.hub-real-avatar{display:block;width:132px;height:132px;margin:auto}
  `;document.head.append(rosterCSS);
  if(mode==='real' && typeof window.fetch==='function')void loadRolePack();
  function attachCards(r) {
    for (const c of cards.values()) {
      if (c.sessionId !== r.remote) continue;
      const key = c.type + ':' + c.id;
      let m = cardMessages.get(key);
      if (!m) {
        m = { id: uid(), hubReal: true, ts: c.createdAt, from: r.bot, role: 'bot', status: 'delivered',
          time: messageDate(c.createdAt)?.time || '', parts: [{ type: 'hub-real-' + c.type, data: c }] };
        cardMessages.set(key, m);
      }
      m.ts = c.createdAt; m.seq = c.seq;
      if (!r.messages.includes(m)) r.messages.push(m);
    }
    sortTimeline(r.messages);
  }
  function upsertCard(value, { render = true } = {}) {
    if (!value || !['approval','delegation'].includes(value.type) || typeof value.id !== 'string' ||
        typeof value.sessionId !== 'string' || !isBot(value.bot)) return;
    const key = value.type + ':' + value.id, old = cards.get(key), wasPending = old?.status === 'pending';
    if (old && old.type === 'approval' && old.status !== 'pending' && value.status === 'pending') return;
    if(rosterTool(value) && !cardNames.has(value.id))cardNames.set(value.id,{
      botName:value.botName || (value.bot===value.target?value.before?.name:'') || botName(value.bot),
      targetName:value.before?.name || value.targetName || roster.get(value.target)?.name || '助理'
    });
    if (old) Object.assign(old, value); else cards.set(key, { ...value });
    const c = cards.get(key), owner = c.type === 'delegation' ? chiefId() : c.bot;
    const r = record(owner, c.sessionId, sessions.find(s => s.id === c.sessionId)?.title || '会话');
    attachCards(r);
    if (c.type === 'approval') {
      if (wasPending !== (c.status === 'pending')) {
        const delta = c.status === 'pending' ? 1 : -1;
        serverPending.set(c.bot, Math.max(0, (serverPending.get(c.bot) || 0) + delta));
        pendingTotal = Math.max(0, pendingTotal + delta);
      }
      if (!activities.has(key) && c.status === 'pending' && H.registerActivity) {
        const a = H.registerActivity({ id: uid(), kind: 'decide', bot: c.bot, conversation: r.local,
          title: c.action || '要你点头', detail: relativePath(c.path), time: messageDate(c.createdAt)?.time || '',
          actions: [{ label: '查看待批', run: () => void openCard(c) }] });
        activities.set(key, a);
      } else if (wasPending && c.status !== 'pending' && activities.has(key)) H.completeActivity(activities.get(key).id);
    } else {
      // 卡片到达时立即反映派工状态；权威 running/unread 随后的 status 帧补齐。
      if (['queued','running'].includes(c.status)) delegated.set(c.bot, { running: c.status === 'running', queued: c.status === 'queued' ? c.queuePos || 1 : 0 });
      else {
        delegated.set(c.bot, { running: false, queued: 0 });
        const b = S.bots.find(b => b.id === c.bot); if (b && c.status === 'done') { b.unread = Math.max(1, b.unread || 0); serverUnread.set(c.bot, b.unread); }
      }
    }
    if (render && active(r)) H.reading.preserve(redraw, { reason: 'real-card' });
    decorate();
    if (S.drawer === 'hub-real-card' && drawerCard === c.id) {
      const host = document.querySelector('.drawer [data-hub-panel]');
      if (host) host.replaceChildren(approvalCard.render(c));
    }
    if (S.drawer === 'hub-real-activity') {
      const host = document.querySelector('.drawer [data-hub-panel]'); if (host) renderApprovals(host);
    }
  }
  function relativePath(path) { return shortPath(path,hubHomePrefix); }
  function letter(c, suffix) {
    return H.h('section', { class: 'mcard r22-letter hub-real-letter', style: H.botStyle(c.bot), 'data-real-card': c.id },
      H.h('span', { class: 'r22-nameplate', 'data-nameplate-bot': c.bot, style: H.botStyle(c.bot) }, botName(c.bot) + ' · ' + suffix));
  }
  function approvalQuoteLabel(c) {
    if (rosterTool(c)) return rosterTitle(c);
    if (c.tool === 'bash') return botName(c.bot) + '想跑一条命令';
    return approvalTitle({ ...c, botName: botName(c.bot) });
  }

  function r29ProjectTalk(content, raw) {
    const text = String(raw || '');
    if (!text || text.includes('暂时读不到') || text === '正在读取项目页…') return false;
    try {
      const talk = window.HubPlainTalk;
      if (!talk || typeof talk.renderProject !== 'function') return false;
      const node = talk.renderProject(text);
      if (!node || typeof content.replaceWith !== 'function') return false;
      content.replaceWith(node);
      return true;
    } catch { return false; }
  }
  function r29SpokenCard(card) {
    try {
      const talk = window.HubPlainTalk;
      if (!talk || typeof talk.renderCard !== 'function') return null;
      return talk.renderCard(card) || null;
    } catch { return null; }
  }
  const approvalCard = { title: '要你点头', quoteLabel: approvalQuoteLabel, render(c) {
    const spoken = r29SpokenCard(c);
    if (spoken) return spoken;
    const root = letter(c, '审批'), params = H.h('dl', { class: 'params' });
    root.dataset.realCardStatus = c.status;
    if(rosterTool(c)) {
      root.append(H.h('h3',{},rosterTitle(c)));
      appendChanges(root,c.before,c.after);
      if(c.why)root.append(H.h('p',{class:'hub-real-why'},'为什么：'+String(c.why)));
    } else if(c.tool==='bash') {
      root.append(H.h('h3', {}, botName(c.bot)+'想跑一条命令'));
      params.append(H.h('dt',{},'命令'),H.h('dd',{},H.h('pre',{class:'hub-real-command','data-real-command':''},c.command || '')),
        H.h('dt',{},'在哪个目录跑'),H.h('dd',{},relativePath(c.cwd)),H.h('dt',{},'为什么'),H.h('dd',{},c.why || '助理没写原因'));
      const needs=[];
      if(c.caps?.network)needs.push('联网');
      if(c.caps?.writeRoots?.length)needs.push('要写这些目录：'+c.caps.writeRoots.map(relativePath).join('、'));
      if(c.caps?.longRunning)needs.push('会跑很久');
      if(needs.length)params.append(H.h('dt',{},'需要的权限'),H.h('dd',{},needs.join('；')));
      if(c.timeoutMs>60000)params.append(H.h('dt',{},'最长跑多久'),H.h('dd',{},'最长跑 '+Math.ceil(c.timeoutMs/60000)+' 分钟'));
      root.append(params);
    } else if (plainCardInfo(c, displayName)) {
      renderPlainApproval(root, params, c);
    } else if (c.confirm === true && c.tool === 'confirm') {
      root.append(H.h('h3', {}, plainLine(c.title, 60) || '要你确认一件事'));
    } else {
    root.append(H.h('h3', {}, [H.h('span', { class: 'shell-level-sticker', 'data-level-sticker': 'L3' }, 'L3'), approvalTitle(c)]));
    for (const [label, text] of [['路径',relativePath(c.path)],['字数',String(c.chars ?? 0) + ' 字']]) {
      params.append(H.h('dt', {}, label), H.h('dd', {}, text || '—'));
    }
    root.append(params);
    if (c.diff) {
      const diff = H.h('pre', { class: 'diff' });
      String(c.diff).slice(0, 600).split('\n').forEach(line => diff.append(H.h('span', { class: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx' }, line)));
      root.append(diff);
    } else root.append(H.h('p', { class: 'hub-real-preview' }, String(c.preview || '').slice(0, 200)));
    const why = approvalWhy(c.why);
    if (why) root.append(H.h('p', { class: 'hub-real-why' }, '为什么要写：' + why));
    }
    if (c.confirm === true && typeof c.text === 'string' && c.text) {
      root.append(H.h('div', { class: 'hub-real-confirm-text', style: 'white-space: pre-wrap' }, c.text));
    }
    // 第三次上线合并：路35 的看全文块（校验码核对）同时覆盖修G 的看全文，所有带全文校验码的卡只画一份。
    { const full = fullTextBlock(c); if (full) root.append(full); }
    if (c.status === 'pending') {
      root.append(H.h('p', { class: 'mini-note', 'data-real-countdown': c.id }, remaining(c)));
      const buttons = H.h('div', { class: 'actions' });
      const options = c.kind === 'group_plan' ? (c.choices || []).filter(choice => ['approve', 'reject', 'yes', 'no']
        .includes(choice.id)).map(choice => [choice.label, ['approve', 'yes'].includes(choice.id) ?
          'approve' : 'reject', ['approve', 'yes'].includes(choice.id) ? 'primary' : 'ghostbtn']) :
        approvalButtons(c);
      for (const [label, decision, cls] of options) {
        buttons.append(H.h('button', { type: 'button', class: cls, 'data-real-answer': decision, 'data-real-approval': c.id, disabled: answering.has(c.id) }, label));
      }
      if(c.tool==='bash' && c.grantable===true)buttons.append(H.h('button',{type:'button',class:'ghostbtn','data-real-answer':'remember','data-real-approval':c.id,disabled:answering.has(c.id)},'以后这类不用问'));
      if (plainCardInfo(c)?.rememberable) buttons.append(H.h('button', { type: 'button', class: 'ghostbtn',
        'data-real-answer': 'remember', 'data-real-approval': c.id,
        disabled: answering.has(c.id) }, '以后这类不用问'));
      root.append(buttons);
      if (approvalDrafts.has(c.id)) {
        root.append(H.h('div',{class:'hub-real-revision'},[
          H.h('textarea', { class: 'pop-input', rows: 2, maxlength: 500, 'data-real-revision': c.id, 'data-focus': 'real-revision-' + c.id, 'aria-label': '改一下的意见' }, approvalDrafts.get(c.id)),
          H.h('button', { type: 'button', class: 'primary', 'data-real-answer': 'revise', 'data-real-approval': c.id, disabled: answering.has(c.id) }, '提交意见')]));
      }
    } else root.append(H.h('p', { class: 'result', role: 'status' }, approvalResult(c)));
    return root;
  } };
  H.registerCard('hub-real-approval', approvalCard);
  H.registerCard('hub-real-delegation', { title: '派工进度', quoteLabel: c => c.task, render(c) {
    const root = letter(c, '派工'), { steps, count } = delegationSteps(c.steps);
    root.dataset.realCardStatus = c.status;
    const stage = c.status === 'queued' ? '排队第 ' + Math.max(1, c.queuePos || 1) + ' 位' : c.status === 'running' ? '在做' :
      c.status === 'done' ? '完成' : '失败：' + delegationLabel(c.reason || '未能完成');
    root.append(H.h('div', { class: 'row hub-real-delegate-head' }, [H.avatar(c.bot), H.h('h3', {}, '派给' + botName(c.bot))]),
      H.h('p', {}, String(c.task || '').slice(0, 120)), H.h('p', { class: 'result' }, stage));
    const list = H.h('ol', { class: 'hub-real-timeline' });
    const row = step => H.h('li', {}, [H.h('time', {}, messageDate(step.ts)?.time || ''), H.h('span', {}, step.label)]);
    let folded;
    for (const step of steps) {
      if (count <= 4 || delegationMilestone(step.label)) { list.append(row(step)); continue; }
      if (!folded) {
        const details = H.h('details', { class: 'hub-real-delegate-steps', 'data-real-delegate-steps': c.id });
        details.open = openDelegations.has(c.id);
        details.addEventListener('toggle', () => { if (details.isConnected) details.open ? openDelegations.add(c.id) : openDelegations.delete(c.id); });
        details.append(H.h('summary', {}, ['共 ' + count + ' 步', H.h('span', { 'aria-hidden': 'true' }, '›')]));
        folded = H.h('ol', { class: 'hub-real-timeline' }); details.append(folded); list.append(H.h('li', {}, details));
      }
      folded.append(row(step));
    }
    root.append(list);
    if (c.status === 'done') root.append(H.h('p', { class: 'hub-real-delegate-summary' }, delegationSummary(c.summary)));
    const note = continuationNotes.get(c.id);
    if (c.status === 'failed' && (canContinue(c) || c.continuedBy)) {
      root.append(H.h('button', { type: 'button', class: 'ghostbtn hub-real-continue', 'data-real-continue': c.id,
        disabled: !!c.continuedBy || continuing.has(c.id) || note === '已经续过一次了' },
        c.continuedBy ? '已让它接着做' : continuing.has(c.id) ? '正在派出…' : note === '已经续过一次了' ? note : '让它接着做剩下的'));
    }
    if (note && !c.continuedBy) root.append(H.h('p', { class: 'mini-note', role: 'status' }, note));
    if (c.toSession) root.append(H.h('button', { type: 'button', class: 'textbutton', 'data-real-report': c.id }, c.status === 'done' ? '查看回报全文 →' : '查看派工会话 →'));
    return root;
  } });
  async function continueDelegation(id, button) {
    const c = cards.get('delegation:' + id);
    if (!c || !canContinue(c) || continuing.has(id) || continuationNotes.get(id) === '已经续过一次了') return;
    continuing.add(id); continuationNotes.delete(id); button.disabled = true; button.textContent = '正在派出…';
    try {
      const result = await api('/delegations/' + encodeURIComponent(id) + '/continue', { method: 'POST', body: '{}' });
      if (result.ok !== true || !result.card?.continuedBy) throw new Error('续做结果未确认');
      upsertCard(result.card);
      if (result.continuation) upsertCard(result.continuation);
      else { const r = remoteRecords.get(c.sessionId); if (r) await loadCards(r); }
    } catch (error) {
      const text = error.status === 409 ? '已经续过一次了' : '没能确认续做结果，请重新加载核对';
      continuationNotes.set(id, text); H.toast(text);
      const r = remoteRecords.get(c.sessionId); if (r) await loadCards(r).catch(() => {});
    } finally {
      continuing.delete(id);
      if (current()?.remote === c.sessionId) H.reading.preserve(redraw, { reason: 'real-continue' });
      void refreshStatus().catch(() => {});
    }
  }
  async function answerApproval(id, decision, button) {
    const c = cards.get('approval:' + id); if (!c || c.status !== 'pending' || answering.has(id)) return;
    if (decision === 'edit') {
      approvalDrafts.set(id, approvalDrafts.get(id) || ''); redraw();
      const editor=[...document.querySelectorAll('[data-real-revision]')].find(n=>n.dataset.realRevision===id);
      if(editor){editor.focus({preventScroll:true});const submit=editor.parentElement.querySelector('[data-real-answer="revise"]');if(submit)revealEditor(submit);}
      return;
    }
    const remember=decision==='remember';
    if(remember) {
      if (plainCardInfo(c)?.rememberable) {
        if (!window.confirm('以后这类事不再问你。确定？')) return;
      } else {
      if(c.tool!=='bash' || c.grantable!==true || !window.confirm('以后 '+botName(c.bot)+' 在 '+relativePath(c.grantKey.dir)+' 用 '+c.grantKey.program+' 不再问你，'+grantDateText(grantUntil(commandGrantDays))+'。确定？'))return;
      }
      decision='approve';
    }
    const note = approvalDrafts.get(id)?.trim();
    if (decision === 'revise' && !note) { H.toast('写一句修改意见再提交'); return; }
    answering.add(id); button.disabled = true;
    try {
      const result = await api('/approvals/' + encodeURIComponent(id) + '/answer', { method: 'POST', body: JSON.stringify({ decision, ...(remember ? {remember:true} : {}), ...(decision === 'revise' ? { note } : {}) }) });
      if (result.ok !== true || !result.card) throw new Error('审批结果未确认');
      upsertCard(result.card); approvalDrafts.delete(id);
    } catch (error) {
      if(rosterTool(c) && error.payload?.card)upsertCard(error.payload.card);
      if (error.status === 409) {
        H.toast('这张卡已处理，正在刷新');
        const r = remoteRecords.get(c.sessionId); if (r) await loadCards(r).catch(() => {});
      } else H.toast('没能确认审批结果，请刷新后再看');
    } finally { answering.delete(id); if (current()?.remote === c.sessionId) redraw(); void refreshStatus().catch(() => {}); }
  }
  async function loadCards(r) {
    if (!r.remote) return;
    const data = await api(endpoint(r.remote, 'cards'));
    if (mode !== 'real') return;
    (Array.isArray(data.cards) ? data.cards : []).forEach(c => upsertCard(c, { render: false }));
    attachCards(r); if (active(r)) H.reading.preserve(redraw, { reason: 'real-cards' });
  }
  let drawerCard;
  H.registerPanel('hub-real-card', { title: '要你点头', render: host => {
    const card = cards.get('approval:' + drawerCard);
    if (card) host.replaceChildren(approvalCard.render(card));
  } });
  async function openCard(c) {
    if (!c.sessionId && c.type === 'approval') {
      drawerCard = c.id;
      H.openPanel('hub-real-card');
      return;
    }
    const owner = c.type === 'delegation' ? chiefId() : c.bot;
    S.drawer = null; await open(record(owner, c.sessionId, sessions.find(s => s.id === c.sessionId)?.title || '会话'));
    const el = [...document.querySelectorAll('[data-real-card]')].find(el => el.dataset.realCard === c.id);
    el?.scrollIntoView({ block: 'center' });
  }
  function renderApprovals(host) {
    host.replaceChildren();
    const pending = [...cards.values()].filter(c => c.type === 'approval' && c.status === 'pending').sort((a,b) => stampValue(a.createdAt) - stampValue(b.createdAt));
    host.append(H.h('p', { class: 'mini-note' }, pendingTotal + ' 项等你点头'));
    if (!pending.length) host.append(H.h('p', {}, pendingTotal ? '正在读取待批卡…' : '现在没有待批事项'));
    pending.forEach(c => {
      host.append(H.h('button', { type: 'button', class: 'setting-row hub-real-session', 'data-real-pending': c.id }, [
        H.h('strong', {}, botName(c.bot) + ' · ' + (c.action || '要你点头')),
        H.h('small', {}, relativePath(c.path) + ' · ' + remaining(c))
      ]));
      try {
        const card = approvalCard.render(c);
        if (card) host.append(card);
      } catch { /* 抽屉里这张卡画失败时，上面的入口还在 */ }
    });
  }
  H.registerPanel('hub-real-activity', { title: '活动 · 等你点头', render: renderApprovals });
  async function renderPermissions(host) {
    host.replaceChildren(H.h('p',{role:'status'},'正在读取权限…'));
    try {
      const [data,status]=await Promise.all([api('/grants'),api('/status')]); if(host.isConnected===false)return;
      if(typeof status.hubHome==='string' && status.hubHome.startsWith('/'))hubHomePrefix=status.hubHome;
      host.replaceChildren();
      if(!data.grants?.length) { host.append(H.h('p',{},'还没有放行过的命令，所有「先问」的命令都会弹卡'));return; }
      for(const g of data.grants) {
        const row=H.h('section',{class:'hub-real-permission','data-real-permission':g.id});
        row.append(H.h('strong',{},botName(g.bot)+' · '+g.program),H.h('p',{},relativePath(g.dir)),
          H.h('p',{},permissionExpiry(g)));
        if(g.status==='active')row.append(H.h('button',{type:'button',class:'ghostbtn','data-real-revoke':g.id,disabled:revoking.has(g.id)},'撤销'));
        host.append(row);
      }
    } catch {host.replaceChildren(H.h('p',{role:'status'},'权限暂时没能读出来，请重新打开再试'));}
  }
  H.registerPanel('hub-real-permissions',{title:'权限',render:renderPermissions});
  if (typeof H.registerMoreItem === 'function') {
    r29More({ id: 'hub-real-permissions', label: '权限',
      onClick: () => H.openPanel('hub-real-permissions') });
  }
  function displayName(id) {
    return S.bots.find(b => b.id === id)?.name || id || '助理';
  }

  async function renderBoard(host) {
    try {
      if (mode !== 'real') return;
      host.replaceChildren(H.h('p', { role: 'status' }, '正在读取看板…'));
      const result = await extGet('board', '/board/tickets', { force: true, ttl: 0 });
      if (!result.ok || !Array.isArray(result.data?.tickets)) {
        host.replaceChildren(H.h('p', {}, '看板暂时没有数据（暂无）'));
        return;
      }
      const tickets = result.data.tickets;
      host.replaceChildren(H.h('small', {}, '共 ' + tickets.length + ' 张工单 · 只看不改'));
      if (!tickets.length) host.append(H.h('p', {}, '现在没有工单'));
      for (const column of boardColumns(tickets)) {
        if (!column.count) continue;
        const section = H.h('section', { class: 'hub-real-kcol' });
        section.append(H.h('h3', {}, column.label + ' · ' + column.count));
        for (const ticket of column.tickets.slice(0, 20)) section.append(boardCard(ticket));
        if (column.count > 20) section.append(H.h('p', {}, '还有 ' + (column.count - 20) + ' 张'));
        host.append(section);
      }
    } catch {
      try { host.replaceChildren(H.h('p', {}, '看板暂时没有数据（暂无）')); } catch {}
    }
  }

  // 只给名册里的助理画脸。外部、本人、对不上的人不借别人的头像。
  function boardFaceNode(person) {
    if (!person || person.type === 'external' || person.type === 'owner') return null;
    if (typeof person.id !== 'string' || !person.id) return null;
    if (!Array.isArray(S.bots) || !S.bots.some(bot => bot && bot.id === person.id)) return null;
    const api = typeof window !== 'undefined' ? window.HubAvatars : null;
    if (!api || typeof api.html !== 'function') return null;
    let html = '';
    try { html = api.html(person.id, 28); } catch { return null; }
    if (typeof html !== 'string' || !html.trim()) return null;
    try { return H.fromHTML(html); } catch { return null; }
  }

  function boardCard(ticket) {
    const info = boardCardInfo(ticket, displayName);
    const card = H.h('details', { class: 'hub-real-kcard' });
    const line = H.h('span', {
      class: 'hub-real-board-line',
      style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', width: '100%' }
    });
    const seen = new Set();
    for (const person of Array.isArray(info.faces) ? info.faces : []) {
      const key = String(person?.type || '') + '\0' + String(person?.id || '');
      if (!person || seen.has(key)) continue;
      seen.add(key);
      const face = boardFaceNode(person);
      if (face) line.append(face);
    }
    line.append(H.h('span', {}, info.line || ''));
    const summary = H.h('summary', {}, [line, H.h('strong', {}, info.title)]);
    if (info.legacy) summary.append(H.h('span', { class: 'hub-real-legacy' }, '旧'));
    if (info.hop) summary.append(H.h('small', {}, '转手 ' + info.hop + ' 次'));
    card.append(summary);
    for (const row of Array.isArray(info.detail) ? info.detail : []) {
      if (!row || typeof row.label !== 'string') continue;
      card.append(H.h('p', {}, row.label + '：' + (typeof row.text === 'string' ? row.text : '')));
    }
    return card;
  }

  // 这一块已经画着卡片版就别先清成「正在读取」。
  const r30Painted = (host, selector) => typeof host?.querySelector === 'function' && !!host.querySelector(selector);

  async function renderLedger(host) {
    try {
      if (mode !== 'real') return;
      // 已经画着卡片版时不先清成「正在读取」，免得每次刷新都闪一下。
      if (!r30Painted(host, '[data-r30l-ledger]')) host.replaceChildren(H.h('p', { role: 'status' }, '正在读取账本…'));
      const [all, today] = await Promise.all([
        extGet('ledger', '/ledger', { force: true, ttl: 0 }),
        extGet('ledger', '/ledger/today', { force: true, ttl: 0 })
      ]);
      // 界面壳带了结构化账本时交给它画；没有就走下面原来的文字版。
      if (typeof window.R30LT?.mountLedger === 'function') {
        const raw = { all: all.data, today: today.ok ? today.data : null };
        const model = all.ok ? window.R30LT.normalizeLedger(raw, displayName) : null;
        // 设了每月预算才给壳，壳才画进度条；没设就没有，不显示。
        if (model) {
          try {
            const set = typeof window.HubSettings?.get === 'function' ? await window.HubSettings.get() : null;
            const limit = set && set.budget && set.budget.monthly;
            if (typeof limit === 'number' && limit > 0) model.budgets = { month: { limit, cur: set.budget.currency || 'CNY' } };
          } catch { /* 读不到预算就当没设 */ }
        }
        if (host.isConnected !== false) window.R30LT.mountLedger(host, model);
        return;
      }
      if (!all.ok || !all.data?.total || typeof all.data.total !== 'object') {
        host.replaceChildren(H.h('p', {}, '账本暂时没有数据（暂无）'));
        return;
      }
      host.replaceChildren();
      const data = all.data;
      if (today.ok && today.data?.total && typeof today.data.total === 'object') {
        const t = today.data.total;
        host.append(H.h('p', {}, '今天 · ' + (t.calls ?? '未知') + ' 次调用 · ' +
          formatTokenCount(bucketTokens(t).total) + ' token · ' + (bucketCost(t).join(' / ') || '费用未知')));
      }
      const total = data.total;
      const usage = bucketTokens(total);
      host.append(H.h('h3', {}, '总计'));
      host.append(H.h('p', {}, (total.calls ?? '未知') + ' 次调用 · ' +
        formatTokenCount(usage.total) + ' token'));
      host.append(H.h('p', {}, '输入 ' + formatTokenCount(usage.parts.input) + ' · 缓存读 ' +
        formatTokenCount(usage.parts.cacheRead) + ' · 输出 ' + formatTokenCount(usage.parts.output)));
      if (usage.unreported > 0) {
        host.append(H.h('p', {}, '有 ' + usage.unreported + ' 次调用没报输入或输出 token，没算进上面的总数'));
      }
      host.append(H.h('p', {}, bucketCost(total).join(' / ') || '费用未知'));
      host.append(H.h('h3', {}, '近 7 天'));
      for (const day of Array.isArray(data.last7Days?.days) ? data.last7Days.days : []) {
        const bucket = day?.total || day;
        host.append(H.h('p', {}, (day?.date || '未知') + ' · ' + (bucket?.calls ?? '未知') + ' 次调用 · ' +
          formatTokenCount(bucketTokens(bucket).total) + ' token'));
      }
      for (const [title, rows] of [['按助理', ledgerRows(data.byBot, displayName)],
        ['按工单', ledgerRows(data.byTicket, displayName, 8)]]) {
        host.append(H.h('h3', {}, title));
        for (const row of rows) host.append(H.h('p', { class: 'hub-real-lrow' }, [
          H.h('span', {}, row.label), H.h('span', {}, row.calls + ' 次 · ' + row.tokens + ' token · ' + row.cost)
        ]));
      }
      const counts = data.counts || {};
      host.append(H.h('h3', {}, '其它记录'));
      host.append(H.h('p', {}, '审批 ' + (counts.approvals ?? '未知') + ' · 动作 ' +
        (counts.actions ?? '未知') + ' · 变更 ' + (counts.changes ?? '未知') + ' · 派活 ' +
        (counts.dispatches ?? '未知')));
      host.append(H.h('small', {},
        '费用按价表折算，不是服务商账单；套餐内的只给折算参考。'));
    } catch {
      try { host.replaceChildren(H.h('p', {}, '账本暂时没有数据（暂无）')); } catch {}
    }
  }

  async function sessionUsage(id) {
    const result = await extGet('ledger', '/ledger/session/' + encodeURIComponent(id), { ttl: 15000 });
    return result.ok && result.data && typeof result.data === 'object' ? result.data : null;
  }

  async function renderLedgerPanel(host) {
    try {
      if (mode !== 'real') return;
      // 没有哪段会话在看时，不放「本会话用量暂无」这个空块；从某段聊天进来、且这段有调用才显示。
      const content = H.h('div', {});
      host.replaceChildren(content);
      const mine = current()?.remote ? sessionUsage(current().remote).catch(() => null) : Promise.resolve(null);
      const drawn = renderLedger(content);
      const bucket = await mine;
      if (bucket && bucket.calls > 0 && host.isConnected !== false) {
        host.prepend(H.h('p', { 'data-real-session-usage': '' }, usageLine(bucket)));
      }
      await drawn;
    } catch {}
  }

  async function renderUsageReal(host) {
    try {
      if (mode !== 'real') return;
      await renderLedgerPanel(host);
      host.append(H.h('button', { type: 'button', 'data-real-open-ledger': '' }, '打开完整账本'));
    } catch {}
  }

  function paintBoardView() {
    if (mode !== 'real' || !['kanban', 'board'].includes(S.view)) return;
    const host = document.querySelector('.boardview');
    if (!host) return;
    // 界面壳的新看板自己读自己改，适配层不再把它换成只读列表。
    if (host.hasAttribute('data-r30-board')) return;
    let root = host.querySelector('.hub-real-board-root');
    if (!root) {
      const heading = host.querySelector('.boardbar,.r22-board-heading');
      root = H.h('div', { class: 'hub-real-board-root' });
      host.replaceChildren(...(heading ? [heading, root] : [root]));
      const p = heading?.querySelector('p');
      if (p) p.textContent = '真实工单 · 只看不改';
    }
    host.querySelectorAll('.hub-real-sample').forEach(n => n.remove());
    repaintRoot(root, 10000, renderBoard);
  }

  function repaintRoot(root, ttl, render) {
    if (Date.now() - Number(root.dataset.at || 0) <= ttl) return;
    root.dataset.at = String(Date.now());
    void render(root).catch(() => {});
  }

  function paintUsageDrawer() {
    if (mode !== 'real' || S.drawer !== 'usage') return;
    const host = document.querySelector('.drawer .r22-sheet-content') || document.querySelector('.drawer');
    if (!host) return;
    let root = host.querySelector('.hub-real-usage-root');
    if (!root) {
      root = H.h('div', { class: 'hub-real-usage-root' });
      host.replaceChildren(root);
    }
    document.querySelectorAll('.drawer .dhead .hub-real-sample').forEach(n => n.remove());
    repaintRoot(root, 15000, renderUsageReal);
  }

  function paintLedgerView() {
    if (mode !== 'real' || S.view !== 'ledger') return;
    // 页面里的内容容器类名带模块前缀（m-governance-content），先找页内标题后面那一个。
    const title = document.querySelector('.hub-extension-view .page-title') || document.querySelector('.page-title');
    const host = title?.parentElement?.querySelector(':scope > .content') || title?.nextElementSibling;
    if (!host) return;
    let root = host.querySelector('.hub-real-ledger-root');
    if (!root) {
      root = H.h('div', { class: 'hub-real-ledger-root' });
      host.replaceChildren(root);
    }
    title.querySelectorAll('.hub-real-sample').forEach(n => n.remove());
    repaintRoot(root, 10000, renderLedger);
  }

  const r29GroupViews = new Map();
  let r29GroupEnter = 0;
  function r29NewGroupPage() {
    return typeof window.r29GroupThread === 'function';
  }
  function r29ShellKind(message) {
    const named = message && (message.eventType || message.type || message.kind);
    return message?.system === true &&
      ['handoff', 'handback', 'accept', 'reject', 'ask', 'join', 'leave'].includes(named) ? named : '';
  }
  function r29Duty(member, tickets) {
    const id = member.id || member.bot || '';
    const role = typeof member.role === 'string' ? member.role : '';
    if (role === 'host') return '主持';
    if (role && role !== 'member') return role;
    const ticket = (tickets || []).find(item => item && (item.assignee === id || item.claimedBy === id));
    if (ticket && typeof ticket.title === 'string' && ticket.title) return ticket.title;
    return role === 'member' ? '成员' : '暂无';
  }
  function r29Now(member, tickets) {
    const id = member.id || member.bot || '';
    const ticket = (tickets || []).find(item => item && (item.assignee === id || item.claimedBy === id));
    const state = ticket && (ticket.status || ticket.state) || member.status || '';
    if (state === 'progress' || state === 'working') return '在做';
    if (state === 'blocked' || state === 'failed') return '卡住了';
    if (state === 'waiting-human') return '等你点头';
    if (state === 'completed' || state === 'done') return '做完';
    if (typeof member.status === 'string' && member.status) return member.status;
    return '暂无';
  }
  function r29StatusLine(members) {
    if (members.some(item => item.status === '卡住了')) return '有人卡住了';
    if (members.some(item => item.status === '等你点头')) return '等你点头';
    if (members.some(item => item.status === '在做')) return '在一起做';
    return '';
  }
  function r29PlanMessages(groupId) {
    const out = [];
    for (const card of cards.values()) {
      if (!card || card.type !== 'approval' || card.status !== 'pending') continue;
      const plan = card.kind === 'group_plan' || card.tool === 'group_plan' || card.tool === 'group_create';
      if (!plan) continue;
      if (card.groupId && card.groupId !== groupId) continue;
      out.push({
        id: 'plan-' + card.id, from: card.bot || '', name: card.botName || '',
        text: typeof card.text === 'string' ? card.text : '',
        parts: [{ type: 'hub-real-approval', data: card }]
      });
    }
    return out;
  }
  function r29FeedMessages(group, packed) {
    const members = packed.members || [];
    const rows = [];
    for (const message of packed.messages || []) {
      if (!message || typeof message.text !== 'string') continue;
      const from = typeof message.from === 'string' ? message.from : '';
      const member = members.find(item => item.id === from);
      const kind = r29ShellKind(message);
      const row = { id: message.id != null ? String(message.id) : '', from, text: message.text };
      if (member && member.name) row.name = member.name;
      if (kind) row.type = kind;
      if (kind === 'ask') {
        row.needOwner = true;
        if (message.answered === true) row.answered = true;
      }
      if (!row.text && !row.type) continue;
      rows.push(row);
    }
    // 旧消息没有事件类型；只展示当前工单状态能证明的事件，不从正文猜历史。
    for (const ticket of packed.tickets || []) {
      const kind = ({ todo: 'handoff', doing: 'handoff', review: 'handback',
        done: 'accept', rework: 'reject', wait_owner: 'ask' })[ticket.status];
      if (!kind) continue;
      const label = ({ handoff: '分工确定', handback: '交单', accept: '验收通过',
        reject: '退回', ask: '问主人' })[kind];
      rows.push({ id: 'ticket-' + ticket.id, type: kind, text: label + '：' + (ticket.title || '工单'),
        ...(kind === 'ask' ? { needOwner: true } : {}) });
    }
    return rows.concat(r29PlanMessages(group.id));
  }
  async function r29PullGroup(id, more = false) {
    // more=true 只取比手上最后一条更新的发言，和手上的合并；返回 'same' 表示什么都没变。
    const have = more ? r29GroupViews.get(id) : null;
    let last = 0;
    for (const item of have?.messages || []) if (Number.isSafeInteger(item?.id) && item.id > last) last = item.id;
    const path = '/groups/' + encodeURIComponent(id) + '?after=' + (have && last ? last : 0);
    const result = await extGet('groups', path, { force: true, ttl: 0 });
    const data = result && result.data;
    let raw = data && Array.isArray(data.messages) ? data.messages : null;
    if (!result || !result.ok || !raw) return false;
    if (have && last) {
      const seen = new Set(have.messages.map(item => item.id));
      raw = have.messages.concat(raw.filter(item => item && !seen.has(item.id)));
    }
    const before = have ? JSON.stringify([have.messages.length, have.tickets, have.members]) : '';
    const info = data.group && typeof data.group === 'object' ? data.group : {};
    const source = Array.isArray(info.members) ? info.members : [];
    const tickets = Array.isArray(data.tickets) ? data.tickets : [];
    const members = source.map(member => {
      const src = typeof member === 'string' ? { id: member } : (member || {});
      const mid = src.id || src.bot || '';
      if (typeof mid !== 'string' || !mid) return null;
      return { id: mid, name: src.name || '', duty: r29Duty(src, tickets), status: r29Now(src, tickets) };
    }).filter(Boolean);
    const view = {
      members, messages: raw.filter(item => item && typeof item.text === 'string'),
      tickets, line: r29StatusLine(members)
    };
    r29GroupViews.set(id, view);
    if (have && before === JSON.stringify([view.messages.length, view.tickets, view.members])) return 'same';
    return true;
  }
  // 组里的回复是后台助理写进组的，没有像单聊那样的实时流：看着组的时候每 2.5 秒取一次新发言。
  // 多位助理先后回复，各自带自己的名字和头像（members 里查）。
  var r31GroupBusy = false;
  async function r31GroupTick() {
    const id = S.r29GroupFocus;
    if (!id || r31GroupBusy || mode !== 'real' || document.hidden || !r29NewGroupPage()) return;
    r31GroupBusy = true;
    try {
      const changed = await r29PullGroup(id, true);
      if (changed === true && S.r29GroupFocus === id) {
        if (typeof H.reading?.preserve === 'function') H.reading.preserve(redraw, { reason: 'group-poll' });
        else redraw();
      }
    } catch { /* 这次没取到，2.5 秒后再取 */ } finally { r31GroupBusy = false; }
  }
  var r31GroupTimer = null;
  function r31GroupStart() {
    if (r31GroupTimer) return;
    r31GroupTimer = setInterval(() => { void r31GroupTick(); }, 2500);
    if (r31GroupTimer && typeof r31GroupTimer.unref === 'function') r31GroupTimer.unref();
  }
  async function r29EnsurePlans() {
    if ([...cards.values()].some(card => card && (card.kind === 'group_plan' || card.tool === 'group_plan'))) return;
    try {
      const data = await api('/approvals');
      (data.approvals || []).forEach(card => upsertCard(card, { render: false }));
    } catch { /* 没有分工确认卡 */ }
  }
  async function r29SendGroupLine(id, text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    try {
      const result = await extFetch('/groups/' + encodeURIComponent(id) + '/messages', {
        method: 'POST', body: JSON.stringify({ from: 'owner', text: clean }),
        headers: { 'idempotency-key': hubIdem() }
      });
      if (!result.ok) {
        if (typeof H.toast === 'function') H.toast('这句没发出去，请再试一次');
        return;
      }
      await r29PullGroup(id, true);
      if (S.r29GroupFocus === id) redraw();
    } catch {
      if (typeof H.toast === 'function') H.toast('这句没发出去，请再试一次');
    }
  }
  async function r29EnterGroup(id) {
    const token = ++r29GroupEnter;
    try { await r29PullGroup(id); } catch { /* 组详情这次没读到 */ }
    try { await r29EnsurePlans(); } catch { /* 确认卡这次没读到 */ }
    if (token !== r29GroupEnter || mode !== 'real' || groupTarget !== id) return;
    if (!r29GroupViews.has(id)) {
      const group = groups.find(item => item.id === id);
      r29GroupViews.set(id, {
        members: (group?.members || []).map(member => ({
          id: member.bot, name: member.name || '', duty: '暂无', status: '暂无'
        })).filter(member => member.id),
        messages: group?.lastText ? [{ id: 'last', from: '', text: group.lastText }] : [],
        line: ''
      });
    }
    S.mode = 'chat';
    S.detail = true;
    S.drawer = null;
    S.r29GroupFocus = id;
    S.r29GroupHold = true;
    S.r29GroupMembersOpen = false;
    try { redraw(); } catch { /* 壳这轮没画上 */ }
    r31GroupStart();
    // 进组就算看过这个组。
    if (r29Hooks) { try { r29Hooks.HubUnread.markRead(id, { latest: true }); } catch { /* 下次再标 */ } }
    // 这一拍里壳可能会顺手打开底下的会话。先按住焦点，导航过了再松开。
    const release = () => { if (S.r29GroupFocus === id) S.r29GroupHold = false; };
    if (typeof queueMicrotask === 'function') queueMicrotask(() => queueMicrotask(release));
    else setTimeout(release, 0);
  }
  function openGroup(id) {
    groupTarget = id;
    if (mode === 'real' && r29NewGroupPage()) {
      void r29EnterGroup(id);
      return;
    }
    if (typeof H.openPanel === 'function') H.openPanel('hub-real-group');
  }

  async function renderGroup(host) {
    try {
      if (mode !== 'real') return;
      clearInterval(groupTimer);
      const version = ++groupRenderVersion;
      const id = groupTarget;
      const group = groups.find(g => g.id === id);
      const status = ({ active: '进行中', paused: '已暂停', done: '已完成' })[group?.status] || '进行中';
      const heading = H.h('div', {}, [H.h('h3', {}, group?.title || '讨论组'), H.h('small', {}, status)]);
      for (const member of group?.members || []) {
        const item = H.h('span', {});
        if (typeof H.avatar === 'function') item.append(H.avatar(member.bot));
        item.append(H.h('small', {}, member.name || displayName(member.bot)));
        heading.append(item);
      }
      heading.append(H.h('button', { type: 'button', 'data-real-group-page': id }, '项目页'));
      const thread = H.h('div', { class: 'hub-real-group-thread' });
      const input = H.h('textarea', { maxlength: 1000, 'data-focus': 'real-group-input',
        'aria-label': '在讨论组里说话' });
      const send = H.h('button', { type: 'button', 'data-real-group-send': id }, '发送');
      host.replaceChildren(heading, thread, input, send);
      let messages = [];
      let loading = false;
      const pull = async () => {
        if (loading || mode !== 'real' || groupTarget !== id) return;
        loading = true;
        try {
          const follow = thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 80;
          const seqs = messages.map(m => m.seq).filter(n => n !== null);
          const after = seqs.length ? Math.max(...seqs) : 0;
          const path = '/groups/' + encodeURIComponent(id) + '?after=' + after;
          const result = await extGet('groups', path, { force: true, ttl: 0 });
          if (!result.ok || !(Array.isArray(result.data) || Array.isArray(result.data?.messages))) {
            if (!messages.length) {
              thread.replaceChildren(H.h('p', {}, '这个讨论组暂时读不到消息（暂无）'));
            }
            return;
          }
          const incoming = normalizeGroupMessages(result.data);
          const seen = new Set(messages.map(m => m.id));
          messages = messages.concat(incoming.filter(m => !seen.has(m.id)));
          thread.replaceChildren();
          if (!messages.length) thread.append(H.h('p', {}, '还没有人说话'));
          for (const message of messages) thread.append(groupMessage(message, group));
          if (follow) thread.scrollTop = thread.scrollHeight;
        } catch {
          if (!messages.length) {
            thread.replaceChildren(H.h('p', {}, '这个讨论组暂时读不到消息（暂无）'));
          }
        } finally {
          loading = false;
        }
      };
      send.addEventListener('click', async e => {
        try {
          consume(e);
          const text = input.value.trim();
          if (!text || send.disabled) return;
          send.disabled = true;
          const result = await extFetch('/groups/' + encodeURIComponent(id) + '/messages', {
            method: 'POST', body: JSON.stringify({ from: 'owner', text }),
            headers: { 'idempotency-key': hubIdem() }
          });
          if (result.ok) {
            input.value = '';
            await pull();
          } else if (typeof H.toast === 'function') H.toast('这句没发出去，请再试一次');
        } catch {
          if (typeof H.toast === 'function') H.toast('这句没发出去，请再试一次');
        } finally {
          send.disabled = false;
        }
      });
      await pull();
      if (version !== groupRenderVersion || mode !== 'real' || groupTarget !== id || !host.isConnected) return;
      groupTimer = setInterval(() => {
        if (host.isConnected === false || mode !== 'real' || groupTarget !== id) {
          clearInterval(groupTimer);
          groupTimer = null;
          return;
        }
        if (!document.hidden) void pull().catch(() => {});
      }, 3000);
    } catch {
      try { host.replaceChildren(H.h('p', {}, '这个讨论组暂时读不到消息（暂无）')); } catch {}
    }
  }

  function groupMessage(message, group) {
    const owner = message.from === 'owner';
    const system = message.from === 'system';
    const row = H.h('div', { class: 'hub-real-group-message' +
      (owner ? ' hub-real-group-owner' : system ? ' hub-real-group-system' : '') });
    if (owner) row.append(H.h('small', {}, '我'));
    if (!owner && !system) {
      const attrs = { class: 'r22-nameplate', 'data-nameplate-bot': message.from };
      if (typeof H.botStyle === 'function') attrs.style = H.botStyle(message.from);
      const member = group?.members.find(m => m.bot === message.from);
      row.append(H.h('span', attrs, member?.name || displayName(message.from)));
    }
    const text = H.h('div', { class: 'hub-real-text' });
    text.textContent = message.text;
    row.append(H.h('div', { class: 'hub-real-group-bubble' }, text));
    row.append(H.h('time', {}, messageDate(message.ts)?.time || ''));
    return row;
  }

  async function renderGroupPage(host) {
    try {
      if (mode !== 'real') return;
      clearInterval(groupTimer);
      groupRenderVersion++;
      const id = groupTarget;
      const back = H.h('button', { type: 'button', 'data-real-group': id }, '回到讨论组');
      const content = H.h('div', { class: 'hub-real-text' }, '正在读取项目页…');
      host.replaceChildren(back, content);
      const path = '/groups/' + encodeURIComponent(id) + '?after=0';
      const result = await extGet('groups', path, { force: true, ttl: 0 });
      const raw = result.data?.page;
      if (!result.ok || typeof raw !== 'string') content.textContent = '项目页暂时读不到（暂无）';
      else if (!r29ProjectTalk(content, raw)) content.textContent = raw;
    } catch {
      try { host.append(H.h('p', {}, '项目页暂时读不到（暂无）')); } catch {}
    }
  }

  function sessionGroups(host) {
    if (mode !== 'real') return;
    if (groups.length) host.append(H.h('h3', {}, '讨论组'));
    for (const group of groups) {
      const row = H.h('div', { class: 'hub-real-session' });
      row.append(H.h('button', { type: 'button', 'data-real-group': group.id }, group.title));
      row.append(H.h('button', { type: 'button', 'data-real-group-page': group.id }, '项目页'));
      host.append(row);
    }
    void sessionUsageRows(host).catch(() => {});
  }

  async function sessionUsageRows(host) {
    const result = await extGet('ledger', '/ledger', { ttl: 15000 });
    if (!result.ok || !result.data?.bySession || mode !== 'real') return;
    host.querySelectorAll('[data-real-open]').forEach(row => {
      const bucket = result.data.bySession[row.dataset.realOpen];
      if (!bucket || row.querySelector('.hub-real-session-usage')) return;
      row.append(H.h('small', { class: 'hub-real-session-usage' }, usageLine(bucket)));
    });
  }

  function r29JoinTitle(name, topic) {
    const who = String(name || '').trim() || '助理';
    const what = String(topic || '').trim();
    if (!what) return who;
    if (what.startsWith(who + ' · ')) return what;
    return who + ' · ' + what;
  }
  function r29LastLine(text, empty) {
    return previewText(text) || empty;
  }
  function r29LiveUnread() {
    try {
      const api = window.HubUnread;
      if (!api || typeof api.counts !== 'function') return null;
      const bag = api.counts();
      return bag && typeof bag === 'object' ? bag : null;
    } catch { return null; }
  }
  function r29BagCount(bag, bucket, id) {
    const table = bag && bag[bucket];
    if (!table || !id || !Object.prototype.hasOwnProperty.call(table, id)) return 0;
    const n = table[id];
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  }
  function r29CountNode(n) {
    const count = Number.isSafeInteger(n) && n > 0 ? n : 0;
    if (!count) return null;
    const text = count > 99 ? '99+' : '+' + count;
    return H.h('b', {
      class: 'bot-unread r29-unread', 'data-r29-unread': text, 'aria-label': '未读 ' + text
    }, text);
  }
  function r29HtmlFace(html) {
    if (typeof html !== 'string' || !html || typeof H.fromHTML !== 'function') return null;
    try { return H.fromHTML(html) || null; } catch { return null; }
  }
  function r29OneFace(id) {
    const api = window.HubAvatars;
    if (api && typeof api.html === 'function') {
      try {
        const node = r29HtmlFace(api.html(id, 40));
        if (node) return node;
      } catch { /* 形象钩子不可用时用原来的头像 */ }
    }
    return typeof H.avatar === 'function' ? H.avatar(id) : H.h('span', { class: 'r29-face' });
  }
  function r29StackNode(ids, px) {
    const list = (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id);
    const api = window.HubAvatars;
    if (api && typeof api.stackHtml === 'function') {
      try {
        const node = r29HtmlFace(api.stackHtml(list, px));
        if (node) return node;
      } catch { /* 叠头像钩子不可用时自己叠 */ }
    }
    const shown = list.slice(0, 3);
    const stack = H.h('span', {
      class: 'r29-stack', 'data-r29-n': String(shown.length),
      'data-r29-stack': shown.join(','), role: 'img', 'aria-label': '讨论组成员'
    });
    for (const id of shown) {
      const face = H.h('span', { class: 'r29-face', 'data-r29-avatar': id });
      if (typeof H.avatar === 'function') face.append(H.avatar(id));
      stack.append(face);
    }
    return stack;
  }
  function r29WatchRecent() {
    if (paintRecent.r29On) return;
    const api = window.HubUnread;
    if (!api || typeof api.subscribe !== 'function') return;
    try {
      api.subscribe(() => { try { paintRecent(); } catch { /* 未读变了，最近列表这次没画上 */ } });
      paintRecent.r29On = true;
    } catch { /* 下次装饰再订 */ }
  }
  function recentGroups(real) {
    const live = r29LiveUnread();
    const needle = String(S.search || '').toLowerCase();
    let added = 0;
    for (const group of groups) {
      if (needle && !String(group.title || '').toLowerCase().includes(needle)) continue;
      const ids = (group.members || []).map(m => m && m.bot).filter(id => typeof id === 'string' && id);
      const row = H.h('button', {
        type: 'button', class: 'conversation r29-group-row', 'data-real-group': group.id
      });
      const hostId = isBot(group.host) ? group.host : (chiefId() || '');
      const face = ids.length ? r29StackNode(ids, 40) : (hostId ? r29OneFace(hostId) : null);
      if (face) row.append(face);
      row.append(H.h('div', { class: 'grow' }, [
        H.h('div', { class: 'line' }, H.h('strong', {}, r29JoinTitle('讨论组', group.title))),
        H.h('div', { class: 'preview' }, r29LastLine(group.lastText, '还没有人说话'))
      ]));
      row.append(H.h('span', { class: 'home-row-meta' }, [
        H.h('time', {}, messageDate(group.updatedAt)?.time || ''),
        r29CountNode(r29BagCount(live, 'groups', group.id))
      ]));
      row.dataset.realUpdatedAt = group.updatedAt || '';
      real.append(row);
      added += 1;
    }
    const times = new Map(sessions.map(s => [s.id, s.updatedAt]));
    const rows = [...real.children];
    rows.sort((a, b) => sortRecent({ updatedAt: a.dataset.realUpdatedAt || times.get(a.dataset.realOpen) },
      { updatedAt: b.dataset.realUpdatedAt || times.get(b.dataset.realOpen) }));
    real.replaceChildren(...rows);
    return added;
  }

  // 确认类卡（confirm:true）后端不认「改一下」，点了永远回 400；所以这类卡不给这个按钮。
  function approvalButtons(c) {
    const all = approvalButtonsAll(c);
    return c.confirm === true ? all.filter(item => item[1] !== 'edit') : all;
  }

  function approvalButtonsAll(c) {
    if (c.confirm === true && c.kind === 'dispatch') {
      return [['派出去', 'approve', 'primary'], ['先不', 'reject', 'ghostbtn']];
    }
    if (plainCardInfo(c)) return [
      ['确认', 'approve', 'primary'], ['改一下', 'edit', 'textbutton'], ['不做', 'reject', 'ghostbtn']
    ];
    if (rosterTool(c)) return [
      ['确认', 'approve', 'primary'], ['改一下', 'edit', 'textbutton'], ['不改', 'reject', 'ghostbtn']
    ];
    return [['批准', 'approve', 'primary'], ['拒绝', 'reject', 'ghostbtn'], ['改一下', 'edit', 'textbutton']];
  }

  function renderPlainApproval(root, params, c) {
    const info = plainCardInfo(c, displayName);
    root.append(H.h('h3', {}, info.title));
    for (const [label, text] of info.rows) params.append(H.h('dt', {}, label), H.h('dd', {}, text));
    root.append(params);
    if (info.preview) {
      root.append(H.h('div', { class: 'hub-real-plan', style: 'white-space: pre-line' }, info.preview));
      if (info.kind === 'kb' && c.bodyTruncated === true && Number.isSafeInteger(c.bodyLength) && c.bodyLength >= 0) {
        root.append(H.h('p', { class: 'mini-note' }, '共 ' + c.bodyLength + ' 字，这里只显示前 600 字'));
      }
    } else if (info.table) {
      const list = H.h('ul', { class: 'hub-real-plan' });
      for (const row of info.table) list.append(H.h('li', { class: 'hub-real-plan-' + row.kind }, row.text));
      root.append(list);
    }
  }

  function r27Click(e, button) {
    if (r28Click(e, button)) return true;
    if (button.dataset.realGroupPage) {
      consume(e);
      groupTarget = button.dataset.realGroupPage;
      if (typeof H.openPanel === 'function') H.openPanel('hub-real-group-page');
      return true;
    }
    if (button.dataset.realGroup) {
      consume(e);
      openGroup(button.dataset.realGroup);
      return true;
    }
    if (button.hasAttribute('data-real-open-ledger')) {
      consume(e);
      S.drawer = null;
      if (typeof H.navigate === 'function') H.navigate({ view: 'ledger' });
      return true;
    }
    return false;
  }

  // ===== r28 路35：界面上缺的入口。只走适配层、只加面板与按钮，不改壳。后端来的文字一律用文本节点显示。 =====
  const r28Css = document.createElement('style');
  r28Css.textContent = `
    .hub-real-r28-sec{padding:10px 0;border-bottom:1px solid var(--line)}
    .hub-real-r28-sec h3{margin:0 0 6px}
    .hub-real-r28-line{margin:4px 0;overflow-wrap:anywhere}
    .hub-real-r28-note{margin:2px 0 6px;font-size:12px;color:var(--ink-2)}
    .hub-real-r28-pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto;margin:6px 0;
      padding:8px;background:var(--elev);border-radius:10px;font:inherit}
    .hub-real-r28-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
    .hub-real-r28-actions button,.hub-real-r28-sec button,.hub-real-fulltext button,
    .hub-real-model-chip{min-height:44px}
    .hub-real-banner{position:fixed;left:0;right:0;top:0;z-index:2147483000;
      padding:calc(env(safe-area-inset-top) + 8px) 16px 10px;
      background:#b3261e;color:#fff;font-size:14px;line-height:1.45;box-shadow:0 2px 12px rgba(0,0,0,.35)}
    .hub-real-banner[data-state=stopped]{background:#8a5a00}
    .hub-real-banner[hidden]{display:none}
    .hub-real-banner ul{margin:4px 0 0;padding-left:20px}
    .hub-real-banner button{min-height:44px;margin:6px 8px 0 0;padding:0 14px;border-radius:10px;
      border:1px solid rgba(255,255,255,.75);background:transparent;color:#fff;font-size:15px}
  `;
  document.head.append(r28Css);
  const R28_PANELS = new Set(['hub-real-today', 'hub-real-panic', 'hub-real-routines', 'hub-real-meetings',
    'hub-real-rules', 'hub-real-model']);

  // 读后端扩展并保留状态码与返回体（一键全停没停全时是 503 带说明，不能丢）。拿不到就是 {status:0,data:null}。
  async function extCall(path, { method = 'GET', body, timeout = 12000 } = {}) {
    if (mode !== 'real') return { status: 0, data: null };
    try {
      const options = { credentials: 'same-origin', cache: 'no-store', method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout) };
      if (method !== 'GET') options.body = JSON.stringify(body ?? {});
      const response = await fetch('/bff' + path, options);
      let data = null;
      try { data = await response.json(); } catch {}
      return { status: response.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }
  const r28Line = (text, cls = 'hub-real-r28-line') => H.h('p', { class: cls }, text);
  const r28Note = text => H.h('p', { class: 'hub-real-r28-note' }, text);
  const r28Gone = host => host.isConnected === false;
  const r28Button = (label, action, extra = {}, cls = 'textbutton') =>
    H.h('button', { type: 'button', class: cls, 'data-real-r28': action, ...extra }, label);
  function r28Repaint() {
    try {
      if (typeof H.reading?.preserve === 'function') H.reading.preserve(redraw, { reason: 'real-r28' });
      else redraw();
    } catch {}
  }
  // 两下确认：第一下只「上膛」换个字，6 秒内再点一下才真执行；用在停机、恢复、真的会起会话的按钮上。
  function r28TwoStep(button, key, label, run) {
    const at = r28.armed.get(key);
    if (at && Date.now() - at < 6000) { r28.armed.delete(key); run(); return; }
    const stamp = Date.now(), original = button.textContent;
    r28.armed.set(key, stamp);
    button.textContent = label;
    setTimeout(() => {
      if (r28.armed.get(key) === stamp) { r28.armed.delete(key); button.textContent = original; }
    }, 6000);
  }
  const r28Stopped = () => !!r28.panic && r28.panic.state !== 'running';
  function r28Host(id, host, render) { r28.hosts.set(id, { host, render }); }
  function r28Redraw(id) {
    const entry = r28.hosts.get(id);
    if (entry && !r28Gone(entry.host)) void entry.render(entry.host).catch(() => {});
  }
  function r28DemoNote(host) {
    host.replaceChildren(r28Line('演示模式下没有真实数据；到「连接模式」里切到真实再看（暂无）'));
  }

  // ---- 一键全停：横幅 + 面板 ----
  function paintBanner() {
    const view = r28.panic;
    const show = mode === 'real' && !!view && view.state !== 'running';
    if (!r28.banner) {
      if (!show) return;
      r28.banner = H.h('div', { class: 'hub-real-banner', role: 'alert' });
      document.body.append(r28.banner);
    }
    const banner = r28.banner;
    banner.hidden = !show;
    if (!show) { banner.replaceChildren(); return; }
    banner.dataset.state = view.state;
    const children = [];
    if (view.state === 'partial') {
      children.push(H.h('strong', {}, '没停全！这几步没停住：'));
      const list = H.h('ul', {});
      for (const step of view.failed) {
        list.append(H.h('li', {}, step.name + (step.reason ? '（' + step.reason + '）' : '')));
      }
      if (!view.failed.length) list.append(H.h('li', {}, '后端没说具体哪一步，请点「详情」'));
      children.push(list, r28Line('新的会话调用和工具调用已经被拒，但上面这些可能还在动。'));
      children.push(r28Button('再试一次全停', 'panic-stop', {}, ''));
    } else {
      children.push(H.h('strong', {}, '已一键全停'));
      if (view.reason) children.push(r28Line('备注：' + view.reason));
    }
    children.push(r28Button('恢复', 'panic-resume', {}, ''),
      r28Button('详情', 'open-panel', { 'data-real-panel': 'hub-real-panic' }, ''));
    banner.replaceChildren(...children);
  }
  // 读一次全停状态；读不到（断网、5xx）保留上一次的，只有后端说没有这个模块（404/501）才清掉。
  async function refreshPanic() {
    if (mode !== 'real') { paintBanner(); return; }
    const result = await extCall('/panic/status');
    if (result.status === 200) r28.panic = panicView(result.data);
    else if ([404, 501].includes(result.status)) r28.panic = null;
    paintBanner();
    r28Redraw('panic');
  }
  async function panicAct(kind) {
    if (r28.busy.has('panic')) return;
    r28.busy.add('panic');
    try {
      const body = kind === 'stop' ? { reason: '从手机上点的' } : {};
      const result = await extCall('/panic/' + kind, { method: 'POST', body, timeout: 30000 });
      const view = panicView(result.data);
      if (view) {
        r28.panic = view;
        const left = view.failed.map(step => step.name).join('、');
        H.toast(view.state === 'partial' ? '没停全：' + (left || '见详情') : view.state === 'stopped' ? '已一键全停' :
          kind === 'resume' ? '已恢复' : '现在是正常状态');
      } else {
        H.toast('没连上，全停状态不明；请当作「没停」处理，刷新后再看');
        await refreshPanic();
      }
    } finally {
      r28.busy.delete('panic');
      paintBanner();
      r28Redraw('panic');
    }
  }
  function drawPanic(host) {
    const view = r28.panic;
    host.replaceChildren();
    if (!view) { host.append(r28Line('一键全停暂时读不到状态（暂无）')); return; }
    const stateText = { running: '正常运行，没有停', stopped: '已全停', partial: '没停全' }[view.state];
    host.append(H.h('section', { class: 'hub-real-r28-sec' }, [H.h('h3', {}, stateText),
      view.reason ? r28Line('备注：' + view.reason) : null,
      r28Line('现在在跑：会话 ' + (view.live.sessions ?? '未知') + ' 个，外包任务 ' + (view.live.external ?? '未知') + ' 个')]));
    if (view.state === 'partial') {
      const section = H.h('section', { class: 'hub-real-r28-sec' }, H.h('h3', {}, '没停住的步骤'));
      for (const step of view.failed) section.append(r28Line(step.name + (step.reason ? '：' + step.reason : '')));
      host.append(section);
    }
    if (view.steps.length) {
      const section = H.h('section', { class: 'hub-real-r28-sec' }, H.h('h3', {}, '每一步'));
      const label = { ok: '已停', absent: '没有这一项', failed: '没停住', unknown: '不明' };
      for (const step of view.steps) section.append(r28Line(step.name + ' · ' + label[step.status]));
      host.append(section);
    }
    const actions = H.h('div', { class: 'hub-real-r28-actions' });
    if (view.state === 'running') {
      actions.append(r28Button('一键全停', 'panic-stop', { 'data-real-confirm': '1' }, 'ghostbtn'));
    } else {
      actions.append(r28Button('再试一次全停', 'panic-stop', {}, 'ghostbtn'),
        r28Button('恢复', 'panic-resume', {}, 'primary'));
    }
    host.append(actions, r28Note('全停只停自动化和在跑的回合；被取消的回合、被停掉的外包任务恢复后不会自动重来。'));
  }
  async function renderPanic(host) {
    r28Host('panic', host, async target => drawPanic(target));
    if (mode !== 'real') { r28DemoNote(host); return; }
    host.replaceChildren(H.h('p', { role: 'status' }, '正在读取…'));
    await refreshPanic();
    if (!r28Gone(host)) drawPanic(host);
  }

  // ---- 「今天」 ----
  const todayMiss = () => r28Line('暂时读不到（暂无）');
  function todayTarget(id, place, text) {
    return H.h('p', { class: 'hub-real-r28-line', 'data-real-today-target': id,
      'data-real-today-place': place }, text);
  }
  // 按编号取这一张。取回来的编号对不上，就不显示，免得点进另一张相似的单。
  async function showTodayTicket(spot, id, place) {
    if (!/^T-\d{8}-\d{6}-[a-zA-Z0-9]{4}$/u.test(id)) { spot.replaceChildren(todayMiss()); return; }
    const result = await extCall('/board/tickets/' + encodeURIComponent(id));
    const ticket = result.status === 200 && isPlainObject(result.data) ? result.data.ticket : null;
    if (!isPlainObject(ticket) || ticket.id !== id) { spot.replaceChildren(todayMiss()); return; }
    const title = plainLine(ticket.title, 80) || '（无标题）';
    const last = Array.isArray(ticket.verification) && ticket.verification.length
      ? ticket.verification[ticket.verification.length - 1] : null;
    const raw = place === 'question' ? (ticket.open_ask && ticket.open_ask.text)
      : ((last && last.note) || (ticket.report && ticket.report.summary));
    const ask = plainLine(raw, 200);
    const label = place === 'question' ? '这个问题：' : '这个结果：';
    spot.replaceChildren(todayTarget(id, place, label + title + (ask ? '。' + ask : '')));
    if (typeof spot.scrollIntoView === 'function') spot.scrollIntoView({ block: 'center' });
  }
  async function showTodayCard(spot, id) {
    if (!/^[A-Za-z0-9:_-]{1,80}$/u.test(id)) { spot.replaceChildren(todayMiss()); return; }
    let card = cards.get('approval:' + id);
    if (!card) {
      const result = await extCall('/cards');
      const list = Array.isArray(result.data && result.data.cards) ? result.data.cards : [];
      card = list.find(item => isPlainObject(item) && item.id === id) || null;
    }
    if (!card || card.id !== id) { spot.replaceChildren(todayMiss()); return; }
    const title = plainLine(card.title || card.action, 80) || '（无标题）';
    const body = plainLine(card.text || card.summary, 200);
    spot.replaceChildren(todayTarget(id, 'card', '这张确认卡：' + title + (body ? '。' + body : '')));
    if (typeof spot.scrollIntoView === 'function') spot.scrollIntoView({ block: 'center' });
    try { upsertCard(card); } catch { /* 挂不上列表时，上面仍是这一张 */ }
    const stored = cards.get('approval:' + id);
    if (stored) {
      try { await openCard(stored); return; } catch { /* 卡面板打不开就留在这一页 */ }
    }
  }
  function openTodayLead(spot, lead) {
    if (!lead || lead.status !== 'item') return;
    const id = String(lead.id || '');
    const place = lead.place;
    const run = place === 'card' ? showTodayCard(spot, id)
      : (place === 'question' || place === 'result') ? showTodayTicket(spot, id, place)
        : Promise.resolve(spot.replaceChildren(todayMiss()));
    void run.catch(() => { try { spot.replaceChildren(todayMiss()); } catch { /* 点开失败只留读不到 */ } });
  }
  function todayLeadBlock(lead) {
    const box = H.h('section', { class: 'hub-real-r28-sec', 'data-real-today': 'lead' });
    if (!lead || lead.status !== 'item') {
      box.append(r28Line(lead && lead.text ? lead.text : '暂时读不到'));
      return box;
    }
    const spot = H.h('div', { 'data-real-today-spot': lead.id });
    box.append(H.h('button', { type: 'button', class: 'hub-real-r28-line', 'data-real-today-lead': 'item',
      'data-real-today-id': lead.id, 'data-real-today-place': lead.place,
      onClick: () => openTodayLead(spot, lead) }, lead.text), spot);
    return box;
  }
  // 卡片版「今天」里点一行：确认卡开卡面板，助理的事进它的会话，
  // 工单去看板。出错就留在原页。
  function openTodayItem(item) {
    try {
      if (!item) return;
      if ((item.kind === 'card' || item.kind === 'kb') && item.id) {
        void showTodayCard(H.h('div', {}), item.id).catch(() => {});
        return;
      }
      if (item.kind === 'bot' && isBot(item.bot)) {
        H.navigate({ view: 'chat', conversation: item.bot + '-013' }, { deferRender: true });
        return;
      }
      if (item.kind === 'ticket') {
        H.navigate({ view: 'kanban' });
        // 直接落到这张卡的操作单，不让人在看板里再找一遍。
        const board = window.R30Board;
        if (item.id && typeof board?.open === 'function') setTimeout(() => board.open(item.id), 200);
      }
    } catch { /* 打不开就留在这一页 */ }
  }
  // 原「活动」并进今天页。本地已读到的待批确认卡，后端汇总里没有的补进「等你处理」（同一张只列一次）；
  // 已经答过的确认卡放进「刚刚发生的」。
  function todayExtras(model, leadId, backendRecent) {
    const have = new Set(model.waiting.items.filter(i => i.kind === 'card').map(i => i.id));
    const all = [...cards.values()].filter(c => c.type === 'approval');
    const pend = all.filter(c => c.status === 'pending');
    pend.sort((a, b) => stampValue(a.createdAt) - stampValue(b.createdAt));
    for (const c of pend) {
      if (have.has(c.id)) continue;
      model.waiting.available = true;
      model.waiting.items.push({ kind: 'card', tag: '确认卡', id: c.id, bot: c.bot, name: botName(c.bot),
        title: plainLine(c.action || c.title, 80) || '要你点头', sub: plainLine(relativePath(c.path), 60), act: '去确认' });
    }
    // 后端挑的「最该先看的一件」排在最前面，一打开就看到它。
    const at = leadId ? model.waiting.items.findIndex(i => i.id === leadId) : -1;
    if (at > 0) model.waiting.items.unshift(model.waiting.items.splice(at, 1)[0]);
    const label = { approved: '已批准', denied: '已拒绝', rejected: '已拒绝', revised: '让它改了', timeout: '没等到你点头' };
    // 以后端算好的真记录为主（已答的确认卡 + 看板流水，最近 20 条），刷新后还在；
    // 本页刚见过、后端清单里还没有的已答卡补在里面（同一张卡只列一次）。老后端没有这个接口时，只用本页见过的卡。
    const local = all.filter(c => c.status !== 'pending' && label[c.status]).map(c => ({
      kind: 'card', id: c.id, bot: c.bot, name: botName(c.bot), title: plainLine(c.action || c.title, 60) || '一次确认',
      sub: plainLine(relativePath(c.path), 60), state: label[c.status], at: c.updatedAt || c.createdAt || '' }));
    const fromBackend = Array.isArray(backendRecent) ? backendRecent.map(item => ({
      kind: item.kind, id: item.id, bot: item.bot || '', name: item.name || (item.bot ? botName(item.bot) : ''),
      title: plainLine(item.title, 60) || '一件事', sub: '', state: plainLine(item.state, 20), at: item.at || '' })) : [];
    const seen = new Set(fromBackend.filter(i => i.kind === 'card').map(i => i.id));
    const merged = fromBackend.concat(local.filter(i => !seen.has(i.id)));
    merged.sort((a, b) => stampValue(b.at) - stampValue(a.at));
    const oldBackend = !Array.isArray(backendRecent);
    const localTime = i => (i.kind === 'card' && oldBackend ? messageDate(i.at)?.time : '') || recentWhen(i.at);
    model.recent = merged.slice(0, 20).map(i => ({ bot: i.bot, name: i.name, title: i.title,
      sub: i.sub || '', state: i.state, when: localTime(i) }));
  }
  // 今天的只写时分，更早的写「月/日 时分」。
  function recentWhen(iso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms), now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return d.toDateString() === now.toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }
  async function renderToday(host) {
    try {
      if (mode !== 'real') { r28DemoNote(host); return; }
      if (!r30Painted(host, '[data-r30l-today]')) host.replaceChildren(H.h('p', { role: 'status' }, '正在读取…'));
      const result = await extCall('/today');
      const view = result.status === 200 ? todayView(result.data, displayName) : null;
      if (r28Gone(host)) return;
      // 界面壳带了卡片版「今天」时交给它画；
      // 在做和今天做完的从看板工单里取，取不到就如实说没有数据。
      if (typeof window.R30LT?.mountToday === 'function') {
        const board = result.status === 200
          ? await extGet('board', '/board/tickets', { force: true, ttl: 0 }) : { ok: false };
        if (r28Gone(host)) return;
        const tickets = board.ok && Array.isArray(board.data?.tickets) ? board.data.tickets : null;
        let model = window.R30LT.normalizeToday(result.data, tickets, displayName);
        // 今天的汇总读不到时，已经读到的待批确认卡也不能不见：只留「等你处理」这一块，并说明其余读不到。
        if (!model && [...cards.values()].some(c => c.type === 'approval' && c.status === 'pending')) {
          const none = { available: false, note: '', items: [] };
          model = { source: 'real', date: '', waiting: { available: true, partial: true, note: '今天的其余汇总暂时读不到',
            items: [] }, doing: { ...none }, done: { ...none }, routines: { ...none, paused: false } };
        }
        const lead = view && view.lead && view.lead.status === 'item' ? String(view.lead.id || '') : '';
        let backendRecent = null;
        if (model) {
          const recent = await extCall('/today/recent');
          if (r28Gone(host)) return;
          if (recent.status === 200 && Array.isArray(recent.data?.items)) backendRecent = recent.data.items;
        }
        if (model) todayExtras(model, lead, backendRecent);
        window.R30LT.mountToday(host, model, { onOpen: openTodayItem });
        return;
      }
      if (!view) { host.replaceChildren(todayMiss()); return; }
      host.replaceChildren();
      host.append(todayLeadBlock(view.lead));
      host.append(r28Note(view.date ? view.date + ' · 数字都是后端算好的' : '数字都是后端算好的'));
      for (const section of view.sections) {
        const box = H.h('section', { class: 'hub-real-r28-sec', 'data-real-today': section.id },
          H.h('h3', {}, section.title));
        if (section.note) box.append(r28Note(section.note));
        if (!section.available || (!section.lines.length && !section.block)) box.append(r28Line('暂无'));
        for (const line of section.lines) box.append(r28Line(line));
        if (section.block) box.append(H.h('pre', { class: 'hub-real-r28-pre' }, section.block));
        host.append(box);
      }
    } catch {
      try { host.replaceChildren(todayMiss()); } catch {}
    }
  }

  // ---- 固定任务 ----
  function drawRoutines(host, view) {
    host.replaceChildren();
    if (!view) { host.append(r28Line('固定任务暂时没有数据（暂无）')); return; }
    if (!view.enabled) host.append(r28Note('固定任务没有启用（后端配置里没有固定任务）'));
    host.append(r28Note('共 ' + view.items.length + ' 条 · ' + (view.paused ? '全部暂停中' : '运行中')));
    const head = H.h('div', { class: 'hub-real-r28-actions' });
    head.append(view.paused ? r28Button('全部恢复', 'routines-resume-all', {}, 'ghostbtn') :
      r28Button('全部暂停', 'routines-pause-all', {}, 'ghostbtn'));
    host.append(head);
    if (!view.items.length) host.append(r28Line('暂无'));
    for (const item of view.items) {
      const box = H.h('section', { class: 'hub-real-r28-sec', 'data-real-routine-row': item.id },
        [H.h('h3', {}, item.title), r28Line(item.who + (item.when ? ' · ' + item.when : '')),
          r28Line('今天：' + item.state + (item.ticket ? ' · 工单 ' + item.ticket : ''))]);
      if (item.done) box.append(r28Note('算做完：' + item.done));
      if (item.id) {
        const actions = H.h('div', { class: 'hub-real-r28-actions' });
        const idAttr = { 'data-real-id': item.id };
        actions.append(r28Button('手动跑一次', 'routine-run', { ...idAttr, disabled: item.running || r28Stopped() },
          'ghostbtn'), item.paused ? r28Button('恢复这条', 'routine-resume', idAttr, 'ghostbtn') :
          r28Button('暂停这条', 'routine-pause', idAttr, 'ghostbtn'));
        box.append(actions);
      }
      host.append(box);
    }
    for (const text of view.invalid) host.append(r28Note('没启用：' + text));
  }
  async function renderRoutines(host) {
    try {
      r28Host('routines', host, renderRoutines);
      if (mode !== 'real') { r28DemoNote(host); return; }
      host.replaceChildren(H.h('p', { role: 'status' }, '正在读取…'));
      const result = await extCall('/routines');
      if (r28Gone(host)) return;
      drawRoutines(host, result.status === 200 ? routineView(result.data, displayName) : null);
    } catch {
      try { host.replaceChildren(r28Line('固定任务暂时没有数据（暂无）')); } catch {}
    }
  }
  async function routineAct(action, id) {
    if (!ID_RE.test(id || '') || r28.busy.has('routine')) return;
    if (action === 'run' && r28Stopped()) { H.toast('已一键全停，先恢复再手动跑'); return; }
    r28.busy.add('routine');
    try {
      const result = await extCall('/routines/' + encodeURIComponent(id) + '/' + action,
        { method: 'POST', body: {}, timeout: action === 'run' ? 300000 : 12000 });
      H.toast(routineActionText(action, result.status, result.data));
    } finally {
      r28.busy.delete('routine');
      r28Redraw('routines');
    }
  }
  async function routinesAll(action) {
    if (r28.busy.has('routine')) return;
    r28.busy.add('routine');
    try {
      const result = await extCall('/routines/' + action, { method: 'POST', body: {}, timeout: 12000 });
      H.toast(result.status === 200 ? (action === 'pause' ? '固定任务已全部暂停' : '固定任务已全部恢复') :
        '这次没成功，状态不明，请刷新看看');
    } finally {
      r28.busy.delete('routine');
      r28Redraw('routines');
    }
  }

  // ---- 晨会晚会纪要 + 开晚会 ----
  async function renderMeetings(host) {
    try {
      r28Host('meetings', host, renderMeetings);
      if (mode !== 'real') { r28DemoNote(host); return; }
      host.replaceChildren(H.h('p', { role: 'status' }, '正在读取…'));
      const date = r28.meetingDate;
      const [status, today] = await Promise.all([extCall('/meetings/status'), extCall('/meetings/today')]);
      const dateText = String(today.data?.date);
      const todayDate = today.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : '';
      let found = today.status === 200 ? asList(today.data?.minutes) : [];
      if (date && date !== todayDate) {
        const both = await Promise.all(['morning', 'evening'].map(type =>
          extCall('/meetings/minutes?date=' + encodeURIComponent(date) + '&type=' + type)));
        found = both.filter(item => item.status === 200 && isPlainObject(item.data)).map(item => item.data);
      }
      if (r28Gone(host)) return;
      const view = status.status === 200 ? meetingView(status.data, found) : null;
      if (!view) { host.replaceChildren(r28Line('晨会晚会暂时没有数据（暂无）')); return; }
      const shown = date && date !== todayDate ? date : todayDate;
      host.replaceChildren(r28Note('时间：晨会 ' + (view.times.morning || '未设') + ' · 晚会 ' + (view.times.evening || '未设') +
        (view.pending ? ' · 有 ' + view.pending + ' 份待投知识库的稿' : '')));
      const nav = H.h('div', { class: 'hub-real-r28-actions' });
      const before = shiftDate(shown, -1), after = shiftDate(shown, 1);
      if (before) nav.append(r28Button('前一天', 'meeting-day', { 'data-real-date': before }, 'ghostbtn'));
      if (after && todayDate && after <= todayDate) {
        nav.append(r28Button('后一天', 'meeting-day', { 'data-real-date': after === todayDate ? '' : after }, 'ghostbtn'));
      }
      host.append(nav, H.h('h3', {}, (shown || '今天') + ' 的纪要'));
      if (!view.minutes.length) host.append(r28Line('这一天暂无纪要'));
      for (const item of view.minutes) {
        host.append(H.h('section', { class: 'hub-real-r28-sec', 'data-real-minutes': item.type },
          [H.h('h3', {}, item.label), H.h('pre', { class: 'hub-real-r28-pre' }, item.text || '（空）')]));
      }
      host.append(H.h('div', { class: 'hub-real-r28-actions' }, r28Button(view.running ? '晚会正在开…' : '开晚会',
        'meeting-run-evening', { disabled: view.running || r28Stopped() }, 'primary')),
      r28Note('开晚会会让每位助理各开一个只聊天的隐藏会话说一条，然后写纪要，需要一会儿。'));
    } catch {
      try { host.replaceChildren(r28Line('晨会晚会暂时没有数据（暂无）')); } catch {}
    }
  }
  async function runEvening(button) {
    if (r28Stopped()) { H.toast('已一键全停，先恢复再开晚会'); return; }
    if (r28.busy.has('meeting')) return;
    r28.busy.add('meeting');
    button.disabled = true;
    button.textContent = '晚会在开…';
    try {
      const result = await extCall('/meetings/run', { method: 'POST', body: { type: 'evening' }, timeout: 240000 });
      H.toast(meetingRunText(result.status, result.data));
    } finally {
      r28.busy.delete('meeting');
      r28Redraw('meetings');
    }
  }

  // ---- 规矩页（只读）----
  async function renderRules(host) {
    try {
      if (mode !== 'real') { r28DemoNote(host); return; }
      host.replaceChildren(H.h('p', { role: 'status' }, '正在读取…'));
      const result = await extCall('/rules');
      const view = result.status === 200 ? rulesView(result.data, displayName) : null;
      if (r28Gone(host)) return;
      if (!view) { host.replaceChildren(r28Line('规矩页暂时读不到（暂无）')); return; }
      host.replaceChildren(r28Note('只读。规矩是助理按你的口头要求记的，这里不能改。'));
      const shared = H.h('section', { class: 'hub-real-r28-sec' }, H.h('h3', {}, '全家共用的派活规则'));
      if (!view.shared.length) shared.append(r28Line('暂无'));
      for (const line of view.shared) shared.append(r28Line(line));
      host.append(shared);
      for (const bot of view.bots) {
        const box = H.h('section', { class: 'hub-real-r28-sec' }, H.h('h3', {}, bot.name + ' 的规矩页'));
        if (!bot.lines.length) box.append(r28Line('暂无'));
        for (const line of bot.lines) box.append(r28Line(line));
        host.append(box);
      }
    } catch {
      try { host.replaceChildren(r28Line('规矩页暂时读不到（暂无）')); } catch {}
    }
  }

  // ---- 新会话选模型：只有后端明确说开关开着才出现 ----
  async function ensureModels(bot) {
    if (!isBot(bot) || mode !== 'real') return;
    const asked = r28.modelAsked.get(bot) || 0;
    if (Date.now() - asked < 30000) return;
    r28.modelAsked.set(bot, Date.now());
    const result = await extGet('models', '/models/bots/' + encodeURIComponent(bot), { ttl: 30000 });
    if (result.ok) {
      const before = JSON.stringify(modelsByBot.get(bot));
      modelsByBot.set(bot, result.data);
      if (before !== JSON.stringify(result.data)) decorate();
    }
  }
  // 用户已选（还没发出第一句）或已建好的会话用的模型名，给标题旁的小字用。
  function pickedModelName(r) {
    if (!r) return '';
    if (r.modelName) return r.modelName;
    const ref = r28.pick.get(r.local);
    const option = modelPickView(modelsByBot.get(r.bot))?.options.find(item => item.ref === ref);
    return option ? option.name : '';
  }
  function paintModelChip(title, r) {
    let chip = title.querySelector('.hub-real-model-chip');
    const view = r && !r.remote ? modelPickView(modelsByBot.get(r.bot)) : null;
    if (r && !r.remote && !modelsByBot.has(r.bot)) void ensureModels(r.bot).catch(() => {});
    if (!view) { chip?.remove(); return; }
    const text = '模型：' + (pickedModelName(r) || '默认') + ' ›';
    if (!chip) {
      chip = r28Button(text, 'model-open', {}, 'textbutton hub-real-model-chip');
      title.append(chip);
    } else if (chip.textContent !== text) chip.textContent = text;
  }
  async function renderModelPanel(host) {
    try {
      if (mode !== 'real') { r28DemoNote(host); return; }
      const r = records.get(r28.pickTarget);
      if (!r || r.remote) { host.replaceChildren(r28Line('这个会话已经开聊了，换模型请新建一个会话')); return; }
      host.replaceChildren(H.h('p', { role: 'status' }, '正在读取…'));
      const result = await extGet('models', '/models/bots/' + encodeURIComponent(r.bot), { force: true, ttl: 0 });
      if (result.ok) modelsByBot.set(r.bot, result.data);
      const view = modelPickView(result.ok ? result.data : null);
      if (r28Gone(host)) return;
      if (!view) { host.replaceChildren(r28Line('现在没有可选的模型（暂无）')); return; }
      host.replaceChildren(r28Note('只对这一个新会话生效；开聊以后不能再换。'));
      const chosen = r28.pick.get(r.local) || '';
      const defaultName = view.options.find(item => item.ref === view.default)?.name || '默认模型';
      host.append(r28Button('用默认：' + defaultName + (chosen ? '' : '（已选）'), 'model-pick',
        { 'data-real-ref': '' }, 'ghostbtn'));
      for (const item of view.options) {
        const meta = [item.window, item.chatOnly ? '只聊天' : '', item.selectable ? '' : item.reason || '现在选不了']
          .filter(Boolean).join(' · ');
        host.append(H.h('section', { class: 'hub-real-r28-sec' }, [
          r28Button(item.name + (chosen === item.ref ? '（已选）' : ''), 'model-pick',
            { 'data-real-ref': item.ref, disabled: !item.selectable }, 'ghostbtn'),
          meta ? r28Note(meta) : null]));
      }
    } catch {
      try { host.replaceChildren(r28Line('现在没有可选的模型（暂无）')); } catch {}
    }
  }
  function chooseModel(ref) {
    const r = records.get(r28.pickTarget);
    if (!r || r.remote) return;
    const view = modelPickView(modelsByBot.get(r.bot));
    if (ref !== '' && !view?.options.some(item => item.ref === ref && item.selectable)) return;
    if (ref === '') r28.pick.delete(r.local); else r28.pick.set(r.local, ref);
    H.toast(ref === '' ? '这个新会话用默认模型' : '这个新会话用：' + pickedModelName(r));
    S.drawer = null;
    r28Repaint();
    decorate();
  }
  // 建远端会话：用户选过模型就带上；失败时把后端的原因告诉用户，不偷偷换成别的模型。
  async function createRemote(r, bot) {
    const model = r28.pick.get(r.local);
    try {
      const body = JSON.stringify(model ? { bot, model } : { bot });
      const created = await api('/sessions', { method: 'POST', body });
      if (model) {
        r.modelName = pickedModelName(r);
        r28.pick.delete(r.local);
      }
      return created;
    } catch (error) {
      if (model) H.toast(modelErrorText(error));
      throw error;
    }
  }

  // ---- 确认卡「看全文」：卡上是摘要，批的是全文那一份 ----
  async function digestMatches(text, digest) {
    try {
      if (!globalThis.crypto?.subtle) return null;
      const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('') === digest;
    } catch {
      return null;
    }
  }
  async function toggleFullText(digest) {
    if (!isDigest(digest) || r28.busy.has('ft:' + digest)) return;
    if (r28.fullOpen.has(digest)) { r28.fullOpen.delete(digest); r28Repaint(); return; }
    r28.fullOpen.add(digest);
    if (!r28.fullText.get(digest)?.ok) {
      r28.busy.add('ft:' + digest);
      try {
        const result = await extCall('/fulltext/' + digest);
        const data = result.data;
        if (result.status === 200 && data?.digest === digest && typeof data.text === 'string') {
          const same = await digestMatches(data.text, digest);
          r28.fullText.set(digest, same === false ? { ok: false, error: '全文和校验码对不上，请不要批准这张卡' } :
            { ok: true, text: plainText(data.text, 60000), verified: same === true,
              cut: Array.from(data.text).length > 60000 });
        } else {
          r28.fullText.set(digest, { ok: false, error: result.status === 404 ? '全文已经不存在，或被改动过，请不要批准这张卡' :
            '全文暂时取不到（暂无）' });
        }
      } finally {
        r28.busy.delete('ft:' + digest);
      }
    }
    r28Repaint();
  }
  // 画「看全文」块；只有卡上带合法校验和才画。
  function fullTextBlock(c) {
    if (!isDigest(c?.fullText)) return null;
    const digest = c.fullText, entry = r28.fullText.get(digest), open = r28.fullOpen.has(digest);
    const box = H.h('div', { class: 'hub-real-fulltext', 'data-real-fulltext-box': digest });
    box.append(r28Note('卡上是摘要；批准的就是下面「全文」这一份（校验码 ' + digest.slice(0, 8) + '…）。'));
    box.append(r28Button(open ? '收起全文' : '看全文', 'fulltext', { 'data-real-digest': digest,
      disabled: r28.busy.has('ft:' + digest) }));
    if (open && entry?.ok) {
      box.append(H.h('pre', { class: 'hub-real-r28-pre' }, entry.text));
      if (entry.cut) box.append(r28Note('全文太长，这里只显示前 60000 字'));
      box.append(r28Note(entry.verified ? '校验码在本机重算过，一致。' :
        '这个连接下浏览器没法重算校验码；服务端读出和执行前都会核对。'));
    } else if (open && entry) box.append(r28Line(entry.error));
    return box;
  }

  // ---- 点击分发 ----
  function r28Click(e, button) {
    const action = button.dataset.realR28;
    if (!action) return false;
    consume(e);
    const go = fn => { void Promise.resolve().then(fn).catch(() => {}); };
    const id = button.dataset.realId;
    if (action === 'model-open') {
      r28.pickTarget = current()?.local || '';
      if (typeof H.openPanel === 'function') H.openPanel('hub-real-model');
    } else if (action === 'model-pick') chooseModel(button.dataset.realRef ?? '');
    else if (action === 'open-panel') {
      if (R28_PANELS.has(button.dataset.realPanel) && typeof H.openPanel === 'function') {
        H.openPanel(button.dataset.realPanel);
      }
    } else if (action === 'panic-stop') {
      const stop = () => go(() => panicAct('stop'));
      if (button.dataset.realConfirm === '1') r28TwoStep(button, 'panic-stop', '再点一下，确认全停', stop);
      else stop();
    } else if (action === 'panic-resume') {
      r28TwoStep(button, 'panic-resume', '再点一下，确认恢复', () => go(() => panicAct('resume')));
    }
    else if (action === 'routine-run') {
      r28TwoStep(button, 'routine-run:' + id, '再点一下，真的跑一次', () => go(() => routineAct('run', id)));
    } else if (action === 'routine-pause') go(() => routineAct('pause', id));
    else if (action === 'routine-resume') go(() => routineAct('resume', id));
    else if (action === 'routines-pause-all') go(() => routinesAll('pause'));
    else if (action === 'routines-resume-all') go(() => routinesAll('resume'));
    else if (action === 'meeting-day') {
      r28.meetingDate = button.dataset.realDate || '';
      r28Redraw('meetings');
    } else if (action === 'meeting-run-evening') {
      r28TwoStep(button, 'meeting-evening', '再点一下，真的开晚会', () => go(() => runEvening(button)));
    } else if (action === 'fulltext') go(() => toggleFullText(button.dataset.realDigest));
    return true;
  }

  if (typeof H.registerPanel === 'function') {
    H.registerPanel('hub-real-today', { title: '今天', render: renderToday });
    H.registerPanel('hub-real-panic', { title: '一键全停', render: renderPanic });
    H.registerPanel('hub-real-routines', { title: '固定任务', render: renderRoutines });
    H.registerPanel('hub-real-meetings', { title: '晨会晚会', render: renderMeetings });
    H.registerPanel('hub-real-rules', { title: '规矩页', render: renderRules });
    H.registerPanel('hub-real-model', { title: '选模型', render: renderModelPanel });
  }
  if (typeof H.registerMoreItem === 'function') {
    for (const [id, label] of [['hub-real-today', '今天（真实数据）'], ['hub-real-panic', '一键全停 / 恢复'],
      ['hub-real-routines', '固定任务'], ['hub-real-meetings', '晨会晚会纪要'], ['hub-real-rules', '规矩页（只读）']]) {
      r29More({ id, label, onClick: () => { if (typeof H.openPanel === 'function') H.openPanel(id); } });
    }
  }
  // 开发期观测：只读，给测试与手机上排错用。
  window.HubRealR28 = Object.freeze({ panic: () => r28.panic, banner: () => r28.banner,
    picked: local => r28.pick.get(local) || '', refreshPanic, record, models: modelsByBot,
    paintModelChip, createRemote, fullTextBlock });
  if (mode === 'real') void refreshPanic().catch(() => {});
  setInterval(() => { if (mode === 'real' && !document.hidden) void refreshPanic().catch(() => {}); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshPanic().catch(() => {}); });

  if (typeof H.registerPanel === 'function') {
    H.registerPanel('hub-real-board', { title: '看板', render: renderBoard });
    H.registerPanel('hub-real-ledger', { title: '账本', render: renderLedgerPanel });
    H.registerPanel('hub-real-group', { title: '讨论组', render: renderGroup });
    H.registerPanel('hub-real-group-page', { title: '项目页', render: renderGroupPage });
  }
  if (typeof H.registerMoreItem === 'function') {
    r29More({ id: 'hub-real-board', label: '看板（真实数据）',
      onClick: () => { if (typeof H.openPanel === 'function') H.openPanel('hub-real-board'); } });
    r29More({ id: 'hub-real-ledger', label: '账本（真实数据）',
      onClick: () => { if (typeof H.openPanel === 'function') H.openPanel('hub-real-ledger'); } });
  }

  async function revokePermission(id,button) {
    if(revoking.has(id) || !window.confirm('撤销后，这类命令会重新问你。确定撤销？'))return;
    revoking.add(id);button.disabled=true;
    try {await api('/grants/'+encodeURIComponent(id)+'/revoke',{method:'POST',body:'{}'});H.toast('已撤销');}
    catch {H.toast('没能确认撤销结果，请重新打开权限核对');}
    finally {revoking.delete(id);const host=S.drawer==='hub-real-permissions' && document.querySelector('.drawer [data-hub-panel]');if(host)void renderPermissions(host);}
  }
  function loadPhrases() {
    return loadRoster().catch(()=>{});
  }
  function connectEvents() {
    if (mode !== 'real' || globalEvents || typeof EventSource === 'undefined') return;
    if(!rosterReady) return;
    const source = globalEvents = new EventSource('/bff/events');
    source.addEventListener('roster', e=>{if(mode==='real')try{applyRoster(JSON.parse(e.data));}catch{H.toast('助理名册没能更新，请稍后重试');}});
    source.addEventListener('status', e => { if (mode === 'real') { try { applyStatus(JSON.parse(e.data)); } catch {} } });
    source.addEventListener('card', e => { if (mode === 'real') { try { upsertCard(JSON.parse(e.data)); } catch {} } });
    source.addEventListener('open', () => {
      void loadRoster().catch(()=>{});
      void api('/approvals').then(async data => {
        if (mode !== 'real') return;
        (data.approvals || []).forEach(c => upsertCard(c, { render: false }));
        // 重连后再读已见会话的卡，取得 BFF 重启时结束的审批状态。
        const known = [...new Set([...cards.values()].filter(c => c.type === 'approval' && c.status === 'pending').map(c => c.sessionId))];
        for (const id of known) { const r = remoteRecords.get(id); if (r) await loadCards(r); }
      }).then(() => refreshStatus()).catch(() => {});
    });
  }
  function paintRecent() {
    r29WatchRecent();
    const host = document.querySelector('.home-recent-list');
    if (!host) return;
    let real = host.querySelector('.hub-real-recents');
    if (!real) real = H.h('div', { class: 'hub-real-recents' });
    if (host.children.length !== 1 || host.firstElementChild !== real) host.replaceChildren(real);
    const live = r29LiveUnread();
    const version = JSON.stringify([rosterVersion, S.search,
      sessions.map(s => [s.id, s.bot, s.title, s.updatedAt, s.lastText]),
      groups.map(g => [g.id, g.title, g.updatedAt, g.lastText]),
      live && live.conversations, live && live.groups]);
    if (real.dataset.version === version) return;
    real.dataset.version = version;
    real.replaceChildren();
    const needle = String(S.search || '').toLowerCase();
    let painted = 0;
    for (const s of sessions) {
      const blob = (botName(s.bot) + (s.title || '') + (s.lastText || '')).toLowerCase();
      if (needle && !blob.includes(needle)) continue;
      if (!isBot(s.bot)) continue;
      painted += 1;
      real.append(H.h('button', {
        type: 'button', class: 'conversation',
        style: typeof H.botStyle === 'function' ? H.botStyle(s.bot) : '',
        'data-real-open': s.id, 'data-real-updated-at': s.updatedAt || ''
      }, [
        r29OneFace(s.bot),
        H.h('div', { class: 'grow' }, [
          H.h('div', { class: 'line' }, H.h('strong', {},
            r29JoinTitle(botName(s.bot), s.title || '新会话'))),
          H.h('div', { class: 'preview' }, r29LastLine(s.lastText, '尚无回复'))
        ]),
        H.h('span', { class: 'home-row-meta' }, [
          H.h('time', {}, messageDate(s.updatedAt)?.time || ''),
          r29CountNode(r29BagCount(live, 'conversations', s.id))
        ])
      ]));
    }
    let grouped = 0;
    try { grouped = recentGroups(real) || 0; } catch { grouped = 0; }
    if (!painted && !grouped && rosterReady) real.append(H.h('p', {}, '暂无'));
  }
  function decorateR24() {
    paintRecent();
    // 壳在手机看板/聊天页隐藏首页底栏；沿用其顶栏图标补一个活动入口。
    const header = document.querySelector('.floatinghead');
    if (header && window.innerWidth < 700 && !header.querySelector('[data-real-activity-entry]')) {
      header.append(H.h('button', { type: 'button', class: 'iconbtn r22-round hub-real-activity-entry', 'data-activity-open': '', 'data-real-activity-entry': '' }, H.icon('bell')));
    }
    document.querySelectorAll('[data-real-activity-entry]').forEach(el => { el.hidden = pendingTotal === 0; });
    document.querySelectorAll('[data-activity-open],[data-today-open]').forEach(el => {
      let count = el.querySelector('[data-r22-activity-total]');
      if (!count && pendingTotal) { count = H.h('b', { class: 'r22-badge', 'data-r22-activity-total': '' }); el.append(count); }
      if (count) { count.textContent = String(pendingTotal); count.hidden = pendingTotal === 0; }
      el.setAttribute('aria-label', el.hasAttribute('data-today-open') ? '今天 ' + pendingTotal + ' 项等你处理' : '活动中心 ' + pendingTotal + ' 项待批');
    });
    document.querySelectorAll('[data-real-countdown]').forEach(el => { const c = cards.get('approval:' + el.dataset.realCountdown); if (c) el.textContent = remaining(c); });
    if (!realChat()) return;
    try { r31PaintMore(); } catch { /* 另有未读的提示这次没画上 */ }
    const slot = document.querySelector('.chat-quick-slot');
    if (slot) {
      const list = phrases.get(S.bot) || [];
      slot.hidden = !list.length;
      if (slot.dataset.realBot !== S.bot || slot.dataset.realPhrases !== JSON.stringify(list)) {
        slot.dataset.realBot = S.bot; slot.dataset.realPhrases = JSON.stringify(list);
        slot.replaceChildren(H.h('div', { class: 'hub-quick hub-real-phrases', 'aria-label': '开场短语，可横向滑动' },
          list.map(p => H.h('button', { type: 'button', class: 'ghostbtn', 'data-real-phrase': p }, p))));
      }
    }
  }

  function actions(d, container) {
    container.replaceChildren();
    const button = (label, attr) => container.append(H.h('button', { type: 'button', class: 'ghostbtn', [attr]: d.local }, label));
    if (['error','disconnected'].includes(d.state) && d.prompt) container.append(H.h('button', { type: 'button', class: 'ghostbtn', 'data-real-retry': d.id }, '重试'));
    if (d.state === 'disconnected' || d.state === 'error') button('重新加载', 'data-real-reload');
  }
  function statusText(d) {
    if (d.state === 'done') return '';
    if (['thinking', 'streaming'].includes(d.state) && !/连接|恢复|失败/.test(d.status || '')) return '···';
    return d.status || '';
  }
  H.registerCard('hub-real-tool', { title: '工具步骤', quoteLabel: d => toolText(d), render(d) {
    const r = current(), run = toolRun(r?.messages || [], d.id);
    const steps = run.length ? run : [d];
    if (steps[0].id !== d.id) return H.h('span', { hidden: true, 'data-real-tool-continuation': d.id });
    const key = (r?.local || '') + ':' + d.id;
    const root = H.h('details', { class: 'r22-tool-call hub-real-tool-trace', 'data-real-tool-group': d.id });
    root.open = openToolRuns.has(key);
    root.addEventListener('toggle', () => { if (root.isConnected) root.open ? openToolRuns.add(key) : openToolRuns.delete(key); });
    const label = steps.length > 1 ? '做了 ' + steps.length + ' 步' : toolText(d, cards.get('approval:' + d.approvalId)).replace(/ · (?:L1 已记录|已完成)$/, '');
    const rawName = steps.length > 1 ? '' : unknownToolName(d);
    root.append(H.h('summary', {}, [H.icon('file'), H.h('span', { title: label }, label), H.h('small', { 'data-real-tool-raw': rawName ? '' : null }, rawName), H.icon('chevron')]));
    const body = H.h('div', { class: 'r22-tool-body' });
    for (const step of steps) {
      const item=H.h('div', { class: 'hub-real-tool-step', 'data-real-tool': step.id }, [
      H.h('span', {}, toolText(step, cards.get('approval:' + step.approvalId))),
      unknownToolName(step) ? H.h('small', { class: 'hub-real-tool-path', 'data-real-tool-raw': '' }, unknownToolName(step)) : null,
      step.path ? H.h('small', { class: 'hub-real-tool-path' }, relativePath(step.path)) : null
    ]);
      if(step.name==='bash') {
        const card=cards.get('approval:'+step.approvalId),output=outputPreview(step.output);
        item.append(H.h('pre',{class:'hub-real-command','data-real-tool-command':''},step.command || card?.command || ''));
        if(step.output)item.append(H.h('pre',{class:'hub-real-command','data-real-tool-output':''},output.text));
        if(step.outputTruncated || output.truncated)item.append(H.h('p',{class:'mini-note'},step.outputPath?'全文在 '+relativePath(step.outputPath):'输出较长，全文位置见工具回执'));
      }
      body.append(item);
    }
    root.append(body); return root;
  } });
  function toolMessage(r, d) {
    return { id: uid(), hubReal: true, hubToolId: d.id, ts: d.ts, seq: d.seq, from: r.bot, role: 'bot', status: 'delivered',
      parts: [{ type: 'hub-real-tool', data: d }] };
  }
  function upsertTool(r, data) {
    const entry = surfaceEntries([{ role: 'assistant', text: '', tools: [data] }])[0]; if (!entry) return;
    const old = r.messages.find(m => m.hubToolId === entry.id);
    if (old) {
      old.ts ??= entry.ts; old.seq ??= entry.seq;
      Object.assign(old.parts[0].data, entry, { ts: old.ts, seq: old.seq });
    }
    else r.messages.push(toolMessage(r, entry));
    attachCards(r); if (active(r)) H.reading.preserve(redraw, { reason: 'real-tool' });
    if (!jobs.has(r.local)) return;
    const label = String(data?.name || data?.tool || entry?.name || '');
    const research = /检索|搜索|知识库|记忆|research|search/i.test(label);
    try { window.HubPetStage?.event?.(r.bot, 'tool-done'); } catch { /* 桌宠没挂上就不打断工具条 */ }
    try { H.petTurn(r.bot, research ? 'research' : 'working'); } catch { /* 舞台引擎还没准备好 */ }
  }
  H.registerCard('hub-real-response', { title: '真实回复', quoteLabel: d => d.text || d.status, render(d, ctx) {
    // 从壳的消息接口取得同一套 bubble + 斜名牌，沿用其 r22-latest 的 ▼。
    const shape = H.fromHTML(H.messageHTML({ id: uid(), from: d.bot || ctx.message.from, role: 'bot', status: 'delivered', parts: [{ type: 'text', md: '' }] }, 0));
    const block = shape.querySelector('.bubble');
    block.querySelectorAll('p,.r22-reply-status').forEach(n => n.remove());
    block.classList.add('hub-real-reply'); block.dataset.realReply = d.id; block.dataset.realState = d.state;
    const text = H.h('div', { class: 'hub-real-text' }); text.innerHTML = markdown(d.text);
    const buttons = H.h('div', { class: 'hub-real-actions' }); actions(d, buttons);
    block.append(text, H.h('small', { class: 'hub-real-status', role: 'status', 'aria-live': 'polite', 'aria-label': d.status }, statusText(d)), buttons,
      H.h('time', { class: 'hub-real-time' }, messageDate(d.ts)?.time || '')); return block;
  } });
  function paint(job, force = false) {
    if (!force && Date.now() - (job.lastPaint || 0) < 80) {
      if (!job.paintTimer) job.paintTimer = setTimeout(() => { job.paintTimer = null; paint(job, true); }, 80 - (Date.now() - job.lastPaint));
      return;
    }
    clearTimeout(job.paintTimer); job.paintTimer = null; job.lastPaint = Date.now();
    const thread = document.querySelector('.thread');
    const follow = thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 80;
    H.reading.preserve(() => document.querySelectorAll('[data-real-reply]').forEach(el => {
      if (el.dataset.realReply !== job.data.id) return;
      el.dataset.realState = job.data.state;
      const text = el.querySelector('.hub-real-text');
      if (text && text.dataset.raw !== job.data.text) { text.innerHTML = markdown(job.data.text); text.dataset.raw = job.data.text; }
      const status = el.querySelector('.hub-real-status'); status.textContent = statusText(job.data); status.setAttribute('aria-label', job.data.status || '');
      el.querySelector('.hub-real-time').textContent = messageDate(job.data.ts)?.time || '';
      actions(job.data, el.querySelector('.hub-real-actions'));
    }), { reason: 'real-stream' });
    if (follow && thread) thread.scrollTop = thread.scrollHeight;
    H.measureDock();
  }
  function finish(job, name, status) {
    if (jobs.get(job.r.local) !== job) return;
    jobs.delete(job.r.local); job.controller?.abort(); clearTimeout(job.paintTimer);
    job.data.state = name; job.data.status = status;
    if (name === 'done' && !job.data.text.trim()) {
      const index = job.r.messages.indexOf(job.message); if (index >= 0) job.r.messages.splice(index, 1);
    }
    attachCards(job.r);
    phase(job.r.bot, name === 'done' ? 'done' : name === 'stopped' ? 'idle' : 'error', job.r);
    H.setMessageStatus(job.r.local, job.message.id, 'delivered');
    paint(job, true); if (active(job.r)) { H.reading.preserve(redraw, { reason: 'turn-end' }); H.reading?.release({ reason: 'turn-end' }); }
    // 回合内多个 assistant 步骤以服务端历史为定稿；不再只留下最后一个文本槽。
    if (name === 'done') void history(job.r, { force: true }).catch(() => {});
    if (name === 'done' && !document.hidden && r29Hooks) {
      try { void r29Hooks.onReply(); } catch { /* 未读刷新失败不打断回合 */ }
    }
    if (active(job.r) && !document.hidden && job.r.remote) void api(endpoint(job.r.remote, 'read'), { method: 'POST', body: '{}' }).catch(() => {});
    if (!document.hidden) { void refreshList().catch(() => {}); void refreshStatus().catch(() => {}); }
  }
  function reply(r, text = '', state = 'done', status = '回复完成') {
    const data = { id: uid(), local: r.local, bot: r.bot, ts: Date.now(), text, state, status };
    const message = post(r, { from: r.bot, role: 'bot', timelineLocal: true, status: state === 'done' ? 'delivered' : 'thinking', parts: [{ type: 'hub-real-response', data }] });
    return { data, message };
  }
  async function history(r, { force = false } = {}) {
    if (!r.remote || jobs.has(r.local)) return;
    if (r.loading && !force) return r.loading;
    r.loading = (async () => {
      const data = await api(endpoint(r.remote, 'history'));
      if (jobs.has(r.local) || mode !== 'real') return;
      if (!Array.isArray(data.messages)) throw new Error('历史格式无效');
      const converted = historyMessages(r, data.messages);
      // 被另一设备停止、重新打开或重载时，也从服务器终态恢复“已停止”。
      if (stoppedSession(sessions.find(s => s.id === r.remote))) converted.push({ id: uid(), hubReal: true, from: r.bot, role: 'bot', status: 'delivered',
        parts: [{ type: 'hub-real-response', data: { id: uid(), local: r.local, bot: r.bot, text: '', state: 'stopped', status: '已停止' } }] });
      // registerConversation 会规范化并复制消息，当前槽的数组由 navigate 后记录。
      r.messages.splice(0, r.messages.length, ...converted); attachCards(r); r.ready = true;
      if (active(r)) { S.threads[r.bot] = r.messages; redraw(); }
    })().finally(() => { r.loading = null; });
    return r.loading;
  }
  function historyMessages(r, messages) {
    return surfaceEntries(messages).map(m => {
        if (m.kind === 'tool') return toolMessage(r, m);
        const assistant = m.role === 'assistant';
        return { id: uid(), hubReal: true, serverId: m.id, seq: m.seq, ts: m.ts, from: assistant ? r.bot : 'user', role: assistant ? 'bot' : 'user', status: 'delivered', time: messageDate(m.ts)?.time || '',
          parts: assistant ? [{ type: 'hub-real-response', data: { id: uid(), local: r.local, bot: r.bot, ts: m.ts, text: m.text, state: 'done', status: '' } }] : [{ type: 'text', md: m.text }] };
      });
  }
  function chatVisible() {
    return realChat() && !S.drawer && (S.detail || window.innerWidth >= 700);
  }
  function routeStamp() { return JSON.stringify([mode, S.view, S.detail, S.bot, S.conversation, S.drawer]); }
  function shellHistory() {
    const navigation = window.shellNavigation;
    return window.innerWidth < 700 && typeof navigation?.sync === 'function' && typeof navigation?.replace === 'function' ? navigation : null;
  }
  function bindMessages(r, { preserveSource = false } = {}) {
    sampleRoute = false;
    H.navigate({ view: 'chat', bot: r.bot, conversation: r.local }, { deferRender: true });
    S.threads[r.bot] = r.messages; S.sessionNames[r.bot] = r.title; H.currentMessages();
    S.running = jobs.has(r.local); S.emotion = S.running ? '思考' : '开心';
    selected.set(r.bot, r);
    const navigation = preserveSource && shellHistory();
    if (navigation) {
      // 壳把相邻 detail 会话视作同层 replace。派工是钻入来源会话：
      // 只同步目标的非 detail 快照来 push，再用现有 replace 提交最终快照。
      // 中间不 render；同一动作只增加一项，来源会话仍由壳负责恢复。
      S.detail = false; navigation.sync(); S.detail = true;
      navigation.replace(redraw);
    } else redraw();
    decorate();
  }
  async function open(r, load = true, options) {
    const epoch = ++opening;
    r31OpenedAt = Date.now();
    bindMessages(r, options);
    // 点开这段会话就算看过，数字先清，不等历史读完、不等滚到底。
    if (r.remote) r31SeenNow(r.remote);
    if (r.remote) {
      try {
        if (load && !jobs.has(r.local)) await history(r);
        await loadCards(r);
        if (epoch !== opening || !active(r)) return;
        await api(endpoint(r.remote, 'read'), { method: 'POST', body: '{}' });
        const meta = sessions.find(s => s.id === r.remote); if (meta) meta.unread = 0;
        serverUnread.set(r.bot, 0);
        const bot = S.bots.find(b => b.id === r.bot); if (bot) bot.unread = 0;
        if (sessions.find(s => s.id === r.remote)?.running && !jobs.has(r.local)) resume(r);
        r29Seen(r);
      } catch (error) { if (active(r)) showLoadError(r, error); }
    }
  }
  function showLoadError(r, error) {
    online = false; decorate();
    const existing = r.messages.find(m => m.parts?.[0]?.data?.loadError);
    if (existing) return;
    const { data } = reply(r, '', 'error', friendlyError(error, 'history')); data.loadError = true;
    phase(r.bot, 'error', r);
  }
  async function refreshList() {
    if (mode !== 'real') return;
    const data = await api('/sessions');
    if (mode !== 'real') return;
    sessions = (Array.isArray(data.sessions) ? data.sessions : []).filter(s => isBot(s.bot) && typeof s.id === 'string').sort((a, b) => (Date.parse(b.updatedAt) || Number(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || Number(a.updatedAt) || 0));
    sessions.forEach(s => { const r = record(s.bot, s.id, s.title || '新会话'); r.title = s.title || '新会话'; });
    if (S.drawer === 'hub-real-sessions') { const host = document.querySelector('.drawer [data-hub-panel]'); if (host) renderSessions(host); }
    decorate();
  }
  async function enterBot(bot) {
    if (!chatVisible() || S.bot !== bot) return;
    let r = selected.get(bot);
    if(!r)return;
    if (!r.remote && !r.messages.length && !r.fresh) {
      const item = r31PickUnread(bot, null) || sessions.find(s => s.bot === bot);
      if (item) r = record(bot, item.id, item.title);
    } else if (Date.now() - r31ExplicitAt >= 1500) {
      const pick = r31PickUnread(bot, r);
      if (pick && pick.id !== r.remote) r = record(bot, pick.id, pick.title || '新会话');
    }
    if (S.bot === bot && mode === 'real') await open(r);
  }
  function scheduleEnter() {
    if (!chatVisible() || queued) return;
    const existing = current();
    // 首页先完成轮询，再打开助理时，也要把自动草稿接回服务器会话。
    // 用户明确新建的空白草稿（fresh）始终保留。
    if (existing && (existing.remote || existing.messages.length || existing.fresh || !sessions.some(s => s.bot === S.bot))) return;
    // 当前 render 尚未结束，推迟导航，避免嵌套 render。
    if (!existing) S.threads[S.bot] = []; queued = true;
    const bot = S.bot, conversation = S.conversation;
    queueMicrotask(() => {
      queued = false;
      // navigate 在 popstate 恢复 fields 前会先发事件；执行时必须重验最终路由。
      if (chatVisible() && S.bot === bot && S.conversation === conversation) void enterBot(bot);
    });
  }
  function renderSessions(host) {
    host.replaceChildren(H.h('p', { class: 'mini-note' }, '会话来自服务器，手机和电脑共用。首次发送时才新建。'));
    host.append(H.h('button', { type: 'button', class: 'ghostbtn', 'data-real-new': S.bot, disabled: !isEnabled(S.bot) }, '新会话'));
    const list = sessions.filter(s => s.bot === S.bot);
    if (!list.length) host.append(H.h('p', {}, '还没有保存的会话'));
    list.forEach(s => host.append(H.h('button', { type: 'button', class: 'hub-real-session', 'data-real-open': s.id }, [
      H.h('strong', {}, botName(s.bot)+' · '+(s.title || '新会话') + (s.unread ? ' · ' + s.unread + ' 条未读' : '') + (s.running ? ' · 进行中' : '')),
      H.h('small', {}, previewText(s.lastText) || '尚无回复')
    ])));
    try { sessionGroups(host); } catch {}
  }
  H.registerPanel('hub-real-sessions', { title: '服务器会话', render: renderSessions });
  H.conversationsHTML = function (bot) {
    if (mode !== 'real' || bot && !isBot(bot)) return originals.conversations(bot);
    return '<button class="setting-row" data-real-list>查看服务器会话</button>';
  };
  // 设置里的「每月预算」。默认不设；设了，账本页的「本月」才出现预算进度条。
  H.registerSettingsPage('hub-real-budget', { title: '每月预算', icon: 'settings', group: '偏好', order: 60, render(host) {
    if (mode !== 'real') { host.append(H.h('p', { class: 'muted' }, '演示模式下不设预算。')); return; }
    const note = H.h('p', { class: 'muted', 'data-real-budget-note': '1' }, '读取中…');
    const input = H.h('input', { type: 'number', min: '1', step: '1', inputmode: 'decimal', 'data-real-budget-input': '1',
      placeholder: '不设', 'aria-label': '每月预算上限' });
    const unit = H.h('select', { 'data-real-budget-currency': '1', 'aria-label': '币种' }, [
      H.h('option', { value: 'CNY' }, '人民币 ¥'), H.h('option', { value: 'USD' }, '美元 $')]);
    const save = H.h('button', { type: 'button', class: 'primary', 'data-real-budget-save': '1' }, '保存');
    const clear = H.h('button', { type: 'button', class: 'ghostbtn', 'data-real-budget-clear': '1' }, '不设预算');
    const show = view => {
      input.value = view && view.monthly ? String(view.monthly) : '';
      unit.value = view && view.currency === 'USD' ? 'USD' : 'CNY';
      note.textContent = view && view.monthly ? '已设每月上限。账本页的「本月」会显示用了多少。'
        : '没有设预算，账本页就不显示进度条。这只是你自己定的提醒线，不是服务商账单。';
    };
    const apply = async value => {
      note.textContent = '保存中…';
      const api = window.HubSettings;
      const done = api && typeof api.setBudget === 'function' ? await api.setBudget(value, unit.value) : { ok: false, error: 'not-ready' };
      if (done.ok) { show(done.budget); note.textContent = value === null ? '已取消预算。' : '已保存。'; }
      else note.textContent = done.error === 'not-ready' ? '这台后端还不支持预算设置。' : '没保存成功，请检查数字后再试。';
    };
    save.addEventListener?.('click', () => {
      const n = Number(input.value);
      if (!(n > 0)) { note.textContent = '请填大于 0 的数字；不想设就点「不设预算」。'; return; }
      void apply(n);
    });
    clear.addEventListener?.('click', () => { void apply(null); });
    host.append(H.h('label', { class: 'field' }, ['每月预算上限', input]), H.h('label', { class: 'field' }, ['币种', unit]),
      H.h('div', { class: 'actions' }, [save, clear]), note);
    const api = window.HubSettings;
    if (api && typeof api.get === 'function') void api.get().then(res => { show(res && res.budget); }).catch(() => { note.textContent = '暂时读不到当前设置。'; });
    else note.textContent = '暂时读不到当前设置。';
  } });
  H.registerSettingsPage('hub-real-mode', { title: '连接模式', icon: 'settings', group: '偏好', order: 99, render(host) {
    host.append(H.h('div', { class: 'setting-row hub-real-mode-row' }, [H.h('span', { class: 'grow' }, mode === 'real' ? '名册助理真实连接' : '全页演示模式'),
      H.h('button', { type: 'button', class: 'ghostbtn', 'data-hub-mode': mode === 'real' ? 'demo' : 'real' }, mode === 'real' ? '切换演示' : '切换真实')]));
  } });
  function badge(host) {
    if (host && !host.closest('.home-top,.side-bottom,.compact-bots,.floatinghead') && !host.querySelector(':scope > .hub-real-sample')) host.append(H.h('span', { class: 'hub-real-sample' }, '样例'));
  }
  const openingDefaults = {
    fallback: '这个你帮我看看怎么办。',
    rows: [
      { when: '总管|协调|排期|先后|待办|梳理', text: '今天先干哪三件，你帮我排。' },
      { when: '调研|来源|出处|资料', text: '这个说法有没有出处，查一下。' },
      { when: '写作|写稿|文案|改稿|内容', text: '把这段改得口语一点。' },
      { when: '项目|进度|验收|推进|交付', text: '那个事现在到哪一步了。' },
      { when: '视觉|配色|图形|画面|出图|看图', text: '看看这张图哪里不对。' }
    ]
  };
  window.HubOpeningLines = openingDefaults;
  function openingTable() {
    const given = globalThis.HubOpeningLines;
    if (given && Array.isArray(given.rows)) return given;
    return openingDefaults;
  }
  function openingPattern(when) {
    if (when instanceof RegExp) return when;
    const source = String(when || '');
    if (!source) return null;
    try { return new RegExp(source); }
    catch { return null; }
  }
  function openingLine(duty) {
    const table = openingTable();
    const text = String(duty || '');
    for (const row of table.rows || []) {
      if (!row || typeof row.text !== 'string' || !row.text.trim() || row.when == null) continue;
      const pattern = openingPattern(row.when);
      if (pattern && pattern.test(text)) return row.text.trim();
    }
    const fallback = typeof table.fallback === 'string' ? table.fallback.trim() : '';
    return fallback || openingDefaults.fallback;
  }
  function openingDuty(bot) {
    const row = roster.get(bot);
    if (row && typeof row.duty === 'string' && row.duty.trim()) return row.duty;
    const shell = S.bots.find(item => item.id === bot);
    return shell && typeof shell.duty === 'string' ? shell.duty : '';
  }
  function openingButtonStyle() {
    return {
      display: 'block', width: '100%', maxWidth: '100%', boxSizing: 'border-box',
      margin: '12px auto 0', padding: '12px', border: '0', borderRadius: '16px',
      background: 'var(--well)', color: 'var(--ink)', font: 'inherit', lineHeight: '1.5',
      textAlign: 'center', whiteSpace: 'normal', overflowWrap: 'anywhere', minHeight: '44px',
      cursor: 'pointer'
    };
  }
  function placeOpeningLine(line) {
    const text = String(line || '').trim();
    if (!text) return;
    S.input = text;
    const box = document.querySelector('[data-focus="composer"]');
    if (!box) return;
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      box.focus({ preventScroll: true });
      box.setSelectionRange(text.length, text.length);
    } catch { /* 输入框暂时不能聚焦时，草稿里已经有这句 */ }
  }
  function paintEmptyTalk(thread, r) {
    const loading = !!(r.remote && !r.ready);
    const name = S.bots.find(item => item.id === r.bot)?.name || '助理';
    const label = loading ? '正在加载会话…' : '和' + name + '说点什么';
    let empty = thread.querySelector('.hub-real-empty');
    let host = thread.querySelector('.r29-opening');
    if (r.messages.length) {
      empty?.remove();
      host?.remove();
      return;
    }
    if (!empty) {
      empty = H.h('p', { class: 'hub-real-empty' });
      thread.append(empty);
    }
    empty.textContent = label;
    // 旧会话的历史还没回来时不放示例，避免加载过程闪出一句能点的话。
    if (loading) {
      host?.remove();
      return;
    }
    const line = openingLine(openingDuty(r.bot));
    if (!host) {
      host = H.h('p', { class: 'r29-opening' });
      empty.after(host);
    }
    const current = host.querySelector('[data-r29-opening]');
    if (current && current.getAttribute('data-r29-opening') === line) return;
    host.replaceChildren();
    const button = H.h('button', {
      type: 'button', class: 'r29-opening-line', 'data-r29-opening': line,
      style: openingButtonStyle()
    });
    button.textContent = line;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      placeOpeningLine(line);
    });
    host.append(button);
  }
  function decorateMessages(r) {
    const thread = document.querySelector('.thread-inner'); if (!thread || !r) return;
    let day = '';
    const wanted = new Set();
    r.messages.forEach(m => {
      const article = [...thread.querySelectorAll('[data-message-id]')].find(n => n.dataset.messageId === m.id);
      if (!article) return;
      article.classList.toggle('hub-real-tool-message', !!m.hubToolId);
      article.hidden = !!article.querySelector('[data-real-tool-continuation]');
      if (article.hidden) return;
      const stamp = messageDate(m.ts);
      const meta = article.querySelector('.message-meta'); if (meta) meta.textContent = stamp?.time || '';
      if (!stamp || stamp.day === day) return;
      day = stamp.day; wanted.add(m.id);
      let divider = [...thread.querySelectorAll('[data-real-date-for]')].find(n => n.dataset.realDateFor === m.id);
      if (!divider) { divider = H.h('p', { class: 'time-stamp hub-real-date', 'data-real-date-for': m.id }); article.before(divider); }
      divider.textContent = day;
    });
    thread.querySelectorAll('[data-real-date-for]').forEach(n => { if (!wanted.has(n.dataset.realDateFor)) n.remove(); });
    paintEmptyTalk(thread, r);
  }
  function decorate() {
    document.documentElement.dataset.hubMode = mode;
    document.documentElement.dataset.hubRealChat = String(realChat());
    decorateModeEntry();
    syncDemoContent();
    fsSync();
    if (mode !== 'real') { document.querySelectorAll('.hub-real-sample,.hub-real-busy,.hub-real-list-link').forEach(n => n.remove()); return; }
    syncShellBotStates();
    paintRoster();
    if (realChat()) {
      const title = document.querySelector('.shell-title-meta');
      const r = current();
      if (title) {
        if (!title.querySelector('.hub-real-title')) title.replaceChildren(H.h('span', { class: 'hub-real-title' }), H.h('small', { class: 'title-model hub-real-health', role: 'status' }), H.h('button', { type: 'button', class: 'textbutton hub-real-list-link', 'data-real-list': '' }, '会话'));
        const label = pickedModelName(r) || modelLabelFor(modelsByBot.get(S.bot), S.bot);
        const caption = (r?.title || '新会话') + ' · ' + (label || 'DeepSeek V4.1 Flash');
        title.querySelector('.hub-real-title').textContent = caption;
        title.querySelector('.hub-real-title').title = caption;
        title.querySelector('.hub-real-health').textContent = online ? '已连接' : '未连接';
        try { paintModelChip(title, r); } catch {}
      }
      if (r) {
        S.sessionNames[r.bot] = r.title;
        decorateMessages(r);
      }
      const job = jobs.get(S.conversation); S.running = !!job;
      const stopButton = document.querySelector('.composer-area .voicebtn');
      if (stopButton && job) { stopButton.dataset.act = 'stop'; stopButton.setAttribute('aria-label', '停止生成'); stopButton.textContent = '停止'; }
      else if (stopButton?.dataset.act === 'stop') { stopButton.dataset.act = S.input?.trim() ? 'send' : 'voice'; stopButton.textContent = S.input?.trim() ? '发送' : '语音'; }
      syncPetLabels();
    }
    document.querySelectorAll('[data-bot-tree]').forEach(host => {
      const bot = host.dataset.botTree;
      if (!isBot(bot)) { badge(host.querySelector('strong')); return; }
      const pending = serverPending.get(bot) || 0;
      const busy = serverRunning.get(bot) === true || delegated.get(bot)?.running || delegated.get(bot)?.queued > 0 || [...jobs.values()].some(j => j.r.bot === bot);
      host.dataset.realBusy = String(busy);
      const caption = !shellStatusAvailable && host.querySelector('.pin > small');
      if (caption) {
        caption.dataset.realIdleCaption ??= caption.textContent;
        caption.textContent = pending ? '等你点头 · ' + pending + ' 项' : busy ? '忙碌' : caption.dataset.realIdleCaption;
      }
      let status = host.querySelector('.hub-real-busy');
      if (!shellStatusAvailable && busy && !caption && !status) { status = H.h('span', { class: 'hub-real-busy' }); host.querySelector('.preview')?.append(status); }
      if (status) status.textContent = busy ? ' · 忙碌' : '';
      const meta = host.querySelector('.home-row-meta') || host.querySelector('.pin'), unread = S.bots.find(b => b.id === bot)?.unread || 0;
      const corner = host.querySelector(':scope > .shell-sub-avatars .home-child-count');
      if (corner) {
        // 壳的 +N 来自演示分助理；真实模式角落只显示 status.unread 的红点。
        corner.style.display = unread ? '' : 'none';
        corner.classList.toggle('has-unread', !!unread);
        if (unread && !corner.querySelector('.r22-unread-dot')) corner.replaceChildren(H.h('i', { class: 'r22-unread-dot', 'aria-label': '未读' }));
        if (!unread) corner.replaceChildren();
        corner.setAttribute('aria-label', (S.bots.find(b => b.id === bot)?.name || '助理') + (unread ? '，有未读' : ''));
        host.querySelector('.pin .bot-unread')?.remove();
      } else if (!shellStatusAvailable && meta && unread && !meta.querySelector('.bot-unread')) meta.append(H.h('i', { class: 'bot-unread' + (meta.matches('.pin') ? ' home-assistant-unread' : ''), 'aria-label': '未读' }));
      if (!unread) meta?.querySelectorAll('.bot-unread').forEach(n => n.remove());
      const preview = host.querySelector('.preview'), latest = sessions.find(s => s.bot === bot);
      if (preview && latest && !busy) preview.textContent = previewText(latest.lastText || latest.title) || '新会话';
    });
    document.querySelectorAll('.capability-card h3,[data-capability-steward] > h2,.bot-capabilities h3').forEach(badge);
    document.querySelectorAll('.shell-activity h3,.shell-activity-column > h3,.decision-shortcut strong').forEach(badge);
    document.querySelectorAll('.home-top .hub-real-sample,.side-bottom .hub-real-sample,.compact-bots .hub-real-sample,.floatinghead .hub-real-sample').forEach(n => n.remove());
    if (!shellStatusAvailable) document.querySelectorAll('.r22-home-busy').forEach(n => { const count = BOTS.filter(bot => serverRunning.get(bot) === true).length; n.textContent = count ? '● ' + count + ' 在干活' : ''; n.hidden = !count; });
    // 看板、账本、活动、舞台等页里是真数据，标题旁不再挂「样例」；只有壳里整页还是演示内容的能力页、任务页保留。
    if (['capabilities','task','control'].includes(S.view)) document.querySelectorAll('.page-title h1,.page-title h2,.r22-board-heading h1').forEach(badge);
    else document.querySelectorAll('.page-title .hub-real-sample,.r22-board-heading .hub-real-sample').forEach(n => n.remove());
    if (S.drawer === 'custom' && S.customTitle === '活动中心') document.querySelectorAll('.drawer .dhead h2').forEach(badge);
    if (['decisions','jobs','usage'].includes(S.drawer)) document.querySelectorAll('.drawer .dhead h2,.drawer .dhead strong').forEach(badge);
    decorateR24();
    try { paintBoardView(); } catch {}
    try { paintUsageDrawer(); } catch {}
    try { paintLedgerView(); } catch {}
    // 新会话里壳自带的“查了知识库”是假素材，不冒充本次真实引用。
    if (typeof H.setDemoContent !== 'function' && realChat()) document.querySelectorAll('.r22-tool-call:not(.hub-real-tool-trace)').forEach(n => n.hidden = true);
  }
  function syncDemoContent() {
    if (typeof H.setDemoContent !== 'function') return;
    BOTS.forEach(bot => {
      const enabled = mode !== 'real' || sampleRoute && S.bot === bot;
      if (shellDemo.get(bot) !== enabled) { H.setDemoContent(bot, enabled); shellDemo.set(bot, enabled); }
    });
  }
  function syncShellBotStates() {
    if (shellStatusAvailable === false) return;
    for (const bot of BOTS) {
      const counts = { running: serverRunning.get(bot) === true || !!delegated.get(bot)?.running || delegated.get(bot)?.queued > 0 || [...jobs.values()].some(j => j.r.bot === bot),
        unread: serverUnread.get(bot) || 0, pending: serverPending.get(bot) || 0 };
      const key = JSON.stringify(counts);
      if (shellCounts.get(bot) === key) continue;
      try { H.setBotStatus(bot, counts); shellStatusAvailable = true; shellCounts.set(bot, key); }
      catch (error) {
        // 旧壳只接受 active/paused；这一次合法对象探测失败后不再调用。
        if (shellStatusAvailable === null && error.message === 'Unsupported bot status') { shellStatusAvailable = false; return; }
        throw error;
      }
    }
  }
  function openModeSettings() {
    if (typeof H.openPanel !== 'function') return;
    S.settingsTab = 'hub-real-mode';
    H.openPanel('settings');
  }
  function decorateModeEntry() {
    if (typeof H.registerMoreItem === 'function') {
      const label = mode === 'real' ? '连接模式 · 真实（点击设置）' : '连接模式 · 演示（点击设置）';
      if (modeEntryLabel !== label) {
        r29More({ id: 'hub-real-mode', label, onClick: openModeSettings });
        modeEntryLabel = label;
      }
      return;
    }
    const host = S.drawer === 'more' ? document.querySelector('.drawer .r22-sheet-content') : null;
    if (host && !host.querySelector('[data-real-mode-entry]')) host.append(H.h('button', { type: 'button', class: 'setting-row hub-real-mode-row', 'data-real-mode-entry': '' }, mode === 'real' ? '连接模式 · 真实（点击设置）' : '连接模式 · 演示（点击设置）'));
  }
  function syncPetLabels() {
    document.querySelectorAll('[data-pet-status]').forEach(el => {
      const paintLabel = () => {
        if (!realChat()) return;
        const label = serverPending.get(S.bot) > 0 ? '等你点头' : ({ thinking:'在想', speaking:'在说', done:'做好了', error:'出错', idle:'随时接话' })[botPhase.get(S.bot)];
        if (label && el.textContent !== label) el.textContent = label;
      };
      paintLabel();
      // 壳的角色动画会再次刷新文字；只观察这两个小标签，不观察整页。
      if (!observedPetLabels.has(el) && typeof MutationObserver !== 'undefined') {
        observedPetLabels.add(el);
        new MutationObserver(paintLabel).observe(el, { childList:true, characterData:true, subtree:true });
      }
    });
  }
  async function streamOnce(job) {
    job.controller = new AbortController();
    const budget = () => Math.max(1, job.retryUntil ? Math.min(22000, job.retryUntil - Date.now()) : 22000);
    const connectTimer = setTimeout(() => job.controller.abort(), Math.min(12000, budget()));
    let response;
    try { response = await fetch('/bff' + endpoint(job.r.remote, 'stream'), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/event-stream' }, signal: job.controller.signal }); }
    finally { clearTimeout(connectTimer); }
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('回复连接暂不可用');
    online = true; decorate();
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let idleState = false, upstreamError = null;
    const output = () => {
      if (job.committed || !job.r.messages.includes(job.message)) {
        const turn = job.data, next = reply(job.r, '', 'thinking', '在想');
        for (const key of ['prompt','idem','userMessageId','unsent']) next.data[key] = turn[key];
        Object.assign(job, next); job.committed = false;
      }
    };
    const parse = eventParser((event, data) => {
      if (jobs.get(job.r.local) !== job || job.stopping) return;
      if (event === 'card') { upsertCard(data); }
      else if (event === 'tool') {
        upsertTool(job.r, data);
        if (!job.data.text.trim()) {
          const index = job.r.messages.indexOf(job.message); if (index >= 0) job.r.messages.splice(index, 1);
          if (active(job.r)) H.reading.preserve(redraw, { reason: 'real-tool-step' });
        }
      }
      else if (event === 'state') {
        if (job.committed && typeof data.partial === 'string' && data.partial.trim()) output();
        if (job.committed && !data.partial) { idleState = data.running === false; return; }
        job.data.text = typeof data.partial === 'string' ? data.partial : '';
        idleState = data.running === false;
        job.data.state = job.data.text ? 'streaming' : 'thinking';
        job.data.status = job.data.text ? '正在回复' : '在想';
        if (!idleState) phase(job.r.bot, job.data.text ? 'speaking' : 'thinking', job.r);
        paint(job);
      } else if (event === 'delta') {
        output();
        job.data.text += typeof data.text === 'string' ? data.text : '';
        job.data.state = 'streaming'; job.data.status = '正在回复'; phase(job.r.bot, 'speaking', job.r); paint(job);
      } else if (event === 'message' && data.role === 'assistant' && typeof data.text === 'string') {
        if (data.text.trim()) {
          if (job.committed && job.message.serverId !== data.id) output();
          if (!job.r.messages.includes(job.message)) output();
          job.data.text = data.text; job.message.serverId = data.id; job.message.seq = data.seq;
          job.data.state = 'done'; job.data.status = '';
          job.message.timelineLocal = false;
          if (Number.isFinite(timeValue(data.ts))) { job.data.ts = data.ts; job.message.ts = data.ts; }
          job.committed = true;
        } else if (!job.data.text.trim()) {
          const index = job.r.messages.indexOf(job.message); if (index >= 0) job.r.messages.splice(index, 1);
        }
        for (const t of Array.isArray(data.tools) ? data.tools : []) upsertTool(job.r, { ...t, ts: t.ts ?? data.ts, seq: t.seq ?? data.seq });
        attachCards(job.r); if (active(job.r)) H.reading.preserve(redraw, { reason: 'real-step-message' });
      } else if ((event === 'done' || event === 'error') && stoppedTurn(data.reason)) finish(job, 'stopped', '已停止');
      else if (event === 'done') finish(job, 'done', '回复完成');
      else if (event === 'error') { upstreamError = new Error(data.message || '助理暂时没能完成回复，请重试。'); upstreamError.upstream = true; }
    });
    try {
      while (jobs.get(job.r.local) === job && !job.stopping) {
        let timer;
        const chunk = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => { job.controller.abort(); reject(new Error('回复连接超时')); }, budget()); })]).finally(() => clearTimeout(timer));
        if (chunk.done) throw new Error('连接断了');
        parse(decoder.decode(chunk.value, { stream: true }));
        if (upstreamError) throw upstreamError;
        if (idleState && jobs.get(job.r.local) === job) {
          // BFF 已结束（含重启），从历史取定稿；不把空 partial 当成最终回复。
          const data = await api(endpoint(job.r.remote, 'history'));
          const last = data.messages?.at(-1);
          if (last?.role !== 'assistant') throw Object.assign(new Error('连接断了，回复可能没收全，请重新加载。'), { upstream: true });
          job.data.text = typeof last.text === 'string' ? last.text : ''; finish(job, 'done', '已从历史恢复');
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function receive(job) {
    let failures = 0, started = 0;
    while (jobs.get(job.r.local) === job && !job.stopping && mode === 'real') {
      try { await streamOnce(job); return; }
      catch (error) {
        if (jobs.get(job.r.local) !== job || job.stopping) return;
        online = false; decorate();
        if (error.upstream) { finish(job, 'error', friendlyError(error, 'reply')); return; }
        started ||= Date.now(); job.retryUntil = started + 30000;
        const delay = Math.min(1000 * 2 ** failures++, 8000), remaining = 30000 - (Date.now() - started);
        if (remaining <= delay) { finish(job, 'disconnected', '连接断了，回复可能没收全。请重新加载。'); return; }
        job.data.status = '连接断了，正在重连（' + delay / 1000 + '秒）'; paint(job, true);
        await new Promise(resolve => { job.wake = resolve; job.retryTimer = setTimeout(resolve, delay); }); job.wake = null;
      }
    }
  }
  function resume(r) {
    if (jobs.has(r.local)) return;
    const existing = r.messages.at(-1);
    const output = existing?.from !== 'user' && existing?.parts?.[0]?.type === 'hub-real-response' ? { message: existing, data: existing.parts[0].data } : reply(r, '', 'thinking', '正在恢复回复');
    const job = { r, ...output, controller: null, admitted: true }; jobs.set(r.local, job); phase(r.bot, 'thinking', r);
    job.task = receive(job).catch(() => finish(job, 'disconnected', '连接断了，回复可能没收全。请重新加载。'));
  }
  function sendText(bot, text, r = current(), retryData = null) {
    if(isBot(bot) && !isEnabled(bot)){H.toast('这个助理已停用，只能查看旧会话');return;}
    assertBot(bot); // 必须在创建会话与任何 fetch 之前断言。
    if (mode !== 'real' || sampleRoute || !r || r.bot !== bot) return;
    if (jobs.has(r.local)) { H.toast('助理正在回复，请先停止'); return; }
    // 重试沿用原句。新发送才把还没带走的文件附注接在后面，避免附注被重试吃掉或提前丢掉。
    const outgoing = !retryData && r29Hooks ? r29Hooks.compose(bot, text) : text;
    if (!String(outgoing || '').trim()) return;
    // 先留下用户气泡与回复位。历史失败也不能在发送入口无声拦住。
    const previous = retryData && r.messages.find(m => m.parts?.[0]?.data === retryData);
    const userMessage = previous && r.messages.find(m => m.id === retryData.userMessageId) || post(r, { from: 'user', role: 'user', parts: [{ type: 'text', md: outgoing }] });
    r.fresh = false;
    const output = previous ? { message: previous, data: retryData } : reply(r, '', 'thinking', '在想');
    Object.assign(output.data, { text: '', state: 'thinking', status: '在想', prompt: outgoing, userMessageId: userMessage.id, unsent: false,
      idem: retryData?.idem || hubIdem() });
    const job = { r, ...output, controller: null, admitted: false, stopping: false }; jobs.set(r.local, job);
    phase(bot, 'thinking', r); paint(job, true);
    job.admission = (async () => {
      if (r.remote && !r.ready) {
        let data;
        try { data = await api(endpoint(r.remote, 'history')); }
        catch (error) { error.definitelyUnsent = true; throw error; }
        if (!Array.isArray(data.messages)) throw Object.assign(new Error('历史格式无效'), { definitelyUnsent: true });
        r.messages.splice(0, r.messages.length, ...historyMessages(r, data.messages), userMessage, output.message); attachCards(r);
        r.ready = true;
        if (active(r)) { S.threads[r.bot] = r.messages; redraw(); }
      }
      if (!r.remote) {
        assertBot(bot); let created;
        try { created = await createRemote(r, bot); }
        catch (error) { error.definitelyUnsent = true; throw error; }
        if (!created.id || created.bot !== bot) throw new Error('会话创建回执不匹配');
        r.remote = created.id; r.ready = true; remoteRecords.set(r.remote, r);
      }
      if (job.stopping) return;
      assertBot(bot); const result = await api(endpoint(r.remote, 'messages'), { method: 'POST', body: JSON.stringify({ text: outgoing, idem: job.data.idem }) });
      if (!result.accepted || !result.requestId) throw new Error('发送结果未知，请先重新加载历史再决定是否重试');
      job.admitted = true; H.setMessageStatus(r.local, userMessage.id, 'delivered');
      void refreshStatus().catch(() => {});
    })();
    job.task = (async () => {
      try { await job.admission; if (!job.stopping) await receive(job); }
      catch (error) { if (!job.stopping) { online = false; job.data.unsent = error.definitelyUnsent === true; finish(job, 'error', friendlyError(error)); } }
    })();
  }
  function r29TakeFiles() {
    return (Array.isArray(S.attachments) ? S.attachments : []).filter(entry => entry && (entry.file || entry.name));
  }
  function r29ClearInput(input) {
    if (typeof H.clearComposer === 'function') return H.clearComposer();
    if (input) input.value = '';
    S.input = '';
    return true;
  }
  async function sendInput() {
    if (mode === 'real' && S.r29GroupFocus && r29NewGroupPage()) {
      const box = document.querySelector('[data-focus="composer"]');
      const text = box?.value.trim() || '';
      if (!text) {
        if (r29TakeFiles().length && typeof H.toast === 'function') H.toast('讨论组里先发文字');
        return;
      }
      if (!r29ClearInput(box)) return;
      if (box) box.dispatchEvent(new Event('input', { bubbles: true }));
      S.refocus = true;
      await r29SendGroupLine(S.r29GroupFocus, text);
      keepComposerFocus();
      return;
    }
    if (typeof H.canSend === 'function' && !H.canSend()) return;
    if(isBot(S.bot) && !isEnabled(S.bot)){H.toast('这个助理已停用，只能查看旧会话');return;}
    assertBot(S.bot);
    const input = document.querySelector('[data-focus="composer"]');
    const text = input?.value.trim() || '';
    const files = r29TakeFiles();
    if (!text && !files.length) return;
    if (jobs.has(S.conversation)) { H.toast('请先停止当前回复'); return; }
    const r = current(); if (!r) { H.toast('请重新打开助理会话'); return; }
    let uploaded = 0;
    const failed = [];
    if (files.length) {
      // 按住时附注先留在队列里，等这一句 sendText 一起带走，不另发一条。
      r29HoldSend = true;
      try {
        for (const entry of files) {
          const file = entry.file || entry;
          let result = null;
          if (typeof window.HubUpload === 'function') {
            try {
              result = await window.HubUpload(file, { conversation: r.remote || r.local, bot: S.bot });
            } catch { result = null; }
          }
          if (result && result.ok) uploaded += 1;
          else failed.push(entry);
        }
      } finally { r29HoldSend = false; }
      S.attachments = failed;
      if (failed.length) H.toast('没传上去，点这里重试');
    }
    const body = text || (uploaded ? '已附上 ' + uploaded + ' 个文件' : '');
    if (!body) return;
    if (!r29ClearInput(input)) return;
    if (input) input.dispatchEvent(new Event('input', { bubbles: true }));
    // 热修：发完不让输入框失焦，接着打的字直接进框（壳的重绘按 refocus 把焦点放回新输入框）。
    S.refocus = true;
    sendText(S.bot, body, r);
    keepComposerFocus();
  }
  // 热修：把焦点放回当前输入框；同步一次，下一帧再补一次（重绘换了节点时）。
  function keepComposerFocus() {
    const again = () => {
      const box = document.querySelector('[data-focus="composer"]');
      if (box && !box.disabled && document.activeElement !== box) box.focus({ preventScroll: true });
    };
    again();
    requestAnimationFrame(() => { again(); S.refocus = false; });
  }
  async function stop(local) {
    const job = jobs.get(local); if (!job || job.stopping) return;
    job.stopping = true; job.data.stopping = true; job.data.status = '正在停止'; paint(job, true);
    job.controller?.abort(); clearTimeout(job.retryTimer); job.wake?.();
    try {
      await job.admission?.catch(() => {});
      if (job.admitted) {
        const result = await api(endpoint(job.r.remote, 'cancel'), { method: 'POST', body: '{}' });
        if (result.ok !== true) throw new Error('停止未获确认');
      }
      finish(job, 'stopped', '已停止');
    } catch { job.stopping = false; job.data.stopping = false; job.data.status = '停止失败，请重试停止'; paint(job, true); }
  }
  async function poll() {
    if (mode !== 'real' || document.hidden || pollBusy) return;
    pollBusy = true;
    try {
      if(!rosterReady)await loadRoster();
      const [health, status] = await Promise.allSettled([api('/health'), api('/status')]);
      if (mode !== 'real') return;
      online = health.status === 'fulfilled' && health.value.ok === true && health.value.dsh?.connected === true;
      if (status.status === 'fulfilled') applyStatus(status.value);
      r31Nudge(20000);
      await refreshList(); decorate();
      try { void refreshGroups().then(() => decorate()).catch(() => {}); } catch {}
      try { void loadModels().then(() => decorate()).catch(() => {}); } catch {}
    } catch { online = false; decorate(); }
    finally { pollBusy = false; }
  }
  function applyStatus(status) {
    if(typeof status.hubHome==='string' && status.hubHome.startsWith('/'))hubHomePrefix=status.hubHome;
    if(Number.isSafeInteger(status.commandGrantDays) && status.commandGrantDays>0)commandGrantDays=status.commandGrantDays;
    pendingTotal = Math.max(0, Number(status.pendingTotal) || 0);
    BOTS.forEach(bot => {
        const value = status.bots?.[bot]; if (!value) return;
        serverRunning.set(bot, value.running === true);
        serverPending.set(bot, Math.max(0, Number(value.pending) || 0));
        delegated.set(bot, value.delegated || { running: false, queued: 0 });
        const unread = Math.max(0, Math.trunc(Number(value.unread) || 0));
        if (serverUnread.has(bot) && serverUnread.get(bot) !== unread) r31Nudge(3000);
        serverUnread.set(bot, unread);
        const item = S.bots.find(b => b.id === bot); if (item && !shellStatusAvailable) item.unread = unread;
        const running = [...jobs.values()].some(j => j.r.bot === bot);
        if (!running && (value.running || !['done','error'].includes(botPhase.get(bot)))) phase(bot, value.running ? 'thinking' : 'idle', selected.get(bot));
    }); decorate();
  }
  async function refreshStatus() {
    if (mode !== 'real' || document.hidden) return;
    const status = await api('/status');
    if (mode === 'real') applyStatus(status);
  }
  function timer() { connectEvents(); clearInterval(pollTimer); if (mode === 'real' && !document.hidden) pollTimer = setInterval(() => void poll(), 5000); }
  async function changeMode(next) {
    if (mode === next || switching) return;
    switching = true;
    try {
      if (next === 'demo') {
        await Promise.all([...jobs.keys()].map(stop));
        if (jobs.size) { H.toast('停止尚未确认，保留真实模式'); return; }
      } else if (S.running) { H.toast('请先停止演示回复'); return; }
      mode = next;
      r29SyncMode();
      fsSync();
      write('hub-web-mode-v1', mode);
      S.running = false;
      S.drawer = null;
      if (next === 'demo') r28a1RestoreBots();
      if (next === 'demo') {
        if (shellStatusAvailable) BOTS.forEach(bot => H.setBotStatus(bot, demo.get(bot).counts));
        shellCounts.clear();
        globalEvents?.close(); globalEvents = null;
        H.clearActivities?.([...activities.values()].map(a => a.id));
        if (isBot(S.bot)) H.navigate({ view: 'chat', conversation: S.bot + '-013' }, { deferRender: true });
        BOTS.forEach(bot => { S.threads[bot] = demo.get(bot).messages; S.sessionNames[bot] = demo.get(bot).title; });
        redraw();
      } else { await loadPhrases(); H.restoreActivities?.([...activities.values()].map(a => a.id)); await poll(); if (isBot(S.bot)) await enterBot(S.bot); }
      timer(); decorate();
    } finally { switching = false; }
  }
  let sendGesture = null, sentGesture = null, forwardingDemoClick = false;
  function sendButton(target) {
    const button = target.closest?.('.composer-area button[data-act="send"]');
    return button && (mode === 'demo' || realChat()) ? button : null;
  }
  function pressSend(e, pointer) {
    const button = sendButton(e.target);
    if (!button || pointer.isPrimary === false || pointer.button > 0) return;
    // 先于浏览器默认聚焦和壳的手势处理，避免键盘收起后按钮移位。
    consume(e);
    sendGesture = { button, id: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, bot: S.bot, conversation: S.conversation, mode };
    try { button.setPointerCapture(pointer.pointerId); } catch {}
  }
  function releaseSend(e, pointer) {
    const gesture = sendGesture;
    if (!gesture || pointer.pointerId !== gesture.id) return;
    consume(e); sendGesture = null;
    sentGesture = { bot: gesture.bot, conversation: gesture.conversation, until: Date.now() + 800 };
    if (Math.hypot(pointer.clientX - gesture.x, pointer.clientY - gesture.y) > 18 || !gesture.button.isConnected || gesture.mode !== mode || gesture.bot !== S.bot || gesture.conversation !== S.conversation) return;
    // pointerup 先完成原生 touchend，再改按钮图标。否则被替换的 SVG
    // 会带走 touchend，壳会一直认为手指仍按着，后续历史重绘也被挂起。
    setTimeout(() => {
      if (!gesture.button.isConnected || gesture.mode !== mode || gesture.bot !== S.bot || gesture.conversation !== S.conversation) return;
      if (mode === 'real') sendInput();
      else {
        // 演示也只修发送键的焦点；仍由壳处理原有演示发送。
        forwardingDemoClick = true;
        try { gesture.button.click(); } finally { forwardingDemoClick = false; }
      }
    }, 0);
  }
  // 热修：按发送键不抢走输入框焦点（手机浏览器合成的 mousedown 会先让输入框失焦）。
  window.addEventListener('mousedown', e => { if (sendButton(e.target)) e.preventDefault(); }, true);
  if (window.PointerEvent) {
    window.addEventListener('pointerdown', e => pressSend(e, e), true);
    window.addEventListener('pointerup', e => releaseSend(e, e), true);
    window.addEventListener('pointercancel', () => { sendGesture = null; }, true);
  } else {
    const touchPointer = touch => ({ pointerId: touch.identifier, clientX: touch.clientX, clientY: touch.clientY, isPrimary: true, button: 0 });
    window.addEventListener('touchstart', e => { if (e.touches.length === 1) pressSend(e, touchPointer(e.touches[0])); }, { capture: true, passive: false });
    window.addEventListener('touchend', e => { if (e.changedTouches.length === 1) releaseSend(e, touchPointer(e.changedTouches[0])); }, { capture: true, passive: false });
    window.addEventListener('touchcancel', () => { sendGesture = null; }, true);
  }
  window.addEventListener('click', e => {
    const button = e.target.closest?.('button'); if (!button) return;
    if (forwardingDemoClick) return;
    if (sentGesture?.bot === S.bot && sentGesture.conversation === S.conversation && Date.now() < sentGesture.until && e.detail !== 0 && button.closest('.r22-input-row') && ['send','stop','voice'].includes(button.dataset.act)) { consume(e); return; }
    if (mode === 'real') {
      if (button.dataset.realAnswer) { consume(e); void answerApproval(button.dataset.realApproval, button.dataset.realAnswer, button); return; }
      if (button.dataset.realRevoke) { consume(e); void revokePermission(button.dataset.realRevoke,button); return; }
      if (button.dataset.realPending) { consume(e); const c = cards.get('approval:' + button.dataset.realPending); if (c) void openCard(c); return; }
      if (button.dataset.realContinue) { consume(e); void continueDelegation(button.dataset.realContinue, button); return; }
      if (button.dataset.realReport) { consume(e); const c = cards.get('delegation:' + button.dataset.realReport); if (c?.toSession) { S.drawer = null; void open(record(c.bot, c.toSession, '派工回报'), true, { preserveSource: true }); } return; }
      if (button.matches?.('[data-feature-phrase],[data-feature-chat]')) {
        consume(e);
        const bot = H.featureOwner?.(S.featureId)?.id;
        if (!isEnabled(bot)) { H.toast('负责的助理暂不可用，请先查看助理名册'); return; }
        // 功能页只填草稿；打开服务端会话后仍等待用户亲自发送。
        const text = button.dataset.featurePhrase || '', latest = sessions.find(s => s.bot === bot);
        S.drawer = null; S.input = text;
        const r = latest ? record(bot, latest.id, latest.title) : selected.get(bot);
        void open(r).then(() => {
          if (!active(r)) return;
          const input = document.querySelector('[data-focus="composer"]');
          if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
        });
        return;
      }
      if (button.dataset.realPhrase && realChat()) { consume(e); sendText(S.bot, button.dataset.realPhrase); return; }
      if (button.hasAttribute('data-today-open') || button.hasAttribute('data-activity-open')) {
        consume(e);
        // 首页那句提醒只有一张待批卡时，直接跳到那张原卡；其余都进今天页的「等你处理」。
        if (button.hasAttribute('data-home-status')) {
          const only = [...cards.values()].filter(c => c.type === 'approval' && c.status === 'pending');
          if (only.length === 1 && pendingTotal <= 1) { void openCard(only[0]).catch(() => {}); return; }
        }
        if (typeof H.openPanel === 'function') H.openPanel('hub-real-today');
        return;
      }
      try { if (r27Click(e, button)) return; } catch {}
      if (button.dataset.realOpen) { consume(e); r31ExplicitAt = Date.now(); S.drawer = null; const r = remoteRecords.get(button.dataset.realOpen); if (r) void open(r); return; }
      if (button.matches?.('[data-act="bot"],[data-r22-assistant]')) {
        const bot = button.dataset.id || button.dataset.r22Assistant;
        if (isBot(bot)) {
          consume(e);
          const origin = routeStamp(), epoch = ++opening;
          // 先确定目标会话，再一次导航；离开原路由或有更新的打开动作就作废。
          void refreshList().catch(() => {}).then(() => {
            if (mode !== 'real' || epoch !== opening || routeStamp() !== origin) return;
            // 这位助理有未读时，落到有未读的那一段（没有就还是最近一段）。
            const item = r31PickUnread(bot, null) || sessions.find(s => s.bot === bot);
            return open(item ? record(bot, item.id, item.title) : selected.get(bot));
          }); return;
        }
      }
    }
    if (mode === 'real' && (!realChat() || button.closest('.capability-card,.shell-activity') || button.dataset.hubView && button.dataset.hubView !== 'chat')) sampleRoute = true;
    if (mode === 'real' && button.matches?.('[data-capability-phrase],[data-activity-source],[data-activity-target],[data-activity-reply-send]')) sampleRoute = true;
    if (button.matches?.('[data-act="bot"],[data-r22-assistant]')) sampleRoute = false;
    if (button.dataset.hubMode) { consume(e); void changeMode(button.dataset.hubMode); return; }
    if (button.hasAttribute('data-real-mode-entry')) { consume(e); openModeSettings(); return; }
    if (mode !== 'real') return;
    if(button.dataset.botProfile && isBot(button.dataset.botProfile)){consume(e);openProfile(button.dataset.botProfile);return;}
    if (button.hasAttribute('data-real-list') || realChat() && button.dataset.act === 'sessions') {
      consume(e);
      if (typeof H.openPanel !== 'function') return;
      const navigation = S.drawer === 'session-menu' && shellHistory();
      // 会话菜单这轮会从对话页拿掉。菜单层还在就替换那一层，不在就直接开服务器会话，都不抛。
      if (navigation) navigation.replace(() => H.openPanel('hub-real-sessions'));
      else H.openPanel('hub-real-sessions');
      // refreshList 会更新仍打开的列表；完成后不能重新打开用户已离开的面板。
      void refreshList().catch(() => H.toast('会话列表未加载，请稍后重试')); return;
    }
    if (button.dataset.realOpen) { consume(e); r31ExplicitAt = Date.now(); const r = remoteRecords.get(button.dataset.realOpen); if (r) void open(r); return; }
    if (button.hasAttribute('data-real-new') || realChat() && button.dataset.act === 'new-session') {
      consume(e); const bot = button.dataset.realNew || S.bot;if(!isEnabled(bot)){H.toast('这个助理已停用，只能查看旧会话');return;} assertBot(bot); const r = record(bot); r.fresh = true; void open(r); return;
    }
    if (button.dataset.realStop) { consume(e); void stop(button.dataset.realStop); return; }
    if (button.dataset.realRetry) {
      consume(e); const r = [...records.values()].find(r => r.messages.some(m => m.parts?.[0]?.data?.id === button.dataset.realRetry)), d = r?.messages.find(m => m.parts?.[0]?.data?.id === button.dataset.realRetry)?.parts[0].data;
      if (r && d) sendText(r.bot, d.prompt, r, d); return;
    }
    if (button.dataset.realReload) { consume(e); const r = records.get(button.dataset.realReload); if (r) void reload(r); return; }
    if (!realChat()) return;
    if (button.closest('.composer-area') && button.dataset.act === 'send') { consume(e); sendInput(); }
    else if (button.dataset.act === 'stop') { consume(e); void stop(S.conversation); }
    else if (['retry-message','continue','branch-session','rename-session','archive-session','pin-session','session-open','create-session','extra-session'].includes(button.dataset.act) || /重新生成|重试回复|失败处继续|从此处分叉/.test(button.getAttribute('aria-label') || button.textContent)) {
      consume(e); H.toast('请在服务器会话列表里选择会话；重试请用回复下方按钮');
    }
  }, true);
  window.addEventListener('input', e => { if (e.target.dataset?.realRevision) approvalDrafts.set(e.target.dataset.realRevision, e.target.value.slice(0, 500)); }, true);
  window.addEventListener('keydown', e => {
    if (realChat() && e.target.matches?.('[data-focus="composer"]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { consume(e); sendInput(); }
  }, true);
  window.addEventListener('click', event => {
    if (mode !== 'real') return;
    const target = event.target;
    if (!target || !target.closest) return;
    const opener = target.closest('[data-r29-group-open]');
    if (opener && r29NewGroupPage()) {
      const id = opener.getAttribute('data-r29-group-open') || '';
      if (!id) return;
      consume(event);
      openGroup(id);
      return;
    }
    if (!S.r29GroupFocus) return;
    const leave = target.closest('[data-act="back"],[data-act="bot"],[data-hub-conversation],' +
      '[data-fixed-task-open],[data-real-open]');
    if (!leave) return;
    S.r29GroupFocus = '';
    S.r29GroupHold = false;
    S.r29GroupMembersOpen = false;
  }, true);
  async function reload(r) {
    const job = jobs.get(r.local);
    if (job && job.admission && !job.admitted) { await job.admission.catch(() => {}); }
    if (job) { job.controller?.abort(); clearTimeout(job.retryTimer); job.wake?.(); clearTimeout(job.paintTimer); jobs.delete(r.local); }
    try { await refreshList(); await history(r, { force: true }); await loadCards(r); if (sessions.find(s => s.id === r.remote)?.running) resume(r); }
    catch (error) { showLoadError(r, error); }
  }
  // 壳的本地会话 id 每次载入都会重建；冷启动用服务器 id 恢复，不能复用旧 local id。
  window.addEventListener('pagehide', () => {
    const r = current();
    write('hub-real-route-v1', JSON.stringify(chatVisible() && r ? { bot: r.bot, remote: r.remote } : null));
  });
  H.on('render', () => { scheduleEnter(); decorate(); });
  H.on('message', () => { if (realChat()) decorate(); });
  H.on('navigate', () => { scheduleEnter(); });
  document.addEventListener('visibilitychange', () => {
    timer(); if (document.hidden || mode !== 'real') return;
    try { void r29Hooks?.refresh(); } catch { /* 回到前台时未读读不到，不挡别的刷新 */ }
    void poll(); const r = current(); if (r?.remote) void reload(r);
    r31ViewingKeep();
  });
  // 主屏幕独立模式从后台回来，有时只发 pageshow / focus，不发 visibilitychange。
  window.addEventListener('pageshow', () => { r31Nudge(0); r31ViewingKeep(); });
  window.addEventListener('focus', () => { r31Nudge(2000); r31ViewingKeep(); });
  window.addEventListener('online', () => { const r = current(); if (mode === 'real' && r?.remote) void reload(r); });
  // 开发期观测与断言：从非助理入口调用 sendText 会在任何网络请求前抛错。
  window.HubReal = Object.freeze({ sendText, markdown, state: () => ({ mode, online, sampleRoute, rosterReady, roster: [...roster.values()].map(b=>({...b})), sessions: sessions.map(s => ({ ...s })), jobs: [...jobs.keys()], turns: turns.map(t => ({ ...t })) }) });
  setInterval(() => { if (mode === 'real') document.querySelectorAll('[data-real-countdown]').forEach(el => { const c = cards.get('approval:' + el.dataset.realCountdown); if (c) el.textContent = remaining(c); }); }, 15000);
  fsInit({H, S, mode: () => mode, extGet, extCall, boardColumns, bucketTokens, bucketCost,
    formatTokenCount, routineView, meetingView, displayName, sortRecent, pending: () => pendingTotal});
  r28a1Init({H, S, roster, api, loadRoster, openProfile, profileDraft, validateName, colorValue,
    rolePack: role => roleInfo(role)?.pack,
    mode: () => mode, limits: () => rosterLimits, redraw});
  decorate(); timer();
  if (mode === 'real') {
    try { void loadModels().then(() => decorate()).catch(() => {}); } catch {}
    try { void refreshGroups().then(() => decorate()).catch(() => {}); } catch {}
    void loadPhrases().then(()=>{connectEvents();scheduleEnter();});
    const detail = S.detail;
    if (isBot(S.bot)) { const r = selected.get(S.bot); bindMessages(r); S.detail = detail; redraw(); }
    const bootRoute = routeStamp(), bootOpening = opening;
    void poll().then(() => {
      const saved = coldRoute; coldRoute = null;
      if (saved && opening === bootOpening && routeStamp() === bootRoute && S.view === 'chat' && !S.drawer && isBot(saved.bot)) {
        const item = sessions.find(s => s.bot === saved.bot && s.id === saved.remote) || sessions.find(s => s.bot === saved.bot);
        void open(item ? record(saved.bot, item.id, item.title) : selected.get(saved.bot));
      } else if (chatVisible() && current()?.messages.length === 0) void enterBot(S.bot);
    });
  }
  r29SyncMode();

  // 原角色格子留给壳的动图引擎。静态头像没有 data-pet-stage，引擎换不上去。
  function r29PaintUnread(host) {
    const pin = host?.querySelector?.('.pin');
    if (!pin) return;
    const id = host.dataset?.botTree || '';
    let count = 0;
    try {
      const bag = r29Hooks?.HubUnread?.counts?.();
      count = Number(bag?.bots?.[id]) || 0;
    } catch { count = 0; }
    const text = count > 99 ? '99+' : count > 0 ? '+' + count : '';
    const badge = pin.querySelector('[data-r29-unread]');
    if (!text) { badge?.remove(); return; }
    const node = badge || H.h('b', { class: 'r29-unread home-assistant-unread' });
    node.textContent = text;
    node.setAttribute('data-r29-unread', text);
    node.setAttribute('aria-label', '未读 ' + text);
    if (!badge) pin.append(node);
  }
  // ===== 主人自己拉群、拉人、请人出组（后端只认主人登录的网页） =====
  async function r30Post(path, body) {
    try {
      const response = await fetch('/bff' + path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(12000)
      });
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      const said = data && data.error && typeof data.error.message === 'string' ? data.error.message : '';
      return { ok: response.ok, status: response.status, data, message: plainLine(said, 80) };
    } catch {
      return { ok: false, status: 0, data: null, message: '' };
    }
  }
  const r30Ids = list => (Array.isArray(list) ? list : [])
    .filter(id => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(id));
  async function r30GroupCreate(input) {
    if (mode !== 'real') return { ok: false, error: '现在连不上，没拉起来' };
    const name = plainLine(input && input.name, 40);
    const members = r30Ids(input && input.members);
    if (!name || members.length < 2) return { ok: false, error: '组名和至少两位助理都要有' };
    const host = input && typeof input.host === 'string' && members.includes(input.host) ? input.host : '';
    const made = await r30Post('/groups/create', { name, members, ...(host ? { host } : {}) });
    const id = made.ok && made.data && made.data.group && made.data.group.id;
    if (typeof id !== 'string' || !id) return { ok: false, error: made.message || '没拉起来，请再试一次' };
    try { await refreshGroups({ force: true }); } catch { /* 列表下一轮再刷新 */ }
    try { openGroup(id); } catch { /* 进组这一步失败，组已经建好，列表里能点开 */ }
    return { ok: true, id };
  }
  async function r30GroupChange(id, path, body, after) {
    if (mode !== 'real' || typeof id !== 'string' || !id) return { ok: false, error: '现在连不上，没改成' };
    const done = await r30Post('/groups/' + encodeURIComponent(id) + path, body);
    if (!done.ok) return { ok: false, error: done.message || '没改成，请再试一次' };
    try { await refreshGroups({ force: true }); } catch { /* 列表下一轮再刷新 */ }
    try { await r29PullGroup(id); } catch { /* 成员面板下一次打开再读 */ }
    try { if (S.r29GroupFocus === id) redraw(); } catch { /* 这轮没画上 */ }
    return { ok: true, ...after(done.data) };
  }
  const r30GroupAdd = (id, ids) => r30GroupChange(id, '/members', { ids: r30Ids(ids) },
    data => ({ added: Array.isArray(data && data.added) ? data.added : [] }));
  const r30GroupRemove = (id, bot) => r30GroupChange(id, '/members/remove', { id: r30Ids([bot])[0] || '' },
    data => ({ removed: data && data.removed || '' }));
  function r29GroupStatus(id) {
    const packed = r29GroupViews.get(id);
    if (packed) return { line: packed.line || '', members: packed.members || [] };
    const group = groups.find(item => item.id === id);
    const members = (group?.members || []).map(member => ({
      id: member.bot, name: member.name || '',
      duty: member.role === 'host' ? '主持' : '暂无', status: '暂无'
    })).filter(member => member.id);
    return { line: '', members };
  }
  function r29GroupsForShell() {
    return groups.map(group => {
      const members = (group.members || []).map(member => member && member.bot)
        .filter(id => typeof id === 'string' && id);
      if (!group.id || !members.length) return null;
      const packed = r29GroupViews.get(group.id);
      return {
        id: group.id, name: group.title || (group.members.map(m => m.name || displayName(m.bot)).join('、') + '的讨论组'), members,
        host: group.host || '',
        title: group.title || '', topic: group.title || '', updatedAt: group.updatedAt || '',
        messages: packed ? r29FeedMessages(group, packed) : (group.lastText ? [{ text: group.lastText }] : [])
      };
    }).filter(Boolean);
  }
  function r29HomeRole(grid, bot) {
    const native = bot.avatar?.kind === 'role' && bot.avatar.role === bot.id &&
      /^[A-Za-z0-9_-]{1,64}$/.test(bot.id);
    if (!native) return { node: H.h('span', { class: 'home-role' }, avatarNode(bot.avatar, bot.id)), fresh: false };
    const live = grid.querySelector?.('[data-bot-tree="' + bot.id + '"] [data-pet-stage="home"]');
    const wrap = H.h('span', { class: 'home-role' });
    if (live && typeof wrap.append === 'function') { wrap.append(live); return { node: wrap, fresh: false }; }
    if (typeof wrap.append === 'function') wrap.append(H.h('span', {
      class: 'chief-pet-stage creature bot-avatar', 'data-pet-stage': 'home',
      'data-pet-assistant': bot.id, 'data-bot-avatar': bot.id, 'data-pet-state': 'idle'
    }));
    return { node: wrap, fresh: true };
  }
  function r29More(spec) {
    if (typeof H.registerMoreItem !== 'function') return;
    try { H.registerMoreItem(spec); } catch { /* 更多里的这一行这轮可能已经不在 */ }
  }
  function r29UpTo(conversation) {
    let found = null;
    for (const item of records.values()) {
      if (item.remote === conversation || item.local === conversation) found = item;
    }
    if (!found) return 0;
    // 只认后端历史里真有的消息（带 serverId）。确认卡、工具行的序号后端不认，带上去会被 400。
    let max = 0; let any = false;
    for (const message of found.messages || []) {
      if (!message || !message.serverId) continue;
      if (Number.isSafeInteger(message.seq) && message.seq > max) { max = message.seq; any = true; }
    }
    return any ? max : 0;
  }
  function r29AtBottom() {
    const thread = document.querySelector('.thread');
    if (!thread) return false;
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 80;
  }
  // 原来是「滚到底才算读」。主人的规矩是点开就算看过，所以这里不再看滚动位置。
  function r29Seen(recordItem) {
    if (document.hidden || mode !== 'real' || !r29Hooks || !recordItem?.remote) return;
    // 点开时已经标过；这里只补读完历史这段时间里新来的。
    if (Number(r29Hooks.HubUnread.counts().conversations[recordItem.remote]) > 0) r31SeenNow(recordItem.remote);
  }
  function r31SeenNow(remote) {
    if (document.hidden || mode !== 'real' || !r29Hooks || !remote) return;
    try { r29Hooks.HubUnread.markRead(remote, { latest: true }); } catch { /* 已读标不上，下一次再标 */ }
  }
  // 看着的这一段又来了新回复：读到数字就补标；同一段连标 3 次还有数字就停 30 秒，免得停不下来。
  var r31Guard = new Map();
  function r31Allow(id, count) {
    if (!(count > 0)) { r31Guard.delete(id); return false; }
    const now = Date.now(); const g = r31Guard.get(id) || { n: 0, at: 0 };
    if (now - g.at >= 30000) g.n = 0;
    if (g.n >= 3 || now - g.at < 1500) return false;
    g.n += 1; g.at = now; r31Guard.set(id, g);
    return true;
  }
  function r31ViewingKeep() {
    if (mode !== 'real' || !r29Hooks || document.hidden || !chatVisible()) return;
    const bag = r29Hooks.HubUnread.counts();
    if (S.r29GroupFocus) {
      const gid = S.r29GroupFocus;
      if (r31Allow(gid, Number(bag.groups[gid]) || 0)) r29Hooks.HubUnread.markRead(gid, { latest: true });
      return;
    }
    const r = current();
    if (r?.remote && r31Allow(r.remote, Number(bag.conversations[r.remote]) || 0)) {
      r29Hooks.HubUnread.markRead(r.remote, { latest: true });
    }
  }
  // 点助理头像：这位助理名下有未读、而点进去的那段没有，就落到有未读的那一段。
  function r31PickUnread(bot, here) {
    if (!r29Hooks) return null;
    const bag = r29Hooks.HubUnread.counts();
    if (!(Number(bag.bots[bot]) > 0)) return null;
    if (here?.remote && Number(bag.conversations[here.remote]) > 0) return null;
    return sessions.find(s => s.bot === bot && Number(bag.conversations[s.id]) > 0) || null;
  }
  // 这位助理名下，除了正在看的这一段，还有别的段有未读：对话顶上放一条入口，点了就进有未读的那一段。
  function r31OtherUnread() {
    if (!r29Hooks || !realChat() || S.r29GroupFocus) return null;
    const bag = r29Hooks.HubUnread.counts();
    const here = current();
    const total = Number(bag.bots[S.bot]) || 0;
    const mine = here?.remote ? Number(bag.conversations[here.remote]) || 0 : 0;
    const other = total - mine;
    if (other <= 0) return null;
    const pick = sessions.find(s => s.bot === S.bot && s.id !== here?.remote && Number(bag.conversations[s.id]) > 0);
    return pick ? { n: other, id: pick.id, title: pick.title || '新会话' } : null;
  }
  function r31PaintMore() {
    const thread = document.querySelector('.chatview .thread');
    const host = thread?.parentElement;
    if (!host) return;
    const old = [...host.children].find(n => n.classList?.contains('r31-more-unread'));
    const found = r31OtherUnread();
    if (!found) { old?.remove(); return; }
    const text = '另有 ' + found.n + ' 条未读，点这里看';
    if (old && old.dataset.r31MoreUnread === found.id && old.textContent === text) return;
    old?.remove();
    const bar = H.h('button', { type: 'button', class: 'r31-more-unread', 'data-r31-more-unread': found.id }, text);
    bar.addEventListener('click', event => {
      consume(event);
      r31ExplicitAt = Date.now();
      const target = sessions.find(s => s.id === found.id);
      if (target) void open(record(target.bot, target.id, target.title || '新会话'));
    });
    thread.before(bar);
  }
  var r31MoreCss = document.createElement('style');
  r31MoreCss.textContent = '.r31-more-unread{display:block;width:100%;min-height:44px;margin:0;padding:8px 16px;' +
    'border:0;border-bottom:1px solid var(--line);background:var(--elev);color:var(--ink);font:inherit;' +
    'font-size:14px;text-align:center;cursor:pointer}';
  document.head.append(r31MoreCss);
  // 点助理头像进对话（从「不在对话」变成「在对话」，且不是点最近列表里某一行）时，落到有未读的那一段。
  var r31ChatKey = '';
  var r31ExplicitAt = 0;
  var r31OpenedAt = 0;
  function r31Landing() {
    const key = mode === 'real' && r29Hooks && realChat() && chatVisible() && !S.r29GroupFocus ? S.bot : '';
    if (key === r31ChatKey) return;
    r31ChatKey = key;
    if (!key) return;
    setTimeout(() => {
      if (mode !== 'real' || !chatVisible() || S.bot !== key || S.r29GroupFocus) return;
      if (Date.now() - r31ExplicitAt < 1500 || Date.now() - r31OpenedAt < 800) return;
      const here = current();
      const pick = r31PickUnread(key, here);
      if (pick && pick.id !== here?.remote) void open(record(key, pick.id, pick.title || '新会话'));
      else if (here?.remote) r31SeenNow(here.remote);
    }, 0);
  }
  var r31NudgeAt = 0;
  function r31Nudge(gap) {
    if (mode !== 'real' || !r29Hooks || document.hidden) return;
    const now = Date.now();
    if (now - r31NudgeAt < gap) return;
    r31NudgeAt = now;
    try { void r29Hooks.refresh(); } catch { /* 这次没刷上，下次再刷 */ }
  }
  function r29OnScroll(event) {
    if (document.hidden || mode !== 'real' || !r29Hooks) return;
    const node = event.target;
    const thread = node?.closest?.('.thread') || (node?.classList?.contains('thread') ? node : null);
    if (!thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight > 80) return;
    const recordItem = current();
    if (recordItem?.remote) r29Hooks.HubUnread.markRead(recordItem.remote);
  }
  async function r29Request(path, options = {}) {
    return fetch('/bff' + path, { credentials: 'same-origin', cache: 'no-store', ...options });
  }
  const r29VoiceLanded = new Map();
  function r29VoiceRemember(id) {
    if (!id) return;
    if (r29VoiceLanded.has(id)) r29VoiceLanded.delete(id);
    r29VoiceLanded.set(id, 1);
    while (r29VoiceLanded.size > 80) {
      r29VoiceLanded.delete(r29VoiceLanded.keys().next().value);
    }
  }
  function r29VoiceRecord(bot, id) {
    if (typeof id !== 'string' || !id || typeof bot !== 'string' || !bot) return null;
    const direct = records.get(id);
    if (direct) return direct.bot === bot ? direct : null;
    const remote = remoteRecords.get(id);
    if (remote) return remote.bot === bot ? remote : null;
    for (const item of records.values()) {
      if (item && item.bot === bot && (item.local === id || item.remote === id)) return item;
    }
    return null;
  }
  function r29VoiceSame(bot, id) {
    const cur = current();
    if (!cur || cur.bot !== bot || typeof id !== 'string' || !id) return null;
    if (cur.local === id || cur.remote === id) return cur;
    return null;
  }
  // 录音投递：先沿用现有建会话，再把转写只送进开口时那一段。
  async function r29BindVoice(bot, info) {
    const shellId = info && typeof info.conversation === 'string' ? info.conversation : '';
    if (!shellId || !bot) return { conversation: shellId, remote: shellId, local: shellId };
    const r = r29VoiceRecord(bot, shellId) || r29VoiceSame(bot, shellId);
    if (!r) return { conversation: shellId, remote: shellId, local: shellId };
    if (!r.remote) {
      assertBot(bot);
      const created = await createRemote(r, bot);
      if (!created || !created.id || created.bot !== bot) throw new Error('会话创建回执不匹配');
      r.remote = created.id;
      r.ready = true;
      remoteRecords.set(r.remote, r);
    }
    return { conversation: r.remote, remote: r.remote, local: r.local };
  }
  function r29PlaceVoice(bot, text, info) {
    const requestId = info && typeof info.requestId === 'string' ? info.requestId : '';
    const shellId = info && typeof info.conversation === 'string' ? info.conversation : '';
    // 键只含助理号和请求号。不加会话号：同一助理换会话仍是同一次开口。
    const voiceKey = requestId ? String(bot ?? '') + '\n' + requestId : '';
    if (voiceKey && r29VoiceLanded.has(voiceKey)) return;
    const remoteId = info && typeof info.remote === 'string' ? info.remote : '';
    const r = r29VoiceRecord(bot, shellId) || r29VoiceRecord(bot, remoteId) ||
      r29VoiceSame(bot, shellId) || r29VoiceSame(bot, remoteId);
    if (!r || r.bot !== bot) return;
    if (voiceKey) r29VoiceRemember(voiceKey);
    sendText(bot, text, r);
  }
  // 看板接口。读全部单、可派给谁，以及主人在界面上挪列、换人、改标题说明、新建。
  function r30BoardHook() {
    const call = async (path, body) => {
      const response = await r29Request('/board' + path, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let data = null;
      try { data = await response.json(); } catch { /* 没有回执就当没成 */ }
      if (!response.ok || !data) throw new Error('board ' + response.status);
      return data;
    };
    const enc = id => encodeURIComponent(String(id));
    return {
      tickets: () => call('/tickets'),
      people: () => call('/people'),
      move: (id, body) => call('/tickets/' + enc(id) + '/move', body),
      assign: (id, body) => call('/tickets/' + enc(id) + '/assign', body),
      edit: (id, body) => call('/tickets/' + enc(id) + '/edit', body),
      remove: id => call('/tickets/' + enc(id) + '/delete', {}),
      // 接力卡上主人的动作（放行、退回重做、回答卡住的问题、改后几棒）。
      relay: (id, body) => call('/tickets/' + enc(id) + '/relay', body),
      // 主人回答首席转来的问题（开放认领的卡回到「谁有空谁接」）。
      answer: (id, body) => call('/tickets/' + enc(id) + '/answer', body),
      // 首席安排（交给首席、就这么办、换个人、先不做）与卡片定时（设、取消、暂停、恢复）。
      arrange: (id, body) => call('/tickets/' + enc(id) + '/arrange', body),
      schedule: (id, body) => call('/tickets/' + enc(id) + '/schedule', body),
      create: (_id, body) => call('/tickets/new', body)
    };
  }
  var r31TapOn = false;
  function r29SyncMode() {
    if (mode !== 'real') {
      r29Hooks = null;
      S.r29GroupFocus = '';
      S.r29GroupHold = false;
      delete window.HubUnread; delete window.HubVoiceSend;
      delete window.HubUpload; delete window.HubSettings;
      delete window.HubGroups; delete window.HubBoard;
      return;
    }
    if (!r29ScrollOn) {
      r29ScrollOn = true;
      document.addEventListener('scroll', r29OnScroll, true);
    }
    if (r29Hooks) return;
    r29Hooks = r29CreateHooks({
      request: r29Request,
      deliver: (bot, text) => sendText(bot, text),
      bindVoice: r29BindVoice,
      placeVoice: r29PlaceVoice,
      busy: bot => r29HoldSend || [...jobs.values()].some(job => job.r.bot === bot),
      upTo: r29UpTo,
      // 本地占位会话（有记录、还没有服务器会话号）后端没有，不发已读。其余照发，由后端判断。
      known(asked, id) {
        if (id !== asked) return true;
        for (const item of records.values()) {
          if (item.remote === asked) return true;
          if (item.local === asked && !item.remote) return false;
        }
        // 壳自己编的会话号（如首页载入时的助理占位号）不是服务器上的会话或讨论组，发过去只会 404。
        // 只有未读表里本来就有的号才发。
        const bag = r29Hooks?.HubUnread?.counts();
        if (!bag) return true;
        return Object.prototype.hasOwnProperty.call(bag.conversations, asked) ||
          Object.prototype.hasOwnProperty.call(bag.groups, asked);
      },
      remote(id) {
        for (const item of records.values()) {
          if (item.local === id && item.remote) return item.remote;
        }
        return '';
      },
      owner(id) {
        for (const item of records.values()) {
          if (item.remote === id || item.local === id) return item.bot;
        }
        if (typeof id === 'string' && id.endsWith('-013') && roster.has(id.slice(0, -4))) return id.slice(0, -4);
        return '';
      }
    });
    window.HubUnread = r29Hooks.HubUnread;
    try { r29Hooks.HubUnread.subscribe(() => { try { r31ViewingKeep(); } catch { /* 补标失败下次再补 */ } }); } catch { /* 订阅不上就靠回前台时补标 */ }
    if (!r31TapOn) { r31TapOn = true; H.on('render', r31Landing); }
    window.HubVoiceSend = r29Hooks.HubVoiceSend;
    window.HubUpload = r29Hooks.HubUpload;
    window.HubSettings = r29Hooks.HubSettings;
    window.HubGroups = {
      list: () => r29GroupsForShell(), status: id => r29GroupStatus(id),
      create: input => r30GroupCreate(input), addMembers: (id, ids) => r30GroupAdd(id, ids),
      removeMember: (id, bot) => r30GroupRemove(id, bot)
    };
    window.HubBoard = r30BoardHook();
    window.HubOpeningLines = openingDefaults;
    if (!document.hidden) { try { void r29Hooks.refresh(); } catch { /* 首屏未读读不到就保持空 */ } }
  }
})();
// ==== r28 接新壳 A1 开始 ====
var r28a1Context;
var r28a1OriginalBots;
var r28a1First;
var r28a1Uploads = new Map();
var r28a1Loading = new Set();
var r28a1BotPool = new Map();

function r28a1NewShell() {
  return typeof window !== 'undefined' && !!window.AssistantProfiles &&
    typeof window.Hub?.registerFeatureSection === 'function';
}

// 将后端资料转换成壳可显示的资料，不修改输入。
function r28a1Profile(bot, options = {}) {
  const colors = {yellow:'#f0d771',green:'#85bda5',blue:'#9dbddd',purple:'#b7a5dc',pink:'#dfa8bc',
    orange:'#e4b083',red:'#d98f93',gray:'#aeb3bd',mint:'#96cbb4',peach:'#edb6a0'};
  const hex = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : colors[value] || '#f0d771';
  const shapes = {circle:'soft-6',round:'soft-6',star:'soft-2',cloud:'soft-1'};
  const fallback = {kind:'shape',shapeId:'soft-1',color:hex(bot.avatar?.color)};
  const catalog = options.catalog || [];
  const a = bot.avatar || {};
  let avatar = fallback;
  const packId = options.rolePack?.(a.role) || a.role;
  if (a.kind === 'role' && catalog.some(p => p.kind === 'pack' && p.id === packId)) {
    avatar = {kind:'pack',id:packId};
  }
  if (a.kind === 'shape') avatar = {...fallback,shapeId:shapes[a.shape] || 'soft-1'};
  if (a.kind === 'upload' && options.uploads?.get(a.file)) {
    avatar = {kind:'upload',dataURL:options.uploads.get(a.file)};
  }
  return {name:bot.name,duty:bot.duty || '',notDuty:bot.notDuty || '',
    description:'管：' + (bot.duty || '') + '。不管：' + (bot.notDuty || ''),
    enabled:bot.status === 'active',homeLabel:bot.duty || '',quickReplies:[...(bot.phrases || [])],
    avatar,avatarExplicit:true,color:hex(options.color || bot.nameColor)};
}

// 把单个壳草稿的差异翻译成后端字段。
function r28a1Patch(change) {
  const before = change.before || {};
  const after = change.after || {};
  const changed = key => JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  const patch = {};
  if (changed('avatar') || changed('color')) throw Error('请在「更多 → 助理资料」里改形象和名牌色');
  if (changed('name')) patch.name = after.name;
  if (changed('duty')) patch.duty = after.duty;
  if (changed('quickReplies')) patch.phrases = after.quickReplies;
  if (changed('enabled')) patch.status = after.enabled ? 'active' : 'disabled';
  if (changed('description')) {
    const parts = String(after.description || '').split(/不管[：:]/);
    if (parts.length !== 2 || !/^\s*管[：:]/.test(parts[0])) throw Error('请按「管：…。不管：…」写');
    patch.duty = parts[0].replace(/^\s*管[：:]\s*/, '').replace(/[。\s]+$/, '');
    patch.notDuty = parts[1].trim();
  }
  return patch;
}

function r28a1RestoreBots() {
  if (!r28a1NewShell() || !r28a1OriginalBots || !r28a1Context) return;
  r28a1Context.S.bots.splice(0, r28a1Context.S.bots.length, ...r28a1OriginalBots);
}

function r28a1PrepareRoster(bots) {
  const c = r28a1Context;
  if (!c || !r28a1NewShell() || c.mode() !== 'real') return;
  for (const bot of bots) {
    const prior = r28a1BotPool.get(bot.id);
    if (prior && !c.S.bots.some(item => item.id === bot.id)) c.S.bots.push(prior);
  }
}

function r28a1MapRoster(bots) {
  const c = r28a1Context;
  if (!c || !r28a1NewShell() || c.mode() !== 'real') return;
  const catalog = window.AssistantProfiles.catalog();
  const members = [];
  for (const bot of bots) {
    const shell = c.S.bots.find(item => item.id === bot.id);
    if (!shell) continue;
    const color = c.colorValue(bot.nameColor);
    Object.assign(shell, r28a1Profile(bot, {catalog,uploads:r28a1Uploads,color,rolePack:c.rolePack}));
    const first = r28a1First?.get(bot.id);
    if (first?.avatar?.kind === 'pack' && shell.avatar.kind === 'pack' && shell.avatar.id === first.avatar.id) {
      shell.avatar = first.avatar;
      shell.avatarExplicit = first.avatarExplicit;
    }
    shell.role = bot.role === 'chief' ? 'chief' : 'assistant';
    shell.parent = null;
    shell.steward = false;
    members.push(shell);
    r28a1BotPool.set(bot.id, shell);
    if (bot.avatar?.kind === 'upload') r28a1FetchAvatar(bot.avatar.file);
  }
  c.S.bots.splice(0, c.S.bots.length, ...members);
}

async function r28a1FetchAvatar(file) {
  if (!file || r28a1Uploads.has(file) || r28a1Loading.has(file)) return;
  r28a1Loading.add(file);
  try {
    const response = await fetch('/bff/avatars/' + encodeURIComponent(file), {credentials:'same-origin'});
    if (!response.ok) throw Error('头像不可用');
    const blob = await response.blob();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) throw Error('头像格式不支持');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    r28a1Uploads.set(file, data);
    const c = r28a1Context;
    if (c.mode() === 'real') {
      r28a1MapRoster([...c.roster.values()]);
      c.H.reading.preserve(c.redraw, {reason:'real-avatar'});
    }
  } catch {
    r28a1Uploads.set(file, '');
  } finally {
    r28a1Loading.delete(file);
  }
}

function r28a1Init(context) {
  r28a1Context = context;
  if (!r28a1NewShell()) return;
  const {H, S} = context;
  r28a1OriginalBots = S.bots.slice();
  r28a1First = new Map();
  for (const b of S.bots) r28a1First.set(b.id, {avatar: b.avatar, avatarExplicit: b.avatarExplicit});
  // 壳自带动图时，只关掉叠上去的呼吸层。不调用 HubPetMotion.hold，也不碰角色媒体开关。
  if (window.HubPetMotion || document.querySelector('.r25-motion-body')) {
    window.HubLivelinessConfig = {...window.HubLivelinessConfig,enabled:false};
  }
  const fixedTasks = H.fixedTasks;
  H.fixedTasks = function (...args) {
    if (context.mode() === 'real' && S.mode === 'assistant-profile') return [];
    return fixedTasks.apply(this, args);
  };
  const inFlight = new Set();
  document.addEventListener('click', event => {
    if (context.mode() !== 'real') return;
    const target = event.target.closest('[data-assistant-confirm],[data-avatar-library],[data-profile-color]');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.hasAttribute('data-assistant-confirm')) {
      const drafts = window.AssistantProfiles?.drafts;
      if (!drafts || typeof drafts.get !== 'function') return;
      const draft = drafts.get(target.dataset.assistantConfirm);
      if (draft && draft.status === 'pending' && !inFlight.has(draft.id)) {
        inFlight.add(draft.id);
        void r28a1Confirm(draft, context).finally(() => inFlight.delete(draft.id));
      }
      return;
    }
    const page = target.closest('[data-assistant-profile-page]');
    const id = target.dataset.avatarLibrary || page?.dataset.assistantProfilePage;
    const bot = context.roster.get(id);
    if (!bot) return;
    const field = target.hasAttribute('data-avatar-library') ? 'avatar' : 'nameColor';
    const draft = context.profileDraft(bot);
    Object.assign(draft, {field,value:bot[field],base:JSON.parse(JSON.stringify(bot)),preview:false,
      tab:'role',file:null,fileURL:'',error:''});
    context.openProfile(id);
  }, true);
}

async function r28a1Confirm(draft, c) {
  const cancel = text => {
    draft.status = 'cancelled';
    window.render();
    c.H.toast(text);
  };
  if (draft.create) return cancel('新建助理请对首席说，由首席发起确认卡');
  if (draft.changes.length !== 1) return cancel('请在「更多 → 助理资料」里改形象和名牌色');
  const change = draft.changes[0];
  let patch;
  try {
    patch = r28a1Patch(change);
  } catch (error) {
    if (error.message.startsWith('请在')) return cancel(error.message);
    c.H.toast(error.message);
    return;
  }
  if (patch.name !== undefined) {
    const message = c.validateName(patch.name, [...c.roster.values()], change.id, c.limits().nameMax);
    if (message) return c.H.toast('没改成：' + message);
  }
  if (!Object.keys(patch).length) return c.H.toast('没改成：没有可保存的改动');
  try {
    await c.api('/bots/' + encodeURIComponent(change.id), {method:'PATCH',body:JSON.stringify(patch)});
    await c.loadRoster();
    const saved = c.roster.get(change.id);
    if (!saved || Object.keys(patch).some(key => JSON.stringify(saved[key]) !== JSON.stringify(patch[key]))) {
      throw Error('保存结果未匹配，请刷新名册核对');
    }
    draft.status = 'confirmed';
    draft.undoUntil = 0;
    c.S.drawer = null;
    window.render();
    c.H.toast('已改 · ' + Array.from(saved.name).slice(0, 20).join(''));
  } catch (error) {
    const reason = error.status === 400 ? '资料不符合要求' : error.status === 403 ? '没有权限' :
      '未能确认保存结果，请刷新名册核对';
    c.H.toast('没改成：' + reason);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  // 供离线测试验证资料映射。
  module.exports.r28a1Profile = r28a1Profile;
  // 供离线测试验证后端字段转换。
  module.exports.r28a1Patch = r28a1Patch;
  // 供离线测试验证确认流程。
  module.exports.r28a1Confirm = r28a1Confirm;
  module.exports.r28a1Init = r28a1Init;
}
// ==== r28 接新壳 A1 结束 ====
// ==== r28 接新壳 A2 开始 ====
var fsContext;
var fsSnapshot;

function fsSync() {
  const c = fsContext;
  if (!c) return;
  const real = c.mode() === 'real';
  let style = document.querySelector('style[data-fs-real]');
  if (real && !style) {
    style = document.createElement('style');
    style.setAttribute('data-fs-real', '');
    style.textContent = [
      '.r25-feature-sections [data-feature-section="current"] > p',
      '.r25-feature-sections [data-feature-section="records"] > p',
      '.r25-feature-sections [data-feature-section="records"] > button',
      '.r25-feature-sections .r25-feature-record',
      '.r25-feature-sections [data-feature-contribution]:not([data-feature-contribution^="hub-real"])',
      '.r25-feature-sections [data-feature-capability]',
      '.r25-feature-sections [data-feature-memory]',
      '.r25-feature-sections [data-feature-detail]',
      '[data-pending-input-open]',
      '[data-tour-start]',
      '[data-r22-template-open]'
    ].join(',') + '{display:none!important}';
    document.head.append(style);
  }
  if (!real && style) style.remove();
  if (real && !fsSnapshot) {
    fsSnapshot = {
      fixed: c.S.fixedTasks.slice(),
      pending: c.S.pendingInputs.slice(),
      activities: []
    };
    c.S.fixedTasks.splice(0);
    c.S.pendingInputs.splice(0);
  }
  if (real && fsSnapshot) {
    // 壳各模块在启动时注册的活动（治理、账本阈值样例等）都是演示；真实活动由适配层注册，id 以 hub-real- 开头。
    const demo = c.S.activities.filter(a => !String(a.id).startsWith('hub-real-'));
    if (demo.length) {
      fsSnapshot.activities.push(...demo);
      c.S.activities.splice(0, c.S.activities.length,
        ...c.S.activities.filter(a => String(a.id).startsWith('hub-real-')));
    }
  }
  if (!real) document.querySelectorAll?.('[data-fs-hidden]')?.forEach(n => {
    n.style.display = '';
    n.removeAttribute('data-fs-hidden');
  });
  if (!real && fsSnapshot) {
    c.S.fixedTasks.splice(0, c.S.fixedTasks.length, ...fsSnapshot.fixed);
    c.S.pendingInputs.splice(0, 0, ...fsSnapshot.pending);
    c.S.activities.splice(0, 0, ...fsSnapshot.activities);
    fsSnapshot = null;
  }
}

// 真实模式下，抽屉里标着「演示」的按钮与本机「新建固定任务」不属于真实功能，运行时隐藏（切回演示恢复）。
function fsHideDemoButtons(c) {
  if (c.mode() !== 'real') return;
  document.querySelectorAll?.('.drawer button')?.forEach(button => {
    const text = (button.textContent || '').trim();
    if (!/演示/.test(text) && text !== '新建固定任务') return;
    // 适配层自己的按钮（含「切换演示」）不隐藏。
    if (button.hasAttribute('data-hub-mode') || /(^|\s)hub-real/.test(button.className)) return;
    if ([...button.attributes].some(attr => attr.name.startsWith('data-real'))) return;
    button.style.display = 'none';
    button.setAttribute('data-fs-hidden', '');
  });
}

// 抽屉内容由壳随时重画，用一个合并到下一帧的观察器补隐藏。
function fsWatchDemoButtons(c) {
  if (typeof MutationObserver !== 'function' || !document.body) return;
  let queued = 0;
  new MutationObserver(() => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      fsHideDemoButtons(c);
    });
  }).observe(document.body, {childList: true, subtree: true});
}

function fsInit(c) {
  const featureShell = typeof c.H.registerFeatureSection === 'function' &&
    typeof c.H.openFeature === 'function' && typeof c.H.featureOwner === 'function';
  if (!featureShell) return;
  fsContext = c;
  fsSync();
  fsWatchDemoButtons(c);
  for (const id of ['board', 'ledger', 'schedule', 'permissions', 'memory', 'devices', 'connections']) {
    for (const kind of ['now', 'log']) {
      c.H.registerFeatureSection(id, {
        id: 'hub-real-' + id + '-' + kind,
        kind,
        render(target) {
          target.hidden = c.mode() !== 'real';
          if (target.hidden) return;
          target.replaceChildren(c.H.h('p', {role: 'status'}, '正在读取…'));
          void fsRender(c, id, kind, target);
        }
      });
    }
  }
  c.H.registerFeatureSection('memory', {
    id: 'hub-real-memory-phrases',
    kind: 'phrases',
    render(target, ctx) {
      target.hidden = c.mode() !== 'real';
      if (target.hidden) return;
      const phrases = typeof FEATURE_SEEDS === 'object' ? FEATURE_SEEDS.memory?.phrases : [];
      for (const phrase of phrases || []) {
        target.append(c.H.h('button', {
          type: 'button', class: 'ghostbtn', 'data-feature-phrase': phrase, disabled: !ctx.ownerAssistant
        }, phrase));
      }
    }
  });
}

async function fsRender(c, id, kind, target) {
  // 让出一个微任务：壳先同步把 target 挂进页面，再填内容（无网络的几页也走这里）。
  await Promise.resolve();
  const h = c.H.h;
  const lines = [];
  const buttons = [];
  const get = path => c.extGet('fs', path, {force: true, ttl: 0});
  const addButton = (label, action) => buttons.push(h('button', {
    type: 'button', class: 'ghostbtn', onClick: action
  }, label));
  try {
    if (['memory', 'devices', 'connections'].includes(id)) {
      lines.push('暂无（真实版还没有接这一项）');
    } else if (id === 'board') {
      const result = await get('/board/tickets');
      if (!result.ok || !Array.isArray(result.data?.tickets)) throw Error('empty');
      const columns = c.boardColumns(result.data.tickets);
      if (kind === 'now') {
        lines.push(columns.map(col => col.label + ' ' + col.count + ' 张').join(' · '));
        addButton('打开看板', () => c.H.navigate({view: 'kanban'}));
      } else {
        const tickets = columns.flatMap(col => col.tickets.map(ticket => ({ticket, label: col.label})));
        tickets.sort((a, b) => c.sortRecent(a.ticket, b.ticket));
        for (const row of tickets.slice(0, 5)) lines.push((row.ticket.title || '未命名') + ' · ' + row.label);
      }
    } else if (id === 'ledger') {
      const result = await get(kind === 'now' ? '/ledger/today' : '/ledger');
      const bucket = result.data?.total;
      if (!result.ok || !bucket || typeof bucket !== 'object' || Array.isArray(bucket)) throw Error('empty');
      const cost = c.bucketCost(bucket).join(' / ').replace('费用未知', '待计价');
      lines.push((kind === 'now' ? '今天' : '累计') + ' · ' + (bucket.calls ?? '未知') + ' 次调用 · ' +
        c.formatTokenCount(c.bucketTokens(bucket).total) + ' token · ' + (cost || '待计价'));
      if (kind === 'now') addButton('打开完整账本', () => c.H.navigate({view: 'ledger'}));
    } else if (id === 'schedule') {
      if (kind === 'now') {
        const [routines, status] = await Promise.all([c.extCall('/routines'), c.extCall('/meetings/status')]);
        const view = routines.status === 200 ? c.routineView(routines.data, c.displayName) : null;
        const meeting = status.status === 200 ? c.meetingView(status.data, []) : null;
        if (!view || !view.items.length) lines.push('固定任务：暂无');
        else for (const item of view.items) {
          lines.push(item.title + ' · ' + (item.when || '周期未设') + ' · ' + item.state);
        }
        lines.push(meeting ? '计划时间：晨会 ' + (meeting.times.morning || '暂无') + ' · 晚会 ' +
          (meeting.times.evening || '暂无') + '；上次时间：暂无' : '晨会晚会：暂无');
        addButton('固定任务', () => { if (typeof c.H.openPanel === 'function') c.H.openPanel('hub-real-routines'); });
        addButton('晨会晚会纪要', () => { if (typeof c.H.openPanel === 'function') c.H.openPanel('hub-real-meetings'); });
      } else {
        const result = await c.extCall('/meetings/today');
        if (result.status !== 200 || !Array.isArray(result.data?.minutes)) throw Error('empty');
        const rows = result.data.minutes.filter(row => row && ['morning', 'evening'].includes(row.type));
        const row = rows.at(-1);
        if (row) lines.push((row.title || (row.type === 'morning' ? '晨会纪要' : '晚会纪要')) + ' · ' +
          (row.date || result.data.date || '日期暂无'));
      }
    } else if (id === 'permissions') {
      const result = await get('/grants');
      if (!result.ok || !Array.isArray(result.data?.grants)) throw Error('empty');
      const grants = result.data.grants;
      if (kind === 'now') {
        lines.push('命令授权 ' + grants.length + ' 条 · 待批 ' + c.pending() + ' 项');
        addButton('打开权限', () => { if (typeof c.H.openPanel === 'function') c.H.openPanel('hub-real-permissions'); });
      } else {
        for (const grant of grants.slice(-5).reverse()) {
          if (!grant || typeof grant !== 'object') continue;
          lines.push(c.displayName(grant.bot) + ' · ' + (grant.program || '程序未知') + ' · ' +
            (grant.until || grant.expiresAt || grant.expires || '到期日暂无'));
        }
      }
    }
    if (!lines.length) lines.push('暂无');
  } catch {
    lines.splice(0, lines.length, '暂无');
  }
  if (c.mode() !== 'real' || target.isConnected === false) return;
  target.replaceChildren(...lines.map(line => h('p', {}, String(line))), ...buttons);
}

if (typeof module !== 'undefined' && module.exports) {
  // 供离线测试验证新壳初始化。
  module.exports.fsInit = fsInit;
  // 供离线测试验证真实功能页。
  module.exports.fsRender = fsRender;
  // 供离线测试验证模式切换。
  module.exports.fsSync = fsSync;
  module.exports.r29CreateHooks = r29CreateHooks;
  module.exports.r29FileLine = r29FileLine;
}

function r29Clip(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, max);
}

function r29FileLine(name, path) {
  const safeName = r29Clip(name, 80);
  const safePath = r29Clip(path, 240);
  if (!safeName || !safePath) return '';
  return '（附了文件：' + safeName + '，在 ' + safePath + '）';
}

function r29SkipKey(id) {
  return !id || id === '__proto__' || id === 'constructor' || id === 'prototype';
}

function r29Box(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of Object.keys(value).slice(0, 2000)) {
    const id = r29Clip(key, 80);
    const count = value[key];
    if (r29SkipKey(id) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) continue;
    out[id] = count;
  }
  return out;
}

function r29Bots(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of Object.keys(value).slice(0, 200)) {
    const id = r29Clip(key, 80);
    const row = value[key];
    if (r29SkipKey(id) || !row || typeof row !== 'object' || Array.isArray(row)) continue;
    const item = {};
    if (typeof row.model === 'string') item.model = r29Clip(row.model, 80);
    if (typeof row.effort === 'string') item.effort = r29Clip(row.effort, 40);
    out[id] = item;
  }
  return out;
}

function r29Models(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).filter(item => typeof item === 'string' ||
    (item && typeof item === 'object' && !Array.isArray(item)));
}

function r29EmptyUnread() {
  return { conversations: {}, bots: {}, groups: {} };
}

function r29CreateHooks(deps) {
  const notes = new Map();
  const listeners = new Set();
  let counts = r29EmptyUnread();
  let unreadMissing = false;
  const readSent = new Map();
  let settingsMissing = false;
  let modelsLocked = false;
  let chain = Promise.resolve();
  const track = task => { chain = chain.then(() => task, () => task); return task; };
  const queued = bot => notes.get(bot) || [];
  function compose(bot, text) {
    const extra = queued(bot).join('');
    notes.delete(bot);
    const body = String(text ?? '');
    if (!extra) return body;
    if (!body.trim()) return extra;
    return body.replace(/\s+$/u, '') + extra;
  }
  async function readJson(response) {
    try { return await response.json(); } catch { return null; }
  }
  async function call(path, options) {
    const response = await deps.request(path, options);
    return { status: response.status, ok: response.ok, data: await readJson(response) };
  }
  function snapshot() {
    return {
      conversations: { ...counts.conversations },
      bots: { ...counts.bots },
      groups: { ...counts.groups }
    };
  }
  function notify() {
    const view = snapshot();
    for (const fn of [...listeners]) { try { fn(view); } catch { /* 一个订阅者出错不影响别的 */ } }
  }
  // 本地已标已读、后端还没确认（或确认前就发出的读取）时，读回来的旧数字不许写回去。
  const quiet = new Map();
  const READ_RETRY = [1500, 4000, 10000, 30000, 60000];
  const stuckReads = new Set();
  // 重试用完仍没成的已读请求，下一次读到未读数时再补一轮。
  function retryStuck() {
    for (const again of [...stuckReads]) { try { if (again()) stuckReads.delete(again); } catch { /* 下次再试 */ } }
  }
  let refreshSeq = 0;
  let refreshApplied = 0;
  const hasKey = (box, key) => Object.prototype.hasOwnProperty.call(box, key);
  function applyQuiet(fresh, startedAt) {
    for (const [id, q] of [...quiet]) {
      // 后端确认之后才发起的读取，数字是真的；这条记号用完了。
      if (q.settled && startedAt > q.settled) { quiet.delete(id); continue; }
      const box = hasKey(fresh.conversations, id) ? fresh.conversations : hasKey(fresh.groups, id) ? fresh.groups : null;
      if (!box) continue;
      const was = Number(box[id]) || 0;
      if (was <= 0) continue;
      box[id] = 0;
      if (box === fresh.conversations && q.bot && hasKey(fresh.bots, q.bot)) {
        fresh.bots[q.bot] = Math.max(0, (Number(fresh.bots[q.bot]) || 0) - was);
      }
    }
  }
  async function refresh() {
    if (unreadMissing) { counts = r29EmptyUnread(); notify(); return snapshot(); }
    const mine = ++refreshSeq;
    const startedAt = Date.now();
    try {
      const res = await call('/unread/', { method: 'GET' });
      if (res.status === 404) { unreadMissing = true; counts = r29EmptyUnread(); notify(); return snapshot(); }
      if (!res.ok || res.data?.ok === false) return snapshot();
      // 先发出的读取后到，不能盖掉后发出的读取。
      if (mine < refreshApplied) return snapshot();
      refreshApplied = mine;
      const fresh = {
        conversations: r29Box(res.data?.conversations),
        bots: r29Box(res.data?.bots),
        groups: r29Box(res.data?.groups)
      };
      applyQuiet(fresh, startedAt);
      counts = fresh;
      notify();
      retryStuck();
      return snapshot();
    } catch { return snapshot(); }
  }
  function schedule(bot) {
    track(Promise.resolve().then(() => {
      if (!queued(bot).length) return;
      if (typeof deps.busy === 'function' && deps.busy(bot)) return;
      try { deps.deliver(bot, ''); } catch { /* 忙或发送入口拒绝时，附注留到下一条 */ }
    }));
  }
  const HubUnread = {
    counts() { return snapshot(); },
    // opts.latest：主人点开了这段会话，就算看过——忽略读到哪一条，直接读到最新；本地数字先清、后端失败自己重试。
    markRead(conversation, opts) {
      const asked = r29Clip(conversation, 80);
      if (r29SkipKey(asked) || unreadMissing) return;
      const force = !!(opts && opts.latest === true);
      // 壳传来的可能是本地会话号，后端只认服务器会话号。
      let id = asked;
      try {
        const mapped = typeof deps.remote === 'function' ? r29Clip(deps.remote(asked), 80) : '';
        if (mapped && !r29SkipKey(mapped)) id = mapped;
      } catch { id = asked; }
      // 占位会话（还没在服务器上建出来的本地会话）后端没有，发过去只会 404：由接线处判断，这种不发。
      try { if (typeof deps.known === 'function' && !deps.known(asked, id)) return; } catch { /* 判断不了就照发 */ }
      let upTo = 0;
      if (!force) {
        try { upTo = typeof deps.upTo === 'function' ? deps.upTo(asked) : 0; } catch { upTo = 0; }
        if (!Number.isFinite(upTo)) upTo = 0;
        upTo = Math.trunc(upTo);
      }
      // 0、空、不是正整数都算没有位置。不带 upTo，后端读到最新。带 0 一定被拒，也不再补发第二次。
      const usable = Number.isSafeInteger(upTo) && upTo > 0;
      // 同一位置：在途不重发；成功后这一段已是 0 就不再发。还有数字也隔 3 秒，并且最多 3 次，
      // 免得停在底部时「请求→刷新→重画→再请求」停不下来。传输没发出去就清掉记号，立刻重试仍算一次。
      // 主人点开会话（latest）不受这三条限制，只受「在途不重发」约束。
      const sig = usable ? String(upTo) : '';
      const now = Date.now();
      const last = readSent.get(id);
      if (last && last.pending) { if (force) last.again = true; return; }
      if (last && last.sig === sig && !force) {
        if (last.zero) return;
        if (last.spaced && last.n >= 3) return;
        if (last.spaced && now - last.at < 3000) return;
      }
      const stamp = {
        sig, at: now, pending: true, spaced: false, zero: false, again: false, tries: 0,
        n: last && last.sig === sig ? (last.n || 0) + 1 : 1
      };
      readSent.set(id, stamp);
      // 先在本地清掉数字（同步、不等任何网络），再告诉后端。
      const before = snapshot();
      let restored = false;
      const putBack = () => {
        if (restored) return;
        restored = true;
        quiet.delete(id);
        counts = {
          conversations: { ...before.conversations },
          bots: { ...before.bots },
          groups: { ...before.groups }
        };
        notify();
      };
      let taken = 0;
      const convKey = hasKey(counts.conversations, id) ? id : (hasKey(counts.conversations, asked) ? asked : '');
      const groupKey = !convKey && (hasKey(counts.groups, id) ? id : (hasKey(counts.groups, asked) ? asked : ''));
      let bot = '';
      if (convKey) {
        taken = Number(counts.conversations[convKey]) || 0;
        counts.conversations[convKey] = 0;
      } else if (groupKey) {
        counts.groups[groupKey] = 0;
      }
      try {
        bot = r29Clip(typeof deps.owner === 'function' ? deps.owner(id) : '', 80);
        if ((!bot || r29SkipKey(bot)) && id !== asked && typeof deps.owner === 'function') {
          bot = r29Clip(deps.owner(asked), 80);
        }
      } catch { bot = ''; }
      if (bot && r29SkipKey(bot)) bot = '';
      if (taken > 0 && bot && hasKey(counts.bots, bot)) {
        const left = (Number(counts.bots[bot]) || 0) - taken;
        counts.bots[bot] = left > 0 ? left : 0;
      }
      if (convKey || groupKey) quiet.set(id, { settled: 0, bot, key: convKey || groupKey });
      if (JSON.stringify(snapshot()) !== JSON.stringify(before)) notify();
      const send = payload => call('/unread/read', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const payload = usable ? { conversation: id, upTo } : { conversation: id };
      const run = async () => {
        if (unreadMissing) { stamp.pending = false; quiet.delete(id); return; }
        stamp.pending = true;
        const releaseFail = () => {
          stamp.pending = false;
          stamp.spaced = false;
          stamp.zero = false;
          stamp.at = 0;
          stamp.n = Math.max(0, (stamp.n || 1) - 1);
        };
        // 网络断了、后端 5xx、限流：数字保持已清，隔一会儿自己重试，不让数字弹回来。
        const retryLater = () => {
          releaseFail();
          const wait = READ_RETRY[Math.min(stamp.tries, READ_RETRY.length - 1)];
          stamp.tries += 1;
          if (stamp.tries > READ_RETRY.length) {
            stamp.stuck = true;
            stuckReads.add(() => {
              if (!stamp.stuck) return true;
              stamp.stuck = false; stamp.tries = 0; stamp.pending = true;
              chain = chain.then(run, run);
              return true;
            });
            return;
          }
          stamp.pending = true;
          stamp.timer = setTimeout(() => { stamp.timer = 0; chain = chain.then(run, run); }, wait);
          if (stamp.timer && typeof stamp.timer.unref === 'function') stamp.timer.unref();
        };
        try {
          const res = await send(payload);
          const hasError = !!(res.data && typeof res.data === 'object' && res.data.error);
          if (res.status === 404 && !hasError) {
            unreadMissing = true;
            quiet.delete(id);
            stamp.pending = false;
            stamp.spaced = true;
            stamp.zero = true;
            await refresh();
            return;
          }
          const transient = res.status === 0 || res.status === 408 || res.status === 429 || res.status >= 500;
          if (transient) { retryLater(); return; }
          if (!res.ok || res.data?.ok === false) {
            // 后端明确拒了（位置不对、没有这段会话）：重试没用，把数字还原成后端说的样子。
            putBack();
            stamp.pending = false;
            stamp.spaced = true;
            stamp.at = Date.now();
            await refresh();
            return;
          }
          stamp.pending = false;
          stamp.spaced = true;
          stamp.at = Date.now();
          const q = quiet.get(id);
          if (q) q.settled = Date.now();
          await refresh();
          const after = snapshot();
          const leftConv = Number(after.conversations[id]) || Number(after.conversations[asked]) || 0;
          const leftGroup = Number(after.groups[id]) || Number(after.groups[asked]) || 0;
          stamp.zero = leftConv <= 0 && leftGroup <= 0;
          if (stamp.again) { stamp.again = false; stamp.zero = false; chain = chain.then(run, run); }
        } catch {
          retryLater();
        }
      };
      chain = chain.then(run, run);
    },
    // 首页行上滑出的「已读」：这位助理名下所有还有数字的会话一并标已读。
    markBotRead(bot) {
      const who = r29Clip(bot, 80);
      if (r29SkipKey(who) || unreadMissing) return;
      for (const key of Object.keys(counts.conversations)) {
        if (!(Number(counts.conversations[key]) > 0)) continue;
        let owner = '';
        try { owner = r29Clip(typeof deps.owner === 'function' ? deps.owner(key) : '', 80); } catch { owner = ''; }
        if (owner === who) HubUnread.markRead(key, { latest: true });
      }
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    }
  };
  function r29VoiceRequestId(value) {
    if (typeof value !== 'string') return '';
    const id = value.trim();
    if (id === '.' || id === '..') return '';
    if (!/^[A-Za-z0-9_.:-]{1,80}$/u.test(id)) return '';
    return id;
  }
  function r29VoiceDuration(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '';
    if (value > 24 * 60 * 60 * 1000) return '';
    return String(value);
  }
  const voiceDone = new Map();
  const voiceFlights = new Map();
  function voiceStore(key, value) {
    if (voiceDone.has(key)) voiceDone.delete(key);
    voiceDone.set(key, value);
    while (voiceDone.size > 80) voiceDone.delete(voiceDone.keys().next().value);
  }
  async function r29VoiceOnce(blob, info, requestId, mark) {
    const bot = r29Clip(info.bot, 80);
    const conversation = r29Clip(info.conversation, 80);
    let uploadId = conversation;
    let remoteId = conversation;
    const rawType = typeof blob?.type === 'string' ? blob.type.split(';')[0].trim() : '';
    const type = /^audio\/[a-z0-9.+-]+$/i.test(rawType) ? rawType : 'application/octet-stream';
    if (typeof deps.bindVoice === 'function' && conversation && bot && !r29SkipKey(bot)) {
      try {
        const bound = await deps.bindVoice(bot, { conversation, requestId });
        const next = r29Clip(bound && bound.conversation, 80);
        if (next) {
          uploadId = next;
          remoteId = next;
        }
      } catch {
        mark(false);
        return { ok: false, error: 'failed' };
      }
    }
    const duration = r29VoiceDuration(info.durationMs);
    let query = '?conversation=' + encodeURIComponent(uploadId) + '&bot=' + encodeURIComponent(bot);
    if (duration) query += '&durationMs=' + duration;
    const headers = { 'content-type': type };
    if (requestId) headers['x-request-id'] = requestId;
    try {
      const res = await call('/voice/' + query, { method: 'POST', headers, body: blob });
      if (res.status === 404) return { ok: false, error: 'not-ready' };
      if (!res.ok) return { ok: false, error: 'failed' };
      if (res.data?.ok === false) {
        const error = typeof res.data.error === 'string' ? res.data.error : 'failed';
        return { ok: false, error, id: res.data.id };
      }
      if (res.data?.ok !== true) return { ok: false, error: 'failed' };
      const text = typeof res.data.text === 'string' ? res.data.text : '';
      const audioUrl = typeof res.data.audioUrl === 'string' ? res.data.audioUrl : '';
      if (text.trim() && bot && !r29SkipKey(bot)) {
        try {
          if (typeof deps.placeVoice === 'function') {
            deps.placeVoice(bot, text, { conversation, remote: remoteId, requestId });
          } else if (typeof deps.deliver === 'function') {
            deps.deliver(bot, text);
          }
          mark(true);
        } catch { mark(false); }
      }
      return { ok: true, text, audioUrl };
    } catch { return { ok: false, error: 'failed' }; }
  }
  async function HubVoiceSend(blob, meta) {
    const info = meta || {};
    const requestId = r29VoiceRequestId(info.requestId);
    const bot = typeof info.bot === 'string' ? info.bot : '';
    // 键只含助理号和请求号。不加会话号：同一助理换会话仍是同一次开口。
    const voiceKey = requestId ? bot + '\n' + requestId : '';
    if (voiceKey && voiceDone.has(voiceKey)) return voiceDone.get(voiceKey);
    if (voiceKey && voiceFlights.has(voiceKey)) return voiceFlights.get(voiceKey);
    let keep = false;
    const job = r29VoiceOnce(blob, info, requestId, flag => { keep = flag; }).then(result => {
      if (voiceKey && keep && result && result.ok) voiceStore(voiceKey, result);
      return result;
    });
    if (voiceKey) {
      voiceFlights.set(voiceKey, job);
      job.finally(() => { voiceFlights.delete(voiceKey); });
    }
    return job;
  }
  async function HubUpload(file, meta) {
    const info = meta || {};
    const bot = r29Clip(info.bot, 80);
    const conversation = r29Clip(info.conversation, 80);
    const rawName = typeof file?.name === 'string' ? file.name : '';
    const headerName = encodeURIComponent(r29Clip(rawName, 120) || 'file');
    const query = '?conversation=' + encodeURIComponent(conversation) + '&bot=' + encodeURIComponent(bot);
    const rawMime = typeof file?.type === 'string' ? file.type.split(';')[0].trim() : '';
    const type = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(rawMime)
      ? rawMime : 'application/octet-stream';
    try {
      const res = await call('/uploads/' + query, {
        method: 'POST', headers: { 'content-type': type, 'x-filename': headerName }, body: file
      });
      if (res.status === 404) return { ok: false, error: 'not-ready' };
      if (!res.ok || res.data?.ok === false) {
        return { ok: false, error: typeof res.data?.error === 'string' ? res.data.error : 'failed' };
      }
      if (res.data?.ok !== true) return { ok: false, error: 'failed' };
      const name = typeof res.data.name === 'string' && res.data.name ? res.data.name : rawName;
      const line = r29FileLine(name, res.data.path);
      if (line && bot && !r29SkipKey(bot)) {
        const list = queued(bot);
        list.push(line);
        notes.set(bot, list);
        schedule(bot);
      }
      return { ok: true, id: res.data.id, name, size: res.data.size, mime: res.data.mime };
    } catch { return { ok: false, error: 'failed' }; }
  }
  function settingsFallback(readonly) {
    if (typeof window !== 'undefined') window.R29SettingsUnreadable = true;
    return { permission: { mode: 'ask' }, bots: {}, models: [], error: true, readonly: true };
  }
  async function getSettings() {
    if (settingsMissing) return settingsFallback(true);
    try {
      const res = await call('/settings/', { method: 'GET' });
      if (res.status === 404) { settingsMissing = true; return settingsFallback(true); }
      if (!res.ok || !res.data || res.data.ok === false) return settingsFallback(false);
      const mode = res.data.permission?.mode;
      if (typeof window !== 'undefined') window.R29SettingsUnreadable = !['open', 'ask', 'readonly'].includes(mode);
      modelsLocked = res.data.modelsWritable === false;
      return {
        permission: { mode: ['open', 'ask', 'readonly'].includes(mode) ? mode : 'ask' },
        ...(!['open', 'ask', 'readonly'].includes(mode) ? { error: true, readonly: true } : {}),
        bots: r29Bots(res.data.bots),
        models: modelsLocked ? [] : r29Models(res.data.models),
        budget: budgetView(res.data.budget),
        ...(modelsLocked ? { modelsWritable: false } : {})
      };
    } catch { return settingsFallback(false); }
  }
  // 每月预算。后端没给或给得不对就当没设（null），界面不画进度条。
  function budgetView(raw) {
    const monthly = raw && typeof raw.monthly === 'number' && Number.isFinite(raw.monthly) && raw.monthly > 0 ? raw.monthly : null;
    return { monthly, currency: raw && raw.currency === 'USD' ? 'USD' : 'CNY' };
  }
  async function setBudget(monthly, currency) {
    if (monthly !== null && !(typeof monthly === 'number' && Number.isFinite(monthly) && monthly > 0)) return { ok: false, error: 'bad-budget' };
    if (settingsMissing) return { ok: false, error: 'not-ready' };
    try {
      const res = await call('/settings/budget', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monthly, currency: currency === 'USD' ? 'USD' : 'CNY' })
      });
      if (res.status === 404) return { ok: false, error: 'not-ready' };
      if (!res.ok || res.data?.ok === false) return { ok: false, error: typeof res.data?.error === 'string' ? res.data.error : 'failed' };
      return { ok: true, budget: budgetView(res.data?.budget) };
    } catch { return { ok: false, error: 'failed' }; }
  }
  async function setPermission(mode) {
    if (mode !== 'open' && mode !== 'ask' && mode !== 'readonly') return { ok: false, error: 'bad-mode' };
    if (settingsMissing) return { ok: false, error: 'not-ready' };
    try {
      const res = await call('/settings/permission', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode })
      });
      if (res.status === 404) { settingsMissing = true; return { ok: false, error: 'not-ready' }; }
      if (!res.ok || res.data?.ok === false) {
        return { ok: false, error: typeof res.data?.error === 'string' ? res.data.error : 'failed' };
      }
      return { ok: true };
    } catch { return { ok: false, error: 'failed' }; }
  }
  async function setBot(id, patch) {
    const bot = r29Clip(id, 80);
    if (r29SkipKey(bot)) return { ok: false, error: 'bad-bot' };
    if (settingsMissing) return { ok: false, error: 'not-ready' };
    if (modelsLocked) return { ok: false, error: 'readonly' };
    const body = {};
    if (patch && typeof patch.model === 'string') body.model = r29Clip(patch.model, 80);
    if (patch && typeof patch.effort === 'string') body.effort = r29Clip(patch.effort, 40);
    try {
      const res = await call('/settings/bots/' + encodeURIComponent(bot), {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      if (res.status === 404) { settingsMissing = true; return { ok: false, error: 'not-ready' }; }
      if (!res.ok || res.data?.ok === false) {
        return { ok: false, error: typeof res.data?.error === 'string' ? res.data.error : 'failed' };
      }
      return { ok: true };
    } catch { return { ok: false, error: 'failed' }; }
  }
  return {
    HubUnread, HubVoiceSend, HubUpload,
    HubSettings: { get: getSettings, setPermission, setBot, setBudget },
    compose, refresh: () => track(refresh()), idle: () => chain, onReply: () => track(refresh())
  };
}
// ==== r28 接新壳 A2 结束 ====
