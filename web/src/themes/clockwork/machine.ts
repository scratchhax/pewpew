import { Container, Sprite, Texture } from 'pixi.js';
import {
  P, canvas, tex, rng, drawText, gearTexture, boilerTexture, furnaceTexture,
  gaugeTexture, needleTexture, plateTexture, ballTexture, mailTexture, cartTexture,
  lampTexture, whistleTexture, puffTexture, flameTexture, hammerTexture, bellTexture,
} from './sprites';

/**
 * Hero parts atlas: LLM-generated stickers baked by scripts/bake-clockwork.mjs
 * (see PROMPTS.md). Optional - a fresh clone without assets/machine.png simply
 * gets the procedural parts.
 */
const heroPng = (import.meta.glob('./assets/machine.png', { eager: true, query: '?url', import: 'default' })
  ['./assets/machine.png'] ?? undefined) as string | undefined;
const heroData = (Object.values(import.meta.glob<{ MACHINE_FRAMES: Record<string, number[]> }>('./assets/machine.ts', { eager: true }))[0]
  ?? undefined);

export async function loadHeroes(): Promise<Record<string, Texture>> {
  const out: Record<string, Texture> = {};
  if (!heroPng || !heroData) return out;
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('hero atlas')); img.src = heroPng; });
  for (const [name, f] of Object.entries(heroData.MACHINE_FRAMES)) {
    const c = canvas(f[2], f[3], (x) => x.drawImage(img, f[0], f[1], f[2], f[3], 0, 0, f[2], f[3]));
    out[name] = tex(c);
  }
  return out;
}

/**
 * The machine itself: one enormous landscape-oriented contraption that fits
 * the whole screen at once - directory and nameplate rack up top, the ball
 * run switchback across the middle, and the gear towers, alarm shelf and
 * boiler along the bottom. The camera never moves; you take the machine in
 * as a whole and watch it work. Static structure (damask wall, girders,
 * rails, pipes, racks) is baked once into a single canvas; everything that
 * moves is a sprite the mechanisms drive. Fired mechanisms may tug a trip
 * cord and wake their neighbours - that's the chain reactions.
 */

export const WORLD_W = 1900;
export const WORLD_H = 1040;

type SfxFn = (name: string, x?: number) => void;
type SayFn = (text: string) => void;

interface Particle { s: Sprite; vx: number; vy: number; life: number; max: number; grav: number; }

/** A polyline the balls and envelopes ride. */
class Path {
  pts: number[][];
  constructor(pts: number[][]) { this.pts = pts; }
  at(u: number): { x: number; y: number; a: number } {
    const lens: number[] = [];
    let total = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const d = Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]);
      lens.push(d); total += d;
    }
    let want = Math.max(0, Math.min(1, u)) * total, k = 0;
    while (k < lens.length && want > lens[k]) { want -= lens[k]; k++; }
    if (k >= lens.length) { const p = this.pts[this.pts.length - 1]; return { x: p[0], y: p[1], a: 0 }; }
    const [x0, y0] = this.pts[k], [x1, y1] = this.pts[k + 1];
    const f = lens[k] ? want / lens[k] : 0;
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a: Math.atan2(y1 - y0, x1 - x0) };
  }
}

// ── the machine's geography ────────────────────────────────────────────────
const RUN = new Path([[1750, 560], [200, 600], [1700, 655], [250, 700], [215, 736]]);
const TUBE = new Path([[1350, 640], [1350, 300], [950, 300], [900, 218]]);
const CART_RAIL = { x0: 1150, x1: 1420, y: 800 };

