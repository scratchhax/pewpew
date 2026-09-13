import { Container, Sprite, Texture } from 'pixi.js';
import type { Fx } from './fx';

interface Missile {
  s: Sprite;
  startX: number; startY: number;
  t: number; flight: number;
  interceptAt: number;
  shot: boolean;
  freq: number; amp: number; phase: number;
  prevX: number; prevY: number;
  color: number;
}

/**
 * IDS/IPS threats (Enhanced/CyberSecure tier) are always malicious, so they
 * arrive as attacks inbound on the core — but unlike block asteroids (which
 * barrel in on a straight line) they fly a looping corkscrew that tightens as
 * it closes, signalling a more sophisticated attack. The defense laser still
 * shoots them down mid-flight, amber explosion instead of red.
 */
export class Threats {
  private active: Missile[] = [];
  private trailTick = 0;

  constructor(private layer: Container, private textures: Texture[], private fx: Fx) {}

  count(): number { return this.active.length; }

  spawn(cx: number, cy: number, w: number, h: number, angle: number, color = 0xff9a45): void {
    const radius = Math.max(w, h) * 0.6;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const speed = Math.min(w, h) * 0.21;            // a touch faster than rocks
    const dist = Math.hypot(cx - x, cy - y) || 1;

    const s = new Sprite(this.textures[(Math.random() * this.textures.length) | 0]);
    s.anchor.set(0.5);
    s.tint = color;
    s.scale.set(0.32 + Math.random() * 0.22);
    s.x = x; s.y = y;
    this.layer.addChild(s);

    this.active.push({
      s, startX: x, startY: y,
      t: 0, flight: dist / speed,
      interceptAt: 0.4 + Math.random() * 0.35,
      shot: false,
      freq: 2.5 + Math.random() * 2.5,              // loops across the approach
      amp: Math.min(w, h) * (0.05 + Math.random() * 0.05),  // ~24–46px loops
      phase: Math.random() * Math.PI * 2,
      prevX: x, prevY: y, color,
    });
  }

  /**
   * March every missile along its tightening corkscrew and intercept/impact.
   * Returns what happened this frame so the caller drives punch / slowmo.
   */
  update(dt: number, cx: number, cy: number): {
    intercepts: { x: number; y: number }[];
    impacts: { x: number; y: number }[];
  } {
    const intercepts: { x: number; y: number }[] = [];
    const impacts: { x: number; y: number }[] = [];
    this.trailTick++;
    const emitTrail = (this.trailTick & 1) === 0;    // trail every other frame

    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.t += dt;
      const p = Math.min(1, m.t / m.flight);

      // base point drifting inward + a shrinking circular offset = corkscrew
      const bx = m.startX + (cx - m.startX) * p;
      const by = m.startY + (cy - m.startY) * p;
      const th = m.phase + m.freq * Math.PI * 2 * p;
      const r = m.amp * (1 - p);
      const nx = bx + Math.cos(th) * r;
      const ny = by + Math.sin(th) * r;

      const dx = nx - m.prevX, dy = ny - m.prevY;
      if (dx || dy) m.s.rotation = Math.atan2(dy, dx) + Math.PI / 2;
      m.prevX = nx; m.prevY = ny; m.s.x = nx; m.s.y = ny;
      if (emitTrail) this.fx.emit(nx, ny, m.color, 1, 16, 0.26, 0.5);

      if (!m.shot && m.t >= m.flight * m.interceptAt) {
        m.shot = true;
        this.fx.laser(cx, cy, nx, ny, 0x6ef7ff, 2.5);
        this.fx.emit(cx, cy, 0x6ef7ff, 4, 60, 0.14, 0.3);   // muzzle flash
        this.fx.explosion(nx, ny, false, m.color);          // amber detonation
        this.fx.burst(nx, ny, m.color, 8);
        intercepts.push({ x: nx, y: ny });
        this.layer.removeChild(m.s); m.s.destroy(); this.active.splice(i, 1);
        continue;
      }

      if (Math.hypot(nx - cx, ny - cy) < 24 || m.t > m.flight + 0.6) {
        this.fx.explosion(m.s.x, m.s.y, true, m.color);     // reached the core
        impacts.push({ x: m.s.x, y: m.s.y });
        this.layer.removeChild(m.s); m.s.destroy(); this.active.splice(i, 1);
      }
    }
    return { intercepts, impacts };
  }
}
