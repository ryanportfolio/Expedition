// Creature decision and learning core. Pure: no DOM, no world store, no rendering.
// Deterministic given the injected rng `() => number in [0, 1)`; never calls Math.random.
// Time (`now`, `dt`) is sim seconds supplied by the caller.

export const VERBS = Object.freeze([
  'eat', 'throw', 'smash', 'haul', 'water', 'play', 'sleep', 'poop', 'idle', 'wander',
]);

export const TARGETS = Object.freeze([
  'grain', 'villager', 'tree', 'rock', 'wood', 'field', 'building', 'none',
]);

export const NEEDS = Object.freeze(['hunger', 'fatigue', 'boredom']);

export const DEFAULTS = Object.freeze({
  // Need growth per sim second while awake (1 / seconds to fill from 0 to 1).
  hungerRate: 1 / 180,
  fatigueRate: 1 / 240,
  boredomRate: 1 / 120,
  // While asleep fatigue falls at this rate instead of rising; hunger and boredom keep rising.
  sleepFatigueRecovery: 1 / 30,
  // Situation level boundaries: below lowMax = low, below midMax = mid, else high.
  levelLowMax: 0.33,
  levelMidMax: 0.66,
  // Choice: score = utilityWeight * utility + learnedWeight * learned, softmax at `temperature`.
  utilityWeight: 1,
  learnedWeight: 1,
  temperature: 0.25,
  // Share of the cross-situation aggregate mixed into a situation score the creature has a row for.
  // With no row for the current situation the aggregate is used alone.
  generalize: 0.35,
  // Learning.
  learnRate: 0.2,        // situation score change for a full-strength, zero-age, salience-1 feedback
  aggregateRate: 0.5,    // aggregate change = learnRate * aggregateRate * credit
  creditWindow: 10,      // seconds; older actions get no credit
  creditMaxActions: 5,   // only the most recent N actions get credit
  creditTau: 4,          // seconds; credit decays by exp(-age / tau)
  forbidThreshold: -0.35,
  // Salience: how strongly feedback attaches to an action. Exact key wins over `verb:*`.
  salienceDefault: 0.6,
  salience: Object.freeze({
    'sleep:*': 0.3, 'poop:*': 0.3, 'play:*': 0.3, 'idle:*': 0.3, 'wander:*': 0.3,
    'eat:villager': 1.0, 'throw:*': 1.0, 'smash:*': 1.0, 'haul:*': 1.0, 'water:*': 1.0,
    'eat:*': 0.6, 'play:villager': 0.6,
  }),
  // Moral weight of an action, -1 evil .. +1 good. Exact key wins over `verb:*`; missing = 0.
  moral: Object.freeze({
    'eat:villager': -1, 'throw:villager': -1, 'smash:villager': -1,
    'smash:building': -0.8, 'smash:field': -0.5,
    'haul:*': 0.6, 'water:*': 0.8, 'play:villager': 0.3,
    'eat:grain': 0,
  }),
  // Lean = sum(moral * aggregate) / max(leanFloor, sum |aggregate|): a little training gives a little lean.
  leanFloor: 1,
  // Weakness from starving.
  weakHunger: 0.9,
  weakAfter: 20,
  weakRecoverBelow: 0.5,
  weakSpeedMult: 0.5,
});

const STATE_VERSION = 1;

function mergeParams(params) {
  const p = { ...DEFAULTS, ...(params || {}) };
  p.salience = { ...DEFAULTS.salience, ...((params && params.salience) || {}) };
  p.moral = { ...DEFAULTS.moral, ...((params && params.moral) || {}) };
  return p;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function splitKey(key) {
  if (typeof key !== 'string') throw new TypeError(`action key must be a string, got ${typeof key}`);
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) throw new TypeError(`action key must be "verb:target", got "${key}"`);
  return [key.slice(0, i), key.slice(i + 1)];
}

function lookup(table, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const wild = `${splitKey(key)[0]}:*`;
  if (Object.prototype.hasOwnProperty.call(table, wild)) return table[wild];
  return fallback;
}

