import { Container, Sprite, Texture } from 'pixi.js';

interface Drifter {
  s: Sprite;
  vx: number; vy: number;
  bob: number; phase: number;
  baseScaleY: number;
}

/** Slow background freighters drifting in from all directions. */
export class AmbientShips {
  private drifters: Drifter[] = [];

  constructor(private layer: Container, textures: Texture[],
              private w: number, private h: number) {
    const pool = [...textures];
    for (let i = pool.length - 1; i > 0; i--) {   // shuffle the roster
      const j = (Math.random() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < 8; i++) {
      const s = new Sprite(pool[i % pool.length]);
      s.anchor.set(0.5);
      const depth = 0.4 + Math.random() * 0.6;
      const sc = 0.55 * depth + 0.38;
      s.scale.set(sc);
      s.alpha = 0.25 + depth * 0.3;

      const th = Math.random() * Math.PI * 2;          // heading: anywhere
      const sp = 8 + depth * 18;
      const d: Drifter = {
        s,
        vx: Math.cos(th) * sp,
        vy: Math.sin(th) * sp * 0.8,
        bob: 3 + Math.random() * 5,
        phase: Math.random() * 10,
        baseScaleY: sc,
      };
      s.x = Math.random() * w;
      s.y = Math.random() * h;
      this.face(d, th);
      this.drifters.push(d);
      layer.addChild(s);
    }
  }

  private face(d: Drifter, th: number): void {
    // nose along the velocity vector; sailing leftward mirrors the hull
    // horizontally (keel stays down) so tops never end up on the bottom
    const leftward = Math.cos(th) < 0;
    d.s.scale.x = leftward ? -d.baseScaleY : d.baseScaleY;
    d.s.scale.y = d.baseScaleY;
    d.s.rotation = leftward ? th - Math.PI : th;
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; }

  update(dt: number, boost = 1): void {
    const M = 140;
    for (const d of this.drifters) {
      d.phase += dt;
      d.s.x += d.vx * dt * boost;
      d.s.y += (d.vy + Math.sin(d.phase * 0.5) * d.bob) * dt * boost;
      // toroidal wrap so ships can cross on any vector
      if (d.s.x > this.w + M) d.s.x = -M;
      if (d.s.x < -M) d.s.x = this.w + M;
      if (d.s.y > this.h + M) d.s.y = -M;
      if (d.s.y < -M) d.s.y = this.h + M;
    }
  }
}
