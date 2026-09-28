import { Matrix4, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Sim } from '../mycelium/filaments';
import { lift, R, S } from './web3d';

/** Max heading change per second: big retargets become slow pans, not snaps. */
const TURN_RATE = (26 * Math.PI) / 180;

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
  /** The last 18 route vertices — revisiting one sooner than that makes a tight loop that whips the heading. */
  private recent = new Set<number>();
  private recentQueue: number[] = [];
  /** Consecutive backtracks — two in a row means the walk is trapped in a tangle (a 2-vertex metronome). */
  private uturns = 0;
  private speed = 5;
  private curSpeed = 0;
  private focusV = -1;
  private focusUntil = 0;
  private orbitT = 0;
  private lastDir = new Vector3(0, 0, -1);
  /** Relocation: the vertex we're gliding to when the local component is exhausted. */
  private travel = -1;
  private travelTarget = new Vector3();
  private travelFrom = new Vector3(0, 1, 0);
  private travelF = 0;
  private lastRelocateT = -1000;
  /** Every 45 s the ride drifts toward wherever the mat is busiest. */
  private nextDriftT = 45;
  /** The route's start vertex, in world space — if it moves, the sim renumbered its vertices and the route is stale. */
  private routeAnchor = new Vector3(1e9, 0, 0);
  private up = new Vector3(0, 1, 0);
  private m4 = new Matrix4();
  private qLook = new Quaternion();
  private qNeg = new Quaternion();
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(private sim: Sim, private cam: PerspectiveCamera, start = new Vector3(0, 0, 0)) {
    this.pos.copy(start);
  }

  setSpeed(v: number): void { this.speed = v; }

  /** The speed the camera is actually going right now (for the diag overlay). */
  get speedNow(): number { return this.curSpeed; }

  /** Route state (for the diag overlay). */
  get routeInfo(): { route: number; total: number; dist: number; travel: number } {
    return { route: this.path.length, total: this.cum[this.cum.length - 1], dist: this.dist, travel: this.travel };
  }

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
    this.travel = -1;
    lift(x, y, this.pos);
    this.pos.y += 4;
    this.newRoute(0);
  }

  // ── routing ───────────────────────────────────────────────────────────────
  private nearestV(p: Vector3): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.sim.V.length; i++) {
      const v = this.sim.V[i];
      lift(v.x, v.y, this.tmp);
      const d = distSq(this.tmp, p);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private edgeBetween(a: number, b: number): number {
    const adj = this.sim.adj[a];
    if (!adj) return -1;
    for (const ei of adj) {
      const e = this.sim.E[ei];
      if (!e) continue;
      if (!e.dead && (e.a === b || e.b === b)) return ei;
    }
    return -1;
  }

  private addRecent(v: number): void {
    if (this.recentQueue.length >= 18) this.recent.delete(this.recentQueue.shift()!);
    this.recent.add(v);
    this.recentQueue.push(v);
  }

  /** Choose the next vertex from `v` (never one used in the last 18 steps), by what the filament carries. When everything fresh is blocked, backtrack to where we came from — a controlled U-turn at a dead end keeps the walk (and the ride) alive. */
  private chooseNext(v: number, t: number): number {
    const opts = this.sim.adj[v];
    if (!opts?.length) return -1;
    let best = -1, bestW = -1;
    for (const ei of opts) {
      const e = this.sim.E[ei];
      if (e.dead) continue;
      const next = e.a === v ? e.b : e.a;
      if (this.recent.has(next)) continue;
      let w = e.mem + 2 * e.flow + 0.15 * Math.random();
      const nv = this.sim.V[next];
      lift(nv.x, nv.y, this.tmp).sub(this.pos).normalize();
      // persistence: strongly prefer continuing the way we're already heading,
      // so the ride turns like a forager, not a drunk
      w *= 1 + 2.5 * Math.max(0, this.tmp.dot(this.lastDir));
      if (this.focusUntil > t && next === this.focusV) w *= 3.2;
      if (w > bestW) { bestW = w; best = next; }
    }
    if (best >= 0) { this.uturns = 0; return best; }
    const prev = this.recentQueue[this.recentQueue.length - 2];
    if (prev === undefined) return -1;
    if (this.edgeBetween(v, prev) < 0) return -1;
    if (++this.uturns >= 2) return -1; // trapped — let the ride relocate instead of oscillating
    return prev;
  }

  /** Grow the route from its current end. Returns true when the component is exhausted (every neighbour already visited). */
  private extendRoute(t: number): boolean {
    let guard = 0;
    while (this.cum[this.cum.length - 1] - this.dist < 240 && guard++ < 400) {
      const v = this.path[this.path.length - 1];
      const next = this.chooseNext(v, t);
      if (next < 0) return true;
      const e = this.sim.E[this.edgeBetween(v, next)];
      if (!e) return true;
      this.path.push(next);
      this.addRecent(next);
      this.cum.push(this.cum[this.cum.length - 1] + e.len * S);
    }
    return false;
  }

  /** (Re)start a route from the nearest vertex to the camera. */
  private newRoute(t: number): void {
    this.path = [];
    this.cum = [0];
    this.dist = 0;
    this.recent.clear();
    this.recentQueue = [];
    this.uturns = 0;
    const v = this.nearestV(this.pos);
    if (v < 0) return;
    this.path.push(v);
    this.addRecent(v);
    this.extendRoute(t);
    const a = this.sim.V[this.path[0]];
    if (a) lift(a.x, a.y, this.routeAnchor);
  }

  /** The top `k` components by size (then activity), with their busiest vertex. */
  private bestComps(k: number): { v: number; size: number; act: number }[] {
    const sim = this.sim;
    const n = sim.V.length;
    if (!n) return [];
    const seen = new Uint8Array(n);
    const out: { v: number; size: number; act: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      let size = 0, act = 0, bestIn = i, bestInAct = -1;
      while (stack.length) {
        const v = stack.pop()!;
        size++;
        let va = 0;
        for (const ei of sim.adj[v]) {
          const e = sim.E[ei];
          if (e.dead) continue;
          va += e.flow + e.mem;
          act += e.flow + e.mem;
          const o = e.a === v ? e.b : e.a;
          if (!seen[o]) { seen[o] = 1; stack.push(o); }
        }
        if (va > bestInAct) { bestInAct = va; bestIn = v; }
      }
      out.push({ v: bestIn, size, act });
    }
    out.sort((a, b) => b.size - a.size || b.act - a.act);
    return out.slice(0, k);
  }

  /** Glide to an active patch — the busiest one that's actually somewhere else (the cooldown keeps this from ping-ponging). */
  private relocate(t: number): boolean {
    if (t - this.lastRelocateT < 2) return false;
    const comps = this.bestComps(3).slice().sort((a, b) => b.act - a.act);
    for (const c of comps) {
      if (c.size < 20) continue;
      const tv = this.sim.V[c.v];
      if (!tv) continue;
      lift(tv.x, tv.y, this.travelTarget);
      if (this.travelTarget.distanceTo(this.pos) < 8) continue;
      this.lastRelocateT = t;
      this.startTravel();
      this.travel = c.v;
      return true;
    }
    return false;
  }

  private startTravel(): void {
    this.travelF = 0;
    // the glide arcs between the two shell directions at a fixed radius, so it
    // never cuts through the hollow core
    if (this.pos.lengthSq() < 1e-4) this.travelFrom.set(0, 1, 0);
    else this.travelFrom.copy(this.pos).normalize();
  }

  /** Glide to the relocation target along a shell arc, then settle back onto the web. */
  private doTravel(dt: number, t: number): void {
    const d = this.travelTarget.distanceTo(this.pos);
    if (d < 0.5 || this.travelF >= 1) {
      this.pos.copy(this.travelTarget);
      this.travel = -1;
      this.newRoute(t);
      this.cam.position.copy(this.pos);
      return;
    }
    this.curSpeed += (this.speed * 1.6 - this.curSpeed) * Math.min(1, dt * 2);
    const dir1 = this.tmp.copy(this.travelTarget).normalize();
    const angle = this.travelFrom.angleTo(dir1);
    const arcLen = Math.max(1e-3, angle * 0.85 * R);
    this.travelF = Math.min(1, this.travelF + (this.curSpeed * dt) / arcLen);
    const s = Math.sin(angle);
    const w0 = s > 1e-4 ? Math.sin((1 - this.travelF) * angle) / s : 1 - this.travelF;
    const w1 = s > 1e-4 ? Math.sin(this.travelF * angle) / s : this.travelF;
    this.tmp2.copy(this.travelFrom).multiplyScalar(w0).addScaledVector(dir1, w1).normalize().multiplyScalar(0.85 * R);
    this.pos.copy(this.tmp2);
    this.tmp2.copy(this.travelTarget).sub(this.pos).normalize();
    this.orientTo(this.tmp2, dt);
    this.lastDir.copy(this.travelTarget).sub(this.pos).normalize();
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  update(dt: number, t: number, wanderX: number, wanderY: number): void {
    const sim = this.sim;
    if (this.travel >= 0) { this.doTravel(dt, t); return; }
    if (sim.V.length < 2) { this.hover(dt); return; }

    if (this.path.length < 2) this.newRoute(t);
    else {
      // the sim renumbers vertices when it compacts — if the route's start
      // vertex is no longer where it was, every index in the route is stale
      const a = this.sim.V[this.path[0]];
      if (!a) {
        this.newRoute(t);
      } else {
        lift(a.x, a.y, this.tmp);
        if (this.tmp.distanceTo(this.routeAnchor) > 0.5) this.newRoute(t);
      }
    }
    let total = this.cum[this.cum.length - 1];
    if (total <= 0) {
      if (this.relocate(t)) return;
      this.hover(dt);
      return;
    }

    if (total - this.dist < 240) {
      const exhausted = this.extendRoute(t);
      total = this.cum[this.cum.length - 1];
      if (exhausted && this.dist >= total - 1) {
        // the route is over and we're at its end — move on, or hover and look
        // around until the mat grows something worth riding
        if (this.relocate(t)) return;
        this.hover(dt);
        return;
      }
    }
    // every 45 s, drift toward wherever the mat is busiest
    if (t > this.nextDriftT) {
      this.nextDriftT = t + 45;
      const c = this.bestComps(1)[0];
      if (c && c.size >= 60) {
        const tv = this.sim.V[c.v];
        if (tv) {
          lift(tv.x, tv.y, this.travelTarget);
          if (this.travelTarget.distanceTo(this.pos) > 10) {
            this.startTravel();
            this.travel = c.v;
            return;
          }
          this.newRoute(t);
          return;
        }
      }
    }
    // the route ran out at a dead end: re-root from here
    if (this.dist >= total - 0.01 && this.cum.length < 4) {
      this.newRoute(t);
      return;
    }

    // advance
    this.curSpeed += (this.speed - this.curSpeed) * Math.min(1, dt * 1.2);
    this.dist += this.curSpeed * dt;
    // prune the trail behind us so the route (and the pointAt scan) stay small
    while (this.path.length > 2 && this.dist > 30) {
      const dropped = this.cum[1];
      this.path.shift();
      this.cum.shift();
      this.dist -= dropped;
      for (let i = 1; i < this.cum.length; i++) this.cum[i] -= dropped;
    }
    const a0 = this.sim.V[this.path[0]];
    if (a0) lift(a0.x, a0.y, this.routeAnchor);

    const p = this.pointAt(this.dist);
    if (!p) { if (this.relocate(t)) return; this.newRoute(t); return; }
    total = this.cum[this.cum.length - 1];
    const ahead = this.pointAt(Math.min(total, this.dist + 48));
    if (!ahead) { if (this.relocate(t)) return; this.newRoute(t); return; }

    // the anti-burn-in wander only — no sway, no roll, ever
    p.x += wanderX * 0.002;
    p.y += wanderY * 0.002;
    this.pos.copy(p);

    // orientation: ease toward the path ahead — world up, level ride; when
    // the view runs near-vertical the heading is held (see orientTo).
    this.tmp2.copy(ahead).sub(this.pos);
    if (this.tmp2.lengthSq() < 1e-4) this.tmp2.copy(this.lastDir);
    this.orientTo(this.tmp2, dt);

    this.lastDir.copy(this.tmp2.copy(ahead).sub(this.pos).normalize());
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }

  /**
   * Ease the heading toward `dir`. World up everywhere (the ride stays
   * level like a flight over a landscape, no planet-walk inversion); when
   * the view runs near-parallel to the up vector the up is ambiguous, so
   * the heading is HELD (returned false) instead of snapping to some
   * fallback — that is what makes the horizon stay continuous.
   */
  private orientTo(dir: Vector3, dt: number): boolean {
    if (Math.abs(dir.y) / (dir.length() || 1) > 0.95) return false;
    this.m4.lookAt(this.pos, this.tmp.copy(this.pos).add(dir), this.up);
    this.qLook.setFromRotationMatrix(this.m4);
    // ease small corrections, but CAP the turn rate: a retarget to a patch
    // over there blends in as a slow pan instead of snapping
    let k = Math.min(1, dt * 3);
    const ang = this.quat.angleTo(this.qLook);
    if (ang > 1e-4) {
      const maxStep = TURN_RATE * dt;
      if (ang > maxStep) k = Math.min(k, maxStep / ang);
    }
    this.slerpTo(this.qLook, k);
    // re-snap upright for the resulting forward: the slerp can pass through
    // rolled intermediates on 3-D turns, but the camera never carries roll
    this.tmp2.set(0, 0, -1).applyQuaternion(this.quat);
    this.m4.lookAt(this.pos, this.tmp2.add(this.pos), this.up);
    this.quat.setFromRotationMatrix(this.m4);
    return true;
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

  /** A slow in-place look-around while there's nothing worth riding (an empty mat, or small components still growing) — it pans the whole sphere, up and down as well as around. */
  private hover(dt: number): void {
    this.orbitT += dt;
    const a = this.orbitT * 0.12;
    this.tmp2.set(
      Math.cos(a) * 24,
      Math.sin(a * 0.53 + 1) * 12,
      Math.sin(a) * 24,
    );
    this.orientTo(this.tmp2, dt);
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }
}

function distSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
