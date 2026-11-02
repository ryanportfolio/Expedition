// UI check: node only, no browser. Checks the HUD layout for 640x360, 640x323 and 480x360 views
// (every panel inside the view, clear of the central region and of each other), the state -> widget
// mapping (bar lengths, ticks, scale markers, belief split) for edge values, that a full render
// draws exactly the computed bar fills into the view buffer, the thought icons for every brain verb
// and target, the debug panel toggle, the win banner (once per session, Enter dismisses, a click only
// after the delay), the title flow (click or Enter -> 'play', one game-start), uiCapture over HUD
// panels, gating (no UI pixels with the screen unset, the title alone on 'title', the HUD in 'play'),
// that the HUD drawn through the engine's test LUT leaves no transparent pixel, the won meter (full,
// "converted by awe" / "converted by fear"), the build bar and placement flow through input.synth
// (keys 1-4 and slot clicks pick, red ghost and reason over water, straight from that refused click
// to a valid tile no refused reason remains, green ghost and a new blueprint on open village ground,
// no grab while a kind is picked, Esc and right click put it away), and that update() and the input handlers
// touch no DOM and never call Math.random.
// Exits 1 and prints each failing check.
//
//   node scripts/check-ui.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { registerPainters, getSprite, placeholderSprite } from '../src/art/registry.js';
import * as uiPainter from '../src/art/painters/ui.js';
import { idx } from '../src/art/palette.js';
import { VERBS, TARGETS } from '../src/creature/brain.js';
import { layout, captureRects, overlaps, contains, barFill, tickX, signedFill, beliefFill, POWER, ALIGN, RIVAL } from '../src/ui/layout.js';
import { FILL } from '../src/ui/hud.js';
import { thoughtView } from '../src/ui/bubble.js';
import { tableLines } from '../src/ui/debug.js';
import { count, drawText, measure } from '../src/ui/draw.js';
import { FONTS } from 'pixelfx';
import * as buildingPainter from '../src/art/painters/buildings.js';
import { BUILD_KINDS, costOf, reasonText, footprint } from '../src/ui/build.js';
import { KINDS } from '../src/village/config.js';
import { makeTestLut } from '../src/dev/test-art.js';

registerPainters(uiPainter);
registerPainters(buildingPainter); // the placement ghost is the building's own sprite
const { createGame } = await import('../src/game.js');

