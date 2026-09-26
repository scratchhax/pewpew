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
    caps: [3, 11, 21].map((seed) => canvasTexture(96, (c, s) => drawCap(c, s, seed))),
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
 * A ghost mushroom in greys (tinted at use): a slim tapering stem with a
 * bulbous base, a domed cap with a hint of gills, and faint freckles. Seeds
 * vary the silhouette so a grove never looks stamped.
 */
function drawCap(c: CanvasRenderingContext2D, s: number, seed: number): void {
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const cx = s * 0.5, base = s * 0.94;
  const h = s * (0.62 + rnd() * 0.16);          // stem height
  const capY = base - h;                        // cap underside
  const capR = s * (0.28 + rnd() * 0.10);
  const lean = (rnd() - 0.5) * s * 0.08;

  // stem: tapered, slightly curved, lit from the left
  const stemW = s * 0.055;
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

  // gills: a darker band under the cap
  const cy2 = capY + 2 - s * 0.012;
  c.fillStyle = '#b9b2a4';
  c.beginPath(); c.ellipse(cx + lean, cy2, capR * 0.86, s * 0.028, 0, 0, Math.PI * 2); c.fill();

  // cap dome: lit top-left
  const domeH = s * (0.13 + rnd() * 0.05);
  const g = c.createRadialGradient(cx + lean - capR * 0.4, capY - domeH * 0.6, capR * 0.15, cx + lean, capY - domeH * 0.4, capR * 1.4);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#efe9dd');
  g.addColorStop(1, '#c9c0af');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(cx + lean - capR, cy2);
  c.bezierCurveTo(cx + lean - capR, capY - domeH * 1.6, cx + lean + capR, capY - domeH * 1.6, cx + lean + capR, cy2);
  c.bezierCurveTo(cx + lean + capR * 0.6, cy2 + s * 0.03, cx + lean - capR * 0.6, cy2 + s * 0.03, cx + lean - capR, cy2);
  c.closePath(); c.fill();
  // freckles
  c.fillStyle = 'rgba(120,110,95,0.5)';
  for (let i = 0; i < 5; i++) {
    const fx = cx + lean + (rnd() - 0.5) * capR * 1.5, fy = capY - rnd() * domeH * 1.1;
    c.beginPath(); c.arc(fx, fy, s * (0.006 + rnd() * 0.008), 0, Math.PI * 2); c.fill();
  }
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return Texture.from(c);
}
