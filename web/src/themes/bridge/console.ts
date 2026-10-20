import { Container, Graphics, Text } from 'pixi.js';
import { L, EV, label, hbar, vbar, pip } from './sprites';

/**
 * The Bridge console, laid out after a classic LCARS master systems display:
 * a big title bar with end-caps, a column of pill buttons down the left, a
 * gold rail of codes, and one big rounded frame holding the working panels —
 * gauges, the long-range sweep, the threat analyser, the intrusion log as an
 * actual table, and a row of LCD readouts along the bottom.
 *
 * Everything is vector, recomputed from the window size on every resize, so
 * it is flush to the edges and crisp from 720p to 4K. Structure is the classic
 * LCARS chart palette; data is the event law (allow green, block red, DNS
 * blue, DHCP yellow, Wi-Fi purple, threat amber, system grey). The deck is
 * never still — the sweep turns, the gauges breathe, the log scrolls — but
 * nothing ever strobes: the alert is a steady red frame, not a flasher.
 */

const KINDS = ['allow', 'block', 'dns', 'dhcp', 'wifi', 'threat', 'system'] as const;
type Kind = typeof KINDS[number];

interface Blip { ang: number; dist: number; t0: number; color: number; }
interface LogRow { kind: Kind; time: string; src: string; dst: string; proto: string; action: string; lvl: string; y: number; }
interface HistEv { kind: Kind; }

interface Rect { x: number; y: number; w: number; h: number; }
interface Lay {
  W: number; H: number; u: number;
  title: Rect; sub: Rect; side: Rect; rail: Rect; frame: Rect;
  gauges: Rect; sweep: Rect; threat: Rect; log: Rect; lcd: Rect;
}

export interface ConsoleStats {
  rate: number;      // events in the last 30s
  denied: number;    // blocks in the last 30s
  threats: number;   // threats in the last 30s
  threat: number;    // 0..1 threat level
  energy: number;    // 0..1
  uptime: number;    // seconds
}

const SIDEBAR = [
  ['SYS STATUS', '02-9382', L.orange],
  ['PORT MON', '02-9382', L.tan],
  ['BLOCKED', '07-4402', L.lilac],
  ['TRAFFIC', '03-9382', L.peach],
  ['ALERT LOG', '03-9382', L.red],
  ['SYS CONFIG', '07-4402', L.tan],
  ['BYPASS', '07-4402', L.lilac],
] as const;

const RAIL_CODES = ['02-9383', '07-4402', '07-4402', '01-4873'];
const LCD_CODES = ['LCD14', 'LCD75', 'LCD36', 'LCD13'];
const LCD_COLORS = [L.tan, L.lilac, L.paleblue, L.peach];

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const ACTION: Record<Kind, string> = {
  allow: 'ALLOW', block: 'BLOCK', dns: 'QUERY', dhcp: 'LEASE',
  wifi: 'DOCK', threat: 'ALERT', system: 'POWER',
};
const LVL: Record<Kind, string> = {
  allow: 'LOW', block: 'HIGH', dns: 'LOW', dhcp: 'LOW', wifi: 'LOW', threat: 'CRIT', system: 'MED',
};

export class Console {
  private chrome = new Graphics();
  private leftG = new Graphics();
  private sweepG = new Graphics();
  private threatG = new Graphics();
  private gaugeG = new Graphics();
  private lcdG = new Graphics();
  private rowsG = new Container();
  private texts = new Container();

  private lay!: Lay;
  private t = 0;
  private sweep = 0;
  private blips: Blip[] = [];
  private rows: LogRow[] = [];
  private rowPool: Array<{ txt: Text }> = [];
  private hist: HistEv[] = [];
  private counts = new Map<Kind, number[]>();
  private ports: number[] = new Array(8).fill(-9);
  private portI = 0;
  private ffFlash = 0;
  private blockFlash = 0;
  private powerT = 9;
  private alertUntil = -9;
  private alertOn = false;
  private phase = 0;
  private stats: ConsoleStats = { rate: 0, denied: 0, threats: 0, threat: 0.15, energy: 0.3, uptime: 0 };
  activity = 0;

