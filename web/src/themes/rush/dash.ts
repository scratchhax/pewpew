import type { State } from '../../state';
import { TILE } from './art';
import { P, drawText, stamp } from './pixels';
import type { Course } from './world';

/**
 * Packet Rush's dash: the HUD as a 16-bit game's. A pixel-font top bar (gems,
 * score, time, stage), and the shared panels redrawn in pixels: the world panel
 * becomes a course mini-map with stage progress, the radar an item box, the
 * heat and boost bars rows of flames and bolts, the speed scope a segmented
 * speedometer. Every few minutes a STAGE CLEAR card slides in with the stage's
 * numbers. Canvases are drawn at pixel resolution and scaled up crisp; nothing
 * blinks (warnings breathe).
 */

const GEM = ['...kk...', '..klLk..', '.klLLgk.', 'klLLggtk', 'kLLggttk', '.kgggtk.', '..kgtk..', '...kk...'];
const GEM_PAL = { k: P.teal, l: P.white, L: P.lime, g: P.green, t: P.teal };
const FLAME = ['...o...', '..oo...', '..oyo..', '.oyyo..', '.oyyyo.', 'orywyro', 'orrwrro', '.orrro.'];
const BOLT = ['....yy.', '...yy..', '..yy...', '.yyyyy.', '...yy..', '..yy...', '.yy....', 'y......'];
const SHOE = ['..kkkk....', '.kccccK...', '.kcwcccK..', '.kcccccckk', 'kccccccccK', 'kKKKKKKKKk', '.kkkkkkkk.'];
const MAGNET = ['.kkk.kkk..', '.krk.krk..', '.krk.krk..', '.krrkrrk..', '.krrrrrk..', '..krrrk...', '...kkk....'];
const SHIELD = ['...cccc...', '..c....c..', '.c.w....c.', 'c.w......c', 'c........c', 'c........c', '.c......c.', '..c....c..', '...cccc...'];
const DRONE = ['rr......rr', '.kkkkkkkk.', 'kaaaAAaaak', 'kaaAerAaak', '.kaaAAaak.', '..k....k..'];

function pixelCanvas(parent: HTMLElement, w: number, h: number, scale: number, id: string, before?: Element | null): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.style.width = `${w * scale}px`; c.style.height = `${h * scale}px`;
  c.style.imageRendering = 'pixelated';
  c.id = id; c.className = 'rush-pix';
  parent.insertBefore(c, before ?? null);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

const pad = (n: number, len: number) => String(Math.max(0, Math.floor(n))).padStart(len, '0');

export interface DashInfo {
  state: State;
  stats: { gems: number; stomps: number; queries: number; bricks: number; flags: number; hurts: number };
  speed: number;
  eps: number;
  world: number;
  worldName: string;
  power: { kind: 'shoe' | 'magnet' | 'shield'; left: number; max: number } | null;
  hunted: boolean;
  map: { heroX: number; enemies: number[]; flags: number[]; queries: number[]; rivals: number[] };
  course: Course;
}

/** How long a stage lasts (seconds of running). */
const STAGE_SECONDS = 180;

export class Dash {
  private top: CanvasRenderingContext2D;
  private mapCtx: CanvasRenderingContext2D;
  private itemCtx: CanvasRenderingContext2D;
  private meterCtx: CanvasRenderingContext2D;
  private speedCtx: CanvasRenderingContext2D;
  private topWrap: HTMLElement;
  private card: HTMLElement;
  private cardCtx: CanvasRenderingContext2D;
  private panels: Record<'map' | 'item' | 'meter' | 'speed', HTMLElement>;
  private t = 0;
  private runT = 0;
  private stage = 1;
  private stageT = 0;
  private stageStart = { gems: 0, stomps: 0, queries: 0, bricks: 0, flags: 0 };
  private cardT = -1;
  private cardLines: Array<[string, string]> = [];
  private cardTitle = '';
  private shownScore = 0;
  private domains = new Map<string, number>();

