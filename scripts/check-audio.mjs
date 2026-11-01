// Audio checks in node, no Web Audio: the event-to-sound map, rate limiting, voice caps, distance
// attenuation, mute, first-gesture unlock with fake windows, and that update(dt) touches no DOM.
// Synthesis itself is rendered and measured in the browser scenario (src/dev/scenarios/audio.js).
//
//   node scripts/check-audio.mjs
//
// Exit 0 when every check passes; otherwise prints each failing check and exits 1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/game.js';
import { screenToWorld } from '../src/world/iso.js';
import { SOUNDS, SOUND_IDS } from '../src/audio/sounds.js';
import { LIMITS, AUDIO } from '../src/audio/config.js';
import { AUDIO_EVENTS, mapEvent } from '../src/audio/map.js';
import { attenuate, createSoundQueue } from '../src/audio/queue.js';
import { muteFlag } from '../src/audio/player.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let passed = 0;
function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
  return !!cond;
}
function section(name, fn) {
  try { fn(); } catch (err) { failures.push(`${name}: threw ${err?.stack || err}`); }
}
const STEP = 1 / 30;

/** 16 x 16 map: x < 8 is land at height 4, x >= 8 is water (height 1, sea level 2). */
function testMap() {
  const w = 16, h = 16, n = w * h;
  const height = new Uint8Array(n), ground = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    height[y * w + x] = x < 8 ? 4 : 1;
    ground[y * w + x] = x < 8 ? 3 : 0;
  }
  return { w, h, seaLevel: 2, height, ground };
}
function newGame() {
  const game = createGame({ seed: 1, worldSize: 16 });
  game.world.loadMap(testMap());
  return game;
}
const audioOf = (game) => game.systems.audio;
/** Emit events, run one tick, return the sound ids accepted in that tick. */
function emitTick(game, list) {
  const a = audioOf(game);
  const before = a.history.length;
  for (const [type, payload] of list) game.events.emit(type, payload);
  game.tick(STEP);
  return a.history.slice(before).map((r) => r.sound);
}

// ---------------------------------------------------------------------------
section('tables', () => {
  for (const id of SOUND_IDS) {
    ok(LIMITS[id], `LIMITS has an entry for sound ${id}`);
    ok(typeof SOUNDS[id].play === 'function' && SOUNDS[id].play.length >= 2, `${id}: play(ctx, dest, params)`);
    const d0 = SOUNDS[id].duration(0), d1 = SOUNDS[id].duration(1);
    ok(d0 > 0 && d1 > 0 && d1 <= 3, `${id}: duration in (0, 3] s (got ${d0}, ${d1})`);
  }
  for (const id of Object.keys(LIMITS)) ok(SOUNDS[id], `LIMITS entry ${id} names a real sound`);
});

