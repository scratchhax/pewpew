import type { Painter } from './skins';

/**
 * The fish, as shapes and paint. Profiles are [x, size] pairs in body lengths,
 * from the tail root (x = 0) to the nose (x = 1): how far the back rises, how
 * far the belly drops, and half the body's thickness. Everything else about a
 * fish (its fins, eye, pattern, how it swims) is here too.
 */
export interface SpeciesDef {
  id: string;
  length: number;                         // world units, nose to tail tip
  top: Array<[number, number]>;
  bottom: Array<[number, number]>;
  width: Array<[number, number]>;
  tail: { len: number; span: number };    // caudal fin box behind the tail root
  dorsal: { x0: number; x1: number; h: number };
  anal: { x0: number; x1: number; h: number };
  pectoral: { x: number; y: number; len: number };
  eye: { x: number; y: number; r: number };
  iris: string;
  spikes?: boolean;
  swim: { amp: number; waveK: number; cruise: number; agility: number };
  look: { rough: number; clearcoat: number; iridescence?: number; scaleRepeat: [number, number]; scaleStrength: number; finGlow?: number };
  paint(p: Painter): void;
}

// ── painting helpers ──
const bodyOutline = (d: Pick<SpeciesDef, 'top' | 'bottom'>, grow = 1.08): Array<[number, number]> => {
  const pts: Array<[number, number]> = [];
  const at = (arr: Array<[number, number]>, x: number) => lerpProfile(arr, x);
  for (let i = 0; i <= 16; i++) { const x = -0.04 + (i / 16) * 1.06; pts.push([x, at(d.top, Math.min(1, x)) * grow + 0.008]); }
  for (let i = 16; i >= 0; i--) { const x = -0.04 + (i / 16) * 1.06; pts.push([x, -at(d.bottom, Math.min(1, x)) * grow - 0.008]); }
  return pts;
};

export function lerpProfile(arr: Array<[number, number]>, x: number): number {
  if (x <= arr[0][0]) return arr[0][1];
  for (let i = 1; i < arr.length; i++) {
    if (x <= arr[i][0]) {
      const [x0, y0] = arr[i - 1], [x1, y1] = arr[i];
      const k = (x - x0) / (x1 - x0);
      const s = k * k * (3 - 2 * k);          // smooth between control points
      return y0 + (y1 - y0) * s;
    }
  }
  return arr[arr.length - 1][1];
}

/** Paint the body's colours inside its (slightly grown) outline. */
function body(p: Painter, d: SpeciesDef, fill: string | CanvasGradient, extra?: () => void): void {
  const g = p.g;
  g.save();
  p.shape(bodyOutline(d), fill);
  g.clip();
  extra?.();
  g.restore();
}

/** A see-through fin with darker rays. */
function finPaint(p: Painter, outline: Array<[number, number]>, color: string, rayRoot: [number, number], rayColor: string, tipsFrom = 1): void {
  p.shape(outline, color);
  p.g.save();
  p.shape(outline, 'rgba(0,0,0,0)');
  p.g.clip();
  p.rays(rayRoot, outline.slice(tipsFrom), rayColor, 1.6);
  p.g.restore();
}

/** The pectoral fin, painted into its corner slot (root on the right). */
function pecPaint(p: Painter, color: string, rays: string): void {
  const o: Array<[number, number]> = [[0.995, -0.47], [0.9, -0.445], [0.76, -0.49], [0.75, -0.53], [0.86, -0.585], [0.995, -0.575]];
  finPaint(p, o, color, [1.0, -0.52], rays, 1);
}

function mouth(p: Painter, x: number, y: number, len: number, color = 'rgba(20,20,20,0.55)'): void {
  p.g.strokeStyle = color; p.g.lineWidth = p.s(0.008);
  p.g.beginPath(); p.g.moveTo(p.px(x - len), p.py(y - 0.004)); p.g.quadraticCurveTo(p.px(x - len * 0.4), p.py(y - 0.012), p.px(x), p.py(y)); p.g.stroke();
}

