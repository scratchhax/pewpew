import type { SceneEvent } from '../../events';
import type { State, Weather } from '../../state';
import { bendAt } from './bend';
import { GEARS } from './score';
import type { MapData } from './traffic';

/**
 * Midnight Run's dashboard, drawn into the shared HUD panels (so the F1 toggles
 * and layout still apply):
 *
 *  - HEAT and NOS: analog gauges with chrome bezels and sprung needles
 *  - TACH: a tachometer on the car's real gear and revs, with a digital speedo
 *    and gear, and the event rate underneath
 *  - RADAR DETECTOR: an LED detector; X, K, Ka and laser bands light for the
 *    kinds of traffic, with signal strength and front/side/rear arrows
 *  - SAT NAV: a heading-up moving map of the winding road, city blocks, cross
 *    streets named after recent DNS lookups, every car and roadblock, the route
 *    our driver is taking and the distance to the next gate
 *
 * Needles swing on springs and every light eases: nothing blinks.
 */

const FONT = "'Courier New', monospace";
const MAGENTA = '#ff3fb4';
const CYAN = '#3ff0ff';
const INK = '#f3e8ff';

export interface DashInfo {
  state: State;
  speed: number;          // m/s
  nitro: number;          // 0..1
  travelled: number;      // m
  eps: number;            // events per second
  map: MapData;
  weather: Record<Weather, string>;
}

/** A needle on a spring: a little overshoot, never a jitter. */
class Needle {
  pos = 0; vel = 0;
  step(target: number, dt: number): number {
    this.vel += (target - this.pos) * 70 * dt;
    this.vel *= Math.exp(-12 * dt);
    this.pos += this.vel * dt;
    return this.pos;
  }
}

function hidpi(parent: HTMLElement, w: number, h: number, id: string, before?: Element | null): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  c.id = id;
  c.className = 'dash';
  parent.insertBefore(c, before ?? null);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return ctx;
}

interface GaugeSpec {
  min: number; max: number; major: number; minor: number;
  red?: [number, number];            // red zone
  band?: [number, number];           // highlighted (good) zone
  label: (v: number) => string;
  title: string;
  unit?: string;
}

const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;

function gauge(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, v: number, g: GaugeSpec, readout: string, glow: number): void {
  const ang = (x: number) => A0 + SWEEP * Math.max(0, Math.min(1, (x - g.min) / (g.max - g.min)));
  c.save();
  // bezel: brushed chrome ring round a smoked face
  const ring = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, '#d8d3ea'); ring.addColorStop(0.35, '#4a4658'); ring.addColorStop(0.6, '#9e99b4'); ring.addColorStop(1, '#2a2636');
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = ring; c.fill();
  const face = c.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
  face.addColorStop(0, '#1d1830'); face.addColorStop(1, '#05040b');
  c.beginPath(); c.arc(cx, cy, r - 3.5, 0, Math.PI * 2); c.fillStyle = face; c.fill();
  // neon backlight round the dial
  c.shadowColor = CYAN; c.shadowBlur = 6 + glow * 10;
  c.strokeStyle = `rgba(63,240,255,${0.28 + glow * 0.4})`; c.lineWidth = 1.5;
  c.beginPath(); c.arc(cx, cy, r - 7, A0, A0 + SWEEP); c.stroke();
  c.shadowBlur = 0;
  if (g.band) {
    c.strokeStyle = 'rgba(63,240,255,0.55)'; c.lineWidth = 3.5;
    c.beginPath(); c.arc(cx, cy, r - 10, ang(g.band[0]), ang(g.band[1])); c.stroke();
  }
  if (g.red) {
    c.strokeStyle = 'rgba(255,46,90,0.9)'; c.lineWidth = 3.5;
    c.beginPath(); c.arc(cx, cy, r - 10, ang(g.red[0]), ang(g.red[1])); c.stroke();
  }
  // ticks and numbers
  c.strokeStyle = INK; c.fillStyle = INK;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `bold ${Math.round(r * 0.19)}px ${FONT}`;
  for (let x = g.min; x <= g.max + 1e-6; x += g.minor) {
    const a = ang(x), major = Math.abs((x - g.min) / g.major - Math.round((x - g.min) / g.major)) < 1e-6;
    const r1 = r - 8, r2 = r1 - (major ? 7 : 3.5);
    c.globalAlpha = major ? 0.95 : 0.5; c.lineWidth = major ? 1.6 : 1;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke();
    if (major) {
      const t = g.label(x);
      if (t) c.fillText(t, cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24));
    }
  }
  c.globalAlpha = 1;
  c.fillStyle = MAGENTA; c.font = `italic bold ${Math.round(r * 0.17)}px ${FONT}`;
  c.fillText(g.title, cx, cy + r * 0.25);
  if (g.unit) { c.fillStyle = 'rgba(243,232,255,0.5)'; c.font = `${Math.round(r * 0.11)}px ${FONT}`; c.fillText(g.unit, cx, cy + r * 0.78); }
  c.fillStyle = CYAN; c.font = `bold ${Math.round(r * 0.22)}px ${FONT}`;
  c.shadowColor = CYAN; c.shadowBlur = 6;
  c.fillText(readout, cx, cy + r * 0.53);
  // needle
  const a = A0 + SWEEP * Math.max(-0.02, Math.min(1.02, v));
  c.shadowColor = MAGENTA; c.shadowBlur = 8;
  c.strokeStyle = MAGENTA; c.lineWidth = 2.6; c.lineCap = 'round';
  c.beginPath();
  c.moveTo(cx - Math.cos(a) * r * 0.14, cy - Math.sin(a) * r * 0.14);
  c.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12));
  c.stroke();
  c.shadowBlur = 0;
  const cap = c.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r * 0.1);
  cap.addColorStop(0, '#bdb8d0'); cap.addColorStop(1, '#1a1626');
  c.beginPath(); c.arc(cx, cy, r * 0.1, 0, Math.PI * 2); c.fillStyle = cap; c.fill();
  c.restore();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

