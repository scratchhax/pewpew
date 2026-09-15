import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group,
  HemisphereLight, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry,
  PointLight, RepeatWrapping, RingGeometry, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace,
  Vector3, type Texture,
} from 'three';
import { glowTexture } from './orbit';

/**
 * The close-up: a small scene built in code for each surveillance vignette,
 * seen from high above at a slight tilt, like a satellite or a drone would.
 * From up there a person is shoulders, a head and a walk cycle, so simple
 * figures read as people. Everything carries a heat value for thermal imaging.
 */

export type ViewMode = 'day' | 'night' | 'thermal';

export interface Tracked {
  label: string;
  kind: 'subject' | 'vehicle' | 'object';
  obj: Object3D;
  /** Seconds (script time) before the box can lock on. */
  from?: number;
}

export interface Script {
  /** Script time in seconds (starts when the enhance begins). */
  update(t: number, dt: number): void;
  focus: Vector3;
  tracked: Tracked[];
}

export interface Vignette {
  id: string;
  /** The dossier's ACTIVITY line. */
  activity: string;
  nightOnly: boolean;
  tilt: number;          // camera tilt from straight down (radians)
  yaw: number;           // camera heading around the focus
  height: number;        // camera height when fully zoomed
  build(k: Kit): Script;
}

// ── keyframes ────────────────────────────────────────────────────────────────
export type Key = [number, ...number[]];
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Sample a keyframe track at t (eased between keys, held past the ends). */
export function sample(keys: Key[], t: number, out: number[] = []): number[] {
  const n = keys[0].length - 1;
  if (t <= keys[0][0]) { for (let i = 0; i < n; i++) out[i] = keys[0][i + 1]; return out; }
  const last = keys[keys.length - 1];
  if (t >= last[0]) { for (let i = 0; i < n; i++) out[i] = last[i + 1]; return out; }
  let k = 0;
  while (k < keys.length - 2 && t > keys[k + 1][0]) k++;
  const a = keys[k], b = keys[k + 1];
  const u = smooth((t - a[0]) / Math.max(1e-6, b[0] - a[0]));
  for (let i = 0; i < n; i++) out[i] = a[i + 1] + (b[i + 1] - a[i + 1]) * u;
  return out;
}

/** Linear sample (constant speed between keys): for vehicles and runs. */
export function sampleLinear(keys: Key[], t: number, out: number[] = []): number[] {
  const n = keys[0].length - 1;
  if (t <= keys[0][0]) { for (let i = 0; i < n; i++) out[i] = keys[0][i + 1]; return out; }
  const last = keys[keys.length - 1];
  if (t >= last[0]) { for (let i = 0; i < n; i++) out[i] = last[i + 1]; return out; }
  let k = 0;
  while (k < keys.length - 2 && t > keys[k + 1][0]) k++;
  const a = keys[k], b = keys[k + 1];
  const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  for (let i = 0; i < n; i++) out[i] = a[i + 1] + (b[i + 1] - a[i + 1]) * u;
  return out;
}

const heatOf = (o: Object3D, h: number) => { o.userData.heat = h; return o; };

// ── people ───────────────────────────────────────────────────────────────────
export interface Pose { crouch?: number; reach?: number; armUp?: number; carry?: number; climb?: number; throwArm?: number; lookAt?: number; }

export class Figure {
  readonly root = new Group();
  private hips = new Group();
  private torso: Mesh;
  private head: Mesh;
  private legL = new Group(); private legR = new Group();
  private armL = new Group(); private armR = new Group();
  readonly hand = new Group();          // right hand: attach props here
  readonly handL = new Group();
  private phase = Math.random() * 6;
  private last = new Vector3(NaN, 0, 0);
  heading = 0;
  private pose: Required<Pose> = { crouch: 0, reach: 0, armUp: 0, carry: 0, climb: 0, throwArm: 0, lookAt: 0 };
  private speed = 0;

