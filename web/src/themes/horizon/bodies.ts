import { Vector3, type Vector4 } from 'three';
import { hash01 } from '../../state';
import { bbColor } from './blackbody';
import { gravShift, omega } from './physics';
import type { Disk } from './disk';
import { MAX_GLOW, MAX_SPH, KNOT_SLOTS, type TracerUniforms } from './tracer';

/**
 * Everything that moves near the hole, simulated on the CPU and handed to the
 * tracer as uniforms (moons, glowing debris, jet knots) or splatted onto the
 * disk (hot spots, the debris stream of a shredded star). Every arrival and
 * departure eases: moons grow out of nothing and shrink away, glows fade in on
 * a sine, and things that fall in redden and dim as time stretches at the
 * horizon instead of vanishing.
 */

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const bell = (t: number) => { const s = Math.sin(Math.PI * Math.max(0, Math.min(1, t))); return s * s; };

export type MoonType = 0 | 1 | 2;
export interface Moon {
  name: string;
  labelled: boolean;
  r: number;
  axisA: Vector3;
  axisB: Vector3;
  phase: number;
  size: number;
  type: MoonType;
  color: [number, number, number];
  seed: number;
  spin: number;
  age: number;
  leaving: number;       // seconds since it started leaving (-1 = staying)
  lastSeen: number;
  pos: Vector3;
  grow: number;
}

export interface Infaller { ip: string; pos: Vector3; vel: Vector3; t: number; glow: number; gone: boolean; }
export interface Glint { label: string; a: Vector3; b: Vector3; ang: number; t: number; life: number; pos: Vector3; vel: Vector3; }
interface Hotspot { r: number; phi: number; t: number; life: number; drift: number; size: number; amount: number; heat: number; }
interface Knot { y: number; v: number; amp: number; t: number; }
interface Debris { x: number; z: number; vx: number; vz: number; t: number; life: number; w: number; }

export interface Tde {
  label: string;
  phase: 'approach' | 'shred' | 'done';
  pos: Vector3;
  vel: Vector3;
  t: number;
  shredAt: number;
  debris: Debris[];
  peri: Vector3;
}

const PALETTE: Record<MoonType, Array<[number, number, number]>> = {
  0: [[0.58, 0.52, 0.47], [0.66, 0.5, 0.4], [0.5, 0.5, 0.52]],
  1: [[0.78, 0.86, 0.95], [0.85, 0.9, 0.92], [0.7, 0.82, 0.9]],
  2: [[0.86, 0.72, 0.52], [0.6, 0.74, 0.82], [0.82, 0.62, 0.55]],
};

const GM_FALL = 520;
const GM_TDE = 320;

export class Bodies {
  moons: Moon[] = [];
  infallers: Infaller[] = [];
  glints: Glint[] = [];
  hotspots: Hotspot[] = [];
  knots: Knot[] = [];
  tde: Tde | null = null;
  /** How much a shredded star is feeding the disk, eased 0..1. */
  feed = 0;
  private feedTarget = 0;
  private feedHold = 0;
  maxMoons = 10;
  maxGlows = MAX_GLOW;
  maxSph = MAX_SPH;
  private time = 0;
  private tmp = new Vector3();
  onShred: (() => void) | null = null;
  onSwallow: ((ip: string) => void) | null = null;

