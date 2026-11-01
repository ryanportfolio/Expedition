// Runs every browser scenario (src/dev/scenarios/*.js) through scripts/browser-check.mjs, one at a
// time, and prints a summary.
//
//   node scripts/run-browser-checks.mjs [--only <name>,<name>...]
//
// Scenarios are found by file name, so a new scenario runs without editing this file. Each run
// builds, serves and opens headed Chrome off screen and muted (see browser-check.mjs), and closes
// Chrome and its server before the next starts. `--only` runs just the named scenarios, in the
// order given; an unknown name is a usage error. Exits 1 when any scenario fails or none is found,
// 2 on a usage error, else 0.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src', 'dev', 'scenarios');

function usage(msg) {
  console.error(`run-browser-checks: ${msg}`);
  process.exit(2);
}

const all = fs.readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isFile() && /^[\w-]+\.js$/.test(d.name))
  .map((d) => d.name.slice(0, -3))
  .sort();

let picked = all;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only') {
    const v = argv[++i];
    if (!v) usage('--only needs a comma-separated list of scenario names');
    picked = [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
    const unknown = picked.filter((n) => !all.includes(n));
    if (unknown.length) usage(`unknown scenario(s): ${unknown.join(', ')}; available: ${all.join(', ')}`);
    if (!picked.length) usage('--only needs at least one scenario name');
  } else usage(`unknown argument ${argv[i]}`);
}

if (!picked.length) {
  console.error('run-browser-checks: no scenarios found in src/dev/scenarios/');
  process.exit(1);
}

const results = [];
for (const name of picked) {
  console.log(`\n=== ${name}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join('scripts', 'browser-check.mjs'), '--scenario', name], { cwd: ROOT, stdio: 'inherit' });
  const code = r.error ? `error: ${r.error.message}` : r.status ?? `signal ${r.signal}`;
  results.push({ name, ok: r.status === 0, code, secs: (Date.now() - t0) / 1000 });
}

const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.name.length));
console.log('\n=== summary');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.secs.toFixed(1).padStart(6)} s${r.ok ? '' : `  (exit ${r.code})`}`);
console.log(`${results.length - failed.length}/${results.length} browser scenarios passed${failed.length ? `; failed: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exitCode = failed.length ? 1 : 0;
