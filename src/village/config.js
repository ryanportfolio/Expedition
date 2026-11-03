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
  workRadius: 16, // foresters look for trees this far from the village centre
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
  woodTarget: 1500, // foresters taper off once the stores hold this much wood
  haulLoad: 150, // wood a builder carries from a store to its site per trip (no more than the site still needs)
  // One store holds all three resources (step 3 of docs/gameplay-spec.md), up to storeCap of each, so
  // a growing town needs more stores. A store full of one resource takes no more of it.
  storeCap: 20000,
  // Ore (step 3): a mine near each village holds mineOre, finite; miners carry oreLoad a trip after
  // mineTime of work. Nothing spends ore until the buildings that cost it arrive (step 8), so miners
  // are dealt only while the stores hold less than oreTarget, at most minersPerMine a mine and
  // mineShare of adults (at least one).
  mineOre: 6000,
  mineTime: 6,
  oreLoad: 100,
  oreTarget: 1000,
  minersPerMine: 4,
  mineShare: 0.1,
  // Surface ore rocks: share of the map's rocks that carry ore, and the ore by rock size.
  oreRockShare: 0.3,
  oreRock: { 1: 100, 2: 250, 3: 500 },
  // Forests regrow (step 3). A forester plants a sapling where it fells a tree; a sapling grows to
  // a full tree in treeGrowTime (rain adds TUNING.rain.growthRate on top). Every spreadInterval the
  // sim tries spreadTries times to seed a sapling 1-2 tiles from a grown tree, on free grass at a
  // forest edge (1 to spreadCrowd trees within 1.6 tiles), no closer than spreadClear to a building,
  // while the island holds fewer trees than it started with. Rain seeds saplings too: rainSprout per
  // second of rain, on free grass under the cloud.
  treeGrowTime: 240,
  spreadInterval: 2,
  spreadTries: 3,
  spreadCrowd: 4,
  spreadClear: 2,
  rainSprout: 0.5,
  assignInterval: 2,
  dropRadius: 2, // hand drop within this distance of a target reassigns
  birthInterval: { player: 25, rival: 50 },
  // Breeders (a hand-set job, step 4): each one shortens the time between births by breederBoost
  // (birthInterval / (1 + breederBoost x breeders)), up to breederMax breeders. Births still need room
  // in the houses and birthReserve grain.
  breederBoost: 0.5,
  breederMax: 4,
  birthCost: 100, // grain per new villager
  birthReserve: 400, // grain kept back before births
  rivalPlanInterval: 120, // rival places a new blueprint at most this often
  influenceR: 10, // village influence (where blueprints go, and loose ore miners fetch): within this of the own temple centre
  buildingInfluenceR: 5, // or within this of a finished own building centre (blueprints and the mine do not count)
  dyingTime: 1.5, // seconds a dead villager lies before removal
  // Recovery after fire and other losses (both villages).
  clearTime: 6, // seconds of builder work to clear one wreck away
  rebuildInterval: 2, // seconds between checks for lost buildings to re-place
  rebuildSites: 2, // re-placed (lost-building) sites a village keeps open at once; its own cap, separate from the player's blueprints, which are never refused for their number
  gatherShare: 0.5, // with no wood in stock and sites waiting for it, at least this share of adults cut wood before builders and worshippers are dealt
  foodShare: 0.25, // with no grain in store (and a store and fields standing), at least this share of adults farm before anyone else is dealt
  salvageShare: 0.75, // share (rounded down) of the timber and stacked wood in a wreck, and of the grain and ore in a store wreck, that clearing it salvages
  rebuildRadius: 4, // tiles from the old centre a re-placed blueprint may move when the old spot is taken; a blueprint of the lost type placed this close (or on the wreck) stands in for it
  rebuildRetry: 10, // seconds before a lost building with no free spot is tried again
  rebuildOrder: ['store', 'field', 'house'], // which lost buildings come back first: the store, then food, homes
  oneOf: ['store'], // the store: a lost one is re-placed at once (beside its wreck if need be) when the village has none standing or going up, and not at all when it has
  wreckWait: 30, // seconds a lost building waits for builders to clear its wreck before it is re-placed beside it
  // Temples (player and rival) and mines are stone: no hp write takes them below this (fire,
  // lightning, a thrown object, a creature smash; stoneHp in sim.js floors every write since round
  // 43), so they are never wrecked and worship resumes once a fire on a temple is out.
  templeMinHp: 0.2,
  settlerMinPop: 3, // below this many villagers, settlers arrive at a standing or ruined temple
  settlerInterval: 15, // seconds between settlers while the village is that small
  startPop: { player: 9, rival: 8 },
  startWood: { player: 200, rival: 400 },
  startGrain: { player: 240, rival: 240 },
  startOre: { player: 0, rival: 0 },
  // The hand: a site fed by pouring wood from the hand rises at once, but god-building costs this
  // many times the wood builders would use (the extra pays for the labour).
  godBuildFactor: 1.5,
};

/** Building kinds: footprint (fw x fh tiles), wood cost, build time, population cap. The mine is
 * prebuilt like the temple: setup places it, and it is never a blueprint. */
export const KINDS = {
  temple: { fw: 3, fh: 3, cost: 0, buildTime: 0, cap: 0 },
  house: { fw: 2, fh: 2, cost: 300, buildTime: 20, cap: 3 },
  field: { fw: 3, fh: 3, cost: 100, buildTime: 10, cap: 0 },
  store: { fw: 2, fh: 2, cost: 400, buildTime: 25, cap: 0 },
  mine: { fw: 2, fh: 2, cost: 0, buildTime: 0, cap: 0 },
};

/** Wood left in tree t: what the hand has not drawn out yet, else its species' full amount scaled by
 * its growth (whole units, at least 1). Foresters, the creature and the hand all take this much. */
export function woodIn(t) {
  if (typeof t.wood === 'number') return t.wood;
  return Math.max(1, Math.round((VILLAGE.treeWood[t.species] ?? VILLAGE.treeWood.broad) * (t.growth ?? 1)));
}

export const PLACEABLE = ['house', 'field', 'store'];
export const JOBS = ['farmer', 'forester', 'miner', 'builder', 'worshipper', 'breeder', 'idle'];
/** Resources a store holds, each up to VILLAGE.storeCap. */
export const STOCK_KINDS = ['grain', 'wood', 'ore'];

/** Ore in rock r: what the hand has not drawn out yet, else its size's full amount; 0 for a plain
 * rock. The terrain system marks ore rocks (`ore: true`) when it spawns the map's rocks. */
export function oreIn(r) {
  if (!r?.ore) return 0;
  if (typeof r.oreLeft === 'number') return r.oreLeft;
  return VILLAGE.oreRock[r.size] ?? VILLAGE.oreRock[2];
}

/** Starting layouts: kind and preferred distance from the village centre (each village's own style). */
export const START_LAYOUT = {
  player: [['store', 2], ['house', 3.5], ['house', 3.5], ['house', 4], ['house', 4], ['field', 6], ['field', 6], ['mine', 10]],
  // Rival style: a tight ring of houses round its store, fields pushed out together.
  rival: [['store', 1.5], ['house', 4.5], ['house', 4.5], ['house', 4.5], ['house', 4.5], ['field', 7], ['field', 7], ['mine', 10]],
};

/** Rival build order, repeated. */
export const RIVAL_PLAN = ['house', 'field', 'house', 'store'];
