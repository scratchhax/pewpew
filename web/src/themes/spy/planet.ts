import {
  AdditiveBlending, BackSide, BufferGeometry, CanvasTexture, Color, DataTexture, Float32BufferAttribute, Group,
  LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Points, RepeatWrapping,
  RGBAFormat, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, UnsignedByteType, Vector3,
  WebGLRenderTarget, type WebGLRenderer, ClampToEdgeWrapping, Matrix3, Texture, Vector4,
} from 'three';
import { Geo, R, dirOf } from './geo';

/**
 * An Earth-like planet that isn't Earth. Continents, relief, biomes, ice caps
 * and weather are generated on the GPU once from a seed and baked into
 * textures, so every frame is cheap: albedo (relief in alpha), surface normals
 * (ocean mask in alpha) and cloud cover. City lights are painted on a canvas
 * from the geography read back from the bake.
 *
 * The planet is lit by a fixed sun and turns slowly, so the terminator sweeps
 * over the cities; clouds drift a little faster and cast shadows; oceans catch
 * the sun; the atmosphere glows at the limb.
 */

const NOISE = /* glsl */`
  precision highp float;
  const float PI = 3.14159265359;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  float fbm(vec3 p, int oct) {
    float a = 0.5, s = 0.0, n = 0.0;
    for (int i = 0; i < 10; i++) {
      if (i >= oct) break;
      s += a * noise(p); n += a;
      p = ROT * p * 2.03; a *= 0.5;
    }
    return s / n;
  }
`;

