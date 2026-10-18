import { Container, Graphics } from 'pixi.js';

/**
 * The machine: one continuous causal run that every event travels end to end.
 *
 * The last attempt at this scene was a room with handsome machines standing
 * about in it, and it was deleted. The failure was not the art - the baked
 * stickers were good - it was that you could not see a chain. The linkages
 * were one-pixel lines on black, half the frame was empty, and two screenshots
 * eight seconds apart showed the machine in the same pose.
 *
 * So this one is built path-first. There is exactly one run. It enters top
 * left, cascades down and right through nine legs, and ends in the firebox
 * under the boiler. Every event is a bearing that physically walks that whole
 * path; the differences between event kinds are what the bearing sets off on
 * the way past, never a different route.
 */

/** 16:9, and an exact integer scale on every common display: 1920/640 = 3. */
export const WORLD_W = 640;
export const WORLD_H = 360;

/**
 * The size language. Everything is measured against the bearing, the way
 * slipstream measures everything against a kart. The old scene had a 380px
 * boiler sharing a frame with 12px dominoes and no rule connecting them.
 */
export const BEARING = 8;
const U = BEARING;

export type Kind = 'allow' | 'block' | 'dns' | 'dhcp' | 'wifi' | 'threat' | 'system';

/** What a bearing looks like per event kind: the only thing that varies. */
const TINT: Record<Kind, number> = {
  allow: 0x5ce6a4, block: 0xff6b6b, dns: 0x55b5ff, dhcp: 0xc08cff,
  wifi: 0xffd84d, threat: 0xff7a2a, system: 0x9aa4b8,
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
 * in those corners. The cascade uses the full height on purpose - the first
 * version kept everything above y=240 and left the bottom third dead.
 */
export const RUN: Leg[] = [
  { name: 'intake', motion: 'drop', x0: 78, y0: 16, x1: 78, y1: 32, secs: 0.35 },
  { name: 'rail', motion: 'roll', x0: 78, y0: 32, x1: 172, y1: 104, secs: 1.2 },
  { name: 'dominoes', motion: 'roll', x0: 172, y0: 104, x1: 268, y1: 110, secs: 1.0 },
  { name: 'seesaw', motion: 'ride', x0: 268, y0: 110, x1: 302, y1: 104, secs: 0.8 },
  { name: 'flight', motion: 'fly', x0: 302, y0: 104, x1: 334, y1: 84, secs: 0.7, arc: 24 },
  { name: 'funnel', motion: 'roll', x0: 334, y0: 84, x1: 340, y1: 96, secs: 0.3 },
  { name: 'standpipe', motion: 'drop', x0: 340, y0: 96, x1: 348, y1: 190, secs: 0.75 },
  { name: 'cart', motion: 'ride', x0: 354, y0: 198, x1: 446, y1: 262, secs: 1.3 },
  { name: 'firebox', motion: 'drop', x0: 452, y0: 266, x1: 476, y1: 284, secs: 0.4 },
];

/**
 * Fixed furniture. The boiler sits to the RIGHT of the cart's descent with the
 * firebox tucked under its left shoulder, overlapping the drum by a couple of
 * units so the two read as one object: in the first layout they were six units
 * apart and looked like two unrelated boxes.
 */
export const BOILER = { x: 452, y: 174, w: 122, h: 78 };
export const FIREBOX = { x: 458, y: 250, w: 62, h: 46 };
export const FLYWHEEL = { x: 602, y: 210, r: 28 };
/**
 * The rack: DHCP leases hang a nameplate here. It exists mostly to fill the
 * middle of the frame, which the first layout left as a void the eye fell
 * into on its way from the dominoes to the boiler.
 */
export const RACK = { x: 196, y: 168, w: 118, h: 86 };
/** The gear train on the left wall, driven off the flywheel by a belt. */
export const GEARS = [
  { x: 96, y: 168, r: 30, teeth: 14, dir: 1 },
  { x: 150, y: 196, r: 25, teeth: 12, dir: -1 },
  { x: 118, y: 232, r: 18, teeth: 9, dir: 1 },
];
export const DOMINO_N = 9;

interface Token { kind: Kind; leg: number; u: number; test: boolean; dead: boolean }
interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; col: number }

export type SfxFn = (name: string, x?: number) => void;

export class Machine {
  readonly world = new Container();
  private gBack = new Graphics();
  private gMech = new Graphics();
  private gTok = new Graphics();
  private gGuide = new Graphics();

