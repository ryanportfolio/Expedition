// Scenario runner for ?scenario=<name>&seed=<n>. The rAF loop stays paused; the scenario advances the
// sim itself through the helper `t`. Progress and results live on window.__scenario, which
// scripts/browser-check.mjs polls. Screenshots: t.shot(name) calls window.__harnessShot(name) when
// the harness has exposed it and waits for it to finish.
//
// A scenario file is src/dev/scenarios/<name>.js with `export default async function (t, game) {}`.

/**
 * Pass rule for a finished scenario, shared with scripts/browser-check.mjs: no error, at least one
 * assert and every assert true, at least one screenshot. Round 46: `asserts.every(ok)` passed a
 * scenario that asserted nothing and took no screenshot, so an empty or stubbed-out scenario
 * passed the browser gate. Every scenario asserts and takes a screenshot (the harness checks each
 * screenshot pixel by pixel), so a scenario with neither checked nothing.
 */
export function scenarioOk({ error, asserts, shots }) {
  return !error && asserts.length > 0 && asserts.every((a) => a.ok) && shots.length > 0;
}

export async function runScenario(game, name, seed = 1) {
  // Vite expands the glob at build time; it sits in here so node checks can import scenarioOk.
  const SCENARIOS = import.meta.glob('./scenarios/*.js');
  game.stop();
  const state = { name, seed, done: false, ok: false, asserts: [], logs: [], shots: [], error: null, view: null };
  window.__scenario = state;
  game.scenario = state;
  game.input.now = () => game.clock.time * 1000; // velocity in sim time: deterministic

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const toScreen = (x, y, z) => game.camera.worldToView(x, y, z ?? game.world.heightAt(x, y));
  const at = (x, y, o = {}) => (o.world ? toScreen(x, y, o.z) : { sx: x, sy: y });
  const s = game.input.synth;

  const t = {
    game,
    /** Advance the sim by whole fixed ticks covering `seconds`, then render once. Returns ticks run. */
    step(seconds = game.clock.step) {
      const n = Math.max(1, Math.round(seconds / game.clock.step));
      game.clock.run(n, game.tick);
      game.renderer.render();
      return n;
    },
    /** Render, let the browser present it, and ask the harness for a screenshot named `name`. */
    async shot(name) {
      game.renderer.render();
      await nextFrame();
      await nextFrame();
      if (typeof window.__harnessShot === 'function') await window.__harnessShot(name);
      state.shots.push({ name, view: { w: game.display.w, h: game.display.h, scale: game.display.scale, zoom: game.display.zoom } });
    },
    assert(cond, msg) {
      state.asserts.push({ ok: !!cond, msg: String(msg) });
      if (!cond) console.warn(`[scenario] assert failed: ${msg}`);
      return !!cond;
    },
    log(...args) {
      state.logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    },
    /** Synthetic input. Coordinates are view px unless { world: true[, z] } is passed. */
    input: {
      toScreen,
      move(x, y, o) { const p = at(x, y, o); s.move(p.sx, p.sy); return p; },
      down(button = 0) { s.down(button); },
      up(button = 0) { s.up(button); },
      wheel(dy) { s.wheel(dy); },
      keyDown(code) { s.keyDown(code); },
      keyUp(code) { s.keyUp(code); },
      leave() { s.leave(); },
      /** Hold a key for `seconds` of sim time. */
      key(code, seconds = 0.2) { s.keyDown(code); t.step(seconds); s.keyUp(code); },
      /** Press at `from`, move to `to` over `seconds` (one move per tick), release. */
      drag(from, to, { button = 0, seconds = 0.3, world = false } = {}) {
        const a = at(from[0], from[1], { world, z: from[2] }), b = at(to[0], to[1], { world, z: to[2] });
        s.move(a.sx, a.sy);
        s.down(button);
        t.step(game.clock.step);
        const n = Math.max(1, Math.round(seconds / game.clock.step));
        for (let i = 1; i <= n; i++) {
          s.move(Math.round(a.sx + ((b.sx - a.sx) * i) / n), Math.round(a.sy + ((b.sy - a.sy) * i) / n));
          t.step(game.clock.step);
        }
        s.up(button);
      },
    },
  };

  try {
    const load = SCENARIOS[`./scenarios/${name}.js`];
    if (!load) throw new Error(`unknown scenario "${name}"; available: ${Object.keys(SCENARIOS).join(', ')}`);
    const mod = await load();
    game.renderer.render();
    await mod.default(t, game);
    state.ok = scenarioOk(state);
  } catch (err) {
    state.error = String(err?.stack || err);
    state.ok = false;
    console.error(`[scenario] ${name} threw: ${state.error}`);
  }
  const d = game.display;
  state.view = { w: d.w, h: d.h, scale: d.scale, zoom: d.zoom, devW: d.devW, devH: d.devH, dpr: d.dpr };
  state.done = true;
  return state;
}
