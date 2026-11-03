// Node checks for the art kit: palette, LUTs, sprite primitives, registry, PNG encoder and decoder,
// and that the baked hand sprites (src/art/painters/hand-data.js) match a fresh bake of art-src/hand/.
//   node scripts/check-art.mjs        exit 0 on pass; non-zero with the failing assertions printed.

import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { RAMPS, RAMP, SHADES, MAX_RAMPS, idx, rampOf } = await load('src/art/palette.js');
const { makeLut, lutFor, rgbaOf, packRGBA } = await load('src/art/lut.js');
const S = await load('src/art/sprite.js');
const registry = await load('src/art/registry.js');
const { encodePNG, decodePNG, crc32 } = await import('./lib/png.mjs');

let failed = 0, passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
}
const eq = (name, got, want) => check(name, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const count = (s, c) => s.data.reduce((n, v) => n + (c === undefined ? (v ? 1 : 0) : v === c ? 1 : 0), 0);
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// ---- palette ----
const REQUIRED = ['ink', 'grass', 'dirt', 'sand', 'rock', 'water', 'foliage', 'bark', 'thatch', 'stone', 'clay', 'skin',
  'cloth-player', 'cloth-rival', 'creature-hide', 'creature-accent', 'hand-glow', 'grain', 'fire', 'heal', 'lightning',
  'ui-parchment', 'ui-ink', 'shadow', 'heart'];
const MUST_SHIFT = ['grass', 'dirt', 'sand', 'rock', 'water', 'foliage', 'bark', 'thatch', 'stone', 'creature-hide', 'creature-accent', 'hand-glow', 'heart'];
const MUST_NOT_SHIFT = ['ink', 'skin', 'ui-parchment', 'ui-ink', 'rose'];
check('ramp count 1..31', RAMPS.length >= 1 && RAMPS.length <= 31 && MAX_RAMPS === 31, `have ${RAMPS.length}`);
eq('8 shades', SHADES, 8);
for (const n of REQUIRED) check(`ramp "${n}" present`, n in RAMP);
check('ramp names unique', new Set(RAMPS.map((r) => r.name)).size === RAMPS.length);
RAMPS.forEach((r, i) => {
  eq(`RAMP["${r.name}"]`, RAMP[r.name], i);
  for (const side of ['good', 'evil']) {
    check(`${r.name}.${side} has 8 colors`, Array.isArray(r[side]) && r[side].length === 8);
    for (const h of r[side]) check(`${r.name}.${side} hex ${h}`, /^#[0-9a-f]{6}$/i.test(h));
  }
});
const differs = (r) => r.good.some((h, i) => h.toLowerCase() !== r.evil[i].toLowerCase());
for (const n of MUST_SHIFT) check(`ramp "${n}" differs good vs evil`, differs(RAMPS[RAMP[n]]));
for (const n of MUST_NOT_SHIFT) check(`ramp "${n}" identical good vs evil`, !differs(RAMPS[RAMP[n]]));

// Perceived lightness (OKLab L) must rise every shade, darkest first, with no step tiny or huge.
function oklabL(hex) {
  const lin = hexRGB(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}
for (const r of RAMPS) for (const side of ['good', 'evil']) {
  const L = r[side].map(oklabL), steps = L.slice(1).map((v, i) => v - L[i]);
  const mean = (L[7] - L[0]) / 7;
  check(`${r.name}.${side} lightness rises evenly`, steps.every((d) => d > 0.4 * mean && d < 1.6 * mean),
    `steps ${steps.map((d) => d.toFixed(3)).join(' ')}`);
}

// ---- idx ----
eq('idx(ink, 0)', idx('ink', 0), 1);
eq('idx(ramp 1, shade 0)', idx(RAMPS[1].name, 0), 9);
eq('idx(grass, 7)', idx('grass', 7), 1 + RAMP.grass * 8 + 7);
eq('idx(last ramp, 7)', idx(RAMPS[RAMPS.length - 1].name, 7), RAMPS.length * 8);
eq('idx(numeric ramp)', idx(2, 3), 1 + 2 * 8 + 3);
check('idx max fits a byte', RAMPS.length * 8 <= 255);
check('idx unknown ramp throws', (() => { try { idx('nope', 0); return false; } catch { return true; } })());
check('rampOf inverts idx', JSON.stringify(rampOf(idx('water', 5))) === JSON.stringify({ ramp: RAMP.water, shade: 5 }) && rampOf(0) === null);

// ---- LUT ----
const good = makeLut(1), evil = makeLut(-1), mid = makeLut(0);
check('LUT is Uint32Array(256)', good instanceof Uint32Array && good.length === 256);
eq('lut[0] unused (0)', good[0], 0);
eq('packRGBA little-endian 0xAABBGGRR', packRGBA(0x11, 0x22, 0x33, 0x44), 0x44332211);
check('ImageData byte order', (() => {
  const bytes = new Uint8Array(new Uint32Array([packRGBA(1, 2, 3, 255)]).buffer);
  return bytes[0] === 1 && bytes[1] === 2 && bytes[2] === 3 && bytes[3] === 255;
})());
let lutOk = { good: true, evil: true, mid: true, alpha: true };
RAMPS.forEach((r, ri) => {
  for (let s = 0; s < 8; s++) {
    const i = 1 + ri * 8 + s, g = hexRGB(r.good[s]), e = hexRGB(r.evil[s]);
    const gg = rgbaOf(good, i), ee = rgbaOf(evil, i), mm = rgbaOf(mid, i);
    if (gg.slice(0, 3).some((v, k) => v !== g[k])) lutOk.good = false;
    if (ee.slice(0, 3).some((v, k) => v !== e[k])) lutOk.evil = false;
    if (mm.slice(0, 3).some((v, k) => Math.abs(v - (g[k] + e[k]) / 2) > 1)) lutOk.mid = false;
    if (gg[3] !== 255 || ee[3] !== 255 || mm[3] !== 255) lutOk.alpha = false;
  }
});
check('LUT(+1) equals good colors', lutOk.good);
check('LUT(-1) equals evil colors', lutOk.evil);
check('LUT(0) equals midpoint within 1', lutOk.mid);
check('LUT colors opaque', lutOk.alpha);
check('LUT entries past last ramp are 0', good.slice(RAMPS.length * 8 + 1).every((v) => v === 0));
check('quantize: 0.51 and 0.5 share one cached LUT', makeLut(0.51) === makeLut(0.5));
check('quantize: same step, same object', makeLut(0.3) === makeLut(0.25) && makeLut(-0.99) === makeLut(-1));
check('quantize: neighbor steps differ', makeLut(0.5) !== makeLut(0.625) && makeLut(0.5)[idx('grass', 4)] !== makeLut(0.625)[idx('grass', 4)]);
check('clamps out-of-range alignment', makeLut(5) === makeLut(1) && makeLut(-7) === makeLut(-1));
check('17 distinct LUTs', new Set(Array.from({ length: 41 }, (_, i) => makeLut(-1 + i * 0.05))).size === 17);
check('lutFor neutral returns the alignment-0 LUT', lutFor(0.9, { neutral: true }) === mid && lutFor(-0.9, { neutral: true }) === mid);
check('lutFor plain = makeLut', lutFor(-0.5) === makeLut(-0.5));
const neutralRamps = RAMPS.map((r, i) => [r, i]).filter(([r]) => !differs(r));
check('neutral ramp list includes ink/skin/ui', MUST_NOT_SHIFT.every((n) => neutralRamps.some(([r]) => r.name === n)));
let neutralSame = true;
for (let k = -8; k <= 8; k++) {
  const lut = makeLut(k / 8);
  for (const [, ri] of neutralRamps) for (let s = 0; s < 8; s++) if (lut[1 + ri * 8 + s] !== mid[1 + ri * 8 + s]) neutralSame = false;
}
check('neutral ramps identical across all 17 alignments', neutralSame);

// ---- sprite primitives ----
{
  const s = S.createSprite(4, 3, 1, 2);
  check('createSprite shape', s.w === 4 && s.h === 3 && s.ax === 1 && s.ay === 2 && s.data instanceof Uint8Array && s.data.length === 12);
  S.px(s, 2, 1, 7); S.px(s, -1, 0, 9); S.px(s, 4, 0, 9);
  eq('px/get', S.get(s, 2, 1), 7);
  eq('px out of bounds ignored', count(s), 1);
  eq('get outside = 0', S.get(s, 9, 9), 0);
}
{
  const s = S.createSprite(10, 10);
  S.rect(s, 2, 3, 4, 5, 3);
  eq('rect area', count(s, 3), 20);
  check('rect corners', S.get(s, 2, 3) === 3 && S.get(s, 5, 7) === 3 && S.get(s, 6, 7) === 0 && S.get(s, 5, 8) === 0);
  const c = S.createSprite(4, 4); S.rect(c, -2, -2, 4, 4, 1);
  eq('rect clips', count(c, 1), 4);
}
{
  const s = S.createSprite(12, 8);
  S.line(s, 1, 1, 10, 5, 4);
  check('line endpoints', S.get(s, 1, 1) === 4 && S.get(s, 10, 5) === 4);
  eq('line pixel count = max(dx,dy)+1', count(s, 4), 10);
  let oneperCol = true;
  for (let x = 1; x <= 10; x++) { let n = 0; for (let y = 0; y < 8; y++) n += S.get(s, x, y) === 4 ? 1 : 0; if (n !== 1) oneperCol = false; }
  check('line is 1 px thick (one pixel per column)', oneperCol);
  const v = S.createSprite(3, 6); S.line(v, 1, 5, 1, 0, 2);
  eq('vertical line reversed', count(v, 2), 6);
}
{
  const s = S.createSprite(32, 16);
  S.isoDiamond(s, 0, 0, 5);
  const widths = [], starts = [];
  for (let y = 0; y < 16; y++) {
    let n = 0, first = -1;
    for (let x = 0; x < 32; x++) if (S.get(s, x, y)) { n++; if (first < 0) first = x; }
    widths.push(n); starts.push(first);
  }
  const want = [2, 6, 10, 14, 18, 22, 26, 30, 30, 26, 22, 18, 14, 10, 6, 2];
  eq('isoDiamond 32x16 row widths', widths.join(','), want.join(','));
  eq('isoDiamond row starts centered', starts.join(','), want.map((w) => 16 - w / 2).join(','));
  eq('isoDiamond area', count(s, 5), 256);
  // Neighboring tiles at (+16, +8) share an edge without gap or overlap.
  const t = S.createSprite(64, 32);
  S.isoDiamond(t, 0, 0, 1); S.isoDiamond(t, 16, 8, 2);
  eq('adjacent diamonds do not overlap', count(t), 512);
  const g = S.createSprite(64, 32);
  for (const [x, y] of [[16, 0], [0, 8], [32, 8], [16, 16]]) S.isoDiamond(g, x, y, 1);
  eq('2x2 diamond patch has no hole at the shared center', S.get(g, 31, 16) && S.get(g, 32, 15) && S.get(g, 31, 15) && S.get(g, 32, 16) ? 1 : 0, 1);
}
{
  const s = S.createSprite(32, 28);
  S.isoBox(s, 16, 0, 8, 8, 12, { top: 7, left: 5, right: 3 });
  eq('isoBox top face = diamond area', count(s, 7), 256);
  eq('isoBox left wall', count(s, 5), 16 * 12);
  eq('isoBox right wall', count(s, 3), 16 * 12);
  check('isoBox left face on left, right face on right', S.get(s, 4, 20) === 5 && S.get(s, 27, 20) === 3 && S.get(s, 16, 4) === 7);
}
{
  const s = S.createSprite(11, 11);
  S.ellipse(s, 5, 5, 4, 4, 2, 1);
  const n = count(s);
  check('ellipse filled + outline', count(s, 2) > 0 && count(s, 1) > 0 && n > 40 && n < 81, `opaque ${n}`);
  check('ellipse outline on the edge, fill inside', S.get(s, 5, 5) === 2 && S.get(s, 1, 5) === 1 && S.get(s, 9, 5) === 1 && S.get(s, 5, 1) === 1);
  check('ellipse symmetric', [...Array(11).keys()].every((y) => [...Array(11).keys()].every((x) => S.get(s, x, y) === S.get(s, 10 - x, y) && S.get(s, x, y) === S.get(s, x, 10 - y))));
  const p = S.createSprite(3, 3); S.ellipse(p, 1, 1, 1, 1, 4);
  eq('radius-1 circle is a plus', count(p, 4), 5);
}
{
  const s = S.createSprite(10, 10);
  S.polygon(s, [[2, 2], [8, 2], [8, 6], [2, 6]], 6);
  eq('polygon square area', count(s, 6), 24);
  const tri = S.createSprite(10, 10);
  S.polygon(tri, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], 1);
  eq('polygon triangle area', count(tri, 1), 55 - 10);
}
{
  const s = S.createSprite(8, 8);
  S.ellipse(s, 4, 4, 3, 3, idx('water', 4));
  const before = s.data.slice();
  S.sphereShade(s, 'water', { lo: 1, hi: 7 });
  check('sphereShade keeps silhouette', s.data.every((v, i) => (v !== 0) === (before[i] !== 0)));
  check('sphereShade stays in ramp', s.data.every((v) => v === 0 || rampOf(v).ramp === RAMP.water));
  check('sphereShade lit top-left, dark bottom-right', rampOf(S.get(s, 3, 2)).shade > rampOf(S.get(s, 6, 6)).shade,
    `${rampOf(S.get(s, 3, 2)).shade} vs ${rampOf(S.get(s, 6, 6)).shade}`);
  const o = S.createSprite(4, 1); S.rect(o, 0, 0, 2, 1, 9); S.rect(o, 2, 0, 2, 1, 10);
  S.sphereShade(o, 'fire', { only: 9 });
  check('sphereShade only touches matching pixels', S.get(o, 2, 0) === 10 && S.get(o, 3, 0) === 10 && rampOf(S.get(o, 0, 0)).ramp === RAMP.fire);
}
{
  const s = S.createSprite(4, 4);
  S.dither(s, 0, 0, 4, 4, 1, 2, 0.5);
  check('dither 0.5 is a checkerboard', count(s, 1) === 8 && count(s, 2) === 8 && S.get(s, 0, 0) !== S.get(s, 1, 0) && S.get(s, 0, 0) !== S.get(s, 0, 1) && S.get(s, 0, 0) === S.get(s, 1, 1));
  const z = S.createSprite(4, 4); S.dither(z, 0, 0, 4, 4, 1, 2, 0);
  eq('dither 0 = all c0', count(z, 1), 16);
  const q = S.createSprite(4, 4); S.dither(q, 0, 0, 4, 4, 1, 2, 0.25);
  eq('dither 0.25 = quarter c1', count(q, 2), 4);
  const m = S.createSprite(4, 1); S.px(m, 1, 0, 5); S.dither(m, 0, 0, 4, 1, 1, 2, 1, true);
  check('dither onlyOpaque leaves transparent', count(m) === 1 && S.get(m, 1, 0) === 2);
}
{
  const s = S.createSprite(3, 3, 1, 2);
  S.px(s, 1, 1, 4);
  const o = S.outline(s, 9);
  check('outline grows by 1 each side and shifts anchor', o.w === 5 && o.h === 5 && o.ax === 2 && o.ay === 3);
  eq('outline ring (4-neighborhood)', count(o, 9), 4);
  check('outline keeps the source pixel', S.get(o, 2, 2) === 4 && S.get(o, 2, 1) === 9 && S.get(o, 1, 1) === 0);
  eq('outline corners option', count(S.outline(s, 9, { corners: true }), 9), 8);
  eq('outline leaves input alone', count(s), 1);
  const f = S.createSprite(2, 2); S.rect(f, 0, 0, 2, 2, 3);
  eq('outline ring around a 2x2 block', count(S.outline(f, 1), 1), 8);
}
{
  const s = S.createSprite(5, 2, 1, 1);
  S.px(s, 0, 0, 1); S.px(s, 1, 1, 2);
  const m = S.mirror(s);
  check('mirror flips pixels', S.get(m, 4, 0) === 1 && S.get(m, 3, 1) === 2 && count(m) === 2);
  check('mirror moves the anchor', m.ax === 3 && m.ay === 1);
  check('mirror twice is identity', (() => { const b = S.mirror(m); return b.ax === s.ax && b.data.every((v, i) => v === s.data[i]); })());
}
{
  const dst = S.createSprite(6, 6);
  const src = S.createSprite(2, 2); S.px(src, 0, 0, 3); S.px(src, 1, 1, 4);
  S.px(dst, 3, 3, 8);
  S.stamp(dst, src, 2, 2);
  check('stamp places pixels, skips transparent', S.get(dst, 2, 2) === 3 && S.get(dst, 3, 3) === 4 && S.get(dst, 3, 2) === 0);
  S.stamp(dst, src, 5, 5);
  check('stamp clips', S.get(dst, 5, 5) === 3);
  const fl = S.createSprite(2, 1); S.stamp(fl, src, 0, 0, { flipX: true });
  eq('stamp flipX', S.get(fl, 1, 0), 3);
}
{
  const s = S.createSprite(10, 10, 5, 9);
  S.rect(s, 3, 4, 3, 2, 6);
  const t = S.trim(s);
  check('trim crops to opaque bounds', t.w === 3 && t.h === 2 && count(t, 6) === 6);
  // World position of pixel (x, y) relative to the anchor must not change: (x - ax, y - ay).
  check('trim keeps the anchor world position', t.ax === 5 - 3 && t.ay === 9 - 4, `ax ${t.ax} ay ${t.ay}`);
  const e = S.trim(S.createSprite(4, 4, 2, 2));
  check('trim of empty sprite', e.w === 1 && e.h === 1 && count(e) === 0);
}
{
  const s = S.createSprite(2, 1); S.px(s, 1, 0, idx('fire', 7));
  const rgba = S.toRGBA(s, good);
  const [r, g, b] = hexRGB(RAMPS[RAMP.fire].good[7]);
  check('toRGBA', rgba instanceof Uint8ClampedArray && rgba.length === 8 && rgba[3] === 0 && rgba[4] === r && rgba[5] === g && rgba[6] === b && rgba[7] === 255);
}

// ---- registry ----
{
  const warnings = [];
  const origWarn = console.warn, origErr = console.error;
  console.warn = (...a) => warnings.push(a.join(' '));
  console.error = (...a) => warnings.push(a.join(' '));
  let calls = 0;
  try {
    registry.registerPainters({
      sprites: {
        'check-dot': (o) => { calls++; const s = S.createSprite(1 + (o.size ?? 0), 1); S.px(s, 0, 0, idx('ink', 0)); return s; },
        'check-broken': () => { throw new Error('boom'); },
      },
      previews: { 'check-dot': [{ size: 2 }] },
    });
    const a = registry.getSprite('check-dot', { size: 1, tint: 'x' });
    const b = registry.getSprite('check-dot', { tint: 'x', size: 1 });
    check('registry memoizes by name + stable opts', a === b && calls === 1);
    check('registry: different opts paint again', registry.getSprite('check-dot', { size: 2 }) !== a && calls === 2);
    check('registry: no opts = empty opts', registry.getSprite('check-dot') === registry.getSprite('check-dot', {}));
    check('listSprites includes registered', registry.listSprites().includes('check-dot'));
    eq('previewsFor', JSON.stringify(registry.previewsFor('check-dot')), '[{"size":2}]');
    let threw = false, p1, p2;
    try { p1 = registry.getSprite('no-such-sprite'); p2 = registry.getSprite('no-such-sprite', { x: 1 }); } catch { threw = true; }
    check('unknown name does not throw', !threw);
    check('placeholder is 8x8 and shared', p1 && p1.w === 8 && p1.h === 8 && p1 === p2);
    check('placeholder uses ink and fire ramps', p1 && [...new Set(p1.data)].every((v) => [RAMP.ink, RAMP.fire].includes(rampOf(v)?.ramp)) && new Set(p1.data).size === 2);
    eq('unknown name warns once', warnings.filter((w) => w.includes('no-such-sprite')).length, 1);
    let threw2 = false;
    try { check('throwing painter gives placeholder', registry.getSprite('check-broken') === p1); } catch { threw2 = true; }
    check('throwing painter does not throw', !threw2);
    check('stableKey sorts keys', registry.stableKey({ b: 1, a: [1, { d: 2, c: 3 }] }) === registry.stableKey({ a: [1, { c: 3, d: 2 }], b: 1 }));
  } finally {
    console.warn = origWarn; console.error = origErr;
  }
  // Every shipped painter file must register and paint without falling back to the placeholder.
  const dir = join(ROOT, 'src/art/painters');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    registry.registerPainters(mod);
    for (const name of Object.keys(mod.sprites ?? {})) {
      for (const opts of [{}, ...(mod.previews?.[name] ?? [])]) {
        const sp = registry.getSprite(name, opts);
        check(`painter ${f} "${name}" ${registry.stableKey(opts)} paints`, sp !== registry.placeholderSprite() && count(sp) > 0);
        check(`painter "${name}" uses valid indices`, sp.data.every((v) => v === 0 || v <= RAMPS.length * 8));
      }
    }
  }
  // Step 4: a villager whose job the hand set is outlined in its job's colour, the same colour at
  // every alignment, and no two jobs share one.
  {
    const { JOB_GLOW } = await load('src/art/painters/villagers.js');
    const evil = makeLut(-1), good = makeLut(1);
    const seen = new Set();
    for (const [job, [ramp, shade]] of Object.entries(JOB_GLOW)) {
      const gi = idx(ramp, shade);
      const opts = { job, pose: 'walk', frame: 1, facing: 'se', owner: 'player' };
      const lit = registry.getSprite('villager', { ...opts, glow: true }), plain = registry.getSprite('villager', opts);
      check(`${job} glow outlines the figure in ${ramp} ${shade}`, lit.data.filter((v) => v === gi).length >= 20 && !plain.data.includes(gi) &&
        lit.data.every((v, i) => v === plain.data[i] || (v === gi && plain.data[i] === idx('ink', 0))));
      check(`${job} glow is the same colour good and evil`, evil[gi] === good[gi], `${rgbaOf(evil, gi)} vs ${rgbaOf(good, gi)}`);
      check(`${job} glow colour is its own`, !seen.has(good[gi]));
      seen.add(good[gi]);
    }
    // Far enough apart to tell at a glance: every two glow colours at least 0.1 apart in OKLab.
    const lab = (hex) => {
      const [r, g, b] = hexRGB(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    };
    const glows = Object.entries(JOB_GLOW).map(([job, [ramp, shade]]) => [job, lab(RAMPS[RAMP[ramp]].good[shade])]);
    let close = null;
    for (let i = 0; i < glows.length; i++) for (let j = i + 1; j < glows.length; j++) {
      const d = Math.hypot(...glows[i][1].map((v, k) => v - glows[j][1][k]));
      if (!close || d < close.d) close = { d, pair: `${glows[i][0]}/${glows[j][0]}` };
    }
    check('job glow colours at least 0.1 apart (OKLab)', close.d >= 0.1, `closest ${close.pair} ${close.d.toFixed(3)}`);
  }
  const fig = registry.getSprite('test-figure');
  check('test figure is about 10 px tall', fig.h >= 9 && fig.h <= 12, `h ${fig.h}`);
}

// ---- PNG ----
{
  const w = 3, h = 2, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([i * 40, 255 - i * 30, i * 7, i === 4 ? 0 : 255], i * 4);
  const png = encodePNG(w, h, rgba);
  check('PNG signature', png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  let off = 8; const chunks = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.toString('latin1', off + 4, off + 8), data = png.subarray(off + 8, off + 8 + len);
    const crcOk = png.readUInt32BE(off + 8 + len) === crc32(png.subarray(off + 4, off + 8 + len));
    chunks.push({ type, data, crcOk });
    off += 12 + len;
  }
  eq('PNG chunk order', chunks.map((c) => c.type).join(','), 'IHDR,IDAT,IEND');
  check('PNG CRCs', chunks.every((c) => c.crcOk));
  const ih = chunks[0].data;
  check('IHDR', ih.readUInt32BE(0) === w && ih.readUInt32BE(4) === h && ih[8] === 8 && ih[9] === 6 && ih[12] === 0);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  eq('IDAT size', raw.length, h * (w * 4 + 1));
  // The encoder's default (no options) stores every row unfiltered: filter type 0 (None). The raw
  // row reads below rely on that; decodePNG (tested further down) handles every filter type.
  check('PNG rows use filter 0', [...Array(h).keys()].every((y) => raw[y * (w * 4 + 1)] === 0));
  const pix = (x, y) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)];
  check('PNG pixels round trip', JSON.stringify(pix(0, 0)) === JSON.stringify([0, 255, 0, 255])
    && JSON.stringify(pix(2, 1)) === JSON.stringify([200, 105, 35, 255])
    && JSON.stringify(pix(1, 1)) === JSON.stringify([160, 135, 28, 0]));
  eq('CRC32 known value', crc32(Buffer.from('IEND', 'latin1')), 0xae426082);
  check('encodePNG rejects wrong length', (() => { try { encodePNG(2, 2, new Uint8Array(3)); return false; } catch { return true; } })());
  // decoder (scripts/bake-hand.mjs reads its sources with it): every encoder mode decodes back to the input
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const dec = decodePNG(png);
  check('decodePNG RGBA round trip', dec.width === w && dec.height === h && same(dec.rgba, rgba));
  const big = new Uint8ClampedArray(7 * 5 * 4);
  for (let i = 0; i < 35; i++) big.set([(i * 37) & 255, (i * 91 + 13) & 255, (255 - i * 11) & 255, 255], i * 4);
  for (const opts of [{ filter: true }, { rgb: true }, { rgb: true, filter: true }]) {
    const d = decodePNG(encodePNG(7, 5, big, opts));
    check(`decodePNG round trip ${JSON.stringify(opts)}`, d.width === 7 && d.height === 5 && same(d.rgba, big));
  }
  check('decodePNG rejects a bad CRC', (() => { const b = Buffer.from(png); b[b.length - 20] ^= 1; try { decodePNG(b); return false; } catch { return true; } })());
  check('decodePNG rejects non-PNG bytes', (() => { try { decodePNG(Buffer.from('not a png')); return false; } catch { return true; } })());
}

// ---- baked hand sprites are current ----
{
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/bake-hand.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  check('hand-data.js matches a fresh bake (node scripts/bake-hand.mjs --check)', r.status === 0, `exit ${r.status}: ${(r.stderr || r.error?.message || '').trim()}`);
}

if (failed) {
  console.error(`check-art: ${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`check-art: all ${passed} checks passed`);
}