type Band = 'X' | 'K' | 'Ka' | 'LASER';
const BANDS: Band[] = ['X', 'K', 'Ka', 'LASER'];
const BAND_FREQ: Record<Band, string> = { X: '10.525', K: '24.150', Ka: '34.700', LASER: 'LASER' };

export class Dash {
  private gaugesCtx: CanvasRenderingContext2D;
  private tachCtx: CanvasRenderingContext2D;
  private radarCtx: CanvasRenderingContext2D;
  private mapCtx: CanvasRenderingContext2D;
  private panels: Record<'bars' | 'tach' | 'radar' | 'map', HTMLElement>;
  private heat = new Needle();
  private nos = new Needle();
  private tach = new Needle();
  // radar detector: target and shown level per band, and per direction
  private bandHit: Record<Band, number> = { X: 0, K: 0, Ka: 0, LASER: 0 };
  private bandLit: Record<Band, number> = { X: 0, K: 0, Ka: 0, LASER: 0 };
  private dirHit = { front: 0, side: 0, rear: 0 };
  private dirLit = { front: 0, side: 0, rear: 0 };
  private shownBand: Band | null = null;
  private shownFor = 0;
  private readout = 0;
  // sat nav: cross streets named after DNS lookups
  private names: string[] = ['NEON AVE', 'SHIBUYA ST', 'DOCK RD'];
  private streets = new Map<number, string>();
  private t = 0;

  constructor() {
    const bars = document.getElementById('hud-bars')!;
    const tach = document.getElementById('scope-wrap')!;
    const radar = document.getElementById('radar-wrap')!;
    const map = document.getElementById('hud-topleft')!;
    this.panels = { bars, tach, radar, map };
    this.gaugesCtx = hidpi(bars, 276, 142, 'dash-gauges');
    this.tachCtx = hidpi(tach, 220, 132, 'dash-tach', document.getElementById('rate'));
    this.radarCtx = hidpi(radar, 212, 80, 'dash-radar');
    this.mapCtx = hidpi(map, 212, 164, 'dash-map');
  }

  /** Every event the theme sees: the detector picks up a band for its kind. */
  event(se: SceneEvent): void {
    const band: Band | null = se.kind === 'threat' ? 'LASER' : se.kind === 'block' ? 'Ka'
      : se.kind === 'allow' ? 'K' : se.kind === 'dns' || se.kind === 'wifi' || se.kind === 'dhcp' ? 'X' : null;
    if (band) this.bandHit[band] = Math.min(1, this.bandHit[band] + (band === 'LASER' ? 0.6 : band === 'Ka' ? 0.22 : band === 'K' ? 0.05 : 0.12));
    const dir = se.scope === 'inbound' ? 'rear' : se.scope === 'outbound' ? 'front' : 'side';
    this.dirHit[dir] = Math.min(1, this.dirHit[dir] + 0.08);
    if (se.kind === 'dns' && se.ev.dns_query) {
      const name = se.ev.dns_query.replace(/^www\./, '').toUpperCase().slice(0, 18);
      if (!this.names.includes(name)) { this.names.push(name); if (this.names.length > 24) this.names.shift(); }
    }
  }

