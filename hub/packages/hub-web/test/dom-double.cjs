// 最小 Hub/DOM 夹具，仅验证请求边界；真实壳行为由 e2e.cjs 覆盖。
const vm = require('node:vm');
function environment() {
  const listeners = new Map(), events = new Map(), conversations = new Map();
  const node = () => ({ dataset: {}, style: {}, append() {}, querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, replaceChildren() {}, hasAttribute: () => false });
  const doc = { head: node(), body: node(), documentElement: node(), hidden: true, querySelector: () => null, querySelectorAll: () => [], createElement: node, addEventListener() {} };
  const state = { bot: 'machine-steward', view: 'capabilities', threads: {}, sessionNames: {}, bots: [], running: false };
  for (const bot of ['chief','support','content','pm','art','research']) { state.threads[bot] = []; state.sessionNames[bot] = bot; state.bots.push({ id: bot, unread: 0 }); }
  const H = { state, h: node, on: (name, fn) => { events.set(name, [...events.get(name) || [], fn]); }, emit: (name, data) => (events.get(name) || []).forEach(fn => fn(data)),
    postMessage: (local, message) => { conversations.get(local).messages.push(message); return message; }, registerConversation: (bot, r) => conversations.set(r.id, { ...r, bot }),
    registerCard() {}, registerPanel() {}, registerSettingsPage() {}, openPanel() {}, conversationsHTML: () => '', currentMessages: () => state.threads[state.bot], messageText: m => m.text,
    setMessageStatus() {}, measureDock() {}, toast() {}, petTurn() {}, petState: () => ({}), reading: { state: () => ({}), release() {}, preserve: fn => fn() } };
  const ctx = { document: doc, Hub: H, localStorage: { getItem: () => 'demo', setItem() {} }, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, queueMicrotask,
    AbortController, AbortSignal, TextDecoder, Event, console, addEventListener: (name, fn) => listeners.set(name, [...listeners.get(name) || [], fn]), render() {}, setChiefFace() {}, animateChiefDone() {} };
  ctx.window = ctx; vm.createContext(ctx);
  return { ctx, doc, listeners, conversations };
}
module.exports = { environment };
