import { NoToneMapping, PerspectiveCamera, Scene, WebGLRenderer, type WebGLCubeRenderTarget, type WebGLRenderTarget, LinearSRGBColorSpace } from 'three';
import { FullScreen, hdrTarget } from './fsq';
import { Disk } from './disk';
import { Post } from './post';
import { bakeSky } from './sky';
import { blackbodyTexture } from './blackbody';
import { createTracer, setTracerFeatures, type TracerUniforms } from './tracer';

/**
 * Renderer and frame pipeline:
 *   disk deposit + emission (polar, its own resolution)
 *   → geodesic trace into an HDR target (a fraction of the canvas)
 *   → bloom, streak, tone map to the canvas
 *   → the overlay scene (orbit lines) on top, unlensed, as instrument graphics.
 */
export interface ViewBudgets {
  traceRes: number;
  steps: number;
  diskRes: number;
  octaves: number;
  haze: boolean;
  jets: boolean;
  bloom: boolean;
  streak: boolean;
}

export class View {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(38, 16 / 9, 0.1, 400);
  readonly overlay = new Scene();
  readonly fs = new FullScreen();
  readonly disk: Disk;
  readonly post: Post;
  readonly tracer: ReturnType<typeof createTracer>['mat'];
  readonly u: TracerUniforms;
  private sky: WebGLCubeRenderTarget;
  private trace: WebGLRenderTarget | null = null;
  private traceRes = 0.85;
  private scale = 1;
  private w = 1;
  private h = 1;
  overlayOn = true;
  frames = 0;

  constructor(mount: HTMLElement, antialias: boolean, power: WebGLPowerPreference | undefined, resolution: number, b: ViewBudgets) {
    this.renderer = new WebGLRenderer({ antialias, powerPreference: power, alpha: false, stencil: false, depth: true });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 1);
    this.scale = resolution;
    this.renderer.setPixelRatio(resolution);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    mount.appendChild(el);

    this.sky = bakeSky(this.renderer, b.diskRes >= 3 ? 1024 : 512);
    this.disk = new Disk(this.fs, b.diskRes, b.octaves);
    this.post = new Post(this.fs);
    const t = createTracer(b.haze, b.jets);
    this.tracer = t.mat;
    this.u = t.u;
    this.u.uSky.value = this.sky.texture;
    this.u.uBB.value = blackbodyTexture();
    this.applyBudgets(b);
    this.resize(window.innerWidth, window.innerHeight);
  }

  applyBudgets(b: ViewBudgets): void {
    this.traceRes = b.traceRes;
    this.u.uSteps.value = b.steps;
    // finer steps when there are more of them to spend
    this.u.uStepK.value = b.steps >= 300 ? 0.045 : b.steps >= 200 ? 0.055 : b.steps >= 140 ? 0.07 : 0.09;
    this.disk.setRes(b.diskRes);
    this.disk.setOctaves(b.octaves);
    setTracerFeatures(this.tracer, b.haze, b.jets);
    this.post.bloom = b.bloom;
    this.post.streakOn = b.streak;
    this.sizeTrace();
  }

  setPixelRatio(s: number): void {
    this.scale = s;
    this.renderer.setPixelRatio(s);
    this.renderer.setSize(this.w, this.h);
    this.sizeTrace();
  }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.sizeTrace();
  }

  /** Canvas size in device pixels. */
  get canvasW(): number { return Math.round(this.w * this.scale); }
  get canvasH(): number { return Math.round(this.h * this.scale); }

  private sizeTrace(): void {
    const tw = Math.max(64, Math.round(this.canvasW * this.traceRes));
    const th = Math.max(36, Math.round(this.canvasH * this.traceRes));
    if (this.trace && this.trace.width === tw && this.trace.height === th) return;
    this.trace?.dispose();
    this.trace = hdrTarget(tw, th);
    this.post.resize(tw, th);
  }

  get traceSize(): [number, number] { return this.trace ? [this.trace.width, this.trace.height] : [0, 0]; }

  render(): void {
    if (!this.trace) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const u = this.u;
    u.uCamPos.value.copy(cam.position);
    u.uCamBasis.value.setFromMatrix4(cam.matrixWorld);
    const tanY = Math.tan((cam.fov * Math.PI) / 360);
    u.uTan.value.set(tanY * cam.aspect, tanY);
    u.uPix.value = (2 * tanY) / this.trace.height;
    u.uFar.value = Math.max(cam.position.length() + 6, 54);
    u.uDisk.value = this.disk.out?.texture ?? null;
    u.uDiskW.value = this.disk.W;
    this.fs.render(this.renderer, this.tracer, this.trace);
    this.post.render(this.renderer, this.trace, this.canvasW, this.canvasH);
    if (this.overlayOn && this.overlay.children.length) {
      const auto = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.overlay, cam);
      this.renderer.autoClear = auto;
    }
    this.frames++;
  }

  dispose(): void {
    this.trace?.dispose();
    this.sky.dispose();
    this.disk.dispose();
    this.post.dispose();
    this.tracer.dispose();
    this.fs.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