const BAKE_FRAG = /* glsl */`
  ${NOISE}
  varying vec2 vUv;
  uniform int uMode;
  uniform vec3 uSeed;
  uniform float uSea;
  uniform float uTexel;

  vec3 dirFromUv(vec2 uv) {
    float th = (1.0 - uv.y) * PI, ph = uv.x * 2.0 * PI;
    return vec3(-cos(ph) * sin(th), cos(th), sin(ph) * sin(th));
  }

  float height(vec3 d) {
    vec3 p = d * 1.35 + uSeed;
    vec3 q = vec3(fbm(p * 1.1 + vec3(1.7, 9.2, 3.1), 4), fbm(p * 1.1 + vec3(8.3, 2.8, 5.5), 4), fbm(p * 1.1 + vec3(4.4, 6.1, 0.7), 4)) - 0.5;
    float c = fbm(p + q * 1.7, 8);
    float rid = 1.0 - abs(noise(p * 5.3 + q * 3.0) * 2.0 - 1.0);
    c += rid * rid * 0.05 * smoothstep(0.45, 0.7, fbm(p * 2.7 + vec3(3.3), 3));
    return c;
  }

  float iceAt(vec3 d, float lat) {
    float alat = abs(lat) / (PI * 0.5);
    return smoothstep(0.855, 0.9, alat + (fbm(d * 4.0 + uSeed, 4) - 0.5) * 0.14);
  }

  void main() {
    vec3 d = dirFromUv(vUv);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    if (uMode == 9) { float h0 = height(d); gl_FragColor = vec4(h0, h0, h0, 1.0); return; }
    if (uMode == 2) {
      vec3 p = d * 2.2 + uSeed.yzx * 1.7;
      vec3 q = vec3(fbm(p * 0.9 + vec3(2.0), 4), fbm(p * 0.9 + vec3(7.0), 4), fbm(p * 0.9 + vec3(4.0), 4)) - 0.5;
      float c = fbm(p + q * 2.4 + vec3(0.0, lat * 1.5, 0.0), 7);
      c *= 0.86 + 0.2 * (0.5 + 0.5 * cos(lat * 6.0));
      gl_FragColor = vec4(c, c, c, 1.0);
      return;
    }
    if (uMode == 3) {
      float base = fbm(d * 3.0 + vec3(11.0), 6);
      float cr = 0.0;
      for (int i = 0; i < 3; i++) {
        vec3 pp = d * (3.0 + float(i) * 4.0) + vec3(float(i) * 3.1);
        vec3 ci = floor(pp), cf = fract(pp);
        float rad = hash(ci) * 0.28 + 0.1;
        vec3 cc = vec3(hash(ci + 1.0), hash(ci + 2.0), hash(ci + 3.0)) * 0.5 + 0.25;
        float dd = length(cf - cc);
        cr += (smoothstep(rad, rad * 0.6, dd) * -0.16 + smoothstep(rad * 1.25, rad, dd) * 0.08) * step(0.5, hash(ci + 5.0));
      }
      float g = 0.36 + (base - 0.5) * 0.7 + cr;
      gl_FragColor = vec4(vec3(g), 1.0);
      return;
    }
    float h = height(d), e = h - uSea;
    if (uMode == 1) {
      vec3 up = abs(d.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
      vec3 east = normalize(cross(up, d)), north = cross(d, east);
      float eps = uTexel * 2.0 * PI;
      float hc = max(h, uSea);
      float he = max(height(normalize(d + east * eps)), uSea);
      float hn = max(height(normalize(d + north * eps)), uSea);
      vec3 n = normalize(d - (east * (he - hc) + north * (hn - hc)) / eps * 0.09);
      float ocean = e < 0.0 ? 1.0 - iceAt(d, lat) : 0.0;
      gl_FragColor = vec4(n * 0.5 + 0.5, ocean);
      return;
    }
    // albedo, relief in alpha
    float alat = abs(lat) / (PI * 0.5);
    float n1 = fbm(d * 6.0 + uSeed * 1.3, 5);
    float moist = fbm(d * 2.2 + uSeed.zxy + vec3(5.0), 5);
    vec3 col;
    if (e < 0.0) {
      float depth = clamp(-e * 9.0, 0.0, 1.0);
      col = mix(vec3(0.03, 0.12, 0.19), vec3(0.006, 0.028, 0.075), smoothstep(0.0, 0.5, depth));
      col = mix(col, vec3(0.07, 0.25, 0.27), (1.0 - smoothstep(0.0, 0.06, depth)) * 0.85);
    } else {
      float el = clamp(e * 5.5, 0.0, 1.0);
      float temp = 1.0 - alat * 1.12 - el * 0.5 + (n1 - 0.5) * 0.3;
      vec3 desert = mix(vec3(0.58, 0.40, 0.25), vec3(0.70, 0.55, 0.36), n1);
      vec3 savanna = vec3(0.42, 0.39, 0.21);
      vec3 jungle = vec3(0.06, 0.16, 0.05);
      vec3 forest = mix(vec3(0.10, 0.20, 0.08), vec3(0.19, 0.27, 0.11), n1);
      vec3 steppe = vec3(0.34, 0.35, 0.21);
      vec3 taiga = vec3(0.09, 0.15, 0.10);
      vec3 tundra = vec3(0.36, 0.34, 0.28);
      vec3 rock = mix(vec3(0.28, 0.25, 0.22), vec3(0.44, 0.40, 0.35), n1);
      vec3 snow = vec3(0.86, 0.89, 0.93);
      vec3 hot = mix(desert, mix(savanna, jungle, smoothstep(0.47, 0.6, moist)), smoothstep(0.4, 0.52, moist));
      vec3 mild = mix(steppe, forest, smoothstep(0.42, 0.55, moist));
      vec3 cold = mix(tundra, taiga, smoothstep(0.42, 0.58, moist) * 0.8);
      col = mix(cold, mild, smoothstep(0.22, 0.45, temp));
      col = mix(col, hot, smoothstep(0.62, 0.8, temp));
      col = mix(col, rock, smoothstep(0.4, 0.8, el) * 0.85);
      col = mix(col, snow, smoothstep(0.12, -0.02, temp));
      col = mix(col, vec3(0.56, 0.50, 0.38), (1.0 - smoothstep(0.0, 0.01, e)) * 0.55);
    }
    col = mix(col, vec3(0.88, 0.92, 0.96), iceAt(d, lat));
    gl_FragColor = vec4(col, clamp(0.5 + e * 3.5, 0.0, 1.0));
  }
`;

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

