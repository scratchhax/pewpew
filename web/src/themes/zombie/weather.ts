import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Weather } from '../../state';

interface Drop { s: Sprite; speed: number }
interface Fog { s: Sprite; vx: number; phase: number }

/**
 * Traffic weather as time of day: CALM is daylight, STORM is dusk with rain,
 * HURRICANE is horde night (dark, heavy rain, fog). Also paints the red
 * alarm wash while a horde is attacking. Screen space, above the world.
 */
export class Sky {
  darkness = 0;
  private overlay = new Graphics();
  private alarmG = new Graphics();
  private rain: Drop[] = [];
  private fog: Fog[] = [];
  private rainLayer = new Container();
  private t = 0;
  private w = 0;
  private h = 0;
  density = 1;

  /** `dark` sits under the lights; `top` (rain, fog, alarm) over everything. */
  constructor(dark: Container, private top: Container, private rainTex: Texture, private glow: Texture) {
    dark.addChild(this.overlay);
    top.addChild(this.alarmG, this.rainLayer);
  }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.rebuild();
  }

  setDensity(d: number): void {
    this.density = d;
    this.rebuild();
  }

  private rebuild(): void {
    for (const d of this.rain) d.s.destroy();
    for (const f of this.fog) f.s.destroy();
    this.rain = [];
    this.fog = [];
    const n = Math.round(260 * this.density * (this.w * this.h) / (1920 * 1080));
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.rainTex);
      s.anchor.set(0.5, 1);
      s.rotation = 0.22;
      s.position.set(Math.random() * this.w, Math.random() * this.h);
      s.scale.set(1, 0.7 + Math.random() * 0.8);
      s.alpha = 0;
      this.rainLayer.addChild(s);
      this.rain.push({ s, speed: 700 + Math.random() * 500 });
    }
    for (let i = 0; i < 7; i++) {
      const s = new Sprite(this.glow);
      s.anchor.set(0.5);
      s.tint = 0x9fb0b8;
      s.position.set(Math.random() * this.w, Math.random() * this.h);
      s.scale.set(9 + Math.random() * 7);
      s.alpha = 0;
      this.top.addChild(s);
      this.fog.push({ s, vx: (Math.random() - 0.5) * 14, phase: Math.random() * 10 });
    }
  }

  update(dt: number, weather: Weather, dayNight: boolean, rainOn: boolean, alarm: number): void {
    this.t += dt;
    const target = !dayNight ? 0 : weather === 'hurricane' ? 0.64 : weather === 'storm' ? 0.36 : 0;
    this.darkness += (target - this.darkness) * Math.min(1, dt * 0.35);

    this.overlay.clear();
    if (this.darkness > 0.005) {
      this.overlay.rect(0, 0, this.w, this.h).fill({ color: 0x060a14, alpha: this.darkness });
    }

    this.alarmG.clear();
    if (alarm > 0.01) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
      this.alarmG.rect(0, 0, this.w, this.h).fill({ color: 0xff2a1a, alpha: 0.05 + 0.07 * pulse * alarm });
    }

    const wet = !rainOn ? 0 : weather === 'hurricane' ? 1 : weather === 'storm' ? 0.55 : 0;
    this.rainLayer.visible = wet > 0;
    if (wet > 0) {
      for (const d of this.rain) {
        d.s.y += d.speed * dt;
        d.s.x += d.speed * dt * 0.22;
        if (d.s.y > this.h + 30) { d.s.y = -10; d.s.x = Math.random() * (this.w + 200) - 200; }
        d.s.alpha = 0.22 * wet;
      }
    }

    const foggy = weather === 'hurricane' && dayNight ? 1 : 0;
    for (const f of this.fog) {
      f.phase += dt * 0.2;
      f.s.x += f.vx * dt;
      if (f.s.x < -300) f.s.x = this.w + 300;
      if (f.s.x > this.w + 300) f.s.x = -300;
      f.s.alpha += (foggy * (0.06 + 0.03 * Math.sin(f.phase)) - f.s.alpha) * Math.min(1, dt * 0.5);
    }
  }
}
