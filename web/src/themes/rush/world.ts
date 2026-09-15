import { Container, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { TILE, type Art, type WorldArt } from './art';

/**
 * The course: an endless strip of tile columns generated just off the right
 * edge of the screen. Each column has a ground height in tiles (0 is a pit)
 * and maybe a one-way ledge above it, and remembers which world it was built
 * in, so a new world rolls in from the right as the traffic changes.
 *
 * The generator never builds anything the runner can't clear at the speed
 * it's going: gaps are sized to the current jump range, steps are at most two
 * tiles, and every gap lands on a flat run.
 */
/** How far below a ledge's top a runner can arrive and still step up onto it (px). */
export const STEP = 6;

export class Course {
  /** Index of the first column held. */
  start = 0;
  ground: number[] = [];
  ledge: number[] = [];
  world: number[] = [];
  /** Screen height in world pixels (ground is measured up from it). */
  vh = 240;

  private h = 3;
  private queue: Array<{ h: number; ledge: number }> = [];
  private rand = Math.random;

  /** The world new columns are built in, and the widest gap the runner can take right now (tiles). */
  buildWorld = 0;
  maxGap = 3;

  private push(h: number, ledge = 0): void { this.queue.push({ h, ledge }); }

  /** Queue the next piece of course. */
  private segment(): void {
    const r = this.rand();
    const h = this.h;
    const flat = (n: number, height = this.h) => { for (let i = 0; i < n; i++) this.push(height); };
    if (r < 0.3) {
      flat(5 + Math.floor(this.rand() * 9));
    } else if (r < 0.46) {                                    // step up
      this.h = Math.min(6, h + (this.rand() < 0.3 && h < 5 ? 2 : 1));
      flat(4 + Math.floor(this.rand() * 6));
    } else if (r < 0.6) {                                     // step down
      this.h = Math.max(2, h - (this.rand() < 0.4 ? 2 : 1));
      flat(4 + Math.floor(this.rand() * 6));
    } else if (r < 0.78) {                                    // a gap, sized to what we can jump right now
      flat(2);
      const w = 2 + Math.floor(this.rand() * Math.max(1, this.maxGap - 1));
      for (let i = 0; i < w; i++) this.push(0);
      this.h = Math.max(2, Math.min(6, h + (this.rand() < 0.5 ? 0 : this.rand() < 0.5 ? 1 : -1)));
      flat(4 + Math.floor(this.rand() * 4));
    } else if (r < 0.9) {                                     // a ledge over a flat run
      flat(1);
      const n = 4 + Math.floor(this.rand() * 4), lh = h + 3;
      for (let i = 0; i < n; i++) this.push(h, lh);
      flat(2);
    } else {                                                  // stairs up, a run, stairs down
      for (let k = 0; k < 3 && this.h < 6; k++) { this.h++; flat(2); }
      flat(4);
      for (let k = 0; k < 3 && this.h > 2; k++) { this.h--; flat(2); }
    }
  }

  get end(): number { return this.start + this.ground.length; }

  /** Make sure columns exist up to `col`, and forget ones before `from`. */
  ensure(from: number, col: number): void {
    while (this.end <= col) {
      if (!this.queue.length) this.segment();
      const q = this.queue.shift()!;
      // the very first stretch is flat ground to start on
      const first = this.end < 24;
      this.ground.push(first ? 3 : q.h);
      this.ledge.push(first ? 0 : q.ledge);
      this.world.push(this.buildWorld);
    }
    const drop = Math.max(0, from - this.start);
    if (drop > 64) {
      this.ground.splice(0, drop); this.ledge.splice(0, drop); this.world.splice(0, drop);
      this.start += drop;
    }
  }

  heightAt(col: number): number {
    const i = col - this.start;
    return i >= 0 && i < this.ground.length ? this.ground[i] : 3;
  }
  ledgeAt(col: number): number {
    const i = col - this.start;
    return i >= 0 && i < this.ledge.length ? this.ledge[i] : 0;
  }
  /** Top of the ground in a column (y grows down), or Infinity over a pit. */
  groundTop(col: number): number {
    const h = this.heightAt(col);
    return h > 0 ? this.vh - h * TILE : Infinity;
  }
  ledgeTop(col: number): number {
    const l = this.ledgeAt(col);
    return l > 0 ? this.vh - l * TILE : Infinity;
  }

  /**
   * What a body spanning [x0, x1] lands on while falling from yPrev to yNow:
   * the highest ground or ledge top it crossed, or null.
   */
  landing(x0: number, x1: number, yPrev: number, yNow: number): number | null {
    let best: number | null = null;
    for (let col = Math.floor(x0 / TILE); col <= Math.floor(x1 / TILE); col++) {
      for (const top of [this.groundTop(col), this.ledgeTop(col)]) {
        if (top === Infinity) continue;
        if (yPrev <= top + 0.5 && yNow >= top && (best === null || top < best)) best = top;
      }
    }
    return best;
  }

  /** Is there something to stand on right under [x0, x1] at feet height y? */
  standing(x0: number, x1: number, y: number): boolean {
    for (let col = Math.floor(x0 / TILE); col <= Math.floor(x1 / TILE); col++) {
      if (Math.abs(this.groundTop(col) - y) < 1 || Math.abs(this.ledgeTop(col) - y) < 1) return true;
    }
    return false;
  }

  /** Does ground rise above feet height y in the column at x (a wall)? A lip of up to STEP px is a step, not a wall. */
  wall(x: number, y: number): boolean {
    const top = this.groundTop(Math.floor(x / TILE));
    return top !== Infinity && top < y - STEP;
  }

  /** Arriving at a ledge with our feet just below its top: the top to step up onto, or null. */
  stepUp(x: number, y: number): number | null {
    const top = this.groundTop(Math.floor(x / TILE));
    return top !== Infinity && top < y && top >= y - STEP ? top : null;
  }
}

/** Draws the visible course with pooled tile sprites. */
export class CourseView {
  private pool: Sprite[] = [];
  private used = 0;

  constructor(private layer: Container, private art: Art) {}

  private take(texture: Texture, x: number, y: number): void {
    let s = this.pool[this.used];
    if (!s) { s = new Sprite(texture); this.layer.addChild(s); this.pool.push(s); }
    s.texture = texture;
    s.position.set(x, y);
    s.visible = true;
    this.used++;
  }

  draw(course: Course, camX: number, vw: number, t: number): void {
    this.used = 0;
    const c0 = Math.floor(camX / TILE) - 1, c1 = Math.ceil((camX + vw) / TILE) + 1;
    const liquidShift = Math.round((t * 6) % TILE);
    for (let col = c0; col <= c1; col++) {
      const w = this.art.worlds[course.world[col - course.start] ?? 0];
      const x = col * TILE;
      const h = course.heightAt(col);
      if (h > 0) {
        const top = course.vh - h * TILE;
        this.take(w.top, x, top);
        for (let y = top + TILE; y < course.vh; y += TILE) this.take(w.fill, x, y);
      } else {
        this.take(w.liquid, x - liquidShift, course.vh - 8);
        this.take(w.liquid, x - liquidShift + TILE, course.vh - 8);
      }
      const l = course.ledgeAt(col);
      if (l > 0) this.take(w.ledge, x, course.vh - l * TILE);
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}

interface Layers { root: Container; sky: TilingSprite; far: TilingSprite; clouds: TilingSprite; mid: TilingSprite; front: TilingSprite }

/**
 * The parallax backdrop for all three worlds, cross-fading between them. The
 * foreground strip is handed back so it can sit in front of the course.
 */
export class Backdrop {
  private sets: Layers[];
  private mix = [1, 0, 0];
  target = 0;
  /** A power flicker rolling across the backdrop (0..1 strength, and where its front is). */
  private dip = 0;
  private dipX = 0;

  constructor(back: Container, front: Container, worlds: WorldArt[]) {
    this.sets = worlds.map((w) => {
      const root = new Container();
      const sky = new TilingSprite({ texture: w.sky, width: 400, height: 256 });
      const far = new TilingSprite({ texture: w.far, width: 400, height: 120 });
      const clouds = new TilingSprite({ texture: w.clouds, width: 400, height: 60 });
      const mid = new TilingSprite({ texture: w.mid, width: 400, height: 100 });
      const frontStrip = new TilingSprite({ texture: w.front, width: 400, height: 24 });
      root.addChild(sky, far, clouds, mid);
      back.addChild(root);
      front.addChild(frontStrip);
      return { root, sky, far, clouds, mid, front: frontStrip };
    });
  }

  flicker(): void { this.dip = 1; this.dipX = 0; }

  update(dt: number, camX: number, vw: number, vh: number, t: number): void {
    this.dip = Math.max(0, this.dip - dt * 0.4);
    this.dipX += dt * vw * 0.9;
    this.sets.forEach((s, k) => {
      const want = k === this.target ? 1 : 0;
      this.mix[k] += (want - this.mix[k]) * Math.min(1, dt * 0.6);
      const a = this.mix[k];
      const on = a > 0.01;
      s.root.visible = on;
      s.front.visible = on;
      if (!on) return;
      s.root.alpha = a;
      s.front.alpha = a;
      s.sky.width = vw; s.sky.height = vh; s.sky.tileScale.set(1, vh / 256);
      for (const [layer, factor, y, drift] of [
        [s.far, 0.12, vh - 150, 0], [s.clouds, 0.22, 6, 4], [s.mid, 0.42, vh - 120, 0],
      ] as Array<[TilingSprite, number, number, number]>) {
        layer.width = vw; layer.y = Math.round(y);
        layer.tilePosition.x = -Math.round(camX * factor + t * drift);
      }
      s.front.width = vw; s.front.y = vh - 20;
      s.front.tilePosition.x = -Math.round(camX * 1.3);
      // the brownout: a dim band sweeping left to right, easing back
      const band = this.dip > 0 ? this.dip * Math.exp(-Math.abs(vw * 0.5 - this.dipX) / (vw * 0.4)) : 0;
      const lum = Math.round(255 * (1 - band * 0.55));
      const tint = (lum << 16) | (lum << 8) | lum;
      s.far.tint = tint; s.mid.tint = tint; s.clouds.tint = tint;
    });
  }
}
