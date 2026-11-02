// Browser boot: build the game on the page canvas, wire window size and input, then either start
// the real-time loop or hand control to a scenario (?scenario=<name>&seed=<n>).
import { createGame } from './game.js';
import { installDevHooks } from './dev/hooks.js';

const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
const seed = params.has('seed') && Number.isFinite(seedParam) ? seedParam : 1;
const canvas = document.getElementById('view');
const game = createGame({ seed, canvas });

game.display.fitWindow(window);
game.camera.clamp();
window.addEventListener('resize', () => { game.display.fitWindow(window); game.camera.clamp(); });
game.input.attach(canvas, window, (clientX, clientY) => {
  const r = canvas.getBoundingClientRect();
  const d = game.display;
  return {
    sx: Math.floor(((clientX - r.left) * d.dpr) / d.scale),
    sy: Math.floor(((clientY - r.top) * d.dpr) / d.scale),
  };
});
installDevHooks(game);

/**
 * Real play: the island opens on the title screen; the UI's `game-start` (a click or Enter on the
 * title) sets up both villages, then the creature (the order the creature scenario uses), once.
 * The camera frames the player's temple when the bootstrap is installed (under the title) and again
 * on `game-start`, since keys or the view edge may pan it while the title is up.
 */
function installPlayBootstrap() {
  let started = false;
  const frameHome = () => {
    const t = game.world.sites?.temple;
    if (t) game.camera.centerOn(t.x, t.y, game.world.heightAt(t.x, t.y));
  };
  frameHome();
  game.events.on('game-start', () => {
    if (started) return;
    started = true;
    game.systems.village?.setup?.();
    game.systems.creature?.setup?.();
    frameHome();
  });
}

const scenario = params.get('scenario');
if (scenario) {
  // Scenarios set up their own worlds; the play scenario installs this same bootstrap through here.
  game.debug.installPlayBootstrap = installPlayBootstrap;
  import('./dev/scenario.js').then(({ runScenario }) => runScenario(game, scenario, seed));
} else {
  installPlayBootstrap();
  game.state ??= {};
  game.state.screen = 'title';
  game.start();
}
