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
  lastFlare: number;
}

/** Three concentric orbital rings accumulating objects and pulsing on traffic. */
export class Rings {
  private g = new Graphics();
  private objLayer = new Container();
  private state: Record<RingKind, RingState> = {
    general: { pulse: 0, count: 0, objs: [], lastFlare: 0 },
    dns: { pulse: 0, count: 0, objs: [], lastFlare: 0 },
    dhcp: { pulse: 0, count: 0, objs: [], lastFlare: 0 },
    wifi: { pulse: 0, count: 0, objs: [], lastFlare: 0 },
  };

  constructor(private layer: Container, private dot: Texture,
              private w: number, private h: number) {
    this.g.blendMode = 'add';
    layer.addChild(this.g, this.objLayer);
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; }

  activate(kind: RingKind, now: number): void {
    const def = DEFS[kind];
    const st = this.state[kind];
    // allow traffic is constant — throttle + gentler amplitude so its flare
    // reads as a slow heartbeat that fully decays between beats, instead of
    // inflow outpacing decay and pinning the green ring at max brightness
    const minGap = kind === 'general' ? 1.1 : 0.09;
    const amp = kind === 'general' ? 0.8 : 1.4;
    if (now - st.lastFlare >= minGap) {
      st.lastFlare = now;
      st.pulse = Math.min(3.0, st.pulse + amp);
    }
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

  update(dt: number, cx: number, cy: number): void {
    const base = Math.min(this.w, this.h);

    this.g.clear();
    for (const kind of Object.keys(DEFS) as RingKind[]) {
      const def = DEFS[kind];
      const st = this.state[kind];
      // glow envelope: fast attack on activate, smooth fall back to rest.
      // The ring geometry stays put — activity shows as a soft halo that
      // blooms up and fades down, the way the station core glow does,
      // rather than the ring line itself thickening / bouncing.
      st.pulse = Math.max(0, st.pulse - dt * (0.9 + st.pulse * 0.9));
      const radius = base * def.radius;
      const glow = Math.min(1, st.pulse);

      // steady base outline so the ring is always readable at rest
      this.g.circle(cx, cy, radius)
        .stroke({ width: 1.1, color: def.color, alpha: 0.15 });

      if (glow > 0.01) {
        // widening faint passes fake a gaussian bloom around the ring
        for (let k = 1; k <= 3; k++) {
          this.g.circle(cx, cy, radius)
            .stroke({ width: 1.1 + k * 7 * glow, color: def.color,
                      alpha: 0.045 * glow / k });
        }
        // bright core line riding on the halo
        this.g.circle(cx, cy, radius)
          .stroke({ width: 1.5 + glow * 2.6, color: def.color,
                    alpha: Math.min(0.95, 0.2 + glow * 0.55) });
      }

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
