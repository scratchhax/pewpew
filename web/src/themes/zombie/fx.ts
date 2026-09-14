import { Container, Graphics, Sprite, Texture } from 'pixi.js';

interface Particle { s: Sprite; vx: number; vy: number; age: number; life: number; drag: number; peak: number }
interface Tracer { x1: number; y1: number; x2: number; y2: number; age: number; color: number }
interface Ring { x: number; y: number; r: number; maxR: number; age: number; life: number; color: number; width: number }
interface Dash { x1: number; y1: number; x2: number; y2: number; age: number; life: number; color: number }
interface Decal { s: Sprite; age: number }

/** Gunfire streaks rise and fall over this long. */
const TRACER_LIFE = 0.35;

/**
 * Soft in-and-out envelope for effects: 0 at birth, 1 at the middle, 0 at the
 * end. Nothing in this theme appears at full strength in a single frame.
 */
function envelope(age: number, life: number): number {
  const p = Math.max(0, Math.min(1, age / life));
  return Math.sin(Math.PI * p);
}

/**
 * Short-lived effects: soft (non-glowing) particles, gunfire streaks,
 * expanding rings, dashed radio lines, and blood decals that stay a while.
 * No additive blending and no pops: every effect fades in and back out, so
 * small things never twinkle against the dark.
 */
export class Fx {
  private particles: Particle[] = [];
  private pool: Sprite[] = [];
  private tracers: Tracer[] = [];
  private rings: Ring[] = [];
  private dashes: Dash[] = [];
  private decals: Decal[] = [];
  private g = new Graphics();
  maxParticles = 3000;
  maxDecals = 140;
  blood = true;

  constructor(private layer: Container, private decalLayer: Container,
              private glow: Texture, private splats: Texture[]) {
    layer.addChild(this.g);
  }

  emit(x: number, y: number, color: number, count: number, speed = 60, size = 0.2, life = 0.6): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) return;
      const s = this.pool.pop() ?? new Sprite(this.glow);
      s.anchor.set(0.5);
      s.visible = true;
      s.alpha = 0;
      s.x = x; s.y = y;
      s.tint = color;
      s.scale.set(size * (0.6 + Math.random() * 0.8));
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      const l = life * (0.8 + Math.random() * 0.6);
      this.particles.push({ s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: l, drag: 0.92, peak: 0.55 });
      this.layer.addChild(s);
    }
  }

  tracer(x1: number, y1: number, x2: number, y2: number, color = 0xd8b48a): void {
    this.tracers.push({ x1, y1, x2, y2, age: 0, color });
  }

  ring(x: number, y: number, color: number, maxR = 60, width = 2, life = 0.9): void {
    this.rings.push({ x, y, r: maxR * 0.3, maxR, age: 0, life: Math.max(life, 0.9), color, width });
  }

  dash(x1: number, y1: number, x2: number, y2: number, color: number, life = 1.2): void {
    this.dashes.push({ x1, y1, x2, y2, age: 0, life, color });
  }

  /** Blood on the ground; oldest decals go first once over budget. */
  splat(x: number, y: number, size = 1): void {
    if (!this.blood || this.maxDecals <= 0) return;
    const s = new Sprite(this.splats[(Math.random() * this.splats.length) | 0]);
    s.anchor.set(0.5);
    s.x = x; s.y = y;
    s.rotation = Math.random() * Math.PI * 2;
    s.scale.set((0.4 + Math.random() * 0.3) * size);
    s.alpha = 0;
    this.decalLayer.addChild(s);
    this.decals.push({ s, age: 0 });
    this.trimDecals();
  }

  clearDecals(): void {
    for (const d of this.decals) d.s.destroy();
    this.decals = [];
  }

  private trimDecals(): void {
    while (this.decals.length > this.maxDecals) this.decals.shift()!.s.destroy();
  }

  count(): number { return this.particles.length; }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.layer.removeChild(p.s);
        p.s.visible = false;
        this.pool.push(p.s);
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= p.drag; p.vy *= p.drag;
      p.s.x += p.vx * dt; p.s.y += p.vy * dt;
      p.s.alpha = p.peak * envelope(p.age, p.life);
    }

    // decals soak in over half a second, then slowly dry out over ~2 minutes
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      d.s.alpha = d.age < 0.5 ? 0.8 * (d.age / 0.5) : Math.max(0, 0.8 - Math.max(0, d.age - 90) / 40);
      if (d.age > 90 && d.s.alpha <= 0) { d.s.destroy(); this.decals.splice(i, 1); }
    }
    this.trimDecals();

    const g = this.g;
    g.clear();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.age += dt;
      if (t.age >= TRACER_LIFE) { this.tracers.splice(i, 1); continue; }
      g.moveTo(t.x1, t.y1).lineTo(t.x2, t.y2)
        .stroke({ width: 1.5, color: t.color, alpha: 0.3 * envelope(t.age, TRACER_LIFE) });
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.life) { this.rings.splice(i, 1); continue; }
      r.r += (r.maxR - r.r) * Math.min(1, dt * 2.5);
      g.circle(r.x, r.y, r.r).stroke({ width: r.width, color: r.color, alpha: 0.4 * envelope(r.age, r.life) });
    }
    for (let i = this.dashes.length - 1; i >= 0; i--) {
      const d = this.dashes[i];
      d.age += dt;
      if (d.age >= d.life) { this.dashes.splice(i, 1); continue; }
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1;
      const ux = (d.x2 - d.x1) / len, uy = (d.y2 - d.y1) / len;
      const shift = (d.age * 30) % 14;           // dashes crawl toward the mast
      for (let s = shift; s < len; s += 14) {
        const e = Math.min(len, s + 7);
        g.moveTo(d.x1 + ux * s, d.y1 + uy * s).lineTo(d.x1 + ux * e, d.y1 + uy * e);
      }
      g.stroke({ width: 2, color: d.color, alpha: 0.5 * envelope(d.age, d.life) });
    }
  }
}

/**
 * Set a sprite's alpha and skip drawing it when it's effectively invisible.
 * PixiJS still draws alpha-0 sprites, and the big additive light quads (tower
 * cones, flashlights, fog) cost real fill time on a Pi even when unseen.
 */
export function fade(s: Container, alpha: number): void {
  s.alpha = alpha;
  s.visible = alpha > 0.004;
}
