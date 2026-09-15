import { Container, Sprite, type Texture } from 'pixi.js';
import { TILE, type Art, type BotFrames } from './art';
import { P, pixelText } from './pixels';
import type { Course } from './world';

/**
 * Everything that moves in Packet Rush: the courier bot and its rivals (with
 * the autoplay planner), crawlers and hoppers, gems, query blocks, brick
 * walls, checkpoint flags, the hunter drone and its bombs, power-ups, and the
 * little particles and pop-up texts. Units are world pixels; y grows down.
 */

// ── physics ──
const G = 900;            // gravity (px/s²)
const JUMP = 330;         // full jump
const HOP = 235;          // short hop
const DOUBLE = 290;       // the second jump
const FALL_MAX = 460;
const HALF = 5;           // runner half-width
const HEIGHT = 17;        // runner height
/** The planner only trusts a landing with the runner's middle over solid ground (real feet are wider, so it never comes up short). */
const PLAN_HALF = 1.5;

type Power = 'shoe' | 'magnet' | 'shield';

export interface RunStats { gems: number; stomps: number; queries: number; bricks: number; flags: number; hurts: number; rescues: number; bosses: number }

interface Runner {
  art: BotFrames;
  sprite: Sprite;
  x: number; y: number; vy: number;
  speed: number;
  grounded: boolean;
  usedDouble: boolean;
  doubleAt: number;        // seconds until a planned double jump (-1: none)
  anim: number;
  planT: number;
  name?: Sprite;
  label?: string;
  // rivals
  life?: number;
  phase?: number;
  side?: number;
}

interface Enemy { kind: 'crawler' | 'hopper' | 'orb'; sprite: Sprite; x: number; y: number; vx: number; vy: number; grounded: boolean; squash: number; hopT: number; anim: number }
interface Gem { sprite: Sprite; x: number; y: number; vx: number; vy: number; free: boolean; delay: number; t: number }
interface Query { sprite: Sprite; x: number; y: number; used: boolean; bump: number; domain: string }
interface Brick { sprite: Sprite; x: number; y: number }
interface Flag { pole: Sprite; flag: Sprite; label: Sprite | null; x: number; base: number; good: boolean; raised: number; passed: boolean; name: string }
interface Item { sprite: Sprite; kind: Power; x: number; y: number; vy: number; grounded: boolean }
interface Bomb { sprite: Sprite; x: number; y: number; vx: number; vy: number; fuse: number }
interface Blast { x: number; y: number; t: number }
/** The boss mech: hovers ahead, slams down (that's when it can be stomped), rolls packet orbs at us. */
interface Boss {
  sprite: Sprite; label: Sprite; name: string;
  x: number; hover: number; hoverTarget: number; ground: number;
  hp: number; max: number; inv: number; t: number; slamT: number; low: number;
  phase: 'enter' | 'fight' | 'leave';
}
interface Bit { sprite: Sprite; x: number; y: number; vx: number; vy: number; life: number; max: number; g: number; fade: boolean }
interface Pop { sprite: Sprite; x: number; y: number; t: number; max: number; rise: number }

export class Actors {
  hero: Runner;
  stats: RunStats = { gems: 0, stomps: 0, queries: 0, bricks: 0, flags: 0, hurts: 0, rescues: 0, bosses: 0 };
  /** How often runners re-plan (per second); lower on small devices. */
  planRate = 20;
  /** Things the theme hears about (sounds): set by the theme. */
  onSfx: (name: string, x: number) => void = () => {};

  maxEnemies = 10;
  maxGems = 140;
  maxBits = 400;

  private rivals: Runner[] = [];
  private enemies: Enemy[] = [];
  private gems: Gem[] = [];
  private queries: Query[] = [];
  private bricks: Brick[] = [];
  private flags: Flag[] = [];
  private items: Item[] = [];
  private bombs: Bomb[] = [];
  private blasts: Blast[] = [];
  private bits: Bit[] = [];
  private pops: Pop[] = [];
  private trails: Array<{ sprite: Sprite; t: number }> = [];
  private drone: { sprite: Sprite; x: number; y: number; wanted: number; bombT: number; on: boolean };
  private shieldSprite: Sprite;

  private hurt = 0;
  private powers: Record<Power, number> = { shoe: 0, magnet: 0, shield: 0 };
  private trailT = 0;
  private gemQueueOut = 0;
  private gemQueueIn = 0;
  private gemT = 0;
  private camX = 0;
  private vw = 400;

  constructor(private layers: { back: Container; mid: Container; front: Container; ui: Container },
              private art: Art, private course: Course) {
    this.hero = this.runner(art.hero, 40);
    this.drone = { sprite: new Sprite(art.drone), x: 0, y: -40, wanted: 0, bombT: 0, on: false };
    this.drone.sprite.anchor.set(0.5, 0.5);
    this.drone.sprite.visible = false;
    layers.front.addChild(this.drone.sprite);
    this.shieldSprite = new Sprite(art.shield);
    this.shieldSprite.anchor.set(0.5, 0.5);
    this.shieldSprite.visible = false;
    layers.front.addChild(this.shieldSprite);
  }

  private runner(frames: BotFrames, x: number): Runner {
    const sprite = new Sprite(frames.run[0]);
    sprite.anchor.set(0.5, 1);
    this.layers.mid.addChild(sprite);
    return { art: frames, sprite, x, y: this.course.groundTop(Math.floor(x / TILE)), vy: 0, speed: 120, grounded: true, usedDouble: false, doubleAt: -1, anim: 0, planT: 0 };
  }

  get turbo(): boolean { return this.powers.shoe > 0; }
  /** Pick who runs (the courier bot, the hacker cat or the ghost). */
  setHero(frames: BotFrames): void { this.hero.art = frames; }
  /** A burst of traffic: a moment of turbo (trails and all). */
  boost(seconds: number): void { this.powers.shoe = Math.max(this.powers.shoe, seconds); }
  get heroSpeedBonus(): number { return this.powers.shoe > 0 ? 55 : 0; }
  counts() { return { enemies: this.enemies.length, gems: this.gems.length, rivals: this.rivals.length, bits: this.bits.length }; }