  // persistent texts
  private titleL = label('LCARS DATA LINK', 46, L.orange, 700);
  private titleR = label('FIREWALL MONITOR · FW-SYS-902', 46, L.lilac, 700, 'right');
  private stardateT = label('STARDATE 00000.0', 18, L.peach, 600);
  private clockT = label('00:00:00 UTC', 18, L.peach, 600, 'right');
  private alertT = label('RED ALERT', 22, '#000000', 700, 'center');
  private sideT: Text[] = [];
  private sideC: Text[] = [];
  private railC: Text[] = [];
  private hLog = label('INTRUSION DETECTION & FIREWALL LOG', 26, L.orange, 700);
  private hSweep = label('LONG RANGE SCAN', 16, L.paleblue, 600);
  private hThreat = label('THREAT ANALYSIS', 16, L.salmon, 600);
  private colT: Text[] = [];
  private cellT: Text[][] = [];
  private gaugeT: Text[] = [];
  private lcdT: Text[] = [];
  private lcdV: Text[] = [];

  constructor(private layer: Container, private settings: Record<string, any>) {
    layer.addChild(this.chrome, this.leftG, this.gaugeG, this.sweepG, this.threatG, this.lcdG, this.rowsG, this.texts);
    this.texts.addChild(this.titleL, this.titleR, this.stardateT, this.clockT, this.alertT, this.hLog, this.hSweep, this.hThreat);
    for (let i = 0; i < SIDEBAR.length; i++) {
      const name = label(SIDEBAR[i][0], 24, '#000000', 700, 'center');
      const code = label(SIDEBAR[i][1], 13, '#000000', 600, 'right');
      this.sideT.push(name); this.sideC.push(code);
      this.texts.addChild(name, code);
    }
    for (let i = 0; i < RAIL_CODES.length; i++) {
      const c = label(RAIL_CODES[i], 13, '#000000', 600, 'right');
      this.railC.push(c); this.texts.addChild(c);
    }
    for (const c of ['TIMESTAMP', 'SOURCE IP', 'DESTINATION', 'PROTOCOL', 'ACTION', 'THREAT LVL']) {
      const t = label(c, 17, L.paleblue, 600);
      this.colT.push(t); this.texts.addChild(t);
    }
    for (let r = 0; r < 12; r++) {
      const cells: Text[] = [];
      for (let c = 0; c < 6; c++) {
        const t = label('', 19, L.white, 600);
        t.visible = false;
        cells.push(t); this.texts.addChild(t);
      }
      this.cellT.push(cells);
    }
    // gauges: 3 meters x (label, value) + harmonics label
    for (let i = 0; i < 7; i++) {
      const big = i === 1 || i === 3 || i === 5;
      const t = label('', big ? 22 : 14, big ? L.peach : L.paleblue, big ? 700 : 600);
      this.gaugeT.push(t); this.texts.addChild(t);
    }
    for (let i = 0; i < 4; i++) {
      const c = label(LCD_CODES[i], 13, '#000000', 700, 'center');
      const v = label('', 17, LCD_COLORS[i], 600, 'right');
      this.lcdT.push(c); this.lcdV.push(v);
      this.texts.addChild(c, v);
    }
    this.alertT.visible = false;
  }

  // ── layout ───────────────────────────────────────────────────────────────
  resize(W: number, H: number): void {
    const u = Math.max(0.5, Math.min(2.4, Math.min(W / 1920, H / 1080)));
    const m = 16 * u;                       // outer margin
    const sideW = 230 * u;
    const railW = 64 * u;
    const titleH = 64 * u;
    const subH = 26 * u;
    const top = m + titleH + 8 * u + subH + 10 * u;
    const x0 = m, y0 = m;
    const x1 = W - m, y1 = H - m;
    const side: Rect = { x: x0, y: top, w: sideW, h: y1 - top };
    const rail: Rect = { x: x0 + sideW + 8 * u, y: top, w: railW, h: y1 - top };
    const fx = rail.x + railW + 8 * u;
    const frame: Rect = { x: fx, y: top, w: x1 - fx, h: y1 - top };
    const pad = 26 * u, r = 36 * u;
    const ix = fx + r, iy = top + r, iw = frame.w - r - pad, ih = frame.h - r - pad;
    const gaugeH = 158 * u;
    const lcdH = 100 * u;
    const midH = (ih - gaugeH - lcdH - 3 * (14 * u)) * 0.46;
    const logH = ih - gaugeH - lcdH - 3 * (14 * u) - midH;
    this.lay = {
      W, H, u,
      title: { x: x0, y: y0, w: x1 - x0, h: titleH },
      sub: { x: x0, y: y0 + titleH + 8 * u, w: x1 - x0, h: subH },
      side, rail, frame,
      gauges: { x: ix, y: iy, w: iw, h: gaugeH },
      sweep: { x: ix, y: iy + gaugeH + 14 * u, w: iw * 0.56 - 8 * u, h: midH },
      threat: { x: ix + iw * 0.56 + 8 * u, y: iy + gaugeH + 14 * u, w: iw * 0.44 - 8 * u, h: midH },
      log: { x: ix, y: iy + gaugeH + midH + 28 * u, w: iw, h: logH },
      lcd: { x: ix, y: iy + ih - lcdH, w: iw, h: lcdH },
    };
    this.buildChrome();
    this.placeTexts();
  }

