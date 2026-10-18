import { Container, Sprite, Texture } from 'pixi.js';
import {
  P, canvas, tex, rng, drawText, gearTexture, boilerTexture, furnaceTexture,
  gaugeTexture, needleTexture, plateTexture, ballTexture, mailTexture, cartTexture,
  lampTexture, whistleTexture, puffTexture, flameTexture, hammerTexture, bellTexture,
  dominoTexture, funnelTexture, flywheelTexture, vaneTexture, leverTexture,
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
 * The machine: ONE Rube Goldberg contraption whose single job is to stoke the
 * great boiler. Nothing stands alone - ramps run from device to device,
 * dominoes tip levers, levers yank strings, strings trip the next device, and
 * every chain ends at the boiler with a sigh of steam.
 *
 *   allow  : a bearing drops in the chute, rolls the switchback, smashes a
 *            domino run, tips the lever (which yanks the gate clear), passes
 *            the gate, and drops into the boiler-top funnel - the funnel's
 *            cord goes taut across the shop and trips the nameplate stamp.
 *   block  : the safety gate slams and holds a bearing until the lever frees it.
 *   dns    : steam fires an envelope up the tube to the directory; the bell
 *            rings and its cord, over a pulley, releases the coal cart.
 *   threat : the whistle screams, the lamp flashes, the cart rolls its ramp
 *            and dumps its load into the firebox.
 *   wifi   : the coupling arm clamps the steam pipe and the vane wheel spins.
 *   system : the clutch drops; the flywheel and every gear spin down.
 *
 * The camera never moves; the whole machine is one frame, and the chains are
 * the show.
 */

export const WORLD_W = 1900;
export const WORLD_H = 1040;

/** Gear trains share one tooth pitch so meshing gears interlock. */
const PITCH = 16;
const gearR = (teeth: number) => (teeth * PITCH) / (Math.PI * 2);

type SfxFn = (name: string, x?: number) => void;
type SayFn = (text: string) => void;

interface Particle { s: Sprite; vx: number; vy: number; life: number; max: number; grav: number; }
interface GearNode { x: number; y: number; teeth: number; ratio: number; phase: number; }
interface Domino { s: Sprite; at: number; }
interface Str { pts: number[][]; bead: Sprite; at: number; after: (() => void) | null; }

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
  /** fraction along the polyline where x is crossed on segment seg */
  uAtX(x: number, seg: number): number {
    let d = 0;
    for (let i = 1; i <= seg; i++) d += Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]);
    const a = this.pts[seg], b = this.pts[seg + 1];
    d += Math.abs((x - a[0]) / (b[0] - a[0])) * Math.hypot(b[0] - a[0], b[1] - a[1]);
    let total = 0;
    for (let i = 1; i < this.pts.length; i++) total += Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]);
    return d / total;
  }
}

// ── the machine's geography ────────────────────────────────────────────────
const RUN = new Path([[150, 330], [760, 385], [220, 430], [1500, 480], [1150, 532]]);
const TUBE = new Path([[1380, 585], [1380, 250], [900, 250], [880, 195]]);
const RAMP = { x0: 1650, y0: 625, x1: 1290, y1: 900 };
const railY1 = (x: number) => 330 + ((x - 150) / 610) * 55;
const railY3 = (x: number) => 430 + ((x - 220) / 1280) * 50;
const U_GATE = RUN.uAtX(950, 2);
const U_DOMINO = RUN.uAtX(620, 0);

