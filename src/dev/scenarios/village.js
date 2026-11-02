// Village scenario: the real island on the engine's debug terrain pass, both villages set up, three
// sim minutes of village life, a player house blueprint built by hauled wood, and a villager dropped
// by the temple turning worshipper. Sprites are placeholders until the painters land.
import { buildIsland } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { lutFor } from '../../art/lut.js';
import { rgba } from '../../render/buffer.js';

// Debug-only footprint outlines under the placeholder sprites, so the screenshots show which
// building is which: finished player blue, rival red; blueprints dashed yellow, sites under
// construction solid yellow, wrecks dark.
const EDGE = { player: rgba('#9fd0ff'), rival: rgba('#ff9a7a'), site: rgba('#f2e08a'), wrecked: rgba('#2a2a2a') };
function footprintPass(ctx) {
  for (const b of ctx.world.query({ kind: 'building' })) {
    if (b.tx === undefined) continue;
    const c = b.stage === 'wrecked' ? EDGE.wrecked : b.stage === 'done' ? EDGE[b.owner] : EDGE.site;
    const z = b.z;
    const corners = [[b.tx, b.ty], [b.tx + b.fw, b.ty], [b.tx + b.fw, b.ty + b.fh], [b.tx, b.ty + b.fh]].map(([x, y]) => ctx.toView(x, y, z));
    for (let k = 0; k < 4; k++) {
      const a = corners[k], e = corners[(k + 1) % 4];
      const n = Math.max(Math.abs(e.vx - a.vx), Math.abs(e.vy - a.vy));
      for (let i = 0; i <= n; i++) {
        if (b.stage === 'blueprint' && (i >> 1) & 1) continue;
        const x = Math.round(a.vx + ((e.vx - a.vx) * i) / n), y = Math.round(a.vy + ((e.vy - a.vy) * i) / n);
        if (x >= 0 && y >= 0 && x < ctx.w && y < ctx.h) ctx.buf[y * ctx.w + x] = c;
      }
    }
  }
}

export default async function village(t, game) {
  const { world, renderer, camera, events } = game;
  world.loadMap(buildIsland());
  renderer.lut = lutFor(0);
  renderer.addTerrainPass(debugTerrainPass);
  const vs = game.systems.village;
  vs.setup();
  renderer.addTerrainPass(footprintPass);
  const site = world.sites.village;
  camera.centerOn(site.x - 1, site.y - 2, world.heightAt(site.x, site.y));
  t.step(1 / 30);

  const villagers = (owner) => world.query({ kind: 'villager' }).filter((v) => v.owner === owner);
  const s0 = vs.stats();
  t.log('start', s0);
  t.assert(s0.player.population >= 8 && s0.rival.population >= 8, `both villages populated (${s0.player.population}, ${s0.rival.population})`);
  t.assert(villagers('player').every((v) => v.sprite && v.owner === 'player' && v.grabbable === true), 'player villagers have sprites and spec fields');
  const start = new Map(world.query({ kind: 'villager' }).map((v) => [v.id, { x: v.x, y: v.y }]));
  await t.shot('start');

  let elapsed = 0;
  const run = (sec) => { t.step(sec); elapsed += sec; };
  run(60);

  // House blueprint near the village centre, on the nearest valid spot.
  let id = null, at = null;
  for (let r = 2; r <= 8 && id === null; r++)
    for (let dy = -r; dy <= r && id === null; dy++)
      for (let dx = -r; dx <= r && id === null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !vs.validate('house', site.x + dx, site.y + dy).ok) continue;
        at = [site.x + dx, site.y + dy];
        id = vs.placeBlueprint('house', at[0], at[1]);
      }
  t.assert(id !== null, `house blueprint placed at ${at}`);
  const house = world.get(id);
  let completed = false;
  events.on('building-complete', (p) => { if (p.buildingId === id) completed = true; });
  let shotMid = false, waited = 0;
  while (house.stage !== 'done' && waited < 240) {
    run(1);
    waited++;
    if (!shotMid && (house.stage === 'building' || house.woodHave >= 2)) {
      shotMid = true;
      t.log('mid-construction', { stage: house.stage, woodHave: house.woodHave, progress: house.progress });
      await t.shot('mid-construction');
    }
  }
  t.assert(shotMid, 'saw the house mid-construction');
  t.assert(house.stage === 'done' && completed, `house blueprint completed in ${waited} s (bounded at 240 s)`);

  if (elapsed < 180) run(180 - elapsed);
  const s1 = vs.stats();
  t.log('after 3 minutes', s1);
  const moved = [...start].filter(([vid, p]) => { const v = world.get(vid); return v && Math.hypot(v.x - p.x, v.y - p.y) > 2; }).length;
  t.assert(moved >= 6, `villagers moved (${moved} moved more than 2 tiles)`);
  t.assert(s1.player.woodDelivered > 0, `wood went up (${s1.player.woodDelivered} delivered)`);
  t.assert(s1.player.grainHarvested > 0, `grain harvested (${s1.player.grainHarvested})`);
  t.assert(s1.power > 0, `power > 0 (${s1.power.toFixed(2)})`);

  // Hand drop by the temple, as the hand system would report it.
  const temple = world.query({ kind: 'building' }).find((b) => b.type === 'temple' && b.owner === 'player');
  const v = villagers('player').find((u) => u.job !== 'worshipper' && u.hp > 0);
  const x = temple.tx + temple.fw + 0.5, y = temple.ty + 1.5;
  events.emit('grab', { entityId: v.id, x: v.x, y: v.y, z: v.z });
  world.move(v, x, y, world.heightAt(x, y));
  events.emit('release', { entityId: v.id, kind: 'villager', x, y, z: v.z, vx: 0, vy: 0, vz: 0 });
  events.emit('landed', { entityId: v.id, speed: 0.4 });
  run(10);
  t.assert(v.job === 'worshipper', `villager dropped by the temple became a worshipper (job ${v.job}, pose ${v.pose})`);

  camera.centerOn(site.x - 3, site.y - 4, world.heightAt(site.x, site.y));
  t.step(1 / 30);
  t.log('end', vs.stats());
  await t.shot('end');
}
