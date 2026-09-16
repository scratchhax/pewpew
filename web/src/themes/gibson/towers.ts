import {
  AdditiveBlending, BoxGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshBasicMaterial, ShaderMaterial, Vector3, type Scene,
} from 'three';
import type { TextAtlas } from './textatlas';

/**
 * The storage wall: a corridor of translucent monoliths lining the way
 * toward the vanishing point, always standing tall as you fly through them,
 * each face covered in glowing cyan listings from the atlas — words in tidy
 * digital boxes — scrolling up or down, with the edge-lit rim-frame of the
 * movie's perspex towers. Towers drift past and recycle at the far edge.
 * Events flash faces white-cyan, or burn a tower red while it's flagged.
 */

const SP_X = 2.6;
const SP_Z = 2.4;
const CAM_Z = 7;

const VERT = /* glsl */`
  attribute float aSeed;
  attribute float aScroll;
  attribute float aFlash;
  attribute float aRed;
  attribute float aH;
  varying vec3 vLocal, vWorld, vN;
  varying float vSeed, vScroll, vFlash, vRed, vH;
  void main() {
    vLocal = position;
    vSeed = aSeed; vScroll = aScroll; vFlash = aFlash; vRed = aRed; vH = aH;
    vec4 wp = instanceMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vN = mat3(instanceMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uAtlas;
  uniform float uCols, uRows, uPitch, uFogD, uPulse;
  uniform vec3 uCamPos, uFill, uEdge, uText, uRed, uTextRed;
  varying vec3 vLocal, vWorld, vN;
  varying float vSeed, vScroll, vFlash, vRed, vH;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    vec3 n = normalize(vN);
    float top = step(0.5, abs(n.y));
    float u = abs(n.x) > 0.5 ? (vLocal.z + 0.5) : (vLocal.x + 0.5);
    float v = vLocal.y + 0.5;
    // the edge-lit rim of the film's perspex towers: thin, bright, white-cyan.
    // measured along each face's own two axes, so tops keep a rim square and
    // not a full white slab
    float ex = 0.5 - abs(vLocal.x);
    float ey = 0.5 - abs(vLocal.y);
    float ez = 0.5 - abs(vLocal.z);
    float e = top > 0.5 ? min(ex, ez) : (abs(n.x) > 0.5 ? min(ey, ez) : min(ex, ey));
    float frame = smoothstep(0.035, 0.004, e);
    // scrolling word strips: one atlas cell (one whole word) per line, the
    // cell aspect matching the face strip so glyphs read as words, not bars
    float g = (v * vH + vScroll) / uPitch;
    float idx = floor(g);
    float f = g - idx;
    float hs = h21(vec2(vSeed * 91.7 + 13.0, idx + 0.5));
    float cx = floor(mod(hs * 997.0, uCols));
    float cy = floor(mod(hs * 39187.0, uRows));
    vec2 tuv = vec2((cx + 0.04 + u * 0.92) / uCols, (cy + 0.05 + f * 0.9) / uRows);
    vec3 tcol = texture2D(uAtlas, tuv).rgb;
    float tx = max(tcol.r, max(tcol.g, tcol.b)) * (1.0 - top);
    vec3 fill = mix(uFill, uRed * 0.22, vRed);
    vec3 edge = mix(uEdge, uRed, vRed);
    vec3 textC = mix(uText, uTextRed, vRed);
    vec3 col = fill * 0.35;
    col += edge * frame * (0.5 + vFlash * 2.6);
    col += textC * tx * (1.6 + vFlash * 2.2) * uPulse;
    col += edge * vFlash * 0.12;
    col *= mix(1.0, 0.3, top);
    // black fog: the far wall dissolves, like the film's storage cavern
    float d = length(vWorld - uCamPos);
    col *= exp(-uFogD * uFogD * d * d);
    gl_FragColor = vec4(col, 1.0);
  }`;

