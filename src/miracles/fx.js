// Effect choices and palettes for the miracles, recolored for the art direction (v2): storm-grey rain
// clouds, natural fire, pale holy light for healing, violet-white lightning.
//
// Two thin wrappers live here:
// - rainCloud: pixelfx lightning/storm-cloud with the one bolt it throws per loop cut out (frames 51-71:
//   the bolt and the sparks it throws). Rain is a good miracle; a bolt would read as lightning damage.
// - orbGlow: a small looping glow written against the pixelfx painter, because the library's orb
//   effects (arcane-orb, water-orb, plasma-ball, spell-charge) are 30-120 px across and the pedestals
//   stand 1.5 tiles apart. It sits on the orb sprite: a tinted halo, a pulsing light, a bright core and
//   three motes on a tilted orbit (two behind the orb, one in front). orbs.js paints it on its own
//   depth-sorted layer (glow-layer.js), not game.fx.
//   Hue must survive at native scale: additive light alone washes pale colors to white over the
//   ground, so the halo is an alpha-blended disc of the palette's saturated middle color (C[2]) and
//   the light uses C[2]; only the core and the front mote reach the near-white C[4].
import * as stormCloud from 'pixelfx/fx/lightning/storm-cloud';
import * as shadowFlames from 'pixelfx/fx/shadow/shadow-flames';
import * as spiritFlame from 'pixelfx/fx/fire/spirit-flame';
import * as fireRing from 'pixelfx/fx/fire/fire-ring';
import * as healAoe from 'pixelfx/fx/holy/heal-aoe';
import * as lightningStrike from 'pixelfx/fx/lightning/lightning-strike';
import * as poof from 'pixelfx/fx/spawn/poof';
import { fit, sparkle } from 'pixelfx';
import { TUNING } from './tuning.js';

// ---- rain cloud without its bolt
const SKIP_FROM = 51, SKIP = 21, FPS = 30;
export const rainCloud = {
  meta: { ...stormCloud.meta, name: 'Rain cloud', duration: stormCloud.meta.duration - SKIP / FPS },
  draw(p, t, o) {
    stormCloud.draw(p, t * FPS < SKIP_FROM ? t : t + SKIP / FPS, o);
  },
};

// ---- small orb glow (pixelfx effect module contract: meta + draw/drawBack(p, t, o))
const GLOW_D = 2.4;
const GROUND_LIGHT_Y = Math.round(TUNING.orbs.hover * 8);
const orbit = (t, i) => {
  const a = (t / GLOW_D) * Math.PI * 2 * (i % 2 ? -1 : 1) + (i * Math.PI * 2) / 3;
  return { x: Math.cos(a) * 8, y: Math.sin(a) * 2.5 - 3, front: Math.sin(a) > 0 };
};
function motes(p, t, o, front) {
  const C = fit(o.palette, 5);
  for (let i = 0; i < 3; i++) {
    const m = orbit(t, i);
    if (m.front !== front) continue;
    p.px(m.x, m.y, front ? C[4] : C[3]);
    p.light(m.x, m.y, C[2], 0.6);
  }
}
export const orbGlow = {
  meta: {
    name: 'Orb glow', desc: 'A soft pulsing light round a floating orb with three motes circling it.',
    size: [40, 36], origin: [20, 22], duration: GLOW_D, loop: true, fps: 30, bg: 'ground',
    options: { palette: ['#0c2036', '#1a4a7c', '#2f86d0', '#7cc4f4', '#e2f4ff'], seed: 1 },
  },
  drawBack(p, t, o) {
    const C = fit(o.palette, 5), pulse = 0.5 + 0.5 * Math.sin((t / GLOW_D) * Math.PI * 4);
    p.circle(0, -3, 7 + pulse, C[2], (d) => (0.55 + 0.1 * pulse) * (1 - d * d));
    p.circle(0, -3, 3.5, C[3], 0.7);
    p.glow(0, -3, 14 + 3 * pulse, C[2], 0.32 + 0.12 * pulse);
    p.glow(0, -3, 5, C[4], 0.25 + 0.1 * pulse);
    // the light it throws on the stone or ground under it, a pedestal orb's hover below its anchor
    // (8 px per height unit)
    p.glow(0, GROUND_LIGHT_Y, 12, C[2], 0.22 + 0.08 * pulse);
    motes(p, t, o, false);
  },
  draw(p, t, o) {
    motes(p, t, o, true);
    // a glint every half loop
    const g = (t / GLOW_D) % 0.5;
    if (g < 0.06) sparkle(p, 2, -5, 2, fit(o.palette, 5)[4], fit(o.palette, 5)[3], 0.3);
  },
};

