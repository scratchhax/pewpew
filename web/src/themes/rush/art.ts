import type { Texture } from 'pixi.js';
import { P, canvas, rng, sprite, stamp, tex, type Palette } from './pixels';

/**
 * Every piece of Packet Rush's art, drawn in code from pixel maps and a
 * seeded generator: the courier bot and its rivals, enemies, gems, blocks,
 * flags, the hunter drone, and the tiles and parallax layers of three worlds.
 */

export const TILE = 16;

// ── the courier bot ────────────────────────────────────────────────────────
const BOT_HEAD = [
  '.......y........',
  '.......k........',
  '.....kkkkkk.....',
  '....kbbbbbbk....',
  '...kbhbbbbbbk...',
  '...kbbbkcccck...',
  '...kbbbkcwcck...',
  '...kbbbkcccck...',
  '...kbbbbbbbbk...',
  '....kbbbbbbk....',
];
const BOT_BODY = [
  'SSSskkkkkkkk....',
  '.SSskbbbbbdk....',
  '...kbbbbbbddk...',
  '...kbbbbbbddk...',
  '....kbbbbbdk....',
];
const BOT_BODY_FLUTTER = [
  '.SSskkkkkkkk....',
  'SS.skbbbbbdk....',
  '...kbbbbbbddk...',
  '...kbbbbbbddk...',
  '....kbbbbbdk....',
];
const LEGS: Record<string, string[]> = {
  run1: ['....kgk..kgk....', '...kgk....kgk...', '..kkk......kkk..'],
  run2: ['.....kgk.kgk....', '.....kgk.kgk....', '.....kkk.kkk....'],
  run3: ['....kgk..kgk....', '....kgk...kgk...', '...kkk.....kkk..'],
  jump: ['....kgk...kgk...', '...kgk.....kk...', '...kk...........'],
  fall: ['.....kgk.kgk....', '....kgk...kgk...', '....kk.....kk...'],
};

function botPalette(body: string, shade: string, scarf: string, scarfHi: string): Palette {
  return {
    k: P.ink, b: body, d: shade, h: P.white, c: P.cyan, w: P.white, y: P.sand, g: P.steel,
    S: scarf, s: scarfHi,
  };
}

export interface BotFrames { run: Texture[]; jump: Texture; fall: Texture }

export type HeroKind = 'bot' | 'cat' | 'ghost';

// ── the hacker cat: a hoodie, a tail that streams behind ───────────────────
const CAT_HEAD = [
  '...k......k.....',
  '..kbk....kbk....',
  '..kpbkkkkbpk....',
  '.kbbbbbbbbbbk...',
  '.kbbbbbbbbbbbk..',
  '.kbbbbbwkbbwkk..',
  '.kbbbbbwkbbwkbk.',
  '.kbbbbbbbbnbbbk.',
  '..kbbbbbbbbbbk..',
  '...kkkkkkkkkk...',
];
const CAT_BODY = [
  'T..kddddddddk...',
  'TT.kdhddddddk...',
  '.TTkddddddddek..',
  '...kddddddddek..',
  '....kddddddek...',
];
const CAT_BODY_FLUTTER = [
  '.TTkddddddddk...',
  'T..kdhddddddk...',
  '...kddddddddek..',
  '...kddddddddek..',
  '....kddddddek...',
];

function catFrames(): BotFrames {
  const pal: Palette = { k: P.ink, b: P.orange, p: P.red, w: P.white, n: P.plum, d: P.navy, h: P.blue, e: P.ink, T: P.orange, g: P.steel };
  const frame = (legs: string, flutter: boolean) => sprite([...CAT_HEAD, ...(flutter ? CAT_BODY_FLUTTER : CAT_BODY), ...LEGS[legs]], pal);
  return { run: [frame('run1', false), frame('run2', true), frame('run3', false), frame('run2', true)], jump: frame('jump', true), fall: frame('fall', false) };
}

