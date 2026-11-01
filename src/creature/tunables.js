// Creature system tunables. Units: tiles, tiles/s, sim seconds, height units (8 px each).
export const CREATURE = {
  walkSpeed: 1.4, // tiles per second before brain.speedMult (weak halves it)
  maxStep: 2, // largest tile height change one step may cross (villagers: 1)
  decisionInterval: 1.5, // seconds of idle between finishing one action and choosing the next
  senseRadius: 10, // candidates come from things this close to the creature
  farFoodHunger: 0.66, // at this hunger with no food in senseRadius, grain anywhere is offered
  tetherRadius: 3, // while tethered: candidates and wandering stay this close to the tether point
  tetherTime: 20, // seconds the creature stays by the tether point after arriving
  reach: 1.6, // the creature acts on targets this close to the tile centre it stands on
  chaseTries: 3, // re-paths after a moving target (a villager) before giving up
  wanderRadius: 4,
  // Seconds each action's pose is held once the creature is at its target.
  duration: { eat: 1.5, throw: 1.2, smash: 2, haul: 1, water: 2.5, play: 3, poop: 2, idle: 1.5, wander: 0.5 },
  sleepMax: 30, // sleep ends at this many seconds or when fatigue reaches sleepWake
  sleepWake: 0.05,
  feedbackPose: 1, // seconds the happy or hurt pose shows after a stroke or slap
  thoughtTime: 3, // seconds a judged action stays in the thought after feedback
  animFps: 6,
  // Need relief per action, for the brain's utility (needs * satisfies) and completeAction.
  satisfies: {
    'eat:grain': { hunger: 0.6 },
    'eat:villager': { hunger: 0.8 },
    'throw:rock': { boredom: 0.5 },
    'throw:villager': { boredom: 0.5 },
    'throw:tree': { boredom: 0.5 },
    'smash:building': { boredom: 0.5 },
    'haul:wood': { boredom: 0.3 },
    'water:field': { boredom: 0.3 },
    'play:none': { boredom: 0.6 },
    'sleep:none': { fatigue: 1 },
    'poop:none': { boredom: 0.05 },
    'idle:none': {},
    'wander:none': { boredom: 0.1 },
  },
  grainBite: 3, // grain taken from a storehouse per meal
  waterGrowth: 0.3, // field growth added by one watering
  smashDamage: 0.5, // building hp removed by one smash (a temple never goes below VILLAGE.templeMinHp)
  // Untrained restraint, the slice's design default: training decides once the player trains it.
  // Each harmful key names its victim kind. While the brain's aggregate for a key is at or below 0
  // (never stroked for it on balance), the key is not offered for harmCooldown[victim] seconds after
  // the creature last harmed that kind, and eat:villager is not offered while eat:grain is (it
  // prefers grain when grain is reachable). A stroke lifts the restraint for that key; a slap
  // forbids it through the brain as before. A debug candidateFilter sees every candidate.
  harm: { 'eat:villager': 'villager', 'throw:villager': 'villager', 'smash:building': 'building' },
  harmCooldown: { villager: 160, building: 120 },
  fellWood: 2, // wood one felled tree yields when the creature hauls it (as a village woodcutter's chop: VILLAGE.treeYield)
  gutPerMeal: 1, // poop is offered once the gut holds at least 1
  dungTime: 60, // seconds a dung item fertilizes before it is used up
  dungRadius: 4, // it boosts the nearest field within this many tiles
  dungGrowth: 1 / 90, // field growth per second added by dung (village base rate is 1/45)
  carryZ: 6, // height units above the ground at which the creature holds things
  throwSpeed: 10, // tiles/s horizontal launch speed
  throwLift: 14, // height units/s vertical launch speed (landing about 17 > the hand's lethal 16)
  // Brain parameters for this creature. One full slap right after an action (credit age up to about
  // 2.7 s, learnRate 0.2) moves its score by at least 0.1, so a punished act is forbidden after one
  // slap; the brain's own default (-0.35) needs two slaps at age 0.
  brainParams: { forbidThreshold: -0.1 },
};
