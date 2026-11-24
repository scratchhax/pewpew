import {
  AddEquation, BufferAttribute, BufferGeometry, CustomBlending, DynamicDrawUsage, LinearMipmapLinearFilter, OneFactor,
  Points, RepeatWrapping,
  Scene, ShaderMaterial, Vector4, type WebGLRenderer, type WebGLRenderTarget, OrthographicCamera,
} from 'three';
import { FullScreen, hdrTarget, pass } from './fsq';
import { NOISE_GLSL } from './noise';
import { GLSL_PHYS, DISK_R0, LOG_SPAN } from './physics';

/**
 * The accretion disk, kept in polar form (u = angle, v = log radius) so a
 * Keplerian orbit is just a sideways shift per row.
 *
 *  - The DEPOSIT is the disk's memory: two half-float targets ping-pong. Each
 *    frame the old one is carried round at each row's orbital speed and
 *    cools a little, then this frame's heat is splatted on top (hot spots
 *    from traffic, the debris stream of a shredded star). Because inner rows
 *    turn faster than outer ones, anything splatted shears into an arc.
 *  - The EMISSION pass turns that into what the tracer samples: the base
 *    disk (a Novikov–Thorne-ish brightness and temperature profile, turbulent
 *    filaments that turn with the flow), plus deposits and gravitational-wave
 *    ripples. Output: R = brightness, G = temperature / 10000 K, B = opacity.
 */
export const RIPPLES = 4;
const MAX_SPLATS = 6000;

const ADVECT = /* glsl */`
  precision highp float;
  ${GLSL_PHYS}
  uniform sampler2D uPrev;
  uniform float uDt, uDecay, uDrift;
  varying vec2 vUv;
  void main() {
    float r = radiusAt(vUv.y);
    float du = omegaAt(r) * uDt / TAU;
    vec4 p = texture(uPrev, vec2(vUv.x - du, vUv.y + uDrift * uDt));
    gl_FragColor = clamp(p * uDecay, 0.0, 4000.0);
  }`;

const EMIT = /* glsl */`
  precision highp float;
  ${GLSL_PHYS}
  ${NOISE_GLSL}
  uniform sampler2D uDep;
  uniform float uTime, uAccretion, uChurn, uFeed, uTemp, uDim;
  uniform vec4 uRipple[${RIPPLES}];
  varying vec2 vUv;

  // long concentric filaments (high radial, low azimuthal frequency) broken
  // into clumps that are still drawn out along the orbit
  float turb(float r, float phi, float seed) {
    float lr = log(r);
    vec3 p = vec3(cos(phi) * 2.1, sin(phi) * 2.1, lr * 40.0 + seed);
    float rings = fbm(p, OCT) * 0.5 + 0.5;
    vec3 q = vec3(cos(phi) * 5.0, sin(phi) * 5.0, lr * 22.0 + seed * 1.3);
    float clumps = gnoise(q) * 0.5 + 0.5;
    float lanes = 1.0 - abs(gnoise(vec3(cos(phi) * 1.4, sin(phi) * 1.4, lr * 70.0 + seed * 0.7)));
    return rings * (0.45 + 1.0 * clumps * clumps) * (0.7 + 0.5 * lanes * lanes);
  }

  void main() {
    float r = radiusAt(vUv.y);
    float phi = vUv.x * TAU;
    float inner = smoothstep(2.45, 3.4, r);
    float outer = 1.0 - smoothstep(8.5, 17.0, r);
    float prof = pow(3.0 / max(r, 2.7), 2.3) * inner * outer;

    // turbulence that turns with the flow: two phases, cross-faded so the
    // shear never runs away (each phase lasts a third of an orbit at its radius)
    float om = omegaAt(r);
    float period = 0.33 * TAU / om;
    float t1 = mod(uTime, period);
    float t2 = mod(uTime + 0.5 * period, period);
    float w1 = 1.0 - abs(2.0 * t1 / period - 1.0);
    float n = turb(r, phi - om * t1, 0.0) * w1 + turb(r, phi - om * t2, 31.0) * (1.0 - w1);

    float contrast = mix(1.4, 2.2, uChurn);
    float dens = prof * (0.12 + 1.6 * pow(max(n, 0.0), contrast));
    dens *= 1.0 + 0.16 * sin(2.0 * phi - 4.2 * log(r) + uTime * 0.04);

    vec4 dep = texture(uDep, vUv);
    float heat = dep.g * 0.05;
    dens += dep.r * 0.08 * smoothstep(2.3, 2.9, r) * (1.0 - smoothstep(11.0, 17.5, r));

    float rip = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 q = uRipple[i];
      if (q.y <= 0.0) continue;
      // a gravitational wave: a bright compressed crest with a rarefied trough behind it,
      // its arms wound into a gentle two-armed spiral
      float x = (r - q.x - 0.35 * sin(2.0 * phi + q.w)) / q.z;
      rip += q.y * (exp(-x * x) - 0.55 * exp(-(x + 1.7) * (x + 1.7)));
    }
    dens *= max(0.2, 1.0 + 3.0 * rip);

    float temp = uTemp * 0.58 * pow(3.0 / max(r, 3.0), 0.72)
      * (1.0 + 0.55 * clamp(heat, 0.0, 2.5)) * (1.0 + 0.22 * uFeed) * (1.0 + 0.35 * max(rip, 0.0));
    float bright = dens * uAccretion * uDim * (1.0 + 1.1 * uFeed) * (1.0 + 0.6 * clamp(heat, 0.0, 2.0));
    float alpha = clamp(dens * 2.6 * mix(1.0, 0.4, smoothstep(6.0, 16.0, r)), 0.0, 0.97);
    gl_FragColor = vec4(bright, temp, alpha, 1.0);
  }`;

