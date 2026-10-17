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
 * The machine itself: one enormous portrait-oriented contraption (1280 x 1600
 * world px) that the camera pans across. Static structure (damask wall,
 * girders, rails, pipes, racks) is baked once into a single canvas; everything
 * that moves is a sprite the mechanisms drive. Fired mechanisms may tug a trip
 * cord and wake their neighbours — that's the chain reactions.
 */

export const WORLD_W = 1280;
export const WORLD_H = 1600;

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
const RUN = new Path([[170, 1000], [1060, 1055], [220, 1110], [1060, 1165], [1092, 1206]]);
const TUBE = new Path([[700, 700], [700, 430], [790, 350], [800, 235]]);
const CART_RAIL = { x0: 880, x1: 1160, y: 1252 };

export class Machine {
  world = new Container();
  private cam = { x: 320, y: 1180, tx: 320, ty: 1180 };
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
  private idleAt = 0;
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
      x.fillStyle = P.oak; x.fillRect(0, WORLD_H - 46, WORLD_W, 46);
      x.fillStyle = P.oakLight; x.fillRect(0, WORLD_H - 46, WORLD_W, 4);

      const girder = (gx: number, gy: number, gw: number, gh: number) => {
        x.fillStyle = P.ironDark; x.fillRect(gx, gy, gw, gh);
        x.fillStyle = P.iron; x.fillRect(gx + 2, gy + 2, gw - 4, gh - 4);
        x.fillStyle = P.ironHi;
        const ry = gy + Math.floor(gh / 2) - 1;
        for (let i = gx + 6; i < gx + gw - 4; i += 18) x.fillRect(i, ry, 2, 2);
      };
      girder(0, 940, WORLD_W, 14); girder(0, 1226, WORLD_W, 12);
      girder(0, 300, WORLD_W, 14); girder(0, 760, WORLD_W, 12);
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
      // counter tray
      x.fillStyle = P.brass; x.fillRect(1060, 1200, 60, 6); x.fillRect(1056, 1188, 6, 18); x.fillRect(1118, 1188, 6, 18);
      x.fillStyle = P.brassHi; x.fillRect(1060, 1200, 60, 2);
      drawText(x, 'COUNTED', 1064, 1212, P.brassLight, null);

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
      x.fillStyle = P.iron; x.fillRect(676, 700, 48, 26);
      x.fillStyle = P.ironDark; x.fillRect(682, 706, 36, 14);
      x.fillStyle = P.dns; x.fillRect(694, 708, 12, 3);
      drawText(x, 'MAIL IN', 678, 730, P.ironHi, null);

      // nameplate rack: a frame of slots
      x.fillStyle = P.oak; x.fillRect(150, 380, 460, 190);
      x.fillStyle = P.oakLight; x.fillRect(154, 384, 452, 4);
      x.fillStyle = '#120f18'; x.fillRect(162, 392, 436, 170);
      for (let row = 0; row < 5; row++) {
        x.fillStyle = P.brassDark; x.fillRect(162, 424 + row * 34, 436, 3);
        for (let i = 168; i < 596; i += 10) { x.fillStyle = P.brass; x.fillRect(i, 420 + row * 34, 3, 5); }
      }
      drawText(x, 'THE RACK', 168, 386, P.brassLight, null);

      // directory board
      x.fillStyle = P.oak; x.fillRect(600, 130, 420, 150);
      x.fillStyle = P.oakLight; x.fillRect(604, 134, 412, 4);
      x.fillStyle = P.paper; x.fillRect(614, 146, 392, 122);
      x.fillStyle = P.paperDark; x.fillRect(614, 146, 392, 3);
      drawText(x, 'DIRECTORY', 622, 154, '#5a4a2a', null);

      // coupling station: a hose stub and manifold
      x.fillStyle = P.iron; x.fillRect(980, 500, 60, 40);
      x.fillStyle = P.ironDark; x.fillRect(986, 506, 48, 28);
      x.fillStyle = P.copper; x.fillRect(940, 514, 44, 12);
      x.fillStyle = P.wifi; x.fillRect(992, 512, 8, 8);
      drawText(x, 'COUPLING', 962, 546, P.ironHi, null);

      // coal rail
      x.fillStyle = P.iron; x.fillRect(CART_RAIL.x0, CART_RAIL.y, CART_RAIL.x1 - CART_RAIL.x0, 3);
      for (let px = CART_RAIL.x0; px <= CART_RAIL.x1; px += 12) { x.fillStyle = P.ironDark; x.fillRect(px, CART_RAIL.y + 3, 3, 4); }
      // the hopper it dumps into
      x.fillStyle = P.iron; x.fillRect(1150, 1268, 60, 40);
      x.fillStyle = '#0d0a12'; x.fillRect(1156, 1274, 48, 20);
      drawText(x, 'COAL', 1168, 1298, P.ironHi, null);

