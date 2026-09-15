import { Color, Vector3, type Material } from 'three';

/**
 * The water every material in the tank shares: sunlight that ripples with
 * caustics, colour that drains toward blue with distance and depth, and a
 * murk whose colour follows where you look (bright toward the surface, deep
 * blue below). Built-in materials get it patched in with `underwater()`; the
 * tank's own shaders include WATER_GLSL directly. All the uniforms are shared
 * objects, so one update reaches every material.
 */
export const W = {
  uTime: { value: 0 },
  uCaustic: { value: 1.4 },       // caustic strength (0 = off)
  uSunBase: { value: 0.55 },      // sunlight between the caustic lines
  uMurk: { value: 0.0085 },       // fog density
  uLight: { value: 1 },           // tank light (system events dim it)
  uDeep: { value: new Color(0x02203a) },
  uShallow: { value: new Color(0x2b94b8) },
  uSurfaceY: { value: 46 },
  uSunDir: { value: new Vector3(0.22, 1, 0.3).normalize() },   // toward the sun
  uAbsorb: { value: new Vector3(0.0075, 0.0026, 0.0012) },
  uCurrent: { value: 0.3 },       // how hard the water moves (weather)
  uWarm: { value: 0 },            // amber from a predator
};

export const WATER_GLSL = /* glsl */`
  uniform float uTime, uCaustic, uSunBase, uMurk, uLight, uSurfaceY, uCurrent, uWarm;
  uniform vec3 uDeep, uShallow, uSunDir, uAbsorb;

  // tileable water caustics: a few rounds of warped sines folded into thin bright lines
  float causticRaw(vec2 uv, float t) {
    vec2 p = mod(uv * 6.2831853, 6.2831853) - 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
  }

  /** Sunlight reaching a point: the caustic pattern projected down from the surface. */
  float sunlightAt(vec3 wp) {
    float below = max(0.0, uSurfaceY - wp.y);
    vec2 p = wp.xz + uSunDir.xz / uSunDir.y * below;
    float c = causticRaw(p / 19.0, uTime * 0.42) * 1.5 + causticRaw(p / 11.5 + 3.1, uTime * 0.33) * 0.7;
    float depthK = mix(0.4, 1.0, clamp(wp.y / uSurfaceY, 0.0, 1.0));
    return uSunBase + uCaustic * depthK * c;
  }

  /** The colour of open water seen in direction dir from height y. */
  vec3 waterColor(vec3 dir, float y) {
    float k = smoothstep(-0.55, 0.95, dir.y + (y / uSurfaceY - 0.4) * 0.25);
    vec3 c = mix(uDeep, uShallow, k * k);
    c += uShallow * pow(max(0.0, dot(dir, uSunDir)), 5.0) * 0.55;
    c = mix(c, c * vec3(1.35, 0.95, 0.6) + vec3(0.03, 0.012, 0.0), uWarm * 0.35);
    return c * uLight;
  }

  /** Light lost on the way: down from the surface, then across to the eye. */
  vec3 waterFog(vec3 col, vec3 wp) {
    vec3 d = wp - cameraPosition;
    float dist = length(d);
    vec3 dir = d / max(dist, 0.001);
    float path = dist + max(0.0, uSurfaceY - wp.y) * 0.5;
    col *= exp(-uAbsorb * path);
    float f = 1.0 - exp(-uMurk * uMurk * dist * dist);
    return mix(col, waterColor(dir, wp.y), f);
  }
`;

export interface Patch {
  /** GLSL added to the vertex header (attributes, uniforms, functions). */
  vertexHead?: string;
  /** Replaces `#include <begin_vertex>`; must declare `vec3 transformed`. */
  begin?: string;
  /** Runs after `#include <beginnormal_vertex>` (objectNormal is in scope). */
  normal?: string;
  /** Extra uniforms for this material (not shared). */
  uniforms?: Record<string, { value: unknown }>;
  /** Skip sunlight caustics (e.g. things lit from inside). */
  noCaustics?: boolean;
  /** Fine surface detail from 3D noise in world space: pits, bumps and mottling (rock). */
  detail?: { scale: number; bump: number; mottle: number };
}

