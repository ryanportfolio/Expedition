// Village art scenario: the real island on the engine's debug terrain pass, both villages set up and
// run for 90 sim seconds so villagers are mid-work, then a player house blueprint taken to the
// `building` stage. Screenshots at zoom 1: player village, rival village, the construction site, and
// the player village under the evil LUT. Asserts that every building, villager and item sprite in
// view came from a registered painter (never the checker placeholder), that one miracle orb floats on
// each of the player temple building's painted pedestals, and that each orb shows at least 90% of its
// sprite pixels with the camera on the temple (screenshot temple-orbs). Before the sim runs it checks the sprite contracts
// on the sprites themselves: building footprint widths and anchors per kind, owner and stage,
// villager anchors on the feet for all 1120 combos, frames, jobs and owners all distinct, and
// repaints identical to the registry's cached sprites.
import { buildIsland } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { lutFor, makeLut } from '../../art/lut.js';
import { listSprites, placeholderSprite, getSprite } from '../../art/registry.js';
import { worldToScreen } from '../../world/iso.js';
import { TEMPLE_PEDESTALS, sprites as buildingPainters } from '../../art/painters/buildings.js';
import { sprites as villagerPainters } from '../../art/painters/villagers.js';
import { KINDS } from '../../village/config.js';

const OURS = { villager: 'villager', wood: 'wood', grain: 'grain' };
const OWNERS = ['player', 'rival'];
const STAGES = ['blueprint', 'building', 'done', 'wrecked'];
const JOBS = ['farmer', 'woodcutter', 'builder', 'worshipper', 'idle'];
const POSES = ['idle', 'walk', 'work', 'carry', 'pray', 'flee', 'dead'];
const FACINGS = ['se', 'sw', 'ne', 'nw'];
const CYCLES = ['walk', 'work', 'carry', 'pray', 'flee'];
// Fields are bare tilled soil until finished, so a field blueprint or site looks the same for both owners.
const SHARED_BY_OWNERS = new Set(['field|blueprint', 'field|building']);

const same = (a, b) => a.w === b.w && a.h === b.h && a.ax === b.ax && a.ay === b.ay && a.data.every((v, i) => v === b.data[i]);
/** Leftmost and rightmost opaque columns on the anchor row and its neighbours: the ground diamond's corners. */
function baseSpan(s) {
  let x0 = Infinity, x1 = -Infinity;
  for (let y = Math.max(0, s.ay - 1); y <= Math.min(s.h - 1, s.ay + 1); y++)
    for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  return [x0, x1];
}
function lowestOpaqueRow(s) {
  for (let y = s.h - 1; y >= 0; y--) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) return y;
  return -1;
}
/** Index pairs (i < j) of identical sprites in a list. */
const samePairs = (list) => list.flatMap((a, i) => list.slice(i + 1).flatMap((b, k) => (same(a, b) ? [[i, i + 1 + k]] : [])));

