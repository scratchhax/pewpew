import { Container, Sprite } from 'pixi.js';
import { angleDelta, type Compound } from './compound';
import { fade, type Fx } from './fx';
import type { ZTextures } from './textures';
import { Point, wallPoint } from './layout';
import { edgePoint } from '../../state';

const BLOOD = 0x9a1010;

interface Pounce { fx: number; fy: number; tx: number; ty: number; t: number; person: boolean }

interface Zombie {
  s: Sprite; eyes: Sprite[];
  sx: number; sy: number; tx: number; ty: number;
  t: number; dur: number;
  speed: number;               // px/s along the path (for resuming after a pounce)
  killAt: number | null;       // progress at which a tower drops it (null = reaches the wall)
  phase: number; weave: number;  // phase: this zombie's offset against the beat
  brute: boolean; horde: number; // horde id (0 = lone zombie)
  sprinter: boolean;           // fast, breaches, bashes buildings
  dying: number;               // > 0 while falling
  seen: number;                // seconds on screen (for fade-in)
  watched: boolean;            // a guard has started turning toward it
  shot: boolean;               // rounds fired, waiting for the hit
  baseScale: number; fallFrom: number; fallDir: number;
  color: number;
  // sprinter post-breach state
  breached: boolean;
  targetBuilding: Point;
  bangs: number;
  bangT: number;
  intercepted: boolean;  // already grabbed a vulnerable walker
  // fence pressure: a wall-reacher clings and claws before the wall guns drop it
  claw: number;
  clawT: number;
  dog: boolean;                // feral pack runner: fast, low, snaps past the guards
  pounce: Pounce | null;       // mid-leap at a survivor
  inside: boolean;             // got through a broken wall: hunts inside the compound
}

export interface ZombieHits { kills: Point[]; breaches: Point[] }

/**
 * Blocked traffic arrives as zombies from a bearing fixed by the remote IP;
 * IDS threats arrive as a brute leading a pack. Towers shoot them on approach;
 * the occasional one reaches the fence (a breach).
 */
interface Corpse { s: Sprite; age: number }

export class Zombies {
  private list: Zombie[] = [];
  private corpses: Corpse[] = [];
  private hordeSeq = 0;
  unit = 1;
  /** Guards opened fire at screen x with this many rounds (for the soundtrack). */
  onShot?: (x: number, rounds: number) => void;
  /** A sprinter bashed a building at (x, y). */
  onBang?: (x: number, y: number) => void;
  /** A zombie intercepted a vulnerable walker at (x, y). */
  onWalkIntercept?: (x: number, y: number) => void;
  /** A zombie is clawing at the wall at (x, y) (thuds + scratches). */
  onClaw?: (x: number, y: number) => void;
  maxCorpses = 20;

  constructor(private layer: Container, private lights: Container, private tex: ZTextures,
              private compound: Compound, private fx: Fx) {}

  count(): number { return this.list.filter((z) => !z.brute && z.horde === 0 && !z.dog && !z.inside && z.dying <= 0).length; }
  hordes(): number { return new Set(this.list.filter((z) => z.brute && z.dying <= 0).map((z) => z.horde)).size; }
  /** Feral runners on screen (a pack or two at most, whatever the settings say). */
  dogs(): number { return this.list.filter((z) => z.dog && z.dying <= 0).length; }

  spawn(angle: number, color: number): void {
    this.add(angle, color, false, 0, 0);
  }