  constructor(k: Kit, coat: number, skin = 0xc79a7a, legsCol = 0x22252c) {
    const coatM = k.mat(coat, 0.9), skinM = k.mat(skin, 0.8), legM = k.mat(legsCol, 0.9), hair = k.mat(0x1a1512, 0.9);
    this.torso = k.mesh(new BoxGeometry(0.46, 0.62, 0.26), coatM, 0.92);
    this.torso.position.y = 0.34;
    this.head = k.mesh(new SphereGeometry(0.13, 12, 10), skinM, 1);
    this.head.position.y = 0.8;
    const cap = k.mesh(new SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0.9);
    cap.position.y = 0.815;
    this.hips.position.y = 0.92;
    this.hips.add(this.torso, this.head, cap);
    for (const [leg, x] of [[this.legL, -0.11], [this.legR, 0.11]] as const) {
      const m = k.mesh(new BoxGeometry(0.16, 0.9, 0.18), legM, 0.85);
      m.position.y = -0.45;
      leg.add(m);
      leg.position.set(x, 0, 0);
      this.hips.add(leg);
    }
    for (const [arm, x] of [[this.armL, -0.3], [this.armR, 0.3]] as const) {
      const m = k.mesh(new BoxGeometry(0.11, 0.62, 0.12), coatM, 0.9);
      m.position.y = -0.31;
      arm.add(m);
      arm.position.set(x, 0.6, 0);
      this.hips.add(arm);
    }
    this.hand.position.y = -0.62; this.armR.add(this.hand);
    this.handL.position.y = -0.62; this.armL.add(this.handL);
    this.root.add(this.hips);
    for (const o of this.root.children) o.castShadow = true;
    k.scene.add(this.root);
  }

  /** Place the figure (world x, y, z) and pose it; walking and turning come from the motion. */
  set(x: number, y: number, z: number, dt: number, pose: Pose = {}, face?: number): void {
    const moved = Number.isNaN(this.last.x) ? 0 : Math.hypot(x - this.last.x, z - this.last.z);
    const sp = dt > 0 ? moved / dt : 0;
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    if (face !== undefined) this.heading = turn(this.heading, face, dt * 5);
    else if (moved > dt * 0.25) this.heading = turn(this.heading, Math.atan2(x - this.last.x, z - this.last.z), dt * 6);
    this.last.set(x, y, z);
    this.root.position.set(x, y, z);
    this.root.rotation.y = this.heading;
    for (const key of Object.keys(this.pose) as Array<keyof Pose>) {
      this.pose[key] += ((pose[key] ?? 0) - this.pose[key]) * Math.min(1, dt * 6);
    }
    const p = this.pose;
    const gait = Math.min(1.6, this.speed / 1.5);
    this.phase += moved * (this.speed > 2.6 ? 2.6 : 3.4);
    const swing = Math.sin(this.phase) * 0.55 * Math.min(1, gait);
    const run = Math.max(0, Math.min(1, (this.speed - 2.4) / 1.5));
    const c = p.crouch;
    this.hips.position.y = 0.92 - c * 0.38 + Math.abs(Math.cos(this.phase)) * 0.03 * gait;
    this.hips.rotation.x = run * 0.25 + c * 0.35;
    this.legL.rotation.x = swing * (1 + run * 0.5) - c * 1.1;
    this.legR.rotation.x = -swing * (1 + run * 0.5) - c * 1.1;
    const armSwing = -swing * 0.8 * (1 - p.carry) * (1 - p.climb);
    const climbA = Math.sin(this.phase * 1.3 + this.root.position.y * 3) * 0.5;
    this.armL.rotation.x = armSwing * 1.0 - p.carry * 1.25 - p.climb * (2.6 + climbA);
    this.armR.rotation.x = -armSwing * 1.0 - p.carry * 1.25 - p.reach * 1.45 - p.armUp * 2.9 - p.climb * (2.6 - climbA)
      - p.throwArm * 2.6;
    this.armR.rotation.z = p.armUp * 0.25;
    this.head.rotation.y = p.lookAt;
  }

  get visible(): boolean { return this.root.visible; }
  set visible(v: boolean) { this.root.visible = v; }
}

function turn(a: number, b: number, k: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * Math.min(1, k);
}

// ── vehicles ─────────────────────────────────────────────────────────────────
export class Car {
  readonly root = new Group();
  heading = 0;
  private last = new Vector3(NaN, 0, 0);
  private headlights: Mesh[] = [];
  private beams: Mesh[] = [];
  readonly doors: Group[] = [];
  lights = false;

