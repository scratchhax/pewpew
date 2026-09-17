import {
  AdditiveBlending, Color, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial,
  Texture, type Scene,
} from 'three';
import { sprCrate, sprDemon, sprFireball, sprGlow, sprPlate, sprVial, tex, FR } from './art';
import { CS, isFloor, type Level } from './levelgen';

/**
 * Everything that moves in the maze: imps that shamble at the marine and
 * pop into gibs when fragged, their fireballs, bobbing pickups, domain
 * plates on the walls, and teleporters that wind up when a client joins.
 * Sprites stand on the floor (bottom-anchored), always face the camera,
 * and never survive a level change.
 */

export interface Demon {
  spr: Sprite; x: number; z: number; hp: number; state: 'walk' | 'pain' | 'die';
  t: number; anim: number; fireT: number;
}
interface Gib { spr: Sprite; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }
interface Fire { spr: Sprite; x: number; z: number; vx: number; vz: number; }
interface Pickup { spr: Sprite; kind: 'vial' | 'crate'; x: number; z: number; t: number }
interface Plate { mesh: Mesh; life: number }
interface Tele { group: Sprite[]; t: number; hot: boolean }

export interface ActorHooks { onDamage: (n: number) => void; onPickup: (kind: 'vial' | 'crate') => void }

export class Actors {
  private d0!: Texture; private d1!: Texture; private fb!: Texture; private gore!: Texture;
  private vial!: Texture; private crate!: Texture;
  demons: Demon[] = [];
  private gibs: Gib[] = [];
  private fires: Fire[] = [];
  private pickups: Pickup[] = [];
  private plates: Plate[] = [];
  private teles: Tele[] = [];
  private scene: Scene;
  private hooks: ActorHooks;

  constructor(scene: Scene, hooks: ActorHooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.d0 = tex(sprDemon(0)); this.d1 = tex(sprDemon(1));
    this.fb = tex(sprFireball());
    this.gore = tex(sprGlow('#d84343'));
    this.vial = tex(sprVial()); this.crate = tex(sprCrate());
  }

  spawnDemon(x: number, z: number): Demon {
    const spr = new Sprite(new SpriteMaterial({ map: this.d0, transparent: true }));
    spr.center.set(0.5, 0.02);
    spr.scale.set(1.55, 2.33, 1);
    spr.position.set(x, 0.06, z);
    this.scene.add(spr);
    const d: Demon = { spr, x, z, hp: 3, state: 'walk', t: 0, anim: 0, fireT: 1 + Math.random() };
    this.demons.push(d);
    return d;
  }

  hit(d: Demon): void {
    d.hp -= 1;
    if (d.hp <= 0) this.killDemon(d);
    else { d.state = 'pain'; d.t = 0.22; (d.spr.material as SpriteMaterial).color.setRGB(2.4, 1.6, 1.4); }
  }

