// Bulk hand scenario: the real island with both villages set up and screen = 'play'. Drives the hand
// only through synthetic pointer input and checks the hand in bulk:
//   draw-grain   holding on a ripe field draws its grain; the hand shows the amount it carries
//   (grain dropped on the store goes into stock)
//   draw-tree    a press held still on a tree draws its wood until the tree is gone
//   pour         wood taken from the store's log stack (its right third), held over a house
//                blueprint, pours in and god-builds it
//   multi        sweeping across villagers holds several; let go, they stay in the hand ("x3")
//   (one click puts one out; holding the button pours the rest out)
//   trees        sweeping across trees holds several; let go over the store, their wood goes in
//   ore          a press held still on an ore rock draws its ore (step 3); dropped on the store it
//                goes into stock, and a press on the store's left third draws ore back out
//   (shaking the hand empties it)
// The village's villagers stand still while the hand drops things on the store: since step 3 the
// store also takes the foresters' and farmers' loads, which would land in the same window.
// Screenshots: draw-grain, draw-tree, pour, multi, trees, ore.
import { HAND } from '../../systems/hand.js';
import { VILLAGE, woodIn, oreIn } from '../../village/config.js';

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
  const field = own('field'), store = own('store'), pile = store;
  /** The store's thirds as the hand reads them (storeKindAt): left ore, middle grain, right wood. */
  const side = (b, k) => { const o = over(b); return { sx: o.sx + 20 * k, sy: o.sy }; };
  const villageStill = (on) => { for (const v of world.query({ kind: 'villager' })) if (v.owner === 'player' && !v.held) { v.path = null; v.work = null; v.wait = on ? 600 : 0; } };
  villageStill(true);
  const seen = { shake: 0, pour: 0 };
  events.on('shake', () => seen.shake++);
  events.on('pour', () => seen.pour++);
  camera.centerOn(store.x, store.y, world.heightAt(store.x, store.y));
  t.step(0.5);

  // ---- 1. grain: hold on a ripe field, glide to the store, let go
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
  t.assert(store.grain === g0 + carried && !H.held.length, `dropped on the store, ${carried} grain goes into stock (${g0} -> ${store.grain})`);

  // ---- 2. a standing tree, the press held still: its wood flows into the hand
  const trees = world.query({ kind: 'tree' }).filter((tr) => !tr.held && Math.hypot(tr.x - store.x, tr.y - store.y) < 9)
    .sort((a, b) => Math.hypot(a.x - store.x, a.y - store.y) - Math.hypot(b.x - store.x, b.y - store.y));
  const tree = trees[0];
  t.assert(tree, 'a tree stands near the store');
  const want = woodIn(tree);
  moveTo(middle(tree));
  s.down(0);
  t.step(HAND.treeDrawDelay + 0.5);
  t.assert(H.load?.kind === 'wood' && H.load.amount > 0 && world.get(tree.id) && tree.wood < want, `a press held still on a tree draws its wood (${H.load?.amount} of ${want})`);
  await t.shot('draw-tree');
  for (let i = 0; i < 150 && world.get(tree.id); i++) tick();
  t.assert(!world.get(tree.id) && H.load?.amount === want, `the tree is gone once all ${want} wood is drawn (hand ${H.load?.amount})`);
  const w0 = pile.wood;
  glide(over(pile)); // trees it passes over on the way are drawn or swept up too
  t.step(0.2);
  const logs = H.load?.amount ?? 0;
  s.up(0);
  tick();
  t.assert(logs >= want && pile.wood === w0 + logs && !H.held.length, `dropped on the store, the ${logs} wood goes into stock (${w0} -> ${pile.wood})`);

  // ---- 3. store -> blueprint: pour to god-build
  pile.wood = Math.max(pile.wood, 2000);
  let spot = null;
  for (let r = 3; r < 9 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
    const tx = Math.floor(store.x) + dx, ty = Math.floor(store.y) + dy;
    if (vs.validate('house', tx, ty).ok) spot = [tx, ty];
  }
  const siteId = spot ? vs.placeBlueprint('house', spot[0], spot[1]) : null;
  const site = siteId !== null ? world.get(siteId) : null;
  t.assert(site && site.stage === 'blueprint', `a house blueprint near the store (${spot})`);
  if (site) {
    moveTo(side(pile, 1));
    s.down(0);
    for (let i = 0; i < 300 && (H.load?.amount ?? 0) < 1.6 * site.woodCost; i++) tick();
    const taken = H.load?.amount ?? 0;
    t.assert(taken >= 1.5 * site.woodCost && H.load?.kind === 'wood', `holding on the store's log stack takes ${taken} wood out`);
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
  t.assert(H.held.length === 3 && group.every((v) => v.held), `sweeping across villagers holds all three (${H.held.length})`);
  glide(at(cx + 1, cy + 3), 0.3);
  t.step(0.2);
  s.up(0);
  tick();
  t.assert(H.stowed && H.held.length === 3 && group.every((v) => v.held), 'let go slowly, the group stays in the hand');
  await t.shot('multi');
  s.down(0); s.up(0);
  tick();
  t.assert(H.held.length === 2 && group.filter((v) => !v.held).length === 1, `a click puts one villager out (${H.held.length} left)`);
  s.down(0);
  for (let i = 0; i < 40 && H.held.length; i++) {
    s.move(p.sx + 2, p.sy);
    tick();
  }
  s.up(0);
  tick();
  t.assert(!H.held.length && group.every((v) => !v.held), 'holding the button pours the rest out');
  t.step(1);

  // ---- 5. multi pick-up of trees, let go over the store
  const stand = world.query({ kind: 'tree' }).filter((tr) => !tr.held && !tr.uprooted && Math.hypot(tr.x - pile.x, tr.y - pile.y) < 10)
    .sort((a, b) => Math.hypot(a.x - pile.x, a.y - pile.y) - Math.hypot(b.x - pile.x, b.y - pile.y)).slice(0, 3);
  t.assert(stand.length === 3, `three trees near the store (${stand.length})`);
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
  t.assert(pile.wood === p0 + sweptWood && swept.every((tr) => !world.get(tr.id)) && !H.held.length, `let go over the store, the trees' ${sweptWood} wood goes in (${p0} -> ${pile.wood})`);

  // ---- 6. ore: the nearest ore rock, set down beside the store, drained by a press held still
  const oreRock = world.query({ kind: 'rock' }).filter((r) => r.ore && !r.held).sort((a, b) => Math.hypot(a.x - store.x, a.y - store.y) - Math.hypot(b.x - store.x, b.y - store.y))[0];
  t.assert(oreRock, 'the island has ore rocks');
  if (oreRock) {
    const ox = store.x + 3.5, oy = store.y - 2.5;
    world.move(oreRock, ox, oy, world.heightAt(ox, oy));
    tick();
    const oreWant = oreIn(oreRock);
    moveTo(middle(oreRock));
    s.down(0);
    t.step(HAND.treeDrawDelay + 0.4);
    t.assert(H.load?.kind === 'ore' && H.load.amount > 0, `a press held still on an ore rock draws its ore (${H.load?.kind} ${H.load?.amount} of ${oreWant})`);
    await t.shot('ore');
    for (let i = 0; i < 150 && world.get(oreRock.id); i++) tick();
    const o0 = store.ore;
    glide(over(store), 0.4);
    t.step(0.2);
    const ore = H.load?.amount ?? 0;
    s.up(0);
    tick();
    t.assert(!world.get(oreRock.id) && ore === oreWant && store.ore === o0 + ore, `the rock drained (${oreWant} ore) and dropped on the store, its ore goes into stock (${o0} -> ${store.ore})`);
    moveTo(side(store, -1));
    s.down(0);
    for (let i = 0; i < 120 && (H.load?.amount ?? 0) < 50; i++) tick();
    t.assert(H.load?.kind === 'ore' && store.ore < o0 + ore, `a press on the store's left third draws ore back out (${H.load?.kind} ${H.load?.amount})`);
    moveTo(over(store)); t.step(0.2); s.up(0); tick();
  }
  villageStill(false);

  // ---- 7. shake empties the hand
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