// ── the ghost: no legs, a hem that ripples ─────────────────────────────────
const GHOST_TOP = [
  '................',
  '.....kkkkkk.....',
  '...kkwwwwwwkk...',
  '..kwwwwwwwwwwk..',
  '.kwwwwwwwwwwwsk.',
  '.kwwwwwkwwwkwsk.',
  '.kwwwwwkwwwkwsk.',
  '.kwwwwwwwwwwwsk.',
  '.kwwwwwwwkkwwsk.',
  '.kwwwwwwwwwwwsk.',
  '.kwwwwwwwwwwwsk.',
  '.kwwwwwwwwwwwsk.',
  '.kwwwwwwwwwwssk.',
  '.kwwwwwwwwwwssk.',
  '.kwwwwwwwwwsssk.',
];
const GHOST_HEM = [
  ['.kwwkwwwkwwwksk.', '.kk..kkk..kkk.k.', '................'],
  ['.kwwwkwwwkwwwsk.', '..kkk..kkk..kkk.', '................'],
  ['.kkwwwkwwwkwwsk.', '.k..kkk..kkk..k.', '................'],
];

function ghostFrames(): BotFrames {
  const pal: Palette = { k: P.slate, w: P.white, s: P.silver };
  const frame = (hem: number) => sprite([...GHOST_TOP, ...GHOST_HEM[hem]], pal);
  return { run: [frame(0), frame(1), frame(2), frame(1)], jump: frame(1), fall: frame(0) };
}

function botFrames(pal: Palette): BotFrames {
  const frame = (legs: string, flutter: boolean) =>
    sprite([...BOT_HEAD, ...(flutter ? BOT_BODY_FLUTTER : BOT_BODY), ...LEGS[legs]], pal);
  return {
    run: [frame('run1', false), frame('run2', true), frame('run3', false), frame('run2', true)],
    jump: frame('jump', true),
    fall: frame('fall', false),
  };
}

// ── enemies ────────────────────────────────────────────────────────────────
const CRAWLER = [
  '......kkkk......',
  '....kkrrrrkk....',
  '...krrhrrrrrk...',
  '..krrrrrrrrrrk..',
  '..krwwkrrkwwrk..',
  '.krrwkkrrkkwrrk.',
  '.krrrrrrrrrrrrk.',
  '.krdrrrrrrrrdrk.',
  '.kddddddddddddk.',
  '..kkkkkkkkkkkk..',
];
const CRAWLER_FEET = [
  ['..kgk......kgk..', '.kkk........kkk.'],
  ['...kgk....kgk...', '...kkk....kkk...'],
];
const SQUASHED = [
  '................',
  '..kkkkkkkkkkkk..',
  '.krrwwkrrkwwrrk.',
  'kddddddddddddddk',
  '.kkkkkkkkkkkkkk.',
];

// ── things on the course ───────────────────────────────────────────────────
const GEM = [
  ['...kk...', '..klLk..', '.klLLgk.', 'klLLggtk', 'kLLggttk', '.kgggtk.', '..kgtk..', '...kk...'],
  ['...kk...', '...klk..', '..klLgk.', '..kLggk.', '..kLggk.', '..kggtk.', '...kgk..', '...kk...'],
  ['...kk...', '...kk...', '...klk..', '...kLk..', '...kgk..', '...kgk..', '...kk...', '...kk...'],
];
const QUERY_GLYPH = ['..kkkk..', '.k....k.', 'k..kk..k', 'k.k..k.k', 'k.k.kk.k', 'k..kk.kk', '.k......', '..kkkk..'];
const BOMB = ['...o..', '..so..', '.kkkk.', 'kkhkkk', 'kkkkkk', '.kkkk.'];
const DRONE = [
  'rrrr........rrrr',
  '..k..........k..',
  '..kkkkkkkkkkkk..',
  '.kaaaaaaaaaaaak.',
  'kaaaaaAAAAaaaaak',
  'kaaaaAerreAaaaak',
  'kaaaaAeRReAaaaak',
  '.kaaaaAAAAaaaak.',
  '..kkkkkkkkkkkk..',
  '....k......k....',
];

