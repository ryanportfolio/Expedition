// Event-to-sound map. Pure: turns one game event into a sound request candidate, or null when the
// event makes no sound. Runs on the sim side (inside event listeners), touches no DOM.
//
// Candidate: { sound, gain, intensity, x, y, z, positional, event }. positional = false means the
// sound is heard at full volume wherever the camera is (village conversion).
import { AUDIO } from './config.js';
import { SOUNDS } from './sounds.js';

/** Event types the audio system listens to. */
export const AUDIO_EVENTS = [
  'grab', 'release', 'landed', 'stroke', 'slap', 'miracle-cast',
  'building-placed', 'building-complete', 'villager-died', 'village-converted',
];

const clamp01 = (v) => Math.min(Math.max(Number.isFinite(v) ? v : 0, 0), 1);
const speedK = (s) => clamp01(s / AUDIO.fullSpeed);

/** World position for a payload: explicit x/y wins, else the entity with id `id`. */
function where(world, p, id) {
  if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
    return { x: p.x, y: p.y, z: Number.isFinite(p.z) ? p.z : world.heightAt(p.x, p.y) };
  }
  const e = id !== undefined ? world.get(id) : null;
  if (e) return { x: e.x, y: e.y, z: e.z ?? world.heightAt(e.x, e.y) };
  return null;
}

/** True when (x, y) is over water: tile height at or under sea level. Off the map counts as water. */
export function isWater(world, x, y) {
  const t = world.tile(Math.floor(x), Math.floor(y));
  return !t || t.height <= world.seaLevel;
}

function req(sound, gain, intensity, pos, event) {
  return {
    sound, gain, intensity, event,
    positional: !!pos,
    x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0,
  };
}

/** One event -> candidate or null. `world` resolves entity ids to positions and water. */
export function mapEvent(type, p = {}, world) {
  p = p ?? {};
  switch (type) {
    case 'grab':
      return req('grab', 0.7, 0.5, where(world, p, p.entityId), type);
    case 'release': {
      const k = speedK(Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0));
      if (k < 0.05) return null; // a gentle drop makes no whoosh
      return req('release', 0.4 + 0.6 * k, k, where(world, p, p.entityId), type);
    }
    case 'landed': {
      const k = speedK(p.speed);
      if (k < 0.04) return null; // settling bumps stay quiet
      const pos = where(world, p, p.entityId);
      const wet = typeof p.water === 'boolean' ? p.water : !!pos && isWater(world, pos.x, pos.y);
      return req(wet ? 'splash' : 'landed', 0.35 + 0.65 * k, k, pos, type);
    }
    case 'stroke':
    case 'slap': {
      const k = clamp01(p.strength ?? 0.5);
      return req(type, 0.5 + 0.5 * k, k, where(world, p, p.creatureId), type);
    }
    case 'miracle-cast': {
      const sound = `miracle-${p.miracle}`;
      if (!SOUNDS[sound]) return null;
      return req(sound, 1, 1, where(world, p), type);
    }
    case 'building-placed':
    case 'building-complete':
      return req(type, 0.8, 0.5, where(world, p, p.buildingId), type);
    case 'villager-died':
      return req(type, 0.6, 0.5, where(world, p, p.id), type);
    case 'village-converted':
      return req(type, 0.9, 1, null, type);
    default:
      return null;
  }
}
