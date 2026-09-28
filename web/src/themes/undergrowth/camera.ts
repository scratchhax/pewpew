import { Matrix4, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Sim } from '../mycelium/filaments';
import { elev, lift, S } from './web3d';

/**
 * The autopilot: a slow ride through the mat. It keeps a chain of vertices
 * (a "route"), travels it at the user's speed, and at every junction chooses
 * the next filament by what it carries — memory and fresh flow — with a nudge
 * to keep heading and a drift toward whatever just happened (a bloom, a
 * blight). Dead ends re-root the route. An empty mat gets a slow orbit.
 */
export class Flycam {
  readonly pos = new Vector3();
  readonly quat = new Quaternion();

  private path: number[] = [];
  private cum: number[] = [0];
  private dist = 0;
  private prevV = -1;
  private speed = 12;
  private curSpeed = 0;
  private focusV = -1;
  private focusUntil = 0;
  private orbitT = 0;
  private lastDir = new Vector3(0, 0, -1);
  private up = new Vector3(0, 1, 0);
  private m4 = new Matrix4();
  private qLook = new Quaternion();
  private qPrev = new Quaternion();
  private qNeg = new Quaternion();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private bank = 0;

  constructor(private sim: Sim, private cam: PerspectiveCamera, start = new Vector3(0, 0, 0)) {
    this.pos.copy(start);
  }

  setSpeed(v: number): void { this.speed = v; }

  /** The speed the camera is actually going right now (for the diag overlay). */
  get speedNow(): number { return this.curSpeed; }

  /** Drift toward a mat vertex (a fresh bloom, a blight) for ~8 s. */
  setFocus(v: number, t: number): void {
    this.focusV = v;
    this.focusUntil = t + 8;
  }

  /** Drift toward a loam point in sim px (the public face of setFocus). */
  focusAt(x: number, y: number, t: number): void {
    const v = this.nearestV(lift(x, y, this.tmp2).clone());
    if (v >= 0) this.setFocus(v, t);
  }

  /** Jump to a loam point in sim px and re-root the route here (diag flyTo). */
  teleport(x: number, y: number): void {
    lift(x, y, this.pos);
    this.pos.y += 4;
    this.newRoute(0);
  }