let failed = 0, passed = 0;
const ok = (cond, msg) => {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${msg}`); }
  return !!cond;
};
const section = (name, fn) => {
  try { fn(); } catch (err) { failed++; console.log(`FAIL [${name}] threw: ${err?.stack || err}`); }
};
const DT = 1 / 30;
const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;

// view (game px) -> device size at scale 3, dpr 1
const VIEWS = [[640, 360], [640, 323], [480, 360]];
function newGame({ view = [640, 360], creature = false, screen = 'play' } = {}) {
  const game = createGame({ seed: 2 });
  game.display.setDevice(view[0] * 3, view[1] * 3, 1);
  if (screen) game.state.screen = screen; // the UI draws only in play; node games start with it unset
  if (creature) { game.systems.village.setup(); game.systems.creature.setup(); }
  return game;
}
const run = (game, seconds) => game.clock.run(Math.max(1, Math.round(seconds / DT)), game.tick);

// ------------------------------------------------------------------ layout
section('layout', () => {
  for (const [W, H] of VIEWS) {
    for (const opts of [{}, { creature: true, weak: true, debug: true }, { creature: false, debug: true }, { creature: true, weak: true, debug: true, build: true }, { creature: false, build: true }]) {
      const L = layout(W, H, opts);
      const tag = `${W}x${H} ${JSON.stringify(opts)}`;
      ok(L.center.x === W / 4 && L.center.w === W / 2 && L.center.y === H / 4 && L.center.h === H / 2, `${tag}: center region is the middle half`);
      const rects = captureRects(L);
      ok(rects.length >= 3, `${tag}: at least the three top panels`);
      for (const [name, r] of Object.entries({ power: L.power, align: L.align, rival: L.rival, creature: L.creature, weakTab: L.weakTab, debug: L.debug, banner: L.banner, build: L.build })) {
        if (!r) continue;
        ok(inside(r, W, H), `${tag}: ${name} ${JSON.stringify(r)} inside the view`);
        ok(!overlaps(r, L.center), `${tag}: ${name} ${JSON.stringify(r)} clear of the center region ${JSON.stringify(L.center)}`);
      }
      const panels = [L.power, L.align, L.rival, L.creature, L.debug, L.build].filter(Boolean);
      if (opts.build) ok(L.buildSlots.length === 4 && L.buildSlots.every((r) => contains(L.build, r.x, r.y) && contains(L.build, r.x + r.w - 1, r.y + r.h - 1)), `${tag}: four build slots inside the bar`);
      for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
        ok(!overlaps(panels[i], panels[j]), `${tag}: panels ${i} and ${j} do not overlap`);
      }
      if (L.banner) for (const p of panels) ok(!overlaps(L.banner, p), `${tag}: the win banner covers no panel`);
    }
  }
  // a top row too narrow for three panels drops the alignment scale to a second row
  const narrow = layout(300, 200);
  ok(narrow.align.y > narrow.power.y + narrow.power.h && !overlaps(narrow.align, narrow.power) && !overlaps(narrow.align, narrow.rival), 'narrow view: alignment scale moves below the top row');
  // the layout check itself rejects a rect in the center (the checks above would see it)
  ok(overlaps({ x: 300, y: 170, w: 10, h: 10 }, layout(640, 360).center), 'overlap test catches a rect in the center');
});

// ------------------------------------------------------------------ value mapping
section('value mapping', () => {
  const inner = POWER.bar.w;
  ok(barFill(0, 100, inner) === 0 && barFill(100, 100, inner) === inner && barFill(25, 100, inner) === 16 && barFill(60, 100, inner) === 38, 'power 0 / 100 / 25 / 60 -> 0 / 64 / 16 / 38 px');
  ok(barFill(150, 100, inner) === inner && barFill(-5, 100, inner) === 0 && barFill(NaN, 100, inner) === 0 && barFill(undefined, 100, inner) === 0, 'power past the cap, negative, NaN and missing clamp');
  ok(barFill(50, 0, inner) === 0, 'zero capacity fills nothing');
  ok(tickX(15, 100, inner) === 9 && tickX(20, 100, inner) === 12 && tickX(30, 100, inner) === 18 && tickX(100, 100, inner) === 63 && tickX(0, 100, inner) === 0, 'cost ticks sit on the last pixel the cost fills');
  const w = ALIGN.scale.w;
  const a = (v) => signedFill(v, w);
  ok(a(-1).fill === -32 && a(-1).caret === 0, `alignment -1: full evil, caret at the left end (${JSON.stringify(a(-1))})`);
  ok(a(0).fill === 0 && a(0).caret === 32, `alignment 0: empty, caret at the centre (${JSON.stringify(a(0))})`);
  ok(a(1).fill === 32 && a(1).caret === 63, `alignment +1: full good, caret at the right end (${JSON.stringify(a(1))})`);
  ok(a(0.4).fill === 13 && a(-0.4).fill === -13 && a(5).fill === 32 && a(NaN).fill === 0, 'alignment 0.4 / -0.4 / 5 / NaN -> 13 / -13 / 32 / 0');
  const bi = RIVAL.bar.w;
  const b = (v, mix) => beliefFill(v, mix, bi);
  ok(b(0, { impress: 0, scare: 0 }).fill === 0, 'belief 0: empty');
  ok(b(1, { impress: 1, scare: 0 }).impress === bi && b(1, { impress: 1, scare: 0 }).scare === 0, 'belief 1 by awe alone: all impress');
  ok(b(1, { impress: 0, scare: 1 }).scare === bi && b(1, { impress: 0, scare: 1 }).impress === 0, 'belief 1 by fear alone: all scare');
  const half = b(0.5, { impress: 0.3, scare: 0.2 });
  ok(half.fill === 28 && half.impress === 17 && half.scare === 11, `belief 0.5 split 3:2 -> 28 = 17 + 11 (${JSON.stringify(half)})`);
  ok(b(0.55, 'garbage').fill === 31 && b(NaN, null).fill === 0, 'bad mix and NaN belief do not throw');
});

// ------------------------------------------------------------------ icons
section('thought icons', () => {
  for (const v of VERBS) ok(getSprite('ui-verb', { verb: v }) !== placeholderSprite(), `verb icon for ${v}`);
  for (const t of TARGETS) ok(getSprite('ui-target', { target: t }) !== placeholderSprite(), `target icon for ${t}`);
  for (const k of ['glow', 'jag']) ok(getSprite('ui-mark', { kind: k }) !== placeholderSprite(), `mark ${k}`);
  for (const s of [1, 2]) ok(getSprite('ui-bubble', { slots: s }) !== placeholderSprite(), `bubble with ${s} slots`);
  ok(getSprite('ui-verb', { verb: 'teleport' }) === placeholderSprite(), 'an unknown verb falls back to the placeholder (so the checks above can fail)');
  const tv = thoughtView({ key: 'eat:grain', judged: 'eat:villager', feedback: 'slap' });
  ok(tv.verb === 'eat' && tv.target === 'villager' && tv.mark === 'jag', `after a slap the judged action shows with the jagged mark (${JSON.stringify(tv)})`);
  const tv2 = thoughtView({ key: 'water:field', judged: 'water:field', feedback: null });
  ok(tv2.verb === 'water' && tv2.target === 'field' && tv2.mark === null, 'without feedback the current action shows, no mark');
  ok(thoughtView({ key: 'haul:wood', judged: 'haul:wood', feedback: 'stroke' }).mark === 'glow', 'a stroke shows the glow mark');
  ok(thoughtView({ key: null, judged: null }) === null && thoughtView(null) === null, 'no action, no bubble');
});

// ------------------------------------------------------------------ render matches state
function renderCheck(view, st) {
  const game = newGame({ view, creature: true });
  Object.assign(game.state, st);
  const cs = game.systems.creature;
  game.events.emit('stroke', { creatureId: cs.entity.id, strength: 1 });
  run(game, DT);
  game.renderer.render();
  const ui = game.systems.ui, last = ui.last, buf = game.renderer.view.data, { w: W, h: H } = game.display;
  const lut = game.renderer.lut;
  const tag = `${W}x${H}`;
  ok(W === view[0] && H === view[1], `${tag}: view size`);
  const hud = last.hud;
  const P = hud.power;
  const wantP = barFill(st.power, 100, POWER.bar.w);
  ok(P.fill === wantP, `${tag}: power ${st.power} -> ${P.fill} px (want ${wantP})`);
  const body = { ...P.rect, y: P.rect.y + 1, h: P.rect.h - 1 }, top = { ...P.rect, h: 1 };
  const cBody = lut[idx(...FILL.power.slice(0, 2))], cLit = lut[idx(FILL.power[0], FILL.power[2])];
  ok(count(buf, W, H, body, cBody) === wantP * (P.rect.h - 1) && count(buf, W, H, top, cLit) === wantP, `${tag}: power bar pixels in the frame = ${wantP} columns`);
  const A = hud.align, wantA = signedFill(st.alignment, ALIGN.scale.w).fill;
  // Both fills are counted on every frame: a negative alignment draws only the evil fill, so a check
  // of the good fill alone (0 px wanted) would pass a frame with no fill at all.
  const goodBody = lut[idx(FILL.good[0], FILL.good[1])], evilBody = lut[idx(FILL.evil[0], FILL.evil[1])];
  const aBody = { ...A.rect, y: A.rect.y + 1, h: A.rect.h - 1 };
  const goodPx = count(buf, W, H, aBody, goodBody), evilPx = count(buf, W, H, aBody, evilBody);
  ok(A.fill === wantA && goodPx === Math.max(0, wantA) * aBody.h && evilPx === Math.max(0, -wantA) * aBody.h,
    `${tag}: alignment ${st.alignment} -> ${A.fill} px fill in the frame (want ${wantA}; good ${goodPx} px, evil ${evilPx} px)`);
  const R = hud.rival, wantR = beliefFill(st.belief, st.beliefMix, RIVAL.bar.w);
  const rb = { ...R.rect, y: R.rect.y + 1, h: R.rect.h - 1 };
  ok(R.fill === wantR.fill && count(buf, W, H, rb, R.impressColor) === wantR.impress * rb.h && count(buf, W, H, rb, R.scareColor) === wantR.scare * rb.h,
    `${tag}: belief ${st.belief} -> ${wantR.impress} awe + ${wantR.scare} fear px in the frame`);
  const needs = cs.state().needs;
  for (const [n, d] of Object.entries(hud.creature.needs)) {
    const want = barFill(needs[n], 1, d.rect.w);
    ok(d.fill === want && count(buf, W, H, { ...d.rect, y: d.rect.y + 1, h: d.rect.h - 1 }, d.color) >= want * (d.rect.h - 1), `${tag}: ${n} ${needs[n].toFixed(3)} -> ${d.fill} px`);
  }
  ok(hud.creature.lean.fill === signedFill(cs.brain.alignmentLean(), 28).fill, `${tag}: creature lean marker matches the brain (${cs.brain.alignmentLean().toFixed(3)})`);
  ok(last.bubble && last.bubble.view.mark === 'glow', `${tag}: after a stroke the bubble shows the glow mark (${JSON.stringify(last.bubble?.view)})`);
  return game;
}
section('render matches state', () => {
  const st = { power: 60, alignment: 0.4, belief: 0.55, beliefMix: { impress: 0.35, scare: 0.2 } };
  for (const v of VIEWS) renderCheck(v, st);
  renderCheck([640, 360], { power: 0, alignment: -1, belief: 0, beliefMix: { impress: 0, scare: 0 } });
  renderCheck([640, 360], { power: 100, alignment: 1, belief: 1, beliefMix: { impress: 0, scare: 1 } });
  renderCheck([640, 360], { power: 25, alignment: 0, belief: 0.5, beliefMix: { impress: 0.25, scare: 0.25 } });
});

section('weak tab', () => {
  const game = newGame({ creature: true });
  const cs = game.systems.creature;
  game.renderer.render();
  ok(!game.systems.ui.last.hud.creature.weak && !game.systems.ui.layout().weakTab, 'a fed creature shows no weak tab');
  cs.debug.holdHunger = 1;
  cs.debug.candidateFilter = (c) => c.key === 'idle:none'; // no meal resets the starving clock
  run(game, cs.brain.params.weakAfter + 10);
  game.renderer.render();
  const L = game.systems.ui.layout(), last = game.systems.ui.last;
  ok(cs.brain.weak && last.hud.creature.weak && L.weakTab, 'a starving, weak creature shows the weak tab');
  const hot = game.renderer.lut[idx('fire', 1)];
  ok(L.weakTab && count(game.renderer.view.data, game.display.w, game.display.h, L.weakTab, hot) > 20, 'the tab is painted');
});

// ------------------------------------------------------------------ debug panel
section('debug panel', () => {
  const game = newGame({ creature: true });
  const cs = game.systems.creature, ui = game.systems.ui;
  run(game, 10); // let it pick and do a few actions, then judge the latest
  game.events.emit('slap', { creatureId: cs.entity.id, strength: 1 });
  run(game, DT);
  ok(!ui.layout().debug, 'debug panel starts closed');
  game.input.synth.keyDown('Backquote'); game.input.synth.keyUp('Backquote');
  ok(ui.debugOpen && ui.layout().debug, 'backquote opens it');
  game.renderer.render();
  const d = ui.last.debug, table = cs.brain.table();
  ok(d && d.total === tableLines(table).length && d.total > 0, `it lists the brain table (${d?.total} lines for ${table.rows.length} rows)`);
  ok(d.rows.every((r) => table.rows.some((t) => t.key === r.key && t.situation === r.situation && t.forbidden === r.forbidden)), 'every drawn row is a table row with its forbidden flag');
  // a short view truncates and scrolls
  const g2 = newGame({ view: [480, 200], creature: true });
  const brain = g2.systems.creature.brain;
  let t = 1000, i = 0;
  for (const n of ['hunger', 'fatigue', 'boredom']) for (const level of [0.1, 0.5, 0.9]) for (const k of ['eat:grain', 'throw:rock', 'haul:wood', 'water:field', 'smash:building']) {
    for (const m of ['hunger', 'fatigue', 'boredom']) brain.needs[m] = 0;
    brain.needs[n] = level;
    brain.recordAction(k, t);
    brain.feedback(i++ % 3 ? 'stroke' : 'slap', 1, t);
    t += 60; // past the credit window: each feedback lands on this action only
  }
  const ui2 = g2.systems.ui;
  ui2.debugOpen = true;
  g2.renderer.render();
  const d2 = ui2.last.debug;
  ok(d2 && d2.total > 40 && d2.shown < d2.total && inside(ui2.layout().debug, 480, 200), `short view: the panel truncates to fit (${d2?.shown} of ${d2?.total} lines)`);
  const first = d2.rows[0]?.key + d2.rows[0]?.situation;
  g2.input.synth.keyDown('PageDown'); g2.input.synth.keyUp('PageDown');
  g2.renderer.render();
  ok(ui2.last.debug.scroll === 4 && ui2.last.debug.rows[0]?.key + ui2.last.debug.rows[0]?.situation !== first, `PageDown scrolls it (scroll ${ui2.last.debug.scroll})`);
  for (let k = 0; k < 40; k++) { g2.input.synth.keyDown('PageDown'); g2.input.synth.keyUp('PageDown'); }
  g2.renderer.render();
  ok(ui2.last.debug.scroll + ui2.last.debug.shown === ui2.last.debug.total, 'scrolling stops at the last line');
  game.input.synth.keyDown('Backquote'); game.input.synth.keyUp('Backquote');
  ok(!ui.debugOpen && !ui.layout().debug, 'backquote closes it');
});

// ------------------------------------------------------------------ win banner
section('win banner', () => {
  const game = newGame();
  const ui = game.systems.ui, s = game.input.synth;
  run(game, 1);
  ok(!ui.bannerOpen, 'no banner before the win');
  game.state.won = true; game.state.wonHow = 'scare';
  run(game, DT);
  ok(ui.bannerOpen && game.state.uiCapture === true, 'won -> the banner opens and holds the pointer');
  game.renderer.render();
  ok(ui.last.banner === true, 'the banner is drawn');
  s.move(320, 300); s.down(0); s.up(0);
  ok(ui.bannerOpen, 'a click in its first second does not dismiss it');
  s.keyDown('Enter'); s.keyUp('Enter');
  ok(!ui.bannerOpen && game.state.uiCapture === false, 'Enter dismisses it and releases the pointer');
  game.state.won = false; run(game, DT);
  game.state.won = true; run(game, DT);
  game.renderer.render();
  ok(!ui.bannerOpen && ui.last.banner === false, 'it never appears again in the session');
  // click after the delay
  const g2 = newGame();
  g2.state.won = true; g2.state.wonHow = 'impress';
  run(g2, 1.2);
  g2.input.synth.move(320, 300); g2.input.synth.down(0); g2.input.synth.up(0);
  ok(!g2.systems.ui.bannerOpen, 'a click after a second dismisses it');
});

// ------------------------------------------------------------------ title flow
section('title flow', () => {
  const game = newGame({ screen: null });
  const ui = game.systems.ui, s = game.input.synth;
  ok(game.state.screen === undefined && game.state.uiCapture === false, 'node (no canvas): starts with the screen unset, not on the title, holding no input');
  const starts = [];
  game.events.on('game-start', (p) => starts.push(p));
  game.state.screen = 'title';
  run(game, DT);
  ok(game.state.uiCapture === true, 'title holds the pointer');
  game.renderer.render();
  ok(ui.last.title && !ui.last.hud, 'title drawn, HUD hidden');
  const rock = game.world.query({ kind: 'rock' })[0];
  const v = game.camera.worldToView(rock.x, rock.y, rock.z ?? game.world.heightAt(rock.x, rock.y));
  s.move(v.sx, v.sy - 3);
  run(game, DT);
  s.down(0);
  ok(game.state.screen === 'play' && starts.length === 1, `a click starts play and emits game-start once (${starts.length})`);
  ok(game.systems.hand.state.heldId === null, 'the starting click grabs nothing');
  s.up(0);
  s.down(0); s.up(0);
  s.keyDown('Enter'); s.keyUp('Enter');
  ok(starts.length === 1, 'later clicks and Enter emit nothing more');
  game.state.screen = 'title';
  s.keyDown('Enter'); s.keyUp('Enter');
  ok(game.state.screen === 'play' && starts.length === 2, 'Enter also starts play from the title');
});

// ------------------------------------------------------------------ uiCapture
section('uiCapture over HUD panels', () => {
  const game = newGame({ creature: true });
  const L = game.systems.ui.layout(), s = game.input.synth;
  for (const [name, r] of [['power', L.power], ['align', L.align], ['rival', L.rival], ['creature', L.creature]]) {
    s.move(r.x + 2, r.y + 2);
    ok(game.state.uiCapture === true, `pointer over the ${name} panel captures`);
    ok(contains(r, r.x + 2, r.y + 2), `${name} contains its own corner`);
  }
  s.move(320, 180);
  ok(game.state.uiCapture === false, 'pointer over the world does not');
  s.leave();
  ok(game.state.uiCapture === false, 'pointer outside the window does not');
  game.state.uiCapture = true;
  ok(game.state.uiCapture === true, 'assigning true pins it');
  game.state.uiCapture = null;
  ok(game.state.uiCapture === false, 'assigning null hands it back');
});

// ------------------------------------------------------------------ gating: UI only in play
// Frame with the ui system's draw replaced by a no-op: what the world alone puts in the view.
function worldOnly(game) {
  const ui = game.systems.ui, real = ui.draw;
  ui.draw = () => {};
  game.renderer.render();
  ui.draw = real;
  return Uint32Array.from(game.renderer.view.data);
}
const sameFrame = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
section('gating: UI only in play', () => {
  const game = newGame({ creature: true, screen: null });
  const ui = game.systems.ui, s = game.input.synth, st = game.state;
  st.power = 60; st.belief = 0.5; st.won = true; st.wonHow = 'impress';
  run(game, DT);
  const bare = worldOnly(game);
  game.renderer.render();
  ok(st.screen === undefined, 'screen starts unset');
  ok(!ui.last.hud && !ui.last.bubble && !ui.last.build && !ui.last.title && ui.last.banner === false && !ui.last.debug, 'screen unset: no HUD, bubble, build bar, title or banner');
  ok(sameFrame(game.renderer.view.data, bare), 'screen unset: the frame equals the world-only frame (no UI pixels)');
  const L = ui.layout();
  s.move(L.power.x + 2, L.power.y + 2);
  ok(st.uiCapture === false && !ui.bannerOpen, 'screen unset: the HUD rects and a won game hold no input');
  s.keyDown('Digit1'); s.keyUp('Digit1');
  ok(!ui.build.open, 'screen unset: key 1 picks nothing to build');
  ui.debugOpen = true;
  game.renderer.render();
  ok(!ui.last.debug && sameFrame(Uint32Array.from(game.renderer.view.data), worldOnly(game)), 'screen unset: the debug panel stays hidden too');
  ui.debugOpen = false;
  st.screen = 'title';
  run(game, DT);
  game.renderer.render();
  ok(ui.last.title && !ui.last.hud && !ui.last.build && !ui.last.bubble && !ui.bannerOpen, 'title: title only (no HUD, bubble, build bar or banner)');
  for (const [name, r] of [['power', L.power], ['rival', L.rival], ['creature', L.creature]]) {
    const n = count(game.renderer.view.data, game.display.w, game.display.h, r, game.renderer.lut[idx('ui-parchment', 5)]);
    ok(n < 10, `title: no ${name} panel body in the frame (${n} parchment pixels)`);
  }
  st.screen = 'play';
  run(game, DT);
  game.renderer.render();
  ok(ui.last.hud && ui.last.build && ui.last.bubble, 'play: HUD, build bar and bubble drawn');
  ok(ui.bannerOpen && ui.last.banner === true, 'play: a game won before play opens its banner once play starts');
  for (const [name, r] of [['power', L.power], ['rival', L.rival], ['creature', L.creature], ['build', ui.layout().build]]) {
    const n = count(game.renderer.view.data, game.display.w, game.display.h, r, game.renderer.lut[idx('ui-parchment', 5)]);
    ok(n > 100, `play: the ${name} panel is in the frame (${n} parchment pixels)`);
  }
  ok(!sameFrame(Uint32Array.from(game.renderer.view.data), worldOnly(game)), 'play: the frame differs from the world-only frame');
});

section('HUD drawn through the engine test LUT stays opaque', () => {
  const game = newGame({ creature: true });
  run(game, DT);
  game.renderer.lut = makeTestLut();
  game.systems.ui.debugOpen = true;
  game.state.won = true; run(game, DT);
  game.systems.ui.pickBuild('house');
  game.input.synth.move(320, 200);
  game.renderer.render();
  const buf = game.renderer.view.data;
  let clear = 0;
  for (const v of buf) if (v >>> 24 !== 255) clear++;
  ok(game.systems.ui.last.hud && game.systems.ui.last.debug && game.systems.ui.last.build, 'HUD, debug panel and build bar drawn');
  ok(clear === 0, `every view pixel opaque (${clear} transparent)`);
  const planted = new Uint32Array(256); planted.set(makeTestLut().subarray(0, 33)); // the old 32-entry LUT
  game.renderer.lut = planted;
  game.renderer.render();
  let clear2 = 0;
  for (const v of game.renderer.view.data) if (v >>> 24 !== 255) clear2++;
  ok(clear2 > 0, `control: the old LUT (only indices 1..32 set) leaves transparent pixels (${clear2})`);
});

// ------------------------------------------------------------------ win: belief full, converted
section('win banner belief', () => {
  for (const [mix, how] of [[{ impress: 0.35, scare: 0.2 }, 'impress'], [{ impress: 0, scare: 0 }, 'scare'], [{ impress: 0, scare: 0 }, 'impress']]) {
    const game = newGame({ creature: true });
    const st = game.state;
    run(game, DT);
    const pin = () => { st.belief = 0.55; st.beliefMix = mix; };
    pin(); game.renderer.render();
    const before = game.systems.ui.last.hud.rival;
    ok(before.fill === beliefFill(0.55, mix, RIVAL.bar.w).fill && !before.won && before.label === null, `not won: belief 0.55 fills ${before.fill} px, no converted label`);
    st.won = true; st.wonHow = how;
    run(game, DT); pin();
    game.renderer.render();
    const R = game.systems.ui.last.hud.rival, buf = game.renderer.view.data, { w: W, h: H } = game.display;
    const rb = { ...R.rect, y: R.rect.y + 1, h: R.rect.h - 1 };
    const filled = (count(buf, W, H, rb, R.impressColor) + count(buf, W, H, rb, R.scareColor)) / rb.h;
    const tag = `won by ${how}, mix ${JSON.stringify(mix)}`;
    ok(game.systems.ui.bannerOpen && R.won && R.belief === 1 && R.fill === RIVAL.bar.w, `${tag}: the banner is up and the meter reads full (${R.fill} of ${RIVAL.bar.w} px) though belief is 0.55`);
    ok(filled === RIVAL.bar.w, `${tag}: ${filled} filled columns in the frame`);
    const wantLabel = how === 'scare' ? 'converted by fear' : 'converted by awe';
    ok(R.label === wantLabel, `${tag}: the panel labels the village ${wantLabel} (${R.label})`);
    if (!(mix.impress + mix.scare)) ok(how === 'scare' ? R.scare === RIVAL.bar.w : R.impress === RIVAL.bar.w, `${tag}: with no mix recorded the full bar takes the winning side's colour`);
  }
});