export class Machine {
  world = new Container();
  private gears: Array<{ s: Sprite; r: number; dir: number; base: number }> = [];
  private needle!: Sprite;
  private flames: Sprite[] = [];
  private lamp!: Sprite;
  private lampAt = -9;
  private whistle!: Sprite;
  private bell!: Sprite;
  private hammer!: Sprite;
  private stampArm!: Sprite;
  private clampArm!: Sprite;
  private gate!: Sprite;
  private cart!: Sprite;
  private directory!: Sprite;
  private directoryCtx!: CanvasRenderingContext2D;
  private directoryTex!: Texture;
  private rackSlots: Array<{ x: number; y: number }> = [];
  private rackPlates: Sprite[] = [];
  private rackCol = 0;
  private balls: Array<{ s: Sprite; u: number; v: number }> = [];
  private mails: Array<{ s: Sprite; u: number }> = [];
  private parts: Particle[] = [];
  private partPool: Sprite[] = [];
  private puffTex = tex(puffTexture());
  private ballTex = tex(ballTexture());
  private mailTex = tex(mailTexture());
  private pending: Array<{ at: number; kind: string; text?: string }> = [];
  private shudder = 0;
  private gearPhase = 0;
  private steamAt = 0;
  private t = 0;
  private r = rng(0x57);
  pressure = 0;
  shake = 0;

  constructor(private settings: Record<string, any>, private sfx: SfxFn, private say: SayFn, private heroes: Record<string, Texture> = {}) {
    this.buildStatic();
    this.buildParts();
  }

