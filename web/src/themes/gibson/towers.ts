import {
  AdditiveBlending, BoxGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshBasicMaterial, ShaderMaterial, Vector3, type Scene,
} from 'three';
import type { TextAtlas } from './textatlas';

/**
 * The computer city: a static lattice of tower blocks on a grid, with open
 * streets running between them on both axes. Nothing here moves through the
 * world - the camera flies through it. Each tower lives in a block of the
 * lattice; the blocks themselves wrap around the camera's current block, so
 * the city is endless in every direction the flight turns toward, and the
 * streets always line up because everything hangs off the same lattice.
 * Faces carry the listings atlas, scroll up or down, flash white-cyan on
 * events, or burn red while a file is flagged.
 */

const SP_X = 2.6;
/** the city's block period: street + block + street, same on both axes */
export const CITY_P = 13;
/** the flight turns on arcs of this radius - it fits inside the street width */
export const TURN_R = 3;

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
    // black fog: the far blocks dissolve, like the film's storage cavern
    float d = length(vWorld - uCamPos);
    col *= exp(-uFogD * uFogD * d * d);
    gl_FragColor = vec4(col, 1.0);
  }`;

export interface LockPick { x: number; y: number; z: number; index: number; }
export interface FacePick { x: number; y: number; z: number; nx: number; nz: number; }

export class Towers {
  mesh!: InstancedMesh;
  hull!: InstancedMesh;
  readonly material: ShaderMaterial;
  private n = 0;
  /** fixed lattice slot of each tower, and its offset within the block */
  private bi!: Int32Array; private bj!: Int32Array;
  private lx!: Float32Array; private lz!: Float32Array;
  /** current world position, recomputed from the lattice every frame */
  private x!: Float32Array; private z!: Float32Array;
  private h!: Float32Array; private hT!: Float32Array;
  private scroll!: Float32Array; private scrollV!: Float32Array; private flash!: Float32Array; private redT!: Float32Array;
  private prevB!: Int32Array;
  private aSeed!: InstancedBufferAttribute; private aScroll!: InstancedBufferAttribute;
  private aFlash!: InstancedBufferAttribute; private aRed!: InstancedBufferAttribute; private aH!: InstancedBufferAttribute;
  private m = new Matrix4();
  cols = 0; rows = 0;
  /** last camera position + heading, kept for the event pickers */
  private camX = 0; private camZ = 0; private fx = 0; private fz = -1;

  constructor(scene: Scene, atlas: TextAtlas) {
    this.material = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uCols: { value: atlas.cols },
        uRows: { value: atlas.rows },
        uPitch: { value: 0.75 },
        uFogD: { value: 0.044 },
        uPulse: { value: 1 },
        uCamPos: { value: new Vector3(0, 2.5, 40) },
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

  /**
   * Rebuild the city (settings changed): a lattice of cols x rows blocks
   * wrapping around the camera's block, each block a 3x3 grove of towers.
   * Streets run along the lattice lines; the flight rides the streets.
   */
  build(scene: Scene, cols: number, rows: number): void {
    if (this.mesh) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.hull) scene.remove(this.hull);
    this.cols = cols; this.rows = rows;
    const nbi = Math.max(4, cols);
    const nbj = Math.max(6, rows * 2);
    this.n = nbi * nbj * 9;
    const geo = new BoxGeometry(1, 1, 1);
    this.bi = new Int32Array(this.n); this.bj = new Int32Array(this.n);
    this.lx = new Float32Array(this.n); this.lz = new Float32Array(this.n);
    this.prevB = new Int32Array(this.n).fill(-99999);
    let t = 0;
    for (let bj = 0; bj < nbj; bj++) {
      for (let bi = 0; bi < nbi; bi++) {
        for (let slot = 0; slot < 9 && t < this.n; slot++, t++) {
          this.bi[t] = bi; this.bj[t] = bj;
          this.lx[t] = ((slot % 3) - 1) * SP_X;
          this.lz[t] = (((slot / 3) | 0) - 1) * SP_X;
        }
      }
    }
    const f = (fill: number | ((i: number) => number)): Float32Array => {
      const a = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) a[i] = typeof fill === 'function' ? fill(i) : fill;
      return a;
    };
    this.x = f(0); this.z = f(0);
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

  /** u ∈ 0..1 picks a lateral column of the view; flashes the nearest tower. */
  pulse(u: number): void { this.nearest(u, (i) => { this.flash[i] = 1; }); }

  /** u ∈ 0..1 picks a lateral column; burns the nearest tower red for `secs`. */
  flag(u: number, secs: number): void { this.nearest(u, (i) => { this.redT[i] = Math.max(this.redT[i], secs); }); }

  /** A file is being written: a far tower in the lateral column nearest u rewrites itself. */
  raise(u: number): void {
    const lat = (u - 0.5) * this.cols * SP_X * 1.6;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const ahead = (this.x[i] - this.camX) * this.fx + (this.z[i] - this.camZ) * this.fz;
      if (ahead < CITY_P * 2 || ahead > this.rows * CITY_P * 0.6) continue;
      const side = (this.x[i] - this.camX) * -this.fz + (this.z[i] - this.camZ) * this.fx;
      const d = Math.abs(side - lat) * 2 - ahead * 0.02;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    this.hT[best] = this.h[best] = 3 + Math.random() * 5;
    this.flash[best] = 1;
    this.aSeed.setX(best, Math.random());
  }

  /** Pick a mid-depth tower ahead, burn it red, and hand it to the camera to lock. */
  pickLock(): LockPick | null {
    const cand: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const ahead = (this.x[i] - this.camX) * this.fx + (this.z[i] - this.camZ) * this.fz;
      if (ahead > CITY_P * 1.2 && ahead < this.rows * CITY_P * 0.5 && this.redT[i] <= 0) cand.push(i);
    }
    if (!cand.length) for (let i = 0; i < this.n; i++) if (this.redT[i] <= 0) cand.push(i);
    if (!cand.length) return null;
    const i = cand[(Math.random() * cand.length) | 0];
    this.redT[i] = 14;
    return { x: this.x[i], y: this.h[i] * 0.6, z: this.z[i], index: i };
  }

  /** Pick a far tower face that looks back down the street, for a sign to hang on. */
  pickFace(): FacePick | null {
    const cand: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const ahead = (this.x[i] - this.camX) * this.fx + (this.z[i] - this.camZ) * this.fz;
      if (ahead > CITY_P * 1.5 && ahead < this.rows * CITY_P * 0.6 && this.h[i] > 4) cand.push(i);
    }
    if (!cand.length) return null;
    const i = cand[(Math.random() * cand.length) | 0];
    // the face turned back toward the flight: whichever axis points at the camera
    const dx = this.camX - this.x[i], dz = this.camZ - this.z[i];
    const along = Math.abs(dz * this.fz + dx * this.fx);
    const across = Math.abs(dz * this.fx - dx * this.fz);
    let nx = 0, nz = 0;
    if (Math.abs(dz) > Math.abs(dx)) nz = dz > 0 ? 1 : -1; else nx = dx > 0 ? 1 : -1;
    void along; void across;
    return { x: this.x[i] + nx * 0.55, y: this.h[i] * (0.5 + Math.random() * 0.3), z: this.z[i] + nz * 0.55, nx, nz };
  }

  redCount(): number { let k = 0; for (let i = 0; i < this.n; i++) if (this.redT[i] > 0) k++; return k; }
  get count(): number { return this.n; }

  /**
   * Recompute every tower from its lattice slot, wrapped around the camera's
   * block: the towers never move through the world; the camera does. A tower
   * only changes when it wraps to the far side of the fog, where it re-seeds.
   */
  update(dt: number, camX: number, camZ: number, k: number): void {
    this.camX = camX; this.camZ = camZ;
    this.fx = k === 1 ? 1 : k === 3 ? -1 : 0;
    this.fz = k === 0 ? 1 : k === 2 ? -1 : 0;
    const nbi = Math.max(4, this.cols);
    const nbj = Math.max(6, this.rows * 2);
    const cbx = Math.floor(camX / CITY_P);
    const cbz = Math.floor(camZ / CITY_P);
    const hbi = nbi >> 1, hbz = nbj >> 1;
    for (let i = 0; i < this.n; i++) {
      const ri = mod(this.bi[i] - cbx + hbi, nbi) - hbi;
      const rj = mod(this.bj[i] - cbz + hbz, nbj) - hbz;
      const b = (cbx + ri) * 73856093 ^ (cbz + rj) * 19349663;
      if (b !== this.prevB[i]) {
        // wrapped to a fresh far-side block: a new tower rises there
        this.prevB[i] = b;
        this.hT[i] = 3 + Math.random() * 5;
        this.h[i] = this.hT[i];
        this.aSeed.setX(i, Math.random());
      }
      this.x[i] = (cbx + ri + 0.5) * CITY_P + this.lx[i];
      this.z[i] = (cbz + rj + 0.5) * CITY_P + this.lz[i];
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
    this.material.uniforms.uCamPos.value.set(camX, 2.5, camZ);
  }

  private nearest(u: number, hit: (i: number) => void): void {
    const lat = (u - 0.5) * this.cols * SP_X * 1.6;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - this.camX, dz = this.z[i] - this.camZ;
      const ahead = dx * this.fx + dz * this.fz;
      if (ahead < 2 || ahead > this.rows * CITY_P * 0.55) continue;
      const side = dx * -this.fz + dz * this.fx;
      const d = Math.abs(side - lat) * 2 - ahead * 0.02;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) hit(best);
  }
}

function mod(a: number, n: number): number { return ((a % n) + n) % n; }

function inst(name: string, arr: Float32Array, geo: BoxGeometry, dyn = false): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(arr, 1);
  if (dyn) a.setUsage(DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}