export interface LockPick { x: number; y: number; z: number; index: number; }
export interface FacePick { x: number; y: number; z: number; side: number; }

export class Towers {
  mesh!: InstancedMesh;
  hull!: InstancedMesh;
  readonly material: ShaderMaterial;
  private n = 0;
  private x!: Float32Array; private z!: Float32Array; private h!: Float32Array; private hT!: Float32Array;
  private scroll!: Float32Array; private scrollV!: Float32Array; private flash!: Float32Array; private redT!: Float32Array;
  private aSeed!: InstancedBufferAttribute; private aScroll!: InstancedBufferAttribute;
  private aFlash!: InstancedBufferAttribute; private aRed!: InstancedBufferAttribute; private aH!: InstancedBufferAttribute;
  private m = new Matrix4();
  cols = 0; rows = 0;

  constructor(scene: Scene, atlas: TextAtlas) {
    this.material = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uCols: { value: atlas.cols },
        uRows: { value: atlas.rows },
        uPitch: { value: 0.75 },
        uFogD: { value: 0.044 },
        uPulse: { value: 1 },
        uCamPos: { value: new Vector3(0, 5.5, 7) },
        uFill: { value: new Color(0x061016) },
        uEdge: { value: new Color(0x9fefff) },
        uText: { value: new Color(0x53e0ff) },
        uRed: { value: new Color(0xff2e2e) },
        uTextRed: { value: new Color(0xffb8b8) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      // translucent hologram glass: additive and depth-write off, so towers
      // behind show through the ones in front, order-independent on black
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.build(scene, 7, 10);
  }

  /** Rebuild the grid (settings changed): cols × rows towers. */
  build(scene: Scene, cols: number, rows: number): void {
    if (this.mesh) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.hull) scene.remove(this.hull);
    this.cols = cols; this.rows = rows;
    this.n = cols * rows;
    const geo = new BoxGeometry(1, 1, 1);
    const f = (fill: number | ((i: number) => number)): Float32Array => {
      const a = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) a[i] = typeof fill === 'function' ? fill(i) : fill;
      return a;
    };
    // a corridor down the middle for the camera, like the film: lanes of
    // towers line the left and right, the centre stays an open data path
    const half = Math.ceil(cols / 2);
    this.x = f((i) => {
      const j = i % cols;
      const side = j < half ? -1 : 1;
      return side * (1.1 + (j % half)) * SP_X;
    });
    this.z = f((i) => -5 - Math.floor(i / cols) * SP_Z);
    this.hT = f(() => 3 + Math.random() * 5);
    this.h = f((i) => this.hT[i]);
    this.scroll = f(() => Math.random() * 64);
    this.scrollV = f(() => (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.1));
    this.flash = f(0);
    this.redT = f(0);
    this.aSeed = inst('aSeed', f(() => Math.random()), geo);
    this.aScroll = inst('aScroll', this.scroll, geo, true);
    this.aFlash = inst('aFlash', this.flash, geo, true);
    this.aRed = inst('aRed', this.redT, geo, true);
    this.aH = inst('aH', this.h, geo, true);
    this.mesh = new InstancedMesh(geo, this.material, this.n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    // a dim solid hull behind the additive glow: gives the towers a little
    // body, so ones behind go softly dark through them instead of staying crisp
    this.hull = new InstancedMesh(geo, new MeshBasicMaterial({
      color: new Color(0x06141d), transparent: true, opacity: 0.5, depthWrite: false,
    }), this.n);
    this.hull.instanceMatrix.setUsage(DynamicDrawUsage);
    this.hull.frustumCulled = false;
    scene.add(this.hull);
  }

  get span(): number { return this.rows * SP_Z; }

  /** u ∈ 0..1 picks a column; flashes the nearest tower in it. */
  pulse(u: number): void { this.nearest(u, (i) => { this.flash[i] = 1; }); }

