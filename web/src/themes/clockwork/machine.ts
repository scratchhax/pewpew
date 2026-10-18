import { Container, Sprite, Texture } from 'pixi.js';
import {
  P, canvas, tex, rng, drawText, gearTexture, boilerTexture, furnaceTexture,
  gaugeTexture, needleTexture, plateTexture, ballTexture, mailTexture, cartTexture,
  lampTexture, whistleTexture, puffTexture, flameTexture, hammerTexture, bellTexture,
  dominoTexture, funnelTexture, flywheelTexture, vaneTexture, leverTexture,
  glowTexture, pendulumTexture,
} from './sprites';

/**
 * Hero parts atlas: LLM-generated stickers baked by scripts/bake-clockwork.mjs
 * (see PROMPTS.md), pixelated and palette-quantised so they share the
 * procedural parts' chunky language. Optional - a fresh clone without
 * assets/machine.png simply gets the procedural parts.
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
 * great boiler. The room is dark and the boiler is the only light: a warm
 * glow spills from it and tints to the colour of the last event. Nothing
 * stands alone - trusses run device to device, dominoes tip levers, levers
 * yank ropes, ropes trip the next device, and every chain ends at the boiler.
 *
 *   allow  : a bearing drops in the chute, rolls the switchback, smashes a
 *            domino run, tips the lever (which yanks the gate rope), passes
 *            the gate, and drops into the boiler-top funnel - the funnel's
 *            rope goes taut across the shop and trips the nameplate stamp.
 *   block  : the safety gate slams and holds a bearing until the lever frees it.
 *   dns    : steam fires an envelope up the tube to the directory; the bell
 *            rings and its rope, over a pulley, releases the coal cart.
 *   threat : the whistle screams, the lamp flashes, the cart rolls its ramp
 *            and tips its load into the firebox.
 *   wifi   : the coupling arm clamps the steam pipe and the vane wheel spins.
 *   system : the clutch drops; the flywheel and every gear spin down.
 *
 * At idle the machine still lives: gears turn, the flywheel hums, a pendulum
 * swings, valves breathe, and every few seconds a test bearing runs the
 * whole course by itself.
 */

export const WORLD_W = 1500;
export const WORLD_H = 850;

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
const RUN = new Path([[120, 270], [620, 310], [170, 345], [1220, 385], [900, 420]]);
const TUBE = new Path([[1120, 450], [1120, 180], [700, 180], [700, 165]]);
const RAMP = { x0: 1300, y0: 500, x1: 1010, y1: 740 };
const railY1 = (x: number) => 270 + ((x - 120) / 500) * 40;
const U_GATE = RUN.uAtX(800, 2);
const U_DOMINO = RUN.uAtX(420, 0);

