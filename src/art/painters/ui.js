// UI icons and frames, hand-placed at native size from character maps (one char = one pixel).
//
//   ui-verb { verb }     9 x 9 thought icon for every creature verb (src/creature/brain.js VERBS)
//   ui-target { target } 9 x 9 thought icon for every target (TARGETS; 'none' is a faint ellipsis)
//   ui-icon { name, lit } HUD icons: power, rival, creature (11 x 11), hunger, fatigue, boredom,
//                        good, evil, and the miracles rain, heal, fire, lightning (7 x 7; lit false
//                        draws the dim, not-yet-affordable look)
//   ui-mark { kind }     7 x 7 feedback flourish on the thought bubble: 'glow' after a stroke,
//                        'jag' after a slap
//   ui-bubble { slots }  thought bubble for 1 or 2 icons, anchored at the tip of its trailing dots
//   ui-build { kind }    13 x 11 build bar picture for house, field, store
//   (ui-icon also has 'wood', a 7 x 7 log end for wood costs and stock)
//
// Icons are anchored at their top-left pixel (HUD code places them by corner). Light from the
// top-left; outlines in ui-ink. World things (trees, villagers, water) use their world ramps so the
// alignment LUT tints them like the world; HUD-only icons stay on neutral ramps.
import { createSprite, px } from '../sprite.js';
import { idx } from '../palette.js';

/** Sprite from rows of chars; legend maps a char to [ramp, shade]; '.' and ' ' are transparent. */
function fromMap(rows, legend, ax = 0, ay = 0) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const s = createSprite(w, h, ax, ay);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const c = legend[ch];
      if (!c) throw new Error(`ui painter: no legend entry for "${ch}"`);
      px(s, x, y, idx(c[0], c[1]));
    }
  });
  return s;
}

// Shared legend entries: ink outline and parchment highlights.
const BASE = {
  k: ['ui-ink', 0], i: ['ui-ink', 2], I: ['ui-ink', 4], j: ['ui-ink', 6],
  p: ['ui-parchment', 3], P: ['ui-parchment', 5], W: ['ui-parchment', 7],
};
const L = (extra) => ({ ...BASE, ...extra });

// ---------------------------------------------------------------- verbs (9 x 9)
const VERB_ICONS = {
  // a clay bowl heaped with grain
  eat: [[
    '.........',
    '..G.g.G..',
    '.gGgGgGg.',
    'kkkkkkkkk',
    'kCLLLCCck',
    '.kCCCCck.',
    '..kcccck.',
    '...kkkk..',
    '.........',
  ], { G: ['grain', 6], g: ['grain', 4], C: ['clay', 4], L: ['clay', 6], c: ['clay', 2] }],
  // a stone flung along a rising arc, speed lines trailing behind it
  throw: [[
    '.....kkk.',
    '....kRRrk',
    '.pp.kRrrk',
    '....kRrqk',
    'pp...kkk.',
    '..pp.....',
    'p........',
    '.p.......',
    '.........',
  ], { R: ['rock', 6], r: ['rock', 4], q: ['rock', 2] }],
  // a block split by a crack, chips flying
  smash: [[
    '.R.....R.',
    'R.r...r.R',
    '.........',
    'kkkkkkkkk',
    'kRRRkRRrk',
    'kRRkRRrrk',
    'krrrkkrrk',
    'krrrrkrrk',
    'kkkkkkkkk',
  ], { R: ['rock', 6], r: ['rock', 4] }],
  // two logs lashed together, carried along the arrow
  haul: [[
    '.kkkkkk..',
    'kOBBBBbk.',
    'kObbbbbk.',
    '.kkkkkk..',
    'kOBBBBbk.',
    'kObbbbbk.',
    '.kkkkkk..',
    '.PPPPP.P.',
    '.......PP',
  ], { O: ['bark', 6], B: ['bark', 4], b: ['bark', 2] }],
  // a falling drop
  water: [[
    '....k....',
    '...kWk...',
    '...kVk...',
    '..kVvvk..',
    '.kVWvvvk.',
    '.kVvvvuk.',
    '.kvvvvuk.',
    '..kvuuk..',
    '...kkk...',
  ], { V: ['water', 6], v: ['water', 4], u: ['water', 2] }],
  // two stones tossed round in a loop
  play: [[
    '..kk.....',
    '.kRrk.p..',
    '.krrk..p.',
    '..kk....p',
    'p.......p',
    'p....kk..',
    '.p..kRrk.',
    '..p.krrk.',
    '.....kk..',
  ], { R: ['rock', 6], r: ['rock', 4] }],
  // a thin moon and a drifting z
  sleep: [[
    '..kkk....',
    '.kWPk.ppp',
    'kWPk....p',
    'kPk....p.',
    'kPk...ppp',
    'kPPk.....',
    '.kPPkkk..',
    '..kkPPPk.',
    '....kkk..',
  ], {}],
  // a dung heap with rising fumes
  poop: [[
    '..p...p..',
    '...p.p...',
    '..p...p..',
    '....k....',
    '...kDk...',
    '..kDdDk..',
    '.kDDdddk.',
    'kDdDdddek',
    'kkkkkkkkk',
  ], { D: ['dirt', 5], d: ['dirt', 3], e: ['dirt', 1] }],
  // an hourglass
  idle: [[
    'kkkkkkkkk',
    '.kPPPPPk.',
    '..kPPPk..',
    '...kpk...',
    '....k....',
    '...kpk...',
    '..kpWpk..',
    '.kPWWWPk.',
    'kkkkkkkkk',
  ], {}],
  // two long footprints, one ahead of the other
  wander: [[
    '.....kk..',
    '....kPPk.',
    '....kPpk.',
    '....kPpk.',
    '.kk..kk..',
    'kPPk.....',
    'kPpk.....',
    'kPpk.....',
    '.kk......',
  ], {}],
};

