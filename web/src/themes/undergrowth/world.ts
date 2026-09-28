import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, FogExp2,
  HalfFloatType, Mesh, PerspectiveCamera, PlaneGeometry, Points, Scene, ShaderMaterial, SRGBColorSpace, Vector2,
  SphereGeometry, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * The subterranean void the mat grows in: a deep-earth backdrop, a faint
 * floor mist far below (you are underground, and the loam is down there),
 * drifting dust, and a lens pass with a soft vignette. No lights at all —
 * everything in the scene is unlit and self-luminous, so the whole look is
 * bloom over dark. Modeled on the aquarium world.
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

const vsWorld = /* glsl */`
  varying vec3 vWp;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWp = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  bloom: UnrealBloomPass;
  lens: ShaderPass;
  specks: Points;
  resize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  setBloom(on: boolean): void;
  setSpecks(n: number): void;
  /** `t` is sim seconds (bullet time slows the void too); `driftMul` stirs the dust on weather. */
  update(dt: number, t: number, driftMul: number): void;
  render(): void;
}

/** The earth all around: dark soil below, a faint glow of the forest above. */
function backdrop(): Mesh {
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: vsWorld,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWp;
      void main() {
        vec3 dir = normalize(vWp - cameraPosition);
        float up = dir.y;
        vec3 soil = vec3(0.010, 0.014, 0.012);
        vec3 earth = vec3(0.016, 0.030, 0.026);
        vec3 canopy = vec3(0.030, 0.075, 0.062);
        vec3 col = mix(soil, earth, smoothstep(-0.85, 0.05, up));
        col = mix(col, canopy, smoothstep(0.15, 0.9, up) * 0.8);
        // a slow, breathing band where the canopy glow leaks in
        float band = exp(-pow((up - 0.22 + 0.03 * sin(uTime * 0.07 + dir.x * 3.0)) * 7.0, 2.0));
        col += vec3(0.05, 0.14, 0.11) * band * 0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: BackSide, depthWrite: false,
  });
  const m = new Mesh(new SphereGeometry(800, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** The loam, far below: a wide plane of slow-drifting dark mist. */
function floorMist(): Mesh {
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: vsWorld,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWp;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 p = vWp.xz * 0.04 + vec2(uTime * 0.008, uTime * 0.005);
        float n = noise(p) * 0.55 + noise(p * 2.7) * 0.3 + noise(p * 6.1) * 0.15;
        float dist = length(vWp.xz - cameraPosition.xz);
        float a = (0.25 + n * 0.55) * exp(-dist * 0.011);
        vec3 col = mix(vec3(0.02, 0.045, 0.038), vec3(0.05, 0.10, 0.085), n);
        gl_FragColor = vec4(col, a * 0.5);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const m = new Mesh(new PlaneGeometry(1600, 1600, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -66; // below the web sphere (its base sits at ~-47)
  m.renderOrder = -5;
  return m;
}

/** Drifting dust in a box around the camera; they wrap, so the drift is all in the shader. */
function specks(): Points {
  const n = 2200;
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); rnd[i] = Math.random(); }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new BufferAttribute(rnd, 1));
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uPx: { value: 1 }, uDrift: { value: [0, 0, 0] },
      uBox: { value: [150, 130, 150] }, uCenter: { value: [0, 0, 0] },
    },
    vertexShader: /* glsl */`
      uniform float uTime, uPx;
      uniform vec3 uDrift, uBox, uCenter;
      attribute float aRnd;
      varying float vA;
      varying vec3 vWp;
      void main() {
        vec3 p = position * uBox + uDrift * (0.6 + aRnd * 0.8);
        p += sin(uTime * 0.25 + aRnd * 40.0) * vec3(1.2, 0.9, 1.1) + cos(uTime * 0.21 + aRnd * 29.0) * vec3(0.8, 1.1, 0.7);
        p = mod(p, uBox) - uBox * 0.5 + uCenter;
        vWp = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = (0.06 + aRnd * aRnd * 0.2);
        gl_PointSize = size * uPx * 900.0 / -mv.z;
        vA = 0.12 + aRnd * 0.3;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      varying vec3 vWp;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c)) * vA;
        float dist = length(vWp - cameraPosition);
        a *= exp(-0.00006 * dist * dist) * smoothstep(1.5, 7.0, dist);
        gl_FragColor = vec4(vec3(0.72, 0.95, 0.85) * a * 0.5, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const p = new Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 6;
  return p;
}

export function createWorld(mount: HTMLElement, antialias: boolean, powerPref: WebGLPowerPreference | undefined, ratio: number): World {
  const renderer = new WebGLRenderer({ antialias, powerPreference: powerPref, stencil: false });
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.info.autoReset = false;
  renderer.domElement.style.display = 'block';
  mount.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x04080a);
  scene.fog = new FogExp2(0x04080a, 0.007);

  const camera = new PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 1500);
  camera.position.set(0, 0, 40);

  // multisampling is charged per pixel of the whole screen, so big screens take fewer samples
  const px = window.innerWidth * window.innerHeight * ratio * ratio;
  const target = new WebGLRenderTarget(window.innerWidth * ratio, window.innerHeight * ratio, { type: HalfFloatType, samples: px > 2.2e6 ? 0 : (antialias ? 4 : 0) });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(window.innerWidth, window.innerHeight);
  const pass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.6, 0.55, 0.25);
  const lens = new ShaderPass(LensShader);
  composer.addPass(pass);
  composer.addPass(bloom);
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  const backdropMesh = backdrop();
  const mistMesh = floorMist();
  const speckPoints = specks();
  scene.add(backdropMesh, mistMesh, speckPoints);

  const setRes = () => {
    const pr = renderer.getPixelRatio();
    lens.uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
    bloom.setSize(Math.round(window.innerWidth * pr / 2), Math.round(window.innerHeight * pr / 2));
    (speckPoints.material as ShaderMaterial).uniforms.uPx.value = window.innerHeight * pr / 1080;
  };
  setRes();

  const drift = [0, 0, 0];
  return {
    renderer, scene, camera, bloom, lens, specks: speckPoints,
    resize(w, h) { renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); setRes(); },
    setPixelRatio(r) { renderer.setPixelRatio(r); composer.setPixelRatio(r); composer.setSize(window.innerWidth, window.innerHeight); setRes(); },
    setBloom(on) { bloom.enabled = on; },
    setSpecks(n) { speckPoints.geometry.setDrawRange(0, n); },
    update(dt, t, driftMul) {
      drift[0] += dt * 1.6 * driftMul; drift[1] += dt * 0.4 * driftMul; drift[2] += dt * 1.1 * driftMul;
      const u = (speckPoints.material as ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uDrift.value = drift;
      u.uCenter.value = [camera.position.x, camera.position.y, camera.position.z];
      (backdropMesh.material as ShaderMaterial).uniforms.uTime.value = t;
      (mistMesh.material as ShaderMaterial).uniforms.uTime.value = t;
      lens.uniforms.uTime.value = t;
    },
    render() {
      renderer.info.reset();
      composer.render();
    },
  };
}
