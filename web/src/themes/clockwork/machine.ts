import { Container, Graphics } from 'pixi.js';
import { frameAt, PartSprite, type Parts } from './art';

/**
 * The machine: one continuous causal run that every event travels end to end.
 *
 * The first attempt at this scene was a room with handsome machines standing
 * about in it, and it was deleted. The failure was not the art - the baked
 * stickers were good - it was that you could not see a chain. The linkages
 * were one-pixel lines on black, half the frame was empty, and two screenshots
 * eight seconds apart showed the machine in the same pose.
 *
 * So this one is built path-first, and it was staged in flat grey boxes before
 * any art went near it. There is exactly one run. It enters top left, cascades
 * down and right through nine legs, and ends in the firebox under the boiler.
 * Every event is a bearing that physically walks that whole path; the
 * differences between event kinds are what the bearing sets off on the way
 * past, never a different route.
 *
 * The art hangs off that skeleton. Every part that moves is a baked sprite
 * whose frames were derived by rotating one still about its pivot, so the
 * dominoes topple, the see-saw tips, the cart tilts and the gears turn in the
 * same chunky pixel language the rails and ropes are drawn in.
 */

/** 16:9, and an exact integer scale on every common display: 1920/640 = 3. */
export const WORLD_W = 640;
export const WORLD_H = 360;

/** The size language: everything is measured against the bearing. */
export const BEARING = 8;
const U = BEARING;

export type Kind = 'allow' | 'block' | 'dns' | 'dhcp' | 'wifi' | 'threat' | 'system';

const TINT: Record<Kind, number> = {
  allow: 0x9effc8, block: 0xff9a9a, dns: 0x9ad2ff, dhcp: 0xdcb4ff,
  wifi: 0xffe88a, threat: 0xffb07a, system: 0xd8dde8,
};

type Motion = 'roll' | 'fly' | 'drop' | 'ride';

interface Leg {
  name: string;
  motion: Motion;
  x0: number; y0: number; x1: number; y1: number;
  secs: number;
  arc?: number;
}

/**
 * THE RUN, hand-placed around the HUD. The shared panels occupy roughly
 * x<62 y<100 (top left), x>540 y<147 (top right), x<193 y>233 (bottom left)
 * and x>543 y>247 (bottom right) in world units; nothing load-bearing goes
 * in those corners.
 */
export const RUN: Leg[] = [
  { name: 'intake', motion: 'drop', x0: 78, y0: 16, x1: 78, y1: 32, secs: 0.35 },
  { name: 'rail', motion: 'roll', x0: 78, y0: 32, x1: 172, y1: 104, secs: 1.2 },
  { name: 'dominoes', motion: 'roll', x0: 172, y0: 104, x1: 268, y1: 110, secs: 1.0 },
  { name: 'seesaw', motion: 'ride', x0: 268, y0: 110, x1: 302, y1: 104, secs: 0.8 },
  { name: 'flight', motion: 'fly', x0: 302, y0: 104, x1: 334, y1: 84, secs: 0.7, arc: 24 },
  { name: 'funnel', motion: 'roll', x0: 334, y0: 84, x1: 340, y1: 96, secs: 0.3 },
  { name: 'standpipe', motion: 'drop', x0: 340, y0: 96, x1: 348, y1: 190, secs: 0.75 },
  { name: 'cart', motion: 'ride', x0: 354, y0: 198, x1: 462, y1: 254, secs: 1.3 },
  { name: 'firebox', motion: 'drop', x0: 468, y0: 258, x1: 506, y1: 276, secs: 0.4 },
];

export const BOILER = { x: 452, y: 174, w: 122, h: 78 };
/**
 * The firebox sits BETWEEN the boiler's legs, overlapping the drum by a few
 * units. Placed below and to the left it read as a separate brick arch that
 * happened to be nearby, which is how the first version looked too.
 */
