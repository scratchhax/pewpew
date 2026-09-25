import { hash01 } from '../../state';

/**
 * The garden itself: who is growing where, how strongly, and what the web
 * remembers. Pure data — the view draws it, index.ts feeds it events, and
 * persistence lets the whole thing survive reloads so the garden grows over
 * days. Positions are normalised (0..1) so the map rides any window size.
 */

export interface MNode {
  id: string;            // internal IP
  label: string;         // hostname if DHCP ever named it, else the IP
  nx: number; ny: number;
  w: number;             // activity 0..1 (decays toward dormant)
  born: number;          // sim seconds
  pulse: number;         // recent-event flash, decays fast, drawn by the view
}

export interface MEdge {
  a: string;             // node id
  b: string;             // node id, or '' for an outward tendril
  w: number;             // thickness 0..1 (decays: neglect thins the web)
  bend: number;          // -1..1 organic curve offset (stable per edge)
  out: number;           // tendril heading (radians) when b === ''
}

export const pairKey = (a: string, b: string): string => (a <= b ? `${a}|${b}` : `${b}|${a}`);
export const stubKey = (a: string, out: number): string => `>${a}|${out.toFixed(3)}`;

const STORE = 'pewpew.mycelium.v1';
const LN2 = Math.log(2);

export class Garden {
  nodes = new Map<string, MNode>();
  edges = new Map<string, MEdge>();
  /** Bumped on any topology change so the view knows to redraw the hyphae. */
  revision = 0;
  private saveAt = 0;
  private dirty = false;
  private w = 1; private h = 1;

  setSize(w: number, h: number): void {
    const sx = w / this.w, sy = h / this.h;
    this.w = w; this.h = h;
    void sx; void sy;   // positions are normalised: nothing to rescale
  }

