// Ballistic flight in world units: x, y in tiles, z in height units, gravity in height units/s^2.
// Each step uses the exact constant-gravity update (z += vz*dt - g*dt^2/2), so the arc does not
// depend on the step size. When a step ends at or under the terrain, the contact point inside the
// step is found by bisection on the time fraction, so landing spots and speeds are exact to well
// under a pixel. Pure functions: no game state, no DOM.

/**
 * Advances body b = { x, y, z, vx, vy, vz } by up to dt seconds over terrain heightAt(x, y).
 * Bounds { w, h } keep it on the map (hitting the edge stops horizontal motion).
 * Returns null when the whole step stays in the air, otherwise { left } (seconds of the step not
 * used) after moving b onto the contact point, with z set to the terrain height and vz the speed
 * at contact.
 */
export function stepBody(b, dt, heightAt, g, bounds) {
  const w = bounds?.w ?? Infinity, h = bounds?.h ?? Infinity;
  const ex = b.x + b.vx * dt, ey = b.y + b.vy * dt;
  if (ex < 0.001 || ex > w - 0.001) b.vx = 0;
  if (ey < 0.001 || ey > h - 0.001) b.vy = 0;
  const at = (s) => {
    const t = dt * s;
    return { x: b.x + b.vx * t, y: b.y + b.vy * t, z: b.z + b.vz * t - 0.5 * g * t * t };
  };
  const gap = (s) => { const p = at(s); return p.z - heightAt(p.x, p.y); };
  if (gap(1) > 0) {
    const p = at(1);
    b.x = p.x; b.y = p.y; b.z = p.z; b.vz -= g * dt;
    return null;
  }
  let s = 0;
  if (gap(0) > 0) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) > 0) lo = mid; else hi = mid;
    }
    s = hi;
  }
  const p = at(s);
  b.x = p.x; b.y = p.y; b.z = heightAt(p.x, p.y); b.vz -= g * dt * s;
  return { left: dt * (1 - s) };
}

/** Highest z of a body launched at z0 with vertical speed vz (closed form). */
export function apexHeight(z0, vz, g) {
  return vz > 0 ? z0 + (vz * vz) / (2 * g) : z0;
}

/** Horizontal distance flown before landing on flat ground at height zg (closed form). */
export function flatRange(z0, zg, vh, vz, g) {
  const t = (vz + Math.sqrt(vz * vz + 2 * g * (z0 - zg))) / g;
  return vh * t;
}

/**
 * Where a body launched from (x, y, z) with (vx, vy, vz) first touches the terrain:
 * { x, y, z, t, speed } or null if it is still flying after maxT seconds. Same integration as the
 * hand uses, so a UI aim preview or a test can ask it ahead of time.
 */
export function predictLanding(x, y, z, vx, vy, vz, heightAt, g, bounds, { dt = 1 / 30, maxT = 10 } = {}) {
  const b = { x, y, z, vx, vy, vz };
  for (let t = 0; t < maxT; t += dt) {
    const c = stepBody(b, dt, heightAt, g, bounds);
    if (c) return { x: b.x, y: b.y, z: b.z, t: t + dt - c.left, speed: Math.hypot(b.vx, b.vy, b.vz) };
  }
  return null;
}
