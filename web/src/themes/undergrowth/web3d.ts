import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DynamicDrawUsage, Group, InstancedMesh,
  LatheGeometry, Line, LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial, NormalBlending, Object3D, Points, ShaderMaterial, Sphere,
  SphereGeometry, Sprite, SpriteMaterial, Vector2, Vector3,
} from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { hash01 } from '../../state';
import type { Sim, SimPulse, SimShroom } from '../mycelium/filaments';

/** The web's radius in world units: the whole mat wraps a sphere ~96 units across. */
export const R = 48;
/** World units per sim pixel: adjacent vertices are ~6 px apart, so their 3-D edge length is still ≈ len·S. */
export const S = 0.05;
const TAU = Math.PI * 2;

/** The mat's colour families, same as seen from above: ice-cyan, teal, spring. */
const HUES = [new Color(0x49e6ff), new Color(0x5ff0cf), new Color(0x8cf29a)];

/**
 * The radial band [0.36..0.98]·R a loam point sits in. Low frequency, so
 * neighbouring vertices share a band and filaments stay coherent strands;
 * periodic in x (the mat's left/right edges join on the sphere), so the seam
 * is seamless. This is what gives the web its volume: a thick shell of
 * layered strands, not a surface.
 */
function depth(x: number, y: number): number {
  const d = 0.72
    + 0.16 * Math.sin((2 * TAU * x) / 1920 + 1.2) * Math.sin(y * 0.004 - 0.8)
    + 0.12 * Math.sin((4 * TAU * x) / 1920 - 0.5) * Math.cos(y * 0.003 + 2.1)
    + 0.08 * Math.sin((2 * TAU * x) / 1920 + (TAU * y) / 1080 + 2.9) * Math.sin(y * 0.002 + 0.4);
  return Math.min(0.98, Math.max(0.36, d));
}

const _v = new Vector3();
const _v2 = new Vector3();

/**
 * Loam (sim px) → world: the mat wraps a spherical shell. x wraps the
 * longitude (the mat's left and right edges join), y spans the latitude band
 * 45°..135° (no pole crowding), and depth() pushes strands into a thick
 * volume — so from anywhere inside the web, every direction leads somewhere.
 */
export function lift(x: number, y: number, out: Vector3): Vector3 {
  const th = (x / 1920) * TAU;
  const ph = Math.PI / 4 + (y / 1080) * (Math.PI / 2);
  const r = R * depth(x, y);
  out.set(
    Math.sin(ph) * Math.cos(th) * r,
    Math.cos(ph) * r,
    Math.sin(ph) * Math.sin(th) * r,
  );
  return out;
}

/** The outward (radial) direction at a loam point — "up" off the web. */
export function radial(x: number, y: number, out: Vector3): Vector3 {
  return out.copy(lift(x, y, out)).normalize();
}

// ── shared soft textures ────────────────────────────────────────────────────
function radialTex(inner: string, mid: string, outer: string, size = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, mid);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}
const TEX = {
  glow: () => radialTex('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0)'),
  flash: () => radialTex('rgba(230,255,246,0.95)', 'rgba(180,240,220,0.35)', 'rgba(180,240,220,0)'),
  scorch: () => radialTex('rgba(8,5,3,0.95)', 'rgba(20,10,6,0.7)', 'rgba(20,10,6,0)'),
  fog: () => radialTex('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0)'),
  ringTeal: () => ringTex('rgba(140,240,205,0.9)'),
  ringFire: () => ringTex('rgba(255,178,106,0.95)'),
};

function ringTex(color: string, size = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = size * 0.055;
  g.shadowColor = color;
  g.shadowBlur = size * 0.09;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
  g.stroke();
  return new CanvasTexture(c);
}

