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
