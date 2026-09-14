/**
 * Compound geometry in screen pixels. Everything is derived from the viewport
 * so the compound sits in the middle, clear of the HUD corners.
 */
export interface Point { x: number; y: number }

export interface Gate extends Point {
  side: -1 | 1;      // left / right wall
  outX: number;      // a step outside the gate
}

export interface Layout {
  w: number; h: number;
  cx: number; cy: number;
  hw: number; hh: number;          // compound half-size
  x0: number; y0: number; x1: number; y1: number;
  wall: number;                     // wall thickness
  gateHalf: number;                 // half the gate opening
  gates: Gate[];
  towers: Point[];
  mast: Point;
  generator: Point;
  buildings: Point[];
  camp: Point[];
  unit: number;                     // sprite scale vs a 1080p screen
}

export function makeLayout(w: number, h: number): Layout {
  const cx = w / 2, cy = h / 2;
  const hw = Math.round(Math.min(w * 0.23, h * 0.40));
  const hh = Math.round(Math.min(h * 0.28, w * 0.2));
  const unit = Math.max(0.6, Math.min(1.6, Math.min(w / 1920, h / 1080) * 1.1));
  const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
  const bx = hw * 0.62, by = hh * 0.58;

  // tent slots: a grid around the courtyard centre, leaving room for the mast
  const camp: Point[] = [];
  const cols = 11, rows = 4;
  const sx = (hw * 0.84) / (cols - 1), sy = (hh * 0.6) / (rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -hw * 0.42 + c * sx, y = -hh * 0.3 + r * sy;
      if (Math.abs(x) < hw * 0.14 && Math.abs(y) < hh * 0.16) continue;
      camp.push({ x: cx + x, y: cy + y });
    }
  }

  return {
    w, h, cx, cy, hw, hh, x0, y0, x1, y1, unit,
    wall: Math.max(8, Math.round(12 * unit)),
    gateHalf: Math.round(30 * unit),
    gates: [
      { x: x0, y: cy, side: -1, outX: x0 - 46 * unit },
      { x: x1, y: cy, side: 1, outX: x1 + 46 * unit },
    ],
    towers: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }],
    mast: { x: cx, y: cy - 6 * unit },
    generator: { x: cx + 46 * unit, y: cy + 20 * unit },
    buildings: [
      { x: cx - bx, y: cy - by }, { x: cx + bx, y: cy - by },
      { x: cx - bx, y: cy + by }, { x: cx + bx, y: cy + by },
      { x: cx, y: cy - by }, { x: cx, y: cy + by },
    ],
    camp,
  };
}

/** Where a straight line from the centre toward `from` meets the outside of the wall. */
export function wallPoint(L: Layout, from: Point, margin = 14): Point {
  const dx = from.x - L.cx, dy = from.y - L.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tx = Math.abs(ux) > 1e-4 ? (L.hw + margin) / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-4 ? (L.hh + margin) / Math.abs(uy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: L.cx + ux * t, y: L.cy + uy * t };
}

/** Nearest gate to a point (by side of the compound). */
export function nearestGate(L: Layout, p: Point): Gate {
  return p.x < L.cx ? L.gates[0] : L.gates[1];
}

/** Deterministic PRNG for the static scenery. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
