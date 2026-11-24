import {
  BufferGeometry, Float32BufferAttribute, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, RGBAFormat,
  Scene, ShaderMaterial, WebGLRenderTarget, ClampToEdgeWrapping, type Material, type Wrapping, type WebGLRenderer,
} from 'three';

/** One big triangle covering the viewport, for full-screen passes. */
export class FullScreen {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: Mesh;

  constructor() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new Mesh(geo);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(r: WebGLRenderer, mat: Material, target: WebGLRenderTarget | null): void {
    this.mesh.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
  }

  dispose(): void { this.mesh.geometry.dispose(); }
}

export const FSQ_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function pass(fragmentShader: string, uniforms: Record<string, { value: unknown }>, defines: Record<string, string | number> = {}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: FSQ_VERT, fragmentShader, uniforms, defines,
    depthTest: false, depthWrite: false,
  });
}

/** An HDR (half-float) render target. */
export function hdrTarget(w: number, h: number, wrapS: Wrapping = ClampToEdgeWrapping): WebGLRenderTarget {
  const t = new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  t.texture.wrapS = wrapS;
  t.texture.wrapT = ClampToEdgeWrapping;
  return t;
}
