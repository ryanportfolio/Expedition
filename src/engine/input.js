// Input state. DOM listeners (attach) and scenario code (synth) feed the same internal calls, so
// a scenario drives exactly the code path a real mouse does. Screen positions are view pixels
// (game pixels from the canvas top-left); world positions come from input.toWorld, which game.js
// points at the camera's height-aware pick.
//
// Events on game.events: pointer-down / pointer-up { button, sx, sy, x, y }, drag-start / drag-end
// { button, sx, sy, x, y, startSx, startSy, vx, vy }, wheel { dy }, key-down / key-up { code }.

const VELOCITY_WINDOW_MS = 100;
const DRAG_THRESHOLD = 3; // view px
const BUTTONS = [[1, 0], [2, 2], [4, 1], [8, 3], [16, 4]]; // [buttons bit, button number]

export function createInput(events) {
  const samples = [];
  const input = {
    /** Time source in ms; scenarios swap in sim time so velocity is deterministic. */
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    /** (sx, sy) -> { x, y, z } world point under a view pixel, or null. Set by game.js. */
    toWorld: () => null,
    pointer: {
      sx: 0, sy: 0, // view px
      x: 0, y: 0, z: 0, hit: false, // world tiles (front-most terrain hit)
      inside: false,
      buttons: 0, // bitmask: 1 left, 2 right, 4 middle
      vsx: 0, vsy: 0, // view px / s over the last ~100 ms
      vx: 0, vy: 0, // world tiles / s over the last ~100 ms
      drag: null, // { button, startSx, startSy, startX, startY, active }
    },
    /** Accumulated wheel delta since the camera last consumed it (negative = zoom in). */
    wheel: 0,
    keys: new Set(),

    // ---- internal entry points (DOM and synthetic share these)
    move(sx, sy) {
      const p = input.pointer;
      p.sx = sx; p.sy = sy; p.inside = true;
      resolveWorld();
      sample();
      const d = p.drag;
      if (d && !d.active && Math.hypot(sx - d.startSx, sy - d.startSy) >= DRAG_THRESHOLD) {
        d.active = true;
        events.emit('drag-start', payload(d.button));
      }
    },
    down(button = 0) {
      const p = input.pointer;
      p.buttons |= bit(button);
      if (!p.drag) p.drag = { button, startSx: p.sx, startSy: p.sy, startX: p.x, startY: p.y, active: false };
      events.emit('pointer-down', payload(button));
    },
    up(button = 0) {
      const p = input.pointer;
      p.buttons &= ~bit(button);
      if (p.drag && p.drag.button === button) {
        if (p.drag.active) events.emit('drag-end', payload(button));
        p.drag = null;
      }
      events.emit('pointer-up', payload(button));
    },
    leave() { input.pointer.inside = false; },
    /**
     * Ends every held press without a gesture: a window blur, a lost pointer capture or a cancelled
     * pointer. The velocity samples are dropped first, so each pointer-up reports no speed and
     * the hand drops what it carries where it is. Before round 46 these went through the ordinary
     * release, which kept the speed of the last moves: alt-tabbing out mid-carry threw the villager
     * (and a fast one died on landing).
     */
    cancel() {
      const p = input.pointer;
      samples.length = 0;
      p.vsx = p.vsy = p.vx = p.vy = 0;
      for (const [b, n] of BUTTONS) if (p.buttons & b) input.up(n);
    },
    addWheel(dy) {
      // the camera keeps a remainder under one zoom step; turning the wheel the other way drops it
      if (dy * input.wheel < 0) input.wheel = 0;
      input.wheel += dy;
      events.emit('wheel', { dy });
    },
    keyDown(code) {
      if (input.keys.has(code)) return;
      input.keys.add(code);
      events.emit('key-down', { code });
    },
    keyUp(code) {
      if (!input.keys.delete(code)) return;
      events.emit('key-up', { code });
    },
    /** Re-resolve the world point (the camera moved under a still pointer). Called once per tick. */
    refresh() { resolveWorld(); sample(); },

    /** Synthetic API for scenarios: screen coordinates are view px. */
    synth: null,

    /**
     * Browser only: wire DOM events. toView(clientX, clientY) -> { sx, sy } in view px.
     *
     * Pointer events are read on the window, not the canvas. The canvas covers view * scale device
     * px, so when the window size is not a multiple of the scale (1366, 1600, 2560 wide at scale 3)
     * a strip under one game pixel wide at the right and bottom shows the page instead. A mouse
     * pushed against the window edge sits in that strip: listening on the canvas, it fired
     * pointerleave there and edge panning stopped (round 42). Positions are clamped to the view, so
     * the strip counts as the last column or row, and the pointer leaves only when it leaves the
     * window (pointerout with no element to go to).
     *
     * Buttons follow e.buttons on every pointer event. Pointer events fire pointerdown only for the
     * first button pressed and pointerup only for the last one released; a second button pressed or
     * released while another is held arrives as a pointermove (Chrome). Reading only e.button on
     * down/up lost those changes, and the hand stayed holding after both buttons were up (round 42).
     * Every bit that differs from the tracked mask becomes one up() or down() call.
     *
     * A lost pointer capture, a cancelled pointer or a window blur ends every held press through
     * cancel(), with no pointer speed (round 46). A blur also takes the pointer out of the window:
     * the mouse may be over another window by then, and a pointer left inside kept edge panning
     * from its last position. A lost capture does not: it also fires after every ordinary
     * pointerup, when the pointer is still over the game.
     */
    attach(canvas, win, toView) {
      const at = (e) => {
        const v = toView(e.clientX, e.clientY);
        const w = canvas.width || 1, h = canvas.height || 1; // the canvas buffer is the view
        return { sx: Math.min(Math.max(v.sx, 0), w - 1), sy: Math.min(Math.max(v.sy, 0), h - 1) };
      };
      const sync = (now) => {
        const was = input.pointer.buttons;
        for (const [b, n] of BUTTONS) if ((was & b) && !(now & b)) input.up(n); // releases first
        for (const [b, n] of BUTTONS) if (!(was & b) && (now & b)) input.down(n);
      };
      const pointer = (e) => {
        const v = at(e);
        input.move(v.sx, v.sy);
        sync(e.buttons ?? 0);
      };
      win.addEventListener('pointermove', pointer);
      win.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture?.(e.pointerId);
        pointer(e);
        if (e.button === 1) e.preventDefault(); // no autoscroll on the middle button
      });
      win.addEventListener('pointerup', pointer);
      win.addEventListener('pointercancel', () => input.cancel());
      canvas.addEventListener('lostpointercapture', () => input.cancel());
      // a middle press added to a held button fires no pointerdown, only the mouse event
      win.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
      win.addEventListener('pointerout', (e) => { if (!e.relatedTarget) input.leave(); });
      win.addEventListener('contextmenu', (e) => e.preventDefault());
      win.addEventListener('wheel', (e) => { e.preventDefault(); input.addWheel(e.deltaY); }, { passive: false });
      win.addEventListener('keydown', (e) => input.keyDown(e.code));
      win.addEventListener('keyup', (e) => input.keyUp(e.code));
      win.addEventListener('blur', () => { for (const k of [...input.keys]) input.keyUp(k); input.cancel(); input.leave(); });
    },
  };

  input.synth = {
    move: (sx, sy) => input.move(sx, sy),
    down: (button = 0) => input.down(button),
    up: (button = 0) => input.up(button),
    wheel: (dy) => input.addWheel(dy),
    keyDown: (code) => input.keyDown(code),
    keyUp: (code) => input.keyUp(code),
    leave: () => input.leave(),
    cancel: () => input.cancel(),
  };

  function bit(button) { return button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 1 << button; }

  function resolveWorld() {
    const p = input.pointer;
    const w = input.toWorld(p.sx, p.sy);
    p.hit = !!w;
    if (w) { p.x = w.x; p.y = w.y; p.z = w.z; }
  }

  function sample() {
    const p = input.pointer;
    const t = input.now();
    samples.push({ t, sx: p.sx, sy: p.sy, x: p.x, y: p.y });
    while (samples.length > 1 && t - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
    const a = samples[0], b = samples[samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt > 0) {
      p.vsx = (b.sx - a.sx) / dt; p.vsy = (b.sy - a.sy) / dt;
      p.vx = (b.x - a.x) / dt; p.vy = (b.y - a.y) / dt;
    } else if (samples.length === 1) {
      p.vsx = p.vsy = p.vx = p.vy = 0;
    }
  }

  function payload(button) {
    const p = input.pointer, d = p.drag;
    return {
      button, sx: p.sx, sy: p.sy, x: p.x, y: p.y, z: p.z,
      startSx: d?.startSx, startSy: d?.startSy, startX: d?.startX, startY: d?.startY,
      vx: p.vx, vy: p.vy, vsx: p.vsx, vsy: p.vsy,
    };
  }

  return input;
}
