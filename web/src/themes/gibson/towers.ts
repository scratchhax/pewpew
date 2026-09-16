import {
  BoxGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh,
  Matrix4, ShaderMaterial, Vector3, type Scene,
} from 'three';
import type { TextAtlas } from './textatlas';

/**
 * The storage wall: a grid of glowing monoliths drifting toward the camera,
 * each face showing a few lines of the listings atlas scrolling up or down,
 * with the etched edge-frame of the movie's perspex towers. Towers scroll
 * past, recycle at the far edge and rise back in. Events flash faces white-
 * blue, or burn a tower red while it's flagged.
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
  uniform float uRows, uLinesPerUnit, uFogD, uPulse;
  uniform vec3 uCamPos, uTower, uText, uRed, uTextRed;
  varying vec3 vLocal, vWorld, vN;
  varying float vSeed, vScroll, vFlash, vRed, vH;
  void main() {
    vec3 n = normalize(vN);
    float top = step(0.5, abs(n.y));
    float u = abs(n.x) > 0.5 ? (vLocal.z + 0.5) : (vLocal.x + 0.5);
    float v = vLocal.y + 0.5;
    // the etched frame around each face, brightest thing after the text
    float e = min(min(u, 1.0 - u), min(v, 1.0 - v));
    float frame = smoothstep(0.05, 0.012, e);
    // pick one whole atlas line so the text never bleeds across two
    float lines = max(1.0, floor(vH * uLinesPerUnit));
    float row = floor(v * lines + vScroll + vSeed * 17.0);
    row = mod(row, uRows);
    float tx = texture2D(uAtlas, vec2(u, (row + 0.5) / uRows)).r;
    tx *= 1.0 - top;
    vec3 towerC = mix(uTower, uRed, vRed);
    vec3 textC = mix(uText, uTextRed, vRed);
    vec3 col = towerC * (0.045 + frame * (0.55 + vFlash * 2.2));
    col += textC * tx * (0.7 + vFlash * 2.4) * uPulse;
    col += towerC * vFlash * 0.16;
    col *= mix(1.0, 0.22, top);
    // black fog: the far wall dissolves, like the film's storage cavern
    float d = length(vWorld - uCamPos);
    col *= exp(-uFogD * uFogD * d * d);
    gl_FragColor = vec4(col, 1.0);
  }`;

export interface LockPick { x: number; y: number; z: number; index: number; }

export class Towers {
  mesh!: InstancedMesh;
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
        uRows: { value: atlas.rows },
        uLinesPerUnit: { value: 1.15 },
        uFogD: { value: 0.044 },
        uPulse: { value: 1 },
        uCamPos: { value: new Vector3(0, 8, 7) },
        uTower: { value: new Color(0x3a3aff) },
        uText: { value: new Color(0xddddff) },
        uRed: { value: new Color(0xff2626) },
        uTextRed: { value: new Color(0xffb0b0) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.build(scene, 7, 10);
  }

  /** Rebuild the grid (settings changed): cols × rows towers. */
  build(scene: Scene, cols: number, rows: number): void {
    if (this.mesh) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.cols = cols; this.rows = rows;
    this.n = cols * rows;
    const geo = new BoxGeometry(1, 1, 1);
    const f = (fill: number | ((i: number) => number)): Float32Array => {
      const a = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) a[i] = typeof fill === 'function' ? fill(i) : fill;
      return a;
    };
    // even column counts leave a corridor down the middle for the camera,
    // like the film: towers pass on both sides, never through the lens
    this.x = f((i) => ((i % cols) - cols / 2 + 0.5) * SP_X);
    this.z = f((i) => -5 - Math.floor(i / cols) * SP_Z);
    this.hT = f(() => 3 + Math.random() * 5);
    this.h = f(0);
    this.scroll = f(() => Math.random() * 64);
    this.scrollV = f(() => (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.35));
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
    scene.add(this.mesh);
  }

  get span(): number { return this.rows * SP_Z; }

  /** u ∈ 0..1 picks a column; flashes the nearest tower in it. */
  pulse(u: number): void { this.nearest(u, (i) => { this.flash[i] = 1; }); }

  /** u ∈ 0..1 picks a column; burns the nearest tower red for `secs`. */
  flag(u: number, secs: number): void { this.nearest(u, (i) => { this.redT[i] = Math.max(this.redT[i], secs); }); }

  /** A file is being written: recycle a far tower in the column nearest u and let it rise. */
  raise(u: number): void {
    const xt = (u - 0.5) * this.cols * SP_X;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.z[i] > -this.span * 0.45) continue;
      const d = Math.abs(this.x[i] - xt) - this.z[i] * 0.02;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    this.h[best] = 0.02;
    this.hT[best] = 3 + Math.random() * 5;
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

  redCount(): number { let k = 0; for (let i = 0; i < this.n; i++) if (this.redT[i] > 0) k++; return k; }

  update(dt: number, speed: number, camPos: Vector3): void {
    const span = this.span;
    for (let i = 0; i < this.n; i++) {
      this.z[i] += speed * dt;
      if (this.z[i] > CAM_Z + 2) {
        this.z[i] -= span;
        this.h[i] = 0.02;
        this.hT[i] = 3 + Math.random() * 5;
        this.aSeed.setX(i, Math.random());
      }
      this.h[i] += (this.hT[i] - this.h[i]) * Math.min(1, dt * 1.1);
      this.scroll[i] += this.scrollV[i] * dt * 2.4;
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
