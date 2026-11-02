// Miracles scenario: the island with the debug terrain pass, power 100, test villagers, houses and
// trees on the player village plateau; each miracle cast once through the hand path (synthetic grab,
// release and landed events), plus a fizzle. The drive and its asserts live in
// src/miracles/testbed.js, shared with scripts/check-miracles.mjs. Screenshots: orbs, fire,
// fire-spread, rain, heal, lightning (flash frame), lightning-after (flash gone), fizzle.
import { debugTerrainPass } from '../test-art.js';
import { makeLut } from '../../art/lut.js';
import { runMiracleSuite } from '../../miracles/testbed.js';

export default async function miracles(t, game) {
  game.renderer.lut = makeLut(0);
  game.renderer.addTerrainPass(debugTerrainPass);
  const drive = {
    step: (s) => t.step(s),
    assert: (c, m) => t.assert(c, m),
    log: (...a) => t.log(...a),
    shot: (name) => t.shot(name),
    focus: (x, y, z) => { game.camera.centerOn(x, y, z); game.renderer.render(); },
  };
  await runMiracleSuite(drive, game);
}
