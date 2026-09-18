import type { SprFrame, TexTable } from './wad';

/**
 * Every pixel FRAGNET shows, drawn in code: the wall and floor textures, the
 * demons and pickups, the marine's shotgun, the status-bar face. A gritty
 * 24-color palette leans rust, bone and hell-red; art is blocky on purpose,
 * sampled nearest, and seeded so the maze looks the same every load.
 *
 * When no pack and no uploaded WAD can be had (offline demo with a missing
 * public/ dir, say), buildFallbackTable() quantises this canvas art into the
 * same palette-indexed TexTable the software renderer paints from, so the
 * scene degrades to its own art instead of refusing to exist.
 */

/** Canvas -> packed little-endian RGBA words, 0 = transparent. */
export function canvasToRgba(c: HTMLCanvasElement): { w: number; h: number; data: Uint32Array } {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, data: new Uint32Array(img.data.buffer.slice(0)) };
}

/** Quantise a canvas into palette indices; colours beyond `max` fall back to the nearest. */
function quantize(c: HTMLCanvasElement, palette: Uint8Array, lookup: Map<number, number>): Uint8Array {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const idx = new Uint8Array(c.width * c.height);
  for (let i = 0; i < idx.length; i++) {
    const a = img.data[i * 4 + 3];
    if (a < 32) { idx[i] = 255; continue; }
    const key = (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2];
    let hit = lookup.get(key);
    if (hit === undefined) {
      const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
      let best = 0, bd = Infinity;
      for (let p = 0; p < 256; p++) {
        const dr = palette[p * 3] - r, dg = palette[p * 3 + 1] - g, db = palette[p * 3 + 2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = p; }
      }
      hit = best;
      lookup.set(key, hit);
    }
    idx[i] = hit;
  }
  return idx;
}

function frameFrom(c: HTMLCanvasElement, palette: Uint8Array, lookup: Map<number, number>): SprFrame {
  const idx = quantize(c, palette, lookup);
  return { w: c.width, h: c.height, lo: c.width >> 1, to: c.height, idx };
}

/**
 * The last-resort art source: a 256-colour palette harvested from this
 * module's own canvases, COLORMAP approximated by thirty-four brightness
 * ramps, everything else indexed from the same quantisation pass.
 */
export function buildFallbackTable(): TexTable {
  const sources = [texTech(1), texTech(2), texBrick(1), texHell(1), texFloor(1), texCeil(1), sprDemon(0), sprFireball(), sprVial(), sprCrate(), sprGun()];
  const palette = new Uint8Array(256 * 3);
  const lookup = new Map<number, number>();
  let next = 0;
  for (const c of sources) {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 32) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (lookup.has(key) || next >= 256) continue;
      palette[next * 3] = d[i]; palette[next * 3 + 1] = d[i + 1]; palette[next * 3 + 2] = d[i + 2];
      lookup.set(key, next++);
    }
  }
  for (let p = next; p < 256; p++) { palette[p * 3] = 0; palette[p * 3 + 1] = 0; palette[p * 3 + 2] = 0; }
  const cmap = new Uint8Array(34 * 256);
  for (let t = 0; t < 34; t++) {
    const k = 1 - t / 33;
    for (let i = 0; i < 256; i++) {
      const r = Math.round(palette[i * 3] * k), g = Math.round(palette[i * 3 + 1] * k), b = Math.round(palette[i * 3 + 2] * k);
      let best = 0, bd = Infinity;
      for (let p = 0; p < 256; p++) {
        const dr = palette[p * 3] - r, dg = palette[p * 3 + 1] - g, db = palette[p * 3 + 2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = p; }
      }
      cmap[t * 256 + i] = best;
    }
  }
  const flat = (c: HTMLCanvasElement): Uint8Array => quantize(c, palette, lookup);
  const table: TexTable = {
    palette, cmap,
    flats: {
      floor: flat(texFloor(3)), ceil: flat(texCeil(3)),
      techFloor: flat(texFloor(5)), hellFloor: flat(texHell(5)), hellCeil: flat(texCeil(7)),
      exitFloor: flat(texFloor(9)), exitCeil: flat(texCeil(9)),
    },
    walls: {
      tech: { w: 64, h: 64, idx: flat(texTech(7)) },
      brick: { w: 64, h: 64, idx: flat(texBrick(11)) },
      hell: { w: 64, h: 64, idx: flat(texHell(13)) },
      door: { w: 64, h: 64, idx: flat(texTech(21)) },
    },
    sprites: {
      demon: { A: frameFrom(sprDemon(0), palette, lookup), B: frameFrom(sprDemon(1), palette, lookup) },
      fireball: { A: frameFrom(sprFireball(), palette, lookup) },
      health: { A: frameFrom(sprVial(), palette, lookup) },
      ammo: { A: frameFrom(sprCrate(), palette, lookup) },
      gun: { A: frameFrom(sprGun(), palette, lookup) },
    },
  };
  return table;
}