// ── the web: every filament in one geometry, drawn twice (core + halo) ─────
const tubeVertex = /* glsl */`
  attribute vec3 aTangent;
  attribute float aWidth;
  attribute vec4 aTint;
  attribute float aSide;
  uniform float uWidthMul;
  varying vec4 vTint;
  varying float vUv;
  void main() {
    vec4 mv = viewMatrix * vec4(position, 1.0);
    vec3 tv = (viewMatrix * vec4(aTangent, 0.0)).xyz;
    vec3 vd = normalize(-mv.xyz);
    vec3 side = cross(tv, vd);
    side = (dot(side, side) < 1e-5) ? vec3(0.0, 1.0, 0.0) : normalize(side);
    mv.xy += side.xy * (aWidth * uWidthMul * aSide);
    vTint = aTint;
    vUv = aSide > 0.0 ? 1.0 : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;
const tubeFragment = /* glsl */`
  uniform float uAlphaMul;
  varying vec4 vTint;
  varying float vUv;
  void main() {
    float f = abs(vUv - 0.5) * 2.0;
    float a = (1.0 - f) * (1.0 - f);
    gl_FragColor = vec4(vTint.rgb * a, vTint.a * uAlphaMul * a);
  }`;

class FilamentWeb {
  readonly core: Mesh;
  private geo = new BufferGeometry();
  private coreMat: ShaderMaterial;
  private haloMat: ShaderMaterial;
  private pos: Float32Array;
  private tan: Float32Array;
  private tint: Float32Array;
  private wid: Float32Array;
  private idx: Uint32Array;
  private edgeSlot = new Map<number, number>(); // live edge index → vertex slot
  private live = 0;
  private structRev = -1;
  private lastRebuild = 0;
  private tmp = new Color();
  private maxEdges: number;

  constructor(scene: Scene, maxEdges: number) {
    this.maxEdges = maxEdges;
    const n = maxEdges * 4;
    this.pos = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.tint = new Float32Array(n * 4);
    this.wid = new Float32Array(n);
    this.idx = new Uint32Array(maxEdges * 12);

    const set = (name: string, arr: Float32Array, size: number) =>
      this.geo.setAttribute(name, new BufferAttribute(arr, size).setUsage(DynamicDrawUsage));
    set('position', this.pos, 3);
    set('aTangent', this.tan, 3);
    set('aTint', this.tint, 4);
    set('aWidth', this.wid, 1);
    const side = new Float32Array(n);
    for (let i = 0; i < n; i += 4) { side[i] = -1; side[i + 1] = 1; side[i + 2] = -1; side[i + 3] = 1; }
    this.geo.setAttribute('aSide', new BufferAttribute(side, 1));
    this.geo.setIndex(new BufferAttribute(this.idx, 1).setUsage(DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.geo.boundingSphere = new Sphere(new Vector3(), 1e6);

    this.coreMat = new ShaderMaterial({
      uniforms: { uWidthMul: { value: 1 }, uAlphaMul: { value: 1 } },
      vertexShader: tubeVertex, fragmentShader: tubeFragment,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.haloMat = new ShaderMaterial({
      uniforms: { uWidthMul: { value: 4.5 }, uAlphaMul: { value: 0.14 } },
      vertexShader: tubeVertex, fragmentShader: tubeFragment,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.core = new Mesh(this.geo, this.coreMat);
    this.core.renderOrder = 1;
    this.core.frustumCulled = false;
    scene.add(this.core);
    const halo = new Mesh(this.geo, this.haloMat);
    halo.renderOrder = 1;
    halo.frustumCulled = false;
    scene.add(halo);
  }

  /** Rebuild the centre lines at most every 200 ms when the structure changed. */
  private rebuildStructure(sim: Sim, t: number): void {
    if (this.structRev === sim.structureRev) return;
    if (this.live > 0 && t - this.lastRebuild < 0.2) return;
    this.lastRebuild = t;
    this.structRev = sim.structureRev;
    const V = sim.V, E = sim.E;
    let n = 0;
    this.edgeSlot.clear();
    for (let ei = 0; ei < E.length; ei++) {
      const e = E[ei];
      if (e.dead || n >= this.maxEdges) continue;
      const a = V[e.a], b = V[e.b];
      if (!a || !b) continue;
      const slot = n * 4;
      this.edgeSlot.set(ei, slot);
      lift(a.x, a.y, _v);
      const ax = _v.x, ay = _v.y, az = _v.z;
      lift(b.x, b.y, _v);
      const bx = _v.x, by = _v.y, bz = _v.z;
      let dx = bx - ax, dy = by - ay, dz = bz - az;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const put = (k: number, x: number, y: number, z: number) => {
        this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
        this.tan[k * 3] = dx; this.tan[k * 3 + 1] = dy; this.tan[k * 3 + 2] = dz;
      };
      put(slot, ax, ay, az); put(slot + 1, ax, ay, az); put(slot + 2, bx, by, bz); put(slot + 3, bx, by, bz);
      const I = (k: number, v: number) => { this.idx[n * 12 + k] = v; };
      I(0, slot); I(1, slot + 1); I(2, slot + 2);
      I(3, slot + 1); I(4, slot + 3); I(5, slot + 2);
      I(6, slot); I(7, slot + 2); I(8, slot + 3);
      I(9, slot + 1); I(10, slot + 3); I(11, slot);
      n++;
    }
    this.live = n;
    this.geo.setDrawRange(0, n * 4);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aTangent.needsUpdate = true;
    this.geo.index!.needsUpdate = true;
  }

  /** Flow and memory change every frame: re-tint and re-width the live threads. */
  update(sim: Sim, t: number, glow: number): void {
    this.rebuildStructure(sim, t);
    const V = sim.V, E = sim.E;
    for (let ei = 0; ei < E.length; ei++) {
      const slot = this.edgeSlot.get(ei);
      if (slot === undefined) continue;
      const e = E[ei];
      const h = HUES[V[e.b]?.hue ?? 1] ?? HUES[1];
      const bright = (0.10 + e.mem * 0.55 + e.flow * 1.3) * glow;
      this.tmp.copy(h).multiplyScalar(bright);
      const alpha = (0.16 + e.mem * 0.5 + e.flow * 0.55) * Math.min(1, glow);
      const width = 0.10 + e.flow * 0.34 + e.mem * 0.28;
      for (let k = 0; k < 4; k++) {
        const ti = (slot + k) * 4;
        this.tint[ti] = this.tmp.r; this.tint[ti + 1] = this.tmp.g; this.tint[ti + 2] = this.tmp.b; this.tint[ti + 3] = alpha;
        this.wid[slot + k] = width;
      }
    }
    this.geo.attributes.aTint.needsUpdate = true;
    this.geo.attributes.aWidth.needsUpdate = true;
  }
}

// ── host nodules: one instanced mesh ────────────────────────────────────────
class Nodules {
  readonly mesh: InstancedMesh;
  private dummy = new Object3D();
  private col = new Color();
  private max: number;

  constructor(scene: Scene, max: number) {
    this.max = max;
    const mat = new MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new InstancedMesh(new SphereGeometry(0.5, 10, 8), mat, max);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    scene.add(mesh);
    this.mesh = mesh;
    this.mesh.count = 0;
  }

  update(sim: Sim): void {
    let i = 0;
    for (const n of sim.nodes.values()) {
      if (i >= this.max) break;
      lift(n.x, n.y, _v);
      const mem = sim.memory(n);
      this.dummy.position.copy(_v);
      this.dummy.scale.setScalar(0.5 + mem * 2.2 + n.pulse * 1.6);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.col.copy(HUES[n.hue]).multiplyScalar(0.25 + mem * 1.1 + n.pulse * 1.4);
      this.mesh.setColorAt(i, this.col);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ── point sprites: pulses (with trails) and burst spores share the shader ──
const pointVertex = /* glsl */`
  attribute vec3 aCol;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uPx;
  varying vec3 vCol;
  varying float vAlpha;
  void main() {
    vCol = aCol; vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPx * 900.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const pointFragment = /* glsl */`
  varying vec3 vCol;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c)) * vAlpha;
    gl_FragColor = vec4(vCol * a, a);
  }`;

function makePoints(scene: Scene, max: number, order: number): { points: Points; pos: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array; setPx: (px: number) => void } {
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const alpha = new Float32Array(max);
  const geo = new BufferGeometry();
  const set = (name: string, arr: Float32Array, sizeN: number) =>
    geo.setAttribute(name, new BufferAttribute(arr, sizeN).setUsage(DynamicDrawUsage));
  set('position', pos, 3); set('aCol', col, 3); set('aSize', size, 1); set('aAlpha', alpha, 1);
  const mat = new ShaderMaterial({
    uniforms: { uPx: { value: 1 } },
    vertexShader: pointVertex, fragmentShader: pointFragment,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const points = new Points(geo, mat);
  points.renderOrder = order;
  points.frustumCulled = false;
  scene.add(points);
  const setPx = (px: number) => { mat.uniforms.uPx.value = px; };
  return { points, pos, col, size, alpha, setPx };
}

const PULSE_TRAILS = 3; // main + 2 ghosts

/** Light running the threads. Returns pass-bys each frame for the whoosh sfx. */
class Pulses {
  private buf: ReturnType<typeof makePoints>;
  private cum = new Map<SimPulse, Float32Array>();
  private walk = new Vector3();
  private camPos = new Vector3();
  private c3 = new Color();
  private max: number;
  readonly points: Points;

  constructor(scene: Scene, max: number) {
    this.max = max;
    this.buf = makePoints(scene, max * PULSE_TRAILS, 3);
    this.points = this.buf.points;
  }

  setPx(px: number): void { this.buf.setPx(px); }
  setCam(p: Vector3): void { this.camPos.copy(p); }

  /** Cumulative segment lengths along a pulse's path (edge lengths never change). */
  private cumlen(sim: Sim, p: SimPulse): Float32Array | null {
    let c = this.cum.get(p);
    if (c) return c;
    const arr = new Float32Array(p.p.length);
    let acc = 0;
    for (let k = 1; k < p.p.length; k++) {
      const ei = this.edge(sim, p.p[k - 1], p.p[k]);
      if (ei < 0) return null;
      acc += sim.E[ei].len;
      arr[k] = acc;
    }
    if (acc <= 0) return null;
    this.cum.set(p, arr);
    return arr;
  }

  private edge(sim: Sim, a: number, b: number): number {
    for (const ei of sim.adj[a]) {
      const e = sim.E[ei];
      if (!e.dead && (e.a === b || e.b === b)) return ei;
    }
    return -1;
  }

  /** Point at distance d along the pulse's path, lifted into the world. */
  private at(sim: Sim, p: SimPulse, c: Float32Array, d: number, out: Vector3): boolean {
    if (d < 0 || d > p.len) return false;
    let k = 1;
    while (k < p.p.length && c[k] < d) k++;
    if (k >= p.p.length) return false;
    const ei = this.edge(sim, p.p[k - 1], p.p[k]);
    if (ei < 0) return false;
    const e = sim.E[ei];
    const f = e.len > 0 ? (d - c[k - 1]) / e.len : 0;
    const forward = e.a === p.p[k - 1];
    const a = sim.V[forward ? e.a : e.b], b = sim.V[forward ? e.b : e.a];
    if (!a || !b) return false;
    out.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, 0);
    lift(out.x, out.y, out);
    return true;
  }

  update(sim: Sim): number {
    const { pos, col, size, alpha } = this.buf;
    const cam = this.camPos;
    let n = 0, passed = 0;
    const alive = new Set<SimPulse>();
    for (const p of sim.pulses) {
      if (n >= this.max) break;
      alive.add(p);
      const c = this.cumlen(sim, p);
      if (!c) continue;
      this.c3.set(p.col);
      // main body first, so pass-by detection uses the same position
      if (this.at(sim, p, c, p.s, this.walk)) {
        const i = n * PULSE_TRAILS;
        pos[i * 3] = this.walk.x; pos[i * 3 + 1] = this.walk.y; pos[i * 3 + 2] = this.walk.z;
        col[i * 3] = this.c3.r; col[i * 3 + 1] = this.c3.g; col[i * 3 + 2] = this.c3.b;
        size[i] = 0.9; alpha[i] = 1;
        n++;
        const dx = this.walk.x - cam.x, dy = this.walk.y - cam.y, dz = this.walk.z - cam.z;
        if (Math.hypot(dx, dy, dz) < 7) {
          this.at(sim, p, c, p.s + 3, _v2);
          const cross = dx * (_v2.y - cam.y) - dy * (_v2.x - cam.x);
          passed += cross > 0 ? -1 : 1; // -1: passed left, +1: right (count, not bool)
        }
      }
      for (const [off, sizeV, alphaV] of [[-7, 0.55, 0.4], [-15, 0.4, 0.18]] as Array<[number, number, number]>) {
        if (this.at(sim, p, c, p.s + off, this.walk)) {
          const i = n * PULSE_TRAILS;
          pos[i * 3] = this.walk.x; pos[i * 3 + 1] = this.walk.y; pos[i * 3 + 2] = this.walk.z;
          col[i * 3] = this.c3.r; col[i * 3 + 1] = this.c3.g; col[i * 3 + 2] = this.c3.b;
          size[i] = sizeV; alpha[i] = alphaV;
          n++;
        }
      }
    }
    for (const key of [...this.cum.keys()]) if (!alive.has(key)) this.cum.delete(key);
    for (let i = n * PULSE_TRAILS; i < this.max * PULSE_TRAILS; i++) alpha[i] = 0;
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aCol.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.setDrawRange(0, n * PULSE_TRAILS);
    return passed;
  }
}

/** Burst spores: the sim's own 2-D physics, lifted a breath above the web. */
class Spores {
  private buf: ReturnType<typeof makePoints>;
  readonly points: Points;

  constructor(scene: Scene, max: number) {
    this.buf = makePoints(scene, max, 4);
    this.points = this.buf.points;
  }

  setPx(px: number): void { this.buf.setPx(px); }

  update(sim: Sim): void {
    const { pos, col, size, alpha } = this.buf;
    const c3 = new Color();
    let n = 0;
    for (const s of sim.spores) {
      if (n >= size.length) break;
      lift(s.x, s.y, _v);
      // a breath off the web, along its radial "up"
      _v2.copy(_v).normalize().multiplyScalar(1.2 + Math.sin(s.t * 3 + s.x * 0.1) * 0.4);
      pos[n * 3] = _v.x + _v2.x;
      pos[n * 3 + 1] = _v.y + _v2.y;
      pos[n * 3 + 2] = _v.z + _v2.z;
      c3.set(s.col);
      col[n * 3] = c3.r; col[n * 3 + 1] = c3.g; col[n * 3 + 2] = c3.b;
      size[n] = 0.34;
      alpha[n] = Math.max(0, 0.8 * (1 - s.t / s.land));
      n++;
    }
    for (let i = n; i < size.length; i++) alpha[i] = 0;
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aCol.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.setDrawRange(0, n);
  }
}

// ── mushrooms: low-poly stems and caps, the three species ──────────────────
const CAP_PROFILES: number[][][] = [
  // 0: amanita — a broad dome
  [[0, 1.5], [0.38, 1.44], [0.72, 1.24], [0.98, 0.92], [1.1, 0.52], [1.04, 0.28], [0.8, 0.2]],
  // 1: morel — a tall, narrow ovoid
  [[0, 2.0], [0.3, 1.94], [0.5, 1.66], [0.62, 1.15], [0.66, 0.62], [0.55, 0.3], [0.42, 0.24]],
  // 2: parasol — a wide, low, upturned cap
  [[0, 0.95], [0.5, 0.9], [1.0, 0.74], [1.5, 0.48], [1.85, 0.26], [1.9, 0.12], [1.55, 0.08]],
];

interface ShroomTendril { line: Line; ax: number; az: number; r: number; seed: number; len: number; rimY: number; }

interface ShroomView { group: Group; glow: Sprite; tendrils: ShroomTendril[]; tmat: LineBasicMaterial; }

const SHROOM_UP = new Vector3(0, 1, 0);

class Shrooms {
  private views = new Map<SimShroom, ShroomView>();
  private glowTex: CanvasTexture;
  private capMats = new Map<number, MeshBasicMaterial>();

  constructor(private scene: Scene) {
    this.glowTex = TEX.glow();
  }

  private capMat(col: number): MeshBasicMaterial {
    let m = this.capMats.get(col);
    if (!m) { m = new MeshBasicMaterial({ color: col, toneMapped: false }); this.capMats.set(col, m); }
    return m;
  }

  private make(m: SimShroom): ShroomView {
    const kind = Math.floor(hash01(`cap|${m.label}`) * 3) % 3;
    const wobble = 0.85 + hash01(`rim|${m.label}`) * 0.3;
    const pts = CAP_PROFILES[kind].map((p) => new Vector2(p[0] * wobble, p[1]));
    const cap = new Mesh(new LatheGeometry(pts, 10), this.capMat(m.col));
    cap.position.y = 2.1;
    const stem = new Mesh(new SphereGeometry(0.34, 8, 6), this.capMat(m.col));
    stem.scale.set(1, 3.0, 1);
    stem.position.y = 1.2;
    const glow = new Sprite(new SpriteMaterial({
      map: this.glowTex, color: m.col, transparent: true, opacity: m.blocked ? 0.3 : 0.5,
      blending: AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(7 * m.s);
    glow.position.y = 2.2;
    const group = new Group();
    group.add(stem, cap, glow);
    // jellyfish tendrils: glowing filaments hanging off the cap rim, swaying
    const tmat = new LineBasicMaterial({
      color: m.col, transparent: true, opacity: 0.45,
      blending: AdditiveBlending, depthWrite: false,
    });
    const tendrils: ShroomTendril[] = [];
    let rimR = 0, rimY = 0;
    for (const p of pts) if (p.x > rimR) { rimR = p.x; rimY = 2.1 + p.y; }
    const tn = 4 + Math.floor(hash01(`tent|${m.label}`) * 3);
    for (let i = 0; i < tn; i++) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(TENDRIL_PTS * 3), 3).setUsage(DynamicDrawUsage));
      const line = new Line(geo, tmat);
      line.frustumCulled = false;
      group.add(line);
      const a = (i / tn) * TAU + hash01(`ta|${m.label}|${i}`) * 1.5;
      tendrils.push({
        line,
        ax: Math.cos(a), az: Math.sin(a),
        r: rimR * (0.5 + hash01(`tr|${m.label}|${i}`) * 0.45),
        seed: hash01(`ts|${m.label}|${i}`) * 10,
        len: 2.8 + hash01(`tl|${m.label}|${i}`) * 2.6,
        rimY,
      });
    }
    lift(m.x, m.y, _v);
    group.position.copy(_v);
    // grow off the web along its radial "up", then the species' own spin and lean
    group.quaternion.setFromUnitVectors(SHROOM_UP, _v2.copy(_v).normalize());
    group.rotateY(m.rot * 4 + hash01(`spin|${m.label}`) * 6.283);
    group.rotateX(m.lean * 0.3);
    this.scene.add(group);
    return { group, glow, tendrils, tmat };
  }

  update(sim: Sim): void {
    const now = performance.now() / 1000;
    for (const [m, v] of [...this.views]) {
      if (!sim.shrooms.includes(m)) {
        this.scene.remove(v.group);
        for (const o of [...v.group.children]) {
          const mesh = o as Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
          const line = o as Line;
          if ((line as unknown as { isLine?: boolean }).isLine) line.geometry.dispose();
        }
        v.tmat.dispose();
        v.glow.material.dispose();
        this.views.delete(m);
        continue;
      }
      // grow: ease-out-back over 1.6 s; wilt: squash in the last quarter of life
      const grow = Math.min(1, m.t / 1.6);
      const e = 1 + 2.2 * Math.pow(grow - 1, 3) + 1.2 * Math.pow(grow - 1, 2);
      let sx = m.s * Math.max(0.001, e);
      let sy = 1;
      const lifeF = m.t / m.life;
      if (lifeF > 0.75) {
        const f = (lifeF - 0.75) / 0.25;
        sx = m.s;
        sy = Math.max(0.05, 1 - f * 0.65);
        v.glow.material.opacity = (m.blocked ? 0.3 : 0.5) * (1 - f);
      }
      v.group.scale.set(sx, sx * sy, sx);
      lift(m.x, m.y, _v);
      v.group.position.copy(_v);
      // the tendrils sway: pinned at the rim, looser toward the tip
      for (const td of v.tendrils) {
        const arr = td.line.geometry.attributes.position.array as Float32Array;
        for (let j = 0; j < TENDRIL_PTS; j++) {
          const f = j / (TENDRIL_PTS - 1);
          const amp = (0.25 + td.len * 0.15) * f;
          arr[j * 3] = td.ax * td.r + Math.sin(now * 0.7 + td.seed + f * 2.6) * amp;
          arr[j * 3 + 1] = td.rimY - td.len * Math.pow(f, 1.2);
          arr[j * 3 + 2] = td.az * td.r + Math.cos(now * 0.55 + td.seed * 1.3 + f * 2.2) * amp * 0.8;
        }
        td.line.geometry.attributes.position.needsUpdate = true;
      }
    }
    for (const m of sim.shrooms) {
      if (!this.views.has(m)) this.views.set(m, this.make(m));
    }
  }

  /** World-space anchor above a mushroom (radially out from the web), for its label (null when gone). */
  anchor(m: SimShroom, out: Vector3): Vector3 | null {
    if (!this.views.has(m)) return null;
    lift(m.x, m.y, out);
    _v2.copy(out).normalize().multiplyScalar(3.7 * m.s);
    out.add(_v2);
    return out;
  }
}

// ── jellyfish tendrils on the busy junctions ────────────────────────────────
const TENDRIL_PTS = 9;
const MAX_TENDRIL_NODES = 26;

interface TendrilNode {
  g: Group;
  lines: { line: Line; ax: number; az: number; seed: number; len: number }[];
  mat: LineBasicMaterial;
  bell: Sprite;
  alpha: number;
}

/**
 * The web's busiest junctions grow a skirt of glowing tendrils that hang off
 * the web into the void and sway — jellyfish among the filaments. Chosen by
 * degree (a real junction, not a strand) and a per-node hash, so the same
 * kinds of places always get them; they fade in and out with the node's
 * life, and survive the sim's index-compaction because they're keyed by
 * position, not by index.
 */
class NodeTendrils {
  private views = new Map<string, TendrilNode>();

  constructor(private scene: Scene) {}

  update(sim: Sim): void {
    const now = performance.now() / 1000;
    const live = new Set<string>();

    for (let i = 0; i < sim.V.length; i++) {
      const v = sim.V[i];
      let deg = 0;
      for (const ei of sim.adj[i]) if (!sim.E[ei].dead) deg++;
      if (deg < 4) continue;
      const key = `${v.x | 0}|${v.y | 0}`;
      if (hash01(`nt|${key}`) >= 0.12) continue;
      if (!this.views.has(key) && this.views.size >= MAX_TENDRIL_NODES) continue;
      live.add(key);
      const view = this.views.get(key) ?? this.spawn(key, v, v.hue);
      if (!view) continue;
      // sway: pinned at the node, looser toward the tip, hanging down the radial
      for (const td of view.lines) {
        const arr = td.line.geometry.attributes.position.array as Float32Array;
        for (let j = 0; j < TENDRIL_PTS; j++) {
          const f = j / (TENDRIL_PTS - 1);
          const amp = (0.2 + td.len * 0.14) * f;
          arr[j * 3] = td.ax * 0.22 + Math.sin(now * 0.6 + td.seed + f * 2.6) * amp;
          arr[j * 3 + 1] = -td.len * Math.pow(f, 1.15);
          arr[j * 3 + 2] = td.az * 0.22 + Math.cos(now * 0.5 + td.seed * 1.3 + f * 2.2) * amp * 0.8;
        }
        td.line.geometry.attributes.position.needsUpdate = true;
      }
    }

    for (const [key, view] of [...this.views]) {
      view.alpha += ((live.has(key) ? 1 : -1) * 1.4) * (1 / 60);
      view.alpha = Math.min(1, Math.max(0, view.alpha));
      view.mat.opacity = 0.5 * view.alpha;
      view.bell.material.opacity = 0.45 * view.alpha;
      if (view.alpha <= 0 && !live.has(key)) {
        this.scene.remove(view.g);
        for (const l of view.lines) l.line.geometry.dispose();
        view.mat.dispose();
        view.bell.material.dispose();
        this.views.delete(key);
      }
    }
  }

  private spawn(key: string, v: { x: number; y: number }, hue: number): TendrilNode | undefined {
    lift(v.x, v.y, _v);
    if (_v.lengthSq() < 1e-6) return undefined;
    const g = new Group();
    g.position.copy(_v);
    // local +Y = radially out of the web; the tendrils hang down into the void
    g.quaternion.setFromUnitVectors(SHROOM_UP, _v2.copy(_v).normalize());
    const col = HUES[Math.max(0, Math.min(2, Math.floor(hue * 3)))];
    const mat = new LineBasicMaterial({
      color: col, transparent: true, opacity: 0,
      blending: AdditiveBlending, depthWrite: false,
    });
    // the glowing bell, so the creature reads from a distance, not just up close
    const bell = new Sprite(new SpriteMaterial({
      map: TEX.glow(), color: col, transparent: true, opacity: 0,
      blending: AdditiveBlending, depthWrite: false,
    }));
    bell.scale.setScalar(2.4 + hash01(`nb|${key}`) * 1.6);
    g.add(bell);
    const lines: TendrilNode['lines'] = [];
    const tn = 3 + Math.floor(hash01(`ntn|${key}`) * 3);
    for (let i = 0; i < tn; i++) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(TENDRIL_PTS * 3), 3).setUsage(DynamicDrawUsage));
      const line = new Line(geo, mat);
      line.frustumCulled = false;
      g.add(line);
      const a = (i / tn) * TAU + hash01(`na|${key}|${i}`) * 1.5;
      lines.push({
        line, ax: Math.cos(a), az: Math.sin(a),
        seed: hash01(`ns|${key}|${i}`) * 10,
        len: 2.6 + hash01(`nl|${key}|${i}`) * 3.4,
      });
    }
    this.scene.add(g);
    const view: TendrilNode = { g, lines, mat, bell, alpha: 0 };
    this.views.set(key, view);
    return view;
  }
}