      // boiler brick surround
      x.fillStyle = '#3a2418'; x.fillRect(440, 1330, 400, 230);
      x.fillStyle = '#2a1a10';
      for (let j = 1334; j < 1556; j += 12) for (let i = 444; i < 836; i += 26) x.fillRect(i + ((j / 12) % 2 ? 13 : 0), j, 24, 10);
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

    // gear towers either side + the master clutch pair over the boiler
    gear(150, 1330, 16, 62, 1, true, 1);
    gear(150, 1204, 12, 44, -1, false, 1.4);
    gear(1130, 1330, 16, 62, -1, true, 1);
    gear(1130, 1204, 12, 44, 1, false, 1.4);
    gear(640, 1290, 12, 40, 1, false, 1.2);
    gear(712, 1258, 8, 26, -1, true, 1.9);
    gear(568, 1258, 8, 26, -1, true, 1.9);

    // boiler, furnace, fire, gauge
    const boilerS = new Sprite(this.heroes.boiler ?? tex(boilerTexture(300, 170)));
    if (this.heroes.boiler) { boilerS.anchor.set(0.5); boilerS.x = 640; boilerS.y = 1435; }
    else { boilerS.x = 490; boilerS.y = 1350; }
    this.world.addChild(boilerS);
    const furnaceS = new Sprite(this.heroes.furnace ?? tex(furnaceTexture(120, 90)));
    if (this.heroes.furnace) { furnaceS.anchor.set(0.5); furnaceS.x = 640; furnaceS.y = 1515; }
    else { furnaceS.x = 580; furnaceS.y = 1470; }
    this.world.addChild(furnaceS);
    for (let i = 0; i < 4; i++) {
      const f = add(tex(flameTexture()), 600 + i * 22, 1520, 0.5, 1);
      this.flames.push(f);
    }
    add(this.heroes.gauge ?? tex(gaugeTexture(26)), 452, 1392);
    this.needle = add(tex(needleTexture(20)), 452, 1392, 0.05, 0.5);
    // the master clutch lever
    const lever = add(tex(canvas(40, 6, (c2) => { c2.fillStyle = P.iron; c2.fillRect(0, 2, 34, 3); c2.fillStyle = P.brass; c2.fillRect(32, 0, 6, 7); })), 830, 1380, 0.05, 0.5);
    lever.rotation = 0.5;

