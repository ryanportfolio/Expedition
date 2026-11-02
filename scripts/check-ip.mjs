// Name gate: fails when a banned name from the spec's IP rule appears in the repo.
//
//   node scripts/check-ip.mjs [--extra <path>]...
//
// Two passes:
//   (a) repo-wide, case-sensitive, whole words: every file under the repo root except node_modules,
//       .tmp, .git, dist, build and .playwright-mcp (at any depth) and .claude/worktrees (other
//       sessions' worktrees when run from a main checkout); symlinked folders are not followed;
//   (b) case-insensitive over game content only (src, scripts, docs, index.html, README.md, and any
//       --extra path): every name except the four-letter one matches anywhere inside a word
//       (plurals and compounds count); in the two-colour name the "&" or "and" is optional and any
//       run of spaces, hyphens or slashes may sit on either side of it; the four-letter name
//       matches only as a whole word, so ordinary words that contain it pass.
// File paths are checked as well as file contents. A file that starts with a UTF-16 byte order mark
// is decoded as UTF-16; any other file containing a NUL byte is skipped as binary and counted in the
// summary. `--extra <path>` (file or folder, repeatable) adds paths to both
// passes even inside an excluded folder; it exists to prove the gate fails on a planted file.
// Prints each hit as path:line and exits 1 on any hit, 2 on a usage error, 0 when clean.
//
// The banned names are assembled from pieces so this file does not contain them itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.tmp', '.git', 'dist', 'build', '.playwright-mcp']);
// Skipped only at this path from the repo root: other app sessions' worktrees in a main checkout.
const SKIP_PATHS = new Set([path.join(ROOT, '.claude', 'worktrees')]);
const CONTENT = ['src', 'scripts', 'docs', 'index.html', 'README.md'];

const j = (...parts) => parts.join('');
const STRICT = [j('Black', ' & ', 'White'), j('Black', ' and ', 'White'), j('Lion', 'head'), j('Ed', 'en'), j('Kha', 'zar')];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole word: no letter, digit or underscore directly before or after the name.
const wordRe = (term, flags) => new RegExp(`(?<![A-Za-z0-9_])${escape(term)}(?![A-Za-z0-9_])`, flags);
const STRICT_RE = STRICT.map((t) => ({ term: t, re: wordRe(t, '') }));
const LOOSE_RE = [
  { term: j('black', ' [&|and|-|/] ', 'white'), re: new RegExp(j('black', '[\\s\\-/]*(&|and)?[\\s\\-/]*', 'white'), 'i') },
  { term: j('lion', 'head'), re: new RegExp(j('lion', 'head'), 'i') },
  { term: j('kha', 'zar'), re: new RegExp(j('kha', 'zar'), 'i') },
  { term: j('ed', 'en'), re: wordRe(j('ed', 'en'), 'i') },
];

function parseArgs(argv) {
  const extra = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--extra') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--extra needs a path');
      extra.push(path.resolve(v));
    } else throw new Error(`unknown argument ${argv[i]}`);
  }
  return { extra };
}

/** Every file under `p` (a file or folder). Excluded folder names are skipped below the start path. */
function* walk(p, skip = true) {
  let st;
  try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) { yield p; return; }
  if (!st.isDirectory()) return;
  for (const d of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, d.name);
    if (skip && d.isDirectory() && (SKIP_DIRS.has(d.name) || SKIP_PATHS.has(child))) continue;
    yield* walk(child, skip);
  }
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/') || f;
const hits = new Map(); // "path:line:term" -> line
let scanned = 0, binary = 0;

function scan(file, rules) {
  const name = rel(file);
  for (const { term, re } of rules) if (re.test(name)) hits.set(`${name}:0:${term}`, `${term} (in the file path)`);
  let buf;
  try { buf = fs.readFileSync(file); } catch (err) { console.error(`check-ip: cannot read ${name}: ${err.message}`); process.exitCode = 2; return; }
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2))).swap16().toString('utf16le');
  else if (buf.includes(0)) { binary++; return; }
  else text = buf.toString('utf8');
  scanned++;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { term, re } of rules) {
      if (re.test(lines[i])) hits.set(`${name}:${i + 1}:${term}`, `${term}: ${lines[i].trim().slice(0, 160)}`);
    }
  }
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`check-ip: ${err.message}`);
  process.exit(2);
}
for (const p of args.extra) {
  if (!fs.existsSync(p)) { console.error(`check-ip: --extra path not found: ${p}`); process.exit(2); }
}

const strictFiles = new Set(walk(ROOT));
const looseFiles = new Set();
for (const c of CONTENT) for (const f of walk(path.join(ROOT, c))) looseFiles.add(f);
for (const p of args.extra) for (const f of walk(p, false)) { strictFiles.add(f); looseFiles.add(f); }

for (const f of strictFiles) scan(f, looseFiles.has(f) ? [...STRICT_RE, ...LOOSE_RE] : STRICT_RE);
for (const f of looseFiles) if (!strictFiles.has(f)) scan(f, LOOSE_RE);

// one line per path:line, every term found on it
const byLine = new Map();
for (const [key, text] of hits) {
  const at = key.slice(0, key.lastIndexOf(':'));
  if (!byLine.has(at)) byLine.set(at, text);
}
for (const [at, text] of byLine) console.log(`${at}: ${text}`);
console.log(`check-ip: ${scanned} files scanned (${looseFiles.size} game-content files case-insensitive), ${binary} binary skipped, ${byLine.size} hit line(s)`);
if (byLine.size) process.exitCode = 1;
