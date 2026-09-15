import {
  ACESFilmicToneMapping, Color, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, WebGLRenderer,
  type Camera,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * The surveillance lens, one pass after bloom:
 *  - pixelation for the enhance steps
 *  - a cloud whiteout that hides the swap between orbit and the close-up
 *  - imaging modes: satellite daylight, night vision, thermal (ironbow)
 *  - film grain, a scan line that sweeps each enhance, an alert tint for DEFCON
 * Everything is driven by eased uniforms; nothing strobes.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new Vector2(1920, 1080) }, uTime: { value: 0 },
    uPixel: { value: 1 }, uCloud: { value: 0 }, uCloudDark: { value: 0 }, uMode: { value: 0 }, uModeMix: { value: 0 },
    uGrain: { value: 0.03 }, uScan: { value: -1 }, uAlert: { value: 0 }, uVignette: { value: 0.55 }, uFade: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uPixel, uCloud, uCloudDark, uMode, uModeMix, uGrain, uScan, uAlert, uVignette, uFade;
    varying vec2 vUv;
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.07; a *= 0.5; } return s; }
    vec3 ironbow(float x) {
      x = clamp(x, 0.0, 1.0);
      vec3 c = mix(vec3(0.0, 0.0, 0.05), vec3(0.3, 0.0, 0.5), smoothstep(0.0, 0.3, x));
      c = mix(c, vec3(0.85, 0.1, 0.25), smoothstep(0.25, 0.55, x));
      c = mix(c, vec3(1.0, 0.55, 0.0), smoothstep(0.5, 0.75, x));
      c = mix(c, vec3(1.0, 0.95, 0.6), smoothstep(0.72, 0.95, x));
      return c;
    }
    void main() {
      vec2 uv = vUv;
      if (uPixel > 1.01) {
        vec2 cell = uPixel / uRes;
        uv = (floor(uv / cell) + 0.5) * cell;
      }
      vec3 col = texture2D(tDiffuse, uv).rgb;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 graded = col;
      if (uMode > 0.5 && uMode < 1.5) {          // satellite daylight: flat, slightly washed
        graded = mix(vec3(lum), col, 0.62) * 1.05 + 0.015;
      } else if (uMode > 1.5 && uMode < 2.5) {   // night vision
        float g = 1.0 - exp(-lum * 6.5);
        graded = vec3(0.12, 0.9, 0.32) * g * 0.95 + vec3(0.0, 0.01, 0.004);
      } else if (uMode > 2.5) {                  // thermal
        float blur = (texture2D(tDiffuse, uv + vec2(1.5, 0.0) / uRes).r + texture2D(tDiffuse, uv - vec2(1.5, 0.0) / uRes).r
          + texture2D(tDiffuse, uv + vec2(0.0, 1.5) / uRes).r + texture2D(tDiffuse, uv - vec2(0.0, 1.5) / uRes).r) * 0.25;
        graded = ironbow(clamp(pow(mix(lum, blur, 0.5), 1.15) * 1.05, 0.0, 1.0)) * 0.8;
      }
      col = mix(col, graded, uModeMix);
      // the swap happens inside a cloud
      if (uCloud > 0.001) {
        vec2 cuv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * (2.2 - uCloud * 0.8);
        float n = fbm(cuv * 2.0 + vec2(uTime * 0.07, uTime * 0.21));
        float n2 = fbm(cuv * 5.0 - vec2(uTime * 0.13, uTime * 0.05));
        float cover = smoothstep(0.3, 0.62, n * 0.55 + n2 * 0.2 + uCloud * 0.95 - 0.3);
        vec3 cloud = mix(vec3(0.62, 0.64, 0.68), vec3(0.012, 0.014, 0.02), uCloudDark) * (0.55 + n * 0.7 + n2 * 0.25);
        col = mix(col, cloud, clamp(cover, 0.0, 1.0));
      }
      if (uScan >= 0.0) {
        float d = abs(vUv.y - uScan);
        col += vec3(0.6, 0.9, 1.0) * exp(-d * 180.0) * 0.35;
        col *= 1.0 - smoothstep(0.0, 0.25, uScan - vUv.y) * 0.0;
      }
      float grain = (h21(vUv * uRes + fract(uTime * 13.0) * 100.0) - 0.5) * uGrain;
      col += grain;
      vec2 c = vUv - 0.5;
      float vig = smoothstep(0.25, 0.85, dot(c, c) * 2.2);
      col *= 1.0 - vig * uVignette;
      col = mix(col, col * vec3(1.15, 0.72, 0.55) + vec3(0.03, 0.0, 0.0), vig * uAlert * 0.8);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  lens: ShaderPass;
  resize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  render(scene: Scene, camera: Camera, bloomOn: boolean): void;
}

export function createWorld(mount: HTMLElement, antialias: boolean, powerPref: WebGLPowerPreference | undefined, ratio: number, shadows: boolean): World {
  const renderer = new WebGLRenderer({ antialias, powerPreference: powerPref, stencil: false });
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.domElement.style.display = 'block';
  mount.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x000000);
  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 5000);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(ratio);
  composer.setSize(window.innerWidth, window.innerHeight);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), 0.55, 0.6, 0.78);
  const lens = new ShaderPass(LensShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  const setRes = () => {
    const pr = renderer.getPixelRatio();
    lens.uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
  };
  setRes();

  return {
    renderer, scene, camera, composer, bloom, lens,
    resize(w, h) {
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      setRes();
    },
    setPixelRatio(r) {
      renderer.setPixelRatio(r);
      composer.setPixelRatio(r);
      composer.setSize(window.innerWidth, window.innerHeight);
      setRes();
    },
    render(sc, cam, bloomOn) {
      renderPass.scene = sc;
      renderPass.camera = cam;
      bloom.enabled = bloomOn;
      renderer.info.reset();
      composer.render();
    },
  };
}
