import { AdditiveBlending, NoBlending, Vector2, type ShaderMaterial, type Texture, type WebGLRenderTarget, type WebGLRenderer } from 'three';
import { FullScreen, hdrTarget, pass } from './fsq';

/**
 * From the tracer's HDR frame to the screen.
 *
 *  - Bloom: a six-level mip chain (13-tap downsample, the first one
 *    luma-weighted so a single hot pixel on the photon ring can't sparkle),
 *    then a tent-filtered upsample added back level by level. It is wide and
 *    soft, the way a real lens scatters a very bright source.
 *  - Streak: a faint horizontal flare drawn out of the bloom, the anamorphic
 *    look of a cinema lens. Steady: it only follows what's already bright.
 *  - Composite: Catmull-Rom upscale of the trace (it can run below screen
 *    resolution), bloom and streak, exposure, AgX tone mapping with a little
 *    punch, a soft vignette and dithering so the deep blacks never band.
 */
const LEVELS = 6;

const DOWN = /* glsl */`
  precision highp float;
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  uniform float uKaris;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
  float w(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
  void main() {
    vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
    vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
    vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
    vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
    vec3 o;
    if (uKaris > 0.5) {
      vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
      float w0 = w(g0), w1 = w(g1), w2 = w(g2), w3 = w(g3), w4 = w(g4);
      o = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5)
        / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    } else {
      o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    }
    gl_FragColor = vec4(max(o, 0.0), 1.0);
  }`;

const UP = /* glsl */`
  precision highp float;
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  uniform float uGain;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
  void main() {
    vec3 o = s(vec2(0, 0)) * 4.0
      + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
      + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
    gl_FragColor = vec4(o / 16.0 * uGain, 1.0);
  }`;

const STREAK = /* glsl */`
  precision highp float;
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  uniform float uSpread;
  varying vec2 vUv;
  void main() {
    vec3 o = vec3(0.0);
    float wsum = 0.0;
    for (int i = -3; i <= 3; i++) {
      float w = exp(-float(i * i) * 0.18);
      o += texture(uSrc, vUv + vec2(float(i) * uSpread * uTexel.x, 0.0)).rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4(o / wsum, 1.0);
  }`;

