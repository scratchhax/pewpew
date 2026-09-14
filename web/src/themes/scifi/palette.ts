import { hash01 } from '../../state';
import { hsl } from '../../palette';
import type { MeshMode, SciFiSettings } from './settings';

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
export function pathColorFor(key: string, s: SciFiSettings): number {
  const pal = buildPathPalette(s.meshMode, s.hueShift, s.colorSat);
  return pal[(hash01(key) * pal.length) | 0];
}
