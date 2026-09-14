import { Container, Sprite, Texture } from 'pixi.js';
import type { Compound } from './compound';
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
  phase: number; weave: number;
  brute: boolean; horde: number; // horde id (0 = lone zombie)
  dying: number;               // > 0 while falling
  color: number;
}

export interface ZombieHits { kills: Point[]; breaches: Point[] }

/**
 * Blocked traffic arrives as zombies from a bearing fixed by the remote IP;
 * IDS threats arrive as a brute leading a pack. Towers shoot them on approach;
 * the occasional one reaches the fence (a breach).
 */
export class Zombies {
  private list: Zombie[] = [];
  private hordeSeq = 0;
  unit = 1;

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
    this.add(angle, color, true, id, 0);
    const pack = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < pack; i++) this.add(angle + (Math.random() - 0.5) * 0.35, color, false, id, 0.4 + i * 0.25);
  }

  private add(angle: number, color: number, brute: boolean, horde: number, delay: number): void {
    const L = this.compound.L;
    const start = edgePoint(L.cx, L.cy, L.w, L.h, angle, 1.05);
    const end = wallPoint(L, start, 16 * L.unit);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const speed = (horde ? 58 : 40) * L.unit * (0.8 + Math.random() * 0.4);
    const s = new Sprite(this.tex.frame(Math.random() < 0.8 ? 'zombie' : 'zombie_stand'));
    s.anchor.set(0.45, 0.5);
    s.scale.set((brute ? 1.7 : 0.95 + Math.random() * 0.2) * L.unit);
    // sickly skin variety; brutes a paler, meaner green
    s.tint = brute ? 0xc8ff9a : [0xffffff, 0xd8f0c8, 0xe8e0c0, 0xc8e8d8][(Math.random() * 4) | 0];
    s.position.set(start.x, start.y);
    const eye = new Sprite(this.tex.glow);
    eye.anchor.set(0.5); eye.blendMode = 'add'; eye.tint = brute ? 0xff9a45 : 0xff3a2a;
    eye.scale.set((brute ? 0.34 : 0.2) * L.unit); fade(eye, 0);
    this.layer.addChild(s);
    this.lights.addChild(eye);
    const lone = !brute && horde === 0;
    this.list.push({
      s, eye, sx: start.x, sy: start.y, tx: end.x, ty: end.y,
      t: -delay * speed / Math.max(1, dist), dur: dist / speed,
      killAt: brute ? 0.82 + Math.random() * 0.12
        : lone ? (Math.random() < 0.88 ? 0.55 + Math.random() * 0.38 : null)
        : 0.5 + Math.random() * 0.45,
      phase: Math.random() * 10, weave: horde ? 22 : 6,
      brute, horde, dying: 0, color,
    });
  }

  /** Any horde brute still coming? (drives the alarm + threat audio) */
  underAttack(): boolean { return this.list.some((z) => z.brute && z.dying <= 0); }

  update(dt: number, darkness: number): ZombieHits {
    const hits: ZombieHits = { kills: [], breaches: [] };
    const L = this.compound.L;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      if (z.dying > 0) {
        z.dying -= dt;
        z.s.alpha = Math.max(0, z.dying / 0.7);
        z.s.rotation += dt * 2.5;
        fade(z.eye, 0);
        if (z.dying <= 0) { z.s.destroy(); z.eye.destroy(); this.list.splice(i, 1); }
        continue;
      }
      z.t += dt / z.dur;
      if (z.t < 0) { z.s.visible = false; continue; }
      z.s.visible = true;
      z.phase += dt * (z.brute ? 3 : 5);
      const ux = z.tx - z.sx, uy = z.ty - z.sy;
      const len = Math.hypot(ux, uy) || 1;
      const px = -uy / len, py = ux / len;          // perpendicular: shamble / weave
      const k = Math.min(1, z.t);
      const sway = Math.sin(z.phase * (z.horde ? 0.35 : 1)) * z.weave * L.unit * (1 - k * 0.6);
      const x = z.sx + ux * k + px * sway, y = z.sy + uy * k + py * sway;
      z.s.position.set(x, y);
      z.s.rotation = Math.atan2(uy, ux) + Math.sin(z.phase) * 0.12;
      z.eye.position.set(x + Math.cos(z.s.rotation) * 6 * L.unit, y + Math.sin(z.s.rotation) * 6 * L.unit);
      fade(z.eye, darkness * (0.55 + 0.25 * Math.sin(z.phase * 1.7)));

      if (z.killAt !== null && z.t >= z.killAt) {
        this.kill(z, { x, y }, z.brute ? 3 : 1);
        hits.kills.push({ x, y });
      } else if (z.t >= 1) {
        // reached the fence: a breach, then the wall guns finish it
        hits.breaches.push({ x, y });
        this.fx.emit(x, y, 0xc9b48a, 10, 60, 0.22, 0.6);     // dust off the fence
        this.kill(z, { x, y }, z.brute ? 3 : 1);
        hits.kills.push({ x, y });
      }
    }
    return hits;
  }

  private kill(z: Zombie, p: Point, bursts: number): void {
    // brutes draw fire from the two closest towers; a walker from the nearest
    const byDistance = this.compound.towers
      .map((t, i) => ({ i, d: Math.hypot(t.base.x - p.x, t.base.y - p.y) }))
      .sort((a, b) => a.d - b.d);
    const shooters = byDistance.slice(0, z.brute ? 2 : 1).map((x) => x.i);
    for (const i of shooters) {
      for (let b = 0; b < bursts; b++) {
        const muzzle = this.compound.aim(i, p);
        const jx = p.x + (Math.random() - 0.5) * 10, jy = p.y + (Math.random() - 0.5) * 10;
        this.fx.tracer(muzzle.x, muzzle.y, jx, jy);
        this.fx.flash(muzzle.x, muzzle.y);
      }
    }
    this.fx.emit(p.x, p.y, BLOOD, z.brute ? 26 : 12, z.brute ? 120 : 80, 0.2, 0.55);
    this.fx.emit(p.x, p.y, z.color, z.brute ? 10 : 4, 60, 0.16, 0.4);
    this.fx.splat(p.x, p.y, z.brute ? 1.8 : 1);
    if (z.brute) this.fx.ring(p.x, p.y, z.color, 110 * this.compound.L.unit, 3.5, 0.9);
    z.dying = 0.7;
  }
}