/**
 * Put a built-in material underwater. `key` must be unique per distinct patch:
 * three.js caches programs by it.
 */
export function underwater<M extends Material>(mat: M, key: string, patch: Patch = {}): M {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, W, patch.uniforms ?? {});
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>\nvarying vec3 vWaterPos;\n${WATER_UNIFORMS_VS}\n${patch.vertexHead ?? ''}`);
    if (patch.begin) vs = vs.replace('#include <begin_vertex>', patch.begin);
    if (patch.normal) vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${patch.normal}`);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 waterWp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        waterWp = instanceMatrix * waterWp;
      #endif
      vWaterPos = (modelMatrix * waterWp).xyz;`);
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>\nvarying vec3 vWaterPos;\n${WATER_GLSL}`);
    if (patch.detail) {
      fs = fs.replace('#include <common>', `#include <common>
        uniform float uDetailScale, uDetailBump, uDetailMottle;
        float dHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float dNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        vec3 dGrad(vec3 p) {
          float e = 0.2, c = dNoise(p);
          return vec3(dNoise(p + vec3(e, 0, 0)) - c, dNoise(p + vec3(0, e, 0)) - c, dNoise(p + vec3(0, 0, e)) - c) / e;
        }`);
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 dp = vWaterPos * uDetailScale;
          float m = dNoise(dp * 0.35) * 0.6 + dNoise(dp * 1.7) * 0.4;
          diffuseColor.rgb *= 1.0 - uDetailMottle + uDetailMottle * 2.0 * m;
        }`);
      fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dp = vWaterPos * uDetailScale;
          vec3 gw = dGrad(dp) + dGrad(dp * 2.9) * 0.45;
          vec3 gv = mat3(viewMatrix) * gw;
          normal = normalize(normal - uDetailBump * (gv - dot(gv, normal) * normal));
        }`);
      Object.assign(shader.uniforms, { uDetailScale: { value: patch.detail.scale }, uDetailBump: { value: patch.detail.bump }, uDetailMottle: { value: patch.detail.mottle } });
    }
    if (!patch.noCaustics) {
      fs = fs.replace('#include <lights_fragment_begin>', 'float waterSun = sunlightAt(vWaterPos);\n#include <lights_fragment_begin>');
      fs = fs.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tif (i == 0) directLight.color *= waterSun;');
    }
    fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = waterFog(gl_FragColor.rgb, vWaterPos);');
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `aq-${key}`;
  return mat;
}

/** The shared uniforms a vertex patch may use. */
const WATER_UNIFORMS_VS = 'uniform float uTime, uCurrent;';

/**
 * A vertex patch that sways things rooted to the floor with the water: tips
 * move most, the whole piece drifts with the current's direction in world space.
 * `height` is the local height at which the sway is full.
 */
export function swayPatch(height: number, amount: number, speed = 1): Patch {
  return {
    vertexHead: 'uniform float uSwayH, uSwayAmt, uSwaySpeed;',
    uniforms: { uSwayH: { value: height }, uSwayAmt: { value: amount }, uSwaySpeed: { value: speed } },
    begin: /* glsl */`
      vec3 transformed = vec3(position);
      mat4 swayM = modelMatrix;
      #ifdef USE_INSTANCING
        swayM = modelMatrix * instanceMatrix;
      #endif
      vec3 root = swayM[3].xyz;
      float hk = clamp(position.y / uSwayH, 0.0, 1.0);
      hk = hk * hk;
      float ph = dot(root, vec3(0.071, 0.0, 0.113));
      float t = uTime * uSwaySpeed;
      float amp = uSwayAmt * (0.55 + uCurrent * 0.9);
      vec3 off = vec3(
        (sin(t * 0.8 + ph) * 0.7 + sin(t * 1.9 + ph * 2.7) * 0.25 + uCurrent * 0.6) * amp,
        0.0,
        (sin(t * 0.63 + ph * 1.9) * 0.45) * amp);
      mat3 m3 = mat3(swayM);
      transformed += transpose(m3) * off * hk / max(0.0001, dot(m3[0], m3[0]));
    `,
  };
}