// ---------------------------------------------------------------- targets (9 x 9)
const TARGET_ICONS = {
  // three ripe stalks bound at the waist
  grain: [[
    '.G..G..G.',
    '.g.gGg.g.',
    '.gG.g.Gg.',
    '..g.g.g..',
    '...ggg...',
    '...kkk...',
    '...e.e...',
    '..e.e.e..',
    '.e..e..e.',
  ], { G: ['grain', 6], g: ['grain', 4], e: ['grain', 2] }],
  // a standing villager in work clothes
  villager: [[
    '...kkk...',
    '..kSSsk..',
    '..kSssk..',
    '...kkk...',
    '..kCCck..',
    '.kSCCcSk.',
    '.kkCccKk.',
    '..kcKck..',
    '..kk.kk..',
  ], { S: ['skin', 5], s: ['skin', 3], C: ['cloth-player', 5], c: ['cloth-player', 3], K: ['cloth-player', 1] }],
  // a pine
  tree: [[
    '....k....',
    '...kFk...',
    '..kFFfk..',
    '...kfk...',
    '..kFFfk..',
    '.kFFfffk.',
    'kkkkfkkkk',
    '...kBk...',
    '...kbk...',
  ], { F: ['foliage', 5], f: ['foliage', 3], B: ['bark', 4], b: ['bark', 2] }],
  // a boulder
  rock: [[
    '.........',
    '...kkk...',
    '..kRRrk..',
    '.kRRrrrk.',
    'kRRrrrrqk',
    'kRrrrrqqk',
    'krrrrqqqk',
    '.kkkkkkk.',
    '.........',
  ], { R: ['rock', 6], r: ['rock', 4], q: ['rock', 2] }],
  // split firewood: two log ends and a length
  wood: [[
    '.........',
    '.kkk.kkk.',
    'kOoOkOoOk',
    'kOOOkOOOk',
    '.kkkBkkk.',
    'kOBBBBBbk',
    'kObbbbbbk',
    '.kkkkkkk.',
    '.........',
  ], { O: ['bark', 6], o: ['bark', 4], B: ['bark', 4], b: ['bark', 2] }],
  // tilled rows with young shoots
  field: [[
    '.........',
    '.h..h..h.',
    '.H..H..H.',
    'ddddddddd',
    'DDDDDDDDD',
    'ddddddddd',
    'DDDDDDDDD',
    'eeeeeeeee',
    '.........',
  ], { h: ['grass', 5], H: ['grass', 3], D: ['dirt', 5], d: ['dirt', 3], e: ['dirt', 1] }],
  // a thatched cottage
  building: [[
    '....k....',
    '...kTk...',
    '..kTTtk..',
    '.kTTtttk.',
    'kkkkkkkkk',
    '.kWWkWwk.',
    '.kWkbkwk.',
    '.kWkbkwk.',
    '.kkkkkkk.',
  ], { T: ['thatch', 6], t: ['thatch', 4], W: ['plaster', 6], w: ['plaster', 4], b: ['bark', 2] }],
  // nothing in particular
  none: [[
    '.........',
    '.........',
    '.........',
    '.........',
    '.p..p..p.',
    '.........',
    '.........',
    '.........',
    '.........',
  ], {}],
};

