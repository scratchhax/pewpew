import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Fx } from './fx';

interface Puff {
  sp: Sprite;
  age: number; max: number; s0: number;
}

interface Crystal {
  s: Sprite;
  trailG: Graphics;
  trail: number[];
  mistTick: number;
  vx: number; vy: number;
  tx: number; ty: number;
  life: number;
  onArrive?: (x: number, y: number) => void;
}

/**
 * Energy crystals (allow / pass traffic) travelling between the station core
 * and the screen edge. Launch side is determined by the caller (direction).
 */
export class Crystals {
  private active: Crystal[] = [];
  private puffs: Puff[] = [];

  constructor(private layer: Container, private texture: Texture,
              private glow: Texture, private fx: Fx) {}

  /**
   * Spawn a crystal. If `inbound` it travels edge→station, else station→edge.
   * `angle` fixes the edge point (derived from the external IP hash).
   */
  spawn(cx: number, cy: number, w: number, h: number, angle: number,
        inbound: boolean, color: number, onArrive?: (x: number, y: number) => void): void {
    const radius = Math.max(w, h) * 0.55;
    const ex = cx + Math.cos(angle) * radius;
    const ey = cy + Math.sin(angle) * radius;

    const fromX = inbound ? ex : cx, fromY = inbound ? ey : cy;
    const toX = inbound ? cx : ex,   toY = inbound ? cy : ey;

    const dx = toX - fromX, dy = toY - fromY;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = Math.min(w, h) * 0.42;   // px/sec

    const s = new Sprite(this.texture);
    s.anchor.set(0.5);
    s.tint = color;
    s.scale.set(0.55);
    s.blendMode = 'add';
    s.x = fromX; s.y = fromY;

    const trailG = new Graphics();
    trailG.blendMode = 'add';
    this.layer.addChild(trailG);
    this.layer.addChild(s);

    this.active.push({
      s, trailG, trail: [],
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      tx: toX, ty: toY,
      life: dist / speed + 0.25,
      mistTick: 0,
      onArrive,
    });
  }

  /** Fire a crystal from a specific point toward the station (e.g. AP → core). */
  spawnToward(x: number, y: number, tx: number, ty: number,
              color: number, onArrive?: (x: number, y: number) => void): void {
    const dx = tx - x, dy = ty - y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = dist / 1.6;
    const s = new Sprite(this.texture);
    s.anchor.set(0.5);
    s.tint = color;
    s.scale.set(0.4);
    s.blendMode = 'add';
    s.x = x; s.y = y;

    const trailG = new Graphics();
    trailG.blendMode = 'add';
    this.layer.addChild(trailG);
    this.layer.addChild(s);
    this.active.push({
      s, trailG, trail: [],
      vx: (dx / dist) * speed, vy: (dy / dist) * speed,
      tx, ty, life: 1.9, mistTick: 0, onArrive,
    });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.life -= dt;
      c.s.x += c.vx * dt;
      c.s.y += c.vy * dt;
      c.s.rotation += dt * 3;

      // cloud / fog trail: soft expanding puffs left in the wake
      c.mistTick -= dt;
      if (c.mistTick <= 0 && this.puffs.length < 70) {
        c.mistTick = 0.07;
        const sp = new Sprite(this.glow);
        sp.anchor.set(0.5);
        sp.tint = c.s.tint;
        sp.blendMode = 'add';
        sp.x = c.s.x + (Math.random() - 0.5) * 5;
        sp.y = c.s.y + (Math.random() - 0.5) * 5;
        const s0 = 0.12 + Math.random() * 0.08;
        sp.scale.set(s0);
        sp.alpha = 0.05;
        this.layer.addChild(sp);
        this.puffs.push({ sp, age: 0, max: 0.3 + Math.random() * 0.25, s0 });
      }

      // smooth tapered contrail (bright core inside the fog)
      c.trail.push(c.s.x, c.s.y);
      if (c.trail.length > 36) c.trail.splice(0, 2);
      c.trailG.clear();
      const n = c.trail.length / 2;
      for (let j = 1; j < n; j++) {
        const f = j / n;
        c.trailG
          .moveTo(c.trail[(j - 1) * 2], c.trail[(j - 1) * 2 + 1])
          .lineTo(c.trail[j * 2], c.trail[j * 2 + 1])
          .stroke({ width: 0.5 + f * 2.4, color: c.s.tint, alpha: f * 0.45 });
      }

      const near = Math.hypot(c.s.x - c.tx, c.s.y - c.ty) < 18;
      if (c.life <= 0 || near) {
        this.fx.emit(c.s.x, c.s.y, c.s.tint, 8, 50, 0.2, 0.55);
        c.onArrive?.(c.s.x, c.s.y);
        this.layer.removeChild(c.s, c.trailG);
        c.s.destroy();
        c.trailG.destroy();
        this.active.splice(i, 1);
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const f = 1 - p.age / p.max;
      if (f <= 0) {
        this.layer.removeChild(p.sp);
        p.sp.destroy();
        this.puffs.splice(i, 1);
        continue;
      }
      p.sp.scale.set(p.s0 * (1 + p.age * 1.5));   // puff expands as it dissipates
      p.sp.alpha = 0.05 * f * f;
    }
  }
}
