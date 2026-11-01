// Play scenario: the whole game loop the way a player meets it, on the real island and terrain.
// Boots like src/main.js outside scenario mode (the same play bootstrap, installed through
// game.debug.installPlayBootstrap, and the title screen), starts play with a synthetic click on the
// title, checks the bootstrap set up both villages and the creature, runs two sim minutes, then
// drives the hand through synthetic input only: takes the rain orb from its temple pedestal and drops
// it on a player field (miracle-cast), and strokes the creature after it has finished an action
// (stroke). Last, acts inside the rival village's ring convert it (village-converted) and the game
// is won. The camera is left to the bootstrap until play has started: the player's temple must sit in
// the central half of the view under the title and after game-start. Screenshots: title, early-play,
// after-miracle, win.
export default async function play(t, game) {
  const { world, events, camera, input } = game;
  const s = input.synth, p = input.pointer;
  const st = (game.state ??= {});
  const ui = game.systems.ui, vs = game.systems.village, cs = game.systems.creature, hs = game.systems.hand;
  const tick = () => t.step(game.clock.step);
  // the player's temple projected into the view, and whether it lies in the central half of it
  const templeInView = () => {
    const tp = world.sites.temple, d = game.display;
    const v = camera.worldToView(tp.x, tp.y, world.heightAt(tp.x, tp.y));
    const inside = v.sx >= d.w / 4 && v.sx <= (3 * d.w) / 4 && v.sy >= d.h / 4 && v.sy <= (3 * d.h) / 4;
    return { ...v, view: [d.w, d.h], inside };
  };

  const seen = { 'game-start': [], 'miracle-cast': [], 'miracle-fizzle': [], stroke: [], 'village-converted': [] };
  for (const type of Object.keys(seen)) events.on(type, (e) => seen[type].push(e ?? {}));

  // ---- boot as main.js does: play bootstrap, title screen
  const boot = game.debug.installPlayBootstrap;
  t.assert(typeof boot === 'function', 'main.js exposes the play bootstrap to scenarios');
  if (typeof boot !== 'function') return;
  boot();
  st.screen = 'title';
  s.move(Math.floor(game.display.w / 2), Math.floor(game.display.h / 2));
  t.step(0.5);
  t.assert(ui.last?.title && !ui.last?.hud, 'title screen drawn over the island, HUD hidden');
  t.assert(!vs.ready && !cs.entity, 'nothing is set up while the title is up');
  const atTitle = templeInView();
  t.assert(atTitle.inside, `under the title the bootstrap frames the player's temple in the central half of the view (${JSON.stringify(atTitle)})`);
  await t.shot('title');

  // ---- a click on the title starts play
  s.down(0);
  s.up(0);
  tick();
  t.assert(st.screen === 'play' && seen['game-start'].length === 1 && ui.starts === 1, `a click on the title starts play once (screen ${st.screen}, game-start x${seen['game-start'].length})`);
  const villagers = (owner) => world.query({ kind: 'villager' }).filter((v) => v.owner === owner);
  t.assert(vs.ready && villagers('player').length > 0 && villagers('rival').length > 0, `village setup ran (${villagers('player').length} player, ${villagers('rival').length} rival villagers)`);
  t.assert(cs.entity && world.get(cs.entity.id) === cs.entity, `creature setup ran (creature ${cs.entity?.id})`);
  s.down(0); s.up(0); t.input.key('Enter', 1 / 30);
  t.assert(seen['game-start'].length === 1, 'a second click or Enter starts nothing again');

  t.step(3);
  const atStart = templeInView();
  t.assert(atStart.inside, `after game-start the player's temple is in the central half of the view (${JSON.stringify(atStart)})`);
  t.assert(ui.last?.hud && !ui.last?.title, 'HUD drawn in play');
  await t.shot('early-play');

  // ---- two sim minutes of play
  for (let i = 0; i < 12; i++) t.step(10);
  const stats = vs.stats();
  t.log('after 2 minutes', JSON.stringify({ power: st.power, player: stats.player?.population, rival: stats.rival?.population, creature: cs.state().action?.key, history: cs.history.length }));
  t.assert(game.clock.time >= 120, `two sim minutes ran (${game.clock.time.toFixed(1)} s)`);

  // ---- rain orb from the temple, dropped on a player field
  const cost = game.systems.miracles.costs().rain;
  let waited = 0;
  while ((st.power ?? 0) < cost && waited < 300) { t.step(5); waited += 5; }
  t.assert((st.power ?? 0) >= cost, `worship paid for rain (power ${(st.power ?? 0).toFixed(1)} >= ${cost} after ${waited} s more)`);
  const field = world.query({ kind: 'building' }).find((b) => b.type === 'field' && b.owner === 'player' && b.stage === 'done');
  t.assert(field, 'the player village has a finished field');
  const temple = world.sites.temple;
  const fx = field.tx + field.fw / 2, fy = field.ty + field.fh / 2;
  camera.centerOn((temple.x + fx) / 2, (temple.y + fy) / 2, world.heightAt(temple.x, temple.y));
  tick();

  const middle = (e) => {
    const v = camera.worldToView(e.x, e.y, e.z);
    return { sx: v.sx, sy: v.sy - Math.floor((e.sprite?.ay ?? 8) / 2) };
  };
  let orb = null;
  for (let attempt = 0; attempt < 6 && !orb; attempt++) {
    const id = game.systems.miracles.orbs.orbOn('rain');
    const e = id != null ? world.get(id) : null;
    if (!e) { t.step(1); continue; }
    const q = middle(e);
    s.move(q.sx, q.sy);
    tick();
    s.down(0);
    t.step(0.2);
    if (hs.state.heldId === e.id) { orb = e; break; }
    s.up(0); // took something standing in front of the orb (or nothing): let go and try again
    t.step(1);
  }
  t.assert(orb && orb.held, `the hand holds the rain orb (held ${hs.state.heldId}, ${world.get(hs.state.heldId)?.kind})`);
  const casts = seen['miracle-cast'].length;
  if (orb) {
    const from = { sx: p.sx, sy: p.sy }, to = camera.worldToView(fx, fy, world.heightAt(fx, fy));
    for (let i = 1; i <= 18; i++) {
      s.move(Math.round(from.sx + ((to.sx - from.sx) * i) / 18), Math.round(from.sy + ((to.sy - from.sy) * i) / 18));
      tick();
    }
    t.step(0.6); // hold still so the release is a drop, not a throw
    s.up(0);
    tick();
  }
  const cast = seen['miracle-cast'][casts];
  const onField = (c) => c && c.x >= field.tx - 0.5 && c.x <= field.tx + field.fw + 0.5 && c.y >= field.ty - 0.5 && c.y <= field.ty + field.fh + 0.5;
  t.assert(cast && cast.miracle === 'rain' && onField(cast), `miracle-cast rain on the field (${JSON.stringify(cast)}; field ${field?.tx},${field?.ty} ${field?.fw}x${field?.fh}; fizzles ${seen['miracle-fizzle'].length})`);
  t.step(1.5);
  camera.centerOn(fx, fy, world.heightAt(fx, fy));
  tick();
  await t.shot('after-miracle');

  // ---- stroke the creature after it has finished an action
  const finished = () => cs.history.filter((h) => h.phase === 'complete');
  waited = 0;
  while (finished().length === 0 && waited < 60) { t.step(1); waited++; }
  t.assert(finished().length > 0, `the creature finished an action before the stroke (last: ${finished().at(-1)?.key})`);
  const strokes = seen.stroke.length;
  for (let attempt = 0; attempt < 6 && seen.stroke.length === strokes; attempt++) {
    const c = cs.entity;
    camera.centerOn(c.x, c.y - 1.5, c.z);
    tick();
    const q = middle(c);
    s.move(q.sx, q.sy);
    tick();
    s.down(0);
    tick();
    if (hs.state.heldId != null) { s.up(0); t.step(1); continue; } // grabbed something in front of it
    for (const d of [1, -1, 1, -1]) for (let i = 0; i < 3; i++) { s.move(p.sx + 4 * d, p.sy); tick(); }
    s.up(0);
    t.step(0.3);
    if (seen.stroke.length === strokes) t.step(1);
  }
  const stroke = seen.stroke[strokes];
  t.assert(stroke && stroke.creatureId === cs.entity.id, `stroke event on the creature (${JSON.stringify(stroke)})`);
  const fb = cs.state().feedback;
  t.assert(fb && fb.kind === 'stroke', `the creature took the stroke as feedback (${JSON.stringify(fb)})`);
  t.log('stroke judged', JSON.stringify(fb));

  // ---- acts inside the rival ring until the village converts
  const ring = game.systems.alignment.ring();
  t.assert(ring && ring.r > 0, `rival influence ring (${JSON.stringify(ring)})`);
  let acts = 0;
  while (ring && seen['village-converted'].length === 0 && acts < 3000) {
    events.emit('act', { actor: 'player', verb: 'cast', target: 'heal', weight: 0.4, x: ring.x, y: ring.y });
    acts++;
    tick();
  }
  t.assert(seen['village-converted'].length === 1, `village-converted fired after ${acts} acts (${JSON.stringify(seen['village-converted'][0])})`);
  t.step(1);
  t.assert(st.won === true, `game.state.won (${st.won}, how ${st.wonHow})`);
  t.assert(villagers('rival').length === 0 && villagers('player').length > 0, `rival villagers joined the player (${villagers('rival').length} rival left)`);
  t.assert(ui.bannerOpen, 'win banner is up');
  camera.centerOn(ring.x, ring.y, world.heightAt(ring.x, ring.y));
  tick();
  await t.shot('win');
}
