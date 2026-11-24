import { Color, Matrix3, Vector2, Vector3, Vector4, type ShaderMaterial, type Texture, type CubeTexture } from 'three';
import { pass } from './fsq';
import { NOISE_GLSL } from './noise';
import { BB_GLSL } from './blackbody';
import { GLSL_PHYS } from './physics';

/**
 * The heart of the scene: every pixel's light is traced BACKWARDS from the
 * camera along a real Schwarzschild null geodesic. In Rs = 1 units the bent
 * path obeys x'' = -1.5 h² x / r⁵ (h = |x × v|, conserved), integrated with
 * velocity Verlet on a step that grows with radius. Along the way the ray
 * can:
 *   - cross the disk plane (any number of times: the far side of the disk
 *     shows up above and below the hole, and again in the thin photon ring),
 *     picking up emission Doppler-boosted and gravitationally redshifted;
 *   - pass through the glowing haze above the disk and the polar jets;
 *   - hit a moon (solid, lit by the disk) or pass glowing debris (an
 *     anisotropic Gaussian, integrated exactly along each step);
 *   - fall through the horizon (black) or escape to the sky, whose stars are
 *     drawn per pixel in the bent direction.
 * Nothing in the frame is a sprite pasted on top: everything you see has
 * come round the hole the way light would.
 */
export const MAX_SPH = 12;
export const MAX_GLOW = 16;
export const KNOT_SLOTS = 4;   // vec4s, two knots each