  constructor(k: Kit, color: number, opts: { van?: boolean; patrol?: boolean; lights?: boolean } = {}) {
    const L = opts.van ? 5.4 : 4.5, W = opts.van ? 2.1 : 1.85, H = opts.van ? 2.2 : 0.8;
    const body = k.mesh(new BoxGeometry(W, H, L), k.mat(color, 0.45, 0.35), 0.42);
    body.position.y = 0.3 + H / 2;
    const glass = k.mat(0x0b0f14, 0.15, 0.6);
    this.root.add(body);
    if (!opts.van) {
      const cabin = k.mesh(new BoxGeometry(W * 0.86, 0.55, L * 0.5), glass, 0.4);
      cabin.position.set(0, 0.3 + H + 0.27, -0.2);
      const roof = k.mesh(new BoxGeometry(W * 0.8, 0.06, L * 0.36), k.mat(color, 0.45, 0.35), 0.45);
      roof.position.set(0, 0.3 + H + 0.56, -0.25);
      this.root.add(cabin, roof);
    } else {
      const wind = k.mesh(new BoxGeometry(W * 0.9, 0.7, 0.1), glass, 0.4);
      wind.position.set(0, 1.9, L / 2 - 0.9);
      this.root.add(wind);
      // rear doors, hinged at the corners
      for (const side of [-1, 1]) {
        const hinge = new Group();
        hinge.position.set(side * W / 2, 0.3, -L / 2 - 0.01);
        const d = k.mesh(new BoxGeometry(W / 2, H * 0.92, 0.06), k.mat(color, 0.5, 0.3), 0.5);
        d.position.set(-side * W / 4, H / 2, 0);
        hinge.add(d);
        this.root.add(hinge);
        this.doors.push(hinge);
      }
    }
    if (opts.patrol) {
      const hood = k.mesh(new BoxGeometry(W * 1.001, 0.02, L * 0.3), k.mat(0xf2f2f2, 0.4), 0.6);
      hood.position.set(0, 0.3 + H + 0.005, L * 0.33);
      const barR = k.mesh(new BoxGeometry(W * 0.4, 0.12, 0.3), k.glowMat(0xff2a3a, 2.2), 0.7);
      const barB = k.mesh(new BoxGeometry(W * 0.4, 0.12, 0.3), k.glowMat(0x2a6aff, 2.2), 0.7);
      barR.position.set(-W * 0.2, 0.3 + H + 0.65, -0.2); barB.position.set(W * 0.2, 0.3 + H + 0.65, -0.2);
      this.root.add(hood, barR, barB);
    }
    // head and tail lights
    for (const side of [-1, 1]) {
      const hl = k.mesh(new BoxGeometry(0.35, 0.14, 0.05), k.glowMat(0xfff2d8, 1.5), 0.8);
      hl.position.set(side * W * 0.32, 0.55, L / 2 + 0.02);
      const tl = k.mesh(new BoxGeometry(0.35, 0.12, 0.05), k.glowMat(0xff2020, 0.9), 0.7);
      tl.position.set(side * W * 0.32, 0.6, -L / 2 - 0.02);
      this.root.add(hl, tl);
      this.headlights.push(hl);
    }
    // headlight wash on the road ahead
    const beam = new Mesh(new PlaneGeometry(4.5, 11), new MeshBasicMaterial({ map: k.beamTex, color: 0xfff0d0, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0.05, L / 2 + 5.6);
    (beam.material as MeshBasicMaterial).opacity = 0.3;
    heatOf(beam, -1);
    this.root.add(beam);
    this.beams.push(beam);
    this.root.traverse((o) => { o.castShadow = o !== beam; });
    this.setLights(opts.lights ?? false);
    k.scene.add(this.root);
  }

  setLights(on: boolean): void {
    this.lights = on;
    for (const b of this.beams) b.visible = on;
    for (const h of this.headlights) (h.material as MeshStandardMaterial).emissiveIntensity = on ? 1.5 : 0.1;
  }

  set(x: number, z: number, dt: number, face?: number): void {
    const moved = Number.isNaN(this.last.x) ? 0 : Math.hypot(x - this.last.x, z - this.last.z);
    if (face !== undefined) this.heading = turn(this.heading, face, dt * 3);
    else if (moved > dt * 0.4) this.heading = turn(this.heading, Math.atan2(x - this.last.x, z - this.last.z), dt * 4);
    this.last.set(x, 0, z);
    this.root.position.set(x, 0, z);
    this.root.rotation.y = this.heading;
  }
}

// ── the kit ──────────────────────────────────────────────────────────────────
export const GROUND = 128;                     // detailed ground (m)
const PX = 8;                                  // canvas pixels per metre

export class Kit {
  readonly scene = new Scene();
  readonly night: boolean;
  readonly glow: Texture;
  readonly beamTex: Texture;
  readonly ctx: CanvasRenderingContext2D;
  readonly lamps: PointLight[] = [];
  private mats = new Map<string, MeshStandardMaterial>();
  private rnd: () => number;
  readonly sun: DirectionalLight;
  readonly updaters: Array<(t: number, dt: number) => void> = [];

  constructor(readonly mode: ViewMode, dark: boolean, readonly shadows: boolean, seed: number) {
    this.night = dark;
    let s = seed >>> 0 || 1;
    this.rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    this.glow = glowTexture();
    this.beamTex = beamTexture();
    const c = document.createElement('canvas');
    c.width = c.height = GROUND * PX;
    this.ctx = c.getContext('2d')!;
    this.scene.background = new Color(dark ? 0x05070a : 0x8a8f94);
    this.scene.fog = new Fog(this.scene.background as Color, 150, 320);
    const nv = mode === 'night';
    this.sun = new DirectionalLight(dark ? 0x8fa6d6 : 0xfff1dc, dark ? (nv ? 1.8 : 0.35) : 3.2);
    this.sun.position.set(-40, 90, 30);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 250;
      this.sun.shadow.bias = -0.0006;
    }
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new HemisphereLight(dark ? 0x5a6a88 : 0xcfdcf0, dark ? 0x1a1a1e : 0x5a5246, dark ? (nv ? 2.2 : 0.35) : 1.1));
  }

