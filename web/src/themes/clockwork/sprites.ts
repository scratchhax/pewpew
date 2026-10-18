import { Texture } from 'pixi.js';

/**
 * Clockwork's pixel tooling and procedural parts: every gear, pipe, plate and
 * bearing is drawn in code from the steampunk palette below — brass and iron,
 * rivets and damask — in chunky 16-bit style. Animated parts (gears, needles,
 * hammers) are single clean sprites that the scene rotates; anything that
 * tiles (wallpaper, girders, rails) is drawn once into the world canvas.
 */

/** The steampunk palette: iron and brass structures, event colours as glass. */
export const P = {
  ink: '#14121c',
  ironDark: '#262833', iron: '#3a3d4d', ironLight: '#565a6e', ironHi: '#767b92',
  brassDark: '#6e4f1d', brass: '#a87c2a', brassLight: '#d9a94a', brassHi: '#f2d489',
  copper: '#8f4f2e', copperLight: '#c07a4a',
  oak: '#4a3320', oakLight: '#6b4a2e',
  verd: '#3f7d6a',
  paper: '#d8c9a0', paperDark: '#a89772',
  fire: '#ff7a2a', ember: '#ffb347', glow: '#ffd88a',
  steel: '#9aa4b8', steelHi: '#e8eef8',
  wall: '#191621', wall2: '#211c2c', wall3: '#2a2336',
  // the fixed event law, as lamp glass and dyed steam
  allow: '#5ce6a4', block: '#ff6b6b', threat: '#ff9a45', dns: '#55b5ff',
  dhcp: '#ffd84d', wifi: '#c08cff', system: '#7d99b3',
};

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

/** A small seeded random (so the machine is the same every load). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

// ── 3x5 pixel font (same shapes the other scenes use, steampunk ink) ──────
const GLYPHS: Record<string, string[]> = {
  "0": ["###","#.#","#.#","#.#","###"], "1": [".#.","##.",".#.",".#.","###"],
  "2": ["##.","..#",".#.","#..","###"], "3": ["##.","..#",".#.","..#","##."],
  "4": ["#.#","#.#","###","..#","..#"], "5": ["###","#..","##.","..#","##."],
  "6": [".##","#..","###","#.#","###"], "7": ["###","..#",".#.",".#.",".#."],
  "8": ["###","#.#","###","#.#","###"], "9": ["###","#.#","###","..#","##."],
  A: [".#.","#.#","###","#.#","#.#"], B: ["##.","#.#","##.","#.#","##."],
  C: [".##","#..","#..","#..",".##"], D: ["##.","#.#","#.#","#.#","##."],
  E: ["###","#..","##.","#..","###"], F: ["###","#..","##.","#..","#.."],
  G: [".##","#..","#.#","#.#",".##"], H: ["#.#","#.#","###","#.#","#.#"],
  I: ["###",".#.",".#.",".#.","###"], J: ["..#","..#","..#","#.#",".#."],
  K: ["#.#","#.#","##.","#.#","#.#"], L: ["#..","#..","#..","#..","###"],
  M: ["#.#","###","###","#.#","#.#"], N: ["##.","#.#","#.#","#.#","#.#"],
  O: [".#.","#.#","#.#","#.#",".#."], P: ["##.","#.#","##.","#..","#.."],
  Q: [".#.","#.#","#.#","##.",".##"], R: ["##.","#.#","##.","#.#","#.#"],
  S: [".##","#..",".#.","..#","##."], T: ["###",".#.",".#.",".#.",".#."],
  U: ["#.#","#.#","#.#","#.#","###"], V: ["#.#","#.#","#.#","#.#",".#."],
  W: ["#.#","#.#","###","###","#.#"], X: ["#.#","#.#",".#.","#.#","#.#"],
  Y: ["#.#","#.#",".#.",".#.",".#."], Z: ["###","..#",".#.","#..","###"],
  ".": ["...","...","...","...",".#."], "-": ["...","...","###","...","..."],
  "_": ["...","...","...","...","###"], ":": ["...",".#.","...",".#.","..."],
  "/": ["..#","..#",".#.","#..","#.."], " ": ["...","...","...","...","..."],
};

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, outline: string | null = P.ink, scale = 1): number {
  const s = text.toUpperCase();
  const put = (ox: number, oy: number, col: string) => {
    ctx.fillStyle = col;
    for (let k = 0; k < s.length; k++) {
      const g = GLYPHS[s[k]] ?? GLYPHS[' '];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) {
        if (g[j][i] === '#') ctx.fillRect(x + (k * 4 + i) * scale + ox, y + j * scale + oy, scale, scale);
      }
    }
  };
  if (outline) for (const [dx, dy] of [[-scale, 0], [scale, 0], [0, -scale], [0, scale]]) put(dx, dy, outline);
  put(0, 0, color);
  return s.length * 4 * scale;
}

// ── parts ──────────────────────────────────────────────────────────────────

/**
 * A gear with real trapezoid teeth. `teeth` must come from the train maths
 * (r = teeth * PITCH / 2PI) so gears with the same pitch actually mesh.
 * Rotates in code; tooth 0 points along +x at rotation 0.
 */