  // ── spawns (from events) ──
  private spawnX(extra = 0): number { return this.camX + this.vw + 12 + extra; }

  /** A column at or after x with ground (not a pit), and its top. */
  private solidAhead(x: number): { x: number; top: number } {
    for (let col = Math.floor(x / TILE); col < Math.floor(x / TILE) + 30; col++) {
      const top = this.course.groundTop(col);
      if (top !== Infinity && this.course.heightAt(col + 1) > 0) return { x: col * TILE + TILE / 2, top };
    }
    return { x, top: this.course.vh - 3 * TILE };
  }

  /** Allowed traffic: gems. Outbound ones wait ahead; inbound ones fly in from behind. */
  gem(inbound: boolean): void {
    if (inbound) this.gemQueueIn = Math.min(40, this.gemQueueIn + 1);
    else this.gemQueueOut = Math.min(40, this.gemQueueOut + 1);
  }

  /** A blocked connection: a baddie on the course ahead. */
  baddie(hop: boolean): boolean {
    if (this.enemies.length >= this.maxEnemies) return false;
    const spot = this.solidAhead(this.spawnX(Math.random() * 60));
    const e: Enemy = {
      kind: hop ? 'hopper' : 'crawler', sprite: new Sprite(hop ? this.art.hopper[0] : this.art.crawler[0]),
      x: spot.x, y: spot.top, vx: hop ? -18 : -26, vy: 0, grounded: true, squash: 0, hopT: 0.5 + Math.random(), anim: Math.random(),
    };
    e.sprite.anchor.set(0.5, 1);
    this.layers.mid.addChild(e.sprite);
    this.enemies.push(e);
    return true;
  }

  /** A burst of blocks: a brick wall to smash through. */
  wall(): void {
    if (this.bricks.length > 12) return;
    const spot = this.solidAhead(this.spawnX(30));
    const tall = 2 + (Math.random() < 0.4 ? 1 : 0);
    const x = Math.floor(spot.x / TILE) * TILE;
    for (let k = 0; k < tall; k++) {
      const sprite = new Sprite(this.art.brick);
      this.layers.mid.addChild(sprite);
      this.bricks.push({ sprite, x, y: spot.top - (k + 1) * TILE });
    }
  }

  /** A DNS lookup: a query block to headbutt, which pops the domain and a power-up. */
  query(domain: string): void {
    if (this.queries.filter((q) => !q.used).length >= 3) return;
    const spot = this.solidAhead(this.spawnX(20));
    const col = Math.floor(spot.x / TILE);
    if (this.course.ledgeAt(col) > 0) return;
    const sprite = new Sprite(this.art.query);
    sprite.anchor.set(0.5, 1);
    this.layers.mid.addChild(sprite);
    this.queries.push({ sprite, x: col * TILE + TILE / 2, y: spot.top - 48, used: false, bump: 0, domain });
  }

  /** A DHCP lease: a rival runner with the device's name drops in and races us. */
  rival(name: string): void {
    const existing = this.rivals.find((r) => r.label === name);
    if (existing) { existing.life = Math.max(existing.life ?? 0, 5); return; }
    if (this.rivals.length >= 2) return;
    const r = this.runner(this.art.rival, this.camX - 20);
    r.y = this.course.vh - 8 * TILE; r.grounded = false;
    r.speed = this.hero.speed + 90;
    r.life = 7; r.phase = 0; r.side = this.rivals.length ? -1 : 1;
    const tag = new Sprite(pixelText(name.slice(0, 16), P.sand));
    tag.anchor.set(0.5, 1);
    this.layers.ui.addChild(tag);
    r.name = tag;
    r.label = name;
    this.rivals.push(r);
  }

  /** Wi-Fi: a checkpoint antenna flag, raised with the AP's name on a join, broken on a failure. */
  flag(name: string, good: boolean): void {
    if (this.flags.length >= 3) return;
    const spot = this.solidAhead(this.spawnX(40));
    const pole = new Sprite(this.art.flagPole);
    pole.anchor.set(0.5, 1);
    const flag = new Sprite(good ? this.art.flag : this.art.flagBroken);
    this.layers.back.addChild(pole, flag);
    let label: Sprite | null = null;
    if (good) {
      label = new Sprite(pixelText(name.slice(0, 16), '#c08cff'));
      label.anchor.set(0.5, 1);
      label.alpha = 0;
      this.layers.ui.addChild(label);
    }
    if (!good) pole.rotation = 0.28;
    this.flags.push({ pole, flag, label, x: spot.x, base: spot.top, good, raised: 0, passed: false, name });
  }

  /** An IDS threat: the hunter drone comes after us (and stays while the heat lasts). */
  hunt(): void {
    this.drone.wanted = Math.max(this.drone.wanted, 10);
    if (!this.drone.on) {
      this.drone.on = true;
      this.drone.x = this.camX + this.vw + 30; this.drone.y = -20;
      this.drone.bombT = 1.2;
      this.drone.sprite.visible = true;
    }
  }
  get hunted(): boolean { return this.drone.on && this.drone.wanted > 0; }

  /** The power-up running now (the one with the most time left), for the item box. */
  activePower(): { kind: Power; left: number; max: number } | null {
    let best: { kind: Power; left: number; max: number } | null = null;
    for (const k of Object.keys(this.powers) as Power[]) {
      const left = this.powers[k];
      if (left > 0 && (!best || left > best.left)) best = { kind: k, left, max: k === 'shoe' ? 6 : k === 'magnet' ? 9 : 12 };
    }
    return best;
  }

  /** Where things are on the course, for the dash's mini-map. */
  mapInfo() {
    return {
      heroX: this.hero.x,
      enemies: this.enemies.filter((e) => e.squash <= 0).map((e) => e.x),
      flags: this.flags.map((f) => f.x),
      queries: this.queries.filter((q) => !q.used).map((q) => q.x),
      rivals: this.rivals.map((r) => r.x),
    };
  }

