import { hash01 } from '../../state';

/**
 * The substrate lattice, after Jared Tarbell's *Substrate* (the old
 * complexification.net piece, and the xscreensaver hack cut from it).
 *
 * The whole data structure is ONE Int32Array: for every cell of the plate it
 * stores the heading, in degrees, of the crack that claimed it — or `EMPTY`.
 * That single fact is enough to grow a city:
 *
 *   - a new crack looks for a cell that is already claimed, and sets off at
 *     ninety degrees to whatever claimed it. That perpendicular departure is
 *     the entire reason the result reads as a street plan or a crazed glaze
 *     instead of scribble;
 *   - it advances a fraction of a cell at a time, bending by its curvature,
 *     claiming cells as it goes;
 *   - when it meets a cell claimed at a materially different angle it stops
 *     dead, and a replacement starts somewhere else. Cracks are never
 *     deleted, only restarted, so the population looks after itself.
 *
 * What is ours, and not Tarbell's: nothing grows unless the network does.
 * Hosts plant the seed cells, so the plan of the city is a function of who
 * actually lives on your LAN; every crack is spawned by one real event, and
 * carries that event's colour, its direction and its restlessness with it.
 *
 * This file is renderer-agnostic on purpose — it emits pigment through
 * `onSand` and hairlines through `onLine`, and knows nothing about PixiJS.
 */

/** No crack has claimed this cell. Matches Tarbell's out-of-band sentinel. */
export const EMPTY = 10001;

const RAD = Math.PI / 180;
/** Cells advanced per step. Tarbell's 0.42 — small enough that the hairline stays hairline. */
const STEP = 0.42;
/**
 * How far the sideways march will look for the far wall before giving up.
 * This is a look cap as much as a cost cap: across a wide-open region an
 * uncapped reach spreads one stroke's grains cells apart, and the wash turns
 * into a dotted beam instead of a wash.
 */
const MARCH_CAP = 240;

/** Grains laid per cell of wash — sparse enough that the sand reads as grain. */
const GRAIN_PER_CELL = 0.6;

/**
 * How far, in cells, a wash may bleed from its crack.
 *
 * This is the contrast control for the whole scene and it has to be its own
 * number. Deriving it from the grain count meant that making the sand sparser
 * silently tripled the reach, every region on the plate got tinted, and the
 * picture lost all its clean paper — which is most of what makes the lattice
 * read at all.
 */
const WASH_REACH = 30;

/**
 * Alpha of a grain laid right against the crack, before the ink knob.
 *
 * Tarbell uses about 0.15 here and his canvas still ends up saturated, because
 * a region of his is swept over and over by a constant churn of cracks. Ours
 * are spawned by events and the lattice closes a block off quickly, so most
 * ground is painted by one or two passing tips and never touched again — at
 * 0.15 a pass that is a picture made of hairlines with a faint rim of colour.
 * The wash has to land in one sweep, so it goes on much heavier.
 */
const WASH_ALPHA = 0.11;

export type CrackKind = 'allow' | 'block' | 'threat' | 'wifi' | 'system';

export interface SpawnOpts {
  kind: CrackKind;
  /** Packed RGB the wash and hairline are drawn in. */
  color: number;
  /** Grow out of this host's district when it has one. */
  near?: Seed | null;
  /** Which way it turns off the cell it was born on: +1 or -1. */
  sign?: number;
  /** Degrees per step. Small is a boulevard, large is a crack in a glaze. */
  curvature?: number;
  /** Steps before it gives up on its own (0 = only stops when it hits something). */
  maxAge?: number;
  /** Multiplies the pigment this crack lays down. */
  ink?: number;
}

/** A host's origin on the plate: stable for an IP, so the plan is stable for a network. */
export interface Seed {
  ip: string;
  label: string;
  x: number;
  y: number;
  /** Heading the seed cell was planted with, in degrees. */
  t: number;
  /** Events attributed to this host this cycle — picks the busiest district. */
  hits: number;
}

