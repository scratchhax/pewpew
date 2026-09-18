import type { TexTable, SprFrame } from './wad';
import type { Level } from './levelgen';
import { CS, isFloor } from './levelgen';
import type { Sprite, RgbaSprite } from './raycast';
import { sprGlow, sprPlate, canvasToRgba } from './art';

/**
 * Everything that moves in the maze, as frames the software renderer can
 * paste: imps that shamble at the marine and die in a spray of red, their
 * fireballs, bobbing pickups, domain plates on the walls, teleporters that
 * wind up when a client joins. Demons idle until they smell the marine -
 * line of sight, close enough - and then they come. Sprites stand on the
 * floor, face the camera, and never survive a level change.
 */

export type DemonState = 'idle' | 'walk' | 'pain' | 'die' | 'corpse';

export interface Demon {
  x: number; z: number; hp: number; state: DemonState;
  t: number; anim: number; fireT: number; aggro: boolean; hostle: boolean;
}
interface Gib { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }
interface Fire { x: number; z: number; vx: number; vz: number; t: number }
interface Pickup { kind: 'health' | 'ammo'; x: number; z: number; t: number }
interface Plate { text: string; rgba: RgbaSprite; x: number; z: number; life: number }
interface Tele { x: number; z: number; t: number; hot: boolean }

export interface ActorHooks {
  onDamage: (n: number) => void;
  onPickup: (kind: 'health' | 'ammo') => void;
  onAggro: () => void;
}

const WALK = ['A', 'B', 'C', 'D'];
const PAIN = ['E', 'F'];
const DEATH = ['H', 'I', 'J', 'K', 'L', 'M'];

function pick(frames: Record<string, SprFrame>, letters: string[]): SprFrame[] {
  const out = letters.map((L) => frames[L]).filter(Boolean) as SprFrame[];
  const first = Object.values(frames)[0];
  return out.length ? out : first ? [first] : [];
}

export class Actors {
  demons: Demon[] = [];
  private gibs: Gib[] = [];
  private fires: Fire[] = [];
  private pickups: Pickup[] = [];
  private plates: Plate[] = [];
  private teles: Tele[] = [];
  private hooks: ActorHooks;

  private walkFrames: SprFrame[] = [];
  private painFrames: SprFrame[] = [];
  private deathFrames: SprFrame[] = [];
  private fbFrames: SprFrame[] = [];
  private healthFrame: SprFrame | null = null;
  private ammoFrame: SprFrame | null = null;
  private gore: RgbaSprite | null = null;
  private teleGlow: RgbaSprite | null = null;
  private teleCold: RgbaSprite | null = null;

  constructor(hooks: ActorHooks) { this.hooks = hooks; }

  load(table: TexTable): void {
    const demon = table.sprites.demon ?? {};
    this.walkFrames = pick(demon, WALK);
    this.painFrames = pick(demon, PAIN);
    this.deathFrames = pick(demon, DEATH);
    this.fbFrames = pick(table.sprites.fireball ?? {}, ['A', 'B', 'C', 'D', 'E']);
    this.healthFrame = table.sprites.health?.A ?? null;
    this.ammoFrame = table.sprites.ammo?.A ?? null;
    this.gore = canvasToRgba(sprGlow('#d84343', 16));
    this.teleGlow = canvasToRgba(sprGlow('#4dffe0', 32));
    this.teleCold = canvasToRgba(sprGlow('#ff4040', 32));
  }

  get demonCount(): number { return this.demons.filter((d) => d.state !== 'die' && d.state !== 'corpse').length; }

  spawnDemon(x: number, z: number, hostile = true): Demon {
    const d: Demon = { x, z, hp: hostile ? 3 : 2, state: 'idle', t: 0, anim: Math.random() * 4, fireT: 1 + Math.random(), aggro: false, hostle: hostile };
    this.demons.push(d);
    return d;
  }

  hit(d: Demon): void {
    if (d.state === 'die' || d.state === 'corpse') return;
    d.hp -= 1;
    if (d.hp <= 0) { d.state = 'die'; d.t = 0; }
    else { d.state = 'pain'; d.t = 0.24; }
  }

