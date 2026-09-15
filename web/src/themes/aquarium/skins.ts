import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Fish are painted in side view onto one canvas each, in the fish's own
 * coordinates: x runs from the tail fin's tip (-0.36) to the nose (1.02), y
 * from -0.62 to 0.62, in body lengths. The body, the fins and the eyes all
 * sample this canvas by where they sit on the fish, so a stripe painted here
 * wraps around the 3D body, and a fin's outline is its painted alpha. The eye
 * and the pectoral fin live in the free corners by the nose.
 */
export const SKIN = { x0: -0.36, x1: 1.02, y0: -0.62, y1: 0.62, size: 1024 };
export const EYE_SLOT = { x: 0.95, y: 0.54, r: 0.06 };             // centre of the painted eye
export const PEC_SLOT = { x0: 0.74, x1: 1.0, y0: -0.6, y1: -0.44 };  // the pectoral fin's box

export const tu = (x: number) => (x - SKIN.x0) / (SKIN.x1 - SKIN.x0);
export const tv = (y: number) => (y - SKIN.y0) / (SKIN.y1 - SKIN.y0);

export interface Painter {
  g: CanvasRenderingContext2D;
  /** Canvas px for a fish x / y. */
  px(x: number): number;
  py(y: number): number;
  /** Body lengths → px. */
  s(d: number): number;
  /** Fill a closed path through fish-space points (a smooth curve). */
  shape(pts: Array<[number, number]>, fill: string | CanvasGradient | CanvasPattern): void;
  /** A linear gradient between two fish-space points. */
  grad(x0: number, y0: number, x1: number, y1: number, stops: Array<[number, string]>): CanvasGradient;
  /** Soft speckle over a region. */
  speckle(x0: number, y0: number, x1: number, y1: number, n: number, r: number, color: string, seed?: number): void;
  /** Fin rays: thin lines fanning from a root through a set of tips. */
  rays(root: [number, number], tips: Array<[number, number]>, color: string, width?: number): void;
  /** Overlapping scale edges over everything inside the current clip (free edges face the tail). */
  scales(size: number, color: string, width?: number): void;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

export function paintSkin(paint: (p: Painter) => void, eye: { iris: string; pupil?: string }): Texture {
  const N = SKIN.size;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d')!;
  const px = (x: number) => tu(x) * N;
  const py = (y: number) => (1 - tv(y)) * N;
  const s = (d: number) => d / (SKIN.x1 - SKIN.x0) * N;
  const p: Painter = {
    g, px, py, s,
    shape(pts, fill) {
      g.beginPath();
      const P = pts.map(([x, y]) => [px(x), py(y)]);
      const n = P.length;
      const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const start = mid(P[n - 1], P[0]);
      g.moveTo(start[0], start[1]);
      for (let i = 0; i < n; i++) {
        const m = mid(P[i], P[(i + 1) % n]);
        g.quadraticCurveTo(P[i][0], P[i][1], m[0], m[1]);
      }
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    },
    grad(x0, y0, x1, y1, stops) {
      const gr = g.createLinearGradient(px(x0), py(y0), px(x1), py(y1));
      for (const [k, col] of stops) gr.addColorStop(k, col);
      return gr;
    },
    speckle(x0, y0, x1, y1, n, r, color, seed = 5) {
      const R = rng(seed);
      g.fillStyle = color;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        g.arc(px(x0 + R() * (x1 - x0)), py(y0 + R() * (y1 - y0)), s(r) * (0.5 + R()), 0, Math.PI * 2);
        g.fill();
      }
    },
    scales(size, color, width = 1.2) {
      const d = s(size);
      g.strokeStyle = color; g.lineWidth = width;
      for (let row = 0, y = 0; y < N + d; row++, y += d * 0.5) {
        for (let x = (row % 2) * d * 0.5 - d; x < N + d; x += d) {
          g.beginPath(); g.arc(x, y, d * 0.55, Math.PI * 0.62, Math.PI * 1.38); g.stroke();
        }
      }
    },
    rays(root, tips, color, width = 1.5) {
      g.strokeStyle = color; g.lineWidth = width;
      for (const t of tips) {
        g.beginPath();
        g.moveTo(px(root[0]), py(root[1]));
        g.quadraticCurveTo(px((root[0] + t[0]) / 2), py((root[1] + t[1]) / 2 + 0.01), px(t[0]), py(t[1]));
        g.stroke();
      }
    },
  };
  paint(p);

  // the eye: a glossy dark pupil in a coloured iris
  const ex = px(EYE_SLOT.x), ey = py(EYE_SLOT.y), er = s(EYE_SLOT.r);
  const ir = g.createRadialGradient(ex, ey, er * 0.2, ex, ey, er);
  ir.addColorStop(0, eye.iris); ir.addColorStop(0.75, eye.iris); ir.addColorStop(1, '#1a1a14');
  g.fillStyle = ir; g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.fill();
  g.fillStyle = eye.pupil ?? '#040506'; g.beginPath(); g.arc(ex, ey, er * 0.55, 0, Math.PI * 2); g.fill();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Overlapping scales as a tiling normal map. */
export function scaleNormals(): Texture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const cell = N / 4;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // each scale is a half-disc overlapping the one behind it
    let nx = 0, ny = 0;
    for (const oy of [0, cell / 2]) {
      const row = Math.floor((y + oy) / cell);
      const shift = row % 2 ? cell / 2 : 0;
      const cx = (Math.floor((x + shift) / cell) + 0.5) * cell - shift;
      const cy = row * cell - oy + cell * 0.2;
      const dx = (x - cx) / cell, dy = (y - cy) / cell;
      const d = Math.hypot(dx, dy);
      if (d < 0.62 && dy > -0.1) { const k = Math.sin(Math.min(1, d / 0.62) * Math.PI * 0.5); nx = dx * k * 0.9; ny = dy * k * 0.9; }
    }
    const i = (y * N + x) * 4;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (-ny * 0.5 + 0.5) * 255; img.data[i + 2] = nz * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}
