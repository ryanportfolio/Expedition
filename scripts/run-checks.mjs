// Runs every node check (scripts/check-*.mjs) one after another and prints a summary.
//
//   node scripts/run-checks.mjs
//
// Checks are found by file name, so a new scripts/check-<area>.mjs runs without editing this file.
// Browser checks are not node checks and are left out (scripts/browser-check.mjs does not match the
// pattern; run them with scripts/run-browser-checks.mjs). Each check runs from the repo root with its
// output passed through. Exits 1 when any check fails or none is found, else 0.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');

if (process.argv.length > 2) {
  console.error(`run-checks: unknown argument ${process.argv[2]} (this runner takes none)`);
  process.exit(2);
}

const checks = fs.readdirSync(SCRIPTS, { withFileTypes: true })
  .filter((d) => d.isFile() && /^check-[\w-]+\.mjs$/.test(d.name))
  .map((d) => d.name)
  .sort();

if (!checks.length) {
  console.error('run-checks: no scripts/check-*.mjs found');
  process.exit(1);
}

const results = [];
for (const name of checks) {
  console.log(`\n=== ${name}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join('scripts', name)], { cwd: ROOT, stdio: 'inherit' });
  const code = r.error ? `error: ${r.error.message}` : r.status ?? `signal ${r.signal}`;
  results.push({ name, ok: r.status === 0, code, secs: (Date.now() - t0) / 1000 });
}

const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.name.length));
console.log('\n=== summary');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.secs.toFixed(1).padStart(5)} s${r.ok ? '' : `  (exit ${r.code})`}`);
console.log(`${results.length - failed.length}/${results.length} node checks passed${failed.length ? `; failed: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exitCode = failed.length ? 1 : 0;