export interface Art {
  hero: BotFrames;
  heroes: Record<HeroKind, BotFrames>;
  rival: BotFrames;
  boss: Texture;
  bossHurt: Texture;
  orb: Texture[];
  crawler: Texture[];
  hopper: Texture[];
  squashed: Texture;
  hopSquashed: Texture;
  gem: Texture[];
  query: Texture;
  queryUsed: Texture;
  brick: Texture;
  brickBit: Texture;
  bomb: Texture;
  drone: Texture;
  flagPole: Texture;
  flag: Texture;
  flagBroken: Texture;
  shoe: Texture;
  magnet: Texture;
  shield: Texture;
  spark: Texture;
  dot: Texture;
  worlds: WorldArt[];
}

export interface WorldArt {
  name: string;
  top: Texture;        // ground surface tile
  fill: Texture;       // ground below the surface
  ledge: Texture;      // one-way platform
  liquid: Texture;     // what's at the bottom of a pit (tiles horizontally)
  sky: Texture;        // stretched to the screen
  far: Texture;        // tiling layers, back to front
  clouds: Texture;
  mid: Texture;
  front: Texture;
  weather: 'none' | 'rain' | 'embers';
}

export function makeArt(): Art {
  const crawlerPal: Palette = { k: P.ink, r: P.red, d: P.plum, h: P.orange, w: P.white, g: P.steel };
  const hopperPal: Palette = { ...crawlerPal, r: P.orange, d: P.red, h: P.sand };
  const creature = (pal: Palette) => CRAWLER_FEET.map((feet) => sprite([...CRAWLER, ...feet], pal));
  const gemPal: Palette = { k: P.teal, l: P.white, L: P.lime, g: P.green, t: P.teal };

  const block = (face: string, hi: string, lo: string, glyph: string[] | null, glyphCol: string) => tex(canvas(TILE, TILE, (c) => {
    c.fillStyle = P.ink; c.fillRect(0, 0, 16, 16);
    c.fillStyle = face; c.fillRect(1, 1, 14, 14);
    c.fillStyle = hi; c.fillRect(1, 1, 14, 1); c.fillRect(1, 1, 1, 14);
    c.fillStyle = lo; c.fillRect(1, 14, 14, 1); c.fillRect(14, 1, 1, 14);
    for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]]) { c.fillStyle = lo; c.fillRect(x, y, 1, 1); }
    if (glyph) stamp(c, glyph, { k: glyphCol }, 4, 4);
  }));

  return {
    hero: botFrames(botPalette(P.sky, P.blue, P.red, P.orange)),
    heroes: { bot: botFrames(botPalette(P.sky, P.blue, P.red, P.orange)), cat: catFrames(), ghost: ghostFrames() },
    boss: bossTex(false),
    bossHurt: bossTex(true),
    orb: [0, 1].map((k) => tex(canvas(10, 10, (c) => {
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        const d = Math.hypot(x - 4.5, y - 4.5);
        if (d > 4.8) continue;
        c.fillStyle = d > 3.8 ? P.ink : (x + y + k) % 4 === 0 ? P.white : d < 2 ? '#e0b0ff' : '#9b5de5';
        c.fillRect(x, y, 1, 1);
      }
    }))),
    rival: botFrames(botPalette(P.sand, P.orange, P.teal, P.cyan)),
    crawler: creature(crawlerPal),
    hopper: creature(hopperPal),
    squashed: sprite(SQUASHED, crawlerPal),
    hopSquashed: sprite(SQUASHED, hopperPal),
    gem: [...GEM.map((g) => sprite(g, gemPal)), sprite(GEM[1], gemPal, true)],
    query: block(P.sky, P.cyan, P.blue, QUERY_GLYPH, P.white),
    queryUsed: block(P.slate, P.silver, P.steel, null, P.white),
    brick: tex(canvas(TILE, TILE, (c) => {
      c.fillStyle = P.plum; c.fillRect(0, 0, 16, 16);
      c.fillStyle = P.red;
      for (const [x, y, w] of [[0, 1, 7], [8, 1, 8], [0, 5, 3], [4, 5, 8], [13, 5, 3], [0, 9, 7], [8, 9, 8], [0, 13, 3], [4, 13, 8], [13, 13, 3]]) c.fillRect(x, y, w, 3);
      c.fillStyle = P.orange;
      for (const [x, y, w] of [[0, 1, 7], [8, 1, 8], [4, 5, 8], [0, 9, 7], [8, 9, 8], [4, 13, 8]]) c.fillRect(x, y, w, 1);
    })),
    brickBit: tex(canvas(4, 4, (c) => { c.fillStyle = P.red; c.fillRect(0, 0, 4, 4); c.fillStyle = P.orange; c.fillRect(0, 0, 4, 1); })),
    bomb: sprite(BOMB, { k: P.ink, h: P.slate, o: P.sand, s: P.orange }),
    drone: sprite(DRONE, { k: P.ink, a: P.orange, A: P.sand, e: P.ink, r: P.red, R: P.white }),
    flagPole: tex(canvas(3, 48, (c) => {
      c.fillStyle = P.silver; c.fillRect(1, 2, 1, 46);
      c.fillStyle = P.slate; c.fillRect(2, 2, 1, 46);
      c.fillStyle = P.sand; c.fillRect(0, 0, 3, 3);
    })),
    flag: tex(canvas(14, 9, (c) => {
      c.fillStyle = '#c08cff'; c.fillRect(0, 0, 12, 8);
      c.fillStyle = P.plum; c.fillRect(0, 7, 12, 1); c.fillRect(11, 0, 1, 8);
      c.fillStyle = P.white; stamp(c, ['.k.k.', 'k.k.k', '..k..'], { k: P.white }, 4, 2);
    })),
    flagBroken: tex(canvas(14, 9, (c) => {
      c.fillStyle = '#6c4f96'; c.fillRect(0, 0, 7, 5); c.fillRect(0, 5, 4, 3); c.fillRect(8, 2, 3, 3);
    })),
    shoe: sprite(['..kkkk....', '.kccccK...', '.kcwcccK..', '.kcccccckk', 'kccccccccK', 'kKKKKKKKKk', '.kkkkkkkk.'], { k: P.ink, c: P.cyan, w: P.white, K: P.teal }),
    magnet: sprite(['.kkk.kkk..', '.krk.krk..', '.krk.krk..', '.krrkrrk..', '.krrrrrk..', '..krrrk...', '...kkk....'], { k: P.ink, r: P.red }),
    shield: tex(canvas(24, 24, (c) => {
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
        const d = Math.hypot(x - 11.5, y - 11.5);
        if (d > 10.5 && d < 12) { c.fillStyle = P.cyan; c.fillRect(x, y, 1, 1); }
        else if (d > 9.5 && d <= 10.5 && (x + y) % 2 === 0) { c.fillStyle = P.white; c.fillRect(x, y, 1, 1); }
      }
    })),
    spark: tex(canvas(3, 3, (c) => { c.fillStyle = P.white; c.fillRect(1, 0, 1, 3); c.fillRect(0, 1, 3, 1); })),
    dot: tex(canvas(1, 1, (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1, 1); })),
    worlds: [hills(), factory(), castle()],
  };
}