// ------------------------------------------------------------------ build menu
section('build bar and placement', () => {
  for (const k of BUILD_KINDS) {
    ok(getSprite('ui-build', { kind: k }) !== placeholderSprite(), `build icon for ${k}`);
    ok(costOf(k) === KINDS[k].cost && costOf(k) > 0, `${k} costs ${costOf(k)} wood (village config)`);
  }
  ok(getSprite('ui-icon', { name: 'wood' }) !== placeholderSprite(), 'wood icon');
  ok(getSprite('ui-build', { kind: 'castle' }) === placeholderSprite(), 'an unknown build icon falls back to the placeholder');
  ok(reasonText('water') === 'cannot build on water' && reasonText('out of range (outside the village influence)') === 'too far from your village' && reasonText('something new') === 'something new', 'village reasons read as player text');

  const game = newGame({ creature: true });
  const { world, camera, events } = game;
  const ui = game.systems.ui, vs = game.systems.village, s = game.input.synth, st = game.state;
  run(game, DT);
  const grabs = [], placed = [];
  events.on('grab', (p) => grabs.push(p.entityId));
  events.on('building-placed', (p) => placed.push(p));
  game.renderer.render();
  const L = ui.layout();
  // the bar is drawn with its four kinds and their costs
  const bar = ui.last.build;
  ok(bar && bar.slots.map((x) => x.kind).join() === BUILD_KINDS.join() && bar.slots.every((x) => x.cost === KINDS[x.kind].cost), `bar shows ${bar?.slots.map((x) => `${x.kind}:${x.cost}`).join(' ')}`);
  // keys 1-4 pick, the same key again puts it away
  s.keyDown('Digit1'); s.keyUp('Digit1');
  ok(ui.build.kind === 'house' && st.uiCapture === true, 'key 1 picks house and the UI holds the pointer');
  s.keyDown('Digit1'); s.keyUp('Digit1');
  ok(ui.build.kind === null, 'key 1 again puts it away');
  s.keyDown('Numpad4'); s.keyUp('Numpad4');
  ok(ui.build.kind === 'woodpile', 'numpad 4 picks woodpile');
  // a click on a slot picks that kind
  const slot = L.buildSlots[0];
  s.move(slot.x + 5, slot.y + 5);
  ok(st.uiCapture === true, 'pointer over the build bar captures');
  s.down(0); s.up(0);
  ok(ui.build.kind === 'house', `a click on slot 1 picks house (${ui.build.kind})`);
  game.renderer.render();
  ok(ui.last.build.slots[0].picked && ui.last.build.tip, 'the picked slot is drawn pressed and a tip shows above the bar');

  // aim the pointer at the centre of tile (tx, ty), returns the tile the pointer resolves to
  const aim = (tx, ty) => {
    const z = world.heightAt(tx + 0.5, ty + 0.5);
    camera.centerOn(tx + 0.5, ty + 0.5, z);
    run(game, DT);
    const v = camera.worldToView(tx + 0.5, ty + 0.5, z);
    s.move(v.sx, v.sy);
    run(game, DT);
    const p = game.input.pointer;
    return p.hit ? { tx: Math.floor(p.x), ty: Math.floor(p.y) } : null;
  };
  // water: red ghost, the reason, a click plans nothing
  let water = null;
  for (let ty = 2; ty < world.h - 2 && !water; ty++) for (let tx = 2; tx < world.w - 2 && !water; tx++) {
    if (world.tile(tx, ty).ground !== 1) continue;
    const at = aim(tx, ty);
    if (at && world.tile(at.tx, at.ty).ground <= 1) water = at;
  }
  ok(!!water, `found a water tile under the pointer (${JSON.stringify(water)})`);
  game.renderer.render();
  const hw = ui.build.hover, gw = ui.last.ghost;
  ok(hw && !hw.ok && hw.reason === 'water', `over water: invalid, reason "${hw?.reason}"`);
  ok(gw && !gw.ok && gw.ramp === 'fire' && gw.drawn > 50 && gw.label === 'cannot build on water', `red ghost drawn (${gw?.drawn} px, ${gw?.ramp}) with the reason "${gw?.label}"`);
  const fireIdx = new Set(Array.from({ length: 8 }, (_, i) => game.renderer.lut[idx('fire', i)]));
  let red = 0;
  if (gw) for (let y = Math.max(0, gw.rect.y); y < Math.min(game.display.h, gw.rect.y + gw.rect.h); y++) for (let x = Math.max(0, gw.rect.x); x < Math.min(game.display.w, gw.rect.x + gw.rect.w); x++) if (fireIdx.has(game.renderer.view.data[y * game.display.w + x])) red++;
  ok(red > 50, `red ghost pixels in the frame (${red})`);
  // the reason sits straight on the world: every text pixel's eight neighbours are text or the ink
  // outline, so no ground colour (sand, grass, water) ever touches a letter
  {
    const text = game.renderer.lut[idx('fire', 7)], ink = game.renderer.lut[idx('ui-ink', 0)];
    const lr = gw?.labelRect, V = game.renderer.view.data, VW = game.display.w, VH = game.display.h;
    let lit = 0, bare = 0;
    if (lr) for (let y = lr.y; y < lr.y + lr.h; y++) for (let x = lr.x; x < lr.x + lr.w; x++) {
      if (V[y * VW + x] !== text) continue;
      lit++;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < VW && ny < VH && V[ny * VW + nx] !== text && V[ny * VW + nx] !== ink) bare++;
      }
    }
    ok(lr && lit > 40 && bare === 0, `the reason text is ringed by its ink outline (${lit} text px, ${bare} touching ground; rect ${JSON.stringify(lr)})`);
  }
  const sites0 = vs.stats().player.sites;
  s.down(0); s.up(0);
  run(game, DT);
  ok(placed.length === 0 && vs.stats().player.sites === sites0, 'a click on water plans nothing');
  ok(ui.build.lastTry && !ui.build.lastTry.ok && ui.build.lastTry.reason === 'water' && vs.lastReason === 'water', `the refused click keeps the reason (${ui.build.lastTry?.reason})`);
  game.renderer.render();
  ok(ui.last.build.tip && /water/i.test(ui.last.build.tip.text) && ui.last.build.tip.bad, `the tip shows why (${ui.last.build.tip?.text})`);
  const refusedAt = game.clock.time;

  // a valid tile near the village: green ghost, a click plans a blueprint there
  const site = world.sites.village;
  let good = null;
  for (let r = 2; r < 9 && !good; r++) for (let dy = -r; dy <= r && !good; dy++) for (let dx = -r; dx <= r && !good; dx++) {
    const tx = Math.floor(site.x) + dx, ty = Math.floor(site.y) + dy;
    if (!vs.validate('house', tx, ty, 'player').ok) continue;
    const at = aim(tx, ty);
    if (at && vs.validate('house', at.tx, at.ty, 'player').ok) good = at;
  }
  ok(!!good, `found a valid house tile near the village (${JSON.stringify(good)})`);
  game.renderer.render();
  const hg = ui.build.hover, gg = ui.last.ghost;
  ok(hg && hg.ok && hg.tx === good.tx && hg.ty === good.ty, `over ${JSON.stringify(good)}: valid`);
  ok(gg && gg.ok && gg.ramp === 'heal' && gg.drawn > 50 && gg.label === null, `green ghost drawn (${gg?.drawn} px, ${gg?.ramp}), no reason`);
  // straight from the refused water click to this tile, well inside the message time: the reason
  // shown must describe the tile under the ghost, so no refused text may remain (ghost or tip strip)
  const since = game.clock.time - refusedAt, tipG = ui.last.build.tip;
  ok(since < 1, `the valid tile was reached ${since.toFixed(2)} s after the refused click, inside the message time`);
  ok(tipG && !tipG.bad && !/water|cannot/i.test(tipG.text) && /click to plan/.test(tipG.text), `right after a refused click, over a valid tile the tip describes this tile ("${tipG?.text}", bad ${tipG?.bad})`);
  const fp = footprint('house', good.tx, good.ty);
  const want = camera.worldToView(fp.cx, fp.cy, world.heightAt(fp.cx, fp.cy));
  const spr = getSprite('house', { owner: 'player', stage: 'done' });
  ok(gg && gg.rect.x === want.sx - spr.ax && gg.rect.y === want.sy - spr.ay, 'the ghost sits where the building will stand (sprite anchor on the footprint centre)');
  const solid = spr.data.filter((v) => v).length;
  ok(gg && gg.drawn < solid * 0.8 && gg.drawn > solid * 0.4, `the ghost is dithered: ${gg?.drawn} of ${solid} sprite pixels drawn`);
  s.down(0); s.up(0);
  run(game, DT);
  const b = placed.length === 1 ? world.get(placed[0].buildingId) : null;
  ok(b && b.kind === 'building' && b.type === 'house' && b.owner === 'player' && b.stage === 'blueprint' && b.tx === fp.ox && b.ty === fp.oy, `the click planned a player house blueprint at ${fp.ox},${fp.oy} (${b && `${b.type} ${b.owner} ${b.stage} ${b.tx},${b.ty}`})`);
  ok(vs.stats().player.sites === sites0 + 1 && ui.build.placed.length === 1 && ui.build.lastTry.ok, `village sites ${sites0} -> ${vs.stats().player.sites}`);
  ok(ui.build.kind === 'house', 'the kind stays picked for the next plan');

  // a rock under the pointer while the bar is open: no grab
  const rock = world.query({ kind: 'rock' })[0];
  camera.centerOn(rock.x, rock.y, rock.z);
  run(game, DT);
  const rv = camera.worldToView(rock.x, rock.y, rock.z);
  s.move(rv.sx, rv.sy - (rock.sprite ? Math.floor(rock.sprite.ay / 2) : 2));
  run(game, DT);
  s.down(0); run(game, 0.2);
  ok(game.systems.hand.state.heldId === null && !rock.held, 'with a kind picked, a press on a rock grabs nothing');
  s.up(0); run(game, DT);

  // Esc and right click put the plan away; the hand then works again
  s.keyDown('Escape'); s.keyUp('Escape');
  ok(ui.build.kind === null && st.uiCapture === false, 'Esc puts the plan away and releases the pointer');
  game.renderer.render();
  ok(!ui.last.ghost, 'no ghost once put away');
  s.keyDown('Digit2'); s.keyUp('Digit2');
  ok(ui.build.kind === 'field', 'key 2 picks field');
  s.down(2); s.up(2);
  ok(ui.build.kind === null, 'a right click puts it away');
  ok(grabs.length === 0, `the hand grabbed nothing during the build flow (${JSON.stringify(grabs)})`);
  s.down(0); run(game, 0.2);
  ok(game.systems.hand.state.heldId === rock.id, 'control: with nothing picked the same press grabs the rock');
  s.up(0); run(game, DT);
  // the banner puts a picked plan away
  s.keyDown('Digit3'); s.keyUp('Digit3');
  st.won = true; run(game, DT);
  ok(ui.bannerOpen && ui.build.kind === null, 'the win banner puts a picked plan away');
});