export const FR = {
  ink: '#150e0a', soot: '#241a14', brown: '#5c3d26', umber: '#7c5330', bone: '#e6d7ab',
  hide: '#9c4126', blood: '#a31f1f', gore: '#d84343', flesh: '#d99a6c', hair: '#3a2317',
  gun: '#3d4450', gunhi: '#69748a', steel: '#8b95a3', brass: '#c9a24b', rust: '#b1502f',
  toxic: '#79d94f', amber: '#ffb14a', ember: '#ff6a2a', plate: '#37e0ff', hell: '#6e1313',
  mold: '#39522e', cream: '#f4ead0',
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

// ── walls, floor, ceiling ──────────────────────────────────────────────────

/** Panelled base: rivets, seams and grime, like the ship's corridors. */
export function texTech(seed = 7, size = 64): HTMLCanvasElement {
  const [c, x] = canvas(size, size); const r = rng(seed);
  x.fillStyle = '#2c2620'; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 3; i++) {
    const y = (i * 21 + 4) | 0;
    x.fillStyle = i % 2 ? '#37302a' : '#241f19';
    x.fillRect(0, y, size, 16);
    x.fillStyle = FR.ink; x.fillRect(0, y + 16, size, 2);
  }
  for (let i = 0; i < 26; i++) {
    const px = (r() * size) | 0, py = (r() * size) | 0;
    x.fillStyle = r() < 0.5 ? '#4a423a' : '#191410';
    x.fillRect(px, py, 2, 2);
  }
  for (let i = 0; i < 4; i++) { x.fillStyle = FR.brass; x.fillRect((i * 16 + 7) | 0, 2, 2, 2); }
  return c;
}

/** Cracked brick for the older corners of the complex. */
export function texBrick(seed = 11, size = 64): HTMLCanvasElement {
  const [c, x] = canvas(size, size); const r = rng(seed);
  x.fillStyle = '#1c1512'; x.fillRect(0, 0, size, size);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 4 : 0;
    for (let k = -1; k < 4; k++) {
      const bx = off + k * 16, by = row * 8;
      const v = r();
      x.fillStyle = v < 0.25 ? '#6e3a24' : v < 0.6 ? '#5c3d26' : '#4c301f';
      x.fillRect(bx + 1, by + 1, 14, 6);
      if (r() < 0.3) { x.fillStyle = '#33241a'; x.fillRect(bx + 2 + ((r() * 10) | 0), by + 2, 3, 2); }
    }
  }
  return c;
}