  burst(x: number, z: number): void {
    if (!this.gore || this.gibs.length > 120) return;
    for (let k = 0; k < 14; k++) {
      this.gibs.push({
        x, y: 1.1, z,
        vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 4,
        life: 0.7 + Math.random() * 0.5,
      });
    }
  }

  spawnFire(x: number, z: number, tx: number, tz: number): void {
    if (this.fires.length > 10) return;
    const dx = tx - x, dz = tz - z, len = Math.hypot(dx, dz) || 1;
    this.fires.push({ x, z, vx: dx / len * 3.4, vz: dz / len * 3.4, t: 0 });
  }

  spawnPickup(x: number, z: number, kind: 'health' | 'ammo'): void {
    if (this.pickups.length > 8) return;
    this.pickups.push({ kind, x, z, t: Math.random() * 6 });
  }

  spawnPlate(text: string, x: number, z: number, nx: number, nz: number): void {
    if (this.plates.length >= 6) this.plates.shift()!;
    this.plates.push({ text, rgba: canvasToRgba(sprPlate(text)), x: x + nx * 0.35, z: z + nz * 0.35, life: 45 });
  }

  spawnTele(x: number, z: number, hot: boolean): void {
    if (this.teles.length >= 4) this.teles.shift()!;
    this.teles.push({ x, z, t: 0, hot });
  }

  clear(): void {
    this.demons = []; this.gibs = []; this.fires = []; this.pickups = []; this.plates = []; this.teles = [];
  }

