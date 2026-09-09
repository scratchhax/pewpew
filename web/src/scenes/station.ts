import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { State } from '../state';

/** Central command station: pulsing core, rotating hex, orbiting guard dots. */
export class Station {
  private core: Sprite;
  private ringG: Graphics;
  private hexG: Graphics;
  private orbiters: Sprite[] = [];
  private pulse = 0;         // 0..1 energy flash
  private t = 0;

  constructor(private layer: Container, glow: Texture, private w: number, private h: number) {
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
    layer.addChild(this.ringG, this.hexG, this.core, ...this.orbiters);
    this.layout();
  }

  layout(): void {
    const cx = this.w / 2, cy = this.h / 2;
    this.core.x = cx; this.core.y = cy;
    this.layer.position.set(0, 0);
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; this.layout(); }

  flash(strength = 0.6): void { this.pulse = Math.min(1, this.pulse + strength); }

  update(dt: number, state: State): void {
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * 1.6);

    const cx = this.w / 2, cy = this.h / 2;
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
      const a = this.t * (0.5 + i * 0.18) + (i * Math.PI * 2) / 3;
      const rad = base * 0.06;
      o.x = cx + Math.cos(a) * rad;
      o.y = cy + Math.sin(a) * rad;
      o.tint = tint;
    });
  }
}

export function toRgb(r: number, g: number, b: number): number {
  return ((clamp01(r) * 255) << 16) | ((clamp01(g) * 255) << 8) | (clamp01(b) * 255);
}
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
