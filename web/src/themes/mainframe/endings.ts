import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry, SRGBColorSpace, Vector3, type Object3D, type Scene, type Texture,
} from 'three';
import type { Chip } from './board';

/**
 * The pieces a dive's ending is built from. Inside the chip, red corruption
 * spreads over the die while the trace runs; then one of three endings
 * resolves it:
 *
 *   purge       ICE floods the buses and a cyan wave sweeps the corruption away;
 *               climbing out, a cyan shockwave rings across the board
 *   quarantine  blast doors drop across the buses and the intruder's traffic
 *               shatters against them; climbing out, firewall walls rise
 *               around the chip
 *   counter     a counter-strike launches back up the line, and the camera rides
 *               it out of the chip and away down the attacker's street
 *
 * Nothing here flashes: everything grows, drops or fades on an ease.
 */
export type Ending = 'purge' | 'quarantine' | 'counter';
export const ENDINGS: Ending[] = ['purge', 'quarantine', 'counter'];

const smooth = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpS = new Vector3(), tmpV = new Vector3();

/** Corrupted cells: a blotch of hot red blocks with a soft falloff. */
function corruptionTexture(): Texture {
  const N = 128, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.7) * N * 0.46;
    const x = N / 2 + Math.cos(a) * r, y = N / 2 + Math.sin(a) * r, k = 1 - r / (N * 0.46);
    const s = 3 + Math.floor(Math.random() * 6);
    g.fillStyle = `rgba(255,${Math.floor(40 + Math.random() * 60)},${Math.floor(20 + Math.random() * 30)},${(0.25 + k * 0.7).toFixed(2)})`;
    g.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, s, s);
  }
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,60,40,0.35)'); gr.addColorStop(1, 'rgba(255,60,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Seed { x: number; z: number; r: number; age: number; level: number; purge: number; }

/** Red corruption blooming across the die, which the ending then contains, drains or purges. */
export class Corruption {
  private mesh: InstancedMesh;
  private seeds: Seed[] = [];
  private col = new Color();
  private wave: { x: number; z: number; r: number; speed: number } | null = null;
  private mode: 'grow' | 'contained' | 'drain' = 'grow';
  private drainT = 0;
  private readonly red = new Color(0xff3a2a);
  private readonly clean = new Color(0x7ef3ff);

  constructor(private scene: Scene) {
    const mat = new MeshBasicMaterial({ map: corruptionTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, 80);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  reset(): void { this.seeds = []; this.wave = null; this.mode = 'grow'; this.drainT = 0; this.mesh.count = 0; }

  seed(x: number, z: number): void {
    if (this.mode !== 'grow' || this.seeds.length >= 80) return;
    this.seeds.push({ x, z, r: 12 + Math.random() * 22, age: 0, level: 0, purge: 0 });
  }

  /** A purge wave spreading from (x, z) at `speed`: corruption it reaches turns clean and fades. */
  purgeFrom(x: number, z: number, speed: number): void { this.wave = { x, z, r: 0, speed }; }
  contain(): void { this.mode = 'contained'; }
  drain(): void { this.mode = 'drain'; this.drainT = 0; }

  update(dt: number): void {
    if (this.wave) this.wave.r += this.wave.speed * dt;
    this.drainT += dt;
    let n = 0;
    for (const s of this.seeds) {
      s.age += dt;
      if (this.wave && s.purge === 0 && Math.hypot(s.x - this.wave.x, s.z - this.wave.z) < this.wave.r) s.purge = 0.0001;
      if (s.purge > 0) s.purge = Math.min(1, s.purge + dt * 0.9);
      const grow = this.mode === 'grow' ? smooth(s.age / 2.2) : Math.max(s.level, 0.01);
      let target = grow;
      if (this.mode === 'contained') target = 0.45;
      if (this.mode === 'drain') target = Math.max(0, 1 - this.drainT / 2.5 - Math.max(0, (s.z - this.minZ()) / 400));
      if (s.purge > 0) target = 1 - smooth(s.purge);
      s.level += (target - s.level) * Math.min(1, dt * 2.2);
      if (s.level < 0.004 && (s.purge >= 1 || this.mode === 'drain')) continue;
      const breathe = 1 + Math.sin(s.age * 1.3 + s.x) * 0.06;
      const r = s.r * (0.35 + 0.65 * smooth(s.age / 3)) * breathe * (1 + s.purge * 0.4);
      tmpM.compose(tmpV.set(s.x, 0.35, s.z), tmpQ.identity(), tmpS.set(r * 2, 1, r * 2));
      this.mesh.setMatrixAt(n, tmpM);
      this.col.copy(this.red).lerp(this.clean, smooth(s.purge * 2)).multiplyScalar(s.level * (this.mode === 'contained' ? 1.1 : 1.6));
      this.mesh.setColorAt(n, this.col);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private minZ(): number { let m = Infinity; for (const s of this.seeds) m = Math.min(m, s.z); return m; }
}

/**
 * The attacker's route catching fire where the counter-strike passes, then
 * cooling to nothing: short glowing segments laid along the route that light
 * up in order and fade from orange through red to dark.
 */
export class BurnLine {
  private mesh: InstancedMesh;
  private segs: Array<{ pos: Vector3; rot: number; arc: number; lit: number }> = [];
  private t = 0;
  private col = new Color();
  private readonly hot = new Color(0xffb347);
  private readonly ember = new Color(0xff3a1a);
  constructor(private scene: Scene, pts: Vector3[], step = 2.4, private width = 3.2) {
    let arc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = a.distanceTo(b);
      const rot = Math.atan2(b.x - a.x, b.z - a.z);
      for (let d = 0; d < len; d += step) {
        this.segs.push({ pos: a.clone().lerp(b, d / len).setY(0.3), rot, arc: arc + d, lit: -1 });
      }
      arc += len;
    }
    const tex = glowStrip();
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, this.segs.length);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  /** Everything up to this distance along the route is burning. */
  ignite(arc: number): void { for (const s of this.segs) if (s.lit < 0 && s.arc <= arc) s.lit = this.t; }
  get done(): boolean { return this.segs.every((s) => s.lit >= 0 && this.t - s.lit > 3.2); }
  update(dt: number): void {
    this.t += dt;
    let n = 0;
    for (const s of this.segs) {
      if (s.lit < 0) continue;
      const age = this.t - s.lit;
      if (age > 3.2) continue;
      // catches over a moment, then cools
      const heat = smooth(age / 0.18) * Math.exp(-Math.max(0, age - 0.18) / 0.9);
      tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), s.rot);
      tmpM.compose(s.pos, tmpQ, tmpS.set(this.width * (0.8 + heat * 0.5), 1, 3.2));
      this.mesh.setMatrixAt(n, tmpM);
      this.mesh.setColorAt(n, this.col.copy(this.ember).lerp(this.hot, heat).multiplyScalar(heat * 2.6));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    const m = this.mesh.material as MeshBasicMaterial;
    m.map?.dispose(); m.dispose();
  }
}

/** A soft bar of light, bright down the middle. */
function glowStrip(): Texture {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 32, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** An expanding ring on the floor: the purge wave inside, the shockwave on the board. */
export class Ripple {
  private rings: Array<{ mesh: Mesh; mat: MeshBasicMaterial; delay: number }> = [];
  private t = 0;
  constructor(private scene: Scene, x: number, z: number, color: Color, private maxR: number, private dur: number, count = 3) {
    for (let i = 0; i < count; i++) {
      const mat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(3.5), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false, opacity: 0 });
      const mesh = new Mesh(new RingGeometry(0.82, 1, 128).rotateX(-Math.PI / 2), mat);
      mesh.position.set(x, 0.4 + i * 0.02, z);
      mesh.scale.setScalar(0.01);
      scene.add(mesh);
      this.rings.push({ mesh, mat, delay: i * 0.28 });
    }
  }
  get done(): boolean { return this.t > this.dur + 0.28 * this.rings.length; }
  update(dt: number): void {
    this.t += dt;
    for (const r of this.rings) {
      const k = Math.max(0, Math.min(1, (this.t - r.delay) / this.dur));
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(0.01 + e * this.maxR);
      r.mat.opacity = k <= 0 ? 0 : Math.min(1, k * 6) * (1 - k) * 0.9;
    }
  }
  dispose(): void {
    for (const r of this.rings) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mat.dispose(); }
    this.rings = [];
  }
}

function hazardTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16161a'; g.fillRect(0, 0, 256, 128);
  g.save();
  g.beginPath(); g.rect(0, 70, 256, 58); g.clip();
  for (let x = -128; x < 300; x += 32) {
    g.fillStyle = '#ffc93a';
    g.beginPath(); g.moveTo(x, 128); g.lineTo(x + 16, 128); g.lineTo(x + 16 + 58, 70); g.lineTo(x + 58, 70); g.fill();
  }
  g.restore();
  g.fillStyle = '#ff3a2a'; g.fillRect(0, 0, 256, 8);
  g.fillStyle = 'rgba(255,90,70,0.9)'; g.font = "bold 30px 'Courier New', monospace"; g.textAlign = 'center';
  g.fillText('SEALED', 128, 48);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Blast doors dropping across the buses, one after another. */
export class BlastDoors {
  private doors: Array<{ group: Group; x: number; delay: number; landed: boolean }> = [];
  private mat: MeshStandardMaterial;
  private edge: MeshBasicMaterial;
  private geo = new BoxGeometry(1, 1, 1);
  private t = 0;
  onLand: (x: number, z: number) => void = () => {};
  constructor(private scene: Scene, xs: number[], private z: number) {
    const tex = hazardTexture();
    this.mat = new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.6 });
    this.edge = new MeshBasicMaterial({ color: new Color(0xff3a2a).multiplyScalar(2.5), toneMapped: false });
    xs.forEach((x, i) => {
      const group = new Group();
      const slab = new Mesh(this.geo, this.mat);
      slab.scale.set(16, 10, 1.6);
      slab.position.y = 5;
      const glow = new Mesh(this.geo, this.edge);
      glow.scale.set(16.4, 0.5, 1.8);
      glow.position.y = 10.1;
      group.add(slab, glow);
      group.position.set(x, 40, z);
      scene.add(group);
      this.doors.push({ group, x, delay: i * 0.24, landed: false });
    });
  }
  get landed(): boolean { return this.doors.every((d) => d.landed); }
  update(dt: number): void {
    this.t += dt;
    for (const d of this.doors) {
      const k = Math.max(0, Math.min(1, (this.t - d.delay) / 0.55));
      // falls under its own weight, then settles with a small bounce
      const fall = k * k;
      const bounce = k >= 1 ? Math.max(0, Math.sin(Math.min(1, (this.t - d.delay - 0.55) / 0.3) * Math.PI)) * 0.6 * Math.exp(-(this.t - d.delay - 0.55) * 6) : 0;
      d.group.position.y = 40 * (1 - fall) + bounce;
      if (k >= 1 && !d.landed) { d.landed = true; this.onLand(d.x, this.z); }
    }
  }
  dispose(): void {
    for (const d of this.doors) this.scene.remove(d.group);
    this.geo.dispose(); this.mat.map?.dispose(); this.mat.dispose(); this.edge.dispose();
    this.doors = [];
  }
}

function wallTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,80,60,1)'); gr.addColorStop(0.35, 'rgba(255,60,50,0.45)'); gr.addColorStop(1, 'rgba(255,60,50,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 128);
  g.fillStyle = 'rgba(255,200,180,0.35)';
  for (let y = 6; y < 128; y += 12) g.fillRect(0, y, 32, 1);
  return new CanvasTexture(c);
}

/** Firewall walls rising around a quarantined chip; they stay with its section of board. */
export class FirewallRing {
  private walls: Mesh[] = [];
  constructor(parent: Object3D, chip: Chip) {
    const mat = new MeshBasicMaterial({ map: wallTexture(), color: new Color(1.6, 1.6, 1.6), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    const w = chip.w + 7, d = chip.d + 7;
    for (const [x, z, len, rot] of [[0, -d / 2, w, 0], [0, d / 2, w, 0], [-w / 2, 0, d, Math.PI / 2], [w / 2, 0, d, Math.PI / 2]] as Array<[number, number, number, number]>) {
      const m = new Mesh(new PlaneGeometry(len, 1), mat);
      m.geometry.translate(0, 0.5, 0);
      m.position.set(chip.x + x, 0.2, chip.z + z);
      m.rotation.y = rot;
      m.scale.y = 0.01;
      parent.add(m);
      this.walls.push(m);
    }
  }
  rise(k: number): void { for (const m of this.walls) m.scale.y = 0.01 + smooth(k) * 7; }
}