/** When the maze goes hell: veined rock that smoulders. */
export function texHell(seed = 13, size = 64): HTMLCanvasElement {
  const [c, x] = canvas(size, size); const r = rng(seed);
  x.fillStyle = '#180b08'; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    x.fillStyle = r() < 0.7 ? '#241009' : FR.hell;
    x.fillRect((r() * size) | 0, (r() * size) | 0, 2 + ((r() * 4) | 0), 2 + ((r() * 3) | 0));
  }
  for (let i = 0; i < 7; i++) {
    let px = (r() * size) | 0, py = (r() * size) | 0;
    for (let k = 0; k < 14; k++) {
      x.fillStyle = k % 3 ? '#3d1408' : FR.rust;
      x.fillRect(px, py, 2, 2);
      px += ((r() * 5) | 0) - 2; py += 1 + ((r() * 2) | 0);
    }
  }
  return c;
}

/** Floor: grimy concrete with a metal grate band. */
export function texFloor(seed = 17, size = 64): HTMLCanvasElement {
  const [c, x] = canvas(size, size); const r = rng(seed);
  x.fillStyle = '#221d18'; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = r() < 0.5 ? '#2a241d' : '#191410';
    x.fillRect((r() * size) | 0, (r() * size) | 0, 2 + ((r() * 3) | 0), 2);
  }
  x.fillStyle = '#332b22'; x.fillRect(0, 0, size, 3); x.fillRect(0, 0, 3, size);
  x.fillStyle = FR.ink; x.fillRect(size - 2, 0, 2, size); x.fillRect(0, size - 2, size, 2);
  return c;
}

export function texCeil(seed = 19, size = 64): HTMLCanvasElement {
  const [c, x] = canvas(size, size); const r = rng(seed);
  x.fillStyle = '#171310'; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 5; i++) { x.fillStyle = '#1f1a14'; x.fillRect(0, i * 13 + 2, size, 9); x.fillStyle = FR.ink; x.fillRect(0, i * 13 + 11, size, 1); }
  for (let i = 0; i < 30; i++) { x.fillStyle = '#120e0a'; x.fillRect((r() * size) | 0, (r() * size) | 0, 2, 2); }
  return c;
}

// ── sprites ────────────────────────────────────────────────────────────────

/** A imp-ish demon, 32×48: hide, horns, glowing eyes, walking frame 0 or 1. */
export function sprDemon(frame: number, size = 32): HTMLCanvasElement {
  const [c, x] = canvas(size, size * 1.5); const r = rng(40 + frame);
  const w = size, h = size * 1.5;
  const px = (sx: number, sy: number, sw: number, sh: number, col: string) => { x.fillStyle = col; x.fillRect((sx * w) | 0, (sy * h) | 0, Math.max(1, sw * w), Math.max(1, sh * h)); };
  const legSwing = frame ? 1 : -1;
  // legs
  px(0.30 + legSwing * 0.04, 0.74, 0.10, 0.24, FR.hide); px(0.58 - legSwing * 0.04, 0.74, 0.10, 0.24, FR.hide);
  px(0.29 + legSwing * 0.04, 0.95, 0.13, 0.04, FR.ink); px(0.56 - legSwing * 0.04, 0.95, 0.13, 0.04, FR.ink);
  // torso
  px(0.28, 0.36, 0.44, 0.42, FR.hide);
  px(0.34, 0.44, 0.32, 0.26, '#b5522f');
  for (let i = 0; i < 8; i++) px(0.32 + r() * 0.34, 0.38 + r() * 0.36, 0.03, 0.03, '#7c331d');
  // arms with claws
  const ay = frame ? 0.40 : 0.46;
  px(0.12, ay, 0.14, 0.22, FR.hide); px(0.74, ay, 0.14, 0.22, FR.hide);
  px(0.10, ay + 0.22, 0.05, 0.08, FR.bone); px(0.17, ay + 0.22, 0.05, 0.08, FR.bone);
  px(0.78, ay + 0.22, 0.05, 0.08, FR.bone); px(0.85, ay + 0.22, 0.05, 0.08, FR.bone);
  // head
  px(0.33, 0.10, 0.34, 0.28, FR.hide);
  px(0.30, 0.02, 0.06, 0.12, FR.bone); px(0.64, 0.02, 0.06, 0.12, FR.bone);      // horns
  px(0.38, 0.18, 0.09, 0.07, FR.amber); px(0.55, 0.18, 0.09, 0.07, FR.amber);   // eyes
  px(0.41, 0.19, 0.03, 0.04, '#fff7d0'); px(0.58, 0.19, 0.03, 0.04, '#fff7d0');
  px(0.40, 0.30, 0.20, 0.06, FR.ink);                                             // mouth
  for (let i = 0; i < 4; i++) px(0.41 + i * 0.05, 0.30, 0.02, 0.03, FR.bone);
  // outline shading
  px(0.28, 0.36, 0.03, 0.42, '#6e2c17'); px(0.69, 0.36, 0.03, 0.42, '#6e2c17');
  return c;
}

