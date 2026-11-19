/* Copyright (c) 2026 lokicorvus and CrossPet contributors. MIT License.
   State machine adapted from CrossPet app/web/index.html (show, dwell,
   blink, fidget, sleep, anger, work events). Full notice: LICENSE-crosspet.txt.
   No character art and no character-specific lines. */
(function (root) {
  function create(options) {
    var opt = options || {};
    var clock = opt.clock;
    var roll = opt.random || Math.random;
    var T = opt.tables || root.HubPetTables;
    var linesOf = opt.lines || function (id, pose) {
      return root.HubPetLines.linesFor(id, pose);
    };
    var sleepAfter = opt.sleepAfter == null ? T.SLEEP_AFTER : opt.sleepAfter;
    var fidgetEvery = opt.fidgetEvery == null ? T.FIDGET_EVERY : opt.fidgetEvery;
    var bots = {};
    var pageHidden = false;
    var reduced = false;

    function now() { return clock.now(); }
    function pick(list) {
      if (!list || !list.length) return '';
      return list[Math.floor(roll() * list.length)];
    }
    function arm(b, key, ms, fn) {
      disarm(b, key);
      if (b.hidden || pageHidden) {
        if (!b.frozen) b.frozen = {};
        b.frozen[key] = { ms: ms, fn: fn };
        return;
      }
      b.arms[key] = {
        ms: ms, at: now(), fn: fn,
        id: clock.setTimer(function () {
          if (!b.arms[key]) return;
          delete b.arms[key];
          if (b.hidden || pageHidden) {
            if (!b.frozen) b.frozen = {};
            b.frozen[key] = { ms: 0, fn: fn };
            return;
          }
          fn();
        }, ms)
      };
    }
    function disarm(b, key) {
      var rec = b.arms[key];
      if (rec) clock.clearTimer(rec.id);
      delete b.arms[key];
      if (b.frozen) delete b.frozen[key];
    }
    function freeze(b) {
      if (b.hidden) return;
      b.hidden = true;
      b.freezeAt = now();
      b.frozen = b.frozen || {};
      Object.keys(b.arms).forEach(function (key) {
        var rec = b.arms[key];
        b.frozen[key] = { ms: Math.max(0, rec.ms - (now() - rec.at)), fn: rec.fn };
        clock.clearTimer(rec.id);
      });
      b.arms = {};
    }
    function thaw(b) {
      if (!b.hidden) return;
      var gap = now() - b.freezeAt;
      b.hidden = false;
      b.lastActive += gap;
      b.poseSince += gap;
      b.shownAt += gap;
      b.angerAt += gap;
      var left = b.frozen || {};
      b.frozen = null;
      Object.keys(left).forEach(function (key) {
        arm(b, key, left[key].ms, left[key].fn);
      });
    }
    function levelOf(a) {
      if (a >= 75) return 'redhot';
      if (a >= 45) return 'puffed';
      if (a >= 20) return 'annoyed';
      return '';
    }
    function readAnger(b) {
      var decay = b.sulking ? 0 : (now() - b.angerAt) / 1000 * T.ANGER_DECAY;
      return Math.max(0, b.anger - decay);
    }
    function angerNow(b) {
      b.anger = readAnger(b);
      b.angerAt = now();
      return b.anger;
    }
    function addAnger(b, n) {
      angerNow(b);
      b.anger = Math.min(100, b.anger + n);
    }
    function restPose(b) {
      if (b.asking) return 'asking';
      if (b.working) return b.workPose === 'listening' ? 'thinking' : (b.workPose || 'thinking');
      return 'idle';
    }
    function setPose(b, pose) {
      if (pose === b.pose) return;
      b.pose = pose;
      b.poseSince = now();
      b.frameIndex = 0;
      b.blinking = false;
    }
    function say(b, line) { b.line = line || ''; }
    function show(b, pose, urgent) {
      if (pose === 'idle') pose = restPose(b);
      var wait = b.shownAt + T.DWELL - now();
      disarm(b, 'pending');
      if (!urgent && wait > 0) {
        arm(b, 'pending', wait, function () { show(b, pose, true); });
        return;
      }
      b.shownAt = now();
      disarm(b, 'revert');
      if (pose !== b.pose) {
        setPose(b, pose);
        say(b, pick(linesOf(b.id, pose)));
      }
      var trans = T.transient(pose);
      if (trans) {
        arm(b, 'revert', trans, function () {
          setPose(b, restPose(b));
          say(b, '');
        });
      }
    }
    function showSay(b, pose) {
      var was = b.pose;
      show(b, pose, true);
      if (was === pose) say(b, pick(linesOf(b.id, pose)));
    }
    function watchStuck(b) {
      disarm(b, 'stuck');
      arm(b, 'stuck', T.STUCK_AFTER, function () {
        if (!b.working || T.NOT_WORKING[b.pose]) return;
        disarm(b, 'think');
        b.working = false;
        b.asking = false;
        show(b, 'idle', true);
      });
    }
    function onSend(b) {
      b.toolCount = 0;
      b.working = true;
      b.asking = false;
      b.workPose = 'listening';
      watchStuck(b);
      disarm(b, 'think');
      if (b.lastTrouble != null && now() - b.lastTrouble < T.TROUBLE_WINDOW) {
        b.lastTrouble = null;
        show(b, 'sorry', true);
        arm(b, 'think', T.DWELL + 500, function () { show(b, 'thinking', false); });
        return;
      }
      show(b, 'listening', true);
      arm(b, 'think', T.LISTEN_TO_THINKING, function () { show(b, 'thinking', false); });
    }
    function onDone(b) {
      var n = b.toolCount;
      b.toolCount = 0;
      b.working = false;
      b.asking = false;
      b.workPose = 'idle';
      disarm(b, 'think');
      disarm(b, 'stuck');
      if (!b.sulking && levelOf(angerNow(b))) {
        disarm(b, 'shakeEnd');
        react(b, true);
        return;
      }
      show(b, n >= T.PROUD_TOOLS ? 'proud' : 'happy', true);
    }
    function complain(b, key) {
      if (b.complained != null && now() - b.complained < 4000) return;
      b.complained = now();
      var line = pick(linesOf(b.id, key));
      say(b, line);
      arm(b, 'complain', T.COMPLAIN_FOR, function () {
        if (b.line === line) say(b, '');
      });
    }
    function resumeWork(b) {
      if (!b.working) { react(b, false); return; }
      var pose = b.workPose === 'listening' ? 'thinking' : b.workPose;
      setPose(b, pose || 'thinking');
      b.shownAt = now();
    }
    function react(b, afterWork) {
      var lv = levelOf(angerNow(b));
      if (!lv) return;
      if (b.sulking) { show(b, 'sulk', true); return; }
      if (lv !== 'redhot') {
        show(b, lv, true);
        if (afterWork) say(b, pick(linesOf(b.id, 'work' + lv.charAt(0).toUpperCase() + lv.slice(1))));
        return;
      }
      b.sulking = true;
      b.coax = 0;
      show(b, 'redhot', true);
      if (afterWork) say(b, pick(linesOf(b.id, 'workRedhot')));
      arm(b, 'sulk', T.SULK_AFTER, function () {
        if (!b.sulking) return;
        show(b, 'sulk', true);
        arm(b, 'sulk', T.SULK_CALM, function () {
          if (!b.sulking) return;
          b.sulking = false;
          b.anger = 30;
          b.angerAt = now();
          show(b, 'idle', true);
        });
      });
    }
    function forgive(b) {
      b.sulking = false;
      b.coax = 0;
      b.anger = 0;
      b.angerAt = now();
      disarm(b, 'sulk');
      show(b, 'forgiven', true);
    }
    function coax(b) {
      if (b.sulking) {
        b.coax += 1;
        if (b.coax >= T.COAX_NEEDED) { forgive(b); return; }
        showSay(b, 'coaxed');
        return;
      }
      b.anger = Math.max(0, angerNow(b) - T.COAX_DROP);
      b.angerAt = now();
      showSay(b, levelOf(b.anger) ? 'coaxed' : 'forgiven');
    }
    function busyCount(b) {
      return b.sessions.filter(function (s) { return s.pose && s.pose !== 'idle'; }).length;
    }
    function flip(b) {
      if (busyCount(b) < 2) return;
      b.side = b.side === 'left' ? 'right' : 'left';
      var asking = b.sessions.some(function (s) { return s.ask; });
      if (asking) show(b, 'asking', true);
      else setPose(b, (busyCount(b) >= 3 ? 'swamped' : 'busy') + '_' + b.side);
      arm(b, 'flip', T.MULTI_FLIP, function () { flip(b); });
    }
    function fidget(b) {
      arm(b, 'fidget', fidgetEvery, function () { fidget(b); });
      if (b.pose !== 'idle' && b.pose !== 'tired') return;
      var quiet = now() - b.lastActive;
      if (quiet > sleepAfter) {
        setPose(b, 'sleeping');
        say(b, pick(linesOf(b.id, 'sleeping')));
        return;
      }
      if (roll() > T.FIDGET_CHANCE) return;
      var pool = ['hum', 'stretch'];
      if (quiet > T.YAWN_AFTER) pool.push('yawn');
      show(b, pool[Math.floor(roll() * pool.length)], true);
    }
    function blink(b) {
      var ok = !reduced && (b.pose === 'idle' || b.pose === 'listening');
      ok = ok && now() - b.poseSince > T.BLINK_AFTER_SWAP;
      if (ok) {
        b.blinking = true;
        arm(b, 'blinkOff', T.BLINK_HOLD, function () { b.blinking = false; });
      }
      arm(b, 'blink', T.BLINK_BASE + roll() * T.BLINK_JITTER, function () { blink(b); });
    }
    function frame(b) {
      if (now() - b.poseSince > T.FRAME_AFTER) {
        b.frameIndex += 1;
        b.poseSince = now();
      }
      arm(b, 'frame', T.FRAME_CHECK, function () { frame(b); });
    }
    function ensure(id) {
      if (bots[id]) return bots[id];
      var b = bots[id] = {
        id: id, pose: 'idle', poseSince: now(), shownAt: now() - T.DWELL,
        line: '', blinking: false, anger: 0, angerAt: now(), sulking: false,
        coax: 0, lastActive: now(), toolCount: 0,
        working: false, asking: false, workPose: 'idle', shakingUntil: 0,
        frameIndex: 0, sessions: [], side: 'left', wobbleUntil: 0,
        greeted: {}, fest: {}, arms: {}, frozen: null, hidden: false,
        external: false, complained: null, lastTrouble: null
      };
      arm(b, 'fidget', fidgetEvery, function () { fidget(b); });
      arm(b, 'blink', T.BLINK_BASE + roll() * T.BLINK_JITTER, function () { blink(b); });
      arm(b, 'frame', T.FRAME_CHECK, function () { frame(b); });
      if (pageHidden) freeze(b);
      return b;
    }
    function touch(b) { b.lastActive = now(); b.external = true; }
    function gesture(id, kind) {
      var b = ensure(id);
      touch(b);
      if (b.pose === 'sleeping') {
        show(b, 'yawn', true);
        say(b, pick(linesOf(b.id, 'wake')));
        return;
      }
      if (kind === 'pat' && (b.sulking || angerNow(b) >= 20)) { coax(b); return; }
      show(b, kind === 'poke' ? 'surprised' : 'pat', true);
    }
    function event(id, name, source) {
      var b = ensure(id);
      if (source !== 'demo') b.external = true;
      b.lastActive = now();
      if (name === 'send') return onSend(b);
      if (name === 'thinking') {
        b.working = true; b.asking = false; b.workPose = 'thinking';
        watchStuck(b); show(b, 'thinking', false); return;
      }
      if (name === 'working') {
        b.toolCount += 1; b.working = true; b.asking = false; b.workPose = 'writing';
        watchStuck(b); show(b, 'writing', false); return;
      }
      if (name === 'tool-done') {
        b.working = true;
        watchStuck(b);
        disarm(b, 'think');
        arm(b, 'think', T.BACK_TO_THINKING, function () { show(b, 'thinking', false); });
        return;
      }
      if (name === 'done') return onDone(b);
      if (name === 'error') {
        b.lastTrouble = now();
        b.working = false;
        b.asking = false;
        show(b, 'oops', true);
        return;
      }
      if (name === 'idle') {
        b.working = false; b.asking = false; b.toolCount = 0; b.workPose = 'idle';
        show(b, 'idle', true);
      }
    }
    function shaken(id) {
      var b = ensure(id);
      b.lastActive = now();
      addAnger(b, T.ANGER_STEP);
      if (busyCount(b) >= 2) {
        complain(b, 'shakeMulti');
        b.wobbleUntil = now() + 1000;
        return;
      }
      if (b.asking) { complain(b, 'shakeAsk'); return; }
      show(b, 'dizzy', true);
      disarm(b, 'shakeEnd');
      if (b.working) {
        complain(b, 'shakeWork');
        b.shakingUntil = now() + T.SHAKE_WORK;
        arm(b, 'shakeEnd', T.SHAKE_WORK, function () { resumeWork(b); });
        return;
      }
      arm(b, 'shakeEnd', T.SHAKE_REACT, function () { react(b, false); });
    }
    function setSessions(id, list) {
      var b = ensure(id);
      var known = T.MOTION;
      b.sessions = (Array.isArray(list) ? list : []).map(function (s) {
        var pose = s && known[s.pose] ? s.pose : 'thinking';
        return { pose: pose, ask: !!(s && (s.ask || s.pose === 'asking')) };
      });
      b.asking = b.sessions.some(function (s) { return s.ask; });
      disarm(b, 'flip');
      if (busyCount(b) >= 2) flip(b);
      else if (b.asking) show(b, 'asking', true);
    }
    function arrive(id, date) {
      var b = ensure(id);
      if (b.working || (b.pose !== 'idle' && b.pose !== 'tired')) return;
      var when = date || new Date(now());
      var fest = T.festival(when);
      var part = T.period(when);
      if (fest) {
        if (b.fest[fest]) return;
        b.fest[fest] = 1;
        b.greeted[part] = 1;
        show(b, fest, true);
        return;
      }
      if (b.greeted[part]) return;
      b.greeted[part] = 1;
      show(b, 'greet_' + part, true);
    }
    function setPageHidden(on) {
      if (pageHidden === !!on) return;
      pageHidden = !!on;
      Object.keys(bots).forEach(function (id) {
        if (pageHidden) freeze(bots[id]);
        else thaw(bots[id]);
      });
    }
    function setReduced(on) { reduced = !!on; }
    function snapshot(id) {
      var b = ensure(id);
      var anger = readAnger(b);
      var pose = b.pose;
      var motion = (!reduced && !pageHidden && !b.hidden && T.MOTION[pose]) || '';
      return {
        pose: pose, motion: motion, line: b.line,
        blinking: !!(b.blinking && !reduced && !pageHidden && !b.hidden),
        anger: anger, angerLevel: levelOf(anger), sulking: b.sulking,
        frameIndex: b.frameIndex, pack: T.PACK[pose] || 'idle',
        hidden: pageHidden || b.hidden, reduced: reduced,
        sessions: b.sessions.map(function (s) { return { pose: s.pose, ask: s.ask }; }),
        side: b.side, wobble: now() < b.wobbleUntil, external: b.external,
        working: b.working, toolCount: b.toolCount
      };
    }
    return {
      event: event, pat: function (id) { gesture(id, 'pat'); },
      poke: function (id) { gesture(id, 'poke'); }, shaken: shaken,
      setSessions: setSessions, arrive: arrive, setPageHidden: setPageHidden,
      setReduced: setReduced, snapshot: snapshot, ensure: ensure
    };
  }
  root.HubPetMachine = { create: create };
})(window);
