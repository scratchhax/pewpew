import { Matrix4, Quaternion, Vector3, type Scene, type Texture } from 'three';
import { FishMesh } from './fishmesh';
import { ANGEL, BUTTERFLY, CHROMIS, CLOWN, PUFFER, REGAL_TANG, SHARK, YELLOW_TANG, type SpeciesDef } from './species';

/**
 * The fish and how they behave. Allowed traffic swims across the tank as
 * schools of chromis (outbound left to right, inbound right to left), with a
 * home school that never leaves. Blocked traffic sends in a pufferfish that
 * swells up at the intruder and backs off. A threat brings a reef shark
 * cruising through, and small fish scatter from it. DHCP leases add residents
 * (tangs, butterflyfish, angelfish) that wander the reef; a pair of clownfish
 * keeps to its anemone. Every fish steers smoothly: turns are real 3D turns,
 * the body bends into them, and the tail beats faster the faster it swims.
 */

export const TANK = { x: 58, yLo: 4, yHi: 36, zLo: -46, zHi: 8, exitX: 108 };

type Role = 'school' | 'resident' | 'puffer' | 'shark' | 'clown';

export interface Fish {
  def: SpeciesDef;
  role: Role;
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  fwd: Vector3;
  size: number;
  phase: number;
  bend: number;
  puff: number;
  puffTarget: number;
  goal: Vector3;
  goalT: number;
  speedK: number;
  school?: School;
  offset?: Vector3;
  leaving: boolean;
  state: string;
  stateT: number;
  ambient: boolean;
  born: number;
  flee: number;
}

interface School { leader: Vector3; vel: Vector3; dir: number; home: boolean; goal: Vector3; goalT: number; members: Fish[]; }