  /** A node for an internal IP, sprouting where it belongs. */
  node(id: string, label?: string, t = 0): MNode {
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, label: label ?? id, nx: 0, ny: 0, w: 0.08, born: t, pulse: 0 };
      this.place(n);
      this.nodes.set(id, n);
      this.dirty = true; this.revision++;
    } else if (label && label !== n.id && n.label === n.id) {
      n.label = label; this.dirty = true;   // DHCP named it — upgrade the label
    }
    return n;
  }

  /** Grow a hypha between two hosts, or boost it: traffic feeds the web. */
  boost(a: MNode, b: MNode, amount: number): MEdge {
    const key = pairKey(a.id, b.id);
    let e = this.edges.get(key);
    if (!e) {
      e = { a: a.id, b: b.id, w: 0, bend: hash01(key) * 2 - 1, out: 0 };
      this.edges.set(key, e);
      this.revision++;
    }
    e.w = Math.min(1, e.w + amount);
    this.dirty = true;
    return e;
  }

  /** An outward tendril: a host talking to the world beyond the clearing. */
  tendril(a: MNode, extIp: string | null, amount: number): MEdge {
    const out = this.stubAngle(a, extIp ?? '0.0.0.0');
    const key = stubKey(a.id, out);
    let e = this.edges.get(key);
    if (!e) {
      e = { a: a.id, b: '', w: 0, bend: hash01(key) * 2 - 1, out };
      this.edges.set(key, e);
      this.revision++;
    }
    e.w = Math.min(1, e.w + amount);
    this.dirty = true;
    return e;
  }

  /** Tendrils leave the node pointing away from the clearing's centre. */
  private stubAngle(n: MNode, extIp: string): number {
    const dx = n.nx - 0.5, dy = n.ny - 0.5;
    const away = Math.hypot(dx, dy) > 0.05 ? Math.atan2(dy, dx) : hash01(extIp) * Math.PI * 2;
    return away + (hash01(`${extIp}|${n.id}`) - 0.5) * 1.6;
  }

  /** Where the web sits: new hosts settle beside their partners, else spiral. */
  private place(n: MNode): void {
    let px = 0, py = 0, cnt = 0;
    for (const e of this.edges.values()) {
      if (e.b === '') continue;
      const other = e.a === n.id ? this.nodes.get(e.b) : e.b === n.id ? this.nodes.get(e.a) : null;
      if (other) { px += other.nx; py += other.ny; cnt++; }
    }
    if (cnt > 0) {
      const jit = hash01(n.id + '@') * Math.PI * 2;
      const r = 0.09 + hash01(n.id + '#') * 0.10;
      n.nx = clamp01(px / cnt + Math.cos(jit) * r * 1.3);
      n.ny = clamp01(py / cnt + Math.sin(jit) * r);
    } else {
      // golden-angle spiral: even, organic, no clustering at the centre
      const i = this.nodes.size;
      const a = i * 2.399963 + hash01(n.id) * 6.28;
      const r = 0.10 + 0.36 * Math.sqrt((i % 34) / 34);
      n.nx = clamp01(0.5 + Math.cos(a) * r * 1.15);
      n.ny = clamp01(0.5 + Math.sin(a) * r * 0.92);
    }
    this.separate(n);
  }

  /** Never let two nodules overlap: a few relaxation pushes. */
  private separate(n: MNode): void {
    const asp = this.w / Math.max(1, this.h);
    for (let k = 0; k < 8; k++) {
      let moved = false;
      for (const o of this.nodes.values()) {
        if (o === n) continue;
        let dx = (n.nx - o.nx) * asp, dy = n.ny - o.ny;
        let d = Math.hypot(dx, dy);
        const min = 0.085;
        if (d < min) {
          if (d < 1e-4) { dx = hash01(o.id + n.id) - 0.5; dy = hash01(n.id + o.id) - 0.5; d = 0.01; }
          const push = (min - d) * 0.5;
          n.nx = clamp01(n.nx + (dx / d) * push / asp);
          n.ny = clamp01(n.ny + (dy / d) * push);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Feed activity: the node lights up, its recent events flash. */
  touch(n: MNode, amount = 0.35): void {
    n.w = Math.min(1, Math.max(n.w, 0.12) + amount * 0.25);
    n.pulse = 1;
  }

  /** Neglect is the paintbrush: everything slowly thins toward dormancy. */
  decay(dt: number, halfDays: number): void {
    const k = Math.exp(-LN2 * dt / (Math.max(0.5, halfDays) * 86400));
    for (const e of this.edges.values()) {
      e.w *= k;
      if (e.w < 0.004) { this.edges.delete(this.edgeKeyOf(e)); this.dirty = true; this.revision++; }
    }
    const nk = Math.exp(-LN2 * dt / (Math.max(0.5, halfDays) * 86400 * 1.6));
    for (const n of this.nodes.values()) {
      n.w *= nk;
      n.pulse = Math.max(0, n.pulse - dt * 1.4);
    }
    // trim to budget: evict the frailest hyphae, then the most dormant hosts
    if (this.edges.size > this.maxEdges) this.evictEdges();
    if (this.nodes.size > this.maxNodes) this.evictNodes();
  }

  maxNodes = 40;
  maxEdges = 220;

  private evictEdges(): void {
    const over = this.edges.size - this.maxEdges;
    const dead: string[] = [];
    let worst = this.frail();
    for (let i = 0; i < over && worst; i++) {
      dead.push(this.edgeKeyOf(worst));
      worst = this.frail();
    }
    for (const k of dead) { this.edges.delete(k); this.dirty = true; this.revision++; }
  }
  private frail(): MEdge | null {
    let best: MEdge | null = null;
    for (const e of this.edges.values()) if (!best || e.w < best.w) best = e;
    return best;
  }
  private evictNodes(): void {
    while (this.nodes.size > this.maxNodes * 1.4) {
      let worst: MNode | null = null;
      for (const n of this.nodes.values()) {
        // dormant and unconnected: this host is gone from the world
        let linked = false;
        for (const e of this.edges.values()) {
          if (e.a === n.id || e.b === n.id) { linked = true; break; }
        }
        if (!linked && (!worst || n.w < worst.w)) worst = n;
      }
      if (!worst || worst.w > 0.02) break;
      for (const e of [...this.edges.values()]) {
        if (e.a === worst.id || e.b === worst.id) this.edges.delete(this.edgeKeyOf(e));
      }
      this.nodes.delete(worst.id);
      this.dirty = true; this.revision++;
    }
  }
  private edgeKeyOf(e: MEdge): string {
    return e.b === '' ? stubKey(e.a, e.out) : pairKey(e.a, e.b);
  }

  /** A saved snapshot, oldest-forgotten; every node has a label and a place. */
  snapshot(): void {
    if (!this.dirty) return;
    try {
      const nodes = [...this.nodes.values()]
        .sort((a, b) => b.w - a.w).slice(0, 80)
        .map((n) => [n.id, n.label, round4(n.nx), round4(n.ny), round4(n.w)]);
      const edges = [...this.edges.values()]
        .sort((a, b) => b.w - a.w).slice(0, 300)
        .map((e) => [e.a, e.b, round4(e.w), round4(e.bend), round4(e.out)]);
      localStorage.setItem(STORE, JSON.stringify({ v: 1, t: Date.now() / 1000, nodes, edges }));
      this.dirty = false;
    } catch { /* private window or full quota: the garden just won't persist */ }
  }

  /** Throttled save: the garden outlives reloads without hammering storage. */
  tick(nowSec: number): void {
    if (nowSec < this.saveAt || this.dirty) {
      if (nowSec >= this.saveAt) { this.saveAt = nowSec + 20; this.snapshot(); }
    }
  }

  restore(halfDays: number): boolean {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const d = JSON.parse(raw) as { v: number; t: number; nodes: unknown[][]; edges: unknown[][] };
      if (d.v !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) return false;
      const k = Math.exp(-LN2 * Math.min(30 * 86400, Date.now() / 1000 - d.t) / (Math.max(0.5, halfDays) * 86400));
      for (const r of d.nodes) {
        const [id, label, nx, ny, w] = r as [string, string, number, number, number];
        if (typeof id !== 'string' || typeof nx !== 'number') continue;
        const n = this.nodes.get(id);
        if (n) { n.w = Math.max(n.w, w * k); continue; }
        this.nodes.set(id, { id, label: label || id, nx: clamp01(nx), ny: clamp01(ny), w: w * k, born: 0, pulse: 0 });
      }
      for (const r of d.edges) {
        const [a, b, w, bend, out] = r as [string, string, number, number, number];
        if (typeof a !== 'string' || typeof b !== 'string') continue;
        if (b === '' && !this.stubAngleOk(a)) continue;
        if (!this.nodes.has(a)) continue;
        if (b !== '' && !this.nodes.has(b)) continue;
        const key = b === '' ? stubKey(a, out) : pairKey(a, b);
        if (this.edges.has(key)) continue;
        this.edges.set(key, { a, b, w: w * k, bend, out });
      }
      this.dirty = true; this.revision++;
      return true;
    } catch { return false; }
  }
  private stubAngleOk(a: string): boolean { return this.nodes.has(a); }
}

const clamp01 = (v: number): number => v < 0 ? 0 : v > 1 ? 1 : v;
const round4 = (v: number): number => Math.round(v * 10000) / 10000;
