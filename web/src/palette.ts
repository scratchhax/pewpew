import { hash01 } from './state';

/** HSL → packed RGB (s,l in 0..1, h in 0..360). */
function hsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
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

/**
 * Rich palette for the host-to-host mesh (connection lines, the energy
 * crystals that ride them, and their arrival bursts). 24 hues × 2
 * lightness tiers = 48 clearly distinct colours, deliberately independent
 * of the event-type colour law so the constellation reads as a colourful web.
 */
export const PATH_COLORS: number[] = (() => {
  const out: number[] = [];
  const hues = 24;
  for (let i = 0; i < hues; i++) {
    const h = (i / hues) * 360;
    out.push(hsl(h, 0.9, 0.6));      // saturated
    out.push(hsl(h, 0.72, 0.74));    // light / airy
  }
  return out;
})();

/** Stable colour for a directed host pair — same link keeps its hue. */
export function pathColorFor(key: string): number {
  return PATH_COLORS[(hash01(key) * PATH_COLORS.length) | 0];
}