  // ── the planner ──
  /**
   * Fly a jump plan forward and score it: landing safely, stomping baddies,
   * grabbing gems, bumping query blocks and power-ups are good; pits, walls,
   * side hits and bombs are bad. `delay` = when to jump (s), `power` = jump
   * velocity (0 = don't jump), `double` = when to use the second jump after
   * leaving the ground (-1 = don't).
   */
  private simulate(r: Runner, delay: number, power: number, double: number, avoid: boolean): number {
    const course = this.course, DT = 1 / 50, H = 1.35;
    let x = r.x, y = r.y, vy = r.vy, grounded = r.grounded, jumped = !power, usedDouble = r.usedDouble, jumpedAt = 0, air = !r.grounded, landT = -1;
    let score = 0;
    const taken = new Set<unknown>();
    for (let t = DT; t <= H; t += DT) {
      if (!jumped && grounded && t >= delay) { vy = -power; grounded = false; jumped = true; jumpedAt = t; }
      if (double >= 0 && jumped && !usedDouble && !grounded && t >= jumpedAt + double) { vy = -DOUBLE; usedDouble = true; }
      const nx = x + r.speed * DT;
      if (course.wall(nx + PLAN_HALF, y)) return score - 600;          // ran into a step
      const lip = vy >= 0 ? course.stepUp(nx + PLAN_HALF, y) : null;
      if (lip !== null) { y = lip; vy = 0; if (!grounded && air) return score + 100; grounded = true; }
      let ny = y;
      if (grounded) {
        if (!course.standing(nx - PLAN_HALF, nx + PLAN_HALF, y)) grounded = false;
      }
      if (!grounded) {
        vy = Math.min(FALL_MAX, vy + G * DT);
        ny = y + vy * DT;
        if (vy >= 0) {
          const land = course.landing(nx - PLAN_HALF, nx + PLAN_HALF, y, ny);
          if (land !== null) { ny = land; vy = 0; grounded = true; usedDouble = false; }
        }
      }
      if (!grounded) air = true;
      x = nx; y = ny;
      if (y > course.vh + 12) return score - 1200;                     // into a pit
      // down safely after being in the air: look a moment past the landing (a baddie right there?), then
      // what comes next is the next plan's job
      if (grounded && air && t > DT && landT < 0) landT = t;
      if (landT >= 0 && t >= landT + 0.3) return score + 100;
      if (!avoid) continue;
      // baddies: from above is a stomp, from the side is a hit
      for (const e of this.enemies) {
        if (e.squash > 0 || taken.has(e)) continue;
        const ex = e.x + e.vx * t;
        if (Math.abs(ex - x) > HALF + 6 || y < e.y - 14 - 2 || y - HEIGHT > e.y) continue;
        if (y < e.y - 7) { if (vy > -60) { score += 140; taken.add(e); vy = -260; grounded = false; } }   // above its middle: a stomp (or just clear)
        else if (this.hurt <= 0 && this.powers.shield <= 0) { score -= 320; taken.add(e); }
      }
      for (const g of this.gems) {
        if (taken.has(g) || Math.abs(g.x - x) > 9 || Math.abs(g.y - (y - 8)) > 12) continue;
        score += 14; taken.add(g);
      }
      for (const q of this.queries) {
        if (q.used || taken.has(q) || Math.abs(q.x - x) > 10) continue;
        if (vy < 0 && y - HEIGHT <= q.y + 2 && y - HEIGHT >= q.y - 10) { score += 110; taken.add(q); vy = 40; }
      }
      for (const it of this.items) {
        if (taken.has(it) || Math.abs(it.x - x) > 10 || Math.abs(it.y - (y - 8)) > 14) continue;
        score += 60; taken.add(it);
      }
      for (const b of this.bombs) {
        const land = this.bombLanding(b);
        if (!land) continue;
        const bt = land.t + b.fuse;
        if (Math.abs(bt - t) < 0.25 && Math.abs(land.x - x) < 20 && y > land.y - 22) { score -= 300; break; }
      }
      const boss = this.boss;
      if (boss && boss.phase === 'fight' && boss.inv <= 0 && !taken.has(boss)) {
        // the boss holds still while it's low; aim to land on its dome
        const bx = boss.low > 0 ? boss.x : boss.x + r.speed * t;
        const top = boss.ground - boss.hover - 26;
        if (Math.abs(bx - x) < 15 && y > top - 4 && y - HEIGHT < boss.ground - boss.hover) {
          if (vy > 0 && y < top + 8) { score += 320; taken.add(boss); vy = -300; grounded = false; }
          else if (this.hurt <= 0 && this.powers.shield <= 0) { score -= 360; taken.add(boss); }
        }
      }
      for (const bl of this.blasts) {
        if (t < 0.3 && Math.abs(bl.x - x) < 20 && y > bl.y - 22) score -= 200;
      }
    }
    if (landT >= 0) return score + 100;
    // still in the air at the end: fine if there's ground under us
    if (!grounded && course.groundTop(Math.floor(x / TILE)) === Infinity) score -= 250;
    return score;
  }

  private bombLanding(b: Bomb): { x: number; y: number; t: number } | null {
    let x = b.x, y = b.y, vy = b.vy, t = 0;
    if (b.fuse < 9) return { x, y, t: 0 };   // already down, fuse burning
    for (; t < 1.5; t += 1 / 30) {
      vy += G * 0.6 / 30; x += b.vx / 30; const ny = y + vy / 30;
      const top = this.course.groundTop(Math.floor(x / TILE));
      if (ny >= top) return { x, y: top, t };
      y = ny;
    }
    return null;
  }

  private plan(r: Runner, avoid: boolean): void {
    let best = this.simulate(r, 0, 0, -1, avoid) + 8, bestPlan: [number, number, number] | null = null;
    if (r.grounded) {
      for (const delay of [0, 0.07, 0.15, 0.25, 0.38]) {
        for (const power of [HOP, JUMP]) {
          for (const double of [-1, 0.3, 0.42]) {
            // the least jump that works: a second jump costs, so gems alone never tempt a long, risky flight
            const s = this.simulate(r, delay, power, double, avoid) - (power === JUMP ? 4 : 0) - (double >= 0 ? 35 : 0) - delay * 4;
            if (s > best) { best = s; bestPlan = [delay, power, double]; }
          }
        }
      }
      if (bestPlan && bestPlan[0] === 0) {
        r.vy = -bestPlan[1]; r.grounded = false;
        r.doubleAt = bestPlan[2];
        this.onSfx(r === this.hero ? 'jump' : 'rivalJump', r.x);
      }
    } else if (!r.usedDouble && r.vy > -60) {
      // airborne: use the second jump if it saves us
      const now = this.simulate(r, 0, 0, 0, avoid);
      if (now > best + 40) { r.vy = -DOUBLE; r.usedDouble = true; this.onSfx('double', r.x); }
    }
  }