// ── worlds ─────────────────────────────────────────────────────────────────
/** A dithered vertical gradient through a few bands: the 16-bit sky look. */
function skyTex(stops: string[], h = 256): Texture {
  return tex(canvas(16, h, (c) => {
    const bands = stops.length - 1;
    for (let y = 0; y < h; y++) {
      const f = (y / h) * bands, k = Math.min(bands - 1, Math.floor(f)), frac = f - k;
      for (let x = 0; x < 16; x++) {
        const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]][y % 4][x % 4] / 16;
        c.fillStyle = frac > bayer ? stops[k + 1] : stops[k];
        c.fillRect(x, y, 1, 1);
      }
    }
  }));
}

function ridge(c: CanvasRenderingContext2D, w: number, h: number, base: number, amp: number, rand: () => number, col: string, rough = 6): number[] {
  const tops: number[] = [];
  let y = base, v = 0;
  for (let x = 0; x < w; x++) {
    if (x % rough === 0) v = (rand() - 0.5) * amp * 0.5;
    y += v * 0.25;
    // pull back toward the base so the layer tiles and never drifts off
    y += (base - y) * 0.04 + Math.sin((x / w) * Math.PI * 2 * 3) * amp * 0.03;
    const top = Math.round(Math.max(0, Math.min(h - 1, y)));
    tops.push(top);
    c.fillStyle = col; c.fillRect(x, top, 1, h - top);
  }
  // make the ends meet so the strip tiles
  return tops;
}