const FRAG = /* glsl */`
  precision highp float;
  ${GLSL_PHYS}
  ${NOISE_GLSL}
  ${BB_GLSL}
  uniform vec3 uCamPos;
  uniform mat3 uCamBasis;
  uniform vec2 uTan;
  uniform float uPix;
  uniform int uSteps;
  uniform float uStepK, uFar, uTime, uDiskW;
  uniform sampler2D uDisk;
  uniform samplerCube uSky;
  uniform float uBeam, uShift, uDiskGain, uHaze, uJet, uStarGain, uSkyGain, uDiskLight;
  uniform vec3 uHazeCol, uJetCol, uLightCol;
  uniform vec4 uSph[${MAX_SPH}];
  uniform vec4 uSphCol[${MAX_SPH}];
  uniform vec4 uSphRot[${MAX_SPH}];
  uniform int uSphN;
  uniform vec4 uGlow[${MAX_GLOW}];
  uniform vec4 uGlowAx[${MAX_GLOW}];
  uniform vec4 uGlowCol[${MAX_GLOW}];
  uniform int uGlowN;
  uniform vec4 uKnots[${KNOT_SLOTS}];
  varying vec2 vUv;

  float erfa(float x) {
    float x2 = x * x;
    float e = 1.0 - exp(-x2 * (1.27324 + 0.147 * x2) / (1.0 + 0.147 * x2));
    return sign(x) * sqrt(max(e, 0.0));
  }

  vec4 diskAt(vec3 pc, float rc, vec3 dir, float travel, float images) {
    float u = fract(atan(pc.z, pc.x) / TAU);
    float v = log(rc / DISK_R0) / LOG_SPAN;
    // mip level from the pixel's footprint where it meets the disk: distance
    // travelled times the pixel's angle, stretched at grazing angles; the
    // second and later images (round the back of the hole) are squeezed
    // thin, so they filter harder
    float texel = rc * TAU / uDiskW;
    float foot = uPix * travel * inversesqrt(max(abs(dir.y), 0.03));
    float lod = log2(max(foot / texel, 1.0)) + images * 1.5;
    vec4 d = textureLod(uDisk, vec2(u, v), lod);
    if (d.b < 0.0005 && d.r < 0.0005) return vec4(0.0);
    float beta = clamp(sqrt(0.5 / max(rc - 1.0, 0.4)), 0.0, 0.72);
    vec3 tdir = vec3(-pc.z, 0.0, pc.x) / rc;
    float cosT = dot(tdir, -dir);
    float gam = inversesqrt(1.0 - beta * beta);
    float g = sqrt(max(1.0 - 1.0 / rc, 0.02)) / (gam * (1.0 - beta * cosT));
    float t = d.g * 10000.0 * mix(1.0, g, uShift);
    float i = d.r * pow(g, uBeam) * uDiskGain;
    return vec4(bb(t) * i * (0.35 + 0.65 * smoothstep(1200.0, 6000.0, t)), d.b);
  }

  float moonSurface(vec3 q, float type, float seed) {
    if (type > 1.5) {          // gas giant: soft bands with a little storm
      float w = fbm(q * vec3(2.0, 6.0, 2.0) + seed, 4);
      return 0.72 + 0.28 * sin(q.y * 15.0 + w * 3.2 + seed);
    }
    if (type > 0.5) {          // ice: bright, scored with dark lines
      float l = 1.0 - abs(gnoise(q * 5.0 + seed));
      return 0.9 - 0.45 * pow(max(l, 0.0), 14.0) + 0.08 * fbm(q * 9.0 + seed, 3);
    }
    float f = fbm(q * 3.5 + seed, 5);            // rock: mottled maria and craters
    float cr = pow(max(1.0 - abs(gnoise(q * 7.0 + seed * 2.0)), 0.0), 9.0);
    return 0.55 + 0.4 * f - 0.25 * cr;
  }

  vec3 shadeMoon(int k, vec3 hit, vec3 dir) {
    vec4 s = uSph[k];
    vec4 cs = uSphCol[k];
    vec4 rot = uSphRot[k];
    vec3 n = normalize(hit - s.xyz);
    float ca = cos(rot.x), sa = sin(rot.x);
    vec3 q = vec3(ca * n.x - sa * n.z, n.y, sa * n.x + ca * n.z);
    vec3 alb = cs.rgb * moonSurface(q, cs.w, rot.y);
    float rr = length(hit);
    vec3 L = -hit / rr;
    float ndl = dot(n, L);
    // the disk is a broad source: light wraps a little past the terminator
    float lit = smoothstep(-0.18, 0.55, ndl) * (0.25 + 0.75 * max(ndl, 0.0));
    float under = max(dot(n, vec3(0.0, -sign(hit.y + 1e-4), 0.0)), 0.0) * smoothstep(0.0, 1.2, abs(hit.y)) * 0.18;
    float e = uDiskLight * 75.0 / (rr * rr);
    vec3 c = alb * uLightCol * (lit + under) * e;
    float fr = pow(1.0 - max(dot(n, -dir), 0.0), 4.0);
    c += uLightCol * cs.rgb * fr * smoothstep(-0.2, 0.4, ndl) * e * 0.35;
    c += alb * vec3(0.004, 0.005, 0.008);
    return c * rot.z;
  }

  vec3 starLayer(vec3 d, float n, float dens, float seed, float gain) {
    vec3 a = abs(d);
    vec2 uv; vec3 fz, fx, fy;
    if (a.x >= a.y && a.x >= a.z) { uv = d.zy / a.x; fz = vec3(sign(d.x), 0.0, 0.0); fx = vec3(0.0, 0.0, 1.0); fy = vec3(0.0, 1.0, 0.0); }
    else if (a.y >= a.z) { uv = d.xz / a.y; fz = vec3(0.0, sign(d.y), 0.0); fx = vec3(1.0, 0.0, 0.0); fy = vec3(0.0, 0.0, 1.0); }
    else { uv = d.xy / a.z; fz = vec3(0.0, 0.0, sign(d.z)); fx = vec3(1.0, 0.0, 0.0); fy = vec3(0.0, 1.0, 0.0); }
    vec2 cell = floor(uv * n);
    vec3 fsd = vec3(cell, seed + dot(fz, vec3(3.0, 5.0, 7.0)));
    vec3 h = hash33(fsd);
    if (h.x > dens) return vec3(0.0);
    vec3 h2 = hash33(fsd + 19.19);
    vec2 suv = (cell + 0.25 + 0.5 * h2.xy) / n;
    vec3 sd = normalize(fz + fx * suv.x + fy * suv.y);
    vec3 dd = d - sd;
    float w = uPix * 1.15;
    // a star is a point: when the trace runs coarse its pixel-wide blob gets
    // bigger on screen, so its peak drops to keep the light it gives the same
    float coarse = clamp(pow(0.00064 / uPix, 1.5), 0.15, 1.0);
    float b = (0.02 + 0.18 * h.y * h.y + 3.5 * pow(h.y, 40.0)) * coarse;
    float t = mix(2900.0, 15000.0, pow(h.z, 2.2));
    return bb(t) * b * gain * exp(-dot(dd, dd) / (w * w));
  }

  vec3 skyAt(vec3 d) {
    vec4 s = texture(uSky, d);
    vec3 c = s.rgb * uSkyGain;
    c += starLayer(d, 34.0, 0.55, 1.0, 1.6) * uStarGain;
    c += starLayer(d, 110.0, 0.12 + 0.45 * s.a, 7.0, 0.45) * uStarGain;
    return c;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 rd = normalize(uCamBasis * vec3(ndc.x * uTan.x, ndc.y * uTan.y, -1.0));
    vec3 pos = uCamPos;
    vec3 vel = rd;
    vec3 hv = cross(pos, vel);
    float h2 = dot(hv, hv);
    float r2 = dot(pos, pos);
    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * sqrt(r2));
    vec3 col = vec3(0.0);
    float trans = 1.0;
    bool escaped = false;
    float travel = 0.0;
    float images = 0.0;

    for (int i = 0; i < 640; i++) {
      if (i >= uSteps) break;
      float r = sqrt(dot(pos, pos));
      float dt = uStepK * max(r - 0.85, 0.12);
      vec3 p0 = pos;
      pos += vel * dt + 0.5 * acc * dt * dt;
      float rn2 = dot(pos, pos);
      float rn = sqrt(rn2);
      vec3 acc1 = -1.5 * h2 * pos / (rn2 * rn2 * rn);
      vel += 0.5 * (acc + acc1) * dt;
      acc = acc1;
      vec3 seg = pos - p0;
      float segLen = length(seg);

      // the disk plane
      if (p0.y * pos.y <= 0.0 && p0.y != pos.y) {
        float f = p0.y / (p0.y - pos.y);
        vec3 pc = mix(p0, pos, f);
        float rc = length(pc.xz);
        if (rc > DISK_R0 && rc < DISK_R1) {
          vec4 d = diskAt(pc, rc, normalize(vel), travel + segLen * f, images);
          col += trans * d.rgb;
          trans *= 1.0 - d.a;
          images += 1.0;
        }
      }

      #if HAZE
      if (abs(pos.y) < 2.0 && rn < 19.0) {
        float rr = length(pos.xz);
        float sig = 0.04 + 0.035 * rr;
        float hz = exp(-pos.y * pos.y / (sig * sig)) * smoothstep(2.3, 4.2, rr) * (1.0 - smoothstep(9.0, 18.0, rr)) * pow(3.0 / max(rr, 3.0), 1.4);
        col += trans * uHazeCol * hz * segLen * uHaze;
      }
      #endif

      #if JETS
      {
        float ay = abs(pos.y);
        float rho2 = dot(pos.xz, pos.xz);
        float w = 0.08 + 0.022 * ay;
        if (ay > 2.2 && ay < 70.0 && rho2 < 9.0 * w * w) {
          float core = exp(-rho2 / (w * w));
          float along = smoothstep(2.2, 6.0, ay) * exp(-ay / 13.0);
          float sg = sign(pos.y);
          float flow = 0.62 + 0.38 * sin(ay * 0.75 - uTime * 2.1 + sg * 1.3) * sin(ay * 0.21 - uTime * 0.8 + sg);
          float knots = 0.0;
          for (int k = 0; k < ${KNOT_SLOTS}; k++) {
            vec4 q = uKnots[k];
            float x0 = (pos.y - q.x) / (0.9 + 0.08 * abs(q.x));
            float x1 = (pos.y - q.z) / (0.9 + 0.08 * abs(q.z));
            knots += q.y * exp(-x0 * x0) + q.w * exp(-x1 * x1);
          }
          col += trans * uJetCol * core * along * (flow + knots) * segLen * uJet / (w * 3.0);
        }
      }
      #endif

      // moons
      for (int k = 0; k < ${MAX_SPH}; k++) {
        if (k >= uSphN) break;
        vec4 s = uSph[k];
        vec3 oc = p0 - s.xyz;
        float b = dot(oc, seg);
        float c = dot(oc, oc) - s.w * s.w;
        float a = segLen * segLen;
        float disc = b * b - a * c;
        if (disc > 0.0 && a > 0.0) {
          float t = (-b - sqrt(disc)) / a;
          if (t >= 0.0 && t <= 1.0) {
            col += trans * shadeMoon(k, p0 + seg * t, seg / segLen);
            trans = 0.0;
            break;
          }
        }
      }
      if (trans < 0.004) break;

      // glowing debris: anisotropic Gaussians, integrated along this step
      for (int k = 0; k < ${MAX_GLOW}; k++) {
        if (k >= uGlowN) break;
        vec4 g = uGlow[k];
        vec4 ax = uGlowAx[k];
        vec3 m = 0.5 * (p0 + pos) - g.xyz;
        float reach = 3.2 * g.w * ax.w + 0.5 * segLen;
        if (dot(m, m) > reach * reach) continue;
        float squash = 1.0 - 1.0 / ax.w;
        vec3 q0 = p0 - g.xyz, q1 = pos - g.xyz;
        q0 -= ax.xyz * dot(q0, ax.xyz) * squash;
        q1 -= ax.xyz * dot(q1, ax.xyz) * squash;
        vec3 d = q1 - q0;
        float l2 = dot(d, d);
        if (l2 < 1e-12) continue;
        float lp = sqrt(l2);
        float tc = -dot(q0, d) / l2;
        vec3 cp = q0 + d * tc;
        float frac = 0.5 * (erfa((1.0 - tc) * lp / g.w) - erfa(-tc * lp / g.w));
        col += trans * uGlowCol[k].rgb * exp(-dot(cp, cp) / (g.w * g.w)) * frac * (segLen / lp);
      }

      travel += segLen;
      if (rn < 1.0) { trans = 0.0; break; }
      if (rn > uFar && dot(pos, vel) > 0.0) { escaped = true; break; }
    }

    if (escaped && trans > 0.004) col += trans * skyAt(normalize(vel));
    // one bad pixel would be smeared over the whole frame by the bloom: never emit NaN or Inf
    if (!(col.r + col.g + col.b < 60000.0)) col = vec3(0.0);
    gl_FragColor = vec4(min(col, vec3(20000.0)), 1.0);
  }`;