  // ── routing ───────────────────────────────────────────────────────────────
  private nearestV(p: Vector3): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.sim.V.length; i++) {
      const v = this.sim.V[i];
      this.tmp.set(v.x * S, elev(v.x, v.y), v.y * S);
      const d = distSq(this.tmp, p);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private edgeBetween(a: number, b: number): number {
    for (const ei of this.sim.adj[a]) {
      const e = this.sim.E[ei];
      if (!e.dead && (e.a === b || e.b === b)) return ei;
    }
    return -1;
  }

  /** Choose the next vertex from `v` (avoiding `avoid`), by what the filament carries. */
  private chooseNext(v: number, avoid: number, t: number): number {
    const opts = this.sim.adj[v];
    if (!opts.length) return -1;
    for (const pass of [0, 1]) {
      let best = -1, bestW = -1;
      for (const ei of opts) {
        const e = this.sim.E[ei];
        if (e.dead) continue;
        const next = e.a === v ? e.b : e.a;
        if (pass === 0 ? next === avoid : next !== avoid) continue;
        let w = e.mem + 2 * e.flow + 0.15 * Math.random();
        const nv = this.sim.V[next];
        this.tmp.set(nv.x * S, elev(nv.x, nv.y), nv.y * S).sub(this.pos).normalize();
        if (this.tmp.dot(this.lastDir) > 0) w *= 1.5;
        if (this.focusUntil > t && next === this.focusV) w *= 3.2;
        if (w > bestW) { bestW = w; best = next; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Grow the route from its current end. */
  private extendRoute(t: number): void {
    let guard = 0;
    while (this.cum[this.cum.length - 1] - this.dist < 240 && guard++ < 400) {
      const v = this.path[this.path.length - 1];
      const next = this.chooseNext(v, this.prevV, t);
      if (next < 0) return;
      const e = this.sim.E[this.edgeBetween(v, next)];
      if (!e) return;
      this.path.push(next);
      this.cum.push(this.cum[this.cum.length - 1] + e.len * S);
      this.prevV = v;
      if (this.path.length > 600) break;
    }
  }

  /** (Re)start a route from the nearest vertex to the camera. */
  private newRoute(t: number): void {
    this.path = [];
    this.cum = [0];
    this.dist = 0;
    this.prevV = -1;
    const v = this.nearestV(this.pos);
    if (v < 0) return;
    this.path.push(v);
    this.extendRoute(t);
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  update(dt: number, t: number, wanderX: number, wanderY: number): void {
    const sim = this.sim;
    if (sim.V.length < 2) { this.orbit(dt); return; }

    if (this.path.length < 2) this.newRoute(t);
    let total = this.cum[this.cum.length - 1];
    if (total <= 0) { this.orbit(dt); return; }

    if (total - this.dist < 240) {
      this.extendRoute(t);
      total = this.cum[this.cum.length - 1];
    }
    // the route ran out at a dead end: re-root from here
    if (this.dist >= total - 0.01 && this.cum.length < 4) {
      this.newRoute(t);
      return;
    }

    // advance
    this.curSpeed += (this.speed - this.curSpeed) * Math.min(1, dt * 1.2);
    this.dist += this.curSpeed * dt;

    const p = this.pointAt(this.dist);
    if (!p) { this.newRoute(t); return; }
    const ahead = this.pointAt(Math.min(total, this.dist + 18));
    if (!ahead) { this.newRoute(t); return; }

    // breathing sway + the anti-burn-in wander
    this.orbitT += dt;
    p.x += Math.sin(this.orbitT * 0.9) * 0.15 + wanderX * 0.002;
    p.y += Math.sin(this.orbitT * 0.63 + 1.3) * 0.12 + wanderY * 0.002;
    p.z += Math.cos(this.orbitT * 0.77 + 0.4) * 0.15;
    this.pos.copy(p);

    // orientation: look along the path ahead, eased; bank into turns
    this.tmp2.copy(ahead).sub(this.pos);
    if (this.tmp2.lengthSq() < 1e-4) this.tmp2.copy(this.lastDir);
    this.m4.lookAt(this.pos, this.tmp2.add(this.pos), this.up);
    this.qLook.setFromRotationMatrix(this.m4);
    this.slerpTo(this.qLook, Math.min(1, dt * 2.6));

    const rate = dt > 0 ? this.quat.angleTo(this.qPrev) / dt : 0;
    this.bank += (Math.max(-0.12, Math.min(0.12, rate * 0.25)) - this.bank) * Math.min(1, dt * 3);
    this.qPrev.copy(this.quat);
    if (Math.abs(this.bank) > 1e-4) {
      this.tmp.set(0, 0, -1).applyQuaternion(this.quat);
      this.qNeg.setFromAxisAngle(this.tmp, this.bank);
      this.quat.premultiply(this.qNeg);
    }

    this.lastDir.copy(this.tmp2.copy(ahead).sub(this.pos).normalize());
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }

  /** Slerp toward `q`, always via the short arc (negate if the dot says long way). */
  private slerpTo(q: Quaternion, k: number): void {
    if (this.quat.dot(q) < 0) {
      this.qNeg.set(-q.x, -q.y, -q.z, -q.w);
      this.quat.slerpQuaternions(this.quat, this.qNeg, k);
    } else {
      this.quat.slerpQuaternions(this.quat, q, k);
    }
  }

  private pointAt(d: number): Vector3 | null {
    const c = this.cum, p = this.path;
    if (d < 0 || d > c[c.length - 1] || p.length < 2) return null;
    let k = 1;
    while (k < c.length && c[k] < d) k++;
    if (k >= c.length) return null;
    const segLen = c[k] - c[k - 1];
    const f = segLen > 0 ? (d - c[k - 1]) / segLen : 0;
    const a = this.sim.V[p[k - 1]], b = this.sim.V[p[k]];
    if (!a || !b) return null;
    return lift(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, this.tmp2).clone();
  }

  private orbit(dt: number): void {
    // no mat yet: a slow circle over the loam's centre
    this.orbitT += dt;
    const cx = 48, cz = 27; // a 1920×1080 mat's centre in world units
    const r = 40;
    this.pos.set(cx + Math.cos(this.orbitT * 0.1) * r, 6 + Math.sin(this.orbitT * 0.07) * 2, cz + Math.sin(this.orbitT * 0.1) * r);
    this.tmp2.set(cx, 0, cz);
    this.m4.lookAt(this.pos, this.tmp2, this.up);
    this.qLook.setFromRotationMatrix(this.m4);
    this.slerpTo(this.qLook, Math.min(1, dt * 1.2));
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }
}

function distSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
