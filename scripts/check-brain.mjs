// Node checks for the creature brain (src/creature/brain.js). Exit 0 on pass, 1 on any failure.
// Usage: node scripts/check-brain.mjs
// BRAIN_MODULE_URL may point at another build of the module (used to prove the checks fail on a broken brain).

const moduleUrl = process.env.BRAIN_MODULE_URL || new URL('../src/creature/brain.js', import.meta.url).href;
const { createBrain, VERBS, TARGETS, DEFAULTS } = await import(moduleUrl);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const results = [];
function check(name, fn) {
  try {
    const summary = fn();
    results.push({ name, ok: true, summary });
    console.log(`PASS ${name}: ${summary}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function rowScore(brain, situation, key) {
  const row = brain.table().rows.find((r) => r.situation === situation && r.key === key);
  return row ? row.score : 0;
}
function aggScore(brain, key) {
  const a = brain.table().aggregates.find((r) => r.key === key);
  return a ? a.score : 0;
}
const f3 = (v) => v.toFixed(3);

check('0 constants', () => {
  for (const v of ['eat', 'throw', 'smash', 'haul', 'water', 'play', 'sleep', 'poop', 'idle', 'wander']) assert(VERBS.includes(v), `VERBS missing ${v}`);
  for (const t of ['grain', 'villager', 'tree', 'rock', 'wood', 'field', 'building', 'none']) assert(TARGETS.includes(t), `TARGETS missing ${t}`);
  assert(DEFAULTS.creditWindow === 10 && DEFAULTS.creditMaxActions === 5 && DEFAULTS.creditTau === 4, 'credit defaults must be 10 s / 5 actions / tau 4 s');
  assert(DEFAULTS.forbidThreshold === -0.35, 'forbid threshold default must be -0.35');
  return `${VERBS.length} verbs, ${TARGETS.length} targets`;
});

check('1 stroke raises, slap lowers', () => {
  const a = createBrain({ rng: mulberry32(1) });
  const sit = a.situation();
  a.recordAction('eat:grain', 0);
  const s = a.feedback('stroke', 1, 0.2);
  const up = rowScore(a, sit, 'eat:grain');
  assert(s.judged === 'eat:grain', `stroke judged ${s.judged}, want eat:grain`);
  assert(up > 0, `stroke left eat:grain at ${up}`);
  const b = createBrain({ rng: mulberry32(1) });
  b.recordAction('eat:grain', 0);
  const sl = b.feedback('slap', 1, 0.2);
  const down = rowScore(b, sit, 'eat:grain');
  assert(sl.judged === 'eat:grain', `slap judged ${sl.judged}, want eat:grain`);
  assert(down < 0, `slap left eat:grain at ${down}`);
  return `after stroke ${f3(up)}, after slap ${f3(down)} (${sit})`;
});

check('2 late slap blames the act on others', () => {
  const b = createBrain({ rng: mulberry32(2) });
  b.recordAction('eat:villager', 0);
  b.recordAction('poop:none', 1.5);
  const r = b.feedback('slap', 1, 2);
  const dv = r.deltas.find((d) => d.key === 'eat:villager');
  const dp = r.deltas.find((d) => d.key === 'poop:none');
  assert(dv && dp, 'both recent actions must receive credit');
  assert(dv.delta < 0 && dp.delta < 0, 'both deltas must be negative');
  assert(Math.abs(dv.delta) > Math.abs(dp.delta), `eat:villager ${dv.delta} must change more than poop:none ${dp.delta}`);
  assert(r.judged === 'eat:villager', `judged ${r.judged}, want eat:villager`);
  return `judged ${r.judged}; eat:villager ${f3(dv.delta)} vs poop:none ${f3(dp.delta)}`;
});

check('2b credit window and action limit', () => {
  const b = createBrain({ rng: mulberry32(3) });
  b.recordAction('smash:rock', 0);
  for (let i = 1; i <= 5; i++) b.recordAction('idle:none', 5 + i * 0.1);
  const r = b.feedback('slap', 1, 6);
  assert(!r.deltas.some((d) => d.key === 'smash:rock'), 'sixth-most-recent action must get no credit');
  const c = createBrain({ rng: mulberry32(3) });
  c.recordAction('smash:rock', 0);
  const late = c.feedback('slap', 1, 10.5);
  assert(late.deltas.length === 0 && late.judged === null, 'action older than 10 s must get no credit');
  const d = createBrain({ rng: mulberry32(3) });
  d.recordAction('smash:rock', 0);
  d.recordAction('smash:tree', 4);
  const decay = d.feedback('slap', 1, 4);
  const old = decay.deltas.find((x) => x.key === 'smash:rock');
  const now = decay.deltas.find((x) => x.key === 'smash:tree');
  assert(decay.judged === 'smash:tree', `equal-salience actions: judged ${decay.judged}, want the newer smash:tree`);
  const ratio = old.credit / now.credit;
  assert(Math.abs(ratio - Math.exp(-1)) < 1e-9, `credit 4 s older should be exp(-1) of fresh, got ${ratio}`);
  return `limit 5 actions, 10 s window, decay exp(-age/4) (4 s old = ${f3(ratio)} of fresh)`;
});

check('3 training always wins', () => {
  const b = createBrain({ rng: mulberry32(4) });
  const offer = [{ key: 'eat:villager', satisfies: { hunger: 0.9 } }, { key: 'idle:none', satisfies: {} }];
  const onlyVillager = [{ key: 'eat:villager', satisfies: { hunger: 0.9 } }];
  // Control: untrained and starving, the same offer picks eat:villager most of the time, so the
  // 0/10000 below proves the forbid blocks it, not low utility.
  b.needs.hunger = 1;
  let control = 0;
  for (let i = 0; i < 200; i++) if (b.choose(offer, 0).key === 'eat:villager') control++;
  assert(control > 100, `control: untrained starving brain chose eat:villager only ${control}/200`);
  b.needs.hunger = 0;
  // Train while fed (default needs are 0), as a player would, then starve it.
  let t = 0;
  let slaps = 0;
  const forbiddenWhenStarving = () => {
    const keep = b.needs.hunger;
    b.needs.hunger = 1;
    const f = b.isForbidden('eat:villager');
    b.needs.hunger = keep;
    return f;
  };
  while (!forbiddenWhenStarving()) {
    assert(slaps < 40, 'eat:villager never became forbidden');
    b.recordAction('eat:villager', t);
    b.feedback('slap', 1, t + 0.3);
    slaps++;
    t += 12;
  }
  b.needs.hunger = 1;
  assert(b.situation() === 'hunger:high', `situation ${b.situation()}, want hunger:high`);
  // Alternate the offer with and without a fallback: only-forbidden offers must wander every time.
  let ate = 0;
  let wander = 0;
  for (let i = 0; i < 10000; i++) {
    const k = b.choose(i % 2 ? onlyVillager : offer, t).key;
    if (k === 'eat:villager') ate++;
    if (k === 'wander:none') wander++;
  }
  assert(ate === 0, `forbidden eat:villager chosen ${ate} times`);
  assert(wander === 5000, `only-forbidden offers should give wander:none, got ${wander}/5000`);

  const dt = 1 / 30;
  for (let i = 0; i < 19 * 30; i++) b.tickNeeds(dt);
  assert(!b.weak && b.speedMult === 1 && b.canThrow, 'weak too early (19 s)');
  for (let i = 0; i < 2 * 30; i++) b.tickNeeds(dt);
  assert(b.weak, 'not weak after 21 s at hunger >= 0.9');
  assert(b.speedMult === 0.5, `speedMult ${b.speedMult}, want 0.5`);
  assert(b.canThrow === false, 'canThrow must be false when weak');
  const th = b.choose([{ key: 'throw:rock', satisfies: { boredom: 1 } }], t);
  assert(th.key === 'wander:none', `weak creature chose ${th.key}`);

  const grain = b.choose([{ key: 'eat:grain', satisfies: { hunger: 0.6 } }], t);
  assert(grain.key === 'eat:grain', `hungry creature offered grain chose ${grain.key}`);
  b.completeAction('eat:grain');
  assert(b.needs.hunger < 0.5, `hunger ${b.needs.hunger} after eating grain`);
  assert(!b.weak && b.speedMult === 1 && b.canThrow, 'still weak after eating to below 0.5 hunger');
  return `control ${control}/200 untrained; ${slaps} slaps while fed -> forbidden when starving; 0/10000 chosen, ${wander}/5000 only-forbidden -> wander; weak at 21 s; grain -> hunger ${f3(b.needs.hunger)}, recovered`;
});

check('4 weighted choice', () => {
  const b = createBrain({ rng: mulberry32(5) });
  b.needs.boredom = 0.5;
  const offer = [{ key: 'play:rock', satisfies: { boredom: 0.5 } }, { key: 'play:tree', satisfies: { boredom: 0.5 } }];
  let rock = 0;
  for (let i = 0; i < 2000; i++) if (b.choose(offer, 0).key === 'play:rock') rock++;
  const share = rock / 2000;
  assert(share >= 0.3 && share <= 0.7, `play:rock share ${share}`);
  // A clearly better option is preferred but not always taken.
  const offer2 = [{ key: 'play:rock', satisfies: { boredom: 0.8 } }, { key: 'play:tree', satisfies: { boredom: 0.4 } }];
  let best = 0;
  for (let i = 0; i < 2000; i++) if (b.choose(offer2, 0).key === 'play:rock') best++;
  assert(best > 1000 && best < 2000, `better option chosen ${best}/2000; want a majority but not all`);
  return `equal: play:rock ${(share * 100).toFixed(1)}%; better option ${(best / 20).toFixed(1)}%`;
});

check('5 targets learn separately', () => {
  const b = createBrain({ rng: mulberry32(6) });
  for (let i = 0; i < 6; i++) {
    b.recordAction('eat:villager', i * 12);
    b.feedback('slap', 1, i * 12 + 0.2);
  }
  assert(b.isForbidden('eat:villager'), 'eat:villager should be forbidden after 6 slaps');
  assert(!b.isForbidden('eat:grain'), 'eat:grain became forbidden');
  assert(aggScore(b, 'eat:grain') === 0, 'eat:grain aggregate changed');
  // Same split while starving: the trained-away target stays out, the other stays in.
  b.needs.hunger = 1;
  assert(b.situation() === 'hunger:high', `situation ${b.situation()}, want hunger:high`);
  assert(b.isForbidden('eat:villager'), 'eat:villager not forbidden while starving');
  assert(!b.isForbidden('eat:grain'), 'eat:grain forbidden while starving');
  const offer = [{ key: 'eat:villager', satisfies: { hunger: 0.9 } }, { key: 'eat:grain', satisfies: { hunger: 0.6 } }];
  let grain = 0;
  for (let i = 0; i < 1000; i++) if (b.choose(offer, 100).key === 'eat:grain') grain++;
  assert(grain === 1000, `starving brain picked eat:grain ${grain}/1000 with eat:villager forbidden`);
  return `eat:villager agg ${f3(aggScore(b, 'eat:villager'))}, eat:grain agg 0; starving: eat:grain allowed, chosen 1000/1000`;
});

function scriptedRun(seed) {
  const b = createBrain({ rng: mulberry32(seed) });
  const offer = [
    { key: 'eat:grain', satisfies: { hunger: 0.7 } },
    { key: 'eat:villager', satisfies: { hunger: 0.9 } },
    { key: 'sleep:none', satisfies: { fatigue: 0.8 } },
    { key: 'play:villager', satisfies: { boredom: 0.6 } },
    { key: 'haul:wood', satisfies: { boredom: 0.3 } },
  ];
  const choices = [];
  let t = 0;
  for (let i = 0; i < 300; i++) {
    b.tickNeeds(1, { asleep: false });
    t += 1;
    const c = b.choose(offer, t);
    choices.push(c.key);
    if (c.key !== 'wander:none') {
      b.recordAction(c.key, t);
      b.completeAction(c.key);
    }
    if (c.key === 'eat:villager') b.feedback('slap', 0.8, t + 0.5);
    if (c.key === 'haul:wood') b.feedback('stroke', 0.6, t + 0.5);
  }
  return { choices, state: JSON.stringify(b.serialize()), table: JSON.stringify(b.table()) };
}

check('6 determinism', () => {
  const a = scriptedRun(42);
  const b = scriptedRun(42);
  const c = scriptedRun(43);
  assert(a.choices.join() === b.choices.join(), 'same seed gave different choices');
  assert(a.table === b.table && a.state === b.state, 'same seed gave different tables');
  assert(a.choices.join() !== c.choices.join(), 'different seed gave identical choices (rng unused?)');
  const kinds = new Set(a.choices).size;
  // One rng draw per choose call whatever the outcome: normal pick, all excluded, or no candidates.
  let draws = 0;
  const base = mulberry32(44);
  const counted = createBrain({ rng: () => { draws++; return base(); } });
  for (let i = 0; i < 6; i++) { counted.recordAction('eat:villager', i * 12); counted.feedback('slap', 1, i * 12 + 0.2); }
  const calls = [
    [{ key: 'eat:grain', satisfies: { hunger: 0.5 } }, { key: 'idle:none', satisfies: {} }],
    [{ key: 'eat:villager', satisfies: { hunger: 0.9 } }],
    [],
  ];
  for (const offer of calls) {
    const before = draws;
    counted.choose(offer, 100);
    assert(draws === before + 1, `choose of [${offer.map((c) => c.key)}] drew ${draws - before} times, want 1`);
  }
  return `300 steps identical for seed 42 (${kinds} distinct actions); seed 43 differs; 1 draw per choose incl. fallback`;
});

check('7 alignment lean', () => {
  const good = createBrain({ rng: mulberry32(7) });
  const evil = createBrain({ rng: mulberry32(7) });
  let t = 0;
  for (let i = 0; i < 4; i++) {
    good.recordAction('haul:wood', t); good.feedback('stroke', 1, t + 0.2); t += 12;
    good.recordAction('water:field', t); good.feedback('stroke', 1, t + 0.2); t += 12;
    evil.recordAction('throw:villager', t); evil.feedback('stroke', 1, t + 0.2); t += 12;
    evil.recordAction('eat:villager', t); evil.feedback('stroke', 1, t + 0.2); t += 12;
  }
  const g = good.alignmentLean();
  const e = evil.alignmentLean();
  assert(g > 0 && g <= 1, `good lean ${g}`);
  assert(e < 0 && e >= -1, `evil lean ${e}`);
  const fresh = createBrain({ rng: mulberry32(7) }).alignmentLean();
  assert(fresh === 0, `untrained lean ${fresh}`);
  const neutral = createBrain({ rng: mulberry32(7) });
  neutral.recordAction('eat:grain', 0); neutral.feedback('stroke', 1, 0.1);
  assert(neutral.alignmentLean() === 0, 'stroking a neutral action moved the lean');
  return `good ${f3(g)}, evil ${f3(e)}, untrained 0, neutral-only 0`;
});

check('8 serialize round trip', () => {
  const src = createBrain({ rng: mulberry32(8) });
  src.tickNeeds(37.5);
  src.recordAction('eat:villager', 1); src.feedback('slap', 1, 1.4);
  src.recordAction('haul:wood', 2); src.feedback('stroke', 0.7, 2.3);
  const state = JSON.parse(JSON.stringify(src.serialize()));
  const copy = createBrain({ rng: mulberry32(8), state });
  assert(JSON.stringify(copy.table()) === JSON.stringify(src.table()), 'table differs after round trip');
  assert(JSON.stringify(copy.needs) === JSON.stringify(src.needs), 'needs differ after round trip');
  assert(JSON.stringify(copy.serialize()) === JSON.stringify(src.serialize()), 'state differs after round trip');
  // Restored brains keep learning identically.
  const r1 = src.feedback('slap', 1, 2.5);
  const r2 = copy.feedback('slap', 1, 2.5);
  assert(JSON.stringify(r1) === JSON.stringify(r2), 'feedback after restore differs');
  return `${src.table().rows.length} rows, needs ${f3(src.needs.hunger)}/${f3(src.needs.fatigue)}/${f3(src.needs.boredom)} preserved`;
});

check('9 bad input is refused', () => {
  const b = createBrain({ rng: mulberry32(9) });
  const throwsOn = (fn) => { try { fn(); return false; } catch { return true; } };
  assert(throwsOn(() => createBrain({})), 'createBrain without rng must throw');
  assert(throwsOn(() => b.feedback('pat', 1, 0)), 'unknown feedback kind must throw');
  assert(throwsOn(() => b.feedback('slap', NaN, 0)), 'NaN strength must throw');
  assert(throwsOn(() => b.recordAction('eat', 0)), 'key without target must throw');
  assert(throwsOn(() => b.tickNeeds(-1)), 'negative dt must throw');
  return 'missing rng, bad kind, NaN strength, malformed key, negative dt';
});

// Round 10: a punishment in one situation forbids the action in every situation (contract v3, acceptance 8).
const T = DEFAULTS.forbidThreshold;
function minRow(brain, key) {
  const rows = brain.table().rows.filter((r) => r.key === key);
  return rows.length ? Math.min(...rows.map((r) => r.score)) : 0;
}
function setNeeds(brain, hunger, fatigue, boredom) {
  brain.needs.hunger = hunger;
  brain.needs.fatigue = fatigue;
  brain.needs.boredom = boredom;
}
// Two full-strength slaps while fed (all needs 0 -> situation hunger:low), as in the audit.
function slapTwiceWhileFed(brain, key) {
  setNeeds(brain, 0, 0, 0);
  const sit = brain.situation();
  for (const t of [0, 12]) { brain.recordAction(key, t); brain.feedback('slap', 1, t + 0.3); }
  assert(sit === 'hunger:low', `fed situation ${sit}, want hunger:low`);
  const agg = aggScore(brain, key);
  const min = minRow(brain, key);
  // The aggregate alone stays above the threshold: only the cross-situation minimum can forbid here.
  assert(agg > T, `${key} aggregate ${agg} already at threshold after 2 slaps; case would not test the minimum`);
  assert(min <= T, `${key} ${sit} score ${min} not at threshold after 2 slaps`);
  return { agg, min };
}
function countPicks(brain, offer, key, n, now) {
  let picks = 0;
  let forbiddenExcl = 0;
  for (let i = 0; i < n; i++) {
    const c = brain.choose(offer, now);
    if (c.key === key) picks++;
    else if (c.reason.excluded && c.reason.excluded.some((e) => e.key === key && e.why === 'forbidden')) forbiddenExcl++;
  }
  return { picks, forbiddenExcl };
}
const throwOffer = [{ key: 'throw:villager', satisfies: { boredom: 1 } }, { key: 'idle:none', satisfies: {} }];
const elsewhere = [
  { name: 'boredom high', needs: [0, 0, 1], sit: 'boredom:high' },
  { name: 'hunger high', needs: [1, 0, 0], sit: 'hunger:high' },
];

check('10a forbidden in one situation is forbidden everywhere', () => {
  const ctl = createBrain({ rng: mulberry32(101) });
  const b = createBrain({ rng: mulberry32(101) });
  const { agg, min } = slapTwiceWhileFed(b, 'throw:villager');
  const out = [];
  for (const s of elsewhere) {
    setNeeds(ctl, ...s.needs);
    setNeeds(b, ...s.needs);
    assert(b.situation() === s.sit, `situation ${b.situation()}, want ${s.sit}`);
    // Control: the untrained brain picks throw:villager often in this situation, so 0 below is the forbid.
    const c = countPicks(ctl, throwOffer, 'throw:villager', 5000, 50).picks;
    assert(c > 1000, `control at ${s.name}: untrained brain chose throw:villager only ${c}/5000`);
    assert(b.isForbidden('throw:villager'), `throw:villager not forbidden at ${s.name}`);
    assert(b.canThrow, 'brain is weak; exclusion would not prove the forbid');
    const r = countPicks(b, throwOffer, 'throw:villager', 5000, 50);
    assert(r.picks === 0, `throw:villager chosen ${r.picks}/5000 at ${s.name}`);
    assert(r.forbiddenExcl === 5000, `throw:villager excluded as forbidden ${r.forbiddenExcl}/5000 at ${s.name}`);
    out.push(`${s.name} 0/5000 (control ${c})`);
  }
  return `2 slaps fed: hunger:low ${f3(min)}, aggregate ${f3(agg)}; ${out.join(', ')}`;
});

check('10b slapped while fed, never eaten while starving', () => {
  const only = [{ key: 'eat:villager', satisfies: { hunger: 0.9 } }];
  const ctl = createBrain({ rng: mulberry32(102) });
  setNeeds(ctl, 1, 0, 0);
  const c = countPicks(ctl, [...only, { key: 'idle:none', satisfies: {} }], 'eat:villager', 1000, 50).picks;
  assert(c > 500, `control: untrained starving brain chose eat:villager only ${c}/1000`);
  const b = createBrain({ rng: mulberry32(102) });
  const { agg } = slapTwiceWhileFed(b, 'eat:villager');
  setNeeds(b, 1, 0, 0);
  assert(b.situation() === 'hunger:high', `situation ${b.situation()}, want hunger:high`);
  let ate = 0;
  let wander = 0;
  for (let i = 0; i < 10000; i++) {
    const k = b.choose(only, 50).key;
    if (k === 'eat:villager') ate++;
    if (k === 'wander:none') wander++;
  }
  assert(ate === 0, `forbidden eat:villager chosen ${ate}/10000 while starving`);
  assert(wander === 10000, `only-forbidden offer gave wander:none ${wander}/10000`);
  const dt = 1 / 30;
  for (let i = 0; i < 19 * 30; i++) b.tickNeeds(dt);
  assert(!b.weak, 'weak too early (19 s)');
  for (let i = 0; i < 2 * 30; i++) b.tickNeeds(dt);
  assert(b.weak && b.speedMult === 0.5 && b.canThrow === false, `after 21 s starving: weak ${b.weak}, speedMult ${b.speedMult}, canThrow ${b.canThrow}`);
  let late = 0;
  for (let i = 0; i < 1000; i++) if (b.choose(only, 80).key === 'eat:villager') late++;
  assert(late === 0, `weak starving brain ate the villager ${late}/1000`);
  return `aggregate ${f3(agg)} (above ${T}); hunger 1: 0/10000 chosen, 10000 wander (control ${c}/1000); weak at 21 s, still 0/1000`;
});

check('10c other targets stay allowed', () => {
  const b = createBrain({ rng: mulberry32(103) });
  slapTwiceWhileFed(b, 'eat:villager');
  const out = [];
  for (const [h, sit] of [[0, 'hunger:low'], [0.5, 'hunger:mid'], [1, 'hunger:high']]) {
    setNeeds(b, h, 0, 0);
    assert(b.situation() === sit, `situation ${b.situation()}, want ${sit}`);
    assert(b.isForbidden('eat:villager'), `eat:villager allowed at ${sit}`);
    assert(!b.isForbidden('eat:grain'), `eat:grain forbidden at ${sit}`);
  }
  const tbl = b.table();
  assert(tbl.forbidden.includes('eat:villager') && !tbl.forbidden.includes('eat:grain'), `table forbidden list ${tbl.forbidden}`);
  setNeeds(b, 1, 0, 0);
  const offer = [{ key: 'eat:villager', satisfies: { hunger: 0.9 } }, { key: 'eat:grain', satisfies: { hunger: 0.6 } }];
  const grain = countPicks(b, offer, 'eat:grain', 1000, 50).picks;
  assert(grain === 1000, `starving brain picked eat:grain ${grain}/1000`);
  out.push(`starving with both offered: eat:grain 1000/1000`);
  return `eat:villager forbidden at low/mid/high hunger, eat:grain allowed at all three; ${out.join('')}`;
});

check('10d stroking lifts the forbid everywhere', () => {
  const b = createBrain({ rng: mulberry32(104) });
  slapTwiceWhileFed(b, 'throw:villager');
  const before = b.table();
  const flagBefore = before.rows.filter((r) => r.key === 'throw:villager').every((r) => r.forbidden === true);
  const aggBefore = before.aggregates.find((a) => a.key === 'throw:villager');
  assert(flagBefore && aggBefore.forbidden === true, 'table must flag throw:villager forbidden before stroking');
  // Stroke it in the situation where it was punished until its lowest score is above the threshold.
  let t = 100;
  let strokes = 0;
  while (minRow(b, 'throw:villager') <= T) {
    assert(strokes < 40, 'stroking never lifted throw:villager');
    setNeeds(b, 0, 0, 0);
    b.recordAction('throw:villager', t);
    b.feedback('stroke', 1, t + 0.3);
    strokes++;
    t += 12;
  }
  const out = [];
  for (const s of elsewhere) {
    setNeeds(b, ...s.needs);
    assert(!b.isForbidden('throw:villager'), `throw:villager still forbidden at ${s.name}`);
    const r = countPicks(b, throwOffer, 'throw:villager', 5000, t);
    assert(r.picks > 1000, `allowed throw:villager chosen only ${r.picks}/5000 at ${s.name}`);
    out.push(`${s.name} ${r.picks}/5000`);
  }
  const after = b.table();
  assert(after.rows.filter((r) => r.key === 'throw:villager').every((r) => r.forbidden === false), 'table rows still flag throw:villager forbidden');
  assert(after.aggregates.find((a) => a.key === 'throw:villager').forbidden === false && !after.forbidden.includes('throw:villager'), 'table aggregate still flags throw:villager forbidden');
  return `${strokes} stroke(s): min ${f3(minRow(b, 'throw:villager'))} > ${T}; chosen ${out.join(', ')}; table flag cleared`;
});

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