  /** A pack of feral dogs: fast, low, mostly silhouette and eye glints. */
  spawnPack(angle: number, color: number): void {
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) this.add(angle + (Math.random() - 0.5) * 0.25, color, false, 0, i * 0.12, false, true);
  }

  /** A brute plus a pack, weaving in on one bearing. */
  spawnHorde(angle: number, color: number): void {
    const id = ++this.hordeSeq;
    this.add(angle, color, true, id, 0, false);
    const pack = 6 + ((Math.random() * 5) | 0);
    for (let i = 0; i < pack; i++) this.add(angle + (Math.random() - 0.5) * 0.35, color, false, id, 0.4 + i * 0.25, false);
  }

  /** A sprinter: fast, not stopped by towers, breaches and bashes a building. */
  spawnSprinter(angle: number, color: number): void {
    this.add(angle, color, false, 0, 0, true);
  }

  private add(angle: number, color: number, brute: boolean, horde: number, delay: number, sprinter = false, dog = false): void {
    const L = this.compound.L;
    const start = edgePoint(L.cx, L.cy, L.w, L.h, angle, 1.05);
    const end = wallPoint(L, start, 16 * L.unit);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const speed = (dog ? 230 : sprinter ? 130 : horde ? 48 : 40) * L.unit * (0.85 + Math.random() * 0.3);
    const s = new Sprite(dog ? this.tex.dog : this.tex.frame(sprinter ? 'zombie_stand' : (Math.random() < 0.8 ? 'zombie' : 'zombie_stand')));
    s.anchor.set(dog ? 0.5 : 0.45, 0.5);
    s.scale.set((dog ? 0.75 + Math.random() * 0.2 : brute ? 1.9 : sprinter ? 0.8 : 0.95 + Math.random() * 0.2) * L.unit);
    // sickly skin variety; brutes a paler, meaner green; sprinters a more yellow, feverish tint
    s.tint = dog ? 0xffffff : brute ? 0xc8ff9a : sprinter ? 0xd8e8a0 : [0xffffff, 0xd8f0c8, 0xe8e0c0, 0xc8e8d8][(Math.random() * 4) | 0];
    s.position.set(start.x, start.y);
    s.rotation = Math.atan2(end.y - start.y, end.x - start.x);
    // a PAIR of eyes, set apart across the heading, so it reads as a face
    const eyeTint = dog ? 0xd8ff5a : sprinter ? 0xff8a3a : brute ? 0xff9a45 : 0xff3a2a;
    const eyeScale = (dog ? 0.12 : brute ? 0.3 : 0.17) * L.unit;
    const eyes: Sprite[] = [];
    for (const side of [-1, 1]) {
      const eye = new Sprite(this.tex.glow);
      eye.anchor.set(0.5); eye.blendMode = 'add'; eye.tint = eyeTint;
      eye.scale.set(eyeScale); fade(eye, 0);
      eyes.push(eye);
      this.lights.addChild(eye);
    }
    this.layer.addChild(s);
    const lone = !brute && horde === 0 && !sprinter && !dog;
    this.list.push({
      s, eyes, sx: start.x, sy: start.y, tx: end.x, ty: end.y,
      t: -delay * speed / Math.max(1, dist), dur: dist / speed, speed,
      killAt: sprinter ? null
        : dog ? 0.45 + Math.random() * 0.2
        : brute ? 0.82 + Math.random() * 0.12
        : lone ? (Math.random() < 0.72 ? 0.55 + Math.random() * 0.38 : null)
        : 0.72 + Math.random() * 0.28,
      phase: Math.random() * 10, weave: dog ? 14 : sprinter ? 10 : horde ? 22 : 6,
      brute, horde, sprinter, dying: 0, seen: 0, watched: false, shot: false,
      baseScale: s.scale.x, fallFrom: 0, fallDir: 1, color,
      breached: false, targetBuilding: { x: L.cx, y: L.cy }, bangs: 0, bangT: 0,
      intercepted: false, claw: 0, clawT: 0, dog, pounce: null, inside: false,
    });
  }

  /** Anything with teeth at the walls or loose inside? (drives alarm + audio) */
  underAttack(): boolean {
    return this.list.some((z) => z.dying <= 0 && (z.brute || z.inside || z.claw > 0 || z.dog));
  }

  /** A wall side just broke: the ones clawing at it come through and hunt. */
  breakInside(gap: Point): number {
    const L = this.compound.L;
    const inPoint = this.compound.insidePoint(gap);
    let n = 0;
    for (const z of this.list) {
      if (z.claw <= 0 || z.dying > 0 || z.inside) continue;
      if (Math.hypot(z.s.x - gap.x, z.s.y - gap.y) > 150 * L.unit) continue;
      z.claw = 0;
      z.inside = true;
      z.intercepted = false;
      z.sx = z.s.x; z.sy = z.s.y;
      z.tx = inPoint.x; z.ty = inPoint.y;
      z.t = 0;
      z.dur = Math.hypot(z.tx - z.sx, z.ty - z.sy) / (90 * L.unit);
      z.killAt = null;
      n++;
    }
    return n;
  }

  insideCount(): number { return this.list.filter((z) => z.inside && z.dying <= 0).length; }

  /** Where every zombie is, fallen ones included (survivors step around them). */
  positions(): Point[] {
    return this.list.filter((z) => z.t >= 0).map((z) => ({ x: z.s.x, y: z.s.y }));
  }

  /** Zombies currently clinging to the fence (for ambient groans and their panning). */
  clawing(): Point[] {
    return this.list.filter((z) => z.claw > 0).map((z) => ({ x: z.s.x, y: z.s.y }));
  }

  /** `people` are survivors on the move: a zombie closing on one draws cover fire. */
  /** `beat` is the scene's music clock: zombies shamble and bob in time with it. */
  update(dt: number, darkness: number, people: Point[] = [], beat = 0, vulnerable: Point[] = []): ZombieHits {
    const hits: ZombieHits = { kills: [], breaches: [] };
    const L = this.compound.L;
    const cover = 130 * L.unit;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      if (z.dying > 0) {
        // topple over and sink into the ground rather than spinning away
        z.dying -= dt;
        const fall = 1 - Math.max(0, z.dying / 0.9);
        z.s.alpha = Math.max(0, z.dying / 0.9);
        z.s.rotation = z.fallFrom + z.fallDir * 0.9 * Math.sin(fall * Math.PI / 2);
        z.s.scale.set(z.baseScale * (1 - 0.15 * fall));
        for (const e of z.eyes) fade(e, e.alpha * Math.max(0, 1 - dt * 3));   // eyes dim out, not cut
        if (z.dying <= 0) {
          // leave a dark corpse on the ground
          this.addCorpse(z.s.x, z.s.y, z.s.rotation, z.baseScale, z.dog);
          z.s.destroy();
          for (const e of z.eyes) e.destroy();
          this.list.splice(i, 1);
        }
        continue;
      }
      z.t += dt / z.dur;
      if (z.t < 0) { z.s.visible = false; continue; }
      z.s.visible = true;
      z.seen += dt;
      z.s.alpha = Math.min(1, z.seen / 0.8);
      // a pounce: a short accelerating leap onto a survivor, body stretching
      // into it, then the blood happens where it lands
      if (z.pounce) {
        const p = z.pounce;
        p.t += dt / 0.32;
        const k = Math.min(1, p.t);
        const e = k * k;
        const x = p.fx + (p.tx - p.fx) * e, y = p.fy + (p.ty - p.fy) * e;
        z.s.position.set(x, y);
        z.s.rotation = Math.atan2(p.ty - p.fy, p.tx - p.fx);
        z.s.scale.set(z.baseScale * (1 + 0.4 * Math.sin(Math.PI * k)));
        this.placeEyes(z, x, y, darkness);
        if (k >= 1) {
          z.s.scale.set(z.baseScale);
          z.pounce = null;
          if (p.person) {
            this.onWalkIntercept?.(p.tx, p.ty);
            this.kill(z, { x: p.tx, y: p.ty }, 1);
            hits.kills.push({ x: p.tx, y: p.ty });
          } else {
            this.onWalkIntercept?.(p.tx, p.ty);
            z.intercepted = true;
            // carry on to the wall from where the leap landed
            z.sx = p.tx; z.sy = p.ty; z.t = 0;
            z.dur = Math.hypot(z.tx - z.sx, z.ty - z.sy) / z.speed;
          }
        }
        continue;
      }
      const ux = z.tx - z.sx, uy = z.ty - z.sy;
      const len = Math.hypot(ux, uy) || 1;
      const px = -uy / len, py = ux / len;
      const k = Math.min(1, z.t);
      // one shamble per two beats; a horde weaves slower, a brute slowest of all,
      // a dog fairly runs the beat into the ground
      const step = beat * Math.PI * (z.brute ? 0.6 : z.sprinter ? 1.6 : z.dog ? 2.4 : 1) + z.phase;
      const sway = Math.sin(beat * Math.PI * (z.brute ? 0.25 : z.sprinter ? 1.4 : z.dog ? 2.4 : z.horde ? 0.4 : 1) + z.phase) * z.weave * L.unit * (1 - k * 0.6);
      const x = z.sx + ux * k + px * sway, y = z.sy + uy * k + py * sway;
      z.s.position.set(x, y);
      z.s.rotation = Math.atan2(uy, ux) + Math.sin(step) * (z.dog ? 0.06 : 0.12);
      // eyes lead the body out of the dark: at night they're the first thing you see
      this.placeEyes(z, x, y, darkness);
      // clamped sprinters at their target don't advance past t=1
      if (z.sprinter && z.breached && Math.hypot(z.tx - x, z.ty - y) < 22 * L.unit) z.t = 1;

      if (z.shot) continue;                          // rounds are on their way

      // guards start turning toward a zombie a moment before they drop it
      if (z.killAt !== null && !z.watched && z.t >= z.killAt - 0.12) {
        z.watched = true;
        for (const i of this.shooters(z, { x, y })) this.compound.watch(i, { x, y });
      }

      // guards won't let a zombie reach a survivor out on the road
      const threatening = people.some((p) => Math.hypot(p.x - x, p.y - y) < cover);
      // a vulnerable walker in pounce range gets leapt on: a short, fast,
      // accelerating leap, then the blood happens where it lands
      if (!z.intercepted && !z.pounce) {
        let best: Point | null = null, bd = 70 * L.unit;
        for (const p of vulnerable) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) z.pounce = { fx: x, fy: y, tx: best.x, ty: best.y, t: 0, person: false };
      }

      if (threatening || (z.killAt !== null && z.t >= z.killAt)) {
        if (z.dog && !threatening && Math.random() > 0.6) {
          // the guards' snap-shot at a runner: rounds chase it, dirt kicks up,
          // and most of the pack gets clean away
          z.killAt = null;
          this.snap(z, { x, y });
        } else {
          this.kill(z, { x, y }, z.brute ? 3 : 1);
          hits.kills.push({ x, y });
        }
      } else if (z.t >= 1) {
        if (z.inside) {
          // loose inside the walls: hunt the nearest survivor; the wall guns
          // get their chance through the `threatening` cover fire above
          let nearest: Point | null = null, nd = Infinity;
          for (const p of people) {
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < nd) { nd = d; nearest = p; }
          }
          if (nearest && nd > 30 * L.unit) {
            z.sx = x; z.sy = y; z.tx = nearest.x; z.ty = nearest.y; z.t = 0;
            z.dur = nd / (95 * L.unit);
          } else if (nearest && !z.pounce) {
            z.pounce = { fx: x, fy: y, tx: nearest.x, ty: nearest.y, t: 0, person: true };
          } else if (!nearest && z.killAt === null) {
            // nothing left to hunt: the guns drop it where it stands
            z.killAt = z.t + 0.2;
          }
        } else if (z.sprinter) {
          // sprinter breaches: sprints into the compound to hunt a person
          if (!z.breached) {
            z.breached = true;
            hits.breaches.push({ x, y });
            this.fx.emit(x, y, 0xc9b48a, 8, 50, 0.25, 0.8);
            // target the nearest person (walker) in the compound
            let nearest: Point | null = null, nd = Infinity;
            for (const p of people) {
              const d = Math.hypot(p.x - x, p.y - y);
              if (d < nd) { nd = d; nearest = p; }
            }
            if (!nearest) nearest = { x: this.compound.L.cx + (Math.random() - 0.5) * 100, y: this.compound.L.cy };
            z.targetBuilding = nearest;
            // reset movement: from current pos to the person
            z.sx = x; z.sy = y;
            z.tx = nearest.x; z.ty = nearest.y;
            z.t = 0;
            const d2 = Math.hypot(z.tx - z.sx, z.ty - z.sy);
            z.dur = d2 / (110 * this.compound.L.unit);
            // towers get a chance to stop them: killAt at 55-90% of inside distance
            z.killAt = 0.55 + Math.random() * 0.35;
          } else {
            // closing on the person: pounce when in range
            const dist = Math.hypot(z.tx - x, z.ty - y);
            if (dist < 60 * L.unit && !z.pounce) {
              z.pounce = { fx: x, fy: y, tx: z.tx, ty: z.ty, t: 0, person: true };
            } else if (dist < 18 * L.unit) {
              this.onWalkIntercept?.(x, y);
              this.kill(z, { x, y }, 1);
              hits.kills.push({ x, y });
            }
          }
        } else if (z.claw <= 0) {
          // reached the fence: cling to it and claw until the wall guns drop it
          // (dogs throw themselves at it in short frantic bursts)
          z.claw = z.dog ? 0.8 + Math.random() * 0.8 : 1.2 + Math.random();
          z.clawT = 0;
          hits.breaches.push({ x, y });
          this.fx.emit(x, y, 0xc9b48a, 6, 40, 0.22, 0.8);
        } else {
          // clawing at the wall: dust and thuds until the wall guns finish it
          z.claw -= dt;
          z.clawT += dt;
          z.s.rotation += Math.sin(z.clawT * (z.dog ? 42 : 26) + z.phase) * 0.07;
          if (z.clawT > (z.dog ? 0.18 : 0.3)) {
            z.clawT = 0;
            this.fx.emit(x, y, 0xc9b48a, 2, 26, 0.14, 0.5);
            this.onClaw?.(x, y);
          }
          if (z.claw <= 0) {
            this.kill(z, { x, y }, z.brute ? 3 : 1);
            hits.kills.push({ x, y });
          }
        }
      }
    }
    return hits;
  }

  /** Two eye glints set well apart across the heading (small soft glows merge
   *  into one dot if they're closer than about twice their size), leading the
   *  body out of the dark. */
  private placeEyes(z: Zombie, x: number, y: number, darkness: number): void {
    const L = this.compound.L;
    const fwd = (z.dog ? 7 : 6.5) * L.unit;
    const apart = (z.brute ? 9 : z.dog ? 4.2 : 5.6) * L.unit;
    const c = Math.cos(z.s.rotation), s = Math.sin(z.s.rotation);
    const a = darkness * (z.brute ? 1 : 0.85) * Math.min(1, z.seen / 1.5);
    for (let i = 0; i < 2; i++) {
      const o = i === 0 ? -apart : apart;
      z.eyes[i].position.set(x + c * fwd - s * o, y + s * fwd + c * o);
      fade(z.eyes[i], a);
    }
  }

  /** The nearest tower; a brute also draws the next one, but only if it's
   *  nearly as close (so no shots across the whole courtyard). */
  private shooters(z: Zombie, p: Point): number[] {
    const [a, b] = this.compound.towersNear(p);
    return z.brute && b && b.d < a.d * 1.35 ? [a.i, b.i] : [a.i];
  }

  /** Guards open fire: rounds fly to the zombie and it drops when the first lands. */
  private kill(z: Zombie, p: Point, bursts: number): void {
    z.shot = true;
    this.onShot?.(p.x, this.shooters(z, p).length * bursts);
    const L = this.compound.L;
    const last = { x: p.x, y: p.y };
    // follow the zombie while it's on screen; stragglers land where it fell
    const target = () => {
      if (!z.s.destroyed) { last.x = z.s.x; last.y = z.s.y; }
      return last;
    };
    let first = true;
    for (const i of this.shooters(z, p)) {
      for (let b = 0; b < bursts; b++) {
        const muzzle = this.compound.aim(i, p);
        this.fx.bullet(muzzle.x, muzzle.y, target, 900 * L.unit,
          first ? (x, y) => this.hit(z, x, y) : undefined, b * 0.12);
        first = false;
      }
    }
  }

  /** The guards' snap-shot at a runner: rounds chase it and kick up dirt
   *  where it was; nobody drops. */
  private snap(z: Zombie, p: Point): void {
    const L = this.compound.L;
    this.onShot?.(p.x, 1);
    const last = { x: p.x, y: p.y };
    const target = () => {
      if (!z.s.destroyed) { last.x = z.s.x; last.y = z.s.y; }
      return last;
    };
    for (const i of this.shooters(z, p)) {
      const muzzle = this.compound.aim(i, p);
      this.fx.bullet(muzzle.x, muzzle.y, target, 900 * L.unit,
        (bx, by) => this.fx.emit(bx, by, 0x6a5a44, 4, 40, 0.16, 0.5));
    }
  }

  private hit(z: Zombie, x: number, y: number): void {
    if (z.dying > 0) return;
    this.fx.emit(x, y, BLOOD, z.brute ? 10 : 5, z.brute ? 70 : 45, 0.18, 0.6);
    this.fx.splat(x, y, z.brute ? 2.2 : 1.2);
    if (z.brute) this.fx.ring(x, y, 0x661111, 110 * this.compound.L.unit, 3.5, 0.9);
    z.dying = 0.9;
    z.fallFrom = z.s.rotation;
    z.fallDir = Math.random() < 0.5 ? -1 : 1;
  }

  private addCorpse(x: number, y: number, rot: number, scale: number, dog = false): void {
    if (this.corpses.length >= this.maxCorpses) {
      const old = this.corpses.shift()!;
      old.s.destroy();
    }
    const s = new Sprite(dog ? this.tex.dog : this.tex.frame('zombie'));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.rotation = dog ? rot : rot + Math.PI / 2;
    s.scale.set(scale * (dog ? 0.85 : 0.7));
    s.tint = dog ? 0x2a2620 : 0x3a3a2a;
    s.alpha = 0.5;
    this.layer.addChild(s);
    this.corpses.push({ s, age: 0 });
  }

  updateCorpses(dt: number): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.age += dt;
      if (c.age > 45) {
        c.s.destroy();
        this.corpses.splice(i, 1);
        continue;
      }
      if (c.age > 40) c.s.alpha = Math.max(0, 0.5 * (1 - (c.age - 40) / 5));
    }
  }
}