export const FIREBOX = { x: 480, y: 242, w: 62, h: 46 };
export const FLYWHEEL = { x: 602, y: 210, r: 28 };
export const RACK = { x: 196, y: 172, w: 110, h: 72 };
export const GEARS = [
  { x: 96, y: 168, s: 1.0, dir: 1 },
  { x: 150, y: 196, s: 0.82, dir: -1 },
  { x: 118, y: 232, s: 0.6, dir: 1 },
];
export const DOMINO_N = 9;
/** The overhead line shaft's height, in world units. */
const SHAFT_Y = 150;
/** Where a nameplate hangs on the rack: four rails, five slots each. */
const PLATE_SLOTS = 20;

/**
 * The linkages, drawn rather than baked.
 *
 * This is the part the first version of the scene got most wrong. It promised
 * "dominoes tip levers, levers yank strings, every chain ends at the boiler"
 * and then drew those strings as one-pixel lines on a black background, so the
 * causal chain - the entire idea - was invisible. Anything that joins two
 * stations here is structural: a truss you can count the braces on, a belt
 * with seams that travel, a rope that visibly hangs slack and snaps taut.
 */

/** A riveted truss: two rails, zigzag bracing, brass rivets along the top. */
function truss(g: Graphics, x0: number, y0: number, x1: number, y1: number, d = 7): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 2) return;
  const nx = -dy / len, ny = dx / len;
  const ax = x0 + nx * d, ay = y0 + ny * d, bx = x1 + nx * d, by = y1 + ny * d;
  const n = Math.max(2, Math.round(len / 12));
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n;
    g.moveTo(x0 + dx * u0, y0 + dy * u0).lineTo(ax + (bx - ax) * u1, ay + (by - ay) * u1)
      .stroke({ width: 1.5, color: 0x3a3d4d });
    g.moveTo(ax + (bx - ax) * u0, ay + (by - ay) * u0).lineTo(x0 + dx * u1, y0 + dy * u1)
      .stroke({ width: 1.5, color: 0x3a3d4d });
  }
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 2.5, color: 0x4a4f5a });
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: 0x767b92 });
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    g.circle(x0 + dx * u, y0 + dy * u, 1.3).fill(0xa87c2a);
  }
}

/**
 * A drive belt between two pulleys, with seams that travel along it.
 *
 * The two runs are drawn parallel at the narrower pulley's radius rather than
 * as true tangents. Geometrically a belt between a 7-unit pulley and a 26-unit
 * flywheel really is a wedge, but at this size it reads as a sling rather than
 * as a belt, and the convention is what the eye wants.
 */
function belt(g: Graphics, x0: number, y0: number, r0: number,
  x1: number, y1: number, r1: number, phase: number): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 2) return;
  const nx = -dy / len, ny = dx / len;
  const w = Math.max(3, Math.min(r0, r1) * 0.85);
  for (const s of [1, -1]) {
    g.moveTo(x0 + nx * w * s, y0 + ny * w * s).lineTo(x1 + nx * w * s, y1 + ny * w * s)
      .stroke({ width: 2.5, color: 0x2a2336 });
  }
  const n = Math.max(3, Math.round(len / 10));
  for (let i = 0; i < n; i++) {
    const u = ((i / n) + phase) % 1;
    const px = x0 + dx * u, py = y0 + dy * u;
    g.moveTo(px + nx * w, py + ny * w).lineTo(px + nx * (w - 3), py + ny * (w - 3))
      .stroke({ width: 1.5, color: 0x4a3320 });
    g.moveTo(px - nx * w, py - ny * w).lineTo(px - nx * (w - 3), py - ny * (w - 3))
      .stroke({ width: 1.5, color: 0x4a3320 });
  }
}

