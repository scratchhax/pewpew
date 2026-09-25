import { Application, Container, FillGradient, Graphics, Sprite, Text, TextStyle, TilingSprite } from 'pixi.js';
import type { MTextures } from './textures';
import type { Garden, MEdge, MNode } from './garden';

/**
 * The clearing: everything luminous is a layered additive glow — hyphae as
 * breathing bezier threads, hosts as nodules of light, DNS as pale mushrooms
 * pushing up with the domain on them, blocks as scorch that heals, threats as
 * a blight swarm the web burns off. The loam itself is a gradient with grain
 * and a vignette, and spore motes drift through all of it.
 */

const TEAL = 0x5ff0cf, TEAL_DIM = 0x2f9f88, WHITE = 0xdffff4;
const CREAM = 0xffd9a8, WARM = 0xffdfae, EMBER = 0xff5a2a, BLIGHT = 0xff2a55;

interface Pulse { e: MEdge; t: number; speed: number; dir: 1 | -1; sprite: Sprite; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; sprite: Sprite; }
interface Ring { x: number; y: number; r: number; max: number; life: number; g: Graphics; color: number; }
interface Bloom { x: number; t: number; life: number; c: Container; glow: Sprite; cap: Sprite; label: Text; }
interface Blight { c: Container; x: number; y: number; tx: number; ty: number; t: number; phase: number; parts: Sprite[]; halo: Sprite; }
interface Mote { s: Sprite; vx: number; vy: number; sway: number; ph: number; base: number; }
interface NodeView { glow: Sprite; core: Sprite; label: Text; n: MNode; }
interface Aged { sprite: Sprite; age: number; kind: 'scorch' | 'ember'; }

const qbez = (a: number, c: number, b: number, t: number): number => {
  const u = 1 - t;
  return u * u * a + 2 * u * t * c + t * t * b;
};

export class View {
  readonly world = new Container();
  private bg = new Container();
  private backdrop = new Graphics();
  private clearing: Sprite;
  private clearingWarm: Sprite;
  private grain: TilingSprite;
  private hyphae = new Container();
  private scorches = new Container();
  private nodesL = new Container();
  private bloomsL = new Container();
  private ambientL = new Container();
  private pulsesL = new Container();
  private fxL = new Container();
  private hyphaG = new Graphics();

  private nodeViews = new Map<string, NodeView>();
  private pulses: Pulse[] = [];
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private blooms: Bloom[] = [];
  private blights: Blight[] = [];
  private motes: Mote[] = [];
  private aged: Aged[] = [];
  private lastRev = -1;
  private lastDraw = -9;

  private w = 1; private h = 1; private unit = 1;

  maxPulses = 380; maxParticles = 1200; maxBlooms = 10;
  glow = 1; sporeDrift = 1; labels = true; weather = 0;