  // ── moons (DHCP) ──
  moon(name: string, labelled: boolean, instant = false): Moon {
    const existing = this.moons.find((m) => m.name === name && m.leaving < 0);
    if (existing) { existing.lastSeen = this.time; return existing; }
    // a named device takes the place of an anonymous moon first
    if (labelled) {
      const anon = this.moons.find((m) => !m.labelled && m.leaving < 0);
      if (anon) anon.leaving = 0;
    }
    const h = (k: string) => hash01(`${name}|${k}`);
    const type = (h('t') < 0.45 ? 0 : h('t') < 0.75 ? 1 : 2) as MoonType;
    const pal = PALETTE[type];
    const node = h('n') * Math.PI * 2;
    const incl = (h('i') - 0.5) * 0.46;
    const A = new Vector3(Math.cos(node), 0, Math.sin(node));
    const N = new Vector3(0, 1, 0).applyAxisAngle(A, incl);
    const B = new Vector3().crossVectors(A, N).normalize();
    const m: Moon = {
      name, labelled,
      r: this.freeRadius(6.3 + h('r') * 8.4),
      axisA: A, axisB: B,
      phase: Math.random() * Math.PI * 2,
      size: 0.17 + h('s') * (type === 2 ? 0.26 : 0.16),
      type, color: pal[Math.floor(h('c') * pal.length) % pal.length],
      seed: h('seed') * 50,
      spin: (0.05 + h('spin') * 0.12) * (h('d') < 0.5 ? 1 : -1),
      age: instant ? 10 : 0, leaving: -1, lastSeen: this.time,
      pos: new Vector3(), grow: instant ? 1 : 0,
    };
    this.moons.push(m);
    this.retireExtra();
    return m;
  }

  /** Keep moons from sharing an orbit radius. */
  private freeRadius(want: number): number {
    let r = want;
    for (let tries = 0; tries < 12; tries++) {
      if (!this.moons.some((m) => m.leaving < 0 && Math.abs(m.r - r) < 0.75)) return r;
      r = 6.3 + ((r - 6.3 + 1.37) % 8.4);
    }
    return r;
  }

  private retireExtra(): void {
    const staying = this.moons.filter((m) => m.leaving < 0);
    let extra = staying.length - this.maxMoons;
    if (extra <= 0) return;
    // anonymous moons go first, then whoever was seen longest ago
    staying.sort((a, b) => Number(a.labelled) - Number(b.labelled) || a.lastSeen - b.lastSeen);
    for (const m of staying) { if (extra-- <= 0) break; m.leaving = 0; }
  }

  setMaxMoons(n: number): void { this.maxMoons = n; this.retireExtra(); }

  // ── infall (blocks) ──
  infall(ip: string, camPos: Vector3, camRight: Vector3, camUp: Vector3): Infaller | null {
    if (this.infallers.filter((f) => !f.gone).length >= 8) return null;
    const theta = hash01(ip) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const toHole = camPos.clone().multiplyScalar(-1).normalize();
    const side = camRight.clone().multiplyScalar(Math.cos(theta)).addScaledVector(camUp, Math.sin(theta) * 0.55);
    const pos = side.multiplyScalar(24).addScaledVector(toHole, 12 + Math.random() * 6);
    const inward = pos.clone().normalize().multiplyScalar(-3.2);
    const tang = new Vector3().crossVectors(pos, toHole).normalize().multiplyScalar((Math.random() - 0.5) * 3.2);
    const f: Infaller = { ip, pos, vel: inward.add(tang), t: 0, glow: 0, gone: false };
    this.infallers.push(f);
    return f;
  }

  // ── photon-ring glints (DNS) ──
  glint(label: string, camPos: Vector3): Glint | null {
    if (this.glints.length >= 4) return null;
    // orbit in the plane facing the camera: at r = 2.3 its direct image lands just
    // outside the shadow (b ≈ 3.06 vs 2.6) and its lensed image rides the photon ring
    const view = camPos.clone().normalize();
    const rnd = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const n = view.add(rnd.multiplyScalar(0.12)).normalize();
    const a = new Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    const b = new Vector3().crossVectors(n, a);
    const g: Glint = { label, a, b, ang: Math.random() * Math.PI * 2, t: 0, life: 3.6, pos: new Vector3(), vel: new Vector3() };
    this.glints.push(g);
    return g;
  }

  // ── hot spots on the disk (allowed traffic) ──
  hotspot(key: string, outbound: boolean, strength: number): void {
    if (this.hotspots.length > 260) return;
    const h = hash01(key);
    this.hotspots.push({
      r: outbound ? 3.35 + h * 3.2 : 7 + h * 4.5,
      phi: hash01(`${key}|a`) * Math.PI * 2 + Math.random() * 0.6,
      t: 0, life: 8 + Math.random() * 6,
      drift: outbound ? 0.004 : 0.012,
      size: 0.4 + Math.random() * 0.35,
      amount: (4.5 + Math.random() * 3) * strength,
      heat: (outbound ? 14 : 9) * strength,
    });
  }

