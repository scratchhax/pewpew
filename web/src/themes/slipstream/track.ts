/**
 * The circuits. Each is a hand-authored closed loop of control points in a
 * 1024×1024 texture that doubles as the world: the Mode 7 ground samples this
 * bitmap directly, so the road you see is the road you drive. Points are
 * chosen so no loop ever crosses itself — the flat plane has no overpasses.
 */

const SIZE = 1024;

export interface Circuit {
  id: string;
  name: string;
  pts: Array<[number, number]>;
  width: number;
  padFr: number[];      // boost pad positions as a fraction of the lap
  boardFr: number;      // sponsor board, fraction of the lap
  speed: number;        // pace flavour multiplier (bowls are faster)
}

export interface Track {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  px: Uint32Array;                 // the baked bitmap, little-endian RGBA32
  xs: Float32Array; ys: Float32Array;
  txs: Float32Array; tys: Float32Array;
  cum: Float32Array;               // cumulative arc length at each sample
  total: number;
  pads: number[];                  // s positions of the boost pads
  boardS: number;
  width: number;
  speed: number;
  atS(s: number): { x: number; y: number; tx: number; ty: number };
  /** Lateral offset (+left / −right of the racing line) baked to world space. */
  offset(s: number, lat: number): { x: number; y: number };
  nearest(x: number, y: number): number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The three circuits. */
export const CIRCUITS: Record<string, Circuit> = {
  bowl: {
    id: 'bowl', name: 'SUNSET BOWL', width: 72, padFr: [0.07, 0.55], boardFr: 0.28, speed: 1.12,
    pts: (() => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = 1 + 0.07 * Math.sin(5 * a);
        pts.push([512 + Math.cos(a) * 372 * r, 512 + Math.sin(a) * 288 * r]);
      }
      return pts;
    })(),
  },
  twisty: {
    id: 'twisty', name: 'CORKSCREW', width: 52, padFr: [0.05, 0.4, 0.75], boardFr: 0.22, speed: 0.92,
    pts: (() => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const r = 302 + 84 * Math.sin(3 * a + 0.6);
        pts.push([512 + Math.cos(a) * r, 512 + Math.sin(a) * r * 0.92]);
      }
      return pts;
    })(),
  },
  long: {
    id: 'long', name: 'LONG LAP', width: 60, padFr: [0.12, 0.7], boardFr: 0.42, speed: 1.0,
    pts: [
      [250, 300], [500, 220], [760, 260], [860, 420], [780, 560], [640, 516],
      [560, 620], [640, 760], [480, 846], [300, 760], [216, 560],
    ],
  },
};

/** Catmull-Rom through the control points, closed; ~30 samples per segment. */
function sample(c: Circuit, per = 44): { xs: Float32Array; ys: Float32Array; txs: Float32Array; tys: Float32Array; cum: Float32Array; total: number } {
  const p = c.pts, n = p.length;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      xs.push(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3));
      ys.push(0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3));
    }
  }
  const m = xs.length;
  const txs = new Float32Array(m), tys = new Float32Array(m), cum = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const a = (i - 1 + m) % m, b = (i + 1) % m;
    let dx = xs[b] - xs[a], dy = ys[b] - ys[a];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    txs[i] = dx; tys[i] = dy;
  }
  let total = 0;
  for (let i = 0; i < m; i++) {
    cum[i] = total;
    const b = (i + 1) % m;
    total += Math.hypot(xs[b] - xs[i], ys[b] - ys[i]);
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), txs, tys, cum, total };
}


/** Paint the world bitmap: tileable grass, then the road on top. */
function bake(c: Circuit, s: ReturnType<typeof sample>): { canvas: HTMLCanvasElement; px: Uint32Array } {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d')!;
  const rnd = mulberry32(c.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));

  // grass: two checker scales so motion over it reads even at speed
  ctx.fillStyle = '#1d4023';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#204727';
  for (let y = 0; y < 16; y++) for (let x = (y & 1); x < 16; x += 2) ctx.fillRect(x * 64, y * 64, 64, 64);
  ctx.fillStyle = '#234d2a';
  for (let y = 0; y < 32; y++) for (let x = ((y >> 1) & 1); x < 32; x += 2) ctx.fillRect(x * 32, y * 32, 32, 32);
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#1a3a20' : '#28552d';
    ctx.fillRect((rnd() * SIZE) | 0, (rnd() * SIZE) | 0, 2 + (rnd() * 3 | 0), 2);
  }
  // dirt patches out in the park, clear of the road
  for (let i = 0; i < 26; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE, r = 24 + rnd() * 60;
    if (distToTrack(s, x, y) < c.width * 1.6) continue;
    ctx.fillStyle = 'rgba(96, 74, 45, 0.5)';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.66, rnd() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }

  // the road, stroked along the samples
  const path = new Path2D();
  const m = s.xs.length;
  path.moveTo(s.xs[0], s.ys[0]);
  for (let i = 1; i <= m; i++) path.lineTo(s.xs[i % m], s.ys[i % m]);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const stroke = (w: number, col: string) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(path); };
  stroke(c.width + 34, '#5a4628');                       // dirt shoulder
  stroke(c.width + 18, '#b03a2e');                       // curb red
  ctx.setLineDash([26, 26]);
  stroke(c.width + 18, '#e8e4da');                       // curb white
  ctx.setLineDash([]);
  stroke(c.width, '#3c3f47');                             // asphalt
  ctx.setLineDash([20, 30]);
  stroke(5, '#c9cdd6');                                  // centre line
  ctx.setLineDash([]);

  // start line: a checker band across the road at s = 0
  const a0 = { x: s.xs[0], y: s.ys[0], tx: s.txs[0], ty: s.tys[0] };
  ctx.save();
  ctx.translate(a0.x, a0.y);
  ctx.rotate(Math.atan2(a0.ty, a0.tx));
  const hw = c.width / 2, sq = 11;
  for (let r = 0; r < 2; r++) for (let k = -Math.ceil(hw / sq); k < hw / sq; k++) {
    ctx.fillStyle = ((k + r) & 1) ? '#111' : '#eee';
    ctx.fillRect(r * sq - sq, k * sq, sq, sq);
  }
  ctx.restore();

  // boost pads: three chevrons across the road, cyan
  const padAt = (sPos: number) => {
    const i = Math.round((sPos / s.total) * m) % m;
    ctx.save();
    ctx.translate(s.xs[i], s.ys[i]);
    ctx.rotate(Math.atan2(s.tys[i], s.txs[i]));
    for (let k = 0; k < 3; k++) {
      const x = -26 + k * 17;
      ctx.fillStyle = k === 2 ? '#c8f6ff' : '#57cfe8';
      ctx.beginPath();
      ctx.moveTo(x + 12, 0); ctx.lineTo(x - 6, -hw + 6); ctx.lineTo(x - 1, 0); ctx.lineTo(x - 6, hw - 6);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };
  for (const f of c.padFr) padAt(f * s.total);

  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  return { canvas: cv, px: new Uint32Array(img.data.buffer) };
}

