import { Container, Sprite, Texture } from 'pixi.js';
import type { Settings } from '../settings';
import type { State } from '../state';

interface Star { s: Sprite; speed: number; vx: number; baseAlpha: number; phase: number; tw: number; }
interface Nebula extends Sprite {
  vx: number; vy: number; pulse: number; baseScale: number; spin: number;
}

const NEBULA_COLORS = [
  0x7b3fbf, 0x2f6fd8, 0xd84a7a, 0x5f2fae,
  0x4a55e8, 0xb03fae, 0x2fa8d8,
];

export class Starfield {
  private stars: Star[] = [];
  private nebulae: Nebula[] = [];

  /**
   * Scroll speed multiplier driven by the event rate.
   * Hysteresis: rises within ~2s of a traffic spike, decays over ~15s;
   * a deadband prevents jitter around the threshold.
   */
  private speedFactor = 0.22;

  constructor(private layer: Container, private glow: Texture, private dot: Texture,
              private clouds: Texture[],
              private w: number, private h: number, private settings: Settings) {
    this.rebuild();
  }

  rebuild(): void {
    this.layer.removeChildren();
    this.stars = [];
    this.nebulae = [];
    if (this.settings.starfield) {
      const n = Math.min(340, Math.floor((this.w * this.h) / 6500));
      for (let i = 0; i < n; i++) {
        const s = new Sprite(this.dot);
        s.anchor.set(0.5);
        s.x = this.w * (0.22 + Math.random() * 0.56);
        s.y = this.h * (0.24 + Math.random() * 0.48);
        const depth = 0.3 + Math.random() * 0.7;
        s.scale.set(0.14 + depth * 0.34);      // pinpoints, not snowflakes
        s.blendMode = 'add';
        const baseAlpha = 0.3 + depth * 0.65;
        s.alpha = baseAlpha;
        this.stars.push({
          s,
          speed: 2 + depth * 11,               // slow gentle drift at factor 1
          vx: (Math.random() * 0.7 - 0.35),    // diagonal, not straight rain
          baseAlpha,
          phase: Math.random() * Math.PI * 2,
          tw: 0.4 + Math.random() * 1.2,
        });
        this.layer.addChild(s);
      }
    }
    if (this.settings.nebula) {
      for (let i = 0; i < 7; i++) {
        const s = new Sprite(this.clouds[i % this.clouds.length]) as Nebula;
        s.anchor.set(0.5);
        s.x = this.w * (0.22 + Math.random() * 0.56);
        s.y = this.h * (0.24 + Math.random() * 0.48);
        s.baseScale = 2.4 + Math.random() * 2.2;   // 256px cloud → 600-1150px
        s.scale.set(s.baseScale);
        s.tint = NEBULA_COLORS[i % NEBULA_COLORS.length];
        s.alpha = 0.12;
        s.blendMode = 'add';
        s.vx = (Math.random() - 0.5) * 3;
        s.vy = (Math.random() - 0.5) * 2;
        s.pulse = Math.random() * 10;
        s.spin = (Math.random() - 0.5) * 0.06;
        this.nebulae.push(s);
        this.layer.addChild(s);
      }
    }
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; this.rebuild(); }

  private t = 0;

  update(dt: number, state: State): void {
    this.t += dt;

    // event-rate-driven speed with hysteresis
    const rate = state.rate30s;
    const target = Math.min(2.4, 0.18 + Math.pow(rate / 45, 1.25) * 1.9);
    const d = target - this.speedFactor;
    if (Math.abs(d) > 0.03) {                       // deadband
      const k = d > 0 ? 0.9 : 0.12;                 // ramp up fast, drift down slow
      this.speedFactor += d * Math.min(1, dt * k);
    }
    const boost = this.speedFactor;

    for (const st of this.stars) {
      st.s.y += st.speed * dt * boost;
      st.s.x += st.vx * st.speed * dt * boost;
      if (st.s.y > this.h + 10) { st.s.y = -10; st.s.x = Math.random() * this.w; }
      if (st.s.x > this.w + 10) st.s.x = -10;
      if (st.s.x < -10) st.s.x = this.w + 10;
      st.s.alpha = st.baseAlpha * (0.78 + 0.22 * Math.sin(this.t * st.tw + st.phase));
    }
    for (const nb of this.nebulae) {
      nb.pulse += dt;
      nb.x += nb.vx * dt * (0.5 + boost);
      nb.y += nb.vy * dt * (0.5 + boost);
      nb.rotation += nb.spin * dt;
      if (nb.x < this.w * 0.10) nb.x = this.w * 0.90;
      if (nb.x > this.w * 0.90) nb.x = this.w * 0.10;
      if (nb.y < this.h * 0.14) nb.y = this.h * 0.86;
      if (nb.y > this.h * 0.86) nb.y = this.h * 0.14;
      const base = weatherAlpha(state.weather);
      const target2 = base * (1 + Math.sin(nb.pulse * 0.4) * 0.45);
      nb.alpha += (target2 - nb.alpha) * Math.min(1, dt);
      nb.scale.set(nb.baseScale * (1 + Math.sin(nb.pulse * 0.25) * 0.08));
    }
  }
}

function weatherAlpha(weather: State['weather']): number {
  return weather === 'hurricane' ? 0.34 : weather === 'storm' ? 0.25 : 0.19;
}