class Baker {
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mat: ShaderMaterial;

  constructor(private renderer: WebGLRenderer, seed: number) {
    this.mat = new ShaderMaterial({
      uniforms: {
        uMode: { value: 0 }, uSeed: { value: new Vector3(((seed * 0.6180339) % 1) * 7 + 1, ((seed * 0.4142135) % 1) * 7 + 1, ((seed * 0.7320508) % 1) * 7 + 1) },
        uSea: { value: 0.5 }, uTexel: { value: 1 / 1024 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: BAKE_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), this.mat));
  }

  /** Render one mode into a w×h target in strips (so a big bake never stalls the page), and read it back. */
  async run(mode: number, w: number, h: number): Promise<Uint8Array> {
    const rt = new WebGLRenderTarget(w, h, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false, generateMipmaps: false });
    this.mat.uniforms.uMode.value = mode;
    this.mat.uniforms.uTexel.value = 1 / w;
    const strip = Math.max(16, Math.floor(262144 / w));
    const prev = this.renderer.getRenderTarget();
    for (let y = 0; y < h; y += strip) {
      rt.scissor.set(0, y, w, Math.min(strip, h - y));
      rt.scissorTest = true;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, this.cam);
      this.renderer.setRenderTarget(prev);
      await nextFrame();
    }
    const buf = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    rt.dispose();
    return buf;
  }
}

function dataTex(buf: Uint8Array, w: number, h: number, aniso: number): DataTexture {
  const t = new DataTexture(buf, w, h, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Weighted (by area) percentile of a channel in an equirect buffer. */
function percentile(buf: Uint8Array, w: number, h: number, q: number): number {
  const hist = new Float64Array(256);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const wt = Math.cos(((y + 0.5) / h - 0.5) * Math.PI);
    for (let x = 0; x < w; x++) { hist[buf[(y * w + x) * 4]] += wt; total += wt; }
  }
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * q) return i / 255; }
  return 1;
}