/** A rope that hangs slack and snaps taut: `taut` 0 slack .. 1 straight. */
function rope(g: Graphics, x0: number, y0: number, x1: number, y1: number, taut: number): void {
  const sag = (1 - taut) * 14;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag;
  g.moveTo(x0, y0).quadraticCurveTo(mx, my + 1, x1, y1).stroke({ width: 3, color: 0x4a3320 });
  g.moveTo(x0, y0).quadraticCurveTo(mx, my, x1, y1).stroke({ width: 1.5, color: 0xa89772 });
}

interface Token { kind: Kind; leg: number; u: number; test: boolean; dead: boolean; roll: number }
interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; col: number }

export type SfxFn = (name: string, x?: number) => void;

export class Machine {
  readonly world = new Container();
  /**
   * The room, the piers, the line shaft and every truss are drawn ONCE. They
   * never change, and rebuilding them each frame cost about a third of the
   * frame rate: 35.8 fps at 1920x1080 against the 60 the other scenes hold.
   * Only the belts, the rope and the fire are redrawn.
   */
  private gStatic = new Graphics();
  private gBack = new Graphics();        // belts and the rope, redrawn
  private cFurniture = new Container();  // rack, boiler, firebox, gears, flywheel
  private gRails = new Graphics();       // rails and the standpipe, over the furniture
  private cMovers = new Container();     // dominoes, see-saw, cart, gate, bell
  private cTokens = new Container();     // bearings
  private gFx = new Graphics();          // particles and the firebox glow
  private gGuide = new Graphics();

  private tokens: Token[] = [];
  private puffs: Puff[] = [];
  private t = 0;
  private sinceReal = 99;

  pressure = 0;
  private dominoes = new Float32Array(DOMINO_N);
  private domHold = new Float32Array(DOMINO_N);
  private seesaw = 0;
  private spin = 0;
  private gate = 0; private bell = 0; private whistle = 0;
  private plates = 0;
  private cartU = 0; private cartTip = 0;

  // sprites, built once
  private sBoiler!: PartSprite; private sFirebox!: PartSprite; private sRack!: PartSprite;
  private sHopper!: PartSprite; private sFunnel!: PartSprite; private sFlywheel!: PartSprite;
  private sSeesaw!: PartSprite; private sCart!: PartSprite; private sGate!: PartSprite;
  private sBell!: PartSprite; private sWhistle!: PartSprite;
  private sGears: PartSprite[] = [];
  private sDominoes: PartSprite[] = [];
  private sPlates: PartSprite[] = [];
  private pool: PartSprite[] = [];

  constructor(private settings: Record<string, unknown>, private sfx: SfxFn, private parts: Parts) {
    this.world.addChild(this.gStatic, this.gBack, this.cFurniture, this.gRails, this.cMovers, this.cTokens, this.gFx, this.gGuide);
    this.build();
    this.drawStatic();
  }

  private get<T>(key: string, fallback: T): T {
    const v = this.settings[key];
    return (v === undefined ? fallback : v) as T;
  }

  private mk(name: string): PartSprite { return new PartSprite(this.parts[name]); }

