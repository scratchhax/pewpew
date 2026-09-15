import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, FogExp2, HemisphereLight, Mesh, MeshBasicMaterial,
  HalfFloatType, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector2, WebGLRenderTarget, WebGLRenderer, type Camera, type Texture,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Renderer, two scenes (the board and the inside of a chip) sharing one
 * neon-lit reflection map, and a lens pass: a warm edge when the board
 * overclocks, a radial zoom blur and a gold whiteout for diving into a chip,
 * slight colour fringing, grain and a vignette. All eased; nothing strobes.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new Vector2(1920, 1080) },
    uDive: { value: 0 }, uZoom: { value: 0 }, uHeat: { value: 0 }, uVignette: { value: 0.6 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uDive, uZoom, uHeat, uVignette;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      vec3 col;
      if (uZoom > 0.001) {
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 12; i++) {
          float k = float(i) / 11.0;
          float w = 1.0 - k * 0.6;
          acc += texture2D(tDiffuse, 0.5 + c * (1.0 - k * uZoom * 0.18)).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      } else {
        float ab = dot(c, c) * 0.0016;
        col = vec3(texture2D(tDiffuse, uv + c * ab).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ab).b);
      }
      // diving through the die: a gold whiteout crossed by a lattice rushing past
      if (uDive > 0.001) {
        // perspective lattice rushing toward the lens
        vec2 v = c * 3.0 / (0.12 + length(c));
        vec2 g = abs(fract(v + vec2(0.0, uTime * 1.8)) - 0.5);
        float lattice = smoothstep(0.38, 0.5, max(g.x, g.y));
        float core = exp(-length(c) * 3.5);
        vec3 gold = vec3(1.0, 0.78, 0.38);
        vec3 through = gold * (0.35 + core * 1.1) * (1.0 - lattice * 0.85) + gold * lattice * core * 0.3;
        col = mix(col, through, smoothstep(0.0, 1.0, uDive));
      }
      float vig = smoothstep(0.2, 0.9, dot(c, c) * 2.2);
      col *= 1.0 - vig * uVignette;
      col = mix(col, col * vec3(1.25, 0.75, 0.45) + vec3(0.04, 0.01, 0.0), vig * uHeat * 0.8);
      col += (h21(vUv * uRes + fract(uTime * 7.0) * 91.0) - 0.5) * 0.01;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;           // the board
  inner: Scene;           // inside a chip
  camera: PerspectiveCamera;
  env: Texture;
  key: DirectionalLight;
  innerKey: DirectionalLight;
  bloom: UnrealBloomPass;
  lens: ShaderPass;
  resize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  render(scene: Scene, camera: Camera, bloomOn: boolean): void;
}

function neonEnv(renderer: WebGLRenderer): Texture {
  const env = new Scene();
  env.background = new Color(0x020308);
  const strip = (color: number, k: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new Mesh(new BoxGeometry(sx, sy, sz), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k) }));
    m.position.set(x, y, z);
    env.add(m);
  };
  strip(0x3ff0ff, 5, -9, 6, 0, 0.5, 2, 40);
  strip(0xff3fb4, 1.6, 9, 7, 0, 0.5, 2, 40);
  strip(0xffffff, 4, 0, 12, 0, 30, 0.4, 3);
  strip(0xffb040, 2, 0, 9, -14, 12, 0.4, 0.4);
  strip(0x8fa8ff, 1.5, 0, -3, 0, 40, 0.2, 40);
  const pm = new PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.04);
  pm.dispose();
  return rt.texture;
}

export function createWorld(mount: HTMLElement, antialias: boolean, powerPref: WebGLPowerPreference | undefined, ratio: number, msaa: boolean): World {
  const renderer = new WebGLRenderer({ antialias, powerPreference: powerPref, stencil: false });
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.info.autoReset = false;
  renderer.domElement.style.display = 'block';
  mount.appendChild(renderer.domElement);
  const env = neonEnv(renderer);

  const scene = new Scene();
  scene.background = new Color(0x020406);
  scene.fog = new FogExp2(0x020406, 0.0017);
  const key = new DirectionalLight(0xcfe6ff, 2.2);
  key.position.set(-40, 90, 30);
  scene.add(key, key.target, new HemisphereLight(0x5a88b0, 0x0a0f0c, 0.55));

  const inner = new Scene();
  inner.background = new Color(0x05020c);
  inner.fog = new FogExp2(0x05020c, 0.0035);
  const innerKey = new DirectionalLight(0xd8c8ff, 1.8);
  innerKey.position.set(30, 80, 20);
  inner.add(innerKey, innerKey.target, new HemisphereLight(0x8a6ad0, 0x0a0614, 0.7));

  const camera = new PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 900);
  // multisampled scene target: the board is all thin traces and pins, which crawl without it
  // multisampling is charged per pixel of the whole screen, so big surfaces take fewer samples
  const px = window.innerWidth * window.innerHeight * ratio * ratio;
  const target = new WebGLRenderTarget(window.innerWidth * ratio, window.innerHeight * ratio, { type: HalfFloatType, samples: msaa ? (px > 2.2e6 ? 2 : 4) : 0 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(window.innerWidth, window.innerHeight);
  const pass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.75, 0.55, 0.8);
  const lens = new ShaderPass(LensShader);
  composer.addPass(pass);
  composer.addPass(bloom);
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  const setRes = () => {
    const pr = renderer.getPixelRatio();
    lens.uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
    // bloom is soft anyway: half resolution costs a quarter of the fill
    bloom.setSize(Math.round(window.innerWidth * pr / 2), Math.round(window.innerHeight * pr / 2));
  };
  setRes();

  return {
    renderer, scene, inner, camera, env, key, innerKey, bloom, lens,
    resize(w, h) { renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); setRes(); },
    setPixelRatio(r) { renderer.setPixelRatio(r); composer.setPixelRatio(r); composer.setSize(window.innerWidth, window.innerHeight); setRes(); },
    render(sc, cam, bloomOn) {
      pass.scene = sc; pass.camera = cam;
      bloom.enabled = bloomOn;
      renderer.info.reset();
      composer.render();
    },
  };
}