  killDemon(d: Demon): void {
    d.state = 'die'; d.t = 0.16;
    (d.spr.material as SpriteMaterial).color.setRGB(3, 0.5, 0.4);
    if (this.gibs.length < 130) {
      for (let k = 0; k < 16; k++) {
        const spr = new Sprite(new SpriteMaterial({ map: this.gore, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
        spr.scale.set(0.22, 0.22, 1);
        spr.position.set(d.x, 1.1, d.z);
        this.scene.add(spr);
        this.gibs.push({
          spr, x: d.x, y: 1.1, z: d.z,
          vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 4,
          life: 0.7 + Math.random() * 0.5,
        });
      }
    }
  }

  spawnFire(x: number, z: number, tx: number, tz: number): void {
    if (this.fires.length > 10) return;
    const spr = new Sprite(new SpriteMaterial({ map: this.fb, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    spr.scale.set(0.5, 0.5, 1);
    spr.position.set(x, 1.2, z);
    this.scene.add(spr);
    const dx = tx - x, dz = tz - z, len = Math.hypot(dx, dz) || 1;
    this.fires.push({ spr, x, z, vx: dx / len * 3.4, vz: dz / len * 3.4 });
  }

  spawnPickup(x: number, z: number, kind: 'vial' | 'crate'): void {
    if (this.pickups.length > 8) return;
    const spr = new Sprite(new SpriteMaterial({ map: kind === 'vial' ? this.vial : this.crate, transparent: true }));
    spr.center.set(0.5, 0);
    spr.scale.set(kind === 'vial' ? 0.55 : 0.85, kind === 'vial' ? 0.82 : 0.68, 1);
    spr.position.set(x, 0.1, z);
    this.scene.add(spr);
    this.pickups.push({ spr, kind, x, z, t: Math.random() * 6 });
  }

  /** A wall plate glowing a domain, facing away from the given cell's wall. */
  spawnPlate(text: string, x: number, z: number, nx: number, nz: number): void {
    if (this.plates.length >= 6) { const p = this.plates.shift()!; this.scene.remove(p.mesh); }
    const t = tex(sprPlate(text));
    const mesh = new Mesh(new PlaneGeometry(1.0, 0.25), new MeshBasicMaterial({ map: t, transparent: true }));
    mesh.position.set(x + nx * 0.06, 2.05, z + nz * 0.06);
    mesh.rotation.y = Math.atan2(nx, nz);
    this.scene.add(mesh);
    this.plates.push({ mesh, life: 45 });
  }

  /** Teleporter spin-up (joined) or red zap (auth failure). */
  spawnTele(x: number, z: number, hot: boolean): void {
    if (this.teles.length >= 4) { const t = this.teles.shift()!; for (const s of t.group) this.scene.remove(s); }
    const col = hot ? '#4dffe0' : '#ff4040';
    const g = tex(sprGlow(col));
    const group: Sprite[] = [];
    for (let k = 0; k < 3; k++) {
      const spr = new Sprite(new SpriteMaterial({ map: g, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      spr.scale.set(0.9, 0.9, 1);
      spr.position.set(x, 0.3 + k * 1.1, z);
      this.scene.add(spr);
      group.push(spr);
    }
    this.teles.push({ group, t: 0, hot });
  }

  clear(): void {
    const kill = (o: Sprite | Mesh): void => { this.scene.remove(o); };
    for (const d of this.demons) kill(d.spr);
    for (const g of this.gibs) kill(g.spr);
    for (const f of this.fires) kill(f.spr);
    for (const p of this.pickups) kill(p.spr);
    for (const p of this.plates) kill(p.mesh);
    for (const t of this.teles) for (const s of t.group) kill(s);
    this.demons = []; this.gibs = []; this.fires = []; this.pickups = []; this.plates = []; this.teles = [];
  }

  get demonCount(): number { return this.demons.length; }

  update(dt: number, level: Level, camX: number, camZ: number): void {
    // demons: shamble toward the marine, lob fireballs, chew on him close
    for (const d of this.demons) {
      if (d.state === 'die') { d.t -= dt; continue; }
      d.anim += dt;
      const m = d.spr.material as SpriteMaterial;
      m.map = ((d.anim / 0.34) | 0) % 2 ? this.d1 : this.d0;
      if (d.state === 'pain') {
        d.t -= dt;
        if (d.t <= 0) { d.state = 'walk'; m.color.setRGB(1, 1, 1); }
        continue;
      }
      const dx = camX - d.x, dz = camZ - d.z, dist = Math.hypot(dx, dz);
      if (dist > 1.7) {
        const step = 0.85 * dt;
        const nx = d.x + (dx / dist) * step, nz = d.z + (dz / dist) * step;
        if (isFloor(level, (nx / CS) | 0, (d.z / CS) | 0)) d.x = nx;
        if (isFloor(level, (d.x / CS) | 0, (nz / CS) | 0)) d.z = nz;
        d.spr.position.set(d.x, 0.06, d.z);
      }
      d.fireT -= dt;
      if (d.fireT <= 0 && dist > 3 && dist < 12) {
        d.fireT = 1.6 + Math.random();
        this.spawnFire(d.x, d.z, camX, camZ);
      }
      if (dist < 2.1) { this.hooks.onDamage(4); d.fireT = 1.2; }
    }
    for (let i = this.demons.length - 1; i >= 0; i--) {
      if (this.demons[i].state === 'die' && this.demons[i].t <= 0) {
        this.scene.remove(this.demons[i].spr);
        this.demons.splice(i, 1);
      }
    }

    // fireballs: travel, hit, pop
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.x += f.vx * dt; f.z += f.vz * dt;
      f.spr.position.set(f.x, 1.2, f.z);
      const cell = level.grid[((f.z / CS) | 0) * level.w + ((f.x / CS) | 0)];
      if (cell === 0 || !isFinite(cell)) { this.pop(f.spr); this.fires.splice(i, 1); continue; }
      if (Math.hypot(f.x - camX, f.z - camZ) < 0.7) { this.hooks.onDamage(7); this.pop(f.spr); this.fires.splice(i, 1); }
    }

    // gibs: arc, splat, fade
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.life -= dt;
      g.vy -= 9.5 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      if (g.y < 0.08) { g.y = 0.08; g.vy = 0; g.vx *= 0.6; g.vz *= 0.6; }
      g.spr.position.set(g.x, g.y, g.z);
      (g.spr.material as SpriteMaterial).opacity = Math.max(0, g.life);
      if (g.life <= 0) { this.scene.remove(g.spr); this.gibs.splice(i, 1); }
    }

    // pickups bob; grab them if the marine brushes past
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.spr.position.y = 0.1 + Math.sin(p.t * 2.4) * 0.08;
      if (Math.hypot(p.x - camX, p.z - camZ) < 0.9) {
        this.hooks.onPickup(p.kind);
        this.scene.remove(p.spr);
        this.pickups.splice(i, 1);
      }
    }

    for (let i = this.plates.length - 1; i >= 0; i--) {
      const p = this.plates[i];
      p.life -= dt;
      const mat = p.mesh.material as MeshBasicMaterial;
      mat.opacity = Math.min(1, p.life / 4);
      if (p.life <= 0) { this.scene.remove(p.mesh); this.plates.splice(i, 1); }
    }

    for (const t of this.teles) {
      t.t += dt;
      const k = t.hot ? 1 : 0.7;
      t.group.forEach((s, i) => {
        const m = s.material as SpriteMaterial;
        m.opacity = k * Math.min(1, t.t) * (0.55 + 0.45 * Math.sin(t.t * 6 + i * 2.1)) * (t.hot ? 1 : Math.max(0, 1 - (t.t - 3) / 2));
        s.scale.setScalar(0.9 + 0.25 * Math.sin(t.t * 5 + i));
      });
    }
  }

  private pop(spr: Sprite): void {
    this.scene.remove(spr);
  }
}

export const SPRITE_COLORS = FR;
export const WHITE = new Color(1, 1, 1);
