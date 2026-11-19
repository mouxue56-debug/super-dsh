import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 取出 Hub 导出表：以 returnToBoard 为锚，向前找最近的 return {，向后到 IIFE 结束；新壳导出表首行不再以它开头。
export function hubApiBlock(html) {
  const at = html.search(/\breturnToBoard\s*:/);
  if (at < 0) return '';
  const start = html.lastIndexOf('return {', at);
  const end = html.indexOf('})()', at);
  return start >= 0 && end > start ? html.slice(start, end) : '';
}

// 静态结构门禁；行为与浏览器布局仍由离线回归验证。
export function checkContract(html) {
  const checks = [];
  const add = (name, pattern) => checks.push({ name, ok: pattern.test(html) });
  add('window.Hub 全局', /window\.Hub\s*=/);
  const api = hubApiBlock(html);
  for (const name of ['h','on','emit','navigate','postMessage','registerCard','registerConversation','registerPanel','openPanel','registerSettingsPage','currentMessages','messageText','messageHTML','fromHTML','setMessageStatus','measureDock','toast','petTurn','petState','subBots','conversationsHTML','runCapability','reading','state','avatar','botStyle','registerActivity','completeActivity','clearActivities','restoreActivities','icon','setBotStatus']) {
    checks.push({ name: 'Hub.' + name, ok: new RegExp('\\b' + name + '\\s*:').test(api) });
  }
  for (const name of ['bot','conversation','threads','bots','sessionNames','running','emotion','input','detail','drawer','settingsTab','customTitle']) {
    add('state.' + name, new RegExp('(?:\\b' + name + '\\s*:|state\\.' + name + '\\b)'));
  }
  add('state.view 别名', /defineProperty\(state,\s*['"]view['"]/);
  for (const name of ['render','setChiefFace','animateChiefDone']) add('全局 ' + name, new RegExp('function\\s+' + name + '\\s*\\('));
  for (const name of ['chief','support','content','pm','art','research']) add('助理 ' + name, new RegExp("['\"]" + name + "['\"]"));
  for (const name of ['send','stop','sessions','new-session','bot','retry-message','continue','branch-session','rename-session','archive-session','pin-session','session-open','create-session','extra-session']) add('data-act=' + name, new RegExp('(?:data-act=["\']' + name + '["\']|case ["\']' + name + '["\']|["\']' + name + '["\'])'));
  for (const name of ['composer-area','title-model','thread-inner','bot-unread','setting-row','capability-card','data-capability-steward','data-bot-tree','data-pet-stage','data-hub-settings','shell-title-meta','preview','pin','home-row-meta','floatinghead','titlepill','page-title','dhead','r22-tool-call','r22-all-functions','voicebtn','data-pet-status','shell-activity','shell-activity-column','decision-shortcut','data-activity-open','ledger-shortcut','chat-quick-slot','data-capability-phrase','data-activity-source','data-activity-target','data-activity-reply-send','data-r22-assistant','data-hub-panel']) add('选择器 ' + name, new RegExp(name));
  for (const name of ['m-persona-today','hub-quick','shell-memory-mount','hub-status','data-context-mix','queuebar','data-reply-wait','message-footer','message-meta','hub-memory-tag','time-stamp','home-top','compact-bots','home-assistant-unread','bubble','r22-nameplate','r22-latest','r22-reply-status']) add('真实界面选择器 ' + name, new RegExp(name));
  add('消息 article 标识', /data-message-id/);
  for (const name of ['r22-home-busy','r22-home-dock','r22-input-row','r22-sheet-content','r22-board-heading','home-child-count','shell-sub-avatars','r22-unread-dot','side-bottom']) add('新壳选择器 ' + name, new RegExp(name));
  add('data-act=session-menu', /data-act=["']session-menu["']/);
  add('底栏更多入口', /r22-home-dock[\s\S]*?data-act=["']more["']/);
  add('通用面板挂载容器', /body=['"]<div data-hub-panel><\/div>['"]/);
  add('回复名牌助理标识', /data-nameplate-bot/);
  add('输入框 data-focus=composer', /data-focus=["']composer["']/);
  add('消息事件 message', /emit\(['"]message['"]/);
  add('渲染事件 render', /emit\(['"]render['"]/);
  add('导航事件 navigate', /emit\(['"]navigate['"]/);
  add('reading.preserve/state/release', /reading:Object\.freeze[\s\S]*?'preserve'[\s\S]*?'release'[\s\S]*?'state'/);
  add('chiefPet.sync/turn/state', /turn:status[\s\S]*?state:\s*\(\)/);
  for (const name of ['mcard','r22-letter','params','actions','shell-level-sticker','diff','add','del','home-recent-list','conversation','role','line','r22-badge','data-r22-activity-total','pop-input','r22-round','iconbtn','creature','result','ghostbtn']) add('r24 复用结构 ' + name, new RegExp(name));
  const expanded = /function (?:registerMoreItem|setDemoContent)\b|typeof status===['"]object['"]/.test(html);
  for (const name of ['registerMoreItem', 'setDemoContent']) checks.push({ name: 'Hub.' + name + '（新壳必需，旧壳回退）', ok: !expanded || new RegExp('\\b' + name + '\\s*:').test(api) });
  const status = html.match(/function setBotStatus\(id,status\)\{[\s\S]*?(?=\n  (?:function |var |const |let ))/)?.[0] || '';
  checks.push({ name: 'setBotStatus 启用暂停兼容', ok: /\['paused','active'\]/.test(status) });
  checks.push({ name: 'setBotStatus 扩展 running/unread/pending（新壳必需）', ok: !expanded ||
    /typeof status===['"]object['"]/.test(status) && /status\.running/.test(status) && /\['unread','pending'\]/.test(status) && /Number\.isInteger/.test(status) && /typeof status\.running!==['"]boolean['"]/.test(status) && /emit\(['"]bot-status['"]/.test(status) });
  checks.push({ name: 'registerMoreItem 规范 id/label/onClick（新壳必需）', ok: !expanded || /function registerMoreItem\(spec\)[\s\S]*?typeof spec\.id!==['"]string['"][\s\S]*?typeof spec\.label!==['"]string['"][\s\S]*?typeof spec\.onClick!==['"]function['"][\s\S]*?moreItems\.set/.test(html) });
  checks.push({ name: 'setDemoContent 按 bot 和布尔开关（新壳必需）', ok: !expanded || /function setDemoContent\(bot,enabled\)[\s\S]*?botBy\(bot\)[\s\S]*?typeof enabled!==['"]boolean['"][\s\S]*?demoContent\.set\(bot,enabled\)/.test(html) });
  add('body 注入锚点', /<\/body>/i);
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('用法：node ops/check-adapter-contract.mjs <index.html路径>');
    const checks = checkContract(await readFile(process.argv[2], 'utf8'));
    for (const c of checks) console.log((c.ok ? '通过 ' : '缺少 ') + c.name);
    const missing = checks.filter(c => !c.ok);
    console.log(`契约：${checks.length - missing.length}/${checks.length} 通过`);
    process.exitCode = missing.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
