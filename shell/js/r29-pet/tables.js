/* Copyright (c) 2026 lokicorvus and CrossPet contributors. MIT License.
   Timings and motion names adapted from CrossPet app/web/index.html.
   Full notice: LICENSE-crosspet.txt. No character art. */
(function (root) {
  var MOTION = {
    idle: 'm-bob', listening: 'm-hop', thinking: 'm-rock', reading: 'm-rock',
    writing: 'm-bob', running: 'm-quick', searching: 'm-sway', delegating: 'm-sway',
    happy: 'm-jump', proud: 'm-hop', oops: 'm-shake', surprised: 'm-jolt',
    pat: 'm-sway', sleeping: 'm-slow', tired: 'm-slow', hum: 'm-sway',
    stretch: 'm-squish', yawn: 'm-squish', drawing: 'm-rock', asking: 'm-hop',
    annoyed: 'm-rock', puffed: 'm-jolt', redhot: 'm-angry', sulk: 'm-slow',
    dizzy: 'm-dizzy', coaxed: 'm-sway', forgiven: 'm-hop', sorry: 'm-slow',
    greet_morning: 'm-hop', greet_noon: 'm-bob', greet_afternoon: 'm-sway',
    greet_evening: 'm-sway', greet_night: 'm-slow', greet_dawn: 'm-slow',
    fest_halloween: 'm-gift', fest_christmas: 'm-gift', fest_newyear: 'm-jump',
    fest_national: 'm-hop',
    busy_left: 'm-quick', busy_right: 'm-quick',
    swamped_left: 'm-shake', swamped_right: 'm-shake'
  };
  var TRANSIENT = {
    happy: 5000, proud: 6000, oops: 4000, surprised: 3000, pat: 4000,
    hum: 4000, stretch: 3200, yawn: 3000, annoyed: 4500, puffed: 5000,
    dizzy: 3000, coaxed: 3500, forgiven: 5000
  };
  var PACK = {
    idle: 'idle', listening: 'waiting', thinking: 'thinking', reading: 'research',
    writing: 'working', running: 'working', searching: 'research',
    delegating: 'working', drawing: 'working', happy: 'done', proud: 'done',
    oops: 'confused', surprised: 'poke', pat: 'poke', sleeping: 'sleep',
    tired: 'drowsy', hum: 'idleB', stretch: 'idleB', yawn: 'drowsy',
    asking: 'waiting', annoyed: 'confused', puffed: 'confused', redhot: 'confused',
    sulk: 'confused', dizzy: 'confused', coaxed: 'poke', forgiven: 'done',
    sorry: 'confused', greet_morning: 'greet', greet_noon: 'greet',
    greet_afternoon: 'greet', greet_evening: 'greet', greet_night: 'greet',
    greet_dawn: 'greet', fest_halloween: 'greet', fest_christmas: 'greet',
    fest_newyear: 'greet', fest_national: 'greet',
    busy_left: 'working', busy_right: 'working',
    swamped_left: 'working', swamped_right: 'working'
  };
  var NOT_WORKING = {
    idle: 1, sleeping: 1, asking: 1, tired: 1, happy: 1, proud: 1,
    oops: 1, surprised: 1
  };
  function transient(pose) {
    if (TRANSIENT[pose]) return TRANSIENT[pose];
    if (pose.indexOf('greet_') === 0) return 5500;
    if (pose.indexOf('fest_') === 0) return 6500;
    return 0;
  }
  function period(date) {
    var h = date.getHours();
    if (h >= 23 || h < 2) return 'night';
    if (h < 5) return 'dawn';
    if (h < 11) return 'morning';
    if (h < 14) return 'noon';
    if (h < 18) return 'afternoon';
    return 'evening';
  }
  function festival(date) {
    var m = date.getMonth() + 1, d = date.getDate();
    if (m === 10 && d === 31) return 'fest_halloween';
    if (m === 12 && (d === 24 || d === 25)) return 'fest_christmas';
    if (m === 1 && d === 1) return 'fest_newyear';
    if (m === 10 && d >= 1 && d <= 7) return 'fest_national';
    return '';
  }
  function nightQuiet(date) {
    var h = date.getHours();
    return h >= 23 || h < 5;
  }
  root.HubPetTables = {
    MOTION: MOTION, PACK: PACK, NOT_WORKING: NOT_WORKING,
    DWELL: 2500, BACK_TO_THINKING: 1500, LISTEN_TO_THINKING: 1800,
    SLEEP_AFTER: 600000, STUCK_AFTER: 180000, TROUBLE_WINDOW: 180000,
    FIDGET_EVERY: 20000, FIDGET_CHANCE: 0.42, YAWN_AFTER: 180000,
    BLINK_BASE: 3000, BLINK_JITTER: 3500, BLINK_HOLD: 140, BLINK_AFTER_SWAP: 600,
    FRAME_CHECK: 2000, FRAME_AFTER: 8000,
    ANGER_STEP: 7, ANGER_DECAY: 2, SHAKE_REACT: 900, SHAKE_WORK: 1200,
    SULK_AFTER: 3500, SULK_CALM: 45000, COAX_DROP: 25, COAX_NEEDED: 3,
    PROUD_TOOLS: 8, MULTI_FLIP: 1500, COMPLAIN_FOR: 3500,
    transient: transient, period: period, festival: festival, nightQuiet: nightQuiet
  };
})(window);