export class Machine {
  world = new Container();
  private train: Array<{ s: Sprite; ratio: number; phase: number }> = [];
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
  private flywheel!: Sprite;
  private rod!: Sprite;
  private vane!: Sprite;
  private lever!: Sprite;
  private dominoes: Domino[] = [];
  private dominoAt = -9;
  private leverAt = -9;
  private vaneSpin = 0;
  private strings: Record<string, Str> = {};
  private directory!: Sprite;
  private directoryCtx!: CanvasRenderingContext2D;
  private directoryTex!: Texture;
  private rackSlots: Array<{ x: number; y: number }> = [];
  private rackPlates: Sprite[] = [];
  private rackCol = 0;
  private balls: Array<{ s: Sprite; u: number; v: number; hit: boolean }> = [];
  private mails: Array<{ s: Sprite; u: number }> = [];
  private parts: Particle[] = [];
  private partPool: Sprite[] = [];
  private puffTex = tex(puffTexture());
  private ballTex = tex(ballTexture());
  private mailTex = tex(mailTexture());
  private gateClosed = false;
  private gateHold = 0;
  private pending: Array<{ at: number; kind: string; text?: string }> = [];
  private shudder = 0;
  private gearPhase = 0;
  private steamAt = 0;
  private t = 0;
  private r = rng(0x57);
  pressure = 0;

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
      x.fillStyle = P.oak; x.fillRect(0, WORLD_H - 40, WORLD_W, 40);
      x.fillStyle = P.oakLight; x.fillRect(0, WORLD_H - 40, WORLD_W, 4);

      const girder = (gx: number, gy: number, gw: number, gh: number) => {
        x.fillStyle = P.ironDark; x.fillRect(gx, gy, gw, gh);
        x.fillStyle = P.iron; x.fillRect(gx + 2, gy + 2, gw - 4, gh - 4);
        x.fillStyle = P.ironHi;
        const ry = gy + Math.floor(gh / 2) - 1;
        for (let i = gx + 6; i < gx + gw - 4; i += 18) x.fillRect(i, ry, 2, 2);
      };
      girder(0, 250, WORLD_W, 12);
      girder(40, 0, 16, WORLD_H); girder(WORLD_W - 56, 0, 16, WORLD_H);

      // the ball run rails
      for (let k = 0; k < RUN.pts.length - 1; k++) {
        const [x0, y0] = RUN.pts[k], [x1, y1] = RUN.pts[k + 1];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
        for (let i = 0; i <= steps; i++) {
          const f = i / steps, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
          x.fillStyle = P.ironLight; x.fillRect(px - 2, py, 4, 3);
          x.fillStyle = P.iron; x.fillRect(px - 2, py + 3, 4, 5);
          x.fillStyle = P.ironDark; x.fillRect(px - 1, py + 4, 2, 3);
          if (i % 22 === 0) { x.fillStyle = P.brassDark; x.fillRect(px - 3, py + 8, 6, 3); }
        }
      }
      // the chute bearings drop from
      x.fillStyle = P.iron; x.fillRect(128, 298, 44, 32);
      x.fillStyle = P.ironDark; x.fillRect(134, 304, 32, 20);
      drawText(x, 'IN', 136, 280, P.ironHi, null, 2);

      // the coal ramp down to the firebox
      const steps = Math.ceil(Math.hypot(RAMP.x1 - RAMP.x0, RAMP.y1 - RAMP.y0) / 2);
      for (let i = 0; i <= steps; i++) {
        const f = i / steps, px = RAMP.x0 + (RAMP.x1 - RAMP.x0) * f, py = RAMP.y0 + (RAMP.y1 - RAMP.y0) * f;
        x.fillStyle = P.ironLight; x.fillRect(px - 2, py, 4, 3);
        x.fillStyle = P.iron; x.fillRect(px - 2, py + 3, 4, 4);
        if (i % 10 === 0) { x.fillStyle = P.ironDark; x.fillRect(px - 1, py + 7, 3, 5); }
      }
      // the flywheel's guide rail
      x.fillStyle = P.iron; x.fillRect(1395, 764, 140, 12);
      x.fillStyle = P.ironDark; x.fillRect(1395, 768, 140, 4);

