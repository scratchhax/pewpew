import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { hash01 } from '../state';

interface StarNode { s: Sprite; halo: Sprite; lastSeen: number; vx: number; vy: number; }
interface Link { x1: number; y1: number; x2: number; y2: number; life: number; color: number; }

const MAX_STARS = 140;
// slow drift so IP stars never sit on the same pixels (LCD burn-in);
// kept gentle so the constellation reads as a lazy star map, not sliding
const DRIFT_SPEED = 7;   // px/sec baseline

/** Faint IP star field with transient src→dst connection lines. */
export class Constellation {
  private stars = new Map<string, StarNode>();
  private links: Link[] = [];
  private lineG = new Graphics();

  constructor(private layer: Container, private dot: Texture, private glow: Texture,
              private w: number, private h: number) {
    this.lineG.blendMode = 'add';
    layer.addChild(this.lineG);
  }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    // keep drifting stars inside the (possibly new) viewport
    const m = Math.min(w, h) * 0.06;
    for (const node of this.stars.values()) {
      node.s.x = Math.min(w - m, Math.max(m, node.s.x));
      node.s.y = Math.min(h - m, Math.max(m, node.s.y));
      node.halo.x = node.s.x; node.halo.y = node.s.y;
    }
  }

  private positionFor(ip: string): { x: number; y: number } {
    const h1 = hash01(ip);
    const h2 = hash01(ip + '::y');
    const margin = Math.min(this.w, this.h) * 0.08;
    return {
      x: margin + h1 * (this.w - margin * 2),
      y: margin + h2 * (this.h - margin * 2),
    };
  }

  private star(ip: string, now: number): StarNode {
    let s = this.stars.get(ip);
    if (!s) {
      const pos = this.positionFor(ip);
      const sp = new Sprite(this.dot);
      sp.anchor.set(0.5);
      sp.scale.set(0.5 + hash01(ip + 'sz') * 0.4);
      sp.tint = 0xbfe0ff;
      sp.blendMode = 'add';
      sp.x = pos.x; sp.y = pos.y;
      sp.alpha = 0;

      const halo = new Sprite(this.glow);
      halo.anchor.set(0.5);
      halo.scale.set(0.28);
      halo.tint = 0x5f8fd8;
      halo.blendMode = 'add';
      halo.x = pos.x; halo.y = pos.y;
      halo.alpha = 0;

      this.layer.addChild(halo, sp);
      const va = Math.random() * Math.PI * 2;
      const vs = DRIFT_SPEED * (0.4 + Math.random() * 0.9);
      s = { s: sp, halo, lastSeen: now,
            vx: Math.cos(va) * vs, vy: Math.sin(va) * vs };
      this.stars.set(ip, s);
      if (this.stars.size > MAX_STARS) {
        let oldestKey = ''; let oldest = Infinity;
        for (const [k, v] of this.stars) if (v.lastSeen < oldest) { oldest = v.lastSeen; oldestKey = k; }
        const old = this.stars.get(oldestKey);
        if (old) {
          this.layer.removeChild(old.s, old.halo);
          old.s.destroy(); old.halo.destroy();
          this.stars.delete(oldestKey);
        }
      }
    }
    s.lastSeen = now;
    return s;
  }

  /** Visible star node position for an IP (created if new) — laser endpoints. */
  starPosition(ip: string): { x: number; y: number } {
    const node = this.star(ip, performance.now());
    return { x: node.s.x, y: node.s.y };
  }

  connect(src: string, dst: string, color: number): void {
    const a = this.star(src, performance.now());
    const b = this.star(dst, performance.now());
    this.links.push({ x1: a.s.x, y1: a.s.y, x2: b.s.x, y2: b.s.y, life: 1.6, color });
    if (this.links.length > 240) this.links.splice(0, this.links.length - 240);
  }

  update(dt: number): void {
    const now = performance.now();
    const m = Math.min(this.w, this.h) * 0.06;
    for (const node of this.stars.values()) {
      // lazy drift with soft bounce off the margins — no fixed star pixels
      node.s.x += node.vx * dt;
      node.s.y += node.vy * dt;
      if (node.s.x < m) { node.s.x = m; node.vx = Math.abs(node.vx); }
      else if (node.s.x > this.w - m) { node.s.x = this.w - m; node.vx = -Math.abs(node.vx); }
      if (node.s.y < m) { node.s.y = m; node.vy = Math.abs(node.vy); }
      else if (node.s.y > this.h - m) { node.s.y = this.h - m; node.vy = -Math.abs(node.vy); }
      node.halo.x = node.s.x; node.halo.y = node.s.y;

      const since = (now - node.lastSeen) / 1000;
      const target = since < 8 ? 1 : Math.max(0.15, 1 - (since - 8) * 0.05);
      node.s.alpha += (target - node.s.alpha) * Math.min(1, dt * 2);
      node.halo.alpha += (target * 0.4 - node.halo.alpha) * Math.min(1, dt * 2);
    }

    if ((window as any).__diag) {
      (window as any).__diagLinks = this.links.map(l =>
        [l.x1 | 0, l.y1 | 0, l.x2 | 0, l.y2 | 0]);
    }
    this.lineG.clear();
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      l.life -= dt;
      if (l.life <= 0) { this.links.splice(i, 1); continue; }
      this.lineG.moveTo(l.x1, l.y1).lineTo(l.x2, l.y2)
        .stroke({ width: 1.5, color: l.color, alpha: Math.min(0.75, l.life * 0.5) });
    }
  }
}