// ── billboarded moments: scorch, blight fog, burn-off, flashes, ripples ────
type BillKind = 'scorch' | 'rim' | 'fog' | 'fire' | 'flash' | 'ring';
interface Bill { key: string; kind: BillKind; sprite: Sprite; mat: SpriteMaterial; born: number; dying: number; seed: number; }

class Billboards {
  private byKey = new Map<string, Bill>();
  private tex: Record<string, CanvasTexture>;

  constructor(private scene: Scene) {
    this.tex = {
      scorch: TEX.scorch(), fog: TEX.fog(), flash: TEX.flash(),
      ringTeal: TEX.ringTeal(), ringFire: TEX.ringFire(),
    };
  }

  private mapFor(kind: BillKind): CanvasTexture {
    switch (kind) {
      case 'scorch': return this.tex.scorch;
      case 'fog': return this.tex.fog;
      case 'flash': return this.tex.flash;
      case 'rim': case 'ring': return this.tex.ringTeal;
      case 'fire': return this.tex.ringFire;
    }
  }

  private ensure(key: string, kind: BillKind, x: number, y: number, t: number): Bill {
    let b = this.byKey.get(key);
    if (!b) {
      const color = kind === 'fog' ? 0x9a4ad8
        : kind === 'rim' ? 0xff8a5a
        : kind === 'fire' ? 0xffb26a
        : 0xffffff;
      const mat = new SpriteMaterial({
        map: this.mapFor(kind), color, transparent: true, depthWrite: false,
        blending: kind === 'scorch' ? NormalBlending : AdditiveBlending,
      });
      const sprite = new Sprite(mat);
      lift(x, y, sprite.position);
      sprite.renderOrder = kind === 'scorch' ? 0 : 5;
      sprite.scale.setScalar(0.001);
      this.scene.add(sprite);
      b = { key, kind, sprite, mat, born: t, dying: 0, seed: Math.random() * 10 };
      this.byKey.set(key, b);
    }
    return b;
  }

