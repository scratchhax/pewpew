import { hsl } from '../../palette';
import type { CrackKind } from './crack';

/**
 * The paper and the pigments, and the fact that they change between pictures.
 *
 * Substrate draws a fresh picture every couple of minutes, and drawing every
 * one of them in the same cream-and-green got old fast: the plate is supposed
 * to feel like a new study each time, not a rerun. So each picture picks a
 * *study* — a paper, an ink, and a cast that is rotated through every pigment
 * on the plate.
 *
 * The colour law survives this because the cast moves every pigment together.
 * Block is still the reddest thing on the plate and DNS still the bluest,
 * whichever study is up; what changes is the whole sheet's complexion. The HUD
 * and the log keep the exact law colours regardless, so the reference never
 * moves.
 */

export type PigmentKind = CrackKind | 'dns' | 'dhcp';

/**
 * Each kind's pigment as a range from a deep tone to a light one, before any
 * study cast. Where an event lands in its range comes from the traffic — which
 * host, which domain — so a plate has depth without ever lying about what an
 * event was.
 */
export const BASE_PIGMENT: Record<PigmentKind, [number, number]> = {
  allow: [0x1f7d5c, 0xa6e87a],
  block: [0xa32323, 0xff8f6b],
  threat: [0xb85a08, 0xffb257],
  dns: [0x1f5f9e, 0x86cdff],
  dhcp: [0xa87c08, 0xffe487],
  wifi: [0x5f3aa8, 0xd8b4ff],
  system: [0x4a555f, 0xb0bcc6],
};

export interface Study {
  /** Shown in the debug overlay, and worth having a name for. */
  name: string;
  /** The bare sheet. */
  paper: number;
  /** The crack hairline. */
  ink: number;
  inkAlpha: number;
  /** Pigment brightens the sheet instead of staining it (dark studies). */
  additive: boolean;
  /** The HUD follows the sheet rather than fighting it. */
  dark: boolean;
  /** Degrees every pigment is rotated by. */
  hue: number;
  /** Saturation multiplier. */
  sat: number;
  /** Lightness shift, -1..1. */
  light: number;
}

/**
 * Six sheets. Kept deliberately close to real drawing papers and inks rather
 * than to a colour wheel: the hue rotations are small enough that red stays
 * red, and the paper does most of the work of making a picture feel different.
 */
export const STUDIES: Study[] = [
  { name: 'FOOLSCAP', paper: 0xf4efe3, ink: 0x0d0b09, inkAlpha: 0.55, additive: false, dark: false, hue: 0, sat: 1, light: 0 },
  { name: 'BLUEPRINT', paper: 0xe4ecf3, ink: 0x101a2e, inkAlpha: 0.5, additive: false, dark: false, hue: 18, sat: 1.05, light: -0.03 },
  { name: 'SEPIA', paper: 0xf1e7d3, ink: 0x2a1d10, inkAlpha: 0.5, additive: false, dark: false, hue: -24, sat: 0.82, light: 0.02 },
  { name: 'VERDIGRIS', paper: 0xe7efe7, ink: 0x0f2320, inkAlpha: 0.5, additive: false, dark: false, hue: 40, sat: 0.95, light: -0.02 },
  { name: 'ROSE MADDER', paper: 0xf3e9e9, ink: 0x2a1216, inkAlpha: 0.5, additive: false, dark: false, hue: -42, sat: 0.9, light: 0 },
  { name: 'NOCTURNE', paper: 0x07080b, ink: 0xe2ebf0, inkAlpha: 0.3, additive: true, dark: true, hue: 8, sat: 1.15, light: 0.12 },
];

/** Packed RGB → hue (degrees), saturation and lightness, all 0..1 but hue. */
function toHsl(rgb: number): [number, number, number] {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

/** One colour through a study's cast. */
function cast(rgb: number, st: Study): number {
  const [h, s, l] = toHsl(rgb);
  return hsl(h + st.hue,
             Math.max(0, Math.min(1, s * st.sat)),
             Math.max(0.02, Math.min(0.98, l + st.light)));
}

/**
 * The pigment table for a study. Built once when the study changes rather than
 * per event, so laying a grain stays a lerp and nothing does colour-space
 * arithmetic on the hot path.
 */
export function castPigments(st: Study): Record<PigmentKind, [number, number]> {
  const out = {} as Record<PigmentKind, [number, number]>;
  for (const k of Object.keys(BASE_PIGMENT) as PigmentKind[]) {
    const [lo, hi] = BASE_PIGMENT[k];
    out[k] = [cast(lo, st), cast(hi, st)];
  }
  return out;
}
