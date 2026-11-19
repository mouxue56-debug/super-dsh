/* Copyright (c) 2026 lokicorvus and CrossPet contributors. MIT License.
   Shake detection adapted from CrossPet app/mac/DragView.swift.
   The window-drag half is not included. Full notice: LICENSE-crosspet.txt. */
(function (root) {
  function create(now) {
    var tracking = false, swingX = 0, swingDir = 0, swings = [], said = -1e15;
    function start(x) {
      tracking = true;
      swingX = x;
      swingDir = 0;
      swings = [];
    }
    function stop() { tracking = false; }
    function move(x) {
      if (!tracking) return false;
      var t = now();
      if (swingDir === 0) {
        if (Math.abs(x - swingX) > 18) {
          swingDir = x > swingX ? 1 : -1;
          swingX = x;
        }
        return false;
      }
      if ((x - swingX) * swingDir > 0) {
        swingX = x;
        return false;
      }
      if ((swingX - x) * swingDir > 18) {
        swingDir = -swingDir;
        swingX = x;
        swings.push(t);
        swings = swings.filter(function (s) { return t - s < 900; });
        if (swings.length >= 2 && t - said > 300) {
          said = t;
          return true;
        }
      }
      return false;
    }
    return { start: start, stop: stop, move: move };
  }
  root.HubPetShake = { create: create };
})(window);