  // ── chrome ───────────────────────────────────────────────────────────────
  private buildChrome(): void {
    const { W, H, u, title, sub, side, rail, frame } = this.lay;
    const g = this.chrome;
    g.clear();
    const a = this.alertOn;
    const cap = a ? L.red : L.orange;
    const bar = a ? L.dkred : L.orange;

    // title bar: end-caps + the two big words (texts ride on top)
    const th = title.h;
    g.roundRect(title.x, title.y, 56 * u, th, 28 * u).fill(cap);
    g.roundRect(title.x + title.w - 56 * u, title.y, 56 * u, th, 28 * u).fill(cap);

    // sub bar: thin rules + status pills
    const sb = sub.y;
    hbar(g, sub.x, sb, sub.w * 0.42, sub.h, a ? L.dkred : L.tan);
    hbar(g, sub.x + sub.w * 0.42 + 8 * u, sb, sub.w * 0.24, sub.h, a ? L.red : L.salmon);
    hbar(g, sub.x + sub.w * 0.66 + 8 * u, sb, sub.w * 0.34, sub.h, a ? L.dkred : L.paleblue);

    // sidebar pills
    const n = SIDEBAR.length;
    const gap = 14 * u;
    const ph = (side.h - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const py = side.y + i * (ph + gap);
      const col = SIDEBAR[i][2] === L.red && a ? '#FF2222' : SIDEBAR[i][2];
      g.roundRect(side.x, py, side.w, ph, Math.min(ph / 2, 26 * u)).fill(col);
    }

    // gold code rail: segments with black codes knocked out
    const segH = rail.h / RAIL_CODES.length;
    g.rect(rail.x, rail.y, rail.w, rail.h).fill(a ? L.dkred : L.tan);
    for (let i = 0; i < RAIL_CODES.length; i++) {
      g.rect(rail.x, rail.y + segH * (i + 1) - 3 * u, rail.w, 6 * u).fill(L.black);
    }

    // the big rounded frame
    g.roundRect(frame.x, frame.y, frame.w, frame.h, 40 * u)
      .stroke({ width: 7 * u, color: a ? L.red : L.lilac, alpha: 1 });

    // inner dividers: lilac rules under gauges and above the LCD row
    const { gauges, log, lcd } = this.lay;
    hbar(g, gauges.x, gauges.y + gauges.h + 4 * u, gauges.w, 5 * u, a ? L.dkred : L.lilac);
    hbar(g, lcd.x, lcd.y - 10 * u, lcd.w, 5 * u, a ? L.dkred : L.lilac);
    // log header rule + column ticks
    hbar(g, log.x, log.y + 34 * u, log.w, 4 * u, a ? L.dkred : L.lilac);

    // panel header nubs (the little D-caps before panel titles)
    g.roundRect(this.lay.sweep.x - 2 * u, this.lay.sweep.y + 2 * u, 14 * u, 20 * u, 7 * u).fill(a ? L.red : L.orange);
    g.roundRect(this.lay.threat.x + this.lay.threat.w - 12 * u, this.lay.threat.y + 2 * u, 14 * u, 20 * u, 7 * u).fill(a ? L.red : L.orange);
    g.roundRect(log.x - 2 * u, log.y + 6 * u, 16 * u, 24 * u, 8 * u).fill(a ? L.red : L.orange);

    void W; void H;
  }