  // ── update ──
  update(dt: number, t: number, heroSpeed: number, camX: number, vw: number): void {
    this.camX = camX; this.vw = vw;
    const course = this.course, hero = this.hero;
    hero.speed = heroSpeed;
    for (const k of Object.keys(this.powers) as Power[]) this.powers[k] = Math.max(0, this.powers[k] - dt);
    this.hurt = Math.max(0, this.hurt - dt);

    this.stepRunner(hero, dt, true);
    for (const r of this.rivals) this.driveRival(r, dt);
    this.rivals = this.rivals.filter((r) => {
      if (r.x < camX + vw + 60 || (r.phase ?? 0) < 2) return true;
      r.sprite.destroy(); r.name?.destroy({ texture: true, textureSource: true }); return false;
    });

    this.updateEnemies(dt);
    this.updateGems(dt, t);
    this.updateQueries(dt);
    this.updateBricks();
    this.updateFlags(dt);
    this.updateItems(dt);
    this.updateDrone(dt, t);
    this.updateBoss(dt);
    this.updateBits(dt);
    this.updateTrails(dt);

    // the shield bubble breathes (never blinks)
    this.shieldSprite.visible = this.powers.shield > 0;
    if (this.shieldSprite.visible) {
      this.shieldSprite.position.set(Math.round(hero.x), Math.round(hero.y - 9));
      this.shieldSprite.alpha = 0.55 + 0.35 * Math.sin(t * 5) * Math.min(1, this.powers.shield);
    }
    // after a hit: a soft see-through shimmer
    hero.sprite.alpha = this.hurt > 0 ? 0.55 + 0.3 * Math.sin(t * 9) : 1;

    // fell in anyway: pop back out of the pit
    if (hero.y > course.vh + 14) {
      hero.vy = -430; hero.usedDouble = false; hero.y = course.vh + 6;
      this.stats.rescues++;
      this.burst(hero.x, course.vh - 4, P.cyan, 14, 90);
      this.onSfx('rescue', hero.x);
    }

    // speed trails with the shoes
    this.trailT -= dt;
    if (this.powers.shoe > 0 && this.trailT <= 0) {
      this.trailT = 0.05;
      const s = new Sprite(hero.sprite.texture);
      s.anchor.set(0.5, 1); s.position.copyFrom(hero.sprite.position); s.tint = 0x73eff7; s.alpha = 0.45;
      this.layers.back.addChild(s);
      this.trails.push({ sprite: s, t: 0 });
    }
  }

  private stepRunner(r: Runner, dt: number, isHero: boolean): void {
    const course = this.course;
    r.planT -= dt;
    if (r.planT <= 0) { r.planT = (r.grounded ? 1 : 2) / this.planRate; this.plan(r, isHero); }
    if (r.doubleAt >= 0) {
      r.doubleAt -= dt;
      // the planned second jump: only if it still beats coming down where we are
      if (r.doubleAt < 0 && !r.grounded && !r.usedDouble && this.simulate(r, 0, 0, 0, isHero) >= this.simulate(r, 0, 0, -1, isHero) - 20) {
        r.vy = -DOUBLE; r.usedDouble = true; this.onSfx('double', r.x);
      }
    }
    const nx = r.x + r.speed * dt;
    // arriving a few pixels below a ledge's top: step up onto it
    const lip = r.vy >= 0 ? course.stepUp(nx + HALF, r.y) : null;
    if (lip !== null) { r.y = lip; r.vy = 0; if (!r.grounded) { r.grounded = true; r.usedDouble = false; r.doubleAt = -1; } }
    if (course.wall(nx + HALF, r.y)) {
      // a step we didn't plan for: hop it rather than ever stopping
      if (r.grounded) { r.vy = -JUMP; r.grounded = false; }
      r.x = Math.floor((nx + HALF) / TILE) * TILE - HALF - 0.01;
    } else {
      r.x = nx;
    }
    if (r.grounded && !course.standing(r.x - HALF, r.x + HALF, r.y)) r.grounded = false;
    if (!r.grounded) {
      r.vy = Math.min(FALL_MAX, r.vy + G * dt);
      const ny = r.y + r.vy * dt;
      const land = r.vy >= 0 ? course.landing(r.x - HALF, r.x + HALF, r.y, ny) : null;
      if (land !== null) {
        r.y = land; r.vy = 0; r.grounded = true; r.usedDouble = false; r.doubleAt = -1;
        if (isHero) this.onSfx('land', r.x);
      } else r.y = ny;
    }
    // animation
    r.anim += dt * (r.speed / 16);
    r.sprite.texture = !r.grounded ? (r.vy < 0 ? r.art.jump : r.art.fall) : r.art.run[Math.floor(r.anim) % 4];
    r.sprite.position.set(Math.round(r.x), Math.round(r.y) + 1);
    if (r.name) r.name.position.set(Math.round(r.x), Math.round(r.y - HEIGHT - 4));
  }

  private driveRival(r: Runner, dt: number): void {
    const hero = this.hero;
    r.life = (r.life ?? 0) - dt;
    if (r.phase === 0) { r.speed = hero.speed + 90; if (r.x > hero.x - 30 + (r.side ?? 1) * 20) r.phase = 1; }
    else if (r.phase === 1) {
      const target = hero.x + (r.side ?? 1) * 26;
      r.speed = hero.speed + (target - r.x) * 1.5;
      if ((r.life ?? 0) <= 0) { r.phase = 2; this.onSfx('rivalDash', r.x); }
    } else r.speed = hero.speed + 150;
    this.stepRunner(r, dt, false);
  }