  /** A bright knot shot up (north) or down (south) the jet. */
  knot(north: boolean, amp = 1): void {
    if (this.knots.length >= KNOT_SLOTS * 2) this.knots.shift();
    this.knots.push({ y: north ? 1.6 : -1.6, v: north ? 7 : -7, amp, t: 0 });
  }

  // ── tidal disruption (threats) ──
  tdeStart(label: string, camPos: Vector3): Tde | null {
    if (this.tde && this.tde.phase !== 'done') return null;
    // come in from the side of the frame, in the disk plane, a parabola with pericentre ~4.5
    const az = Math.atan2(camPos.z, camPos.x) + (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.5);
    const r0 = 34, rp = 4.6;
    const pos = new Vector3(Math.cos(az) * r0, 0.22, Math.sin(az) * r0);
    const v0 = Math.sqrt((2 * GM_TDE) / r0);
    const vt = Math.sqrt(2 * GM_TDE * rp) / r0;
    const vr = -Math.sqrt(Math.max(0, v0 * v0 - vt * vt));
    const radial = new Vector3(Math.cos(az), 0, Math.sin(az));
    const tang = new Vector3(-Math.sin(az), 0, Math.cos(az));   // prograde, like the disk
    const vel = radial.multiplyScalar(vr).addScaledVector(tang, vt);
    this.tde = { label, phase: 'approach', pos, vel, t: 0, shredAt: 0, debris: [], peri: new Vector3() };
    return this.tde;
  }

  get tdeActive(): boolean { return !!this.tde && this.tde.phase !== 'done'; }

  // ── step ──
  update(dt: number, disk: Disk): void {
    this.time += dt;

    for (const m of this.moons) {
      m.age += dt;
      m.phase += omega(m.r) * dt;
      if (m.leaving >= 0) m.leaving += dt;
      m.grow = m.leaving >= 0 ? 1 - smooth(m.leaving / 3.5) : smooth(m.age / 3.5);
      m.pos.copy(m.axisA).multiplyScalar(Math.cos(m.phase) * m.r).addScaledVector(m.axisB, Math.sin(m.phase) * m.r);
    }
    this.moons = this.moons.filter((m) => m.leaving < 3.6);

    for (const f of this.infallers) {
      f.t += dt;
      const r = f.pos.length();
      const g = gravShift(r);
      // time slows at the horizon: the fall stalls and fades rather than vanishing
      const slow = Math.pow(g, 1.6);
      const sub = 4;
      for (let k = 0; k < sub; k++) {
        const rr = Math.max(f.pos.length(), 1.05);
        const acc = f.pos.clone().multiplyScalar(-GM_FALL / (rr * rr * rr));
        f.vel.addScaledVector(acc, (dt * slow) / sub);
        f.pos.addScaledVector(f.vel, (dt * slow) / sub);
      }
      const intro = smooth(f.t / 1.2);
      f.glow = intro * Math.pow(g, 4);
      if (r < 1.02 || (f.t > 3 && f.glow < 0.004)) {
        if (!f.gone) this.onSwallow?.(f.ip);
        f.gone = true;
      }
    }
    this.infallers = this.infallers.filter((f) => !f.gone);

    for (const g of this.glints) {
      g.t += dt;
      g.ang += dt * (Math.PI * 2 / 2.4);
      const r = 2.3;
      g.pos.copy(g.a).multiplyScalar(Math.cos(g.ang) * r).addScaledVector(g.b, Math.sin(g.ang) * r);
      g.vel.copy(g.a).multiplyScalar(-Math.sin(g.ang)).addScaledVector(g.b, Math.cos(g.ang));
    }
    this.glints = this.glints.filter((g) => g.t < g.life);

    for (const s of this.hotspots) {
      s.t += dt;
      // a hot spot runs a little ahead of the gas around it, so it leaves a
      // glowing wake that the shear draws out into an arc
      s.phi += omega(s.r) * 1.6 * dt;
      s.r = Math.max(2.7, s.r - s.r * s.drift * dt);
      const env = bell(s.t / s.life);
      disk.splat(Math.cos(s.phi) * s.r, Math.sin(s.phi) * s.r, s.size, s.amount * env * 2.2, s.heat * env * 2.2, dt);
    }
    this.hotspots = this.hotspots.filter((s) => s.t < s.life);

    for (const k of this.knots) { k.t += dt; k.y += k.v * dt; }
    this.knots = this.knots.filter((k) => Math.abs(k.y) < 70);

    this.updateTde(dt, disk);
    if (this.feedHold > 0) this.feedHold -= dt; else this.feedTarget = 0;
    this.feed += (this.feedTarget - this.feed) * Math.min(1, dt / (this.feedTarget > this.feed ? 5 : 14));
  }