  update(dt: number, d: DashInfo, police: boolean): void {
    this.t += dt;
    const shown = (el: HTMLElement) => el.style.display !== 'none';
    if (shown(this.panels.bars)) this.drawGauges(dt, d);
    if (shown(this.panels.tach)) this.drawTach(dt, d);
    if (shown(this.panels.radar)) this.drawRadar(dt, police);
    if (shown(this.panels.map)) this.drawMap(d);
  }

  // ── HEAT and NOS ──
  private drawGauges(dt: number, d: DashInfo): void {
    const c = this.gaugesCtx;
    c.clearRect(0, 0, 276, 142);
    const heat = this.heat.step(d.state.threat, dt);
    gauge(c, 69, 71, 66, heat, {
      min: 0, max: 100, major: 25, minor: 5, red: [75, 100],
      label: (v) => (v === 0 ? 'C' : v === 100 ? 'H' : v === 50 ? '½' : ''), title: 'HEAT', unit: 'COOLANT',
    }, `${Math.round(d.state.threat * 100)}°`, d.state.threat > 0.75 ? d.state.threat : 0);
    const psi = d.state.energy * 1500;
    const nos = this.nos.step(d.state.energy, dt);
    gauge(c, 207, 71, 66, nos, {
      min: 0, max: 1500, major: 500, minor: 100, band: [900, 1100],
      label: (v) => String(v / 100), title: 'NOS', unit: 'PSI ×100',
    }, `${Math.round(psi)}`, d.nitro);
  }

  // ── TACH ──
  private gear = 1;
  private drawTach(dt: number, d: DashInfo): void {
    const c = this.tachCtx;
    c.clearRect(0, 0, 220, 132);
    const v = d.speed;
    while (this.gear < GEARS.length - 1 && v > GEARS[this.gear]) this.gear++;
    while (this.gear > 1 && v < GEARS[this.gear - 1] * 0.92) this.gear--;
    const lo = GEARS[this.gear - 1], hi = GEARS[this.gear];
    const rev = Math.max(0, Math.min(1, (v - lo) / Math.max(1, hi - lo)));
    const rpm = 1.4 + rev * 5.6 + d.nitro * 0.5;
    const needle = this.tach.step(rpm / 9, dt);
    gauge(c, 66, 66, 62, needle, {
      min: 0, max: 9, major: 1, minor: 0.5, red: [7, 9],
      label: (x) => String(x), title: 'RPM', unit: '×1000',
    }, `${(rpm * 1000 / 100 | 0) * 100}`, rpm > 7 ? 1 : 0);
    // digital speedo and gear
    c.textAlign = 'right'; c.textBaseline = 'alphabetic';
    c.shadowColor = CYAN; c.shadowBlur = 10; c.fillStyle = CYAN;
    c.font = `bold 40px ${FONT}`;
    c.fillText(String(Math.round(v * 2.237)), 214, 58);
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(243,232,255,0.6)'; c.font = `12px ${FONT}`;
    c.fillText('MPH', 214, 74);
    roundRect(c, 150, 86, 34, 38, 5);
    c.fillStyle = '#07060d'; c.fill();
    c.strokeStyle = 'rgba(255,63,180,0.6)'; c.lineWidth = 1.5; c.stroke();
    c.textAlign = 'center'; c.fillStyle = MAGENTA; c.shadowColor = MAGENTA; c.shadowBlur = 8;
    c.font = `bold 28px ${FONT}`;
    c.fillText(String(this.gear), 167, 116);
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(243,232,255,0.5)'; c.font = `10px ${FONT}`; c.textAlign = 'left';
    c.fillText('GEAR', 190, 110);
  }

