import { Container, Sprite, Texture } from 'pixi.js';
import type { Fx } from './fx';

interface Asteroid {
  s: Sprite;
  vx: number; vy: number;
  spin: number;
  t: number;              // seconds alive
  flight: number;         // planned flight time
  interceptAt: number;    // fraction of flight when station shoots it
  shot: boolean;
  color: number;
}

/**
 * Blocked traffic arrives as asteroids inbound on the station; the core
 * defense laser intercepts them mid-flight.
 */
export class Asteroids {
  private active: Asteroid[] = [];

  count(): number { return this.active.length; }

  constructor(private layer: Container, private textures: Texture[], private fx: Fx) {}

  spawn(cx: number, cy: number, w: number, h: number, angle: number, color = 0xff8a80): void {
    const radius = Math.max(w, h) * 0.58;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;

    const dx = cx - x, dy = cy - y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = Math.min(w, h) * 0.16;

    const tex = this.textures[(Math.random() * this.textures.length) | 0];
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.tint = color;
    s.scale.set(0.55 + Math.random() * 0.5);
    s.x = x; s.y = y;
    this.layer.addChild(s);

    this.active.push({
      s,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      spin: (Math.random() - 0.5) * 4,
      t: 0,
      flight: dist / speed,
      interceptAt: 0.45 + Math.random() * 0.3,
      shot: false,
      color,
    });
  }

  /**
   * Advance all asteroids. Returns what happened this frame so the caller can
   * drive camera punch / screen flash / bullet-time.
   */
  update(dt: number, cx: number, cy: number): {
    intercepts: { x: number; y: number }[];
    impacts: { x: number; y: number }[];
  } {
    const intercepts: { x: number; y: number }[] = [];
    const impacts: { x: number; y: number }[] = [];

    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      a.s.x += a.vx * dt;
      a.s.y += a.vy * dt;
      a.s.rotation += a.spin * dt;

      if (!a.shot && a.t >= a.flight * a.interceptAt) {
        a.shot = true;
        this.fx.laser(cx, cy, a.s.x, a.s.y, 0x6ef7ff, 3);
        // twin shot for drama
        if (Math.random() < 0.5) this.fx.laser(cx, cy, a.s.x + 6, a.s.y - 4, 0x6ef7ff, 1.5);
        this.fx.emit(cx, cy, 0x6ef7ff, 4, 60, 0.14, 0.3);   // muzzle flash
        this.fx.explosion(a.s.x, a.s.y, false);
        intercepts.push({ x: a.s.x, y: a.s.y });
        this.layer.removeChild(a.s);
        a.s.destroy();
        this.active.splice(i, 1);
        continue;
      }

      // reached the core (missed shot) → bigger impact bang
      if (Math.hypot(a.s.x - cx, a.s.y - cy) < 26 || a.t > a.flight + 0.5) {
        this.fx.explosion(a.s.x, a.s.y, true);
        impacts.push({ x: a.s.x, y: a.s.y });
        this.layer.removeChild(a.s);
        a.s.destroy();
        this.active.splice(i, 1);
      }
    }
    return { intercepts, impacts };
  }
}