  private updateTde(dt: number, disk: Disk): void {
    const e = this.tde;
    if (!e) return;
    e.t += dt;
    if (e.phase === 'approach') {
      const sub = 6;
      for (let k = 0; k < sub; k++) {
        const r = Math.max(e.pos.length(), 2);
        const acc = e.pos.clone().multiplyScalar(-GM_TDE / (r * r * r));
        acc.y = 0;
        e.vel.addScaledVector(acc, dt / sub);
        e.pos.addScaledVector(e.vel, dt / sub);
      }
      const radialV = e.pos.dot(e.vel);
      if (radialV > 0 && e.pos.length() < 8) {
        // pericentre: the star comes apart into a stream; half of it is bound
        e.phase = 'shred';
        e.shredAt = e.t;
        e.peri.copy(e.pos);
        const n = 340;
        const dir = e.vel.clone().normalize();
        for (let i = 0; i < n; i++) {
          const eps = -0.2 + (i / (n - 1)) * 0.26;           // spread in orbital energy: mostly bound
          const along = (i / (n - 1) - 0.5) * 0.35;
          const x = e.pos.x + dir.x * along + (Math.random() - 0.5) * 0.05;
          const z = e.pos.z + dir.z * along + (Math.random() - 0.5) * 0.05;
          const sv = 1 + eps;
          e.debris.push({ x, z, vx: e.vel.x * sv, vz: e.vel.z * sv, t: -Math.random() * 0.6, life: 26 + Math.random() * 10, w: 0.7 + Math.random() * 0.6 });
        }
        this.feedTarget = 1;
        this.feedHold = 34;
        this.onShred?.();
      }
    } else if (e.phase === 'shred') {
      // the star's remains drift on, fading
      e.pos.addScaledVector(e.vel, dt * 0.6);
      const sub = 3;
      let alive = 0;
      for (const d of e.debris) {
        d.t += dt;
        if (d.t > d.life) continue;
        for (let k = 0; k < sub; k++) {
          const r = Math.max(Math.hypot(d.x, d.z), 1.5);
          const a = -GM_TDE / (r * r * r);
          // a little drag: the stream settles into the disk instead of orbiting for ever
          d.vx += (d.x * a - d.vx * 0.05) * (dt / sub);
          d.vz += (d.z * a - d.vz * 0.05) * (dt / sub);
          d.x += d.vx * (dt / sub);
          d.z += d.vz * (dt / sub);
        }
        const r = Math.hypot(d.x, d.z);
        if (r < 2.6 || r > 30) { d.t = d.life + 1; continue; }
        alive++;
        if (d.t < 0) continue;
        const env = smooth(d.t / 1.4) * (1 - smooth((d.t - d.life + 8) / 8));
        disk.splat(d.x, d.z, 0.32, 4.5 * env * d.w, 6 * env * d.w, dt);
      }
      if (alive === 0 && e.t - e.shredAt > 6) e.phase = 'done';
    } else if (e.t - e.shredAt > 60) {
      this.tde = null;
    }
  }

