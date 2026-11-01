// UI system: everything drawn over the world, in the same pixel buffer (no HTML).
//
//   HUD (src/ui/hud.js)      power bar with miracle cost ticks (top-left), alignment scale
//                            (top-centre), rival belief split by awe and fear (top-right; full and
//                            labelled converted once the village is won), creature needs, weak tab
//                            and lean (bottom-left)
//   build bar (src/ui/build.js) bottom-right: house, field, storehouse, woodpile with their wood
//                            costs and the village's wood stock. Click a slot or press 1-4 to pick a
//                            kind; a dithered ghost then follows the pointer, snapped to the tile under
//                            it, green or red from village.validate(); a left click plans the
//                            blueprint (village.placeBlueprint), a refused click shows the reason
//                            above the bar only while the ghost stays on that refused tile (the text
//                            always describes the tile under the ghost); right click, Esc, or the
//                            same slot / key again puts the plan away
//   thought bubble           over the creature: the action in game.state.creatureThought, with a
//                            glow or jagged mark after a stroke or slap (src/ui/bubble.js)
//   debug panel              backquote toggles it: the creature brain's needs and table, PageUp /
//                            PageDown scroll it (src/ui/debug.js)
//   win banner               once, when game.state.won first turns true in play; Enter dismisses it
//                            (a click does too, after a second, so a stray click mid-throw cannot)
//   title screen             game.state.screen === 'title': a click or Enter sets it to 'play' and
//                            emits `game-start` once
//
// Gating: the title draws only while game.state.screen === 'title'; the HUD, bubble, build bar,
// ghost, debug panel and win banner only while it is 'play'. With screen unset (node checks, browser
// scenarios until they set it) the UI draws nothing and holds no input.
//
// Reads: game.state.power, alignment, belief, beliefMix, won, wonHow, creatureThought, screen;
// game.systems.creature (.entity, .brain, .state(); may be absent or not set up),
// game.systems.miracles.costs(), game.systems.village (validate, placeBlueprint, stats, lastReason
// only). Alignment and belief come only from game.state.
// Writes: game.state.screen, and game.state.uiCapture, an accessor that is true while the title or
// the win banner is up, while a building is picked for placing, or while the pointer is over a HUD
// panel, the build bar or the open debug panel. The hand reads it and starts no grab, stroke, slap or
// tether while it is true. It is computed when read, so a press that arrives between ticks sees the
// pointer where it is. Assigning true or false pins it (checks, debug); assigning null hands it back
// to the UI.
//
// Title on boot: the browser game (a canvas, no scenario) opens on the title. main.js creates the
// game before a scenario attaches, so the choice is made on the first update or draw rather than
// in create(); node checks (no canvas) and scenarios leave the screen unset.
//
// update(dt) touches only game state; draw(ctx) registers one overlay.
import { VILLAGE } from '../village/config.js';
import { layout, captureRects, contains } from '../ui/layout.js';
import { drawHud } from '../ui/hud.js';
import { drawThought } from '../ui/bubble.js';
import { drawDebug, tableLines } from '../ui/debug.js';
import { drawTitle, drawBanner } from '../ui/screens.js';
import { BUILD_KINDS, BUILD_KEYS, drawBuildBar, drawGhost, reasonText } from '../ui/build.js';

const BANNER_CLICK_DELAY = 1; // sim seconds before a click may dismiss the win banner
const BUILD_FLASH = 2; // sim seconds a refused or accepted placement message stays up
const FALLBACK_COSTS = Object.freeze({ rain: 15, heal: 20, fire: 20, lightning: 30 });

