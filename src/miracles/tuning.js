// Miracle tuning. Every number a designer may want to change lives here; distances are in tiles,
// times in seconds of sim time, hp and burning on their 0..1 scales.

export const MIRACLES = ['rain', 'heal', 'fire', 'lightning'];

export const TUNING = {
  /** Worship power spent per cast. */
  costs: { rain: 15, heal: 20, fire: 20, lightning: 30 },
  /** Alignment weight of the `act` each cast emits (good positive). */
  weights: { rain: 0.3, heal: 0.4, fire: -0.4, lightning: -0.6 },

  orbs: {
    /** Pedestal offsets from the temple tile center, one per miracle. Rain and heal sit on the far
     * side of the temple (top of the screen), fire and lightning on the near side. */
    pedestals: { rain: [0, -1.5], heal: [-1.5, 0], fire: [1.5, 0], lightning: [0, 1.5] },
    respawn: 4, // seconds before a taken orb is replaced on its pedestal
    /** Height units from the stone's foot (the temple base) to the orb's bottom pixel. The painted
     * stone (src/art/painters/buildings.js playerTemple) is 7 px tall and its top face reaches
     * 0.14 tiles * 16 = 2.2 px higher at the back corner: 9.2 px, 1.16 units. The far orbs (rain,
     * heal) sort behind the temple sprite, so any of their pixels below that line is painted over by
     * the stone; at 1.0 the bob dipped them 2 to 4 rows into it. hover - bobAmp = 1.25 units (10 px)
     * keeps every orb clear of its stone through the whole bob. */
    hover: 1.5,
    bobAmp: 0.25, // height units
    bobPeriod: 2.4, // seconds per bob
    castSpeed: 2, // release speed (tiles/s) at or under which the orb counts as dropped and casts at once
    flightTimeout: 4, // a thrown orb with no `landed` event casts where it is after this long
  },

  rain: {
    radius: 4,
    duration: 10,
    growthRate: 0.08, // growth per second added to entities with a numeric `growth` in range (0.2 -> 0.52 in 4 s, readable on crops)
    extinguishTime: 2, // full burning (1) to 0 in this long under rain
  },

  fire: {
    radius: 2, // ignition radius of the miracle
    igniteDelay: 0.3, // the ring of flame reaches the targets
    startBurning: 1, // burning set by the miracle and lightning (spec)
    spreadStart: 0.3, // burning of a neighbor that catches
    rampRate: 0.5, // burning per second while a fire grows toward 1
    burnTime: 9, // seconds an entity burns before the fire dies down
    fadeTime: 2.5, // seconds from burning 1 to 0 once it dies down
    /** hp lost per second at burning 1, by building type or else by kind. A house, store, woodpile or
     * field that catches burns to hp 0 unless rain puts it out: lit by the miracle it is a wreck
     * after about 7 s, caught by spread after about 8 s. The stone temple loses about half its hp to
     * a full burn and stands: a wrecked temple can't be rebuilt, and the orb pedestals stand beside
     * it, so a fumbled fire orb would otherwise end worship for good. Trees burn down (spec: removed
     * at hp 0); a villager who keeps burning dies. */
    damage: { temple: 0.05, building: 0.14, tree: 0.14, villager: 0.12, other: 0.1 },
    /** Height (height units) above the entity's ground point where its flames sit: on the roof, in the canopy. */
    lift: { field: 0.3, building: 1, tree: 1.2, villager: 0, other: 0.5 },
    /** Spread is bounded (fire.js): one blaze (the fires one cast or bolt lights together) catches
     * at most spreadBudget more entities, and each generation away from the first fires spreads
     * spreadDecay times as readily as the one before. */
    spreadReach: 1.5, // tiles, edge to edge between footprints, a fire can jump
    spreadChance: 0.12, // chance per second (times burning) to catch each flammable neighbor, generation 0
    spreadFrom: { field: 0.4, building: 1, tree: 0.5, other: 0.5 }, // how readily each type or kind passes fire on (fields and trees less than buildings)
    spreadDecay: 0.4, // chance factor per generation
    spreadBudget: 2, // entities one blaze may spread to, in total: a burning house takes one or two neighbors at most
    spreadMin: 0.4, // a fire spreads only once it burns at least this hot
    maxHalfDiag: 2.2, // largest footprint centre-to-corner distance (3x3 field or temple), for the neighbor query
  },

  heal: {
    radius: 3,
    amount: 0.6, // hp restored, capped at 1
    delay: 0.35, // the healing ring rolls over the targets
  },

  lightning: {
    killRadius: 1,
    damageRadius: 1.5,
    buildingDamage: 0.5,
    igniteRadius: 1.5,
    /** Bolt times inside the strike effect (lightning/lightning-strike strokes at 0.76, 1.04, 1.26 s).
     * The first stroke does the damage; every stroke flashes the screen. */
    strokes: [0.76, 1.04, 1.26],
    flash: [0.55, 0.35, 0.2], // flash strength per stroke
    flashTime: 0.13, // seconds per flash
  },
};
