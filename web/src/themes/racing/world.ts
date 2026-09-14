import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, Color, CylinderGeometry, FogExp2, Mesh, MeshBasicMaterial,
  PerspectiveCamera, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector2, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { skyline } from './textures';

/** Night fog: deep blue with a violet cast. */
export const FOG = new Color(0x0d0a1f);

/** Vignette + a whisper of chromatic aberration toward the edges (lens feel). */
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uAberration: { value: 0.0015 }, uVignette: { value: 0.9 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uAberration; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberration * (0.4 + r2 * 4.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(1.0, 1.0 - uVignette * 0.9, smoothstep(0.1, 0.55, r2));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  lens: ShaderPass;
  skyline: Mesh;
  resize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  render(bloomOn: boolean): void;
}

export function createWorld(mount: HTMLElement, antialias: boolean, powerPref: WebGLPowerPreference | undefined, ratio: number): World {
  const renderer = new WebGLRenderer({ antialias, powerPreference: powerPref, stencil: false });
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.info.autoReset = false;
  renderer.domElement.style.display = 'block';
  mount.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = FOG.clone();
  scene.fog = new FogExp2(FOG.getHex(), 0.0042);
  scene.environment = neonEnvironment(renderer);

  const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 2.6, 8);

  // sky: a violet glow on the horizon fading to black overhead
  const sky = new Mesh(new SphereGeometry(1500, 32, 16), new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new Color(0x02020a) }, horizon: { value: new Color(0x3a1650) }, glow: { value: new Color(0xff5a9c) } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 c = mix(horizon, top, smoothstep(0.0, 0.35, h));
        c += glow * 0.16 * exp(-abs(h) * 18.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  // a distant skyline ring, lit windows and all
  const tx = skyline();
  tx.repeat.set(3, 1);
  const sl = new Mesh(new CylinderGeometry(1100, 1100, 260, 64, 1, true),
    new MeshBasicMaterial({ map: tx, transparent: true, side: BackSide, depthWrite: false, fog: false, color: new Color(0.9, 0.85, 1) }));
  sl.position.y = 110;
  sl.renderOrder = -9;
  scene.add(sl);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(ratio);
  composer.setSize(window.innerWidth, window.innerHeight);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), 0.7, 0.5, 0.82);
  const lens = new ShaderPass(LensShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  return {
    renderer, scene, camera, composer, bloom, lens, skyline: sl,
    resize(w, h) {
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    setPixelRatio(r) {
      renderer.setPixelRatio(r);
      composer.setPixelRatio(r);
      composer.setSize(window.innerWidth, window.innerHeight);
    },
    render(bloomOn) {
      bloom.enabled = bloomOn;
      renderer.info.reset();              // count the whole frame, every pass
      composer.render();
    },
  };
}

/**
 * Reflections for the car paint and the wet road: a dark box lined with neon
 * strips (magenta, cyan, amber), pre-filtered once.
 */
function neonEnvironment(renderer: WebGLRenderer) {
  const env = new Scene();
  env.background = new Color(0x05040c);
  const strip = (color: number, intensity: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new Mesh(new BoxGeometry(sx, sy, sz), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }));
    m.position.set(x, y, z);
    env.add(m);
  };
  strip(0xff3fb4, 6, -8, 3, 0, 0.4, 6, 30);
  strip(0x3ff0ff, 6, 8, 2, 0, 0.4, 5, 30);
  strip(0xffb040, 4, 0, 9, -12, 18, 0.5, 0.5);
  strip(0xffffff, 3, 0, 10, 0, 1, 0.2, 24);
  strip(0x6a3cff, 3, 0, -2, 14, 20, 2, 0.4);
  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  return rt.texture;
}
