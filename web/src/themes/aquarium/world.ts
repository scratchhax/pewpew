import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Group,
  HalfFloatType, HemisphereLight, Mesh, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Points, Scene, ShaderMaterial,
  SphereGeometry, SRGBColorSpace, Vector2, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { W, WATER_GLSL } from './water';

/**
 * Renderer, lights, the open water around the reef (a backdrop that matches
 * the murk, the rippling surface seen from below with its bright window
 * straight up, shafts of sunlight and drifting specks), and a lens pass with a
 * soft vignette and a touch of fringing. No wobble, nothing strobes.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new Vector2(1920, 1080) }, uVignette: { value: 0.55 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 c = vUv - 0.5;
      float ab = dot(c, c) * 0.0022;
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ab).b);
      float vig = smoothstep(0.15, 0.95, dot(c, c) * 2.0);
      col *= 1.0 - vig * uVignette;
      col += (h21(vUv * uRes + fract(uTime * 7.0) * 91.0) - 0.5) * 0.008;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  sun: DirectionalLight;
  rim: DirectionalLight;
  hemi: HemisphereLight;
  bloom: UnrealBloomPass;
  lens: ShaderPass;
  rays: Group;
  specks: Points;
  resize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  setShadows(on: boolean): void;
  setSpecks(n: number): void;
  update(dt: number, drift: { x: number; y: number; z: number }): void;
  render(bloomOn: boolean): void;
}

const vsWorld = /* glsl */`
  varying vec3 vWp;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWp = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

/** Open water all around: exactly the murk colour, so the reef fades into it. */
function backdrop(): Mesh {
  const mat = new ShaderMaterial({
    uniforms: W,
    vertexShader: vsWorld,
    fragmentShader: /* glsl */`
      ${WATER_GLSL}
      varying vec3 vWp;
      void main() {
        vec3 dir = normalize(vWp - cameraPosition);
        gl_FragColor = vec4(waterColor(dir, cameraPosition.y), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: BackSide, depthWrite: false,
  });
  const m = new Mesh(new SphereGeometry(700, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** The underside of the surface: rippling, bright straight up, a dim mirror further out. */
function surface(): Mesh {
  const mat = new ShaderMaterial({
    uniforms: W,
    vertexShader: vsWorld,
    fragmentShader: /* glsl */`
      ${WATER_GLSL}
      varying vec3 vWp;
      float wave(vec2 p, float t) {
        return sin(p.x * 0.09 + t * 0.7) * 0.5 + sin(p.y * 0.12 - t * 0.9 + p.x * 0.03) * 0.4
          + sin((p.x + p.y) * 0.21 + t * 1.3) * 0.25 + sin((p.x - p.y * 1.3) * 0.37 - t * 1.7) * 0.12;
      }
      void main() {
        vec3 d = vWp - cameraPosition;
        float dist = length(d);
        vec3 dir = d / dist;
        float t = uTime * (0.8 + uCurrent * 0.8);
        vec2 p = vWp.xz;
        float e = 0.8;
        vec2 grad = vec2(wave(p + vec2(e, 0.0), t) - wave(p - vec2(e, 0.0), t), wave(p + vec2(0.0, e), t) - wave(p - vec2(0.0, e), t)) / (2.0 * e);
        vec3 n = normalize(vec3(-grad.x * (1.5 + uCurrent), -1.0, -grad.y * (1.5 + uCurrent)));
        // Snell's window: looking up steeply you see the bright sky, shallower you see the water mirrored
        float cosI = abs(dot(dir, n));
        float window = smoothstep(0.62, 0.78, cosI);
        vec3 sky = vec3(0.75, 0.95, 1.0) * (1.4 + 0.5 * pow(max(0.0, dot(reflect(dir, n), -uSunDir)), 1.0));
        vec3 mirror = uDeep * 1.4 + uShallow * 0.35;
        vec3 col = mix(mirror, sky, window) * uLight;
        col += vec3(0.8, 1.0, 1.0) * causticRaw(p / 23.0, uTime * 0.5) * 0.35 * uLight;
        float f = 1.0 - exp(-uMurk * uMurk * dist * dist * 0.55);
        col = mix(col, waterColor(dir, cameraPosition.y), f);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: DoubleSide, depthWrite: false,
  });
  const m = new Mesh(new PlaneGeometry(1400, 1400, 1, 1), mat);
  m.rotation.x = Math.PI / 2;
  m.position.y = W.uSurfaceY.value;
  m.renderOrder = -9;
  return m;
}

/** Shafts of sunlight: tall soft quads that turn to face the camera, breathing slowly. */
function rays(): Group {
  const g = new Group();
  const mat = new ShaderMaterial({
    uniforms: { ...W, uSeed: { value: 0 }, uStrength: { value: 1 } },
    vertexShader: vsWorld,
    fragmentShader: /* glsl */`
      ${WATER_GLSL}
      uniform float uSeed, uStrength;
      varying vec3 vWp;
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float streaks = 0.55 + 0.45 * sin(vUv.x * 19.0 + uSeed * 7.0 + sin(uTime * 0.21 + uSeed) * 2.0)
          * sin(vUv.x * 7.0 - uTime * 0.13 + uSeed * 3.0);
        float breathe = 0.6 + 0.4 * sin(uTime * 0.17 + uSeed * 5.3);
        float down = pow(vUv.y, 1.6);
        float a = pow(max(across, 0.0), 2.2) * streaks * breathe * down;
        float dist = length(vWp - cameraPosition);
        a *= exp(-uMurk * uMurk * dist * dist * 0.45) * smoothstep(8.0, 30.0, dist);
        gl_FragColor = vec4(vec3(0.55, 0.85, 0.95) * a * 0.16 * uStrength * uLight * (1.0 - uCurrent * 0.25), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  });
  for (let i = 0; i < 11; i++) {
    const m = mat.clone();
    m.uniforms = { ...W, uSeed: { value: Math.random() * 10 }, uStrength: { value: 0.6 + Math.random() * 0.6 } };
    const w = 6 + Math.random() * 12, h = 80;
    const geo = new PlaneGeometry(w, h, 1, 1);
    geo.translate(0, -h / 2, 0);
    const q = new Mesh(geo, m);
    q.position.set(-90 + Math.random() * 180, W.uSurfaceY.value, -70 + Math.random() * 70);
    q.userData.slant = 0.25 + Math.random() * 0.1;
    q.renderOrder = 5;
    q.frustumCulled = false;
    g.add(q);
  }
  return g;
}

/** Drifting specks in a box around the camera; they wrap, so the drift is all in the shader. */
function specks(): Points {
  const n = 3000;
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); rnd[i] = Math.random(); }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new BufferAttribute(rnd, 1));
  const mat = new ShaderMaterial({
    uniforms: { ...W, uDrift: { value: [0, 0, 0] }, uBox: { value: [140, 60, 110] }, uCenter: { value: [0, 22, 10] }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime, uPx;
      uniform vec3 uDrift, uBox, uCenter;
      attribute float aRnd;
      varying float vA;
      varying vec3 vWp;
      void main() {
        vec3 p = position * uBox + uDrift * (0.6 + aRnd * 0.8);
        p += vec3(sin(uTime * 0.3 + aRnd * 40.0), sin(uTime * 0.23 + aRnd * 17.0), cos(uTime * 0.27 + aRnd * 29.0)) * 0.8;
        p = mod(p, uBox) - uBox * 0.5 + uCenter;
        vWp = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = (0.08 + aRnd * aRnd * 0.22);
        gl_PointSize = size * uPx * 900.0 / -mv.z;
        vA = 0.25 + aRnd * 0.5;
      }`,
    fragmentShader: /* glsl */`
      ${WATER_GLSL}
      varying float vA;
      varying vec3 vWp;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c)) * vA;
        float dist = length(vWp - cameraPosition);
        a *= exp(-uMurk * uMurk * dist * dist) * smoothstep(2.0, 8.0, dist);
        gl_FragColor = vec4(vec3(0.75, 0.9, 0.85) * uLight * a * 0.55, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const p = new Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 6;
  return p;
}

export function createWorld(mount: HTMLElement, antialias: boolean, powerPref: WebGLPowerPreference | undefined, ratio: number, msaa: boolean): World {
  const renderer = new WebGLRenderer({ antialias, powerPreference: powerPref, stencil: false });
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.domElement.style.display = 'block';
  mount.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x02203a);
  // the sun first: the caustics ride on directional light 0
  const sun = new DirectionalLight(0xe8fbff, 2.6);
  sun.position.copy(W.uSunDir.value).multiplyScalar(120);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 90, bottom: -90, near: 10, far: 320 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const rim = new DirectionalLight(0xffa040, 0);
  rim.position.set(-60, 20, -80);
  scene.add(rim, rim.target);
  const hemi = new HemisphereLight(0x6cc4e0, 0x6a5a40, 1.2);
  scene.add(hemi);
  scene.add(backdrop(), surface());
  const rayGroup = rays();
  const speckPoints = specks();
  scene.add(rayGroup, speckPoints);

  const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1500);
  camera.position.set(0, 17, 64);

  const target = new WebGLRenderTarget(window.innerWidth * ratio, window.innerHeight * ratio, { type: HalfFloatType, samples: msaa ? 4 : 0 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(window.innerWidth, window.innerHeight);
  const pass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.32, 0.6, 0.85);
  const lens = new ShaderPass(LensShader);
  composer.addPass(pass);
  composer.addPass(bloom);
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  const setRes = () => {
    const pr = renderer.getPixelRatio();
    lens.uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
    bloom.setSize(Math.round(window.innerWidth * pr / 2), Math.round(window.innerHeight * pr / 2));
    (speckPoints.material as ShaderMaterial).uniforms.uPx.value = window.innerHeight * pr / 1080;
  };
  setRes();

  const drift = [0, 0, 0];
  return {
    renderer, scene, camera, sun, rim, hemi, bloom, lens, rays: rayGroup, specks: speckPoints,
    resize(w, h) { renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); setRes(); },
    setPixelRatio(r) { renderer.setPixelRatio(r); composer.setPixelRatio(r); composer.setSize(window.innerWidth, window.innerHeight); setRes(); },
    setShadows(on) {
      if (renderer.shadowMap.enabled === on) return;
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      scene.traverse((o) => { const m = (o as Mesh).material; if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true; });
    },
    setSpecks(n) { speckPoints.geometry.setDrawRange(0, n); },
    update(dt, d) {
      drift[0] += d.x * dt; drift[1] += d.y * dt; drift[2] += d.z * dt;
      const u = (speckPoints.material as ShaderMaterial).uniforms;
      u.uDrift.value = drift;
      u.uCenter.value = [camera.position.x, 22, camera.position.z - 50];
      for (const r of rayGroup.children) {
        // cylindrical billboard, leaning away from the sun
        r.rotation.set(0, Math.atan2(camera.position.x - r.position.x, camera.position.z - r.position.z), 0);
        r.rotateZ(r.userData.slant * Math.sign(W.uSunDir.value.x));
      }
    },
    render(bloomOn) {
      bloom.enabled = bloomOn;
      renderer.info.reset();
      composer.render();
    },
  };
}
