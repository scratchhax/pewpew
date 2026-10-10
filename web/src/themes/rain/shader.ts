/**
 * The Rain's fragment shader: a port of xscreensaver glmatrix's architecture
 * (columns with a falling spinner, a fading trail behind it, procedural depth
 * layers composited additively) with one change of identity - the near layer
 * is not hash noise, it is the firewall log. The CPU writes glyph indices
 * into a cols x rows data texture as each spinner falls; this shader only
 * ever asks "which glyph is in this cell, and how far behind the spinner is
 * it". The trail is analytic, so it never leaves residue at any resolution.
 *
 * uCells: cols x rows RGBA8 - R glyph index (ASCII - 32), G event class,
 *         B per-cell seed.
 * uCols:  cols x 1 RGBA8 - RG head (16-bit, in cells), B speed, A class.
 */
export const RAIN_VERT = /* glsl */`#version 300 es
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

export const RAIN_FRAG = /* glsl */`#version 300 es
in vec2 vUv;
out vec4 finalColor;
uniform sampler2D uCells;
uniform sampler2D uCols;
uniform sampler2D uAtlas;
uniform vec2 uGrid;
uniform vec2 uTexSize;
uniform vec2 uWander;
uniform float uTime;
uniform float uTrail;
uniform float uWaves;
uniform float uFog;
uniform float uPan;
uniform float uColorMode;
uniform float uFar;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453123); }
float hash2(float x, float y) { return fract(sin(x * 269.5 + y * 183.3) * 24005.7913); }

vec3 glyphColor(float cls) {
  if (uColorMode > 1.5) return vec3(0.42, 0.82, 1.0);
  if (uColorMode < 0.5) {
    if (cls > 1.5) return vec3(1.0, 0.42, 0.12);
    if (cls > 0.5) return vec3(1.0, 0.22, 0.2);
  }
  return vec3(0.23, 1.0, 0.42);
}

// the log itself: one cell of the data texture
vec3 dataLayer(vec2 uv) {
  vec2 g = uv * uGrid;
  vec2 cell = floor(g);
  if (cell.x < 0.0 || cell.x >= uGrid.x || cell.y < 0.0 || cell.y >= uGrid.y) return vec3(0.0);
  vec2 f = fract(g);
  vec4 cd = texture(uCols, vec2((cell.x + 0.5) / uTexSize.x, 0.5));
  float head = (cd.r + cd.g / 255.0) * 256.0;
  float d = head - cell.y;
  if (d < 0.0 || d > uTrail) return vec3(0.0);
  vec4 cs = texture(uCells, (cell + 0.5) / uTexSize);
  float idx = floor(cs.r * 255.0 + 0.5);
  float cls = floor(cs.g * 255.0 + 0.5);
  float seed = cs.b;
  vec2 ac = vec2(mod(idx, 16.0), floor(idx / 16.0));
  float a = texture(uAtlas, (ac + f) / vec2(16.0, 6.0)).r;
  if (a < 0.02) return vec3(0.0);
  float fade = pow(max(0.0, 1.0 - d / uTrail), 1.05);
  float bright = fade * (1.5 + 0.4 * seed);
  bright *= 0.85 + 0.15 * step(0.35, hash2(cell.x + seed * 91.0, cell.y + floor(uTime * 2.5)));
  bright *= mix(1.0, 0.8 + 0.2 * sin(uTime * 0.6 + hash1(cell.x * 1.37) * 6.283), uWaves);
  vec3 col = glyphColor(cls);
  if (d < 1.0) col = mix(col, vec3(0.85, 1.0, 0.92), 1.0 - d);
  return col * a * bright;
}

// depth: a far layer of procedural glyphs, smaller cells, dimmed by fog
vec3 farLayer(vec2 uv, float k, float fog) {
  vec2 grid = floor(uGrid * k);
  vec2 g = uv * grid;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float ph = hash1(cell.x * 0.71 + k * 13.0);
  float spd = 0.25 + hash1(cell.x * 1.7 + k * 7.0) * 0.5;
  float cyc = grid.y + uTrail * 2.0;
  float head = mod(uTime * grid.y * spd * 0.22 + ph * cyc, cyc) - uTrail;
  float d = head - cell.y;
  if (d < 0.0 || d > uTrail) return vec3(0.0);
  float gi = hash2(cell.x + k * 31.0, cell.y + floor(uTime * spd * 2.0 + ph * 100.0));
  float idx = floor(gi * 95.0);
  vec2 ac = vec2(mod(idx, 16.0), floor(idx / 16.0));
  float a = texture(uAtlas, (ac + f) / vec2(16.0, 6.0)).r;
  float fade = pow(max(0.0, 1.0 - d / uTrail), 1.7);
  vec3 tint = uColorMode > 1.5 ? vec3(0.35, 0.7, 0.95) : vec3(0.2, 0.9, 0.38);
  return tint * a * fade * fog;
}