  private tokens: Token[] = [];
  private puffs: Puff[] = [];
  private t = 0;
  /** Seconds since a real event last entered the run. */
  private sinceReal = 99;

  pressure = 0;
  /** 0 standing .. 1 flat. */
  private dominoes = new Float32Array(DOMINO_N);
  /** Seconds a flattened domino waits before the stagehand stands it up. */
  private domHold = new Float32Array(DOMINO_N);
  private seesaw = 0;
  private spin = 0;
  private gate = 0; private bell = 0; private whistle = 0;
  /** Nameplates hung on the rack by DHCP leases, 0..20. */
  private plates = 0;
  private cartU = 0; private cartTip = 0;

  constructor(private settings: Record<string, unknown>, private sfx: SfxFn) {
    this.world.addChild(this.gBack, this.gMech, this.gTok, this.gGuide);
  }

  private get<T>(key: string, fallback: T): T {
    const v = this.settings[key];
    return (v === undefined ? fallback : v) as T;
  }

  /** An event arrives: one bearing enters the top of the run. */
  fire(kind: Kind): void {
    this.sinceReal = 0;
    this.release(kind, false);
  }

  private release(kind: Kind, test: boolean): void {
    const cap = this.get('kMaxTokens', 14);
    if (this.tokens.length >= cap) this.tokens.shift();
    this.tokens.push({ kind, leg: 0, u: 0, test, dead: false });
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

    /**
     * An idle machine is a dead machine. On a quiet network the run keeps
     * turning over on test bearings, so the scene is never the still life the
     * first version was.
     */
    if (this.sinceReal > 4 && this.tokens.length === 0) this.release('system', true);

    this.spin += dt * rate * 3.4;
    this.gate = Math.max(0, this.gate - dt * 1.6);
    this.bell = Math.max(0, this.bell - dt * 1.4);
    this.whistle = Math.max(0, this.whistle - dt * 0.9);
    this.seesaw += (0 - this.seesaw) * Math.min(1, dt * 3);
    /**
     * Toppling and standing back up are separate states. Running both off one
     * number did not work: the reset dropped the value below 1, which put it
     * back inside the toppling test, which drove it to 1 again, so the whole
     * run sat permanently flat and read on screen as a white smear.
     */
    for (let i = 0; i < DOMINO_N; i++) {
      if (this.domHold[i] > 0) {
        this.domHold[i] -= dt;
        if (this.domHold[i] <= 0) this.dominoes[i] = 0;          // the stagehand
      } else if (this.dominoes[i] > 0) {
        this.dominoes[i] += dt * 5;
        if (this.dominoes[i] >= 1) { this.dominoes[i] = 1; this.domHold[i] = 0.5 + i * 0.07; }
      }
    }
    if (this.cartTip > 0) this.cartTip = Math.max(0, this.cartTip - dt * 2.2);

    for (const tok of this.tokens) {
      const L = RUN[tok.leg];
      tok.u += dt * rate / L.secs;
      this.onLeg(tok, L);
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
      this.puff(BOILER.x + 20, BOILER.y - 2, 0xd8c9a0);
    }

    this.draw();
  }

