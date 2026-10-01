import { Assets, Rectangle, Texture } from 'pixi.js';
import atlasUrl from './assets/atlas.png';
import { ATLAS_FRAMES, type FrameName } from './assets/atlas';

/** Sprites from the Kenney atlas, plus the few effects drawn in code. */
export interface ZTextures {
  frame(name: FrameName): Texture;
  glow: Texture;
  splats: Texture[];
  rain: Texture;
  dot: Texture;
  /** Top-down ridge tent drawn in greys, tinted per device. */
  tent: Texture;
  /** A small brass round with a faint motion streak, pointing +x. */
  bullet: Texture;
}

export async function loadTextures(): Promise<ZTextures> {
  const base = await Assets.load<Texture>(atlasUrl);
  const cache = new Map<FrameName, Texture>();
  const frame = (name: FrameName): Texture => {
    let t = cache.get(name);
    if (!t) {
      const [x, y, w, h] = ATLAS_FRAMES[name];
      t = new Texture({ source: base.source, frame: new Rectangle(x, y, w, h) });
      cache.set(name, t);
    }
    return t;
  };
  return {
    frame,
    glow: canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.2, 'rgba(255,255,255,0.65)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
    // the pack's splat is pure black (can't be tinted), so blood is drawn here
    splats: [11, 23, 37].map((seed) => canvasTexture(64, (ctx, s) => splat(ctx, s, seed))),
    rain: canvasTexture(24, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(210,230,255,0)');
      g.addColorStop(1, 'rgba(210,230,255,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(s / 2 - 1, 0, 2, s);
    }),
    tent: canvasTexture(64, drawTent),
    bullet: canvasTexture(32, (ctx, s) => {
      const cy = s / 2;
      // motion streak behind the round (not a glow: a soft brass smear)
      const g = ctx.createLinearGradient(0, cy, s * 0.72, cy);
      g.addColorStop(0, 'rgba(210,170,90,0)');
      g.addColorStop(1, 'rgba(210,170,90,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, cy - 1, s * 0.72, 2);
      // the round: brass body, darker tip
      ctx.fillStyle = '#c9a24a';
      ctx.fillRect(s * 0.62, cy - 2, s * 0.26, 4);
      ctx.fillStyle = '#7a5a22';
      ctx.beginPath();
      ctx.arc(s * 0.88, cy, 2, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
    }),
    dot: canvasTexture(8, (ctx, s) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2 - 0.5, 0, Math.PI * 2);
      ctx.fill();
    }),
  };
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return Texture.from(c);
}

/**
 * A ridge tent seen from above, in greys so a tint colours it: two canvas
 * slopes (lit and shaded) meeting at a ridge, a darker front flap, and guy
 * lines to pegs at the corners. Reads as a tent without needing a label.
 */
function drawTent(ctx: CanvasRenderingContext2D, s: number): void {
  const x0 = s * 0.2, x1 = s * 0.8, y0 = s * 0.14, y1 = s * 0.86, cx = s / 2;
  // guy lines + pegs
  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  ctx.lineWidth = 1.2;
  ctx.fillStyle = 'rgba(40,40,40,0.7)';
  for (const [px, py, tx, ty] of [[s * 0.06, s * 0.08, x0, y0], [s * 0.94, s * 0.08, x1, y0],
                                  [s * 0.06, s * 0.92, x0, y1], [s * 0.94, s * 0.92, x1, y1]]) {
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
  }
  // soft ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x0 + 3, y0 + 4, x1 - x0, y1 - y0);
  // two slopes
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(x0, y0, cx - x0, y1 - y0);
  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(cx, y0, x1 - cx, y1 - y0);
  // front flap (triangle at the door end)
  ctx.fillStyle = '#8c8c8c';
  ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(cx, y1 - s * 0.16); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
  // ridge + outline
  ctx.strokeStyle = '#5a5a5a';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1 - s * 0.16); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

function splat(ctx: CanvasRenderingContext2D, s: number, seed: number): void {
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const blob = (x: number, y: number, rad: number, a: number) => {
    ctx.fillStyle = `rgba(${100 + (rnd() * 40) | 0},8,10,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  blob(s / 2, s / 2, s * 0.22, 0.85);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, d = s * (0.12 + rnd() * 0.18);
    blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.06 + rnd() * 0.09), 0.8);
  }
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = s * (0.3 + rnd() * 0.17);
    blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.015 + rnd() * 0.03), 0.75);
  }
}