export interface DiskDrive {
  time: number;
  accretion: number;   // overall brightness
  churn: number;       // turbulence contrast (traffic weather)
  feed: number;        // a shredded star feeding the disk 0..1
  temp: number;        // temperature scale (setting)
  dim: number;         // system-log dimming 0..1
}

export class Disk {
  W = 0;
  H = 0;
  private dep: [WebGLRenderTarget, WebGLRenderTarget] | null = null;
  private cur = 0;
  out: WebGLRenderTarget | null = null;
  private fs: FullScreen;
  private advect: ShaderMaterial;
  private emit: ShaderMaterial;
  private splatScene = new Scene();
  private splatCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private splatGeo = new BufferGeometry();
  private splatPos = new Float32Array(MAX_SPLATS * 3);
  private splatVal = new Float32Array(MAX_SPLATS * 3);
  private nSplats = 0;
  readonly ripples: Vector4[] = Array.from({ length: RIPPLES }, () => new Vector4(0, 0, 1, 0));

  constructor(fs: FullScreen, res: number, octaves: number) {
    this.fs = fs;
    this.advect = pass(ADVECT, { uPrev: { value: null }, uDt: { value: 0 }, uDecay: { value: 1 }, uDrift: { value: 0 } });
    this.emit = pass(EMIT, {
      uDep: { value: null }, uTime: { value: 0 }, uAccretion: { value: 1 }, uChurn: { value: 0 }, uFeed: { value: 0 },
      uTemp: { value: 1 }, uDim: { value: 1 }, uRipple: { value: this.ripples },
    }, { OCT: octaves });
    this.splatGeo.setAttribute('position', new BufferAttribute(this.splatPos, 3).setUsage(DynamicDrawUsage));
    this.splatGeo.setAttribute('aVal', new BufferAttribute(this.splatVal, 3).setUsage(DynamicDrawUsage));
    const splatMat = new ShaderMaterial({
      vertexShader: /* glsl */`
        attribute vec3 aVal;
        varying vec2 vVal;
        void main() {
          vVal = aVal.yz;
          gl_PointSize = aVal.x;
          gl_Position = vec4(position.xy * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vVal;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float g = exp(-dot(c, c) * 4.0) - 0.0183;
          if (g <= 0.0) discard;
          gl_FragColor = vec4(vVal.x * g, vVal.y * g, 0.0, 0.0);
        }`,
      // plain ONE + ONE: three's AdditiveBlending scales by source alpha, which is 0 here
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor,
      blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor,
      depthTest: false, depthWrite: false, transparent: true,
    });
    const pts = new Points(this.splatGeo, splatMat);
    pts.frustumCulled = false;
    this.splatScene.add(pts);
    this.setRes(res);
  }

