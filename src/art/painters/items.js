// Item painters: the loose goods villagers haul. `wood` is a short bundle of split logs tied with
// cord, `grain` a tied burlap sack, `ore` a heap of rust-red ore lumps. Both sit on their ground contact row (anchor at the bottom
// center), so the same sprite works lying on the ground and riding on a carrier's head: the
// village system moves a carried item to the carrier's position 1.2 height units up.

import { idx } from '../palette.js';
import { createSprite, outline, px } from '../sprite.js';

// One row per string, top to bottom. Keys are resolved in each painter.
function fromMap(map, key, ax) {
  const h = map.length, w = map[0].length;
  const s = createSprite(w, h, ax, h - 1);
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (key[ch]) px(s, x, y, key[ch]); }));
  return s;
}

/** Three logs stacked two-and-one, cut ends facing front-right, bodies running back up-left,
 * tied with a cord. 9 x 7 with outline. */
function wood() {
  const s = createSprite(7, 5, 3, 4);
  const log = (ex, ey) => {
    // Body: two pixels behind the end, lit top row, dark under-row.
    for (let k = 1; k <= 3; k++) {
      px(s, ex - k, ey - 1, idx('bark', 5));
      px(s, ex - k, ey, idx('bark', 3));
      px(s, ex - k, ey + 1, idx('bark', 2));
    }
    // Cut end: pale heartwood in a bark ring.
    px(s, ex, ey - 1, idx('bark', 4));
    px(s, ex, ey, idx('sand', 6));
    px(s, ex, ey + 1, idx('bark', 3));
    px(s, ex + 1, ey, idx('bark', 4));
  };
  log(5, 3);
  log(3, 3);
  log(4, 1);
  // Cord round the bundle.
  px(s, 1, 2, idx('thatch', 6)); px(s, 1, 3, idx('thatch', 5)); px(s, 1, 4, idx('thatch', 4));
  return outline(s, idx('bark', 0));
}

/** Burlap sack with a tied neck, lit from the top-left. 7 x 8 with outline. */
function grain() {
  // t tie, n neck, 1-4 burlap bright to dark, g a few spilled kernels on the seam.
  const map = [
    '..tt.',
    '..nn.',
    '.1223',
    '12234',
    '12234',
    '.2344',
  ];
  const key = {
    t: idx('thatch', 3), n: idx('sand', 4),
    1: idx('sand', 6), 2: idx('sand', 5), 3: idx('sand', 4), 4: idx('sand', 3),
  };
  return outline(fromMap(map, key, 2), idx('sand', 0));
}

/** Heap of ore lumps: grey stone streaked rust-red, lit from the top-left. 8 x 6 with outline. */
function ore() {
  // r stone light to dark (1-3), o ore bright to dark (4-6), g a glint.
  const map = [
    '..g4..',
    '.1455.',
    '14523r',
    '452356',
  ];
  const key = {
    g: idx('clay', 7), 1: idx('rock', 5), 2: idx('rock', 4), 3: idx('rock', 3), r: idx('rock', 2),
    4: idx('clay', 6), 5: idx('clay', 4), 6: idx('clay', 2),
  };
  return outline(fromMap(map, key, 3), idx('rock', 0));
}

export const sprites = { wood, grain, ore };
export const previews = { wood: [], grain: [], ore: [] };
