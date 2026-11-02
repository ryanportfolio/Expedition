// Hand tunables, in one object so balance and feel changes touch one place. Units: positions in
// tiles (x, y) and height units (z, 8 px each); speeds in tiles/s or height units/s; times in
// seconds of sim time; screen distances in view pixels (one game pixel each).
export const HAND = {
  // ---- where the hand and a carried object sit
  hoverZ: 2.5, // empty hand: height above the terrain under the pointer
  carryZ: 1.5, // held object's foot: height above the terrain under it
  gripGap: -0.4, // holding: hand fingertips sit this far above the top of the held object (negative = overlap, a grip)
  followRate: 14, // 1/s: held object closes this share of the gap per second (exponential lag)

  // ---- release: pointer velocity over the last 100 ms (view px/s) -> ground velocity (tiles/s)
  throwGain: 0.5, // multiplies the ground velocity of the pointer
  throwMin: 1.5, // tiles/s: slower releases drop straight down (no throw)
  throwMax: 16, // tiles/s: cap on horizontal throw speed
  loft: 1.0, // vertical launch speed (height units/s) per tile/s of horizontal speed

  // ---- flight
  gravity: 36, // height units/s^2
  lethalSpeed: 16, // landing speed (|v|, tiles/s and height units/s mixed 1:1) that kills a villager
  bounce: { rock: 0.35, wood: 0.4 }, // restitution of the vertical speed; kinds not listed settle
  friction: 0.55, // horizontal speed kept per bounce
  bounceMin: 3, // height units/s: slower vertical impacts settle
  maxBounces: 4,
  waterGround: 1, // ground types 0 (deep) and 1 (shallow) are water
  sinkTime: 0.7, // seconds an object takes to sink before it is removed
  sinkRate: 1.6, // height units/s while sinking

  // ---- thrown rocks against buildings
  damageKinds: ['rock'],
  buildingRadius: 1.2, // tiles, used when a building has no `r`
  buildingHeight: 3, // height units above the building's ground point that count as a hit
  damageSpeed: 6, // impacts slower than this do no damage
  fullDamageSpeed: 16, // impacts at or above this do the full rockDamage
  rockDamage: 0.5, // hp removed by a full-speed hit (buildings have hp 0..1)

  // ---- picking entities under the pointer (view px)
  pickPad: 2, // grow every sprite's box by this much on each side
  pickMin: 10, // boxes smaller than this are widened to it (10 px villagers stay easy to grab)
  hitBox: { creature: { w: 40, h: 76 }, villager: { w: 8, h: 12 }, default: { w: 12, h: 12 } }, // entities without a sprite
  queryRadius: 10, // tiles around the pointer's ground point searched for candidates

  // ---- stroke and slap
  strokeWindow: 1.2, // seconds
  strokeReversals: 3, // direction reversals over the creature inside the window
  strokeMinTravel: 3, // view px a move must cover before it counts as a direction
  strokeFullSpeed: 240, // view px/s of drag that gives strength 1 (clamped 0.2..1)

  // ---- pose timers (seconds the pose is held after the action)
  grabPose: 0.18,
  slapPose: 0.3,
  strokePose: 0.4,

  // ---- the hand in bulk (resources in units: wood and grain, at the village's scale)
  multiPickup: true, // sweeping across villagers or trees with the button down holds several (an upgrade once tribute exists)
  multiKinds: ['villager', 'tree'], // never rocks, orbs or piles
  multiMax: 40,
  sweepStart: 8, // view px the pointer must move from the press before the sweep adds anything
  spread: [[0, 0], [0.35, -0.2], [-0.3, 0.25], [0.2, 0.4], [-0.4, -0.3]], // tiles: where the first held things ride round the grip; the rest ride on the first
  treeDrawDelay: 0.3, // s: a press held still this long on a tree draws its wood out instead of pulling the tree up
  drawDelay: 0.2, // s: a press on a field or store draws nothing before this (a click takes nothing)
  draw: { start: 40, ramp: 2, max: 800 }, // units/s drawn from a field, store or tree: start x (1 + ramp x seconds drawing), capped
  pour: { start: 60, ramp: 2, max: 900 }, // wood/s poured into a site to god-build it, same shape
  pourDelay: 0.3, // s the hand stays over a site with wood (or holds the button over a held group) before pouring starts
  pourInterval: 0.15, // s between things put out of a held group while the button is held
  shakeWindow: 0.7, // s: shakeReversals direction changes inside this window, at shakeSpeed, empty the hand
  shakeReversals: 4,
  shakeMinTravel: 12, // view px a move must cover before it counts as a direction
  shakeSpeed: 500, // view px/s of hand movement over the window
  shakeScatter: 1.2, // tiles/s things shaken out fly apart
  labelGap: 3, // view px between the hand sprite and the amount it carries

  // ---- act weights the hand emits (good positive)
  weights: { uproot: -0.05, kill: -0.6, throw: 0, drop: 0 },
};

/** Draw or pour rate (units/s) after `t` seconds of drawing or pouring, for HAND.draw or HAND.pour. */
export function bulkRate(r, t) {
  return Math.min(r.max, r.start * (1 + r.ramp * t));
}

/** Kinds of loose resource the hand carries as one pile with an amount. */
export const PILE_KINDS = new Set(['wood', 'grain']);

/** Kinds the hand may pick up when the owner of the kind has not set `grabbable`. */
export const GRABBABLE_KINDS = new Set(['villager', 'tree', 'rock', 'wood', 'grain', 'orb']);

/** Creatures and buildings are never grabbable; otherwise the entity's own flag, else the kind default. */
export function isGrabbable(e) {
  if (!e || e.kind === 'creature' || e.kind === 'building') return false;
  if (typeof e.grabbable === 'boolean') return e.grabbable;
  return GRABBABLE_KINDS.has(e.kind);
}

/** Ground velocity (tiles/s) for a screen velocity (view px/s), on the plane of constant height. */
export function screenToGroundVelocity(vsx, vsy) {
  const d = vsx / 16, s = vsy / 8; // d(x - y)/dt, d(x + y)/dt
  return { vx: (s + d) / 2, vy: (s - d) / 2 };
}

/** Inverse of screenToGroundVelocity: view px/s that move the ground point at (vx, vy) tiles/s. */
export function groundToScreenVelocity(vx, vy) {
  return { vsx: 16 * (vx - vy), vsy: 8 * (vx + vy) };
}

/**
 * Launch velocity for a release with the pointer moving at (vsx, vsy) view px/s:
 * { vx, vy, vz, speed, thrown }. Below throwMin it is a plain drop (all zero).
 */
export function releaseVelocity(vsx, vsy, T = HAND) {
  const g = screenToGroundVelocity(vsx, vsy);
  const raw = Math.hypot(g.vx, g.vy) * T.throwGain;
  if (!(raw >= T.throwMin)) return { vx: 0, vy: 0, vz: 0, speed: 0, thrown: false };
  const speed = Math.min(raw, T.throwMax);
  const k = speed / Math.hypot(g.vx, g.vy);
  return { vx: g.vx * k, vy: g.vy * k, vz: speed * T.loft, speed, thrown: true };
}