  private updateEnemies(dt: number): void {
    const course = this.course, hero = this.hero;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.squash > 0) {
        e.squash -= dt;
        e.sprite.alpha = Math.min(1, e.squash * 2);
        if (e.squash <= 0) { e.sprite.destroy(); this.enemies.splice(i, 1); }
        continue;
      }
      e.anim += dt * 4;
      // walk; turn around at walls and (crawlers) at pit edges
      const nx = e.x + e.vx * dt;
      const ahead = nx + Math.sign(e.vx) * 7;
      if (e.kind === 'orb') e.x = nx;                          // orbs roll on regardless
      else if (course.wall(ahead, e.y) || (e.kind === 'crawler' && e.grounded && course.groundTop(Math.floor(ahead / TILE)) === Infinity) || this.brickAt(ahead, e.y - 4)) e.vx = -e.vx;
      else e.x = nx;
      if (e.kind === 'hopper' && e.grounded) {
        e.hopT -= dt;
        if (e.hopT <= 0) { e.vy = -210; e.grounded = false; e.hopT = 1 + Math.random() * 0.8; }
      }
      if (e.grounded && !course.standing(e.x - 5, e.x + 5, e.y)) e.grounded = false;
      if (!e.grounded) {
        e.vy = Math.min(FALL_MAX, e.vy + G * dt);
        const ny = e.y + e.vy * dt;
        const land = e.vy >= 0 ? course.landing(e.x - 5, e.x + 5, e.y, ny) : null;
        if (land !== null) { e.y = land; e.vy = 0; e.grounded = true; } else e.y = ny;
      }
      const frames = e.kind === 'orb' ? this.art.orb : e.kind === 'hopper' ? this.art.hopper : this.art.crawler;
      e.sprite.texture = frames[Math.floor(e.anim) % 2];
      e.sprite.scale.x = e.kind === 'orb' ? 1 : e.vx < 0 ? 1 : -1;
      e.sprite.position.set(Math.round(e.x), Math.round(e.y) + 1);
      if (e.y > course.vh + 20 || e.x < this.camX - 40) { e.sprite.destroy(); this.enemies.splice(i, 1); continue; }