interface Walker {
  s: Sprite; prop: Sprite | null; lamp: Sprite;
  path: Point[]; seg: number; along: number;
  speed: number;
  rot: number;
  fade: number;
  dodge: number;
  onDone?: (p: Point) => void;
  kind: string;
  vulnerable: boolean;
  dead: number; // > 0 while dying
}

const SURVIVORS = ['survivor_a', 'survivor_b', 'survivor_c', 'survivor_d', 'survivor_e', 'survivor_f'] as const;

/** Survivors on the move: supply runs, couriers, new arrivals, building visits. */
export class Walkers {
  private list: Walker[] = [];
  /** A vulnerable walker was killed at (x, y). */
  onWalkedKilled?: (x: number, y: number) => void;

  constructor(private layer: Container, private lights: Container, private tex: ZTextures, private fx?: Fx) {}

  count(kind?: string): number { return kind ? this.list.filter((w) => w.kind === kind).length : this.list.length; }

  walk(kind: string, route: Point[], opts: {
    speed: number; carry?: boolean; onDone?: (p: Point) => void; unit: number; vulnerable?: boolean;
  }): void {
    if (route.length < 2) return;
    const lane = 9 * opts.unit;
    const ox = (Math.random() * 2 - 1) * lane, oy = (Math.random() * 2 - 1) * lane;
    const path = route.map((p, i) => (i === 0 || i === route.length - 1 ? p : { x: p.x + ox, y: p.y + oy }));
    const s = new Sprite(this.tex.frame(opts.carry ? 'carrier' : SURVIVORS[(Math.random() * SURVIVORS.length) | 0]));
    s.anchor.set(0.4, 0.5);
    s.scale.set(0.85 * opts.unit);
    s.position.set(path[0].x, path[0].y);
    const rot = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
    s.rotation = rot;
    s.alpha = 0;
    let prop: Sprite | null = null;
    if (opts.carry) {
      prop = new Sprite(this.tex.frame('crate_small'));
      prop.anchor.set(0.5);
      prop.scale.set(0.55 * opts.unit);
      prop.alpha = 0;
      this.layer.addChild(prop);
    }
    const lamp = new Sprite(this.tex.glow);
    lamp.anchor.set(0.05, 0.5); lamp.blendMode = 'add'; lamp.tint = 0xfff3d0; fade(lamp, 0);
    this.layer.addChild(s);
    this.lights.addChild(lamp);
    this.list.push({ s, prop, lamp, path, seg: 0, along: 0, speed: opts.speed, rot, fade: 0, dodge: 0, onDone: opts.onDone, kind, vulnerable: opts.vulnerable ?? false, dead: 0 });
  }