// ---------------------------------------------------------------- HUD icons
const HUD_ICONS = {
  // an altar stone with its offering flame: worship power
  power: [[
    '....f....',
    '...fFf...',
    '...fYf...',
    '..kfFfk..',
    '.kkkkkkk.',
    '.kWPPPpk.',
    '..kpppk..',
    '.kPPPppk.',
    'kkkkkkkkk',
  ], { f: ['fire', 3], F: ['fire', 5], Y: ['fire', 7] }],
  // the rival's domed clay hut
  rival: [[
    '...kkk...',
    '..kLCCk..',
    '.kLCCCck.',
    '.kCCCcck.',
    'kkkkkkkkk',
    'kCCkkCcck',
    'kCckIkcck',
    'kCckIkcck',
    'kkkkkkkkk',
  ], { L: ['clay', 6], C: ['clay', 4], c: ['clay', 2] }],
  // the creature's hooded head, face in shadow, two ember points
  creature: [[
    '...kkkkk...',
    '..kHHHhhk..',
    '.kHHhhhhhk.',
    '.kHkkkkkhk.',
    'kHkkkkkkkhk',
    'kHkAkkkAkhk',
    'kHkkkkkkkhk',
    'khkkkkkkkhk',
    'kMhkkkkkhgk',
    '.kMhhhhhgk.',
    '..kkkkkkk..',
  ], { H: ['creature-hide', 6], h: ['creature-hide', 4], A: ['creature-accent', 6], M: ['moss', 5], g: ['creature-hide', 2] }],
  // a small bowl: hunger
  hunger: [[
    '.......',
    '.G.g.G.',
    'kkkkkkk',
    'kLCCCck',
    '.kCCck.',
    '..kkk..',
    '.......',
  ], { G: ['clay', 7], g: ['clay', 5], L: ['clay', 6], C: ['clay', 4], c: ['clay', 2] }],
  // a thin moon: fatigue
  fatigue: [[
    '..kkk..',
    '.kWPk..',
    'kWPk...',
    'kPk....',
    'kPPk...',
    '.kPPkk.',
    '..kkk..',
  ], {}],
  // a restless coil: boredom
  boredom: [[
    '.kkkkk.',
    'kQQQQQk',
    'kQkkkqk',
    'kQkQkqk',
    'kQkkqqk',
    'kqqqqk.',
    '.kkkk..',
  ], { Q: ['cloth-rival', 6], q: ['cloth-rival', 4] }],
  // a young shoot: good
  good: [[
    '.......',
    '.Hh.hH.',
    '.hHkHh.',
    '..hkh..',
    '...k...',
    '...k...',
    '..kkk..',
  ], { H: ['heal', 5], h: ['heal', 3] }],
  // a cracked ember shard: evil
  evil: [[
    '...k...',
    '..kRk..',
    '.kRrrk.',
    '.kRYrk.',
    'kRrYrrk',
    'krrrrqk',
    '.kkkkk.',
  ], { R: ['fire', 3], r: ['fire', 1], Y: ['fire', 5], q: ['fire', 0] }],
  rain: [[
    '.kkkkk.',
    'kWWPPpk',
    '.kkkkk.',
    '.V.V.V.',
    'V.V.V..',
    '.V.V.V.',
    '.......',
  ], { V: ['water', 6] }],
  heal: [[
    '....kk.',
    '..kkHk.',
    '.kHHhk.',
    'kHHhhk.',
    'kHhhk..',
    '.kkk...',
    'k......',
  ], { H: ['heal', 6], h: ['heal', 4] }],
  fire: [[
    '...f...',
    '..fF...',
    '.fFFf..',
    '.fFYFf.',
    'fFYYYFf',
    'fFYYYFf',
    '.fFFFf.',
  ], { f: ['fire', 2], F: ['fire', 4], Y: ['fire', 6] }],
  lightning: [[
    '...BBB.',
    '..BWB..',
    '.BWB...',
    'BWWWWB.',
    '..BWB..',
    '.BWB...',
    '.B.....',
  ], { B: ['lightning', 3], W: ['lightning', 7] }],
  // a sawn log end with its growth rings: wood (build costs and the village's stock)
  wood: [[
    '..kkk..',
    '.kOOOk.',
    'kOooOok',
    'kOoOoOk',
    'kOooobk',
    '.kbbbk.',
    '..kkk..',
  ], { O: ['bark', 6], o: ['bark', 4], b: ['bark', 2] }],
};

