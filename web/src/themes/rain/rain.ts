import { BufferImageSource, Mesh, PlaneGeometry, Shader, TextureSource, UniformGroup } from 'pixi.js';
import { makeAtlas, GLYPHS } from './atlas';
import { RAIN_VERT, RAIN_FRAG } from './shader';

/**
 * The CPU half of the rain: a grid of columns, each running a falling
 * spinner that writes the next log line into the cell data texture one
 * character at a time. The shader does every pixel; this only decides what
 * the glyphs are and where the spinners are. When the queue is empty the
 * columns fall back to static - hex noise, the shape a firewall makes when
 * nothing is happening.
 */

export interface RainOpts {
  speed: number;
  density: number;
  trail: number;
  flicker: boolean;
  weatherSpeed: number;
  weatherDensity: number;
}

interface Col {
  head: number;      // spinner position in cells (can be above the screen)
  speed: number;     // cells per second
  cls: number;       // colour class of the line being written
  line: string;
  pos: number;
  written: number;   // last row written
  wait: number;
  alive: boolean;
}

const FILLER = '0123456789ABCDEF#$%&*+=<>/\\|~^';
const CELL_ASPECT = 1.72;
/** Fixed data-texture size: the grid lives in its corner, so a window
 *  resize never destroys a texture that is still bound to the shader. */
const TEX_W = 512, TEX_H = 160;

interface RainUniforms {
  uGrid: Float32Array;
  uTexSize: Float32Array;
  uWander: Float32Array;
  uTime: number;
  uTrail: number;
  uWaves: number;
  uFog: number;
  uCam: number;
  uFly: number;
  uVp: Float32Array;
  uColorMode: number;
  uFar: number;
}

export class Rain {
  cols = 0;
  rows = 0;
  glyphW = 15;
  dirtyGrid = false;
  readonly queue: Array<{ line: string; cls: number }> = [];
  private cells = new Uint8Array(TEX_W * TEX_H * 4);
  private colData = new Uint8Array(TEX_W * 4);
  private cellsSrc: TextureSource;
  private colsSrc: TextureSource;
  private atlas = makeAtlas();
  private columns: Col[] = [];
  private mesh: Mesh<PlaneGeometry, Shader>;
  private shader: Shader;
  private trail = 12;