      // the pneumatic tube from the boiler shoulder to the directory
      for (let k = 0; k < TUBE.pts.length - 1; k++) {
        const [x0, y0] = TUBE.pts[k], [x1, y1] = TUBE.pts[k + 1];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
        for (let i = 0; i <= steps; i++) {
          const f = i / steps, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
          x.fillStyle = P.copper; x.fillRect(px - 6, py - 6, 12, 12);
          x.fillStyle = P.copperLight; x.fillRect(px - 6, py - 6, 4, 12);
          if (i % 40 === 0 && i > 0 && i < steps) { x.fillStyle = P.brass; x.fillRect(px - 8, py - 8, 16, 16); x.fillStyle = P.copper; x.fillRect(px - 6, py - 6, 12, 12); x.fillStyle = P.copperLight; x.fillRect(px - 6, py - 6, 4, 12); }
        }
      }
      // the steam pipe from the boiler shoulder to the vane wheel
      x.fillStyle = P.copper; x.fillRect(768, 594, 112, 12);
      x.fillStyle = P.copperLight; x.fillRect(768, 594, 112, 4);

      // the funnel's downpipe into the boiler dome
      x.fillStyle = P.brassDark; x.fillRect(1136, 560, 28, 26);
      x.fillStyle = P.brass; x.fillRect(1140, 560, 20, 26);

