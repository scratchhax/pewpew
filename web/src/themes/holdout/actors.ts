import { Container, Sprite } from 'pixi.js';
import { angleDelta, type Compound } from './compound';
import { fade, type Fx } from './fx';
import type { ZTextures } from './textures';
import { Point, wallPoint } from './layout';
import { edgePoint } from '../../state';

const BLOOD = 0x9a1010;

interface Zombie {
  s: Sprite; eye: Sprite;
  sx: number; sy: number; tx: number; ty: number;
  t: number; dur: number;
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
  maxCorpses = 20;

  constructor(private layer: Container, private lights: Container, private tex: ZTextures,
              private compound: Compound, private fx: Fx) {}

  count(): number { return this.list.filter((z) => !z.brute && z.horde === 0 && z.dying <= 0).length; }
  hordes(): number { return new Set(this.list.filter((z) => z.brute && z.dying <= 0).map((z) => z.horde)).size; }

  spawn(angle: number, color: number): void {
    this.add(angle, color, false, 0, 0);
  }

  /** A brute plus a pack, weaving in on one bearing. */
  spawnHorde(angle: number, color: number): void {
    const id = ++this.hordeSeq;
    this.add(angle, color, true, id, 0, false);
    const pack = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < pack; i++) this.add(angle + (Math.random() - 0.5) * 0.35, color, false, id, 0.4 + i * 0.25, false);
  }

  /** A sprinter: fast, not stopped by towers, breaches and bashes a building. */
  spawnSprinter(angle: number, color: number): void {
    this.add(angle, color, false, 0, 0, true);
  }

  private add(angle: number, color: number, brute: boolean, horde: number, delay: number, sprinter = false): void {
    const L = this.compound.L;
    const start = edgePoint(L.cx, L.cy, L.w, L.h, angle, 1.05);
    const end = wallPoint(L, start, 16 * L.unit);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const speed = (sprinter ? 130 : horde ? 58 : 40) * L.unit * (0.85 + Math.random() * 0.3);
    const s = new Sprite(this.tex.frame(sprinter ? 'zombie_stand' : (Math.random() < 0.8 ? 'zombie' : 'zombie_stand')));
    s.anchor.set(0.45, 0.5);
    s.scale.set((brute ? 1.7 : sprinter ? 0.8 : 0.95 + Math.random() * 0.2) * L.unit);
    // sickly skin variety; brutes a paler, meaner green; sprinters a more yellow, feverish tint
    s.tint = brute ? 0xc8ff9a : sprinter ? 0xd8e8a0 : [0xffffff, 0xd8f0c8, 0xe8e0c0, 0xc8e8d8][(Math.random() * 4) | 0];
    s.position.set(start.x, start.y);
    s.rotation = Math.atan2(end.y - start.y, end.x - start.x);
    const eye = new Sprite(this.tex.glow);
    eye.anchor.set(0.5); eye.blendMode = 'add'; eye.tint = sprinter ? 0xffcc00 : brute ? 0xff9a45 : 0xff3a2a;
    eye.scale.set((brute ? 0.34 : 0.2) * L.unit); fade(eye, 0);
    this.layer.addChild(s);
    this.lights.addChild(eye);
    const lone = !brute && horde === 0 && !sprinter;
    this.list.push({
      s, eye, sx: start.x, sy: start.y, tx: end.x, ty: end.y,
      t: -delay * speed / Math.max(1, dist), dur: dist / speed,
      killAt: sprinter ? null
        : brute ? 0.82 + Math.random() * 0.12
        : lone ? (Math.random() < 0.88 ? 0.55 + Math.random() * 0.38 : null)
        : 0.5 + Math.random() * 0.45,
      phase: Math.random() * 10, weave: sprinter ? 10 : horde ? 22 : 6,
      brute, horde, sprinter, dying: 0, seen: 0, watched: false, shot: false,
      baseScale: s.scale.x, fallFrom: 0, fallDir: 1, color,
      breached: false, targetBuilding: { x: L.cx, y: L.cy }, bangs: 0, bangT: 0,
      intercepted: false,
    });
  }

  /** Any horde brute still coming? (drives the alarm + threat audio) */
  underAttack(): boolean { return this.list.some((z) => z.brute && z.dying <= 0); }

  /** Where every zombie is, fallen ones included (survivors step around them). */
  positions(): Point[] {
    return this.list.filter((z) => z.t >= 0).map((z) => ({ x: z.s.x, y: z.s.y }));
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
        fade(z.eye, z.eye.alpha * Math.max(0, 1 - dt * 3));   // eyes dim out, not cut
        if (z.dying <= 0) {
          // leave a dark corpse on the ground
          this.addCorpse(z.s.x, z.s.y, z.s.rotation, z.baseScale);
          z.s.destroy(); z.eye.destroy();
          this.list.splice(i, 1);
        }
        continue;
      }
      z.t += dt / z.dur;
      if (z.t < 0) { z.s.visible = false; continue; }
      z.s.visible = true;
      z.seen += dt;
      z.s.alpha = Math.min(1, z.seen / 0.8);
      const ux = z.tx - z.sx, uy = z.ty - z.sy;
      const len = Math.hypot(ux, uy) || 1;
      const px = -uy / len, py = ux / len;
      const k = Math.min(1, z.t);
      // one shamble per two beats; a horde weaves slower, a brute slowest of all
      const step = beat * Math.PI * (z.brute ? 0.6 : z.sprinter ? 1.6 : 1) + z.phase;
      const sway = Math.sin(beat * Math.PI * (z.brute ? 0.25 : z.sprinter ? 1.4 : z.horde ? 0.4 : 1) + z.phase) * z.weave * L.unit * (1 - k * 0.6);
      const x = z.sx + ux * k + px * sway, y = z.sy + uy * k + py * sway;
      z.s.position.set(x, y);
      z.s.rotation = Math.atan2(uy, ux) + Math.sin(step) * 0.12;
      z.eye.position.set(x + Math.cos(z.s.rotation) * 6 * L.unit, y + Math.sin(z.s.rotation) * 6 * L.unit);
      fade(z.eye, darkness * 0.45 * Math.min(1, z.seen / 1.5));
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
      // a zombie closing on a VULNERABLE walker intercepts (kills the walker, keeps going)
      if (!z.intercepted) {
        const nearVuln = vulnerable.some((p) => Math.hypot(p.x - x, p.y - y) < cover);
        if (nearVuln) {
          this.onWalkIntercept?.(x, y);
          z.intercepted = true;
        }
      }

      if (threatening || (z.killAt !== null && z.t >= z.killAt)) {
        this.kill(z, { x, y }, z.brute ? 3 : 1);
        hits.kills.push({ x, y });
      } else if (z.t >= 1) {
        if (z.sprinter) {
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
            // at the person: kill them
            const dx = z.tx - x, dy = z.ty - y;
            const dist = Math.hypot(dx, dy);
            if (dist < 18 * this.compound.L.unit) {
              this.onWalkIntercept?.(x, y);
              this.kill(z, { x, y }, 1);
              hits.kills.push({ x, y });
            }
          }
        } else {
          // regular breach: wall guns finish it
          hits.breaches.push({ x, y });
          this.fx.emit(x, y, 0xc9b48a, 6, 40, 0.22, 0.8);
          this.kill(z, { x, y }, z.brute ? 3 : 1);
          hits.kills.push({ x, y });
        }
      }
    }
    return hits;
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

  private hit(z: Zombie, x: number, y: number): void {
    if (z.dying > 0) return;
    this.fx.emit(x, y, BLOOD, z.brute ? 8 : 4, z.brute ? 70 : 45, 0.18, 0.6);
    this.fx.splat(x, y, z.brute ? 1.8 : 1);
    if (z.brute) this.fx.ring(x, y, z.color, 110 * this.compound.L.unit, 3.5, 0.9);
    z.dying = 0.9;
    z.fallFrom = z.s.rotation;
    z.fallDir = Math.random() < 0.5 ? -1 : 1;
  }

  private addCorpse(x: number, y: number, rot: number, scale: number): void {
    if (this.corpses.length >= this.maxCorpses) {
      const old = this.corpses.shift()!;
      old.s.destroy();
    }
    const s = new Sprite(this.tex.frame('zombie'));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.rotation = rot + Math.PI / 2;
    s.scale.set(scale * 0.7);
    s.tint = 0x3a3a2a;
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

  /** A zombie reached a vulnerable walker: topple + blood + callback. */
  killWalker(w: Walker): void {
    w.dead = 0.9;
    w.s.rotation += 0.4;
    this.fx?.emit(w.s.x, w.s.y, BLOOD, 6, 50, 0.2, 0.6);
    this.fx?.splat(w.s.x, w.s.y, 1);
    this.onWalkedKilled?.(w.s.x, w.s.y);
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
        // dying: topple and fade
        w.dead -= dt;
        w.s.rotation += dt * 2.5;
        w.s.alpha = Math.max(0, w.dead / 0.9);
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