  /** Survivors still walking (not the ones fading out at their destination). */
  positions(): Point[] {
    return this.list.filter((w) => w.seg < w.path.length - 1 && w.dead <= 0).map((w) => ({ x: w.s.x, y: w.s.y }));
  }

  /** Positions of vulnerable walkers still on the road (for zombie intercept). */
  vulnerablePositions(): Point[] {
    return this.list.filter((w) => w.vulnerable && w.dead <= 0 && w.seg < w.path.length - 1).map((w) => ({ x: w.s.x, y: w.s.y }));
  }

  /** A zombie reached a vulnerable walker: the pounce lands, blood sprays,
   *  the survivor is thrown and goes down spinning. */
  killWalker(w: Walker): void {
    w.dead = 0.9;
    w.s.rotation += 0.6;
    const x = w.s.x, y = w.s.y;
    this.fx?.emit(x, y, 0xd02020, 18, 150, 0.26, 0.7);   // the spray, bright enough to see
    this.fx?.emit(x, y, BLOOD, 8, 55, 0.42, 1.0);        // heavy drops that travel
    this.fx?.splat(x, y, 2);
    this.fx?.ring(x, y, 0x661111, 40 * (w.s.scale.x / 0.85), 2.5, 0.6);
    this.onWalkedKilled?.(x, y);
  }

