import { Container, Sprite, Texture } from 'pixi.js';

/**
 * One fighter: a sprite with an animation state machine and enough physics
 * to walk, lunge, get hit and fly off-screen. The scene decides when to
 * attack and who got hit; the fighter just performs it.
 */

export type FState = 'idle' | 'walk' | 'attack' | 'hurt' | 'ko' | 'win';

export interface AttackDef {
  anim: string;
  fps: number;
  dmg: number;
  range: number;   // px: how close the fighters must be for it to connect
  hitAt: number;   // seconds from the attack's start until the fist lands
  dur: number;     // seconds until the fighter is free again
  knock: number;   // knockback px/s handed to the victim
  lunge: number;   // px/s the attacker moves forward while attacking
}

export const ATTACKS: Record<string, AttackDef> = {
  jab:      { anim: 'jab',      fps: 14, dmg: 2,  range: 150, hitAt: 0.13, dur: 0.24, knock: 50,  lunge: 30 },
  punch:    { anim: 'punch',    fps: 12, dmg: 5,  range: 160, hitAt: 0.17, dur: 0.34, knock: 110, lunge: 60 },
  kick:     { anim: 'kick',     fps: 14, dmg: 7,  range: 168, hitAt: 0.21, dur: 0.42, knock: 140, lunge: 70 },
  jumpkick: { anim: 'jumpkick', fps: 12, dmg: 8,  range: 170, hitAt: 0.18, dur: 0.46, knock: 160, lunge: 90 },
  divekick: { anim: 'divekick', fps: 16, dmg: 9,  range: 172, hitAt: 0.19, dur: 0.5,  knock: 150, lunge: 100 },
  punch2:   { anim: 'punch',    fps: 11, dmg: 7,  range: 172, hitAt: 0.19, dur: 0.38, knock: 140, lunge: 70 },
  punch3:   { anim: 'punch',    fps: 10, dmg: 9,  range: 178, hitAt: 0.2,  dur: 0.44, knock: 170, lunge: 80 },
  super:    { anim: 'punch',    fps: 10, dmg: 16, range: 195, hitAt: 0.22, dur: 0.62, knock: 220, lunge: 120 },
};

export class Fighter {
  readonly root = new Container();
  readonly sprite = new Sprite();
  charge = 0;
  health = 100;
  state: FState = 'idle';
  x = 0;
  facing: 1 | -1 = 1;
  hitLanded = false;
  baseScale = 3.5;
  /** +1 when the sprite sheets face right, -1 when they face left. */
  sheetDir: 1 | -1 = 1;
  private vx = 0;
  private vy = 0;
  private lift = 0;              // px above the floor (jumps, knockback air)
  private anim: Texture[];
  private animT = 0;
  private frame = 0;
  private stateT = 0;
  private atk: AttackDef | null = null;
  private hurtDur = 0.42;
  private tintFlash = 0;

  constructor(anims: Record<string, Texture[]>, readonly label: string) {
    this.anims = anims;
    this.anim = anims.idle;
    this.sprite.texture = this.anim[0];
    this.sprite.anchor.set(0.5, 1);
    this.sprite.scale.set(this.baseScale, this.baseScale);
    this.root.addChild(this.sprite);
  }

  protected anims: Record<string, Texture[]>;

  get busy(): boolean { return this.state === 'attack' || this.state === 'hurt' || this.state === 'ko'; }

  /** Begin an attack; returns false when too busy. */
  attack(kind: keyof typeof ATTACKS, foeX: number): boolean {
    if (this.busy) return false;
    this.atk = ATTACKS[kind];
    this.anim = this.anims[this.atk.anim] ?? this.anims.idle;
    this.frame = 0;
    this.animT = 0;
    this.state = 'attack';
    this.stateT = 0;
    this.hitLanded = false;
    this.facing = foeX >= this.x ? 1 : -1;
    return true;
  }

  takeHit(dmg: number, dir: 1 | -1, knock: number, big = false, dur = 0.42): void {
    this.health = Math.max(0, this.health - dmg);
    this.state = 'hurt';
    this.stateT = 0;
    this.hurtDur = dur;
    this.anim = this.anims.hurt;
    this.frame = 0;
    this.animT = 0;
    this.vx = dir * knock;
    this.vy = big ? 200 : 0;
    this.tintFlash = 0.18;
  }

