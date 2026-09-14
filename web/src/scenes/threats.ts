import { Container, Sprite, Texture } from 'pixi.js';
import type { Fx } from './fx';
import { edgePoint } from '../state';

interface Missile {
  root: Container;
  body: Sprite;
  aura: Sprite;
  x: number; y: number;
  vx: number; vy: number;
  speed: number;
  t: number; flight: number;
  interceptAt: number;
  // evasive steering: sum of oscillators (mean-zero) so the rocket weaves both
  // clockwise AND counter-clockwise, never a tidy predictable spiral
  turnA: number; w1: number; ph1: number;
  turnB: number; w2: number; ph2: number;
  judder: number; w3: number;
  color: number;
}

/** shortest signed difference from `a` to `b`, in (-pi, pi] */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * IDS/IPS threats (Enhanced/CyberSecure tier) are always malicious, so they
 * arrive as attack rockets inbound on the core. They fly a live-steered,
 * evasive path — weaving and jinking in both directions as they burn in, then
 * homing harder as they close — before the defense laser shoots them down.
 */
export class Threats {
  private active: Missile[] = [];

  constructor(private layer: Container, private rocket: Texture,
              private glow: Texture, private fx: Fx) {}

  count(): number { return this.active.length; }

  spawn(cx: number, cy: number, w: number, h: number, angle: number, color = 0xff9a45): void {
    // Fan the bearing out from the source-derived angle: on this network the
    // IDS always fires from the same device, so ipAngle() would pin every
    // rocket to one side. A wide random offset makes attacks come from all
    // directions while still loosely honouring the source.
    const bearing = angle + (Math.random() - 0.5) * Math.PI * 1.3;
    const { x, y } = edgePoint(cx, cy, w, h, bearing, 1.08);

    const speed = Math.min(w, h) * 0.15;
    const dist = Math.hypot(cx - x, cy - y) || 1;
    // initial velocity aims at the core, then steering takes over
    const toC = Math.atan2(cy - y, cx - x);

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
    body.rotation = toC + Math.PI / 2;
    root.addChild(aura, body);
    root.x = x; root.y = y;
    this.layer.addChild(root);

    this.active.push({
      root, body, aura, x, y,
      vx: Math.cos(toC) * speed, vy: Math.sin(toC) * speed, speed,
      t: 0, flight: dist / speed,
      interceptAt: 0.6 + Math.random() * 0.32,
      turnA: (0.5 + Math.random() * 0.9) * (Math.random() < 0.5 ? -1 : 1),
      w1: 0.7 + Math.random() * 0.9, ph1: Math.random() * Math.PI * 2,
      turnB: (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
      w2: 1.8 + Math.random() * 1.6, ph2: Math.random() * Math.PI * 2,
      judder: 0.3 + Math.random() * 0.6, w3: 5 + Math.random() * 4,
      color,
    });
  }

  /**
   * Steer every rocket along an evasive path (oscillating turn rate + core
   * homing that ramps up late), trail flame, and intercept / impact.
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

      // evasive turn rate: two slow oscillators of opposite sign + a fast
      // judder -> S-curves, barrel rolls and last-second jinks, in both
      // rotation directions, never a predictable spiral
      const turn =
        m.turnA * Math.sin(m.w1 * m.t + m.ph1) +
        m.turnB * Math.sin(m.w2 * m.t + m.ph2) +
        m.judder * Math.sin(m.w3 * m.t);

      let head = Math.atan2(m.vy, m.vx) + turn * dt;
      // home toward the core, weakly at first, hard on the final approach so
      // the attack always converges on the station
      const want = Math.atan2(cy - m.y, cx - m.x);
      head += angleDiff(head, want) * Math.min(1, (0.6 + 3.2 * p) * dt);

      m.speed *= 1 + 0.03 * dt;              // gentle throttle-up
      m.vx = Math.cos(head) * m.speed;
      m.vy = Math.sin(head) * m.speed;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.root.x = m.x; m.root.y = m.y;
      m.body.rotation = head + Math.PI / 2;

      // engine flame streams from the tail, opposite the heading
      const ex = m.x - Math.cos(head) * 16;
      const ey = m.y - Math.sin(head) * 16;
      this.fx.emit(ex, ey, 0xffb14a, 2, 26, 0.22, 0.34);
      m.aura.alpha = 0.45 + Math.sin(m.t * 20) * 0.12;

      if (m.t >= m.flight * m.interceptAt) {
        this.fx.laser(cx, cy, m.x, m.y, 0x6ef7ff, 3);
        this.fx.emit(cx, cy, 0x6ef7ff, 5, 70, 0.16, 0.3);     // muzzle flash
        this.fx.explosion(m.x, m.y, true, m.color);           // amber detonation
        this.fx.burst(m.x, m.y, m.color, 12);
        intercepts.push({ x: m.x, y: m.y });
        this.layer.removeChild(m.root); m.root.destroy(); this.active.splice(i, 1);
        continue;
      }

      if (Math.hypot(m.x - cx, m.y - cy) < 24 || m.t > m.flight + 0.8) {
        this.fx.explosion(m.x, m.y, true, m.color);           // reached the core
        impacts.push({ x: m.x, y: m.y });
        this.layer.removeChild(m.root); m.root.destroy(); this.active.splice(i, 1);
      }
    }
    return { intercepts, impacts };
  }
}
