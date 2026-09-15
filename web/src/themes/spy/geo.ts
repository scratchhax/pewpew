import { Vector3 } from 'three';

/**
 * The made-up world's geography, read back from the baked planet: which pixels
 * are land, the nations (regions), their cities and districts, the ground
 * station that stands for your network, and where every IP "lives".
 *
 * Coordinates follow three.js's SphereGeometry UVs so the CPU and the planet
 * textures agree: u = (lon + π) / 2π, v = lat / π + 0.5 (v = 1 is the north pole).
 */

export const R = 100;                         // planet radius (world units)

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Unit direction (planet-local) for a latitude/longitude in radians. */
export function dirOf(lat: number, lon: number, out = new Vector3()): Vector3 {
  const phi = lon + Math.PI;
  return out.set(-Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
}

/** Latitude/longitude (radians) of a planet-local direction. */
export function latLonOf(d: Vector3): { lat: number; lon: number } {
  const n = d.clone().normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, n.y)));
  let phi = Math.atan2(n.z, -n.x);
  if (phi < 0) phi += Math.PI * 2;
  return { lat, lon: phi - Math.PI };
}

/** Great-circle angle between two lat/lon points. */
export function angleBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return dirOf(a.lat, a.lon).angleTo(dirOf(b.lat, b.lon));
}

export function fmtCoord(lat: number, lon: number, digits = 4): string {
  const la = (lat * 180) / Math.PI, lo = (lon * 180) / Math.PI;
  return `${Math.abs(la).toFixed(digits)}° ${la >= 0 ? 'N' : 'S'}  ${Math.abs(lo).toFixed(digits)}° ${lo >= 0 ? 'E' : 'W'}`;
}

// ── names ────────────────────────────────────────────────────────────────────
const ON = ['k', 'v', 'th', 'dr', 'm', 's', 'br', 'h', 'al', 'or', 'z', 'n', 'c', 'gr', 'l', 't', 'ves', 'kal', 'st', 'r', 'p', 'qu', 'f', 'sh'];
const NU = ['a', 'e', 'o', 'i', 'u', 'ae', 'ei', 'ar', 'or', 'en', 'al', 'y'];
const CO = ['th', 'r', 'n', 'l', 'ss', 'rk', 'nd', 'v', 'st', 'm', 'x', 'dr', 'lt', 'sk', 'rn', 'g'];
const END = ['a', 'ia', 'or', 'mark', 'ay', 'en', 'is', 'ar', 'heim', 'ova', 'ek', 'us', 'ane', 'um', 'ith', 'ra'];
const CITY_END = ['', '', '', 'ford', 'haven', 'mouth', 'burg', 'grad', 'port', 'wick', 'stad', 'ton', 'ville', 'field', 'crest', 'gate'];
const DIST_A = ['Old', 'North', 'South', 'East', 'West', 'Upper', 'Lower', 'New', 'Grey', 'Iron', 'Salt', 'Tannery', 'Vessel', 'Harrow', 'Copper', 'Mill', 'Glass', 'Rook', 'Cinder', 'Lantern'];
const DIST_B = ['Quay', 'Row', 'Market', 'Heights', 'Yards', 'Docks', 'Cross', 'Commons', 'Terrace', 'Wharf', 'Ward', 'Hill', 'Lane', 'Gardens', 'Arches', 'Basin', 'Works', 'Parade'];

const pickR = <T>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function word(r: () => number, syll: number, ending: readonly string[]): string {
  let w = pickR(r, ON) + pickR(r, NU);
  for (let i = 1; i < syll; i++) w += pickR(r, CO) + pickR(r, NU);
  return cap(w + pickR(r, ending)).replace(/(.)\1\1/g, '$1$1');
}

export function districtName(h: number): string {
  const r = rng(h);
  return `${pickR(r, DIST_A)} ${pickR(r, DIST_B)}`;
}

// ── world data ───────────────────────────────────────────────────────────────
export interface Region { name: string; lat: number; lon: number; cities: City[]; }
export interface City {
  name: string; lat: number; lon: number;
  pop: number;            // 0..1
  region: Region;
  capital: boolean;
  home?: boolean;
}

export class Geo {
  readonly regions: Region[] = [];
  readonly cities: City[] = [];
  home!: City;
  readonly planetName: string;

  /**
   * `pixels` is the albedo bake read back (RGBA, row 0 = south pole) with the
   * relief in alpha: land where alpha > 127.
   */
  constructor(readonly pixels: Uint8Array, readonly w: number, readonly h: number, seed: number) {
    const r = rng(seed * 7919 + 13);
    this.planetName = word(r, 2, END).toUpperCase();
    this.placeRegions(r);
    this.placeCities(r);
  }

