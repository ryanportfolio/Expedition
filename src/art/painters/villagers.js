// Villager painter: `villager { job, pose, frame, facing, owner, glow }`, about 10 px tall standing.
//
// A villager is assembled from parts on a small grid: head (3 x 3), torso (3 wide, belt, hem),
// legs from a per-pose set, and two arms drawn as 1 px lines from the shoulders to per-frame hand
// points, so every pose is a short table of hand positions instead of a hand-drawn frame. The
// figure is drawn facing se (screen down-right); ne turns the head (back of the head, no face);
// sw and nw are mirrors. The back arm (screen left) is drawn behind the torso, the front arm and
// the job's tool in front of it. The body gets an ink outline; tools are drawn after the outline
// so a 1 px handle stays 1 px.
//
// Jobs read at a glance by tool and dress: farmer = straw hat + hoe, forester = rolled sleeves
// + axe, miner = dark cap + pick, builder = leather apron + mallet, worshipper = pale hood and long
// robe, breeder = rose headscarf, idle = plain.
// `glow` (a job set by the hand, step 4 of docs/gameplay-spec.md): the outline is drawn in the job's
// colour (JOB_GLOW) instead of ink. Every glow ramp is one that does not shift with alignment, so a
// job's colour reads the same in a good and an evil town.
// Cloth uses `cloth-player` or `cloth-rival` (owner); everything else uses ramps that do not
// shift with alignment except the player's cloth, so the rival never changes with the player.
//
// Carry pose: both hands up at head height. The carried log or sack is its own entity, drawn by
// the village system just above the carrier's head, so the villager sprite never draws the load.

import { idx } from '../palette.js';
import { createSprite, line, mirror, outline, px, trim } from '../sprite.js';

const JOBS = ['farmer', 'forester', 'miner', 'builder', 'worshipper', 'breeder', 'idle'];

/** Outline colour [ramp, shade] of a villager whose job the hand set, by job. */
export const JOB_GLOW = Object.freeze({
  farmer: ['fire', 5], forester: ['heal', 4], miner: ['lightning', 3], builder: ['fire', 3], worshipper: ['lightning', 5], breeder: ['rose', 5],
});
const POSES = ['idle', 'walk', 'work', 'carry', 'pray', 'flee', 'dead'];
const FACINGS = ['se', 'sw', 'ne', 'nw'];

// Canvas: body grid (0, 0) = top-left of the head row when standing; feet on row 9.
const CW = 26, CH = 26, OX = 10, OY = 10;

// ---- body parts ------------------------------------------------------------------------------

// Head rows, x 3..5. se shows the face on the right (facing side), ne the back of the head.
const HEAD = {
  se: [['h', 'h', 'h'], ['h', 's', 's'], ['H', 's', 'z']],
  ne: [['h', 'h', 'h'], ['h', 'h', 'H'], ['H', 'z', 'H']],
};
// Torso rows 3..6, x 3..5: tunic lit on the left, belt, hem.
const TORSO = [['c5', 'c4', 'c3'], ['c5', 'c4', 'c3'], ['b', 'b', 'b'], ['c4', 'c3', 'c2']];

// Leg sets: [x, y, tag] with N = near (front) leg, F = far leg, f = foot.
const LEGS = {
  stand: [[3, 7, 'F'], [3, 8, 'F'], [5, 7, 'N'], [5, 8, 'N'], [3, 9, 'f'], [5, 9, 'f'], [6, 9, 'f']],
  walk: [
    // contact, near leg forward
    [[3, 7, 'F'], [2, 8, 'F'], [5, 7, 'N'], [6, 8, 'N'], [2, 9, 'f'], [6, 9, 'f'], [7, 9, 'f']],
    // passing, near leg planted, far foot lifted
    [[4, 7, 'F'], [3, 8, 'F'], [5, 7, 'N'], [5, 8, 'N'], [3, 9, 'f'], [5, 9, 'f'], [6, 9, 'f']],
    // contact, far leg forward
    [[3, 7, 'N'], [2, 8, 'N'], [5, 7, 'F'], [6, 8, 'F'], [2, 9, 'f'], [6, 9, 'f'], [7, 9, 'f']],
    // passing, far leg planted, near foot lifted
    [[3, 7, 'F'], [3, 8, 'F'], [4, 7, 'N'], [5, 8, 'N'], [3, 9, 'f'], [4, 9, 'f'], [6, 8, 'f']],
  ],
  run: [
    [[3, 7, 'F'], [2, 8, 'F'], [1, 8, 'f'], [5, 7, 'N'], [6, 8, 'N'], [7, 9, 'f'], [8, 9, 'f']],
    [[4, 7, 'F'], [3, 8, 'F'], [2, 8, 'f'], [5, 7, 'N'], [5, 8, 'N'], [5, 9, 'f'], [6, 9, 'f']],
    [[3, 7, 'N'], [2, 8, 'N'], [1, 8, 'f'], [5, 7, 'F'], [6, 8, 'F'], [7, 9, 'f'], [8, 9, 'f']],
    [[4, 7, 'N'], [3, 8, 'N'], [2, 8, 'f'], [5, 7, 'F'], [5, 8, 'F'], [5, 9, 'f'], [6, 9, 'f']],
  ],
  // Kneeling (body lowered 2): shins flat behind, near knee forward under the hem.
  kneel: [[1, 9, 'f'], [2, 9, 'F'], [3, 9, 'F'], [4, 9, 'N'], [5, 9, 'N'], [6, 9, 'N'], [6, 8, 'N']],
};