const COMPOSITE = /* glsl */`
  precision highp float;
  uniform sampler2D uScene, uBloom, uStreak;
  uniform vec2 uSceneTexel, uRes;
  uniform float uBloomGain, uStreakGain, uExposure, uVignette, uFrame, uUpscale;
  uniform vec3 uStreakTint;
  varying vec2 vUv;

  vec3 catmullRom(sampler2D tex, vec2 uv, vec2 texel) {
    vec2 pos = uv / texel;
    vec2 c = floor(pos - 0.5) + 0.5;
    vec2 f = pos - c;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 o12 = w2 / w12;
    vec2 t0 = (c - 1.0) * texel, t3 = (c + 2.0) * texel, t12 = (c + o12) * texel;
    vec3 r = texture(tex, vec2(t12.x, t0.y)).rgb * w12.x * w0.y
      + texture(tex, vec2(t0.x, t12.y)).rgb * w0.x * w12.y
      + texture(tex, vec2(t12.x, t12.y)).rgb * w12.x * w12.y
      + texture(tex, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
      + texture(tex, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
    float n = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return max(r / n, 0.0);
  }

  // AgX (Sobotka), minimal fit by B. Wrensch, with a gentle "punchy" look
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x, x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 v) {
    const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    const float lo = -12.47393, hi = 4.026069;
    v = m * v;
    v = clamp(log2(max(v, 1e-10)), lo, hi);
    v = (v - lo) / (hi - lo);
    v = agxContrast(v);
    float luma = dot(v, vec3(0.2126, 0.7152, 0.0722));
    v = pow(max(v, 0.0), vec3(1.12));
    v = luma + 1.3 * (v - luma);
    return clamp(mi * v, 0.0, 1.0);
  }

  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

  void main() {
    vec3 c = uUpscale > 0.5 ? catmullRom(uScene, vUv, uSceneTexel) : texture(uScene, vUv).rgb;
    c += texture(uBloom, vUv).rgb * uBloomGain;
    c += texture(uStreak, vUv).rgb * uStreakTint * uStreakGain;
    c *= uExposure;
    vec2 q = vUv - 0.5;
    q.x *= uRes.x / uRes.y;
    c *= 1.0 - uVignette * smoothstep(0.35, 1.15, length(q));
    c = agx(c);
    vec2 px = gl_FragCoord.xy + vec2(uFrame * 5.588238, uFrame * 3.1);
    c += (ign(px) + ign(px + 17.3) - 1.0) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Post {
  private mips: WebGLRenderTarget[] = [];
  private streakA: WebGLRenderTarget | null = null;
  private streakB: WebGLRenderTarget | null = null;
  private down: ShaderMaterial;
  private up: ShaderMaterial;
  private streak: ShaderMaterial;
  readonly composite: ShaderMaterial;
  private w = 0;
  private h = 0;
  private frame = 0;
  bloom = true;
  streakOn = true;

  constructor(private fs: FullScreen) {
    this.down = pass(DOWN, { uSrc: { value: null }, uTexel: { value: new Vector2() }, uKaris: { value: 0 } });
    this.up = pass(UP, { uSrc: { value: null }, uTexel: { value: new Vector2() }, uGain: { value: 1 } });
    this.up.blending = AdditiveBlending;
    this.up.transparent = true;
    this.streak = pass(STREAK, { uSrc: { value: null }, uTexel: { value: new Vector2() }, uSpread: { value: 1 } });
    this.composite = pass(COMPOSITE, {
      uScene: { value: null }, uBloom: { value: null }, uStreak: { value: null },
      uSceneTexel: { value: new Vector2() }, uRes: { value: new Vector2(1, 1) },
      uBloomGain: { value: 0.06 }, uStreakGain: { value: 0.05 }, uExposure: { value: 1 }, uVignette: { value: 0.35 },
      uFrame: { value: 0 }, uUpscale: { value: 1 }, uStreakTint: { value: [0.55, 0.7, 1.0] },
    });
    this.composite.blending = NoBlending;
  }

  /** Size the chain from the trace resolution. */
  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < LEVELS; i++) {
      mw = Math.max(1, Math.floor(mw / 2)); mh = Math.max(1, Math.floor(mh / 2));
      this.mips.push(hdrTarget(mw, mh));
    }
    this.streakA?.dispose(); this.streakB?.dispose();
    const sw = this.mips[2].width, sh = Math.max(1, Math.floor(this.mips[2].height / 2));
    this.streakA = hdrTarget(sw, sh);
    this.streakB = hdrTarget(sw, sh);
  }

  render(r: WebGLRenderer, scene: WebGLRenderTarget, screenW: number, screenH: number): void {
    const du = this.down.uniforms, uu = this.up.uniforms;
    let src: Texture = scene.texture;
    let sw = scene.width, sh = scene.height;
    if (this.bloom || this.streakOn) {
      for (let i = 0; i < LEVELS; i++) {
        du.uSrc.value = src;
        du.uTexel.value.set(1 / sw, 1 / sh);
        du.uKaris.value = i === 0 ? 1 : 0;
        this.fs.render(r, this.down, this.mips[i]);
        src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
      }
    }
    if (this.streakOn && this.streakA && this.streakB) {
      // pull the flare out of the mid mip, then stretch it sideways in three widening passes
      const su = this.streak.uniforms;
      let from: WebGLRenderTarget = this.mips[2], to = this.streakA, other = this.streakB;
      const spreads = [1, 4, 14];
      for (const s of spreads) {
        su.uSrc.value = from.texture;
        su.uTexel.value.set(1 / from.width, 1 / from.height);
        su.uSpread.value = s * (from.width / to.width);
        this.fs.render(r, this.streak, to);
        from = to; [to, other] = [other, to];
      }
      this.composite.uniforms.uStreak.value = from.texture;
    }
    if (this.bloom) {
      const auto = r.autoClear;
      r.autoClear = false;
      for (let i = LEVELS - 1; i > 0; i--) {
        const s = this.mips[i];
        uu.uSrc.value = s.texture;
        uu.uTexel.value.set(1 / s.width, 1 / s.height);
        uu.uGain.value = 1;
        this.fs.render(r, this.up, this.mips[i - 1]);
      }
      r.autoClear = auto;
    }
    const cu = this.composite.uniforms;
    cu.uScene.value = scene.texture;
    cu.uSceneTexel.value.set(1 / scene.width, 1 / scene.height);
    cu.uUpscale.value = scene.width < screenW * 0.98 ? 1 : 0;
    cu.uBloom.value = this.bloom ? this.mips[0].texture : null;
    cu.uRes.value.set(screenW, screenH);
    cu.uFrame.value = this.frame++ % 64;
    if (!this.bloom) cu.uBloomGain.value = 0;
    if (!this.streakOn) cu.uStreakGain.value = 0;
    this.fs.render(r, this.composite, null);
  }

  dispose(): void {
    for (const m of this.mips) m.dispose();
    this.streakA?.dispose(); this.streakB?.dispose();
    this.down.dispose(); this.up.dispose(); this.streak.dispose(); this.composite.dispose();
  }
}
