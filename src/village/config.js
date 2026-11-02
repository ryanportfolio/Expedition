// Village tunables and building definitions. Times in sim seconds, distances in tiles.
//
// Amounts follow the reference's scale (hundreds of wood per building, tens to hundreds per tree,
// grain in the hundreds): the step-1 retune multiplied every wood amount by 50 and every grain amount
// by 20 from the old log and sack counts, so a house still takes about three trees and a harvest
// still feeds five meals. Trees now hold different amounts by species and growth (woodIn).

export const VILLAGE = {
  walkSpeed: 1.6, // tiles per second
  hungrySpeed: 0.6, // speed factor while hungry with no grain to eat
  fleeSpeed: 1.4, // speed factor while fleeing
  fleeTime: 3, // seconds a scare lasts
  fleeReach: 4, // a fleeing villager heads for the tile farthest from the threat within this many steps
  strikeFearPad: 3, // villagers within strike r + this flee
  fireFearR: 2.5, // villagers this close to a burning building flee
  eatInterval: 120, // seconds between meals
  mealGrain: 20, // grain one meal eats
  chopTime: 5,
  treeWood: { broad: 120, pine: 80 }, // wood in a grown tree by species (scaled by growth); a felled tree is carried back as one load
  harvestTime: 3,
  tendTime: 4,
  buildStep: 2, // seconds of work per build visit before re-checking
  workRadius: 16, // woodcutters look for trees this far from the village centre
  looseItemRadius: 6, // villagers pick up dropped wood or grain this close
  fieldGrowTime: 45, // seconds from 0 to 1 growth, untended, no rain
  tendFactor: 2, // growth multiplier while a farmer works the field
  rainFactor: 2, // growth multiplier while a recent rain boost lasts
  rainBoostTime: 30, // seconds a rain event keeps the boost
  fieldYield: 100, // grain per harvest
  worshipPower: 0.08, // power per praying worshipper per second
  powerCap: 100,
  worshipShare: 0.25, // share of player adults sent to the temple by auto-assignment
  rivalWorshipShare: 0.15, // rival villagers pray too; no god collects it
  builderShare: 0.3, // share of adults that may build while there are sites
  woodTarget: 1500, // woodcutters taper off once the woodpiles hold this much
  haulLoad: 150, // wood a builder carries from the woodpile to its site per trip (no more than the site still needs)
  assignInterval: 2,
  dropLockTime: 90, // a hand-dropped villager keeps its new job this long
  dropRadius: 2, // hand drop within this distance of a target reassigns
  birthInterval: { player: 25, rival: 50 },
  birthCost: 100, // grain per new villager
  birthReserve: 400, // grain kept back before births
  rivalPlanInterval: 120, // rival places a new blueprint at most this often
  influenceR: 10, // blueprints within this of the own temple centre
  buildingInfluenceR: 5, // or within this of a finished own building centre (blueprints do not count)
  dyingTime: 1.5, // seconds a dead villager lies before removal
  // Recovery after fire and other losses (both villages).
  clearTime: 6, // seconds of builder work to clear one wreck away
  rebuildInterval: 2, // seconds between checks for lost buildings to re-place
  rebuildSites: 2, // re-placed (lost-building) sites a village keeps open at once; its own cap, separate from the player's blueprints, which are never refused for their number
  gatherShare: 0.5, // with no wood in stock and sites waiting for it, at least this share of adults cut wood before builders and worshippers are dealt
  foodShare: 0.25, // with no grain in store (and a storehouse and fields standing), at least this share of adults farm before anyone else is dealt
  salvageShare: 0.75, // share (rounded down) of the timber and stacked wood in a wreck, and of the grain in a storehouse wreck, that clearing it salvages
  rebuildRadius: 4, // tiles from the old centre a re-placed blueprint may move when the old spot is taken; a blueprint of the lost type placed this close (or on the wreck) stands in for it
  rebuildRetry: 10, // seconds before a lost building with no free spot is tried again
  rebuildOrder: ['storehouse', 'woodpile', 'field', 'house'], // which lost buildings come back first: stores, then wood, food, homes
  oneOf: ['storehouse', 'woodpile'], // stores: a lost one is re-placed at once (beside its wreck if need be) when the village has none standing or going up, and not at all when it has
  wreckWait: 30, // seconds a lost building waits for builders to clear its wreck before it is re-placed beside it
  // Temples (player and rival) are stone: no hp write takes them below this (fire, lightning, a
  // thrown object, a creature smash; stoneHp in sim.js floors every write since round 43), so they
  // are never wrecked and worship resumes once a fire on them is out.
  templeMinHp: 0.2,
  settlerMinPop: 3, // below this many villagers, settlers arrive at a standing or ruined temple
  settlerInterval: 15, // seconds between settlers while the village is that small
  startPop: { player: 9, rival: 8 },
  startWood: { player: 200, rival: 400 },
  startGrain: { player: 240, rival: 240 },
  // The hand: a site fed by pouring wood from the hand rises at once, but god-building costs this
  // many times the wood builders would use (the extra pays for the labour).
  godBuildFactor: 1.5,
};

/** Building kinds: footprint (fw x fh tiles), wood cost, build time, population cap. */
export const KINDS = {
  temple: { fw: 3, fh: 3, cost: 0, buildTime: 0, cap: 0 },
  house: { fw: 2, fh: 2, cost: 300, buildTime: 20, cap: 3 },
  field: { fw: 3, fh: 3, cost: 100, buildTime: 10, cap: 0 },
  storehouse: { fw: 2, fh: 2, cost: 400, buildTime: 25, cap: 0 },
  woodpile: { fw: 1, fh: 1, cost: 150, buildTime: 8, cap: 0 },
};

/** Wood left in tree t: what the hand has not drawn out yet, else its species' full amount scaled by
 * its growth (whole units, at least 1). Woodcutters, the creature and the hand all take this much. */
export function woodIn(t) {
  if (typeof t.wood === 'number') return t.wood;
  return Math.max(1, Math.round((VILLAGE.treeWood[t.species] ?? VILLAGE.treeWood.broad) * (t.growth ?? 1)));
}

export const PLACEABLE = ['house', 'field', 'storehouse', 'woodpile'];
export const JOBS = ['farmer', 'woodcutter', 'builder', 'worshipper', 'idle'];

/** Starting layouts: kind and preferred distance from the village centre (each village's own style). */
export const START_LAYOUT = {
  player: [['storehouse', 2], ['woodpile', 2], ['house', 3.5], ['house', 3.5], ['house', 4], ['house', 4], ['field', 6], ['field', 6]],
  // Rival style: a tight ring of houses round its stores, fields pushed out together.
  rival: [['storehouse', 1.5], ['woodpile', 2.5], ['house', 4.5], ['house', 4.5], ['house', 4.5], ['house', 4.5], ['field', 7], ['field', 7]],
};

/** Rival build order, repeated. */
export const RIVAL_PLAN = ['house', 'field', 'woodpile', 'house', 'storehouse'];
