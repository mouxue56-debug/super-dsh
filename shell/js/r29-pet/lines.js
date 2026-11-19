/* Generic lines only. No character persona and no assistant id. */
(function (root) {
  var GENERIC = {
    idle: ['在呢', '有什么要做的吗'],
    listening: ['我在听'],
    thinking: ['让我想想'],
    reading: ['我看看'],
    writing: ['我来写'],
    running: ['跑一下'],
    searching: ['查一下'],
    delegating: ['分一头去做'],
    drawing: ['我画一下'],
    happy: ['做好了'],
    proud: ['这个比较大，做好了'],
    oops: ['出错了'],
    surprised: ['诶？'],
    pat: ['嘿嘿'],
    sleeping: ['zZz'],
    tired: ['有点累了'],
    hum: ['哼～'],
    stretch: ['伸个懒腰'],
    yawn: ['哈啊'],
    annoyed: ['别晃了'],
    puffed: ['再晃我要生气了'],
    redhot: ['气死了'],
    sulk: ['哼'],
    dizzy: ['晕'],
    coaxed: ['好吧'],
    forgiven: ['原谅你了'],
    asking: ['等你一下'],
    sorry: ['我改一下'],
    wake: ['唔…你回来啦'],
    workAnnoyed: ['干活时别晃'],
    workPuffed: ['干活时别这样晃'],
    workRedhot: ['干完了也不想理你'],
    shakeMulti: ['我已经够忙了'],
    shakeAsk: ['别晃，先回答我'],
    shakeWork: ['别晃，我在做事'],
    greet_morning: ['早上好'],
    greet_noon: ['中午好'],
    greet_afternoon: ['下午好'],
    greet_evening: ['晚上好'],
    greet_night: ['夜深了'],
    greet_dawn: ['还没睡呀'],
    fest_halloween: ['今天有节日'],
    fest_christmas: ['今天有节日'],
    fest_newyear: ['新的一年'],
    fest_national: ['这几天是节日']
  };
  var custom = {};
  function cleanList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) { return typeof s === 'string'; }).map(function (s) {
      return s.replace(/[<>&]/g, '').slice(0, 80);
    }).filter(Boolean);
  }
  function linesFor(id, pose) {
    var own = id && custom[id] && custom[id][pose];
    if (own && own.length) return own.slice();
    return (GENERIC[pose] || []).slice();
  }
  function setLines(id, table) {
    if (typeof id !== 'string' || !id || !table || typeof table !== 'object') return;
    var next = {};
    Object.keys(table).forEach(function (key) {
      var list = cleanList(table[key]);
      if (list.length) next[key] = list;
    });
    custom[id] = next;
  }
  root.HubPetLines = { linesFor: linesFor, setLines: setLines, generic: GENERIC };
})(window);