void main() {
  vec2 uv = vUv;
  // burn-in drift, on a slight overscan so the edges never show
  vec2 duv = (uv - 0.5) * 1.04 + 0.5 + uWander;
  vec3 col = dataLayer(duv);
  for (int i = 0; i < 3; i++) {
    float li = float(i);
    if (li >= uFar) break;
    vec2 uvf = uv;
    if (uPan > 0.5) {
      uvf += vec2(sin(uTime * 0.023 + li * 2.0), cos(uTime * 0.017 + li * 3.0)) * 0.018 * (li + 1.0);
    }
    float fog = mix(0.2, 0.3 / (1.0 + li * 1.5), uFog);
    col += farLayer(uvf, 1.7 + li * 0.9, fog);
  }
  finalColor = vec4(col, 1.0);
}
`;

/**
 * Fly mode: the whole scene is a 3D field of log columns and the camera
 * moves through it. Columns are data (x, z, lineId, class) in a float
 * texture; each projects with true perspective (scale = 1/z, so approach
 * is hyperbolic: hang, then whoosh), draws its real line from the ring
 * buffer, and recycles to the far plane once it passes you. The text is
 * analytic from (lineId, head) - no per-cell texture, no stride bugs.
 *
 * uLines: LEN x RING rgba8 - R glyph index (ASCII - 32).
 * uCols:  MAXC x 1 rgba32f - x, z, lineId, class.
 */
export const RAIN3D_FRAG = /* glsl */`#version 300 es
#define MAXC 96
#define LEN 32
#define RING 64
in vec2 vUv;
out vec4 finalColor;
uniform sampler2D uLines;
uniform sampler2D uCols;
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uN;
uniform float uCellH;
uniform float uAspect;
uniform vec2 uRes;
uniform float uSpread;
uniform vec2 uVp;
uniform float uTrail;
uniform float uFog;
uniform float uColorMode;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453123); }

vec3 glyphColor(float cls) {
  if (uColorMode > 1.5) return vec3(0.42, 0.82, 1.0);
  if (uColorMode < 0.5) {
    if (cls > 1.5) return vec3(1.0, 0.42, 0.12);
    if (cls > 0.5) return vec3(1.0, 0.22, 0.2);
  }
  return vec3(0.23, 1.0, 0.42);
}

void main() {
  vec2 uv = vUv;
  vec3 col = vec3(0.0);
  for (int i = 0; i < MAXC; i++) {
    float fi = float(i);
    if (fi >= uN) break;
    vec4 c = texture(uCols, vec2((fi + 0.5) / float(MAXC), 0.5));
    float z = c.y;
    if (z < 0.02) continue;
    float s = 1.0 / z;
    float cellH = uCellH * s;
    float sx = uVp.x + (c.x - 0.5) * uSpread * s;
    float halfW = cellH / (3.44 * uAspect);
    float dx = uv.x - sx;
    if (abs(dx) > halfW) continue;
    float wy = (uv.y - uVp.y) / cellH;
    float cell = floor(wy);
    float fy = fract(wy);
    float lineId = floor(c.z + 0.5);
    float ph = hash1(fi * 13.3 + lineId * 7.1);
    float spd = 0.5 + hash1(fi * 7.7) * 0.35;
    // the spinner sweeps the whole screen height at this column's depth,
    // so far columns rain across the frame, not just around the vp
    float halfH = 0.5 / cellH + uTrail;
    float cyc = float(LEN) + 2.0 * halfH;
    float head = mod(uTime * spd * 1.2 + ph * cyc, cyc) - halfH;
    float d = head - cell;
    // the whole line rides the column - the spinner just lights its head
    if (d < 0.0 || d >= float(LEN)) continue;
    float ci = float(LEN) - 1.0 - floor(d);
    float ch = texture(uLines, (vec2(ci, lineId) + 0.5) / vec2(float(LEN), float(RING))).r;
    float idx = floor(ch * 255.0 + 0.5);
    vec2 ac = vec2(mod(idx, 16.0), floor(idx / 16.0));
    vec2 f = vec2(dx / halfW * 0.5 + 0.5, fy);
    float a = texture(uAtlas, (ac + f) / vec2(16.0, 6.0)).r;
    if (a < 0.02) continue;
    float lit = 1.0 - 0.55 * (d / float(LEN));
    float depth = mix(1.0, 0.35, clamp((z - 0.35) / 4.0, 0.0, 1.0));
    float fog = mix(1.0, depth, uFog);
    float near = smoothstep(0.06, 0.16, z);
    vec3 tint = glyphColor(c.w);
    if (d < 1.0) tint = mix(tint, vec3(0.85, 1.0, 0.92), 1.0 - d);
    float lit2 = lit * fog * near * 1.25;
    // close columns are being drawn on a CRT: scanlines, RGB fringing,
    // a slow flicker and a little bloom - all ramping in with nearness
    float crt = 1.0 - smoothstep(0.15, 1.2, z);
    if (crt > 0.02) {
      float px = 0.09 * crt;
      float ar = texture(uAtlas, (ac + f + vec2(-px, 0.0)) / vec2(16.0, 6.0)).r;
      float ab = texture(uAtlas, (ac + f + vec2(px, 0.0)) / vec2(16.0, 6.0)).r;
      vec3 rgb = tint * a + vec3(0.55, 0.08, 0.0) * ar * 0.6 + vec3(0.0, 0.12, 0.55) * ab * 0.6;
      float scan = 1.0 - 0.5 * crt * (0.5 + 0.5 * cos(uv.y * uRes.y * 2.0944));
      float flick = 1.0 - 0.05 * crt * sin(uTime * 37.0);
      col += rgb * lit2 * scan * flick * (1.0 + 0.35 * crt);
    } else {
      col += tint * a * lit2;
    }
  }
  finalColor = vec4(col, 1.0);
}
`;