export function gearTexture(teeth: number, r: number, brass: boolean): HTMLCanvasElement {
  const s = Math.ceil(r * 2 + 20);
  return canvas(s, s, (c) => {
    const cx = s / 2, cy = s / 2;
    const dark = brass ? P.brassDark : P.ironDark;
    const mid = brass ? P.brass : P.iron;
    const lite = brass ? P.brassLight : P.ironLight;
    const th = Math.max(5, r * 0.13);            // tooth height
    const wr = (Math.PI / teeth) * 0.62;         // half-width at the root
    const wt = (Math.PI / teeth) * 0.34;         // half-width at the tip
    // teeth as trapezoids
    for (let i = 0; i < teeth; i++) {
      c.save(); c.translate(cx, cy); c.rotate((i / teeth) * Math.PI * 2);
      c.beginPath();
      c.moveTo(Math.cos(-wr) * (r - 1), Math.sin(-wr) * (r - 1));
      c.lineTo(Math.cos(-wt) * (r + th), Math.sin(-wt) * (r + th));
      c.lineTo(Math.cos(wt) * (r + th), Math.sin(wt) * (r + th));
      c.lineTo(Math.cos(wr) * (r - 1), Math.sin(wr) * (r - 1));
      c.closePath();
      c.fillStyle = mid; c.fill();
      // lit flank
      c.beginPath();
      c.moveTo(Math.cos(-wr) * (r - 1), Math.sin(-wr) * (r - 1));
      c.lineTo(Math.cos(-wt) * (r + th), Math.sin(-wt) * (r + th));
      c.lineTo(Math.cos(-wt) * (r + th * 0.4), Math.sin(-wt) * (r + th * 0.4));
      c.closePath();
      c.fillStyle = lite; c.fill();
      c.restore();
    }
    // body
    c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fillStyle = mid; c.fill();
    c.beginPath(); c.arc(cx, cy, r - 2, 0, 7); c.fillStyle = dark; c.fill();
    c.beginPath(); c.arc(cx, cy, r - 4, 0, 7); c.fillStyle = mid; c.fill();
    // rim highlight (top-left, flat 16-bit lighting)
    c.beginPath(); c.arc(cx, cy, r - 3, Math.PI * 1.05, Math.PI * 1.6);
    c.strokeStyle = lite; c.lineWidth = 2; c.stroke();
    // spokes
    c.strokeStyle = dark; c.lineWidth = Math.max(3, r * 0.16);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5)); c.stroke();
    }
    // hub
    c.beginPath(); c.arc(cx, cy, Math.max(3, r * 0.2), 0, 7); c.fillStyle = lite; c.fill();
    c.beginPath(); c.arc(cx, cy, Math.max(1.5, r * 0.09), 0, 7); c.fillStyle = dark; c.fill();
  });
}

/** The boiler: a riveted brass drum with bands, a gauge boss and legs. */
export function boilerTexture(w: number, h: number): HTMLCanvasElement {
  return canvas(w, h, (c) => {
    c.fillStyle = P.ironDark; c.fillRect(0, 0, w, h);
    c.fillStyle = P.brass; c.fillRect(2, 2, w - 4, h - 4);
    c.fillStyle = P.brassLight; c.fillRect(4, 4, 6, h - 8);
    c.fillStyle = P.brassDark; c.fillRect(w - 10, 4, 6, h - 8);
    // bands + rivets
    for (const by of [h * 0.22, h * 0.62]) {
      c.fillStyle = P.brassDark; c.fillRect(2, by, w - 4, 4);
      c.fillStyle = P.brassHi;
      for (let x = 8; x < w - 6; x += 10) c.fillRect(x, by + 1, 2, 2);
    }
    // dome on top
    c.fillStyle = P.brass; c.fillRect(w * 0.36, -10, w * 0.28, 12);
    c.fillStyle = P.brassLight; c.fillRect(w * 0.36, -10, w * 0.28, 3);
    // legs
    c.fillStyle = P.iron; c.fillRect(6, h - 4, 10, 8); c.fillRect(w - 16, h - 4, 10, 8);
  });
}

