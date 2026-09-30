import { Matrix4, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Sim } from '../mycelium/filaments';
import { lift, vertexWorld, R, S } from './web3d';

/** Max heading change per second: big retargets become slow pans, not snaps. */
const TURN_RATE = (22 * Math.PI) / 180;
/** Max velocity-turn per second: the camera is a zero-g vehicle — direction NEVER changes abruptly. */
const POS_TURN = (28 * Math.PI) / 180;

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
  private lastRelocateT = -1000;
  /** Where the camera is actually heading — velocity direction, turn-limited. */
  private velDir = new Vector3();
  private tmp3 = new Vector3();
  private tmp4 = new Vector3();
  /** When the current route was (re)rooted — the vehicle coasts through a re-root. */
  private routeT = -1000;
  /** Weighted direction toward nearby living structure — what the camera likes to look at. */
  private pullDir = new Vector3();
  /** The last two glide targets — never glide back where we just were. */
  private lastTravelA = new Vector3(1e9, 0, 0);
  private lastTravelB = new Vector3(1e9, 0, 0);
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
  get routeInfo(): { route: number; total: number; dist: number; travel: number; tdist: number; vel: number[] } {
    return { route: this.path.length, total: this.cum[this.cum.length - 1], dist: this.dist, travel: this.travel, tdist: this.travel >= 0 ? this.pos.distanceTo(this.travelTarget) : -1, vel: [this.velDir.x, this.velDir.y, this.velDir.z] };
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
      if (!vertexWorld(this.sim, i, this.tmp)) continue;
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
      if (!vertexWorld(this.sim, next, this.tmp)) continue;
      this.tmp.sub(this.pos).normalize();
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
    this.routeT = t;
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
    vertexWorld(this.sim, this.path[0], this.routeAnchor);
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

  /** Glide to an active patch — lively AND roughly ahead, so the ride never becomes endless backwards transit. */
  private relocate(t: number): boolean {
    if (t - this.lastRelocateT < 4) return false;
    const comps = this.bestComps(5).slice();
    const velN = this.velDir.lengthSq() > 1e-6 ? this.tmp.copy(this.velDir).normalize() : null;
    const cand: { v: number; p: Vector3; score: number }[] = [];
    for (const c of comps) {
      if (c.size < 20) continue;
      const tv = this.sim.V[c.v];
      if (!tv || !vertexWorld(this.sim, c.v, this.tmp3)) continue;
      if (this.tmp3.distanceTo(this.pos) < 8) continue;
      // never glide back to where we just came from — that ping-pong is what
      // reads as the whole scene snapping back and forth
      if (this.tmp3.distanceTo(this.lastTravelA) < 25) continue;
      if (this.tmp3.distanceTo(this.lastTravelB) < 25) continue;
      let fwd = 1;
      if (velN) {
        const dir = this.tmp2.copy(this.tmp3).sub(this.pos).normalize();
        fwd = 0.3 + 0.7 * Math.max(0, velN.dot(dir));
      }
      cand.push({ v: c.v, p: this.tmp3.clone(), score: c.act * fwd });
    }
    cand.sort((a, b) => b.score - a.score);
    const best = cand[0];
    if (!best) return false;
    this.lastRelocateT = t;
    this.travelTarget.copy(best.p);
    this.startTravel();
    this.travel = best.v;
    return true;
  }

  private startTravel(): void {
    this.lastTravelB.copy(this.lastTravelA);
    this.lastTravelA.copy(this.travelTarget);
  }

  /**
   * Glide to the relocation target as a zero-g vehicle: steer at the target
   * with a soft field around the hollow core — deep inside the shell we bias
   * outward, outside it we bias inward. The path bends gracefully around the
   * void with no arc state to get stuck in (every parameterized scheme tried
   * here had a degenerate case; a steering field has none).
   */
  private doTravel(dt: number, t: number): void {
    const d0 = this.pos.distanceTo(this.travelTarget);
    if (d0 < 0.3) {
      this.pos.copy(this.travelTarget); // imperceptible settle, not a jump
      this.travel = -1;
      this.newRoute(t);
      this.cam.position.copy(this.pos);
      return;
    }
    this.tmp.copy(this.travelTarget).sub(this.pos);
    this.tmp.normalize();
    const r = this.pos.length();
    const near = Math.min(1, d0 / 16); // the field fades off on final approach
    if (r > 1e-3) {
      const rad = this.tmp4.copy(this.pos).multiplyScalar(1 / r);
      const deep = Math.min(1, Math.max(0, (0.62 * R - r) / (0.25 * R))) * near;
      const high = Math.min(1, Math.max(0, (r - 0.95 * R) / (0.2 * R))) * near;
      if (deep > 0) this.tmp.addScaledVector(rad, deep * 2.2).normalize();
      else if (high > 0) this.tmp.addScaledVector(rad, -high * 1.4).normalize();
    }
    // Zero-g cornering: past the gentle zone the pivot slows harder than the
    // brake — target switches become wide sweeping arcs, not pivots in place.
    this.corner(dt, this.tmp, this.speed * 1.3);
    this.pos.addScaledVector(this.velDir, this.curSpeed * dt);
    this.aim(this.tmp, dt);
    this.lastDir.copy(this.tmp);
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  update(dt: number, t: number, wanderX: number, wanderY: number): void {
    const sim = this.sim;
    this.computePull(this.sim);
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
        vertexWorld(this.sim, this.path[0], this.tmp);
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
    this.dist += this.curSpeed * dt;
    // prune the trail behind us so the route (and the pointAt scan) stay small
    while (this.path.length > 2 && this.dist > 30) {
      const dropped = this.cum[1];
      this.path.shift();
      this.cum.shift();
      this.dist -= dropped;
      for (let i = 1; i < this.cum.length; i++) this.cum[i] -= dropped;
    }
    const a0 = this.path[0];
    vertexWorld(this.sim, a0, this.routeAnchor);

    const p = this.pointAt(this.dist);
    if (!p) { if (this.relocate(t)) return; this.newRoute(t); return; }
    total = this.cum[this.cum.length - 1];
    const chase = this.pointAt(Math.min(total, this.dist + 14));
    const ahead = this.pointAt(Math.min(total, this.dist + 48));
    if (!chase || !ahead) { if (this.relocate(t)) return; this.newRoute(t); return; }

    // the rail runs at the ride speed; the camera is a vehicle chasing a point
    // down the rail — junction corners get rounded off, never taken
    const lag = p.distanceTo(this.pos);
    if (lag > 10) this.dist -= (lag - 10) * 0.6;
    this.tmp.subVectors(chase, this.pos);
    if (this.tmp.lengthSq() < 1e-6) this.tmp.copy(this.lastDir);
    this.tmp.normalize();
    // Coast through a re-root: the desired direction blends in from the
    // current velocity over the first two seconds, so a rail that snaps to a
    // new junction never swings the drift
    const rb = Math.min(1, (t - this.routeT) / 2);
    if (rb < 1 && this.velDir.lengthSq() > 1e-6) this.tmp.lerp(this.velDir, 1 - rb).normalize();
    // Zero-g cornering on the rails too (same law as doTravel): a junction
    // switch or fresh rail that demands a heading way off the current one
    // slows the PIVOT harder than it brakes — a wide sweeping arc, never a
    // pivot in place at speed.
    this.corner(dt, this.tmp, this.speed);
    this.pos.addScaledVector(this.velDir, this.curSpeed * dt);

    // the anti-burn-in wander only — no sway, no roll, ever
    this.pos.x += wanderX * 0.002;
    this.pos.y += wanderY * 0.002;

    // orientation: ease toward the path ahead — pulled toward glowing
    // structure the more the path misses it (the camera never stares at void)
    this.tmp2.copy(ahead).sub(this.pos);
    if (this.tmp2.lengthSq() < 1e-4) this.tmp2.copy(this.lastDir);
    this.aim(this.tmp2, dt);

    this.lastDir.copy(this.tmp2.copy(ahead).sub(this.pos).normalize());
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }

  /**
   * Weighted direction toward nearby living structure — what glows pulls the
   * eye. Accumulated every frame from vertex memory and fresh flow, with a
   * distance falloff so close structure dominates.
   */
  private computePull(sim: Sim): void {
    this.pullDir.set(0, 0, 0);
    for (let i = 0; i < sim.V.length; i++) {
      const v = sim.V[i];
      const w = 0.04 + v.mem + v.flow * 1.6;
      if (!vertexWorld(sim, i, this.tmp3)) continue;
      this.tmp.subVectors(this.tmp3, this.pos);
      const d2 = this.tmp.lengthSq();
      if (d2 < 1e-3 || d2 > 7200) continue; // nearby-ish only
      this.tmp.normalize();
      this.pullDir.addScaledVector(this.tmp, w / (1 + d2 / 250));
    }
  }

  /**
   * Aim the view: along the path, but pulled toward nearby structure the
   * more the path misses it — the camera never volunteers to stare at the
   * void while something is glowing off to the side.
   */
  private aim(pathAhead: Vector3, dt: number): void {
    const pa = this.tmp2.copy(pathAhead);
    if (pa.lengthSq() < 1e-8) return;
    pa.normalize();
    const pl = this.pullDir.length();
    if (pl > 1e-4) {
      this.tmp3.copy(this.pullDir).divideScalar(pl);
      const miss = Math.max(0, 1 - pa.dot(this.tmp3));
      if (miss > 0.02) pa.addScaledVector(this.tmp3, 0.3 + 1.4 * miss).normalize();
    }
    this.orientTo(pa, dt);
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

  /**
   * Turn the velocity toward `desired`, capped at POS_TURN per second — the
   * vehicle's rule: the direction of travel NEVER changes abruptly. `rateMul`
   * widens the arc for hard heading demands (a target switch): slower pivot
   * at near-speed is a wide sweeping arc, while a fast pivot on cut speed
   * is a pivot-in-place, which reads as a snap.
   */
  private steer(dt: number, desired: Vector3, rateMul = 1): void {
    if (this.velDir.lengthSq() < 1e-6) this.velDir.copy(desired);
    else {
      const ang = this.velDir.angleTo(desired);
      if (ang > 1e-4) this.velDir.lerp(desired, Math.min(1, (POS_TURN * dt * rateMul) / ang)).normalize();
    }
    this.velDir.normalize();
  }

  /**
   * The cornering law, shared by rail-riding and gliding: past the gentle
   * zone, the pivot slows HARDER than the brake — wide sweeping arcs, never
   * a pivot in place. Eases curSpeed and steers with the matching multiplier.
   */
  private corner(dt: number, desired: Vector3, baseSpeed: number): void {
    const off = this.velDir.lengthSq() > 1e-6 ? this.velDir.angleTo(desired) : 0;
    const hard = Math.max(0, off - 0.5);
    const turnMul = Math.max(0.3, 1 - hard * 0.8);
    const speedMul = Math.max(0.72, 1 - hard * 0.45);
    this.curSpeed += (baseSpeed * speedMul - this.curSpeed) * Math.min(1, dt * 2.5);
    this.steer(dt, desired, turnMul);
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
    if (!vertexWorld(this.sim, p[k - 1], this.tmp2)) return null;
    if (!vertexWorld(this.sim, p[k], this.tmp3)) return null;
    return this.tmp2.lerp(this.tmp3, f).clone();
  }

  /** A slow in-place look-around while there's nothing worth riding (an empty mat, or small components still growing) — it pans the whole sphere, up and down as well as around. */
  private hover(dt: number): void {
    this.orbitT += dt;
    // zero-g: there is no brakes — bleed the speed off and drift to a stop
    this.curSpeed += (0 - this.curSpeed) * Math.min(1, dt * 1.2);
    if (this.curSpeed > 0.02 && this.velDir.lengthSq() > 1e-6) {
      this.pos.addScaledVector(this.velDir, this.curSpeed * dt);
    }
    const a = this.orbitT * 0.12;
    if (this.pullDir.lengthSq() > 1e-6) {
      // gaze at the busiest nearby structure with a slow sway — even parked,
      // the camera looks at something alive
      const pl = Math.sqrt(this.pullDir.lengthSq());
      this.tmp2.copy(this.pullDir).divideScalar(pl);
      this.tmp2.x += Math.sin(a * 1.9) * 0.3;
      this.tmp2.y += Math.sin(a * 1.4 + 2) * 0.12;
      this.tmp2.z += Math.cos(a * 1.7 + 1) * 0.3;
    } else {
      this.tmp2.set(
        Math.cos(a) * 24,
        Math.sin(a * 0.53 + 1) * 12,
        Math.sin(a) * 24,
      );
    }
    this.orientTo(this.tmp2, dt);
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
  }
}

function distSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
