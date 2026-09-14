import { Container, Graphics, Sprite, Texture } from 'pixi.js';

interface Particle { s: Sprite; vx: number; vy: number; life: number; max: number; drag: number; grow: number; peak: number }
interface Tracer { x1: number; y1: number; x2: number; y2: number; life: number; color: number }
interface Ring { x: number; y: number; r: number; maxR: number; life: number; max: number; color: number; width: number }
interface Dash { x1: number; y1: number; x2: number; y2: number; life: number; max: number; color: number }
interface Decal { s: Sprite; age: number }

/** Gunfire lines fade over this long; a soft warm streak, no white core. */
const TRACER_LIFE = 0.22;

/**
 * Short-lived effects: additive particles, gunfire tracers, expanding rings,
 * dashed radio lines, and blood decals that stay on the ground a while.
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
    this.g.blendMode = 'add';
    layer.addChild(this.g);
  }

  emit(x: number, y: number, color: number, count: number, speed = 60, size = 0.2, life = 0.6): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) return;
      const s = this.pool.pop() ?? Object.assign(new Sprite(this.glow), { blendMode: 'add' as const });
      s.anchor.set(0.5);
      s.visible = true;
      s.x = x; s.y = y;
      s.tint = color;
      s.scale.set(size * (0.6 + Math.random() * 0.8));
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      const l = life * (0.6 + Math.random() * 0.7);
      this.particles.push({ s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, drag: 0.92, grow: 0, peak: 0.85 });
      this.layer.addChild(s);
    }
  }

  /** Muzzle glow: a small warm bloom that fades, not a bright pop. */
  flash(x: number, y: number, color = 0xffc98a, size = 0.5): void {
    if (this.particles.length >= this.maxParticles) return;
    const s = this.pool.pop() ?? Object.assign(new Sprite(this.glow), { blendMode: 'add' as const });
    s.anchor.set(0.5); s.visible = true;
    s.x = x; s.y = y; s.tint = color; s.scale.set(size * 0.35);
    this.particles.push({ s, vx: 0, vy: 0, life: 0.3, max: 0.3, drag: 1, grow: size * 0.8, peak: 0.4 });
    this.layer.addChild(s);
  }

  tracer(x1: number, y1: number, x2: number, y2: number, color = 0xffc98a): void {
    this.tracers.push({ x1, y1, x2, y2, life: TRACER_LIFE, color });
  }

  ring(x: number, y: number, color: number, maxR = 60, width = 2, life = 0.7): void {
    this.rings.push({ x, y, r: 4, maxR, life, max: life, color, width });
  }

  dash(x1: number, y1: number, x2: number, y2: number, color: number, life = 0.9): void {
    this.dashes.push({ x1, y1, x2, y2, life, max: life, color });
  }

  /** Blood on the ground; oldest decals go first once over budget. */
  splat(x: number, y: number, size = 1): void {
    if (!this.blood || this.maxDecals <= 0) return;
    const s = new Sprite(this.splats[(Math.random() * this.splats.length) | 0]);
    s.anchor.set(0.5);
    s.x = x; s.y = y;
    s.rotation = Math.random() * Math.PI * 2;
    s.scale.set((0.4 + Math.random() * 0.3) * size);
    s.alpha = 0.8;
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
      p.life -= dt;
      if (p.life <= 0) {
        this.layer.removeChild(p.s);
        p.s.visible = false;
        this.pool.push(p.s);
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= p.drag; p.vy *= p.drag;
      p.s.x += p.vx * dt; p.s.y += p.vy * dt;
      if (p.grow) p.s.scale.set(p.s.scale.x + p.grow * dt);
      p.s.alpha = Math.min(p.peak, (p.life / p.max) * 1.4);
    }

    // decals slowly dry out over ~2 minutes
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age > 90) {
        d.s.alpha = Math.max(0, 0.8 - (d.age - 90) / 40);
        if (d.s.alpha <= 0) { d.s.destroy(); this.decals.splice(i, 1); }
      }
    }
    this.trimDecals();

    const g = this.g;
    g.clear();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) { this.tracers.splice(i, 1); continue; }
      const a = t.life / TRACER_LIFE;
      g.moveTo(t.x1, t.y1).lineTo(t.x2, t.y2).stroke({ width: 2, color: t.color, alpha: 0.35 * a });
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.rings.splice(i, 1); continue; }
      r.r += (r.maxR - r.r) * Math.min(1, dt * 4);
      const a = r.life / r.max;
      g.circle(r.x, r.y, r.r).stroke({ width: r.width * a + 0.5, color: r.color, alpha: a * 0.5 });
    }
    for (let i = this.dashes.length - 1; i >= 0; i--) {
      const d = this.dashes[i];
      d.life -= dt;
      if (d.life <= 0) { this.dashes.splice(i, 1); continue; }
      const a = d.life / d.max;
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1;
      const ux = (d.x2 - d.x1) / len, uy = (d.y2 - d.y1) / len;
      const shift = ((1 - a) * 40) % 14;           // dashes crawl toward the mast
      for (let s = shift; s < len; s += 14) {
        const e = Math.min(len, s + 7);
        g.moveTo(d.x1 + ux * s, d.y1 + uy * s).lineTo(d.x1 + ux * e, d.y1 + uy * e);
      }
      g.stroke({ width: 2, color: d.color, alpha: a * 0.6 });
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
