// Sprite registry: named painter functions, memoized results.
//
// A painter module looks like:
//   export const sprites = { 'tree-oak': (opts) => Sprite, ... };
//   export const previews = { 'tree-oak': [{ size: 1 }, { size: 2 }] };   // optional
// In the browser (Vite) every file in ./painters/ is registered automatically. In node, import
// the painter modules yourself and pass each to registerPainters().
//
// getSprite(name, opts) paints once per name + opts and returns the same object afterwards, so
// callers must treat returned sprites as read-only. Unknown names, and painters that throw,
// get a shared 8x8 checker placeholder and one console message per name; getSprite never throws.
//
// Painters may call getSprite at paint time (to compose sprites) but must not call it at module
// top level: the eager glob below imports painters before this module finishes evaluating.

import { createSprite } from './sprite.js';
import { idx } from './palette.js';

const painters = new Map();
const previewMap = new Map();
const cache = new Map();
const warned = new Set();
let placeholder = null;

/** JSON-like serialization with sorted object keys, so { a, b } and { b, a } share a cache key. */
export function stableKey(value) {
  if (value === undefined) return 'u';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableKey(value[k])}`).join(',')}}`;
}

/** Registers every painter in a module object ({ sprites, previews? }). Re-registering a name
 * replaces its painter and drops its cached sprites (Vite hot reload, tests). */
export function registerPainters(mod) {
  const sprites = mod?.sprites ?? {};
  for (const [name, fn] of Object.entries(sprites)) {
    if (typeof fn !== 'function') continue;
    painters.set(name, fn);
    warned.delete(name);
    for (const key of cache.keys()) if (key.startsWith(`${name}|`)) cache.delete(key);
  }
  for (const [name, list] of Object.entries(mod?.previews ?? {})) {
    if (Array.isArray(list)) previewMap.set(name, list);
  }
}

/** The shared 8x8 checker returned for unknown names: ink black and the fire ramp's pinkest red. */
export function placeholderSprite() {
  if (!placeholder) {
    placeholder = createSprite(8, 8, 4, 7);
    const dark = idx('ink', 0), hot = idx('fire', 1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) placeholder.data[y * 8 + x] = ((x >> 1) + (y >> 1)) & 1 ? dark : hot;
  }
  return placeholder;
}

function warnOnce(name, message, error) {
  if (warned.has(name)) return;
  warned.add(name);
  if (error) console.error(message, error);
  else console.warn(message);
}

export function getSprite(name, opts = {}) {
  const key = `${name}|${stableKey(opts ?? {})}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const painter = painters.get(name);
  if (!painter) {
    warnOnce(name, `art registry: unknown sprite "${name}", drawing placeholder`);
    return placeholderSprite();
  }
  let sprite;
  try {
    sprite = painter(opts ?? {});
    if (!sprite || !(sprite.data instanceof Uint8Array) || sprite.data.length !== sprite.w * sprite.h) {
      throw new Error('painter did not return a valid Sprite { w, h, ax, ay, data: Uint8Array(w*h) }');
    }
  } catch (err) {
    warnOnce(name, `art registry: painter "${name}" failed, drawing placeholder`, err);
    return placeholderSprite();
  }
  cache.set(key, sprite);
  return sprite;
}

/** Registered sprite names, in registration order. */
export function listSprites() {
  return [...painters.keys()];
}

/** Preview option sets a painter module declared for a name ([] when none). */
export function previewsFor(name) {
  return previewMap.get(name) ?? [];
}

// Browser auto-registration. Vite replaces the import.meta.glob call with an object of the
// eagerly imported modules at build time. In node, import.meta.glob is undefined, the call
// throws a TypeError and nothing is registered here (node callers use registerPainters).
let globbed = {};
try {
  globbed = import.meta.glob('./painters/*.js', { eager: true });
} catch {
  globbed = {};
}
for (const mod of Object.values(globbed)) registerPainters(mod);
