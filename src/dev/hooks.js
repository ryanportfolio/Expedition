// Exposes the live game as window.__game for checks and the browser console.
export function installDevHooks(game) {
  if (typeof window !== 'undefined') window.__game = game;
}
