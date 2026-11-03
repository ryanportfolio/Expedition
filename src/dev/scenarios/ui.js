// UI scenario: the island as the terrain system draws it, both villages set up and the creature
// spawned, then the interface over it. The UI draws only in play, so the scenario first checks that
// nothing is drawn with the screen unset, then sets screen = 'play':
//   no-screen  screen unset: the frame matches one rendered without the UI, pixel for pixel
//   hud      power 60, alignment 0.4, belief 0.55 (awe 0.35, fear 0.2), the creature panel; asserts
//            that every bar's filled pixels in the frame match the state values
//   hud-480  the same HUD and checks in a narrow 480-wide view (360 tall when the window allows it)
//   thought  a synthetic stroke: the bubble shows the judged action with the glow mark
//   debug    backquote opens the brain panel; it lists the table rows
//   capture  a rock under the power panel: a press there grabs nothing, the same press with the UI
//            pinned off grabs it (control)
//   win      won = true: the banner opens once, the belief meter reads full and "converted by awe";
//            Enter closes the banner and it does not come back
//   title    screen = 'title': title over the dimmed island; a click sets 'play' and emits
//            game-start once
// Works at any window size (the done-check runs 1920x1080 and 1920x970).
import { getSprite } from '../../art/registry.js';
import { worldToScreen } from '../../world/iso.js';
import { idx } from '../../art/palette.js';
import { barFill, signedFill, beliefFill, contains, POWER, ALIGN, RIVAL } from '../../ui/layout.js';
import { FILL } from '../../ui/hud.js';
import { count } from '../../ui/draw.js';

