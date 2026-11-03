// Palette: ordered color ramps shared by every painter, the LUT builder and the renderer.
//
// Sprite pixels hold indices, never colors: index = 1 + ramp * 8 + shade (0 = transparent).
// Each ramp has 8 shades, darkest first, stepped evenly in perceived lightness (OKLab L) with
// a hue shift from cool darks to warm lights. `good` is the look at alignment +1, `evil` at -1;
// the LUT blends between them. Ramps that must never change with alignment (ink, skin, UI,
// rival village, effects) use one array for both.
//
// Append new ramps at the end only: reordering changes every index already baked into painters.
// At most 31 ramps (index 1 + 30 * 8 + 7 = 248 fits a byte).

const shifting = (name, good, evil) => Object.freeze({ name, shifts: true, good: Object.freeze(good), evil: Object.freeze(evil) });
const neutral = (name, colors) => {
  const arr = Object.freeze(colors);
  return Object.freeze({ name, shifts: false, good: arr, evil: arr });
};

export const RAMPS = Object.freeze([
  // Shared outline and neutral greys. Shade 0 is the outline ink.
  neutral('ink', ['#0a0a11', '#212028', '#3a3842', '#55525e', '#756c78', '#96898d', '#b3a9a6', '#cfc9c4']),
  // Land. Good: muted meadow green (01, 15). Evil: ash-grey and soot-black with dead olive-brown midtones.
  shifting('grass',
    ['#06261a', '#1d3c2a', '#315537', '#4b6f41', '#6b8750', '#8f9f6a', '#b1b78b', '#d2d0aa'],
    ['#0a0705', '#1c1713', '#2f271f', '#453b2e', '#5b5141', '#70685a', '#858076', '#9b9891']),
  // Good: worn earth and paths (06 field). Evil: charred soil, near-black with grey-brown ash tops (06 bottom field).
  shifting('dirt',
    ['#20120d', '#36251e', '#503a2d', '#6b4f3d', '#846750', '#99826b', '#ae9d89', '#c5b9a6'],
    ['#050101', '#0f0605', '#20120e', '#32201a', '#433028', '#534037', '#625349', '#71655d']),
  // Good: pale shore sand (01). Evil: neutral grey ash, matching the ash land.
  shifting('sand',
    ['#483223', '#604936', '#796047', '#937959', '#ac936f', '#c1af8f', '#d6cbb4', '#eee8d5'],
    ['#1a1815', '#322f2c', '#474540', '#5d5a55', '#74726c', '#8b8983', '#a3a19b', '#bbbab4']),
  // Cliffs and boulders. Good: blue-grey slate, teal-grey mids warming to a buff highlight (01 cliffs, 15). Evil: cold charcoal slate, no violet.
  shifting('rock',
    ['#0b141f', '#1c2a32', '#334043', '#4b5756', '#65706b', '#828a80', '#a2a392', '#c9bca8'],
    ['#070b14', '#151a25', '#242a38', '#353c4b', '#464e5f', '#5a6270', '#6f7582', '#848994']),
  // Good: muted sea teal (01, chroma well below the magic ramps). Evil: near-black slate with a faint cold highlight (15 river).
  shifting('water',
    ['#0d1d33', '#123250', '#164a6b', '#1e6383', '#317d98', '#4d97ad', '#6db0be', '#8fc9d0'],
    ['#000103', '#03080f', '#0a151e', '#16232d', '#24333c', '#32424b', '#41565f', '#536e77']),
  // Tree crowns. Good: deep pine and oak greens, cooler and darker than grass (01). Evil: soot-black to dead olive.
  shifting('foliage',
    ['#00110f', '#00261f', '#033d2c', '#195438', '#396b44', '#5e7f56', '#81936f', '#a0aa87'],
    ['#030201', '#0e0b06', '#1c180f', '#2d291a', '#403b27', '#524d39', '#646150', '#777568']),
  // Trunks, timber, roots. Good: brown timber grain (06 barn). Evil: charred near-black wood, ember orange only in the top two shades (06 bottom).
  shifting('bark',
    ['#190b0a', '#2e1c18', '#462d25', '#5f4032', '#755542', '#886d59', '#9a8674', '#af9f8d'],
    ['#020101', '#0c0807', '#1a1513', '#29221f', '#39312d', '#4b403a', '#81462c', '#af5a21']),
  // Player roofs. Good: weathered straw thatch (06 top). Evil: charred, sooty thatch, ember orange only in the top two shades (06 bottom).
  shifting('thatch',
    ['#331e17', '#4a3226', '#664732', '#815d3d', '#9a764f', '#ae916d', '#c0ad90', '#d6c9af'],
    ['#050302', '#130e0b', '#241e1a', '#362f28', '#494138', '#5d5448', '#8b6144', '#b6753b']),
  // Player stonework. Good: pale weathered stone (06 temple, 15 walls). Evil: soot-dark, cool grey stone.
  shifting('stone',
    ['#1f252b', '#323d3e', '#4d564e', '#706d61', '#8f867b', '#a9a398', '#c4c0b7', '#e0ded6'],
    ['#020305', '#0c1013', '#1b2024', '#2b3135', '#3c4448', '#4f575a', '#626b6d', '#7a8284']),
  // Rival village terracotta (15 domes); never shifts: the rival is not the player's to corrupt.
  neutral('clay', ['#2f080f', '#4a1d1e', '#6a2f2a', '#8a4336', '#a85d45', '#bc7c5f', '#cc9d81', '#e2bca0']),
  neutral('skin', ['#371b19', '#51302a', '#6f453a', '#8e5d49', '#aa775c', '#c09579', '#d3b59c', '#ead3bb']),
  // Player villagers' clothes. Good: faded woad blue wool. Evil: torn blood-red cloth (06 bottom banners).
  shifting('cloth-player',
    ['#111426', '#22293e', '#33405a', '#435877', '#567292', '#6f8da6', '#8ea7b7', '#abc2ce'],
    ['#1e0008', '#350813', '#52111b', '#711c21', '#8b3029', '#9c4d3c', '#a66b58', '#b6856f']),
  neutral('cloth-rival', ['#04191e', '#142f33', '#244749', '#35605f', '#4d7974', '#6d9288', '#91a99f', '#b1c3b8']),
  // Creature (21): cracked slate. Good: cool slate grey. Evil: darker, near-black stone.
  shifting('creature-hide',
    ['#090b12', '#1a1d25', '#2c313b', '#3f4752', '#535e69', '#6a757e', '#848d92', '#9ea6a9'],
    ['#05060b', '#101217', '#1c1f25', '#292c33', '#373b42', '#454a50', '#55595f', '#65696f']),
  // Creature seams and chest light (21). Good: soft amber ember. Evil: hot red-orange.
  shifting('creature-accent',
    ['#3f1000', '#5d290a', '#80410b', '#a35c07', '#c07d21', '#d1a35b', '#dfc89b', '#f6ebc9'],
    ['#260002', '#4b0002', '#731202', '#972701', '#ba4106', '#d86105', '#e09457', '#e6bc8b']),
  // Divine hand. Good: translucent icy cyan, deep sea-blue darks to a blue-white core (12). Evil: crimson through ember to pale ash (no pink or magenta).
  shifting('hand-glow',
    ['#0b1f3a', '#103d60', '#175e86', '#257fa8', '#45a2c6', '#72c3de', '#a9e2f0', '#e4fbff'],
    ['#390109', '#620312', '#8d0a17', '#b12e20', '#c9583f', '#a69b92', '#c5b8af', '#ddd8d2']),
  // Crops. Good: ripe wheat (01 fields), a touch more golden than thatch. Evil: blighted, dried stalks (06 bottom field).
  shifting('grain',
    ['#492b0a', '#60421a', '#7b5a20', '#957429', '#ac9040', '#c0ad6a', '#d3ca9a', '#ebe7bf'],
    ['#17090a', '#2b1919', '#412b27', '#593e36', '#6f5347', '#836a5c', '#968374', '#ab9b8b']),
  // Miracle and effect ramps keep their identity at any alignment; saturation lives here.
  neutral('fire', ['#46000c', '#750007', '#9d2300', '#c24600', '#e06f00', '#f49c24', '#f1ce8d', '#fff6cb']),
  neutral('heal', ['#003125', '#004f36', '#006e42', '#1c8f49', '#55ac55', '#91c476', '#c6dbaa', '#eff7d5']),
  neutral('lightning', ['#021f5f', '#243784', '#464eb1', '#6b66d8', '#9385ef', '#b8abf1', '#dad2f1', '#faf7ff']),
  neutral('ui-parchment', ['#4a392d', '#625041', '#7b6754', '#958068', '#ad9b7f', '#c4b69d', '#dbd2bf', '#f4eede']),
  neutral('ui-ink', ['#130807', '#231614', '#352621', '#48362f', '#5b483f', '#6c5b52', '#7c7067', '#8e847b']),
  // Ground shadows: cool near-blacks, drawn as opaque pixels (the sprite format has no alpha).
  neutral('shadow', ['#0a0c14', '#13161f', '#1c212c', '#262c39', '#303946', '#3c4551', '#49525c', '#565f68']),
  // Appended (round 5). Moss in stone crevices and on the creature (21). Good: olive moss, yellower and duller than grass. Evil: withered grey-brown.
  shifting('moss',
    ['#0c1a09', '#222e17', '#394423', '#545b2e', '#707140', '#8c895d', '#a7a17f', '#c3bb9d'],
    ['#0e0705', '#201612', '#33261f', '#46372e', '#5a493e', '#6d5d52', '#7f7267', '#91877d']),
  // Appended (round 5). Cottage walls, cracked plaster (06). Good: lime-washed cream, lighter and creamier than stone,
  // greyer than sand. Evil: soot-stained, yellowed grey (06 bottom row).
  shifting('plaster',
    ['#2f3034', '#504743', '#6c6159', '#857a6d', '#a39785', '#bdb29d', '#dad1bd', '#f4eedd'],
    ['#161518', '#2e2624', '#433a33', '#584e46', '#6e6459', '#847b6f', '#9a9287', '#b1aaa0']),
  // Appended (round 41). The hand's stroke hearts and warm trail (12). Good: muted rose pink, not neon.
  // Evil: dried-blood rose to dusty ash pink.
  shifting('heart',
    ['#2a0a14', '#46162a', '#65233b', '#86344c', '#a64b5e', '#c06a76', '#d6909a', '#ebbcc0'],
    ['#1a0507', '#2e0d10', '#451619', '#5e2224', '#763331', '#8a4943', '#9c645c', '#b08680']),
  // Appended (step 4). The breeder's job colour: the heart ramp's good rose, held at every alignment,
  // so a hand-set breeder's glow reads the same in a good and an evil town.
  neutral('rose', ['#2a0a14', '#46162a', '#65233b', '#86344c', '#a64b5e', '#c06a76', '#d6909a', '#ebbcc0']),
]);

export const SHADES = 8;
export const MAX_RAMPS = 31;

/** Ramp name -> ramp position in RAMPS. */
export const RAMP = Object.freeze(Object.fromEntries(RAMPS.map((r, i) => [r.name, i])));

/**
 * Sprite pixel index for a ramp and shade: 1 + ramp * 8 + shade.
 * `rampName` may be a name ('grass') or a ramp position (number). Shade is clamped to 0..7.
 * Throws on an unknown ramp name: a typo here would otherwise paint transparent holes.
 */
export function idx(rampName, shade) {
  const ramp = typeof rampName === 'number' ? rampName : RAMP[rampName];
  if (!Number.isInteger(ramp) || ramp < 0 || ramp >= RAMPS.length) throw new Error(`palette: unknown ramp ${String(rampName)}`);
  const s = Math.max(0, Math.min(SHADES - 1, Math.round(shade)));
  return 1 + ramp * SHADES + s;
}

/** Inverse of idx: { ramp, shade } for a nonzero pixel index, or null for 0. */
export function rampOf(index) {
  if (!index) return null;
  return { ramp: Math.floor((index - 1) / SHADES), shade: (index - 1) % SHADES };
}
