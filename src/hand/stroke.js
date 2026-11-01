// Stroke gesture: counts direction reversals of a left-drag. A reversal counts when the segment of
// movement that just ended passed over the creature, so sweeping right across the creature and
// turning just past its edge still counts. Once `need` counted reversals fall inside `within`
// seconds the tracker fires and starts counting again from zero.
//
// Moves are view-pixel deltas. A direction only exists after `minTravel` px of movement, and a
// reversal needs `minTravel` px of movement the other way, so a 1 px tremor does not count.
// Pure: no game state, no DOM.

export function createStrokeTracker({ within = 1.2, need = 3, minTravel = 3, fullSpeed = 240 } = {}) {
  let seg = null; // { x, y } movement of the current segment
  let back = null; // { x, y } movement against the current segment, not yet a reversal
  let segTouched = false;
  let reversals = []; // sim times of counted reversals
  let moves = []; // { t, len } for the speed estimate

  const tracker = {
    get reversals() { return reversals.length; },
    reset() { seg = null; back = null; segTouched = false; reversals = []; moves = []; },
    /**
     * One pointer move of (dx, dy) view px at sim time t; touched = the pointer is over the
     * creature now. Returns { strength } when the stroke completes, else null.
     */
    move(dx, dy, t, touched) {
      const len = Math.hypot(dx, dy);
      if (len === 0) return null;
      moves.push({ t, len });
      while (moves.length && t - moves[0].t > within) moves.shift();
      if (!seg) { seg = { x: dx, y: dy }; segTouched = touched; return null; }
      if (dx * seg.x + dy * seg.y < 0) {
        back = back ? { x: back.x + dx, y: back.y + dy } : { x: dx, y: dy };
        if (Math.hypot(back.x, back.y) >= minTravel && Math.hypot(seg.x, seg.y) >= minTravel) {
          if (segTouched || touched) reversals.push(t);
          seg = back;
          back = null;
          segTouched = touched;
        }
      } else {
        if (back) { seg = { x: seg.x + back.x, y: seg.y + back.y }; back = null; }
        seg.x += dx; seg.y += dy;
        segTouched ||= touched;
      }
      while (reversals.length && t - reversals[0] > within) reversals.shift();
      if (reversals.length < need) return null;
      const span = Math.max(t - moves[0].t, 1 / 30);
      const speed = moves.reduce((a, m) => a + m.len, 0) / span;
      reversals = [];
      return { strength: Math.min(1, Math.max(0.2, speed / fullSpeed)) };
    },
  };
  return tracker;
}
