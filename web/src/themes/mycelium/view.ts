import { Application, Container, FillGradient, Graphics, Sprite, Text, TextStyle, TilingSprite } from 'pixi.js';
import type { MTextures } from './textures';
import type { Sim, SimBlight, SimFlash, SimNode, SimScorch, SimShroom } from './filaments';

/**
 * The clearing: pixi renders whatever the sim currently is. The mat itself
 * is one Graphics rebuilt on structural change (bucketed thin strokes with
 * alpha from filament memory), a per-frame hot layer carries living flow,
 * pulses ride the filaments, mushrooms rise at junctions and wilt into
 * spores, scorch heals, blight crawls. The loam is gradient + grain +
 * vignette; ambient motes drift through all of it.
 */

const TEAL = 0x5ff0cf, TEAL_DIM = 0x2f9f88, WHITE = 0xdffff4;
// three network colour families — ice cyan / teal / spring green — so a
// fused mat reads as a tapestry instead of one flat teal
const HUES = [0x49e6ff, 0x5ff0cf, 0x8cf29a];
const HUES_DIM = [0x268fa6, 0x2f9f88, 0x4f9c60];
const CREAM = 0xffd9a8, WARM = 0xffdfae, EMBER = 0xff5a2a, BLIGHT = 0xff2a55;

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; sprite: Sprite; }
interface Ring { x: number; y: number; r: number; max: number; life: number; g: Graphics; color: number; }
interface Mote { s: Sprite; vx: number; vy: number; sway: number; ph: number; base: number; }
interface NodeView { glow: Sprite; core: Sprite; label: Text }
interface ShroomView { c: Container; glow: Sprite; cap: Sprite; label: Text }
interface BlightView { c: Container; halo: Sprite; parts: Sprite[] }

const labelStyle = (size: number): TextStyle => new TextStyle({
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: size, fill: 0xffffff,
});

export class View {
  readonly world = new Container();
  private bg = new Container();
  private backdrop = new Graphics();
  private clearing: Sprite;
  private clearingWarm: Sprite;
  private grain: TilingSprite;
  private matG = new Graphics();
  private hotG = new Graphics();
  private pulsesL = new Container();
  private sporeL = new Container();
  private scorches = new Container();
  private nodesL = new Container();
  private bloomsL = new Container();
  private ambientL = new Container();
  private fxL = new Container();
  private blightsL = new Container();
  private vigSprite: Sprite;

  private nodeViews = new Map<string, NodeView>();
  private shroomViews = new Map<SimShroom, ShroomView>();
  private scorchViews = new Map<SimScorch, { s: Sprite; ember: Sprite }>();
  private blightViews = new Map<SimBlight, BlightView>();
  private flashSeen = new Set<SimFlash>();
  private pulsePool: Sprite[] = [];
  private sporePool: Sprite[] = [];
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private motes: Mote[] = [];
  private lastDraw = -9;

  private w = 1; private h = 1; private unit = 1;

  maxParticles = 1200;
  glow = 1; sporeDrift = 1; labels = true; weather = 0;