function distToTrack(s: ReturnType<typeof sample>, x: number, y: number): number {
  let bd = Infinity;
  const m = s.xs.length;
  for (let i = 0; i < m; i += 4) {
    const d = (s.xs[i] - x) ** 2 + (s.ys[i] - y) ** 2;
    if (d < bd) bd = d;
  }
  return Math.sqrt(bd);
}

/**
 * Build one track. `sel` is the setting ('auto' picks by hostname so every
 * LAN gets a stable home circuit).
 */
export function buildTrack(sel: string, hostname: string): Track {
  let id = sel;
  if (!id || id === 'auto' || !(id in CIRCUITS)) {
    let h = 2166136261;
    const s = hostname || 'lan';
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    const ids = Object.keys(CIRCUITS);
    id = ids[h % ids.length];
  }
  const c = CIRCUITS[id];
  const smp = sample(c);
  const { canvas, px } = bake(c, smp);

  // nearest-sample lookup buckets (built once)
  const G = 32, bucket = new Int32Array(G * G).fill(-1);
  const m = smp.xs.length;
  const build = () => {
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const cx = (gx + 0.5) * SIZE / G, cy = (gy + 0.5) * SIZE / G;
      let best = 0, bd = Infinity;
      for (let i = 0; i < m; i += 2) {
        const d = (smp.xs[i] - cx) ** 2 + (smp.ys[i] - cy) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      bucket[gy * G + gx] = best;
    }
  };
  build();

  const wrapS = (s: number) => { let v = s % smp.total; if (v < 0) v += smp.total; return v; };
  const idxAt = (s: number): number => {
    // binary search the cumulative arc lengths
    let lo = 0, hi = m - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (smp.cum[mid] <= s) lo = mid; else hi = mid - 1; }
    return lo;
  };

  return {
    id, name: c.name, canvas, px,
    xs: smp.xs, ys: smp.ys, txs: smp.txs, tys: smp.tys, cum: smp.cum, total: smp.total,
    pads: c.padFr.map((f) => f * smp.total), boardS: c.boardFr * smp.total,
    width: c.width, speed: c.speed,
    atS(sv: number) {
      const s = wrapS(sv), i = idxAt(s), j = (i + 1) % m;
      const seg = (j === 0 ? smp.total : smp.cum[j]) - smp.cum[i];
      const f = seg > 0 ? (s - smp.cum[i]) / seg : 0;
      return {
        x: smp.xs[i] + (smp.xs[j] - smp.xs[i]) * f,
        y: smp.ys[i] + (smp.ys[j] - smp.ys[i]) * f,
        tx: smp.txs[i], ty: smp.tys[i],
      };
    },
    offset(sv: number, lat: number) {
      const a = this.atS(sv);
      return { x: a.x - a.ty * lat, y: a.y + a.tx * lat };
    },
    nearest(x: number, y: number) {
      const gx = Math.min(G - 1, Math.max(0, (x / SIZE * G) | 0));
      const gy = Math.min(G - 1, Math.max(0, (y / SIZE * G) | 0));
      let best = bucket[gy * G + gx], bd = Infinity;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = gx + ox, ny = gy + oy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const i = bucket[ny * G + nx];
        if (i < 0) continue;
        const d = (smp.xs[i] - x) ** 2 + (smp.ys[i] - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      // walk the neighbourhood of the bucket winner for an exact hit
      for (let k = -6; k <= 6; k++) {
        const i = (best + k + m) % m;
        const d = (smp.xs[i] - x) ** 2 + (smp.ys[i] - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
  };
}

export const trackHalfWidth = (t: Track): number => t.width / 2;