// ---- poses -----------------------------------------------------------------------------------
// Each frame: { legs, dy (body drop), lean (head shift), back: [x, y] hand, front: [x, y] hand,
// grip: tool grip point, angle (deg, 0 = right, 90 = up), toolLen }.
// Hands are in body grid coordinates before dy is applied; shoulders sit at (2, 3) and (6, 3).

const standHands = { back: [2, 5], front: [6, 5] };

function walkFrame(f) {
  return {
    legs: LEGS.walk[f],
    back: [[3, 5], [2, 5], [1, 5], [2, 5]][f],
    front: [[5, 5], [6, 5], [7, 5], [6, 5]][f],
    dy: f % 2 ? 0 : 1, // contact frames sink a pixel (legs spread), passing frames stand tall
  };
}

// Tool held while standing or walking, by job: grip and angle relative to the body.
const HOLD = {
  farmer: { idle: { front: [6, 5], grip: [6, 5], angle: 90, len: 9 }, walk: { front: [7, 4], grip: [7, 4], angle: 80, len: 9 } },
  forester: { idle: { front: [6, 5], grip: [6, 5], angle: -75, len: 4 }, walk: { front: [6, 5], grip: [6, 5], angle: -65, len: 4 } },
  miner: { idle: { front: [6, 5], grip: [6, 5], angle: -80, len: 5 }, walk: { front: [6, 4], grip: [6, 4], angle: 120, len: 5 } },
  builder: { idle: { front: [7, 3], grip: [7, 3], angle: 105, len: 4 }, walk: { front: [7, 3], grip: [7, 3], angle: 115, len: 4 } },
};

// Work swings: both hands on the handle (grip and one step down the handle).
const SWING = {
  // Overhead chop or hammer blow: wind up behind, over the top, strike forward, follow through.
  chop: [
    { grip: [3, -1], angle: 150, lean: 0 },
    { grip: [5, -2], angle: 85, lean: 0 },
    { grip: [8, 2], angle: 5, lean: 1 },
    { grip: [7, 4], angle: -50, lean: 1 },
  ],
  // Hoe: raise to the chest, lift, bite the soil ahead, drag it back.
  hoe: [
    { grip: [6, 2], angle: 115, lean: 0 },
    { grip: [7, 1], angle: 70, lean: 0 },
    { grip: [7, 4], angle: -35, lean: 1 },
    { grip: [6, 4], angle: -30, lean: 1 },
  ],
};
const TOOL = {
  farmer: { kind: 'hoe', swing: 'hoe', len: 8 },
  forester: { kind: 'axe', swing: 'chop', len: 6 },
  miner: { kind: 'pick', swing: 'chop', len: 5 },
  builder: { kind: 'mallet', swing: 'chop', len: 4 },
};

