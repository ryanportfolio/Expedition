// Browser check: build with Vite, serve the build, run one scenario in headed Chrome, save
// screenshots and result.json.
//
//   node scripts/browser-check.mjs --scenario <name> [--out <dir>] [--window <WxH>] [--seed <n>] [--timeout <s>]
//
// Output: D:/screenshots/Expedition/<basename of cwd>/<scenario>/ unless --out is given (falls back
// to .tmp/screenshots/<basename>/<scenario>/ when D: is missing or not writable, and says so).
// The page viewport is exactly --window in CSS px at device scale 1, so the view size is
// floor(W / 3) x floor(H / 3) at zoom 1.
// Every screenshot is decoded and checked: each game pixel must show as one solid scale x scale
// block of device pixels matching the view buffer pixel (no smoothing, no offset), and the image must
// hold more than 8 colours (blank-image guard).
// Exit 0 only when the scenario finished, made at least one assert and took at least one screenshot,
// every assert and pixel check passed and the page logged no page error or console error (round 46:
// a scenario that asserted nothing and took no screenshot passed). Chrome and the server are closed
// on every path.
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { build } from 'vite';
import { serveStatic } from './lib/static-server.mjs';
import { launchPlacedChrome } from './lib/launch-chrome.mjs';

function parseArgs(argv) {
  const o = { scenario: null, out: null, window: '1920x1080', seed: 1, timeout: 90 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--scenario') o.scenario = v();
    else if (a === '--out') o.out = v();
    else if (a === '--window') o.window = v();
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--timeout') o.timeout = Number(v());
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.scenario || !/^[\w-]+$/.test(o.scenario)) throw new Error('--scenario <name> is required (letters, digits, - and _)');
  const m = /^(\d+)x(\d+)$/.exec(o.window);
  if (!m) throw new Error(`--window must be WxH, got ${o.window}`);
  o.width = Number(m[1]);
  o.height = Number(m[2]);
  if (!Number.isInteger(o.seed)) throw new Error('--seed must be an integer');
  if (!(o.timeout > 0)) throw new Error('--timeout must be a positive number of seconds');
  return o;
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

function outDir(o) {
  if (o.out) return path.resolve(o.out);
  const base = path.basename(process.cwd());
  const d = `D:/screenshots/Expedition/${base}/${o.scenario}`;
  if (fs.existsSync('D:/') && writable(d)) return d;
  const fallback = path.resolve('.tmp/screenshots', base, o.scenario);
  console.warn(`[browser-check] D: drive missing or not writable; screenshots go to ${fallback}`);
  return fallback;
}

/**
 * Crisp-pixel check for one screenshot. The scenario is paused inside t.shot while this runs, so the
 * view buffer read here is the frame on screen. Every game pixel (bx, by) must cover device pixels
 * [bx*scale, by*scale] .. +scale-1 as one solid colour (no smoothing, no sub-pixel offset) that matches
 * the view buffer within 4 per channel (colour management slack). Fewer than 9 distinct colours means
 * a blank or near-blank frame and fails too. The page runs at deviceScaleFactor 1, so screenshot
 * pixels are device pixels.
 */
async function checkPixels(page, png) {
  const img = decodePng(png);
  const v = await page.evaluate(() => {
    const g = window.__game;
    const view = g.renderer.view;
    let b = '';
    for (let i = 0; i < view.bytes.length; i += 0x8000) b += String.fromCharCode.apply(null, view.bytes.subarray(i, i + 0x8000));
    return { w: view.w, h: view.h, scale: g.display.scale, b64: btoa(b) };
  });
  const s = v.scale;
  const view = Buffer.from(v.b64, 'base64');
  if (view.length !== v.w * v.h * 4) return { ok: false, summary: `view buffer ${view.length} bytes, want ${v.w * v.h * 4}` };
  if (img.w < v.w * s || img.h < v.h * s) return { ok: false, summary: `screenshot ${img.w}x${img.h} smaller than view ${v.w}x${v.h} at scale ${s}` };
  let notSolid = 0, mismatch = 0, maxDiff = 0;
  const colours = new Set();
  for (let by = 0; by < v.h; by++) {
    for (let bx = 0; bx < v.w; bx++) {
      const o = (by * s * img.w + bx * s) * 4;
      const r = img.px[o], g = img.px[o + 1], b = img.px[o + 2];
      let solid = true;
      for (let y = 0; y < s && solid; y++) {
        for (let x = 0; x < s; x++) {
          const p = ((by * s + y) * img.w + bx * s + x) * 4;
          if (img.px[p] !== r || img.px[p + 1] !== g || img.px[p + 2] !== b) { solid = false; break; }
        }
      }
      if (!solid) notSolid++;
      const q = (by * v.w + bx) * 4;
      const d = Math.max(Math.abs(view[q] - r), Math.abs(view[q + 1] - g), Math.abs(view[q + 2] - b));
      if (d > maxDiff) maxDiff = d;
      if (d > 4) mismatch++;
      if (colours.size < 4096) colours.add((r << 16) | (g << 8) | b);
    }
  }
  const blank = colours.size <= 8;
  return {
    ok: notSolid === 0 && mismatch === 0 && !blank,
    view: { w: v.w, h: v.h, scale: s }, blocks: v.w * v.h, notSolid, mismatch, maxDiff, colours: colours.size, blank,
    summary: `${v.w * v.h} blocks of ${s}x${s}: ${notSolid} not solid, ${mismatch} differ from the view buffer (max channel diff ${maxDiff}), ${colours.size} colours${blank ? ' (blank: 8 or fewer)' : ''}`,
  };
}

/** Minimal PNG decoder for what Chrome writes: 8-bit RGB or RGBA, not interlaced. Returns { w, h, px: RGBA }. */
function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace) throw new Error(`unsupported PNG: depth ${depth} type ${type} interlace ${interlace}`);
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ro = y * (stride + 1), f = raw[ro];
    for (let i = 0; i < stride; i++) {
      const x = raw[ro + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let val;
      if (f === 0) val = x;
      else if (f === 1) val = x + a;
      else if (f === 2) val = x + b;
      else if (f === 3) val = x + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${f}`);
      cur[i] = val & 255;
    }
    for (let i = 0; i < w; i++) {
      const o = (y * w + i) * 4;
      px[o] = cur[i * bpp]; px[o + 1] = cur[i * bpp + 1]; px[o + 2] = cur[i * bpp + 2];
      px[o + 3] = bpp === 4 ? cur[i * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, px };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!process.env.CHROME_PLACE) process.env.CHROME_PLACE = 'offscreen';
  const out = outDir(o);
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.endsWith('.png') || f === 'result.json') fs.rmSync(path.join(out, f));

  const buildDir = path.resolve('.tmp/browser-check', String(process.pid));
  const result = {
    scenario: o.scenario, seed: o.seed, window: { width: o.width, height: o.height }, out,
    ok: false, asserts: [], failed: [], logs: [], shots: [], pixelChecks: [], consoleErrors: [], pageErrors: [], view: null, error: null,
  };
  let server = null;
  let browser = null;
  try {
    await build({ root: process.cwd(), logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } });
    server = await serveStatic(buildDir);
    browser = await launchPlacedChrome({ args: ['--mute-audio'], purpose: `browser-check ${o.scenario}` });
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') result.consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => result.pageErrors.push(String(err?.stack || err)));
    await page.exposeFunction('__harnessShot', async (name) => {
      const safe = String(name).replace(/[^\w-]/g, '_');
      const file = path.join(out, `${safe}.png`);
      const png = await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
      result.shots.push(file);
      let check;
      try {
        check = await checkPixels(page, png);
      } catch (err) {
        check = { ok: false, summary: `pixel check threw: ${err?.message || err}` };
      }
      result.pixelChecks.push({ name: safe, ...check });
      console.log(`[browser-check] shot ${safe}: pixel check ${check.ok ? 'ok' : 'FAILED'}: ${check.summary}`);
    });
    await page.goto(`${server.url}?scenario=${encodeURIComponent(o.scenario)}&seed=${o.seed}`);
    await page.waitForFunction(() => window.__scenario?.done === true, null, { timeout: o.timeout * 1000, polling: 100 });
    const state = await page.evaluate(() => window.__scenario);
    result.asserts = state.asserts;
    result.failed = state.asserts.filter((a) => !a.ok);
    result.logs = state.logs;
    result.view = state.view;
    result.shotViews = state.shots;
    result.error = state.error;
    result.ok = state.ok && !state.error && result.failed.length === 0 &&
      result.asserts.length > 0 && result.shots.length > 0 &&
      result.consoleErrors.length === 0 && result.pageErrors.length === 0 &&
      result.pixelChecks.length === result.shots.length && result.pixelChecks.every((c) => c.ok);
  } catch (err) {
    result.error = String(err?.stack || err);
    result.ok = false;
  } finally {
    if (browser) await browser.close().catch((e) => console.warn(`[browser-check] browser close: ${e.message}`));
    if (server) await server.close();
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));

  const passed = result.asserts.length - result.failed.length;
  console.log(`[browser-check] ${o.scenario} @ ${o.width}x${o.height}: ${passed}/${result.asserts.length} asserts passed, ` +
    `${result.consoleErrors.length} console errors, ${result.pageErrors.length} page errors` +
    (result.view ? `, final view ${result.view.w}x${result.view.h} at zoom ${result.view.zoom}` : ''));
  for (const a of result.failed) console.log(`  FAIL ${a.msg}`);
  if (!result.error && !result.asserts.length) console.log('  FAIL the scenario made no asserts');
  if (!result.error && !result.shots.length) console.log('  FAIL the scenario took no screenshot');
  for (const c of result.pixelChecks) if (!c.ok) console.log(`  FAIL pixel check ${c.name}: ${c.summary}`);
  for (const e of [...result.consoleErrors, ...result.pageErrors]) console.log(`  ERROR ${e}`);
  if (result.error) console.log(`  ERROR ${result.error}`);
  console.log(`[browser-check] ${result.shots.length} screenshots + result.json in ${out}`);
  console.log(result.ok ? '[browser-check] PASS' : '[browser-check] FAIL');
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(`[browser-check] ${err?.stack || err}`);
  process.exitCode = 2;
});
