// Frame-time check in the worst-case scene (src/dev/scenarios/perf.js: a town of hundreds of
// villagers round each village, the creature and all four miracles alive), on the real-time loop.
//
//   node scripts/perf-check.mjs [--budget <ms>] [--warmup <s>] [--seconds <s>] [--window <WxH>] [--out <dir>]
//                               [--scenario <name>] [--town <n>] [--rival <n>]
//
// --town and --rival set the villagers in the player and rival towns (default: TOWN in src/dev/town.js).
//
// Builds with Vite, serves dist from node on an ephemeral port, opens headed Chrome through
// launchPlacedChrome() (off screen, muted; never headless, never minimized, so rAF runs at the
// display rate) with a 1920x1080 viewport at a device pixel ratio of 1. First it measures the display
// refresh rate from rAF in an empty page, then opens ?scenario=perf, waits for window.__perf.ready
// (the scene handed to game.start()), warms up 5 s and records 20 s of real frames: the frame time is
// the gap between consecutive rAF timestamps, and inside the page the scene's profiler splits each
// game.frame into sim ticks and render phases (terrain, systems draw, collect, fx back, sort+blit,
// fx front, overlays, present).
//
// End-of-window check: the scene must still be the worst case when the window closes. Against the
// window start it needs player houses standing >= start - 1 and player villagers alive >= 80% of the
// start count, and every one of the four miracle effects alive on every sim tick of the last 2 s
// (the scene's tick hook stamps each tick on which an effect was not alive). A failed check fails
// the run whatever the frame times.
//
// Output: stdout and <out>/perf.json (default D:/screenshots/Expedition/<basename of cwd>/perf/), plus
// one screenshot of the running scene in <out>/perf-check/scene.png (a subfolder, because
// browser-check clears PNGs in the perf folder itself). Exit 1 when p95 frame time is over the
// budget (default 16.7 ms), the end-of-window check fails or the run fails, else 0. --scenario runs
// another scene that installs the same window.__perf (default perf), for example a copy that aims
// fire at the houses to prove the end-of-window check fails. Chrome and the server are closed on every path.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { serveStatic } from './lib/static-server.mjs';
import { launchPlacedChrome } from './lib/launch-chrome.mjs';

function parseArgs(argv) {
  const o = { budget: 16.7, warmup: 5, seconds: 20, window: '1920x1080', out: null, scenario: 'perf', town: null, rival: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--budget') o.budget = Number(v());
    else if (a === '--warmup') o.warmup = Number(v());
    else if (a === '--seconds') o.seconds = Number(v());
    else if (a === '--window') o.window = v();
    else if (a === '--out') o.out = v();
    else if (a === '--scenario') o.scenario = v();
    else if (a === '--town' || a === '--rival') o[a.slice(2)] = Number(v());
    else throw new Error(`unknown argument ${a}`);
  }
  for (const k of ['budget', 'seconds']) if (!(o[k] > 0)) throw new Error(`--${k} must be a positive number`);
  if (!(o.warmup >= 0)) throw new Error('--warmup must be 0 or more');
  for (const k of ['town', 'rival']) if (o[k] !== null && !(Number.isInteger(o[k]) && o[k] >= 0)) throw new Error(`--${k} must be a whole number`);
  const m = /^(\d+)x(\d+)$/.exec(o.window);
  if (!m) throw new Error(`--window must be WxH, got ${o.window}`);
  if (!/^[\w-]+$/.test(o.scenario)) throw new Error(`--scenario must be a scenario file name, got ${o.scenario}`);
  o.width = Number(m[1]);
  o.height = Number(m[2]);
  return o;
}