  update(dt: number, level: Level, camX: number, camZ: number, los: (ax: number, az: number, bx: number, bz: number) => boolean): void {
    for (const d of this.demons) {
      d.anim += dt;
      if (d.state === 'die') { d.t += dt; if (d.t > DEATH.length * 0.12) { d.state = 'corpse'; d.t = 0; } continue; }
      if (d.state === 'corpse') { d.t += dt; continue; }
      if (d.state === 'pain') {
        d.t -= dt;
        if (d.t <= 0) d.state = 'walk';
        continue;
      }
      const dx = camX - d.x, dz = camZ - d.z, dist = Math.hypot(dx, dz);
      if (!d.aggro && d.hostle && dist < 9 && los(d.x, d.z, camX, camZ)) {
        d.aggro = true;
        this.hooks.onAggro();
      }
      if (d.state === 'idle' && !d.aggro) {
        // idle wander: shuffle a step in a random floor direction, but never
        // right on top of the marine - ambient demons set the mood, they
        // don't smother the camera
        d.t -= dt;
        if (d.t <= 0) {
          d.t = 0.6 + Math.random() * 1.2;
          const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          const [sx, sz] = dirs[(Math.random() * 4) | 0];
          const nx = d.x + sx * 0.9, nz = d.z + sz * 0.9;
          const nearCam = Math.hypot(nx - camX, nz - camZ) < 2.4;
          if (!nearCam) {
            if (isFloor(level, (nx / CS) | 0, (d.z / CS) | 0)) d.x = nx;
            if (isFloor(level, (d.x / CS) | 0, (nz / CS) | 0)) d.z = nz;
          }
        }
        continue;
      }
      // chasing the marine
      if (dist > 1.7) {
        const step = 0.95 * dt;
        const nx = d.x + (dx / dist) * step, nz = d.z + (dz / dist) * step;
        if (isFloor(level, (nx / CS) | 0, (d.z / CS) | 0)) d.x = nx;
        if (isFloor(level, (d.x / CS) | 0, (nz / CS) | 0)) d.z = nz;
      }
      d.fireT -= dt;
      if (d.fireT <= 0 && dist > 3 && dist < 12 && this.fbFrames.length) {
        d.fireT = 1.6 + Math.random();
        this.spawnFire(d.x, d.z, camX, camZ);
      }
      if (dist < 2.1) { this.hooks.onDamage(4); d.fireT = 1.2; }
    }
    // corpses fade out eventually
    for (let i = this.demons.length - 1; i >= 0; i--) {
      const d = this.demons[i];
      if (d.state === 'corpse' && d.t > 14) this.demons.splice(i, 1);
    }

    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      f.x += f.vx * dt; f.z += f.vz * dt;
      const cell = level.grid[((f.z / CS) | 0) * level.w + ((f.x / CS) | 0)];
      if (cell === 0) { this.fires.splice(i, 1); continue; }
      if (Math.hypot(f.x - camX, f.z - camZ) < 0.7) { this.hooks.onDamage(7); this.fires.splice(i, 1); }
    }

    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.life -= dt;
      g.vy -= 9.5 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      if (g.y < 0.08) { g.y = 0.08; g.vy = 0; g.vx *= 0.6; g.vz *= 0.6; }
      if (g.life <= 0) this.gibs.splice(i, 1);
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      if (Math.hypot(p.x - camX, p.z - camZ) < 0.9) {
        this.hooks.onPickup(p.kind);
        this.pickups.splice(i, 1);
      }
    }

    for (let i = this.plates.length - 1; i >= 0; i--) {
      this.plates[i].life -= dt;
      if (this.plates[i].life <= 0) this.plates.splice(i, 1);
    }
    for (const t of this.teles) t.t += dt;
    for (let i = this.teles.length - 1; i >= 0; i--) if (this.teles[i].t > 8) this.teles.splice(i, 1);
  }

  /** Everything visible, as renderer sprites. */
  collect(): Sprite[] {
    const out: Sprite[] = [];
    for (const t of this.teles) {
      const glow = t.hot ? this.teleGlow : this.teleCold;
      if (!glow) continue;
      for (let k = 0; k < 3; k++) {
        const rise = t.hot ? Math.min(1, t.t) : Math.max(0, 1 - (t.t - 3) / 2);
        if (rise <= 0.01) continue;
        out.push({
          x: t.x, z: t.z, rgba: glow, scale: 0.85 + 0.2 * Math.sin(t.t * 5 + k),
          zBase: 0.1 + k * 1.05 + (t.hot ? Math.sin(t.t * 2.2 + k) * 0.3 : 0),
          add: true, alpha: rise * (0.5 + 0.45 * Math.sin(t.t * 6 + k * 2.1)),
        });
      }
    }
    for (const f of this.fires) {
      const fr = this.fbFrames.length ? this.fbFrames[((f.t * 12) | 0) % this.fbFrames.length] : null;
      if (fr) out.push({ x: f.x, z: f.z, frame: fr, scale: 0.55, zBase: 0.95, add: true });
    }
    for (const g of this.gibs) {
      if (!this.gore) continue;
      out.push({ x: g.x, z: g.z, rgba: this.gore, scale: 0.24, zBase: g.y, add: true, alpha: Math.max(0, Math.min(1, g.life)) });
    }
    for (const p of this.pickups) {
      const fr = p.kind === 'health' ? this.healthFrame : this.ammoFrame;
      if (!fr) continue;
      out.push({ x: p.x, z: p.z, frame: fr, scale: p.kind === 'health' ? 0.5 : 0.42, zBase: 0.08 + Math.sin(p.t * 2.4) * 0.07 });
    }
    for (const pl of this.plates) {
      out.push({ x: pl.x, z: pl.z, rgba: pl.rgba, scale: 0.42, zBase: 1.75, alpha: Math.min(1, pl.life / 4) });
    }
    for (const d of this.demons) {
      const frames = d.state === 'pain' ? this.painFrames : d.state === 'die' || d.state === 'corpse' ? this.deathFrames : this.walkFrames;
      if (!frames.length) continue;
      let frame: SprFrame;
      if (d.state === 'die') frame = frames[Math.min(frames.length - 1, ((d.t / 0.12) | 0) % frames.length)];
      else if (d.state === 'corpse') frame = frames[frames.length - 1];
      else frame = frames[((d.anim / 0.34) | 0) % frames.length];
      out.push({ x: d.x, z: d.z, frame, scale: 1.55 });
    }
    return out;
  }
}