  private placeTexts(): void {
    const { u, title, sub, side, rail, frame, gauges, sweep, threat, log, lcd } = this.lay;
    const k = Math.max(0.55, Math.min(2.2, u));
    const cap = 64 * u;
    this.titleL.scale.set(k); this.titleR.scale.set(k);
    this.titleL.position.set(title.x + cap, title.y + 6 * u);
    this.titleR.position.set(title.x + title.w - cap, title.y + 6 * u);
    this.stardateT.scale.set(k); this.clockT.scale.set(k);
    this.stardateT.position.set(sub.x + 12 * u, sub.y + 3 * u);
    this.clockT.position.set(sub.x + sub.w - 12 * u, sub.y + 3 * u);
    this.alertT.scale.set(k);
    this.alertT.position.set((title.x + title.w / 2 + frame.x) / 2, sub.y + 1 * u);

    const n = SIDEBAR.length, gap = 14 * u;
    const ph = (side.h - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const py = side.y + i * (ph + gap);
      this.sideT[i].scale.set(k * 0.95);
      this.sideT[i].position.set(side.x + side.w / 2, py + ph / 2 - 14 * u);
      this.sideC[i].scale.set(k * 0.9);
      this.sideC[i].position.set(side.x + side.w - 16 * u, py + ph - 22 * u);
    }
    const segH = rail.h / RAIL_CODES.length;
    for (let i = 0; i < RAIL_CODES.length; i++) {
      this.railC[i].scale.set(k * 0.9);
      this.railC[i].position.set(rail.x + rail.w - 8 * u, rail.y + segH * i + 8 * u);
    }

    this.hLog.scale.set(k); this.hSweep.scale.set(k); this.hThreat.scale.set(k);
    this.hLog.position.set(log.x + 24 * u, log.y);
    this.hSweep.position.set(sweep.x + 22 * u, sweep.y);
    this.hThreat.position.set(threat.x, threat.y);

    // log columns: TIMESTAMP | SOURCE IP | DEST PORT | PROTOCOL | ACTION | THREAT LVL
    const cols = [0, 0.17, 0.40, 0.55, 0.68, 0.83];
    for (let c = 0; c < 6; c++) {
      this.colT[c].scale.set(k * 0.9);
      this.colT[c].position.set(log.x + log.w * cols[c], log.y + 46 * u);
    }
    for (const cells of this.cellT) for (const t of cells) t.scale.set(k * 0.95);

    // gauge labels/values are positioned per-frame in drawGauges
    void gauges; void lcd; void frame;
  }

  // ── events ───────────────────────────────────────────────────────────────
  event(kind: Kind, src: string, ev?: { dst?: string; port?: string; proto?: string }): void {
    if (this.settings.bBlips !== false) {
      if (this.blips.length >= (this.settings.bMaxBlips ?? 60)) this.blips.shift();
      this.blips.push({ ang: Math.random() * Math.PI * 2, dist: 0.25 + Math.random() * 0.7, t0: this.t, color: EV[kind] });
    }
    if (this.settings.bFeed !== false) {
      // at demo traffic the log would blur into noise: one row per 0.12s
      if (this.t - this.lastLog > 0.12) {
        this.lastLog = this.t;
        const d = new Date();
        const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        this.rows.push({
          kind, time,
          src: (src || '?').toUpperCase().slice(0, 15),
          dst: ((ev?.dst ?? '') + (ev?.port ? ':' + ev.port : '') || '—').toUpperCase().slice(0, 15),
          proto: (ev?.proto || (kind === 'dns' ? 'DNS' : kind === 'dhcp' ? 'DHCP' : kind === 'wifi' ? 'WPA' : '—')).toUpperCase().slice(0, 6),
          action: ACTION[kind], lvl: LVL[kind], y: 40,
        });
        const max = Math.min(20, this.settings.bFeedRows ?? 12);
        while (this.rows.length > max + 2) this.rows.shift();
      }
    }
    if (this.settings.bBars !== false) {
      this.hist.push({ kind });
      while (this.hist.length > (this.settings.bHistory ?? 48)) this.hist.shift();
      const a = this.counts.get(kind) ?? [];
      a.push(this.t);
      while (a.length && this.t - a[0] > 30) a.shift();
      this.counts.set(kind, a);
    }
    if (kind === 'block') { this.blockFlash = 1; this.ffFlash = 1; }
    if (kind === 'wifi' && this.settings.bPorts !== false) {
      this.ports[this.portI % 8] = this.t; this.portI++;
    }
    if (kind === 'system') this.powerT = 0;
  }
  private lastLog = -9;

