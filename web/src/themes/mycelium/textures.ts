import { Texture } from 'pixi.js';

/**
 * Everything Mycelium draws is painted here, once, into canvases: soft glows
 * (the whole bioluminescent look is layered additive radial gradients), a
 * scorch blotch, ghost-mushroom caps in three shapes, drifting motes, film
 * grain and the vignette that keeps the loam dark at the edges.
 */
export interface MTextures {
  glowSoft: Texture;
  glowCore: Texture;
  mote: Texture;
  scorch: Texture;
  caps: Texture[];
  grain: Texture;
  vignette: Texture;
}

export function loadTextures(): MTextures {
  return {
    glowSoft: canvasTexture(128, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.38)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    }),
    glowCore: canvasTexture(64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    }),
    mote: canvasTexture(16, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); c.fill();
    }),
    scorch: canvasTexture(128, (c, s) => {
      // organic blotch: a dark core with ragged edge and faint ash rim
      const blob = (x: number, y: number, r: number, a: number) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(12,6,4,${a})`);
        g.addColorStop(0.58, `rgba(18,9,5,${a * 0.8})`);
        g.addColorStop(0.74, `rgba(96,38,12,${a * 0.5})`);
        g.addColorStop(0.86, `rgba(255,110,40,${a * 0.42})`);
        g.addColorStop(1, 'rgba(60,24,8,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      };
      blob(s / 2, s / 2, s * 0.30, 0.92);
      let r = 7;
      const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
      for (let i = 0; i < 6; i++) {
        const a = rnd() * Math.PI * 2, d = s * (0.10 + rnd() * 0.16);
        blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.08 + rnd() * 0.12), 0.8);
      }
    }),
    // three silhouettes (amanita/morel/parasol), a few seed variants each,
    // so a grove reads as a species mix rather than one stamped shape
    caps: ([[3, 0], [17, 0], [29, 0], [11, 1], [41, 1], [21, 2], [53, 2], [8, 2]] as [number, number][])
      .map(([seed, kind]) => canvasTexture(96, (c, s) => drawCap(c, s, seed, kind))),
    grain: canvasTexture(128, (c, s) => {
      const img = c.createImageData(s, s);
      for (let i = 0; i < s * s; i++) {
        const v = (Math.random() * 255) | 0;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 26;
      }
      c.putImageData(img, 0, 0);
    }),
    vignette: canvasTexture(512, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, s * 0.30, s / 2, s / 2, s * 0.72);
      g.addColorStop(0, 'rgba(2,3,3,0)');
      g.addColorStop(0.7, 'rgba(2,3,3,0.34)');
      g.addColorStop(1, 'rgba(1,2,2,0.78)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    }),
  };
}

/**
 * A ghost mushroom in greys (tinted at use). Three silhouettes:
 * 0 = amanita — slim tapering stem, bulbous base, domed cap with gills and
 * freckles; 1 = morel — narrow tall stem, high fluted cap pitted with
 * dimples, fused straight to the stem; 2 = parasol — thin tall stem with an
 * unusually broad, low, upturned cap and a scalloped rim. Seeds vary the
 * silhouette so a grove never looks stamped.
 */
function drawCap(c: CanvasRenderingContext2D, s: number, seed: number, kind: number): void {
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const cx = s * 0.5, base = s * 0.94;
  const tall = kind === 2 ? 1.22 : kind === 1 ? 1.12 : 1;
  const h = s * (0.62 + rnd() * 0.16) * tall;       // stem height
  const capY = base - h;                            // cap underside
  const capR = s * (kind === 1 ? 0.20 + rnd() * 0.04 : kind === 2 ? 0.40 + rnd() * 0.04 : 0.28 + rnd() * 0.10);
  const lean = (rnd() - 0.5) * s * 0.08;

  // stem: tapered, slightly curved, lit from the left
  const stemW = s * (kind === 2 ? 0.04 : kind === 1 ? 0.038 : 0.055);
  c.fillStyle = '#e8e4da';
  c.beginPath();
  c.moveTo(cx - stemW * 1.7, base);
  c.bezierCurveTo(cx - stemW * 1.2 + lean, base - h * 0.5, cx - stemW + lean, capY + s * 0.06, cx - stemW * 0.8 + lean, capY + 2);
  c.lineTo(cx + stemW * 0.8 + lean, capY + 2);
  c.bezierCurveTo(cx + stemW + lean, capY + s * 0.06, cx + stemW * 1.4 + lean, base - h * 0.5, cx + stemW * 1.9, base);
  c.closePath(); c.fill();
  // shaded right side of the stem
  c.fillStyle = 'rgba(40,38,34,0.35)';
  c.beginPath();
  c.moveTo(cx + stemW * 0.2, base);
  c.bezierCurveTo(cx + stemW * 0.9 + lean, base - h * 0.5, cx + stemW * 0.9 + lean, capY + s * 0.05, cx + stemW * 0.5 + lean, capY + 2);
  c.lineTo(cx + stemW * 0.8 + lean, capY + 2);
  c.bezierCurveTo(cx + stemW + lean, capY + s * 0.06, cx + stemW * 1.4 + lean, base - h * 0.5, cx + stemW * 1.9, base);
  c.closePath(); c.fill();
  // bulbous base
  c.fillStyle = '#ded9cd';
  c.beginPath(); c.ellipse(cx, base - s * 0.012, stemW * 2.2, s * 0.028, 0, 0, Math.PI * 2); c.fill();

  if (kind === 1) {
    // morel: a tall fluted ovoid fused to the stem, pitted with dimples
    const ch = s * (0.30 + rnd() * 0.08);
    const g = c.createLinearGradient(cx + lean - capR, 0, cx + lean + capR, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#efe9dd');
    g.addColorStop(1, '#c9c0af');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(cx + lean, capY + s * 0.02);
    c.bezierCurveTo(cx + lean - capR * 1.25, capY - ch * 0.35, cx + lean - capR, capY - ch, cx + lean, capY - ch);
    c.bezierCurveTo(cx + lean + capR, capY - ch, cx + lean + capR * 1.25, capY - ch * 0.35, cx + lean, capY + s * 0.02);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(120,110,95,0.42)';
    for (let row = 0; row < 4; row++) {
      const yy = capY - ch * (0.15 + row * 0.22);
      for (let kx = -1; kx <= 1; kx++) {
        const xx = cx + lean + kx * capR * 0.55 + (row % 2 ? capR * 0.27 : -capR * 0.27);
        if (Math.hypot((xx - cx - lean) / (capR * 0.8), (yy - (capY - ch * 0.5)) / (ch * 0.6)) > 0.9) continue;
        c.beginPath(); c.ellipse(xx, yy, s * 0.017, s * 0.013, 0, 0, Math.PI * 2); c.fill();
      }
    }
    return;
  }

  // gills: a darker band under the cap
  const cy2 = capY + 2 - s * 0.012;
  c.fillStyle = '#b9b2a4';
  c.beginPath(); c.ellipse(cx + lean, cy2, capR * 0.86, s * 0.028, 0, 0, Math.PI * 2); c.fill();

  // cap: domed (amanita) or broad and low with an upturned rim (parasol)
  const domeH = s * (kind === 2 ? 0.07 + rnd() * 0.02 : 0.13 + rnd() * 0.05);
  const flare = kind === 2 ? -s * 0.022 : s * 0.03;
  const g = c.createRadialGradient(cx + lean - capR * 0.4, capY - domeH * 0.6, capR * 0.15, cx + lean, capY - domeH * 0.4, capR * 1.4);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#efe9dd');
  g.addColorStop(1, '#c9c0af');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(cx + lean - capR, cy2);
  c.bezierCurveTo(cx + lean - capR, capY - domeH * 1.6, cx + lean + capR, capY - domeH * 1.6, cx + lean + capR, cy2);
  c.bezierCurveTo(cx + lean + capR * 0.6, cy2 + flare, cx + lean - capR * 0.6, cy2 + flare, cx + lean - capR, cy2);
  c.closePath(); c.fill();
  if (kind === 2) {
    // scalloped rim: shallow bumps pinned along the cap edge
    c.fillStyle = 'rgba(201,192,175,0.9)';
    for (let k = 0; k < 5; k++) {
      const bx = cx + lean + (k / 4 - 0.5) * 2 * capR * 0.88;
      c.beginPath(); c.arc(bx, cy2 - s * 0.004, s * 0.022, Math.PI, 0); c.fill();
    }
    // a skirt line where the cap meets the thin stem
    c.fillStyle = 'rgba(120,110,95,0.35)';
    c.beginPath(); c.ellipse(cx + lean, capY + s * 0.045, stemW * 1.6, s * 0.008, 0, 0, Math.PI * 2); c.fill();
  }
  // freckles (amanita only)
  if (kind === 0) {
    c.fillStyle = 'rgba(120,110,95,0.5)';
    for (let i = 0; i < 5; i++) {
      const fx = cx + lean + (rnd() - 0.5) * capR * 1.5, fy = capY - rnd() * domeH * 1.1;
      c.beginPath(); c.arc(fx, fy, s * (0.006 + rnd() * 0.008), 0, Math.PI * 2); c.fill();
    }
  }
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return Texture.from(c);
}