// ------------------------------------------------------------------ small font letters
// Rule (what a reader uses to tell the 3x5 capitals apart at 1x):
//   H has a crossbar: a full-width row in its middle three rows. W has no full-width row anywhere;
//   instead its centre column is empty in the top two rows and inked lower down (the middle notch: a
//   centre stroke rising from the bottom), and its bottom row has empty outer corners (pointed feet,
//   where H stands on two stems). M is the reverse of W: its centre column is inked in the middle row
//   and empty in the bottom two rows (the stroke hangs from the top), and it has no full-width row.
//   Every pair of W, H, M, N, V differs in width or in at least 3 pixels.
// The masks come from drawText itself (the UI's real text path). The same rule must reject
// pixelfx's own mini W, H and M, which is what this round replaced; that keeps the rule honest.
section('small font letters', () => {
  const maskOf = (ch) => {
    const ctx = { buf: new Uint32Array(16 * 9), w: 16, h: 9, lut: [] };
    const w = drawText(ctx, ch, 1, 1, 1);
    const rows = [];
    for (let r = 0; r < 5; r++) rows.push(Array.from({ length: w }, (_, k) => ctx.buf[(r + 1) * 16 + 1 + k] ? 1 : 0));
    let stray = 0;
    for (let i = 0; i < ctx.buf.length; i++) {
      const x = i % 16, y = (i / 16) | 0;
      if (ctx.buf[i] && (x < 1 || x > w || y < 1 || y > 5)) stray++;
    }
    return { w, rows, stray };
  };
  const rawMask = (ch) => { const g = FONTS.mini.glyphs[ch]; return { w: g.w, rows: g.rows.map((r) => Array.from(r, (v) => (v ? 1 : 0))), stray: 0 }; };
  const full = (m) => m.rows.map((r, i) => (r.every(Boolean) ? i : -1)).filter((i) => i >= 0);
  const mid = (m) => m.w >> 1;
  const col = (m, c) => m.rows.map((r) => r[c]);
  function ruleFails({ W, H, M }) {
    const bad = [];
    if (!full(H).some((i) => i >= 1 && i <= 3)) bad.push('H has no crossbar');
    if (full(W).length) bad.push(`W has a full-width row (${full(W)})`);
    const wc = col(W, mid(W));
    if (wc[0] || wc[1] || !(wc[2] || wc[3])) bad.push(`W has no centre stroke rising from the bottom (${wc.join('')})`);
    const wb = W.rows[4];
    if (wb[0] || wb[W.w - 1]) bad.push(`W's bottom row stands on its outer stems (${wb.join('')})`);
    const mc = col(M, mid(M));
    if (!mc[2] || mc[3] || mc[4]) bad.push(`M's centre stroke does not hang from the top (${mc.join('')})`);
    if (full(M).length) bad.push(`M has a full-width row (${full(M)})`);
    return bad;
  }
  const L = Object.fromEntries(['W', 'H', 'M', 'N', 'V'].map((c) => [c, maskOf(c)]));
  const show = (m) => m.rows.map((r) => r.map((v) => (v ? '#' : '.')).join('')).join('/');
  for (const [c, m] of Object.entries(L)) ok(m.w === measure(c) && m.stray === 0 && m.rows.flat().some(Boolean), `${c}: drawn ${m.w} px wide inside its measured box (${show(m)})`);
  const fails = ruleFails(L);
  ok(fails.length === 0, `W, H and M read as themselves at the small size (${fails.join('; ') || 'ok'})`);
  const raw = ruleFails({ W: rawMask('W'), H: rawMask('H'), M: rawMask('M') });
  ok(raw.length > 0, `the rule rejects pixelfx's own mini W/M (${raw.join('; ')})`);
  const names = Object.keys(L);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = L[names[i]], b = L[names[j]];
    let diff = 0;
    if (a.w === b.w) for (let r = 0; r < 5; r++) for (let k = 0; k < a.w; k++) diff += a.rows[r][k] !== b.rows[r][k] ? 1 : 0;
    ok(a.w !== b.w || diff >= 3, `${names[i]} and ${names[j]} differ in width or in at least 3 pixels (${a.w}/${b.w} wide, ${diff} px)`);
  }
  ok(measure('AWE') === 3 + 1 + 5 + 1 + 3 && measure('WATER') === 5 + 4 * 4, `text widths follow the wider letters (AWE ${measure('AWE')}, WATER ${measure('WATER')})`);
});