/** The furnace mouth: a dark arch with brick surround; the fire rides inside. */
export function furnaceTexture(w: number, h: number): HTMLCanvasElement {
  return canvas(w, h, (c) => {
    c.fillStyle = P.oak; c.fillRect(0, 0, w, h);
    c.fillStyle = P.oakLight; c.fillRect(1, 1, w - 2, 3);
    c.fillStyle = P.ironDark; c.fillRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#0d0a12'; c.fillRect(7, 7, w - 14, h - 14);
    // iron bars
    c.fillStyle = P.iron;
    for (let x = 10; x < w - 10; x += 8) c.fillRect(x, h - 12, 2, 6);
  });
}

/** A pressure gauge: brass ring, bone face, ticks. The needle is separate. */
export function gaugeTexture(r: number): HTMLCanvasElement {
  const s = Math.ceil(r * 2 + 4);
  return canvas(s, s, (c) => {
    const cx = s / 2;
    c.beginPath(); c.arc(cx, cx, r, 0, 7); c.fillStyle = P.brassDark; c.fill();
    c.beginPath(); c.arc(cx, cx, r - 1.5, 0, 7); c.fillStyle = P.brassLight; c.fill();
    c.beginPath(); c.arc(cx, cx, r - 3, 0, 7); c.fillStyle = P.paper; c.fill();
    c.strokeStyle = P.ink; c.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (r - 4.5), cx + Math.sin(a) * (r - 4.5));
      c.lineTo(cx + Math.cos(a) * (r - 7), cx + Math.sin(a) * (r - 7));
      c.stroke();
    }
    // the red zone
    c.strokeStyle = P.block; c.lineWidth = 1.5;
    c.beginPath(); c.arc(cx, cx, r - 5, Math.PI * 0.75 + Math.PI * 1.5 * 0.78, Math.PI * 0.75 + Math.PI * 1.5); c.stroke();
  });
}

/** A gauge needle (pivot at the left-middle). */
export function needleTexture(len: number): HTMLCanvasElement {
  return canvas(len + 3, 3, (c) => {
    c.fillStyle = P.ink; c.fillRect(0, 1, len, 1);
    c.fillStyle = P.block; c.fillRect(len - 3, 1, 3, 1);
  });
}

/** A brass nameplate with the hostname engraved. */
export function plateTexture(name: string): HTMLCanvasElement {
  const w = Math.max(34, name.length * 4 + 8);
  return canvas(w, 12, (c) => {
    c.fillStyle = P.brassDark; c.fillRect(0, 0, w, 12);
    c.fillStyle = P.brassLight; c.fillRect(1, 1, w - 2, 10);
    c.fillStyle = P.brass; c.fillRect(1, 9, w - 2, 2);
    c.fillStyle = P.brassHi; c.fillRect(2, 2, 2, 2); c.fillRect(w - 4, 2, 2, 2);
    drawText(c, name.slice(0, Math.floor((w - 10) / 4)), 5, 4, P.ink, null);
  });
}

/** A ball bearing. */
export function ballTexture(): HTMLCanvasElement {
  return canvas(7, 7, (c) => {
    c.fillStyle = P.steel; c.beginPath(); c.arc(3.5, 3.5, 3, 0, 7); c.fill();
    c.fillStyle = P.steelHi; c.fillRect(2, 1, 2, 2);
    c.fillStyle = P.ironDark; c.fillRect(4, 5, 2, 1);
  });
}

/** A sealed envelope for the pneumatic mail. */
export function mailTexture(): HTMLCanvasElement {
  return canvas(10, 7, (c) => {
    c.fillStyle = P.paper; c.fillRect(0, 0, 10, 7);
    c.strokeStyle = P.paperDark; c.beginPath(); c.moveTo(0, 0); c.lineTo(5, 4); c.lineTo(10, 0); c.stroke();
    c.fillStyle = P.dns; c.fillRect(7, 1, 2, 2);
  });
}