// ---------------------------------------------------------------- build bar (13 x 11)
// One small picture per building the player may plan, in the player village's own materials.
const BUILD_ICONS = {
  // a timber-framed cottage under a thatch roof, fieldstone footing, door on the right
  house: [[
    '.....kkk.....',
    '....kTTtk....',
    '...kTTTttk...',
    '..kTTTTtttk..',
    '.kTTTTttttak.',
    'kkkkkkkkkkkkk',
    '.kWbWWbWkddk.',
    '.kbbbbbbkdDk.',
    '.kWkWbWwkdDk.',
    '.kSsSsSskdDk.',
    '.kkkkkkkkkkk.',
  ], { T: ['thatch', 6], t: ['thatch', 4], a: ['thatch', 2], W: ['plaster', 6], w: ['plaster', 4], b: ['bark', 3], d: ['bark', 1], D: ['bark', 2], S: ['stone', 5], s: ['stone', 3] }],
  // a tilled plot: ripe stalks along the top furrow, dark soil rows below
  field: [[
    '..G...G...G..',
    '.GgG.GgG.GgG.',
    '..g...g...g..',
    'kkkkkkkkkkkkk',
    'kDDDDDDDDDDDk',
    'kdedededededk',
    'kDDDDDDDDDDDk',
    'kdedededededk',
    'kDDDDDDDDDDDk',
    'kdddddddddddk',
    'kkkkkkkkkkkkk',
  ], { G: ['grain', 6], g: ['grain', 4], D: ['dirt', 5], d: ['dirt', 3], e: ['dirt', 1] }],
  // the store: a plank barn with open doors, an ore heap on its left, split logs on its right
  store: [[
    '....kkkkk....',
    '...kRRRrrk...',
    '..kRRRRrrqk..',
    '..kkkkkkkkk..',
    '...kWbBbwk...',
    '...kWbkbwk...',
    '...kwbkbwkkk.',
    '.kkkwbkbwkOOk',
    'kEeEkbkbkOoOk',
    'keEeSbkbskOOk',
    'kkkkkkkkkkkkk',
  ], { R: ['bark', 5], r: ['bark', 4], q: ['bark', 2], W: ['plaster', 6], w: ['plaster', 4], b: ['bark', 2], B: ['bark', 4], S: ['stone', 5], s: ['stone', 3], O: ['bark', 6], o: ['bark', 3], E: ['clay', 5], e: ['rock', 4] }],
};
const MIRACLES = new Set(['rain', 'heal', 'fire', 'lightning']);

// ---------------------------------------------------------------- marks (7 x 7)
const MARKS = {
  // a soft warm glow: the creature was stroked
  glow: [[
    '...f...',
    '...F...',
    '.f.Y.f.',
    'fFYWYFf',
    '.f.Y.f.',
    '...F...',
    '...f...',
  ], { f: ['fire', 5], F: ['fire', 6], Y: ['fire', 7], W: ['ui-parchment', 7] }],
  // a jagged red burst: the creature was slapped
  jag: [[
    'r..k..r',
    '.rkRkr.',
    '.kRYRk.',
    'kRYWYRk',
    '.kRYRk.',
    '.rkRkr.',
    'r..k..r',
  ], { r: ['fire', 2], R: ['fire', 3], Y: ['fire', 5], W: ['fire', 7] }],
};

function paintVerb({ verb = 'idle' } = {}) {
  const def = VERB_ICONS[verb];
  if (!def) throw new Error(`ui-verb: unknown verb "${verb}"`);
  return fromMap(def[0], L(def[1]));
}

function paintTarget({ target = 'none' } = {}) {
  const def = TARGET_ICONS[target];
  if (!def) throw new Error(`ui-target: unknown target "${target}"`);
  return fromMap(def[0], L(def[1]));
}

function paintIcon({ name = 'power', lit = true } = {}) {
  const def = HUD_ICONS[name];
  if (!def) throw new Error(`ui-icon: unknown icon "${name}"`);
  if (!MIRACLES.has(name) || lit) return fromMap(def[0], L(def[1]));
  // not affordable yet: the same shape in dim ink shades, outline dropped so it recedes
  const dim = {};
  for (const ch of new Set(def[0].join(''))) if (ch !== '.') dim[ch] = ['ui-ink', ch === 'k' ? 1 : ch === 'W' || ch === 'Y' ? 5 : 4];
  return fromMap(def[0], dim);
}