// ------------------------------------------------------------------ DOM-free and deterministic
section('update and input handlers touch no DOM and never call Math.random', () => {
  const game = newGame({ creature: true });
  const names = ['window', 'document', 'requestAnimationFrame', 'HTMLCanvasElement', 'navigator', 'localStorage', 'location'];
  const saved = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  const touched = [];
  for (const n of names) Object.defineProperty(globalThis, n, { configurable: true, get() { touched.push(n); return undefined; } });
  const realRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => { randomCalls++; return realRandom(); };
  void globalThis.window; Math.random();
  ok(touched.length === 1 && randomCalls === 1, 'traps count planted accesses');
  touched.length = 0; randomCalls = 0;
  const ui = game.systems.ui, s = game.input.synth;
  let threw = null;
  // only the ui's own code runs here (the creature brain's choice is seeded, but the brain is not
  // under test): update, the key and pointer handlers, the capture getter
  try {
    for (let i = 0; i < 30; i++) ui.update(DT);
    game.state.won = true; ui.update(DT);
    s.keyDown('Backquote'); s.keyUp('Backquote');
    s.keyDown('PageDown'); s.keyUp('PageDown');
    s.keyDown('Enter'); s.keyUp('Enter');
    game.state.screen = 'title'; s.down(0); s.up(0);
    s.move(10, 10); void game.state.uiCapture;
  } catch (err) { threw = err; }
  Math.random = realRandom;
  for (const n of names) { const d = saved.get(n); if (d) Object.defineProperty(globalThis, n, d); else delete globalThis[n]; }
  ok(!threw, `ui ran without throwing (${threw})`);
  ok(touched.length === 0, `no DOM globals read (${[...new Set(touched)].join(', ')})`);
  ok(randomCalls === 0, `no Math.random calls (${randomCalls})`);
  const files = ['src/systems/ui.js', 'src/art/painters/ui.js', ...readdirSync('src/ui').map((n) => `src/ui/${n}`)];
  for (const f of files) {
    const code = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(!/Math\.random/.test(code), `${f}: no Math.random`);
    ok(!/\b(window|document|requestAnimationFrame|getContext|location)\b/.test(code), `${f}: no DOM access`);
  }
});

console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