  constructor(w: number, h: number) {
    this.build(w, h);
    this.cellsSrc = this.makeSource(TEX_W, TEX_H, this.cells);
    this.colsSrc = this.makeSource(TEX_W, 1, this.colData);
    const uniforms = new UniformGroup({
      uGrid: { value: new Float32Array([this.cols, this.rows]), type: 'vec2<f32>' },
      uTexSize: { value: new Float32Array([TEX_W, TEX_H]), type: 'vec2<f32>' },
      uWander: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
      uTime: { value: 0, type: 'f32' },
      uTrail: { value: 12, type: 'f32' },
      uWaves: { value: 1, type: 'f32' },
      uFog: { value: 1, type: 'f32' },
      uCam: { value: 2, type: 'f32' },
      uFly: { value: 0, type: 'f32' },
      uVp: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
      uColorMode: { value: 0, type: 'f32' },
      uFar: { value: 2, type: 'f32' },
    });
    this.shader = Shader.from({
      gl: { vertex: RAIN_VERT, fragment: RAIN_FRAG },
      resources: {
        uCells: this.cellsSrc,
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
  private get u(): RainUniforms {
    return (this.shader.resources as unknown as { uParams: { uniforms: RainUniforms } }).uParams.uniforms;
  }

  /** Data textures: raw bytes in, raw bytes out - no premultiply, no lerp. */
  private makeSource(width: number, height: number, resource: Uint8Array): TextureSource {
    const src = new BufferImageSource({
      width, height, format: 'rgba8unorm', resource,
      autoGenerateMipmaps: false, alphaMode: 'no-premultiply-alpha',
    });
    src.addressMode = 'clamp-to-edge';
    src.magFilter = 'nearest';
    src.minFilter = 'nearest';
    return src;
  }

  private build(w: number, h: number): void {
    this.cols = Math.min(TEX_W, Math.max(8, Math.ceil(w / this.glyphW)));
    this.rows = Math.min(TEX_H, Math.max(8, Math.ceil(h / (this.glyphW * CELL_ASPECT))));
    this.cells.fill(0);
    this.colData.fill(0);
    this.columns = [];
    for (let i = 0; i < this.cols; i++) {
      const c: Col = { head: 0, speed: 1, cls: 0, line: '', pos: 0, written: -1, wait: 0, alive: true };
      this.reset(c, true);
      this.columns.push(c);
    }
  }

  resize(w: number, h: number): void {
    this.build(w, h);
    this.u.uGrid.set([this.cols, this.rows]);
    this.mesh.geometry.destroy();
    this.mesh.geometry = this.plane(w, h);
    this.dirtyGrid = false;
  }

  /** A log line from the theme. cls: 0 green, 1 block, 2 threat. */
  push(line: string, cls: number): void {
    if (this.queue.length > 96) this.queue.shift();
    this.queue.push({ line: line.toUpperCase(), cls });
  }

  private nextLine(): { line: string; cls: number } {
    const q = this.queue.shift();
    if (q) return q;
    const n = 8 + ((Math.random() * 16) | 0);
    let s = '';
    for (let i = 0; i < n; i++) s += FILLER[(Math.random() * FILLER.length) | 0];
    return { line: s, cls: 0 };
  }

  private reset(c: Col, initial: boolean): void {
    c.head = initial ? -Math.random() * this.rows * 1.5 : -this.trail - Math.random() * this.rows * 0.7;
    c.speed = 3 + Math.random() * 5;
    c.pos = 0;
    const l = this.nextLine();
    c.line = l.line;
    c.cls = l.cls;
    c.written = Math.floor(c.head) - 1;
  }

  private write(col: number, row: number, c: Col): void {
    if (row < 0 || row >= this.rows) return;
    if (c.pos >= c.line.length) {
      const l = this.nextLine();
      c.line = l.line;
      c.pos = 0;
      c.cls = l.cls;
    }
    const code = c.line.charCodeAt(c.pos++) - 32;
    const i = (row * TEX_W + col) * 4;
    this.cells[i] = code >= 0 && code < GLYPHS ? code : 0;
    this.cells[i + 1] = c.cls;
    this.cells[i + 2] = (Math.random() * 255) | 0;
  }

  step(dt: number, o: RainOpts): void {
    this.trail = o.trail;
    const vel = dt * o.speed * o.weatherSpeed;
    const targetAlive = this.cols * Math.min(1, o.density * o.weatherDensity);
    let alive = 0;
    for (let i = 0; i < this.cols; i++) {
      const c = this.columns[i];
      c.head += c.speed * vel;
      if (c.alive) {
        const upto = Math.floor(c.head);
        while (c.written < upto) {
          c.written++;
          this.write(i, c.written, c);
        }
        if (c.head > this.rows + o.trail) {
          c.alive = false;
          c.wait = 0.4 + Math.random() * 5;
        }
      } else {
        c.wait -= dt;
        if (c.wait <= 0 && alive < targetAlive) {
          this.reset(c, false);
          c.alive = true;
        }
      }
      if (c.alive) alive++;
      const h16 = Math.max(0, Math.min(65535, Math.round(c.head * 256)));
      const j = i * 4;
      this.colData[j] = h16 >> 8;
      this.colData[j + 1] = h16 & 255;
      this.colData[j + 2] = (c.speed * 25) | 0;
      this.colData[j + 3] = c.cls;
    }
    // flicker: the trail churns, glyphs mutating as they fade
    if (o.flicker) {
      for (let n = 0; n < 4; n++) {
        const col = (Math.random() * this.cols) | 0;
        const c = this.columns[col];
        if (!c.alive) continue;
        const row = Math.floor(c.head - Math.random() * o.trail);
        if (row < 0 || row >= this.rows) continue;
        const i = (row * TEX_W + col) * 4;
        this.cells[i] = FILLER.charCodeAt((Math.random() * FILLER.length) | 0) - 32;
      }
    }
    this.cellsSrc.update();
    this.colsSrc.update();
  }

  /** Anti burn-in drift, in fractions of the screen. */
  wander(x: number, y: number): void {
    this.u.uWander.set([x, y]);
  }

  uniforms(t: number, o: { trail: number; waves: boolean; fog: boolean; cam: number; fly: number; vpX: number; vpY: number; colorMode: number; farLayers: number }): void {
    const u = this.u;
    u.uTime = t;
    u.uTrail = o.trail;
    u.uWaves = o.waves ? 1 : 0;
    u.uFog = o.fog ? 1 : 0;
    u.uCam = o.cam;
    u.uFly = o.fly;
    u.uVp.set([o.vpX, o.vpY]);
    u.uColorMode = o.colorMode;
    u.uFar = o.farLayers;
  }

  diag(): Record<string, unknown> {
    return {
      cols: this.cols, rows: this.rows,
      alive: this.columns.filter((c) => c.alive).length,
      queued: this.queue.length,
    };
  }
}
