import { Container, Graphics, Sprite, Texture } from 'pixi.js';

export type RingKind = 'dns' | 'dhcp' | 'general' | 'wifi';

interface RingDef { radius: number; color: number; every: number; cap: number; speed: number; }

// ring colors mirror the log-viewer event colors
const DEFS: Record<RingKind, RingDef> = {
  general: { radius: 0.16, color: 0x5ce6a4, every: 3, cap: 16, speed: 0.35 },
  dns:     { radius: 0.25, color: 0x55b5ff, every: 5, cap: 12, speed: -0.24 },
  dhcp:    { radius: 0.34, color: 0xffd84d, every: 8, cap: 18, speed: 0.15 },
  wifi:    { radius: 0.43, color: 0xc08cff, every: 6, cap: 10, speed: -0.1 },
};

interface RingObj { s: Sprite; angle: number; life: number; }

interface RingState {
  pulse: number;
  count: number;
  objs: RingObj[];
}

/** Three concentric orbital rings accumulating objects and pulsing on traffic. */
export class Rings {
  private g = new Graphics();
  private objLayer = new Container();
  private state: Record<RingKind, RingState> = {
    general: { pulse: 0, count: 0, objs: [] },
    dns: { pulse: 0, count: 0, objs: [] },
    dhcp: { pulse: 0, count: 0, objs: [] },
    wifi: { pulse: 0, count: 0, objs: [] },
  };

  constructor(private layer: Container, private dot: Texture,
              private w: number, private h: number) {
    layer.addChild(this.g, this.objLayer);
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; }

  activate(kind: RingKind): void {
    const def = DEFS[kind];
    const st = this.state[kind];
    st.pulse = 1;
    st.count++;
    if (st.count % def.every === 0 && st.objs.length < def.cap) {
      const s = new Sprite(this.dot);
      s.anchor.set(0.5);
      s.tint = def.color;
      s.scale.set(0.5 + Math.random() * 0.5);
      const obj: RingObj = { s, angle: Math.random() * Math.PI * 2, life: 1 };
      st.objs.push(obj);
      this.objLayer.addChild(s);
    }
  }

  update(dt: number): void {
    const cx = this.w / 2, cy = this.h / 2;
    const base = Math.min(this.w, this.h);

    this.g.clear();
    for (const kind of Object.keys(DEFS) as RingKind[]) {
      const def = DEFS[kind];
      const st = this.state[kind];
      st.pulse = Math.max(0, st.pulse - dt * 1.5);
      const radius = base * def.radius;
      this.g.circle(cx, cy, radius)
        .stroke({ width: 1 + st.pulse * 3, color: def.color, alpha: 0.16 + st.pulse * 0.5 });

      for (let i = st.objs.length - 1; i >= 0; i--) {
        const o = st.objs[i];
        o.angle += def.speed * dt;
        o.life -= dt * 0.02;   // slow fade
        if (o.life <= 0) {
          this.objLayer.removeChild(o.s);
          o.s.destroy();
          st.objs.splice(i, 1);
          continue;
        }
        o.s.x = cx + Math.cos(o.angle) * radius;
        o.s.y = cy + Math.sin(o.angle) * radius;
        o.s.alpha = Math.min(1, o.life * 2);
      }
    }
  }
}