function paintBuild({ kind = 'house' } = {}) {
  const def = BUILD_ICONS[kind];
  if (!def) throw new Error(`ui-build: unknown building "${kind}"`);
  return fromMap(def[0], L(def[1]));
}

function paintMark({ kind = 'glow' } = {}) {
  const def = MARKS[kind];
  if (!def) throw new Error(`ui-mark: unknown kind "${kind}"`);
  return fromMap(def[0], L(def[1]), 3, 3);
}

/** Thought bubble: a rounded parchment cloud for `slots` 9 px icons, two bumps on its top edge and
 * two trailing dots below-left. Anchor = the smallest trailing dot (it sits just above the
 * creature's head). Icon slots start at (BUBBLE.pad, BUBBLE.top + BUBBLE.pad). */
export const BUBBLE = Object.freeze({ pad: 3, slot: 9, gap: 2, h: 15, top: 2 });
export function bubbleWidth(slots) {
  return BUBBLE.pad * 2 + slots * BUBBLE.slot + (slots - 1) * BUBBLE.gap;
}
function paintBubble({ slots = 1 } = {}) {
  const n = slots === 2 ? 2 : 1;
  const w = bubbleWidth(n), h = BUBBLE.h, t = BUBBLE.top;
  const s = createSprite(w, t + h + 6, 3, t + h + 5);
  const ink = idx('ui-ink', 0), body = idx('ui-parchment', 6), lit = idx('ui-parchment', 7), shade = idx('ui-parchment', 4);
  // body: a rounded rectangle (corners cut by two pixels), lit along the top, shaded along the bottom
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ex = Math.min(x, w - 1 - x), ey = Math.min(y, h - 1 - y);
      if (ex + ey < 2) { if (ex + ey === 1) px(s, x, t + y, ink); continue; }
      const edge = ex === 0 || ey === 0 || (ex === 1 && ey === 1);
      px(s, x, t + y, edge ? ink : ey === 1 && y < h / 2 ? lit : y >= h - 3 ? shade : body);
    }
  }
  // two bumps rising from the top edge, so it reads as a thought rather than a speech box
  for (const bx of [Math.floor(w / 3), Math.floor((2 * w) / 3)]) {
    for (let x = bx - 1; x <= bx + 1; x++) { px(s, x, t - 2, ink); px(s, x, t - 1, lit); }
    for (const x of [bx - 3, bx - 2, bx + 2, bx + 3]) px(s, x, t - 1, ink);
    for (let x = bx - 3; x <= bx + 3; x++) px(s, x, t, lit);
  }
  // trailing dots down-left toward the head: a 3 x 3 pebble, then a single pixel
  const dot = (x0, y0, size) => {
    for (let y = -1; y <= size; y++) for (let x = -1; x <= size; x++) {
      const inside = x >= 0 && y >= 0 && x < size && y < size;
      const corner = (x === -1 || x === size) && (y === -1 || y === size);
      if (inside) px(s, x0 + x, y0 + y, (x === 0 || y === 0) && size > 2 ? lit : body);
      else if (!corner) px(s, x0 + x, y0 + y, ink);
    }
  };
  dot(5, t + h + 1, 3);
  dot(3, t + h + 5, 1);
  return s;
}

export const sprites = {
  'ui-verb': paintVerb,
  'ui-target': paintTarget,
  'ui-icon': paintIcon,
  'ui-mark': paintMark,
  'ui-bubble': paintBubble,
  'ui-build': paintBuild,
};

export const ICON_NAMES = Object.freeze(Object.keys(HUD_ICONS));
export const BUILD_NAMES = Object.freeze(Object.keys(BUILD_ICONS));
export const VERB_NAMES = Object.freeze(Object.keys(VERB_ICONS));
export const TARGET_NAMES = Object.freeze(Object.keys(TARGET_ICONS));

export const previews = {
  'ui-verb': VERB_NAMES.map((verb) => ({ verb })),
  'ui-target': TARGET_NAMES.map((target) => ({ target })),
  'ui-icon': [
    ...ICON_NAMES.map((name) => ({ name })),
    ...[...MIRACLES].map((name) => ({ name, lit: false })),
  ],
  'ui-mark': [{ kind: 'glow' }, { kind: 'jag' }],
  'ui-bubble': [{ slots: 1 }, { slots: 2 }],
  'ui-build': BUILD_NAMES.map((kind) => ({ kind })),
};