/** Fireball, 16×16 of pure menace. */
export function sprFireball(size = 16): HTMLCanvasElement {
  const [c, x] = canvas(size, size); const r = rng(77);
  const cx = size / 2, cy = size / 2;
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = r() * size * 0.42;
    x.fillStyle = d < size * 0.16 ? FR.cream : d < size * 0.3 ? FR.amber : FR.ember;
    x.fillRect(cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1, 3, 3);
  }
  return c;
}

/** Health vial, 16×24. */
export function sprVial(size = 16): HTMLCanvasElement {
  const [c, x] = canvas(size, size * 1.5); const w = size, h = size * 1.5;
  x.fillStyle = FR.ink; x.fillRect(w * 0.38, h * 0.06, w * 0.24, h * 0.12);
  x.fillStyle = '#4f7fd9'; x.fillRect(w * 0.32, h * 0.2, w * 0.36, h * 0.68);
  x.fillStyle = '#7fb0ff'; x.fillRect(w * 0.4, h * 0.26, w * 0.1, h * 0.5);
  x.fillStyle = FR.ink; x.fillRect(w * 0.32, h * 0.88, w * 0.36, h * 0.05);
  return c;
}

/** Ammo crate, 20×16. */
export function sprCrate(size = 20): HTMLCanvasElement {
  const [c, x] = canvas(size, size * 0.8); const w = size, h = size * 0.8;
  x.fillStyle = FR.ink; x.fillRect(0, 0, w, h);
  x.fillStyle = '#57633c'; x.fillRect(1, 1, w - 2, h - 2);
  x.fillStyle = '#414b2c'; x.fillRect(1, h * 0.4 | 0, w - 2, 2);
  x.fillStyle = FR.amber; x.fillRect(w * 0.2 | 0, h * 0.18 | 0, 3, 3); x.fillRect(w * 0.6 | 0, h * 0.66 | 0, 3, 3);
  return c;
}

/** Soft round glow for lamps, teleporters and explosions, 32×32. */
export function sprGlow(col: string, size = 32): HTMLCanvasElement {
  const [c, x] = canvas(size, size);
  const g = x.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}

/** A wall-mounted domain name plate. */
export function sprPlate(text: string): HTMLCanvasElement {
  const [c, x] = canvas(160, 40);
  x.fillStyle = '#0a1216'; x.fillRect(0, 0, 160, 40);
  x.strokeStyle = 'rgba(55,224,255,0.55)'; x.lineWidth = 2; x.strokeRect(2, 2, 156, 36);
  x.font = 'bold 18px "Courier New", monospace';
  x.fillStyle = FR.plate;
  x.fillText(text.toUpperCase().slice(0, 14), 8, 26);
  return c;
}

// ── the marine's hands ─────────────────────────────────────────────────────