  /** Kill the nearest vulnerable walker to (x, y) within `range` px. Returns true if one was found. */
  killNearestVulnerable(x: number, y: number, range = 130): boolean {
    let best: Walker | null = null, bestD = range;
    for (const w of this.list) {
      if (!w.vulnerable || w.dead > 0 || w.seg >= w.path.length - 1) continue;
      const d = Math.hypot(w.s.x - x, w.s.y - y);
      if (d < bestD) { best = w; bestD = d; }
    }
    if (best) { this.killWalker(best); return true; }
    return false;
  }

  /** `avoid` are zombies (live or falling): walkers sidestep rather than pass through. */
  update(dt: number, darkness: number, flashlights = true, avoid: Point[] = []): void {
    const lampDark = flashlights ? darkness : 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      if (w.dead > 0) {
        // dying: thrown a step, spinning out and fading
        w.dead -= dt;
        const d = Math.max(0, w.dead / 0.9);
        w.s.rotation += dt * 4.5;
        w.s.x += Math.cos(w.s.rotation) * 70 * d * dt;
        w.s.y += Math.sin(w.s.rotation) * 70 * d * dt;
        w.s.alpha = d;
        if (w.prop) w.prop.alpha = Math.max(0, w.dead / 0.9);
        fade(w.lamp, 0);
        if (w.dead <= 0) {
          w.s.destroy(); w.prop?.destroy(); w.lamp.destroy();
          this.list.splice(i, 1);
        }
        continue;
      }
      if (w.seg >= w.path.length - 1) {
        // arrived: step out of view over half a second
        w.fade = Math.max(0, w.fade - dt * 2);
        w.s.alpha = w.fade;
        if (w.prop) w.prop.alpha = w.fade;
        fade(w.lamp, w.fade * lampDark * 0.35);
        if (w.fade <= 0) {
          w.s.destroy(); w.prop?.destroy(); w.lamp.destroy();
          this.list.splice(i, 1);
        }
        continue;
      }
      w.fade = Math.min(1, w.fade + dt * 3);
      let a = w.path[w.seg], b = w.path[w.seg + 1];
      let segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      w.along += w.speed * dt;
      // advance through finished segments and re-read the CURRENT segment:
      // reusing the old one here drew walkers back at the previous waypoint
      // for a frame at every corner (the flicker/teleport)
      let arrived = false;
      while (w.along >= segLen) {
        w.along -= segLen;
        w.seg++;
        if (w.seg >= w.path.length - 1) { arrived = true; break; }
        a = w.path[w.seg];
        b = w.path[w.seg + 1];
        segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      }
      if (arrived) {
        w.s.position.set(b.x, b.y);
        w.onDone?.(b);
        continue;
      }
      const f = w.along / segLen;
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      // step to the side of any zombie near the path, easing out and back in
      const px = -Math.sin(heading), py = Math.cos(heading);
      const cx = a.x + (b.x - a.x) * f, cy = a.y + (b.y - a.y) * f;
      const reach = 46 * w.s.scale.x, maxDodge = 26 * w.s.scale.x;
      let want = 0;
      for (const z of avoid) {
        const d = Math.hypot(z.x - cx, z.y - cy);
        if (d >= reach) continue;
        const side = (z.x - cx) * px + (z.y - cy) * py;
        want -= (side >= 0 ? 1 : -1) * maxDodge * (1 - d / reach) * 1.6;
      }
      want = Math.max(-maxDodge, Math.min(maxDodge, want));
      w.dodge += (want - w.dodge) * Math.min(1, dt * 4);
      const x = cx + px * w.dodge, y = cy + py * w.dodge;
      w.rot += angleDelta(w.rot, heading) * Math.min(1, dt * 8);
      w.s.position.set(x, y);
      w.s.rotation = w.rot;
      w.s.alpha = w.fade;
      if (w.prop) {
        const reach = 16 * w.s.scale.x;
        w.prop.position.set(x + Math.cos(w.rot) * reach, y + Math.sin(w.rot) * reach);
        w.prop.rotation = w.rot;
        w.prop.alpha = w.fade;
      }
      w.lamp.position.set(x, y);
      w.lamp.rotation = w.rot;
      w.lamp.scale.set(2.2 * w.s.scale.x, 0.9 * w.s.scale.x);
      fade(w.lamp, lampDark * 0.35 * w.fade);
    }
  }
}
