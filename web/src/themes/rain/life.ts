import { BufferImageSource, Mesh, PlaneGeometry, Shader, TextureSource, UniformGroup } from 'pixi.js';
import { makeAtlas, GLYPHS } from './atlas';
import { RAIN_VERT, LIFE_FRAG } from './shader';

/**
 * Game of life mode: Conway's automaton on a toroidal grid where every live
 * cell is a log glyph. The automaton is pure CPU - two Uint8 buffers and an
 * age buffer, B3/S23 on a torus - and the GPU only ever sees one float
 * texture per generation: glyph index, colour class and age per cell.
 * Events seed the grid with patterns instead of lines: a PASS is a glider,
 * a BLOCK is a still life that just sits there, an IDS alarm is a Gosper
 * gun spraying gliders forever. Newborn cells flash white and elders dim,
 * so you can watch the generations flow.
 */

export const LIFE_W = 128;
export const LIFE_H = 48;
const LEN = 32;
const FILLER = '0123456789ABCDEF#$%&*+=<>/\\|~^';

/** Cell offsets of the patterns the log can seed. */
export const PATTERNS: Record<string, number[][]> = {
  glider: [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2]],
  block: [[0, 0], [1, 0], [0, 1], [1, 1]],
  blinker: [[0, 0], [1, 0], [2, 0]],
  toad: [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]],
  pentomino: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  pulsar: [
    [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
    [0, 2], [5, 2], [7, 2], [12, 2],
    [0, 3], [5, 3], [7, 3], [12, 3],
    [0, 4], [5, 4], [7, 4], [12, 4],
    [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
    [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
    [0, 8], [5, 8], [7, 8], [12, 8],
    [0, 9], [5, 9], [7, 9], [12, 9],
    [0, 10], [5, 10], [7, 10], [12, 10],
    [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12],
  ],
  gun: [
    [24, 0], [22, 1], [24, 1],
    [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
    [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
    [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
    [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [28, 5], [30, 5],
    [10, 6], [16, 6], [24, 6],
    [11, 7], [15, 7],
    [12, 8], [13, 8],
  ],
};

/** B3/S23 on a torus. After step(), cur is the new generation and old the
 *  previous one, so a birth is `cur[i] && !old[i]`. */
export class LifeGrid {
  readonly w: number;
  readonly h: number;
  cur: Uint8Array;
  old: Uint8Array;
  readonly age: Uint16Array;
  gen = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cur = new Uint8Array(w * h);
    this.old = new Uint8Array(w * h);
    this.age = new Uint16Array(w * h);
  }

  set(x: number, y: number): void {
    const px = ((x % this.w) + this.w) % this.w;
    const py = ((y % this.h) + this.h) % this.h;
    const i = py * this.w + px;
    this.cur[i] = 1;
    this.age[i] = 1;
  }

  step(): void {
    const { w, h, cur, old, age } = this;
    for (let y = 0; y < h; y++) {
      const up = ((y + h - 1) % h) * w;
      const dn = ((y + 1) % h) * w;
      const md = y * w;
      for (let x = 0; x < w; x++) {
        const l = (x + w - 1) % w;
        const r = (x + 1) % w;
        const n = cur[up + l] + cur[up + x] + cur[up + r]
                + cur[md + l] + cur[md + r]
                + cur[dn + l] + cur[dn + x] + cur[dn + r];
        const i = md + x;
        const was = cur[i];
        const now = was ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
        old[i] = now;
        age[i] = now ? (was ? Math.min(age[i] + 1, 65535) : 1) : 0;
      }
    }
    this.cur = old;
    this.old = cur;
    this.gen++;
  }

  population(): number {
    let p = 0;
    for (let i = 0; i < this.cur.length; i++) p += this.cur[i];
    return p;
  }
}

export interface LifeOpts {
  stepMs: number; // ms per generation
  seed: number;   // 0..1 ambient seeding
  wet: number;    // 0..1 weather: storms seed harder
}

interface LifeUniforms {
  uTime: number;
  uRes: Float32Array;
  uWander: Float32Array;
  uFog: number;
  uColorMode: number;
}

export class LifeScene {
  glyphW = 15;
  dirtyGrid = false;
  readonly grid = new LifeGrid(LIFE_W, LIFE_H);
  private glyph = new Uint8Array(LIFE_W * LIFE_H);
  private cls = new Uint8Array(LIFE_W * LIFE_H);
  private data = new Float32Array(LIFE_W * LIFE_H * 4);
  private line = new Uint8Array(LEN);
  private lineCls = 0;
  private acc = 0;
  private dirty = true;
  private seedsThisTick = 0;
  private src: TextureSource;
  private atlas = makeAtlas();
  private mesh: Mesh<PlaneGeometry, Shader>;
  private shader: Shader;

  constructor(w: number, h: number) {
    this.staticLine();
    this.src = new BufferImageSource({
      width: LIFE_W, height: LIFE_H, format: 'rgba32float', resource: this.data,
      autoGenerateMipmaps: false, alphaMode: 'no-premultiply-alpha',
    });
    this.src.addressMode = 'clamp-to-edge';
    this.src.magFilter = 'nearest';
    this.src.minFilter = 'nearest';
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uRes: { value: new Float32Array([1920, 1080]), type: 'vec2<f32>' },
      uWander: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
      uFog: { value: 1, type: 'f32' },
      uColorMode: { value: 0, type: 'f32' },
    });
    this.shader = Shader.from({
      gl: { vertex: RAIN_VERT, fragment: LIFE_FRAG },
      resources: {
        uLife: this.src,
        uAtlas: this.atlas.source,
        uParams: uniforms,
      },
    });
    this.mesh = new Mesh({ geometry: this.plane(w, h), shader: this.shader });
    // start already breathing: a few patterns and a handful of soup
    this.seedEvent('allow', 0);
    this.seedEvent('dhcp', 0);
    this.seedEvent('wifi', 0);
    for (let k = 0; k < 90; k++) this.setCell((Math.random() * LIFE_W) | 0, (Math.random() * LIFE_H) | 0, 0);
  }

  private plane(w: number, h: number): PlaneGeometry {
    return new PlaneGeometry({ width: w, height: h, verticesX: 2, verticesY: 2 });
  }

  get view(): Mesh<PlaneGeometry, Shader> { return this.mesh; }
  get cols(): number { return LIFE_W; }
  get rows(): number { return LIFE_H; }
  private get u(): LifeUniforms {
    return (this.shader.resources as unknown as { uParams: { uniforms: LifeUniforms } }).uParams.uniforms;
  }

  resize(w: number, h: number): void {
    this.mesh.geometry.destroy();
    this.mesh.geometry = this.plane(w, h);
  }

  /** The line newborn cells spell: latest log line, or static. */
  push(line: string, cls: number): void {
    const s = line.toUpperCase();
    for (let i = 0; i < LEN; i++) {
      const code = i < s.length ? s.charCodeAt(i) - 32 : 0;
      this.line[i] = code >= 0 && code < GLYPHS ? code : 0;
    }
    this.lineCls = cls;
  }

  private staticLine(): void {
    for (let i = 0; i < LEN; i++) this.line[i] = FILLER.charCodeAt((Math.random() * FILLER.length) | 0) - 32;
  }

  private setCell(x: number, y: number, cls: number): void {
    const px = ((x % LIFE_W) + LIFE_W) % LIFE_W;
    const py = ((y % LIFE_H) + LIFE_H) % LIFE_H;
    const i = py * LIFE_W + px;
    this.grid.set(px, py);
    this.glyph[i] = this.line[px % LEN];
    this.cls[i] = cls;
    this.dirty = true;
  }

  /** An event drops a pattern: PASS glides, BLOCK sits, IDS sprays. */
  seedEvent(kind: string, cls: number): void {
    // at deluge rates every event would seed a gun: cap the fireworks
    if (this.seedsThisTick >= 3) return;
    this.seedsThisTick++;
    let name = 'glider';
    let pw = 3;
    let ph = 3;
    if (kind === 'threat') { name = 'gun'; pw = 37; ph = 9; }
    else if (kind === 'block') { name = 'block'; pw = 2; ph = 2; }
    else if (kind === 'dns') { name = 'blinker'; pw = 3; ph = 1; }
    else if (kind === 'dhcp') { name = 'toad'; pw = 4; ph = 2; }
    else if (kind === 'wifi') { name = 'pulsar'; pw = 13; ph = 13; }
    else if (kind === 'system') { name = 'pentomino'; pw = 3; ph = 3; }
    const p = PATTERNS[name];
    const cx = (Math.random() * LIFE_W) | 0;
    const cy = (Math.random() * LIFE_H) | 0;
    for (const [dx, dy] of p) this.setCell(cx + dx, cy + dy, cls);
  }

  step(dt: number, o: LifeOpts): void {
    this.acc += dt * 1000;
    let ticks = 0;
    while (this.acc >= o.stepMs && ticks < 4) {
      this.acc -= o.stepMs;
      this.tick(o);
      ticks++;
    }
    if (this.dirty) {
      this.upload();
      this.src.update();
      this.dirty = false;
    }
  }

  private tick(o: LifeOpts): void {
    this.grid.step();
    this.seedsThisTick = 0;
    const { cur, old, age } = this.grid;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] && !old[i]) {
        this.glyph[i] = this.line[i % LIFE_W % LEN];
        this.cls[i] = this.lineCls;
      }
    }
    // still lifes never die, so the field needs a predator: once it passes
    // a twelfth of the grid, seeding stops and radiation thins it instead
    const frac = this.grid.population() / (LIFE_W * LIFE_H);
    if (frac > 0.12) {
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] && Math.random() < 0.03) { cur[i] = 0; age[i] = 0; }
      }
      this.dirty = true;
      return;
    }
    // the weather seeds the field: drizzle is sparse, a hurricane is soup.
    // lone cells die at once, so ambient life arrives as small survivors:
    // blocks, blinkers and the odd glider
    const n = Math.round(o.seed * (1 + o.wet * 6));
    for (let k = 0; k < n; k++) {
      const x = (Math.random() * LIFE_W) | 0;
      const y = (Math.random() * LIFE_H) | 0;
      const r = Math.random();
      const p = r < 0.4 ? PATTERNS.block : r < 0.75 ? PATTERNS.blinker : PATTERNS.glider;
      for (const [dx, dy] of p) this.setCell(x + dx, y + dy, this.lineCls);
    }
    if (Math.random() < 0.04 + o.wet * 0.22) this.seedEvent('allow', 0);
    this.dirty = true;
  }

  private upload(): void {
    const { cur, age } = this.grid;
    for (let i = 0; i < cur.length; i++) {
      const j = i * 4;
      this.data[j] = cur[i] ? this.glyph[i] + 1 : 0;
      this.data[j + 1] = this.cls[i];
      this.data[j + 2] = cur[i] ? age[i] : 0;
    }
  }

  uniforms(t: number, o: { fog: boolean; colorMode: number; resX: number; resY: number; wanderX: number; wanderY: number }): void {
    const u = this.u;
    u.uTime = t;
    u.uRes.set([o.resX, o.resY]);
    u.uWander.set([o.wanderX, o.wanderY]);
    u.uFog = o.fog ? 1 : 0;
    u.uColorMode = o.colorMode;
  }

  diag(): Record<string, unknown> {
    return {
      mode: 'life',
      gen: this.grid.gen,
      population: this.grid.population(),
    };
  }
}