/** A coal cart. */
export function cartTexture(): HTMLCanvasElement {
  return canvas(18, 13, (c) => {
    c.fillStyle = P.iron; c.fillRect(1, 2, 16, 8);
    c.fillStyle = P.ironLight; c.fillRect(1, 2, 16, 2);
    c.fillStyle = '#0d0a12'; c.fillRect(3, 0, 12, 3);
    c.fillStyle = P.fire; c.fillRect(5, 0, 2, 2); c.fillRect(10, 1, 2, 1);
    c.fillStyle = P.ironDark; c.beginPath(); c.arc(5, 11, 2.4, 0, 7); c.fill(); c.beginPath(); c.arc(13, 11, 2.4, 0, 7); c.fill();
  });
}

/** A warning lamp: iron hood over glass the colour of the event law. */
export function lampTexture(color: string): HTMLCanvasElement {
  return canvas(12, 14, (c) => {
    c.fillStyle = P.ironDark; c.fillRect(1, 0, 10, 3);
    c.fillStyle = color; c.fillRect(2, 3, 8, 8);
    c.fillStyle = P.ink; c.fillRect(2, 3, 1, 8); c.fillRect(9, 3, 1, 8);
    c.fillStyle = P.iron; c.fillRect(1, 11, 10, 2);
  });
}

/** A steam whistle. */
export function whistleTexture(): HTMLCanvasElement {
  return canvas(14, 16, (c) => {
    c.fillStyle = P.brass; c.fillRect(4, 4, 6, 10);
    c.fillStyle = P.brassLight; c.fillRect(4, 4, 2, 10);
    c.fillStyle = P.brassDark; c.fillRect(2, 12, 10, 3);
    c.fillStyle = P.brass; c.fillRect(5, 0, 4, 5);
    c.fillStyle = P.brassHi; c.fillRect(5, 0, 1, 5);
  });
}

/** A soft steam puff. */
export function puffTexture(): HTMLCanvasElement {
  return canvas(16, 16, (c) => {
    const g = c.createRadialGradient(8, 8, 1, 8, 8, 8);
    g.addColorStop(0, 'rgba(232,238,248,0.9)');
    g.addColorStop(1, 'rgba(232,238,248,0)');
    c.fillStyle = g; c.fillRect(0, 0, 16, 16);
  });
}

/** A flame for the furnace (flickers in code). */
export function flameTexture(): HTMLCanvasElement {
  return canvas(12, 14, (c) => {
    c.fillStyle = P.fire;
    c.beginPath(); c.moveTo(6, 0); c.quadraticCurveTo(11, 7, 6, 13); c.quadraticCurveTo(1, 7, 6, 0); c.fill();
    c.fillStyle = P.ember;
    c.beginPath(); c.moveTo(6, 4); c.quadraticCurveTo(9, 8, 6, 12); c.quadraticCurveTo(3, 8, 6, 4); c.fill();
  });
}

/** A hammer head on its arm (pivot at the left-middle). */
export function hammerTexture(): HTMLCanvasElement {
  return canvas(22, 10, (c) => {
    c.fillStyle = P.oakLight; c.fillRect(0, 4, 15, 3);
    c.fillStyle = P.iron; c.fillRect(14, 0, 7, 10);
    c.fillStyle = P.ironLight; c.fillRect(14, 0, 7, 2);
  });
}

/** A valve wheel. */
export function wheelTexture(): HTMLCanvasElement {
  return canvas(14, 14, (c) => {
    c.strokeStyle = P.copperLight; c.lineWidth = 2;
    c.beginPath(); c.arc(7, 7, 5.5, 0, 7); c.stroke();
    c.strokeStyle = P.copper;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      c.beginPath(); c.moveTo(7, 7); c.lineTo(7 + Math.cos(a) * 5.5, 7 + Math.sin(a) * 5.5); c.stroke();
    }
    c.fillStyle = P.brass; c.fillRect(6, 6, 2, 2);
  });
}

/** A bell (rings when mail arrives). */
export function bellTexture(): HTMLCanvasElement {
  return canvas(12, 12, (c) => {
    c.fillStyle = P.brass;
    c.beginPath(); c.moveTo(6, 1); c.quadraticCurveTo(11, 6, 10, 9); c.lineTo(2, 9); c.quadraticCurveTo(1, 6, 6, 1); c.fill();
    c.fillStyle = P.brassHi; c.fillRect(4, 3, 2, 4);
    c.fillStyle = P.brassDark; c.fillRect(5, 9, 2, 2);
  });
}

