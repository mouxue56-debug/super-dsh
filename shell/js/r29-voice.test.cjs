/* 麦克风状态机。假的 mediaDevices / MediaRecorder，不碰真麦克风。 */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'r29-voice.js'), 'utf8');
let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; }

function boot(opt) {
  opt = opt || {};
  const support = opt.support || new Set(['audio/webm;codecs=opus', 'audio/webm']);
  const timers = [];
  const posts = [];
  const toasts = [];
  const calls = [];
  const constructed = [];
  let now = 1000000;
  let seq = 0;
  let deny = !!opt.deny;
  let reduced = !!opt.reduced;
  let lastStream = null;
  let ask = 0;
  let hookMode = opt.hook || 'ok';
  let pending = null;
  const cards = {};
  const place = { conversation: 'conv-1', bot: 'bot-1' };
  const postIds = [];

  function classesOf(el) {
    return (el.className || '').split(/\s+/).filter(Boolean);
  }
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.attributes = {};
      this.childNodes = [];
      this.parentNode = null;
      this.listeners = {};
      this.value = '';
      this.disabled = false;
      this.dataset = new Proxy({}, {
        set: (obj, key, val) => {
          obj[key] = String(val);
          const attr = 'data-' + String(key).replace(/[A-Z]/g, ch => '-' + ch.toLowerCase());
          this.attributes[attr] = String(val);
          return true;
        },
        get: (obj, key) => obj[key]
      });
      const self = this;
      this.classList = {
        add(name) {
          const cur = classesOf(self);
          if (!cur.includes(name)) self.className = cur.concat(name).join(' ');
        },
        remove(name) { self.className = classesOf(self).filter(item => item !== name).join(' '); },
        toggle(name, on) { if (on) this.add(name); else this.remove(name); },
        contains(name) { return classesOf(self).includes(name); }
      };
    }
    set className(value) { this.attributes.class = value; }
    get className() { return this.attributes.class || ''; }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (key === 'disabled') this.disabled = true;
    }
    getAttribute(key) { return this.attributes[key] === undefined ? null : this.attributes[key]; }
    removeAttribute(key) {
      delete this.attributes[key];
      if (key === 'disabled') this.disabled = false;
    }
    append(...items) {
      for (const item of items) {
        if (item == null) continue;
        const node = typeof item === 'string' ? new Text(item) : item;
        if (node.parentNode) node.remove();
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
    replaceChildren(...items) {
      for (const node of this.childNodes.splice(0)) node.parentNode = null;
      if (items.length) this.append(...items);
    }
    replaceWith(node) {
      const parent = this.parentNode;
      if (!parent) return;
      const index = parent.childNodes.indexOf(this);
      this.remove();
      node.parentNode = parent;
      parent.childNodes.splice(index, 0, node);
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this);
      this.parentNode = null;
    }
    set textContent(value) {
      this.childNodes = [];
      this._text = '';
      if (value) this.append(new Text(String(value)));
    }
    get textContent() {
      if (this.tagName === '#TEXT') return this._text || '';
      return this.childNodes.map(node => node.textContent).join('');
    }
    set innerHTML(value) {
      this.childNodes = [];
      if (String(value).includes('<img')) {
        const img = new Element('img');
        this.append(img);
      }
    }
    matches(sel) {
      const body = String(sel).trim();
      if (!body.startsWith('[') || !body.endsWith(']')) return false;
      const raw = body.slice(1, -1);
      const eq = raw.indexOf('=');
      if (eq < 0) return this.attributes[raw] !== undefined;
      let expected = raw.slice(eq + 1).trim();
      if (expected.startsWith('"') && expected.endsWith('"')) expected = expected.slice(1, -1);
      return this.attributes[raw.slice(0, eq)] === expected;
    }
    querySelectorAll(sel) {
      const found = [];
      const walk = el => {
        for (const node of el.childNodes) {
          if (node.matches && node.matches(sel)) found.push(node);
          if (node.querySelectorAll) walk(node);
        }
      };
      walk(this);
      return found;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    closest(sel) {
      let node = this;
      while (node) {
        if (node.matches && node.matches(sel)) return node;
        node = node.parentNode;
      }
      return null;
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      event.preventDefault = event.preventDefault || function () {};
      event.stopImmediatePropagation = event.stopImmediatePropagation || function () {};
      for (const fn of (this.listeners[event.type] || []).slice()) fn(event);
      if (this.parentNode) this.parentNode.dispatchEvent(event);
    }
  }
  class Text extends Element {
    constructor(value) { super('#text'); this._text = value; }
  }
  const doc = new Element('document');
  doc.documentElement = new Element('html');
  doc.body = new Element('body');
  doc.documentElement.append(doc.body);
  doc.createElement = tag => new Element(tag);
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.addEventListener = (type, fn) => doc.documentElement.addEventListener(type, fn);
  doc.dispatchEvent = event => doc.documentElement.dispatchEvent(event);
  doc.visibilityState = 'visible';
  const thread = new Element('div');
  thread.className = 'thread-inner';
  const input = new Element('textarea');
  input.setAttribute('data-focus', 'composer');
  input.value = '已有草稿';
  const mic = new Element('button');
  mic.setAttribute('data-r29-mic', '');
  mic.setAttribute('aria-label', '旧标签');
  const slot = new Element('div');
  slot.setAttribute('data-r29-voice-slot', '');
  doc.body.append(thread, input);
  if (opt.controls !== false) {
    if (opt.slot !== false) doc.body.append(slot);
    if (opt.mic !== false) doc.body.append(mic);
  }
  if (opt.real) doc.documentElement.dataset.hubMode = 'real';

  function FakeRecorder(stream, opts) {
    this.stream = stream;
    this.mimeType = (opts && opts.mimeType) || '';
    this.state = 'inactive';
    this._ev = {};
    constructed.push({ mime: this.mimeType });
  }
  FakeRecorder.prototype.addEventListener = function (type, fn) {
    (this._ev[type] ||= []).push(fn);
  };
  FakeRecorder.prototype.start = function () { this.state = 'recording'; };
  FakeRecorder.prototype.stop = function () {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    const type = (this.mimeType || 'audio/webm').split(';')[0];
    const data = new Blob(['xyz'], { type: type });
    (this._ev.dataavailable || []).forEach(fn => fn({ data: data }));
    (this._ev.stop || []).forEach(fn => fn({}));
  };
  FakeRecorder.isTypeSupported = type => support.has(type);

  const winListeners = {};
  const ctx = {
    document: doc,
    navigator: {
      mediaDevices: opt.devices === false ? null : {
        getUserMedia() {
          ask += 1;
          const track = {
            stopped: false,
            _fn: [],
            addEventListener(type, fn) { if (type === 'ended') this._fn.push(fn); },
            stop() { this.stopped = true; }
          };
          lastStream = {
            track: track,
            getAudioTracks() { return [track]; },
            getTracks() { return [track]; }
          };
          if (deny) {
            const error = new Error('denied');
            error.name = 'NotAllowedError';
            return Promise.reject(error);
          }
          return Promise.resolve(lastStream);
        }
      }
    },
    MediaRecorder: FakeRecorder,
    Blob: Blob,
    Date: { now: () => now },
    setTimeout: (fn, delay) => {
      const id = ++seq;
      timers.push({ id: id, fn: fn, delay: delay, kind: 't' });
      return id;
    },
    clearTimeout: id => {
      const index = timers.findIndex(item => item.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    setInterval: (fn, delay) => {
      const id = ++seq;
      timers.push({ id: id, fn: fn, delay: delay, kind: 'i' });
      return id;
    },
    clearInterval: id => {
      const index = timers.findIndex(item => item.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    dispatchEvent: event => { (winListeners[event.type] || []).forEach(fn => fn(event)); },
    Hub: {
      registerCard(id, spec) { cards[id] = spec; },
      postMessage(id, msg) {
        posts.push(msg);
        postIds.push(id);
        if (id !== place.conversation) return { id: msg.id };
        const node = cards['r29-voice'].render(msg.parts[0].data);
        thread.append(node);
      },
      on() {},
      context() {
        if (opt.place === 'empty') return { conversation: '', bot: { id: '' } };
        return { conversation: place.conversation, bot: { id: place.bot } };
      },
      toast(text) { toasts.push(text); }
    },
    state: { input: '已有草稿' },
    console: { warn() {}, log() {} }
  };
  ctx.window = ctx;
  if (hookMode === 'none') {
    /* 不挂钩子，走演示或暂无 */
  } else if (hookMode === 'defer') {
    ctx.HubVoiceSend = (blob, meta) => {
      calls.push({ blob: blob, meta: meta });
      return new Promise((resolve, reject) => { pending = { resolve: resolve, reject: reject }; });
    };
  } else {
    ctx.HubVoiceSend = (blob, meta) => {
      calls.push({ blob: blob, meta: meta });
      if (hookMode === 'throw') return Promise.reject(new Error('offline'));
      if (hookMode === 'asr') return Promise.resolve({ ok: false, error: 'asr-unavailable', id: 'kept' });
      if (hookMode === 'bad') return Promise.resolve({ ok: false, error: 'network' });
      if (hookMode === 'asr-down') {
        return Promise.resolve({
          ok: false,
          error: 'asr-failed',
          asr: true,
          retryable: true,
          message: '转文字暂时不可用，录音已保存'
        });
      }
      if (hookMode === 'long') {
        return Promise.resolve({
          ok: false,
          error: 'audio-too-long',
          asr: true,
          message: '<img src=x>超过时长上限，录音已保存'
        });
      }
      if (hookMode === 'ready') return Promise.resolve({ ok: true, text: '转好了', asr: true });
      return Promise.resolve({ ok: true, text: opt.text || '转好了' });
    };
  }
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'r29-voice.js' });
  function click(el) { el.dispatchEvent({ type: 'click', target: el }); }
  function bubbles() { return doc.querySelectorAll('[data-r29-voice-id]'); }
  function capTimer() { return timers.find(item => item.kind === 't' && item.delay === 300000); }
  return {
    doc: doc, mic: mic, slot: slot, input: input, thread: thread, timers: timers,
    posts: posts, postIds: postIds, toasts: toasts, calls: calls, constructed: constructed, cards: cards,
    setPlace(conversation, bot) { place.conversation = conversation; place.bot = bot; },
    click: click, bubbles: bubbles, capTimer: capTimer,
    asks: () => ask, stream: () => lastStream,
    now: value => { now = value; }, clock: () => now,
    setReduced: value => { reduced = value; },
    pending: () => pending,
    fire: type => {
      if (type === 'visibility') {
        doc.visibilityState = 'hidden';
        doc.dispatchEvent({ type: 'visibilitychange' });
      } else if (type === 'pagehide') ctx.dispatchEvent({ type: 'pagehide' });
      else doc.dispatchEvent({ type: type });
    }
  };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function record(api) {
  api.click(api.mic);
  await flush();
}

(async () => {
  {
    const api = boot({ controls: false });
    api.doc.body.dispatchEvent({ type: 'click', target: api.doc.body });
    check(api.asks() === 0, '没有按钮时点击也不去要麦克风');
  }
  {
    const api = boot({ slot: false });
    api.click(api.mic);
    await flush();
    check(api.asks() === 0, '只有麦克风、没有状态条时不录音');
  }
  {
    const api = boot({ deny: true });
    await record(api);
    check(api.mic.getAttribute('aria-label') === '开始录音', '拒绝后回到待机');
    check(api.slot.textContent.includes('麦克风没打开，这次没录上。'), '拒绝时说人话');
    check(api.toasts.includes('麦克风没打开，这次没录上。'), '拒绝时也走提示条');
    check(api.bubbles().length === 0 && api.calls.length === 0, '拒绝后不发');
    check(api.input.value === '已有草稿', '拒绝后草稿还在');
  }
  {
    const bare = boot({ devices: false });
    await record(bare);
    check(bare.slot.textContent.includes('麦克风没打开，这次没录上。'), '没有麦克风接口也回到待机');
  }
  {
    const api = boot();
    api.click(api.mic);
    api.click(api.mic);
    await flush();
    check(api.asks() === 1, '权限还没回来时连点只请求一次');
    check(api.constructed[0].mime === 'audio/webm;codecs=opus', '支持 webm 时优先 opus');
    check(api.mic.getAttribute('aria-label') === '发送录音', '在录时按钮改成发送录音');
    check(api.mic.getAttribute('data-r29-phase') === 'recording', '在录时标出发送样子');
    check(api.slot.textContent.includes('00:00') && api.slot.textContent.includes('取消'), '在录时有计时和取消');
    check(api.input.value === '已有草稿', '开始录不清草稿');
  }
  {
    const api = boot({ support: new Set(['audio/mp4']) });
    await record(api);
    check(api.constructed[0].mime === 'audio/mp4', '只有 mp4 时用 mp4');
  }
  {
    const api = boot({ hook: 'defer', text: '转好了' });
    await record(api);
    api.now(api.clock() + 2500);
    api.click(api.mic);
    api.click(api.mic);
    await flush();
    check(api.calls.length === 1, '发送连点只调用一次钩子');
    check(api.bubbles().length === 1, '发送中只有一条语音气泡');
    check(api.mic.disabled === true, '发送中按钮禁用');
    check(api.mic.getAttribute('aria-label') === '正在发送录音', '发送中读屏改成正在发送');
    check(api.calls[0].meta.durationMs === 2500, '时长随录音走');
    check(api.calls[0].meta.conversation === 'conv-1' && api.calls[0].meta.bot === 'bot-1', '带上当前会话和助理');
    check(!Object.hasOwn(api.calls[0].meta, 'text'), '不把输入框的字交给钩子');
    check(!api.bubbles()[0].textContent.includes('已有草稿'), '气泡里没有输入框的字');
    check(api.input.value === '已有草稿', '发送中不清草稿');
    api.pending().resolve({ ok: true, text: '<img src=x>转好了' });
    await flush();
    check(api.bubbles().length === 1, '成功后还是一条');
    check(api.bubbles()[0].textContent.includes('<img src=x>转好了'), '转写按纯文本留下');
    check(api.bubbles()[0].querySelector('img') == null, '转写不当成页面代码');
    check(api.mic.getAttribute('aria-label') === '开始录音', '成功后回到待机');
    check(api.input.value === '已有草稿', '成功后草稿还在');
    check(api.posts.length === 1, '成功路径只投递一条消息');
  }
  {
    const api = boot();
    await record(api);
    const cancel = api.slot.querySelector('[data-r29-voice-cancel]');
    api.click(cancel);
    check(api.calls.length === 0 && api.bubbles().length === 0, '取消丢掉，不发送');
    check(api.mic.getAttribute('aria-label') === '开始录音', '取消后待机');
    check(api.slot.textContent === '', '取消后状态条收起');
    check(api.stream().track.stopped === true, '取消后放开麦克风');
    check(!api.capTimer(), '取消后不再等到点');
    check(api.input.value === '已有草稿', '取消不清草稿');
  }
  {
    const api = boot({ hook: 'defer' });
    await record(api);
    api.fire('visibility');
    check(api.slot.textContent.includes('录音停了，还留着'), '切后台停住并留着');
    check(api.slot.querySelector('[data-r29-voice-send]'), '中断后给发送');
    check(api.slot.querySelector('[data-r29-voice-discard]'), '中断后给丢弃');
    check(api.calls.length === 0, '中断本身不发送');
    api.fire('pagehide');
    api.fire('freeze');
    check(api.calls.length === 0 && api.bubbles().length === 0, '重复的中断不会发出去');
    api.click(api.slot.querySelector('[data-r29-voice-discard]'));
    check(api.calls.length === 0 && api.mic.getAttribute('aria-label') === '开始录音', '丢弃后不发送');
  }
  {
    const api = boot({ hook: 'defer' });
    await record(api);
    api.fire('pagehide');
    api.click(api.slot.querySelector('[data-r29-voice-send]'));
    api.click(api.mic);
    await flush();
    check(api.calls.length === 1 && api.bubbles().length === 1, '中断后发送只出一条');
    check(api.posts.length === 1, '中断后发送只投递一次');
  }
  {
    const api = boot({ hook: 'defer' });
    await record(api);
    api.stream().track._fn.forEach(fn => fn());
    check(api.slot.textContent.includes('录音停了，还留着'), '音轨被掐断时留着');
    check(api.calls.length === 0, '音轨中断不自动发');
  }
  {
    const api = boot({ hook: 'defer' });
    await record(api);
    const cap = api.capTimer();
    check(!!cap, '到点计时已经排上');
    api.now(api.clock() + 300000);
    cap.fn();
    check(api.slot.textContent.includes('到时间了，点发送'), '到点停住等发送');
    check(api.calls.length === 0, '到点不自动发');
    api.click(api.slot.querySelector('[data-r29-voice-send]'));
    await flush();
    check(api.calls.length === 1 && api.calls[0].meta.durationMs === 300000, '到点后再发送只有一条');
  }
  {
    const api = boot({ hook: 'asr' });
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.bubbles()[0].textContent.includes('录音已保存，转文字还没接上'), '转文字没接上时原句提示');
    check(!api.bubbles()[0].querySelector('[data-r29-voice-retry]'), '转文字没接上不拿重试当失败');
    check(api.posts.length === 1, '转文字没接上仍然只留一条');
  }
  {
    const api = boot({ hook: 'throw' });
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.bubbles().length === 1, '失败时不另起一条');
    check(api.slot.textContent.includes('没发出去，录音还在。'), '失败时说明录音还在');
    const retry = api.bubbles()[0].querySelector('[data-r29-voice-retry]');
    check(retry && retry.textContent === '重试', '失败时给重试');
    api.click(retry);
    api.click(retry);
    await flush();
    check(api.calls.length === 2 && api.posts.length === 1 && api.bubbles().length === 1, '重试连点也不会发出第二条');
  }
  {
    const api = boot({ hook: 'bad' });
    await record(api);
    api.click(api.mic);
    await flush();
    const first = api.bubbles()[0];
    api.click(first.querySelector('[data-r29-voice-retry]'));
    await flush();
    check(api.calls.length === 2 && api.posts.length === 1, '返回失败后再试仍是同一条');
    check(api.bubbles()[0].textContent.includes('转好了') === false, '再次失败不编造成功文字');
    check(api.bubbles()[0].querySelector('[data-r29-voice-retry]'), '再次失败还留着重试');
  }
  {
    const api = boot({ hook: 'none' });
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.bubbles().length === 1, '没有钩子也有一条气泡');
    check(api.bubbles()[0].textContent.includes('演示'), '没有钩子时标明演示');
    check(api.input.value === '已有草稿', '演示回退不清草稿');
  }
  {
    const api = boot({ hook: 'none', real: true });
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.bubbles()[0].textContent.includes('暂无'), '真实模式没有钩子时显示暂无');
    check(!api.bubbles()[0].textContent.includes('演示'), '真实模式不露演示');
  }
  {
    const api = boot({ hook: 'defer', place: 'empty' });
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.posts.length === 0 && api.bubbles().length === 1, '还不知道会话时先把气泡画上，不硬投递');
    check(api.calls[0].meta.conversation === '' && api.calls[0].meta.bot === '', '未知会话不编造编号');
  }
  {
    const api = boot({ reduced: true });
    check(api.slot.getAttribute('data-r29-reduced') === '1', '减弱动态效果时打上标记');
    await record(api);
    const dot = api.slot.querySelector('[aria-hidden="true"]');
    check(dot && dot.classList.contains('is-still'), '减弱动态效果时指示点不闪');
  }
  {
    const api = boot({ hook: 'defer' });
    await record(api);
    api.fire('freeze');
    check(api.slot.querySelector('[data-r29-voice-send]'), '页面冻结时留发送');
    check(api.slot.querySelector('[data-r29-voice-discard]'), '页面冻结时留丢弃');
  }
  {
    const api = boot({ hook: 'defer' });
    api.click(api.mic);
    api.setPlace('conv-2', 'bot-1');
    await flush();
    api.click(api.mic);
    await flush();
    check(api.calls.length === 1, '权限等待时切走，回来仍只发一次');
    check(api.calls[0].meta.conversation === 'conv-1', '开口时就绑住当时的会话');
    check(api.calls[0].meta.bot === 'bot-1', '开口时就绑住当时的助理');
    check(typeof api.calls[0].meta.requestId === 'string' &&
      api.calls[0].meta.requestId.indexOf('r29-voice-') === 0, '开口时就有请求号');
    check(api.postIds[0] === 'conv-1', '气泡投进开口时的会话');
    check(api.bubbles().length === 0, '切走后不把气泡画进另一段');
    check(api.input.disabled !== true && api.input.value === '已有草稿', '等转写时输入框还能打');
    api.pending().resolve({ ok: true, text: '只进原来那段' });
    await flush();
    check(api.bubbles().length === 0, '转写回来也不画进另一段');
    check(api.calls.length === 1, '转写等待期间不另发一次');
    check(api.mic.getAttribute('aria-label') === '开始录音', '转写回来后可以接着录');
  }
  {
    const api = boot({ hook: 'throw' });
    await record(api);
    api.click(api.mic);
    await flush();
    const firstId = api.calls[0].meta.requestId;
    const retry = api.bubbles()[0].querySelector('[data-r29-voice-retry]');
    check(!!retry, '断线后留着重试');
    api.click(retry);
    api.click(retry);
    await flush();
    check(api.calls.length === 2, '断线后重试只再发一次');
    check(api.calls[1].meta.requestId === firstId, '断线重试沿用同一个请求号');
    check(api.calls[1].meta.conversation === 'conv-1', '断线重试仍是原来的会话');
    check(api.posts.length === 1 && api.bubbles().length === 1, '断线重试不另起一条');
  }
  {
    const api = boot({ hook: 'asr' });
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.mic.disabled !== true, '没配引擎后麦克风不再按住');
    check(api.mic.getAttribute('aria-label') === '开始录音', '没配引擎后可以马上再录');
    check(api.input.disabled !== true && api.input.value === '已有草稿', '没配引擎后可以马上打字');
  }
  {
    const api = boot();
    await record(api);
    api.click(api.slot.querySelector('[data-r29-voice-cancel]'));
    await flush();
    check(api.calls.length === 0, '取消后第一段不发出');
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.calls.length === 1, '取消后再录只发出下一段');
    check(api.calls[0].blob.size === new Blob(['xyz']).size, '下一段不含上一段');
  }
  {
    const api = boot({ hook: 'ready' });
    await record(api);
    api.click(api.mic);
    await flush();
    check(api.bubbles()[0].textContent.includes('转好了'), '接上引擎后气泡是转写文字');
    check(!api.bubbles()[0].textContent.includes('还没接上'), '接上引擎后不说还没接上');
    check(!api.slot.textContent.includes('还没接上'), '接上引擎后状态条也不说还没接上');
  }
  {
    const api = boot({ hook: 'asr-down' });
    await record(api);
    api.click(api.mic);
    await flush();
    const bubble = api.bubbles()[0];
    check(bubble.textContent.includes('转文字暂时不可用，录音已保存'), '转写失败时气泡说明录音已保存');
    check(api.slot.textContent.includes('转文字暂时不可用，录音已保存'), '转写失败时状态条同一句');
    check(!bubble.textContent.includes('还没接上'), '转写失败不说还没接上');
    const retry = bubble.querySelector('[data-r29-voice-retry]');
    check(retry && retry.textContent === '重试', '转写失败给重试');
    const firstId = api.calls[0].meta.requestId;
    api.click(retry);
    await flush();
    check(api.calls.length === 2 && api.calls[1].meta.requestId === firstId, '转写失败重试沿用同一个请求号');
    check(api.posts.length === 1 && api.bubbles().length === 1, '转写失败重试不另起一条');
  }
  {
    const api = boot({ hook: 'long' });
    await record(api);
    api.click(api.mic);
    await flush();
    const bubble = api.bubbles()[0];
    check(bubble.textContent.includes('<img src=x>超过时长上限，录音已保存'), '超长说明按文字留下');
    check(!bubble.querySelector('img'), '超长说明不插成图片');
    check(!bubble.querySelector('[data-r29-voice-retry]'), '超长不再给重试');
  }
  check(source.includes('暂定') && source.includes('5 * 60 * 1000'), '五分钟上限标了暂定');
  check(!/iPhone|\/Users\/|192\.168|10\.\d+\.\d+/.test(source), '新代码不写设备、路径和内网');
  console.log('r29-voice ' + passed + ' 项通过');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