  private onLeg(tok: Token, L: Leg): void {
    if (L.name === 'dominoes' && this.get('kDominoes', true)) {
      const i = Math.min(DOMINO_N - 1, Math.floor(tok.u * DOMINO_N));
      if (this.dominoes[i] === 0) { this.dominoes[i] = 0.001; this.sfx('clack', L.x0 + (L.x1 - L.x0) * tok.u); }
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
        if (tok.kind === 'dhcp') { this.plates = Math.min(20, this.plates + 1); this.sfx('stamp', RACK.x); }
      }
    }
  }

  private arrive(tok: Token): void {
    this.sfx('stoke', FIREBOX.x);
    for (let i = 0; i < 6; i++) this.puff(FIREBOX.x + FIREBOX.w / 2, FIREBOX.y + 10, TINT[tok.kind], 60);
  }

  private puff(x: number, y: number, col: number, up = 26): void {
    if (this.puffs.length >= this.get('kMaxParticles', 400)) return;
    this.puffs.push({
      x, y, col, vx: (Math.random() - 0.5) * 16, vy: -up * (0.5 + Math.random() * 0.8),
      life: 0, max: 0.6 + Math.random() * 0.7,
    });
  }

  // ── drawing: flat boxes, so the staging can be judged before any art ──
  private draw(): void {
    const b = this.gBack, m = this.gMech, k = this.gTok, gd = this.gGuide;
    b.clear(); m.clear(); k.clear(); gd.clear();

    b.rect(0, 0, WORLD_W, WORLD_H).fill(0x191621);
    b.rect(0, 306, WORLD_W, WORLD_H - 306).fill(0x211c2c);

    // the gear train on the left wall: furniture that fills the frame and,
    // more to the point, visibly turns
    for (const g of GEARS) {
      b.circle(g.x, g.y, g.r).stroke({ width: 2, color: 0x3a3d4d });
      for (let i = 0; i < g.teeth; i++) {
        const a = this.spin * g.dir * (12 / g.teeth) + (i / g.teeth) * Math.PI * 2;
        b.circle(g.x + Math.cos(a) * g.r, g.y + Math.sin(a) * g.r, 2).fill(0x565a6e);
      }
      b.circle(g.x, g.y, 3).fill(0x565a6e);
    }
    // the belt back to the flywheel, so the train has a visible driver
    b.moveTo(GEARS[1].x, GEARS[1].y - GEARS[1].r)
      .lineTo(FLYWHEEL.x, FLYWHEEL.y - FLYWHEEL.r).stroke({ width: 2, color: 0x2a2336 });

    // the rack, standing in the middle of the frame where the void was
    b.rect(RACK.x, RACK.y, RACK.w, RACK.h).fill(0x211c2c);
    b.rect(RACK.x, RACK.y, RACK.w, RACK.h).stroke({ width: 2, color: 0x4a3320 });
    for (let r = 0; r < 4; r++) {
      b.rect(RACK.x + 5, RACK.y + 10 + r * 19, RACK.w - 10, 2).fill(0x3a3d4d);
      for (let c = 0; c < 5; c++) {
        const lit = (r * 5 + c) < this.plates;
        b.rect(RACK.x + 8 + c * 21, RACK.y + 13 + r * 19, 16, 9)
          .fill(lit ? 0xc08cff : 0x2a2336);
      }
    }

    // boiler, firebox, flywheel: the destination
    const heat = 0.3 + this.pressure * 0.7;
    b.rect(BOILER.x, BOILER.y, BOILER.w, BOILER.h).fill(0x565a6e);
    b.rect(BOILER.x + 4, BOILER.y + 4, BOILER.w - 8, BOILER.h - 8).fill(0x3a3d4d);
    b.rect(FIREBOX.x, FIREBOX.y, FIREBOX.w, FIREBOX.h).fill(0x3a3d4d);
    b.rect(FIREBOX.x + 6, FIREBOX.y + 10, FIREBOX.w - 12, FIREBOX.h - 16)
      .fill({ color: 0xff7a2a, alpha: 0.25 + heat * 0.6 });

    b.circle(FLYWHEEL.x, FLYWHEEL.y, FLYWHEEL.r).stroke({ width: 3, color: 0x565a6e });
    for (let i = 0; i < 6; i++) {
      const a = this.spin + (i / 6) * Math.PI * 2;
      b.moveTo(FLYWHEEL.x, FLYWHEEL.y)
        .lineTo(FLYWHEEL.x + Math.cos(a) * FLYWHEEL.r, FLYWHEEL.y + Math.sin(a) * FLYWHEEL.r)
        .stroke({ width: 2, color: 0x767b92 });
    }

    const rail = RUN[1], dom = RUN[2], see = RUN[3], fly = RUN[4], fun = RUN[5], pipe = RUN[6], cart = RUN[7];

    m.rect(RUN[0].x0 - 11, RUN[0].y0 - 13, 22, 14).fill(0x565a6e);
    m.rect(RUN[0].x0 - 5, RUN[0].y0, 10, RUN[0].y1 - RUN[0].y0 + 4).fill(0x3a3d4d);
    m.moveTo(rail.x0, rail.y0).lineTo(rail.x1, rail.y1).stroke({ width: 3, color: 0x565a6e });
    m.moveTo(dom.x0, dom.y0 + 2).lineTo(dom.x1 + 36, dom.y1 + 2).stroke({ width: 3, color: 0x565a6e });

    if (this.get('kDominoes', true)) {
      for (let i = 0; i < DOMINO_N; i++) {
        const x = dom.x0 + ((i + 0.5) / DOMINO_N) * (dom.x1 - dom.x0);
        const a = this.dominoes[i] * Math.PI * 0.46;
        const h = U * 2.2, w = 2.5;
        const dx = Math.sin(a) * h, dy = h - Math.cos(a) * h;
        m.poly([x - w, dom.y0 + 1, x + w, dom.y0 + 1, x + w + dx, dom.y0 + 1 - h + dy, x - w + dx, dom.y0 + 1 - h + dy])
          .fill(0x9aa4b8);
      }
    }

    // see-saw, and the spring launcher it throws the bearing off
    const sa = this.seesaw * 0.22;
    const sx = (see.x0 + see.x1) / 2, sy = (see.y0 + see.y1) / 2 + 3;
    m.poly([
      sx - 21 * Math.cos(sa), sy - 21 * Math.sin(sa) - 2,
      sx + 21 * Math.cos(sa), sy + 21 * Math.sin(sa) - 2,
      sx + 21 * Math.cos(sa), sy + 21 * Math.sin(sa) + 1,
      sx - 21 * Math.cos(sa), sy - 21 * Math.sin(sa) + 1,
    ]).fill(0xa87c2a);
    m.poly([sx - 4, sy + 11, sx + 4, sy + 11, sx, sy]).fill(0x565a6e);
    m.rect(fly.x0 - 3, fly.y0 - 1, 10, 7).fill(0x8f4f2e);

    // funnel and standpipe, drawn as one piece: the first pass left fourteen
    // units of nothing between the funnel's throat and the top of the pipe
    m.poly([fun.x0 - 15, fun.y0 - 9, fun.x0 + 15, fun.y0 - 9, fun.x0 + 6, fun.y0 + 7, fun.x0 - 6, fun.y0 + 7])
      .fill(0x6e4f1d);
    m.rect(pipe.x0 - 6, fun.y0 + 5, 12, pipe.y1 - fun.y0 + 4).fill(0x4a3320);
    m.rect(pipe.x0 - 6, fun.y0 + 5, 3, pipe.y1 - fun.y0 + 4).fill(0x6b4a2e);

    // cart rail and the cart riding it
    m.moveTo(cart.x0 - 7, cart.y0 + 8).lineTo(cart.x1 + 12, cart.y1 + 8).stroke({ width: 3, color: 0x565a6e });
    if (this.get('kCart', true)) {
      const cx = cart.x0 + (cart.x1 - cart.x0) * this.cartU;
      const cy = cart.y0 + (cart.y1 - cart.y0) * this.cartU;
      const tip = this.cartTip * 0.5;
      m.poly([cx - 10, cy - 6 + tip * 7, cx + 10, cy - 6 - tip * 7, cx + 8, cy + 4, cx - 8, cy + 4])
        .fill(0xa87c2a);
      m.circle(cx - 6, cy + 7, 3).fill(0x3a3d4d);
      m.circle(cx + 6, cy + 7, 3).fill(0x3a3d4d);
    }

    if (this.gate > 0) m.rect(FIREBOX.x - 12, FIREBOX.y - 28, 6, 28 * this.gate).fill(0xff6b6b);
    if (this.bell > 0) m.circle(BOILER.x + BOILER.w + 6, BOILER.y + 12, 5 + this.bell * 3).fill(0x55b5ff);
    if (this.whistle > 0) m.rect(BOILER.x + 56, BOILER.y - 16, 6, 16).fill(0xff7a2a);

    // ── the travelling bearings: the brightest thing on screen ──
    for (const tok of this.tokens) {
      const p = this.at(tok);
      const col = tok.test ? 0x767b92 : TINT[tok.kind];
      k.circle(p.x, p.y, U / 2 + 2).fill({ color: col, alpha: tok.test ? 0.12 : 0.24 });
      k.circle(p.x, p.y, U / 2).fill(col);
    }
    for (const p of this.puffs) {
      const a = 1 - p.life / p.max;
      k.circle(p.x, p.y, 1 + a * 2.6).fill({ color: p.col, alpha: a * 0.5 });
    }

    if (this.get('kGuide', false)) {
      for (const L of RUN) {
        gd.moveTo(L.x0, L.y0).lineTo(L.x1, L.y1).stroke({ width: 1, color: 0x5ce6a4, alpha: 0.5 });
        gd.circle(L.x0, L.y0, 2).fill({ color: 0xffd84d, alpha: 0.8 });
      }
    }
  }

  /** For the diag probe: how many bearings are on each leg right now. */
  census(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const L of RUN) out[L.name] = 0;
    for (const tok of this.tokens) out[RUN[tok.leg].name]++;
    return out;
  }
}
