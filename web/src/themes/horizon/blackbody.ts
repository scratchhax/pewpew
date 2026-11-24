import { DataTexture, LinearFilter, RGBAFormat, ClampToEdgeWrapping, UnsignedByteType } from 'three';

/**
 * Blackbody colour, done properly: Planck's law integrated against the CIE
 * 1931 observer (the Wyman/Sloan/Shirley multi-lobe fit), converted to linear
 * Rec.709 and normalised to its brightest channel. Everything that glows in
 * this scene (the disk, the stars, infalling debris, the shredded star) takes
 * its colour from this one table, so Doppler and gravitational shifts read as
 * real temperature changes: the receding side of the disk deepens to orange,
 * the approaching side climbs to blue-white, and anything falling in reddens
 * as it nears the horizon.
 *
 * The shader looks colours up by u = log(T / T_MIN) / log(T_MAX / T_MIN).
 */
export const T_MIN = 800;
export const T_MAX = 40000;
const N = 256;

function lobe(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

function cmf(nm: number): [number, number, number] {
  const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** Linear Rec.709 colour of a blackbody at `t` kelvin, brightest channel = 1. */
export function blackbody(t: number): [number, number, number] {
  let X = 0, Y = 0, Z = 0;
  for (let nm = 380; nm <= 780; nm += 5) {
    const l = nm * 1e-9;
    const b = 1 / (Math.pow(l, 5) * (Math.exp(1.4388e-2 / (l * t)) - 1));
    const [x, y, z] = cmf(nm);
    X += b * x; Y += b * y; Z += b * z;
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let bl = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  r = Math.max(0, r); g = Math.max(0, g); bl = Math.max(0, bl);
  const m = Math.max(r, g, bl, 1e-30);
  return [r / m, g / m, bl / m];
}

const table: Array<[number, number, number]> = [];
for (let i = 0; i < N; i++) table.push(blackbody(T_MIN * Math.pow(T_MAX / T_MIN, i / (N - 1))));

/** Table lookup (same values the shaders see). */
export function bbColor(t: number): [number, number, number] {
  const u = Math.log(Math.max(T_MIN, Math.min(T_MAX, t)) / T_MIN) / Math.log(T_MAX / T_MIN) * (N - 1);
  const i = Math.min(N - 2, Math.floor(u)), f = u - i;
  const a = table[i], b = table[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function blackbodyTexture(): DataTexture {
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const [r, g, b] = table[i];
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, N, 1, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** GLSL side of the table: `bb(T)` returns the normalised colour. */
export const BB_GLSL = /* glsl */`
  uniform sampler2D uBB;
  vec3 bb(float t) {
    float u = log(clamp(t, ${T_MIN.toFixed(1)}, ${T_MAX.toFixed(1)}) / ${T_MIN.toFixed(1)}) / ${Math.log(T_MAX / T_MIN).toFixed(6)};
    return texture(uBB, vec2(u * ${((N - 1) / N).toFixed(6)} + ${(0.5 / N).toFixed(6)}, 0.5)).rgb;
  }`;
