/* Pose cues adapted in idea from CrossPet app/web/effects.js (MIT).
   Copyright (c) 2026 lokicorvus and CrossPet contributors.
   Full notice: LICENSE-crosspet.txt. Drawn here as short marks, not their SVG. */
(function (root) {
  var MARK = {
    thinking: 'think', listening: 'listen', reading: 'read', writing: 'write',
    running: 'run', searching: 'search', happy: 'happy', proud: 'happy',
    oops: 'oops', surprised: 'surprise', pat: 'pat', sleeping: 'sleep',
    hum: 'hum', yawn: 'yawn', redhot: 'hot', puffed: 'hot', annoyed: 'hot',
    dizzy: 'dizzy', coaxed: 'pat', forgiven: 'happy', asking: 'listen'
  };
  function mark(pose) {
    if (MARK[pose]) return MARK[pose];
    if (pose.indexOf('greet_') === 0 || pose.indexOf('fest_') === 0) return 'greet';
    if (pose.indexOf('busy_') === 0 || pose.indexOf('swamped_') === 0) return 'busy';
    return '';
  }
  root.HubPetFx = { mark: mark };
})(window);