function frameSpec(job, pose, f) {
  const tool = TOOL[job];
  switch (pose) {
    case 'walk': {
      const w = walkFrame(f);
      const hold = tool && HOLD[job].walk;
      return hold ? { ...w, front: hold.front, tool: { ...tool, grip: hold.grip, angle: hold.angle, len: hold.len } } : w;
    }
    case 'carry': {
      const w = walkFrame(f);
      return { ...w, back: [2, 0], front: [6, 0], dy: (f % 2 ? 0 : 1) };
    }
    case 'flee':
      return {
        legs: LEGS.run[f], lean: 1, dy: f % 2 ? 0 : 1,
        back: [[1, -1], [1, 0], [1, -1], [2, -1]][f], front: [[7, 0], [8, -1], [7, -1], [8, 0]][f],
      };
    case 'pray':
      if (f < 2) return { legs: LEGS.kneel, dy: 2, lean: f, back: [6, 5 + f], front: [7, 5 + f] };
      return { legs: LEGS.kneel, dy: 2, lean: 0, back: [[1, 0], [1, -1]][f - 2], front: [[7, 0], [7, -1]][f - 2] };
    case 'work': {
      if (job === 'worshipper') return frameSpec(job, 'pray', f);
      const sw = SWING[tool?.swing ?? 'hoe'][f];
      const t = tool ? { ...tool, grip: sw.grip, angle: sw.angle } : null;
      // Second hand one step down the handle from the grip.
      const a = (sw.angle * Math.PI) / 180;
      const second = [Math.round(sw.grip[0] - Math.cos(a) * 2), Math.round(sw.grip[1] + Math.sin(a) * 2)];
      return { legs: f >= 2 ? LEGS.walk[0] : LEGS.stand, lean: sw.lean, back: second, front: sw.grip, tool: t };
    }
    default: {
      const hold = tool && HOLD[job].idle;
      const base = { legs: LEGS.stand, ...standHands };
      return hold ? { ...base, front: hold.front, tool: { ...tool, grip: hold.grip, angle: hold.angle, len: hold.len } } : base;
    }
  }
}

// ---- colors ----------------------------------------------------------------------------------

const HAIR = {
  farmer: ['ui-ink', 2], forester: ['ink', 1], miner: ['ink', 2], builder: ['skin', 1], worshipper: ['ui-ink', 2], breeder: ['ink', 3], idle: ['ui-ink', 3],
};

function palette(job, owner) {
  const cloth = owner === 'rival' ? 'cloth-rival' : 'cloth-player';
  const [hr, hs] = HAIR[job] ?? HAIR.idle;
  return {
    h: idx(hr, hs + 1), H: idx(hr, hs),
    s: idx('skin', 5), z: idx('skin', 3),
    c5: idx(cloth, 5), c4: idx(cloth, 4), c3: idx(cloth, 3), c2: idx(cloth, 2),
    b: idx('ui-ink', 1),
    N: idx('ui-ink', 4), F: idx('ui-ink', 2), f: idx('ui-ink', 1),
    armBack: idx(cloth, 2), armFront: idx(cloth, 4),
    handBack: idx('skin', 3), handFront: idx('skin', 5),
    // dress
    hat: idx('thatch', 6), hatS: idx('thatch', 4), hatD: idx('thatch', 3),
    cap: idx('ui-ink', 2), capS: idx('ui-ink', 1),
    scarf: idx('rose', 4), scarfS: idx('rose', 3),
    hood: idx('ui-parchment', 6), hoodS: idx('ui-parchment', 4),
    robe: idx(cloth, 3), robeS: idx(cloth, 2),
    apron: idx('ui-parchment', 3), apronS: idx('ui-parchment', 2),
    // tools
    wood: idx('bark', 4), woodS: idx('bark', 2), iron: idx('ink', 5), ironHi: idx('ink', 7), ironS: idx('ink', 3),
    malletHead: idx('bark', 5), malletS: idx('bark', 3),
  };
}

// ---- assembly --------------------------------------------------------------------------------

/** Figure as a grid map key "x,y" -> tag, before colors. Later writes win. */
function assemble(job, pose, f, facing) {
  const spec = frameSpec(job, pose, f);
  const dy = spec.dy ?? 0, lean = spec.lean ?? 0;
  const back = facing === 'ne';
  const parts = { back: [], body: [], front: [] };
  const put = (layer, x, y, tag) => parts[layer].push([x, y, tag]);

  // Back arm (behind the torso).
  armLine(parts.back, [2, 3 + dy], spec.back, 'armBack', 'handBack', dy);
  // Legs (not lowered: they reach the ground), torso and head (lowered by dy).
  for (const [x, y, t] of spec.legs) put('body', x, y, t);
  TORSO.forEach((row, r) => row.forEach((t, c) => put('body', 3 + c, 3 + r + dy, t)));
  (back ? HEAD.ne : HEAD.se).forEach((row, r) => row.forEach((t, c) => put('body', 3 + c + lean, r + dy, t)));
  // Front arm (over the torso), then the tool.
  armLine(parts.front, [6, 3 + dy], spec.front, 'armFront', 'handFront', dy);
  return { spec, parts, dy, lean };
}

function armLine(out, shoulder, hand, armTag, handTag, dy) {
  const [hx, hy0] = hand;
  const hy = hy0 + dy;
  const tmp = createSprite(40, 40);
  line(tmp, shoulder[0] + 15, shoulder[1] + 15, hx + 15, hy + 15, 1);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (tmp.data[y * 40 + x]) out.push([x - 15, y - 15, armTag]);
  out.push([hx, hy, handTag]);
}