  update(sim: Sim, t: number): void {
    const wanted = new Set<string>();
    // scorches: a dark scar that swells, then fades over its long life
    for (const s of sim.scorchs) {
      const key = `sc|${s.x.toFixed(0)}|${s.y.toFixed(0)}`;
      wanted.add(key);
      const r = s.r * S * 2 * (1 + Math.min(1, s.t / 2) * 0.6);
      const b = this.ensure(key, 'scorch', s.x, s.y, t);
      b.sprite.scale.setScalar(Math.max(0.001, r));
      b.mat.opacity = Math.min(1, s.t / 0.6) * Math.max(0, 1 - s.t / 16) * 0.85;
      const rim = this.ensure(`rim|${s.x.toFixed(0)}|${s.y.toFixed(0)}`, 'rim', s.x, s.y, t);
      wanted.add(rim.key);
      rim.sprite.scale.setScalar(Math.max(0.001, r * 1.15));
      rim.mat.opacity = s.t < 2.4 ? 0.5 * (1 - s.t / 2.4) : 0;
    }
    // blight: a fog cluster that crawls, then a burn-off ring
    for (const bl of sim.blights) {
      for (let k = 0; k < 12; k++) {
        const hx = hash01(`fbx|${bl.target}|${k}`) * 2 - 1;
        const hy = hash01(`fby|${bl.target}|${k}`) * 2 - 1;
        const key = `fog|${bl.target}|${k}`;
        wanted.add(key);
        const b = this.ensure(key, 'fog', bl.x + hx * 6, bl.y + hy * 6, t);
        lift(bl.x + hx * 6, bl.y + hy * 6, _v);
        b.sprite.position.copy(_v);
        b.sprite.scale.setScalar(2.4 + hash01(`fs|${bl.target}|${k}`) * 3.2);
        const arrive = Math.min(1, bl.t / 3);
        b.mat.opacity = 0.2 * arrive * (bl.phase ? 0.25 : 1);
        b.mat.rotation = b.seed + t * 0.12;
      }
      if (bl.phase) {
        const key = `fire|${bl.target}`;
        wanted.add(key);
        const b = this.ensure(key, 'fire', bl.x, bl.y, t);
        const f = (bl.t - 7.4) / 1.6;
        if (f >= 0 && f <= 1.4) {
          b.sprite.scale.setScalar(2 + f * 40);
          b.mat.opacity = 0.8 * Math.max(0, 1 - f);
        } else {
          b.mat.opacity = 0;
        }
      }
    }
    // flashes (burn-off bloom, spore landings)
    for (const fl of sim.flashes) {
      const key = `fl|${fl.x.toFixed(0)}|${fl.y.toFixed(0)}|${fl.life}`;
      wanted.add(key);
      const b = this.ensure(key, 'flash', fl.x, fl.y, t);
      lift(fl.x, fl.y, _v);
      b.sprite.position.copy(_v);
      const f = fl.t / fl.life;
      b.sprite.scale.setScalar(Math.max(0.001, fl.r * S * 2 * (0.6 + f * 0.8)));
      b.mat.opacity = Math.max(0, 0.55 * (1 - f));
    }
    // fire-and-forget ripples: expand and fade over 1.6 s
    for (const b of this.byKey.values()) {
      if (b.kind !== 'ring') continue;
      const f = (t - b.born) / 1.6;
      if (f < 0 || f > 1) { b.mat.opacity = 0; continue; }
      b.sprite.scale.setScalar(0.5 + f * 12);
      b.mat.opacity = 0.6 * (1 - f);
    }
    // everything no longer wanted fades out over ~1 s, then is removed
    for (const b of this.byKey.values()) {
      if (wanted.has(b.key)) { b.dying = 0; continue; }
      if (!b.dying) b.dying = t;
      const f = 1 - (t - b.dying) / 1.0;
      if (f <= 0) {
        this.scene.remove(b.sprite);
        b.mat.dispose();
        this.byKey.delete(b.key);
        continue;
      }
      b.mat.opacity = Math.min(b.mat.opacity, 0.85 * f);
      if (b.kind === 'ring') b.mat.opacity = 0;
    }
  }

