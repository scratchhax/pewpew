import { BufferImageSource, Mesh, PlaneGeometry, Shader, TextureSource, UniformGroup } from 'pixi.js';
import { makeAtlas, GLYPHS } from '../rain/atlas';
import { LIFE_VERT, LIFE_FRAG } from './shader';

/**
 * Game of Life: Conway's automaton on a toroidal grid where every live cell
 * is a log glyph. The automaton is pure CPU - two Uint8 buffers and an
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
      gl: { vertex: LIFE_VERT, fragment: LIFE_FRAG },
      resources: {
        uLife: this.src,
        uAtlas: this.atlas.source,
        uParams: uniforms,
      },
    });
    this.mesh = new Mesh({ geometry: this.plane(w, h), shader: this.shader });
    // a classic opening so the first seconds already read as Life: a gun
    // in the corner spraying gliders, a pulsar breathing, a few gliders
    // crossing, and an r-pentomino about to thrash
    this.seedAt('gun', 6, 6, 0, 'G'.charCodeAt(0) - 32);
    this.seedAt('pulsar', 96, 24, 0, 'O'.charCodeAt(0) - 32);
    this.seedAt('pentomino', 60, 20, 2, '%'.charCodeAt(0) - 32);
    this.seedAt('glider', 30, 8, 0, 'P'.charCodeAt(0) - 32);
    this.seedAt('glider', 44, 36, 0, 'P'.charCodeAt(0) - 32);
    this.seedAt('glider', 110, 10, 0, 'P'.charCodeAt(0) - 32);
    this.seedAt('toad', 20, 38, 0, 'T'.charCodeAt(0) - 32);
  }

  /** Seed a named pattern at a fixed spot, wearing one glyph. */
  private seedAt(name: string, x: number, y: number, cls: number, glyph: number): void {
    for (const [dx, dy] of PATTERNS[name]) this.setCell(x + dx, y + dy, cls, glyph);
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

  private setCell(x: number, y: number, cls: number, glyph: number): void {
    const px = ((x % LIFE_W) + LIFE_W) % LIFE_W;
    const py = ((y % LIFE_H) + LIFE_H) % LIFE_H;
    const i = py * LIFE_W + px;
    this.grid.set(px, py);
    this.glyph[i] = glyph;
    this.cls[i] = cls;
    this.dirty = true;
  }

  /** An event drops a pattern: PASS glides, BLOCK sits, IDS sprays. The
   *  whole pattern wears one glyph - the first letter of the line - so a
   *  glider stream reads as a stream of P's, a block colony as B's. */
  seedEvent(kind: string, cls: number): void {
    // at deluge rates every event would seed a gun: one pattern per
    // generation, and most PASSes pass without one
    if (this.seedsThisTick >= 1) return;
    if (kind === 'allow' && Math.random() < 0.6) return;
    this.seedsThisTick++;
    let name = 'glider';
    if (kind === 'threat') name = 'gun';
    else if (kind === 'block') name = 'block';
    else if (kind === 'dns') name = 'blinker';
    else if (kind === 'dhcp') name = 'toad';
    else if (kind === 'wifi') name = 'pulsar';
    else if (kind === 'system') name = 'pentomino';
    const p = PATTERNS[name];
    const cx = (Math.random() * LIFE_W) | 0;
    const cy = (Math.random() * LIFE_H) | 0;
    const g = this.line[0] || 16;
    for (const [dx, dy] of p) this.setCell(cx + dx, cy + dy, cls, g);
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
    const { cur, old, age, w, h } = this.grid;
    // newborns inherit: a cell is born between exactly three parents, so
    // it wears the glyph and colour of the first one. Colonies stay
    // themselves as they grow - a B colony breeds B's, a glider stream
    // stays a stream
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] && !old[i]) {
        const x = i % w;
        const y = (i / w) | 0;
        const l = (x + w - 1) % w;
        const r = (x + 1) % w;
        const up = ((y + h - 1) % h) * w;
        const dn = ((y + 1) % h) * w;
        const md = y * w;
        const p = old[up + l] ? up + l : old[up + x] ? up + x : old[up + r] ? up + r
                : old[md + l] ? md + l : old[md + r] ? md + r
                : old[dn + l] ? dn + l : old[dn + x] ? dn + x : old[dn + r] ? dn + r : -1;
        if (p >= 0) {
          this.glyph[i] = this.glyph[p];
          this.cls[i] = this.cls[p];
        }
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
    // ambient life arrives rarely - a survivor every few seconds, more in
    // a storm - so patterns have time to breed, collide and be recognised
    if (Math.random() < o.seed * (0.05 + o.wet * 0.18)) {
      const x = (Math.random() * LIFE_W) | 0;
      const y = (Math.random() * LIFE_H) | 0;
      const r = Math.random();
      const p = r < 0.4 ? PATTERNS.block : r < 0.75 ? PATTERNS.blinker : PATTERNS.glider;
      const g = this.line[0] || 16;
      for (const [dx, dy] of p) this.setCell(x + dx, y + dy, this.lineCls, g);
    }
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
