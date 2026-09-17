import {
  Color, FogExp2, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';

/**
 * The corridor renderer: the whole world is drawn at DOOM-era internal
 * resolution (a couple hundred pixels tall) and stretched over the screen
 * with nearest filtering - real chunky pixels, no post-processing, no bloom.
 * Depth fog does the lighting drama. The weapon lives in its own overlay
 * scene so the maze can never occlude the marine's hands.
 */

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  gunScene: Scene;
  gunCamera: OrthographicCamera;
  setPixRes(heightPx: number): void;
  resize(w: number, h: number): void;
  setPixelRatio(scale: number): void;
  render(): void;
}

export function createWorld(mount: HTMLElement, powerPref: WebGLPowerPreference | undefined, resScale: number, pixH: number): World {
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: powerPref, stencil: false, depth: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x070302, 1);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.imageRendering = 'pixelated';
  mount.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x070302);
  scene.fog = new FogExp2(0x0c0503, 0.21);

  const camera = new PerspectiveCamera(75, 16 / 9, 0.04, 46);
  camera.rotation.order = 'YXZ';

  const gunScene = new Scene();
  const gunCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  gunCamera.position.z = 2;

  let cssW = window.innerWidth, cssH = window.innerHeight;
  let baseH = pixH, scale = resScale;

  const fit = () => {
    const aspect = cssW / cssH;
    const h = Math.max(120, Math.round(baseH * scale));
    const w = Math.max(160, Math.round(h * aspect));
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    gunCamera.left = -aspect; gunCamera.right = aspect; gunCamera.top = 1; gunCamera.bottom = -1;
    gunCamera.updateProjectionMatrix();
  };
  fit();

  return {
    renderer, scene, camera, gunScene, gunCamera,
    setPixRes(h) { baseH = h; fit(); },
    resize(w, h) { cssW = w; cssH = h; fit(); },
    setPixelRatio(s) { scale = s; fit(); },
    render() {
      renderer.autoClear = true;
      renderer.render(scene, camera);
      if (gunScene.children.length) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(gunScene, gunCamera);
      }
    },
  };
}

/** Shared helper: a textured quad for the gun overlay. */
export function overlayQuad(material: MeshBasicMaterial, w: number, h: number): Mesh {
  const m = new Mesh(new PlaneGeometry(w, h), material);
  m.frustumCulled = false;
  return m;
}
