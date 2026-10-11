import { Container, Graphics, Sprite, TilingSprite, Texture } from 'pixi.js';

/**
 * The street the fight happens on: a night-city block built from ansimuz's
 * stage layers - a tiled brick backdrop, a checkered sidewalk the fighters
 * stand on, and a foreground of road, lamps and parked car sliding past.
 * The camera follows the midpoint of the fight and shakes when fists land.
 * Weather is the traffic: storm brings rain, hurricane brings sheets of it
 * and the odd lightning strike.
 */

export const WORLD_W = 2400;
export const SCALE = 4;

export class Stage {
  readonly root = new Container();
  private sky = new Graphics();
  private world = new Container();
  private back: TilingSprite;
  private fore: TilingSprite;
  private ground = new Graphics();
  private props = new Container();
  private crowd = new Container();
  private bobs = new Map<Container, number>();
  private rain = new Graphics();
  private flashG = new Graphics();
  private camX = 0;
  private shakeT = 0;
  private shakeAmp = 0;
  private rainT = 0;
  private wet = 0;
  private flashT = 0;
  private w = 0;
  private h = 0;

  constructor(back: Texture, fore: Texture) {
    this.back = new TilingSprite({ texture: back, width: WORLD_W, height: back.height * SCALE });
    this.back.tileScale.set(SCALE);
    this.fore = new TilingSprite({ texture: fore, width: WORLD_W + 800, height: fore.height * SCALE });
    this.fore.tileScale.set(SCALE);
    this.root.addChild(this.sky, this.back, this.world, this.fore, this.rain, this.flashG);
    this.world.addChild(this.ground, this.props, this.crowd);
  }

  get groundY(): number { return this.h * 0.84; }
  /** The camera-bound layer: fighters and world-space FX live here. */
  get worldLayer(): Container { return this.world; }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const gy = this.groundY;
    this.sky.clear().rect(0, 0, w, h).fill(0x0a0d1c);
    // stars and a moon so the night sky is not an empty void
    for (let i = 0; i < 90; i++) {
      const sx = (i * 173.13) % w;
      const sy = (i * 97.7) % Math.max(40, gy - this.back.height - 40);
      this.sky.rect(sx, sy, 2, 2).fill({ color: 0xcfd8ff, alpha: 0.25 + (i % 5) * 0.12 });
    }
    this.sky.circle(w * 0.82, 110, 34).fill(0xf2edb8);
    this.sky.circle(w * 0.82 - 12, 102, 30).fill(0x0a0d1c);
    this.back.y = gy - this.back.height - 8;
    this.fore.y = gy + 26;
    this.fore.width = w + 800;
    this.ground.clear();
    // the sidewalk: teal checks, darker toward the back
    const rows = 5;
    const cell = 46;
    for (let r = 0; r < rows; r++) {
      const y = gy - 10 + r * (cell * 0.55);
      const shade = 0.5 + r * 0.12;
      for (let x = -1; x < WORLD_W / cell + 1; x++) {
        const even = (x + r) % 2 === 0;
        const c = even ? [58, 125, 118] : [47, 107, 100];
        this.ground.rect(x * cell, y, cell, cell * 0.55 + 1).fill(rgb(c, shade));
      }
    }
    this.flashG.clear().rect(0, 0, w, h).fill(0xffffff);
    this.flashG.alpha = 0;
  }

  /** A few props so the block feels placed: hydrant, barrels, a car behind. */
  addProps(car: Texture | null): void {
    void car;
    const gy = this.groundY;
    const spots = [
      { x: 260, c: 0x8a3a2a, w: 26, h: 34 },   // hydrant
      { x: 900, c: 0x7a4a20, w: 30, h: 40 },   // barrel
      { x: 1500, c: 0x7a4a20, w: 30, h: 40 },
      { x: 2050, c: 0x8a3a2a, w: 26, h: 34 },
    ];
    for (const s of spots) {
      const p = new Graphics();
      p.roundRect(-s.w / 2, -s.h, s.w, s.h, 5).fill(s.c);
      p.rect(-s.w / 2 - 5, -s.h * 0.72, s.w + 10, 5).fill({ color: 0x000000, alpha: 0.25 });
      p.x = s.x;
      p.y = gy - 4;
      this.props.addChild(p);
    }
  }

  /** A dark silhouette joins the crowd and bobs: a new face on the network. */
  crowdCount(): number { return this.crowd.children.length; }

  addCrowd(): void {
    if (this.crowd.children.length >= 34) return;
    const c = new Graphics();
    const hue = [0x1b2436, 0x241b30, 0x182828][this.crowd.children.length % 3];
    c.circle(0, -34, 7).fill(hue);
    c.roundRect(-9, -27, 18, 27, 6).fill(hue);
    c.x = 80 + Math.random() * (WORLD_W - 160);
    c.y = this.groundY - 14 - Math.random() * 10;
    c.alpha = 0.85;
    c.scale.set(0.8 + Math.random() * 0.35);
    this.bobs.set(c, Math.random() * 6.28);
    this.crowd.addChild(c);
  }

  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  lightning(): void {
    this.flashT = 0.22;
  }

  update(dt: number, t: number, midX: number, wet: number): void {
    this.wet = wet;
    // camera: follow the fight, clamp to the block
    const target = Math.max(0, Math.min(WORLD_W - this.w, midX - this.w / 2));
    this.camX += (target - this.camX) * Math.min(1, dt * 3.2);
    this.shakeT = Math.max(0, this.shakeT - dt);
    const amp = this.shakeT > 0 ? this.shakeAmp * (this.shakeT / 0.3) : 0;
    if (amp === 0) this.shakeAmp = 0;
    const sx = (Math.random() - 0.5) * 2 * amp;
    const sy = (Math.random() - 0.5) * 2 * amp;
    this.back.x = -this.camX * 0.6 + sx;
    this.world.x = -this.camX + sx;
    this.fore.x = -this.camX * 1.15 + sx * 1.4;
    this.world.y = sy;
    this.fore.y = this.groundY + 26 + sy * 1.4;
    // crowd bobs harder when the weather is up
    for (const c of this.crowd.children) {
      const b = this.bobs.get(c) ?? 0;
      c.y += Math.sin(t * (3 + wet * 5) + b) * 0.25 * (1 + wet * 2);
    }
    // rain: slanted streaks, density with the weather
    this.rainT += dt * (1 + wet * 2);
    this.rain.clear();
    if (wet > 0.01) {
      const n = Math.round(90 * wet);
      for (let i = 0; i < n; i++) {
        const seed = i * 127.1;
        const speed = 900 + (i % 7) * 130;
        const x = ((seed * 7.3 + this.rainT * speed * 0.32) % (this.w + 120)) - 60;
        const y = (seed * 3.7 + this.rainT * speed) % (this.h + 80) - 40;
        this.rain.moveTo(x, y).lineTo(x - 7 - wet * 6, y + 26 + wet * 14);
      }
      this.rain.stroke({ width: 1.5, color: 0x9fc4e8, alpha: 0.3 });
    }
    // lightning flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashG.alpha = Math.max(0, this.flashT / 0.22) * 0.3;
    } else if (this.flashG.alpha !== 0) {
      this.flashG.alpha = 0;
    }
  }

  /** occasional caller-side lightning when the weather is a hurricane */
  get isStorm(): boolean { return this.wet > 0.6; }
}

function rgb(c: number[], shade: number): number {
  const f = (v: number) => Math.min(255, Math.round(v * shade));
  return (f(c[0]) << 16) | (f(c[1]) << 8) | f(c[2]);
}
