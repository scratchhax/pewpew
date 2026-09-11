import { hash01 } from './state';
import type { MeshMode, Settings } from './settings';

/** HSL → packed RGB (s,l in 0..1, h in degrees, any range — wrapped). */
export function hsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255);
  return (q(r) << 16) | (q(g) << 8) | q(b);
}

// hue family per mesh mode: [centre, spread across the wheel]
const BANDS: Record<Exclude<MeshMode, 'law'>, [number, number]> = {
  spectrum: [0, 360],
  mono:     [195, 46],
  warm:     [22, 118],
  cool:     [210, 132],
};

const HUES = 24;   // × 2 lightness tiers = 48 colours

let cacheKey = '';
let cache: number[] = [];

/** Build (and cache) the 48-colour mesh palette for the current colour knobs. */
export function buildPathPalette(mode: MeshMode, hueShift: number, sat: number): number[] {
  const key = `${mode}|${hueShift}|${sat}`;
  if (key === cacheKey) return cache;
  cacheKey = key;
  if (mode === 'law') { cache = [0x5ce6a4]; return cache; }
  const [centre, spread] = BANDS[mode];
  const s = Math.min(1, Math.max(0, sat));
  const out: number[] = [];
  for (let i = 0; i < HUES; i++) {
    const h = centre + (i / HUES - 0.5) * spread + hueShift;
    out.push(hsl(h, 0.9 * s, 0.6));
    out.push(hsl(h, 0.72 * s, 0.74));
  }
  cache = out;
  return out;
}

/** Stable colour for a directed host pair — same link keeps its hue. */
export function pathColorFor(key: string, s: Settings): number {
  const pal = buildPathPalette(s.meshMode, s.hueShift, s.colorSat);
  return pal[(hash01(key) * pal.length) | 0];
}