  /** Build every sprite once; update() only moves them and swaps frames. */
  private build(): void {
    this.sRack = this.mk('rack');
    this.sRack.place(0, RACK.x + RACK.w / 2, RACK.y + RACK.h / 2);
    this.cFurniture.addChild(this.sRack);

    for (const g of GEARS) {
      const s = this.mk('gear');
      s.scale.set(g.s);
      this.sGears.push(s);
      this.cFurniture.addChild(s);
    }
    this.sFlywheel = this.mk('flywheel');
    this.cFurniture.addChild(this.sFlywheel);

    this.sBoiler = this.mk('boiler');
    this.sBoiler.place(0, BOILER.x + BOILER.w / 2, BOILER.y + BOILER.h / 2);
    this.sFirebox = this.mk('firebox');
    this.sFirebox.place(0, FIREBOX.x + FIREBOX.w / 2, FIREBOX.y + FIREBOX.h / 2);
    this.cFurniture.addChild(this.sFirebox, this.sBoiler);

    // nameplates hung on the rack by DHCP leases
    for (let i = 0; i < PLATE_SLOTS; i++) {
      const s = this.mk('plate');
      const row = Math.floor(i / 5), col = i % 5;
      s.place(0, RACK.x + 16 + col * 20, RACK.y + 14 + row * 16);
      s.visible = false;
      this.sPlates.push(s);
      this.cFurniture.addChild(s);
    }

    this.sHopper = this.mk('hopper');
    this.sHopper.place(0, RUN[0].x0, RUN[0].y0 - 6);
    this.sFunnel = this.mk('funnel');
    this.sFunnel.place(0, RUN[5].x0, RUN[5].y0 - 2);
    this.cMovers.addChild(this.sHopper, this.sFunnel);

    for (let i = 0; i < DOMINO_N; i++) {
      const s = this.mk('domino');
      this.sDominoes.push(s);
      this.cMovers.addChild(s);
    }
    this.sSeesaw = this.mk('seesaw');
    this.sCart = this.mk('cart');
    this.sGate = this.mk('gate');
    this.sBell = this.mk('bell');
    this.sWhistle = this.mk('whistle');
    this.sWhistle.place(0, BOILER.x + 58, BOILER.y + 2);
    this.cMovers.addChild(this.sSeesaw, this.sCart, this.sGate, this.sBell, this.sWhistle);
  }

  fire(kind: Kind): void {
    this.sinceReal = 0;
    this.release(kind, false);
  }

  private release(kind: Kind, test: boolean): void {
    const cap = this.get('kMaxTokens', 14);
    if (this.tokens.length >= cap) this.tokens.shift();
    this.tokens.push({ kind, leg: 0, u: 0, test, dead: false, roll: 0 });
    this.sfx('drop', RUN[0].x0);
  }

  private at(tok: Token): { x: number; y: number } {
    const L = RUN[tok.leg];
    const u = tok.u;
    let x = L.x0 + (L.x1 - L.x0) * u;
    let y = L.y0 + (L.y1 - L.y0) * u;
    if (L.motion === 'fly') y -= (L.arc ?? 0) * 4 * u * (1 - u);
    if (L.motion === 'drop') y = L.y0 + (L.y1 - L.y0) * (u * u);
    if (L.motion === 'roll') {
      const e = u * u * (0.35 + 0.65 * u);
      x = L.x0 + (L.x1 - L.x0) * e; y = L.y0 + (L.y1 - L.y0) * e;
    }
    return { x, y };
  }

  update(dt: number, pressure: number): void {
    this.t += dt;
    this.sinceReal += dt;
    this.pressure = pressure;
    const rate = 0.55 + pressure * 1.25;

    // an idle machine is a dead machine: the run keeps turning over on test
    // bearings, so a quiet network is never the still life the first one was
    if (this.sinceReal > 4 && this.tokens.length === 0) this.release('system', true);

    this.spin += dt * rate * 3.4;
    this.gate = Math.max(0, this.gate - dt * 1.6);
    this.bell = Math.max(0, this.bell - dt * 1.4);
    this.whistle = Math.max(0, this.whistle - dt * 0.9);
    this.seesaw += (0 - this.seesaw) * Math.min(1, dt * 3);

    /**
     * Toppling and standing back up are separate states. Running both off one
     * number did not work: the reset dropped the value below 1, which put it
     * back inside the toppling test, which drove it to 1 again, so the run sat
     * permanently flat and read on screen as a white smear.
     */
    for (let i = 0; i < DOMINO_N; i++) {
      if (this.domHold[i] > 0) {
        this.domHold[i] -= dt;
        if (this.domHold[i] <= 0) this.dominoes[i] = 0;
      } else if (this.dominoes[i] > 0) {
        this.dominoes[i] += dt * 5;
        if (this.dominoes[i] >= 1) { this.dominoes[i] = 1; this.domHold[i] = 0.5 + i * 0.07; }
      }
    }
    if (this.cartTip > 0) this.cartTip = Math.max(0, this.cartTip - dt * 2.2);

    for (const tok of this.tokens) {
      const L = RUN[tok.leg];
      const before = this.at(tok);
      tok.u += dt * rate / L.secs;
      this.onLeg(tok, L);
      const after = this.at(tok);
      tok.roll += Math.hypot(after.x - before.x, after.y - before.y);
      while (tok.u >= 1) {
        tok.u -= 1;
        tok.leg++;
        if (tok.leg >= RUN.length) { this.arrive(tok); tok.dead = true; break; }
        this.enter(tok, RUN[tok.leg]);
      }
    }
    this.tokens = this.tokens.filter((k) => !k.dead);

    const onCart = this.tokens.find((k) => RUN[k.leg]?.name === 'cart');
    this.cartU = onCart ? onCart.u : Math.max(0, this.cartU - dt * 0.9);

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 24 * dt;
      if (p.life >= p.max) this.puffs.splice(i, 1);
    }
    if (this.get('kSteam', true) && Math.random() < dt * 2.2 * this.get('kSteamDensity', 1)) {
      this.puff(BOILER.x + 24, BOILER.y - 4, 0xd8c9a0);
    }

