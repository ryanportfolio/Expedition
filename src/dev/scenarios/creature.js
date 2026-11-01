// Creature scenario: the island on the engine's debug terrain pass, both villages set up and the
// creature spawned at its start site, then the shared creature trial (src/creature/trial.js): two sim
// minutes of free choice, forced actions and their world effects (dung measured against the village
// growth rate), a slap right after eating a villager and three starving minutes (never eats a
// villager again, goes weak, recovers on grain), a stroke after watering, a tether, and the lean
// drawn through its own LUT. Screenshots: walking (in the village), mid-action, hurt-after-slap,
// weak, tethered, lean. The thought state is logged. The camera follows the creature for every shot.
//
// Until the creature painter lands, the creature system draws the stand-in sprites from
// src/creature/placeholder-art.js (a gaunt slate figure in the creature-hide and creature-accent
// ramps, so its own LUT shows); a registered painter wins.
import { buildIsland } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { lutFor } from '../../art/lut.js';
import { creatureTrial } from '../../creature/trial.js';

export default async function creature(t, game) {
  const { world, renderer, camera } = game;
  world.loadMap(buildIsland());
  renderer.lut = lutFor(0);
  renderer.addTerrainPass(debugTerrainPass);
  game.systems.village.setup();
  const cs = game.systems.creature;
  cs.setup();
  const follow = () => { const e = cs.entity; camera.centerOn(e.x, e.y - 1.5, e.z); };
  follow();
  t.step(1 / 30);

  const out = await creatureTrial(game, {
    step: (sec) => t.step(sec),
    assert: t.assert,
    log: t.log,
    shot: async (name) => { follow(); t.step(1 / 30); t.log('shot', name, JSON.stringify(cs.state().thought), cs.state().pose); await t.shot(name); },
  });
  t.log('summary', JSON.stringify(out.summary));
  t.log('creatureThought', JSON.stringify(game.state.creatureThought));
}