  constructor() {
    const hud = document.getElementById('hud')!;
    this.topWrap = document.createElement('div');
    this.topWrap.id = 'rush-top';
    hud.appendChild(this.topWrap);
    this.top = pixelCanvas(this.topWrap, 232, 13, 4, 'rush-topbar');

    this.panels = {
      map: document.getElementById('hud-topleft')!,
      item: document.getElementById('radar-wrap')!,
      meter: document.getElementById('hud-bars')!,
      speed: document.getElementById('scope-wrap')!,
    };
    this.mapCtx = pixelCanvas(this.panels.map, 100, 50, 2, 'rush-map');
    this.itemCtx = pixelCanvas(this.panels.item, 56, 44, 2, 'rush-item');
    this.meterCtx = pixelCanvas(this.panels.meter, 84, 30, 3, 'rush-meter');
    this.speedCtx = pixelCanvas(this.panels.speed, 76, 22, 3, 'rush-speed', document.getElementById('rate'));

    this.card = document.createElement('div');
    this.card.id = 'rush-card';
    this.card.hidden = true;
    document.body.appendChild(this.card);
    this.cardCtx = pixelCanvas(this.card, 150, 74, 4, 'rush-card-canvas');
  }

  /** Remember looked-up domains, for the stage card's "most visited". */
  domain(name: string): void { this.domains.set(name, (this.domains.get(name) ?? 0) + 1); }

  private score(s: DashInfo['stats']): number {
    return s.gems * 10 + s.stomps * 100 + s.queries * 50 + s.bricks * 20 + s.flags * 500;
  }

  update(dt: number, d: DashInfo): void {
    this.t += dt;
    this.runT += dt;
    this.stageT += dt;
    const score = this.score(d.stats);
    // the score counts up rather than jumping
    this.shownScore += Math.min(score - this.shownScore, Math.max(10, (score - this.shownScore) * dt * 6));
    if (this.stageT >= STAGE_SECONDS) this.clearStage(d);

    this.drawTop(d);
    const shown = (el: HTMLElement) => el.style.display !== 'none';
    if (shown(this.panels.map)) this.drawMap(d);
    if (shown(this.panels.item)) this.drawItem(d);
    if (shown(this.panels.meter)) this.drawMeters(d);
    if (shown(this.panels.speed)) this.drawSpeed(d);
    this.drawCard(dt);
  }

  private drawTop(d: DashInfo): void {
    const c = this.top, W = 232, H = 13;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(26,28,44,0.82)'; c.fillRect(0, 0, W, H);
    c.fillStyle = P.white; c.fillRect(0, 0, W, 1); c.fillRect(0, H - 1, W, 1); c.fillRect(0, 0, 1, H); c.fillRect(W - 1, 0, 1, H);
    stamp(c, GEM, GEM_PAL, 4, 3 - 1);
    let x = 14;
    x += drawText(c, `*${pad(d.stats.gems, 3)}`, x, 4, P.white);
    x += 10;
    x += drawText(c, 'SCORE', x, 4, P.sand);
    x += 3;
    x += drawText(c, pad(this.shownScore, 7), x, 4, P.white);
    x += 10;
    x += drawText(c, 'TIME', x, 4, P.sand);
    x += 3;
    const secs = Math.floor(this.runT);
    x += drawText(c, `${pad(Math.floor(secs / 60), 2)}:${pad(secs % 60, 2)}`, x, 4, P.white);
    x += 10;
    x += drawText(c, 'STAGE', x, 4, P.sand);
    x += 3;
    drawText(c, `${d.world + 1}-${this.stage}`, x, 4, P.white);
  }