function hills(): WorldArt {
  const r = rng(11);
  return {
    name: 'GREEN HILLS', weather: 'none',
    top: tex(canvas(TILE, TILE, (c) => {
      c.fillStyle = '#8f563b'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#663931';
      for (let y = 6; y < 16; y += 4) for (let x = (y / 4) % 2 ? 0 : 4; x < 16; x += 8) c.fillRect(x, y, 4, 4);
      c.fillStyle = P.green; c.fillRect(0, 0, 16, 5);
      c.fillStyle = P.lime; c.fillRect(0, 0, 16, 2);
      for (const x of [1, 5, 9, 13]) { c.fillStyle = P.green; c.fillRect(x, 5, 2, 2); }
      c.fillStyle = P.teal; for (const x of [0, 4, 8, 12]) c.fillRect(x, 5, 1, 1);
      c.fillStyle = P.white; c.fillRect(3, 0, 1, 1); c.fillRect(11, 0, 1, 1);
    })),
    fill: tex(canvas(TILE, TILE, (c) => {
      c.fillStyle = '#8f563b'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#663931';
      for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? 0 : 4; x < 16; x += 8) c.fillRect(x, y, 4, 4);
    })),
    ledge: tex(canvas(TILE, 8, (c) => {
      c.fillStyle = P.ink; c.fillRect(0, 0, 16, 8);
      c.fillStyle = '#8f563b'; c.fillRect(0, 1, 16, 6);
      c.fillStyle = P.sand; c.fillRect(0, 1, 16, 1);
      c.fillStyle = '#663931'; c.fillRect(0, 4, 16, 1); c.fillRect(7, 1, 1, 6);
    })),
    liquid: tex(canvas(TILE, 8, (c) => {
      c.fillStyle = P.blue; c.fillRect(0, 0, 16, 8);
      c.fillStyle = P.sky; c.fillRect(0, 0, 16, 2);
      c.fillStyle = P.cyan; c.fillRect(2, 0, 4, 1); c.fillRect(10, 1, 3, 1);
    })),
    sky: skyTex([P.sky, P.sky, P.cyan, P.white]),
    far: tex(canvas(320, 120, (c) => {
      ridge(c, 320, 120, 50, 60, r, '#7fb2d8', 10);
      ridge(c, 320, 120, 80, 40, r, P.slate, 8);
      c.fillStyle = P.white;
      for (let x = 20; x < 320; x += 70) c.fillRect(x, 52 + ((x * 7) % 9), 6, 2);
    })),
    clouds: tex(canvas(256, 60, (c) => {
      for (let i = 0; i < 6; i++) {
        const cx = 20 + i * 42 + r() * 10, cy = 18 + r() * 24;
        for (let k = 0; k < 5; k++) {
          const bx = cx + (k - 2) * 7, by = cy - (k % 2) * 4, rad = 7 + (k % 2) * 3;
          for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
            if (x * x + y * y > rad * rad) continue;
            c.fillStyle = y > rad * 0.35 ? '#dcebf5' : P.white;
            c.fillRect(Math.round(bx + x), Math.round(by + y), 1, 1);
          }
        }
      }
    })),
    mid: tex(canvas(256, 100, (c) => {
      for (let i = 0; i < 4; i++) {
        const cx = 30 + i * 64, rad = 26 + (i % 2) * 12;
        for (let y = 0; y < 100; y++) for (let x = -rad; x <= rad; x++) {
          const top = 100 - Math.sqrt(Math.max(0, rad * rad - x * x)) * 1.6;
          if (y < top) continue;
          const stripe = Math.floor((y - top) / 6) % 2 === 0;
          c.fillStyle = stripe ? P.green : '#2f9a55';
          c.fillRect(((cx + x) % 256 + 256) % 256, y, 1, 1);
        }
      }
    })),
    front: tex(canvas(256, 24, (c) => {
      for (let i = 0; i < 7; i++) {
        const cx = 14 + i * 37, rad = 8 + (i % 3) * 3;
        for (let y = -rad; y <= 0; y++) for (let x = -rad * 1.4; x <= rad * 1.4; x++) {
          if ((x / 1.4) ** 2 + y * y > rad * rad) continue;
          c.fillStyle = y > -rad * 0.5 ? P.teal : P.green;
          c.fillRect(Math.round(cx + x), 24 + y - 1, 1, 1);
        }
      }
    })),
  };
}

