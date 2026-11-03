// Node check that drawing only what is on screen changes no pixel (no browser).
//   node scripts/check-render.mjs
// The renderer puts only the entity sprites that overlap the view into the draw list, and the
// village picks sprites afresh only near the view and only when what they are picked by changes
// (step 2 of docs/gameplay-spec.md). With the real painters, a town of 300 villagers and the creature,
// every frame below is rendered twice with no tick between: culled, then with renderer.cull off
// (every sprite picked and drawn). The two must match pixel for pixel, over cameras inside the town,
// at its edges and off the map, at every zoom step, while the sim runs between frames.
import { readdirSync } from 'node:fs';
import { createGame } from '../src/game.js';
import { registerPainters } from '../src/art/registry.js';
import { makeLut } from '../src/art/lut.js';
import { buildTown } from '../src/dev/town.js';

const warn = console.warn;
console.warn = (...a) => { if (!String(a[0]).startsWith('art registry:')) warn(...a); };
for (const f of readdirSync(new URL('../src/art/painters/', import.meta.url))) {
  if (f.endsWith('.js')) registerPainters(await import(`../src/art/painters/${f}`));
}

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else { fails.push(msg); console.log(`FAIL ${msg}`); } };

const game = createGame({ seed: 2 });
const { world, systems, renderer, camera, display } = game;
systems.village.setup();
systems.creature.setup();
buildTown(game, 'player', 300, () => false);
buildTown(game, 'rival', 60, () => false);
game.clock.run(300, game.tick);
renderer.lut = makeLut(0);

const v = world.sites.village;
let seed = 7;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
let frames = 0, differing = 0, worst = null, drawnCulled = 0, drawnAll = 0;
for (const scale of [2, 3, 4, 6]) {
  display.setDevice(1920, 1080, 1);
  display.setScale(scale);
  for (let k = 0; k < 12; k++) {
    // inside the town most of the time, sometimes anywhere on the map or past its edge
    const far = k % 4 === 3;
    const x = far ? rnd() * (world.w + 20) - 10 : v.x + (rnd() - 0.5) * 40;
    const y = far ? rnd() * (world.h + 20) - 10 : v.y + (rnd() - 0.5) * 40;
    camera.centerOn(x, y, 4);
    camera.x += rnd() - 0.5; // sub-pixel camera positions round like the real ones
    game.clock.run(3, game.tick);
    renderer.cull = true;
    renderer.render();
    const culled = Uint32Array.from(renderer.view.data);
    drawnCulled += renderer.list.items.length;
    renderer.cull = false;
    renderer.render();
    drawnAll += renderer.list.items.length;
    renderer.cull = true;
    let d = 0;
    const view = renderer.view.data;
    for (let i = 0; i < view.length; i++) if (view[i] !== culled[i]) d++;
    if (d && !worst) worst = { scale, x: +x.toFixed(2), y: +y.toFixed(2), d };
    differing += d;
    frames++;
  }
}
ok(differing === 0, `culled frames match frames with every sprite drawn (${frames} frames at zoom 2/3/4/6, ${differing} differing pixels${worst ? `, first at ${JSON.stringify(worst)}` : ''})`);
ok(drawnCulled < drawnAll / 2, `culling leaves most entities out of the draw list (${drawnCulled} drawn of ${drawnAll} over the frames)`);

console.log(fails.length ? `check-render: ${pass} passed, ${fails.length} failed` : `check-render: ${pass} passed, 0 failed`);
process.exitCode = fails.length ? 1 : 0;
