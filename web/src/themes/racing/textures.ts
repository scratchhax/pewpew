import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/** Everything is drawn in code: no image files for this theme. */

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

function tex(c: HTMLCanvasElement, color = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Metres of road one texture tile covers. */
export const ROAD_TILE = 36;
/** Road width the texture spans, in metres (4 lanes + shoulders). */
export const ROAD_WIDTH = 17;

/**
 * Asphalt with lane markings (colour) and a roughness map where the wheel
 * paths are polished smooth, so the wet sheen follows the lanes.
 */
export function roadTextures(): { map: Texture; rough: Texture } {
  const W = 512, H = 1024, pxm = W / ROAD_WIDTH, pyl = H / ROAD_TILE;
  const r = rnd(7);
  const map = canvas(W, H, (ctx) => {
    ctx.fillStyle = '#15161c';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26000; i++) {
      const v = 18 + r() * 26;
      ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
    // patches and cracks
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(r() * W, r() * H, 10 + r() * 50, 20 + r() * 90, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const lane = (m: number) => (ROAD_WIDTH / 2 + m) * pxm;
    // edge lines
    ctx.fillStyle = '#e8e4d8';
    for (const m of [-7.2, 7.2]) ctx.fillRect(lane(m) - 0.12 * pxm, 0, 0.24 * pxm, H);
    // dashed lane dividers: 3 m dash every 9 m
    for (const m of [-3.6, 0, 3.6]) {
      for (let y = 0; y < ROAD_TILE; y += 9) {
        ctx.fillStyle = m === 0 ? '#f2c14e' : '#e8e4d8';
        ctx.fillRect(lane(m) - 0.08 * pxm, y * pyl, 0.16 * pxm, 3 * pyl);
      }
    }
  });
  const rough = canvas(W / 4, H / 4, (ctx) => {
    const w = W / 4, h = H / 4, s = w / ROAD_WIDTH;
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(0, 0, w, h);
    // polished wheel paths in each lane
    for (const m of [-5.4, -1.8, 1.8, 5.4]) {
      for (const o of [-0.8, 0.8]) {
        const g = ctx.createLinearGradient((ROAD_WIDTH / 2 + m + o - 0.5) * s, 0, (ROAD_WIDTH / 2 + m + o + 0.5) * s, 0);
        g.addColorStop(0, 'rgba(40,40,40,0)');
        g.addColorStop(0.5, 'rgba(40,40,40,0.8)');
        g.addColorStop(1, 'rgba(40,40,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect((ROAD_WIDTH / 2 + m + o - 0.5) * s, 0, s, h);
      }
    }
    for (let i = 0; i < 1500; i++) {
      const v = 60 + r() * 160;
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(r() * w, r() * h, 2, 2);
    }
  });
  const m = tex(map), ro = tex(rough, false);
  for (const t of [m, ro]) { t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; }
  return { map: m, rough: ro };
}

/** A building facade: a grid of windows, some lit warm, some cool, a few neon. */
export function facade(seed: number): Texture {
  const r = rnd(seed * 97 + 13);
  const W = 256, H = 512, cols = 10, rows = 26;
  const c = canvas(W, H, (ctx) => {
    ctx.fillStyle = ['#0c0e16', '#100c14', '#0b1014'][seed % 3];
    ctx.fillRect(0, 0, W, H);
    const cw = W / cols, rh = H / rows;
    const warm = ['#ffcf8a', '#ffd9a8', '#ffb86b'], cool = ['#9fd8ff', '#b9e6ff', '#c8c8ff'], neon = ['#ff4fd8', '#3ff5ff', '#ffe14f'];
    for (let y = 0; y < rows; y++) {
      const floorLit = r() < 0.8;
      for (let x = 0; x < cols; x++) {
        const lit = floorLit && r() < 0.38;
        const p = r();
        ctx.fillStyle = !lit ? `rgba(30,40,60,${0.4 + r() * 0.3})` : p < 0.6 ? warm[(r() * 3) | 0] : p < 0.95 ? cool[(r() * 3) | 0] : neon[(r() * 3) | 0];
        ctx.globalAlpha = lit ? 0.55 + r() * 0.45 : 1;
        ctx.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.22, cw * 0.64, rh * 0.56);
      }
    }
    ctx.globalAlpha = 1;
  });
  return tex(c);
}

/** Neon lettering with a soft glow on transparent black. */
export function neonText(text: string, color: string, w = 1024, h = 256): CanvasTexture {
  return tex(canvas(w, h, (ctx) => drawNeon(ctx, text, color, w, h)));
}

export function drawNeon(ctx: CanvasRenderingContext2D, text: string, color: string, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  let size = h * 0.62;
  ctx.font = `italic 900 ${size}px "Arial Black", Impact, "Segoe UI", sans-serif`;
  while (ctx.measureText(text).width > w * 0.9 && size > 12) {
    size -= 4;
    ctx.font = `italic 900 ${size}px "Arial Black", Impact, "Segoe UI", sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  for (const [blur, a] of [[h * 0.25, 0.9], [h * 0.1, 1]] as const) {
    ctx.shadowBlur = blur;
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.75;
  ctx.fillText(text, w / 2, h / 2);
  ctx.globalAlpha = 1;
}

/** Soft round glow (underglow, light pools, beacons). */
export function glow(): Texture {
  return tex(canvas(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }));
}

/** A wet-road reflection: a narrow streak that fades along its length. */
export function streak(): Texture {
  return tex(canvas(64, 256, (ctx) => {
    const along = ctx.createLinearGradient(0, 0, 0, 256);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    along.addColorStop(0.55, 'rgba(255,255,255,0.5)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, 64, 256);
    ctx.globalCompositeOperation = 'destination-in';
    const across = ctx.createLinearGradient(0, 0, 64, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(0.5, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 64, 256);
  }));
}

/** Distant skyline silhouettes with pin-prick windows (wraps horizontally). */
export function skyline(): Texture {
  const r = rnd(4242);
  const t = tex(canvas(2048, 256, (ctx) => {
    let x = 0;
    while (x < 2048) {
      const w = 30 + r() * 90, h = 40 + r() * 190;
      ctx.fillStyle = '#07060e';
      ctx.fillRect(x, 256 - h, w, h);
      if (r() < 0.3) ctx.fillRect(x + w * 0.45, 256 - h - 20 - r() * 30, 3, 40);   // antenna
      for (let i = 0; i < w * h / 180; i++) {
        ctx.fillStyle = r() < 0.7 ? 'rgba(255,200,140,0.8)' : 'rgba(150,210,255,0.8)';
        ctx.fillRect(x + r() * w, 256 - r() * h, 2, 2);
      }
      x += w + r() * 10;
    }
  }));
  t.wrapS = RepeatWrapping;
  return t;
}

/** Red-and-white barrier stripes. */
export function stripes(): Texture {
  return tex(canvas(128, 32, (ctx) => {
    for (let i = -1; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#f2f2f2' : '#d8262e';
      ctx.beginPath();
      ctx.moveTo(i * 20, 32); ctx.lineTo(i * 20 + 20, 0); ctx.lineTo(i * 20 + 40, 0); ctx.lineTo(i * 20 + 20, 32);
      ctx.fill();
    }
  }));
}