  /** A ripple at a nodule (system events, dhcp sprouts). */
  ripple(x: number, y: number, t: number, warm = false): void {
    const key = `ring|${x.toFixed(1)}|${y.toFixed(1)}|${t.toFixed(2)}`;
    const b = this.ensure(key, 'ring', x, y, t);
    if (warm) { b.mat.map = this.tex.ringFire; b.mat.color.set(0xffb26a); }
  }
}

// ── labels: names that follow mushrooms and hosts ──────────────────────────
interface Label {
  el: HTMLDivElement;
  key: string;
  anchor: (out: Vector3) => Vector3 | null;
}

class Labels {
  private byKey = new Map<string, Label>();
  private root: HTMLDivElement;
  private camPos = new Vector3();
  private cam: PerspectiveCamera | null = null;
  private w = 0;
  private h = 0;

  constructor(overlay: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'ug-overlay';
    overlay.appendChild(this.root);
  }

  setView(w: number, h: number): void { this.w = w; this.h = h; }
  setCam(cam: PerspectiveCamera | null): void { this.cam = cam; if (cam) this.camPos.copy(cam.position); }

  private ensure(key: string, text: string, blocked: boolean, anchor: (out: Vector3) => Vector3 | null): Label {
    let l = this.byKey.get(key);
    if (!l) {
      const el = document.createElement('div');
      el.className = 'ug-label';
      el.textContent = text;
      if (blocked) el.classList.add('blocked');
      this.root.appendChild(el);
      l = { el, key, anchor };
      this.byKey.set(key, l);
    }
    return l;
  }