/** Job dress applied to the assembled body parts (tags only). */
function dress(job, fig) {
  const { parts, dy, lean } = fig;
  const body = parts.body;
  const headTop = dy;
  if (job === 'farmer') {
    // Straw hat: brim over the hair row, one wider on each side; crown above.
    for (let x = 2; x <= 6; x++) body.push([x + lean, headTop, x === 6 ? 'hatD' : 'hat']);
    for (let x = 3; x <= 5; x++) body.push([x + lean, headTop - 1, x === 5 ? 'hatS' : 'hat']);
  } else if (job === 'worshipper') {
    // Hood over the head and shoulders; long robe down to the feet.
    for (const p of body) {
      if (p[2] === 'h') p[2] = 'hood';
      else if (p[2] === 'H') p[2] = 'hoodS';
    }
    body.push([2 + lean, 1 + dy, 'hoodS']);
    for (let x = 3; x <= 5; x++) body.push([x, 3 + dy, x === 5 ? 'hoodS' : 'hood']);
    const legRows = new Map();
    for (const p of body) {
      if (p[2] === 'N' || p[2] === 'F') {
        p[2] = p[2] === 'N' ? 'robe' : 'robeS';
        const r = legRows.get(p[1]) ?? [Infinity, -Infinity];
        legRows.set(p[1], [Math.min(r[0], p[0]), Math.max(r[1], p[0])]);
      }
    }
    for (const [y, [x0, x1]] of legRows) for (let x = x0 + 1; x < x1; x++) body.push([x, y, 'robe']);
  } else if (job === 'miner') {
    // Close dark cap pulled over the hair, a peak over the brow on the facing side.
    for (let x = 3; x <= 5; x++) body.push([x + lean, headTop, x === 5 ? 'capS' : 'cap']);
    body.push([6 + lean, headTop + 1, 'capS']);
  } else if (job === 'breeder') {
    // Rose headscarf over the hair, tied at the back of the head.
    for (let x = 3; x <= 5; x++) body.push([x + lean, headTop, x === 5 ? 'scarfS' : 'scarf']);
    body.push([2 + lean, headTop + 1, 'scarfS']);
  } else if (job === 'builder') {
    // Leather apron down the front of the tunic.
    body.push([4, 4 + dy, 'apron'], [4, 5 + dy, 'apron'], [5, 5 + dy, 'apronS'], [4, 6 + dy, 'apron'], [5, 6 + dy, 'apronS']);
  } else if (job === 'forester') {
    // Rolled sleeves: forearms bare.
    for (const layer of [parts.back, parts.front]) {
      layer.forEach((p, i) => {
        if (i >= 2 && p[2] === 'armBack') p[2] = 'handBack';
        if (i >= 2 && p[2] === 'armFront') p[2] = 'handFront';
      });
    }
  }
}

