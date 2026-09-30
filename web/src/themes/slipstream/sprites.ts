/**
 * Procedural 16-bit pixel art, authored the honest way: vehicle bodies are
 * hand-placed pixel maps (built from counted segments so every row is exact),
 * and the driver, race number and boost flames are drawn on top at proper
 * sprite sizes. Six vehicle archetypes, dealt out per host like karts at a
 * party — you can tell the monster truck from the bike at fifty board units.
 */

const hsl = (h: number, s: number, l: number): string => `hsl(${h}, ${s}%, ${l}%)`;

export interface Character {
  pat: number;       // 0 solid, 1 stripe, 2 checkers, 3 star
  spoiler: number;   // legacy, folded into the vehicle now
  num: number;       // race number 1-99
  acc: number;       // accent hue (suit, trim, helmet pattern)
  veh: number;       // vehicle archetype, index into VEHICLES
  drv: number;       // which of the cast is driving, index into DRIVERS
}

/**
 * How big a kart is on the board, in board units. The renderer sizes sprites
 * from KART_H and the race solver builds its collision box from KART_W and
 * KART_L, so the box a kart is shoved out of is the box you can see. The old
 * solver used a half-width of 1.98 per kart against art only 2.9 wide, and the
 * pack bounced off each other across a visible gap.
 */
export const KART_H = 2.9;      // how tall a kart and its driver stand
export const KART_W = 2.9;      // how wide it is across the tyres
export const KART_L = 3.9;      // how long it is nose to tail, from the side art

/** Relative kart width per archetype, multiplied into the world size. */
export const VEH_W = [1.0, 1.12, 0.7, 0.95, 1.24, 1.05];
export const VEH_NAMES = ['STD', 'MUSCLE', 'BIKE', 'BALLOON', 'MONSTER', 'WEDGE'];

/** Avalanche a 32-bit hash, so one changed character changes every field. */
const mix32 = (x: number): number => {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
};

export function characterFor(key: string): Character {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  // Each field gets its own avalanche. Slicing bit-fields out of one FNV hash
  // looked fine until the keys were 'seat0'..'seat7', which differ in a single
  // character: six of the eight seats drew the same driver.
  const a = mix32(h), b = mix32(h ^ 0x9e3779b9), c = mix32(h ^ 0x85ebca6b);
  return {
    pat: a % 4, spoiler: (a >>> 8) % 3, num: 1 + ((b >>> 4) % 99),
    acc: b % 360, veh: (c >>> 6) % 6, drv: c % 8,
  };
}

function sprite(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  return [cv, c];
}

/** One map row from counted [char, n] segments. */
const row = (...segs: Array<[string, number]>): string => segs.map(([c, n]) => c.repeat(n)).join('');

/** Palette slots shared by every vehicle map. */
function palFor(hue: number, acc: number): Record<string, string> {
  return {
    K: '#0b0c10', T: '#3b3e46', R: '#a6adba',
    B: hsl(hue, 72, 42), L: hsl(hue, 80, 58), D: hsl(hue, 70, 26),
    W: hsl(hue, 80, 60), A: hsl(acc, 85, 55), a: hsl(acc, 85, 38),
    P: '#efece1', S: hsl(acc, 68, 46),
    X: hsl(acc, 90, 62), x: hsl(acc, 80, 44),
    O: '#26282f', U: '#ff4040', Y: '#ffd86a',
    M: '#8b919e', m: '#4a4f5a',
  };
}

/** Paint a pixel map centered horizontally into the canvas. */
function paint(c: CanvasRenderingContext2D, map: string[], pal: Record<string, string>, w: number, top = 0): void {
  for (let i = 0; i < map.length; i++) {
    const r = map[i];
    const x0 = Math.floor((w - r.length) / 2);
    for (let x = 0; x < r.length; x++) {
      const px = x0 + x;
      if (px < 0 || px >= w) continue;
      const ch = r[x];
      if (ch === '.') continue;
      const col = pal[ch];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(px, top + i, 1, 1);
    }
  }
}

// ── the grid: eight drivers you can tell apart at fifty board units ───
//
// Each is an 11x12 pixel map. '.' is clear; the letters index a palette built
// per driver, with the racer's own accent hue in the suit so team colours still
// read. G/g are the driver's colour and its shade, W/P an eye and its pupil,
// M a dark line (mouth, visor slot, whiskers), T teeth, N a beak, nose or lens,
// R/r metal, A/a the racing suit.
export interface Driver { name: string; skin: string; shade: string; extra: string; map: string[] }

