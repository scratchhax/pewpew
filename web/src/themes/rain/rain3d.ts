import { BufferImageSource, Mesh, PlaneGeometry, Shader, TextureSource, UniformGroup } from 'pixi.js';
import { makeAtlas, GLYPHS } from './atlas';
import { RAIN_VERT, RAIN3D_FRAG } from './shader';

/**
 * Fly mode's CPU half: a field of log columns in a slab of world space,
 * the camera advancing through it. Each column carries a real line from
 * the ring buffer; when a column passes the camera it recycles to the far
 * plane with a fresh line. The shader does the projection and every
 * pixel; this only moves the columns and writes the text.
 */

const MAXC = 96;
const RING = 64;
const LEN = 32;
const Z_NEAR = 0.06;
const Z_FAR = 4.5;
const FILLER = '0123456789ABCDEF#$%&*+=<>/\\|~^';

export interface FlyOpts {
  flySpeed: number; // world z per second
  density: number;  // 0..1 share of columns in flight
  trail: number;
}

interface Col3 {
  x: number;
  z: number;
  lineId: number;
  cls: number;
}

interface FlyUniforms {
  uTime: number;
  uN: number;
  uCellH: number;
  uAspect: number;
  uSpread: number;
  uVp: Float32Array;
  uTrail: number;
  uFog: number;
  uColorMode: number;
}

export class Rain3D {
  glyphW = 15;
  dirtyGrid = false;
  readonly queue: Array<{ line: string; cls: number }> = [];
  private colData = new Float32Array(MAXC * 4);
  private lines = new Uint8Array(RING * LEN * 4);
  private columns: Col3[] = [];
  private wp = 0;
  private linesDirty = true;
  private colsSrc: TextureSource;
  private linesSrc: TextureSource;
  private atlas = makeAtlas();
  private mesh: Mesh<PlaneGeometry, Shader>;
  private shader: Shader;

  constructor(w: number, h: number) {
    for (let i = 0; i < MAXC; i++) {
      const c: Col3 = { x: Math.random(), z: Z_NEAR + Math.random() * (Z_FAR - Z_NEAR), lineId: 0, cls: 0 };
      this.take(c);
      // scatter the initial field so the first frame is already mid-dive
      c.z = Z_NEAR + Math.random() * (Z_FAR - Z_NEAR);
      this.columns.push(c);
    }
    this.colsSrc = new BufferImageSource({
      width: MAXC, height: 1, format: 'rgba32float', resource: this.colData,
      autoGenerateMipmaps: false, alphaMode: 'no-premultiply-alpha',
    });
    this.colsSrc.addressMode = 'clamp-to-edge';
    this.colsSrc.magFilter = 'nearest';
    this.colsSrc.minFilter = 'nearest';
    this.linesSrc = new BufferImageSource({
      width: LEN, height: RING, format: 'rgba8unorm', resource: this.lines,
      autoGenerateMipmaps: false, alphaMode: 'no-premultiply-alpha',
    });
    this.linesSrc.addressMode = 'clamp-to-edge';
    this.linesSrc.magFilter = 'nearest';
    this.linesSrc.minFilter = 'nearest';
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uN: { value: MAXC, type: 'f32' },
      uCellH: { value: 0.045, type: 'f32' },
      uAspect: { value: 16 / 9, type: 'f32' },
      uSpread: { value: 2.2, type: 'f32' },
      uVp: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
      uTrail: { value: 12, type: 'f32' },
      uFog: { value: 1, type: 'f32' },
      uColorMode: { value: 0, type: 'f32' },
    });
    this.shader = Shader.from({
      gl: { vertex: RAIN_VERT, fragment: RAIN3D_FRAG },
      resources: {
        uLines: this.linesSrc,
        uCols: this.colsSrc,
        uAtlas: this.atlas.source,
        uParams: uniforms,
      },
    });
    this.mesh = new Mesh({ geometry: this.plane(w, h), shader: this.shader });
  }

  private plane(w: number, h: number): PlaneGeometry {
    return new PlaneGeometry({ width: w, height: h, verticesX: 2, verticesY: 2 });
  }

  get view(): Mesh<PlaneGeometry, Shader> { return this.mesh; }
  get cols(): number { return Math.round(this.u.uN); }
  get rows(): number { return LEN; }
  private get u(): FlyUniforms {
    return (this.shader.resources as unknown as { uParams: { uniforms: FlyUniforms } }).uParams.uniforms;
  }

  resize(w: number, h: number): void {
    this.mesh.geometry.destroy();
    this.mesh.geometry = this.plane(w, h);
  }

  /** A log line from the theme. cls: 0 green, 1 block, 2 threat. */
  push(line: string, cls: number): void {
    if (this.queue.length > 96) this.queue.shift();
    this.queue.push({ line: line.toUpperCase(), cls });
  }

  /** Give a recycled column a fresh line from the queue (or static). */
  private take(c: Col3): void {
    const q = this.queue.shift();
    const line = q ? q.line : this.staticLine();
    c.cls = q ? q.cls : 0;
    c.lineId = this.wp;
    const row = this.wp * LEN * 4;
    for (let i = 0; i < LEN; i++) {
      const code = i < line.length ? line.charCodeAt(i) - 32 : 0;
      this.lines[row + i * 4] = code >= 0 && code < GLYPHS ? code : 0;
    }
    this.wp = (this.wp + 1) % RING;
    this.linesDirty = true;
  }

  private staticLine(): string {
    const n = 10 + ((Math.random() * 22) | 0);
    let s = '';
    for (let i = 0; i < n; i++) s += FILLER[(Math.random() * FILLER.length) | 0];
    return s;
  }

  step(dt: number, o: FlyOpts): void {
    const dz = o.flySpeed * dt;
    const active = Math.round(MAXC * Math.min(1, o.density));
    for (let i = 0; i < MAXC; i++) {
      const c = this.columns[i];
      const j = i * 4;
      if (i >= active) {
        this.colData[j + 1] = -1; // parked: the shader skips z < 0.02
        continue;
      }
      c.z -= dz;
      if (c.z < Z_NEAR) {
        c.z = Z_FAR + Math.random() * 2;
        c.x = Math.random();
        this.take(c);
      }
      this.colData[j] = c.x;
      this.colData[j + 1] = c.z;
      this.colData[j + 2] = c.lineId;
      this.colData[j + 3] = c.cls;
    }
    this.colsSrc.update();
    if (this.linesDirty) {
      this.linesSrc.update();
      this.linesDirty = false;
    }
  }

  uniforms(t: number, o: { trail: number; fog: boolean; colorMode: number; columns: number; glyph: number; aspect: number; vpX: number; vpY: number; wanderX: number; wanderY: number }): void {
    const u = this.u;
    u.uTime = t;
    u.uN = Math.max(1, Math.min(MAXC, Math.round(o.columns)));
    u.uCellH = 0.045 * (o.glyph / 15);
    u.uAspect = o.aspect;
    u.uVp.set([o.vpX + o.wanderX, o.vpY + o.wanderY]);
    u.uTrail = o.trail;
    u.uFog = o.fog ? 1 : 0;
    u.uColorMode = o.colorMode;
  }

  diag(): Record<string, unknown> {
    return {
      mode: 'fly',
      columns: this.u.uN,
      queued: this.queue.length,
      nearest: Math.min(...this.columns.map((c) => c.z)).toFixed(2),
    };
  }
}
