import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { State } from '../state';

/** Central command station: pulsing core, rotating hex, orbiting guard dots. */
export class Station {
  private glowTex: Texture;
  private cloudLayer = new Container();
  private clouds: { s: Sprite; life: number; ox?: number; oy?: number }[] = [];
  private core: Sprite;
  private ringG: Graphics;
  private hexG: Graphics;
  private orbiters: Sprite[] = [];
  private pulse = 0;         // 0..1 energy flash
  private t = 0;
  private phi1 = Math.random() * Math.PI * 2;   // flight pattern, unique per boot
  private phi2 = Math.random() * Math.PI * 2;
  readonly center = { x: 0, y: 0 };

  constructor(private layer: Container, glow: Texture, private w: number, private h: number) {
    this.glowTex = glow;
    this.core = new Sprite(glow);
    this.core.anchor.set(0.5);
    this.core.scale.set(2.3);
    this.core.tint = 0x35e0ff;
    this.core.alpha = 0.75;
    this.core.blendMode = 'add';

    this.ringG = new Graphics();
    this.hexG = new Graphics();

    for (let i = 0; i < 3; i++) {
      const o = new Sprite(glow);
      o.anchor.set(0.5);
      o.scale.set(0.22);
      o.tint = 0x9ff3ff;
      this.orbiters.push(o);
    }
    layer.addChild(this.cloudLayer, this.ringG, this.hexG, this.core, ...this.orbiters);
    this.layout();
  }

  layout(): void {
    this.center.x = this.w / 2;
    this.center.y = this.h / 2;
    this.layer.position.set(0, 0);
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; this.layout(); }

  flash(strength = 0.6): void { this.pulse = Math.min(1, this.pulse + strength); }

  /** Soft event-colored cloud blooming around the core, drifting outward. */
  eventCloud(color: number): void {
    let c: { s: Sprite; life: number; ox?: number; oy?: number };
    if (this.clouds.length < 5) {
      const sp = new Sprite(this.glowTex);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      this.cloudLayer.addChild(sp);
      c = { s: sp, life: 0 };
      this.clouds.push(c);
    } else {
      c = this.clouds[(this.cloudIdx++) % this.clouds.length];
    }
    c.s.tint = color;
    c.life = 1;
    // seed offset so concurrent clouds don't stack dead-center
    const a = Math.random() * Math.PI * 2;
    c.ox = Math.cos(a) * 18; c.oy = Math.sin(a) * 14;
  }
  private cloudIdx = 0;

  update(dt: number, state: State): void {
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * 1.6);

    // Lissajous roam: prime-ratio periods never visibly loop; storms add
    // smooth turbulence on top of the lazy drift
    const heat = state.heat ?? 0;
    const roamX = 0.20 * this.w * Math.sin((2 * Math.PI * this.t) / 47 + this.phi1);
    const roamY = 0.14 * this.h * Math.sin((2 * Math.PI * this.t) / 71 + this.phi2);
    const turb = heat * 10;
    this.center.x = this.w / 2 + roamX
      + Math.sin(this.t * 3.1) * turb + Math.sin(this.t * 5.3) * turb * 0.6;
    this.center.y = this.h / 2 + roamY
      + Math.sin(this.t * 4.3) * turb + Math.sin(this.t * 2.6) * turb * 0.6;
    const cx = this.center.x, cy = this.center.y;
    const threat = state.threat;

    // threat tint: cyan → amber → red
    const r = threat < 0.5 ? 0.2 + threat * 1.2 : 1;
    const g = threat < 0.5 ? 0.88 - threat * 0.5 : 0.35 - (threat - 0.5) * 0.55;
    const tint = toRgb(r, Math.max(0.1, g), 0.35 * (1 - threat));

    const breathe = 1 + Math.sin(this.t * 2.2) * 0.05 + this.pulse * 0.5
                    + state.energy * 0.35;
    this.core.scale.set(2.3 * breathe);
    this.core.tint = tint;
    this.core.alpha = 0.75 + this.pulse * 0.25;

    const base = Math.min(this.w, this.h);

    this.ringG.clear();
    for (let i = 1; i <= 3; i++) {
      this.ringG.circle(cx, cy, base * 0.045 * i)
        .stroke({ width: 1.4, color: tint, alpha: 0.5 - i * 0.1 });
    }

    this.hexG.clear();
    const hr = base * 0.022;
    const rot = this.t * 0.4;
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      pts.push(cx + Math.cos(a) * hr, cy + Math.sin(a) * hr);
    }
    this.hexG.poly(pts).stroke({ width: 2, color: 0xbff6ff, alpha: 0.85 });

    this.orbiters.forEach((o, i) => {
      const a = this.t * (0.5 + i * 0.18) * (1 + heat * 1.5) + (i * Math.PI * 2) / 3;
      const rad = base * 0.06;
      o.x = cx + Math.cos(a) * rad;
      o.y = cy + Math.sin(a) * rad;
      o.tint = tint;
    });

    // event clouds: bloom outward and dissolve
    for (const c of this.clouds) {
      if (c.life <= 0) { c.s.alpha = 0; continue; }
      c.life = Math.max(0, c.life - dt * 1.1);
      const grow = 1 - c.life;
      c.s.x = cx + (c.ox ?? 0) * grow * 2.2;
      c.s.y = cy + (c.oy ?? 0) * grow * 2.2;
      c.s.scale.set(2.6 + grow * 4.2);
      c.s.alpha = c.life * 0.30;
    }
  }
}

export function toRgb(r: number, g: number, b: number): number {
  return ((clamp01(r) * 255) << 16) | ((clamp01(g) * 255) << 8) | (clamp01(b) * 255);
}
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