function gill(p: Painter, x: number, top: number, bottom: number, color = 'rgba(0,0,0,0.18)'): void {
  p.g.strokeStyle = color; p.g.lineWidth = p.s(0.01);
  p.g.beginPath(); p.g.moveTo(p.px(x), p.py(top)); p.g.quadraticCurveTo(p.px(x - 0.05), p.py((top + bottom) / 2), p.px(x), p.py(bottom)); p.g.stroke();
}

// ── species ──
export const CHROMIS: SpeciesDef = {
  id: 'chromis', length: 2.4,
  top: [[0, 0.05], [0.25, 0.15], [0.5, 0.2], [0.75, 0.175], [0.92, 0.1], [1, 0.02]],
  bottom: [[0, 0.05], [0.3, 0.14], [0.55, 0.17], [0.8, 0.13], [0.95, 0.06], [1, 0.01]],
  width: [[0, 0.03], [0.4, 0.075], [0.7, 0.08], [0.92, 0.05], [1, 0.008]],
  tail: { len: 0.3, span: 0.24 },
  dorsal: { x0: 0.22, x1: 0.76, h: 0.14 },
  anal: { x0: 0.15, x1: 0.46, h: 0.11 },
  pectoral: { x: 0.7, y: -0.03, len: 0.15 },
  eye: { x: 0.86, y: 0.035, r: 0.045 },
  iris: '#8ab8a0',
  swim: { amp: 0.075, waveK: 5.5, cruise: 7, agility: 2.6 },
  look: { rough: 0.35, clearcoat: 0.6, iridescence: 0.7, scaleRepeat: [22, 18], scaleStrength: 0.35 },
  paint(p) {
    finPaint(p, [[0.04, 0.05], [-0.3, 0.26], [-0.2, 0.08], [-0.16, 0], [-0.2, -0.08], [-0.3, -0.26], [0.04, -0.05]], 'rgba(120,225,185,0.55)', [0.02, 0], 'rgba(70,160,130,0.6)');
    finPaint(p, [[0.2, 0.12], [0.3, 0.3], [0.5, 0.33], [0.72, 0.26], [0.78, 0.16]], 'rgba(110,215,175,0.6)', [0.5, 0.15], 'rgba(60,150,120,0.6)');
    finPaint(p, [[0.12, -0.1], [0.2, -0.24], [0.4, -0.26], [0.48, -0.14]], 'rgba(150,235,200,0.55)', [0.32, -0.12], 'rgba(70,160,130,0.5)');
    pecPaint(p, 'rgba(190,245,220,0.45)', 'rgba(90,170,140,0.4)');
    body(p, this, p.grad(0, 0.22, 0, -0.18, [[0, '#14566e'], [0.3, '#2a9f9a'], [0.6, '#6fdcb4'], [1, '#dcfbea']]), () => {
      p.scales(0.03, 'rgba(8,40,40,0.28)', 1.4);
      p.scales(0.03, 'rgba(200,255,240,0.10)', 0.8);
      p.g.fillStyle = 'rgba(80,200,255,0.18)'; p.g.fillRect(p.px(0.3), p.py(0.2), p.s(0.6), p.s(0.12));
      gill(p, 0.76, 0.12, -0.1, 'rgba(10,60,50,0.25)');
      mouth(p, 1.0, -0.005, 0.05);
    });
  },
};