export interface TracerUniforms {
  uCamPos: { value: Vector3 };
  uCamBasis: { value: Matrix3 };
  uTan: { value: Vector2 };
  uPix: { value: number };
  uSteps: { value: number };
  uStepK: { value: number };
  uFar: { value: number };
  uTime: { value: number };
  uDiskW: { value: number };
  uDisk: { value: Texture | null };
  uSky: { value: CubeTexture | Texture | null };
  uBB: { value: Texture | null };
  uBeam: { value: number };
  uShift: { value: number };
  uDiskGain: { value: number };
  uHaze: { value: number };
  uJet: { value: number };
  uStarGain: { value: number };
  uSkyGain: { value: number };
  uDiskLight: { value: number };
  uHazeCol: { value: Color };
  uJetCol: { value: Color };
  uLightCol: { value: Color };
  uSph: { value: Vector4[] };
  uSphCol: { value: Vector4[] };
  uSphRot: { value: Vector4[] };
  uSphN: { value: number };
  uGlow: { value: Vector4[] };
  uGlowAx: { value: Vector4[] };
  uGlowCol: { value: Vector4[] };
  uGlowN: { value: number };
  uKnots: { value: Vector4[] };
}

const vecs = (n: number) => Array.from({ length: n }, () => new Vector4());