interface Walker {
  s: Sprite; prop: Sprite | null; lamp: Sprite;
  path: Point[]; seg: number; along: number;
  speed: number; color: number; trailGap: number; since: number;
  fade: number;                  // fade-in, then fade-out at the end
  exitFade: boolean;
  onDone?: (p: Point) => void;
  kind: string;
}

const SURVIVORS = ['survivor_a', 'survivor_b', 'survivor_c', 'survivor_d', 'survivor_e', 'survivor_f'] as const;

/** Survivors on the move: supply runs, couriers, new arrivals, building visits. */
export class Walkers {
  private list: Walker[] = [];

  constructor(private layer: Container, private lights: Container, private tex: ZTextures, private fx: Fx) {}

  count(kind?: string): number { return kind ? this.list.filter((w) => w.kind === kind).length : this.list.length; }

  walk(kind: string, path: Point[], opts: {
    speed: number; color: number; carry?: boolean; trail?: boolean;
    exitFade?: boolean; onDone?: (p: Point) => void; unit: number; texture?: Texture;
  }): void {
    if (path.length < 2) return;
    const s = new Sprite(opts.texture ?? this.tex.frame(opts.carry ? 'carrier' : SURVIVORS[(Math.random() * SURVIVORS.length) | 0]));
    s.anchor.set(0.4, 0.5);
    s.scale.set(0.85 * opts.unit);
    s.position.set(path[0].x, path[0].y);
    s.alpha = 0;
    let prop: Sprite | null = null;
    if (opts.carry) {
      prop = new Sprite(this.tex.frame('crate_small'));
      prop.anchor.set(0.5);
      prop.scale.set(0.55 * opts.unit);
      this.layer.addChild(prop);
    }
    const lamp = new Sprite(this.tex.glow);
    lamp.anchor.set(0.05, 0.5); lamp.blendMode = 'add'; lamp.tint = 0xfff3d0; fade(lamp, 0);
    this.layer.addChild(s);
    this.lights.addChild(lamp);
    this.list.push({
      s, prop, lamp, path, seg: 0, along: 0, speed: opts.speed, color: opts.color,
      trailGap: opts.trail ? 16 * opts.unit : 0, since: 0, fade: 0,
      exitFade: opts.exitFade ?? true, onDone: opts.onDone, kind,
    });
  }

  update(dt: number, darkness: number, flashlights = true): void {
    const lampDark = flashlights ? darkness : 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      const done = w.seg >= w.path.length - 1;
      if (done) {
        w.fade -= dt * 2.5;
        w.s.alpha = Math.max(0, w.fade);
        if (w.prop) w.prop.alpha = w.s.alpha;
        fade(w.lamp, w.s.alpha * lampDark * 0.35);
        if (w.fade <= 0) {
          w.s.destroy(); w.prop?.destroy(); w.lamp.destroy();
          this.list.splice(i, 1);
        }
        continue;
      }
      w.fade = Math.min(1, w.fade + dt * 3);
      w.s.alpha = w.fade;
      const a = w.path[w.seg], b = w.path[w.seg + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      w.along += w.speed * dt;
      w.since += w.speed * dt;
      if (w.along >= segLen) {
        w.along -= segLen;
        w.seg++;
        if (w.seg >= w.path.length - 1) {
          w.s.position.set(b.x, b.y);
          w.onDone?.(b);
          if (!w.exitFade) w.fade = 0.01;
          continue;
        }
      }
      const f = w.along / segLen;
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      w.s.position.set(x, y);
      w.s.rotation = heading;
      if (w.prop) {
        w.prop.position.set(x + Math.cos(heading) * 16 * w.s.scale.x, y + Math.sin(heading) * 16 * w.s.scale.x);
        w.prop.rotation = heading;
        w.prop.alpha = w.fade;
      }
      w.lamp.position.set(x, y);
      w.lamp.rotation = heading;
      w.lamp.scale.set(2.2 * w.s.scale.x, 0.9 * w.s.scale.x);
      fade(w.lamp, lampDark * 0.35 * w.fade);
      if (w.trailGap && w.since >= w.trailGap) {
        w.since = 0;
        this.fx.emit(x, y, w.color, 1, 4, 0.1, 1.4);
      }
    }
  }
}