  // ── construction ─────────────────────────────────────────────────────────
  private buildStatic(): void {
    const c = canvas(WORLD_W, WORLD_H, (x) => {
      // damask wallpaper
      x.fillStyle = P.wall; x.fillRect(0, 0, WORLD_W, WORLD_H);
      for (let j = 0; j < WORLD_H; j += 24) for (let i = 0; i < WORLD_W; i += 24) {
        x.fillStyle = P.wall2;
        x.fillRect(i + 10, j + 10, 4, 4);
        x.fillRect(i + 8, j + 12, 2, 2); x.fillRect(i + 14, j + 12, 2, 2);
        x.fillRect(i + 11, j + 8, 2, 2); x.fillRect(i + 11, j + 14, 2, 2);
      }
      // wainscot + skirting
      x.fillStyle = P.oak; x.fillRect(0, WORLD_H - 40, WORLD_W, 40);
      x.fillStyle = P.oakLight; x.fillRect(0, WORLD_H - 40, WORLD_W, 4);

      const girder = (gx: number, gy: number, gw: number, gh: number) => {
        x.fillStyle = P.ironDark; x.fillRect(gx, gy, gw, gh);
        x.fillStyle = P.iron; x.fillRect(gx + 2, gy + 2, gw - 4, gh - 4);
        x.fillStyle = P.ironHi;
        const ry = gy + Math.floor(gh / 2) - 1;
        for (let i = gx + 6; i < gx + gw - 4; i += 18) x.fillRect(i, ry, 2, 2);
      };
      girder(0, 250, WORLD_W, 14); girder(0, 760, WORLD_W, 12);
      girder(40, 0, 16, WORLD_H); girder(WORLD_W - 56, 0, 16, WORLD_H);

      // the ball run: grooved rails
      for (let k = 0; k < RUN.pts.length - 1; k++) {
        const [x0, y0] = RUN.pts[k], [x1, y1] = RUN.pts[k + 1];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
        for (let i = 0; i <= steps; i++) {
          const f = i / steps, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
          x.fillStyle = P.iron; x.fillRect(px - 2, py, 4, 7);
          x.fillStyle = P.ironDark; x.fillRect(px - 1, py + 2, 2, 3);
          if (i % 22 === 0) { x.fillStyle = P.brassDark; x.fillRect(px - 3, py + 7, 6, 3); }
        }
      }
      // counter tray (bottom left, where the run comes to rest)
      x.fillStyle = P.brass; x.fillRect(185, 730, 60, 6); x.fillRect(181, 718, 6, 18); x.fillRect(243, 718, 6, 18);
      x.fillStyle = P.brassHi; x.fillRect(185, 730, 60, 2);
      drawText(x, 'COUNTED', 189, 742, P.brassLight, null);
      // the chute it drops from (top right)
      x.fillStyle = P.iron; x.fillRect(1730, 520, 44, 30);
      x.fillStyle = P.ironDark; x.fillRect(1736, 526, 32, 18);
      drawText(x, 'IN', 1744, 510, P.ironHi, null);

      // the pneumatic tube
      for (let k = 0; k < TUBE.pts.length - 1; k++) {
        const [x0, y0] = TUBE.pts[k], [x1, y1] = TUBE.pts[k + 1];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
        for (let i = 0; i <= steps; i++) {
          const f = i / steps, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
          x.fillStyle = P.copper; x.fillRect(px - 5, py - 5, 10, 10);
          x.fillStyle = P.copperLight; x.fillRect(px - 5, py - 5, 3, 10);
          if (i % 40 === 0 && i > 0 && i < steps) { x.fillStyle = P.brass; x.fillRect(px - 7, py - 7, 14, 14); x.fillStyle = P.copper; x.fillRect(px - 5, py - 5, 10, 10); x.fillStyle = P.copperLight; x.fillRect(px - 5, py - 5, 3, 10); }
        }
      }
      // mail dispatch hopper
      x.fillStyle = P.iron; x.fillRect(1326, 640, 48, 26);
      x.fillStyle = P.ironDark; x.fillRect(1332, 646, 36, 14);
      x.fillStyle = P.dns; x.fillRect(1344, 648, 12, 3);
      drawText(x, 'MAIL IN', 1328, 670, P.ironHi, null);

      // nameplate rack: a frame of slots
      x.fillStyle = P.oak; x.fillRect(120, 300, 460, 190);
      x.fillStyle = P.oakLight; x.fillRect(124, 304, 452, 4);
      x.fillStyle = '#120f18'; x.fillRect(132, 312, 436, 170);
      for (let row = 0; row < 5; row++) {
        x.fillStyle = P.brassDark; x.fillRect(132, 344 + row * 34, 436, 3);
        for (let i = 138; i < 566; i += 10) { x.fillStyle = P.brass; x.fillRect(i, 340 + row * 34, 3, 5); }
      }
      drawText(x, 'THE RACK', 138, 306, P.brassLight, null);

      // directory board
      x.fillStyle = P.oak; x.fillRect(660, 60, 420, 150);
      x.fillStyle = P.oakLight; x.fillRect(664, 64, 412, 4);
      x.fillStyle = P.paper; x.fillRect(674, 76, 392, 122);
      x.fillStyle = P.paperDark; x.fillRect(674, 76, 392, 3);
      drawText(x, 'DIRECTORY', 682, 84, '#5a4a2a', null);

      // coupling station: a hose stub and manifold
      x.fillStyle = P.iron; x.fillRect(1560, 330, 60, 40);
      x.fillStyle = P.ironDark; x.fillRect(1566, 336, 48, 28);
      x.fillStyle = P.copper; x.fillRect(1520, 344, 44, 12);
      x.fillStyle = P.wifi; x.fillRect(1572, 342, 8, 8);
      drawText(x, 'COUPLING', 1542, 376, P.ironHi, null);

      // coal rail + the hopper it dumps into
      x.fillStyle = P.iron; x.fillRect(CART_RAIL.x0, CART_RAIL.y, CART_RAIL.x1 - CART_RAIL.x0, 3);
      for (let px = CART_RAIL.x0; px <= CART_RAIL.x1; px += 12) { x.fillStyle = P.ironDark; x.fillRect(px, CART_RAIL.y + 3, 3, 4); }
      x.fillStyle = P.iron; x.fillRect(1420, 816, 60, 40);
      x.fillStyle = '#0d0a12'; x.fillRect(1426, 822, 48, 20);
      drawText(x, 'COAL', 1438, 846, P.ironHi, null);

      // boiler brick surround
      x.fillStyle = '#3a2418'; x.fillRect(750, 800, 400, 230);
      x.fillStyle = '#2a1a10';
      for (let j = 804; j < 1026; j += 12) for (let i = 754; i < 1146; i += 26) x.fillRect(i + ((j / 12) % 2 ? 13 : 0), j, 24, 10);
    });
    const bg = new Sprite(tex(c));
    this.world.addChild(bg);
  }