// ---- palettes
const FIRE = ['#4a1712', '#8a1f17', '#c9281f', '#f2561d', '#ff8a2a', '#ffc23d', '#ffe26b', '#fff3a6', '#ffffff'];
const STRUCTURE_FIRE = ['#140c0a', '#3a1a12', '#7a2414', '#c9401a', '#f2701f', '#ffae35', '#ffe27a', '#fff8d6'];

/** Orb glow per miracle, dark to bright. C[2] (halo and light) carries the hue and differs per
 * miracle in hue, not only lightness: pale blue rain, white-gold heal, orange fire, violet lightning. */
export const ORB_PALETTE = {
  rain: ['#0c2036', '#1a4a7c', '#2f86d0', '#7cc4f4', '#e2f4ff'],
  heal: ['#3a2c0c', '#8a6614', '#e0b030', '#ffe27a', '#fffbe8'],
  fire: ['#3a1008', '#902a0c', '#e8601a', '#ffa030', '#fff0b0'],
  lightning: ['#24104a', '#5a2aa8', '#9058ec', '#c8a4ff', '#f6f0ff'],
};

/** Effect module + options per use. Pixel sizes are at zoom 1 (one tile is 32 px wide). */
export const FX = {
  orb: (miracle, seed) => [orbGlow, { palette: ORB_PALETTE[miracle], seed }],
  rain: (seed) => [rainCloud, {
    seed,
    cloud: ['#0f1114', '#1c2026', '#2a3038', '#3a414b', '#4d5560', '#646c76', '#7e858d'],
    palette: ['#14161a', '#262a30', '#3a3f47', '#555b64', '#7a828c', '#a4abb3', '#d4d8dc', '#ffffff'],
    rain: ['#3a4652', '#56636f', '#7a8894', '#a9b5bf'],
    sparks: ['#d4d8dc', '#a4abb3', '#7a828c', '#555b64'],
  }],
  /** Ignition ring; reach in px matches the fire radius on screen (a tile radius is ~22.6 px wide). */
  fireRing: (reach, seed) => [fireRing, { palette: FIRE, reach, seed }],
  /** Flames on a burning building or tree: pixelfx shadow/shadow-flames recolored to a natural fire. Its
   * black heart reads as the charred frame inside the blaze; no logs, unlike the campfire. */
  burnLarge: (seed) => [shadowFlames, { palette: STRUCTURE_FIRE, seed, light: 0.8 }],
  /** Flames on a burning villager: a single loose flame, no timbers. */
  burnSmall: (seed) => [spiritFlame, {
    palette: ['#3a1210', '#7a2414', '#b8401a', '#e0661e', '#f58a2a', '#ffb03a', '#ffd66a', '#fff0b0', '#ffffff'],
    seed, light: 0.6,
  }],
  heal: (reach, seed) => [healAoe, {
    palette: ['#2a2820', '#4a4636', '#787258', '#a8a080', '#d0caa8', '#ece6cc', '#faf6e8', '#ffffff'], reach, seed,
  }],
  lightning: (seed) => [lightningStrike, {
    palette: ['#14081f', '#2c1250', '#4a2088', '#6f3cc0', '#9a6ee6', '#c6a8f6', '#ece0ff', '#ffffff'],
    sparks: ['#ffffff', '#f0e6ff', '#c8b0ff', '#8a60e0'], seed,
  }],
  /** Orb fizzle (not enough power): a small grey puff with no stars. */
  fizzle: (seed) => [poof, {
    palette: ['#2a2a2e', '#45454c', '#64646c', '#8a8a92', '#b4b4ba', '#dcdce0'],
    stars: ['#64646c', '#8a8a92', '#b4b4ba'], seed,
  }],
  /** A burnt tree collapsing: dark smoke. */
  ash: (seed) => [poof, {
    palette: ['#141214', '#24201f', '#363130', '#4a4442', '#5f5855', '#76706b'],
    stars: ['#5f5855', '#76706b', '#8a2a14'], seed,
  }],
};

/** Pixels per tile of radius along the screen's horizontal axis: a world circle of radius r projects to
 * an ellipse r * 16 * sqrt(2) px wide on each side. */
export const PX_PER_TILE = 16 * Math.SQRT2;
