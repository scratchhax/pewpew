import {
  ACESFilmicToneMapping, Color, HalfFloatType, PerspectiveCamera, Scene, SRGBColorSpace,
  Vector2, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Renderer for the storage cavern: everything is self-lit and the fog eats
 * the distance, so the lens pass is light — a slight colour fringe, grain,
 * and a vignette that leans blue-violet. All eased; nothing strobes.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new Vector2(1920, 1080) }, uVignette: { value: 0.62 },
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
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float ab = dot(c, c) * 0.0018;
      vec3 col = vec3(texture2D(tDiffuse, uv + c * ab).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ab).b);
      float vig = smoothstep(0.2, 0.9, dot(c, c) * 2.2);
      col *= 1.0 - vig * uVignette;
      col = mix(col, col * vec3(0.78, 0.76, 1.15) + vec3(0.012, 0.006, 0.03), vig * 0.8);
      col += (h21(uv * uRes + fract(uTime * 7.0) * 91.0) - 0.5) * 0.012;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  bloom: UnrealBloomPass;
  lens: ShaderPass;
  resize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  render(bloomOn: boolean): void;
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

  const scene = new Scene();
  scene.background = new Color(0x000004);

  const camera = new PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 160);
  camera.position.set(0, 8, 7);

  const px = window.innerWidth * window.innerHeight * ratio * ratio;
  const target = new WebGLRenderTarget(window.innerWidth * ratio, window.innerHeight * ratio, { type: HalfFloatType, samples: msaa ? (px > 2.2e6 ? 2 : 4) : 0 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(window.innerWidth, window.innerHeight);
  const pass = new RenderPass(scene, camera);
  // a low threshold: the edge frames and the listings are the whole scene, let them bloom
  const bloom = new UnrealBloomPass(new Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.8, 0.5, 0.35);
  const lens = new ShaderPass(LensShader);
  composer.addPass(pass);
  composer.addPass(bloom);
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  const setRes = () => {
    const pr = renderer.getPixelRatio();
    lens.uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
    bloom.setSize(Math.round(window.innerWidth * pr / 2), Math.round(window.innerHeight * pr / 2));
  };
  setRes();

  return {
    renderer, scene, camera, bloom, lens,
    resize(w, h) { renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); setRes(); },
    setPixelRatio(r) { renderer.setPixelRatio(r); composer.setPixelRatio(r); composer.setSize(window.innerWidth, window.innerHeight); setRes(); },
    render(bloomOn) {
      bloom.enabled = bloomOn;
      renderer.info.reset();
      composer.render();
    },
  };
}
