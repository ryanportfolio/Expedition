// Towns of hundreds of villagers for perf scenes and benches (step 2 of docs/gameplay-spec.md):
// buildTown lays out a full town round a village through the village's own placement rules and
// fills it with villagers. Used by src/dev/scenarios/perf.js and scripts/sim-bench.mjs; the game
// itself never calls it. Deterministic: no randomness here, and the village adopts the villagers
// with game.rng.
import { KINDS } from '../village/config.js';

/** Villagers in each town (step 2 of docs/gameplay-spec.md: towns of hundreds). */
export const TOWN = { player: 600, rival: 120 };
/** Villagers per building of each kind in a town (houses hold KINDS.house.cap each). */
const PER = { field: 15, storehouse: 100, woodpile: 100 };
/** Stock per store in a town: enough that woodpiles stay above VILLAGE.woodTarget all scene (so
 * the woodcutters, one by then, leave the forest the fires need) and nobody goes hungry. */
const STOCK = { wood: 20000, grain: 10000 };
/** House blueprints kept open in the player town, per villager. */
export const OPEN_PER = 15;
/** Town reach in tiles from the village centre. */
const TOWN_R = 40;
/** Candidate centre tiles within TOWN_R of a village's centre, nearest first (ties: row, column). */
export function townSpots(vill) {
  const cx = Math.floor(vill.cx), cy = Math.floor(vill.cy), out = [];
  for (let dy = -TOWN_R; dy <= TOWN_R; dy++) for (let dx = -TOWN_R; dx <= TOWN_R; dx++) {
    const d = Math.hypot(dx, dy);
    if (d <= TOWN_R) out.push({ tx: cx + dx, ty: cy + dy, d });
  }
  return out.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
}

/** Finishes a placed building at once, as if builders had built it; stores get STOCK. */
function finish(b, k) {
  b.stage = 'done';
  b.woodHave = b.woodCost;
  b.progress = KINDS[b.type].buildTime;
  b.flammable = true;
  if (b.type === 'field') b.growth = (k * 0.618) % 1; // fields at every stage of growth
  if (b.type === 'woodpile') b.wood = STOCK.wood;
  if (b.type === 'storehouse') b.grain = STOCK.grain;
}

/**
 * Builds a town of `pop` villagers round `owner`'s village: houses for all of them, and fields,
 * storehouses and woodpiles in the PER ratios. Each building goes through the village's own
 * placement (placeBlueprint: influence, ground, no overlap, no tree or rock in the way) on the
 * nearest free spot with a 1-tile margin round it, outside `keepOut(x, y)`, the kind furthest behind
 * its count first, and is finished at once (finish). Then villagers are spawned in the houses until
 * the town holds `pop`; the village adopts them on its next tick. Returns the spot list and the next
 * index in it, for the open sites the tick hook places later.
 */
export function buildTown(game, owner, pop, keepOut) {
  const { world } = game, sim = game.systems.village.sim;
  const mine = (type) => world.query({ kind: 'building' }).filter((b) => b.owner === owner && b.type === type);
  const want = { house: Math.ceil(pop / KINDS.house.cap), field: Math.ceil(pop / PER.field), storehouse: Math.ceil(pop / PER.storehouse), woodpile: Math.ceil(pop / PER.woodpile) };
  const have = Object.fromEntries(Object.keys(want).map((k) => [k, mine(k).length]));
  for (const t of ['woodpile', 'storehouse']) for (const b of mine(t)) finish(b, 0); // the start stores get the town's stock
  const spots = townSpots(sim.village(owner));
  let i = 0;
  for (; i < spots.length; i++) {
    const order = Object.keys(want).filter((k) => have[k] < want[k]).sort((a, b) => have[a] / want[a] - have[b] / want[b]);
    if (!order.length) break;
    const { tx, ty } = spots[i];
    if (keepOut(tx + 0.5, ty + 0.5)) continue;
    const type = order.find((k) => sim.validate(k, tx, ty, owner, { margin: 1 }).ok);
    if (!type) continue;
    const id = sim.placeBlueprint(type, tx, ty, owner);
    if (id === null) continue;
    finish(world.get(id), have[type]++);
  }
  const houses = mine('house');
  let n = world.query({ kind: 'villager' }).filter((v) => v.owner === owner).length;
  for (let k = 0; n < pop && houses.length; k++, n++) {
    const h = houses[k % houses.length], c = (k / houses.length) | 0; // the house's four tiles in turn
    world.spawn('villager', { x: h.tx + 0.5 + (c & 1), y: h.ty + 0.5 + ((c >> 1) & 1), owner, hp: 1, grabbable: true, flammable: false, burning: 0 });
  }
  return { spots, next: i, want, have };
}