export const YELLOW_TANG: SpeciesDef = {
  id: 'tang', length: 5,
  top: [[0, 0.07], [0.2, 0.24], [0.48, 0.36], [0.72, 0.31], [0.88, 0.17], [1, 0.03]],
  bottom: [[0, 0.07], [0.25, 0.25], [0.5, 0.33], [0.76, 0.26], [0.92, 0.09], [1, 0.01]],
  width: [[0, 0.03], [0.5, 0.085], [0.85, 0.06], [1, 0.01]],
  tail: { len: 0.24, span: 0.22 },
  dorsal: { x0: 0.08, x1: 0.76, h: 0.17 },
  anal: { x0: 0.06, x1: 0.6, h: 0.15 },
  pectoral: { x: 0.68, y: -0.02, len: 0.16 },
  eye: { x: 0.8, y: 0.1, r: 0.045 },
  iris: '#1a1a10',
  swim: { amp: 0.05, waveK: 4.6, cruise: 4, agility: 1.6 },
  look: { rough: 0.45, clearcoat: 0.45, scaleRepeat: [34, 30], scaleStrength: 0.15 },
  paint(p) {
    finPaint(p, [[0.03, 0.08], [-0.22, 0.24], [-0.2, 0], [-0.22, -0.24], [0.03, -0.08]], 'rgba(255,214,40,0.92)', [0.02, 0], 'rgba(220,170,0,0.5)');
    finPaint(p, [[0.04, 0.1], [0.08, 0.34], [0.35, 0.52], [0.66, 0.44], [0.8, 0.26]], 'rgba(255,212,30,0.95)', [0.4, 0.2], 'rgba(210,160,0,0.5)');
    finPaint(p, [[0.03, -0.1], [0.08, -0.33], [0.33, -0.48], [0.6, -0.34], [0.64, -0.2]], 'rgba(255,212,30,0.95)', [0.35, -0.2], 'rgba(210,160,0,0.5)');
    pecPaint(p, 'rgba(255,230,120,0.6)', 'rgba(200,160,40,0.5)');
    body(p, this, p.grad(0, 0.36, 0, -0.33, [[0, '#f0c000'], [0.5, '#ffe030'], [1, '#fff08a']]), () => {
      p.speckle(0.1, -0.3, 0.9, 0.3, 90, 0.006, 'rgba(255,255,200,0.25)', 3);
      p.scales(0.018, 'rgba(150,110,0,0.14)', 1);
      p.g.fillStyle = p.grad(0, 0.36, 0, 0, [[0, 'rgba(160,110,0,0.28)'], [1, 'rgba(160,110,0,0)']]); p.g.fillRect(0, 0, 1024, p.py(0));
      // the white scalpel at the tail root
      p.g.fillStyle = 'rgba(255,255,255,0.9)';
      p.g.beginPath(); p.g.ellipse(p.px(0.06), p.py(0), p.s(0.035), p.s(0.012), 0, 0, Math.PI * 2); p.g.fill();
      gill(p, 0.7, 0.22, -0.18, 'rgba(160,110,0,0.25)');
      mouth(p, 1.0, 0.01, 0.04);
    });
  },
};