section('event map', () => {
  const game = newGame();
  const { world } = game;
  const villager = world.spawn('villager', { x: 3.5, y: 3.5 });
  const rockOnLand = world.spawn('rock', { x: 4.5, y: 6.5 });
  const rockInSea = world.spawn('rock', { x: 12.5, y: 6.5 });
  const giant = world.spawn('creature', { x: 5.5, y: 5.5 });
  const house = world.spawn('building', { x: 2.5, y: 9.5 });
  const cases = [
    ['grab', { entityId: rockOnLand.id, x: 4.5, y: 6.5, z: 6, vx: 0, vy: 0, vz: 0 }, ['grab']],
    ['release', { entityId: rockOnLand.id, x: 4.5, y: 6.5, z: 6, vx: 8, vy: 2, vz: 1 }, ['release']],
    ['release', { entityId: rockOnLand.id, x: 4.5, y: 6.5, z: 6, vx: 0.1, vy: 0, vz: 0 }, []],
    ['landed', { entityId: rockOnLand.id, speed: 9 }, ['landed']],
    ['landed', { entityId: rockInSea.id, speed: 9 }, ['splash']],
    ['landed', { entityId: rockOnLand.id, speed: 9, water: true }, ['splash']],
    ['landed', { entityId: rockOnLand.id, speed: 0.1 }, []],
    ['stroke', { creatureId: giant.id, strength: 0.7 }, ['stroke']],
    ['slap', { creatureId: giant.id, strength: 1 }, ['slap']],
    ['miracle-cast', { miracle: 'rain', x: 6, y: 6 }, ['miracle-rain']],
    ['miracle-cast', { miracle: 'fire', x: 6, y: 6 }, ['miracle-fire']],
    ['miracle-cast', { miracle: 'heal', x: 6, y: 6 }, ['miracle-heal']],
    ['miracle-cast', { miracle: 'lightning', x: 6, y: 6 }, ['miracle-lightning']],
    ['miracle-cast', { miracle: 'nonsense', x: 6, y: 6 }, []],
    ['building-placed', { buildingId: house.id, kind: 'house' }, ['building-placed']],
    ['building-complete', { buildingId: house.id, kind: 'house' }, ['building-complete']],
    ['villager-died', { id: villager.id, cause: 'thrown' }, ['villager-died']],
    ['villager-died', { id: 99999, cause: 'gone' }, ['villager-died']],
    ['village-converted', { village: 'rival' }, ['village-converted']],
    ['act', { actor: 'player', verb: 'throw' }, []],
  ];
  const seen = new Set();
  for (const [type, payload, want] of cases) {
    game.tick(1); // one long tick: every rate limit and voice from earlier cases has cleared
    const got = emitTick(game, [[type, payload]]);
    ok(JSON.stringify(got) === JSON.stringify(want), `${type} ${JSON.stringify(payload)} -> ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
    for (const s of got) seen.add(s);
  }
  for (const id of SOUND_IDS) ok(seen.has(id), `sound ${id} is reachable from some event`);
  for (const type of AUDIO_EVENTS) ok(cases.some(([t, , w]) => t === type && w.length), `event ${type} has a sound`);

  // positions: entity lookup and explicit x/y
  const c1 = mapEvent('stroke', { creatureId: giant.id, strength: 0.5 }, world);
  ok(c1.positional && c1.x === giant.x && c1.y === giant.y, 'stroke is placed at the creature');
  const c2 = mapEvent('villager-died', { id: 99999 }, world);
  ok(!c2.positional, 'a death with no entity and no x/y is heard unplaced (full volume)');
  ok(!mapEvent('village-converted', {}, world).positional, 'village conversion is not attenuated by distance');
  ok(mapEvent('landed', null, world) === null && mapEvent('release', undefined, world) === null, 'null payloads make no sound and do not throw');

  // speed scaling
  const slow = mapEvent('release', { x: 4, y: 4, vx: 2, vy: 0, vz: 0 }, world);
  const fast = mapEvent('release', { x: 4, y: 4, vx: 30, vy: 0, vz: 0 }, world);
  ok(slow.gain < fast.gain && slow.intensity < fast.intensity && fast.intensity === 1, `whoosh scales with speed (gain ${slow.gain.toFixed(2)} < ${fast.gain.toFixed(2)}, intensity capped at 1)`);
  ok(SOUNDS.release.duration(slow.intensity) < SOUNDS.release.duration(fast.intensity), 'faster whoosh lasts longer');
  const soft = mapEvent('landed', { x: 4, y: 4, speed: 2 }, world);
  const hard = mapEvent('landed', { x: 4, y: 4, speed: 12 }, world);
  ok(soft.gain < hard.gain, 'thud scales with speed');
});

section('rate limiting: 20 landed in one tick', () => {
  const game = newGame();
  const rock = game.world.spawn('rock', { x: 4.5, y: 4.5 });
  game.tick(STEP);
  const burst = Array.from({ length: 20 }, (_, i) => ['landed', { entityId: rock.id, speed: 2 + (i === 13 ? 9 : i % 5) }]);
  const a = audioOf(game);
  const req0 = a.stats.requested;
  const got = emitTick(game, burst);
  ok(got.length === 1 && got[0] === 'landed', `one thud from a 20-event burst in one tick (got ${got.length})`);
  ok(a.stats.requested - req0 === 20, '20 requests counted');
  const r = a.history[a.history.length - 1];
  ok(Math.abs(r.intensity - 11 / AUDIO.fullSpeed) < 1e-9, `the loudest landing wins (intensity ${r.intensity.toFixed(3)})`);
  ok(a.queue.voiceCount('landed') === 1, 'one landed voice live');
});

section('rate limiting: 20 landed over 20 ticks', () => {
  const game = newGame();
  const rock = game.world.spawn('rock', { x: 4.5, y: 4.5 });
  const a = audioOf(game);
  const lim = LIMITS.landed;
  const times = [];
  let maxLive = 0;
  for (let i = 0; i < 20; i++) {
    game.events.emit('landed', { entityId: rock.id, speed: 10 });
    game.tick(STEP);
    for (const h of a.history) if (h.tick === a.queue.ticks) times.push(h.time);
    maxLive = Math.max(maxLive, a.queue.voiceCount('landed'));
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  ok(times.length >= 2 && times.length < 20, `burst thinned (${times.length} of 20 played)`);
  ok(gaps.every((g) => g >= lim.minInterval - 1e-9), `every gap >= minInterval ${lim.minInterval}s (min gap ${Math.min(...gaps).toFixed(3)})`);
  ok(maxLive <= lim.maxVoices, `live landed voices <= ${lim.maxVoices} (max ${maxLive})`);
  ok(maxLive === lim.maxVoices && a.stats.voices > 0, `voice cap reached and enforced (${a.stats.voices} dropped for voices)`);
  // after the sounds end, voices free up
  game.tick(1);
  ok(a.queue.voiceCount('landed') === 0, 'voices free once their sounds end');
});

section('total voice cap', () => {
  const q = createSoundQueue();
  const all = SOUND_IDS.map((sound) => ({ sound, gain: 1, intensity: 1, positional: false, x: 0, y: 0, z: 0 }));
  for (let i = 0; i < 4; i++) {
    for (const c of all) q.push({ ...c });
    q.update(0.3, null);
    ok(q.voiceCount() <= AUDIO.maxVoicesTotal, `round ${i}: live voices ${q.voiceCount()} <= ${AUDIO.maxVoicesTotal}`);
  }
  ok(q.stats.totalVoices > 0, `total cap dropped requests (${q.stats.totalVoices})`);
  ok(q.queue.length <= AUDIO.maxQueue && q.history.length <= AUDIO.maxHistory, 'queue and history stay bounded');
});

section('distance attenuation', () => {
  const view = { cx: 1000, cy: 400, halfW: 320, halfH: 180 };
  const at = (nx, ny) => {
    const p = screenToWorld(view.cx + nx * view.halfW, view.cy + ny * view.halfH, 0);
    return { positional: true, x: p.x, y: p.y, z: 0 };
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(attenuate(at(0, 0), view).factor, 1), 'center: full volume');
  ok(near(attenuate(at(0.99, -0.99), view).factor, 1), 'on screen corner: full volume');
  const mid = (AUDIO.inner + AUDIO.outer) / 2;
  ok(near(attenuate(at(mid, 0), view).factor, 0.5), `halfway between inner and outer: 0.5 (got ${attenuate(at(mid, 0), view).factor})`);
  ok(near(attenuate(at(0, -mid), view).factor, 0.5), 'vertical distance uses the half height');
  ok(attenuate(at(AUDIO.outer + 0.1, 0), view).factor === 0, 'past outer: silent');
  ok(attenuate(at(1, 0), view).pan > 0 && attenuate(at(-1, 0), view).pan < 0 && near(attenuate(at(4, 0), view).pan, AUDIO.panWidth), 'pan follows screen x, clamped');
  ok(near(attenuate({ positional: false }, view).factor, 1), 'unplaced sounds ignore distance');
  ok(near(attenuate(at(9, 9), null).factor, 1), 'no view: full volume');
  const f1 = attenuate(at(1.2, 0), view).factor, f2 = attenuate(at(1.8, 0), view).factor, f3 = attenuate(at(2.3, 0), view).factor;
  ok(f1 > f2 && f2 > f3 && f3 > 0, `monotone fade (${f1.toFixed(2)} > ${f2.toFixed(2)} > ${f3.toFixed(2)})`);

  // through the system: real display and camera
  const game = newGame();
  game.display.setDevice(1920, 1080, 1);
  game.camera.centerOn(4, 4, 4);
  const a = audioOf(game);
  const v = a.view();
  ok(v && v.halfW === 320 && v.halfH === 180, `system view = 640x360 game px (got ${v && v.halfW * 2}x${v && v.halfH * 2})`);
  game.tick(1);
  const placed = (nx) => { const p = screenToWorld(v.cx + nx * v.halfW, v.cy, 4); return { x: p.x, y: p.y, z: 4 }; };
  const before = a.stats.distance;
  const near1 = emitTick(game, [['miracle-cast', { miracle: 'heal', ...placed(0.2) }]]);
  game.tick(1);
  const far = emitTick(game, [['miracle-cast', { miracle: 'heal', ...placed(3) }]]);
  game.tick(1);
  const fading = emitTick(game, [['miracle-cast', { miracle: 'heal', ...placed(2) }]]);
  ok(near1.length === 1 && far.length === 0 && fading.length === 1, 'on-screen plays, far off-screen skipped, near off-screen plays');
  ok(a.stats.distance === before + 1, 'far sound counted as a distance drop');
  ok(a.history[a.history.length - 1].gain < 0.5, `near off-screen sound is quieter (gain ${a.history[a.history.length - 1].gain.toFixed(2)})`);
});

section('mute and URL flag', () => {
  ok(muteFlag('?mute=1') && muteFlag('?seed=3&mute=1') && muteFlag('?mute'), '?mute=1 and ?mute mute');
  ok(!muteFlag('') && !muteFlag('?mute=0') && !muteFlag('?seed=1') && !muteFlag(undefined), 'no flag or mute=0: not muted');
  const game = newGame();
  const a = audioOf(game);
  ok(a.muted === false, 'starts unmuted');
  game.input.synth.keyDown('KeyM'); game.input.synth.keyUp('KeyM');
  ok(a.muted === true, 'KeyM mutes');
  game.input.synth.keyDown('KeyM'); game.input.synth.keyUp('KeyM');
  ok(a.muted === false, 'KeyM again unmutes');
});

section('update touches no DOM', () => {
  const names = ['window', 'document', 'location', 'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'requestAnimationFrame', 'localStorage'];
  const saved = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  const hits = [];
  for (const n of names) {
    Object.defineProperty(globalThis, n, { configurable: true, get() { hits.push(n); return undefined; } });
  }
  try {
    const game = newGame();
    game.display.setDevice(1920, 1080, 1);
    const rock = game.world.spawn('rock', { x: 4.5, y: 4.5 });
    for (let i = 0; i < 90; i++) {
      game.events.emit('landed', { entityId: rock.id, speed: 3 + (i % 7) });
      game.events.emit('grab', { entityId: rock.id, x: 4.5, y: 4.5, z: 4 });
      game.events.emit('miracle-cast', { miracle: ['rain', 'fire', 'heal', 'lightning'][i % 4], x: 5, y: 5 });
      game.events.emit('key-down', { code: i % 30 === 0 ? 'KeyM' : 'KeyQ' });
      game.tick(STEP);
    }
    ok(audioOf(game).history.length > 0, 'sounds were queued during the trapped run');
  } finally {
    for (const [n, d] of saved) {
      if (d) Object.defineProperty(globalThis, n, d);
      else delete globalThis[n];
    }
  }
  ok(hits.length === 0, `no window/document/Web Audio access from create + update (got ${[...new Set(hits)].join(', ') || 'none'})`);
});

section('no Math.random, no audio files', () => {
  const files = ['src/systems/audio.js', ...fs.readdirSync(path.join(root, 'src/audio')).map((f) => `src/audio/${f}`)];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    ok(!/Math\.random/.test(text), `${f}: no Math.random`);
    ok(!/\.(wav|mp3|ogg|flac|m4a)\b|data:audio/i.test(text), `${f}: no audio files or data URLs`);
  }
  const audioFiles = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(wav|mp3|ogg|flac|m4a|aac|opus)$/i.test(e.name)) audioFiles.push(p); } };
  walk(path.join(root, 'src'));
  ok(audioFiles.length === 0, `no audio files under src/ (${audioFiles.join(', ') || 'none'})`);
});

section('determinism', () => {
  const run = () => {
    const game = newGame();
    game.display.setDevice(1280, 720, 1);
    game.camera.centerOn(6, 6, 4);
    const rock = game.world.spawn('rock', { x: 4.5, y: 4.5 });
    for (let i = 0; i < 60; i++) {
      if (i % 2 === 0) game.events.emit('landed', { entityId: rock.id, speed: (i * 7) % 13 });
      if (i % 9 === 0) game.events.emit('miracle-cast', { miracle: 'lightning', x: (i * 3) % 16, y: 4 });
      game.tick(STEP);
    }
    return JSON.stringify(audioOf(game).history);
  };
  ok(run() === run(), 'same events -> same queued requests');
});

section('draw without Web Audio never throws', () => {
  // node: no window at all
  const g1 = newGame();
  g1.events.emit('village-converted', {});
  g1.tick(STEP);
  let threw = null;
  try { g1.systems.audio.draw({}); } catch (err) { threw = err; }
  ok(!threw, `draw in node does not throw (${threw})`);
  ok(g1.systems.audio.queue.queue.length === 0, 'draw drains the queue even with nowhere to play it');

  const fakeWindow = (search, AC) => {
    const listeners = {};
    return {
      listeners,
      location: { search },
      AudioContext: AC,
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
      fire(type) { for (const fn of [...(listeners[type] ?? [])]) fn({ type }); },
    };
  };
  const withWindow = (w, fn) => {
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: w, writable: true });
    try { fn(); } finally { if (prev) Object.defineProperty(globalThis, 'window', prev); else delete globalThis.window; }
  };

  // window without Web Audio, ?mute=1
  withWindow(fakeWindow('?mute=1', undefined), () => {
    const w = globalThis.window;
    const g = newGame();
    let err = null;
    try {
      g.systems.audio.draw({});
      ok(g.systems.audio.muted === true, '?mute=1 mutes on the first frame');
      w.fire('pointerdown');
      g.events.emit('grab', { x: 2, y: 2 });
      g.tick(STEP);
      g.systems.audio.draw({});
    } catch (e) { err = e; }
    ok(!err, `no Web Audio: gesture and draw do not throw (${err})`);
    ok(g.systems.audio.player.unavailable === true && !g.systems.audio.player.ctx, 'no Web Audio: player marked unavailable');
    ok((w.listeners.pointerdown ?? []).length === 0, 'gesture listeners removed once Web Audio is known missing');
  });

  // AudioContext constructor that throws
  withWindow(fakeWindow('', class { constructor() { throw new Error('blocked'); } }), () => {
    const w = globalThis.window;
    const g = newGame();
    let err = null;
    const warn = console.warn; console.warn = () => {};
    try { g.systems.audio.draw({}); w.fire('keydown'); g.systems.audio.draw({}); } catch (e) { err = e; } finally { console.warn = warn; }
    ok(!err && g.systems.audio.player.unavailable, `throwing AudioContext: no throw, player unavailable (${err})`);
  });

  // a working fake AudioContext: created only on the first gesture, once
  let made = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), pan: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  class FakeAC {
    constructor() { made++; this.state = 'suspended'; this.currentTime = 0; this.destination = node(); }
    createGain() { return node(); }
    createDynamicsCompressor() { return node(); }
    createStereoPanner() { return node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  withWindow(fakeWindow('', FakeAC), () => {
    const w = globalThis.window;
    const g = newGame();
    for (let i = 0; i < 5; i++) { g.tick(STEP); g.systems.audio.draw({}); }
    ok(made === 0, 'no AudioContext before a user gesture');
    w.fire('pointerdown');
    w.fire('keydown');
    ok(made === 1, `one AudioContext after gestures (made ${made})`);
    g.input.synth.keyDown('KeyM');
    g.systems.audio.draw({});
    ok(g.systems.audio.player.muted === true, 'KeyM reaches the player at frame time');
  });
});

// ---------------------------------------------------------------------------
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  console.log(`check-audio: ${failures.length} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`check-audio: all ${passed} checks passed`);
}