      // contact with the hero (and rivals get to stomp too)
      for (const r of [hero, ...this.rivals]) {
        if (Math.abs(e.x - r.x) > HALF + 6 || r.y < e.y - 14 || r.y - HEIGHT > e.y) continue;
        // feet above its middle: a stomp on the way down, and no harm on the way up
        if (r.y < e.y - 7 && r.vy <= -60) continue;
        if (r.y < e.y - 7) {
          e.squash = 0.35;
          e.sprite.texture = e.kind === 'orb' ? this.art.orb[0] : e.kind === 'hopper' ? this.art.hopSquashed : this.art.squashed;
          r.vy = -270; r.grounded = false; r.usedDouble = false;
          if (r === hero) { this.stats.stomps++; this.onSfx('stomp', e.x); }
          this.burst(e.x, e.y - 4, P.white, 6, 60);
          break;
        } else if (r === hero && this.hurt <= 0) {
          if (this.powers.shield > 0) {
            this.powers.shield = 0;
            e.squash = 0.35; e.sprite.texture = e.kind === 'orb' ? this.art.orb[0] : e.kind === 'hopper' ? this.art.hopSquashed : this.art.squashed;
            this.burst(e.x, e.y - 6, P.cyan, 10, 80); this.onSfx('shieldPop', e.x);
          } else {
            this.hurtHero();
          }
          break;
        }
      }
    }
  }

  /** Hit: scatter some gems (they can be grabbed back) and shimmer for a moment. */
  private hurtHero(): void {
    const hero = this.hero;
    this.hurt = 1.3;
    this.stats.hurts++;
    const lose = Math.min(8, this.stats.gems);
    this.stats.gems -= lose;
    for (let k = 0; k < lose; k++) {
      const a = -Math.PI * (0.15 + 0.7 * (k / Math.max(1, lose - 1)));
      this.addGem(hero.x, hero.y - 10, Math.cos(a) * 90 + hero.speed * 0.6, Math.sin(a) * 220, true, 0.7);
    }
    this.onSfx('hurt', hero.x);
  }

  private addGem(x: number, y: number, vx: number, vy: number, free: boolean, delay = 0): void {
    if (this.gems.length >= this.maxGems) return;
    const sprite = new Sprite(this.art.gem[0]);
    sprite.anchor.set(0.5, 0.5);
    this.layers.mid.addChild(sprite);
    this.gems.push({ sprite, x, y, vx, vy, free, delay, t: Math.random() * 4 });
  }

  private updateGems(dt: number, t: number): void {
    const course = this.course, hero = this.hero;
    // lay out queued gems in little patterns just off screen
    this.gemT -= dt;
    if (this.gemT <= 0) {
      this.gemT = 0.35;
      if (this.gemQueueOut > 0) {
        const n = Math.min(this.gemQueueOut, 7);
        this.gemQueueOut -= n;
        const spot = this.solidAhead(this.spawnX(8));
        const col = Math.floor(spot.x / TILE);
        const pattern = Math.random();
        for (let k = 0; k < n; k++) {
          const gx = spot.x + k * 12;
          const top = course.groundTop(Math.floor(gx / TILE));
          const baseTop = top === Infinity ? spot.top : top;
          const gy = pattern < 0.55
            ? baseTop - 22 - Math.sin((k / Math.max(1, n - 1)) * Math.PI) * 34            // an arc to jump through
            : course.ledgeAt(col) > 0 ? course.ledgeTop(col) - 12 : baseTop - 12;          // a line along the ground (or ledge)
          this.addGem(gx, gy, 0, 0, false);
        }
      }
      if (this.gemQueueIn > 0) {
        const n = Math.min(this.gemQueueIn, 5);
        this.gemQueueIn -= n;
        for (let k = 0; k < n; k++) this.addGem(this.camX - 10, 30 + Math.random() * 50, hero.speed + 140 + Math.random() * 60, -80 - Math.random() * 60, true);
      }
    }
    const magnet = this.powers.magnet > 0;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.t += dt;
      g.delay = Math.max(0, g.delay - dt);
      if (g.free) {
        g.vy = Math.min(FALL_MAX, g.vy + G * 0.5 * dt);
        g.vx *= Math.exp(-dt * 1.4);
        g.x += g.vx * dt;
        const ny = g.y + g.vy * dt;
        const land = g.vy > 0 ? course.landing(g.x - 3, g.x + 3, g.y + 4, ny + 4) : null;
        if (land !== null) { g.y = land - 4; g.vy = -g.vy * 0.45; if (Math.abs(g.vy) < 40) { g.vy = 0; g.vx = 0; g.free = false; } }
        else g.y = ny;
        if (g.y > course.vh + 10) { g.sprite.destroy(); this.gems.splice(i, 1); continue; }
      }
      if (magnet && g.delay <= 0) {
        const dx = hero.x - g.x, dy = hero.y - 8 - g.y, d = Math.hypot(dx, dy);
        if (d < 80) { g.x += (dx / d) * 220 * dt; g.y += (dy / d) * 220 * dt; }
      }
      // collect
      const hx = hero.x, hy = hero.y - 8;
      if (g.delay <= 0 && Math.abs(g.x - hx) < 9 && Math.abs(g.y - hy) < 12) {
        this.stats.gems++;
        this.onSfx('gem', g.x);
        this.sparkle(g.x, g.y);
        g.sprite.destroy(); this.gems.splice(i, 1); continue;
      }
      if (g.x < this.camX - 30) { g.sprite.destroy(); this.gems.splice(i, 1); continue; }
      g.sprite.texture = this.art.gem[Math.floor(g.t * 8) % 4];
      g.sprite.position.set(Math.round(g.x), Math.round(g.y + (g.free ? 0 : Math.sin(g.t * 3) * 1.5)));
    }
  }

  private updateQueries(dt: number): void {
    const hero = this.hero;
    for (let i = this.queries.length - 1; i >= 0; i--) {
      const q = this.queries[i];
      q.bump = Math.max(0, q.bump - dt * 5);
      if (!q.used && hero.vy < 0 && Math.abs(q.x - hero.x) < 11 && hero.y - HEIGHT <= q.y + 2 && hero.y - HEIGHT >= q.y - 10) {
        q.used = true; q.bump = 1; hero.vy = 40;
        q.sprite.texture = this.art.queryUsed;
        this.stats.queries++;
        this.onSfx('query', q.x);
        this.popText(q.domain, P.cyan, q.x, q.y - 18);
        const kinds: Power[] = ['shoe', 'magnet', 'shield'];
        const kind = kinds[Math.floor(Math.random() * 3)];
        const sprite = new Sprite(kind === 'shoe' ? this.art.shoe : kind === 'magnet' ? this.art.magnet : this.art.shield);
        sprite.anchor.set(0.5, 1);
        if (kind === 'shield') sprite.scale.set(0.5);
        this.layers.mid.addChild(sprite);
        this.items.push({ sprite, kind, x: q.x + 20, y: q.y - 16, vy: -160, grounded: false });
      }
      q.sprite.position.set(Math.round(q.x), Math.round(q.y - Math.sin(q.bump * Math.PI) * 4));
      if (q.x < this.camX - 30) { q.sprite.destroy(); this.queries.splice(i, 1); }
    }
  }

  private brickAt(x: number, y: number): Brick | undefined {
    return this.bricks.find((b) => x >= b.x && x < b.x + TILE && y >= b.y && y < b.y + TILE);
  }

  private updateBricks(): void {
    const hero = this.hero;
    for (let i = this.bricks.length - 1; i >= 0; i--) {
      const b = this.bricks[i];
      b.sprite.position.set(b.x, b.y);
      const touching = hero.x + HALF >= b.x && hero.x - HALF <= b.x + TILE && hero.y > b.y && hero.y - HEIGHT < b.y + TILE;
      if (touching) {
        // we go straight through: the wall comes apart
        for (let k = 0; k < 4; k++) {
          this.bit(this.art.brickBit, b.x + 4 + (k % 2) * 8, b.y + 4 + Math.floor(k / 2) * 8,
            hero.speed * 0.5 + 40 + Math.random() * 90, -120 - Math.random() * 160, 1.2, G * 0.8, false);
        }
        this.stats.bricks++;
        this.onSfx('brick', b.x);
        b.sprite.destroy(); this.bricks.splice(i, 1); continue;
      }
      if (b.x < this.camX - 40) { b.sprite.destroy(); this.bricks.splice(i, 1); }
    }
  }

  private updateFlags(dt: number): void {
    const hero = this.hero;
    for (let i = this.flags.length - 1; i >= 0; i--) {
      const f = this.flags[i];
      if (!f.passed && hero.x > f.x) {
        f.passed = true;
        if (f.good) { this.stats.flags++; this.onSfx('flag', f.x); }
        else { this.onSfx('flagBroken', f.x); this.burst(f.x, f.base - 40, '#c08cff', 8, 50); }
      }
      if (f.passed && f.good) f.raised = Math.min(1, f.raised + dt * 1.1);
      const ease = f.raised * f.raised * (3 - 2 * f.raised);
      f.pole.position.set(Math.round(f.x), Math.round(f.base) + 1);
      f.flag.position.set(Math.round(f.x) + 1, Math.round(f.base - 12 - ease * 32));
      if (f.label) { f.label.position.set(Math.round(f.x), Math.round(f.base - 52)); f.label.alpha = ease; }
      if (f.x < this.camX - 40) { f.pole.destroy(); f.flag.destroy(); f.label?.destroy({ texture: true, textureSource: true }); this.flags.splice(i, 1); }
    }
  }

  private updateItems(dt: number): void {
    const course = this.course, hero = this.hero;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.grounded) {
        it.vy = Math.min(FALL_MAX, it.vy + G * 0.6 * dt);
        const ny = it.y + it.vy * dt;
        const land = it.vy > 0 ? course.landing(it.x - 4, it.x + 4, it.y, ny) : null;
        if (land !== null) { it.y = land; it.grounded = true; } else it.y = ny;
      }
      it.sprite.position.set(Math.round(it.x), Math.round(it.y));
      if (Math.abs(it.x - hero.x) < 11 && Math.abs(it.y - 6 - (hero.y - 8)) < 14) {
        this.powers[it.kind] = it.kind === 'shoe' ? 6 : it.kind === 'magnet' ? 9 : 12;
        this.onSfx('power', it.x);
        this.popText(it.kind === 'shoe' ? 'TURBO' : it.kind === 'magnet' ? 'MAGNET' : 'SHIELD', P.sand, it.x, it.y - 20);
        it.sprite.destroy(); this.items.splice(i, 1); continue;
      }
      if (it.y > course.vh + 10 || it.x < this.camX - 30) { it.sprite.destroy(); this.items.splice(i, 1); }
    }
  }

  private updateDrone(dt: number, t: number): void {
    const d = this.drone, hero = this.hero;
    this.blasts = this.blasts.filter((b) => (b.t += dt) < 0.45);
    if (d.on) {
      d.wanted -= dt;
      const leaving = d.wanted <= 0;
      const tx = leaving ? this.camX + this.vw + 60 : hero.x + 70 + Math.sin(t * 0.9) * 22;
      const ty = leaving ? -40 : 44 + Math.sin(t * 1.7) * 6;
      d.x += (tx - d.x) * Math.min(1, dt * 3);
      d.y += (ty - d.y) * Math.min(1, dt * 2);
      if (!leaving) {
        d.bombT -= dt;
        if (d.bombT <= 0) {
          d.bombT = 1.4 + Math.random() * 0.6;
          const s = new Sprite(this.art.bomb);
          s.anchor.set(0.5, 1);
          this.layers.mid.addChild(s);
          this.bombs.push({ sprite: s, x: d.x, y: d.y + 6, vx: hero.speed * 0.35, vy: 0, fuse: 9 });
          this.onSfx('bombDrop', d.x);
        }
      }
      if (leaving && d.y < -30) { d.on = false; d.sprite.visible = false; }
      d.sprite.position.set(Math.round(d.x), Math.round(d.y));
      d.sprite.rotation = Math.sin(t * 2.3) * 0.08;   // a gentle hover sway
    }
    const course = this.course;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      if (b.fuse >= 9) {
        b.vy += G * 0.6 * dt; b.x += b.vx * dt; b.vx *= Math.exp(-dt * 0.5);
        const ny = b.y + b.vy * dt;
        const top = course.groundTop(Math.floor(b.x / TILE));
        if (ny >= top) { b.y = top; b.fuse = 0.55; } else b.y = ny;
        if (b.y > course.vh + 10) { b.sprite.destroy(); this.bombs.splice(i, 1); continue; }
      } else {
        b.fuse -= dt;
        // the fuse glows warmer as it burns down (a smooth ramp, no blinking)
        const k = 1 - Math.max(0, b.fuse) / 0.55;
        b.sprite.tint = (0xff << 16) | (Math.round(0xff - k * 0x32) << 8) | Math.round(0xff - k * 0x8a);
        if (b.fuse <= 0) {
          this.blasts.push({ x: b.x, y: b.y, t: 0 });
          this.burst(b.x, b.y - 4, P.orange, 14, 110);
          this.burst(b.x, b.y - 4, P.sand, 8, 70);
          this.onSfx('boom', b.x);
          if (Math.abs(b.x - hero.x) < 20 && hero.y > b.y - 22 && this.hurt <= 0) {
            if (this.powers.shield > 0) { this.powers.shield = 0; this.onSfx('shieldPop', hero.x); } else this.hurtHero();
          }
          b.sprite.destroy(); this.bombs.splice(i, 1); continue;
        }
      }
      b.sprite.position.set(Math.round(b.x), Math.round(b.y) + 1);
    }
  }

  // ── the boss ──
  private boss: Boss | null = null;
  private bossCool = 0;

  /** A sustained attack: a boss mech named for the threat comes in (one at a time, not too often). */
  bossFight(name: string): boolean {
    if (this.boss || this.bossCool > 0) return false;
    const sprite = new Sprite(this.art.boss);
    sprite.anchor.set(0.5, 1);
    this.layers.mid.addChild(sprite);
    const label = new Sprite(pixelText(name.slice(0, 20), P.orange));
    label.anchor.set(0.5, 1);
    this.layers.ui.addChild(label);
    this.boss = {
      sprite, label, name, x: this.camX + this.vw + 40, hover: 70, hoverTarget: 55, ground: this.hero.y,
      hp: 3, max: 3, inv: 0, t: 0, slamT: 3.2, low: 0, phase: 'enter',
    };
    this.onSfx('bossStart', this.boss.x);
    return true;
  }

  /** The fight's state for the dash (null when there's no boss). */
  bossInfo(): { name: string; hp: number; max: number } | null {
    return this.boss && this.boss.phase !== 'leave' ? { name: this.boss.name, hp: this.boss.hp, max: this.boss.max } : null;
  }

  private updateBoss(dt: number): void {
    this.bossCool = Math.max(0, this.bossCool - dt);
    const b = this.boss, hero = this.hero, course = this.course;
    if (!b) return;
    b.t += dt;
    b.inv = Math.max(0, b.inv - dt);
    const top = course.groundTop(Math.floor(b.x / TILE));
    if (top !== Infinity) b.ground += (top - b.ground) * Math.min(1, dt * 6);
    if (b.phase === 'enter') {
      const target = hero.x + 120;
      b.x += (target - b.x) * Math.min(1, dt * 1.5) + hero.speed * dt * 0.5;
      if (Math.abs(b.x - target) < 12) b.phase = 'fight';
      if (b.t > 45) b.phase = 'leave';
    } else if (b.phase === 'fight') {
      if (b.t > 50) b.phase = 'leave';
      if (b.low > 0) {
        // down on the ground: it holds still (we catch up), then lifts off again
        b.low -= dt;
        b.hoverTarget = 0;
        if (b.low <= 0) { b.hoverTarget = 55; b.slamT = 2.6 + Math.random(); }
      } else {
        // keep ahead of us, bobbing, until it's time to slam
        const target = hero.x + 110 + Math.sin(b.t * 0.8) * 22;
        b.x += (target - b.x) * Math.min(1, dt * 2.4);
        b.hoverTarget = 50 + Math.sin(b.t * 1.7) * 8;
        b.slamT -= dt;
        if (b.slamT <= 0 && b.hover > 30) { b.low = 1.5; this.onSfx('bossSlam', b.x); }
      }
    } else {
      b.x += (hero.speed + 60) * dt;
      b.hoverTarget = 140;
    }
    const rate = b.hoverTarget < b.hover ? 7 : 1.8;
    const wasHigh = b.hover > 6;
    b.hover += (b.hoverTarget - b.hover) * Math.min(1, dt * rate);
    if (wasHigh && b.hover <= 6 && b.low > 0) {
      // impact: dust, and two packet orbs rolling at us
      this.burst(b.x - 14, b.ground - 2, P.silver, 8, 70);
      this.burst(b.x + 14, b.ground - 2, P.silver, 8, 70);
      for (const off of [-18, -40]) {
        const e: Enemy = { kind: 'orb', sprite: new Sprite(this.art.orb[0]), x: b.x + off, y: b.ground, vx: -80, vy: -60, grounded: false, squash: 0, hopT: 9, anim: 0 };
        e.sprite.anchor.set(0.5, 1);
        this.layers.mid.addChild(e.sprite);
        this.enemies.push(e);
      }
    }
    const y = b.ground - b.hover;
    // hit: pale for a moment (an ease between the two looks, never a flash)
    b.sprite.texture = b.inv > 0.6 ? this.art.bossHurt : this.art.boss;
    b.sprite.alpha = b.inv > 0 ? 0.75 + 0.25 * Math.cos(b.inv * 6) : 1;
    b.sprite.position.set(Math.round(b.x), Math.round(y) + 1);
    b.sprite.rotation = b.phase === 'fight' && b.low <= 0 ? Math.sin(b.t * 2) * 0.05 : 0;
    b.label.position.set(Math.round(b.x), Math.round(y - 34));

    // contact with the hero: land on the dome to hit it, touch it anywhere else and it hurts
    if (b.phase === 'fight' && Math.abs(b.x - hero.x) < 15 && hero.y > y - 30 && hero.y - HEIGHT < y) {
      if (hero.vy > 0 && hero.y < y - 18) {
        if (b.inv <= 0) {
          b.hp--; b.inv = 1.4; b.low = 0; b.hoverTarget = 70; b.slamT = 2.2;
          this.stats.stomps++;
          this.burst(b.x, y - 26, P.sand, 14, 110);
          if (b.hp <= 0) { this.defeatBoss(); return; }
          this.onSfx('bossHit', b.x);
        }
        hero.vy = -300; hero.grounded = false; hero.usedDouble = false;
      } else if (this.hurt <= 0 && b.inv <= 0) {
        if (this.powers.shield > 0) { this.powers.shield = 0; this.onSfx('shieldPop', hero.x); } else this.hurtHero();
      }
    }
    if (b.phase === 'leave' && y < -40) this.dropBoss();
  }

  private defeatBoss(): void {
    const b = this.boss!;
    const y = b.ground - b.hover;
    this.stats.bosses++;
    this.onSfx('bossDown', b.x);
    this.popText('BOSS DOWN!', P.sand, b.x, y - 40);
    this.burst(b.x, y - 14, P.orange, 24, 150);
    this.burst(b.x, y - 14, P.white, 14, 120);
    for (let k = 0; k < 18; k++) {
      const a = -Math.PI * (0.1 + 0.8 * Math.random());
      this.addGem(b.x, y - 14, Math.cos(a) * 140 + this.hero.speed * 0.5, Math.sin(a) * 260, true, 0.3);
    }
    this.dropBoss();
  }

  private dropBoss(): void {
    if (!this.boss) return;
    this.boss.sprite.destroy();
    this.boss.label.destroy({ texture: true, textureSource: true });
    this.boss = null;
    this.bossCool = 40;
    this.onSfx('bossEnd', 0);
  }

  // ── little effects ──
  private bit(texture: Texture, x: number, y: number, vx: number, vy: number, life: number, g: number, fade: boolean, tint = 0xffffff): void {
    if (this.bits.length >= this.maxBits) return;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.tint = tint;
    this.layers.front.addChild(sprite);
    this.bits.push({ sprite, x, y, vx, vy, life, max: life, g, fade });
  }

  burst(x: number, y: number, color: string, n: number, speed: number): void {
    const tint = parseInt(color.slice(1), 16);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
      this.bit(this.art.dot, x, y, Math.cos(a) * v + this.hero.speed * 0.3, Math.sin(a) * v - 30, 0.4 + Math.random() * 0.4, G * 0.3, true, tint);
    }
  }

  private sparkle(x: number, y: number): void {
    this.bit(this.art.spark, x, y, this.hero.speed * 0.2, -30, 0.35, 0, true, 0xa7f070);
  }

  popText(text: string, color: string, x: number, y: number): void {
    const sprite = new Sprite(pixelText(text.slice(0, 22), color));
    sprite.anchor.set(0.5, 1);
    this.layers.ui.addChild(sprite);
    this.pops.push({ sprite, x, y, t: 0, max: 1.8, rise: 22 });
  }

  private updateBits(dt: number): void {
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= dt;
      if (b.life <= 0) { b.sprite.destroy(); this.bits.splice(i, 1); continue; }
      b.vy += b.g * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      b.sprite.position.set(Math.round(b.x), Math.round(b.y));
      if (b.fade) b.sprite.alpha = Math.min(1, (b.life / b.max) * 1.5);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t >= p.max) { p.sprite.texture.destroy(true); p.sprite.destroy(); this.pops.splice(i, 1); continue; }
      const k = p.t / p.max;
      p.sprite.position.set(Math.round(p.x), Math.round(p.y - p.rise * (1 - (1 - k) * (1 - k))));
      // eases in, holds, fades out
      p.sprite.alpha = Math.min(1, p.t * 6, (p.max - p.t) * 2);
    }
  }

  private updateTrails(dt: number): void {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.t += dt;
      tr.sprite.alpha = 0.45 * (1 - tr.t / 0.3);
      if (tr.t >= 0.3) { tr.sprite.destroy(); this.trails.splice(i, 1); }
    }
  }
}
