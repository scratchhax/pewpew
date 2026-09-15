import { Texture } from 'pixi.js';

/**
 * Pixel-art tooling for Packet Rush: sprites are drawn from little string maps
 * with a palette, text uses a hand-made 3x5 pixel font, and every texture is
 * sampled with nearest filtering so it stays crisp when scaled up. No image
 * files anywhere.
 */

/** Sweetie 16, a well-loved 16-colour palette: every sprite and tile draws from it. */
export const P = {
  ink: '#1a1c2c', plum: '#5d275d', red: '#b13e53', orange: '#ef7d57', sand: '#ffcd75',
  lime: '#a7f070', green: '#38b764', teal: '#257179', navy: '#29366f', blue: '#3b5dc9',
  sky: '#41a6f6', cyan: '#73eff7', white: '#f4f4f4', silver: '#94b0c2', slate: '#566c86', steel: '#333c57',
};

export type Palette = Record<string, string>;

export function canvas(w: number, h: number, draw?: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw?.(ctx);
  return c;
}

export function tex(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

/** Draw a string map ('.' = clear) into a context at (x, y). */
export function stamp(ctx: CanvasRenderingContext2D, rows: string[], pal: Palette, x = 0, y = 0, flip = false): void {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[flip ? row.length - 1 - i : i];
      const col = pal[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  });
}

export function sprite(rows: string[], pal: Palette, flip = false): Texture {
  const w = Math.max(...rows.map((r) => r.length));
  return tex(canvas(w, rows.length, (ctx) => stamp(ctx, rows, pal, 0, 0, flip)));
}

/** A small seeded random (so the art is the same every load). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

// ── 3x5 pixel font ─────────────────────────────────────────────────────────
/** 3 wide x 5 tall, row by row. */
const GLYPHS: Record<string, string[]> = {
  "0": ["###","#.#","#.#","#.#","###"],
  "1": [".#.","##.",".#.",".#.","###"],
  "2": ["##.","..#",".#.","#..","###"],
  "3": ["##.","..#",".#.","..#","##."],
  "4": ["#.#","#.#","###","..#","..#"],
  "5": ["###","#..","##.","..#","##."],
  "6": [".##","#..","###","#.#","###"],
  "7": ["###","..#",".#.",".#.",".#."],
  "8": ["###","#.#","###","#.#","###"],
  "9": ["###","#.#","###","..#","##."],
  "A": [".#.","#.#","###","#.#","#.#"],
  "B": ["##.","#.#","##.","#.#","##."],
  "C": [".##","#..","#..","#..",".##"],
  "D": ["##.","#.#","#.#","#.#","##."],
  "E": ["###","#..","##.","#..","###"],
  "F": ["###","#..","##.","#..","#.."],
  "G": [".##","#..","#.#","#.#",".##"],
  "H": ["#.#","#.#","###","#.#","#.#"],
  "I": ["###",".#.",".#.",".#.","###"],
  "J": ["..#","..#","..#","#.#",".#."],
  "K": ["#.#","#.#","##.","#.#","#.#"],
  "L": ["#..","#..","#..","#..","###"],
  "M": ["#.#","###","###","#.#","#.#"],
  "N": ["##.","#.#","#.#","#.#","#.#"],
  "O": [".#.","#.#","#.#","#.#",".#."],
  "P": ["##.","#.#","##.","#..","#.."],
  "Q": [".#.","#.#","#.#","##.",".##"],
  "R": ["##.","#.#","##.","#.#","#.#"],
  "S": [".##","#..",".#.","..#","##."],
  "T": ["###",".#.",".#.",".#.",".#."],
  "U": ["#.#","#.#","#.#","#.#","###"],
  "V": ["#.#","#.#","#.#","#.#",".#."],
  "W": ["#.#","#.#","###","###","#.#"],
  "X": ["#.#","#.#",".#.","#.#","#.#"],
  "Y": ["#.#","#.#",".#.",".#.",".#."],
  "Z": ["###","..#",".#.","#..","###"],
  ".": ["...","...","...","...",".#."],
  "-": ["...","...","###","...","..."],
  "_": ["...","...","...","...","###"],
  ":": ["...",".#.","...",".#.","..."],
  "/": ["..#","..#",".#.","#..","#.."],
  "!": [".#.",".#.",".#.","...",".#."],
  "?": ["##.","..#",".#.","...",".#."],
  "+": ["...",".#.","###",".#.","..."],
  "*": ["...","#.#",".#.","#.#","..."],
  " ": ["...","...","...","...","..."],
  "'": [".#.",".#.","...","...","..."],
};

/** Draw text in the 3x5 font onto a canvas at (x, y) (top-left of the glyphs), with an optional 1px outline. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, outline: string | null = P.ink): number {
  const s = text.toUpperCase();
  const put = (ox: number, oy: number, col: string) => {
    ctx.fillStyle = col;
    for (let k = 0; k < s.length; k++) {
      const g = GLYPHS[s[k]] ?? GLYPHS['?'];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) {
        if (g[j][i] === '#') ctx.fillRect(x + k * 4 + i + ox, y + j + oy, 1, 1);
      }
    }
  };
  if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) put(dx, dy, outline);
  put(0, 0, color);
  return s.length * 4;
}

/** Text as a texture in the 3x5 font, with a 1px dark outline so it reads over anything. */
export function pixelText(text: string, color: string, outline = P.ink): Texture {
  const w = text.length * 4 + 3;
  return tex(canvas(w, 7, (ctx) => { drawText(ctx, text, 1, 1, color, outline); }));
}