    this.layout();
    this.drawLines();
  }

  private onLeg(tok: Token, L: Leg): void {
    if (L.name === 'dominoes' && this.get('kDominoes', true)) {
      const i = Math.min(DOMINO_N - 1, Math.floor(tok.u * DOMINO_N));
      if (this.dominoes[i] === 0 && this.domHold[i] <= 0) {
        this.dominoes[i] = 0.001;
        this.sfx('clack', L.x0 + (L.x1 - L.x0) * tok.u);
      }
    }
    if (L.name === 'seesaw') this.seesaw = -1 + tok.u * 2;
  }

  private enter(tok: Token, L: Leg): void {
    if (L.name === 'seesaw') this.sfx('clack', L.x0);
    if (L.name === 'flight') this.sfx('spring', L.x0);
    if (L.name === 'standpipe') this.sfx('pipe', L.x0);
    if (L.name === 'cart') this.sfx('cart', L.x0);
    if (L.name === 'firebox') {
      this.cartTip = 1;
      if (this.get('kSideEffects', true) && !tok.test) {
        if (tok.kind === 'block') { this.gate = 1; this.sfx('gate', FIREBOX.x); }
        if (tok.kind === 'dns') { this.bell = 1; this.sfx('bell', FIREBOX.x); }
        if (tok.kind === 'threat') { this.whistle = 1; this.sfx('whistle', FIREBOX.x); }
        if (tok.kind === 'dhcp') { this.plates = Math.min(PLATE_SLOTS, this.plates + 1); this.sfx('stamp', RACK.x); }
      }
    }
  }

  private arrive(tok: Token): void {
    this.sfx('stoke', FIREBOX.x);
    for (let i = 0; i < 6; i++) this.puff(FIREBOX.x + FIREBOX.w / 2, FIREBOX.y + 14, TINT[tok.kind], 60);
  }

  private puff(x: number, y: number, col: number, up = 26): void {
    if (this.puffs.length >= this.get('kMaxParticles', 400)) return;
    this.puffs.push({
      x, y, col, vx: (Math.random() - 0.5) * 16, vy: -up * (0.5 + Math.random() * 0.8),
      life: 0, max: 0.6 + Math.random() * 0.7,
    });
  }

  /** Move the sprites and swap their frames. */
  private layout(): void {
    for (let i = 0; i < GEARS.length; i++) {
      const g = GEARS[i];
      this.sGears[i].place(Math.floor(this.spin * g.dir * 1.4) & 7, g.x, g.y);
    }
    this.sFlywheel.place(Math.floor(this.spin * 1.1) & 7, FLYWHEEL.x, FLYWHEEL.y);

    for (let i = 0; i < PLATE_SLOTS; i++) this.sPlates[i].visible = i < this.plates;

    const dom = RUN[2];
    const showDom = this.get('kDominoes', true);
    for (let i = 0; i < DOMINO_N; i++) {
      const s = this.sDominoes[i];
      s.visible = showDom;
      if (!showDom) continue;
      const x = dom.x0 + ((i + 0.5) / DOMINO_N) * (dom.x1 - dom.x0);
      s.place(frameAt(this.dominoes[i], s.count), x, dom.y0 + 2);
    }

    const see = RUN[3];
    this.sSeesaw.place(frameAt((this.seesaw + 1) / 2, this.sSeesaw.count),
      (see.x0 + see.x1) / 2, (see.y0 + see.y1) / 2 + 4);

    const cart = RUN[7];
    const showCart = this.get('kCart', true);
    this.sCart.visible = showCart;
    if (showCart) {
      this.sCart.place(frameAt(this.cartTip, this.sCart.count),
        cart.x0 + (cart.x1 - cart.x0) * this.cartU,
        cart.y0 + (cart.y1 - cart.y0) * this.cartU + 4);
    }

    const fx = this.get('kSideEffects', true);
    this.sGate.visible = fx && this.gate > 0.02;
    if (this.sGate.visible) this.sGate.place(0, FIREBOX.x - 14, FIREBOX.y - 30 + 30 * (1 - this.gate));
    this.sBell.visible = fx;
    // on the boiler's near shoulder, not off its right edge, where it was
    // drawing straight on top of the flywheel
    this.sBell.place(frameAt((Math.sin(this.t * 26) * this.bell + 1) / 2, this.sBell.count),
      BOILER.x + 18, BOILER.y - 4);
    this.sWhistle.visible = fx;

    // bearings, pooled
    while (this.pool.length < this.tokens.length) {
      const s = this.mk('bearing');
      this.pool.push(s);
      this.cTokens.addChild(s);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const s = this.pool[i];
      const tok = this.tokens[i];
      s.visible = !!tok;
      if (!tok) continue;
      const p = this.at(tok);
      s.tint = tok.test ? 0x8a8f9e : TINT[tok.kind];
      s.alpha = tok.test ? 0.75 : 1;
      s.place(Math.floor(tok.roll / 2) & 7, p.x, p.y);
    }
  }

  /** The room and every fixed girder: drawn once, never rebuilt. */
  private drawStatic(): void {
    const s = this.gStatic;
    s.clear();
    s.rect(0, 0, WORLD_W, WORLD_H).fill(0x191621);
    s.rect(0, 306, WORLD_W, WORLD_H - 306).fill(0x211c2c);

    // the shop floor: brick piers carrying the run, so the machine is standing
    // in a room instead of floating in one
    for (let i = 0; i < 7; i++) {
      const px = 36 + i * 92;
      s.rect(px, 306, 26, 54).fill(0x2a2336);
      s.rect(px, 306, 26, 3).fill(0x3a3d4d);
    }
    s.rect(0, 303, WORLD_W, 4).fill(0x3a3d4d);
    // a steam main running the length of the floor
    s.rect(0, 316, WORLD_W, 7).fill(0x3a3d4d);
    s.rect(0, 316, WORLD_W, 2).fill(0x565a6e);
    for (let i = 0; i < 12; i++) s.rect(18 + i * 54, 314, 5, 11).fill(0x4a3320);

    /**
     * An overhead line shaft drives the room, the way a mill actually did it.
     * The belt used to run flat across to the flywheel, straight through the
     * rack, whose own gaps let it show through; dropping it to a floor pulley
     * instead just hid it behind the log panel. Up here it has a clear lane
     * between the domino rail and the top of the rack, and it ties the gear
     * train and the flywheel into one machine.
     */
    s.rect(74, SHAFT_Y - 2, 540, 5).fill(0x4a4f5a);
    s.rect(74, SHAFT_Y - 2, 540, 2).fill(0x767b92);
    for (let x = 90; x < 610; x += 76) {
      s.rect(x - 2, SHAFT_Y - 12, 4, 10).fill(0x3a3d4d);
      s.rect(x - 7, SHAFT_Y - 14, 14, 3).fill(0x565a6e);
    }
    for (const g of [GEARS[0], { x: FLYWHEEL.x }]) {
      s.circle(g.x, SHAFT_Y, 12).fill(0x565a6e);
      s.circle(g.x, SHAFT_Y, 5).fill(0x3a3d4d);
    }

    const rail = RUN[1], dom = RUN[2], fun = RUN[5], pipe = RUN[6], cart = RUN[7];
    s.rect(RUN[0].x0 - 5, RUN[0].y0, 10, RUN[0].y1 - RUN[0].y0 + 4).fill(0x3a3d4d);
    truss(s, rail.x0, rail.y0, rail.x1, rail.y1);
    truss(s, dom.x0, dom.y0 + 3, dom.x1 + 36, dom.y1 + 3);
    s.rect(pipe.x0 - 7, fun.y0 + 4, 14, pipe.y1 - fun.y0 + 6).fill(0x4a3320);
    s.rect(pipe.x0 - 7, fun.y0 + 4, 4, pipe.y1 - fun.y0 + 6).fill(0x6b4a2e);
    // joint bands, kept inside the pipe's own width: proud of it by two units
    // each side they read as the rungs of a ladder rather than as pipework
    for (let i = 0; i < 5; i++) s.rect(pipe.x0 - 8, fun.y0 + 16 + i * 18, 16, 2).fill(0x6e4f1d);
    truss(s, cart.x0 - 7, cart.y0 + 10, cart.x1 + 14, cart.y1 + 10, 8);
  }

  /** The handful of drawn things that actually change: belts, rope, fire. */
  private drawLines(): void {
    const b = this.gBack, r = this.gRails, f = this.gFx, gd = this.gGuide;
    b.clear(); r.clear(); f.clear(); gd.clear();

    const phase = (this.spin * 0.08) % 1;
    belt(b, GEARS[0].x, SHAFT_Y, 12, GEARS[0].x, GEARS[0].y, 28, phase);
    belt(b, FLYWHEEL.x, SHAFT_Y, 12, FLYWHEEL.x, FLYWHEEL.y, 26, phase);

    const see = RUN[3], fun = RUN[5], pipe = RUN[6];

    /**
     * The one linkage the run does not carry itself: the see-saw's rope. It
     * hangs slack while the bearing rolls the dominoes, then snaps taut as the
     * plank tips, which is the beat that throws the bearing at the funnel.
     */
    const taut = Math.max(0, this.seesaw);
    rope(r, see.x1 + 10, see.y1 + 4, pipe.x0 - 8, fun.y0 + 20, taut);
    r.circle(see.x1 + 10, see.y1 + 4, 2).fill(0xa87c2a);

    // the fire in the box, breathing with pressure
    const heat = 0.3 + this.pressure * 0.7;
    f.rect(FIREBOX.x + 14, FIREBOX.y + 20, FIREBOX.w - 28, 16)
      .fill({ color: 0xff7a2a, alpha: 0.2 + heat * 0.45 });

    for (const p of this.puffs) {
      const a = 1 - p.life / p.max;
      f.circle(p.x, p.y, 1 + a * 2.6).fill({ color: p.col, alpha: a * 0.5 });
    }

    if (this.get('kGuide', false)) {
      for (const L of RUN) {
        gd.moveTo(L.x0, L.y0).lineTo(L.x1, L.y1).stroke({ width: 1, color: 0x5ce6a4, alpha: 0.5 });
        gd.circle(L.x0, L.y0, 2).fill({ color: 0xffd84d, alpha: 0.8 });
      }
    }
  }

  census(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const L of RUN) out[L.name] = 0;
    for (const tok of this.tokens) out[RUN[tok.leg].name]++;
    return out;
  }
}