function factory(): WorldArt {
  const r = rng(29);
  return {
    name: 'NEON FACTORY', weather: 'rain',
    top: tex(canvas(TILE, TILE, (c) => {
      c.fillStyle = P.steel; c.fillRect(0, 0, 16, 16);
      for (let x = -4; x < 20; x += 8) { c.fillStyle = P.sand; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 4, 0); c.lineTo(x + 1, 4); c.lineTo(x - 3, 4); c.fill(); }
      c.fillStyle = P.ink; c.fillRect(0, 4, 16, 1);
      c.fillStyle = P.slate; c.fillRect(0, 5, 16, 1);
      c.fillStyle = P.silver; c.fillRect(2, 8, 1, 1); c.fillRect(13, 8, 1, 1); c.fillRect(2, 13, 1, 1); c.fillRect(13, 13, 1, 1);
      c.fillStyle = P.ink; c.fillRect(15, 5, 1, 11);
    })),
    fill: tex(canvas(TILE, TILE, (c) => {
      c.fillStyle = P.navy; c.fillRect(0, 0, 16, 16);
      c.fillStyle = P.steel; c.fillRect(1, 1, 14, 14);
      c.fillStyle = P.ink; c.fillRect(0, 15, 16, 1); c.fillRect(15, 0, 1, 16);
      c.fillStyle = P.slate; c.fillRect(3, 3, 1, 1); c.fillRect(12, 12, 1, 1);
    })),
    ledge: tex(canvas(TILE, 8, (c) => {
      c.fillStyle = P.ink; c.fillRect(0, 0, 16, 8);
      c.fillStyle = P.orange; c.fillRect(0, 1, 16, 2); c.fillRect(0, 6, 16, 1);
      c.fillStyle = P.orange; for (let x = 0; x < 16; x += 4) { c.fillRect(x, 3, 1, 3); }
      c.fillStyle = P.sand; c.fillRect(0, 1, 16, 1);
    })),
    liquid: tex(canvas(TILE, 8, (c) => {
      c.fillStyle = P.teal; c.fillRect(0, 0, 16, 8);
      c.fillStyle = P.lime; c.fillRect(0, 0, 16, 1); c.fillRect(4, 1, 3, 1);
      c.fillStyle = P.green; c.fillRect(11, 1, 4, 1);
    })),
    sky: skyTex([P.ink, P.navy, P.plum, P.red]),
    far: tex(canvas(320, 120, (c) => {
      let x = 0;
      while (x < 320) {
        const w = 14 + Math.floor(r() * 22), h = 30 + Math.floor(r() * 70);
        c.fillStyle = '#20264a'; c.fillRect(x, 120 - h, w, h);
        c.fillStyle = r() < 0.5 ? P.sand : P.cyan;
        for (let wy = 120 - h + 4; wy < 116; wy += 6) for (let wx = x + 2; wx < x + w - 2; wx += 4) if (r() < 0.3) c.fillRect(wx, wy, 2, 2);
        if (r() < 0.35) { c.fillStyle = '#20264a'; c.fillRect(x + 3, 120 - h - 14, 4, 14); }
        x += w + 2;
      }
    })),
    clouds: tex(canvas(256, 60, (c) => {
      for (let i = 0; i < 9; i++) {
        const cx = r() * 256, cy = 10 + r() * 40, rad = 5 + r() * 9;
        for (let y = -rad; y <= rad; y++) for (let x = -rad * 2; x <= rad * 2; x++) {
          if ((x / 2) ** 2 + y * y > rad * rad || (x + y) % 2) continue;
          c.fillStyle = 'rgba(86,108,134,0.55)'; c.fillRect(Math.round(((cx + x) % 256 + 256) % 256), Math.round(cy + y), 1, 1);
        }
      }
    })),
    mid: tex(canvas(256, 100, (c) => {
      for (let x = 0; x < 256; x += 64) {
        c.fillStyle = P.steel; c.fillRect(x + 10, 20, 8, 80);
        c.fillStyle = P.slate; c.fillRect(x + 10, 20, 2, 80);
        c.fillStyle = P.steel; c.fillRect(x, 34, 64, 5);
        c.fillStyle = P.ink; for (let k = 0; k < 64; k += 8) c.fillRect(x + k, 35, 4, 3);
        c.fillStyle = P.cyan; c.fillRect(x + 40, 60, 10, 2);
        c.fillStyle = P.teal; c.fillRect(x + 36, 62, 18, 38);
        c.fillStyle = P.ink; c.fillRect(x + 38, 66, 14, 2);
      }
    })),
    front: tex(canvas(256, 24, (c) => {
      c.fillStyle = P.ink; c.fillRect(0, 12, 256, 3);
      for (let x = 0; x < 256; x += 32) { c.fillRect(x + 6, 12, 3, 12); }
      c.fillStyle = P.steel; c.fillRect(0, 12, 256, 1);
    })),
  };
}