function finite(name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${name} must be a finite number, got ${v}`);
  return v;
}

export function createBrain({ rng, params, state } = {}) {
  if (typeof rng !== 'function') throw new TypeError('createBrain needs an injected rng () => [0,1)');
  const P = mergeParams(params);

  const needs = { hunger: 0, fatigue: 0, boredom: 0 };
  const scores = new Map();      // `${situation}|${key}` -> score
  const aggregates = new Map();  // key -> score
  const sitsByKey = new Map();   // key -> Set of situations that have a score row for it
  let recent = [];               // [{ key, situation, t }], oldest first, length <= creditMaxActions
  let weak = false;
  let starvingFor = 0;           // sim seconds hunger has stayed >= weakHunger
  const lastSatisfies = new Map(); // key -> satisfies of the last chosen candidate with that key

  if (state) restore(state);

  function setScore(sit, key, v) {
    splitKey(key);
    scores.set(`${sit}|${key}`, v);
    let sits = sitsByKey.get(key);
    if (!sits) sitsByKey.set(key, (sits = new Set()));
    sits.add(sit);
  }

  function restore(s) {
    if (!s || s.v !== STATE_VERSION) throw new TypeError(`unsupported brain state version ${s && s.v}`);
    for (const n of NEEDS) needs[n] = clamp(finite(`state.needs.${n}`, s.needs[n]), 0, 1);
    for (const [k, v] of s.scores) {
      const bar = typeof k === 'string' ? k.indexOf('|') : -1;
      if (bar <= 0) throw new TypeError(`score id must be "situation|verb:target", got "${k}"`);
      setScore(k.slice(0, bar), k.slice(bar + 1), clamp(finite(`score ${k}`, v), -1, 1));
    }
    for (const [k, v] of s.aggregates) { splitKey(k); aggregates.set(k, clamp(finite(`aggregate ${k}`, v), -1, 1)); }
    recent = s.recent.slice(-P.creditMaxActions).map((r) => ({ key: r.key, situation: r.situation, t: finite('recent.t', r.t) }));
    weak = !!s.weak;
    starvingFor = finite('state.starvingFor', s.starvingFor);
    for (const [k, v] of s.lastSatisfies || []) lastSatisfies.set(k, { ...v });
  }

  function level(v) {
    return v < P.levelLowMax ? 'low' : v < P.levelMidMax ? 'mid' : 'high';
  }

  function situation() {
    let best = NEEDS[0];
    for (const n of NEEDS) if (needs[n] > needs[best]) best = n;
    return `${best}:${level(needs[best])}`;
  }

  function updateWeak(dt) {
    if (needs.hunger >= P.weakHunger) starvingFor += dt;
    else starvingFor = 0;
    if (!weak && starvingFor >= P.weakAfter) weak = true;
    if (weak && needs.hunger < P.weakRecoverBelow) weak = false;
  }

  function tickNeeds(dt, { asleep = false } = {}) {
    finite('dt', dt);
    if (dt < 0) throw new RangeError('dt must be >= 0');
    needs.hunger = clamp(needs.hunger + P.hungerRate * dt, 0, 1);
    needs.boredom = clamp(needs.boredom + P.boredomRate * dt, 0, 1);
    needs.fatigue = clamp(needs.fatigue + (asleep ? -P.sleepFatigueRecovery : P.fatigueRate) * dt, 0, 1);
    updateWeak(dt);
  }

  function learned(key, sit) {
    const agg = aggregates.get(key) ?? 0;
    const id = `${sit}|${key}`;
    if (!scores.has(id)) return agg;
    return (1 - P.generalize) * scores.get(id) + P.generalize * agg;
  }

  // Lowest situation score the action has anywhere (0 when it has no rows yet).
  function minScore(key) {
    let min = 0;
    let any = false;
    for (const sit of sitsByKey.get(key) || []) {
      const s = scores.get(`${sit}|${key}`);
      if (!any || s < min) { min = s; any = true; }
    }
    return min;
  }

  // Training always wins: an action punished down to the threshold in any one situation is
  // forbidden in every situation (starving included), until stroking lifts that row and the
  // aggregate back above the threshold. Keys stay per target, so `eat:villager` never forbids `eat:grain`.
  function isForbidden(key) {
    splitKey(key);
    const agg = aggregates.get(key) ?? 0;
    return minScore(key) <= P.forbidThreshold || agg <= P.forbidThreshold;
  }

  function utility(satisfies) {
    let u = 0;
    if (satisfies) for (const n of NEEDS) if (satisfies[n]) u += needs[n] * finite(`satisfies.${n}`, satisfies[n]);
    return u;
  }

  function choose(candidates, now) {
    // Exactly one draw per call, even when every candidate is excluded, so the rng stream
    // position depends only on how many times choose ran, not on what the creature learned.
    const u01 = rng();
    const sit = situation();
    const considered = [];
    const excluded = [];
    for (const c of candidates || []) {
      const [verb] = splitKey(c.key);
      if (isForbidden(c.key)) { excluded.push({ key: c.key, why: 'forbidden' }); continue; }
      if (weak && verb === 'throw') { excluded.push({ key: c.key, why: 'weak' }); continue; }
      const u = utility(c.satisfies);
      const l = learned(c.key, sit);
      considered.push({ c, utility: u, learned: l, score: P.utilityWeight * u + P.learnedWeight * l });
    }
    if (considered.length === 0) {
      return {
        key: 'wander:none',
        satisfies: {},
        reason: { fallback: candidates && candidates.length ? 'all-excluded' : 'no-candidates', situation: sit, excluded, now },
      };
    }
    const T = Math.max(1e-6, P.temperature);
    let max = -Infinity;
    for (const x of considered) if (x.score > max) max = x.score;
    let total = 0;
    for (const x of considered) { x.w = Math.exp((x.score - max) / T); total += x.w; }
    const r = u01 * total;
    let acc = 0;
    let pick = considered[considered.length - 1];
    for (const x of considered) { acc += x.w; if (r < acc) { pick = x; break; } }
    if (pick.c.satisfies) lastSatisfies.set(pick.c.key, { ...pick.c.satisfies });
    return {
      ...pick.c,
      reason: {
        situation: sit,
        utility: pick.utility,
        learned: pick.learned,
        probability: pick.w / total,
        options: considered.map((x) => ({ key: x.c.key, utility: x.utility, learned: x.learned, probability: x.w / total })),
        excluded,
        now,
      },
    };
  }

  function recordAction(key, now) {
    splitKey(key);
    finite('now', now);
    recent.push({ key, situation: situation(), t: now });
    if (recent.length > P.creditMaxActions) recent = recent.slice(-P.creditMaxActions);
  }

  // `now` (optional): the action's credit time moves to `now`. For an act of more than one stage the
  // caller records it when it starts and passes `now` when it finishes, so feedback given at the
  // finish (a haul's delivery, seconds after the pickup) is credited as fresh. Only the newest
  // recent entry for `key` is re-stamped, in place.
  function completeAction(key, satisfies, now) {
    splitKey(key);
    if (now !== undefined) {
      finite('now', now);
      for (let i = recent.length - 1; i >= 0; i--) if (recent[i].key === key) { recent[i].t = now; break; }
    }
    const s = satisfies || lastSatisfies.get(key);
    if (s) for (const n of NEEDS) if (s[n]) needs[n] = clamp(needs[n] - finite(`satisfies.${n}`, s[n]), 0, 1);
    updateWeak(0);
  }

  function feedback(kind, strength, now) {
    if (kind !== 'stroke' && kind !== 'slap') throw new TypeError(`feedback kind must be stroke or slap, got ${kind}`);
    const sign = kind === 'stroke' ? 1 : -1;
    const amount = clamp(finite('strength', strength), 0, 1);
    finite('now', now);
    const deltas = [];
    const creditByKey = new Map();
    for (const r of recent.slice(-P.creditMaxActions)) {
      const age = now - r.t;
      if (age < 0 || age > P.creditWindow) continue;
      const credit = sign * amount * Math.exp(-age / P.creditTau) * lookup(P.salience, r.key, P.salienceDefault);
      if (credit === 0) continue;
      const id = `${r.situation}|${r.key}`;
      const before = scores.get(id) ?? 0;
      const after = clamp(before + P.learnRate * credit, -1, 1);
      setScore(r.situation, r.key, after);
      const aggBefore = aggregates.get(r.key) ?? 0;
      const aggAfter = clamp(aggBefore + P.learnRate * P.aggregateRate * credit, -1, 1);
      aggregates.set(r.key, aggAfter);
      deltas.push({ key: r.key, situation: r.situation, age, credit, delta: after - before, score: after, aggregateDelta: aggAfter - aggBefore, aggregate: aggAfter });
      creditByKey.set(r.key, (creditByKey.get(r.key) ?? 0) + credit);
    }
    // `judged` = the action that received the most credit (intended change), so the thought bubble
    // still names it when its score is already pinned at -1 or +1 and the applied change is 0.
    let judged = null;
    let best = 0;
    for (const [k, c] of creditByKey) if (Math.abs(c) > best) { best = Math.abs(c); judged = k; }
    return { judged, kind, deltas };
  }

  function moralOf(key) {
    return lookup(P.moral, key, 0);
  }

  function alignmentLean() {
    let num = 0;
    let den = 0;
    for (const [k, a] of aggregates) { num += moralOf(k) * a; den += Math.abs(a); }
    return clamp(num / Math.max(P.leanFloor, den), -1, 1);
  }

  function entriesByKey(map) {
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  // Debug-panel view. `forbidden` on a row is the action's flag (the same in every situation);
  // each aggregate entry also carries the action's lowest situation score (`minScore`).
  function table() {
    const rows = entriesByKey(scores).map(([id, score]) => {
      const bar = id.indexOf('|');
      const key = id.slice(bar + 1);
      return { situation: id.slice(0, bar), key, score, forbidden: isForbidden(key) };
    });
    const aggs = entriesByKey(aggregates).map(([key, score]) => ({
      key, score, minScore: minScore(key), moral: moralOf(key), forbidden: isForbidden(key),
    }));
    const forbidden = aggs.filter((a) => a.forbidden).map((a) => a.key);
    return { situation: situation(), rows, aggregates: aggs, forbidden, lean: alignmentLean() };
  }

  function serialize() {
    return {
      v: STATE_VERSION,
      needs: { ...needs },
      scores: entriesByKey(scores),
      aggregates: entriesByKey(aggregates),
      recent: recent.map((r) => ({ ...r })),
      weak,
      starvingFor,
      lastSatisfies: entriesByKey(lastSatisfies).map(([k, v]) => [k, { ...v }]),
    };
  }

  return {
    needs,
    params: P,
    tickNeeds,
    situation,
    choose,
    recordAction,
    completeAction,
    feedback,
    isForbidden,
    alignmentLean,
    moralOf,
    table,
    serialize,
    get weak() { return weak; },
    get speedMult() { return weak ? P.weakSpeedMult : 1; },
    get canThrow() { return !weak; },
  };
}
