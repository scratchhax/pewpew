/**
 * The pure automaton: Conway's B3/S23 on a toroidal grid, no rendering, no
 * Pixi - so the rule can be unit tested. After step(), cur is the new
 * generation and old the previous one, so a birth is `cur[i] && !old[i]`.
 */

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
    [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
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
