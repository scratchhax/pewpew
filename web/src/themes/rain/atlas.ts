import { Texture } from 'pixi.js';

/**
 * The glyph atlas: ASCII 32..126 rendered once into a 16x6 grid of cells,
 * our version of xscreensaver's matrix3.png. The shader indexes it with
 * `code - 32`, so a space is index 0 and renders as nothing.
 */
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 6;
export const GLYPHS = 95;

export function makeAtlas(): Texture {
  const cw = 32, ch = 48;
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS * cw;
  c.height = ATLAS_ROWS * ch;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.font = `600 ${ch * 0.82}px "Courier New", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  for (let i = 0; i < GLYPHS; i++) {
    const ch2 = String.fromCharCode(32 + i);
    g.fillText(ch2, (i % ATLAS_COLS + 0.5) * cw, ((i / ATLAS_COLS | 0) + 0.52) * ch);
  }
  return Texture.from(c);
}