  constructor(app: Application, private tex: MTextures) {
    this.grain = TilingSprite.from(tex.grain, { width: 2000, height: 2000 });
    this.grain.alpha = 0.05;
    this.clearing = this.glowSprite(this.bg, TEAL_DIM, 0.3);
    this.clearingWarm = this.glowSprite(this.bg, 0x503012, 0.16);
    this.bg.addChild(this.grain);

    this.matG.blendMode = 'add';
    this.hotG.blendMode = 'add';
    this.pulsesL.blendMode = 'add';
    this.sporeL.blendMode = 'add';
    this.fxL.blendMode = 'add';
    this.world.addChild(this.scorches, this.matG, this.hotG, this.nodesL,
      this.bloomsL, this.blightsL, this.ambientL, this.sporeL, this.pulsesL, this.fxL);

    const vig = new Sprite(tex.vignette);
    app.stage.addChild(this.bg, this.world, vig);
    this.vigSprite = vig;
  }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.unit = Math.min(w, h) / 900;
    const g = new FillGradient(0, 0, 0, h);
    g.addColorStop(0, 0x05070a);
    g.addColorStop(0.55, 0x0a0c0a);
    g.addColorStop(1, 0x0e0b07);
    this.bg.removeChild(this.backdrop);
    this.backdrop = new Graphics().rect(0, 0, w, h).fill(g);
    this.bg.addChildAt(this.backdrop, 0);
    this.grain.width = w; this.grain.height = h;
    this.vigSprite.width = w; this.vigSprite.height = h;
    this.lastDraw = -9;
    this.reseedMotes();
  }

  unitPx(): number { return this.unit; }

  // ── transient view fx (event sparks the sim does not own) ────────────────
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

  // ── the mat ───────────────────────────────────────────────────────────────
  private drawMat(sim: Sim): void {
    const g = this.matG;
    g.clear();
    const u = this.unit;
    const B = 6;
    const buckets: number[][] = Array.from({ length: 3 * B }, () => []);
    for (let i = 0; i < sim.E.length; i++) {
      const e = sim.E[i];
      if (e.dead) continue;
      const a = Math.min(1, 0.05 + e.mem * 1.4);
      const h = sim.V[e.b]?.hue ?? 1;
      buckets[h * B + Math.min(B - 1, (a * B) | 0)].push(i);
    }
    for (let h = 0; h < 3; h++) {
      for (let k = 0; k < B; k++) {
        const list = buckets[h * B + k];
        if (!list.length) continue;
        const a = (k + 0.5) / B;
        for (const i of list) { const e = sim.E[i]; g.moveTo(sim.V[e.a].x, sim.V[e.a].y).lineTo(sim.V[e.b].x, sim.V[e.b].y); }
        g.stroke({ color: HUES_DIM[h], width: 2.6 * u, alpha: 0.09 + a * 0.16 });
        g.moveTo(0, 0);
        for (const i of list) { const e = sim.E[i]; g.moveTo(sim.V[e.a].x, sim.V[e.a].y).lineTo(sim.V[e.b].x, sim.V[e.b].y); }
        g.stroke({ color: HUES[h], width: 1 * u, alpha: 0.12 + a * 0.34 });
      }
    }
    // junction sparks where filaments fused
    const deg = sim.degrees();
    for (let v = 0; v < deg.length; v++) {
      if (deg[v] < 3) continue;
      const p = sim.V[v];
      const a = Math.min(0.34, 0.05 + (deg[v] - 2) * 0.045 + p.mem * 0.3);
      g.circle(p.x, p.y, (1.6 + p.mem * 2.4) * u).fill({ color: HUES[p.hue] ?? 0x8cffdc, alpha: a });
    }
  }

  private drawHot(sim: Sim, t: number): void {
    const g = this.hotG;
    g.clear();
    const u = this.unit;
    for (let i = 0; i < sim.E.length; i++) {
      const e = sim.E[i];
      if (e.dead || e.flow < 0.18) continue;
      g.moveTo(sim.V[e.a].x, sim.V[e.a].y).lineTo(sim.V[e.b].x, sim.V[e.b].y)
        .stroke({ color: WHITE, width: 0.9 * u, alpha: 0.04 + e.flow * e.flow * 0.26 });
    }
    // the growing frontier: each tip's live segment is drawn every frame as
    // a smoothly extending ciliated hair — the mat visibly reaches and wiggles
    for (const tip of sim.tips) {
      const pv = sim.V[tip.vPrev];
      if (!pv) continue;
      const hue = HUES[tip.hue] ?? TEAL;
      const ph = tip.born * 6 + tip.x * 0.05;
      const pts: number[] = [pv.x, pv.y];
      for (let k = 0; k < tip.trail.length; k += 2) {
        const wx = tip.trail[k], wy = tip.trail[k + 1];
        if (Math.hypot(wx - pts[pts.length - 2], wy - pts[pts.length - 1]) < 1.5) continue;
        pts.push(wx, wy);
      }
      pts.push(tip.x, tip.y);
      g.moveTo(pts[0], pts[1]);
      for (let k = 1; k < pts.length - 3; k += 2) {
        const dx = pts[k + 2] - pts[k - 2], dy = pts[k + 3] - pts[k + 1];
        const dl = Math.hypot(dx, dy) || 1;
        const w = Math.sin(t * 3.2 + ph + k * 0.9) * 2.2 * u;
        g.lineTo(pts[k] - dy / dl * w, pts[k + 1] + dx / dl * w);
      }
      g.lineTo(tip.x, tip.y);
      g.stroke({ color: hue, width: 1 * u, alpha: 0.26 });
      // a short feeler reaching ahead, swaying
      const fa = Math.sin(t * 4.5 + ph) * 0.55;
      g.moveTo(tip.x, tip.y)
        .lineTo(tip.x + Math.cos(tip.head + fa) * 7 * u, tip.y + Math.sin(tip.head + fa) * 7 * u)
        .stroke({ color: hue, width: 0.8 * u, alpha: 0.16 });
      g.circle(tip.x, tip.y, 1.4 * u).fill({ color: hue, alpha: 0.38 });
    }
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  update(dt: number, t: number, sim: Sim): void {
    if (t - this.lastDraw > 0.7) {
      this.drawMat(sim);
      this.lastDraw = t;
    }
    this.drawHot(sim, t);
    // storm governor: flooded traffic dims the base mat; the pulses carry it
    const gov = (0.85 + 0.15 * Math.sin(t * 0.45)) * (1 - this.weather * 0.3);
    this.matG.alpha = gov * this.glow;
    this.hotG.alpha = this.glow;

    this.syncNodes(sim, t);
    this.syncPulses(sim);
    this.syncShrooms(sim, t);
    this.syncScorches(sim);
    this.syncBlights(sim, t);
    this.syncFlashes(sim);
    this.syncSpores(sim);
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

  private syncNodes(sim: Sim, t: number): void {
    for (const [id, n] of sim.nodes) {
      if (!this.nodeViews.has(id)) {
        const glow = this.glowSprite(this.nodesL, HUES[n.hue] ?? TEAL, 0);
        const core = new Sprite(this.tex.glowCore);
        core.anchor.set(0.5); core.tint = WHITE; core.blendMode = 'add';
        const label = new Text({ text: n.label.toUpperCase(), style: labelStyle(9) });
        label.anchor.set(0.5, 0); label.tint = 0x9fe8d5;
        this.nodesL.addChild(glow, core, label);
        this.nodeViews.set(id, { glow, core, label });
      }
    }
    for (const id of [...this.nodeViews.keys()]) {
      if (sim.nodes.has(id)) continue;
      const v = this.nodeViews.get(id)!;
      this.nodesL.removeChild(v.glow, v.core, v.label);
      v.glow.destroy(); v.core.destroy(); v.label.destroy();
      this.nodeViews.delete(id);
    }
    for (const [id, v] of this.nodeViews) {
      const n = sim.nodes.get(id)!;
      const born = Math.min(1, (t - n.born) * 1.4 + 0.05);
      const mem = sim.memory(n);
      const pulse = n.pulse * n.pulse;
      const breathe = 1 + 0.07 * Math.sin(t * 1.3 + id.length * 2.7 + n.x * 0.01);
      v.glow.position.set(n.x, n.y);
      v.glow.width = v.glow.height = (30 + 62 * mem + 45 * pulse) * breathe * this.glow * born;
      v.glow.alpha = Math.min(0.55, 0.2 + 0.3 * mem + 0.2 * pulse) * this.glow * born;
      const cSize = (6 + 7 * mem + 5 * pulse) * this.unit * born;
      v.core.position.set(n.x, n.y);
      v.core.width = v.core.height = cSize;
      v.core.alpha = Math.min(0.8, 0.45 + 0.45 * Math.min(1, mem * 1.2 + pulse)) * born;
      v.label.position.set(n.x, n.y + 10 * this.unit + cSize * 0.4);
      v.label.alpha = this.labels ? (mem > 0.12 ? 0.12 + 0.4 * mem : 0) * born : 0;
    }
  }

  private syncPulses(sim: Sim): void {
    const n = sim.pulses.length;
    while (this.pulsePool.length < n) {
      const s = new Sprite(this.tex.glowCore);
      s.anchor.set(0.5); s.blendMode = 'add';
      this.pulsesL.addChild(s);
      this.pulsePool.push(s);
    }
    for (let i = 0; i < this.pulsePool.length; i++) {
      const s = this.pulsePool[i];
      const p = sim.pulses[i];
      if (!p) { s.visible = false; continue; }
      s.visible = true;
      s.tint = p.col;
      s.position.set(p.hx, p.hy);
      s.width = s.height = 10 * this.unit;
      s.alpha = 0.7;
    }
  }

  private syncShrooms(sim: Sim, t: number): void {
    for (const m of sim.shrooms) {
      if (this.shroomViews.has(m)) continue;
      const c = new Container();
      c.position.set(m.x, m.y);
      const glow = this.glowSprite(c, CREAM, 0.5);
      glow.width = glow.height = 105 * this.unit;
      glow.y = -34 * this.unit;
      const cap = new Sprite(this.tex.caps[(Math.random() * this.tex.caps.length) | 0]);
      cap.anchor.set(0.5, 1);
      cap.tint = 0xffe9cf;
      const cs = 66 * this.unit;
      cap.width = cap.height = cs;
      const label = new Text({ text: m.label, style: labelStyle(8) });
      label.anchor.set(0.5, 0);
      label.position.set(0, 5 * this.unit);
      label.tint = 0xffe8c8;
      label.alpha = 0;
      c.addChild(glow, cap, label);
      this.bloomsL.addChild(c);
      this.shroomViews.set(m, { c, glow, cap, label });
    }
    for (const [m, v] of [...this.shroomViews]) {
      if (sim.shrooms.includes(m)) continue;
      this.bloomsL.removeChild(v.c);
      v.c.destroy({ children: true });
      this.shroomViews.delete(m);
    }
    for (const [m, v] of this.shroomViews) {
      const up = Math.min(1, m.t / 1.1);
      const ease = 1 - Math.pow(1 - up, 3) + Math.sin(up * Math.PI) * 0.08;
      const wilt = m.t > m.life ? Math.min(1, (m.t - m.life) / 5) : 0;
      v.c.scale.set(m.s * (1 - wilt * 0.15), Math.max(0.01, m.s * ease * (1 - wilt * 0.4)));
      v.c.rotation = Math.sin(m.t * 1.1 + m.x * 0.01) * 0.03 * (1 - wilt) + m.lean * wilt * 0.4;
      const vis = 1 - wilt;
      v.cap.alpha = vis;
      v.glow.alpha = (0.42 + 0.28 * Math.sin(m.t * 2.2)) * vis * this.glow;
      v.label.alpha = Math.max(0, Math.min(1, m.t * 1.4 - 0.4)) * vis * 0.9;
    }
    void t;
  }

  private syncScorches(sim: Sim): void {
    for (const s of sim.scorchs) {
      if (this.scorchViews.has(s)) continue;
      const sp = new Sprite(this.tex.scorch);
      sp.anchor.set(0.5);
      sp.position.set(s.x, s.y);
      const sc = (0.9 + Math.random() * 0.7) * this.unit * s.r * 2.6;
      sp.width = sp.height = sc;
      sp.alpha = 0;
      this.scorches.addChild(sp);
      const ember = this.glowSprite(this.fxL, EMBER, 0);
      ember.position.set(s.x, s.y);
      ember.width = ember.height = sc * 1.1;
      this.scorchViews.set(s, { s: sp, ember });
    }
    for (const [s, v] of [...this.scorchViews]) {
      if (sim.scorchs.includes(s)) {
        v.s.alpha = s.t < 0.8 ? (s.t / 0.8) * 0.5 : Math.max(0, 0.5 * (1 - (s.t - 0.8) / 14));
        v.ember.alpha = Math.max(0, 0.5 * (1 - s.t / 3));
        continue;
      }
      this.scorches.removeChild(v.s); this.fxL.removeChild(v.ember);
      v.s.destroy(); v.ember.destroy();
      this.scorchViews.delete(s);
    }
  }

  private syncBlights(sim: Sim, t: number): void {
    for (const b of sim.blights) {
      if (this.blightViews.has(b)) continue;
      const c = new Container();
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
      this.blightsL.addChild(c);
      this.blightViews.set(b, { c, halo, parts });
    }
    for (const [b, v] of [...this.blightViews]) {
      if (!sim.blights.includes(b)) {
        this.blightsL.removeChild(v.c); v.c.destroy({ children: true });
        this.blightViews.delete(b);
        continue;
      }
      const fade = b.phase ? Math.max(0, 1 - (b.t - 7.4) / 1.6) : 1;
      v.c.position.set(b.x, b.y);
      v.halo.alpha = 0.68 * fade * (0.7 + 0.3 * Math.sin(b.t * 9));
      for (let k = 0; k < v.parts.length; k++) {
        const p = v.parts[k];
        const a = k * 2.399963 + b.t * (b.phase ? 3 : 1.2);
        const r = (18 + 26 * Math.sin(b.t * 2 + k)) * (b.phase ? 1 + (b.t - 7.4) * 6 : 1) * this.unit;
        p.position.set(Math.cos(a) * r, Math.sin(a) * r);
        p.alpha = fade * (k % 3 === 0 ? 0.9 : 0.4);
      }
    }
    void t;
  }

  private syncFlashes(sim: Sim): void {
    for (const f of sim.flashes) {
      if (this.flashSeen.has(f)) continue;
      this.flashSeen.add(f);
      const g = new Graphics();
      this.fxL.addChild(g);
      this.rings.push({ x: f.x, y: f.y, r: f.r * 0.3 * this.unit, max: f.r * 1.6 * this.unit, life: 1, g, color: (f.c[0] << 16) | (f.c[1] << 8) | f.c[2] });
    }
    if (this.flashSeen.size > 64) {
      for (const f of sim.flashes) if (f.t > f.life) this.flashSeen.delete(f);
    }
  }

  private syncSpores(sim: Sim): void {
    const n = sim.spores.length;
    while (this.sporePool.length < n) {
      const s = new Sprite(this.tex.mote);
      s.anchor.set(0.5); s.tint = WARM; s.blendMode = 'add';
      s.width = s.height = 3 * this.unit;
      this.sporeL.addChild(s);
      this.sporePool.push(s);
    }
    for (let i = 0; i < this.sporePool.length; i++) {
      const s = this.sporePool[i];
      const p = sim.spores[i];
      if (!p) { s.visible = false; continue; }
      s.visible = true;
      s.position.set(p.x, p.y);
      s.alpha = 0.55 * (1 - p.t / (p.land + 1));
    }
  }

  // ── transient fx + motes ──────────────────────────────────────────────────
  private updateSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.fxL.removeChild(s.sprite); s.sprite.destroy(); this.sparks.splice(i, 1); continue; }
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
      if (r.life <= 0) { this.fxL.removeChild(r.g); r.g.destroy(); this.rings.splice(i, 1); continue; }
      r.g.clear();
      r.g.circle(r.x, r.y, r.r).stroke({ color: r.color, width: 2 * this.unit, alpha: r.life * 0.8 });
    }
  }

  setWeather(w: number): void {
    const bucket = Math.round(w * 2);
    const was = Math.round(this.weather * 2);
    this.weather = w;
    if (bucket !== was) this.reseedMotes();
  }

  setBudgets(b: { mSporeDrift: number; mGlow: number; mMaxParticles: number; mLabels: boolean }): void {
    const reseed = Math.abs(b.mSporeDrift - this.sporeDrift) > 0.3;
    this.sporeDrift = b.mSporeDrift; this.glow = b.mGlow; this.labels = b.mLabels;
    this.maxParticles = b.mMaxParticles;
    if (reseed) this.reseedMotes();
  }

  private reseedMotes(): void {
    for (const m of this.motes) { this.ambientL.removeChild(m.s); m.s.destroy(); }
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
