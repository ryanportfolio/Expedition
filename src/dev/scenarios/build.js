// Build scenario: the island, both villages set up, screen = 'play', then the player plans a house
// through the build bar exactly as a mouse would:
//   bar      house picked from the bar (a click on its slot), the pointer still on the bar: the
//            picked slot drawn pressed, no ghost yet
//   invalid  the pointer over water near the village: red dithered ghost and the reason under it; a
//            click there plans nothing and the strip above the bar says why
//   valid    the pointer over open ground in the village: green ghost, and the strip back on the
//            plain tip (no refused reason left from the water click)
//   placed   a click plans the blueprint (a new player house site in the world and in stats())
// then Esc puts the plan away. The hand must not grab anything during the flow.
// Works at any window size.
export default async function build(t, game) {
  const { world, camera, events, systems } = game;
  const st = game.state;
  const U = systems.ui, vs = systems.village;
  t.assert(world.sites && world.sites.village, 'the terrain system loaded the island');
  vs.setup();
  st.screen = 'play';
  const grabs = [], placed = [];
  events.on('grab', (p) => grabs.push(p.entityId));
  events.on('building-placed', (p) => placed.push(p));
  const site = world.sites.village;
  camera.centerOn(site.x, site.y, world.heightAt(site.x, site.y));
  t.step(1);
  t.assert(U.last.build && U.last.build.slots.length === 4, 'play: the build bar is drawn with four kinds');

  // open: a click on the house slot
  const slot = U.layout().buildSlots[0];
  t.input.move(slot.x + 8, slot.y + 8);
  t.step(1 / 30);
  t.assert(st.uiCapture === true, 'pointer over the build bar: the UI holds it');
  t.input.down(0); t.input.up(0);
  t.step(1 / 30);
  t.assert(U.build.kind === 'house' && U.last.build.slots[0].picked, `a click on the first slot picks house (${U.build.kind})`);
  t.assert(U.last.build.slots.every((x) => x.cost > 0) && !U.last.ghost, 'the bar shows a wood cost for every kind; no ghost while the pointer is on the bar');
  await t.shot('bar');

  // aim at the centre of tile (tx, ty) with the camera on (cx, cy); returns the tile under the pointer
  const aim = (tx, ty, cx = tx + 0.5, cy = ty + 0.5) => {
    camera.centerOn(cx, cy, world.heightAt(cx, cy));
    t.step(1 / 30);
    const p = t.input.move(tx + 0.5, ty + 0.5, { world: true });
    t.step(1 / 30);
    const q = game.input.pointer;
    return q.hit ? { tx: Math.floor(q.x), ty: Math.floor(q.y), at: p } : null;
  };

  // invalid: the water tile nearest the village, the camera between the two
  const waters = [];
  for (let ty = 1; ty < world.h - 1; ty++) for (let tx = 1; tx < world.w - 1; tx++) {
    if (world.tile(tx, ty).ground <= 1) waters.push({ tx, ty, d: Math.hypot(tx + 0.5 - site.x, ty + 0.5 - site.y) });
  }
  waters.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
  let water = null;
  for (const w of waters.slice(0, 40)) {
    if (w.d < 4) continue; // leave room for the ghost between the village and the shore
    const got = aim(w.tx, w.ty, (w.tx + 0.5 + site.x) / 2, (w.ty + 0.5 + site.y) / 2);
    if (got && world.tile(got.tx, got.ty).ground <= 1) { water = got; break; }
  }
  t.assert(!!water, `the pointer is over water near the village (${JSON.stringify(water)})`);
  t.step(1 / 30);
  const bad = U.build.hover, gBad = U.last.ghost;
  t.assert(bad && !bad.ok && bad.reason === 'water', `over water the house is refused: ${bad?.reason}`);
  t.assert(gBad && gBad.ramp === 'fire' && gBad.drawn > 50 && gBad.label, `red ghost (${gBad?.drawn} px) with the reason "${gBad?.label}"`);
  await t.shot('invalid');
  const sites0 = vs.stats().player.sites;
  t.input.down(0); t.input.up(0);
  t.step(1 / 30);
  t.assert(placed.length === 0 && vs.stats().player.sites === sites0, 'a click on water plans nothing');
  t.assert(U.build.lastTry && !U.build.lastTry.ok && U.last.build.tip && /water/i.test(U.last.build.tip.text), `the tip says why (${U.last.build.tip?.text})`);

  // valid: open ground in the village, nearest the centre first
  let good = null;
  for (let r = 2; r < 10 && !good; r++) for (let dy = -r; dy <= r && !good; dy++) for (let dx = -r; dx <= r && !good; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const tx = Math.floor(site.x) + dx, ty = Math.floor(site.y) + dy;
    if (!vs.validate('house', tx, ty, 'player').ok) continue;
    const got = aim(tx, ty, site.x, site.y);
    if (got && vs.validate('house', got.tx, got.ty, 'player').ok) good = got;
  }
  t.assert(!!good, `open ground for a house near the village centre (${JSON.stringify(good)})`);
  t.step(1 / 30);
  const ok = U.build.hover, gOk = U.last.ghost;
  t.assert(ok && ok.ok && gOk && gOk.ramp === 'heal' && gOk.drawn > 50 && !gOk.label, `green ghost at ${ok?.tx},${ok?.ty} (${gOk?.drawn} px)`);
  const tipOk = U.last.build.tip;
  t.assert(tipOk && !tipOk.bad && /click to plan/.test(tipOk.text), `over the valid tile the strip shows the plain tip, not the water reason ("${tipOk?.text}")`);
  await t.shot('valid');

  // place
  t.input.down(0); t.input.up(0);
  t.step(1 / 30);
  const b = placed.length === 1 ? world.get(placed[0].buildingId) : null;
  t.assert(b && b.type === 'house' && b.owner === 'player' && b.stage === 'blueprint', `a player house blueprint now stands there (${b && `${b.type} ${b.owner} ${b.stage} at ${b.tx},${b.ty}`})`);
  t.assert(vs.stats().player.sites === sites0 + 1, `village sites ${sites0} -> ${vs.stats().player.sites}`);

  // Esc puts the plan away; the shot shows the new blueprint and the confirmation above the bar
  t.input.key('Escape', 1 / 30);
  t.assert(U.build.kind === null && !U.last.ghost, 'Esc puts the plan away: no ghost');
  const away = { sx: Math.round(slot.x * 0.6), sy: Math.round(slot.y * 0.35) }; // off the new site
  t.input.move(away.sx, away.sy);
  t.step(1 / 30);
  await t.shot('placed');
  t.assert(st.uiCapture === false, 'with nothing picked the pointer over the world is the hand\'s again');
  t.assert(grabs.length === 0, `the hand grabbed nothing during the build flow (${JSON.stringify(grabs)})`);
  t.log('build', JSON.stringify({ water: water && [water.tx, water.ty], good: good && [good.tx, good.ty], blueprint: b && b.id, lastTry: U.build.lastTry }));
}