export function create(game) {
  game.state ??= {};
  const st = game.state;
  const { events, input, display } = game;

  let titlePending = !!display.canvas; // browser boot: decided once a scenario has had its chance
  let time = 0;
  let bannerSeen = st.won === true; // a game that starts already won shows no banner
  let banner = null; // { since } while the win banner is up
  let debugOpen = false;
  let debugScroll = 0;
  let starts = 0;
  let pinned = null; // uiCapture pinned by assignment
  let last = null; // what the last frame drew, for checks
  // build: the picked kind (null = nothing picked), the last placement attempt and its message
  const build = { kind: null, placed: [], lastTry: null, flash: null };

  const playing = () => st.screen === 'play';

  // ---------------------------------------------------------------- reads
  function creatureSys() {
    const cs = game.systems.creature;
    const e = cs?.entity;
    return e && game.world.get(e.id) === e ? cs : null;
  }
  function creatureInfo() {
    const cs = creatureSys();
    if (!cs) return null;
    const s = typeof cs.state === 'function' ? cs.state() : {};
    const brain = cs.brain;
    return {
      needs: s.needs ?? brain?.needs ?? {},
      weak: !!(s.weak ?? brain?.weak),
      lean: Number.isFinite(s.lean) ? s.lean : (brain?.alignmentLean?.() ?? 0),
      table: typeof brain?.table === 'function' ? brain.table() : null,
    };
  }
  function costs() {
    const c = game.systems.miracles?.costs?.();
    return c && typeof c === 'object' ? c : FALLBACK_COSTS;
  }
  const village = () => game.systems.village;
  function currentLayout() {
    const cs = creatureSys();
    // the debug panel grows with the brain's table (one line per row and per situation heading)
    const lines = debugOpen ? Math.max(1, cs?.brain?.table ? tableLines(cs.brain.table()).length + 1 : 1) : 0;
    return layout(display.w, display.h, { creature: !!cs, weak: !!cs?.brain?.weak, debug: debugOpen, debugLines: lines, build: !!village() });
  }
  /** Index of the build slot under the pointer, or -1. */
  function slotAt(L, sx, sy) {
    return L.buildSlots.findIndex((r) => contains(r, sx, sy));
  }
  /** The placement the pointer would make now: { kind, tx, ty, ok, reason } or null. */
  function hoverPlacement(L = currentLayout()) {
    const p = input.pointer;
    if (!build.kind || !playing() || banner || !p.inside || !p.hit) return null;
    if (captureRects(L).some((r) => contains(r, p.sx, p.sy))) return null; // over a panel: no ghost
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    const v = village()?.validate?.(build.kind, tx, ty, 'player') ?? { ok: false, reason: 'no village' };
    return { kind: build.kind, tx, ty, ok: !!v.ok, reason: v.ok ? null : v.reason };
  }

  // ---------------------------------------------------------------- input capture
  function capture() {
    if (pinned != null) return pinned;
    if (st.screen === 'title') return true;
    if (!playing()) return false;
    if (banner || build.kind) return true;
    const p = input.pointer;
    if (!p.inside || !display.w) return false;
    return captureRects(currentLayout()).some((r) => contains(r, p.sx, p.sy));
  }
  Object.defineProperty(st, 'uiCapture', {
    configurable: true,
    enumerable: true,
    get: capture,
    set(v) { pinned = v == null ? null : !!v; },
  });

  // ---------------------------------------------------------------- flow
  function resolveTitle() {
    if (!titlePending) return;
    titlePending = false;
    if (!game.scenario) st.screen = 'title';
  }
  function start() {
    if (st.screen !== 'title') return false;
    st.screen = 'play';
    starts++;
    events.emit('game-start', {});
    return true;
  }
  function dismissBanner() {
    if (!banner) return false;
    banner = null;
    return true;
  }
  function checkWon() {
    if (!playing()) return;
    if (st.won === true && !bannerSeen) { bannerSeen = true; banner = { since: time }; cancelBuild(); }
  }

  // ---------------------------------------------------------------- build
  /** Picks a kind for placing (the picked kind again puts it away). Returns the picked kind. */
  function pickBuild(kind) {
    if (!playing() || banner || !BUILD_KINDS.includes(kind)) return build.kind;
    build.kind = build.kind === kind ? null : kind;
    build.flash = null;
    return build.kind;
  }
  function cancelBuild() {
    const was = build.kind;
    build.kind = null;
    return was != null;
  }
  /** Tries to plan the picked kind at the tile under the pointer. Returns the building id or null. */
  function placeAtPointer() {
    const hover = hoverPlacement();
    if (!hover) return null;
    const vs = village();
    const id = vs.placeBlueprint(hover.kind, hover.tx, hover.ty, 'player');
    const reason = id == null ? vs.lastReason ?? hover.reason : null;
    build.lastTry = { kind: hover.kind, tx: hover.tx, ty: hover.ty, ok: id != null, id, reason, at: time };
    if (id != null) build.placed.push({ id, kind: hover.kind, tx: hover.tx, ty: hover.ty });
    build.flash = { ok: id != null, text: id != null ? `${hover.kind} planned` : reasonText(reason), until: time + BUILD_FLASH };
    return id;
  }

  events.on('key-down', ({ code }) => {
    if (code === 'Backquote') { debugOpen = !debugOpen; return; }
    if (code === 'Enter' || code === 'NumpadEnter') {
      if (st.screen === 'title') start();
      else dismissBanner();
      return;
    }
    if (code === 'Escape') { cancelBuild(); return; }
    if (code in BUILD_KEYS) { pickBuild(BUILD_KINDS[BUILD_KEYS[code]]); return; }
    if (debugOpen && code === 'PageDown') debugScroll += 4;
    if (debugOpen && code === 'PageUp') debugScroll = Math.max(0, debugScroll - 4);
  });
  events.on('pointer-down', ({ button }) => {
    if (st.screen === 'title') { if (button === 0) start(); return; }
    if (!playing()) return;
    if (banner) {
      if (button === 0 && time - banner.since >= BANNER_CLICK_DELAY) dismissBanner();
      return;
    }
    if (button === 2) { cancelBuild(); return; }
    if (button !== 0) return;
    const L = currentLayout(), p = input.pointer;
    const slot = slotAt(L, p.sx, p.sy);
    if (slot >= 0) { pickBuild(BUILD_KINDS[slot]); return; }
    if (build.kind) placeAtPointer();
  });

  /** The placement message for the strip above the bar, or null. A refused click's reason shows
   * only while the ghost still sits on the refused tile and that tile is still refused, worded from
   * the current hover, so the strip never names a reason for any tile but the one under the ghost;
   * anywhere else the strip falls back to the plain tip. */
  function tipFlash(hover) {
    const f = build.flash;
    if (!f || time >= f.until) return null;
    if (f.ok) return f;
    const t = build.lastTry;
    if (!hover || hover.ok || hover.kind !== t?.kind || hover.tx !== t.tx || hover.ty !== t.ty) return null;
    return { ok: false, text: reasonText(hover.reason) };
  }

  // ---------------------------------------------------------------- draw
  function paint(ctx) {
    const L = currentLayout();
    const out = { layout: L, hud: null, bubble: null, debug: null, banner: false, title: null, build: null, ghost: null };
    last = out;
    if (st.screen === 'title') {
      out.title = drawTitle(ctx);
      return;
    }
    if (!playing()) return;
    const hover = hoverPlacement(L);
    if (hover) out.ghost = { ...hover, ...drawGhost(ctx, hover, game.world.heightAt) };
    const cs = creatureSys();
    if (cs) out.bubble = drawThought(ctx, cs.entity, st.creatureThought);
    const info = creatureInfo();
    out.hud = drawHud(ctx, L, {
      power: st.power, cap: VILLAGE.powerCap ?? 100, costs: costs(),
      alignment: st.alignment, belief: st.belief, mix: st.beliefMix, won: st.won, wonHow: st.wonHow,
      creature: info,
    });
    if (L.debug) {
      out.debug = drawDebug(ctx, L.debug, info, debugScroll);
      debugScroll = out.debug.scroll;
    }
    if (L.build) {
      const p = input.pointer;
      const flash = tipFlash(hover);
      const tip = flash ? flash.text : build.kind ? `click to plan a ${build.kind}  esc to stop` : null;
      out.build = drawBuildBar(ctx, L, {
        kind: build.kind,
        hoverSlot: p.inside ? slotAt(L, p.sx, p.sy) : -1,
        wood: village()?.stats?.().player?.wood ?? 0,
        tip, tipBad: !!flash && !flash.ok,
      });
    }
    if (banner) { drawBanner(ctx, L.banner, st.wonHow); out.banner = true; }
  }

  return {
    update(dt) {
      resolveTitle();
      if (Number.isFinite(dt) && dt > 0) time += dt;
      checkWon();
    },
    draw(ctx) {
      resolveTitle();
      checkWon();
      ctx.overlay(paint);
    },
    /** Layout for the current view (panel rects). */
    layout: currentLayout,
    /** What the last frame drew: { layout, hud, bubble, debug, banner, title, build, ghost }. */
    get last() { return last; },
    get debugOpen() { return debugOpen; },
    set debugOpen(v) { debugOpen = !!v; },
    get bannerOpen() { return !!banner; },
    /** Times the title screen handed over to play (game-start emitted). */
    get starts() { return starts; },
    /** Build state: { kind (picked or null), open, hover (what a click would plan now), lastTry,
     * placed (ids this session's clicks planned) }. */
    get build() {
      return { kind: build.kind, open: build.kind != null, hover: hoverPlacement(), lastTry: build.lastTry, placed: build.placed.slice() };
    },
    pickBuild,
    cancelBuild,
    start,
    dismissBanner,
    capture,
  };
}