/** Sprite contracts checked on the sprites themselves, before the sim runs. */
function contractChecks(t) {
  // Buildings: every kind, owner and stage spans its footprint diamond ((fw + fh) * 16 px, within
  // 4 px for eaves and rubble) with the anchor near the middle; owners look different.
  for (const [kind, k] of Object.entries(KINDS)) {
    const want = (k.fw + k.fh) * 16, bad = [], shared = [];
    for (const stage of STAGES) {
      const byOwner = OWNERS.map((owner) => getSprite(kind, { owner, stage, growth: 1 }));
      byOwner.forEach((s, i) => {
        const [x0, x1] = baseSpan(s);
        if (s === placeholderSprite() || Math.abs(x1 - x0 + 1 - want) > 4 || Math.abs((x0 + x1 + 1) / 2 - s.ax) > 2 || s.ay < 0 || s.ay >= s.h)
          bad.push(`${OWNERS[i]} ${stage}: base ${x1 - x0 + 1} px, anchor ${s.ax},${s.ay} in ${s.w}x${s.h}`);
      });
      if (same(...byOwner)) shared.push(stage);
    }
    t.assert(bad.length === 0, `${kind}: every owner and stage spans its ${want} px footprint with the anchor centred${bad.length ? ` (${bad.join('; ')})` : ''}`);
    const unexpected = shared.filter((stage) => !SHARED_BY_OWNERS.has(`${kind}|${stage}`));
    if (shared.length) t.log(`${kind}: player and rival sprites identical at ${shared.join(', ')}`);
    t.assert(unexpected.length === 0, `${kind}: player and rival sprites differ at every stage except the allowed shared ones${unexpected.length ? ` (identical: ${unexpected.join(', ')})` : ''}`);
  }
  for (const owner of OWNERS) {
    const crops = [0, 0.25, 0.5, 0.75, 1].map((growth) => getSprite('field', { owner, stage: 'done', growth }));
    t.assert(samePairs(crops).length === 0, `${owner} field growth 0, 0.25, 0.5, 0.75 and 1 all look different`);
  }

  // Villagers: all 1120 job/pose/frame/facing/owner combos have the anchor on the feet (the
  // lowest opaque row, within 1 px for a hoe blade biting the soil) and a sane height.
  let total = 0;
  const off = [];
  for (const job of JOBS) for (const pose of POSES) for (let frame = 0; frame < 4; frame++) for (const facing of FACINGS) for (const owner of OWNERS) {
    const s = getSprite('villager', { job, pose, frame, facing, owner });
    total++;
    const low = lowestOpaqueRow(s);
    if (s === placeholderSprite() || Math.abs(low - s.ay) > 1 || s.h < 4 || s.h > 24 || s.ax < 0 || s.ax >= s.w) off.push(`${job} ${pose} ${frame} ${facing} ${owner} (feet row ${low}, anchor ${s.ax},${s.ay}, ${s.w}x${s.h})`);
  }
  t.assert(total === 1120 && off.length === 0, `villager anchors on the feet for all ${total} combos${off.length ? `: ${off.slice(0, 6).join('; ')}` : ''}`);

  // Every animated pose's 4 frames are pairwise different, for every job, facing and owner; the
  // jobs differ from each other in every pose and frame; the owners differ in every combo.
  const frameDup = [], jobDup = [], ownerDup = [];
  const v = (job, pose, frame, facing, owner) => getSprite('villager', { job, pose, frame, facing, owner });
  for (const owner of OWNERS) for (const facing of FACINGS) for (const job of JOBS) for (const pose of CYCLES)
    for (const [i, j] of samePairs([0, 1, 2, 3].map((f) => v(job, pose, f, facing, owner)))) frameDup.push(`${owner} ${facing} ${job} ${pose} ${i}=${j}`);
  for (const facing of FACINGS) for (const pose of POSES) for (let frame = 0; frame < 4; frame++) {
    for (const owner of OWNERS)
      for (const [i, j] of samePairs(JOBS.map((job) => v(job, pose, frame, facing, owner)))) jobDup.push(`${owner} ${facing} ${pose} ${frame} ${JOBS[i]}=${JOBS[j]}`);
    for (const job of JOBS) if (same(v(job, pose, frame, facing, 'player'), v(job, pose, frame, facing, 'rival'))) ownerDup.push(`${facing} ${job} ${pose} ${frame}`);
  }
  t.assert(frameDup.length === 0, `walk, work, carry, pray and flee frames pairwise different for every job, facing and owner${frameDup.length ? ` (${frameDup.slice(0, 6).join('; ')})` : ''}`);
  t.assert(jobDup.length === 0, `jobs look different in every pose, frame and facing, the dead pose included${jobDup.length ? ` (${jobDup.slice(0, 6).join('; ')})` : ''}`);
  t.assert(ownerDup.length === 0, `player and rival villagers differ in every combo${ownerDup.length ? ` (${ownerDup.slice(0, 6).join('; ')})` : ''}`);

  // Painters are pure: a fresh repaint matches the registry's cached sprite pixel for pixel.
  const repaints = [
    ['villager', villagerPainters.villager, { job: 'farmer', pose: 'walk', frame: 2, facing: 'nw', owner: 'rival' }],
    ['villager', villagerPainters.villager, { job: 'builder', pose: 'dead', frame: 0, facing: 'sw', owner: 'player' }],
    ['field', buildingPainters.field, { owner: 'player', stage: 'done', growth: 0.5 }],
    ['house', buildingPainters.house, { owner: 'rival', stage: 'wrecked' }],
    ['temple', buildingPainters.temple, { owner: 'player', stage: 'done' }],
  ];
  const drift = repaints.filter(([name, paint, opts]) => !same(paint(opts), getSprite(name, opts))).map(([name, , opts]) => `${name} ${JSON.stringify(opts)}`);
  t.assert(drift.length === 0, `repainting the same opts gives identical sprites${drift.length ? ` (differs: ${drift.join('; ')})` : ''}`);
}

