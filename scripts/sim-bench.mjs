// Node bench for crowd cost (no browser): builds the island with a town of hundreds round each
// village (src/dev/town.js, as the perf scene does), lets it settle, then times sim ticks per system
// and renders of a 640 x 360 view over the player town (terrain, systems draw, collect, sort+blit).
// Frame timing itself is scripts/perf-check.mjs in headed Chrome; this bench isolates the CPU work
// so a change can be measured in seconds, deterministically.
//
//   node scripts/sim-bench.mjs [--town <n>] [--rival <n>] [--seed <n>] [--settle <s>] [--seconds <s>]
//
// Prints medians, p95 and max in ms. Exit 0 always: a measuring tool, not a gate.
import { createGame } from '../src/game.js';
import { TOWN, buildTown } from '../src/dev/town.js';
import { makeLut } from '../src/art/lut.js';

const warn = console.warn;
console.warn = (...a) => { if (!String(a[0]).startsWith('art registry:')) warn(...a); };

const o = { town: TOWN.player, rival: TOWN.rival, seed: 1, settle: 30, seconds: 20 };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, ''), v = Number(process.argv[i + 1]);
  if (!(k in o) || !Number.isFinite(v) || v < 0) throw new Error(`bad argument ${process.argv[i]} ${process.argv[i + 1]}`);
  o[k] = v;
}
const pct = (l, p) => { const s = [...l].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };
const fmt = (l) => `median ${pct(l, 50).toFixed(2)}, p95 ${pct(l, 95).toFixed(2)}, max ${Math.max(...l).toFixed(2)}`;

const game = createGame({ seed: o.seed });
const { world, systems } = game;
let t = performance.now();
systems.village.setup();
systems.creature.setup();
buildTown(game, 'player', o.town, () => false);
buildTown(game, 'rival', o.rival, () => false);
console.log(`setup + towns ${(performance.now() - t).toFixed(0)} ms; map ${world.w}x${world.h}, ${world.entities.size} entities`);
t = performance.now();
game.clock.run(Math.round(o.settle * 30), game.tick);
console.log(`settle ${o.settle} s of sim: ${(performance.now() - t).toFixed(0)} ms`);

// per-system tick times
const sysT = Object.fromEntries(game.systemOrder.map((n) => [n, []]));
for (const n of game.systemOrder) {
  const s = systems[n], fn = s.update;
  s.update = (dt) => { const a = performance.now(); fn.call(s, dt); sysT[n].push(performance.now() - a); };
}
const ticks = [];
const tick = game.tick;
for (let i = 0; i < o.seconds * 30; i++) { const a = performance.now(); tick(1 / 30); ticks.push(performance.now() - a); }
const count = (owner) => world.query({ kind: 'villager' }).filter((v) => v.owner === owner && !v.dying).length;
console.log(`villagers: player ${count('player')}, rival ${count('rival')}; ${world.entities.size} entities`);
console.log(`tick: ${fmt(ticks)} ms`);
for (const n of game.systemOrder) console.log(`  ${n.padEnd(10)} ${fmt(sysT[n])}`);

// renders of the player town (no present: node has no canvas)
game.display.setDevice(1920, 1080, 1);
game.renderer.lut = makeLut(0);
const v = world.sites.village;
game.camera.centerOn(v.x + 0.5, v.y + 0.5, world.heightAt(v.x, v.y));
const r = game.renderer, list = r.list;
const phase = { render: [], sortBlit: [], drawItems: [], systems: [] };
let sysAcc = 0;
for (const n of game.systemOrder) {
  const s = systems[n], fn = s.draw;
  s.draw = (ctx) => { const a = performance.now(); fn.call(s, ctx); sysAcc += performance.now() - a; };
}
const draw = list.draw;
list.draw = (ctx) => { const a = performance.now(); draw.call(list, ctx); phase.sortBlit.push(performance.now() - a); phase.drawItems.push(list.items.length); };
for (let i = 0; i < 60; i++) { game.tick(1 / 30); sysAcc = 0; const a = performance.now(); r.render(); phase.render.push(performance.now() - a); phase.systems.push(sysAcc); }
console.log(`render 640x360: ${fmt(phase.render)} ms; systems draw ${fmt(phase.systems)} ms; sort+blit ${fmt(phase.sortBlit)} ms over ${pct(phase.drawItems, 50)} items`);
