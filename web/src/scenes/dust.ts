import { Container, Sprite, Texture } from 'pixi.js';

interface Mote { s: Sprite; vx: number; vy: number; tw: number; }

/** Slow drifting luminous space dust for depth. */
export class Dust {
  private motes: Mote[] = [];

  constructor(private layer: Container, private glow: Texture,
              private w: number, private h: number, count = 70) {
    for (let i = 0; i < count; i++) this.spawn(true);
  }

  private spawn(anywhere = false): void {
    const s = new Sprite(this.glow);
    s.anchor.set(0.5);
    s.tint = 0x9fd8ff;
    s.blendMode = 'add';
    const depth = 0.3 + Math.random() * 0.7;
    s.scale.set(0.1 + depth * 0.22);
    s.x = anywhere ? Math.random() * this.w : (Math.random() < 0.5 ? -20 : this.w + 20);
    s.y = Math.random() * this.h;
    const a = Math.random() * Math.PI * 2;
    const sp = 3 + depth * 9;
    const m: Mote = {
      s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 + 4,
      tw: Math.random() * 10,
    };
    this.motes.push(m);
    this.layer.addChild(s);
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; }

  update(dt: number, boost = 1): void {
    for (const m of this.motes) {
      m.tw += dt * 2;
      m.s.x += m.vx * dt * boost;
      m.s.y += m.vy * dt * boost;
      m.s.alpha = 0.12 + Math.sin(m.tw) * 0.09;
      if (m.s.x < -30 || m.s.x > this.w + 30 || m.s.y < -30 || m.s.y > this.h + 30) {
        this.layer.removeChild(m.s);
        m.s.destroy();
        this.motes.splice(this.motes.indexOf(m), 1);
        this.spawn();
      }
    }
  }
}