export class Crack {
  x = 0;
  y = 0;
  /** Heading in degrees. Deliberately NOT normalised: see the merge test in `step`. */
  t = 0;
  alive = false;
  age = 0;

  // what the event that owns this crack decided
  kind: CrackKind = 'allow';
  color = 0xffffff;
  curvature = 0;
  maxAge = 0;
  ink = 1;
  owner: Seed | null = null;

  /**
   * Pigment spread, a random walk in 0..1 — Tarbell's SandPainter `g`. It
   * decides how far out from the crack the wash reaches, and it is the single
   * value that makes the difference between a painting and a line drawing.
   *
   * Tarbell starts it at 0.01-0.1 and lets it wander. The range matters more
   * than it looks: the wash is meant to hug the crack and fade off it, and
   * opening the spread right up does not fill the blocks — it throws a long
   * sparse reach across them that beads into visible streaks. Kept modest,
   * with the grain count carrying the density instead.
   */
  spread: number;

  constructor(rnd: () => number) {
    this.spread = 0.05 + rnd() * 0.5;
  }
}

export class Plate {
  /** Lattice cells across and down. */
  w = 0;
  h = 0;
  grid: Int32Array = new Int32Array(0);

  readonly seeds = new Map<string, Seed>();
  readonly cracks: Crack[] = [];

  // ── pushed from settings every frame ──
  density = 160;
  grains = 32;
  ink = 1;
  /** Scales every crack's curvature; the traffic decides the base. */
  curveScale = 1;
  sand = true;
  hairline = true;

  /** Grains emitted since `beginFrame`, against the frame budget. */
  private emitted = 0;
  private budget = 30000;

  /** Where pigment goes. Set by the view. */
  onSand: (x: number, y: number, color: number, alpha: number) => void = () => {};
  /** Where the crack's own dark line goes. Grouped by kind so the colour law
   *  survives into the structure without a stroke call per crack. */
  onLine: (x0: number, y0: number, x1: number, y1: number, kind: CrackKind) => void = () => {};

  private seed = 1;

  /** Cracks that stopped this cycle — the plate's own measure of how crazed it is. */
  scars = 0;