export function createTracer(haze: boolean, jets: boolean): { mat: ShaderMaterial; u: TracerUniforms } {
  const u: TracerUniforms = {
    uCamPos: { value: new Vector3() },
    uCamBasis: { value: new Matrix3() },
    uTan: { value: new Vector2(1, 1) },
    uPix: { value: 0.001 },
    uSteps: { value: 200 },
    uStepK: { value: 0.07 },
    uFar: { value: 60 },
    uTime: { value: 0 },
    uDiskW: { value: 1536 },
    uDisk: { value: null },
    uSky: { value: null },
    uBB: { value: null },
    uBeam: { value: 2 },
    uShift: { value: 0.6 },
    uDiskGain: { value: 1 },
    uHaze: { value: 1 },
    uJet: { value: 1 },
    uStarGain: { value: 1 },
    uSkyGain: { value: 1 },
    uDiskLight: { value: 1 },
    uHazeCol: { value: new Color(1, 0.7, 0.4) },
    uJetCol: { value: new Color(0.6, 0.75, 1) },
    uLightCol: { value: new Color(1, 0.85, 0.7) },
    uSph: { value: vecs(MAX_SPH) },
    uSphCol: { value: vecs(MAX_SPH) },
    uSphRot: { value: vecs(MAX_SPH) },
    uSphN: { value: 0 },
    uGlow: { value: vecs(MAX_GLOW) },
    uGlowAx: { value: vecs(MAX_GLOW) },
    uGlowCol: { value: vecs(MAX_GLOW) },
    uGlowN: { value: 0 },
    uKnots: { value: vecs(KNOT_SLOTS) },
  };
  const mat = pass(FRAG, u as unknown as Record<string, { value: unknown }>, { HAZE: haze ? 1 : 0, JETS: jets ? 1 : 0 });
  return { mat, u };
}

export function setTracerFeatures(mat: ShaderMaterial, haze: boolean, jets: boolean): void {
  const h = haze ? 1 : 0, j = jets ? 1 : 0;
  if (mat.defines.HAZE === h && mat.defines.JETS === j) return;
  mat.defines.HAZE = h;
  mat.defines.JETS = j;
  mat.needsUpdate = true;
}