export default async function villageArt(t, game) {
  const { world, renderer, camera, display } = game;
  world.loadMap(buildIsland());
  renderer.lut = lutFor(0);
  renderer.addTerrainPass(debugTerrainPass);
  const vs = game.systems.village;
  vs.setup();
  const site = world.sites.village, rival = world.sites.rival;
  const focus = (x, y) => { camera.centerOn(x, y, world.heightAt(x, y)); t.step(1 / 30); };

  const registered = new Set(listSprites());
  for (const name of ['house', 'field', 'store', 'mine', 'temple', 'villager', 'wood', 'grain', 'ore'])
    t.assert(registered.has(name), `painter registered for "${name}"`);
  contractChecks(t);

  /** Village entities whose sprite anchor projects into the current view. */
  function inView() {
    const cx = Math.round(camera.x), cy = Math.round(camera.y);
    return world.query({}).filter((e) => {
      if (!e.sprite || e.madeBy === undefined && e.kind !== 'villager') return false;
      const p = worldToScreen(e.x, e.y, e.z);
      const vx = p.sx - cx, vy = p.sy - cy;
      return vx > -40 && vy > -40 && vx < display.w + 40 && vy < display.h + 60;
    });
  }
  function checkView(label) {
    const ents = inView().filter((e) => e.kind === 'building' || OURS[e.kind]);
    const names = new Set();
    let bad = 0;
    for (const e of ents) {
      const name = e.kind === 'building' ? e.type : OURS[e.kind];
      names.add(name);
      if (!registered.has(name) || e.sprite === placeholderSprite()) { bad++; t.log(`${label}: placeholder or unregistered sprite on ${e.kind} ${e.id} (${name})`); }
    }
    const kinds = ents.reduce((m, e) => { m[e.kind] = (m[e.kind] ?? 0) + 1; return m; }, {});
    t.log(`${label}: in view`, kinds, [...names].join(', '));
    t.assert(ents.length > 0 && bad === 0, `${label}: all ${ents.length} building/villager/item sprites in view come from registered painters (${[...names].join(', ')})`);
    return ents;
  }

  t.step(90);
  const s = vs.stats();
  t.log('after 90 s', s);
  const working = world.query({ kind: 'villager' }).filter((v) => v.pose === 'work' || v.pose === 'pray' || v.pose === 'carry');
  t.assert(working.length >= 3, `villagers mid-work after 90 s (${working.length} working, praying or carrying)`);

  // Orbs on the pedestals the temple painter draws, and visible there. On this island the village
  // can't build the player temple on world.sites.temple (the site is too steep) and puts it one tile
  // west, so the check is against the temple *building*, never the site: an offset check against the
  // site passed while the heal orb sat inside the temple and drew 0 of its pixels.
  const temple = world.query({ kind: 'building' }).find((b) => b.type === 'temple' && b.owner === 'player');
  const orbs = world.query({ kind: 'orb' });
  t.log('temple', { x: temple.x, y: temple.y, z: temple.z, site: world.sites.temple }, 'orbs', orbs.map((o) => [o.miracle, o.x, o.y, o.z]));
  const off = (o) => [o.x - temple.x, o.y - temple.y];
  const onPedestal = (o) => TEMPLE_PEDESTALS.findIndex(([dx, dy]) => Math.hypot(off(o)[0] - dx, off(o)[1] - dy) < 0.05);
  const used = orbs.map(onPedestal);
  t.assert(orbs.length === TEMPLE_PEDESTALS.length && used.every((i) => i >= 0) && new Set(used).size === orbs.length,
    `one orb on each of the ${TEMPLE_PEDESTALS.length} painted temple pedestals (${orbs.map((o) => `${o.miracle} ${off(o).map((v) => +v.toFixed(2))}`).join('; ')})`);
  // Visible: with the camera on the temple, take each orb's sprite away and count the pixels of its
  // sprite box that change. A pixel the temple (or anything in front) covers doesn't change. The orb
  // glows are left out while measuring: their additive core and glints can push a pixel to the same
  // near-white with and without the sprite, which reads as hidden though nothing covers the orb.
  focus(temple.x, temple.y);
  const frame = () => Uint32Array.from(renderer.render().buf);
  const glowItems = game.systems.miracles.orbs.glows, keptGlows = [...glowItems];
  glowItems.clear();
  for (const o of orbs) {
    const spr = o.sprite, opaque = spr.data.reduce((n, v) => n + (v ? 1 : 0), 0);
    const ctx = renderer.render(), with_ = Uint32Array.from(ctx.buf), { vx, vy } = ctx.toView(o.x, o.y, o.z);
    o.sprite = null;
    const without = frame();
    o.sprite = spr;
    let shown = 0;
    for (let y = vy - spr.ay; y < vy - spr.ay + spr.h; y++)
      for (let x = vx - spr.ax; x < vx - spr.ax + spr.w; x++)
        if (x >= 0 && y >= 0 && x < display.w && y < display.h && with_[y * display.w + x] !== without[y * display.w + x]) shown++;
    t.assert(shown >= 0.9 * opaque, `${o.miracle} orb visible beside the temple: ${shown} of its ${opaque} sprite pixels drawn (want 90%)`);
  }
  for (const [k, v] of keptGlows) glowItems.set(k, v);
  await t.shot('temple-orbs');

  // Player village.
  focus(site.x + 0.5, site.y - 1.5);
  checkView('player village');
  await t.shot('player-village');

  // Rival village.
  focus(rival.x + 0.5, rival.y - 0.5);
  checkView('rival village');
  await t.shot('rival-village');

  // A player house blueprint near the centre, taken to the building stage by hauled wood.
  let id = null, at = null;
  for (let r = 2; r <= 9 && id === null; r++)
    for (let dy = -r; dy <= r && id === null; dy++)
      for (let dx = -r; dx <= r && id === null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !vs.validate('house', site.x + dx, site.y + dy).ok) continue;
        at = [site.x + dx, site.y + dy];
        id = vs.placeBlueprint('house', at[0], at[1]);
      }
  t.assert(id !== null, `house blueprint placed at ${at}`);
  const house = world.get(id);
  focus(house.x, house.y);
  t.assert(house.sprite && house.sprite === getSprite('house', { owner: 'player', stage: 'blueprint' }), 'fresh blueprint draws the house blueprint sprite');
  await t.shot('blueprint');
  let waited = 0;
  while (house.stage !== 'building' && waited < 240) { t.step(1); waited++; }
  t.assert(house.stage === 'building', `house reached the building stage in ${waited} s`);
  t.step(4);
  focus(house.x, house.y);
  t.assert(house.sprite === getSprite('house', { owner: 'player', stage: 'building' }) && house.sprite !== placeholderSprite(), 'construction site draws the scaffolded house sprite');
  checkView('construction site');
  await t.shot('construction-site');

  // Player village under the evil LUT (and evil alignment, for an alignment system that drives the LUT).
  game.state ??= {};
  const keep = game.state.alignment;
  game.state.alignment = -1;
  renderer.lut = makeLut(-1);
  focus(site.x + 0.5, site.y - 1.5);
  renderer.lut = makeLut(-1);
  checkView('player village, evil LUT');
  await t.shot('player-village-evil');
  game.state.alignment = keep;
  renderer.lut = lutFor(0);
}