export const BUTTERFLY: SpeciesDef = {
  id: 'butterfly', length: 4.4,
  top: [[0, 0.07], [0.2, 0.26], [0.45, 0.36], [0.72, 0.3], [0.88, 0.14], [1, 0.03]],
  bottom: [[0, 0.07], [0.22, 0.26], [0.5, 0.33], [0.78, 0.22], [0.93, 0.07], [1, 0.01]],
  width: [[0, 0.03], [0.5, 0.075], [0.85, 0.055], [1, 0.01]],
  tail: { len: 0.2, span: 0.2 },
  dorsal: { x0: 0.05, x1: 0.72, h: 0.13 },
  anal: { x0: 0.04, x1: 0.5, h: 0.12 },
  pectoral: { x: 0.66, y: -0.04, len: 0.14 },
  eye: { x: 0.79, y: 0.08, r: 0.04 },
  iris: '#20201a',
  swim: { amp: 0.05, waveK: 4.6, cruise: 3.5, agility: 1.8 },
  look: { rough: 0.4, clearcoat: 0.5, scaleRepeat: [26, 24], scaleStrength: 0.3 },
  paint(p) {
    finPaint(p, [[0.03, 0.08], [-0.18, 0.2], [-0.16, 0], [-0.18, -0.2], [0.03, -0.08]], 'rgba(255,220,60,0.85)', [0.02, 0], 'rgba(200,160,20,0.5)');
    finPaint(p, [[0.02, 0.1], [0.06, 0.36], [0.35, 0.47], [0.62, 0.4], [0.76, 0.24]], 'rgba(255,214,50,0.95)', [0.4, 0.2], 'rgba(200,150,0,0.4)');
    finPaint(p, [[0.02, -0.1], [0.05, -0.33], [0.3, -0.43], [0.5, -0.3], [0.54, -0.2]], 'rgba(255,214,50,0.95)', [0.3, -0.2], 'rgba(200,150,0,0.4)');
    pecPaint(p, 'rgba(250,250,240,0.5)', 'rgba(180,180,160,0.4)');
    // black edge along the dorsal fin
    p.g.strokeStyle = 'rgba(20,20,20,0.7)'; p.g.lineWidth = p.s(0.012);
    p.g.beginPath(); p.g.moveTo(p.px(0.1), p.py(0.42)); p.g.quadraticCurveTo(p.px(0.4), p.py(0.5), p.px(0.62), p.py(0.4)); p.g.stroke();
    body(p, this, '#f8f6ea', () => {
      const g = p.g;
      p.scales(0.026, 'rgba(90,80,60,0.18)', 1.2);
      // yellow rear half fading into white, with fine diagonal lines
      g.fillStyle = p.grad(0.05, 0, 0.6, 0, [[0, '#ffd23a'], [0.6, 'rgba(255,215,60,0.8)'], [1, 'rgba(255,215,60,0)']]);
      g.fillRect(p.px(-0.1), p.py(0.6), p.s(0.8), p.s(1.2));
      g.strokeStyle = 'rgba(60,50,40,0.28)'; g.lineWidth = p.s(0.006);
      for (let i = -4; i < 14; i++) { g.beginPath(); g.moveTo(p.px(0.08 * i), p.py(0.45)); g.lineTo(p.px(0.08 * i + 0.3), p.py(-0.45)); g.stroke(); }
      // a false eye near the tail, and a black band through the real one
      g.fillStyle = '#121214'; g.beginPath(); g.arc(p.px(0.2), p.py(0.13), p.s(0.05), 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = p.s(0.01); g.beginPath(); g.arc(p.px(0.2), p.py(0.13), p.s(0.06), 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#141416';
      g.beginPath(); g.moveTo(p.px(0.76), p.py(0.4)); g.lineTo(p.px(0.84), p.py(0.4)); g.lineTo(p.px(0.83), p.py(-0.4)); g.lineTo(p.px(0.75), p.py(-0.4)); g.fill();
      g.fillStyle = '#ffd23a'; g.fillRect(p.px(0.9), p.py(0.12), p.s(0.12), p.s(0.24));
      mouth(p, 1.0, 0.0, 0.03);
    });
  },
};

export const ANGEL: SpeciesDef = {
  id: 'angel', length: 6.5,
  top: [[0, 0.08], [0.2, 0.27], [0.45, 0.35], [0.7, 0.3], [0.88, 0.17], [1, 0.04]],
  bottom: [[0, 0.08], [0.22, 0.27], [0.48, 0.33], [0.75, 0.25], [0.92, 0.1], [1, 0.02]],
  width: [[0, 0.03], [0.5, 0.08], [0.85, 0.06], [1, 0.01]],
  tail: { len: 0.24, span: 0.22 },
  dorsal: { x0: -0.26, x1: 0.72, h: 0.3 },
  anal: { x0: -0.24, x1: 0.5, h: 0.28 },
  pectoral: { x: 0.68, y: -0.02, len: 0.17 },
  eye: { x: 0.82, y: 0.09, r: 0.04 },
  iris: '#2a60c0',
  swim: { amp: 0.04, waveK: 4.2, cruise: 3, agility: 1.2 },
  look: { rough: 0.35, clearcoat: 0.6, iridescence: 0.35, scaleRepeat: [30, 26], scaleStrength: 0.3 },
  paint(p) {
    const g = p.g;
    finPaint(p, [[0.03, 0.08], [-0.2, 0.22], [-0.24, 0], [-0.2, -0.22], [0.03, -0.08]], 'rgba(255,205,30,0.95)', [0.02, 0], 'rgba(200,140,0,0.5)');
    // long trailing dorsal and anal fins, blue with gold edges
    const dor: Array<[number, number]> = [[0.7, 0.26], [0.5, 0.45], [0.2, 0.5], [-0.05, 0.5], [-0.26, 0.58], [-0.12, 0.34], [0.1, 0.24]];
    finPaint(p, dor, 'rgba(40,110,220,0.92)', [0.3, 0.3], 'rgba(20,60,140,0.4)', 0);
    g.strokeStyle = 'rgba(255,210,60,0.9)'; g.lineWidth = p.s(0.012);
    g.beginPath(); g.moveTo(p.px(0.7), p.py(0.27)); g.quadraticCurveTo(p.px(0.4), p.py(0.52), p.px(0.0), p.py(0.5)); g.quadraticCurveTo(p.px(-0.2), p.py(0.52), p.px(-0.26), p.py(0.58)); g.stroke();
    const an: Array<[number, number]> = [[0.5, -0.26], [0.3, -0.42], [0.0, -0.46], [-0.24, -0.56], [-0.12, -0.32], [0.1, -0.24]];
    finPaint(p, an, 'rgba(40,110,220,0.92)', [0.2, -0.3], 'rgba(20,60,140,0.4)', 0);
    g.beginPath(); g.moveTo(p.px(0.5), p.py(-0.27)); g.quadraticCurveTo(p.px(0.2), p.py(-0.46), p.px(-0.24), p.py(-0.56)); g.stroke();
    pecPaint(p, 'rgba(255,210,60,0.85)', 'rgba(40,90,200,0.6)');
    body(p, this, p.grad(0.1, 0.3, 0.9, -0.3, [[0, '#2a7fe0'], [0.5, '#39a0f0'], [1, '#1e6ad0']]), () => {
      p.scales(0.024, 'rgba(10,40,90,0.3)', 1.3);
      p.speckle(0.05, -0.32, 0.8, 0.32, 260, 0.007, 'rgba(255,220,80,0.55)', 9);
      // the "crown": a dark blue spot ringed in electric blue on the forehead
      g.fillStyle = '#0a1a50'; g.beginPath(); g.arc(p.px(0.84), p.py(0.23), p.s(0.04), 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6fe0ff'; g.lineWidth = p.s(0.01); g.stroke();
      g.strokeStyle = 'rgba(120,220,255,0.8)'; g.lineWidth = p.s(0.014);
      g.beginPath(); g.moveTo(p.px(0.74), p.py(0.3)); g.quadraticCurveTo(p.px(0.68), p.py(0.0), p.px(0.74), p.py(-0.24)); g.stroke();
      g.fillStyle = '#ffd23a'; g.beginPath(); g.ellipse(p.px(0.95), p.py(0.0), p.s(0.07), p.s(0.08), 0, 0, Math.PI * 2); g.fill();
      mouth(p, 1.0, 0.0, 0.035);
    });
  },
};

export const REGAL_TANG: SpeciesDef = {
  id: 'regal', length: 4.4,
  top: [[0, 0.06], [0.25, 0.2], [0.5, 0.27], [0.75, 0.24], [0.9, 0.14], [1, 0.04]],
  bottom: [[0, 0.06], [0.25, 0.19], [0.5, 0.25], [0.78, 0.2], [0.93, 0.09], [1, 0.02]],
  width: [[0, 0.03], [0.5, 0.08], [0.85, 0.06], [1, 0.012]],
  tail: { len: 0.26, span: 0.24 },
  dorsal: { x0: 0.08, x1: 0.78, h: 0.13 },
  anal: { x0: 0.06, x1: 0.55, h: 0.11 },
  pectoral: { x: 0.7, y: -0.03, len: 0.16 },
  eye: { x: 0.83, y: 0.07, r: 0.045 },
  iris: '#101418',
  swim: { amp: 0.06, waveK: 5, cruise: 5, agility: 1.8 },
  look: { rough: 0.35, clearcoat: 0.55, iridescence: 0.25, scaleRepeat: [34, 28], scaleStrength: 0.15 },
  paint(p) {
    const g = p.g;
    finPaint(p, [[0.03, 0.07], [-0.24, 0.26], [-0.2, 0], [-0.24, -0.26], [0.03, -0.07]], 'rgba(255,214,30,0.95)', [0.02, 0], 'rgba(20,20,40,0.5)');
    g.strokeStyle = '#0c1020'; g.lineWidth = p.s(0.02);
    g.beginPath(); g.moveTo(p.px(-0.24), p.py(0.26)); g.quadraticCurveTo(p.px(-0.08), p.py(0.1), p.px(0.03), p.py(0.07)); g.stroke();
    g.beginPath(); g.moveTo(p.px(-0.24), p.py(-0.26)); g.quadraticCurveTo(p.px(-0.08), p.py(-0.1), p.px(0.03), p.py(-0.07)); g.stroke();
    finPaint(p, [[0.06, 0.08], [0.1, 0.3], [0.45, 0.4], [0.72, 0.34], [0.82, 0.2]], 'rgba(30,70,200,0.95)', [0.4, 0.2], 'rgba(10,10,30,0.4)');
    finPaint(p, [[0.05, -0.08], [0.1, -0.28], [0.4, -0.36], [0.56, -0.26], [0.6, -0.18]], 'rgba(30,70,200,0.95)', [0.3, -0.2], 'rgba(10,10,30,0.4)');
    g.strokeStyle = '#0a0c18'; g.lineWidth = p.s(0.016);
    g.beginPath(); g.moveTo(p.px(0.1), p.py(0.3)); g.quadraticCurveTo(p.px(0.45), p.py(0.41), p.px(0.78), p.py(0.3)); g.stroke();
    pecPaint(p, 'rgba(255,215,60,0.8)', 'rgba(30,60,160,0.5)');
    body(p, this, p.grad(0, 0.3, 0, -0.3, [[0, '#1b4fd8'], [0.5, '#2566f0'], [1, '#3d7af0']]), () => {
      // the dark "palette" marking
      g.fillStyle = '#0a0d1c';
      p.shape([[0.9, 0.2], [0.7, 0.26], [0.35, 0.22], [0.12, 0.1], [0.05, -0.02], [0.2, 0.0], [0.4, 0.1], [0.3, -0.06], [0.55, -0.02], [0.75, 0.08], [0.88, 0.0], [0.92, 0.12]], '#0a0d1c');
      g.fillStyle = '#2566f0'; g.beginPath(); g.ellipse(p.px(0.47), p.py(0.1), p.s(0.13), p.s(0.045), -0.1, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(160,210,255,0.35)'; g.fillRect(p.px(0.3), p.py(-0.18), p.s(0.6), p.s(0.08));
      p.scales(0.02, 'rgba(0,10,40,0.2)', 1);
      mouth(p, 1.0, 0.0, 0.035);
    });
  },
};

export const CLOWN: SpeciesDef = {
  id: 'clown', length: 2.3,
  top: [[0, 0.07], [0.25, 0.18], [0.5, 0.23], [0.75, 0.2], [0.92, 0.12], [1, 0.03]],
  bottom: [[0, 0.07], [0.3, 0.17], [0.55, 0.2], [0.8, 0.16], [0.95, 0.07], [1, 0.02]],
  width: [[0, 0.035], [0.5, 0.1], [0.85, 0.08], [1, 0.015]],
  tail: { len: 0.24, span: 0.2 },
  dorsal: { x0: 0.12, x1: 0.72, h: 0.15 },
  anal: { x0: 0.1, x1: 0.42, h: 0.12 },
  pectoral: { x: 0.68, y: -0.04, len: 0.15 },
  eye: { x: 0.85, y: 0.05, r: 0.05 },
  iris: '#e07818',
  swim: { amp: 0.09, waveK: 5.5, cruise: 2.2, agility: 3 },
  look: { rough: 0.35, clearcoat: 0.6, scaleRepeat: [20, 16], scaleStrength: 0.2 },
  paint(p) {
    const g = p.g;
    const edge = (pts: Array<[number, number]>) => {
      finPaint(p, pts, 'rgba(255,120,20,0.92)', [pts[0][0], 0], 'rgba(120,40,0,0.3)');
      g.strokeStyle = '#111'; g.lineWidth = p.s(0.018);
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(p.px(x), p.py(y)) : g.moveTo(p.px(x), p.py(y)))); g.stroke();
    };
    edge([[0.03, 0.07], [-0.12, 0.2], [-0.24, 0.16], [-0.25, -0.16], [-0.12, -0.2], [0.03, -0.07]]);
    edge([[0.1, 0.14], [0.2, 0.3], [0.44, 0.34], [0.66, 0.3], [0.74, 0.2]]);
    edge([[0.08, -0.14], [0.14, -0.28], [0.34, -0.3], [0.44, -0.18]]);
    pecPaint(p, 'rgba(255,130,30,0.9)', 'rgba(90,30,0,0.4)');
    body(p, this, p.grad(0, 0.24, 0, -0.2, [[0, '#e8560a'], [0.5, '#ff7a18'], [1, '#ff9a40']]), () => {
      const bar = (x: number, w: number, lean: number) => {
        g.fillStyle = '#111';
        g.beginPath(); g.ellipse(p.px(x), p.py(0), p.s(w + 0.018), p.s(0.4), lean, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fbfbf6';
        g.beginPath(); g.ellipse(p.px(x), p.py(0), p.s(w), p.s(0.4), lean, 0, Math.PI * 2); g.fill();
      };
      p.scales(0.026, 'rgba(120,40,0,0.2)', 1.2);
      bar(0.74, 0.04, 0.12); bar(0.43, 0.05, -0.05); bar(0.08, 0.025, 0);
      mouth(p, 1.0, -0.01, 0.04);
    });
  },
};

export const PUFFER: SpeciesDef = {
  id: 'puffer', length: 4.4,
  top: [[0, 0.07], [0.25, 0.2], [0.55, 0.27], [0.82, 0.24], [0.96, 0.13], [1, 0.07]],
  bottom: [[0, 0.07], [0.3, 0.22], [0.6, 0.28], [0.85, 0.22], [1, 0.06]],
  width: [[0, 0.06], [0.3, 0.2], [0.6, 0.25], [0.85, 0.2], [1, 0.06]],
  tail: { len: 0.2, span: 0.17 },
  dorsal: { x0: 0.1, x1: 0.28, h: 0.12 },
  anal: { x0: 0.1, x1: 0.26, h: 0.11 },
  pectoral: { x: 0.74, y: 0.0, len: 0.11 },
  eye: { x: 0.82, y: 0.12, r: 0.06 },
  iris: '#48a060',
  spikes: true,
  swim: { amp: 0.03, waveK: 4, cruise: 2.4, agility: 1 },
  look: { rough: 0.55, clearcoat: 0.35, scaleRepeat: [16, 14], scaleStrength: 0.05 },
  paint(p) {
    const g = p.g;
    finPaint(p, [[0.03, 0.05], [-0.1, 0.16], [-0.19, 0.14], [-0.21, 0], [-0.19, -0.14], [-0.1, -0.16], [0.03, -0.05]], 'rgba(200,170,110,0.6)', [0.02, 0], 'rgba(100,70,30,0.4)');
    finPaint(p, [[0.08, 0.16], [0.14, 0.34], [0.26, 0.3], [0.3, 0.2]], 'rgba(200,170,110,0.7)', [0.2, 0.2], 'rgba(100,70,30,0.4)');
    finPaint(p, [[0.08, -0.16], [0.13, -0.33], [0.25, -0.3], [0.28, -0.2]], 'rgba(230,220,200,0.7)', [0.2, -0.2], 'rgba(100,70,30,0.4)');
    pecPaint(p, 'rgba(210,190,140,0.6)', 'rgba(110,80,40,0.4)');
    body(p, this, p.grad(0, 0.3, 0, -0.3, [[0, '#6f5a3c'], [0.45, '#9c8358'], [0.62, '#e8e0cc'], [1, '#fbf8ee']]), () => {
      p.speckle(0.02, -0.02, 0.95, 0.3, 140, 0.012, 'rgba(225,80,40,0.8)', 21);
      p.speckle(0.02, 0.05, 0.95, 0.3, 90, 0.008, 'rgba(40,28,14,0.55)', 22);
      mouth(p, 1.0, -0.02, 0.03, 'rgba(60,40,20,0.8)');
    });
  },
};

export const SHARK: SpeciesDef = {
  id: 'shark', length: 20,
  top: [[0, 0.008], [0.14, 0.03], [0.35, 0.07], [0.6, 0.1], [0.84, 0.085], [0.95, 0.045], [1, 0.006]],
  bottom: [[0, 0.008], [0.14, 0.028], [0.35, 0.065], [0.6, 0.088], [0.84, 0.065], [0.96, 0.024], [1, 0.004]],
  width: [[0, 0.005], [0.14, 0.022], [0.35, 0.055], [0.6, 0.08], [0.85, 0.065], [1, 0.01]],
  tail: { len: 0.22, span: 0.17 },
  dorsal: { x0: 0.46, x1: 0.66, h: 0.15 },
  anal: { x0: 0.1, x1: 0.2, h: 0.05 },
  pectoral: { x: 0.72, y: -0.05, len: 0.2 },
  eye: { x: 0.9, y: 0.035, r: 0.012 },
  iris: '#b9a46a',
  swim: { amp: 0.065, waveK: 4.8, cruise: 7.5, agility: 0.6 },
  look: { rough: 0.55, clearcoat: 0.25, scaleRepeat: [80, 30], scaleStrength: 0.06, finGlow: 0 },
  paint(p) {
    const g = p.g;
    const skin = p.grad(0, 0.1, 0, -0.08, [[0, '#4b5358'], [0.45, '#7d8589'], [0.55, '#cfd2cf'], [1, '#f2f2ee']]);
    // the tail: a long upper lobe with a black tip
    const tailPts: Array<[number, number]> = [[0.07, 0.03], [-0.06, 0.06], [-0.2, 0.17], [-0.17, 0.09], [-0.1, 0.005], [-0.12, -0.085], [-0.06, -0.05], [0.07, -0.03]];
    p.shape(tailPts, p.grad(0, 0.2, 0, -0.1, [[0, '#59636a'], [0.6, '#7b858b'], [1, '#9aa2a6']]));
    g.save(); p.shape(tailPts, 'rgba(0,0,0,0)'); g.clip();
    g.fillStyle = '#16191b'; g.beginPath(); g.arc(p.px(-0.205), p.py(0.17), p.s(0.035), 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(p.px(-0.125), p.py(-0.09), p.s(0.025), 0, Math.PI * 2); g.fill();
    g.restore();
    // the dorsal fin sweeps back to a dusky tip
    p.shape([[0.68, 0.085], [0.6, 0.12], [0.555, 0.19], [0.53, 0.25], [0.515, 0.24], [0.5, 0.15], [0.44, 0.085]], p.grad(0, 0.25, 0, 0.08, [[0, '#2a2f33'], [0.35, '#545d62'], [1, '#6b7479']]));
    p.shape([[0.2, -0.03], [0.16, -0.08], [0.12, -0.075], [0.1, -0.03]], '#6d7478');
    pecPaint(p, '#6a7276', 'rgba(0,0,0,0)');
    p.shape([[0.77, -0.47], [0.755, -0.52], [0.8, -0.56], [0.78, -0.5]], '#141719');
    body(p, this, skin, () => {
      g.strokeStyle = 'rgba(30,34,36,0.45)'; g.lineWidth = p.s(0.004);
      for (let i = 0; i < 5; i++) { const x = 0.74 + i * 0.018; g.beginPath(); g.moveTo(p.px(x), p.py(0.03)); g.quadraticCurveTo(p.px(x + 0.006), p.py(-0.01), p.px(x), p.py(-0.05)); g.stroke(); }
      mouth(p, 0.96, -0.03, 0.06, 'rgba(40,40,40,0.6)');
      p.speckle(0.1, -0.02, 0.9, 0.08, 120, 0.004, 'rgba(40,40,40,0.12)', 31);
    });
  },
};

export const SPECIES = [CHROMIS, YELLOW_TANG, BUTTERFLY, ANGEL, REGAL_TANG, CLOWN, PUFFER, SHARK];
