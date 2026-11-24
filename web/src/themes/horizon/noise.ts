/** Shared GLSL noise: hashes, 3D gradient noise and fbm. */
export const NOISE_GLSL = /* glsl */`
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 grad3(vec3 c) { return hash33(c) * 2.0 - 1.0; }
  // gradient noise, roughly -1..1
  float gnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(grad3(i), f);
    float n100 = dot(grad3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0));
    float n010 = dot(grad3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0));
    float n110 = dot(grad3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0));
    float n001 = dot(grad3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1));
    float n101 = dot(grad3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1));
    float n011 = dot(grad3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1));
    float n111 = dot(grad3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
               mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 1.8;
  }
  float fbm(vec3 p, int oct) {
    float a = 0.5, s = 0.0, n = 0.0;
    for (int i = 0; i < 7; i++) {
      if (i >= oct) break;
      s += a * gnoise(p);
      n += a;
      p = p * 2.03 + vec3(1.7, 9.2, 4.1);
      a *= 0.5;
    }
    return s / n;
  }
`;