  random(): number { return this.rnd(); }

  mat(color: number, rough = 0.85, metal = 0): MeshStandardMaterial {
    const key = `${color}|${rough}|${metal}`;
    let m = this.mats.get(key);
    if (!m) { m = new MeshStandardMaterial({ color, roughness: rough, metalness: metal }); this.mats.set(key, m); }
    return m;
  }

  glowMat(color: number, intensity: number): MeshStandardMaterial {
    return new MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.6 });
  }

  mesh(geo: BoxGeometry | SphereGeometry | CylinderGeometry | PlaneGeometry | RingGeometry, m: Material, heat: number): Mesh {
    const mesh = new Mesh(geo, m);
    heatOf(mesh, heat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, heat = 0.3, rough = 0.85): Mesh {
    const m = this.mesh(new BoxGeometry(w, h, d), this.mat(color, rough), heat);
    m.position.set(x, y + h / 2, z);
    this.scene.add(m);
    return m;
  }

  // ── ground painting (canvas: x, z in metres from the centre) ──
  px(v: number): number { return (v + GROUND / 2) * PX; }
  fill(color: string, grain = 0.12): void {
    const g = this.ctx, n = GROUND * PX;
    g.fillStyle = color; g.fillRect(0, 0, n, n);
    this.grain(0, 0, GROUND, GROUND, grain);
  }
  rect(x0: number, z0: number, x1: number, z1: number, color: string, grain = 0): void {
    const g = this.ctx;
    g.fillStyle = color;
    g.fillRect(this.px(x0), this.px(z0), (x1 - x0) * PX, (z1 - z0) * PX);
    if (grain) this.grain(x0, z0, x1 - x0, z1 - z0, grain);
  }
  line(x0: number, z0: number, x1: number, z1: number, color: string, width = 0.12, dash: number[] = []): void {
    const g = this.ctx;
    g.strokeStyle = color; g.lineWidth = width * PX; g.setLineDash(dash.map((d) => d * PX));
    g.beginPath(); g.moveTo(this.px(x0), this.px(z0)); g.lineTo(this.px(x1), this.px(z1)); g.stroke();
    g.setLineDash([]);
  }
  blot(x: number, z: number, r: number, color: string): void {
    const g = this.ctx, gr = g.createRadialGradient(this.px(x), this.px(z), 0, this.px(x), this.px(z), r * PX);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(this.px(x), this.px(z), r * PX, 0, Math.PI * 2); g.fill();
  }
  grain(x0: number, z0: number, w: number, d: number, amt: number): void {
    const g = this.ctx;
    const count = Math.round(w * d * 26 * amt);
    for (let i = 0; i < count; i++) {
      const v = this.rnd();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.18})` : `rgba(0,0,0,${(0.5 - v) * 0.3})`;
      g.fillRect(this.px(x0 + this.rnd() * w), this.px(z0 + this.rnd() * d), 1 + this.rnd() * 2.5, 1 + this.rnd() * 2.5);
    }
  }
  /** A road along x or z with lane markings and sidewalks. */
  road(axis: 'x' | 'z', c: number, from: number, to: number, width = 8, walk = 2.5): void {
    const hw = width / 2;
    if (axis === 'x') {
      this.rect(from, c - hw - walk, to, c - hw, '#6d6a66', 0.15);
      this.rect(from, c + hw, to, c + hw + walk, '#6d6a66', 0.15);
      this.rect(from, c - hw, to, c + hw, '#2e2f31', 0.25);
      this.line(from, c, to, c, '#c9a642', 0.14, [3, 3]);
      this.line(from, c - hw, to, c - hw, '#8b8782', 0.2);
      this.line(from, c + hw, to, c + hw, '#8b8782', 0.2);
    } else {
      this.rect(c - hw - walk, from, c - hw, to, '#6d6a66', 0.15);
      this.rect(c + hw, from, c + hw + walk, to, '#6d6a66', 0.15);
      this.rect(c - hw, from, c + hw, to, '#2e2f31', 0.25);
      this.line(c, from, c, to, '#c9a642', 0.14, [3, 3]);
      this.line(c - hw, from, c - hw, to, '#8b8782', 0.2);
      this.line(c + hw, from, c + hw, to, '#8b8782', 0.2);
    }
  }
  /** Lay the painted ground and a plain outer ground, with filler blocks round the edge. */
  finishGround(outer = 0x4a4c4e, filler = true): void {
    const tex = new CanvasTexture(this.ctx.canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    const g = this.mesh(new PlaneGeometry(GROUND, GROUND), new MeshStandardMaterial({ map: tex, roughness: 0.95 }), 0.18);
    g.rotation.x = -Math.PI / 2;
    g.castShadow = false;
    this.scene.add(g);
    const o = this.mesh(new PlaneGeometry(700, 700), this.mat(outer, 1), 0.14);
    o.rotation.x = -Math.PI / 2; o.position.y = -0.03; o.castShadow = false;
    this.scene.add(o);
    if (!filler) return;
    for (let i = 0; i < 90; i++) {
      const a = this.rnd() * Math.PI * 2, r = 70 + this.rnd() * 90;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = 10 + this.rnd() * 18, d = 10 + this.rnd() * 18, h = 5 + this.rnd() * 22;
      this.building(x, z, w, d, h, { windows: 0.25 });
    }
  }

  building(x: number, z: number, w: number, d: number, h: number, o: { wall?: number; roof?: number; windows?: number; ac?: number } = {}): Mesh {
    const wall = o.wall ?? pickOf(this.rnd, [0x6f655c, 0x7b7872, 0x5c6066, 0x86786a, 0x4f5358]);
    const tex = facadeTexture(w, h, this.night ? o.windows ?? 0.3 : 0, this.rnd);
    const side = new MeshStandardMaterial({ color: wall, map: tex.map, emissiveMap: tex.emissive, emissive: 0xffd9a0, emissiveIntensity: this.night ? 1.6 : 0, roughness: 0.9 });
    const roofM = this.mat(o.roof ?? pickOf(this.rnd, [0x3a3b3d, 0x4d4a46, 0x55585b, 0x2f3133]), 0.95);
    const m = new Mesh(new BoxGeometry(w, h, d), [side, side, roofM, roofM, side, side]);
    heatOf(m, this.night ? 0.3 : 0.35);
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    // parapet and roof clutter
    const par = 0.5, t = 0.25, pm = this.mat(wall, 0.9);
    for (const [px, pz, pw, pd] of [[0, -d / 2 + t / 2, w, t], [0, d / 2 - t / 2, w, t], [-w / 2 + t / 2, 0, t, d], [w / 2 - t / 2, 0, t, d]]) {
      const p = this.mesh(new BoxGeometry(pw, par, pd), pm, 0.3);
      p.position.set(x + px, h + par / 2, z + pz);
      this.scene.add(p);
    }
    const n = o.ac ?? Math.floor((w * d) / 120);
    for (let i = 0; i < n; i++) {
      const bw = 1 + this.rnd() * 2, bd = 1 + this.rnd() * 2;
      this.box(x + (this.rnd() - 0.5) * (w - bw - 1.5), h, z + (this.rnd() - 0.5) * (d - bd - 1.5), bw, 0.6 + this.rnd() * 0.9, bd, 0x8d9094, 0.45, 0.6);
    }
    return m;
  }

  tree(x: number, z: number, r: number): void {
    const trunk = this.mesh(new CylinderGeometry(0.15, 0.2, 2.5, 6), this.mat(0x3a2a1e), 0.25);
    trunk.position.set(x, 1.25, z);
    this.scene.add(trunk);
    const leaf = this.mat(pickOf(this.rnd, [0x2f4a26, 0x3a5a2c, 0x27402a]), 1);
    for (let i = 0; i < 3; i++) {
      const s = this.mesh(new SphereGeometry(r * (0.6 + this.rnd() * 0.4), 10, 8), leaf, 0.22);
      s.position.set(x + (this.rnd() - 0.5) * r * 0.8, 2.6 + r * 0.5 + this.rnd() * 0.6, z + (this.rnd() - 0.5) * r * 0.8);
      this.scene.add(s);
    }
  }

  lamp(x: number, z: number, arm = 0): void {
    const pole = this.mesh(new CylinderGeometry(0.08, 0.1, 6, 6), this.mat(0x2b2d30, 0.5, 0.5), 0.25);
    pole.position.set(x, 3, z);
    const head = this.mesh(new BoxGeometry(0.5, 0.15, 0.9), this.glowMat(0xffe2b0, this.night ? (this.mode === 'night' ? 0.5 : 1.2) : 0.1), this.night ? 0.8 : 0.3);
    head.position.set(x, 6, z + arm);
    this.scene.add(pole, head);
    if (this.night) {
      const l = new PointLight(0xffc98a, 30, 22, 1.7);
      l.position.set(x, 5.7, z + arm);
      this.scene.add(l);
      this.lamps.push(l);
      const pool = new Mesh(new PlaneGeometry(14, 14), new MeshBasicMaterial({ map: this.glow, color: 0xffb870, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.04, z + arm);
      heatOf(pool, -1);
      this.scene.add(pool);
    }
  }

  dumpster(x: number, z: number, rot = 0, color = 0x2f5a3a): Group {
    const g = new Group();
    const body = this.mesh(new BoxGeometry(2.2, 1.3, 1.3), this.mat(color, 0.7, 0.2), 0.3);
    body.position.y = 0.65;
    const lid = this.mesh(new BoxGeometry(2.25, 0.08, 1.35), this.mat(0x1d1f22, 0.6), 0.3);
    lid.position.y = 1.34;
    g.add(body, lid);
    g.position.set(x, 0, z); g.rotation.y = rot;
    this.scene.add(g);
    return g;
  }

  /** A little glow sprite (lit window spill, sparks, fire). */
  sprite(color: number, size: number, heat: number): Sprite {
    const s = new Sprite(new SpriteMaterial({ map: this.glow, color, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(size);
    heatOf(s, heat);
    return s;
  }

  /** A fire in a barrel (or anywhere): rising embers and a warm, gently breathing light. */
  fire(x: number, y: number, z: number): { boost: number } {
    const state = { boost: 0 };
    const flames: Array<{ s: Sprite; age: number; life: number; vx: number; vz: number }> = [];
    for (let i = 0; i < 26; i++) {
      const s = this.sprite(i % 3 === 0 ? 0xffd070 : 0xff7a2a, 0.8, 1);
      this.scene.add(s);
      flames.push({ s, age: this.rnd() * 1.2, life: 0.8 + this.rnd() * 0.7, vx: (this.rnd() - 0.5) * 0.3, vz: (this.rnd() - 0.5) * 0.3 });
    }
    const light = new PointLight(0xff8a3a, 60, 18, 1.7);
    light.position.set(x, y + 1.2, z);
    this.scene.add(light);
    let t = 0;
    this.updaters.push((_st, dt) => {
      t += dt;
      for (const f of flames) {
        f.age += dt;
        if (f.age > f.life) { f.age = 0; f.life = 0.7 + this.rnd() * 0.8 + state.boost * 0.4; }
        const k = f.age / f.life;
        f.s.position.set(x + f.vx * k * 2, y + k * (1.4 + state.boost), z + f.vz * k * 2);
        f.s.scale.setScalar((1.1 + state.boost * 0.6) * (1 - k * 0.7));
        (f.s.material as SpriteMaterial).opacity = (1 - k) * 0.85;
      }
      light.intensity = (55 + state.boost * 50) * (0.85 + 0.15 * Math.sin(t * 3.1) * Math.sin(t * 1.7 + 1));
    });
    return state;
  }

  water(x: number, z: number, w: number, d: number): void {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0d1a22'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      g.strokeStyle = `rgba(${120 + this.rnd() * 80},${150 + this.rnd() * 60},${170 + this.rnd() * 60},${0.04 + this.rnd() * 0.08})`;
      const px = this.rnd() * 256, py = this.rnd() * 256, len = 3 + this.rnd() * 10;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + len, py + (this.rnd() - 0.5)); g.stroke();
    }
    const tex = new CanvasTexture(c);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(w / 16, d / 16);
    tex.colorSpace = SRGBColorSpace;
    const m = this.mesh(new PlaneGeometry(w, d), new MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.3 }), 0.06);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z);
    m.castShadow = false;
    this.scene.add(m);
    this.updaters.push((_t, dt) => { tex.offset.x += dt * 0.012; tex.offset.y += dt * 0.006; });
  }

  /** Expanding rings on water (a splash). */
  splash(x: number, z: number, at: number): void {
    const rings = [0, 0.25, 0.55].map((delay) => {
      const m = new Mesh(new RingGeometry(0.85, 1, 40), new MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z);
      heatOf(m, 0.12);
      this.scene.add(m);
      return { m, delay };
    });
    this.updaters.push((t) => {
      for (const r of rings) {
        const k = (t - at - r.delay) / 3;
        (r.m.material as MeshBasicMaterial).opacity = k > 0 && k < 1 ? (1 - k) * 0.7 : 0;
        r.m.scale.setScalar(0.3 + Math.max(0, k) * 6);
      }
    });
  }

  /** Swap every material for flat heat greys (the post pass maps them through a thermal palette). */
  applyThermal(): void {
    const cache = new Map<number, MeshBasicMaterial>();
    const maps = new Map<string, MeshBasicMaterial>();
    const heatMat = (h: number, src?: Material) => {
      // ambient stuff sits cold and dark; people, engines and fire stand out hot
      const k = Math.round((0.2 + 0.8 * Math.pow(Math.max(0, (Math.min(1, h) - 0.1) / 0.9), 1.5)) * 40);
      // facades keep their window grid as a faint pattern; painted ground stays flat (it's all one temperature)
      const map = (src as MeshStandardMaterial | undefined)?.emissiveMap ? (src as MeshStandardMaterial).map : null;
      if (map) {
        // keep painted detail (lines, stains, windows) as a little variation in the heat
        const key = `${k}|${map.uuid}`;
        let mm = maps.get(key);
        if (!mm) { const v = (k / 40) * 1.7; mm = new MeshBasicMaterial({ color: new Color(v, v, v), map }); maps.set(key, mm); }
        return mm;
      }
      let m = cache.get(k);
      if (!m) { const v = k / 40; m = new MeshBasicMaterial({ color: new Color(v, v, v) }); cache.set(k, m); }
      return m;
    };
    this.scene.traverse((o) => {
      const h = o.userData.heat as number | undefined;
      if (o instanceof Mesh) {
        if (h === -1) { o.visible = false; return; }
        const v = h ?? 0.2;
        o.material = Array.isArray(o.material) ? o.material.map((m) => heatMat(v, m)) : heatMat(v, o.material);
      } else if (o instanceof Sprite) {
        (o.material as SpriteMaterial).color.setScalar(1);
      }
    });
    for (const l of this.lamps) l.visible = false;
    (this.scene.background as Color).setScalar(0.02);
    (this.scene.fog as Fog).color.setScalar(0.02);
  }
}

const pickOf = <T>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];

function beamTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(24, 128); g.lineTo(40, 128); g.lineTo(64, 0); g.lineTo(0, 0); g.closePath(); g.fill();
  return new CanvasTexture(c);
}

function facadeTexture(w: number, h: number, lit: number, r: () => number): { map: Texture; emissive: Texture } {
  const cols = Math.max(2, Math.round(w / 3)), rows = Math.max(1, Math.round(h / 3.2));
  const c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = e.width = cols * 16; c.height = e.height = rows * 20;
  const g = c.getContext('2d')!, ge = e.getContext('2d')!;
  g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, c.width, c.height);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, e.width, e.height);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    g.fillStyle = '#2a2e33';
    g.fillRect(x * 16 + 4, y * 20 + 5, 8, 10);
    if (r() < lit) { ge.fillStyle = r() < 0.7 ? '#ffd79a' : '#cfe3ff'; ge.fillRect(x * 16 + 4, y * 20 + 5, 8, 10); }
  }
  const map = new CanvasTexture(c), emissive = new CanvasTexture(e);
  map.colorSpace = emissive.colorSpace = SRGBColorSpace;
  return { map, emissive };
}

// ── the site: a vignette running in its own scene ──────────────────────────
export class Site {
  readonly camera = new PerspectiveCamera(34, 1, 0.5, 900);
  kit: Kit;
  script: Script;
  private focus = new Vector3();
  private t = 0;

  constructor(readonly vignette: Vignette, readonly mode: ViewMode, dark: boolean, shadows: boolean, seed: number) {
    this.kit = new Kit(mode, dark, shadows, seed);
    this.script = vignette.build(this.kit);
    if (mode === 'thermal') this.kit.applyThermal();
    this.script.update(0, 0);
    this.focus.copy(this.script.focus);
  }

  get time(): number { return this.t; }

  /** `zoom` 0 = wide (just through the clouds) … 1 = fully enhanced. */
  update(dt: number, zoom: number, aspect: number, wanderX = 0, wanderY = 0): void {
    this.t += dt;
    this.script.update(this.t, dt);
    for (const u of this.kit.updaters) u(this.t, dt);
    this.focus.lerp(this.script.focus, Math.min(1, dt * 1.6));
    const v = this.vignette;
    const hgt = v.height + (1 - zoom) * 120;
    const back = Math.tan(v.tilt) * hgt;
    this.camera.position.set(
      this.focus.x + Math.sin(v.yaw) * back + wanderX * 0.02 + Math.sin(this.t * 0.13) * 1.2,
      this.focus.y + hgt,
      this.focus.z + Math.cos(v.yaw) * back + wanderY * 0.02 + Math.cos(this.t * 0.11) * 1.2,
    );
    this.camera.lookAt(this.focus);
    this.camera.aspect = aspect;
    this.camera.fov = 34;
    this.camera.updateProjectionMatrix();
    this.kit.sun.target.position.copy(this.focus);
    this.kit.sun.position.set(this.focus.x - 40, 90, this.focus.z + 30);
  }

  dispose(): void {
    this.kit.scene.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) { (m as MeshStandardMaterial).map?.dispose(); (m as MeshStandardMaterial).emissiveMap?.dispose(); m.dispose(); }
      }
    });
    this.kit.sun.shadow.map?.dispose();
  }
}