  // ── RADAR DETECTOR ──
  private drawRadar(dt: number, police: boolean): void {
    const c = this.radarCtx, W = 212, H = 80;
    const fall = Math.exp(-dt * 0.9);
    for (const b of BANDS) {
      if (b === 'LASER' && police) this.bandHit.LASER = Math.max(this.bandHit.LASER, 0.85);
      this.bandHit[b] *= fall;
      this.bandLit[b] += (this.bandHit[b] - this.bandLit[b]) * Math.min(1, dt * 4);
    }
    for (const k of ['front', 'side', 'rear'] as const) {
      this.dirHit[k] *= fall;
      this.dirLit[k] += (Math.min(1, this.dirHit[k]) - this.dirLit[k]) * Math.min(1, dt * 3);
    }
    // the display holds the strongest band for a moment before switching (no flicker between bands)
    let top: Band | null = null;
    for (const b of BANDS) if (this.bandLit[b] > 0.12 && (!top || this.bandLit[b] * (b === 'LASER' ? 2 : 1) > this.bandLit[top] * (top === 'LASER' ? 2 : 1))) top = b;
    this.shownFor += dt;
    if (top !== this.shownBand && (this.shownFor > 1.2 || !this.shownBand)) { this.shownBand = top; this.shownFor = 0; }
    const strength = this.shownBand ? this.bandLit[this.shownBand] : 0;
    this.readout += ((this.shownBand ? 1 : 0) - this.readout) * Math.min(1, dt * 3);

    c.clearRect(0, 0, W, H);
    // the unit: a black plastic box with a bevel
    roundRect(c, 1, 1, W - 2, H - 2, 9);
    const body = c.createLinearGradient(0, 0, 0, H);
    body.addColorStop(0, '#2a2733'); body.addColorStop(0.12, '#141219'); body.addColorStop(1, '#060509');
    c.fillStyle = body; c.fill();
    c.strokeStyle = '#3a3646'; c.lineWidth = 1; c.stroke();
    // display window
    roundRect(c, 10, 9, 118, 38, 4);
    c.fillStyle = '#140205'; c.fill();
    c.strokeStyle = '#000'; c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'middle';
    const red = (a: number) => `rgba(255,${40 + a * 30},${50 + a * 20},${a})`;
    if (this.readout > 0.02 && this.shownBand) {
      const a = Math.min(1, 0.25 + strength * 0.9) * this.readout;
      c.shadowColor = '#ff2e3c'; c.shadowBlur = 10 * a;
      c.fillStyle = red(a);
      c.font = `bold 17px ${FONT}`;
      const b = this.shownBand;
      c.fillText(b === 'LASER' ? 'LASER' : b, 16, 28);
      if (b !== 'LASER') { c.font = `bold 13px ${FONT}`; c.fillText(BAND_FREQ[b], 58, 29); }
      c.shadowBlur = 0;
    }
    c.fillStyle = red(0.22 * (1 - this.readout) + 0.05);
    c.font = `bold 15px ${FONT}`;
    if (this.readout < 0.98) { c.globalAlpha = 1 - this.readout; c.fillText('SCAN · · ·', 16, 28); c.globalAlpha = 1; }
    // band lamps
    c.font = `bold 10px ${FONT}`;
    BANDS.forEach((b, i) => {
      const x = 14 + i * 29, lit = Math.min(1, this.bandLit[b] * 1.6);
      c.beginPath(); c.arc(x + 2, 62, 3, 0, Math.PI * 2);
      c.fillStyle = `rgba(255,60,70,${0.12 + lit * 0.88})`;
      c.shadowColor = '#ff2e3c'; c.shadowBlur = lit * 8; c.fill(); c.shadowBlur = 0;
      c.fillStyle = `rgba(243,232,255,${0.35 + lit * 0.5})`;
      c.fillText(b === 'LASER' ? 'LSR' : b, x + 8, 62);
    });
    // arrows
    const arrow = (cx: number, cy: number, dir: 'front' | 'side' | 'rear') => {
      const a = this.dirLit[dir], s = 7;
      c.beginPath();
      if (dir === 'front') { c.moveTo(cx, cy - s); c.lineTo(cx + s, cy + s * 0.6); c.lineTo(cx - s, cy + s * 0.6); }
      else if (dir === 'rear') { c.moveTo(cx, cy + s); c.lineTo(cx + s, cy - s * 0.6); c.lineTo(cx - s, cy - s * 0.6); }
      else { c.moveTo(cx - s, cy); c.lineTo(cx, cy - s * 0.7); c.lineTo(cx + s, cy); c.lineTo(cx, cy + s * 0.7); }
      c.closePath();
      c.fillStyle = `rgba(255,60,70,${0.1 + a * 0.9})`;
      c.shadowColor = '#ff2e3c'; c.shadowBlur = a * 8; c.fill(); c.shadowBlur = 0;
    };
    arrow(146, 18, 'front'); arrow(146, 40, 'side'); arrow(146, 62, 'rear');
    // signal strength: eight segments
    for (let k = 0; k < 8; k++) {
      const on = Math.max(0, Math.min(1, strength * 9 - k));
      const y = 66 - k * 7.4;
      c.fillStyle = k > 5 ? `rgba(255,60,70,${0.1 + on * 0.9})` : k > 2 ? `rgba(255,184,64,${0.1 + on * 0.9})` : `rgba(92,230,164,${0.1 + on * 0.9})`;
      c.fillRect(166, y, 34, 5);
    }
  }

