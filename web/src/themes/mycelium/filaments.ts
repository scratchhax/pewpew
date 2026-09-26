import { hash01 } from '../../state';

/**
 * The living substrate. This is not a graph of traffic pairs: it is a fungal
 * mat that GROWS — tips wander the loam, branch, and fuse with other
 * networks into junctions, long before any packet moves. Traffic is nutrient
 * light: pulses walk the existing filaments and fade; habit (mem) makes
 * used routes bolder. Mushrooms fruit at busy junctions and seed new growth
 * with spores. Pure data + physics; the view draws it, index.ts feeds it.
 */

export interface SimNode {
  id: string;
  label: string;
  x: number; y: number;
  v: number;             // root vertex in the mat
  born: number;          // sim seconds
  pulse: number;         // recent-event flash, drawn and decayed fast
  hue: number;           // network colour family: 0 ice-cyan, 1 teal, 2 spring
}

interface Vtx { x: number; y: number; flow: number; mem: number; born: number; hue: number }
interface Seg { a: number; b: number; len: number; flow: number; mem: number; dead: boolean }

export interface SimPulse { p: number[]; s: number; len: number; hx: number; hy: number; col: number }
export interface SimShroom { x: number; y: number; t: number; life: number; lean: number; s: number; label: string }
export interface SimSpore { x: number; y: number; vx: number; vy: number; t: number; land: number }
export interface SimScorch { x: number; y: number; r: number; t: number }
export interface SimBlight { x: number; y: number; tx: number; ty: number; t: number; phase: number; target: string }
export interface SimFlash { x: number; y: number; t: number; life: number; r: number; c: [number, number, number] }

export interface SimTip { x: number; y: number; head: number; curv: number; vPrev: number; age: number; born: number; homeV: number; seeking: boolean; hue: number; trail: number[] }

const STORE = 'pewpew.mycelium.v3';
const LN2 = Math.log(2);
const SEG_LEN = 6;
const FUSE_R = 7;
const CELL = 28;
const GHOST = 0.045;          // the faintest a filament's memory ever fades
const TIP_SPEED = 24;         // px/s creep

export class Sim {
  nodes = new Map<string, SimNode>();
  V: Vtx[] = [];
  E: Seg[] = [];
  adj: number[][] = [];
  tips: SimTip[] = [];
  pulses: SimPulse[] = [];
  shrooms: SimShroom[] = [];
  spores: SimSpore[] = [];
  scorchs: SimScorch[] = [];
  blights: SimBlight[] = [];
  flashes: SimFlash[] = [];
  revision = 0;
  clock = 0;

  maxSegs = 3200;
  maxNodes = 40;
  maxShrooms = 10;
  maxPulses = 240;

  w = 1; h = 1;
  private uf: number[] = [];
  private hash = new Map<string, number[]>();
  private tGrow = 0; private tPrune = 14; private tReach = 0;
  private dirty = false; private saveAt = 0;
  private deadE = 0;
  private edgeCache = new Map<number, number>();

  private gscale = 1;

  setSize(w: number, h: number): void {
    this.w = w; this.h = h;
    // big screens are that much more loam to colonise: grow faster there
    this.gscale = Math.min(1.8, Math.max(1, Math.hypot(w, h) / 1750));
  }

  // ── graph plumbing ────────────────────────────────────────────────────────
  private key(x: number, y: number): string { return ((x / CELL) | 0) + ',' + ((y / CELL) | 0); }
  private hashPush(k: string, i: number): void { let a = this.hash.get(k); if (!a) { a = []; this.hash.set(k, a); } a.push(i); }