  /** 1 = 768×256, 2 = 1536×512, 3 = 3072×1024 (width = 3 × height keeps texels square on the disk). */
  setRes(level: number): void {
    const H = level >= 3 ? 1024 : level >= 2 ? 512 : 256;
    const W = H * 3;
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.dep?.[0].dispose(); this.dep?.[1].dispose(); this.out?.dispose();
    this.dep = [hdrTarget(W, H, RepeatWrapping), hdrTarget(W, H, RepeatWrapping)];
    // the tracer picks a mip level from each pixel's footprint on the disk, so
    // the outer disk seen edge-on is filtered instead of shimmering
    this.out = hdrTarget(W, H, RepeatWrapping);
    this.out.texture.generateMipmaps = true;
    this.out.texture.minFilter = LinearMipmapLinearFilter;
    this.cur = 0;
  }

  setOctaves(n: number): void {
    if (this.emit.defines.OCT === n) return;
    this.emit.defines.OCT = n;
    this.emit.needsUpdate = true;
  }

  /**
   * Heat on the disk at (x, z) this frame. `size` is in Rs; `amount` and `heat`
   * are per second (they accumulate frame over frame and cool with the deposit).
   */
  splat(x: number, z: number, size: number, amount: number, heat: number, dt: number): void {
    const r = Math.hypot(x, z);
    if (r < DISK_R0 || r > DISK_R0 * Math.exp(LOG_SPAN)) return;
    let u = Math.atan2(z, x) / (Math.PI * 2);
    if (u < 0) u += 1;
    const v = Math.log(r / DISK_R0) / LOG_SPAN;
    const px = Math.max(1.5, Math.min(96, (size / r) * this.W / (Math.PI * 2)));
    const a = amount * dt, h = heat * dt;
    this.push(u, v, px, a, h);
    const half = px / this.W;
    if (u < half) this.push(u + 1, v, px, a, h);
    else if (u > 1 - half) this.push(u - 1, v, px, a, h);
  }

  private push(u: number, v: number, px: number, a: number, h: number): void {
    if (this.nSplats >= MAX_SPLATS) return;
    const i = this.nSplats++;
    this.splatPos[i * 3] = u; this.splatPos[i * 3 + 1] = v; this.splatPos[i * 3 + 2] = 0;
    this.splatVal[i * 3] = px; this.splatVal[i * 3 + 1] = a; this.splatVal[i * 3 + 2] = h;
  }

  get splats(): number { return this.nSplats; }

  update(r: WebGLRenderer, dt: number, d: DiskDrive): void {
    if (!this.dep || !this.out) return;
    const prev = this.dep[this.cur], next = this.dep[1 - this.cur];
    const au = this.advect.uniforms;
    au.uPrev.value = prev.texture;
    au.uDt.value = dt;
    au.uDecay.value = Math.exp(-dt / 9);
    au.uDrift.value = 0.004;
    this.fs.render(r, this.advect, next);

    if (this.nSplats > 0) {
      (this.splatGeo.attributes.position as BufferAttribute).needsUpdate = true;
      (this.splatGeo.attributes.aVal as BufferAttribute).needsUpdate = true;
      this.splatGeo.setDrawRange(0, this.nSplats);
      r.setRenderTarget(next);
      const auto = r.autoClear;
      r.autoClear = false;
      r.render(this.splatScene, this.splatCam);
      r.autoClear = auto;
    }
    this.nSplats = 0;
    this.cur = 1 - this.cur;

    const eu = this.emit.uniforms;
    eu.uDep.value = next.texture;
    eu.uTime.value = d.time;
    eu.uAccretion.value = d.accretion;
    eu.uChurn.value = d.churn;
    eu.uFeed.value = d.feed;
    eu.uTemp.value = d.temp;
    eu.uDim.value = d.dim;
    this.fs.render(r, this.emit, this.out);
  }

  dispose(): void {
    this.dep?.[0].dispose(); this.dep?.[1].dispose(); this.out?.dispose();
    this.advect.dispose(); this.emit.dispose(); this.splatGeo.dispose();
  }
}