    // alarm kit
    add(this.heroes.whistle ?? tex(whistleTexture()), 330, 1288, 0.5, 1);
    this.whistle = add(tex(puffTexture()), 330, 1276); this.whistle.alpha = 0;
    this.lamp = add(this.heroes.lamp ?? tex(lampTexture(P.threat)), 285, 1236); this.lamp.alpha = 0.25;
    this.cart = add(this.heroes.cart ?? tex(cartTexture()), CART_RAIL.x0 + 10, CART_RAIL.y - 6);
    this.bell = add(this.heroes.bell ?? tex(bellTexture()), 810, 116);
    this.hammer = add(tex(hammerTexture()), 372, 356, 0.05, 0.5);
    this.stampArm = add(this.heroes.stamp ?? tex(canvas(10, 34, (c2) => { c2.fillStyle = P.iron; c2.fillRect(3, 0, 4, 26); c2.fillStyle = P.brass; c2.fillRect(0, 26, 10, 8); })), 372, 330, 0.5, 0);
    this.clampArm = add(this.heroes.clamp ?? tex(canvas(46, 8, (c2) => { c2.fillStyle = P.oakLight; c2.fillRect(0, 3, 34, 3); c2.fillStyle = P.brass; c2.fillRect(32, 0, 12, 8); })), 900, 520, 0.05, 0.5);
    this.gate = add(tex(canvas(10, 30, (c2) => { c2.fillStyle = P.iron; c2.fillRect(0, 0, 10, 30); c2.fillStyle = P.block; c2.fillRect(0, 0, 10, 4); c2.fillStyle = P.ironDark; for (let j = 6; j < 28; j += 6) c2.fillRect(0, j, 10, 2); })), 640, 1000, 0.5, 0);
    this.gate.y = 1006; // stowed above the rail
    // the directory sheet (redrawn as mail arrives)
    const dc = canvas(392, 100, (c2) => { c2.fillStyle = 'rgba(0,0,0,0)'; c2.fillRect(0, 0, 392, 100); });
    this.directoryCtx = dc.getContext('2d')!;
    this.directoryTex = tex(dc);
    this.directory = add(this.directoryTex, 614, 168, 0, 0);
    // rack slot anchors (5 rows x 8 cols)
    for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) this.rackSlots.push({ x: 172 + col * 55, y: 400 + row * 34 });
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
    this.sfx('chain', 640);
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
    this.sfx('gate', 640);
    this.spark(640, 1030, 0xff6b6b, 5, 40);
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
    this.sfx('stamp', 372);
    this.chain(['mail', 'clamp', 'ball']);
  }
  private stampT = 9; private stampName = '';

  private clamp(): void {
    this.clampT = 0;
    this.sfx('clamp', 920);
    this.chain(['gate', 'bell']);
  }
  private clampT = 9;

  private alarm(): void {
    this.lampAt = this.t;
    this.whistleT = 0;
    this.cartT = 0;
    this.sfx('whistle', 330);
    this.chain(['gate', 'stamp', 'ball']);
  }
  private whistleT = 9; private cartT = 9;

  private clutchDrop(): void {
    this.shudder = 1;
    this.shake = 1;
    this.sfx('shudder', 640);
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
      if (this.settings.kSteam) this.puff(this.r() < 0.5 ? 330 : 900, this.r() < 0.5 ? 1276 : 514, 0.7);
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
        this.sfx('clack', 1090);
        this.spark(1090, 1198, 0xe8eef8, 3, 50);
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
    this.gate.y = 1006 + Math.max(0, Math.min(1, gk)) * 34;

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
      this.stampArm.y = 330 + k * 26;
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
      if (this.clampT > 0.5 && this.clampT < 0.7 && this.r() < 0.4) this.puff(940, 514, 0.6, 0xc08cff, -18);
    }
    // whistle + lamp + cart
    if (this.whistleT < 1.4) {
      this.whistleT += dt * 1.6;
      this.whistle.alpha = Math.max(0, 1 - this.whistleT / 1.4) * 0.9;
      this.whistle.scale.set(0.6 + this.whistleT * 1.6);
      if (this.r() < 0.6) this.puff(330, 1268, 0.9, 0xffffff, -60);
    }
    const lampOn = this.t - this.lampAt < 3;
    this.lamp.alpha = lampOn ? (Math.sin(this.t * 14) > 0 ? 1 : 0.25) : 0.25;
    if (this.cartT < 2.2) {
      this.cartT += dt * 1.4;
      const k = Math.min(1, this.cartT);
      this.cart.x = CART_RAIL.x0 + 10 + k * (CART_RAIL.x1 - CART_RAIL.x0 - 20);
      if (this.cartT >= 1.4 && this.cartT - dt * 1.4 < 1.4) {
        this.sfx('coal', 1160);
        this.spark(1170, 1272, 0xff7a2a, 10, 80);
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

    this.updateCamera(dt);
  }

  private ringBell(domain: string): void {
    this.bellAt = this.t;
    this.sfx('bell', 810);
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
    s.x = 372; s.y = 372;
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

  // ── camera ───────────────────────────────────────────────────────────────
  focus(x: number, y: number): void {
    this.cam.tx = x; this.cam.ty = y;
    this.idleAt = this.t;
  }

  private updateCamera(dt: number): void {
    // idle: drift slowly up and down the machine
    if (this.t - this.idleAt > 8) {
      this.cam.ty = 900 + Math.sin(this.t * 0.05) * 620;
      this.cam.tx = 640 + Math.sin(this.t * 0.033) * 260;
    }
    const vw = this.vw, vh = this.vh;
    this.cam.tx = Math.max(vw / 2, Math.min(WORLD_W - vw / 2, this.cam.tx));
    this.cam.ty = Math.max(vh / 2, Math.min(WORLD_H - vh / 2, this.cam.ty));
    const k = Math.min(1, dt * 1.1);
    this.cam.x += (this.cam.tx - this.cam.x) * k;
    this.cam.y += (this.cam.ty - this.cam.y) * k;
  }

  vw = 480; vh = 270;
  applyCamera(shakeX: number, shakeY: number): void {
    const sh = this.shake * 6;
    this.world.x = -(this.cam.x - this.vw / 2) + shakeX * sh;
    this.world.y = -(this.cam.y - this.vh / 2) + shakeY * sh;
  }

  /** Where should the camera look for this event? */
  anchorFor(kind: string): { x: number; y: number } {
    switch (kind) {
      case 'allow': return { x: 400, y: 1030 };
      case 'block': return { x: 640, y: 1030 };
      case 'dns': return { x: 740, y: 560 };
      case 'dhcp': return { x: 372, y: 400 };
      case 'wifi': return { x: 940, y: 520 };
      case 'threat': return { x: 640, y: 1240 };
      case 'system': return { x: 640, y: 1400 };
      default: return { x: 640, y: 1000 };
    }
  }
}