  private buildParts(): void {
    const add = (t: Texture, x: number, y: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.x = x; s.y = y;
      this.world.addChild(s);
      return s;
    };
    const gear = (x: number, y: number, teeth: number, r: number, dir: number, brass: boolean, base: number) => {
      const s = add(tex(gearTexture(teeth, r, brass)), x, y);
      this.gears.push({ s, r, dir, base });
    };

    // gear towers either side + the master clutch trio over the boiler
    gear(690, 890, 16, 62, 1, true, 1);
    gear(690, 764, 12, 44, -1, false, 1.4);
    gear(1500, 900, 16, 62, -1, true, 1);
    gear(1500, 774, 12, 44, 1, false, 1.4);
    gear(950, 780, 12, 40, 1, false, 1.2);
    gear(1022, 748, 8, 26, -1, true, 1.9);
    gear(878, 748, 8, 26, -1, true, 1.9);

    // boiler, furnace, fire, gauge
    const boilerS = new Sprite(this.heroes.boiler ?? tex(boilerTexture(300, 170)));
    if (this.heroes.boiler) { boilerS.anchor.set(0.5); boilerS.x = 950; boilerS.y = 905; }
    else { boilerS.x = 800; boilerS.y = 820; }
    this.world.addChild(boilerS);
    const furnaceS = new Sprite(this.heroes.furnace ?? tex(furnaceTexture(120, 90)));
    if (this.heroes.furnace) { furnaceS.anchor.set(0.5); furnaceS.x = 950; furnaceS.y = 985; }
    else { furnaceS.x = 890; furnaceS.y = 940; }
    this.world.addChild(furnaceS);
    for (let i = 0; i < 4; i++) {
      const f = add(tex(flameTexture()), 910 + i * 22, 990, 0.5, 1);
      this.flames.push(f);
    }
    add(this.heroes.gauge ?? tex(gaugeTexture(26)), 762, 862);
    this.needle = add(tex(needleTexture(20)), 762, 862, 0.05, 0.5);
    // the master clutch lever
    const lever = add(tex(canvas(40, 6, (c2) => { c2.fillStyle = P.iron; c2.fillRect(0, 2, 34, 3); c2.fillStyle = P.brass; c2.fillRect(32, 0, 6, 7); })), 1140, 850, 0.05, 0.5);
    lever.rotation = 0.5;

    // alarm kit
    add(this.heroes.whistle ?? tex(whistleTexture()), 1230, 250, 0.5, 1);
    this.whistle = add(tex(puffTexture()), 1230, 238); this.whistle.alpha = 0;
    this.lamp = add(this.heroes.lamp ?? tex(lampTexture(P.threat)), 1160, 244); this.lamp.alpha = 0.25;
    this.cart = add(this.heroes.cart ?? tex(cartTexture()), CART_RAIL.x0 + 10, CART_RAIL.y - 6);
    this.bell = add(this.heroes.bell ?? tex(bellTexture()), 870, 50);
    this.hammer = add(tex(hammerTexture()), 350, 262, 0.05, 0.5);
    this.stampArm = add(this.heroes.stamp ?? tex(canvas(10, 34, (c2) => { c2.fillStyle = P.iron; c2.fillRect(3, 0, 4, 26); c2.fillStyle = P.brass; c2.fillRect(0, 26, 10, 8); })), 350, 236, 0.5, 0);
    this.clampArm = add(this.heroes.clamp ?? tex(canvas(46, 8, (c2) => { c2.fillStyle = P.oakLight; c2.fillRect(0, 3, 34, 3); c2.fillStyle = P.brass; c2.fillRect(32, 0, 12, 8); })), 1470, 350, 0.05, 0.5);
    this.gate = add(tex(canvas(10, 30, (c2) => { c2.fillStyle = P.iron; c2.fillRect(0, 0, 10, 30); c2.fillStyle = P.block; c2.fillRect(0, 0, 10, 4); c2.fillStyle = P.ironDark; for (let j = 6; j < 28; j += 6) c2.fillRect(0, j, 10, 2); })), 975, 566, 0.5, 0);
    this.gate.y = 572; // stowed above the rail
    // the directory sheet (redrawn as mail arrives)
    const dc = canvas(392, 100, (c2) => { c2.fillStyle = 'rgba(0,0,0,0)'; c2.fillRect(0, 0, 392, 100); });
    this.directoryCtx = dc.getContext('2d')!;
    this.directoryTex = tex(dc);
    this.directory = add(this.directoryTex, 674, 98, 0, 0);
    // rack slot anchors (5 rows x 8 cols)
    for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) this.rackSlots.push({ x: 142 + col * 55, y: 320 + row * 34 });
  }

  // ── particles ────────────────────────────────────────────────────────────
  private puff(x: number, y: number, scale: number, color?: number, vy = -26): void {
    if (this.parts.length >= (this.settings.kMaxParticles ?? 400)) return;
    const s = this.partPool.pop() ?? new Sprite(this.puffTex);
    s.texture = this.puffTex;
    s.anchor.set(0.5); s.x = x; s.y = y; s.scale.set(0.4);
    s.tint = color ?? 0xffffff; s.alpha = 0.8;
    this.world.addChild(s);
    this.parts.push({ s, vx: (this.r() - 0.5) * 18, vy, life: 0, max: 0.9 + this.r() * 0.5, grav: -6 });
  }
  private spark(x: number, y: number, color: number, n: number, up = 60): void {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= (this.settings.kMaxParticles ?? 400)) return;
      const s = this.partPool.pop() ?? new Sprite();
      s.texture = this.puffTex;
      s.anchor.set(0.5); s.x = x; s.y = y; s.scale.set(0.12 + this.r() * 0.1);
      s.tint = color; s.alpha = 1;
      this.world.addChild(s);
      this.parts.push({ s, vx: (this.r() - 0.5) * 130, vy: -this.r() * up, life: 0, max: 0.4 + this.r() * 0.4, grav: 190 });
    }
  }

  // ── mechanisms ───────────────────────────────────────────────────────────
  fire(kind: string, text?: string): void {
    switch (kind) {
      case 'allow': if (this.settings.kBalls) this.dropBall(); break;
      case 'block': if (this.settings.cGates) this.slamGate(); break;
      case 'dns': if (this.settings.kMail) this.sendMail(text ?? ''); break;
      case 'dhcp': if (this.settings.kPlates) this.stampPlate(text ?? ''); break;
      case 'wifi': if (this.settings.kClamp) this.clamp(); break;
      case 'threat': if (this.settings.kWhistle) this.alarm(); break;
      case 'system': if (this.settings.kShudder) this.clutchDrop(); break;
    }
  }

  private chain(targets: string[], text?: string): void {
    if (!this.settings.kChains || this.r() > 0.45) return;
    const t = targets[(this.r() * targets.length) | 0];
    this.pending.push({ at: this.t + 0.4 + this.r() * 0.7, kind: t, text });
    this.sfx('chain', 950);
  }

  private dropBall(): void {
    if (this.balls.length >= (this.settings.kMaxBalls ?? 24)) return;
    const s = new Sprite(this.ballTex);
    s.anchor.set(0.5);
    const p = RUN.at(0); s.x = p.x; s.y = p.y - 30;
    this.world.addChild(s);
    this.balls.push({ s, u: 0, v: 0 });
    this.sfx('release', p.x);
    this.chain(['dns', 'stamp', 'clamp']);
  }

  private slamGate(): void {
    this.gateFired = true;
    this.sfx('gate', 975);
    this.spark(975, 596, 0xff6b6b, 5, 40);
    this.chain(['gate', 'mail']);
  }
  private gateFired = false; private gateT = 9;

  private sendMail(domain: string): void {
    if (this.mails.length >= 6) return;
    const s = new Sprite(this.mailTex);
    s.anchor.set(0.5);
    const p = TUBE.at(0); s.x = p.x; s.y = p.y;
    this.world.addChild(s);
    this.mails.push({ s, u: 0 });
    this.sfx('mail', p.x);
    this.pending.push({ at: this.t + 1.5, kind: '_bell', text: domain });
  }

  private stampPlate(hostname: string): void {
    this.stampT = 0;
    this.stampName = hostname || 'ANON';
    this.sfx('stamp', 350);
    this.chain(['mail', 'clamp', 'ball']);
  }
  private stampT = 9; private stampName = '';

  private clamp(): void {
    this.clampT = 0;
    this.sfx('clamp', 1490);
    this.chain(['gate', 'bell']);
  }
  private clampT = 9;

  private alarm(): void {
    this.lampAt = this.t;
    this.whistleT = 0;
    this.cartT = 0;
    this.sfx('whistle', 1230);
    this.chain(['gate', 'stamp', 'ball']);
  }
  private whistleT = 9; private cartT = 9;

  private clutchDrop(): void {
    this.shudder = 1;
    this.shake = 1;
    this.sfx('shudder', 950);
    this.say('MASTER CLUTCH DROPPED — REENGAGING');
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt: number, pressure: number): void {
    this.t += dt;
    this.pressure = pressure;
    const speed = (0.25 + pressure * 1.9) * (1 - this.shudder * 0.95);
    this.gearPhase += dt * speed;
    for (const g of this.gears) g.s.rotation = this.gearPhase * g.dir * g.base * (16 / g.r);

    // furnace fire flickers with pressure
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl = 0.55 + pressure * 0.6 + Math.sin(this.t * (9 + i * 2.3) + i) * 0.18;
      f.alpha = Math.min(1, fl);
      f.scale.set(0.8 + pressure * 0.5 + Math.sin(this.t * 13 + i * 2) * 0.12);
    }
    // gauge needle
    this.needle.rotation = -Math.PI * 0.75 + Math.PI * 1.5 * pressure + Math.sin(this.t * 7) * 0.02;

    // ambient valve steam
    this.steamAt -= dt * (this.settings.kSteam ? (0.6 + pressure * 2.2) * (this.settings.kSteamDensity ?? 1) : 0);
    if (this.steamAt <= 0) {
      this.steamAt = 0.5;
      if (this.settings.kSteam) this.puff(this.r() < 0.5 ? 1230 : 1520, this.r() < 0.5 ? 230 : 344, 0.7);
    }

    // balls roll the run
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.v = Math.min(0.42, b.v + dt * 0.28);
      b.u += (b.v * dt) / 4.2;
      const p = RUN.at(b.u);
      b.s.x = p.x; b.s.y = p.y + 2; b.s.rotation += dt * b.v * 9;
      if (b.u >= 1) {
        this.world.removeChild(b.s); this.balls.splice(i, 1);
        this.sfx('clack', 215);
        this.spark(215, 728, 0xe8eef8, 3, 50);
        this.chain(['ball']);
      }
    }

    // the gate swings down and back
    this.gateT = this.gateFired ? 0 : Math.min(1, this.gateT + dt * 3);
    if (this.gateFired) {
      this.gateT += dt * 5;
      if (this.gateT > 1.4) { this.gateFired = false; this.gateT = 0; }
    }
    const gk = this.gateT < 1 ? this.gateT : 2 - Math.min(2, this.gateT);
    this.gate.y = 572 + Math.max(0, Math.min(1, gk)) * 34;

    // envelopes ride the tube
    for (let i = this.mails.length - 1; i >= 0; i--) {
      const m = this.mails[i];
      m.u += dt / 1.5;
      const p = TUBE.at(Math.min(1, m.u));
      m.s.x = p.x; m.s.y = p.y; m.s.rotation = p.a;
      if (m.u >= 1) { this.world.removeChild(m.s); this.mails.splice(i, 1); }
    }

    // stamp arm presses, then a plate slides onto the rack
    if (this.stampT < 1) {
      this.stampT += dt * 2.6;
      const k = Math.sin(Math.min(1, this.stampT) * Math.PI);
      this.stampArm.y = 236 + k * 26;
      if (this.stampT >= 1) this.addPlate(this.stampName);
    }
    // hammer idles with a tick now and then
    this.hammer.rotation = -0.5 + Math.sin(this.t * 1.7) * 0.12;
    // clamp arm swings out and back
    if (this.clampT < 1.6) {
      this.clampT += dt * 2.2;
      const k = Math.sin(Math.min(1, this.clampT / 1.6) * Math.PI);
      this.clampArm.rotation = -0.9 + k * 0.9;
      if (this.clampT >= 1.6) this.clampArm.rotation = 0;
      if (this.clampT > 0.5 && this.clampT < 0.7 && this.r() < 0.4) this.puff(1520, 344, 0.6, 0xc08cff, -18);
    }
    // whistle + lamp + cart
    if (this.whistleT < 1.4) {
      this.whistleT += dt * 1.6;
      this.whistle.alpha = Math.max(0, 1 - this.whistleT / 1.4) * 0.9;
      this.whistle.scale.set(0.6 + this.whistleT * 1.6);
      if (this.r() < 0.6) this.puff(1230, 230, 0.9, 0xffffff, -60);
    }
    const lampOn = this.t - this.lampAt < 3;
    this.lamp.alpha = lampOn ? (Math.sin(this.t * 14) > 0 ? 1 : 0.25) : 0.25;
    if (this.cartT < 2.2) {
      this.cartT += dt * 1.4;
      const k = Math.min(1, this.cartT);
      this.cart.x = CART_RAIL.x0 + 10 + k * (CART_RAIL.x1 - CART_RAIL.x0 - 20);
      if (this.cartT >= 1.4 && this.cartT - dt * 1.4 < 1.4) {
        this.sfx('coal', 1440);
        this.spark(1440, 820, 0xff7a2a, 10, 80);
      }
      if (this.cartT >= 2.2) this.cart.x = CART_RAIL.x0 + 10;
    }
    // bell swing
    this.bell.rotation = Math.max(0, Math.sin(this.t * 22)) * 0.4 * (this.t - this.bellAt < 0.8 ? 1 : 0);
    // shudder decay
    this.shudder = Math.max(0, this.shudder - dt * 1.4);
    this.shake = Math.max(0, this.shake - dt * 2.2);

    // pending chains / delayed bits
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.t >= p.at) {
        this.pending.splice(i, 1);
        if (p.kind === '_bell') { this.ringBell(p.text ?? ''); this.directoryEntry(p.text ?? ''); }
        else this.fire(p.kind, p.text);
      }
    }

    // particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.world.removeChild(p.s); this.parts.splice(i, 1);
        if (this.partPool.length < 80) this.partPool.push(p.s); else p.s.destroy();
        continue;
      }
      const f = p.life / p.max;
      p.s.x += p.vx * dt; p.s.y += p.vy * dt; p.vy += p.grav * dt;
      p.s.alpha = (1 - f) * 0.85;
      p.s.scale.set(p.s.scale.x + (p.grav < 0 ? dt * 1.4 : 0));
    }
  }

  private ringBell(domain: string): void {
    this.bellAt = this.t;
    this.sfx('bell', 870);
    if (domain) this.say(`MAIL DELIVERED — ${domain.slice(0, 28)}`);
  }
  private bellAt = -9;

  private directoryEntries: string[] = [];
  private directoryEntry(domain: string): void {
    if (!domain) return;
    this.directoryEntries.unshift(domain.replace(/\.$/, ''));
    this.directoryEntries = this.directoryEntries.slice(0, 6);
    const c = this.directoryCtx;
    c.clearRect(0, 0, 392, 100);
    this.directoryEntries.forEach((d, i) => drawText(c, d.slice(0, 40), 8, 6 + i * 15, '#3a2c14', null));
    this.directoryTex.source.update?.();
  }

  private addPlate(hostname: string): void {
    const max = this.settings.kRack ?? 24;
    const name = (hostname || 'ANON').slice(0, 11);
    const s = new Sprite(tex(plateTexture(name)));
    s.anchor.set(0, 0.5);
    s.x = 350; s.y = 292;
    this.world.addChild(s);
    const slot = this.rackSlots[this.rackCol % this.rackSlots.length];
    this.rackCol++;
    const from = { x: s.x, y: s.y }, to = { x: slot.x, y: slot.y };
    const slide = () => {
      const k = Math.min(1, (this.t - slideStart) / 0.7);
      const e = 1 - Math.pow(1 - k, 3);
      s.x = from.x + (to.x - from.x) * e;
      s.y = from.y + (to.y - from.y) * e;
      if (k < 1) requestAnimationFrame(slide);
    };
    const slideStart = this.t;
    slide();
    this.rackPlates.push(s);
    while (this.rackPlates.length > max) {
      const old = this.rackPlates.shift()!;
      this.world.removeChild(old);
    }
  }

  /** The camera is fixed: the whole machine is framed, centred, once. */
  vw = 1920; vh = 1080;
  applyCamera(shakeX: number, shakeY: number): void {
    const sh = this.shake * 6;
    this.world.x = (this.vw - WORLD_W) / 2 + shakeX * sh;
    this.world.y = (this.vh - WORLD_H) / 2 + shakeY * sh;
  }
}