function castle(): WorldArt {
  const r = rng(53);
  const stone = (c: CanvasRenderingContext2D, face: string, mortar: string, hi: string) => {
    c.fillStyle = mortar; c.fillRect(0, 0, 16, 16);
    c.fillStyle = face;
    for (const [x, y, w, h] of [[0, 0, 7, 7], [8, 0, 8, 7], [0, 8, 3, 8], [4, 8, 8, 8], [13, 8, 3, 8]]) c.fillRect(x, y, w, h);
    c.fillStyle = hi;
    for (const [x, y, w] of [[0, 0, 7], [8, 0, 8], [4, 8, 8]]) c.fillRect(x, y, w, 1);
  };
  return {
    name: 'LAVA CASTLE', weather: 'embers',
    top: tex(canvas(TILE, TILE, (c) => { stone(c, P.slate, P.steel, P.silver); })),
    fill: tex(canvas(TILE, TILE, (c) => { stone(c, P.steel, P.ink, P.slate); })),
    ledge: tex(canvas(TILE, 8, (c) => {
      c.fillStyle = P.ink; c.fillRect(0, 0, 16, 8);
      c.fillStyle = P.slate; c.fillRect(0, 1, 15, 6);
      c.fillStyle = P.silver; c.fillRect(0, 1, 15, 1);
    })),
    liquid: tex(canvas(TILE, 8, (c) => {
      c.fillStyle = P.red; c.fillRect(0, 0, 16, 8);
      c.fillStyle = P.orange; c.fillRect(0, 0, 16, 2);
      c.fillStyle = P.sand; c.fillRect(3, 0, 3, 1); c.fillRect(11, 1, 2, 1);
    })),
    sky: skyTex([P.ink, P.plum, P.red, P.orange]),
    far: tex(canvas(320, 120, (c) => {
      ridge(c, 320, 120, 90, 50, r, '#2a1f3a', 12);
      c.fillStyle = '#2a1f3a';
      for (const [x, w, h] of [[60, 26, 70], [150, 40, 95], [240, 22, 60]]) {
        c.fillRect(x, 120 - h, w, h);
        for (let k = 0; k < w; k += 6) c.fillRect(x + k, 120 - h - 5, 3, 5);
        c.fillStyle = P.orange; c.fillRect(x + Math.floor(w / 2) - 1, 120 - h + 12, 2, 4); c.fillStyle = '#2a1f3a';
      }
    })),
    clouds: tex(canvas(256, 60, (c) => {
      for (let i = 0; i < 7; i++) {
        const cx = r() * 256, cy = 8 + r() * 40, rad = 4 + r() * 7;
        for (let y = -rad; y <= rad; y++) for (let x = -rad * 2.5; x <= rad * 2.5; x++) {
          if ((x / 2.5) ** 2 + y * y > rad * rad || (x * 3 + y) % 3) continue;
          c.fillStyle = 'rgba(93,39,93,0.6)'; c.fillRect(Math.round(((cx + x) % 256 + 256) % 256), Math.round(cy + y), 1, 1);
        }
      }
    })),
    mid: tex(canvas(256, 100, (c) => {
      for (let x = 0; x < 256; x += 80) {
        c.fillStyle = P.steel; c.fillRect(x + 20, 10, 16, 90);
        c.fillStyle = P.slate; c.fillRect(x + 20, 10, 3, 90);
        c.fillStyle = P.ink; for (let y = 16; y < 100; y += 10) c.fillRect(x + 20, y, 16, 1);
        c.fillStyle = P.steel; for (let y = 0; y < 40; y += 4) c.fillRect(x + 56, y, 2, 3);
        c.fillStyle = P.orange; c.fillRect(x + 26, 40, 4, 6); c.fillStyle = P.sand; c.fillRect(x + 27, 41, 2, 3);
      }
    })),
    front: tex(canvas(256, 24, (c) => {
      for (let i = 0; i < 9; i++) {
        const x = 8 + i * 29, h = 8 + ((i * 7) % 12);
        c.fillStyle = P.ink;
        for (let y = 0; y < h; y++) c.fillRect(x - Math.floor((h - y) / 3), 24 - y, 1 + Math.floor(((h - y) / 3)) * 2, 1);
      }
    })),
  };
}