/** City lights, towns and the roads between them, painted in equirect. */
function paintLights(geo: Geo, w: number, h: number, seed: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  let s = seed * 9301 + 49297;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const toXY = (lat: number, lon: number) => [((lon + Math.PI) / (Math.PI * 2)) * w, (0.5 - lat / Math.PI) * h];
  const dot = (lat: number, lon: number, rad: number, a: number) => {
    const [x, y] = toXY(lat, lon);
    const sx = 1 / Math.max(0.25, Math.cos(lat));
    for (const wrap of [0, -w, w]) {
      const xx = x + wrap;
      if (xx < -rad * sx * 2 || xx > w + rad * sx * 2) continue;
      g.save();
      g.translate(xx, y); g.scale(sx, 1);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(0.35, `rgba(255,255,255,${a * 0.45})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  };
  const k = w / 2048;
  // roads first, faint, between near neighbours on land
  g.lineWidth = Math.max(0.6, 0.9 * k);
  for (const a of geo.cities) {
    const near = geo.cities.filter((b) => b !== a).map((b) => ({ b, d: Math.hypot(b.lat - a.lat, (b.lon - a.lon) * Math.cos(a.lat)) }))
      .sort((p, q) => p.d - q.d).slice(0, 2);
    for (const { b, d } of near) {
      if (d > 0.22 || Math.abs(b.lon - a.lon) > 1) continue;
      let ok = true;
      for (let t = 0.2; t < 0.9; t += 0.2) if (!geo.land(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)) ok = false;
      if (!ok) continue;
      const steps = Math.ceil(d * 400 * k);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (rand() < 0.45) dot(a.lat + (b.lat - a.lat) * t + (rand() - 0.5) * 0.004, a.lon + (b.lon - a.lon) * t, 1.4 * k + 0.4, 0.18);
      }
    }
  }
  for (const city of geo.cities) {
    const size = 0.25 + city.pop;
    // suburbs and towns scattered round the core, on land
    const towns = Math.round(10 + city.pop * 60);
    for (let i = 0; i < towns; i++) {
      const rr = Math.pow(rand(), 1.6) * 0.06 * (0.5 + size);
      const ang = rand() * Math.PI * 2;
      const lat = city.lat + Math.sin(ang) * rr, lon = city.lon + (Math.cos(ang) * rr) / Math.max(0.3, Math.cos(city.lat));
      if (!geo.land(lat, lon)) continue;
      dot(lat, lon, (1 + rand() * 2.2) * k + 0.5, 0.12 + rand() * 0.25);
    }
    dot(city.lat, city.lon, (5 + size * 12) * k, 0.55 + city.pop * 0.35);
    dot(city.lat, city.lon, (2 + size * 3) * k, 0.9);
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const PLANET_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vObj;
  void main() {
    vUv = uv;
    vObj = normalize(position);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PLANET_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tAlbedo, tNormal, tClouds, tLights;
  uniform mat3 uRot;
  uniform vec3 uSun;
  uniform float uCloudShift, uCloudThresh, uGrid, uPulse, uCloudsOn;
  uniform vec4 uRipple;
  uniform vec3 uGridColor;
  varying vec2 vUv;
  varying vec3 vNormalW, vPosW, vObj;
  const float PI = 3.14159265359;

  float gridLine(float v, float step) {
    float x = v / step;
    float d = abs(fract(x - 0.5) - 0.5) / max(fwidth(x), 1e-5);
    return 1.0 - clamp(d, 0.0, 1.0);
  }

  void main() {
    vec4 alb = texture2D(tAlbedo, vUv);
    vec4 nrm = texture2D(tNormal, vUv);
    vec3 n = normalize(uRot * normalize(nrm.rgb * 2.0 - 1.0));
    vec3 ng = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float geo = dot(ng, uSun);
    float day = smoothstep(-0.12, 0.18, geo);
    float lights = texture2D(tLights, vUv).r;
    float cl = uCloudsOn * smoothstep(uCloudThresh, uCloudThresh + 0.16, texture2D(tClouds, vUv - vec2(uCloudShift - 0.002, 0.0)).r);

    vec3 base = alb.rgb;
    base = mix(base, base * vec3(0.72, 0.70, 0.68) + vec3(0.018), clamp(lights * 0.9, 0.0, 0.5));
    float lit = max(dot(n, uSun), 0.0) * smoothstep(-0.06, 0.12, geo);
    vec3 col = base * (0.012 + lit * 1.35) * (1.0 - cl * 0.5 * day);
    vec3 H = normalize(uSun + V);
    col += vec3(1.0, 0.93, 0.8) * pow(max(dot(ng, H), 0.0), 260.0) * nrm.a * day * 0.18 * (1.0 - cl);
    col += vec3(1.0, 0.68, 0.36) * lights * lights * (1.0 - day) * (1.5 + uPulse * 0.8) * (1.0 - cl * 0.75);
    float fr = pow(1.0 - max(dot(ng, V), 0.0), 3.5);
    col += vec3(0.22, 0.45, 1.0) * fr * (0.05 + 0.75 * smoothstep(-0.3, 0.4, geo));

    if (uGrid > 0.001) {
      float lat = asin(clamp(vObj.y, -1.0, 1.0));
      float lon = atan(vObj.z, -vObj.x);
      float gl = max(gridLine(lat, PI / 12.0), gridLine(lon, PI / 12.0));
      col += uGridColor * gl * uGrid * (0.1 + uPulse * 0.05) * (0.4 + 0.6 * (1.0 - day));
    }
    if (uRipple.w >= 0.0 && uRipple.w < 5.0) {
      float ang = acos(clamp(dot(vObj, uRipple.xyz), -1.0, 1.0));
      float front = uRipple.w * 0.55;
      col += vec3(0.55, 0.7, 1.0) * exp(-pow((ang - front) * 16.0, 2.0)) * (1.0 - uRipple.w / 5.0) * 0.35;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CLOUD_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tClouds;
  uniform vec3 uSun;
  uniform float uThresh;
  varying vec2 vUv;
  varying vec3 vNormalW, vPosW;
  void main() {
    float c = texture2D(tClouds, vUv).r;
    float d = smoothstep(uThresh, uThresh + 0.16, c);
    float thick = smoothstep(uThresh + 0.1, uThresh + 0.35, c);
    vec3 ng = normalize(vNormalW);
    float geo = dot(ng, uSun);
    float lit = smoothstep(-0.15, 0.35, geo);
    vec3 col = mix(vec3(0.006, 0.008, 0.014), vec3(0.95, 0.96, 1.0) * (1.0 - thick * 0.25), lit);
    col += vec3(0.9, 0.45, 0.25) * exp(-pow(geo * 7.0, 2.0)) * 0.18;     // sunset rim on the terminator
    gl_FragColor = vec4(col, d * 0.93);
  }
`;

const HALO_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSun;
  uniform float uR, uRh;
  uniform vec3 uTint;
  varying vec3 vPosW;
  void main() {
    vec3 v = normalize(vPosW - cameraPosition);
    float dist = length(cross(v, -cameraPosition));
    float g = 1.0 - smoothstep(uR, uRh, dist);
    g = g * g;
    float sun = dot(normalize(vPosW), uSun);
    vec3 col = uTint * g * (0.15 + 1.1 * smoothstep(-0.35, 0.5, sun));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface PlanetFrame {
  dt: number;
  cloudCover: number;   // 0 calm … 1 hurricane
  clouds: boolean;
  grid: number;
  pulse: number;
}

export class Planet {
  readonly root = new Group();       // tilted axis
  readonly spin = new Group();       // turns with the planet: put surface markers in here
  readonly sunDir = new Vector3(-0.82, 0.22, 0.52).normalize();
  geo!: Geo;
  private planetMat!: ShaderMaterial;
  private cloudMat!: ShaderMaterial;
  private cloudMesh!: Mesh;
  private haloMat!: ShaderMaterial;
  private stars!: Points;
  private moon!: Mesh;
  private moonPivot = new Group();
  private sun!: Sprite;
  private rotation = 0;
  private cloudRot = 0;
  private cover = 0;
  private thresholds = [0.6, 0.5, 0.4];
  private ripple = -1;
  private rippleDir = new Vector3(0, 1, 0);
  private textures: Texture[] = [];
  private seed: number;

  constructor(private renderer: WebGLRenderer, private scene: Scene, seed = 1) {
    this.seed = seed;
    this.root.rotation.z = 0.36;
    this.root.add(this.spin);
    scene.add(this.root);
  }

  /** Bake the world at `res` texels wide (a few hundred ms on a desktop GPU). */
  async build(res: number, stars: number): Promise<void> {
    const baker = new Baker(this.renderer, this.seed);
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    // sea level: about 64% of the surface is ocean
    const pre = await baker.run(9, 256, 128);
    const sea = percentile(pre, 256, 128, 0.64);
    baker.mat.uniforms.uSea.value = sea;
    // geography always from the same 1024 bake, so a detail change never moves a city
    const geoBuf = await baker.run(0, 1024, 512);
    if (!this.geo) this.geo = new Geo(geoBuf, 1024, 512, this.seed);
    const albedo = res === 1024 ? geoBuf : await baker.run(0, res, res / 2);
    const normal = await baker.run(1, res, res / 2);
    const cw = Math.min(2048, res), clouds = await baker.run(2, cw, cw / 2);
    this.thresholds = [percentile(clouds, cw, cw / 2, 0.62), percentile(clouds, cw, cw / 2, 0.47), percentile(clouds, cw, cw / 2, 0.33)];
    const moonBuf = this.moon ? null : await baker.run(3, 512, 256);
    baker.mat.dispose();

    for (const t of this.textures) t.dispose();
    const tAlbedo = dataTex(albedo, res, res / 2, aniso);
    const tNormal = dataTex(normal, res, res / 2, aniso);
    const tClouds = dataTex(clouds, cw, cw / 2, aniso);
    const tLights = paintLights(this.geo, Math.min(2048, res), Math.min(2048, res) / 2, this.seed);
    this.textures = [tAlbedo, tNormal, tClouds, tLights];

    if (!this.planetMat) {
      this.planetMat = new ShaderMaterial({
        uniforms: {
          tAlbedo: { value: tAlbedo }, tNormal: { value: tNormal }, tClouds: { value: tClouds }, tLights: { value: tLights },
          uRot: { value: new Matrix3() }, uSun: { value: this.sunDir }, uCloudShift: { value: 0 }, uCloudThresh: { value: 0.6 },
          uGrid: { value: 1 }, uPulse: { value: 0 }, uRipple: { value: new Vector4(0, 1, 0, -1) },
          uGridColor: { value: new Color(0.95, 0.78, 0.4) }, uCloudsOn: { value: 1 },
        },
        vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
      });
      const planet = new Mesh(new SphereGeometry(R, 256, 128), this.planetMat);
      this.spin.add(planet);

      this.cloudMat = new ShaderMaterial({
        uniforms: { tClouds: { value: tClouds }, uSun: { value: this.sunDir }, uThresh: { value: 0.6 } },
        vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG,
        transparent: true, depthWrite: false,
      });
      this.cloudMesh = new Mesh(new SphereGeometry(R * 1.012, 160, 80), this.cloudMat);
      this.root.add(this.cloudMesh);

      this.haloMat = new ShaderMaterial({
        uniforms: { uSun: { value: this.sunDir }, uR: { value: R * 0.985 }, uRh: { value: R * 1.075 }, uTint: { value: new Color(0.3, 0.55, 1.0) } },
        vertexShader: 'varying vec3 vPosW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPosW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: HALO_FRAG,
        side: BackSide, transparent: true, blending: AdditiveBlending, depthWrite: false,
      });
      this.scene.add(new Mesh(new SphereGeometry(R * 1.075, 96, 48), this.haloMat));

      this.buildSky(stars, moonBuf!);
    } else {
      Object.assign(this.planetMat.uniforms.tAlbedo, { value: tAlbedo });
      Object.assign(this.planetMat.uniforms.tNormal, { value: tNormal });
      Object.assign(this.planetMat.uniforms.tClouds, { value: tClouds });
      Object.assign(this.planetMat.uniforms.tLights, { value: tLights });
      this.cloudMat.uniforms.tClouds.value = tClouds;
    }
  }

  private buildSky(stars: number, moonBuf: Uint8Array): void {
    this.setStars(stars);
    // the sun: a hot glow far off along the light
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const g = sc.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,246,225,0.95)');
    gr.addColorStop(0.25, 'rgba(255,200,140,0.25)'); gr.addColorStop(1, 'rgba(255,160,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this.sun = new Sprite(new SpriteMaterial({ map: new CanvasTexture(sc), blending: AdditiveBlending, depthWrite: false, color: new Color(3, 2.8, 2.5) }));
    this.sun.scale.setScalar(220);
    this.sun.position.copy(this.sunDir).multiplyScalar(1500);
    this.scene.add(this.sun);
    // a moon on a slow inclined orbit
    const tMoon = dataTex(moonBuf, 512, 256, 4);
    this.moon = new Mesh(new SphereGeometry(13, 48, 24), new ShaderMaterial({
      uniforms: { tMap: { value: tMoon }, uSun: { value: this.sunDir } },
      vertexShader: PLANET_VERT,
      fragmentShader: `precision highp float; uniform sampler2D tMap; uniform vec3 uSun; varying vec2 vUv; varying vec3 vNormalW;
        void main() { float g = texture2D(tMap, vUv).r; float l = max(dot(normalize(vNormalW), uSun), 0.0);
          gl_FragColor = vec4(vec3(g) * (0.004 + l * 1.1), 1.0); }`,
    }));
    this.moon.position.set(430, 0, 0);
    this.moonPivot.rotation.set(0.25, 1.9, 0.12);
    this.moonPivot.add(this.moon);
    this.scene.add(this.moonPivot);
  }

  setStars(density: number): void {
    if (this.stars) { this.scene.remove(this.stars); this.stars.geometry.dispose(); }
    const n = Math.round(4200 * density);
    const pos: number[] = [], col: number[] = [];
    let s = 1234567;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      pos.push(Math.cos(a) * rr * 1700, u * 1700, Math.sin(a) * rr * 1700);
      const b = Math.pow(rand(), 3) * 1.4 + 0.12, tint = rand();
      col.push(b * (tint > 0.8 ? 1 : 0.85), b * 0.92, b * (tint < 0.2 ? 0.8 : 1.05));
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geom.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.stars = new Points(geom, new ShaderMaterial({
      vertexShader: `attribute vec3 color; varying vec3 vC; void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = 1.0 + color.g * 1.6; }`,
      fragmentShader: `precision mediump float; varying vec3 vC; void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)); gl_FragColor = vec4(vC * a, 1.0); }`,
      transparent: true, blending: AdditiveBlending, depthWrite: false,
    }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  /** World position of a surface point (or `alt` world units above it). */
  surface(lat: number, lon: number, alt = 0, out = new Vector3()): Vector3 {
    dirOf(lat, lon, out).multiplyScalar(R + alt);
    return this.spin.localToWorld(out);
  }

  /** 1 in full daylight at a point, 0 at night. */
  daylight(lat: number, lon: number): number {
    const p = this.surface(lat, lon).normalize();
    return Math.max(0, Math.min(1, (p.dot(this.sunDir) + 0.12) / 0.3));
  }

  /** A system event: a ripple through the atmosphere from a point. */
  rippleFrom(lat: number, lon: number): void {
    dirOf(lat, lon, this.rippleDir);
    this.ripple = 0;
  }

  update(f: PlanetFrame): void {
    this.rotation += f.dt * (Math.PI * 2) / 480;
    this.cloudRot += f.dt * (Math.PI * 2) / 420;
    this.spin.rotation.y = this.rotation;
    this.cloudMesh.rotation.y = this.cloudRot;
    this.root.updateMatrixWorld(true);
    this.planetMat.uniforms.uRot.value.setFromMatrix4(this.spin.matrixWorld);
    // the cloud texture is offset from the ground by how far the clouds have drifted
    this.planetMat.uniforms.uCloudShift.value = ((this.cloudRot - this.rotation) / (Math.PI * 2)) % 1;
    this.cover += (f.cloudCover - this.cover) * Math.min(1, f.dt * 0.08);
    const [c0, c1, c2] = this.thresholds;
    const th = this.cover < 0.5 ? c0 + (c1 - c0) * this.cover * 2 : c1 + (c2 - c1) * (this.cover - 0.5) * 2;
    this.planetMat.uniforms.uCloudThresh.value = th;
    this.cloudMat.uniforms.uThresh.value = th;
    this.cloudMesh.visible = f.clouds;
    this.planetMat.uniforms.uCloudsOn.value = f.clouds ? 1 : 0;
    this.planetMat.uniforms.uGrid.value += (f.grid - this.planetMat.uniforms.uGrid.value) * Math.min(1, f.dt * 2);
    this.planetMat.uniforms.uPulse.value = f.pulse;
    if (this.ripple >= 0) {
      this.ripple += f.dt;
      if (this.ripple > 5) this.ripple = -1;
    }
    this.planetMat.uniforms.uRipple.value.set(this.rippleDir.x, this.rippleDir.y, this.rippleDir.z, this.ripple);
    this.moonPivot.rotation.y += f.dt * 0.004;
  }

  cloudsVisible(v: boolean): void { this.cloudMesh.visible = v; }
}
