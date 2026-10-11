/**
 * Game of life: the whole screen is one toroidal automaton grid, one glyph
 * per cell. The CPU steps Conway's rule and uploads the generation as a
 * float texture (glyph index + 1, colour class, age); this shader draws one
 * cell per pixel: glyph from the atlas, newborns flashing white, elders
 * dimming to embers, all floating on a drifting fog behind the tube's
 * scanlines.
 *
 * uLife: GW x GH rgba32f - glyph index + 1 (0 = dead), class, age, 0.
 */
export const LIFE_VERT = /* glsl */`#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUv;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uProjectionMatrix;
void main() {
  vUv = aUV;
  vec3 p = uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}
`;

export const LIFE_FRAG = /* glsl */`#version 300 es
#define GW 128
#define GH 48
in vec2 vUv;
out vec4 finalColor;
uniform sampler2D uLife;
uniform sampler2D uAtlas;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uWander;
uniform float uFog;
uniform float uColorMode;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453123); }
float hash2(float x, float y) { return fract(sin(x * 269.5 + y * 183.3) * 24005.7913); }
float vnoise(vec2 p) {
  vec2 i = floor(p), g = fract(p);
  g = g * g * (3.0 - 2.0 * g);
  return mix(mix(hash2(i.x, i.y), hash2(i.x + 1.0, i.y), g.x),
             mix(hash2(i.x, i.y + 1.0), hash2(i.x + 1.0, i.y + 1.0), g.x), g.y);
}
float fogField(vec2 uv, float t) {
  float n = vnoise(uv * 3.0 + vec2(t * 0.03, t * 0.02)) * 0.65
          + vnoise(uv * 7.0 - vec2(t * 0.05, t * 0.01)) * 0.35;
  return n;
}

vec3 glyphColor(float cls) {
  if (uColorMode > 1.5) return vec3(0.42, 0.82, 1.0);
  if (uColorMode < 0.5) {
    if (cls > 1.5) return vec3(1.0, 0.42, 0.12);
    if (cls > 0.5) return vec3(1.0, 0.22, 0.2);
  }
  return vec3(0.23, 1.0, 0.42);
}

void main() {
  // burn-in drift, on a slight overscan so the edges never show
  vec2 duv = (vUv - 0.5) * 1.04 + 0.5 + uWander;
  float fogBank = fogField(duv, uTime) * uFog;
  vec3 col = vec3(0.05, 0.13, 0.07) * fogBank * 0.8;
  if (duv.x >= 0.0 && duv.x <= 1.0 && duv.y >= 0.0 && duv.y <= 1.0) {
    vec2 g = duv * vec2(GW, GH);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    vec4 d = texture(uLife, (cell + 0.5) / vec2(GW, GH));
    float idx = d.r - 1.0;
    if (idx >= 0.0) {
      float cls = d.g;
      float age = d.b;
      vec2 ac = vec2(mod(idx, 16.0), floor(idx / 16.0));
      float ga = texture(uAtlas, (ac + f) / vec2(16.0, 6.0)).r;
      // the cell is a solid block so the colony's shape reads at a glance;
      // the glyph rides inside it, brighter, so up close it is still the log
      vec2 inset = smoothstep(0.05, 0.16, f) * smoothstep(0.05, 0.16, 1.0 - f);
      float a = inset.x * inset.y * (0.45 + 0.55 * ga);
      if (a > 0.02) {
        // newborns flash white, elders cool to embers
        float bright = mix(1.0, 0.5, min(age, 24.0) / 24.0);
        vec3 tint = mix(glyphColor(cls), vec3(0.85, 1.0, 0.92), age <= 1.0 ? 0.8 : 0.0);
        bright *= 0.9 + 0.1 * hash2(cell.x + 13.0, cell.y + floor(uTime * 3.0));
        col += tint * a * bright;
      }
    }
  }
  // the whole feed is a tube: gentle scanlines and a slow flicker
  float band = 0.5 + 0.5 * cos(duv.y * uRes.y * 2.0944);
  band = pow(band, 2.2);
  col *= 1.0 - 0.3 * band;
  col *= 1.0 - 0.03 * sin(uTime * 37.0);
  finalColor = vec4(col, 1.0);
}
`;
