/* 假时钟：对照表里每一项「搬」各一条。助理号只用 a / b。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const petDir = path.join(root, 'js/r29-pet');
const files = ['tables.js', 'lines.js', 'shake.js', 'machine.js', 'effects.js'];

function load(ctx) {
  if (!vm.isContext(ctx)) vm.createContext(ctx);
  for (const name of files) {
    const file = path.join(petDir, name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
}

function boot(makeRandom) {
  let now = 0;
  const queue = [];
  let seq = 1;
  const ctx = { Date, console, setTimeout() { return 0; }, clearTimeout() {} };
  ctx.window = ctx;
  load(ctx);
  const clock = {
    now() { return now; },
    setTimer(fn, ms) {
      const id = seq++;
      queue.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer(id) {
      const i = queue.findIndex((item) => item.id === id);
      if (i >= 0) queue.splice(i, 1);
    }
  };
  function advance(ms) {
    const end = now + ms;
    let guard = 0;
    while (guard < 10000) {
      guard += 1;
      const due = queue.filter((item) => item.at <= end);
      if (!due.length) break;
      due.sort((a, b) => a.at - b.at || a.id - b.id);
      const item = due[0];
      now = item.at;
      clock.clearTimer(item.id);
      item.fn();
    }
    now = end;
  }
  const random = makeRandom ? makeRandom(() => now) : () => 0;
  const machine = ctx.HubPetMachine.create({
    clock,
    random,
    lines(id, pose) { return ctx.HubPetLines.linesFor(id, pose); }
  });
  machine.ensure('a');
  return { ctx, machine, advance, pose: (id) => machine.snapshot(id || 'a') };
}

function bootPage(mode) {
  const delays = [];
  const document = {
    documentElement: { dataset: { hubMode: mode || '' } },
    hidden: false,
    addEventListener() {}
  };
  const ctx = {
    document, Date, console,
    setTimeout(fn, ms) { delays.push(ms); return delays.length; },
    clearTimeout() {},
    matchMedia() { return { matches: false, addEventListener() {} }; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('Math.random=function(){return 0;};', ctx);
  load(ctx);
  vm.runInContext(fs.readFileSync(path.join(petDir, 'mount.js'), 'utf8'), ctx, { filename: 'mount.js' });
  const slot = {
    isConnected: true,
    dataset: {},
    innerHTML: '',
    querySelector(sel) { return sel === '[data-r29-bubble]' ? { textContent: '' } : null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    getAttribute() { return 'a'; }
  };
  ctx.HubPetStage.mount(slot, 'a');
  return { ctx, delays, slot };
}

const base = boot();
const T = base.ctx.HubPetTables;
const css = fs.readFileSync(path.join(root, 'css/r29-pet.css'), 'utf8');
let passed = 0;
function check(value, label) {
  assert.ok(value, label);
  passed += 1;
  console.log('通过：' + label);
}

check(Object.keys(T.MOTION).every((pose) => T.PACK[pose]), '每个姿势都有角色包回落');
for (const motion of new Set(Object.values(T.MOTION))) {
  check(css.includes('[data-motion="' + motion + '"]'), '动作曲线 ' + motion);
}
check(css.includes('translateY(-2.5%)') && css.includes('translateY(-9%)'), '起伏与跳跃幅度');
check(css.includes('rotate(-2.5deg)') && css.includes('translateX(-3%)'), '摇摆与发抖幅度');
check(css.includes('transform-origin: 50% 100%'), '轴心在脚底');

base.machine.event('a', 'thinking');
check(base.pose().pose === 'thinking' && base.pose().motion === 'm-rock', '思考用摇摆');
base.machine.event('a', 'working');
base.advance(2499);
check(base.pose().pose === 'thinking', '非紧急动作等停留结束');
base.advance(1);
check(base.pose().pose === 'writing' && base.pose().motion === 'm-bob', '停留满了才换成写');
base.machine.event('a', 'done');
check(base.pose().pose === 'happy' && base.pose().motion === 'm-jump', '紧急的完成不看停留');
check(base.pose().line === '做好了', '完成时有气泡');
base.advance(4999);
check(base.pose().pose === 'happy' && base.pose().line === '做好了', '高兴停满之前不收回');
base.advance(1);
check(base.pose().pose === 'idle' && base.pose().line === '', '短暂动作结束气泡清空');

const dwell = boot();
dwell.machine.event('a', 'send');
check(dwell.pose().pose === 'listening' && dwell.pose().motion === 'm-hop', '发送先听');
dwell.advance(2499);
check(dwell.pose().pose === 'listening', '听完停留才去想');
dwell.advance(1);
check(dwell.pose().pose === 'thinking', '发送后 2500 毫秒进入思考');

const tools = boot();
tools.machine.event('a', 'working');
check(tools.pose().pose === 'writing', '干活是写');
tools.machine.event('a', 'tool-done');
tools.advance(2499);
check(tools.pose().pose === 'writing', '工具回来仍受停留约束');
tools.advance(1);
check(tools.pose().pose === 'thinking', '工具回来停留满了回到思考');

const proud = boot();
for (let i = 0; i < 8; i += 1) proud.machine.event('a', 'working');
proud.machine.event('a', 'done');
check(proud.pose().pose === 'proud' && proud.pose().motion === 'm-hop', '八次干活后是得意');
const once = boot();
once.machine.event('a', 'working');
once.machine.event('a', 'done');
check(once.pose().pose === 'happy', '一次干活后是高兴');

const trouble = boot();
trouble.machine.event('a', 'error');
check(trouble.pose().pose === 'oops' && trouble.pose().motion === 'm-shake', '出错是失手');
trouble.machine.event('a', 'send');
check(trouble.pose().pose === 'sorry', '出错后马上再发送先道歉');
trouble.advance(2999);
check(trouble.pose().pose === 'sorry', '道歉还没到点');
trouble.advance(1);
check(trouble.pose().pose === 'thinking', '道歉之后进入思考');

const poke = boot();
poke.machine.poke('a');
check(poke.pose().pose === 'surprised' && poke.pose().line === '诶？', '戳一下是吃惊');
const pat = boot();
pat.machine.pat('a');
check(pat.pose().pose === 'pat' && pat.pose().motion === 'm-sway', '摸一下是拍拍');

let tick = 0;
const shaker = base.ctx.HubPetShake.create(() => tick);
shaker.start(0);
check(shaker.move(20) === false && shaker.move(40) === false, '单程不算甩');
check(shaker.move(20) === false && shaker.move(0) === false, '一次折返还不够');
check(shaker.move(20) === true, '两次折返算甩');
check(shaker.move(40) === false && shaker.move(20) === false, '0.3 秒内不连发');
tick = 301;
check(shaker.move(0) === false && shaker.move(20) === true, '过了 0.3 秒可以再甩');

const annoyed = boot();
for (let i = 0; i < 4; i += 1) annoyed.machine.shaken('a');
check(Math.abs(annoyed.pose().anger - 28) < 0.01, '甩一次加 7，四次是 28');
annoyed.advance(900);
check(annoyed.pose().pose === 'annoyed' && annoyed.pose().anger > 20 && annoyed.pose().anger < 45, '四次甩完仍是不耐烦');
const decay = boot();
decay.machine.shaken('a');
decay.advance(500);
check(Math.abs(decay.pose().anger - 6) < 0.05, '生气每秒掉 2');
const under = boot();
for (let i = 0; i < 3; i += 1) under.machine.shaken('a');
under.advance(900);
check(under.pose().anger < 20 && under.pose().sulking === false, '三次甩完衰减后不满 20');

const hot = boot();
for (let i = 0; i < 11; i += 1) hot.machine.shaken('a');
check(hot.pose().anger >= 75, '十一次甩到发怒线');
hot.advance(900);
check(hot.pose().pose === 'redhot' && hot.pose().sulking === true, '发怒后进入赌气');
hot.advance(3500);
check(hot.pose().pose === 'sulk', '发怒停完变成赌气姿势');
hot.machine.pat('a');
hot.machine.pat('a');
check(hot.pose().sulking === true && hot.pose().pose === 'coaxed', '赌气要摸满三次');
hot.machine.pat('a');
check(hot.pose().sulking === false && hot.pose().pose === 'forgiven' && hot.pose().anger === 0, '第三次摸原谅');
hot.advance(45000);
check(hot.pose().sulking === false && hot.pose().anger < 20, '原谅之后气已经消了');

const coax = boot();
for (let i = 0; i < 7; i += 1) coax.machine.shaken('a');
coax.machine.pat('a');
check(coax.pose().pose === 'coaxed' && coax.pose().anger === 24, '哄一次减 25');

const mad = boot();
for (let i = 0; i < 4; i += 1) mad.machine.shaken('a');
mad.machine.event('a', 'done');
check(mad.pose().pose === 'annoyed' && mad.pose().pose !== 'happy', '还在气头上不庆祝');

const workShake = boot();
workShake.machine.event('a', 'working');
workShake.machine.shaken('a');
check(workShake.pose().pose === 'dizzy' && workShake.pose().line === '别晃，我在做事', '干活时被甩会晕');
workShake.advance(1200);
check(workShake.pose().pose === 'writing', '晕完 1200 毫秒回到干活');

const fidget = boot();
fidget.advance(20000);
check(fidget.pose().pose === 'hum', '闲时 42% 会哼');
const quiet = boot((now) => () => 0.5);
quiet.advance(20000);
check(quiet.pose().pose === 'idle', '没抽中就保持闲置');
const yawn = boot((now) => {
  let n = 0;
  return () => {
    if (now() >= 200000) {
      n += 1;
      if (n === 1) return 0;
      if (n === 2) return 0.9;
    }
    return 0;
  };
});
yawn.advance(200000);
check(yawn.pose().pose === 'yawn', '安静超过三分钟会打哈欠');

const sleep = boot();
sleep.advance(600000);
check(sleep.pose().pose !== 'sleeping', '刚好十分钟还不到入睡线');
sleep.advance(20000);
check(sleep.pose().pose === 'sleeping' && sleep.pose().motion === 'm-slow', '再过一个节拍入睡');
sleep.machine.poke('a');
check(sleep.pose().pose === 'yawn' && sleep.pose().line === '唔…你回来啦', '戳醒先打哈欠');

const hidden = boot();
hidden.machine.snapshot('a');
hidden.machine.setPageHidden(true);
hidden.advance(700000);
check(hidden.pose().pose === 'idle' && hidden.pose().hidden === true, '页面藏着不计安静时间');
hidden.machine.setPageHidden(false);
hidden.advance(600000);
check(hidden.pose().pose !== 'sleeping', '藏起来的时间不拿来入睡');
hidden.advance(20000);
check(hidden.pose().pose === 'sleeping', '重新可见满十分钟才睡');

const reduced = boot();
reduced.machine.setReduced(true);
reduced.machine.poke('a');
const reducedSnap = reduced.pose();
check(reducedSnap.reduced && reducedSnap.motion === '' && reducedSnap.pose === 'surprised', '减弱动态只留表情');
check(reduced.pose().line === '诶？' && reduced.pose().blinking === false, '减弱动态仍有气泡且不眨眼');

const blink = boot();
blink.advance(3000);
check(blink.pose().blinking === true, '闲置到点会眨眼');
blink.advance(140);
check(blink.pose().blinking === false, '闭眼 140 毫秒');
const eyes = boot();
eyes.machine.poke('a');
eyes.advance(500);
check(eyes.pose().blinking === false, '刚换姿势 600 毫秒内不眨眼');
const thinkBlink = boot();
thinkBlink.machine.event('a', 'thinking');
thinkBlink.advance(4000);
check(thinkBlink.pose().blinking === false, '思考时不眨眼');
const noBlink = boot();
noBlink.machine.setReduced(true);
noBlink.advance(4000);
check(noBlink.pose().blinking === false, '减弱动态不眨眼');

const frames = boot();
frames.advance(10000);
check(frames.pose().frameIndex === 1, '同一姿势超过 8 秒换一帧');

const stuck = boot((now) => () => 0.5);
stuck.machine.event('a', 'thinking');
stuck.advance(180000);
check(stuck.pose().working === false && stuck.pose().pose === 'idle', '卡住三分钟回到闲置');

const multi = boot();
multi.machine.setSessions('a', [{ pose: 'writing' }, { pose: 'reading' }]);
check(multi.pose().pose === 'busy_right' && multi.pose().side === 'right', '两个忙会话先翻到右边');
multi.advance(1500);
check(multi.pose().pose === 'busy_left', '1500 毫秒后翻到左边');
const swamp = boot();
swamp.machine.setSessions('a', [{ pose: 'writing' }, { pose: 'writing' }, { pose: 'thinking' }]);
check(swamp.pose().pose === 'swamped_right', '三个忙会话是手忙脚乱');
const ask = boot();
ask.machine.setSessions('a', [{ pose: 'asking' }]);
check(ask.pose().pose === 'asking', '有人在问就变成等待');
const wobble = boot();
wobble.machine.setSessions('a', [{ pose: 'writing' }, { pose: 'writing' }]);
wobble.machine.shaken('a');
check(wobble.pose().wobble === true && wobble.pose().line === '我已经够忙了', '多会话被甩时卡片晃');

const greet = boot();
greet.machine.arrive('a', new Date(2026, 5, 15, 9, 0, 0));
check(greet.pose().pose === 'greet_morning', '早上打招呼');
greet.advance(5500);
check(greet.pose().pose === 'idle', '招呼说完回到闲置');
greet.machine.arrive('a', new Date(2026, 5, 15, 10, 0, 0));
check(greet.pose().pose === 'idle', '同一时段只打一次');
greet.machine.arrive('a', new Date(2026, 5, 15, 12, 0, 0));
check(greet.pose().pose === 'greet_noon', '中午换一句');
const fest = boot();
fest.machine.arrive('a', new Date(2026, 9, 31, 9, 0, 0));
check(fest.pose().pose === 'fest_halloween' && fest.pose().motion === 'm-gift', '固定公历节日');

const lines = base.ctx.HubPetLines;
lines.setLines('a', { pat: ['<b>嗨</b>&', 'y'.repeat(90), 12, ''] });
check(JSON.stringify(lines.linesFor('a', 'pat')) === JSON.stringify(['b嗨/b', 'y'.repeat(80)]), '台词去掉尖括号并截断');
check(lines.linesFor('b', 'pat')[0] === '嘿嘿', '别的助理仍用通用句');

const night = new Date(2026, 5, 15, 23, 10, 0);
const dawn = new Date(2026, 5, 15, 3, 0, 0);
const noon = new Date(2026, 5, 15, 12, 0, 0);
check(T.nightQuiet(night) && T.nightQuiet(dawn) && !T.nightQuiet(noon), '夜里 23 点到 5 点不出声');
const demo = bootPage('');
check(demo.delays.includes(6000) && demo.delays.includes(24000), '没人调用时走演示节奏');
check(demo.ctx.HubPetStage.soundAllowed(noon) === true, '中午允许出声');
check(demo.ctx.HubPetStage.soundAllowed(night) === false, '夜里钩子也不出声');
const real = bootPage('real');
check(!real.delays.includes(6000) && !real.delays.includes(24000), '真实模式不演假干活');
real.ctx.HubPetStage.sessions('a', [{ pose: 'writing' }, { pose: 'reading' }]);
check(real.ctx.HubPetStage.snapshot('a').pose === 'busy_right', '会话钩子能推进多会话');
check(!/new Audio|HTMLAudioElement/.test(fs.readFileSync(path.join(petDir, 'mount.js'), 'utf8')), '没有创建音频');

const banned = /\/Users\/|\.ts\.net|\b100\.\d+\.\d+\.\d+/i;
for (const name of fs.readdirSync(petDir)) {
  check(!banned.test(fs.readFileSync(path.join(petDir, name), 'utf8')), '新文件不含设备名 ' + name);
}
for (const name of fs.readdirSync(petDir)) {
  const text = fs.readFileSync(path.join(petDir, name), 'utf8');
  text.split(/\n/).forEach((line, i) => {
    if (line.length > 120) throw new Error(name + ':' + (i + 1) + ' 超过 120 列');
  });
}
check(css.split(/\n/).every((line) => line.length <= 120), '样式每行不超过 120 列');

console.log('假时钟测试 ' + passed + ' 项通过');