// ── chain-reaction parts ───────────────────────────────────────────────────

/** A domino: iron tile with a brass pip, pivot at the bottom centre. */
export function dominoTexture(): HTMLCanvasElement {
  return canvas(8, 20, (c) => {
    c.fillStyle = P.ironDark; c.fillRect(0, 0, 8, 20);
    c.fillStyle = P.ironLight; c.fillRect(1, 1, 3, 18);
    c.fillStyle = P.iron; c.fillRect(4, 1, 3, 18);
    c.fillStyle = P.brassLight; c.fillRect(3, 4, 2, 2); c.fillRect(3, 12, 2, 2);
  });
}

/** A brass funnel the bearings drop into, mouth up. */
export function funnelTexture(): HTMLCanvasElement {
  return canvas(70, 46, (c) => {
    c.fillStyle = P.brassDark;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(70, 0); c.lineTo(44, 30); c.lineTo(44, 46); c.lineTo(26, 46); c.lineTo(26, 30); c.closePath(); c.fill();
    c.fillStyle = P.brass;
    c.beginPath(); c.moveTo(3, 3); c.lineTo(67, 3); c.lineTo(42, 29); c.lineTo(42, 44); c.lineTo(28, 44); c.lineTo(28, 29); c.closePath(); c.fill();
    c.fillStyle = P.brassHi;
    c.beginPath(); c.moveTo(3, 3); c.lineTo(24, 3); c.lineTo(30, 27); c.lineTo(28, 29); c.closePath(); c.fill();
    c.fillStyle = '#0d0a12'; c.fillRect(4, 3, 62, 4);
  });
}

/** A flywheel: spoked iron rim with paddles and a brass crank pin. */
export function flywheelTexture(r: number): HTMLCanvasElement {
  const s = Math.ceil(r * 2 + 10);
  return canvas(s, s, (c) => {
    const cx = s / 2;
    c.strokeStyle = P.iron; c.lineWidth = 7;
    c.beginPath(); c.arc(cx, cx, r, 0, 7); c.stroke();
    c.strokeStyle = P.ironHi; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cx, r + 3, Math.PI * 1.1, Math.PI * 1.7); c.stroke();
    c.strokeStyle = P.ironDark; c.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      c.beginPath(); c.moveTo(cx, cx); c.lineTo(cx + Math.cos(a) * (r - 3), cx + Math.sin(a) * (r - 3)); c.stroke();
    }
    c.fillStyle = P.brass; c.beginPath(); c.arc(cx, cx, r * 0.2, 0, 7); c.fill();
    c.fillStyle = P.brassHi; c.beginPath(); c.arc(cx, cx, r * 0.09, 0, 7); c.fill();
    // crank pin
    c.fillStyle = P.brassLight; c.beginPath(); c.arc(cx + r * 0.62, cx, 4, 0, 7); c.fill();
  });
}

/** A steam vane wheel: eight brass blades on a hub. */
export function vaneTexture(): HTMLCanvasElement {
  const s = 60;
  return canvas(s, s, (c) => {
    const cx = s / 2;
    for (let i = 0; i < 8; i++) {
      c.save(); c.translate(cx, cx); c.rotate((i / 8) * Math.PI * 2);
      c.fillStyle = i % 2 ? P.brass : P.brassLight;
      c.beginPath(); c.moveTo(0, -3); c.lineTo(26, -7); c.lineTo(26, 3); c.lineTo(0, 3); c.closePath(); c.fill();
      c.restore();
    }
    c.fillStyle = P.iron; c.beginPath(); c.arc(cx, cx, 6, 0, 7); c.fill();
    c.fillStyle = P.brassHi; c.beginPath(); c.arc(cx, cx, 2.5, 0, 7); c.fill();
  });
}

/** A lever: oak plank with an iron cap, pivot at the left end. */
export function leverTexture(): HTMLCanvasElement {
  return canvas(44, 8, (c) => {
    c.fillStyle = P.oakLight; c.fillRect(0, 2, 36, 4);
    c.fillStyle = P.iron; c.fillRect(34, 0, 10, 8);
    c.fillStyle = P.ironHi; c.fillRect(34, 0, 10, 2);
  });
}

// ── the 3x5 font as a texture helper ───────────────────────────────────────
export function labelTexture(text: string, color: string): HTMLCanvasElement {
  const w = text.length * 4 + 3;
  return canvas(w, 7, (c) => drawText(c, text, 1, 1, color, P.ink));
}