  alert(): void { this.alertUntil = this.t + 3; }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt: number, t: number, activity: number, stats?: ConsoleStats): void {
    this.t = t;
    this.activity = activity;
    if (stats) this.stats = stats;
    const u = this.lay.u;

    // red alert: the frame goes red and stays red - no strobing, no flicker.
    const alert = t < this.alertUntil && this.settings.bAlert !== false;
    if (alert !== this.alertOn) {
      this.alertOn = alert;
      this.buildChrome();
      this.placeTexts();
    }
    this.alertT.visible = alert;

    // power dropout (system): one smooth dip, no random flicker
    if (this.powerT < 1.2) {
      this.powerT += dt;
      this.layer.alpha = 0.55 + 0.45 * Math.min(1, this.powerT / 1.2);
    } else this.layer.alpha = 1;

    this.ffFlash = Math.max(0, this.ffFlash - dt * 1.6);
    this.blockFlash = Math.max(0, this.blockFlash - dt * 2.2);

    // stardate + clock tick
    const now = new Date();
    const sd = 41141 + (Date.now() / 86400000 - 20746) / 365.25 * 1000;
    this.stardateT.text = `STARDATE ${sd.toFixed(1)}`;
    this.clockT.text = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} UTC`;

    this.drawGauges(u);
    this.drawSweep(dt, t, u);
    this.drawThreat(t, u);
    this.drawLog(u);
    this.drawLcd(u);
    this.drawLeftColumn(t, u);
  }

  private drawGauges(u: number): void {
    const g = this.gaugeG;
    g.clear();
    const { gauges } = this.lay;
    const s = this.stats;
    const a = this.alertOn;
    const rows = [
      ['FORCE FIELD', Math.min(1, 0.3 + this.activity * 0.4 + this.ffFlash), this.ffFlash > 0.3 ? L.red : L.salmon],
      ['SHIELDS', Math.max(0.05, 1 - s.threat), s.threat > 0.6 ? L.red : L.peach],
      ['IMPULSE PWR', Math.max(0.05, s.energy), L.orange],
    ];
    const bh = 24 * u;
    rows.forEach(([name, v, col], i) => {
      const x = gauges.x;
      const w = gauges.w - 26 * u;
      const y = gauges.y + 22 * u + i * 38 * u;
      // label above the bar
      const lt = this.gaugeT[i * 2];
      lt.text = String(name); lt.scale.set(Math.max(0.55, Math.min(2.2, u)) * 0.8);
      lt.position.set(x, y - 15 * u);
      // track + fill + end cap
      g.roundRect(x, y, w, bh, bh / 2).fill('#1a1a1a');
      g.roundRect(x, y, Math.max(bh, w * (v as number)), bh, bh / 2).fill(col as string);
      g.roundRect(x + w + 6 * u, y, 10 * u, bh, 5 * u).fill(col as string);
      // % readout knocked out at the right end of the track, reference-style
      const vt = this.gaugeT[i * 2 + 1];
      vt.text = `${Math.round((v as number) * 100)}%`;
      vt.scale.set(Math.max(0.55, Math.min(2.2, u)) * 0.95);
      vt.position.set(x + w - 10 * u, y + 3 * u);
      vt.style.fill = (v as number) > 0.82 ? '#000000' : L.peach;
      vt.style.align = 'right';
    });
    // shield harmonics: a segmented meter riding the activity
    const hx = gauges.x, hy = gauges.y + 22 * u + 3 * 38 * u - 8 * u;
    const segs = 24;
    const lit = Math.round((0.15 + this.activity * 0.85) * segs);
    for (let i = 0; i < segs; i++) {
      g.rect(hx + i * (12 * u), hy, 8 * u, 16 * u).fill(i < lit ? (a ? L.red : L.paleblue) : '#222233');
    }
    const ht = this.gaugeT[6];
    ht.text = 'SHIELD HARMONICS';
    ht.scale.set(Math.max(0.55, Math.min(2.2, u)) * 0.8);
    ht.position.set(hx + segs * 12 * u + 14 * u, hy + 1 * u);
  }

  private drawSweep(dt: number, t: number, u: number): void {
    const g = this.sweepG;
    g.clear();
    if (this.settings.bSweep === false) return;
    const { sweep } = this.lay;
    const cx = sweep.x + sweep.w / 2, cy = sweep.y + sweep.h / 2 + 10 * u;
    const R = Math.min(sweep.w, sweep.h - 20 * u) * 0.44;
    this.sweep += dt * (0.55 + this.activity * 0.7);
    for (let i = 1; i <= 3; i++) g.circle(cx, cy, R * i / 3).stroke({ width: 1.5 * u, color: L.deepblue, alpha: 0.55 });
    g.moveTo(cx - R, cy).lineTo(cx + R, cy).stroke({ width: 1.5 * u, color: L.deepblue, alpha: 0.4 });
    g.moveTo(cx, cy - R).lineTo(cx, cy + R).stroke({ width: 1.5 * u, color: L.deepblue, alpha: 0.4 });
    const steps = 18;
    for (let i = 0; i < steps; i++) {
      const a0 = this.sweep - (i + 1) * 0.055, a1 = this.sweep - i * 0.055;
      g.moveTo(cx, cy)
        .lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
        .lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R)
        .closePath().fill({ color: L.cyan, alpha: 0.05 * (1 - i / steps) + 0.008 });
    }
    g.moveTo(cx, cy).lineTo(cx + Math.cos(this.sweep) * R, cy + Math.sin(this.sweep) * R)
      .stroke({ width: 2 * u, color: L.cyan, alpha: 0.9 });
    g.circle(cx, cy, 4 * u).fill(L.peach);
    for (let i = this.blips.length - 1; i >= 0; i--) {
      const b = this.blips[i];
      const age = t - b.t0;
      if (age > 6) { this.blips.splice(i, 1); continue; }
      const bx = cx + Math.cos(b.ang) * R * b.dist, by = cy + Math.sin(b.ang) * R * b.dist;
      const al = age < 0.15 ? age / 0.15 : Math.max(0, 1 - (age - 0.15) / 5.8);
      g.circle(bx, by, 3.4 * u).fill({ color: b.color, alpha: al });
      if (age < 0.9) g.circle(bx, by, (3.4 + age * 22) * u).stroke({ width: 1.5 * u, color: b.color, alpha: al * 0.5 * (1 - age / 0.9) });
    }
  }

  private drawThreat(t: number, u: number): void {
    const g = this.threatG;
    g.clear();
    const { threat } = this.lay;
    const s = this.stats;
    // "MALICIOUS ATTEMPTS" headline rides as chrome text? keep it simple: bars
    const bx = threat.x, by = threat.y + 28 * u;
    const bw = threat.w, bh = threat.h - 28 * u;
    // 2x2 mini charts of the event history
    const cw = (bw - 16 * u) / 2, ch = (bh - 40 * u - 14 * u) / 2;
    const charts = [L.salmon, L.tan, L.paleblue, L.red];
    for (let q = 0; q < 4; q++) {
      const qx = bx + (q % 2) * (cw + 16 * u), qy = by + Math.floor(q / 2) * (ch + 14 * u);
      g.rect(qx, qy, cw, ch).stroke({ width: 1.5 * u, color: L.paleblue, alpha: 0.7 });
      const bars = 10;
      for (let i = 0; i < bars; i++) {
        const seed = Math.abs(Math.sin(i * 3.7 + q * 11.3 + Math.floor(t / 2))) * 0.6 + 0.15;
        const v = q === 3 ? Math.max(0.08, s.threat * (0.5 + 0.5 * Math.sin(i + t))) : seed * (0.3 + this.activity);
        const hgt = Math.max(2 * u, (ch - 6 * u) * Math.min(1, v));
        g.rect(qx + 6 * u + i * ((cw - 12 * u) / bars), qy + ch - 3 * u - hgt, (cw - 12 * u) / bars - 2 * u, hgt).fill(charts[q]);
      }
    }
    // docking uplink ports: 8 pills under the charts
    const py = by + 2 * ch + 14 * u + 24 * u;
    const pw = (bw - 7 * 6 * u) / 8;
    for (let i = 0; i < 8; i++) {
      const lit = t - this.ports[i] < 2;
      g.roundRect(bx + i * (pw + 6 * u), py, pw, 14 * u, 4 * u).fill(lit ? 0xc08cff : '#2a1140');
    }
  }

  private drawLog(u: number): void {
    const { log } = this.lay;
    const cols = [0, 0.17, 0.40, 0.55, 0.68, 0.83];
    const rows = Math.min(20, this.settings.bFeedRows ?? 12);
    const rh = (log.h - 70 * u) / rows;
    const k = Math.max(0.55, Math.min(2.2, u)) * 0.95;
    const bottom = log.y + log.h;
    // newest row sits at the bottom; rows ease into their slots and scroll up
    for (let i = 0; i < this.rows.length; i++) {
      const slot = (this.rows.length - 1 - i) * rh;   // 0 = bottom
      this.rows[i].y += (slot - this.rows[i].y) * 0.25;
    }
    for (let r = 0; r < this.cellT.length; r++) {
      const row = this.rows[this.rows.length - 1 - r];
      const cells = this.cellT[r];
      if (!row) { for (const c of cells) c.visible = false; continue; }
      const yTop = bottom - rh - row.y;
      const show = yTop > log.y + 66 * u && yTop < bottom;
      const vals = [row.time, row.src, row.dst, row.proto, row.action, row.lvl];
      const col = hex(EV[row.kind]);
      for (let c = 0; c < 6; c++) {
        const cell = cells[c];
        cell.visible = show;
        cell.scale.set(k);
        cell.position.set(log.x + log.w * cols[c], yTop);
        cell.text = vals[c];
        cell.style.fill = c >= 4 ? col : (row.kind === 'allow' || row.kind === 'system' ? L.white : col);
      }
    }
  }

  private drawLcd(u: number): void {
    const g = this.lcdG;
    g.clear();
    const { lcd } = this.lay;
    const s = this.stats;
    const vals = [
      Math.min(1, s.rate / 600),
      Math.min(1, s.denied / 120),
      Math.min(1, s.threats / 20),
      Math.min(1, s.uptime / 86400),
    ];
    const labels = ['TRAFFIC', 'DENIED', 'THREATS', 'UPTIME'];
    const colW = lcd.w / 4;
    for (let i = 0; i < 4; i++) {
      const x = lcd.x + colW * i + (i ? 14 * u : 0);
      const w = colW - 20 * u;
      const y = lcd.y + 10 * u;
      // code pill
      g.roundRect(x, y, 64 * u, 22 * u, 6 * u).fill(LCD_COLORS[i]);
      this.lcdT[i].scale.set(Math.max(0.55, Math.min(2.2, u)) * 0.9);
      this.lcdT[i].position.set(x + 32 * u, y + 4 * u);
      // track + fill (room kept on the right for the value)
      g.roundRect(x + 72 * u, y + 2 * u, w - 72 * u - 120 * u, 18 * u, 9 * u).fill('#1a1a1a');
      g.roundRect(x + 72 * u, y + 2 * u, Math.max(18 * u, (w - 72 * u - 120 * u) * vals[i]), 18 * u, 9 * u).fill(LCD_COLORS[i]);
      // value
      const v = this.lcdV[i];
      const txt = i === 3 ? fmtUptime(s.uptime) : `${Math.round(vals[i] * 100)}%`;
      v.text = `${labels[i]} ${txt}`;
      v.scale.set(Math.max(0.55, Math.min(2.2, u)) * 0.9);
      v.position.set(x + w, y + 2 * u);
      // second row: a small block meter
      const segs = 8;
      for (let j = 0; j < segs; j++) {
        const lit = j < Math.round(vals[i] * segs);
        g.rect(x + 72 * u + j * 14 * u, y + 30 * u, 10 * u, 12 * u).fill(lit ? LCD_COLORS[i] : '#222233');
      }
    }
  }

  private drawLeftColumn(t: number, u: number): void {
    // the sidebar pill for ALERT LOG glows steady red while the deck is at alert
    void t; void u;
    this.leftG.clear();
  }
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}D${String(h).padStart(2, '0')}H` : `${h}H${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}M`;
}