/**
 * The boss: a hovering botnet mech, drawn procedurally at 32x30. A dome with a
 * visor and one big eye, horns, arms, and jets underneath. The hurt version is
 * the same mech washed pale (the theme eases between them; nothing flashes).
 */
function bossTex(hurt: boolean): Texture {
  return tex(canvas(32, 30, (c) => {
    const put = (x: number, y: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, 1, 1); };
    const body = hurt ? '#e8a0b0' : P.red, shade = hurt ? '#c07888' : P.plum, hi = hurt ? P.white : P.orange;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 32; x++) {
      const dx = x - 15.5, dy = y - 13;
      const dome = (dx * dx) / (13 * 13) + (dy * dy) / (11 * 11);
      if (dome <= 1) put(x, y, dome > 0.86 ? P.ink : dx > 6 ? shade : dx < -8 && dy < -2 ? hi : body);
    }
    // horns
    for (let k = 0; k < 5; k++) { put(5 - k, 5 - k, P.ink); put(4 - k, 5 - k, P.sand); put(26 + k, 5 - k, P.ink); put(27 + k, 5 - k, P.sand); }
    // visor and eye
    c.fillStyle = P.ink; c.fillRect(7, 10, 18, 7);
    c.fillStyle = hurt ? P.silver : P.steel; c.fillRect(8, 11, 16, 5);
    c.fillStyle = P.sand; c.fillRect(13, 11, 6, 5);
    c.fillStyle = hurt ? P.white : P.red; c.fillRect(15, 12, 2, 3);
    c.fillStyle = P.white; c.fillRect(14, 12, 1, 1);
    // arms
    c.fillStyle = P.ink; c.fillRect(0, 15, 4, 6); c.fillRect(28, 15, 4, 6);
    c.fillStyle = P.slate; c.fillRect(1, 16, 2, 4); c.fillRect(29, 16, 2, 4);
    // jets
    c.fillStyle = P.ink; c.fillRect(9, 23, 5, 3); c.fillRect(18, 23, 5, 3);
    c.fillStyle = P.cyan; c.fillRect(10, 26, 3, 2); c.fillRect(19, 26, 3, 2);
    c.fillStyle = P.white; c.fillRect(11, 26, 1, 1); c.fillRect(20, 26, 1, 1);
    c.fillStyle = P.sky; c.fillRect(11, 28, 1, 2); c.fillRect(20, 28, 1, 2);
  }));
}
