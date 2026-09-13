import { Container, Sprite, Texture } from 'pixi.js';
import type { Fx } from './fx';
import { edgePoint } from '../state';

interface Missile {
  root: Container;
  body: Sprite;
  aura: Sprite;
  startX: number; startY: number;
  t: number; flight: number;
  interceptAt: number;
  freq: number; amp: number; phase: number;
  prevX: number; prevY: number;
  color: number;
}

/**
 * IDS/IPS threats (Enhanced/CyberSecure tier) are always malicious, so they
 * arrive as attack rockets inbound on the core. Unlike block asteroids (which
 * barrel in on a straight line) they burn in slowly, weaving hard corkscrews
 * that "zoom around" for several seconds before the defense laser shoots them
 * down close to the station — a bright, unmistakable amber intercept.
 */
export class Threats {
  private active: Missile[] = [];

  constructor(private layer: Container, private rocket: Texture,
              private glow: Texture, private fx: Fx) {}

  count(): number { return this.active.length; }

  spawn(cx: number, cy: number, w: number, h: number, angle: number, color = 0xff9a45): void {
    // Start just outside the visible edge along the attack bearing so the
    // rocket flies fully into view for the whole burn.
    const { x, y } = edgePoint(cx, cy, w, h, angle, 1.08);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    // slow burn: ~5-7s across the visible field
    const speed = Math.min(w, h) * 0.14;
    const dist = Math.hypot(cx - x, cy - y) || 1;

    const root = new Container();
    const aura = new Sprite(this.glow);
    aura.anchor.set(0.5);
    aura.tint = color;
    aura.blendMode = 'add';
    aura.scale.set(1.5);
    aura.alpha = 0.55;
    const body = new Sprite(this.rocket);
    body.anchor.set(0.5);
    body.scale.set(0.85 + Math.random() * 0.25);
    root.addChild(aura, body);
    root.x = x; root.y = y;
    this.layer.addChild(root);

    this.active.push({
      root, body, aura, startX: x, startY: y,
      t: 0, flight: dist / speed,
      interceptAt: 0.68 + Math.random() * 0.24,   // shot down close to the core
      freq: 3.5 + Math.random() * 2.5,            // broad, readable weaving
      amp: Math.min(w, h) * (0.07 + Math.random() * 0.04),
      phase: Math.random() * Math.PI * 2,
      prevX: x, prevY: y, color,
    });
  }

  /**
   * March every rocket along its weaving approach, trail flame, and intercept
   * /impact. Returns what happened this frame so the caller drives punch.
   */
  update(dt: number, cx: number, cy: number): {
    intercepts: { x: number; y: number }[];
    impacts: { x: number; y: number }[];
  } {
    const intercepts: { x: number; y: number }[] = [];
    const impacts: { x: number; y: number }[] = [];

    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.t += dt;
      const p = Math.min(1, m.t / m.flight);

      // base point drifting inward + a weaving offset that only tightens late,
      // so it keeps "zooming around" for most of the run
      const bx = m.startX + (cx - m.startX) * p;
      const by = m.startY + (cy - m.startY) * p;
      const th = m.phase + m.freq * Math.PI * 2 * p;
      const r = m.amp * (1 - 0.45 * p);
      const nx = bx + Math.cos(th) * r;
      const ny = by + Math.sin(th) * r;

      const dx = nx - m.prevX, dy = ny - m.prevY;
      const heading = Math.atan2(dy, dx) + Math.PI / 2;
      if (dx || dy) m.body.rotation = heading;
      m.root.x = nx; m.root.y = ny;
      m.prevX = nx; m.prevY = ny;

      // engine flame: exhaust streams from the tail, opposite the heading
      const ex = nx - Math.cos(heading - Math.PI / 2) * 14;
      const ey = ny - Math.sin(heading - Math.PI / 2) * 14;
      this.fx.emit(ex, ey, 0xffb14a, 2, 26, 0.22, 0.34);
      m.aura.alpha = 0.45 + Math.sin(m.t * 20) * 0.12;   // engine flicker

      if (m.t >= m.flight * m.interceptAt) {
        this.fx.laser(cx, cy, nx, ny, 0x6ef7ff, 3);
        this.fx.emit(cx, cy, 0x6ef7ff, 5, 70, 0.16, 0.3);     // muzzle flash
        this.fx.explosion(nx, ny, true, m.color);             // amber detonation
        this.fx.burst(nx, ny, m.color, 12);
        intercepts.push({ x: nx, y: ny });
        this.layer.removeChild(m.root); m.root.destroy(); this.active.splice(i, 1);
        continue;
      }

      if (Math.hypot(nx - cx, ny - cy) < 24 || m.t > m.flight + 0.6) {
        this.fx.explosion(m.root.x, m.root.y, true, m.color);   // reached the core
        impacts.push({ x: m.root.x, y: m.root.y });
        this.layer.removeChild(m.root); m.root.destroy(); this.active.splice(i, 1);
      }
    }
    return { intercepts, impacts };
  }
}