  private px(lat: number, lon: number): number {
    const u = (lon + Math.PI) / (Math.PI * 2), v = lat / Math.PI + 0.5;
    const x = Math.min(this.w - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * this.w)));
    const y = Math.min(this.h - 1, Math.max(0, Math.floor(v * this.h)));
    return (y * this.w + x) * 4;
  }

  /** Relief: < 0.5 is sea, 0.5 the coast, 1 the highest peaks. */
  relief(lat: number, lon: number): number { return this.pixels[this.px(lat, lon) + 3] / 255; }
  land(lat: number, lon: number): boolean { return this.relief(lat, lon) > 0.5; }
  /** Ground colour at a point (0..1 RGB), for tinting the close-up. */
  ground(lat: number, lon: number): [number, number, number] {
    const i = this.px(lat, lon);
    return [this.pixels[i] / 255, this.pixels[i + 1] / 255, this.pixels[i + 2] / 255];
  }

  landFraction(): number {
    let n = 0, land = 0;
    for (let i = 3; i < this.pixels.length; i += 4 * 7) { n++; if (this.pixels[i] > 127) land++; }
    return land / Math.max(1, n);
  }

  private randomLand(r: () => number, maxLat: number, tries = 400): { lat: number; lon: number } | null {
    for (let k = 0; k < tries; k++) {
      // uniform on the sphere, clamped to a latitude band
      const lat = Math.asin(r() * 2 - 1);
      if (Math.abs(lat) > maxLat) continue;
      const lon = r() * Math.PI * 2 - Math.PI;
      if (this.land(lat, lon)) return { lat, lon };
    }
    return null;
  }

  private placeRegions(r: () => number): void {
    const want = 9;
    for (let k = 0; k < 2000 && this.regions.length < want; k++) {
      const p = this.randomLand(r, 1.1);
      if (!p) break;
      if (this.regions.some((g) => angleBetween(g, p) < 0.55)) continue;
      this.regions.push({ name: word(r, 1 + (r() < 0.5 ? 1 : 0), END).toUpperCase(), lat: p.lat, lon: p.lon, cities: [] });
    }
    if (!this.regions.length) this.regions.push({ name: 'KETHRA', lat: 0, lon: 0, cities: [] });
  }

  private nearCoast(lat: number, lon: number): boolean {
    const d = 0.035;
    for (const [a, b] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
      if (!this.land(lat + a, lon + b / Math.max(0.2, Math.cos(lat)))) return true;
    }
    return false;
  }

  private placeCities(r: () => number): void {
    const want = 170;
    for (let k = 0; k < 20000 && this.cities.length < want; k++) {
      const p = this.randomLand(r, 1.08, 40);
      if (!p) continue;
      const rel = this.relief(p.lat, p.lon);
      if (rel > 0.8) continue;                                 // not on the peaks
      const coast = this.nearCoast(p.lat, p.lon);
      const temperate = 1 - Math.abs(Math.abs(p.lat) - 0.6) * 0.9;
      if (r() > (coast ? 0.9 : 0.28) * Math.max(0.15, temperate)) continue;
      if (this.cities.some((c) => angleBetween(c, p) < 0.045)) continue;
      let region = this.regions[0], best = 9;
      for (const g of this.regions) { const a = angleBetween(g, p); if (a < best) { best = a; region = g; } }
      const city: City = {
        name: word(r, 1 + (r() < 0.55 ? 1 : 0), CITY_END), lat: p.lat, lon: p.lon,
        pop: Math.pow(r(), 2.4) * (coast ? 1 : 0.7), region, capital: false,
      };
      this.cities.push(city);
      region.cities.push(city);
    }
    for (const g of this.regions) {
      if (!g.cities.length) continue;
      const cap0 = g.cities.reduce((a, b) => (b.pop > a.pop ? b : a));
      cap0.capital = true;
      cap0.pop = Math.max(cap0.pop, 0.75 + r() * 0.25);
    }
    // the ground station: a mid-size temperate city
    const cands = this.cities.filter((c) => Math.abs(c.lat) > 0.45 && Math.abs(c.lat) < 0.85 && !c.capital);
    this.home = (cands.length ? cands : this.cities).reduce((a, b) => (Math.abs(b.pop - 0.35) < Math.abs(a.pop - 0.35) ? b : a), (cands.length ? cands : this.cities)[0]);
    if (this.home) this.home.home = true;
    this.regions.splice(0, this.regions.length, ...this.regions.filter((g) => g.cities.length));
  }

  /** Where an IP "lives": its /16 picks the nation (so ranges cluster), the whole address the city. */
  locate(ip: string | null | undefined): City {
    if (!ip || !this.regions.length) return this.home;
    const parts = ip.split(/[.:]/);
    const region = this.regions[hashStr(parts.slice(0, 2).join('.')) % this.regions.length];
    return region.cities[hashStr(ip) % region.cities.length];
  }
}