const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpS = new Vector3(), tmpV = new Vector3(), tmpU = new Vector3(), tmpW = new Vector3();
const UP = new Vector3(0, 1, 0);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Life {
  readonly fish: Fish[] = [];
  private meshes = new Map<string, FishMesh>();
  private schools: School[] = [];
  private home: School;
  maxFish = 260;
  maxResidents = 12;
  speedScale = 1;
  current = 0.3;
  ground: (x: number, z: number) => number = () => 0;
  anemone = new Vector3(-24, 5, -12);
  onSfx: (name: string, x: number) => void = () => {};

  constructor(scene: Scene, scales: Texture) {
    const cap: Array<[SpeciesDef, number]> = [[CHROMIS, 420], [YELLOW_TANG, 16], [BUTTERFLY, 16], [ANGEL, 12], [REGAL_TANG, 16], [CLOWN, 4], [PUFFER, 4], [SHARK, 2]];
    for (const [d, n] of cap) this.meshes.set(d.id, new FishMesh(d, n, scene, scales));
    this.home = { leader: new Vector3(8, 18, -18), vel: new Vector3(), dir: 0, home: true, goal: new Vector3(8, 18, -18), goalT: 0, members: [] };
    this.schools.push(this.home);
    for (let i = 0; i < 18; i++) this.join(this.home, this.spawn(CHROMIS, 'school', this.home.leader.clone().add(new Vector3(rand(-5, 5), rand(-3, 3), rand(-4, 4))), true));
    for (const d of [YELLOW_TANG, REGAL_TANG, ANGEL, BUTTERFLY]) this.spawn(d, 'resident', this.randomSpot(), true);
    for (let i = 0; i < 2; i++) this.spawn(CLOWN, 'clown', this.anemone.clone().add(new Vector3(rand(-2, 2), 2 + i, rand(-2, 2))), true);
  }

  get counts() {
    const c: Record<string, number> = {};
    for (const f of this.fish) c[f.def.id] = (c[f.def.id] ?? 0) + 1;
    return c;
  }
  get sharkAlive(): boolean { return this.fish.some((f) => f.role === 'shark'); }

  private randomSpot(): Vector3 {
    return new Vector3(rand(-TANK.x * 0.8, TANK.x * 0.8), rand(TANK.yLo + 4, TANK.yHi - 6), rand(TANK.zLo + 6, TANK.zHi - 6));
  }

  private spawn(def: SpeciesDef, role: Role, at: Vector3, ambient = false): Fish {
    const f: Fish = {
      def, role, pos: at.clone(), vel: new Vector3(rand(-1, 1), 0, rand(-0.3, 0.3)).setLength(def.swim.cruise * 0.5), quat: new Quaternion(), fwd: new Vector3(1, 0, 0),
      size: rand(0.85, 1.12), phase: Math.random() * 20, bend: 0, puff: 0, puffTarget: 0, goal: at.clone(), goalT: 0, speedK: rand(0.85, 1.1),
      leaving: false, state: 'in', stateT: 0, ambient, born: performance.now(), flee: 0,
    };
    this.fish.push(f);
    return f;
  }

  private join(s: School, f: Fish): void {
    f.school = s;
    const r = 2.2 + Math.sqrt(s.members.length + 1) * 0.9;
    f.offset = new Vector3(rand(-r, r) * 1.3, rand(-r, r) * 0.6, rand(-r, r));
    s.members.push(f);
  }

  // ── events ──
  /** A school swims across: outbound left → right, inbound right → left. */
  school(n: number, outbound: boolean): Fish | null {
    const chromis = this.fish.filter((f) => f.def === CHROMIS).length;
    n = Math.min(n, this.maxFish - this.fish.length, this.meshes.get('chromis')!.max - chromis);
    if (n < 3) return null;
    const dir = outbound ? 1 : -1;
    const y = rand(10, 30), z = rand(-38, 0);
    let first: Fish | null = null;
    const s: School = { leader: new Vector3(-dir * TANK.exitX * 0.92, y, z), vel: new Vector3(dir * CHROMIS.swim.cruise, 0, 0), dir, home: false, goal: new Vector3(), goalT: 0, members: [] };
    for (let i = 0; i < n; i++) {
      const f = this.spawn(CHROMIS, 'school', s.leader.clone());
      this.join(s, f);
      f.pos.add(f.offset!).x -= dir * rand(0, 6);
      f.vel.set(dir * CHROMIS.swim.cruise, 0, 0);
      first ??= f;
    }
    this.schools.push(s);
    this.onSfx('school', -dir * 60);
    return first;
  }

  /** A pufferfish swims in, swells up at the intruder, then backs off. */
  puffer(): Fish | null {
    if (this.fish.filter((f) => f.role === 'puffer').length >= 3 || this.fish.length >= this.maxFish) return null;
    const side = Math.random() < 0.5 ? -1 : 1;
    const f = this.spawn(PUFFER, 'puffer', new Vector3(side * TANK.exitX * 0.85, rand(12, 26), rand(-14, 4)));
    f.goal.set(rand(-30, 30), rand(12, 26), rand(-10, 4));
    f.vel.set(-side * PUFFER.swim.cruise, 0, 0);
    this.onSfx('puffer', f.pos.x);
    return f;
  }

  /** A shark cruises through. */
  shark(): Fish | null {
    if (this.sharkAlive) return null;
    const side = Math.random() < 0.5 ? -1 : 1;
    const f = this.spawn(SHARK, 'shark', new Vector3(side * (TANK.exitX + 20), rand(14, 24), rand(-30, -12)));
    f.goal.set(-side * (TANK.exitX + 90), rand(12, 26), rand(-26, -6));
    f.vel.set(-side * SHARK.swim.cruise, 0, 0);
    this.onSfx('shark', f.pos.x);
    return f;
  }

  /** A new resident arrives from the side with its name, and the oldest newcomer leaves if the reef is full. */
  resident(): Fish | null {
    const pool = [YELLOW_TANG, BUTTERFLY, ANGEL, REGAL_TANG];
    const def = pool[Math.floor(Math.random() * pool.length)];
    const mesh = this.meshes.get(def.id)!;
    if (this.fish.filter((f) => f.def === def).length >= mesh.max || this.fish.length >= this.maxFish) return null;
    const living = this.fish.filter((f) => f.role === 'resident' && !f.leaving);
    if (living.length >= this.maxResidents) {
      const oldest = living.filter((f) => !f.ambient).sort((a, b) => a.born - b.born)[0] ?? living[0];
      oldest.leaving = true;
      oldest.goal.set(Math.sign(oldest.pos.x || 1) * (TANK.exitX + 10), oldest.pos.y, oldest.pos.z);
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    const f = this.spawn(def, 'resident', new Vector3(side * TANK.exitX * 0.9, rand(10, 28), rand(-30, 0)));
    f.goal.set(rand(-30, 30), rand(10, 28), rand(-30, 0));
    f.goalT = rand(6, 10);
    f.vel.set(-side * def.swim.cruise, 0, 0);
    this.onSfx('resident', f.pos.x);
    return f;
  }

  // ── simulation ──
  update(dt: number): void {
    const now = performance.now();
    const shark = this.fish.find((f) => f.role === 'shark');
    const sk = this.speedScale;

    // school leaders
    for (const s of this.schools) {
      if (s.home) {
        s.goalT -= dt;
        if (s.goalT <= 0 || s.leader.distanceTo(s.goal) < 3) { s.goal.set(rand(-30, 34), rand(10, 26), rand(-32, -4)); s.goalT = rand(8, 16); }
        tmpV.subVectors(s.goal, s.leader).setLength(CHROMIS.swim.cruise * 0.45 * sk);
      } else {
        const t = now * 0.001;
        tmpV.set(s.dir * CHROMIS.swim.cruise * sk, Math.sin(t * 0.4 + s.leader.z) * 1.2, Math.sin(t * 0.3 + s.leader.y) * 1.5);
      }
      if (shark && s.leader.distanceTo(shark.pos) < 26) tmpV.add(tmpU.subVectors(s.leader, shark.pos).setY(0).setLength(CHROMIS.swim.cruise * 1.2));
      s.vel.lerp(tmpV, 1 - Math.exp(-dt * 0.8));
      s.leader.addScaledVector(s.vel, dt);
      if (s.home) s.leader.clamp(tmpU.set(-TANK.x, TANK.yLo + 4, TANK.zLo + 4), tmpW.set(TANK.x, TANK.yHi - 4, TANK.zHi - 6));
    }

    for (const f of this.fish) this.steer(f, dt, shark, now);
    this.separate(dt);

    // retire fish that have left, and schools that have emptied
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      const gone = Math.abs(f.pos.x) > TANK.exitX + (f.role === 'shark' ? 40 : 6);
      const leavingDone = (f.role === 'school' && !f.school!.home && Math.sign(f.pos.x) === f.school!.dir) || f.leaving || f.state === 'out' || f.role === 'shark';
      if (gone && leavingDone && now - f.born > 3000) {
        this.fish.splice(i, 1);
        if (f.school) f.school.members.splice(f.school.members.indexOf(f), 1);
      }
    }
    this.schools = this.schools.filter((s) => s.home || s.members.length > 0);
    this.commit();
  }

  private steer(f: Fish, dt: number, shark: Fish | undefined, now: number): void {
    const d = f.def, cruise = d.swim.cruise * f.speedK * this.speedScale;
    const want = tmpV;
    switch (f.role) {
      case 'school': {
        const s = f.school!;
        want.copy(s.leader).add(f.offset!).sub(f.pos).multiplyScalar(0.9).add(s.vel);
        break;
      }
      case 'resident': {
        f.goalT -= dt;
        if (!f.leaving && (f.goalT <= 0 || f.pos.distanceTo(f.goal) < 2.5)) {
          f.goal.copy(this.randomSpot());
          f.goalT = rand(7, 16);
        }
        want.subVectors(f.goal, f.pos).setLength(cruise * (f.leaving ? 1.3 : 0.7));
        break;
      }
      case 'clown': {
        f.goalT -= dt;
        if (f.goalT <= 0) { f.goal.copy(this.anemone).add(tmpU.set(rand(-3, 3), rand(1.5, 4), rand(-3, 3))); f.goalT = rand(1.5, 4); }
        want.subVectors(f.goal, f.pos).multiplyScalar(0.8).clampLength(0, cruise);
        break;
      }
      case 'puffer': {
        f.stateT += dt;
        if (f.state === 'in') {
          want.subVectors(f.goal, f.pos).clampLength(0, cruise);
          if (f.pos.distanceTo(f.goal) < 3 || f.stateT > 20) { f.state = 'puff'; f.stateT = 0; f.puffTarget = 1; this.onSfx('puff', f.pos.x); }
        } else if (f.state === 'puff') {
          want.set(0, Math.sin(f.stateT * 1.3) * 0.2, 0);
          if (f.stateT > 4.5) { f.state = 'deflate'; f.stateT = 0; f.puffTarget = 0; this.onSfx('deflate', f.pos.x); }
        } else if (f.state === 'deflate') {
          want.set(0, 0, 0);
          if (f.stateT > 2) { f.state = 'out'; f.goal.set(Math.sign(f.pos.x || 1) * (TANK.exitX + 12), f.pos.y + 2, f.pos.z - 4); }
        } else {
          want.subVectors(f.goal, f.pos).setLength(cruise * 1.2);
        }
        f.puff += (f.puffTarget - f.puff) * Math.min(1, dt * (f.puffTarget > f.puff ? 1.6 : 0.9));
        break;
      }
      case 'shark': {
        const t = now * 0.001;
        want.subVectors(f.goal, f.pos).setY(0).setLength(cruise);
        want.y = (f.goal.y + Math.sin(t * 0.2) * 4 - f.pos.y) * 0.3;
        want.z += Math.sin(t * 0.13) * 1.5;
        break;
      }
    }
    // scatter from the shark
    f.flee = Math.max(0, f.flee - dt);
    if (shark && f !== shark && f.def.length < 8) {
      tmpU.subVectors(f.pos, shark.pos);
      const dist = tmpU.length();
      if (dist < 24) {
        tmpU.y *= 0.4;
        want.addScaledVector(tmpU.normalize(), d.swim.cruise * 2.4 * (1 - dist / 24) * 2);
        f.flee = 1.2;
      }
    }
    // keep inside the water and off the reef
    const floor = this.ground(f.pos.x, f.pos.z) + 2 + d.length * 0.3;
    if (f.pos.y < floor) want.y += (floor - f.pos.y) * 2.5;
    if (f.pos.y > TANK.yHi) want.y -= (f.pos.y - TANK.yHi) * 2;
    if (f.pos.z > TANK.zHi) want.z -= (f.pos.z - TANK.zHi) * 1.5;
    if (f.pos.z < TANK.zLo) want.z += (TANK.zLo - f.pos.z) * 1.5;
    if (f.role === 'resident' && !f.leaving && Math.abs(f.pos.x) > TANK.x + 20) want.x -= Math.sign(f.pos.x) * cruise;
    want.x += this.current * 0.4;

    const agility = d.swim.agility * (f.flee > 0 ? 2 : 1);
    const maxSpeed = cruise * (f.flee > 0 ? 2.6 : 1.5);
    want.clampLength(0, maxSpeed);
    f.vel.lerp(want, 1 - Math.exp(-dt * agility));
    // fish don't swim straight up or down
    const flat = Math.hypot(f.vel.x, f.vel.z);
    f.vel.y = Math.max(-flat * 0.45, Math.min(flat * 0.45, f.vel.y));
    f.pos.addScaledVector(f.vel, dt);

    // heading: follow the velocity, turning smoothly; hover in place when nearly still
    const speed = f.vel.length();
    const prev = tmpW.copy(f.fwd);
    if (speed > 0.25) {
      const k = 1 - Math.exp(-dt * (2 + agility * 1.5));
      f.fwd.lerp(tmpU.copy(f.vel).divideScalar(speed), k).normalize();
      if (Math.hypot(f.fwd.x, f.fwd.z) < 0.2) f.fwd.set(prev.x || 1, f.fwd.y, prev.z).normalize();
    }
    const turn = -(prev.z * f.fwd.x - prev.x * f.fwd.z) / Math.max(dt, 1e-3);    // local turn rate (rad/s)
    f.bend += (Math.max(-0.22, Math.min(0.22, turn * 0.16)) - f.bend) * Math.min(1, dt * 5);
    const side = tmpU.crossVectors(f.fwd, UP).normalize();
    const up = tmpS.crossVectors(side, f.fwd).normalize();
    tmpM.makeBasis(f.fwd, up, side);
    f.quat.setFromRotationMatrix(tmpM);

    const L = d.length * f.size;
    const beat = 0.5 + 0.95 * speed / L + Math.abs(f.bend) * 2 + (f.role === 'puffer' && f.puff > 0.3 ? 0.8 : 0);
    f.phase += dt * Math.PI * 2 * beat;
  }

  /** Keep fish from swimming through each other: a coarse grid, small pushes. */
  private grid = new Map<number, Fish[]>();
  private separate(dt: number): void {
    const g = this.grid;
    g.clear();
    const cell = 3;
    const key = (x: number, y: number, z: number) => ((Math.floor(x / cell) + 512) * 1048576) + ((Math.floor(y / cell) + 512) * 1024) + (Math.floor(z / cell) + 512);
    for (const f of this.fish) {
      if (f.role === 'shark') continue;
      const k = key(f.pos.x, f.pos.y, f.pos.z);
      let list = g.get(k);
      if (!list) g.set(k, (list = []));
      list.push(f);
    }
    for (const f of this.fish) {
      if (f.role === 'shark') continue;
      const cx = Math.floor(f.pos.x / cell), cy = Math.floor(f.pos.y / cell), cz = Math.floor(f.pos.z / cell);
      for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) for (let iz = -1; iz <= 1; iz++) {
        const list = g.get(((cx + ix + 512) * 1048576) + ((cy + iy + 512) * 1024) + (cz + iz + 512));
        if (!list) continue;
        for (const o of list) {
          if (o === f) continue;
          tmpU.subVectors(f.pos, o.pos);
          const want = (f.def.length * f.size + o.def.length * o.size) * 0.32;
          const d2 = tmpU.lengthSq();
          if (d2 > want * want || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          f.pos.addScaledVector(tmpU, ((want - d) / d) * Math.min(1, dt * 3) * 0.5);
        }
      }
    }
  }

  private commit(): void {
    const counts = new Map<FishMesh, number>();
    for (const m of this.meshes.values()) counts.set(m, 0);
    for (const f of this.fish) {
      const mesh = this.meshes.get(f.def.id)!;
      const i = counts.get(mesh)!;
      if (i >= mesh.max) continue;
      const L = f.def.length * f.size;
      // the geometry's origin is the tail root; place the fish by its middle
      tmpV.copy(f.pos).addScaledVector(f.fwd, -0.5 * L);
      tmpM.compose(tmpV, f.quat, tmpS.setScalar(L));
      const speed = f.vel.length();
      const amp = f.def.swim.amp * (0.45 + 0.55 * Math.min(1.8, speed / f.def.swim.cruise)) * (1 - f.puff * 0.7);
      mesh.set(i, tmpM, f.phase, amp, f.bend, f.puff);
      counts.set(mesh, i + 1);
    }
    for (const [m, n] of counts) m.commit(n);
  }
}