  /** The star's glow while it lasts: 1 on approach, fading as it comes apart. */
  starGlow(): number {
    const e = this.tde;
    if (!e) return 0;
    if (e.phase === 'approach') return smooth(e.t / 2.5);
    if (e.phase === 'shred') return 1 - smooth((e.t - e.shredAt) / 3);
    return 0;
  }

  /** Pack moons, glows and knots into the tracer's uniform arrays. */
  pack(u: TracerUniforms, time: number): void {
    let n = 0;
    const sph = u.uSph.value, col = u.uSphCol.value, rot = u.uSphRot.value;
    for (const m of this.moons) {
      if (n >= Math.min(MAX_SPH, this.maxSph)) break;
      if (m.grow <= 0.002) continue;
      sph[n].set(m.pos.x, m.pos.y, m.pos.z, m.size * m.grow);
      col[n].set(m.color[0], m.color[1], m.color[2], m.type);
      rot[n].set(time * m.spin + m.seed, m.seed, 1, 0);
      n++;
    }
    u.uSphN.value = n;

    let g = 0;
    const gl = u.uGlow.value, ax = u.uGlowAx.value, gc = u.uGlowCol.value;
    const cap = Math.min(MAX_GLOW, this.maxGlows);
    const put = (p: Vector3, sigma: number, axis: Vector3, stretch: number, rgb: [number, number, number], k: number) => {
      if (g >= cap || k <= 0.0005) return;
      gl[g].set(p.x, p.y, p.z, sigma);
      const len = axis.length() || 1;
      ax[g].set(axis.x / len, axis.y / len, axis.z / len, Math.max(1, stretch));
      gc[g].set(rgb[0] * k, rgb[1] * k, rgb[2] * k, 0);
      g++;
    };

    const e = this.tde;
    const sg = this.starGlow();
    if (e && sg > 0) {
      const r = e.pos.length();
      const tidal = e.phase === 'approach' ? smooth((9 - r) / 4.5) : 1;
      const shredT = e.phase === 'shred' ? smooth((e.t - e.shredAt) / 3) : 0;
      put(e.pos, 0.3 * (1 + shredT * 0.5), e.vel, 1 + tidal * 2.5 + shredT * 5, bbColor(5200), 4.5 * sg);
    }
    for (const f of this.infallers) {
      // a small hot head and a fainter tail drawn out behind it
      const r = f.pos.length();
      const col = bbColor(8500 * Math.max(gravShift(r), 0.12));
      const speed = f.vel.length();
      const tailLen = Math.min(2.2, 0.25 + speed * 0.07);
      this.tmp.copy(f.vel).normalize().multiplyScalar(-tailLen * 0.55).add(f.pos);
      put(f.pos, 0.1, f.vel, 1.4, col, 0.7 * f.glow);
      put(this.tmp, 0.07, f.vel, 1 + tailLen / 0.07 * 0.5, col, 0.3 * f.glow);
    }
    for (const s of this.glints) {
      put(s.pos, 0.09, s.vel, 3, bbColor(13000), 7 * bell(s.t / s.life));
    }
    u.uGlowN.value = g;

    const kn = u.uKnots.value as Vector4[];
    for (let i = 0; i < KNOT_SLOTS; i++) {
      const a = this.knots[i * 2], b = this.knots[i * 2 + 1];
      const ka = a ? smooth(a.t / 1.2) * Math.exp(-a.t / 7) * a.amp : 0;
      const kb = b ? smooth(b.t / 1.2) * Math.exp(-b.t / 7) * b.amp : 0;
      kn[i].set(a ? a.y : 999, ka, b ? b.y : 999, kb);
    }
  }

  counts(): Record<string, number> {
    return {
      moons: this.moons.length, infall: this.infallers.length, glints: this.glints.length,
      hotspots: this.hotspots.length, debris: this.tde?.debris.length ?? 0,
    };
  }
}