  ko(dir: 1 | -1): void {
    this.state = 'ko';
    this.stateT = 0;
    this.anim = this.anims.hurt;
    this.frame = this.anim.length - 1;
    this.sprite.texture = this.anim[this.frame];
    this.vx = dir * 420;
    this.vy = 340;
    this.lift = 30;
  }

  win(): void {
    if (this.state === 'ko') return;
    this.state = 'win';
    this.stateT = 0;
    this.anim = this.anims.idle;
    this.frame = 0;
  }

  reset(x: number, facing: 1 | -1): void {
    this.health = 100;
    this.charge = 0;
    this.state = 'idle';
    this.x = x;
    this.facing = facing;
    this.vx = 0;
    this.vy = 0;
    this.lift = 0;
    this.sprite.rotation = 0;
    this.sprite.alpha = 1;
    this.sprite.tint = 0xffffff;
    this.anim = this.anims.idle;
    this.frame = 0;
  }

  /** Walk toward a target x at speed, unless busy. */
  walkToward(tx: number, speed: number, dt: number): void {
    if (this.busy) return;
    const d = tx - this.x;
    if (Math.abs(d) < 4) { this.setState('idle'); return; }
    this.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    this.setState('walk');
  }

  idle(): void {
    if (!this.busy) this.setState('idle');
  }

  private setState(s: FState): void {
    if (this.state === s) return;
    this.state = s;
    const a = this.anims;
    if (s === 'walk' && a.walk) this.anim = a.walk;
    else if (s === 'idle' && a.idle) this.anim = a.idle;
    this.frame = 0;
    this.animT = 0;
  }

  /** Per-frame: advance the state machine. Returns the attack that just landed. */
  update(dt: number): AttackDef | null {
    let landed: AttackDef | null = null;
    this.stateT += dt;
    if (this.tintFlash > 0) {
      this.tintFlash -= dt;
      this.sprite.tint = this.tintFlash > 0 ? 0xff8a70 : 0xffffff;
    }
    switch (this.state) {
      case 'attack': {
        const a = this.atk!;
        if (!this.hitLanded && this.stateT >= a.hitAt) { this.hitLanded = true; landed = a; }
        this.x += this.facing * a.lunge * dt;
        if (a.anim === 'divekick') this.lift = Math.max(0, 34 - this.stateT * 110);
        if (a.anim === 'jumpkick') this.lift = Math.abs(Math.sin(Math.min(1, this.stateT / a.dur) * Math.PI)) * 40;
        if (this.stateT >= a.dur) { this.setState('idle'); this.lift = 0; }
        break;
      }
      case 'hurt':
        this.x += this.vx * dt;
        this.vx *= Math.pow(0.02, dt);
        if (this.lift > 0 || this.vy > 0) {
          this.lift = Math.max(0, this.lift + this.vy * dt);
          this.vy -= 900 * dt;
        }
        if (this.stateT >= this.hurtDur) this.setState('idle');
        break;
      case 'ko':
        this.x += this.vx * dt;
        this.lift += this.vy * dt;
        this.vy -= 1100 * dt;
        this.sprite.rotation += dt * 6;
        break;
      default:
        this.lift = Math.max(0, this.lift - 220 * dt);
        break;
    }
    // animation clock
    const fps = this.state === 'attack' && this.atk ? this.atk.fps : 8;
    this.animT += dt;
    const step = 1 / fps;
    while (this.animT >= step) {
      this.animT -= step;
      const looping = this.state === 'idle' || this.state === 'walk' || this.state === 'win';
      this.frame = looping ? (this.frame + 1) % this.anim.length : Math.min(this.frame + 1, this.anim.length - 1);
    }
    this.sprite.texture = this.anim[Math.min(this.frame, this.anim.length - 1)];
    this.sprite.scale.set(this.facing * this.sheetDir * this.baseScale, this.baseScale);
    this.root.y = -this.lift;
    return landed;
  }
}