/** First-person shotgun, drawn like it costs extra. */
export function sprGun(w = 200, h = 130): HTMLCanvasElement {
  const [c, x] = canvas(w, h);
  const px = (a: number, b: number, bw: number, bh: number, col: string) => { x.fillStyle = col; x.fillRect(a, b, bw, bh); };
  // outline pass so it reads against dark walls
  px(74, 2, 34, 86, FR.ink);
  // barrel rising toward center
  px(78, 6, 26, 82, '#59636f'); px(81, 8, 7, 78, '#93a0b0'); px(97, 8, 5, 78, '#3a424c');
  px(76, 0, 30, 8, '#2a3138');
  // receiver and pump
  px(100, 58, 72, 42, '#4a5462'); px(104, 62, 64, 7, '#93a0b0');
  px(110, 96, 58, 30, '#333c48');
  px(112, 74, 44, 18, '#7a5230'); px(115, 76, 40, 3, '#9c6c40');      // wood pump
  // hands
  px(120, 88, 26, 30, FR.flesh); px(150, 66, 24, 26, FR.flesh);
  px(120, 88, 26, 4, '#a56a45'); px(150, 66, 24, 4, '#a56a45');
  px(120, 116, 26, 4, FR.ink); px(150, 90, 24, 3, FR.ink);
  // trigger guard
  px(118, 100, 20, 4, FR.ink);
  return c;
}

/** Muzzle flash frame: layer 0..2 (bigger is later/fainter). */
export function sprMuzzle(layer: number, size = 96): HTMLCanvasElement {
  const [c, x] = canvas(size, size); const r = rng(5 + layer);
  const cx = size / 2, cy = size / 2, rad = size * (0.16 + 0.12 * layer);
  for (let i = 0; i < 26 + layer * 14; i++) {
    const a = r() * Math.PI * 2, d = r() * rad;
    x.fillStyle = d < rad * 0.4 ? FR.cream : d < rad * 0.7 ? FR.amber : FR.ember;
    const s = 3 + (r() * 4) | 0;
    x.fillRect(cx + Math.cos(a) * d - s / 2, cy + Math.sin(a) * d - s / 2, s, s);
  }
  return c;
}

// ── the status face ────────────────────────────────────────────────────────

/** The HUD's pixel marine face: mood 0 calm, 1 firing, 2 hurt, 3 demon-near. */
export function drawFace(cvs: HTMLCanvasElement, mood: number, hurtSide: boolean): void {
  const s = 32; cvs.width = s; cvs.height = s;
  const x = cvs.getContext('2d')!;
  const px = (a: number, b: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  x.clearRect(0, 0, s, s);
  px(7, 3, 18, 5, FR.hair); px(6, 6, 20, 3, FR.hair);            // hair
  px(8, 8, 16, 17, mood === 2 ? '#c9785a' : FR.flesh);           // face
  px(8, 25, 16, 4, '#8a6248');
  // eyes track demons when one is near
  const ex = mood === 3 ? -2 : 0;
  px(11 + ex, 12, 4, 4, '#f4f0e8'); px(18 + ex, 12, 4, 4, '#f4f0e8');
  px(12 + ex, 13, 2, 2, FR.ink); px(19 + ex, 13, 2, 2, FR.ink);
  if (mood === 1 || mood === 3) { px(10, 10, 5, 2, FR.hair); px(18, 10, 5, 2, FR.hair); }   // brows down
  if (mood === 0) px(13, 20, 7, 2, '#7d3a2c');                     // calm line
  if (mood === 1) { px(12, 19, 9, 5, '#4d1d16'); px(13, 20, 7, 2, '#f0e6d2'); }              // firing yell
  if (mood === 2) { px(12, 20, 9, 3, '#3d1512'); px(13, 21, 2, 1, '#f0e6d2'); px(18, 21, 2, 1, '#f0e6d2'); }
  if (mood === 3) { px(12, 19, 9, 4, '#4d1d16'); }
  if (mood === 2) {                                                             // blood when hurt
    const bx = hurtSide ? 8 : 19;
    px(bx, 9, 5, 2, FR.blood); px(bx + 1, 11, 3, 6, FR.blood); px(bx + 1, 17, 2, 5, FR.gore);
  }
}
