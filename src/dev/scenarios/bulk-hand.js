// Bulk hand scenario: the real island with both villages set up and screen = 'play'. Drives the hand
// only through synthetic pointer input and checks the hand in bulk:
//   draw-grain   holding on a ripe field draws its grain; the hand shows the amount it carries
//   (grain dropped on the storehouse goes into stock)
//   draw-tree    a press held still on a tree draws its wood until the tree is gone
//   pour         wood taken from the woodpile, held over a house blueprint, pours in and god-builds it
//   multi        sweeping across villagers holds several; let go, they stay in the hand ("x3")
//   (one click puts one out; holding the button pours the rest out)
//   trees        sweeping across trees holds several; let go over the woodpile, their wood goes in
//   (shaking the hand empties it)
// Screenshots: draw-grain, draw-tree, pour, multi, trees.
import { HAND } from '../../systems/hand.js';
import { VILLAGE, woodIn } from '../../village/config.js';

export default async function bulkHand(t, game) {
  const { world, camera, events, input, systems } = game;
  const vs = systems.village, H = systems.hand.state;
  t.assert(world.sites && world.sites.village, 'the terrain system loaded the island');
  vs.setup();
  game.state.screen = 'play';
  const s = input.synth, p = input.pointer;
  const tick = () => t.step(game.clock.step);
  const own = (type) => world.query({ kind: 'building' }).find((b) => b.owner === 'player' && b.type === type && b.stage === 'done');
  const at = (x, y) => { const v = camera.worldToView(x, y, world.heightAt(x, y)); return { sx: v.sx, sy: v.sy }; };
  const over = (b) => at(b.x, b.y);
  const middle = (e) => { const v = camera.worldToView(e.x, e.y, e.z); return { sx: v.sx, sy: v.sy - Math.floor((e.sprite?.ay ?? 8) / 2) }; };
  const moveTo = (q) => { s.move(q.sx, q.sy); tick(); };
  /** Moves the pointer to q over `seconds`, one move per tick (a hand gliding, not jumping). */
  const glide = (q, seconds = 0.4) => {
    const a = { sx: p.sx, sy: p.sy }, n = Math.max(1, Math.round(seconds / game.clock.step));
    for (let i = 1; i <= n; i++) { s.move(Math.round(a.sx + ((q.sx - a.sx) * i) / n), Math.round(a.sy + ((q.sy - a.sy) * i) / n)); tick(); }
  };
  const field = own('field'), store = own('storehouse'), pile = own('woodpile');
  const seen = { shake: 0, pour: 0 };
  events.on('shake', () => seen.shake++);
  events.on('pour', () => seen.pour++);
  camera.centerOn(store.x, store.y, world.heightAt(store.x, store.y));
  t.step(0.5);

  // ---- 1. grain: hold on a ripe field, glide to the storehouse, let go
  field.growth = 1;
  moveTo(over(field));
  s.down(0);
  t.step(0.7);
  const grain = H.load?.amount ?? 0;
  t.assert(H.load?.kind === 'grain' && grain > 0 && grain <= VILLAGE.fieldYield, `holding on the field draws grain (${grain} of its ${VILLAGE.fieldYield})`);
  await t.shot('draw-grain');
  const g0 = store.grain;
  glide(over(store)); // fields it passes over on the way give more grain
  t.step(0.2);
  const carried = H.load?.amount ?? 0;
  s.up(0);
  tick();
  t.assert(store.grain === g0 + carried && !H.held.length, `dropped on the storehouse, ${carried} grain goes into stock (${g0} -> ${store.grain})`);

  // ---- 2. a standing tree, the press held still: its wood flows into the hand
  const trees = world.query({ kind: 'tree' }).filter((tr) => !tr.held && Math.hypot(tr.x - store.x, tr.y - store.y) < 9)
    .sort((a, b) => Math.hypot(a.x - store.x, a.y - store.y) - Math.hypot(b.x - store.x, b.y - store.y));
  const tree = trees[0];
  t.assert(tree, 'a tree stands near the storehouse');
  const want = woodIn(tree);
  moveTo(middle(tree));
  s.down(0);
  t.step(HAND.treeDrawDelay + 0.5);
  t.assert(H.load?.kind === 'wood' && H.load.amount > 0 && world.get(tree.id) && tree.wood < want, `a press held still on a tree draws its wood (${H.load?.amount} of ${want})`);
  await t.shot('draw-tree');
  for (let i = 0; i < 150 && world.get(tree.id); i++) tick();
  t.assert(!world.get(tree.id) && H.load?.amount === want, `the tree is gone once all ${want} wood is drawn (hand ${H.load?.amount})`);
  const w0 = pile.wood;
  glide(over(pile));
  t.step(0.2);
  s.up(0);
  tick();
  t.assert(pile.wood === w0 + want && !H.held.length, `dropped on the woodpile, the wood goes into stock (${w0} -> ${pile.wood})`);

  // ---- 3. woodpile -> blueprint: pour to god-build
  pile.wood = Math.max(pile.wood, 2000);
  let spot = null;
  for (let r = 3; r < 9 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
    const tx = Math.floor(store.x) + dx, ty = Math.floor(store.y) + dy;
    if (vs.validate('house', tx, ty).ok) spot = [tx, ty];
  }
  const siteId = spot ? vs.placeBlueprint('house', spot[0], spot[1]) : null;
  const site = siteId !== null ? world.get(siteId) : null;
  t.assert(site && site.stage === 'blueprint', `a house blueprint near the storehouse (${spot})`);
  if (site) {
    moveTo(over(pile));
    s.down(0);
    for (let i = 0; i < 300 && (H.load?.amount ?? 0) < 1.6 * site.woodCost; i++) tick();
    const taken = H.load?.amount ?? 0;
    t.assert(taken >= 1.5 * site.woodCost, `holding on the woodpile takes ${taken} wood out`);
    const god0 = vs.stats().player.godWood;
    glide(over(site));
    for (let i = 0; i < 20 && !seen.pour; i++) tick();
    t.step(0.3);
    t.assert(seen.pour > 0 && site.woodHave > 0 && site.progress > 0, `held over the blueprint the wood pours in (woodHave ${site.woodHave}, progress ${site.progress.toFixed(1)} s)`);
    await t.shot('pour');
    for (let i = 0; i < 200 && site.stage !== 'done'; i++) tick();
    const god = vs.stats().player.godWood - god0;
    // builders may haul wood to it too meanwhile, so the hand's share is at most the full god cost
    t.assert(site.stage === 'done' && god > 0 && god <= VILLAGE.godBuildFactor * site.woodCost, `the house is god-built: ${god} wood poured (full god cost ${VILLAGE.godBuildFactor * site.woodCost})`);
    s.up(0);
    tick();
    if (H.held.length) systems.hand.shake();
  }

  // ---- 4. multi pick-up: villagers swept up, stowed, put out
  const people = world.query({ kind: 'villager' }).filter((v) => v.owner === 'player' && v.hp > 0 && !v.held);
  const cx = store.x + 2.5, cy = store.y + 2.5;
  const group = people.slice(0, 3);
  group.forEach((v, i) => { v.path = null; v.work = null; v.wait = 5; world.move(v, cx + i * 0.9, cy, world.heightAt(cx + i * 0.9, cy)); });
  tick();
  moveTo(middle(group[0]));
  s.down(0);
  tick();
  for (const v of group.slice(1)) glide(middle(v), 0.15);
  t.assert(H.held.length === 3, `sweeping across villagers holds all three (${H.held.length})`);
  glide(at(cx + 1, cy + 3), 0.3);
  t.step(0.2);
  s.up(0);
  tick();
  t.assert(H.stowed && H.held.length === 3, 'let go, the group stays in the hand');
  await t.shot('multi');
  s.down(0); s.up(0);
  tick();
  t.assert(H.held.length === 2, `a click puts one villager out (${H.held.length} left)`);
  s.down(0);
  for (let i = 0; i < 40 && H.held.length; i++) {
    s.move(p.sx + 2, p.sy);
    tick();
  }
  s.up(0);
  tick();
  t.assert(!H.held.length && group.every((v) => !v.held), 'holding the button pours the rest out');
  t.step(1);

  // ---- 5. multi pick-up of trees, let go over the woodpile
  const stand = world.query({ kind: 'tree' }).filter((tr) => !tr.held && !tr.uprooted && Math.hypot(tr.x - pile.x, tr.y - pile.y) < 10)
    .sort((a, b) => Math.hypot(a.x - pile.x, a.y - pile.y) - Math.hypot(b.x - pile.x, b.y - pile.y)).slice(0, 3);
  t.assert(stand.length === 3, `three trees near the woodpile (${stand.length})`);
  const woods = stand.reduce((a, tr) => a + woodIn(tr), 0);
  const q0 = middle(stand[0]);
  moveTo(q0);
  s.down(0);
  s.move(q0.sx + 4, q0.sy);
  tick();
  for (const tr of stand.slice(1)) glide(middle(tr), 0.2);
  // trees passed over on the way are swept up too
  const swept = H.held.map((id) => world.get(id)).filter(Boolean);
  const sweptWood = swept.reduce((a, tr) => a + woodIn(tr), 0);
  t.assert(swept.length >= 3 && stand.every((tr) => tr.held) && H.load?.amount === sweptWood && sweptWood >= woods, `sweeping across trees holds ${swept.length} with ${sweptWood} wood`);
  glide(over(pile), 0.5);
  t.step(0.2);
  await t.shot('trees');
  const p0 = pile.wood;
  s.up(0);
  tick();
  t.assert(pile.wood === p0 + sweptWood && swept.every((tr) => !world.get(tr.id)) && !H.held.length, `let go over the woodpile, the trees' ${sweptWood} wood goes in (${p0} -> ${pile.wood})`);

  // ---- 6. shake empties the hand
  field.growth = 1;
  moveTo(over(field));
  s.down(0);
  t.step(0.4);
  // grain, or a villager working the field when one stands under the pointer: either is held
  t.assert(H.held.length === 1, `holding something before the shake (${H.load?.kind} ${H.load?.amount})`);
  for (let i = 0; i < 12 && H.held.length; i++) { s.move(p.sx + (i % 2 ? -40 : 40), p.sy); tick(); }
  t.assert(!H.held.length && seen.shake === 1, `a fast shake empties the hand (${seen.shake} shake)`);
  s.up(0);
  t.step(1);
}