export const DRIVERS: Driver[] = [
  { name: 'GREMLIN', skin: '#7fe049', shade: '#3f9622', extra: '#fff05a', map: [
    '.G.......G.',
    '.GG.....GG.',
    '.GGGGGGGGG.',
    'GGGGGGGGGGG',
    'GGWPGGGWPGG',
    'GGWWGGGWWGG',
    'GGGGGGGGGGG',
    'GGTTTTTTTGG',
    'GGMMMMMMMGG',
    '.GGGGGGGGG.',
    '..AAAAAAA..',
    '.AAAAAAAAA.',
  ] },
  { name: 'RUSTBUCKET', skin: '#c2ccdb', shade: '#6b7486', extra: '#ff5e3a', map: [
    '.....N.....',
    '.....r.....',
    '.RRRRRRRRR.',
    'RRRRRRRRRRR',
    'RAAAAAAAAAR',
    'RAPPAAAPPAR',
    'RAAAAAAAAAR',
    'RRRRRRRRRRR',
    'RrrRRRRRrrR',
    '.RRRRRRRRR.',
    '..AAAAAAA..',
    '.AAAAAAAAA.',
  ] },
  { name: 'WHISKERS', skin: '#ffa94d', shade: '#b8611c', extra: '#ffe9c4', map: [
    '.GG.....GG.',
    '.GgG...GgG.',
    '.GGGGGGGGG.',
    'GGGGGGGGGGG',
    'GGWPGGGWPGG',
    'GGWWGGGWWGG',
    'GGGGGNGGGGG',
    'MGGGMMMGGGM',
    'GGGGGGGGGGG',
    '.GGGGGGGGG.',
    '..AAAAAAA..',
    '.AAAAAAAAA.',
  ] },
  { name: 'GOGGLES', skin: '#ffc79a', shade: '#b0764a', extra: '#3ee0ff', map: [
    '...........',
    '..aaaaaaa..',
    '.aaaaaaaaa.',
    'GGGGGGGGGGG',
    'GNNNGGGNNNG',
    'GNPNGGGNPNG',
    'GGGGGGGGGGG',
    'GGGGGGGGGGG',
    'GGMMMMMMMGG',
    '.GGGGGGGGG.',
    '..AAAAAAA..',
    '.AAAAAAAAA.',
  ] },
  { name: 'RATTLE', skin: '#f6f4ec', shade: '#a8a49a', extra: '#ff3d63', map: [
    '...........',
    '..GGGGGGG..',
    '.GGGGGGGGG.',
    'GGGGGGGGGGG',
    'GGPPGGGPPGG',
    'GGPPGGGPPGG',
    'GGGGPGGGGGG',
    'GGGGGGGGGGG',
    'GMGMGMGMGMG',
    '.GGGGGGGGG.',
    '..AAAAAAA..',
    '.AAAAAAAAA.',
  ] },
  { name: 'BLOOP', skin: '#6ff5c0', shade: '#2fae7c', extra: '#e07bff', map: [
    '...........',
    '...GGGGG...',
    '..GGGGGGG..',
    '.GGGGGGGGG.',
    'GGGGGGGGGGG',
    'GPPPGGPPPGG',
    'GPPPGGPPPGG',
    'GGPGGGGPGGG',
    'GGGGMGGGGGG',
    '.GGGGGGGGG.',
    '..AAAAAAA..',
    '.AAAAAAAAA.',
  ] },
  { name: 'QUACKERS', skin: '#fffdf2', shade: '#c0bdac', extra: '#ff9c00', map: [
    '..AAAAAAA..',
    '.AAAAAAAAA.',
    'AAAAAAAAAAA',
    '.GGGGGGGGG.',
    'GGWPGGGWPGG',
    'GGWWGGGWWGG',
    'GGGNNNNNGGG',
    'GGGNNNNNGGG',
    'GGGGGGGGGGG',
    '.GGGGGGGGG.',
    '..aaaaaaa..',
    '.aaaaaaaaa.',
  ] },
  { name: 'VISOR', skin: '#f4f1e6', shade: '#a9a69c', extra: '#19e0ff', map: [
    '...........',
    '..AAAAAAA..',
    '.AAAAAAAAA.',
    'AAAAAAAAAAA',
    'AAAAAAAAAAA',
    'ANNNNNNNNNA',
    'ANPNNNNNPNA',
    'AAAAAAAAAAA',
    '.AAAAAAAAA.',
    '.aaaaaaaaa.',
    '..GGGGGGG..',
    '.GGGGGGGGG.',
  ] },
];

const DRIVER_W = 11, DRIVER_H = 12;

/** Palette for one driver, with the racer's accent hue in the suit. */
function drvPal(d: Driver, acc: number): Record<string, string> {
  return {
    G: d.skin, g: d.shade, R: d.skin, r: d.shade,
    W: '#fbfaf4', P: '#14161d', M: '#1b1d25', T: '#fbfaf4',
    N: d.extra, A: hsl(acc, 80, 56), a: hsl(acc, 75, 34),
  };
}

/**
 * Paint a driver into the canvas, centred on cx with its shoulders at baseY.
 * 'squash' narrows the head for the side and front views, which reads as a
 * profile at this size without needing a second set of maps.
 */
function drawDriver(c: CanvasRenderingContext2D, cx: number, baseY: number, ch: Character, squash = 1): void {
  const d = DRIVERS[ch.drv % DRIVERS.length];
  const w = Math.max(5, Math.round(DRIVER_W * squash));
  const cv = document.createElement('canvas');
  cv.width = DRIVER_W; cv.height = DRIVER_H;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  paint(g, d.map, drvPal(d, ch.acc), DRIVER_W, 0);
  c.imageSmoothingEnabled = false;
  c.drawImage(cv, 0, 0, DRIVER_W, DRIVER_H, Math.round(cx - w / 2), Math.round(baseY - DRIVER_H), w, DRIVER_H);
}

/** SMK rule: everything has a thick black outline — draw it around the silhouette. */
function outline(cv: HTMLCanvasElement): void {
  const c = cv.getContext('2d')!;
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < cv.width && y < cv.height && d[(y * cv.width + x) * 4 + 3] > 0;
  const add: number[] = [];
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const i = (y * cv.width + x) * 4;
    if (d[i + 3] > 0) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push(i);
  }
  for (const i of add) { d[i] = 11; d[i + 1] = 12; d[i + 2] = 16; d[i + 3] = 255; }
  c.putImageData(img, 0, 0);
}

