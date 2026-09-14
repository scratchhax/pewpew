import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Weather } from '../../state';
import { fade } from './fx';

interface Drop { s: Sprite; speed: number }
interface Fog { s: Sprite; vx: number; phase: number }

/** Darkness per traffic weather. Even a calm day is overcast and gloomy. */
const GLOOM = { calm: 0.3, storm: 0.48, hurricane: 0.68 } as const;
/** Low mist per weather (scaled by the fog budget toggle). */
const MIST = { calm: 0.45, storm: 0.7, hurricane: 1 } as const;

/**
 * Traffic weather as time of day: CALM is a grey overcast day, STORM is dusk
 * with rain, HURRICANE is horde night (dark, heavy rain, thick fog). There's
 * always a cold wash that deepens toward the edges, and some mist. Also paints the red alarm
 * wash while a horde is attacking. Screen space, above the world.
 */
export class Sky {
  darkness = GLOOM.calm;
  /** One full-screen layer for both the cold darkness and the vignette (one fill pass on a Pi). */
  private overlay: Sprite;
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
    this.overlay = new Sprite(gloomTexture());
    dark.addChild(this.overlay);
    top.addChild(this.alarmG, this.rainLayer);
  }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.overlay.width = w;
    this.overlay.height = h;
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

  /** `heart`: the soundtrack's heartbeat during a horde (softened), or null to breathe on its own. */
  update(dt: number, weather: Weather, dayNight: boolean, rainOn: boolean, alarm: number, fogOn = true, heart: number | null = null): void {
    this.t += dt;
    const target = dayNight ? GLOOM[weather] : GLOOM.calm;
    this.darkness += (target - this.darkness) * Math.min(1, dt * 0.35);

    // a cold blue-green cast that deepens toward the edges; the centre sits at
    // exactly `darkness` (until the corners reach black)
    this.overlay.alpha = Math.min(1, this.darkness / GLOOM_CENTRE);

    this.alarmG.clear();
    if (alarm > 0.01) {
      // a steady red cast (alarm itself is eased); only a slow ±10% breath, no pulsing
      const breath = heart === null ? 1 + 0.1 * Math.sin(this.t * 1.2) : 0.95 + 0.15 * heart;
      this.alarmG.rect(0, 0, this.w, this.h).fill({ color: 0xff2a1a, alpha: 0.07 * alarm * breath });
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

    const foggy = fogOn ? MIST[dayNight ? weather : 'calm'] : 0;
    for (const f of this.fog) {
      f.phase += dt * 0.2;
      f.s.x += f.vx * dt;
      if (f.s.x < -300) f.s.x = this.w + 300;
      if (f.s.x > this.w + 300) f.s.x = -300;
      fade(f.s, f.s.alpha + (foggy * (0.07 + 0.03 * Math.sin(f.phase)) - f.s.alpha) * Math.min(1, dt * 0.5));
    }
  }
}

/** Centre opacity of the gloom texture (the corners are fully opaque). */
const GLOOM_CENTRE = 0.62;

/** A cold blue-green wash: GLOOM_CENTRE opaque in the middle, solid at the corners. */
function gloomTexture(): Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.72);
  g.addColorStop(0, `rgba(7,17,15,${GLOOM_CENTRE})`);
  g.addColorStop(0.6, `rgba(5,12,11,${GLOOM_CENTRE + (1 - GLOOM_CENTRE) * 0.45})`);
  g.addColorStop(1, 'rgba(3,8,7,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return Texture.from(c);
}