  /** Wash accounting for `?diag`: how many strokes landed, and how far they reached. */
  washPainted = 0;
  washSkipped = 0;
  washLen = 0;

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    this.grid = new Int32Array(this.w * this.h);
    this.clear();
  }

  /** Wipe the lattice but keep the hosts — a new picture of the same network. */
  clear(): void {
    this.grid.fill(EMPTY);
    this.cracks.length = 0;
    this.scars = 0;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    // re-plant every known host so the plan is there from the first frame
    for (const s of this.seeds.values()) {
      s.hits = 0;
      this.plant(s);
    }

    // Tarbell opens with a scatter of claimed cells, so there is somewhere to
    // set off from all over the canvas from the very first step. Ours are
    // hashed off the host list rather than taken at random: the scatter is
    // still this particular network's, and the same LAN opens the same way
    // every time. Without them a plate with two or three hosts can only grow
    // out of two or three points, and the picture arrives as a starburst.
    const ips = [...this.seeds.keys()].sort().join(',');
    const extra = Math.min(28, 10 + this.seeds.size);
    for (let i = 0; i < extra; i++) {
      const x = (hash01(`sx|${ips}|${i}`) * this.w) | 0;
      const y = (hash01(`sy|${ips}|${i}`) * this.h) | 0;
      const idx = this.index(x, y);
      if (idx >= 0) this.grid[idx] = (hash01(`st|${ips}|${i}`) * 360) | 0;
    }
  }

  /** Deterministic per-cycle RNG (mulberry32), so one seed is one picture. */
  rnd = (): number => {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  private rndRange(min: number, max: number): number {
    return min + this.rnd() * (max - min);
  }

  // ── hosts ────────────────────────────────────────────────────────────────

  /**
   * The seed cell for a host. Position and heading come from a hash of the IP,
   * so the same LAN always lays out the same way and a device keeps its corner
   * of the plate across reloads and across cycles.
   */
  host(ip: string, label?: string): Seed {
    const found = this.seeds.get(ip);
    if (found) {
      if (label && label !== '-' && found.label === ip) found.label = label;
      return found;
    }
    // keep seeds off the very edge, or half of every district falls off the plate
    const s: Seed = {
      ip,
      label: label && label !== '-' ? label : ip,
      x: (0.1 + hash01('x|' + ip) * 0.8) * this.w,
      y: (0.1 + hash01('y|' + ip) * 0.8) * this.h,
      t: hash01('t|' + ip) * 360,
      hits: 0,
    };
    this.seeds.set(ip, s);
    this.plant(s);
    return s;
  }

  /** Claim a host's own cell, so its district has something to grow from. */
  private plant(s: Seed): void {
    const i = this.index(s.x | 0, s.y | 0);
    if (i >= 0) this.grid[i] = s.t | 0;
  }

  /** Any host, chosen by a caller-supplied roll — for effects that must not
   *  keep landing on the same district. */
  seedAt(k: number): Seed | null {
    const n = this.seeds.size;
    if (!n) return null;
    let i = Math.min(n - 1, Math.max(0, (k * n) | 0));
    for (const s of this.seeds.values()) if (i-- <= 0) return s;
    return null;
  }

  /** The host with the most traffic this cycle. */
  busiest(): Seed | null {
    let best: Seed | null = null;
    for (const s of this.seeds.values()) if (!best || s.hits > best.hits) best = s;
    return best && best.hits > 0 ? best : null;
  }

  private index(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return x + y * this.w;
  }

  // ── the frame ────────────────────────────────────────────────────────────

  beginFrame(budget: number): void {
    this.emitted = 0;
    this.washPainted = 0;
    this.washSkipped = 0;
    this.washLen = 0;
    this.budget = budget;
  }

  /** Advance every live crack `steps` times. */
  advance(steps: number): void {
    // the density knob can be turned down mid-picture; drop the overflow
    if (this.cracks.length > this.density) this.cracks.length = this.density;
    for (let n = 0; n < steps; n++) {
      for (let i = 0; i < this.cracks.length; i++) this.step(this.cracks[i]);
    }
  }

  // ── growth ───────────────────────────────────────────────────────────────

  /**
   * Start a crack for one event. It looks for somewhere to be born inside its
   * own host's district first, so a chatty device visibly builds out its own
   * quarter of the plate.
   */
  spawn(o: SpawnOpts): Crack | null {
    let c: Crack | null = null;
    if (this.cracks.length < this.density) {
      c = new Crack(this.rnd);
      this.cracks.push(c);
    } else {
      // At capacity, take over a crack that has stopped rather than building a
      // new one. Reuse is not just cheaper: the pigment spread rides along on
      // the object, so the plate keeps the wash it has worked up instead of
      // resetting to a hairline every time an event arrives.
      for (const k of this.cracks) if (!k.alive) { c = k; break; }
      if (!c) return null;
    }
    c.kind = o.kind;
    c.color = o.color;
    c.curvature = (o.curvature ?? 0.02) * this.curveScale;
    c.maxAge = o.maxAge ?? 0;
    c.ink = o.ink ?? 1;
    c.owner = o.near ?? null;
    if (!this.findStart(c, o.near ?? null, o.sign)) {
      c.alive = false;
      return null;
    }
    if (o.near) o.near.hits++;
    return c;
  }

  /**
   * Find a claimed cell and leave it at right angles. Tarbell samples the whole
   * canvas; we sample the host's district first (a widening series of discs)
   * and only then fall back to the whole plate, which is what ties the shape of
   * the picture to the shape of the network.
   */
  private findStart(c: Crack, near: Seed | null, sign?: number): boolean {
    let px = 0;
    let py = 0;
    let found = false;

    // A weak pull toward the host's own district — enough that a talkative
    // device shapes its corner of the plate, but no more. Tarbell samples the
    // whole canvas uniformly, and that uniformity is what spreads the picture
    // out; binding most cracks to their host instead piled them onto the one
    // cell a quiet district had claimed and drew a starburst over it.
    if (near && this.rnd() < 0.35) {
      const r = Math.min(this.w, this.h) * (0.12 + this.rnd() * 0.25);
      for (let tries = 0; tries < 300 && !found; tries++) {
        const a = this.rnd() * Math.PI * 2;
        const d = this.rnd() * r;
        px = (near.x + Math.cos(a) * d) | 0;
        py = (near.y + Math.sin(a) * d) | 0;
        const i = this.index(px, py);
        if (i >= 0 && this.grid[i] < EMPTY) found = true;
      }
    }
    for (let tries = 0; tries < 900 && !found; tries++) {
      px = (this.rnd() * this.w) | 0;
      py = (this.rnd() * this.h) | 0;
      const i = this.index(px, py);
      if (i >= 0 && this.grid[i] < EMPTY) found = true;
    }
    if (!found) return false;

    // ±90° off whatever claimed this cell, with a couple of degrees of slop so
    // the lattice is hand-drawn rather than mechanical
    let a = this.grid[this.index(px, py)];
    const turn = sign !== undefined ? sign : this.rnd() < 0.5 ? -1 : 1;
    a += turn * 90 + (this.rndRange(-2, 2.1) | 0);

    c.x = px + 0.61 * Math.cos(a * RAD);
    c.y = py + 0.61 * Math.sin(a * RAD);
    c.t = a;
    c.age = 0;
    c.alive = true;
    return true;
  }

  /** One advance of one crack: claim, or stop and be replaced. */
  private step(c: Crack): void {
    if (!c.alive) {
      // A stopped crack is reborn, which is how the plate keeps filling. Mostly
      // back in its own host's district, but not always: if every crack only
      // ever restarted at home the districts would bunch into knots and the
      // rest of the plate would stay bare.
      const local = this.rnd() < 0.3 ? c.owner : null;
      if (!this.findStart(c, local, undefined)) return;
    }

    c.t += c.curvature;
    const px = c.x;
    const py = c.y;
    c.x += STEP * Math.cos(c.t * RAD);
    c.y += STEP * Math.sin(c.t * RAD);
    c.age++;

    if (this.hairline) this.onLine(px, py, c.x, c.y, c.kind);
    if (this.sand) this.wash(c);

    if (c.maxAge > 0 && c.age > c.maxAge) {
      c.alive = false;
      this.scars++;
      return;
    }

    const cx = c.x | 0;
    const cy = c.y | 0;
    const i = this.index(cx, cy);
    if (i < 0) {
      c.alive = false;
      this.scars++;
      return;
    }
    const g = this.grid[i];
    if (g >= EMPTY || Math.abs(g - c.t) < 5) {
      this.grid[i] = c.t | 0;           // open ground, or near enough parallel to merge
    } else {
      c.alive = false;                  // met another crack at an angle: stop dead
      this.scars++;
    }
  }

  // ── pigment ──────────────────────────────────────────────────────────────

  /**
   * Tarbell's SandPainter, and the reason the thing is beautiful rather than
   * merely structural. March sideways from the tip until the far wall of the
   * open region, then lay a run of translucent grains across that gap: wide
   * where the region is open, a tight rim where two cracks nearly touch.
   */
  private wash(c: Crack): void {
    const sinT = Math.sin(c.t * RAD);
    const cosT = Math.cos(c.t * RAD);
    let rx = c.x;
    let ry = c.y;
    for (let n = 0; n < MARCH_CAP; n++) {
      rx += 0.81 * sinT;
      ry -= 0.81 * cosT;
      const i = this.index(rx | 0, ry | 0);
      if (i < 0 || this.grid[i] < EMPTY) break;
    }

    c.spread = Math.max(0, Math.min(1, c.spread + this.rndRange(-0.05, 0.05)));

    /*
     * Tarbell spends a fixed 64 grains however far the wash reaches, which is
     * fine on a canvas whose regions are all of a size. Ours are not: a wash
     * across a freshly opened quarter of the plate got the same 64 grains as
     * one into a gap two cells wide, so the first beaded into a dotted beam
     * and the second was a hard rim. Instead we fix the *spacing* at just
     * under a cell and let the count follow the reach — and cap the reach at
     * what the grain budget can actually cover smoothly, so a wash bleeds off
     * its crack and stops rather than spraying across open ground.
     */
    const dx = rx - c.x;
    const dy = ry - c.y;
    const uMax = Math.sin(Math.sin(c.spread));
    const dist = Math.hypot(dx, dy) * uMax;
    if (dist < 0.5 || uMax <= 0) { this.washSkipped++; return; }
    this.washPainted++;
    this.washLen += dist;
    const len = Math.min(dist, WASH_REACH);
    const n = Math.max(4, Math.min(this.grains, Math.round(len * GRAIN_PER_CELL)));
    const w = c.spread / Math.max(1, n - 1);
    const scale = this.ink * c.ink;
    // unit vector toward the far wall
    const inv = 1 / Math.hypot(dx, dy);
    const ux = dx * inv;
    const uy = dy * inv;

    for (let i = 0; i < n; i++) {
      if (this.emitted >= this.budget) return;
      // same falloff as Tarbell's: densest and strongest against the crack
      const a = WASH_ALPHA * (1 - i / n) * scale;
      if (a <= 0) continue;
      const d = len * (Math.sin(Math.sin(i * w)) / uMax);
      this.onSand(c.x + ux * d, c.y + uy * d, c.color, a);
      this.emitted++;
    }
  }

  /**
   * A pool of pigment with no crack behind it: DNS settling into a junction.
   * Grains fall off toward the edge, so it reads as a wash and not a disc.
   */
  bloom(x: number, y: number, color: number, radius: number, grains: number, ink = 1): void {
    for (let i = 0; i < grains; i++) {
      if (this.emitted >= this.budget) return;
      const a = this.rnd() * Math.PI * 2;
      const d = radius * Math.sqrt(this.rnd());
      const fall = 1 - d / radius;
      this.onSand(x + Math.cos(a) * d, y + Math.sin(a) * d, color,
                  0.05 * fall * fall * this.ink * ink);
      this.emitted++;
    }
  }

  /** Faint pigment adrift, going nowhere: Wi-Fi and system chatter. */
  drift(x: number, y: number, color: number, n: number, spread: number, ink = 1): void {
    for (let i = 0; i < n; i++) {
      if (this.emitted >= this.budget) return;
      const a = this.rnd() * Math.PI * 2;
      const d = spread * this.rnd();
      this.onSand(x + Math.cos(a) * d, y + Math.sin(a) * d, color,
                  0.04 * this.ink * ink);
      this.emitted++;
    }
  }

  /**
   * Claim a short arc of cells as a wall. A blocked flow does not just draw a
   * red line, it puts something in the lattice that later cracks die against —
   * so a firewall rule slowly becomes a boundary in the city.
   */
  barrier(x: number, y: number, deg: number, len: number): void {
    const dx = Math.cos(deg * RAD);
    const dy = Math.sin(deg * RAD);
    for (let n = 0; n < len; n++) {
      const i = this.index((x + dx * n) | 0, (y + dy * n) | 0);
      if (i < 0) return;
      if (this.grid[i] >= EMPTY) this.grid[i] = deg | 0;
    }
  }
}