  /** u ∈ 0..1 picks a column; burns the nearest tower red for `secs`. */
  flag(u: number, secs: number): void { this.nearest(u, (i) => { this.redT[i] = Math.max(this.redT[i], secs); }); }

  /** A file is being written: a far tower in the column nearest u rewrites itself. */
  raise(u: number): void {
    const xt = (u - 0.5) * this.cols * SP_X;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.z[i] > -this.span * 0.45) continue;
      const d = Math.abs(this.x[i] - xt) - this.z[i] * 0.02;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    this.hT[best] = this.h[best] = 3 + Math.random() * 5;
    this.flash[best] = 1;
    this.aSeed.setX(best, Math.random());
  }

  /** Pick a mid-depth tower, burn it red, and hand it to the camera to lock. */
  pickLock(): LockPick | null {
    const cand: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.z[i] < -this.span * 0.35 && this.z[i] > -this.span * 0.8 && this.redT[i] <= 0) cand.push(i);
    if (!cand.length) for (let i = 0; i < this.n; i++) if (this.redT[i] <= 0) cand.push(i);
    if (!cand.length) return null;
    const i = cand[(Math.random() * cand.length) | 0];
    this.redT[i] = 14;
    return { x: this.x[i], y: this.h[i] * 0.6, z: this.z[i], index: i };
  }

  /** Pick a far tower's corridor-facing side for a sign to hang on. */
  pickFace(): FacePick | null {
    const cand: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.z[i] < -this.span * 0.4 && this.h[i] > 4) cand.push(i);
    if (!cand.length) return null;
    const i = cand[(Math.random() * cand.length) | 0];
    const side = this.x[i] > 0 ? -1 : 1;
    return { x: this.x[i] + side * 0.55, y: this.h[i] * (0.5 + Math.random() * 0.3), z: this.z[i], side };
  }

  redCount(): number { let k = 0; for (let i = 0; i < this.n; i++) if (this.redT[i] > 0) k++; return k; }

  update(dt: number, speed: number, camPos: Vector3): void {
    const span = this.span;
    for (let i = 0; i < this.n; i++) {
      this.z[i] += speed * dt;
      if (this.z[i] > CAM_Z + 2) {
        this.z[i] -= span;
        this.hT[i] = 3 + Math.random() * 5;
        this.h[i] = this.hT[i];
        this.aSeed.setX(i, Math.random());
      }
      this.scroll[i] += this.scrollV[i] * dt;
      this.flash[i] *= Math.exp(-dt * 2.6);
      if (this.redT[i] > 0) this.redT[i] -= dt;
      this.m.makeScale(1, this.h[i], 1);
      this.m.setPosition(this.x[i], this.h[i] / 2, this.z[i]);
      this.mesh.setMatrixAt(i, this.m);
      this.aScroll.setX(i, this.scroll[i]);
      this.aFlash.setX(i, this.flash[i]);
      this.aRed.setX(i, Math.max(0, Math.min(1, this.redT[i])));
      this.aH.setX(i, this.h[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.hull.instanceMatrix.array as Float32Array).set(this.mesh.instanceMatrix.array as Float32Array);
    this.hull.instanceMatrix.needsUpdate = true;
    this.aSeed.needsUpdate = true;
    this.aScroll.needsUpdate = this.aFlash.needsUpdate = this.aRed.needsUpdate = this.aH.needsUpdate = true;
    this.material.uniforms.uCamPos.value.copy(camPos);
  }

  private nearest(u: number, hit: (i: number) => void): void {
    const xt = (u - 0.5) * this.cols * SP_X;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.z[i] > CAM_Z || this.z[i] < -this.span) continue;
      const d = Math.abs(this.x[i] - xt) * 2 - this.z[i];
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) hit(best);
  }
}

function inst(name: string, arr: Float32Array, geo: BoxGeometry, dyn = false): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(arr, 1);
  if (dyn) a.setUsage(DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}