  constructor(app: Application, private tex: MTextures) {
    this.grain = TilingSprite.from(tex.grain, { width: 2000, height: 2000 });
    this.grain.alpha = 0.05;
    this.clearing = this.glowSprite(this.bg, TEAL_DIM, 0.3);
    this.clearingWarm = this.glowSprite(this.bg, 0x503012, 0.16);
    this.bg.addChild(this.grain);

    this.hyphae.addChild(this.hyphaG);
    this.hyphae.blendMode = 'add';
    this.pulsesL.blendMode = 'add';
    this.fxL.blendMode = 'add';
    this.world.addChild(this.hyphae, this.scorches, this.nodesL, this.bloomsL,
      this.ambientL, this.pulsesL, this.fxL);

    const vig = new Sprite(tex.vignette);
    app.stage.addChild(this.bg, this.world, vig);
    this.vigSprite = vig;
  }
  private vigSprite: Sprite;

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.unit = Math.min(w, h) / 900;
    // loam: cool dark above, faint warm earth below
    const g = new FillGradient(0, 0, 0, h);
    g.addColorStop(0, 0x05070a);
    g.addColorStop(0.55, 0x0a0c0a);
    g.addColorStop(1, 0x0e0b07);
    this.bg.removeChild(this.backdrop);
    this.backdrop = new Graphics().rect(0, 0, w, h).fill(g);
    this.bg.addChildAt(this.backdrop, 0);
    this.grain.width = w; this.grain.height = h;
    this.vigSprite.width = w; this.vigSprite.height = h;
    this.lastRev = -1;
    this.reseedMotes();
  }

  // ── spawners ──────────────────────────────────────────────────────────────

  /** A light pulse running a hypha; dir 1 = a→b. */
  pulseEdge(e: MEdge, dir: 1 | -1): void {
    if (this.pulses.length >= this.maxPulses) return;
    const sprite = new Sprite(this.tex.glowCore);
    sprite.anchor.set(0.5);
    sprite.tint = e.b === '' ? WARM : TEAL;
    sprite.blendMode = 'add';
    this.pulsesL.addChild(sprite);
    this.pulses.push({ e, t: dir === 1 ? 0 : 1, speed: 0.26 + Math.random() * 0.2, dir, sprite });
  }

  scorchAt(x: number, y: number): void {
    const s = new Sprite(this.tex.scorch);
    s.anchor.set(0.5);
    s.position.set(x, y);
    const sc = (0.9 + Math.random() * 0.7) * this.unit * 70;
    s.width = s.height = sc;
    s.alpha = 0;
    this.scorches.addChild(s);
    const ember = this.glowSprite(this.fxL, EMBER, 0);
    ember.position.set(x, y);
    ember.width = ember.height = sc * 1.1;
    this.aged.push({ sprite: s, age: 0, kind: 'scorch' }, { sprite: ember, age: 0, kind: 'ember' });
  }

  bloomAt(x: number, y: number, name: string): void {
    if (this.blooms.length >= this.maxBlooms) {
      const old = this.blooms.shift();
      if (old) this.bloomsL.removeChild(old.c);
    }
    // keep the fruiting bodies clear of the HUD rails: they live in the
    // middle band and the lower-middle, never behind the corner panels
    x = Math.min(this.w * 0.76, Math.max(this.w * 0.16, x));
    y = Math.min(this.h * 0.9, Math.max(this.h * 0.14, y));
    if (x < this.w * 0.36 && y > this.h * 0.54) y = this.h * (0.34 + 0.18 * Math.random());
    // one fruiting body per domain within throwing distance
    const tag = name.toUpperCase().slice(0, 26);
    for (const b of this.blooms) {
      if (b.label.text === tag && Math.hypot(b.x - x, b.c.y - y) < 170 * this.unit) return;
    }
    const c = new Container();
    c.position.set(x, y);
    const glow = this.glowSprite(c, CREAM, 0.5);
    glow.width = glow.height = 105 * this.unit;
    glow.y = -34 * this.unit;
    const cap = new Sprite(this.tex.caps[(Math.random() * this.tex.caps.length) | 0]);
    cap.anchor.set(0.5, 1);
    cap.tint = 0xffe9cf;
    const cs = 66 * this.unit;
    cap.width = cap.height = cs;
    const label = new Text({ text: name.toUpperCase().slice(0, 26), style: labelStyle(8) });
    label.anchor.set(0.5, 0);
    label.position.set(0, 5 * this.unit);
    label.tint = 0xffe8c8;
    label.alpha = 0;
    c.addChild(glow, cap, label);
    c.scale.set(1, 0.01);
    this.bloomsL.addChild(c);
    this.blooms.push({ x, t: 0, life: 22 + Math.random() * 10, c, glow, cap, label });
  }

  /** A blight swarm crawling in from a margin toward a bright host. */
  blightAt(tx: number, ty: number): void {
    const edge = (Math.random() * 4) | 0;
    const x = edge === 0 ? -40 : edge === 1 ? this.w + 40 : Math.random() * this.w;
    const y = edge === 2 ? -40 : edge === 3 ? this.h + 40 : Math.random() * this.h;
    const c = new Container();
    c.position.set(x, y);
    const halo = this.glowSprite(c, BLIGHT, 0.4);
    halo.width = halo.height = 170 * this.unit;
    const parts: Sprite[] = [];
    for (let i = 0; i < 22; i++) {
      const p = new Sprite(this.tex.mote);
      p.anchor.set(0.5);
      p.tint = i % 3 === 0 ? 0xff3a66 : 0xff7aa0;
      p.width = p.height = (10 + Math.random() * 16) * this.unit;
      p.blendMode = 'add';
      c.addChild(p);
      parts.push(p);
    }
    this.world.addChild(c);
    this.blights.push({ c, x, y, tx, ty, t: 0, phase: 0, parts, halo });
  }

  emit(x: number, y: number, color: number, n: number, speed: number, life: number): void {
    for (let i = 0; i < n; i++) {
      if (this.sparks.length >= this.maxParticles) break;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.9);
      const sprite = new Sprite(this.tex.mote);
      sprite.anchor.set(0.5);
      sprite.tint = color;
      sprite.blendMode = 'add';
      sprite.width = sprite.height = (5 + Math.random() * 9) * this.unit;
      sprite.position.set(x, y);
      this.fxL.addChild(sprite);
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, sprite });
    }
  }

  ringAt(x: number, y: number, color: number, max: number): void {
    const g = new Graphics();
    this.fxL.addChild(g);
    this.rings.push({ x, y, r: 3 * this.unit, max: max * this.unit, life: 1, g, color });
  }

  /** A node lit up by any event: a ring out from the nodule. */
  touchFx(n: MNode): void { this.ringAt(n.nx * this.w, n.ny * this.h, TEAL, 40); }

  unitPx(): number { return this.unit; }
  bloomCount(): number { return this.blooms.length; }
  pulseCount(): number { return this.pulses.length; }

  // ── frame ─────────────────────────────────────────────────────────────────

  update(dt: number, t: number, garden: Garden): void {
    if (garden.revision !== this.lastRev || t - this.lastDraw > 0.5) {
      this.drawHyphae(garden);
      this.lastRev = garden.revision;
      this.lastDraw = t;
    }
    // storm governor: when traffic floods, the base web dims and the light
    // is carried by the travelling pulses instead
    this.hyphaG.alpha = (0.85 + 0.15 * Math.sin(t * 0.45)) * (1 - this.weather * 0.3);

    this.syncNodes(garden, t);
    this.updatePulses(dt, garden);
    this.updateAged(dt);
    this.updateBlooms(dt);
    this.updateBlights(dt, garden);
    this.updateSparks(dt);
    this.updateRings(dt);
    this.updateMotes(dt);

    const calm = 0.34 + 0.07 * Math.sin(t * 0.07);
    this.clearing.alpha = (calm + this.weather * 0.12) * this.glow;
    this.clearing.position.set(this.w / 2, this.h / 2);
    const cs = Math.min(this.w, this.h) * (1.5 + 0.06 * Math.sin(t * 0.05));
    this.clearing.width = this.clearing.height = cs;
    this.clearingWarm.alpha = (0.26 + 0.05 * Math.sin(t * 0.09 + 2)) * this.glow;
    this.clearingWarm.position.set(this.w / 2, this.h * 1.02);
    this.clearingWarm.width = this.clearingWarm.height = Math.min(this.w, this.h) * 1.5;
  }

  /** [ax ay cx cy bx by]: the hypha's bezier, control bowed perpendicular. */
  private edgePts(e: MEdge, garden: Garden): number[] | null {
    const a = garden.nodes.get(e.a);
    if (!a) return null;
    const ax = a.nx * this.w, ay = a.ny * this.h;
    let bx: number, by: number;
    if (e.b === '') {
      const len = Math.min(this.w, this.h) * 0.24;
      bx = ax + Math.cos(e.out) * len; by = ay + Math.sin(e.out) * len;
    } else {
      const b = garden.nodes.get(e.b);
      if (!b) return null;
      bx = b.nx * this.w; by = b.ny * this.h;
    }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const bendAmt = len * 0.24 * e.bend * (e.b === '' ? 0.55 : 1);
    return [ax, ay, mx - (dy / len) * bendAmt, my + (dx / len) * bendAmt, bx, by];
  }

  private drawHyphae(garden: Garden): void {
    const g = this.hyphaG;
    g.clear();
    const u = this.unit;
    for (const e of garden.edges.values()) {
      const p = this.edgePts(e, garden);
      if (!p) continue;
      // memory keeps a faint thread; a flare only lifts it a little. Traffic
      // volume reads as travelling pulses, never as bulk brightness — a
      // flooded network is busy light over a calm web, not a white wall
      const wgt = Math.min(0.65, e.w * 1.1 + e.live * 0.32);
      if (wgt <= 0.003) continue;
      if (e.b === '') {
        // outward tendril: a sampled polyline that fades into the dark
        const seg = 6;
        for (let s = 0; s < seg; s++) {
          const t0 = s / seg, t1 = (s + 1) / seg;
          const fade = 1 - s / seg;
          g.moveTo(qbez(p[0], p[2], p[4], t0), qbez(p[1], p[3], p[5], t0))
            .lineTo(qbez(p[0], p[2], p[4], t1), qbez(p[1], p[3], p[5], t1))
            .stroke({ color: WARM, width: (1.2 + 5 * wgt) * fade * u, alpha: (0.07 + 0.18 * wgt) * fade });
        }
        continue;
      }
      // wide bloom band, soft halo, a bright thread, a white hint on the
      // oldest paths: the additive blend turns that stack into bioluminescence
      g.moveTo(p[0], p[1]).quadraticCurveTo(p[2], p[3], p[4], p[5])
        .stroke({ color: TEAL_DIM, width: (3.5 + 12 * wgt) * u, alpha: 0.03 + 0.10 * wgt });
      g.moveTo(p[0], p[1]).quadraticCurveTo(p[2], p[3], p[4], p[5])
        .stroke({ color: TEAL_DIM, width: (1.5 + 9 * wgt) * u, alpha: 0.10 + 0.22 * wgt });
      g.moveTo(p[0], p[1]).quadraticCurveTo(p[2], p[3], p[4], p[5])
        .stroke({ color: TEAL, width: (0.9 + 2.2 * wgt) * u, alpha: 0.34 + 0.34 * wgt });
      if (wgt > 0.5) {
        g.moveTo(p[0], p[1]).quadraticCurveTo(p[2], p[3], p[4], p[5])
          .stroke({ color: WHITE, width: u, alpha: (wgt - 0.5) * 1.4 });
      }
    }
  }

  private syncNodes(garden: Garden, t: number): void {
    for (const [id, n] of garden.nodes) {
      if (!this.nodeViews.has(id)) {
        const glow = this.glowSprite(this.nodesL, TEAL, 0);
        const core = new Sprite(this.tex.glowCore);
        core.anchor.set(0.5);
        core.tint = WHITE;
        core.blendMode = 'add';
        const label = new Text({ text: n.label.toUpperCase(), style: labelStyle(9) });
        label.anchor.set(0.5, 0);
        label.tint = 0x9fe8d5;
        this.nodesL.addChild(glow, core, label);
        this.nodeViews.set(id, { glow, core, label, n });
      }
    }
    for (const [id, v] of this.nodeViews) {
      if (!garden.nodes.has(id)) {
        this.nodesL.removeChild(v.glow, v.core, v.label);
        this.nodeViews.delete(id);
        continue;
      }
      v.n = garden.nodes.get(id)!;
    }
    for (const [id, v] of this.nodeViews) {
      const n = v.n;
      const x = n.nx * this.w, y = n.ny * this.h;
      const born = Math.min(1, (t - n.born) * 1.4 + 0.05);
      // memory glows faintly; live activity flares — the root never bakes in
      const wgt = Math.min(0.72, Math.pow(Math.min(1, n.w * 0.7 + n.live), 0.7));
      const pulse = Math.min(1, n.pulse) * Math.min(1, n.pulse);
      const breathe = 1 + 0.07 * Math.sin(t * 1.3 + id.length * 2.7 + x * 0.01);
      v.glow.position.set(x, y);
      v.glow.width = v.glow.height = (30 + 62 * wgt + 45 * pulse) * breathe * this.glow * born;
      v.glow.alpha = Math.min(0.55, 0.2 + 0.3 * wgt + 0.2 * pulse) * this.glow * born;
      const cSize = (6 + 7 * wgt + 5 * pulse) * this.unit * born;
      v.core.position.set(x, y);
      v.core.width = v.core.height = cSize;
      v.core.alpha = Math.min(0.8, 0.45 + 0.45 * Math.min(1, wgt * 1.2 + pulse)) * born;
      v.label.position.set(x, y + 10 * this.unit + cSize * 0.4);
      // only significant hosts carry a name — the rest are pure light
      v.label.alpha = this.labels ? (n.w > 0.3 ? 0.12 + 0.4 * wgt : 0) * born : 0;
    }
  }

  private updatePulses(dt: number, garden: Garden): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt * p.speed * p.dir;
      const pts = p.t > 0 && p.t < 1 ? this.edgePts(p.e, garden) : null;
      if (!pts) {
        this.pulsesL.removeChild(p.sprite);
        this.pulses.splice(i, 1);
        continue;
      }
      p.sprite.position.set(qbez(pts[0], pts[2], pts[4], p.t), qbez(pts[1], pts[3], pts[5], p.t));
      const edge = Math.min(p.t, 1 - p.t) * 8;
      const sz = (11 + 10 * Math.sin(Math.PI * p.t)) * this.unit;
      p.sprite.width = p.sprite.height = sz;
      p.sprite.alpha = Math.min(1, edge);
    }
  }

  private updateAged(dt: number): void {
    for (let i = this.aged.length - 1; i >= 0; i--) {
      const a = this.aged[i];
      a.age += dt;
      if (a.kind === 'scorch') {
        // fades in hot, then heals away over a fifth of a minute
        a.sprite.alpha = a.age < 0.8 ? (a.age / 0.8) * 0.5 : Math.max(0, 0.5 * (1 - (a.age - 0.8) / 19));
        if (a.age > 20) { this.scorches.removeChild(a.sprite); this.aged.splice(i, 1); }
      } else {
        a.sprite.alpha = Math.max(0, 0.6 * (1 - a.age / 3));
        if (a.age > 3) { this.fxL.removeChild(a.sprite); this.aged.splice(i, 1); }
      }
    }
  }

  private updateBlooms(dt: number): void {
    for (let i = this.blooms.length - 1; i >= 0; i--) {
      const b = this.blooms[i];
      b.t += dt;
      const up = Math.min(1, b.t / 1.1);
      const ease = 1 - Math.pow(1 - up, 3) + Math.sin(up * Math.PI) * 0.08;
      const wilt = b.t > b.life ? Math.min(1, (b.t - b.life) / 5) : 0;
      b.c.scale.set(1 - wilt * 0.15, Math.max(0.01, ease * (1 - wilt * 0.4)));
      b.c.rotation = Math.sin(b.t * 1.1 + b.x * 0.01) * 0.03 * (1 - wilt);
      const vis = 1 - wilt;
      b.cap.alpha = vis;
      b.glow.alpha = (0.42 + 0.28 * Math.sin(b.t * 2.2)) * vis * this.glow;
      b.label.alpha = Math.max(0, Math.min(1, b.t * 1.4 - 0.4)) * vis * 0.9;
      if (wilt >= 1) { this.blooms.splice(i, 1); this.bloomsL.removeChild(b.c); }
    }
  }

  private updateBlights(dt: number, garden: Garden): void {
    for (let i = this.blights.length - 1; i >= 0; i--) {
      const b = this.blights[i];
      b.t += dt;
      const approach = Math.min(1, b.t / 6.5);
      b.x += (b.tx - b.x) * Math.min(1, dt * (0.4 + approach * 0.8));
      b.y += (b.ty - b.y) * Math.min(1, dt * (0.4 + approach * 0.8));
      if (b.t > 7.5 && b.phase === 0) {
        b.phase = 1;                              // the web burns it off
        this.emit(b.x, b.y, WHITE, 26, 180 * this.unit, 0.9);
        this.emit(b.x, b.y, TEAL, 16, 110 * this.unit, 1.3);
        this.ringAt(b.x, b.y, TEAL, 160);
        for (const e of garden.edges.values()) e.live = Math.min(0.9, Math.max(e.live, 0.7));
        garden.revision++;
      }
      const fade = b.phase ? Math.max(0, 1 - (b.t - 7.5) / 1.6) : 1;
      b.c.position.set(b.x, b.y);
      b.halo.alpha = 0.68 * fade * (0.7 + 0.3 * Math.sin(b.t * 9));
      for (let k = 0; k < b.parts.length; k++) {
        const p = b.parts[k];
        const a = k * 2.399963 + b.t * (b.phase ? 3 : 1.2);
        const r = (18 + 26 * Math.sin(b.t * 2 + k)) * (b.phase ? 1 + (b.t - 7.5) * 6 : 1) * this.unit;
        p.position.set(Math.cos(a) * r, Math.sin(a) * r);
        p.alpha = fade * (k % 3 === 0 ? 0.9 : 0.4);
      }
      if (fade <= 0) { this.blights.splice(i, 1); this.world.removeChild(b.c); }
    }
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.fxL.removeChild(s.sprite); this.sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= 1 - dt * 1.6; s.vy = s.vy * (1 - dt * 1.6) - dt * 14 * this.unit;
      s.sprite.position.set(s.x, s.y);
      s.sprite.alpha = Math.pow(s.life / s.max, 1.5);
    }
  }

  private updateRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt * 1.4;
      r.r += (r.max - r.r) * Math.min(1, dt * 4);
      if (r.life <= 0) { this.fxL.removeChild(r.g); this.rings.splice(i, 1); continue; }
      r.g.clear();
      r.g.circle(r.x, r.y, r.r).stroke({ color: r.color, width: 2 * this.unit, alpha: r.life * 0.8 });
    }
  }

  // ── ambient spores ───────────────────────────────────────────────────────

  setWeather(w: number): void {
    const bucket = Math.round(w * 2);
    const was = Math.round(this.weather * 2);
    this.weather = w;
    if (bucket !== was) this.reseedMotes();
  }

  setBudgets(b: { mSporeDrift: number; mGlow: number; mMaxPulses: number; mMaxParticles: number; mMaxBlooms: number; mLabels: boolean }): void {
    const reseed = Math.abs(b.mSporeDrift - this.sporeDrift) > 0.3;
    this.sporeDrift = b.mSporeDrift; this.glow = b.mGlow; this.labels = b.mLabels;
    this.maxPulses = b.mMaxPulses; this.maxParticles = b.mMaxParticles; this.maxBlooms = b.mMaxBlooms;
    if (reseed) this.reseedMotes();
  }

  private reseedMotes(): void {
    for (const m of this.motes) this.ambientL.removeChild(m.s);
    this.motes = [];
    const n = Math.round((26 + 30 * this.sporeDrift) * (1 + this.weather * 1.2));
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.tex.mote);
      s.anchor.set(0.5);
      s.tint = i % 5 === 0 ? WARM : TEAL;
      s.blendMode = 'add';
      s.width = s.height = (3 + Math.random() * 7) * this.unit;
      s.position.set(Math.random() * this.w, Math.random() * this.h);
      this.ambientL.addChild(s);
      this.motes.push({ s, vx: (Math.random() - 0.5) * 6 * this.unit, vy: -(4 + Math.random() * 10) * this.unit,
        sway: 0.3 + Math.random() * 0.8, ph: Math.random() * 6.28, base: 0.09 + Math.random() * 0.22 });
    }
  }

  private updateMotes(dt: number): void {
    for (const m of this.motes) {
      m.ph += dt;
      m.s.x += (m.vx + Math.sin(m.ph * m.sway) * 5 * this.unit) * dt;
      m.s.y += m.vy * dt * (1 + this.weather * 0.9);
      m.s.alpha = m.base * (0.5 + 0.5 * Math.sin(m.ph * 1.7)) * this.glow;
      if (m.s.y < -20) { m.s.y = this.h + 10; m.s.x = Math.random() * this.w; }
      if (m.s.x < -20) m.s.x = this.w + 10;
      if (m.s.x > this.w + 20) m.s.x = -10;
    }
  }

  private glowSprite(parent: Container, tint: number, alpha: number): Sprite {
    const s = new Sprite(this.tex.glowSoft);
    s.anchor.set(0.5);
    s.tint = tint;
    s.blendMode = 'add';
    s.alpha = alpha;
    parent.addChild(s);
    return s;
  }
}

const labelStyle = (size: number): TextStyle => new TextStyle({
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: size, fill: 0xffffff,
});