  private drawMap(d: DashInfo): void {
    const c = this.mapCtx, W = 100, H = 50;
    c.clearRect(0, 0, W, H);
    const col = [[P.green, P.lime], [P.slate, P.sand], [P.steel, P.orange]][d.world];
    drawText(c, d.worldName, 1, 1, col[1]);
    // the course around us: one pixel per column, from a few tiles back to far ahead
    const hero = Math.floor(d.map.heroX / TILE), c0 = hero - 16, base = 36;
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 9, W, base - 9 + 2);
    for (let k = 0; k < W; k++) {
      const h = d.course.heightAt(c0 + k);
      if (h <= 0) { c.fillStyle = d.world === 2 ? P.red : d.world === 1 ? P.teal : P.blue; c.fillRect(k, base - 1, 1, 2); continue; }
      const top = base - h * 3;
      c.fillStyle = col[0]; c.fillRect(k, top, 1, base - top + 1);
      c.fillStyle = col[1]; c.fillRect(k, top, 1, 1);
      const l = d.course.ledgeAt(c0 + k);
      if (l > 0) { c.fillStyle = P.sand; c.fillRect(k, base - l * 3, 1, 1); }
    }
    const at = (x: number) => Math.floor(x / TILE) - c0;
    const dot = (x: number, y: number, color: string, w = 1, h = 1) => { if (x >= 0 && x < W) { c.fillStyle = color; c.fillRect(x, y, w, h); } };
    for (const x of d.map.flags) dot(at(x), 12, '#c08cff', 1, 5);
    for (const x of d.map.queries) dot(at(x), 14, P.sky, 2, 2);
    for (const x of d.map.enemies) { const k = at(x); dot(k, base - d.course.heightAt(c0 + k) * 3 - 2, P.red, 2, 2); }
    for (const x of d.map.rivals) { const k = at(x); dot(k, base - d.course.heightAt(c0 + k) * 3 - 3, P.sand, 2, 3); }
    dot(16, base - d.course.heightAt(hero) * 3 - 3, P.cyan, 2, 3);
    // stage progress
    const prog = Math.min(1, this.stageT / STAGE_SECONDS);
    c.fillStyle = P.steel; c.fillRect(1, 42, W - 18, 5);
    c.fillStyle = P.sky; c.fillRect(1, 42, Math.round((W - 18) * prog), 5);
    c.fillStyle = P.white; c.fillRect(1 + Math.round((W - 19) * prog), 41, 1, 7);
    // the goal flag
    c.fillStyle = P.silver; c.fillRect(W - 14, 38, 1, 10);
    c.fillStyle = '#c08cff'; c.fillRect(W - 13, 38, 5, 3);
    drawText(c, 'GO', W - 7 - 1, 43, P.white, null);
  }

  private drawItem(d: DashInfo): void {
    const c = this.itemCtx, W = 56, H = 44;
    c.clearRect(0, 0, W, H);
    // the box
    c.fillStyle = P.ink; c.fillRect(4, 2, 26, 26);
    c.fillStyle = P.white; c.fillRect(4, 2, 26, 1); c.fillRect(4, 27, 26, 1); c.fillRect(4, 2, 1, 26); c.fillRect(29, 2, 1, 26);
    c.fillStyle = P.blue; c.fillRect(6, 4, 22, 22);
    if (d.power) {
      const map = d.power.kind === 'shoe' ? SHOE : d.power.kind === 'magnet' ? MAGNET : SHIELD;
      const pal = { k: P.ink, c: P.cyan, w: P.white, K: P.teal, r: P.red };
      stamp(c, map, pal, 12, 11);
      const f = d.power.left / d.power.max;
      c.fillStyle = P.steel; c.fillRect(4, 31, 26, 3);
      c.fillStyle = f > 0.3 ? P.lime : P.orange; c.fillRect(4, 31, Math.round(26 * f), 3);
      drawText(c, d.power.kind === 'shoe' ? 'TURBO' : d.power.kind === 'magnet' ? 'MAGNT' : 'SHLD', 2, 37, P.white);
    } else {
      drawText(c, '--', 13, 13, P.silver, null);
      drawText(c, 'EMPTY', 2, 37, P.slate, null);
    }
    // the drone warning breathes while it hunts us
    if (d.hunted) {
      const a = 0.55 + 0.45 * Math.sin(this.t * 4);
      c.globalAlpha = a;
      stamp(c, DRONE, { r: P.red, k: P.ink, a: P.orange, A: P.sand, e: P.ink }, 38, 4);
      drawText(c, '!', 42, 13, P.orange);
      c.globalAlpha = 1;
      drawText(c, 'HUNT', 35, 22, P.orange);
    }
  }

  private drawMeters(d: DashInfo): void {
    const c = this.meterCtx;
    c.clearRect(0, 0, 84, 30);
    const row = (label: string, y: number, value: number, icon: string[], pal: Record<string, string>, color: string) => {
      drawText(c, label, 1, y + 2, color);
      const n = 6, filled = value * n;
      for (let k = 0; k < n; k++) {
        const f = Math.max(0, Math.min(1, filled - k));
        c.globalAlpha = 0.18 + f * 0.82;
        stamp(c, icon, f > 0 ? pal : { o: P.steel, y: P.steel, r: P.steel, w: P.steel }, 24 + k * 10, y);
      }
      c.globalAlpha = 1;
    };
    row('HEAT', 2, d.state.threat, FLAME, { o: P.orange, y: P.sand, r: P.red, w: P.white }, P.orange);
    row('BOOST', 18, d.state.energy, BOLT, { y: P.sand }, P.sand);
  }

  private drawSpeed(d: DashInfo): void {
    const c = this.speedCtx;
    c.clearRect(0, 0, 76, 22);
    drawText(c, 'SPD', 1, 2, P.sand);
    const f = Math.max(0, Math.min(1, (d.speed - 100) / 180));
    const n = 12;
    for (let k = 0; k < n; k++) {
      const on = k < Math.round(f * n);
      c.fillStyle = on ? (k < 9 ? P.lime : k < 13 ? P.sand : P.orange) : P.steel;
      c.fillRect(16 + k * 5, 2, 4, 6 + Math.floor(k / 4));
    }
    drawText(c, `${Math.round(d.speed)}`, 1, 14, P.white);
    drawText(c, 'PX/S', 16, 14, P.slate, null);
  }

  // ── stage clear ──
  private clearStage(d: DashInfo): void {
    const s = d.stats, b = this.stageStart;
    const topDomain = [...this.domains.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '-';
    this.cardTitle = `STAGE ${d.world + 1}-${this.stage} CLEAR!`;
    this.cardLines = [
      ['GEMS', pad(s.gems - b.gems, 3)],
      ['STOMPS', pad(s.stomps - b.stomps, 3)],
      ['BLOCKS', pad(s.queries - b.queries, 3)],
      ['BRICKS', pad(s.bricks - b.bricks, 3)],
      ['FLAGS', pad(s.flags - b.flags, 3)],
      ['TOP SITE', topDomain.slice(0, 16)],
    ];
    this.stageStart = { gems: s.gems, stomps: s.stomps, queries: s.queries, bricks: s.bricks, flags: s.flags };
    this.domains.clear();
    this.stage++;
    this.stageT = 0;
    this.cardT = 0;
    this.card.hidden = false;
  }

  private drawCard(dt: number): void {
    if (this.cardT < 0) return;
    this.cardT += dt;
    const HOLD = 5.5, T = this.cardT;
    if (T > HOLD + 0.6) { this.cardT = -1; this.card.hidden = true; return; }
    // slides down into place, holds, slides back up (eased)
    const inK = Math.min(1, T / 0.5), outK = Math.max(0, (T - HOLD) / 0.5);
    const ease = (k: number) => k * k * (3 - 2 * k);
    this.card.style.transform = `translate(-50%, ${(-40 + 40 * ease(inK) - 40 * ease(outK)).toFixed(1)}px)`;
    this.card.style.opacity = String(ease(inK) * (1 - ease(outK)));
    const c = this.cardCtx, W = 150, H = 74;
    c.clearRect(0, 0, W, H);
    c.fillStyle = P.ink; c.fillRect(0, 0, W, H);
    c.fillStyle = P.white; c.fillRect(0, 0, W, 1); c.fillRect(0, H - 1, W, 1); c.fillRect(0, 0, 1, H); c.fillRect(W - 1, 0, 1, H);
    c.fillStyle = P.navy; c.fillRect(2, 2, W - 4, 1); c.fillRect(2, H - 3, W - 4, 1);
    const tw = this.cardTitle.length * 4;
    drawText(c, this.cardTitle, Math.floor((W - tw) / 2), 6, P.sand);
    // the numbers tick in one line at a time
    this.cardLines.forEach(([label, value], k) => {
      if (T < 0.6 + k * 0.25) return;
      const y = 18 + k * 9;
      drawText(c, label, 12, y, P.silver, null);
      drawText(c, value, W - 12 - value.length * 4, y, P.white, null);
    });
  }
}