// ── race numbers: a hand-made 3×5 digit font, crisp at any zoom ──────
const DIGITS: number[][][] = [
  [[1, 1, 1], [1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 1, 1]],   // 0
  [[0, 1, 0], [1, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 1]],   // 1
  [[1, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 0], [1, 1, 1]],   // 2
  [[1, 1, 1], [0, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1]],   // 3
  [[1, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 0, 1]],   // 4
  [[1, 1, 1], [1, 0, 0], [1, 1, 1], [0, 0, 1], [1, 1, 1]],   // 5
  [[1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1], [1, 1, 1]],   // 6
  [[1, 1, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],   // 7
  [[1, 1, 1], [1, 0, 1], [1, 1, 1], [1, 0, 1], [1, 1, 1]],   // 8
  [[1, 1, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1]],   // 9
];

/** Rear number plate: white rectangle mounted dead centre, digits inside. */
function drawPlate(c: CanvasRenderingContext2D, cx: number, y: number, num: number): void {
  const s = String(num);
  const dw = s.length * 4 - 1;
  const x0 = cx - Math.floor(dw / 2) - 1;
  c.fillStyle = '#101116';
  c.fillRect(x0 - 1, y - 1, dw + 4, 8);
  c.fillStyle = '#efece1';
  c.fillRect(x0, y, dw + 2, 6);
  c.fillStyle = '#101116';
  for (let i = 0; i < s.length; i++) {
    const d = DIGITS[+s[i]];
    for (let r = 0; r < 5; r++) for (let x = 0; x < 3; x++) {
      if (d[r][x]) c.fillRect(x0 + i * 4 + x, y + 1 + r, 1, 1);
    }
  }
}

// ── rear-view vehicle maps (32 wide, centered) ────────────────────────
// SMK silhouette: fat tyres running full height, huge helmet above a white
// number plate mounted on the rear panel, wing/struts, diffuser at the axle.
type MapDef = { map: string[]; helmet: [number, number]; plate: [number, number] };

// body rows are pre-built segment arrays
type Seg = [string, number];
const tireRow = (mid: Seg[], solid = false): string =>
  row(['K', 1], ...(solid ? ([['T', 4]] as Seg[]) : ([['T', 1], ['R', 2], ['T', 1]] as Seg[])), ['K', 1],
      ...mid,
      ['K', 1], ...(solid ? ([['T', 4]] as Seg[]) : ([['T', 1], ['R', 2], ['T', 1]] as Seg[])), ['K', 1]);
const tire7 = (mid: Seg[], solid = false): string =>
  row(['K', 1], ...(solid ? ([['T', 5]] as Seg[]) : ([['T', 1], ['R', 3], ['T', 1]] as Seg[])), ['K', 1],
      ...mid,
      ['K', 1], ...(solid ? ([['T', 5]] as Seg[]) : ([['T', 1], ['R', 3], ['T', 1]] as Seg[])), ['K', 1]);

const DIFF18: Seg[] = [['m', 2], ['D', 4], ['m', 2], ['D', 4], ['m', 2], ['D', 4]];
const DIFF20: Seg[] = [['m', 2], ['D', 4], ['m', 2], ['D', 4], ['m', 2], ['D', 4], ['m', 2]];

const REAR: MapDef[] = [
  // 0 STD — wing, 6px tyres, rear panel for the plate
  {
    map: [
      row(['W', 22]),
      row(['W', 1], ['L', 20], ['W', 1]),
      row(['K', 2], ['.', 18], ['K', 2]),
      row(['D', 20]),
      row(['D', 1], ['L', 18], ['D', 1]),
      row(['S', 20]),
      row(['.', 1], ['K', 4], ['.', 1], ['D', 20], ['.', 1], ['K', 4], ['.', 1]),
      tireRow([['D', 1], ['B', 18], ['D', 1]]),
      tireRow([['D', 1], ['B', 18], ['D', 1]]),
      tireRow([['D', 1], ['B', 18], ['D', 1]]),
      tireRow([['U', 1], ['D', 18], ['U', 1]]),
      tireRow([['D', 1], ['B', 18], ['D', 1]]),
      tireRow(DIFF20, true),
      row(['K', 1], ['T', 4], ['K', 1], ['.', 20], ['K', 1], ['T', 4], ['K', 1]),
      row(['.', 1], ['K', 4], ['.', 1], ['.', 20], ['.', 1], ['K', 4], ['.', 1]),
    ],
    helmet: [12, 3], plate: [16, 9],
  },
  // 1 MUSCLE — 7px fat tyres, tall spoiler, accent stripes
  {
    map: [
      row(['W', 26]),
      row(['W', 1], ['A', 24], ['W', 1]),
      row(['K', 2], ['.', 20], ['K', 2]),
      row(['D', 22]),
      row(['D', 1], ['L', 20], ['D', 1]),
      row(['A', 20]),
      row(['S', 18]),
      row(['.', 1], ['K', 5], ['.', 1], ['D', 18], ['.', 1], ['K', 5], ['.', 1]),
      tire7([['D', 1], ['B', 16], ['D', 1]]),
      tire7([['D', 1], ['B', 16], ['D', 1]]),
      tire7([['D', 1], ['B', 16], ['D', 1]]),
      tire7([['U', 1], ['D', 16], ['U', 1]]),
      tire7([['D', 1], ['B', 16], ['D', 1]]),
      tire7(DIFF18, true),
      row(['K', 7], ['.', 18], ['K', 7]),
      row(['K', 6], ['.', 20], ['K', 6]),
    ],
    helmet: [12, 4], plate: [16, 10],
  },
  // 2 BIKE — single fat centre wheel, slim rider, twin high pipes
  {
    map: [
      row(['.', 12], ['D', 8], ['.', 12]),
      row(['.', 11], ['D', 1], ['L', 6], ['D', 1], ['.', 13]),
      row(['.', 12], ['S', 8], ['.', 12]),
      row(['.', 9], ['O', 2], ['.', 2], ['D', 6], ['.', 2], ['O', 2], ['.', 9]),
      row(['.', 8], ['D', 16], ['.', 8]),
      row(['.', 7], ['D', 1], ['L', 6], ['.', 1], ['U', 1], ['.', 1], ['L', 6], ['D', 1], ['.', 8]),
      row(['.', 10], ['B', 12], ['.', 10]),
      row(['.', 10], ['D', 12], ['.', 10]),
      row(['.', 13], ['K', 6], ['.', 13]),
      row(['.', 12], ['K', 1], ['T', 4], ['K', 1], ['.', 12]),
      row(['.', 12], ['K', 1], ['T', 1], ['R', 2], ['T', 1], ['K', 1], ['.', 12]),
      row(['.', 12], ['K', 1], ['T', 4], ['K', 1], ['.', 12]),
      row(['.', 13], ['K', 6], ['.', 13]),
    ],
    helmet: [12, 1], plate: [16, 5],
  },
  // 3 BALLOON — two bright balloons on strings over a small kart
  {
    map: [
      row(['X', 7], ['.', 8], ['X', 7]),
      row(['X', 1], ['x', 5], ['X', 1], ['.', 8], ['X', 1], ['x', 5], ['X', 1]),
      row(['x', 5], ['.', 8], ['x', 5]),
      row(['.', 3], ['x', 1], ['.', 12], ['x', 1], ['.', 3]),
      row(['.', 4], ['x', 1], ['.', 10], ['x', 1], ['.', 4]),
      row(['.', 6], ['D', 20], ['.', 6]),
      row(['.', 6], ['D', 1], ['L', 18], ['D', 1], ['.', 6]),
      row(['.', 6], ['S', 20], ['.', 6]),
      row(['.', 2], ['K', 4], ['.', 1], ['D', 1], ['B', 16], ['D', 1], ['.', 1], ['K', 4], ['.', 2]),
      row(['K', 1], ['T', 3], ['K', 1], ['D', 1], ['B', 16], ['D', 1], ['K', 1], ['T', 3], ['K', 1]),
      row(['K', 1], ['T', 1], ['R', 2], ['T', 1], ['K', 1], ['D', 1], ['B', 16], ['D', 1], ['K', 1], ['T', 1], ['R', 2], ['T', 1], ['K', 1]),
      row(['K', 1], ['T', 3], ['K', 1], ['U', 1], ['D', 14], ['U', 1], ['K', 1], ['T', 3], ['K', 1]),
      row(['K', 1], ['T', 3], ['K', 1], ['m', 2], ['D', 2], ['m', 2], ['D', 2], ['m', 2], ['D', 2], ['m', 2], ['K', 1], ['T', 3], ['K', 1]),
      row(['.', 2], ['K', 4], ['.', 1], ['.', 16], ['.', 1], ['K', 4], ['.', 2]),
    ],
    helmet: [12, 6], plate: [16, 10],
  },
  // 4 MONSTER — knobby 7px tyres riding absurdly high
  {
    map: [
      row(['.', 6], ['D', 20], ['.', 6]),
      row(['.', 6], ['D', 1], ['L', 18], ['D', 1], ['.', 6]),
      row(['.', 6], ['A', 18], ['.', 6]),
      row(['.', 6], ['S', 18], ['.', 6]),
      row(['.', 6], ['D', 1], ['B', 18], ['D', 1], ['.', 6]),
      row(['K', 7], ['.', 1], ['D', 16], ['.', 1], ['K', 7]),
      row(['K', 1], ['T', 1], ['K', 1], ['T', 3], ['K', 1], ['D', 1], ['B', 16], ['D', 1], ['K', 1], ['T', 3], ['K', 1], ['T', 1], ['K', 1]),
      tire7([['D', 1], ['B', 16], ['D', 1]]),
      tire7([['U', 1], ['D', 16], ['U', 1]]),
      tire7(DIFF18, true),
      row(['K', 7], ['.', 18], ['K', 7]),
      row(['K', 1], ['T', 1], ['K', 1], ['T', 1], ['K', 1], ['T', 1], ['K', 1], ['.', 18], ['K', 1], ['T', 1], ['K', 1], ['T', 1], ['K', 1], ['T', 1], ['K', 1]),
      row(['K', 7], ['.', 18], ['K', 7]),
    ],
    helmet: [12, 0], plate: [16, 7],
  },
  // 5 WEDGE — low and wide, spoiler blades, diffuser teeth
  {
    map: [
      row(['.', 4], ['W', 2], ['.', 20], ['W', 2], ['.', 4]),
      row(['.', 4], ['W', 2], ['.', 20], ['W', 2], ['.', 4]),
      row(['D', 24]),
      row(['D', 1], ['L', 1], ['A', 18], ['L', 1], ['D', 1]),
      row(['S', 20]),
      row(['.', 1], ['K', 4], ['.', 1], ['D', 1], ['B', 18], ['D', 1], ['.', 1], ['K', 4], ['.', 1]),
      tireRow([['D', 1], ['A', 1], ['B', 14], ['A', 1], ['D', 1]]),
      tireRow([['D', 1], ['B', 18], ['D', 1]]),
      tireRow([['U', 1], ['D', 18], ['U', 1]]),
      tireRow([['m', 2], ['D', 4], ['m', 2], ['D', 4], ['m', 2], ['D', 4]], true),
      row(['.', 1], ['K', 4], ['.', 1], ['.', 18], ['.', 1], ['K', 4], ['.', 1]),
    ],
    helmet: [12, 2], plate: [16, 7],
  },
];

// ── side-view vehicle maps (40 wide, facing right) ────────────────────
const SIDEMAP = (rows: string[]): string[] => rows;

const SIDE: MapDef[] = [
  // 0 STD
  { map: SIDEMAP([
    row(['.', 1], ['W', 6], ['.', 33]),
    row(['.', 1], ['W', 1], ['L', 4], ['W', 1], ['.', 33]),
    row(['.', 2], ['K', 1], ['.', 2], ['K', 1], ['.', 34]),
    row(['.', 15], ['D', 6], ['.', 19]),
    row(['.', 14], ['D', 1], ['L', 6], ['D', 1], ['.', 18]),
    row(['.', 12], ['S', 8], ['.', 20]),
    row(['.', 8], ['O', 2], ['.', 1], ['D', 16], ['Y', 1], ['.', 12]),
    row(['.', 2], ['.', 2], ['K', 7], ['.', 20], ['K', 7], ['.', 4]),
    row(['.', 1], ['K', 7], ['D', 1], ['B', 20], ['D', 1], ['K', 7], ['.', 3]),
    row(['.', 1], ['K', 3], ['R', 2], ['K', 2], ['D', 1], ['B', 20], ['D', 1], ['K', 3], ['R', 2], ['K', 2], ['.', 3]),
    row(['.', 1], ['K', 7], ['m', 2], ['D', 2], ['m', 2], ['D', 2], ['m', 2], ['D', 2], ['m', 2], ['K', 7], ['.', 3]),
    row(['.', 2], ['.', 1], ['K', 5], ['.', 1], ['.', 22], ['.', 1], ['K', 5], ['.', 1], ['.', 4]),
    row(['.', 3], ['.', 2], ['K', 3], ['.', 2], ['.', 22], ['.', 2], ['K', 3], ['.', 2], ['.', 5]),
  ]), helmet: [13, 1], plate: [0, 0] },
  // 1 MUSCLE — long low body, big wing, fat wheels
  { map: SIDEMAP([
    row(['.', 1], ['W', 8], ['.', 31]),
    row(['.', 1], ['A', 8], ['.', 31]),
    row(['.', 2], ['K', 1], ['.', 2], ['K', 1], ['.', 34]),
    row(['.', 16], ['D', 6], ['.', 18]),
    row(['.', 14], ['D', 1], ['L', 8], ['D', 1], ['.', 16]),
    row(['.', 11], ['D', 1], ['A', 1], ['S', 6], ['A', 1], ['D', 1], ['.', 19]),
    row(['.', 6], ['D', 1], ['A', 1], ['B', 23], ['Y', 1], ['A', 1], ['D', 1], ['.', 6]),
    row(['.', 2], ['K', 7], ['D', 1], ['B', 24], ['K', 7], ['.', 4]),
    row(['.', 2], ['K', 3], ['R', 2], ['K', 2], ['D', 1], ['A', 1], ['B', 22], ['A', 1], ['K', 3], ['R', 2], ['K', 2], ['.', 4]),
    row(['.', 2], ['K', 7], ['m', 26], ['K', 7], ['.', 4]),
    row(['.', 3], ['.', 1], ['K', 5], ['.', 1], ['.', 22], ['.', 1], ['K', 5], ['.', 1], ['.', 5]),
    row(['.', 4], ['.', 2], ['K', 3], ['.', 2], ['.', 22], ['.', 2], ['K', 3], ['.', 2], ['.', 5]),
  ]), helmet: [15, 2], plate: [0, 0] },
  // 2 BIKE — two wheels, low slim everything
  { map: SIDEMAP([
    row(['.', 16], ['D', 5], ['.', 19]),
    row(['.', 15], ['D', 1], ['L', 5], ['D', 1], ['.', 18]),
    row(['.', 15], ['S', 6], ['.', 19]),
    row(['.', 15], ['S', 6], ['.', 19]),
    row(['.', 11], ['O', 2], ['.', 2], ['D', 8], ['Y', 1], ['.', 16]),
    row(['.', 7], ['K', 1], ['T', 3], ['K', 1], ['.', 2], ['D', 1], ['B', 10], ['D', 1], ['.', 2], ['K', 1], ['T', 3], ['K', 1], ['.', 7]),
    row(['.', 7], ['K', 1], ['T', 1], ['R', 2], ['T', 1], ['K', 1], ['.', 2], ['D', 1], ['B', 10], ['D', 1], ['.', 2], ['K', 1], ['T', 1], ['R', 2], ['T', 1], ['K', 1], ['.', 5]),
    row(['.', 7], ['K', 1], ['T', 3], ['K', 1], ['.', 2], ['m', 10], ['.', 2], ['K', 1], ['T', 3], ['K', 1], ['.', 7]),
    row(['.', 8], ['K', 5], ['.', 14], ['K', 5], ['.', 8]),
  ]), helmet: [14, 0], plate: [0, 0] },
  // 3 BALLOON
  { map: SIDEMAP([
    row(['.', 9], ['X', 7], ['.', 24]),
    row(['.', 8], ['X', 1], ['x', 5], ['X', 1], ['.', 25]),
    row(['.', 9], ['x', 5], ['.', 26]),
    row(['.', 13], ['x', 1], ['.', 26]),
    row(['.', 14], ['D', 6], ['.', 20]),
    row(['.', 13], ['D', 1], ['L', 6], ['D', 1], ['.', 19]),
    row(['.', 11], ['S', 8], ['.', 21]),
    row(['.', 9], ['D', 14], ['Y', 1], ['.', 16]),
    row(['.', 3], ['.', 1], ['K', 5], ['.', 1], ['.', 1], ['D', 1], ['B', 18], ['D', 1], ['.', 1], ['.', 1], ['K', 5], ['.', 1], ['.', 6]),
    row(['.', 3], ['K', 3], ['R', 2], ['K', 2], ['D', 1], ['B', 18], ['D', 1], ['K', 3], ['R', 2], ['K', 2], ['.', 6]),
    row(['.', 4], ['.', 1], ['K', 5], ['.', 1], ['m', 2], ['D', 2], ['m', 2], ['D', 2], ['m', 2], ['.', 1], ['K', 5], ['.', 1], ['.', 7]),
    row(['.', 5], ['.', 2], ['K', 3], ['.', 2], ['.', 22], ['.', 2], ['K', 3], ['.', 2], ['.', 7]),
  ]), helmet: [13, 5], plate: [0, 0] },
  // 4 MONSTER — wheels bigger than the kart
  { map: SIDEMAP([
    row(['.', 6], ['D', 22], ['.', 12]),
    row(['.', 6], ['D', 1], ['L', 20], ['D', 1], ['.', 12]),
    row(['.', 6], ['A', 20], ['.', 14]),
    row(['.', 10], ['S', 12], ['.', 18]),
    row(['.', 5], ['K', 3], ['.', 2], ['D', 2], ['B', 18], ['D', 2], ['.', 2], ['K', 3], ['.', 3]),
    row(['.', 4], ['K', 1], ['T', 1], ['K', 1], ['T', 1], ['K', 1], ['.', 1], ['D', 2], ['B', 18], ['D', 2], ['.', 1], ['K', 1], ['T', 1], ['K', 1], ['T', 1], ['K', 1], ['.', 2]),
    row(['.', 4], ['K', 5], ['T', 1], ['D', 2], ['B', 18], ['D', 2], ['T', 1], ['K', 5], ['.', 2]),
    row(['.', 4], ['K', 3], ['R', 2], ['K', 2], ['m', 2], ['D', 2], ['m', 14], ['D', 2], ['m', 2], ['K', 3], ['R', 2], ['K', 2], ['.', 2]),
    row(['.', 4], ['K', 7], ['.', 20], ['K', 7], ['.', 2]),
    row(['.', 5], ['.', 1], ['K', 5], ['.', 1], ['.', 22], ['.', 1], ['K', 5], ['.', 1], ['.', 4]),
    row(['.', 5], ['K', 7], ['.', 20], ['K', 7], ['.', 2]),
    row(['.', 6], ['K', 7], ['.', 20], ['K', 7], ['.', 3]),
  ]), helmet: [14, 0], plate: [0, 0] },
  // 5 WEDGE — a plank with wheels
  { map: SIDEMAP([
    row(['.', 3], ['W', 3], ['.', 34]),
    row(['.', 13], ['D', 8], ['.', 19]),
    row(['.', 11], ['D', 1], ['L', 1], ['A', 8], ['L', 1], ['D', 1], ['.', 17]),
    row(['.', 10], ['S', 8], ['.', 22]),
    row(['.', 7], ['D', 1], ['A', 1], ['B', 21], ['Y', 1], ['D', 1], ['.', 8]),
    row(['.', 4], ['.', 1], ['K', 5], ['.', 1], ['D', 1], ['B', 22], ['.', 1], ['K', 5], ['.', 1], ['.', 5]),
    row(['.', 4], ['K', 3], ['R', 2], ['K', 2], ['D', 1], ['m', 1], ['D', 20], ['K', 3], ['R', 2], ['K', 2], ['.', 5]),
    row(['.', 5], ['.', 1], ['K', 5], ['.', 1], ['m', 2], ['D', 1], ['m', 2], ['D', 1], ['m', 2], ['.', 1], ['K', 5], ['.', 1], ['.', 6]),
    row(['.', 6], ['.', 2], ['K', 3], ['.', 2], ['.', 22], ['.', 2], ['K', 3], ['.', 2], ['.', 6]),
  ]), helmet: [12, 0], plate: [0, 0] },
];

const RW = 32, SW = 40;

/**
 * Spinning rubber: bright tread bands marching down each tyre, phase-driven.
 * Rects are the tyre faces per archetype in canvas coords [x0, x1, y0, y1].
 */
const WHEEL_BANDS: Array<Array<[number, number, number, number]>> = [
  [[0, 5, 8, 13], [26, 31, 8, 13]],
  [[0, 6, 9, 14], [25, 31, 9, 14]],
  [[12, 19, 9, 13]],
  [[0, 5, 9, 13], [26, 31, 9, 13]],
  [[0, 6, 6, 14], [25, 31, 6, 14]],
  [[0, 5, 6, 11], [26, 31, 6, 11]],
];

function wheelSpin(cv: HTMLCanvasElement, veh: number, wf: number): void {
  if (!wf) return;
  const c = cv.getContext('2d')!;
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (const [x0, x1, y0, y1] of WHEEL_BANDS[veh]) {
    const h = y1 - y0 + 1;
    const b1 = y0 + Math.floor((wf % 4) * h / 4) % h;
    const b2 = y0 + (Math.floor((wf % 4) * h / 4) + Math.floor(h / 2)) % h;
    for (const y of [b1, b2]) for (let x = x0 + 1; x < x1; x++) {
      const i = (y * cv.width + x) * 4;
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (d[i + 3] > 0 && l < 95) { d[i] = 122; d[i + 1] = 129; d[i + 2] = 141; }   // tread glint
    }
  }
  c.putImageData(img, 0, 0);
}

/**
 * One canvas height for every view of a kart. The body is bottom-aligned in it
 * and the driver sits in the headroom above, so a kart is the same size on the
 * board whichever way it happens to be facing.
 */
const KART_PX_H = 30;
/** Rows of the body the driver's shoulders sink into, so it looks seated. */
const SEAT_SINK = 3;

/** Rear view of the driver's machine, assembled from map + driver + number. */
export function kartRear(hue: number, ch: Character, wf = 0): HTMLCanvasElement {
  const def = REAR[ch.veh];
  const [cv, c] = sprite(RW, KART_PX_H);
  const top = KART_PX_H - def.map.length - 1;
  paint(c, def.map, palFor(hue, ch.acc), RW, top);
  wheelSpin(cv, ch.veh, wf);
  if (def.plate[1]) drawPlate(c, def.plate[0], def.plate[1] + top, ch.num);
  drawDriver(c, RW / 2, top + def.helmet[1] + SEAT_SINK, ch);
  outline(cv);
  return cv;
}

/** Front view: the side profile mirrored (you only glimpse it when passing). */
export function kartFront(hue: number, ch: Character): HTMLCanvasElement {
  const base = kartSide(hue, ch);
  const [cv, c] = sprite(base.width, base.height);
  c.translate(base.width, 0);
  c.scale(-1, 1);
  c.drawImage(base, 0, 0);
  return cv;
}

/** Side view, facing right. */
export function kartSide(hue: number, ch: Character): HTMLCanvasElement {
  const def = SIDE[ch.veh];
  const [cv, c] = sprite(SW, KART_PX_H);
  const top = KART_PX_H - def.map.length - 1;
  paint(c, def.map, palFor(hue, ch.acc), SW, top);
  // narrower head: a profile, without a second set of maps
  drawDriver(c, def.helmet[0] + 4, top + def.helmet[1] + SEAT_SINK, ch, 0.66);
  outline(cv);
  return cv;
}

// ── trackside: the circuit has an audience ───────────────────────────

/** A head from the cast, shoulders and all, for a face in the crowd. */
function castHead(c: CanvasRenderingContext2D, x: number, y: number, drv: number, acc: number, rows = 10): void {
  const d = DRIVERS[drv % DRIVERS.length];
  const pal = drvPal(d, acc);
  for (let i = 0; i < Math.min(rows, d.map.length); i++) {
    const r = d.map[i];
    for (let k = 0; k < r.length; k++) {
      const col = pal[r[k]];
      if (!col || r[k] === '.') continue;
      c.fillStyle = col;
      c.fillRect(x + k, y + i, 1, 1);
    }
  }
}

/**
 * A packed grandstand: a tiered block with a crowd in it. `wave` shifts which
 * rows are standing, so the stand ripples as you go past instead of sitting
 * there as wallpaper.
 */
export function stand(hue: number, wave: number, seed: number): HTMLCanvasElement {
  const W = 84, H = 46;
  const [cv, c] = sprite(W, H);
  // the structure
  c.fillStyle = '#2a2f3c'; c.fillRect(0, 10, W, H - 10);
  c.fillStyle = hsl(hue, 55, 34); c.fillRect(0, H - 8, W, 8);       // skirt
  c.fillStyle = hsl(hue, 70, 52); c.fillRect(0, H - 8, W, 2);       // trim
  // roof
  c.fillStyle = '#171a24'; c.fillRect(-2, 4, W + 4, 7);
  c.fillStyle = hsl(hue, 65, 44); c.fillRect(-2, 4, W + 4, 2);
  for (let x = 4; x < W; x += 20) { c.fillStyle = '#171a24'; c.fillRect(x, 11, 2, H - 19); }
  // four tiers of heads, back rows higher and dimmer
  let h = seed >>> 0;
  const rnd = (): number => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
  for (let row = 0; row < 4; row++) {
    const y = 14 + row * 7;
    const bob = ((wave + row) % 3 === 0) ? -1 : 0;    // a rolling wave, not a strobe
    for (let x = 2; x < W - 8; x += 7) {
      const drv = (rnd() * 8) | 0;
      const acc = (rnd() * 360) | 0;
      c.save();
      c.globalAlpha = 0.55 + row * 0.15;
      c.translate(x + (rnd() < 0.5 ? 0 : 1), y + bob);
      c.scale(0.55, 0.55);
      castHead(c, 0, 0, drv, acc, 9);
      c.restore();
    }
  }
  outline(cv);
  return cv;
}

/** One fan up against the fence, arms up. */
export function fan(drv: number, acc: number, up: boolean): HTMLCanvasElement {
  const [cv, c] = sprite(16, 22);
  castHead(c, 3, up ? 3 : 4, drv, acc, 12);
  // arms, raised on the up frame
  c.fillStyle = hsl(acc, 80, 56);
  if (up) { c.fillRect(1, 4, 2, 5); c.fillRect(13, 4, 2, 5); }
  else { c.fillRect(1, 10, 2, 5); c.fillRect(13, 10, 2, 5); }
  outline(cv);
  return cv;
}

/** A pine by the fence: cheap depth, and it tells you how fast you are going. */
export function tree(seed: number): HTMLCanvasElement {
  const [cv, c] = sprite(20, 34);
  const g = 92 + (seed % 5) * 7;
  c.fillStyle = '#4a3320'; c.fillRect(8, 26, 4, 8);
  for (let i = 0; i < 4; i++) {
    const w = 18 - i * 3, y = 24 - i * 6;
    c.fillStyle = `hsl(${g}, ${46 + i * 5}%, ${20 + i * 5}%)`;
    c.fillRect((20 - w) / 2, y, w, 8);
  }
  outline(cv);
  return cv;
}

/** A balloon arch marker, the kind that flaps over a kart circuit. */
export function balloons(hue: number): HTMLCanvasElement {
  const [cv, c] = sprite(22, 30);
  c.fillStyle = '#c9cdd6'; c.fillRect(10, 14, 2, 16);
  for (let i = 0; i < 5; i++) {
    const a = (i / 4) * Math.PI;
    const x = 11 - Math.cos(a) * 9, y = 12 - Math.sin(a) * 9;
    c.fillStyle = hsl((hue + i * 62) % 360, 88, 58);
    c.beginPath(); c.arc(x, y, 3.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(x - 2, y - 2, 1, 1);
  }
  outline(cv);
  return cv;
}

/** A marshal post: a striped board and somebody waving behind it. */
export function marshal(drv: number, acc: number, up: boolean): HTMLCanvasElement {
  const [cv, c] = sprite(20, 26);
  c.fillStyle = '#e9e6dc'; c.fillRect(0, 12, 20, 10);
  c.fillStyle = '#b03a2e';
  for (let x = 0; x < 20; x += 6) c.fillRect(x, 12, 3, 10);
  castHead(c, 5, up ? 0 : 1, drv, acc, 11);
  outline(cv);
  return cv;
}

/** A stack of tyres on the apex. */
export function tyres(): HTMLCanvasElement {
  const [cv, c] = sprite(20, 16);
  for (let r = 0; r < 3; r++) {
    const y = 13 - r * 4, w = 18 - r * 3;
    c.fillStyle = r === 1 ? '#c9cdd6' : '#25272e';
    c.fillRect((20 - w) / 2, y, w, 4);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect((20 - w) / 2, y, w, 1);
  }
  outline(cv);
  return cv;
}

/** The warm halo around a kart that has picked up a star. */
export function star(): HTMLCanvasElement {
  const [cv, c] = sprite(36, 36);
  const g = c.createRadialGradient(18, 18, 2, 18, 18, 18);
  g.addColorStop(0, 'rgba(255, 246, 190, 0.95)');
  g.addColorStop(0.45, 'rgba(255, 208, 70, 0.55)');
  g.addColorStop(1, 'rgba(255, 170, 40, 0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 36, 36);
  // five points, so it reads as a star and not just a blob
  c.fillStyle = 'rgba(255, 250, 220, 0.9)';
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
    c.fillRect(18 + Math.cos(a) * 13 - 1.5, 18 + Math.sin(a) * 13 - 1.5, 3, 3);
  }
  return cv;
}

/** Ground shadow: SMK never lets a sprite float — every kart sits on one. */
export function shadow(): HTMLCanvasElement {
  const [cv, c] = sprite(28, 12);
  c.fillStyle = 'rgba(5, 6, 10, 0.42)';
  c.beginPath(); c.ellipse(14, 6, 13, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(5, 6, 10, 0.30)';
  c.beginPath(); c.ellipse(14, 6, 9, 3.4, 0, 0, Math.PI * 2); c.fill();
  return cv;
}

/** Twin boost flames, flickering — every boosted racer announces itself. */
export function flame(): HTMLCanvasElement {
  const [cv, c] = sprite(16, 12);
  const cols = ['#ffe98a', '#ff8a3c', '#d0432c'];
  for (const x0 of [2, 10]) {
    for (let y = 0; y < 10; y++) {
      const w = Math.max(0, 4 - Math.floor(y / 2.6));
      c.fillStyle = cols[Math.min(2, Math.floor(y / 4))];
      c.fillRect(x0 + 2 - Math.ceil(w / 2), y, w, 1);
    }
  }
  return cv;
}

/** The red shell: it flies, it homes, it should not be this fast. */
export function shell(color = '#d0262c', dark = '#7a1216'): HTMLCanvasElement {
  const [cv, c] = sprite(20, 14);
  c.fillStyle = dark; c.beginPath(); c.arc(11, 7, 6, 0, Math.PI * 2); c.fill();
  c.fillStyle = color; c.beginPath(); c.arc(11, 7, 4.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffd86a'; c.fillRect(13, 5, 2, 4);          // wing stripe
  c.fillStyle = '#ff8a3c'; c.fillRect(0, 5, 5, 3);           // rocket flames
  c.fillStyle = '#ffe98a'; c.fillRect(1, 6, 3, 1);
  c.fillStyle = '#f4f2ea'; c.fillRect(15, 6, 3, 2);          // nose cone
  return cv;
}

/** Oil slick: a block's calling card. */
export function oil(): HTMLCanvasElement {
  const [cv, c] = sprite(24, 12);
  c.fillStyle = '#0c0d12';
  c.beginPath(); c.ellipse(12, 6, 11, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3b2a55';
  c.beginPath(); c.ellipse(9, 5, 4, 1.6, 0.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#22534a';
  c.beginPath(); c.ellipse(15, 7, 3, 1.2, -0.3, 0, Math.PI * 2); c.fill();
  return cv;
}

/** The floating item box under the gantries. */
/**
 * The item box: a translucent cube with an iridescent shell and a '?' floating
 * inside it. `phase` rolls the hue so the box shimmers as it spins, which is
 * the whole point of the thing - it used to be 16x16 of three browns with an
 * 8px question mark, which reads as a crate.
 */
export function itemBox(phase = 0): HTMLCanvasElement {
  const N = 24;
  const [cv, c] = sprite(N, N);
  const h0 = (phase * 360) % 360;
  // shell: four nested rings, each a step further round the wheel
  for (let r = 0; r < 4; r++) {
    c.fillStyle = hsl((h0 + r * 42) % 360, 92, 60 - r * 6);
    c.fillRect(1 + r, 1 + r, N - 2 - r * 2, N - 2 - r * 2);
  }
  // glassy middle so the '?' sits inside the box rather than on it
  c.fillStyle = 'rgba(16, 12, 30, 0.55)';
  c.fillRect(5, 5, N - 10, N - 10);
  // corner studs, the SMK tell
  c.fillStyle = '#fffbe8';
  for (const [x, y] of [[1, 1], [N - 3, 1], [1, N - 3], [N - 3, N - 3]]) c.fillRect(x, y, 2, 2);
  // the mark: drawn as pixels so it stays crisp at any zoom
  const Q = [
    '.###.',
    '#...#',
    '...#.',
    '..#..',
    '..#..',
    '.....',
    '..#..',
  ];
  const qx = (N - 5) / 2 | 0, qy = 6;
  c.fillStyle = '#120f1e';
  for (let y = 0; y < Q.length; y++) for (let x = 0; x < 5; x++) {
    if (Q[y][x] !== '#') continue;
    c.fillRect(qx + x - 1, qy + y, 3, 1);          // shadow, one pixel out
  }
  c.fillStyle = '#fffbe8';
  for (let y = 0; y < Q.length; y++) for (let x = 0; x < 5; x++) {
    if (Q[y][x] === '#') c.fillRect(qx + x, qy + y, 1, 1);
  }
  // top-face highlight
  c.fillStyle = 'rgba(255, 255, 255, 0.55)';
  c.fillRect(4, 3, N - 8, 1);
  c.fillStyle = 'rgba(255, 255, 255, 0.22)';
  c.fillRect(3, 4, 2, N - 8);
  return cv;
}

/** Banana: small, silly, ruinous. */
export function banana(): HTMLCanvasElement {
  const [cv, c] = sprite(14, 9);
  c.fillStyle = '#f2c53c';
  c.fillRect(2, 4, 10, 3); c.fillRect(1, 3, 3, 2); c.fillRect(10, 2, 3, 2);
  c.fillStyle = '#c79a20'; c.fillRect(2, 6, 10, 1);
  c.fillStyle = '#6b4a12'; c.fillRect(1, 2, 2, 1);
  return cv;
}

/** Boost mushroom. */
export function mushroom(): HTMLCanvasElement {
  const [cv, c] = sprite(14, 12);
  c.fillStyle = '#c72c30'; c.fillRect(1, 1, 12, 6);
  c.fillRect(0, 3, 14, 3);
  c.fillStyle = '#f2ece0';
  c.fillRect(3, 2, 2, 2); c.fillRect(8, 1, 3, 2); c.fillRect(6, 4, 2, 2);
  c.fillStyle = '#e6cfae'; c.fillRect(4, 7, 6, 4);
  c.fillStyle = '#2a1a10'; c.fillRect(5, 8, 1, 2); c.fillRect(8, 8, 1, 2);
  return cv;
}

/** A name + position tag floating over the kart. */
export function label(name: string, rank: number, hue: number): HTMLCanvasElement {
  const text = `P${rank} ${name.length > 11 ? name.slice(0, 10) + '…' : name}`;
  const w = Math.max(30, text.length * 4 + 6);
  const [cv, c] = sprite(w, 9);
  c.fillStyle = 'rgba(6, 8, 12, 0.62)';
  c.fillRect(0, 0, w, 9);
  c.fillStyle = `hsl(${hue}, 85%, 62%)`;
  c.fillRect(0, 0, w, 1);
  c.fillStyle = '#f2efe4';
  c.font = 'bold 6px monospace';
  c.textBaseline = 'middle';
  c.fillText(text, 3, 5);
  return cv;
}

/** The sponsor board: whatever your network looked up last. */
export function board(text: string, hue: number): HTMLCanvasElement {
  const w = 112, h = 26;
  const [cv, c] = sprite(w, h);
  c.fillStyle = '#0b0d12'; c.fillRect(0, 0, w, h);
  c.strokeStyle = hsl(hue, 80, 55); c.lineWidth = 2;
  c.strokeRect(1, 1, w - 2, h - 2);
  c.fillStyle = '#f2efe4';
  c.font = 'bold 11px monospace';
  c.textBaseline = 'middle';
  const t = text.length > 15 ? `${text.slice(0, 14)}…` : text;
  c.fillText(t, 6, h / 2 + 1);
  return cv;
}

/** Desaturate a kart into the ghost of a host that stopped talking. */
export function ghost(src: HTMLCanvasElement): HTMLCanvasElement {
  const [cv, c] = sprite(src.width, src.height);
  c.drawImage(src, 0, 0);
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * 0.55 + 60;
    d[i] = l; d[i + 1] = l; d[i + 2] = Math.min(255, l + 8);
  }
  c.putImageData(img, 0, 0);
  return cv;
}