  // ── SAT NAV ──
  private drawMap(d: DashInfo): void {
    const c = this.mapCtx, W = 212, H = 164;
    const S = 1.25;                      // px per metre
    const carY = 128;
    const X = (x: number, z: number) => W / 2 + (x + bendAt(z).x) * S;
    const Y = (z: number) => carY + z * S;
    c.save();
    c.clearRect(0, 0, W, H);
    roundRect(c, 0, 0, W, H, 8);
    c.fillStyle = '#0a0918'; c.fill();
    c.clip();

    // city blocks on both sides, scrolling with the distance we've covered
    const BLOCK = 26, zTop = -(carY / S) - 10, zBot = (H - carY) / S + 10;
    const i0 = Math.floor((d.travelled + (-zBot)) / BLOCK), i1 = Math.ceil((d.travelled - zTop) / BLOCK);
    for (let i = i0; i <= i1; i++) {
      const z = -(i * BLOCK - d.travelled);
      for (const side of [-1, 1]) {
        const h = hashN(i * 2 + (side > 0 ? 1 : 0));
        if (streetAt(i)) continue;
        const depth = 16 + h * 30, gap = 4;
        const x0 = side < 0 ? -12 - depth : 12, x1 = side < 0 ? -12 : 12 + depth;
        c.fillStyle = h > 0.8 ? '#221a3a' : '#16142a';
        c.beginPath();
        c.moveTo(X(x0, z), Y(z)); c.lineTo(X(x1, z), Y(z));
        c.lineTo(X(x1, z - BLOCK + gap), Y(z - BLOCK + gap)); c.lineTo(X(x0, z - BLOCK + gap), Y(z - BLOCK + gap));
        c.closePath(); c.fill();
      }
    }
    // cross streets, named after recent lookups
    for (let i = i0; i <= i1; i++) {
      if (!streetAt(i)) continue;
      const z = -(i * BLOCK - d.travelled) - BLOCK / 2;
      let name = this.streets.get(i);
      if (!name) {
        name = this.names[(hashN(i + 99) * this.names.length) | 0];
        this.streets.set(i, name);
        if (this.streets.size > 40) this.streets.delete(this.streets.keys().next().value!);
      }
      c.strokeStyle = '#2b2546'; c.lineWidth = 9;
      c.beginPath(); c.moveTo(X(-120, z), Y(z)); c.lineTo(X(120, z), Y(z)); c.stroke();
      c.fillStyle = 'rgba(243,232,255,0.55)'; c.font = `9px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(name, X(14, z) + 2, Y(z));
    }

    // the road: our street, curbs in the city's neon
    const zs: number[] = [];
    for (let z = zBot; z >= zTop; z -= 4) zs.push(z);
    const edge = (x: number) => { c.beginPath(); zs.forEach((z, k) => (k ? c.lineTo(X(x, z), Y(z)) : c.moveTo(X(x, z), Y(z)))); };
    c.beginPath();
    zs.forEach((z, k) => (k ? c.lineTo(X(-8.5, z), Y(z)) : c.moveTo(X(-8.5, z), Y(z))));
    for (let k = zs.length - 1; k >= 0; k--) c.lineTo(X(8.5, zs[k]), Y(zs[k]));
    c.closePath(); c.fillStyle = '#2a2540'; c.fill();
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(255,63,180,0.8)'; edge(-8.5); c.stroke();
    c.strokeStyle = 'rgba(63,240,255,0.8)'; edge(8.5); c.stroke();
    c.setLineDash([3, 5]); c.lineDashOffset = -(d.travelled * S) % 8;
    c.strokeStyle = 'rgba(243,232,255,0.18)'; c.lineWidth = 0.8;
    for (const x of [-3.6, 0, 3.6]) { edge(x); c.stroke(); }
    c.setLineDash([]);

    // the route our driver is taking
    const m = d.map;
    c.shadowColor = CYAN; c.shadowBlur = 6;
    c.strokeStyle = 'rgba(63,240,255,0.75)'; c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(X(m.x, 0), Y(0));
    for (let z = -4; z >= zTop; z -= 4) {
      const k = Math.min(1, -z / 30);
      c.lineTo(X(m.x + (m.planX - m.x) * (k * k * (3 - 2 * k)), z), Y(z));
    }
    c.stroke();
    c.shadowBlur = 0;

    // gates, roadblocks, cars
    for (const g of m.gates) {
      if (g.z < zTop || g.z > zBot) continue;
      c.strokeStyle = g.good ? 'rgba(192,140,255,0.95)' : 'rgba(192,140,255,0.35)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(X(-10, g.z), Y(g.z)); c.lineTo(X(10, g.z), Y(g.z)); c.stroke();
    }
    for (const b of m.blocks) {
      if (b.z < zTop || b.z > zBot) continue;
      c.fillStyle = '#ff6b6b';
      for (const x of b.xs) c.fillRect(X(x, b.z) - 4, Y(b.z) - 1.5, 8, 3);
    }
    for (const car of m.cars) {
      if (car.z < zTop || car.z > zBot) continue;
      let col = 'rgba(92,230,164,0.85)';
      if (car.crashed) col = 'rgba(125,106,138,0.9)';
      else if (car.kind === 'rival') col = '#ffd84d';
      else if (car.kind === 'police') {
        const k = 0.5 + 0.5 * Math.sin(car.age * 3.2);                      // the same slow sway as the light bar
        col = `rgb(${Math.round(60 + 195 * k)},${Math.round(60 * (1 - k) + 30)},${Math.round(60 + 195 * (1 - k))})`;
      }
      c.fillStyle = col;
      c.fillRect(X(car.x, car.z) - 2.2, Y(car.z) - 4, 4.4, 8);
    }
    // us: a glowing arrow
    const px = X(m.x, 0), py = Y(0);
    c.shadowColor = CYAN; c.shadowBlur = 10;
    c.fillStyle = CYAN;
    c.beginPath(); c.moveTo(px, py - 7); c.lineTo(px + 5, py + 5); c.lineTo(px, py + 2.5); c.lineTo(px - 5, py + 5); c.closePath(); c.fill();
    c.shadowBlur = 0;

    // top strip: what's next
    const nextGate = m.gates.filter((g) => g.z < -2).sort((a, b) => b.z - a.z)[0];
    const nextBlock = m.blocks.filter((b) => b.z < -2).sort((a, b) => b.z - a.z)[0];
    c.fillStyle = 'rgba(5,4,11,0.72)'; c.fillRect(0, 0, W, 18);
    c.textBaseline = 'middle'; c.font = `bold 10px ${FONT}`; c.textAlign = 'left';
    if (nextGate) {
      c.fillStyle = '#c08cff';
      c.fillText(`▲ ${nextGate.name.slice(0, 14)}  ${Math.round(-nextGate.z)} M`, 6, 9.5);
    } else if (nextBlock) {
      c.fillStyle = '#ff6b6b';
      c.fillText(`▲ ROADBLOCK  ${Math.round(-nextBlock.z)} M`, 6, 9.5);
    } else {
      c.fillStyle = 'rgba(243,232,255,0.6)';
      c.fillText('▲ CLEAR ROAD', 6, 9.5);
    }
    // bottom: conditions
    const w = d.state.weather;
    const wx = d.weather[w];
    c.font = `bold 10px ${FONT}`;
    const tw = c.measureText(wx).width + 12;
    roundRect(c, 6, H - 20, tw, 14, 4);
    c.fillStyle = 'rgba(5,4,11,0.75)'; c.fill();
    c.fillStyle = w === 'hurricane' ? '#ff5a5a' : w === 'storm' ? '#ffd24a' : '#45ff9b';
    c.textAlign = 'left'; c.fillText(wx, 12, H - 12.5);
    c.textAlign = 'right'; c.fillStyle = 'rgba(243,232,255,0.55)';
    c.fillText(`${(d.travelled / 1609).toFixed(1)} MI`, W - 6, H - 12.5);
    c.restore();
    // the frame
    roundRect(c, 0.5, 0.5, W - 1, H - 1, 8);
    c.strokeStyle = 'rgba(63,240,255,0.35)'; c.lineWidth = 1; c.stroke();
  }
}

function hashN(n: number): number {
  let h = 2166136261 ^ n;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Every so often a block is a cross street instead. */
function streetAt(i: number): boolean { return hashN(i * 7 + 3) < 0.22; }
