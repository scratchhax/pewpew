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

// a soft glow blob that sits on the ring circumference (the "fog" wrap)
interface FogBlob { s: Sprite; angle: number; phase: number; }

interface RingState {
  pulse: number;
  count: number;
  objs: RingObj[];
  fog: FogBlob[];
  fogRot: number;
  lastFlare: number;
}

/** Concentric orbital rings wrapped in a soft glow that blooms on traffic. */
export class Rings {
  private g = new Graphics();
  private objLayer = new Container();
  private fogLayer = new Container();
  private state: Record<RingKind, RingState> = {
    general: { pulse: 0, count: 0, objs: [], fog: [], fogRot: 0, lastFlare: 0 },
    dns: { pulse: 0, count: 0, objs: [], fog: [], fogRot: 0, lastFlare: 0 },
    dhcp: { pulse: 0, count: 0, objs: [], fog: [], fogRot: 0, lastFlare: 0 },
    wifi: { pulse: 0, count: 0, objs: [], fog: [], fogRot: 0, lastFlare: 0 },
  };

  constructor(private layer: Container, private dot: Texture, private glow: Texture,
              private w: number, private h: number) {
    this.g.blendMode = 'add';
    this.fogLayer.blendMode = 'add';
    layer.addChild(this.fogLayer, this.g, this.objLayer);
    this.rebuildFog();
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; this.rebuildFog(); }

  /** Distribute soft glow blobs around each ring so the whole circle can be
   *  wrapped in the same fog/cloud that makes the station core bloom. */
  private rebuildFog(): void {
    const base = Math.min(this.w, this.h);
    for (const kind of Object.keys(DEFS) as RingKind[]) {
      const st = this.state[kind];
      const def = DEFS[kind];
      const radius = base * def.radius;
      // enough blobs to read as continuous fog, sized to overlap
      const n = Math.max(10, Math.min(40, Math.round(radius / 20)));
      // clear old fog sprites for this ring
      for (const f of st.fog) { this.fogLayer.removeChild(f.s); f.s.destroy(); }
      st.fog = [];
      for (let i = 0; i < n; i++) {
        const s = new Sprite(this.glow);
        s.anchor.set(0.5);
        s.tint = def.color;
        s.blendMode = 'add';
        s.alpha = 0;
        // blob diameter ~ a touch over the arc spacing so neighbours blend
        const spacing = (2 * Math.PI * radius) / n;
        s.scale.set((spacing * 2.4) / 64);
        this.fogLayer.addChild(s);
        st.fog.push({ s, angle: (i / n) * Math.PI * 2, phase: Math.random() * Math.PI * 2 });
      }
    }
  }

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

    for (const kind of Object.keys(DEFS) as RingKind[]) {
      const def = DEFS[kind];
      const st = this.state[kind];
      // glow envelope: fast attack on activate, smooth fall back to rest.
      // The ring geometry stays put — activity shows as a soft fog that
      // blooms up and fades away, the same effect the station core uses.
      st.pulse = Math.max(0, st.pulse - dt * (0.9 + st.pulse * 0.9));
      const radius = base * def.radius;
      const glow = Math.min(1, st.pulse);

      // wrap the ring in the soft glow fog: brightness rides the envelope,
      // with a slow shimmer so it breathes like a living cloud
      st.fogRot += dt * def.speed * 0.25;
      for (const f of st.fog) {
        const a = f.angle + st.fogRot;
        f.s.x = cx + Math.cos(a) * radius;
        f.s.y = cy + Math.sin(a) * radius;
        const shimmer = 0.82 + 0.18 * Math.sin(this.t * 0.8 + f.phase);
        f.s.alpha = (0.05 + glow * 0.5) * shimmer;
      }
    }
    this.t += dt;

    // crisp ring outlines drawn on top of the fog
    this.g.clear();
    for (const kind of Object.keys(DEFS) as RingKind[]) {
      const def = DEFS[kind];
      const st = this.state[kind];
      const radius = base * def.radius;
      const glow = Math.min(1, st.pulse);
      // steady base outline so the ring stays readable at rest, a touch
      // brighter when the fog is blooming
      this.g.circle(cx, cy, radius)
        .stroke({ width: 1.1 + glow * 1.6, color: def.color,
                  alpha: 0.16 + glow * 0.35 });

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
  private t = 0;
}
