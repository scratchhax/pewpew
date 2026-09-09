import { Container, Graphics, Sprite, Texture } from 'pixi.js';

export interface Particle {
  s: Sprite;
  vx: number; vy: number;
  life: number;       // seconds remaining
  decay: number;      // alpha fade rate
  drag: number;
  grow?: number;      // scale growth per second (core flashes)
}

interface Debris {
  s: Sprite;
  vx: number; vy: number;
  spin: number;
  life: number;
}

export interface Laser {
  x1: number; y1: number; x2: number; y2: number;
  life: number; color: number; width: number;
}

interface Shockwave {
  x: number; y: number; r: number; maxR: number;
  life: number; maxLife: number; color: number; width: number;
}

/** Shared particle pool + laser flashes drawn into the fx layer. */
export class Fx {
  private particles: Particle[] = [];
  private debris: Debris[] = [];
  private lasers: Laser[] = [];
  private shocks: Shockwave[] = [];
  private laserG = new Graphics();
  private pool: Sprite[] = [];
  private chunkPool: Sprite[] = [];
  private chunks: Texture[];

  constructor(private layer: Container, private glow: Texture, private max: number,
              chunkTextures: Texture[] = []) {
    this.chunks = chunkTextures;
    this.laserG.blendMode = 'add';
    layer.addChild(this.laserG);
  }

  resize(): void { /* layer is full-screen; nothing to do */ }

  private take(): Sprite | null {
    if (this.particles.length >= this.max) return null;
    const s = this.pool.pop() ?? (() => {
      const sp = new Sprite(this.glow);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      return sp;
    })();
    s.visible = true;
    return s;
  }

  emit(x: number, y: number, color: number, count: number,
       speed = 60, size = 0.25, life = 0.8): void {
    for (let i = 0; i < count; i++) {
      const s = this.take();
      if (!s) return;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      s.x = x; s.y = y;
      s.tint = color;
      s.scale.set(size * (0.6 + Math.random() * 0.8));
      s.alpha = 1;
      this.particles.push({
        s, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: life * (0.6 + Math.random() * 0.7), decay: 1.6, drag: 0.92,
      });
      this.layer.addChild(s);
    }
  }

  explosion(x: number, y: number, big = false, tint = 0xff8a3d): void {
    // blinding core flash that pops and dies fast
    const core = this.take();
    if (core) {
      core.x = x; core.y = y;
      core.tint = 0xfff8e0;
      core.scale.set(0.2);
      core.alpha = 1;
      this.particles.push({
        s: core, vx: 0, vy: 0,
        life: big ? 0.32 : 0.2, decay: 4, drag: 1, grow: big ? 5.5 : 3.2,
      });
      this.layer.addChild(core);
    }
    // hot spark burst: white → yellow → tint
    this.emit(x, y, 0xffffff, big ? 14 : 6, big ? 280 : 150, 0.16, 0.4);
    this.emit(x, y, 0xffd76a, big ? 24 : 10, big ? 200 : 110, 0.22, 0.7);
    this.emit(x, y, tint, big ? 36 : 16, big ? 170 : 90, 0.3, 1.0);
    // lingering embers
    this.emit(x, y, 0xff6a2a, big ? 26 : 8, big ? 55 : 28, 0.26, 2.2);
    // spinning debris chunks
    if (this.chunks.length > 0) {
      const n = big ? 8 : 4;
      for (let i = 0; i < n; i++) {
        const tex = this.chunks[(Math.random() * this.chunks.length) | 0];
        const sp = this.chunkPool.pop() ?? new Sprite(tex);
        sp.texture = tex;
        sp.anchor.set(0.5);
        sp.blendMode = 'normal';
        sp.tint = 0xffffff;
        sp.x = x; sp.y = y;
        sp.scale.set(0.12 + Math.random() * 0.14);
        sp.alpha = 1;
        const a = Math.random() * Math.PI * 2;
        const v = (big ? 120 : 70) * (0.4 + Math.random());
        this.layer.addChild(sp);
        this.debris.push({
          s: sp, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          spin: (Math.random() - 0.5) * 9, life: big ? 2.2 : 1.4,
        });
      }
    }
    this.shockwave(x, y, big ? 0xffb056 : 0xffd8a8, big ? 200 : 90, big ? 3.5 : 2);
  }

  /** Colored burst for non-explosive events (crystal arrivals etc.). */
  burst(x: number, y: number, color: number, count = 10): void {
    this.emit(x, y, 0xffffff, Math.max(2, count / 3) | 0, 90, 0.12, 0.3);
    this.emit(x, y, color, count, 110, 0.18, 0.65);
    this.shockwave(x, y, color, 70, 1.6);
  }

  shockwave(x: number, y: number, color: number, maxR = 120, width = 3): void {
    this.shocks.push({ x, y, r: 6, maxR, life: 0.7, maxLife: 0.7, color, width });
  }

  laser(x1: number, y1: number, x2: number, y2: number, color = 0x6ef7ff, width = 2.5): void {
    this.lasers.push({ x1, y1, x2, y2, life: 0.22, color, width });
  }

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
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      if (p.grow) p.s.scale.set(p.s.scale.x + p.grow * dt);
      p.s.alpha = Math.min(1, p.life * p.decay);
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.layer.removeChild(d.s);
        this.chunkPool.push(d.s);
        this.debris.splice(i, 1);
        continue;
      }
      d.vx *= 0.985; d.vy *= 0.985;
      d.s.x += d.vx * dt;
      d.s.y += d.vy * dt;
      d.s.rotation += d.spin * dt;
      d.s.alpha = Math.min(1, d.life * 1.2);
    }

    this.laserG.clear();
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.life -= dt;
      if (l.life <= 0) { this.lasers.splice(i, 1); continue; }
      this.laserG.moveTo(l.x1, l.y1).lineTo(l.x2, l.y2)
        .stroke({ width: l.width * 2.5, color: l.color, alpha: Math.min(0.25, l.life * 1.2) });
      this.laserG.moveTo(l.x1, l.y1).lineTo(l.x2, l.y2)
        .stroke({ width: l.width, color: 0xffffff, alpha: Math.min(1, l.life * 5) });
    }

    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.life -= dt;
      if (s.life <= 0) { this.shocks.splice(i, 1); continue; }
      s.r += (s.maxR - s.r) * Math.min(1, dt * 8);
      const a = s.life / s.maxLife;
      this.laserG.circle(s.x, s.y, s.r)
        .stroke({ width: s.width * a + 0.5, color: s.color, alpha: a * 0.8 });
    }
  }
}