  update(sim: Sim, opts: { hosts: boolean }): void {
    const wanted = new Set<string>();
    // mushroom domain labels
    for (const m of sim.shrooms) {
      const key = `sh|${m.label}`;
      wanted.add(key);
      this.ensure(key, m.label, m.blocked, (out) => this.shroomAnchor ? this.shroomAnchor(m, out) : null);
    }
    // host labels: the nearest sixteen to the camera
    if (opts.hosts) {
      const near: Array<{ n: { id: string; label: string; x: number; y: number }; d: number }> = [];
      for (const n of sim.nodes.values()) {
        lift(n.x, n.y, _v2);
        near.push({ n, d: _v2.distanceToSquared(this.camPos) });
      }
      near.sort((a, b) => a.d - b.d);
      for (const { n } of near.slice(0, 16)) {
        const key = `ho|${n.id}`;
        wanted.add(key);
        this.ensure(key, n.label, false, (out) => {
          lift(n.x, n.y, out);
          const l = Math.hypot(out.x, out.y, out.z) || 1; // nudge radially off the web
          out.x += (out.x / l) * 0.6; out.y += (out.y / l) * 0.6; out.z += (out.z / l) * 0.6;
          return out;
        });
      }
    }
    // project what is wanted, retire the rest
    const m4 = new Matrix4();
    const cam = this.cam;
    for (const [key, l] of [...this.byKey]) {
      if (!wanted.has(key)) {
        l.el.remove();
        this.byKey.delete(key);
        continue;
      }
      const p = l.anchor(_v);
      if (!cam || !p) { l.el.classList.remove('on'); l.el.style.visibility = 'hidden'; continue; }
      m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      p.applyMatrix4(m4);
      if (p.z > 1 || p.z < -1) { l.el.classList.remove('on'); l.el.style.visibility = 'hidden'; continue; }
      const x = (p.x + 1) / 2 * this.w;
      const y = (1 - p.y) / 2 * this.h;
      if (x < -80 || x > this.w + 80 || y < -40 || y > this.h + 40) { l.el.classList.remove('on'); l.el.style.visibility = 'hidden'; continue; }
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -130%)`;
      l.el.style.visibility = 'visible';
      l.el.classList.add('on');
    }
  }
  shroomAnchor: ((m: SimShroom, out: Vector3) => Vector3 | null) | null = null;
}

// ── the view: all of the above, driven by the shared sim ──────────────────
export interface ViewOpts {
  glow: number;
  hosts: boolean;
}

export class UndergrowthView {
  private web: FilamentWeb;
  private nodules: Nodules;
  private pulses: Pulses;
  private spores: Spores;
  private shrooms: Shrooms;
  private tendrils: NodeTendrils;
  private bills: Billboards;
  private labels: Labels;
  private cam: PerspectiveCamera;

  constructor(scene: Scene, overlay: HTMLElement, cam: PerspectiveCamera, budgets: { edges: number; nodes: number; pulses: number; spores: number }) {
    this.web = new FilamentWeb(scene, budgets.edges);
    this.nodules = new Nodules(scene, budgets.nodes);
    this.pulses = new Pulses(scene, budgets.pulses);
    this.spores = new Spores(scene, 400);
    this.shrooms = new Shrooms(scene);
    this.tendrils = new NodeTendrils(scene);
    this.bills = new Billboards(scene);
    this.labels = new Labels(overlay);
    this.labels.shroomAnchor = (m, out) => this.shrooms.anchor(m, out);
    this.cam = cam;
  }

  /** One frame. Returns pass-by count for the whoosh sfx (sign: -1 left, +1 right). */
  update(sim: Sim, t: number, opts: ViewOpts): number {
    this.web.update(sim, t, opts.glow);
    this.nodules.update(sim);
    this.pulses.setCam(this.cam.position);
    const passed = this.pulses.update(sim);
    this.spores.update(sim);
    this.shrooms.update(sim);
    this.tendrils.update(sim);
    this.bills.update(sim, t);
    this.labels.setCam(this.cam);
    this.labels.update(sim, { hosts: opts.hosts });
    return passed;
  }

  ripple(x: number, y: number, t: number, warm = false): void { this.bills.ripple(x, y, t, warm); }

  setPx(px: number): void {
    this.pulses.setPx(px);
    this.spores.setPx(px);
  }

  stats(sim: Sim): Record<string, string | number> {
    let edges = 0;
    for (const e of sim.E) if (!e.dead) edges++;
    return { threads: edges, hosts: sim.nodes.size, pulses: sim.pulses.length, blooms: sim.shrooms.length };
  }
}