  private addV(x: number, y: number, mem = GHOST, hue = 1): number {
    const i = this.V.length;
    this.V.push({ x, y, flow: 0, mem, born: this.clock, hue });
    this.adj.push([]); this.uf[i] = i; this.hashPush(this.key(x, y), i);
    return i;
  }
  private addE(a: number, b: number): number {
    const i = this.E.length;
    const dx = this.V[a].x - this.V[b].x, dy = this.V[a].y - this.V[b].y;
    this.E.push({ a, b, len: Math.hypot(dx, dy), flow: 0, mem: GHOST, dead: false });
    this.adj[a].push(i); this.adj[b].push(i); this.union(a, b);
    this.dirty = true; this.revision++;
    return i;
  }
  private find(i: number): number { while (this.uf[i] !== i) { this.uf[i] = this.uf[this.uf[i]]; i = this.uf[i]; } return i; }
  private union(a: number, b: number): void { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.uf[ra] = rb; }

  private nearVerts(x: number, y: number, r: number, skip: number): number[] {
    const out: number[] = [];
    const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = this.hash.get((cx + i) + ',' + (cy + j)); if (!a) continue;
      for (const v of a) {
        if (v === skip) continue;
        const dx = this.V[v].x - x, dy = this.V[v].y - y;
        if (dx * dx + dy * dy < r * r) out.push(v);
      }
    }
    return out;
  }
  /** Live degree of every vertex (ignores dead segments). */
  degrees(): number[] {
    const d = new Array<number>(this.V.length).fill(0);
    for (const e of this.E) if (!e.dead) { d[e.a]++; d[e.b]++; }
    return d;
  }

  /** How lit a host's nodule should read, 0..0.85. */
  memory(n: SimNode): number { const v = this.V[n.v]; return Math.min(0.85, (v ? v.mem : 0.05) * 1.5); }

  segCount(): number { let n = 0; for (const e of this.E) if (!e.dead) n++; return n; }

  private vdeg(i: number): number { let n = 0; for (const e of this.adj[i]) if (!this.E[e].dead) n++; return n; }
  private edgeBetween(a: number, b: number): number {
    const k = a * 100000 + b;
    let e = this.edgeCache.get(k);
    if (e === undefined) {
      e = -1;
      for (const ei of this.adj[a]) { const ee = this.E[ei]; if (!ee.dead && (ee.b === b || ee.a === b)) { e = ei; break; } }
      this.edgeCache.set(k, e);
    }
    return e;
  }

  // ── hosts: nodules the mat grows toward and from ─────────────────────────
  host(ip: string, label: string | undefined, t: number): SimNode {
    let n = this.nodes.get(ip);
    if (n) { if (label && n.label === n.id) n.label = label; return n; }
    const pos = this.place();
    const hue = (hash01(`hue|${ip}`) * 3) | 0;
    const v = this.addV(pos.x, pos.y, GHOST, hue);
    n = { id: ip, label: label ?? ip, x: pos.x, y: pos.y, v, born: t, pulse: 0, hue };
    this.nodes.set(ip, n);
    this.spawnTip(pos.x, pos.y, hash01(ip) * 6.283, v, v, true, hue);
    this.dirty = true; this.revision++;
    return n;
  }
  byId(id: string): SimNode | undefined { return this.nodes.get(id); }

  /** Golden-angle spiral + relaxation so nodules never overlap. */
  private place(): { x: number; y: number } {
    const i = this.nodes.size;
    const a = i * 2.399963 + hash01(`spiral${i}`) * 6.283;
    const r = 0.11 + 0.34 * Math.sqrt((i % 40) / 40);
    let x = this.w * (0.5 + Math.cos(a) * r * 1.2);
    let y = this.h * (0.52 + Math.sin(a) * r * 0.95);
    for (let k = 0; k < 10; k++) {
      let moved = false;
      for (const o of this.nodes.values()) {
        let dx = x - o.x, dy = y - o.y;
        let d = Math.hypot(dx, dy);
        const min = Math.min(this.w, this.h) * 0.13;
        if (d < min) {
          if (d < 1e-4) { dx = hash01(o.id) - 0.5; dy = 0.3; d = 0.01; }
          x += (dx / d) * (min - d) * 0.5; y += (dy / d) * (min - d) * 0.5; moved = true;
        }
      }
      if (!moved) break;
    }
    x = Math.min(this.w * 0.94, Math.max(this.w * 0.06, x));
    y = Math.min(this.h * 0.88, Math.max(this.h * 0.14, y));
    return { x, y };
  }

  touchNode(n: SimNode, amount: number): void {
    n.pulse = Math.max(n.pulse, 0.6 + amount * 0.4);
    const v = this.V[n.v];
    if (v) v.mem = Math.min(0.7, v.mem + amount * 0.05);
  }

  /** The busiest junction near a point — where fruiting bodies prefer to rise. */
  junctionNear(x: number, y: number, maxR: number): { x: number; y: number } | null {
    let best = -1, bestScore = -1;
    for (const vs of this.hash.values()) {
      for (const v of vs) {
        const d = this.vdeg(v);
        if (d < 3) continue;
        const p = this.V[v];
        const dd = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (dd > maxR * maxR || dd < 30 * 30) continue;
        const score = d * 2 + p.mem * 8 - Math.sqrt(dd) / 160;
        if (score > bestScore) { bestScore = score; best = v; }
      }
    }
    return best >= 0 ? { x: this.V[best].x, y: this.V[best].y } : null;
  }

  brightest(): SimNode | null {
    let best: SimNode | null = null;
    for (const n of this.nodes.values()) {
      if (!this.V[n.v]) continue;
      const m = this.memory(n) + n.pulse * 0.4;
      if (!best || m > this.memory(best) + best.pulse * 0.4) best = n;
    }
    return best;
  }

  // ── growth ────────────────────────────────────────────────────────────────
  private spawnTip(x: number, y: number, head: number, anchorV: number, homeV: number, force = false, hue = 1): void {
    if (this.tips.length > (force ? 90 : 40) * this.gscale || this.E.length >= this.maxSegs) return;
    this.tips.push({ x, y, head, curv: (hash01(`c${x}|${y}|${this.tips.length}`) - 0.5) * 0.32,
      vPrev: anchorV, age: 0, born: this.clock, homeV, seeking: true, hue, trail: [] });
  }

  private growTips(dt: number): void {
    for (let i = this.tips.length - 1; i >= 0; i--) {
      const t = this.tips[i]; t.age += dt;
      // hyphae grow in graceful arcs via a clamped curvature integrator;
      // chemotropism below adds real bends. Clamping is what keeps tips
      // from coiling into springs
      t.curv += (Math.random() - 0.5) * 2.5 * dt; if (t.curv > 0.16) t.curv = 0.16; if (t.curv < -0.16) t.curv = -0.16;
      // a filament may be gentle, but never dead straight — a long straight
      // reads as a laser, not growth
      if (t.curv > -0.05 && t.curv < 0.05) t.curv = 0.05 * (Math.random() < 0.5 ? -1 : 1);
      t.head += t.curv * 1.1 * dt;
      t.x += Math.cos(t.head) * TIP_SPEED * this.gscale * dt; t.y += Math.sin(t.head) * TIP_SPEED * this.gscale * dt;
      if (t.x < 4 || t.y < 4 || t.x > this.w - 4 || t.y > this.h - 4 || t.age > 35 / Math.sqrt(this.gscale)) { this.tips.splice(i, 1); continue; }
      t.trail.push(t.x, t.y); if (t.trail.length > 10) t.trail.splice(0, t.trail.length - 10);
      const pv = this.V[t.vPrev];
      if (Math.hypot(t.x - pv.x, t.y - pv.y) >= SEG_LEN) {
        if (this.E.length >= this.maxSegs) { this.tips.splice(i, 1); continue; }
        // anastomosis: fuse with a stranger NETWORK, or with one's own OLD
        // trail — the second is what closes loops and stops wandering tips
        // from spiraling forever; crossing one's recent trail just passes
        const myRoot = this.find(t.vPrev);
        const cand = this.nearVerts(t.x, t.y, FUSE_R, t.vPrev)
          .find(v => v !== t.vPrev && Math.hypot(this.V[v].x - pv.x, this.V[v].y - pv.y) > 2.2 * SEG_LEN
            && (this.find(v) !== myRoot || this.V[v].born < t.born - 14));
        if (cand !== undefined) {
          this.addE(t.vPrev, cand); this.V[cand].flow = Math.max(this.V[cand].flow, 0.5);
          this.flashes.push({ x: t.x, y: t.y, t: 0, life: 1.2, r: 14, c: [95, 240, 207] });
          this.tips.splice(i, 1); continue;
        }
        // scorch is wounded ground: tips do not re-enter it
        let burned = false;
        for (const s of this.scorchs) if (s.t < 14 && Math.hypot(t.x - s.x, t.y - s.y) < s.r * 1.1) { burned = true; break; }
        if (burned) { this.tips.splice(i, 1); continue; }
        const nv = this.addV(t.x, t.y, GHOST, t.hue); this.addE(t.vPrev, nv); t.vPrev = nv;
        // keep the last trail point so the drawn hair grows on continuously
        if (t.trail.length > 2) t.trail.splice(0, t.trail.length - 2); else t.trail.length = 0;
        if (Math.random() < 0.02 && t.age > 1) {
          this.spawnTip(t.x, t.y, t.head + (Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.7), t.vPrev, -1, false, t.hue);
        }
      }
    }
    // exploratory regrowth: from established junctions, and — critically —
    // from any host the mat has not reached yet, so no nodule stays an island
    this.tGrow -= dt;
    if (this.tGrow <= 0 && this.tips.length < 70 * this.gscale && this.E.length < this.maxSegs * 0.98) {
      this.tGrow = 0.8;
      const dormant = [...this.nodes.values()].filter(n => !this.tips.some(t => t.homeV === n.v));
      if (dormant.length && Math.random() < 0.6) {
        const n = dormant[(Math.random() * dormant.length) | 0];
        this.spawnTip(n.x, n.y, Math.random() * 6.283, n.v, n.v, true, n.hue);
      }
      const pool: number[] = [];
      for (let i = 0; i < this.V.length; i += 7) if (this.vdeg(i) >= 3) pool.push(i);
      if (pool.length) {
        const v = pool[(Math.random() * pool.length) | 0];
        this.spawnTip(this.V[v].x, this.V[v].y, Math.random() * 6.283, v, -1, false, this.V[v].hue);
      }
    }
  }

  // ── traffic: light walks existing paths ───────────────────────────────────
  private bestPath(a: number, b: number): number[] | null {
    const N = this.V.length;
    const dist = new Float64Array(N).fill(1e18), prev = new Int32Array(N).fill(-1);
    const heap: [number, number][] = [];
    const hpush = (d: number, v: number) => { heap.push([d, v]); let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const hpop = (): [number, number] => {
      const top = heap[0], last = heap.pop() as [number, number];
      if (heap.length) { heap[0] = last; let i = 0;
        for (;;) { const l = 2 * i + 1, r = 2 * i + 2; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top; };
    dist[a] = 0; hpush(0, a);
    while (heap.length) {
      const [d, u] = hpop();
      if (u === b) break;
      if (d > dist[u]) continue;
      for (const ei of this.adj[u]) {
        const e = this.E[ei]; if (e.dead) continue;
        const w = e.len / (0.3 + 0.7 * (e.mem * 0.8 + 0.2));   // habit: used paths run faster
        const v = e.a === u ? e.b : e.a;
        if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; hpush(d + w, v); }
      }
    }
    if (dist[b] > 1e17) return null;
    const path: number[] = [];
    for (let v = b; v !== -1; v = prev[v]) path.push(v);
    path.reverse(); return path;
  }

  /** Run nutrient light between two hosts along existing filaments.
   *  Returns false if the mat does not connect them yet — and sends an
   *  exploratory tip toward the far host so next time it will. */
  sendLight(a: SimNode, b: SimNode, col = 0x5ff0cf, quiet = false): boolean {
    if (a === b) return false;
    const p = this.bestPath(a.v, b.v);
    if (!p || p.length < 2) {
      if (!quiet && this.tReach <= 0) {
        // the network reaches out toward what it cannot yet feed — slowly,
        // one explorer at a time, or the loam fills with aimed straights
        this.tReach = 3;
        const head = Math.atan2(b.y - a.y, b.x - a.x) + (Math.random() - 0.5) * 0.8;
        this.spawnTip(a.x, a.y, head, a.v, a.v, false, this.V[a.v]?.hue ?? 1);
      }
      return false;
    }
    if (quiet) {
      for (let i = 1; i < p.length; i++) {
        const ei = this.edgeBetween(p[i - 1], p[i]);
        if (ei >= 0) this.E[ei].mem = Math.min(0.8, this.E[ei].mem + 0.015);
      }
      return true;
    }
    let len = 0;
    for (let i = 1; i < p.length; i++) {
      const ei = this.edgeBetween(p[i - 1], p[i]);
      if (ei >= 0) len += this.E[ei].len;
    }
    if (this.pulses.length < this.maxPulses) this.pulses.push({ p, s: 0, len, hx: a.x, hy: a.y, col });
    return true;
  }

  /** Light running out to the internet: toward a margin vertex on the remote's bearing. */
  sendLightOut(a: SimNode, extIp: string, col = 0xffdfae, quiet = false): boolean {
    const bearing = hash01(`bearing|${extIp}|${a.id}`) * 6.283;
    const myRoot = this.find(a.v);
    let best = -1, bd = -1;
    for (let k = 0; k < 30; k++) {
      const vi = (Math.random() * this.V.length) | 0;
      if (!this.V[vi] || this.vdeg(vi) === 0) continue;
      // only vertices the light can actually walk to — a margin vertex on a
      // stranger's network is not a road out of town
      if (this.find(vi) !== myRoot) continue;
      const d = Math.hypot(this.V[vi].x - a.x, this.V[vi].y - a.y);
      if (d < 120) continue;
      const va = Math.atan2(this.V[vi].y - a.y, this.V[vi].x - a.x);
      let da = Math.abs(va - bearing); if (da > Math.PI) da = 6.283 - da;
      if (da > 1.1) continue;
      const edgeBonus = (this.V[vi].x < 60 || this.V[vi].y < 60 || this.V[vi].x > this.w - 60 || this.V[vi].y > this.h - 60) ? 1.5 : 1;
      const score = d * edgeBonus - da * 200;
      if (score > bd) { bd = score; best = vi; }
    }
    if (best >= 0) {
      const p = this.bestPath(a.v, best);
      if (p && p.length > 1) {
        if (!quiet) {
          let len = 0;
          for (let i = 1; i < p.length; i++) { const ei = this.edgeBetween(p[i - 1], p[i]); if (ei >= 0) len += this.E[ei].len; }
          if (this.pulses.length < this.maxPulses) this.pulses.push({ p, s: 0, len, hx: a.x, hy: a.y, col });
        }
        return true;
      }
    }
    if (!quiet && this.tReach <= 0) { this.tReach = 3; this.spawnTip(a.x, a.y, bearing, a.v, a.v, false, this.V[a.v]?.hue ?? 1); }
    return false;
  }

  // ── fruiting, spores ──────────────────────────────────────────────────────
  fruit(x: number, y: number, label: string): void {
    for (const m of this.shrooms) if (m.label === label && Math.hypot(m.x - x, m.y - y) < 170) return;
    if (this.shrooms.length >= this.maxShrooms) {
      const old = this.shrooms.shift(); if (old) this.puff(old.x, old.y, 12);
    }
    this.shrooms.push({ x, y, t: 0, life: 24 + Math.random() * 16, lean: (Math.random() - 0.5) * 0.4,
      s: 0.5 + Math.random() * 0.22, label: label.toUpperCase().slice(0, 26) });
  }

  puff(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.spores.push({ x: x + (Math.random() - 0.5) * 8, y: y - 14,
        vx: (Math.random() - 0.5) * 28, vy: -8 - Math.random() * 18, t: 0, land: 3.5 + Math.random() * 3.5 });
    }
  }

  // ── hostility ─────────────────────────────────────────────────────────────
  scorch(x: number, y: number): void {
    const r = 22 + Math.random() * 14;
    this.scorchs.push({ x, y, r, t: 0 });
    for (let i = 0; i < this.E.length; i++) {
      const e = this.E[i]; if (e.dead) continue;
      const A = this.V[e.a], B = this.V[e.b];
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      if (Math.hypot(mx - x, my - y) < r * 0.75) { e.dead = true; this.deadE++; }
    }
    this.edgeCache.clear();
    this.dirty = true; this.revision++;
  }

  blight(target: SimNode): void {
    if (this.blights.length >= 3) return;
    const edge = (Math.random() * 4) | 0;
    this.blights.push({
      x: edge === 0 ? -40 : edge === 1 ? this.w + 40 : Math.random() * this.w,
      y: edge === 2 ? -40 : this.h + 40,
      tx: target.x, ty: target.y, t: 0, phase: 0, target: target.id,
    });
  }

  /** Live flare to the whole mat: the burn-off surge. */
  surge(amount: number): void {
    for (const e of this.E) if (!e.dead) e.flow = Math.max(e.flow, amount);
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  step(dt: number, halfMin: number): void {
    this.clock += dt;
    if (this.tReach > 0) this.tReach -= dt;
    this.growTips(dt);

    const fl = Math.exp(-dt * 2.6);
    const mm = Math.exp(-LN2 * dt / (Math.max(1, halfMin) * 60));
    for (const e of this.E) { e.flow *= fl; e.mem = Math.max(GHOST, e.mem * mm); }
    for (const v of this.V) v.flow *= fl;

    // pulses travel, lighting and reinforcing the filaments they pass
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.s += 300 * dt;
      let acc = 0;
      for (let k = 1; k < p.p.length; k++) {
        const ei = this.edgeBetween(p.p[k - 1], p.p[k]);
        if (ei < 0) continue;
        const e = this.E[ei];
        if (p.s >= acc && p.s < acc + e.len) {
          e.flow = 1; e.mem = Math.min(0.9, e.mem + 0.05);
          const f = (p.s - acc) / e.len;
          p.hx = this.V[e.a].x + (this.V[e.b].x - this.V[e.a].x) * f;
          p.hy = this.V[e.a].y + (this.V[e.b].y - this.V[e.a].y) * f;
        }
        acc += e.len;
      }
      if (p.s >= p.len) this.pulses.splice(i, 1);
    }

    // spores drift, settle, and seed new growth
    for (let i = this.spores.length - 1; i >= 0; i--) {
      const s = this.spores[i]; s.t += dt;
      s.vy += (s.t > s.land * 0.6 ? 10 : -4) * dt;
      s.vx *= 1 - dt * 0.6; s.vx += Math.sin(this.clock * 2 + s.y * 0.05) * 6 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.t > s.land) {
        this.spores.splice(i, 1);
        if (this.E.length < this.maxSegs * 0.96 && Math.random() < 0.7) {
          const hue = (hash01(`sh|${s.x}|${s.y}`) * 3) | 0;
          const v = this.addV(s.x, s.y, GHOST, hue);
          this.spawnTip(s.x, s.y, Math.random() * 6.283, v, -1, false, hue);
          this.flashes.push({ x: s.x, y: s.y, t: 0, life: 0.9, r: 10, c: [160, 255, 220] });
        }
      }
    }

    // mushrooms: grow, then puff spores at the end
    for (let i = this.shrooms.length - 1; i >= 0; i--) {
      const m = this.shrooms[i]; m.t += dt;
      if (m.t > m.life) { this.puff(m.x, m.y, 26); this.shrooms.splice(i, 1); }
    }

    for (let i = this.scorchs.length - 1; i >= 0; i--) { this.scorchs[i].t += dt; if (this.scorchs[i].t > 18) this.scorchs.splice(i, 1); }

    // blight: crawls in eating filaments, then the web burns it off
    for (let i = this.blights.length - 1; i >= 0; i--) {
      const b = this.blights[i]; b.t += dt;
      const tg = this.nodes.get(b.target);
      if (tg) { b.tx = tg.x; b.ty = tg.y; }
      b.x += (b.tx - b.x) * Math.min(1, dt * 0.55); b.y += (b.ty - b.y) * Math.min(1, dt * 0.55);
      for (let k = 0; k < this.E.length; k++) {
        const e = this.E[k]; if (e.dead) continue;
        if (Math.hypot(this.V[e.a].x - b.x, this.V[e.a].y - b.y) < 30) { e.dead = true; this.deadE++; }
      }
      if (b.t > 7.4 && b.phase === 0) {
        b.phase = 1;
        this.surge(0.5);
        this.flashes.push({ x: b.x, y: b.y, t: 0, life: 1.4, r: 190, c: [200, 255, 240] });
        // the network answers: pulses radiate from the gateway
        const gw = this.nodes.values().next().value;
        if (gw) for (let k = 0; k < 5; k++) {
          const pick = [...this.nodes.values()][(Math.random() * this.nodes.size) | 0];
          if (pick) this.sendLight(gw, pick);
        }
      }
      if (b.phase && b.t > 9) this.blights.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].t += dt; if (this.flashes[i].t > this.flashes[i].life) this.flashes.splice(i, 1); }

    for (const n of this.nodes.values()) n.pulse = Math.max(0, n.pulse - dt * 3.2);

    // slow pruning of forgotten filaments keeps the mat breathing
    this.tPrune -= dt;
    if (this.tPrune <= 0) {
      this.tPrune = 14;
      let n = 0;
      for (const e of this.E) {
        if (!e.dead && e.mem < GHOST + 1e-3 && this.E.length > this.maxSegs * 0.9 &&
            this.clock - this.V[e.a].born > 60 && n < 300) { e.dead = true; this.deadE++; n++; }
      }
      if (n) { this.edgeCache.clear(); this.dirty = true; this.revision++; }
    }
    if (this.deadE > 280) this.compact();
    // dormant unlinked hosts drift off
    if (this.nodes.size > this.maxNodes) this.evictNodes();
  }

  private evictNodes(): void {
    while (this.nodes.size > this.maxNodes * 1.15) {
      let worst: SimNode | null = null;
      for (const n of this.nodes.values()) {
        if (n.id === 'gateway' || n.id === '192.168.1.1') continue;
        if (!worst || this.memory(n) < this.memory(worst)) worst = n;
      }
      if (!worst) break;
      for (const ei of this.adj[worst.v]) this.E[ei].dead = true;
      this.nodes.delete(worst.id);
      this.edgeCache.clear(); this.dirty = true; this.revision++;
      break;
    }
  }

  /** Rebuild without dead weight: vertices renumbered, edges re-pointed. */
  private compact(): void {
    const map = new Int32Array(this.V.length).fill(-1);
    const nV: Vtx[] = [], nAdj: number[][] = [], nE: Seg[] = [];
    const keep = (i: number): number => {
      if (map[i] >= 0) return map[i];
      if (!this.adj[i].some(ei => !this.E[ei].dead)) return -1;
      map[i] = nV.length; nV.push(this.V[i]); nAdj.push([]);
      return map[i];
    };
    for (const e of this.E) {
      if (e.dead) continue;
      const a = keep(e.a), b = keep(e.b);
      if (a < 0 || b < 0 || a === b) continue;
      nE.push({ a, b, len: e.len, flow: e.flow, mem: e.mem, dead: false });
      const k = nE.length - 1; nAdj[a].push(k); nAdj[b].push(k);
    }
    for (const n of this.nodes.values()) {
      const nv = map[n.v];
      if (nv >= 0) { n.v = nv; continue; }
      // a host whose last filament died: re-seed its nodule vertex so the
      // mat can grow out again
      map[n.v] = nV.length;
      nV.push(this.V[n.v]); nAdj.push([]);
      n.v = nV.length - 1;
    }
    for (let i = this.tips.length - 1; i >= 0; i--) {
      const tip = this.tips[i];
      const nv = map[tip.vPrev];
      if (nv >= 0) tip.vPrev = nv; else { this.tips.splice(i, 1); continue; }
      const hv = map[tip.homeV]; tip.homeV = hv >= 0 ? hv : -1;
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const np = this.pulses[i].p.map(v => map[v]);
      if (np.includes(-1)) { this.pulses.splice(i, 1); continue; }
      this.pulses[i].p = np;
    }
    this.V = nV; this.adj = nAdj; this.E = nE; this.deadE = 0;
    this.edgeCache.clear();
    this.uf = new Array(nV.length); for (let i = 0; i < nV.length; i++) this.uf[i] = i;
    for (const e of this.E) this.union(e.a, e.b);
    this.hash = new Map();
    for (let i = 0; i < this.V.length; i++) this.hashPush(this.key(this.V[i].x, this.V[i].y), i);
    this.dirty = true; this.revision++;
  }

  // ── persistence: the mat you left is the mat you return to ───────────────
  snapshot(): void {
    if (!this.dirty) return;
    try {
      const nodes = [...this.nodes.values()].map(n => [n.id, n.label, Math.round(n.x), Math.round(n.y)]);
      const verts = this.V.map(v => [Math.round(v.x * 2) / 2, Math.round(v.y * 2) / 2, Math.round(v.mem * 100) / 100, v.hue]);
      const edges = this.E.filter(e => !e.dead).map(e => [e.a, e.b, Math.round(e.mem * 100) / 100]);
      localStorage.setItem(STORE, JSON.stringify({ v: 2, t: Date.now() / 1000, w: this.w, h: this.h, nodes, verts, edges }));
      this.dirty = false;
    } catch { /* private window or quota: the garden just won't persist */ }
  }

  tick(nowSec: number): void {
    if (this.dirty && nowSec >= this.saveAt) { this.saveAt = nowSec + 20; this.snapshot(); }
  }

  restore(halfMin: number): boolean {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const d = JSON.parse(raw) as { v: number; t: number; w: number; h: number;
        nodes: [string, string, number, number][]; verts: [number, number, number, number][]; edges: [number, number, number][] };
      if (d.v !== 3 || !Array.isArray(d.verts) || !Array.isArray(d.edges)) return false;
      // restore only if the saved world roughly matches this screen
      if (Math.abs(d.w - this.w) > this.w * 0.25 || Math.abs(d.h - this.h) > this.h * 0.25) return false;
      const k = Math.exp(-LN2 * Math.min(30 * 86400, Date.now() / 1000 - d.t) / (Math.max(1, halfMin) * 60));
      const mem = (m: number) => GHOST + (Math.max(GHOST, m) - GHOST) * k;
      for (const [x, y, m, h] of d.verts) this.addV(x, y, mem(m), h ?? 1);
      for (const [a, b, m] of d.edges) {
        if (a < 0 || b < 0 || a >= this.V.length || b >= this.V.length) continue;
        const ei = this.addE(a, b); this.E[ei].mem = mem(m);
      }
      const nearest = (x: number, y: number): number => {
        let best = 0, bd = 1e18;
        for (let i = 0; i < this.V.length; i++) {
          const dx = this.V[i].x - x, dy = this.V[i].y - y, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = i; }
        }
        return best;
      };
      for (const [id, label, x, y] of d.nodes) {
        if (this.nodes.has(id) || typeof id !== 'string') continue;
        const v = nearest(x, y);
        this.nodes.set(id, { id, label: label || id, x: this.V[v].x, y: this.V[v].y, v, born: 0, pulse: 0,
          hue: (hash01(`hue|${id}`) * 3) | 0 });
      }
      this.dirty = true; this.revision++;
      return true;
    } catch { return false; }
  }
}