function drawTool(s, tool, ox, oy, dy, c) {
  const a = (tool.angle * Math.PI) / 180;
  const dx = Math.cos(a), dyv = -Math.sin(a);
  const gx = tool.grip[0] + ox, gy = tool.grip[1] + dy + oy;
  const ex = Math.round(gx + dx * tool.len), ey = Math.round(gy + dyv * tool.len);
  // Butt one pixel behind the grip, handle to the head.
  px(s, Math.round(gx - dx), Math.round(gy - dyv), c.woodS);
  line(s, gx, gy, ex, ey, c.wood);
  // Blade side: the swing direction (clockwise), i.e. the handle direction turned 90 deg right.
  const bx = Math.round(Math.sin(a)), by = Math.round(Math.cos(a));
  const sx = Math.sign(bx) || 0, sy = Math.sign(by) || 0;
  if (tool.kind === 'axe') {
    px(s, ex, ey, c.ironS);
    px(s, ex + sx, ey + sy, c.iron);
    px(s, ex + 2 * sx, ey + 2 * sy, c.ironHi);
    // Second row of the head, one step back down the handle.
    const hx = Math.round(ex - dx), hy = Math.round(ey - dyv);
    px(s, hx + sx, hy + sy, c.iron);
    px(s, hx + 2 * sx, hy + 2 * sy, c.ironHi);
  } else if (tool.kind === 'pick') {
    // Pick: a curved iron head across the handle end, a point on each side.
    px(s, ex, ey, c.ironS);
    px(s, ex + sx, ey + sy, c.iron);
    px(s, ex + 2 * sx, ey + 2 * sy, c.ironHi);
    px(s, ex - sx, ey - sy, c.iron);
    px(s, Math.round(ex - 2 * sx - dx), Math.round(ey - 2 * sy - dyv), c.ironS);
  } else if (tool.kind === 'hoe') {
    px(s, ex, ey, c.ironS);
    px(s, ex + sx, ey + sy, c.iron);
    px(s, ex + 2 * sx, ey + 2 * sy, c.ironHi);
  } else if (tool.kind === 'mallet') {
    // Square-cut wooden head across the handle end: 3 x 2, or 2 x 3 when the handle is level.
    const level = Math.abs(dx) > Math.abs(dyv);
    const w = level ? 2 : 3, h = level ? 3 : 2;
    const x0 = level ? ex + (dx > 0 ? 0 : -1) : ex - 1, y0 = level ? ey - 1 : ey + (dyv > 0 ? 0 : -1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(s, x0 + x, y0 + y, x === 0 || y === 0 ? c.malletHead : c.malletS);
  }
}

function deadFigure(job, owner) {
  // Lying flat on the back, head to the right (se). One row per string.
  // Face up, one arm flung above the head, legs apart: a person, not a log.
  const map = [
    'f.......aK..',
    '.FF.5c44.hh.',
    '..NNb433ahsz',
    '.fN.......k.',
  ];
  const c = palette(job, owner);
  const key = {
    h: job === 'worshipper' ? c.hood : c.h, s: c.s, z: c.z, 5: c.c5, 4: c.c4, 3: c.c3, c: c.c4, b: c.b,
    F: job === 'worshipper' ? c.robeS : c.F, N: job === 'worshipper' ? c.robe : c.N, f: c.f,
    a: c.armBack, K: c.handBack, k: c.handFront,
  };
  const s = createSprite(map[0].length, map.length + 1, 5, map.length);
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (key[ch]) px(s, x, y, key[ch]); }));
  return s;
}

function villager(opts = {}) {
  const job = JOBS.includes(opts.job) ? opts.job : 'idle';
  const pose = POSES.includes(opts.pose) ? opts.pose : 'idle';
  const facing = FACINGS.includes(opts.facing) ? opts.facing : 'se';
  const owner = opts.owner === 'rival' ? 'rival' : 'player';
  const f = ((Math.floor(Number(opts.frame) || 0) % 4) + 4) % 4;
  const c = palette(job, owner);
  const glow = opts.glow && JOB_GLOW[job] ? idx(...JOB_GLOW[job]) : idx('ink', 0);
  const flip = facing === 'sw' || facing === 'nw';

  let s;
  if (pose === 'dead') {
    s = trim(outline(deadFigure(job, owner), idx('ink', 0))); // the dead lose their glow
  } else {
    const fig = assemble(job, pose, f, facing === 'nw' ? 'ne' : facing === 'sw' ? 'se' : facing);
    dress(job, fig);
    const body = createSprite(CW, CH, OX + 4, OY + 10);
    const paint = (list) => { for (const [x, y, t] of list) px(body, x + OX, y + OY, c[t]); };
    paint(fig.parts.back);
    paint(fig.parts.body);
    paint(fig.parts.front);
    // Hands that reach behind the head stay visible; the outline wraps the whole figure.
    s = outline(body, glow, { grow: false });
    if (fig.spec.tool) drawTool(s, fig.spec.tool, OX, OY, fig.dy, c);
    s = trim(s);
  }
  return flip ? mirror(s) : s;
}

export const sprites = { villager };

// Every pose and frame for the farmer facing se (player), plus each job working and a few
// facings and the rival cloth, so the preview sheet shows the whole set.
const pv = [];
for (const pose of POSES) for (let frame = 0; frame < (pose === 'dead' || pose === 'idle' ? 1 : 4); frame++) pv.push({ job: 'farmer', pose, frame, facing: 'se', owner: 'player' });
for (const job of JOBS) for (let frame = 0; frame < 4; frame++) pv.push({ job, pose: 'work', frame, facing: 'se', owner: 'player' });
for (const job of JOBS) pv.push({ job, pose: 'idle', frame: 0, facing: 'se', owner: 'player' }, { job, pose: 'walk', frame: 0, facing: 'ne', owner: 'rival' });
for (const facing of FACINGS) pv.push({ job: 'forester', pose: 'walk', frame: 1, facing, owner: 'rival' });
for (let frame = 0; frame < 4; frame++) pv.push({ job: 'builder', pose: 'carry', frame, facing: 'sw', owner: 'player' });
for (const job of Object.keys(JOB_GLOW)) pv.push({ job, pose: 'walk', frame: 1, facing: 'se', owner: 'player', glow: true });
export const previews = { villager: pv };