/** Event law, as light. */
const EVENT_TINT: Record<string, number> = {
  allow: 0x5ce6a4, block: 0xff6b6b, threat: 0xff9a45, dns: 0x55b5ff,
  dhcp: 0xffd84d, wifi: 0xc08cff, system: 0x7d99b3,
};

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
  private pendulum!: Sprite;
  private glow!: Sprite;
  private glowAt = -9;
  private glowTint = 0xffb347;
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
  private ventAt = 2;
  private autoAt = 6;
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
      // the room: near-black, warmed from below by the furnace
      const g = x.createLinearGradient(0, 0, 0, WORLD_H);
      g.addColorStop(0, '#100e16'); g.addColorStop(0.62, '#171219'); g.addColorStop(1, '#2b1a10');
      x.fillStyle = g; x.fillRect(0, 0, WORLD_W, WORLD_H);
      const fg = x.createRadialGradient(900, 790, 40, 900, 790, 620);
      fg.addColorStop(0, 'rgba(255,140,50,0.20)'); fg.addColorStop(1, 'rgba(255,140,50,0)');
      x.fillStyle = fg; x.fillRect(0, 0, WORLD_W, WORLD_H);
      x.fillStyle = P.oak; x.fillRect(0, WORLD_H - 34, WORLD_W, 34);
      x.fillStyle = P.oakLight; x.fillRect(0, WORLD_H - 34, WORLD_W, 4);

      const girder = (gx: number, gy: number, gw: number, gh: number) => {
        x.fillStyle = P.ironDark; x.fillRect(gx, gy, gw, gh);
        x.fillStyle = P.iron; x.fillRect(gx + 2, gy + 2, gw - 4, gh - 4);
        x.fillStyle = P.ironHi;
        const ry = gy + Math.floor(gh / 2) - 1;
        for (let i = gx + 6; i < gx + gw - 4; i += 18) x.fillRect(i, ry, 2, 2);
      };
      girder(0, 205, WORLD_W, 12);
      girder(26, 0, 14, WORLD_H); girder(WORLD_W - 40, 0, 14, WORLD_H);

      // the ball run: fat iron trusses with rivets
      const truss = (x0: number, y0: number, x1: number, y1: number, th: number) => {
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
        for (let i = 0; i <= steps; i++) {
          const f = i / steps, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
          x.fillStyle = P.iron; x.fillRect(px - 3, py, 6, th);
          x.fillStyle = P.ironLight; x.fillRect(px - 3, py, 6, 3);
          x.fillStyle = P.ironDark; x.fillRect(px - 2, py + th - 3, 4, 3);
          if (i % 20 === 0) { x.fillStyle = P.brass; x.fillRect(px - 4, py + th, 8, 4); }
        }
      };
      for (let k = 0; k < RUN.pts.length - 1; k++) {
        const [x0, y0] = RUN.pts[k], [x1, y1] = RUN.pts[k + 1];
        truss(x0, y0, x1, y1, 11);
      }
      // the chute bearings drop from
      x.fillStyle = P.iron; x.fillRect(98, 240, 44, 32);
      x.fillStyle = P.ironDark; x.fillRect(104, 246, 32, 20);
      drawText(x, 'IN', 104, 224, P.ironHi, null, 2);

      // the coal ramp down to the firebox
      truss(RAMP.x0, RAMP.y0, RAMP.x1, RAMP.y1, 9);
      // the flywheel's guide rail
      x.fillStyle = P.iron; x.fillRect(1105, 634, 130, 12);
      x.fillStyle = P.ironLight; x.fillRect(1105, 634, 130, 3);

      // the pneumatic tube from the boiler shoulder to the directory
      for (let k = 0; k < TUBE.pts.length - 1; k++) {
        const [x0, y0] = TUBE.pts[k], [x1, y1] = TUBE.pts[k + 1];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
        for (let i = 0; i <= steps; i++) {
          const f = i / steps, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
          x.fillStyle = P.copper; x.fillRect(px - 6, py - 6, 12, 12);
          x.fillStyle = P.copperLight; x.fillRect(px - 6, py - 6, 4, 12);
          if (i % 34 === 0 && i > 0 && i < steps) { x.fillStyle = P.brass; x.fillRect(px - 8, py - 8, 16, 16); x.fillStyle = P.copper; x.fillRect(px - 6, py - 6, 12, 12); x.fillStyle = P.copperLight; x.fillRect(px - 6, py - 6, 4, 12); }
        }
      }
      // the steam pipe from the boiler shoulder to the vane wheel
      x.fillStyle = P.copper; x.fillRect(593, 554, 70, 12);
      x.fillStyle = P.copperLight; x.fillRect(593, 554, 70, 4);

      // the funnel's downpipe into the boiler dome
      x.fillStyle = P.brassDark; x.fillRect(886, 442, 28, 26);
      x.fillStyle = P.brass; x.fillRect(890, 442, 20, 26);

      // ropes, drawn once (they go taut when pulled)
      const rope = (pts: number[][], sag: number) => {
        x.strokeStyle = '#5a4426'; x.lineWidth = 3;
        x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i - 1], [qx, qy] = pts[i];
          x.quadraticCurveTo((px + qx) / 2, (py + qy) / 2 + sag, qx, qy);
        }
        x.stroke();
      };
      rope([[560, 308], [800, 366]], 12);
      rope([[900, 432], [900, 392], [340, 392], [340, 398]], 8);
      rope([[930, 42], [1380, 92], [1285, 495]], 14);
      for (const [px, py] of [[900, 392], [340, 392], [1380, 92]]) {
        x.fillStyle = P.brass; x.beginPath(); x.arc(px, py, 7, 0, 7); x.fill();
        x.fillStyle = P.brassDark; x.beginPath(); x.arc(px, py, 3, 0, 7); x.fill();
      }

      // nameplate rack
      x.fillStyle = P.oak; x.fillRect(150, 430, 380, 150);
      x.fillStyle = P.oakLight; x.fillRect(154, 434, 372, 4);
      x.fillStyle = '#120f18'; x.fillRect(162, 442, 356, 130);
      for (let row = 0; row < 5; row++) {
        x.fillStyle = P.brassDark; x.fillRect(162, 470 + row * 28, 356, 3);
        for (let i = 168; i < 512; i += 10) { x.fillStyle = P.brass; x.fillRect(i, 466 + row * 28, 3, 5); }
      }
      drawText(x, 'THE RACK', 166, 434, P.brassLight, null, 2);

      // directory board: dark slate, brass lettering
      x.fillStyle = P.brassDark; x.fillRect(516, 26, 388, 138);
      x.fillStyle = P.ironDark; x.fillRect(520, 30, 380, 130);
      x.fillStyle = '#1c1826'; x.fillRect(530, 58, 360, 96);
      drawText(x, 'DIRECTORY', 534, 36, P.brassLight, null, 2);

      // coupling manifold at the pipe's boiler end
      x.fillStyle = P.iron; x.fillRect(652, 546, 28, 30);
      x.fillStyle = P.wifi; x.fillRect(660, 554, 8, 8);
      drawText(x, 'COUPLING', 600, 574, P.ironHi, null, 2);

      // the firebox mouth at the ramp's foot
      drawText(x, 'FIREBOX', 940, 758, P.ember, null, 2);

      // boiler brick surround: dark mortar, warm irregular brick
      x.fillStyle = '#17110c'; x.fillRect(600, 380, 600, 470);
      for (let j = 384, n = 0; j < 846; j += 12, n++) {
        for (let i = 604; i < 1196; i += 26) {
          const shade = ['#4a2e1c', '#422818', '#513420', '#3c2416'][(i * 7 + j * 13 + n) % 4];
          x.fillStyle = shade;
          x.fillRect(i + (n % 2 ? 13 : 0), j, 24, 10);
        }
      }
      x.fillStyle = 'rgba(255,150,60,0.10)';
      x.fillRect(600, 640, 600, 210);
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

    // the boiler's glow: the room's only lamp, tinted by the last event
    this.glow = add(tex(glowTexture(512)), 900, 610);
    this.glow.scale.set(2.1, 1.7);
    this.glow.tint = this.glowTint;
    this.glow.blendMode = 'add';
    this.glow.alpha = 0.16;

    // gear trains: the crank beside the boiler dome, one tower in the left gap
    const crank = this.addGear(760, 430, 20, true);
    this.meshAt(crank, 13, 168, false);
    this.meshAt(crank, 13, 12, false);
    const lt = this.addGear(430, 700, 26, true);
    this.meshAt(lt, 13, -35, false);

    // the great boiler and its fittings
    const boilerS = new Sprite(this.heroes.boiler ?? tex(boilerTexture(440, 260)));
    if (this.heroes.boiler) { boilerS.anchor.set(0.5); boilerS.x = 900; boilerS.y = 600; }
    else { boilerS.x = 680; boilerS.y = 470; }
    this.world.addChild(boilerS);
    const furnaceS = new Sprite(this.heroes.furnace ?? tex(furnaceTexture(170, 130)));
    if (this.heroes.furnace) { furnaceS.anchor.set(0.5); furnaceS.x = 900; furnaceS.y = 770; }
    else { furnaceS.x = 815; furnaceS.y = 705; }
    this.world.addChild(furnaceS);
    for (let i = 0; i < 5; i++) {
      const f = add(tex(flameTexture()), 850 + i * 25, 812, 0.5, 1);
      f.scale.set(2.2);
      this.flames.push(f);
    }
    add(this.heroes.gauge ?? tex(gaugeTexture(65)), 720, 500);
    this.needle = add(tex(needleTexture(45)), 720, 500, 0.05, 0.5);
    add(this.heroes.whistle ?? tex(whistleTexture()), 930, 425, 0.5, 1);
    this.whistle = add(tex(puffTexture()), 930, 408); this.whistle.alpha = 0;
    this.lamp = add(this.heroes.lamp ?? tex(lampTexture(P.threat)), 1180, 430); this.lamp.alpha = 0.25;

    // the flywheel and its rod to the boiler pump
    this.flywheel = add(tex(flywheelTexture(70)), 1260, 640);
    this.rod = add(tex(canvas(6, 6, (c2) => { c2.fillStyle = P.ironLight; c2.fillRect(0, 1, 6, 4); })), 1260, 640, 0, 0.5);

    // the vane wheel on the steam pipe
    this.vane = add(tex(vaneTexture()), 565, 560);
    this.clampArm = add(this.heroes.clamp ?? tex(canvas(70, 12, (c2) => { c2.fillStyle = P.oakLight; c2.fillRect(0, 5, 50, 4); c2.fillStyle = P.brass; c2.fillRect(48, 0, 20, 12); })), 610, 560, 0.05, 0.5);

    // the funnel the run ends in
    add(tex(funnelTexture()), 900, 418);

    // dominoes along the first truss
    const dom = tex(dominoTexture());
    for (let i = 0; i < 6; i++) {
      const dx = 420 + i * 24;
      const s = add(dom, dx, railY1(dx) + 8, 0.5, 1);
      this.dominoes.push({ s, at: -9 });
    }
    this.lever = add(tex(leverTexture()), 560, railY1(560) + 3, 0.05, 0.5);
    this.lever.rotation = -0.35;

    // the safety gate across the long run
    this.gate = add(tex(canvas(18, 52, (c2) => { c2.fillStyle = P.iron; c2.fillRect(0, 0, 18, 52); c2.fillStyle = P.block; c2.fillRect(0, 0, 18, 7); c2.fillStyle = P.ironDark; for (let j = 12; j < 50; j += 9) c2.fillRect(0, j, 18, 3); })), 800, 364, 0.5, 0);

    // the coal cart on its ramp (mirrored to face downhill; the negative
    // x-scale mirrors the rotation too, so the tilt is -0.65)
    this.cart = add(this.heroes.cart ?? tex(cartTexture()), 0, 0);
    this.cart.scale.x = -1; this.cart.rotation = -0.65;
    const cp = this.cartPos(0.05);
    this.cart.x = cp.x; this.cart.y = cp.y;

    // stamp, hammer, bell over the rack and directory
    this.hammer = add(tex(hammerTexture()), 340, 392, 0.05, 0.5);
    this.hammer.scale.set(1.6);
    this.stampArm = add(this.heroes.stamp ?? tex(canvas(16, 54, (c2) => { c2.fillStyle = P.iron; c2.fillRect(5, 0, 6, 40); c2.fillStyle = P.brass; c2.fillRect(0, 40, 16, 14); })), 340, 400, 0.5, 0);
    if (this.heroes.hopper) add(this.heroes.hopper, 1120, 458);
    this.bell = add(this.heroes.bell ?? tex(bellTexture()), 930, 30);

    // the pendulum beside the directory: the room's heartbeat
    this.pendulum = add(tex(pendulumTexture()), 480, 24, 0.5, 0);

    // string beads (the chains you can see travelling)
    const bead = () => {
      const b = new Sprite(tex(canvas(10, 10, (c2) => { c2.fillStyle = P.brassHi; c2.beginPath(); c2.arc(5, 5, 4, 0, 7); c2.fill(); })));
      b.anchor.set(0.5); b.visible = false;
      this.world.addChild(b);
      return b;
    };
    this.strings.lever = { pts: [[560, 308], [800, 366]], bead: bead(), at: -1, after: null };
    this.strings.funnel = { pts: [[900, 432], [900, 392], [340, 392], [340, 398]], bead: bead(), at: -1, after: null };
    this.strings.bell = { pts: [[930, 42], [1380, 92], [1285, 495]], bead: bead(), at: -1, after: null };

    // the directory sheet (redrawn as mail arrives)
    const dc = canvas(360, 96, (c2) => { c2.fillStyle = 'rgba(0,0,0,0)'; c2.fillRect(0, 0, 360, 96); });
    this.directoryCtx = dc.getContext('2d')!;
    this.directoryTex = tex(dc);
    this.directory = add(this.directoryTex, 530, 60, 0, 0);
    // rack slot anchors (5 rows x 6 cols)
    for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) this.rackSlots.push({ x: 172 + col * 55, y: 458 + row * 28 });
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

  // ── the chain engine: ropes that visibly pull ────────────────────────────
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
    this.glowAt = this.t;
    this.glowTint = EVENT_TINT[kind] ?? 0xffb347;
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
    s.x = 120; s.y = 244;
    this.world.addChild(s);
    this.balls.push({ s, u: 0, v: 0, hit: false });
    this.sfx('release', 120);
  }

  private slamGate(): void {
    this.gateClosed = true;
    this.gateHold = 2.5;
    this.sfx('gate', 800);
    this.spark(800, 416, 0xff6b6b, 5, 40);
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
    this.sfx('stamp', 340);
  }
  private stampT = 9; private stampName = '';

  private clamp(): void {
    this.clampT = 0;
    this.vaneSpin = 14;
    this.sfx('clamp', 610);
  }
  private clampT = 9;

  private alarm(): void {
    this.lampAt = this.t;
    this.whistleT = 0;
    this.sfx('whistle', 930);
    this.rollCart();
  }
  private whistleT = 9;

  private rollCart(): void {
    if (this.cartT >= 0 && this.cartT < 4.4) return;
    this.cartT = 0;
  }
  private cartT = 9;

  /** A point on the coal ramp at fraction s, lifted onto the rail. */
  private cartPos(s: number): { x: number; y: number } {
    const dx = RAMP.x1 - RAMP.x0, dy = RAMP.y1 - RAMP.y0;
    const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    return { x: RAMP.x0 + ux * s * len - uy * 14, y: RAMP.y0 + uy * s * len + ux * 14 };
  }

  private clutchDrop(): void {
    this.shudder = 1;
    this.sfx('shudder', 900);
    for (let i = 0; i < 6; i++) this.puff(700 + this.r() * 400, 480 + this.r() * 110, 1.2);
    this.say('MASTER CLUTCH DROPPED — REENGAGING');
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt: number, pressure: number): void {
    this.t += dt;
    this.pressure = pressure;
    const speed = 0.25 + pressure * 1.9;
    this.gearPhase += dt * speed * (1 - this.shudder * 0.95);
    for (const g of this.train) g.s.rotation = this.gearPhase * g.ratio + g.phase;

    // the boiler's glow: breathes with pressure, flashes the event colour -
    // but only as a whisper of tint over the furnace amber, never a wash
    {
      const fresh = Math.max(0, 1 - (this.t - this.glowAt) / 1.2);
      const w = 0xffb347;
      const mix = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
      const k = fresh * 0.35;
      this.glow.tint = (mix((w >> 16) & 255, (this.glowTint >> 16) & 255, k) << 16)
        | (mix((w >> 8) & 255, (this.glowTint >> 8) & 255, k) << 8)
        | mix(w & 255, this.glowTint & 255, k);
      this.glow.alpha = 0.13 + pressure * 0.16 + Math.sin(this.t * 2.2) * 0.02 + fresh * 0.22;
    }

    // the flywheel and its pump rod to the boiler
    this.flywheel.rotation = this.gearPhase * 0.55;
    {
      const a = this.flywheel.rotation;
      const px = 1260 + Math.cos(a) * 43, py = 640 + Math.sin(a) * 43;
      const sx = 1260 - (Math.cos(a) * 43 + Math.sqrt(Math.max(0, 95 * 95 - Math.pow(Math.sin(a) * 43, 2))));
      this.rod.x = px; this.rod.y = py;
      this.rod.scale.set(Math.hypot(sx - px, 640 - py) / 6, 1);
      this.rod.rotation = Math.atan2(640 - py, sx - px);
    }
    // the vane wheel on the steam pipe
    this.vaneSpin = Math.max(0, this.vaneSpin - dt * 4);
    this.vane.rotation += dt * this.vaneSpin;
    // the pendulum: the room's heartbeat, never stops
    this.pendulum.rotation = Math.sin(this.t * 1.1) * 0.42;

    // furnace fire flickers with pressure
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl = 0.55 + pressure * 0.6 + Math.sin(this.t * (9 + i * 2.3) + i) * 0.18;
      f.alpha = Math.min(1, fl);
      f.scale.set(2 + pressure * 0.9 + Math.sin(this.t * 13 + i * 2) * 0.25);
    }
    // gauge needle
    this.needle.rotation = -Math.PI * 0.75 + Math.PI * 1.5 * pressure + Math.sin(this.t * 7) * 0.02;

    // ambient valve steam + periodic vent whistles so the room breathes
    this.steamAt -= dt * (this.settings.kSteam ? (0.6 + pressure * 2.2) * (this.settings.kSteamDensity ?? 1) : 0);
    if (this.steamAt <= 0) {
      this.steamAt = 0.5;
      if (this.settings.kSteam) this.puff(this.r() < 0.5 ? 930 : 610, this.r() < 0.5 ? 408 : 554, 0.9);
    }
    this.ventAt -= dt;
    if (this.ventAt <= 0) {
      this.ventAt = 3 + this.r() * 3;
      const vx = this.r() < 0.5 ? 640 : 1120;
      for (let i = 0; i < 4; i++) this.puff(vx, 552, 1.1, 0xd8c9a0, -34);
    }

    // the gate holds or frees
    if (this.gateClosed) {
      this.gateHold -= dt;
      if (this.gateHold <= 0) this.gateClosed = false;
    }
    this.gate.y = this.gateClosed ? 416 : Math.max(364, this.gate.y - dt * 220);

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
          this.sfx('clack', 480);
          // the last domino tips the lever, and the lever yanks the gate rope
          if (this.settings.kChains) {
            this.pending.push({ at: this.t + 0.75, kind: '_lever' });
          }
        }
      }
      const p = RUN.at(Math.min(b.u, U_GATE - (held ? 0.013 : 0)));
      b.s.x = p.x; b.s.y = p.y + 3; b.s.rotation += dt * b.v * 9;
      if (b.u >= 1) {
        this.world.removeChild(b.s); this.balls.splice(i, 1);
        this.sfx('clack', 900);
        this.spark(900, 412, 0xe8eef8, 3, 50);
        this.puff(900, 404, 0.8, 0xd8c9a0, -14);
        // the funnel's rope trips the stamp: the chain completes at the boiler
        if (this.settings.kChains) {
          this.pull('funnel', () => this.stampPlate(this.lastDhcp || 'TRAFFIC'));
        }
      }
    }

    // an idle machine is a dead machine: run a test bearing by ourselves
    this.autoAt -= dt;
    if (this.autoAt <= 0) {
      this.autoAt = 7 + this.r() * 4;
      if (this.settings.kBalls && this.balls.length === 0 && this.cartT >= 9) this.dropBall();
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
      this.stampArm.y = 400 + k * 30;
      if (this.stampT >= 1) this.addPlate(this.stampName);
    }
    this.hammer.rotation = -0.5 + Math.sin(this.t * 1.7) * 0.12;
    // clamp arm swings out and back; steam puffs purple
    if (this.clampT < 1.6) {
      this.clampT += dt * 2.2;
      const k = Math.sin(Math.min(1, this.clampT / 1.6) * Math.PI);
      this.clampArm.rotation = -0.9 + k * 0.9;
      if (this.clampT >= 1.6) this.clampArm.rotation = 0;
      if (this.clampT > 0.5 && this.clampT < 0.7 && this.r() < 0.4) this.puff(610, 554, 0.8, 0xc08cff, -18);
    }
    // whistle + lamp
    if (this.whistleT < 1.4) {
      this.whistleT += dt * 1.6;
      this.whistle.alpha = Math.max(0, 1 - this.whistleT / 1.4) * 0.9;
      this.whistle.scale.set(1 + this.whistleT * 1.8);
      if (this.r() < 0.6) this.puff(930, 400, 1.2, 0xffffff, -60);
    }
    const lampOn = this.t - this.lampAt < 3;
    this.lamp.alpha = lampOn ? (Math.sin(this.t * 14) > 0 ? 1 : 0.25) : 0.25;
    // the coal cart: rolls down, tips its load into the firebox, rolls back
    if (this.cartT < 4.4) {
      const was = this.cartT;
      this.cartT += dt;
      const t = this.cartT;
      let s = 0.05, tip = 0;
      if (t < 1.6) {
        const k = t / 1.6;
        s = 0.05 + 0.92 * (k * k * (3 - 2 * k));
      } else if (t < 2.6) {
        s = 0.97;
        tip = Math.min(1, (t - 1.6) / 0.35);
      } else if (t < 3.0) {
        s = 0.97;
        tip = 1 - (t - 2.6) / 0.4;
      } else {
        const k = (t - 3.0) / 1.4;
        s = 0.97 - 0.92 * (k * k * (3 - 2 * k));
      }
      const cp = this.cartPos(s);
      this.cart.x = cp.x; this.cart.y = cp.y;
      this.cart.rotation = -0.65 - tip * 0.85;
      if (was < 1.6 && t >= 1.6) {
        this.sfx('coal', 1000);
        this.spark(985, 758, 0xff7a2a, 12, 90);
      }
      if (t >= 4.4) {
        this.cartT = 9;
        const p0 = this.cartPos(0.05);
        this.cart.x = p0.x; this.cart.y = p0.y;
        this.cart.rotation = -0.65;
      }
    }
    // bell swing
    this.bell.rotation = Math.max(0, Math.sin(this.t * 22)) * 0.4 * (this.t - this.bellAt < 0.8 ? 1 : 0);
    this.shudder = Math.max(0, this.shudder - dt * 1.4);

    // pending: the lever yank, the bell and its rope
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
    this.sfx('bell', 930);
    if (domain) this.say(`MAIL DELIVERED — ${domain.slice(0, 28)}`);
  }
  private bellAt = -9;

  private directoryEntries: string[] = [];
  private directoryEntry(domain: string): void {
    if (!domain) return;
    this.directoryEntries.unshift(domain.replace(/\.$/, ''));
    this.directoryEntries = this.directoryEntries.slice(0, 6);
    const c = this.directoryCtx;
    c.clearRect(0, 0, 360, 96);
    this.directoryEntries.forEach((d, i) => drawText(c, d.slice(0, 26), 6, 4 + i * 15, '#d9a94a', null, 2));
    this.directoryTex.source.update?.();
  }

  private addPlate(hostname: string): void {
    this.lastDhcp = hostname || this.lastDhcp;
    const max = this.settings.kRack ?? 24;
    const name = (hostname || 'ANON').slice(0, 11);
    const s = new Sprite(tex(plateTexture(name)));
    s.anchor.set(0, 0.5); s.scale.set(1.2);
    s.x = 340; s.y = 440;
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