export default async function ui(t, game) {
  const { world, camera, events, systems, renderer, display } = game;
  const st = game.state;
  t.assert(world.sites && Object.keys(world.sites).length > 0, 'the terrain system loaded the island');
  systems.village.setup();
  const cs = systems.creature;
  cs.setup?.();
  const U = systems.ui;
  const starts = [];
  events.on('game-start', (p) => starts.push(p));
  const follow = () => { const e = cs.entity; camera.centerOn(e.x, e.y - 2, e.z); };
  follow();
  // a scenario run neither opens on the title nor draws the HUD until it sets the screen itself:
  // the frame is the same pixel for pixel as one rendered with the UI's draw removed
  t.step(1 / 30);
  t.assert(st.screen === undefined && !U.last.title && !U.last.hud && !U.last.build, `a scenario run starts with the screen unset: no title, no HUD (${st.screen})`);
  const uiDraw = U.draw;
  U.draw = () => {};
  renderer.render();
  const bare = Uint32Array.from(renderer.view.data);
  U.draw = uiDraw;
  renderer.render();
  let differ = 0;
  for (let i = 0; i < bare.length; i++) if (renderer.view.data[i] !== bare[i]) differ++;
  t.assert(differ === 0 && st.uiCapture === false, `screen unset: no UI pixels (${differ} differ from the frame without the UI) and the UI holds no input`);
  await t.shot('no-screen');
  st.screen = 'play';

  t.step(6); // the creature picks and starts a few actions
  // and finishes one, so the stroke below has an act to credit (how long the first takes depends on
  // what stands round the creature's start)
  for (let i = 0; i < 30 && !cs.brain.serialize().recent.length; i++) t.step(1);
  t.assert(cs.brain.serialize().recent.length > 0, 'the creature has finished an act');
  follow();

  const setState = () => {
    st.power = 60;
    st.alignment = 0.4;
    st.belief = 0.55;
    st.beliefMix = { impress: 0.35, scare: 0.2 };
  };
  setState();
  t.step(1 / 30);
  setState(); // the alignment and village systems move these on every tick; pin them for the frame
  renderer.render();

  // ---- HUD values in the frame, for the view on screen (the window's, then a narrow 480-wide one)
  const rows = (r) => ({ ...r, y: r.y + 1, h: r.h - 1 });
  const checkHud = () => {
    const { w: W, h: H } = display;
    const buf = renderer.view.data, lut = renderer.lut;
    const hud = U.last.hud;
    const wantP = barFill(st.power, 100, POWER.bar.w);
    const pBody = count(buf, W, H, rows(hud.power.rect), lut[idx(FILL.power[0], FILL.power[1])]);
    t.assert(hud.power.fill === wantP && pBody === wantP * (hud.power.rect.h - 1), `power bar: ${pBody / (hud.power.rect.h - 1)} filled columns for power ${st.power} (want ${wantP})`);
    t.assert(hud.power.lit.rain && hud.power.lit.lightning, 'with 60 power every miracle shows as affordable');
    const wantA = signedFill(st.alignment, ALIGN.scale.w).fill;
    const aBody = count(buf, W, H, rows(hud.align.rect), lut[idx(FILL.good[0], FILL.good[1])]);
    t.assert(hud.align.fill === wantA && aBody === wantA * (hud.align.rect.h - 1), `alignment scale: ${aBody / (hud.align.rect.h - 1)} good columns for alignment ${st.alignment} (want ${wantA})`);
    const wantB = beliefFill(st.belief, st.beliefMix, RIVAL.bar.w);
    const bRows = rows(hud.rival.rect);
    const awe = count(buf, W, H, bRows, hud.rival.impressColor) / bRows.h, fear = count(buf, W, H, bRows, hud.rival.scareColor) / bRows.h;
    t.assert(awe === wantB.impress && fear === wantB.scare, `belief meter: ${awe} awe + ${fear} fear columns for belief ${st.belief} (want ${wantB.impress} + ${wantB.scare})`);
    const needs = cs.state().needs;
    for (const [n, d] of Object.entries(hud.creature?.needs ?? {})) {
      const want = barFill(needs[n], 1, d.rect.w);
      const got = count(buf, W, H, rows(d.rect), d.color) / (d.rect.h - 1);
      t.assert(got === want, `${n} bar: ${got} columns for ${needs[n].toFixed(3)} (want ${want})`);
    }
    t.assert(!!hud.creature, 'creature panel drawn');
    t.assert(hud.creature && hud.creature.lean.fill === signedFill(cs.brain.alignmentLean(), 28).fill, 'creature lean marker matches the brain');
    const L = U.layout();
    for (const [name, r] of Object.entries({ power: L.power, align: L.align, rival: L.rival, creature: L.creature })) {
      const inView = r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
      const c = L.center, clear = r.x + r.w <= c.x || r.x >= c.x + c.w || r.y + r.h <= c.y || r.y >= c.y + c.h;
      t.assert(inView && clear, `${name} panel inside the ${W}x${H} view and clear of its centre`);
    }
    t.log('hud', JSON.stringify({ view: [W, H], power: hud.power.fill, align: hud.align.fill, belief: [hud.rival.impress, hud.rival.scare], needs: Object.fromEntries(Object.entries(hud.creature?.needs ?? {}).map(([k, v]) => [k, v.fill])) }));
  };
  checkHud();
  await t.shot('hud');

  // ---- the same HUD in a narrow 480-wide view (360 tall when the window allows it), then back
  const narrowH = Math.min(360, Math.floor(window.innerHeight / 3));
  display.setDevice(480 * 3, narrowH * 3, 1);
  camera.clamp();
  follow();
  t.step(1 / 30);
  setState();
  renderer.render();
  t.assert(display.w === 480 && display.h === narrowH, `narrow view is 480x${narrowH} (${display.w}x${display.h})`);
  checkHud();
  await t.shot('hud-480');
  display.fitWindow(window);
  camera.clamp();
  follow();
  const { w: W, h: H } = display;

  // ---- thought bubble after a stroke
  events.emit('stroke', { creatureId: cs.entity.id, strength: 1 });
  t.step(1 / 30);
  follow();
  setState();
  renderer.render();
  const b = U.last.bubble;
  t.log('thought', JSON.stringify(st.creatureThought), JSON.stringify(b?.view));
  t.assert(b && b.view.mark === 'glow', `after a stroke the bubble shows the glow mark (${JSON.stringify(b?.view)})`);
  t.assert(b && b.view.key === (st.creatureThought.judged ?? st.creatureThought.key), 'the bubble shows the judged action');
  if (b) {
    const inView = b.rect.x >= 0 && b.rect.y >= 0 && b.rect.x + b.rect.w <= W && b.rect.y + b.rect.h <= H;
    const paper = count(renderer.view.data, W, H, b.rect, renderer.lut[idx('ui-parchment', 6)]);
    t.assert(inView && paper > 20, `bubble drawn in the view (${paper} parchment pixels)`);
  }
  await t.shot('thought');

  // ---- debug panel, with the creature starved weak so the weak tab shows too
  cs.debug.holdHunger = 1;
  cs.debug.candidateFilter = (c) => c.key === 'idle:none'; // no meal resets the starving clock
  t.step(cs.brain.params.weakAfter + 10);
  cs.debug.holdHunger = null;
  cs.debug.candidateFilter = null;
  follow();
  t.assert(cs.brain.weak, 'starved past weakAfter, the creature is weak');
  t.input.key('Backquote', 1 / 30);
  setState();
  renderer.render();
  const d = U.last.debug, table = cs.brain.table();
  t.assert(U.debugOpen && d, 'backquote opens the debug panel');
  t.assert(U.last.hud.creature?.weak && U.last.layout.weakTab, 'the creature panel shows the weak tab');
  t.assert(d && table.rows.length > 0 && d.rows.length > 0 && d.rows.every((r) => table.rows.some((x) => x.key === r.key && x.situation === r.situation)), `debug panel lists table rows (${d?.rows.length} drawn of ${table.rows.length})`);
  t.log('table', JSON.stringify(table.rows.slice(0, 6)));
  await t.shot('debug');
  t.input.key('Backquote', 1 / 30);
  t.assert(!U.debugOpen, 'backquote closes it');

  // ---- uiCapture over a HUD panel blocks a grab (control: the same press with capture pinned off)
  const P = U.layout().power;
  // an open patch of land (nothing else touchable within 3 tiles) the camera can pan under the panel
  const at = { sx: P.x + (P.w >> 1), sy: P.y + P.h - 4 };
  let spot = null;
  for (let ty = 8; ty < world.h - 8 && !spot; ty++) for (let tx = 8; tx < world.w - 8 && !spot; tx++) {
    const tile = world.tile(tx, ty);
    if (tile.ground !== 3 || world.query({ x: tx + 0.5, y: ty + 0.5, r: 3 }).length) continue;
    const sp = worldToScreen(tx + 0.5, ty + 0.5, world.heightAt(tx + 0.5, ty + 0.5));
    camera.x = sp.sx - at.sx;
    camera.y = sp.sy - at.sy;
    camera.clamp();
    const q = camera.worldToView(tx + 0.5, ty + 0.5, world.heightAt(tx + 0.5, ty + 0.5));
    if (q.sx === at.sx && q.sy === at.sy) spot = { x: tx + 0.5, y: ty + 0.5 };
  }
  t.assert(!!spot, `open land the camera can put under the power panel (${JSON.stringify(spot)})`);
  const rock = world.spawn('rock', { x: spot.x, y: spot.y, z: world.heightAt(spot.x, spot.y), vx: 0, vy: 0, vz: 0, size: 1, grabbable: true, hp: 1, sprite: getSprite('rock', { size: 1 }) });
  const v = camera.worldToView(rock.x, rock.y, rock.z);
  const press = { sx: v.sx, sy: v.sy - Math.floor(rock.sprite.ay / 2) };
  t.assert(contains(P, press.sx, press.sy), `press point ${JSON.stringify(press)} is on the power panel`);
  t.input.move(press.sx, press.sy);
  t.step(1 / 30);
  t.assert(st.uiCapture === true, 'pointer over the power panel: uiCapture true');
  t.input.down(0);
  t.step(1 / 30);
  t.assert(systems.hand.state.heldId === null && !rock.held, 'a press on the rock under the HUD panel grabs nothing');
  t.input.up(0);
  t.step(1 / 30);
  st.uiCapture = false; // control: the same press with the UI out of the way
  t.input.down(0);
  t.step(1 / 30);
  t.assert(systems.hand.state.heldId === rock.id, 'control: with uiCapture pinned off the same press grabs it');
  t.input.up(0);
  st.uiCapture = null;
  t.step(0.5);
  world.remove(rock.id);
  t.input.move(W >> 1, H >> 1);
  follow();

  // ---- win banner
  st.won = true;
  st.wonHow = 'impress';
  t.step(1 / 30);
  setState();
  renderer.render();
  t.assert(U.bannerOpen && U.last.banner === true, 'won: the win banner is up');
  t.assert(st.uiCapture === true, 'the banner holds the pointer');
  const won = U.last.hud.rival;
  t.assert(won.fill === RIVAL.bar.w && won.belief === 1 && won.label === 'converted by awe', `won: the belief meter reads full and the village converted by awe (${won.fill} of ${RIVAL.bar.w} px, ${won.label}) though belief is ${st.belief}`);
  await t.shot('win');
  t.input.key('Enter', 1 / 30);
  t.assert(!U.bannerOpen && st.uiCapture === false, 'Enter dismisses the banner');
  st.won = false; t.step(1 / 30); st.won = true; t.step(1 / 30);
  t.assert(!U.bannerOpen, 'the banner never comes back in this session');

  // ---- title (pointer outside the window, as before a first move)
  t.input.leave();
  st.screen = 'title';
  t.step(1 / 30);
  t.assert(U.last.title && !U.last.hud, 'title drawn over the island, HUD hidden');
  await t.shot('title');
  t.input.move(W >> 1, Math.round(H * 0.7));
  t.input.down(0);
  t.input.up(0);
  t.step(1 / 30);
  t.assert(st.screen === 'play' && starts.length === 1, `a click on the title sets play and emits game-start once (${starts.length})`);
  t.input.down(0); t.input.up(0);
  t.input.key('Enter', 1 / 30);
  t.assert(starts.length === 1, 'no second game-start');
}
