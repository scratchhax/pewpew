import { Container, Graphics, Text } from 'pixi.js';
import { L, EV, label, hbar, vbar, elbow, elbowBL, pip } from './sprites';

/**
 * The Bridge console: a full-screen LCARS layout that IS the interface.
 * Everything is vector (bars, elbows, pips, text), so it rasterises crisp at
 * any resolution from 720p to 4K, and the layout is recomputed from the
 * window size on every resize - no fixed world, no letterboxing.
 *
 * Structure is LCARS (peach, lilac, blue); data is the event law (allow
 * green, block red, DNS blue, DHCP yellow, Wi-Fi purple, threat amber,
 * system grey). The deck is never still: the sweep turns, the waveform
 * breathes, the stardate ticks, and the feed scrolls.
 */

const KINDS = ['allow', 'block', 'dns', 'dhcp', 'wifi', 'threat', 'system'] as const;
type Kind = typeof KINDS[number];

interface Blip { ang: number; dist: number; t0: number; color: number; }
interface Row { kind: Kind; text: string; y: number; }
interface HistEv { kind: Kind; }

interface Rect { x: number; y: number; w: number; h: number; }
interface Lay {
  W: number; H: number; u: number; bw: number; er: number; er2: number;
  viewer: Rect; wave: Rect; bank: Rect; feed: Rect; crew: Rect; lib: Rect;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export class Console {
  private chrome = new Graphics();
  private leftG = new Graphics();
  private sweepG = new Graphics();
  private waveG = new Graphics();
  private bankG = new Graphics();
  private rowsG = new Container();
  private texts = new Container();

  private lay!: Lay;
  private t = 0;
  private sweep = 0;
  private blips: Blip[] = [];
  private rows: Row[] = [];
  private rowPool: Array<{ cap: Graphics; txt: Text }> = [];
  private crewT: Text[] = []; private crewC: Graphics[] = [];
  private libT: Text[] = []; private libC: Graphics[] = [];
  private hist: HistEv[] = [];
  private lastFeed = -9;
  private crew: string[] = [];
  private lib: string[] = [];
  private counts = new Map<Kind, number[]>();
  private ports: number[] = new Array(8).fill(-9);
  private portI = 0;
  private ffFlash = 0;
  private blockFlash = 0;
  private powerT = 9;
  private alertUntil = -9;
  private alertOn = false;
  private phase = 0;
  activity = 0;

  // persistent texts
  private stardateT = label('STARDATE 00000.0', 20, '#000000', 700);
  private clockT = label('00:00:00', 20, '#000000', 700, 'right');
  private titleT = label('U.S.S. PEWPEW · NET DEFENSE GRID', 20, '#000000', 700, 'right');
  private alertT = label('RED ALERT', 26, '#000000', 700, 'center');
  private statusT = label('UPLINK ACTIVE', 16, '#000000', 600);
  private impT = label('IMPULSE POWER 100%', 14, L.paleblue, 600);
  private sensT = label('SENSORS NOMINAL', 14, L.paleblue, 600, 'right');
  private hViewer = label('LONG RANGE SCAN', 18, '#000000', 700);
  private hRange = label('IMPULSE RANGE', 15, '#000000', 600, 'right');
  private hWave = label('SHIELD HARMONICS', 15, '#000000', 700);
  private hBank = label('EVENT ANALYSIS', 15, '#000000', 700);
  private hFeed = label('SUBSPACE RELAY', 15, '#000000', 700);
  private hCrew = label('CREW MANIFEST', 15, '#000000', 700);
  private hLib = label('LIB. COMPARATIVE', 15, '#000000', 700);
  private hFF = label('FORCE FIELD', 11, L.salmon, 600);
  private hPorts = label('DOCKING UPLINK', 11, L.lilac, 600);
  private kindT: Text[] = [];

  constructor(private layer: Container, private settings: Record<string, any>) {
    layer.addChild(this.chrome, this.leftG, this.sweepG, this.waveG, this.bankG, this.rowsG, this.texts);
    this.texts.addChild(
      this.stardateT, this.clockT, this.titleT, this.alertT, this.statusT, this.impT, this.sensT,
      this.hViewer, this.hRange, this.hWave, this.hBank, this.hFeed, this.hCrew, this.hLib,
      this.hFF, this.hPorts,
    );
    for (const k of KINDS) {
      const tt = label(k.toUpperCase(), 12, L.gray, 600, 'center');
      this.kindT.push(tt);
      this.texts.addChild(tt);
    }
    for (let i = 0; i < 6; i++) {
      const cap = new Graphics(); const txt = label('', 14, L.white, 600);
      this.rowsG.addChild(cap); this.texts.addChild(txt);
      this.crewC.push(cap); this.crewT.push(txt);
    }
    for (let i = 0; i < 5; i++) {
      const cap = new Graphics(); const txt = label('', 14, L.paleblue, 600);
      this.rowsG.addChild(cap); this.texts.addChild(txt);
      this.libC.push(cap); this.libT.push(txt);
    }
    this.alertT.visible = false;
  }

  // ── layout ───────────────────────────────────────────────────────────────
  resize(W: number, H: number): void {
    const u = Math.max(0.5, Math.min(2.4, Math.min(W / 1920, H / 1080)));
    const bw = 30 * u;
    const er = 190 * u, er2 = 80 * u;
    const g0 = 12 * u;
    const x0 = bw + g0, y0 = bw + g0, x1 = W - bw - g0, y1 = H - bw - g0;
    const cw = x1 - x0, ch = y1 - y0;
    const pw = Math.max(240 * u, cw * 0.30);
    const vw = cw - pw - g0;
    this.lay = {
      W, H, u, bw, er, er2,
      viewer: { x: x0, y: y0, w: vw, h: ch * 0.60 },
      wave: { x: x0, y: y0 + ch * 0.60 + g0, w: vw, h: ch * 0.15 },
      bank: { x: x0, y: y0 + ch * 0.75 + 2 * g0, w: vw, h: ch * 0.25 - 2 * g0 },
      feed: { x: x0 + vw + g0, y: y0, w: pw, h: ch * 0.44 },
      crew: { x: x0 + vw + g0, y: y0 + ch * 0.44 + g0, w: pw, h: ch * 0.28 },
      lib: { x: x0 + vw + g0, y: y0 + ch * 0.72 + 2 * g0, w: pw, h: ch * 0.28 - 2 * g0 },
    };
    this.buildChrome();
    this.placeTexts();
    this.ensureRows();
  }

  private buildChrome(): void {
    const { W, H, u, bw, er, er2 } = this.lay;
    const g = this.chrome;
    g.clear();
    const c1 = this.alertOn ? L.red : L.peach;
    const c2 = this.alertOn ? L.dkred : L.orange;
    const c3 = this.alertOn ? L.dkred : L.lilac;

    hbar(g, er, 0, W - er, bw, c1);
    elbow(g, er, er, er, er - bw, c1);
    vbar(g, 0, er, bw, H - er - er2, c1);
    elbowBL(g, er2, H - er2, er2, er2 - bw, c1);
    hbar(g, er2, H - bw, W - er2, bw, c2);
    vbar(g, W - bw, 0, bw, H, c3);

    // rail rhythm: black notches + coloured pips (LCARS rhythm). The left
    // column skips the force-field gauge and docking-port zone.
    const notch = (x: number, y: number, w: number, h: number) => g.rect(x, y, w, h).fill(L.black);
    const ffZone = [er + 40 * u, er + 70 * u + 190 * u + 8 * 22 * u + 26 * u];
    for (let y = er + 40 * u, n = 0; y < H - er2 - 60 * u; y += 96 * u, n++) {
      if (y > ffZone[0] - 40 * u && y < ffZone[1]) continue;
      notch(0, y, bw, 4 * u);
      pip(g, 3 * u, y + 10 * u, bw - 6 * u, 26 * u, n % 2 ? L.blue : L.cyan);
      notch(0, y + 44 * u, bw, 4 * u);
    }
    for (let x = er + 60 * u, n = 0; x < W - bw - 40 * u; x += 120 * u, n++) {
      notch(x, 0, 4 * u, bw);
      pip(g, x + 10 * u, 3 * u, 40 * u, bw - 6 * u, n % 2 ? L.tan : L.blue);
      notch(x + 58 * u, 0, 4 * u, bw);
    }
    for (let y = 40 * u, n = 0; y < H - 40 * u; y += 84 * u, n++) {
      notch(W - bw, y, bw, 4 * u);
      pip(g, W - bw + 3 * u, y + 10 * u, bw - 6 * u, 22 * u, n % 2 ? L.peach : L.salmon);
      notch(W - bw, y + 40 * u, bw, 4 * u);
    }

    // panel headers + viewer well
    const { viewer, wave, bank, feed, crew, lib } = this.lay;
    const hh = 22 * u;
    hbar(g, viewer.x, viewer.y, viewer.w, hh, L.blue);
    hbar(g, viewer.x + viewer.w - 130 * u, viewer.y, 130 * u, hh, L.paleblue);
    hbar(g, wave.x, wave.y, wave.w, hh, L.tan);
    hbar(g, bank.x, bank.y, bank.w, hh, L.lilac);
    hbar(g, feed.x, feed.y, feed.w, hh, L.peach);
    hbar(g, crew.x, crew.y, crew.w, hh, L.blue);
    hbar(g, lib.x, lib.y, lib.w, hh, L.lilac);
    g.rect(viewer.x, viewer.y + hh, viewer.w, viewer.h - hh).fill('#02040a');

    // force-field gauge + docking-port sockets in the left column
    const ffy = er + 70 * u;
    g.rect(6 * u, ffy, bw - 12 * u, 150 * u).stroke({ width: 2 * u, color: L.salmon, alpha: 0.8 });
    for (let i = 0; i < 8; i++) {
      g.roundRect(6 * u, ffy + 190 * u + i * 22 * u, bw - 12 * u, 14 * u, 4 * u).fill('#2a1140');
    }
  }

  private placeTexts(): void {
    const { W, H, u, bw, er, er2 } = this.lay;
    const { viewer, wave, bank, feed, crew, lib } = this.lay;
    const k = Math.max(0.55, Math.min(2.2, u));
    for (const t of [this.stardateT, this.clockT, this.titleT]) t.scale.set(k);
    this.alertT.scale.set(k * 1.2);
    this.stardateT.position.set(er + 24 * u, 6 * u);
    this.clockT.position.set(W - bw - 24 * u, 6 * u);
    this.titleT.position.set(W - bw - 24 * u, H - bw + 6 * u);
    this.alertT.position.set((er + W - bw) / 2, 3 * u);
    this.statusT.scale.set(k);
    this.statusT.position.set(er2 + 24 * u, H - bw + 7 * u);
    this.impT.scale.set(k); this.sensT.scale.set(k);
    this.impT.position.set(viewer.x + 8 * u, viewer.y + viewer.h - 20 * u);
    this.sensT.position.set(viewer.x + viewer.w - 8 * u, viewer.y + viewer.h - 20 * u);
    const hh = 22 * u;
    const put = (t: Text, x: number, y: number) => { t.scale.set(k * 0.9); t.position.set(x, y); };
    put(this.hViewer, viewer.x + 10 * u, viewer.y + 3 * u);
    put(this.hRange, viewer.x + viewer.w - 10 * u, viewer.y + 4 * u);
    put(this.hWave, wave.x + 10 * u, wave.y + 3 * u);
    put(this.hBank, bank.x + 10 * u, bank.y + 3 * u);
    put(this.hFeed, feed.x + 10 * u, feed.y + 3 * u);
    put(this.hCrew, crew.x + 10 * u, crew.y + 3 * u);
    put(this.hLib, lib.x + 10 * u, lib.y + 3 * u);
    put(this.hFF, 0, 0);
    this.hFF.rotation = Math.PI / 2;
    this.hFF.anchor.set(0, 0);
    this.hFF.style.fill = L.white;
    this.hFF.position.set(6 * u, er + 6 * u);
    this.hPorts.rotation = Math.PI / 2;
    this.hPorts.anchor.set(0, 0);
    this.hPorts.position.set(6 * u, er + 70 * u + 190 * u + 8 * 22 * u + 14 * u);
    const bwid = bank.w / KINDS.length;
    KINDS.forEach((_, i) => {
      const t = this.kindT[i];
      t.scale.set(k * 0.85);
      t.position.set(bank.x + bwid * (i + 0.5), bank.y + bank.h - 16 * u);
    });
    void hh;
  }

  // ── feed rows ────────────────────────────────────────────────────────────
  private ensureRows(): void {
    const want = Math.min(20, this.settings.bFeedRows ?? 12) + 2;
    while (this.rowPool.length < want) {
      const cap = new Graphics();
      const txt = label('', 15, L.white, 600);
      this.rowsG.addChild(cap); this.texts.addChild(txt);
      this.rowPool.push({ cap, txt });
    }
    for (const r of this.rowPool) { r.txt.visible = false; r.cap.clear(); }
  }

  // ── events ───────────────────────────────────────────────────────────────
  event(kind: Kind, text: string): void {
    if (this.settings.bBlips !== false) {
      if (this.blips.length >= (this.settings.bMaxBlips ?? 60)) this.blips.shift();
      this.blips.push({ ang: Math.random() * Math.PI * 2, dist: 0.25 + Math.random() * 0.7, t0: this.t, color: EV[kind] });
    }
    if (this.settings.bFeed !== false) {
      // at demo traffic the feed would blur into noise: one row per 0.12s
      if (this.t - this.lastFeed > 0.12) {
        this.lastFeed = this.t;
        this.rows.push({ kind, text: text.toUpperCase().slice(0, 30), y: 80 });
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
    if (kind === 'dhcp' && text) {
      const n = text.toUpperCase();
      this.crew = [n, ...this.crew.filter((c) => c !== n)].slice(0, 6);
    }
    if (kind === 'dns' && text) {
      const d = text.toUpperCase().replace(/^WWW\./, '');
      this.lib = [d, ...this.lib.filter((c) => c !== d)].slice(0, 5);
    }
    if (kind === 'system') this.powerT = 0;
  }

  alert(): void { this.alertUntil = this.t + 3; }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt: number, t: number, activity: number): void {
    this.t = t;
    this.activity = activity;
    const u = this.lay.u;

    // red alert strobe: the whole frame flips red twice a second
    const alert = t < this.alertUntil && this.settings.bAlert !== false;
    if (alert !== this.alertOn) {
      this.alertOn = alert;
      this.buildChrome();
      this.placeTexts();
    }
    this.alertT.visible = alert && Math.sin(t * 12) > -0.2;

    // power dropout flicker (system)
    if (this.powerT < 1.2) {
      this.powerT += dt;
      this.layer.alpha = 0.45 + 0.55 * (Math.random() < 0.3 ? 0.5 : 1);
    } else this.layer.alpha = 1;

    this.ffFlash = Math.max(0, this.ffFlash - dt * 1.6);
    this.blockFlash = Math.max(0, this.blockFlash - dt * 2.2);

    // stardate + clock tick
    const now = new Date();
    const sd = 41141 + (Date.now() / 86400000 - 20746) / 365.25 * 1000;
    this.stardateT.text = `STARDATE ${sd.toFixed(1)}`;
    this.clockT.text = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} UTC`;
    this.statusT.text = `UPLINK ACTIVE · DECK ${activity > 0.6 ? 'ALERT' : activity > 0.22 ? 'BUSY' : 'QUIET'} · ${Math.round(activity * 100)}% LOAD`;

    this.drawSweep(dt, t, u);
    this.drawWave(dt, u);
    this.drawBank(u);
    this.drawFeed(u);
    this.drawLists(u);
    this.drawLeftColumn(t, u);
  }

  private drawSweep(dt: number, t: number, u: number): void {
    const g = this.sweepG;
    g.clear();
    if (this.settings.bSweep === false) return;
    const { viewer } = this.lay;
    const cx = viewer.x + viewer.w / 2, cy = viewer.y + viewer.h / 2 + 8 * u;
    const R = Math.min(viewer.w, viewer.h - 16 * u) * 0.44;
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
      const a = age < 0.15 ? age / 0.15 : Math.max(0, 1 - (age - 0.15) / 5.8);
      g.circle(bx, by, 3.4 * u).fill({ color: b.color, alpha: a });
      if (age < 0.9) g.circle(bx, by, (3.4 + age * 22) * u).stroke({ width: 1.5 * u, color: b.color, alpha: a * 0.5 * (1 - age / 0.9) });
    }
  }

  private drawWave(dt: number, u: number): void {
    const g = this.waveG;
    g.clear();
    if (this.settings.bWave === false) return;
    const { wave } = this.lay;
    const hh = 22 * u;
    const x = wave.x, y = wave.y + hh, w = wave.w, h = wave.h - hh;
    this.phase += dt * (2 + this.activity * 5);
    const amp = Math.min(1.4, 0.22 + this.activity * 0.6 + this.blockFlash * 1.2);
    const col = this.blockFlash > 0.7 ? L.red : L.cyan;
    const n = 90;
    const px = (s: number) => x + 6 * u + (w - 12 * u) * (s / (n - 1));
    const py = (s: number) => {
      const v = Math.sin(s * 0.34 + this.phase) * 0.55 + Math.sin(s * 0.11 - this.phase * 0.7) * 0.3 + Math.sin(s * 1.7 + this.phase * 2.3) * 0.15;
      return y + h / 2 + v * h * 0.42 * amp;
    };
    g.moveTo(px(0), py(0));
    for (let i = 1; i < n; i++) g.lineTo(px(i), py(i));
    g.stroke({ width: 2 * u, color: col, alpha: 0.85 });
  }

  private drawBank(u: number): void {
    const g = this.bankG;
    g.clear();
    if (this.settings.bBars === false) return;
    const { bank } = this.lay;
    const hh = 22 * u;
    const x = bank.x, y = bank.y + hh, w = bank.w, h = bank.h - hh;
    const histH = 14 * u;
    const bwid = w / KINDS.length;
    const maxN = this.settings.bHistory ?? 48;
    this.hist.forEach((e, i) => {
      const hx = x + w * (i / maxN);
      g.rect(hx, y, Math.max(2 * u, w / maxN - 2 * u), histH).fill({ color: EV[e.kind], alpha: 0.45 + 0.55 * (i / Math.max(1, this.hist.length - 1)) });
    });
    g.rect(x, y, w, histH).stroke({ width: 1.5 * u, color: L.gray, alpha: 0.5 });
    let maxC = 4;
    for (const k of KINDS) maxC = Math.max(maxC, (this.counts.get(k) ?? []).length);
    KINDS.forEach((k, i) => {
      const mx = x + bwid * i + bwid * 0.28;
      const mw = bwid * 0.44;
      const my = y + histH + 8 * u;
      const mh = h - histH - 30 * u;
      g.roundRect(mx, my, mw, mh, mw / 2).stroke({ width: 1.5 * u, color: L.gray, alpha: 0.6 });
      const c = (this.counts.get(k) ?? []).length;
      const fh = Math.max(mw, mh * Math.min(1, c / maxC));
      g.roundRect(mx, my + mh - fh, mw, fh, mw / 2).fill({ color: EV[k], alpha: 0.9 });
    });
  }

  private drawFeed(u: number): void {
    const { feed } = this.lay;
    const hh = 22 * u;
    const rows = Math.min(20, this.settings.bFeedRows ?? 12);
    const rh = (feed.h - hh) / rows;
    // newest row sits at the bottom; rows ease into their slots and scroll up
    for (let i = 0; i < this.rows.length; i++) {
      const slot = (this.rows.length - 1 - i) * rh;   // 0 = bottom
      this.rows[i].y += (slot - this.rows[i].y) * 0.25;
    }
    this.rowPool.forEach((r, i) => {
      const row = this.rows[this.rows.length - 1 - i];
      if (!row) { r.txt.visible = false; r.cap.clear(); return; }
      const yy = feed.y + feed.h - rh * 0.5 - row.y;
      const show = yy > feed.y + hh + rh * 0.2 && yy < feed.y + feed.h;
      r.txt.visible = show;
      r.txt.scale.set(Math.max(0.55, Math.min(2.2, u)) * 0.85);
      r.txt.position.set(feed.x + 26 * u, yy - 10 * u);
      r.txt.text = row.text;
      r.txt.style.fill = hex(EV[row.kind]);
      r.cap.clear();
      if (show) hbar(r.cap, feed.x + 4 * u, yy - 7 * u, 14 * u, 8 * u, EV[row.kind]);
    });
  }

  private drawLists(u: number): void {
    const fill = (rect: { x: number; y: number; w: number; h: number }, items: string[], ts: Text[], cs: Graphics[], color: number) => {
      const hh = 22 * u;
      const rh = (rect.h - hh) / ts.length;
      ts.forEach((txt, i) => {
        const item = items[i];
        txt.visible = !!item;
        txt.scale.set(Math.max(0.55, Math.min(2.2, u)) * 0.85);
        txt.position.set(rect.x + 22 * u, rect.y + hh + 6 * u + i * rh);
        txt.style.fill = hex(color);
        if (item) txt.text = item.slice(0, 24);
        const cap = cs[i];
        cap.clear();
        if (item) hbar(cap, rect.x + 4 * u, rect.y + hh + 10 * u + i * rh, 10 * u, 8 * u, color);
      });
    };
    fill(this.lay.crew, this.crew, this.crewT, this.crewC, 0xffffff);
    fill(this.lay.lib, this.lib, this.libT, this.libC, 0x99ccff);
  }

  private drawLeftColumn(t: number, u: number): void {
    this.leftG.clear();
    const { er, bw } = this.lay;
    const ffy = er + 70 * u;
    const fill = Math.min(1, 0.3 + this.activity * 0.4 + this.ffFlash);
    const fh = 150 * u * fill;
    this.leftG.rect(8 * u, ffy + 150 * u - fh, bw - 16 * u, fh)
      .fill({ color: this.ffFlash > 0.3 ? L.red : L.tan, alpha: 0.95 });
    for (let i = 0; i < 8; i++) {
      const lit = t - this.ports[i] < 2;
      if (lit) {
        this.leftG.roundRect(6 * u, ffy + 190 * u + i * 22 * u, bw - 12 * u, 14 * u, 4 * u)
          .fill(0xc08cff);
      }
    }
  }
}