      // slack strings, drawn once (they go taut when pulled)
      const rope = (pts: number[][], sag: number) => {
        x.strokeStyle = '#4a3a24'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i - 1], [qx, qy] = pts[i];
          x.quadraticCurveTo((px + qx) / 2, (py + qy) / 2 + sag, qx, qy);
        }
        x.stroke();
      };
      rope([[758, 388], [950, 452]], 12);
      rope([[1150, 548], [1150, 505], [470, 505], [470, 500]], 8);
      rope([[870, 46], [1750, 120], [1630, 616]], 14);
      // pulley wheels at the cord corners
      for (const [px, py] of [[1150, 505], [470, 505], [1750, 120]]) {
        x.fillStyle = P.brass; x.beginPath(); x.arc(px, py, 6, 0, 7); x.fill();
        x.fillStyle = P.brassDark; x.beginPath(); x.arc(px, py, 2.5, 0, 7); x.fill();
      }

      // nameplate rack
      x.fillStyle = P.oak; x.fillRect(240, 560, 460, 170);
      x.fillStyle = P.oakLight; x.fillRect(244, 564, 452, 4);
      x.fillStyle = '#120f18'; x.fillRect(252, 572, 436, 150);
      for (let row = 0; row < 5; row++) {
        x.fillStyle = P.brassDark; x.fillRect(252, 602 + row * 30, 436, 3);
        for (let i = 258; i < 686; i += 10) { x.fillStyle = P.brass; x.fillRect(i, 598 + row * 30, 3, 5); }
      }
      drawText(x, 'THE RACK', 256, 564, P.brassLight, null, 2);

      // directory board
      x.fillStyle = P.oak; x.fillRect(660, 40, 420, 150);
      x.fillStyle = P.oakLight; x.fillRect(664, 44, 412, 4);
      x.fillStyle = P.paper; x.fillRect(674, 56, 392, 122);
      x.fillStyle = P.paperDark; x.fillRect(674, 56, 392, 3);
      drawText(x, 'DIRECTORY', 680, 62, '#5a4a2a', null, 2);

      // coupling manifold at the pipe's boiler end
      x.fillStyle = P.iron; x.fillRect(868, 584, 30, 32);
      x.fillStyle = P.wifi; x.fillRect(876, 592, 8, 8);
      drawText(x, 'COUPLING', 776, 614, P.ironHi, null, 2);

      // coal scuttle at the ramp's foot = the firebox mouth
      drawText(x, 'FIREBOX', 1180, 908, P.ember, null, 2);

      // boiler brick surround
      x.fillStyle = '#33200f'; x.fillRect(830, 520, 640, 510);
      x.fillStyle = '#573621';
      for (let j = 524; j < 1026; j += 12) for (let i = 834; i < 1466; i += 26) x.fillRect(i + ((j / 12) % 2 ? 13 : 0), j, 24, 10);
    });
    this.world.addChild(new Sprite(tex(c)));
  }

  private addGear(x: number, y: number, teeth: number, brass: boolean, parent?: GearNode): GearNode {
    const r = gearR(teeth);
    let ratio = 1, phase = 0;
    if (parent) {
      const rp = gearR(parent.teeth);
      const alpha = Math.atan2(parent.y - y, parent.x - x);
      ratio = -(rp / r) * parent.ratio;
      phase = -(rp / r) * parent.phase + alpha * (1 + rp / r) + Math.PI + Math.PI / teeth;
    }
    const s = new Sprite(tex(gearTexture(teeth, r, brass)));
    s.anchor.set(0.5); s.x = x; s.y = y;
    this.world.addChild(s);
    this.train.push({ s, ratio, phase });
    return { x, y, teeth, ratio, phase };
  }

  private meshAt(parent: GearNode, teeth: number, deg: number, brass: boolean): GearNode {
    const a = (deg * Math.PI) / 180;
    const d = gearR(parent.teeth) + gearR(teeth);
    return this.addGear(parent.x + Math.cos(a) * d, parent.y + Math.sin(a) * d, teeth, brass, parent);
  }

  private buildParts(): void {
    const add = (t: Texture, x: number, y: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.x = x; s.y = y;
      this.world.addChild(s);
      return s;
    };

    // gear trains: the crank beside the boiler dome, one tower in the left gap
    const crank = this.addGear(990, 545, 20, true);
    this.meshAt(crank, 13, 168, false);
    this.meshAt(crank, 13, 12, false);
    const lt = this.addGear(660, 870, 26, true);
    this.meshAt(lt, 13, -35, false);

    // the great boiler and its fittings
    const boilerS = new Sprite(this.heroes.boiler ?? tex(boilerTexture(560, 320)));
    if (this.heroes.boiler) { boilerS.anchor.set(0.5); boilerS.x = 1150; boilerS.y = 760; }
    else { boilerS.x = 870; boilerS.y = 600; }
    this.world.addChild(boilerS);
    const furnaceS = new Sprite(this.heroes.furnace ?? tex(furnaceTexture(170, 130)));
    if (this.heroes.furnace) { furnaceS.anchor.set(0.5); furnaceS.x = 1150; furnaceS.y = 935; }
    else { furnaceS.x = 1065; furnaceS.y = 870; }
    this.world.addChild(furnaceS);
    for (let i = 0; i < 5; i++) {
      const f = add(tex(flameTexture()), 1090 + i * 30, 990, 0.5, 1);
      f.scale.set(2.2);
      this.flames.push(f);
    }
    add(this.heroes.gauge ?? tex(gaugeTexture(65)), 920, 655);
    this.needle = add(tex(needleTexture(50)), 920, 655, 0.05, 0.5);
    add(this.heroes.whistle ?? tex(whistleTexture()), 1180, 565, 0.5, 1);
    this.whistle = add(tex(puffTexture()), 1180, 548); this.whistle.alpha = 0;
    this.lamp = add(this.heroes.lamp ?? tex(lampTexture(P.threat)), 1500, 560); this.lamp.alpha = 0.25;

    // the flywheel and its rod to the boiler pump
    this.flywheel = add(tex(flywheelTexture(85)), 1560, 770);
    this.rod = add(tex(canvas(6, 6, (c2) => { c2.fillStyle = P.ironLight; c2.fillRect(0, 1, 6, 4); })), 1560, 770, 0, 0.5);

    // the vane wheel on the steam pipe
    this.vane = add(tex(vaneTexture()), 740, 600);
    this.clampArm = add(this.heroes.clamp ?? tex(canvas(70, 12, (c2) => { c2.fillStyle = P.oakLight; c2.fillRect(0, 5, 50, 4); c2.fillStyle = P.brass; c2.fillRect(48, 0, 20, 12); })), 800, 600, 0.05, 0.5);

    // the funnel the run ends in
    add(tex(funnelTexture()), 1150, 536);

    // dominoes along the first ramp
    const dom = tex(dominoTexture());
    for (let i = 0; i < 7; i++) {
      const dx = 620 + i * 20;
      const s = add(dom, dx, railY1(dx) + 6, 0.5, 1);
      this.dominoes.push({ s, at: -9 });
    }
    this.lever = add(tex(leverTexture()), 758, railY1(758) + 2, 0.05, 0.5);
    this.lever.rotation = -0.35;

    // the safety gate across the long run
    this.gate = add(tex(canvas(14, 44, (c2) => { c2.fillStyle = P.iron; c2.fillRect(0, 0, 14, 44); c2.fillStyle = P.block; c2.fillRect(0, 0, 14, 6); c2.fillStyle = P.ironDark; for (let j = 10; j < 42; j += 8) c2.fillRect(0, j, 14, 3); })), 950, 452, 0.5, 0);

    // the coal cart on its ramp
    this.cart = add(this.heroes.cart ?? tex(cartTexture()), RAMP.x0 - 20, RAMP.y0 - 8);
    this.cart.scale.x = -1; this.cart.rotation = 0.65;

    // stamp, hammer, bell over the rack and directory
    this.hammer = add(tex(hammerTexture()), 470, 496, 0.05, 0.5);
    this.hammer.scale.set(1.6);
    this.stampArm = add(this.heroes.stamp ?? tex(canvas(16, 54, (c2) => { c2.fillStyle = P.iron; c2.fillRect(5, 0, 6, 40); c2.fillStyle = P.brass; c2.fillRect(0, 40, 16, 14); })), 470, 505, 0.5, 0);
    if (this.heroes.hopper) add(this.heroes.hopper, 1380, 592);
    this.bell = add(this.heroes.bell ?? tex(bellTexture()), 870, 34);

    // string beads (the chains you can see travelling)
    const bead = () => {
      const b = new Sprite(tex(canvas(8, 8, (c2) => { c2.fillStyle = P.brassHi; c2.beginPath(); c2.arc(4, 4, 3.5, 0, 7); c2.fill(); })));
      b.anchor.set(0.5); b.visible = false;
      this.world.addChild(b);
      return b;
    };
    this.strings.lever = { pts: [[758, 388], [950, 452]], bead: bead(), at: -1, after: null };
    this.strings.funnel = { pts: [[1150, 548], [1150, 505], [470, 505], [470, 500]], bead: bead(), at: -1, after: null };
    this.strings.bell = { pts: [[870, 46], [1750, 120], [1630, 616]], bead: bead(), at: -1, after: null };

    // the directory sheet (redrawn as mail arrives)
    const dc = canvas(392, 100, (c2) => { c2.fillStyle = 'rgba(0,0,0,0)'; c2.fillRect(0, 0, 392, 100); });
    this.directoryCtx = dc.getContext('2d')!;
    this.directoryTex = tex(dc);
    this.directory = add(this.directoryTex, 674, 78, 0, 0);
    // rack slot anchors (5 rows x 8 cols)
    for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) this.rackSlots.push({ x: 262 + col * 55, y: 588 + row * 30 });
  }

  // ── particles ────────────────────────────────────────────────────────────
  private puff(x: number, y: number, scale: number, color?: number, vy = -26): void {
    if (this.parts.length >= (this.settings.kMaxParticles ?? 400)) return;
    const s = this.partPool.pop() ?? new Sprite(this.puffTex);
    s.texture = this.puffTex;
    s.anchor.set(0.5); s.x = x; s.y = y; s.scale.set(0.7 * scale);
    s.tint = color ?? 0xffffff; s.alpha = 0.8;
    this.world.addChild(s);
    this.parts.push({ s, vx: (this.r() - 0.5) * 18, vy, life: 0, max: 0.9 + this.r() * 0.5, grav: -6 });
  }
  private spark(x: number, y: number, color: number, n: number, up = 60): void {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= (this.settings.kMaxParticles ?? 400)) return;
      const s = this.partPool.pop() ?? new Sprite();
      s.texture = this.puffTex;
      s.anchor.set(0.5); s.x = x; s.y = y; s.scale.set(0.2 + this.r() * 0.14);
      s.tint = color; s.alpha = 1;
      this.world.addChild(s);
      this.parts.push({ s, vx: (this.r() - 0.5) * 130, vy: -this.r() * up, life: 0, max: 0.4 + this.r() * 0.4, grav: 190 });
    }
  }

  // ── the chain engine: strings that visibly pull ──────────────────────────
  private pull(name: string, after: () => void): void {
    const s = this.strings[name];
    if (!s || s.at >= 0) { after(); return; }
    s.at = 0; s.after = after;
    s.bead.visible = true;
    this.sfx('chain', s.pts[0][0]);
  }

  private updateStrings(dt: number): void {
    for (const k of Object.keys(this.strings)) {
      const s = this.strings[k];
      if (s.at < 0) continue;
      s.at += dt;
      const total = s.pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - s.pts[i][0], p[1] - s.pts[i][1]), 0);
      let want = Math.min(1, s.at / 0.55) * total;
      let i = 1;
      while (i < s.pts.length) {
        const d = Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
        if (want <= d) {
          const f = d ? want / d : 0;
          s.bead.x = s.pts[i - 1][0] + (s.pts[i][0] - s.pts[i - 1][0]) * f;
          s.bead.y = s.pts[i - 1][1] + (s.pts[i][1] - s.pts[i - 1][1]) * f;
          break;
        }
        want -= d; i++;
      }
      if (s.at >= 0.55) {
        s.at = -1; s.bead.visible = false;
        const cb = s.after; s.after = null;
        if (cb) cb();
      }
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

  private dropBall(): void {
    if (this.balls.length >= (this.settings.kMaxBalls ?? 24)) return;
    const s = new Sprite(this.ballTex);
    s.anchor.set(0.5); s.scale.set(1.6);
    s.x = 150; s.y = 300;
    this.world.addChild(s);
    this.balls.push({ s, u: 0, v: 0, hit: false });
    this.sfx('release', 150);
  }

  private slamGate(): void {
    this.gateClosed = true;
    this.gateHold = 2.5;
    this.sfx('gate', 950);
    this.spark(950, 492, 0xff6b6b, 5, 40);
  }

  private sendMail(domain: string): void {
    if (this.mails.length >= 6) return;
    const s = new Sprite(this.mailTex);
    s.anchor.set(0.5); s.scale.set(1.8);
    const p = TUBE.at(0); s.x = p.x; s.y = p.y;
    this.world.addChild(s);
    this.mails.push({ s, u: 0 });
    this.sfx('mail', p.x);
    this.pending.push({ at: this.t + 1.5, kind: '_bell', text: domain });
  }

  private stampPlate(hostname: string): void {
    if (this.stampT < 0.6) return;
    this.stampT = 0;
    this.stampName = hostname || 'ANON';
    this.sfx('stamp', 470);
  }
  private stampT = 9; private stampName = '';

  private clamp(): void {
    this.clampT = 0;
    this.vaneSpin = 14;
    this.sfx('clamp', 800);
  }
  private clampT = 9;

  private alarm(): void {
    this.lampAt = this.t;
    this.whistleT = 0;
    this.sfx('whistle', 1180);
    this.rollCart();
  }
  private whistleT = 9;

  private rollCart(): void {
    if (this.cartT >= 0 && this.cartT < 2.6) return;
    this.cartT = 0;
  }
  private cartT = 9;

  private clutchDrop(): void {
    this.shudder = 1;
    this.sfx('shudder', 1150);
    for (let i = 0; i < 6; i++) this.puff(900 + this.r() * 500, 600 + this.r() * 140, 1.2);
    this.say('MASTER CLUTCH DROPPED — REENGAGING');
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt: number, pressure: number): void {
    this.t += dt;
    this.pressure = pressure;
    const speed = 0.25 + pressure * 1.9;
    this.gearPhase += dt * speed * (1 - this.shudder * 0.95);
    for (const g of this.train) g.s.rotation = this.gearPhase * g.ratio + g.phase;

    // the flywheel and its pump rod to the boiler
    this.flywheel.rotation = this.gearPhase * 0.55;
    {
      const a = this.flywheel.rotation;
      const px = 1560 + Math.cos(a) * 52, py = 770 + Math.sin(a) * 52;
      const sx = 1560 - (Math.cos(a) * 52 + Math.sqrt(Math.max(0, 105 * 105 - Math.pow(Math.sin(a) * 52, 2))));
      this.rod.x = px; this.rod.y = py;
      this.rod.scale.set(Math.hypot(sx - px, 770 - py) / 6, 1);
      this.rod.rotation = Math.atan2(770 - py, sx - px);
    }
    // the vane wheel on the steam pipe
    this.vaneSpin = Math.max(0, this.vaneSpin - dt * 4);
    this.vane.rotation += dt * this.vaneSpin;

    // furnace fire flickers with pressure
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl = 0.55 + pressure * 0.6 + Math.sin(this.t * (9 + i * 2.3) + i) * 0.18;
      f.alpha = Math.min(1, fl);
      f.scale.set(2 + pressure * 0.9 + Math.sin(this.t * 13 + i * 2) * 0.25);
    }
    // gauge needle
    this.needle.rotation = -Math.PI * 0.75 + Math.PI * 1.5 * pressure + Math.sin(this.t * 7) * 0.02;

    // ambient valve steam
    this.steamAt -= dt * (this.settings.kSteam ? (0.6 + pressure * 2.2) * (this.settings.kSteamDensity ?? 1) : 0);
    if (this.steamAt <= 0) {
      this.steamAt = 0.5;
      if (this.settings.kSteam) this.puff(this.r() < 0.5 ? 1180 : 800, this.r() < 0.5 ? 548 : 594, 0.9);
    }

    // the gate holds or frees
    if (this.gateClosed) {
      this.gateHold -= dt;
      if (this.gateHold <= 0) this.gateClosed = false;
    }
    this.gate.y = this.gateClosed ? 498 : Math.max(452, this.gate.y - dt * 220);

    // balls roll the run, smashing the dominoes, held by the gate
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      const held = this.gateClosed && b.u >= U_GATE - 0.012 && b.u < U_GATE;
      if (!held) {
        b.v = Math.min(0.42, b.v + dt * 0.28);
        b.u += (b.v * dt) / 3.0;
      }
      if (!b.hit && b.u >= U_DOMINO) {
        b.hit = true;
        if (this.dominoAt < 0 || this.t - this.dominoAt > 4) {
          this.dominoAt = this.t;
          this.sfx('clack', 680);
          // the last domino tips the lever, and the lever yanks the gate cord
          if (this.settings.kChains) {
            this.pending.push({ at: this.t + 0.75, kind: '_lever' });
          }
        }
      }
      const p = RUN.at(Math.min(b.u, U_GATE - (held ? 0.013 : 0)));
      b.s.x = p.x; b.s.y = p.y + 3; b.s.rotation += dt * b.v * 9;
      if (b.u >= 1) {
        this.world.removeChild(b.s); this.balls.splice(i, 1);
        this.sfx('clack', 1150);
        this.spark(1150, 528, 0xe8eef8, 3, 50);
        this.puff(1150, 520, 0.8, 0xd8c9a0, -14);
        // the funnel's cord trips the stamp: the chain completes at the boiler
        if (this.settings.kChains) {
          this.pull('funnel', () => this.stampPlate(this.lastDhcp || 'TRAFFIC'));
        }
      }
    }

    // dominoes topple in sequence
    if (this.dominoAt >= 0) {
      for (let i = 0; i < this.dominoes.length; i++) {
        const d = this.dominoes[i];
        const k = this.t - this.dominoAt - i * 0.09;
        if (k > 0) d.s.rotation = Math.min(1.45, k * 12);
      }
      if (this.t - this.dominoAt > 4) {
        this.dominoAt = -9;
        for (const d of this.dominoes) d.s.rotation = 0;
      }
    }
    // the lever yanks and frees the gate
    if (this.leverAt >= 0) {
      const k = this.t - this.leverAt;
      this.lever.rotation = -0.35 + Math.sin(Math.min(1, k / 0.5) * Math.PI) * 0.85;
      if (k >= 0.5) { this.leverAt = -9; this.lever.rotation = -0.35; }
    }

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
      this.stampArm.y = 505 + k * 30;
      if (this.stampT >= 1) this.addPlate(this.stampName);
    }
    this.hammer.rotation = -0.5 + Math.sin(this.t * 1.7) * 0.12;
    // clamp arm swings out and back; steam puffs purple
    if (this.clampT < 1.6) {
      this.clampT += dt * 2.2;
      const k = Math.sin(Math.min(1, this.clampT / 1.6) * Math.PI);
      this.clampArm.rotation = -0.9 + k * 0.9;
      if (this.clampT >= 1.6) this.clampArm.rotation = 0;
      if (this.clampT > 0.5 && this.clampT < 0.7 && this.r() < 0.4) this.puff(800, 594, 0.8, 0xc08cff, -18);
    }
    // whistle + lamp
    if (this.whistleT < 1.4) {
      this.whistleT += dt * 1.6;
      this.whistle.alpha = Math.max(0, 1 - this.whistleT / 1.4) * 0.9;
      this.whistle.scale.set(1 + this.whistleT * 1.8);
      if (this.r() < 0.6) this.puff(1180, 540, 1.2, 0xffffff, -60);
    }
    const lampOn = this.t - this.lampAt < 3;
    this.lamp.alpha = lampOn ? (Math.sin(this.t * 14) > 0 ? 1 : 0.25) : 0.25;
    // the coal cart rolls its ramp and dumps into the firebox
    if (this.cartT < 2.6) {
      this.cartT += dt * 1.1;
      const k = Math.min(1, this.cartT / 1.6);
      this.cart.x = RAMP.x0 - 20 + k * (RAMP.x1 - RAMP.x0 + 40);
      this.cart.y = RAMP.y0 - 8 + k * (RAMP.y1 - RAMP.y0);
      if (this.cartT >= 1.6 && this.cartT - dt * 1.1 < 1.6) {
        this.sfx('coal', 1250);
        this.spark(1230, 918, 0xff7a2a, 12, 90);
      }
      if (this.cartT >= 2.6) { this.cartT = 9; this.cart.x = RAMP.x0 - 20; this.cart.y = RAMP.y0 - 8; }
    }
    // bell swing
    this.bell.rotation = Math.max(0, Math.sin(this.t * 22)) * 0.4 * (this.t - this.bellAt < 0.8 ? 1 : 0);
    this.shudder = Math.max(0, this.shudder - dt * 1.4);

    // pending: the lever yank, the bell and its cord
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.t >= p.at) {
        this.pending.splice(i, 1);
        if (p.kind === '_lever') {
          this.leverAt = this.t;
          this.pull('lever', () => { this.gateClosed = false; });
        } else if (p.kind === '_bell') {
          this.ringBell(p.text ?? '');
          this.directoryEntry(p.text ?? '');
          if (this.settings.kChains) this.pull('bell', () => this.rollCart());
        } else this.fire(p.kind, p.text);
      }
    }
    this.updateStrings(dt);

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

  private lastDhcp = '';

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
    this.directoryEntries.forEach((d, i) => drawText(c, d.slice(0, 30), 8, 4 + i * 15, '#3a2c14', null, 2));
    this.directoryTex.source.update?.();
  }

  private addPlate(hostname: string): void {
    this.lastDhcp = hostname || this.lastDhcp;
    const max = this.settings.kRack ?? 24;
    const name = (hostname || 'ANON').slice(0, 11);
    const s = new Sprite(tex(plateTexture(name)));
    s.anchor.set(0, 0.5); s.scale.set(1.2);
    s.x = 470; s.y = 545;
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
  applyCamera(): void {
    this.world.x = (this.vw - WORLD_W) / 2;
    this.world.y = (this.vh - WORLD_H) / 2;
  }
}
