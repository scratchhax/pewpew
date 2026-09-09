import { Texture } from 'pixi.js';

function canvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  return Texture.from(c);
}

/** Soft radial glow, white (tint in the scene). */
export function makeGlow(size = 64, core = 0.12): Texture {
  return canvas(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * core * 0.2, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Shaded sphere (white — tint in the scene). Seeded variants: plain,
 *  craters, continents, craters+continents. */
export function makePlanet(size = 64, seed = 1): Texture {
  return canvas(size, (ctx, s) => {
    let z = (seed * 2654435761) >>> 0;
    const rnd = () => {
      z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
      return z / 4294967296;
    };
    const cx = s / 2, cy = s / 2;
    const r = s * 0.30;
    // guaranteed mix across the 4-variant set: plain / craters / continents /
    // craters+continents
    const kind = (seed - 1) % 4;
    const craters = kind === 1 || kind === 3;
    const continents = kind === 2 || kind === 3;

    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(195,195,205,1)');
    g.addColorStop(0.92, 'rgba(80,84,100,1)');
    g.addColorStop(1, 'rgba(35,37,48,1)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.clip();
    if (craters) {
      const n = 3 + (seed % 3);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = rnd() * r * 0.55;
        const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
        const cr = r * (0.09 + rnd() * 0.13);
        ctx.beginPath(); ctx.arc(px, py, cr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(40,42,55,0.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(px - cr * 0.25, py - cr * 0.25, cr * 0.65, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fill();
      }
    }
    if (continents) {
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2, d = rnd() * r * 0.5;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9);
        ctx.rotate(rnd() * 3);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * (0.16 + rnd() * 0.26), r * (0.09 + rnd() * 0.14), 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  });
}

/** Tight pin-point star (crisp core, minimal halo — no snowflake blobs). */
export function makeDot(size = 10): Texture {
  return canvas(size, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Energy crystal: diamond with inner core highlight. */
export function makeCrystal(size = 48): Texture {
  return canvas(size, (ctx, s) => {
    const c = s / 2;
    // outer glow
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(120,255,255,0.5)');
    g.addColorStop(1, 'rgba(120,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // diamond
    ctx.beginPath();
    ctx.moveTo(c, s * 0.1);
    ctx.lineTo(s * 0.85, c);
    ctx.lineTo(c, s * 0.9);
    ctx.lineTo(s * 0.15, c);
    ctx.closePath();
    ctx.fillStyle = 'rgba(160,255,255,0.9)';
    ctx.fill();
    // inner core
    ctx.beginPath();
    ctx.moveTo(c, s * 0.32);
    ctx.lineTo(s * 0.66, c);
    ctx.lineTo(c, s * 0.68);
    ctx.lineTo(s * 0.34, c);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
}

/** Rock-ish asteroid blob. */
export function makeAsteroid(size = 48, seed = 1): Texture {
  return canvas(size, (ctx, s) => {
    const c = s / 2;
    let rndState = seed * 9301 + 49297;
    const rnd = () => { rndState = (rndState * 9301 + 49297) % 233280; return rndState / 233280; };
    const pts = 9;
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const r = c * (0.55 + rnd() * 0.35);
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#8a6a4f';
    ctx.fill();
    ctx.strokeStyle = '#5f4632';
    ctx.lineWidth = s * 0.05;
    ctx.stroke();
    // craters
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(c + (rnd() - 0.5) * c, c + (rnd() - 0.5) * c, s * (0.04 + rnd() * 0.07), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,42,28,0.7)';
      ctx.fill();
    }
  });
}

/** Ambient freighter silhouette with tiny lit windows. */
export function makeShip(size = 96, seed = 1): Texture {
  return canvas(size, (ctx, s) => {
    let rndState = seed * 7919 + 17;
    const rnd = () => { rndState = (rndState * 9301 + 49297) % 233280; return rndState / 233280; };
    const c = s / 2;
    const len = s * (0.55 + rnd() * 0.35);
    const wid = len * (0.14 + rnd() * 0.08);
    ctx.translate(c, c);
    // hull
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(-len / 2 + wid * 0.4, -wid / 2);
    ctx.lineTo(len / 2 - wid * 0.6, -wid / 2);
    ctx.lineTo(len / 2, 0);
    ctx.lineTo(len / 2 - wid * 0.6, wid / 2);
    ctx.lineTo(-len / 2 + wid * 0.4, wid / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(58,72,96,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,140,180,0.5)';
    ctx.lineWidth = s * 0.012;
    ctx.stroke();
    // engine glow
    ctx.beginPath();
    ctx.arc(-len / 2 + wid * 0.1, 0, wid * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,140,60,0.9)';
    ctx.fill();
    // window row
    ctx.fillStyle = 'rgba(140,230,255,0.9)';
    const n = 3 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) {
      ctx.fillRect(-len * 0.25 + (i * len) / (2 * n), -wid * 0.12, s * 0.012, s * 0.012);
    }
  });
}


/** Iconic guest ships, all drawn bow-right. */
export function makeIconShips(): Texture[] {
  return [enterprise, xwing, deathStar, tie, saucer, satellite, wheatley]
    .map((fn) => canvas(96, fn));
}

function enterprise(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  // secondary hull: short & slim so it reads as hull, not a third nacelle
  ctx.fillStyle = 'rgba(150,165,190,0.9)';
  rr(ctx, c - s * 0.24, c - s * 0.03, s * 0.30, s * 0.06, s * 0.03);
  ctx.fillStyle = 'rgba(90,170,255,0.95)';
  dot(ctx, c + s * 0.075, c, s * 0.015);                 // deflector
  // nacelles: long, thin, twin
  ctx.fillStyle = 'rgba(172,186,208,0.92)';
  rr(ctx, c - s * 0.30, c - s * 0.225, s * 0.38, s * 0.045, s * 0.022);
  rr(ctx, c - s * 0.30, c + s * 0.18, s * 0.38, s * 0.045, s * 0.022);
  ctx.fillStyle = 'rgba(90,170,255,0.95)';               // bussard glow
  dot(ctx, c + s * 0.07, c - s * 0.202, s * 0.016);
  dot(ctx, c + s * 0.07, c + s * 0.202, s * 0.016);
  ctx.fillStyle = 'rgba(255,120,60,0.85)';               // running lights
  dot(ctx, c - s * 0.29, c - s * 0.202, s * 0.012);
  dot(ctx, c - s * 0.29, c + s * 0.202, s * 0.012);
  // pylons
  ctx.strokeStyle = 'rgba(150,165,190,0.9)';
  ctx.lineWidth = s * 0.022;
  ctx.beginPath();
  ctx.moveTo(c - s * 0.09, c - s * 0.18); ctx.lineTo(c - s * 0.05, c - s * 0.04);
  ctx.moveTo(c - s * 0.09, c + s * 0.18); ctx.lineTo(c - s * 0.05, c + s * 0.04);
  ctx.stroke();
  // saucer — big, front, unmistakable
  ctx.fillStyle = 'rgba(198,210,228,0.94)';
  ctx.beginPath();
  ctx.ellipse(c + s * 0.17, c, s * 0.20, s * 0.145, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,135,160,0.95)';              // bridge
  dot(ctx, c + s * 0.28, c, s * 0.022);
  ctx.fillStyle = 'rgba(140,220,255,0.7)';               // rim lights
  dot(ctx, c + s * 0.17, c - s * 0.12, s * 0.012);
  dot(ctx, c + s * 0.17, c + s * 0.12, s * 0.012);
}

function xwing(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  // swept-back wings (top view): shoulder → tip trapezoids
  for (const d of [-1, 1]) {
    ctx.fillStyle = 'rgba(188,193,203,0.92)';
    ctx.beginPath();
    ctx.moveTo(c + s * 0.04, c + d * s * 0.035);
    ctx.lineTo(c - s * 0.17, c + d * s * 0.245);
    ctx.lineTo(c - s * 0.27, c + d * s * 0.225);
    ctx.lineTo(c - s * 0.13, c + d * s * 0.04);
    ctx.closePath();
    ctx.fill();
    // wingtip laser cannons, aimed at the bow
    ctx.fillStyle = 'rgba(110,116,130,0.95)';
    ctx.beginPath();
    ctx.moveTo(c - s * 0.16, c + d * s * 0.245);
    ctx.lineTo(c + s * 0.06, c + d * s * 0.185);
    ctx.lineTo(c + s * 0.06, c + d * s * 0.205);
    ctx.lineTo(c - s * 0.16, c + d * s * 0.265);
    ctx.closePath();
    ctx.fill();
    // red stripe on the wing
    ctx.fillStyle = 'rgba(220,90,60,0.85)';
    ctx.fillRect(c - s * 0.185, c + d * s * 0.175, s * 0.06, s * 0.022);
  }
  // fuselage: long pointed nose
  ctx.fillStyle = 'rgba(196,200,210,0.95)';
  ctx.beginPath();
  ctx.moveTo(c + s * 0.34, c);
  ctx.lineTo(c + s * 0.08, c - s * 0.05);
  ctx.lineTo(c - s * 0.24, c - s * 0.042);
  ctx.lineTo(c - s * 0.24, c + s * 0.042);
  ctx.lineTo(c + s * 0.08, c + s * 0.05);
  ctx.closePath();
  ctx.fill();
  // nose battery (the boxy chin)
  ctx.fillStyle = 'rgba(160,166,178,0.95)';
  ctx.fillRect(c + s * 0.10, c - s * 0.028, s * 0.14, s * 0.056);
  // cockpit
  ctx.fillStyle = 'rgba(140,220,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(c + s * 0.02, c - s * 0.015, s * 0.045, s * 0.024, 0, 0, Math.PI * 2);
  ctx.fill();
  // engines
  ctx.fillStyle = 'rgba(255,130,50,0.95)';
  dot(ctx, c - s * 0.245, c - s * 0.018, s * 0.02);
  dot(ctx, c - s * 0.245, c + s * 0.018, s * 0.02);
}

function deathStar(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  const R = s * 0.30;
  const g = ctx.createRadialGradient(c - R * 0.3, c - R * 0.3, R * 0.2, c, c, R);
  g.addColorStop(0, 'rgba(170,178,168,0.95)');
  g.addColorStop(1, 'rgba(95,105,98,0.95)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
  // equatorial trench
  ctx.fillStyle = 'rgba(45,52,48,0.9)';
  ctx.fillRect(c - R, c - s * 0.014, R * 2, s * 0.028);
  // superlaser dish
  ctx.fillStyle = 'rgba(80,90,84,0.95)';
  ctx.beginPath(); ctx.arc(c + R * 0.38, c - R * 0.4, R * 0.34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(210,255,220,0.95)';
  dot(ctx, c + R * 0.38, c - R * 0.4, s * 0.022);
  // surface greebles
  ctx.fillStyle = 'rgba(60,66,62,0.5)';
  for (const [dx, dy] of [[-0.5, -0.3], [-0.2, 0.45], [0.5, 0.35], [-0.62, 0.15]]) {
    dot(ctx, c + R * dx, c + R * dy, s * 0.018);
  }
}

function tie(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  // struts
  ctx.strokeStyle = 'rgba(120,130,145,0.9)';
  ctx.lineWidth = s * 0.03;
  ctx.beginPath();
  ctx.moveTo(c - s * 0.27, c); ctx.lineTo(c + s * 0.27, c);
  ctx.stroke();
  // hexagonal solar panels
  for (const sx of [-1, 1]) {
    ctx.fillStyle = 'rgba(150,158,170,0.9)';
    hexPanel(ctx, c + sx * s * 0.27, c, s * 0.075, s * 0.28);
    ctx.fillStyle = 'rgba(60,66,75,0.85)';
    hexPanel(ctx, c + sx * s * 0.27, c, s * 0.05, s * 0.23);
  }
  // cockpit
  ctx.fillStyle = 'rgba(140,148,162,0.95)';
  dot(ctx, c, c, s * 0.115);
  ctx.fillStyle = 'rgba(90,210,255,0.95)';
  dot(ctx, c + s * 0.02, c - s * 0.01, s * 0.05);
  ctx.fillStyle = 'rgba(255,90,90,0.9)';
  dot(ctx, c, c + s * 0.09, s * 0.016);
}

function saucer(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  // hull disc
  const g = ctx.createLinearGradient(0, c - s * 0.06, 0, c + s * 0.12);
  g.addColorStop(0, 'rgba(205,215,228,0.96)');
  g.addColorStop(0.5, 'rgba(140,152,170,0.96)');
  g.addColorStop(1, 'rgba(85,95,112,0.96)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(c, c + s * 0.03, s * 0.34, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  // underbelly shading
  ctx.fillStyle = 'rgba(50,58,72,0.8)';
  ctx.beginPath();
  ctx.ellipse(c, c + s * 0.07, s * 0.26, s * 0.055, 0, 0, Math.PI);
  ctx.fill();
  // glass dome
  ctx.fillStyle = 'rgba(150,230,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(c, c - s * 0.045, s * 0.13, s * 0.10, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(c - s * 0.045, c - s * 0.095, s * 0.035, s * 0.02, -0.6, 0, Math.PI * 2);
  ctx.fill();
  // running lights around the rim
  const cols = ['rgba(255,90,90,0.95)', 'rgba(255,220,90,0.95)', 'rgba(90,255,150,0.95)'];
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.15 + (i / 4) * 0.7);
    ctx.fillStyle = cols[i % 3];
    dot(ctx, c - Math.cos(a) * s * 0.31, c + s * 0.05 + Math.sin(a) * s * 0.045, s * 0.016);
  }
  // tractor beam hint
  ctx.fillStyle = 'rgba(120,230,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(c - s * 0.07, c + s * 0.09);
  ctx.lineTo(c + s * 0.07, c + s * 0.09);
  ctx.lineTo(c + s * 0.14, c + s * 0.32);
  ctx.lineTo(c - s * 0.14, c + s * 0.32);
  ctx.closePath();
  ctx.fill();
}

function satellite(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  // solar arrays
  for (const side of [-1, 1]) {
    ctx.fillStyle = 'rgba(40,70,150,0.95)';
    const x = side < 0 ? c - s * 0.40 : c + s * 0.12;
    ctx.fillRect(x, c - s * 0.09, s * 0.28, s * 0.18);
    ctx.strokeStyle = 'rgba(140,180,255,0.8)';
    ctx.lineWidth = s * 0.008;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (i * s * 0.28) / 4, c - s * 0.09);
      ctx.lineTo(x + (i * s * 0.28) / 4, c + s * 0.09);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x, c); ctx.lineTo(x + s * 0.28, c);
    ctx.stroke();
    // boom
    ctx.strokeStyle = 'rgba(160,168,180,0.9)';
    ctx.lineWidth = s * 0.018;
    ctx.beginPath();
    ctx.moveTo(c - side * s * 0.06, c);
    ctx.lineTo(side < 0 ? x + s * 0.28 : x, c);
    ctx.stroke();
  }
  // gold foil body
  const g = ctx.createLinearGradient(c, c - s * 0.1, c, c + s * 0.1);
  g.addColorStop(0, 'rgba(255,220,130,0.97)');
  g.addColorStop(1, 'rgba(180,140,50,0.97)');
  ctx.fillStyle = g;
  ctx.fillRect(c - s * 0.065, c - s * 0.10, s * 0.13, s * 0.20);
  ctx.strokeStyle = 'rgba(90,70,30,0.9)';
  ctx.lineWidth = s * 0.01;
  ctx.strokeRect(c - s * 0.065, c - s * 0.10, s * 0.13, s * 0.20);
  // dish antenna
  ctx.fillStyle = 'rgba(225,228,235,0.95)';
  ctx.beginPath();
  ctx.ellipse(c + s * 0.03, c - s * 0.17, s * 0.08, s * 0.045, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(170,178,190,0.9)';
  ctx.lineWidth = s * 0.012;
  ctx.beginPath();
  ctx.moveTo(c + s * 0.01, c - s * 0.10);
  ctx.lineTo(c + s * 0.04, c - s * 0.16);
  ctx.stroke();
  // status blinker
  ctx.fillStyle = 'rgba(255,80,80,0.95)';
  dot(ctx, c, c + s * 0.075, s * 0.016);
}

function wheatley(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  const R = s * 0.29;
  const g = ctx.createRadialGradient(c - R * 0.3, c - R * 0.4, R * 0.2, c, c, R);
  g.addColorStop(0, 'rgba(240,240,244,0.98)');
  g.addColorStop(1, 'rgba(150,156,168,0.98)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
  // side armor caps
  ctx.fillStyle = 'rgba(72,78,90,0.95)';
  ctx.beginPath(); ctx.ellipse(c - R * 0.88, c, R * 0.2, R * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(c + R * 0.88, c, R * 0.2, R * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  // eye
  ctx.fillStyle = 'rgba(28,32,40,0.98)';
  dot(ctx, c + R * 0.12, c - R * 0.05, R * 0.42);
  ctx.fillStyle = 'rgba(70,150,255,0.98)';
  dot(ctx, c + R * 0.12, c - R * 0.05, R * 0.26);
  ctx.fillStyle = 'rgba(8,10,14,0.98)';
  dot(ctx, c + R * 0.16, c - R * 0.03, R * 0.11);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  dot(ctx, c + R * 0.02, c - R * 0.18, R * 0.05);
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function quad(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, wid: number, _dir: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0 - wid / 2);
  ctx.lineTo(x1, y1 - wid / 2);
  ctx.lineTo(x1, y1 + wid / 2);
  ctx.lineTo(x0, y0 + wid / 2);
  ctx.closePath();
  ctx.fill();
}

function hexPanel(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - ry);
  ctx.lineTo(x + rx, y - ry * 0.55);
  ctx.lineTo(x + rx, y + ry * 0.55);
  ctx.lineTo(x, y + ry);
  ctx.lineTo(x - rx, y + ry * 0.55);
  ctx.lineTo(x - rx, y - ry * 0.55);
  ctx.closePath();
  ctx.fill();
}

/** Soft nebula cloud: overlapping blobs with a wispy silhouette. */
export function makeCloud(size = 256, seed = 1): Texture {
  return canvas(size, (ctx, s) => {
    let rndState = seed * 40499 + 7;
    const rnd = () => { rndState = (rndState * 9301 + 49297) % 233280; return rndState / 233280; };
    const c = s / 2;
    // blobs
    for (let i = 0; i < 14; i++) {
      const bx = c + (rnd() - 0.5) * s * 0.55;
      const by = c + (rnd() - 0.5) * s * 0.4;
      const br = s * (0.08 + rnd() * 0.22);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(255,255,255,${0.12 + rnd() * 0.16})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    // hot filaments
    for (let i = 0; i < 5; i++) {
      const bx = c + (rnd() - 0.5) * s * 0.4;
      const by = c + (rnd() - 0.5) * s * 0.3;
      const br = s * (0.04 + rnd() * 0.08);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(255,255,255,${0.35 + rnd() * 0.3})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    // wispy edge: multiply alpha by a soft disc so the cloud has no hard border
    ctx.globalCompositeOperation = 'destination-in';
    const vg = ctx.createRadialGradient(c, c, 0, c, c, c);
    vg.addColorStop(0, 'rgba(0,0,0,1)');
    vg.addColorStop(0.65, 'rgba(0,0,0,0.8)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, s, s);
  });
}

export interface Textures {
  cloud: Texture;
  clouds: Texture[];
  glow: Texture;
  dot: Texture;
  crystal: Texture;
  planets: Texture[];
  asteroids: Texture[];
  ships: Texture[];
  icons: Texture[];
}

export function buildTextures(): Textures {
  return {
    glow: makeGlow(),
    dot: makeDot(),
    crystal: makeCrystal(),
    planets: [1, 2, 3, 4].map((i) => makePlanet(64, i)),
    cloud: makeCloud(),
    clouds: [1, 2, 3].map((i) => makeCloud(256, i * 13 + 1)),
    asteroids: [1, 2, 3, 4, 5].map((i) => makeAsteroid(56, i)),
    ships: [1, 2, 3].map((i) => makeShip(96, i)),
    icons: makeIconShips(),
  };
}