function outDir(o) {
  if (o.out) return path.resolve(o.out);
  const base = path.basename(process.cwd());
  const d = `D:/screenshots/Expedition/${base}/perf`;
  try {
    fs.mkdirSync(d, { recursive: true });
    const probe = path.join(d, `.probe-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return d;
  } catch {
    const fallback = path.resolve('.tmp/screenshots', base, 'perf');
    console.warn(`[perf-check] D: drive missing or not writable; output goes to ${fallback}`);
    return fallback;
  }
}

/** Nearest-rank percentile of a numeric list (p in 0..100). */
function pct(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/**
 * Records rAF frames for `ms` in the page. Returns { gaps, late, start, end }: gaps between consecutive rAF
 * timestamps (the frame times the budget applies to), and gaps between the moments the callbacks
 * actually ran (performance.now()). Chrome stamps each rAF with its vsync time, so a main thread that
 * overruns a frame can still show even timestamps while the callbacks run late; `late` shows that.
 * start and end are the first and last rAF timestamps (performance.now() time base).
 */
async function rafGaps(page, ms) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const ts = [], at = [];
    const diffs = (l) => l.slice(1).map((v, i) => v - l[i]);
    const loop = (t) => {
      ts.push(t);
      at.push(performance.now());
      if (t - ts[0] < ms) requestAnimationFrame(loop);
      else resolve({ gaps: diffs(ts), late: diffs(at), start: ts[0], end: ts[ts.length - 1] });
    };
    requestAnimationFrame(loop);
  }), ms);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!process.env.CHROME_PLACE) process.env.CHROME_PLACE = 'offscreen';
  const out = outDir(o);
  fs.mkdirSync(path.join(out, 'perf-check'), { recursive: true });
  const buildDir = path.resolve('.tmp/perf-check', String(process.pid));
  const result = { ok: false, budgetMs: o.budget, window: { width: o.width, height: o.height }, warmupS: o.warmup, recordS: o.seconds, error: null, consoleErrors: [], pageErrors: [] };
  let server = null, browser = null;
  try {
    await build({ root: process.cwd(), logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } });
    server = await serveStatic(buildDir);
    browser = await launchPlacedChrome({ args: ['--mute-audio'], purpose: 'perf-check' });
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => result.pageErrors.push(String(e?.stack || e)));

    // ---- display refresh rate, from rAF in an empty page
    await page.setContent('<!doctype html><title>refresh</title><body style="margin:0;background:#000"></body>');
    await rafGaps(page, 500); // settle
    const empty = (await rafGaps(page, 3000)).gaps;
    const refreshMs = pct(empty, 50);
    result.display = { refreshHz: r2(1000 / refreshMs), frameMs: r2(refreshMs), samples: empty.length, p95Ms: r2(pct(empty, 95)) };
    console.log(`[perf-check] display: ${result.display.refreshHz} Hz from rAF in an empty page (median gap ${result.display.frameMs} ms over ${empty.length} frames)`);

    // ---- the scene
    const t0 = Date.now();
    const sizes = ['town', 'rival'].filter((k) => o[k] !== null).map((k) => `&${k}=${o[k]}`).join('');
    await page.goto(`${server.url}?scenario=${o.scenario}&seed=1${sizes}`);
    result.scenario = o.scenario;
    await page.waitForFunction(() => window.__perf?.ready === true || window.__scenario?.error, null, { timeout: 180000, polling: 100 });
    const scen = await page.evaluate(() => ({ error: window.__scenario?.error, asserts: window.__scenario?.asserts, logs: window.__scenario?.logs, view: window.__scenario?.view, dpr: devicePixelRatio, inner: [innerWidth, innerHeight] }));
    if (scen.error) throw new Error(`perf scenario threw: ${scen.error}`);
    const failed = (scen.asserts ?? []).filter((a) => !a.ok);
    if (failed.length) throw new Error(`perf scene incomplete: ${failed.map((a) => a.msg).join('; ')}`);
    result.scene = { setupS: (Date.now() - t0) / 1000, logs: scen.logs, view: scen.view, dpr: scen.dpr, inner: scen.inner, creatureArt: await page.evaluate(() => window.__perf.creatureArt ?? 'unknown') };
    console.log(`[perf-check] creature art in the scene: ${result.scene.creatureArt}`);
    if (scen.dpr !== 1 || scen.inner[0] !== o.width || scen.inner[1] !== o.height) throw new Error(`page is ${scen.inner.join('x')} at DPR ${scen.dpr}, want ${o.width}x${o.height} at 1`);
    console.log(`[perf-check] scene ready after ${result.scene.setupS.toFixed(1)} s; view ${scen.view?.w}x${scen.view?.h} at scale ${scen.view?.scale}; warming up ${o.warmup} s`);
    await page.waitForTimeout(o.warmup * 1000);

    // ---- record
    await page.evaluate(() => window.__perf.reset());
    const before = await page.evaluate(() => ({ live: window.__game.fx.live.length, counts: { ...window.__perf.counts }, village: window.__perf.village() }));
    const { gaps, late, end } = await rafGaps(page, o.seconds * 1000);
    const rec = await page.evaluate(() => {
      const g = window.__game, M = g.systems.miracles;
      const frames = window.__perf.stop();
      const ents = [...g.world.entities.values()];
      return {
        frames,
        phases: window.__perf.phases,
        counts: { ...window.__perf.counts },
        village: window.__perf.village(),
        active: window.__perf.active(),
        watch: { ...window.__perf.watch },
        state: {
          liveFx: g.fx.live.length,
          rains: M.effects.rains.length,
          burning: ents.filter((e) => e.burning > 0).map((e) => `${e.kind}:${e.type ?? e.species ?? ''}`),
          villagers: ents.filter((e) => e.kind === 'villager' && e.owner === 'player').length,
          entities: ents.length,
          running: g.running,
        },
      };
    });
    await page.screenshot({ path: path.join(out, 'perf-check', 'scene.png') });
    result.screenshot = path.join(out, 'perf-check', 'scene.png');

    // ---- numbers
    const over = gaps.filter((g) => g > o.budget).length;
    result.frames = {
      count: gaps.length,
      medianMs: r2(pct(gaps, 50)), p95Ms: r2(pct(gaps, 95)), p99Ms: r2(pct(gaps, 99)), maxMs: r2(Math.max(...gaps)), meanMs: r2(mean(gaps)),
      fps: r2(1000 / mean(gaps)), overBudget: over, overBudgetPct: r2((100 * over) / gaps.length),
      callbackGaps: { medianMs: r2(pct(late, 50)), p95Ms: r2(pct(late, 95)), p99Ms: r2(pct(late, 99)), maxMs: r2(Math.max(...late)), overBudget: late.filter((g) => g > o.budget).length },
    };
    const stats = (fr) => {
      const col = (k) => fr.map((f) => f[k]).filter((v) => typeof v === 'number');
      const phase = (k) => ({ medianMs: r2(pct(col(k), 50)), meanMs: r2(mean(col(k))), p95Ms: r2(pct(col(k), 95)), maxMs: r2(Math.max(...col(k))) });
      return {
        frames: fr.length,
        frame: phase('frame'),
        ticks: phase('ticks'),
        ticksPerFrame: r2(mean(col('tickCount'))),
        render: phase('render'),
        phases: Object.fromEntries(rec.phases.map((k) => [k, phase(k)])),
      };
    };
    // all frames, and the frames that ran at least one sim tick (effects change only on ticks, so
    // these also redraw every effect)
    result.work = { ...stats(rec.frames), tickFrames: stats(rec.frames.filter((f) => f.tickCount > 0)) };
    result.scene.during = { castsInWindow: Object.fromEntries(Object.keys(rec.counts).map((k) => [k, rec.counts[k] - (before.counts[k] ?? 0)])), liveFxAtStart: before.live, ...rec.state };
    // ---- end-of-window check: still a full village with all four miracles alive
    const s0 = before.village, s1 = rec.village, LAST = 2000;
    const gapsLast = Object.fromEntries(Object.entries(rec.watch.inactive).map(([m, l]) => [m, l.filter((at) => at >= end - LAST && at <= end).length]));
    const fails = [];
    if (!(s1.houses >= s0.houses - 1)) fails.push(`player houses standing ${s1.houses}, want >= ${s0.houses - 1} (start ${s0.houses} - 1)`);
    if (!(s1.villagers >= 0.8 * s0.villagers)) fails.push(`player villagers ${s1.villagers}, want >= ${(0.8 * s0.villagers).toFixed(1)} (80% of ${s0.villagers})`);
    for (const [m, n] of Object.entries(gapsLast)) if (n > 0) fails.push(`${m} effect not alive on ${n} ticks of the last 2 s`);
    result.endCheck = { ok: fails.length === 0, fails, start: s0, end: s1, minHousesInWindow: rec.watch.minHouses, minVillagersInWindow: rec.watch.minVillagers, burningPerTick: { min: rec.watch.burning.min, mean: r2(rec.watch.burning.sum / rec.watch.burning.ticks), max: rec.watch.burning.max }, litPerFireCast: rec.watch.fireCasts, inactiveTicksLast2s: gapsLast, inactiveTicksInWindow: Object.fromEntries(Object.entries(rec.watch.inactive).map(([m, l]) => [m, l.length])), activeAtEnd: rec.active };
    result.ok = result.frames.p95Ms <= o.budget && result.consoleErrors.length === 0 && result.pageErrors.length === 0 && rec.state.running && result.endCheck.ok;
    if (!rec.state.running) result.error = 'the real-time loop was not running at the end of the window';
    else if (!result.endCheck.ok) result.error = `end-of-window check failed: ${fails.join('; ')}`;
  } catch (err) {
    result.error = String(err?.stack || err);
    result.ok = false;
  } finally {
    if (browser) await browser.close().catch((e) => console.warn(`[perf-check] browser close: ${e.message}`));
    if (server) await server.close();
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(out, 'perf.json'), JSON.stringify(result, null, 2));

  if (result.frames) {
    const f = result.frames, w = result.work;
    console.log(`[perf-check] ${f.count} frames in ${o.seconds} s (${f.fps} fps): median ${f.medianMs} ms, p95 ${f.p95Ms} ms, p99 ${f.p99Ms} ms, max ${f.maxMs} ms; ${f.overBudget} frames (${f.overBudgetPct}%) over ${o.budget} ms`);
    console.log(`[perf-check] game.frame work, median per frame: total ${w.frame.medianMs} ms (p95 ${w.frame.p95Ms}), sim ticks ${w.ticks.medianMs} ms (${w.ticksPerFrame} ticks/frame), render ${w.render.medianMs} ms`);
    console.log(`[perf-check] rAF callbacks ran ${f.callbackGaps.medianMs} ms apart at the median, p95 ${f.callbackGaps.p95Ms} ms, max ${f.callbackGaps.maxMs} ms; ${f.callbackGaps.overBudget} over ${o.budget} ms`);
    console.log(`[perf-check] render phases, median (mean) ms: ${Object.entries(w.phases).map(([k, v]) => `${k} ${v.medianMs} (${v.meanMs})`).join(', ')}`);
    const tf = w.tickFrames;
    console.log(`[perf-check] ${tf.frames} frames with sim ticks: work median ${tf.frame.medianMs} ms, p95 ${tf.frame.p95Ms} ms, max ${tf.frame.maxMs} ms; ticks median ${tf.ticks.medianMs} ms, render median ${tf.render.medianMs} ms (fx back ${tf.phases.fxBack.medianMs}, fx front ${tf.phases.fxFront.medianMs})`);
    const d = result.scene.during;
    const e = result.endCheck;
    console.log(`[perf-check] village at window start / end: ${e.start.houses} / ${e.end.houses} houses standing (fewest on any tick ${e.minHousesInWindow}), ${e.start.buildings} / ${e.end.buildings} buildings, ${e.start.villagers} / ${e.end.villagers} villagers (fewest ${e.minVillagersInWindow}); ticks with an effect not alive, last 2 s: ${JSON.stringify(e.inactiveTicksLast2s)}, whole window: ${JSON.stringify(e.inactiveTicksInWindow)}; end-of-window check ${e.ok ? 'PASS' : 'FAIL'}`);
    console.log(`[perf-check] during the window: casts ${JSON.stringify(d.castsInWindow)}; entities burning per tick min / mean / max ${e.burningPerTick.min} / ${e.burningPerTick.mean} / ${e.burningPerTick.max}, set alight per fire cast ${JSON.stringify(e.litPerFireCast)}; ${d.liveFx} live effects at the end, ${d.rains} rain, ${d.burning.length} burning (${d.burning.join(', ')}), ${d.villagers} player villagers`);
  }
  for (const e of [...result.consoleErrors, ...result.pageErrors]) console.log(`  ERROR ${e}`);
  if (result.error) console.log(`  ERROR ${result.error}`);
  console.log(`[perf-check] perf.json in ${out}`);
  console.log(result.ok ? `[perf-check] PASS (p95 ${result.frames.p95Ms} ms <= ${o.budget} ms)` : `[perf-check] FAIL${result.frames ? ` (p95 ${result.frames.p95Ms} ms, budget ${o.budget} ms${result.endCheck?.ok === false ? '; end-of-window check failed' : ''})` : ''}`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(`[perf-check] ${err?.stack || err}`);
  process.exitCode = 1;
});
