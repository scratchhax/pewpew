import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, SRGBColorSpace, TorusGeometry, type PerspectiveCamera, type Scene, type Texture,
} from 'three';
import { curved } from './bend';
import { buildCar, disposeCar, type CarRig } from './car';
import { LANES, NEAR } from './road';
import { drawNeon, streak, stripes } from './textures';

/** Shared geometry (created once, never per object, so nothing leaks). */
const GEO = {
  trail: new PlaneGeometry(0.45, 7).rotateX(-Math.PI / 2),
  plate: new PlaneGeometry(2.4, 0.6),
  barrier: new BoxGeometry(1.0, 0.9, 0.35).translate(0, 0.45, 0),
  beacon: new PlaneGeometry(2.4, 2.4),
  arch: new TorusGeometry(11, 0.22, 8, 48, Math.PI),
  broken: new TorusGeometry(11, 0.22, 8, 30, Math.PI * 0.62),
  post: new BoxGeometry(0.5, 1.2, 0.5),
  label: new PlaneGeometry(7, 1.75),
};

const PAINTS = [0xd7263d, 0xf2f2f2, 0x1b1b24, 0x2a6cf0, 0xf5b700, 0x2bd9a8, 0x8a2be2, 0xff6a00, 0x9aa3b5, 0x0f5132];

// ── physics constants ──
/** Car footprint half-width and half-length (m). */
const HALF_W = 0.98;
const HALF_L = 2.28;
/** Reach used for barricade checks (m). */
const R = 0.98;
const AXLE = 1.25;
/** Bounciness of car-on-car contact. */
const RESTITUTION = 0.25;
/** An impulse (m/s) above this makes a car lose control. */
const CRASH = 5.5;
/** How far out crashed cars come to rest (on the shoulder, clear of the lanes). */
const SHOULDER = 8.0;
const ROAD_EDGE = 8.2;
/** How far across our driver will go: wheels on the curb, clear of a car sitting in the outside lane. */
const PLAYER_EDGE = 7.4;
/** How far a civilian squeezes onto the curb to let us by. */
const PULL = 1.9;

const nearestLane = (x: number) => LANES.reduce((best, lx, k) => (Math.abs(lx - x) < Math.abs(LANES[best] - x) ? k : best), 0);

type Kind = 'traffic' | 'overtake' | 'rival' | 'police';

/** The four corners of a car's footprint and its two axes. Forward is (-sin yaw, -cos yaw). */
function frame(b: { x: number; z: number; yaw: number }) {
  const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
  const fx = -s, fz = -c, rx = c, rz = -s;
  const corners: Array<[number, number]> = [];
  for (const [u, v] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    corners.push([b.x + rx * HALF_W * u + fx * HALF_L * v, b.z + rz * HALF_W * u + fz * HALF_L * v]);
  }
  return { fx, fz, rx, rz, corners };
}

function inside(px: number, pz: number, b: { x: number; z: number }, f: ReturnType<typeof frame>): boolean {
  const dx = px - b.x, dz = pz - b.z;
  return Math.abs(dx * f.rx + dz * f.rz) <= HALF_W && Math.abs(dx * f.fx + dz * f.fz) <= HALF_L;
}

/**
 * Separating axis test for two car footprints. Returns the push direction
 * (from b toward a), how deep they overlap, and a contact point, or null.
 */
function overlap(a: { x: number; z: number; yaw: number }, b: { x: number; z: number; yaw: number }) {
  const fa = frame(a), fb = frame(b);
  let depth = Infinity, nx = 0, nz = 0;
  for (const [ux, uz] of [[fa.rx, fa.rz], [fa.fx, fa.fz], [fb.rx, fb.rz], [fb.fx, fb.fz]]) {
    const ra = HALF_W * Math.abs(fa.rx * ux + fa.rz * uz) + HALF_L * Math.abs(fa.fx * ux + fa.fz * uz);
    const rb = HALF_W * Math.abs(fb.rx * ux + fb.rz * uz) + HALF_L * Math.abs(fb.fx * ux + fb.fz * uz);
    const d = (a.x - b.x) * ux + (a.z - b.z) * uz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < depth) { depth = o; nx = d < 0 ? -ux : ux; nz = d < 0 ? -uz : uz; }
  }
  // contact: the corners that ended up inside the other car (or the midpoint)
  let px = 0, pz = 0, n = 0;
  for (const [cx, cz] of fa.corners) if (inside(cx, cz, b, fb)) { px += cx; pz += cz; n++; }
  for (const [cx, cz] of fb.corners) if (inside(cx, cz, a, fa)) { px += cx; pz += cz; n++; }
  if (n) { px /= n; pz /= n; } else { px = (a.x + b.x) / 2; pz = (a.z + b.z) / 2; }
  return { nx, nz, depth, px, pz };
}

/** Rigid-ish body in the road plane. Velocity is (vx, -speed): forward is -z. */
interface Body {
  x: number; z: number;
  vx: number;               // sideways velocity (m/s)
  speed: number;            // forward speed over the ground (m/s)
  yaw: number;              // heading (rad, three.js rotation.y)
  yawRate: number;          // spin (rad/s)
  mass: number;
  crashed: number;          // > 0: seconds since losing control (0 = driving)
}

interface Car extends Body {
  rig: CarRig;
  kind: Kind;
  lane: number;
  laneNow: number;          // the lane it's actually steering for
  target: number;           // speed the driver wants
  ratio: number;            // traffic cruise speed as a share of our cruising speed
  yieldCool: number;        // seconds before it will move over for us again
  clearT: number;           // > 0: we asked it to get out of our way (seconds left)
  pull: number;             // sideways offset from its lane while squeezing onto the curb for us (m)
  age: number;
  phase: number;            // rival/police script phase
  life: number;
  plate?: { mesh: Mesh; mat: MeshBasicMaterial; tex: CanvasTexture };
}

interface Block {
  group: Group;
  pieces: Mesh[];
  lanes: number[];
  z: number;
  smashed: boolean;
  vel: Array<{ x: number; y: number; z: number; r: number }>;
  glowMat: MeshBasicMaterial;
}

interface Gate {
  group: Group;
  z: number;
  mat: MeshBasicMaterial;
  bright: number;
  target: number;
  label?: { mat: MeshBasicMaterial; tex: CanvasTexture };
}

export interface Impact { x: number; z: number; strength: number; player: boolean }

/** What happened this frame. */
export interface TrafficHits {
  smashed: number;
  passed: number;
  /** When our driver is boxed in: the speed to ease down to. */
  speedLimit: number;
  /** Extra speed our driver wants over cruising, to get past before a gap closes (m/s). */
  boost: number;
  /** Change to our forward speed from collisions this frame (m/s). */
  playerDv: number;
  impacts: Impact[];
  /** We just got boxed in: lean on the horn. */
  honk: boolean;
}

/**
 * Everything on the road, driven by a small physics model: every car is two
 * discs with momentum, sideways velocity, heading and spin. Drivers avoid
 * trouble (follow, change lanes when there's room), but when anything touches
 * they trade momentum; an off-centre hit spins them, and a hard one makes a
 * car lose control, slide out and scrub to a stop on the shoulder. Our car is
 * knocked about, loses speed and fishtails, then recovers. Barricades are
 * solid until something smashes them.
 */
export class Traffic {
  player: CarRig;
  private pb: Body = { x: LANES[1], z: 0, vx: 0, speed: 30, yaw: 0, yawRate: 0, mass: 1.25, crashed: 0 };
  private boxed = 0;             // seconds without a clean way through
  /** Our driver's plan: where across the road to be, and the speed to do it at. */
  private plan = { x: LANES[1], speed: 30, mode: 0, safe: true };   // mode: 0 cruise, 1 boost, 2 brake
  private planT = 0;
  /** The last plan's winners (for ?diag). */
  lastOptions: unknown = null;
  /** How wild our driver is right now (network aggression, plus frustration). */
  private agg = 0;
  /** Extra visual yaw while the tail hangs out. */
  private drift = 0;
  private cars: Car[] = [];
  private blocks: Block[] = [];
  private gates: Gate[] = [];
  private stripeTex: Texture;
  private trailMat: MeshBasicMaterial;
  private postMat = curved(new MeshStandardMaterial({ color: 0x15151c }));
  private barrierMat: MeshStandardMaterial | null = null;
  maxCars = 20;
  private cruise = 30;
  far = 700;

  constructor(private scene: Scene, private glowTex: Texture) {
    this.player = buildCar({ paint: 0x1e2cff, glow: 0x3ff0ff, glowTex });
    scene.add(this.player.group);
    this.stripeTex = stripes();
    this.trailMat = curved(new MeshBasicMaterial({
      map: streak(), color: new Color(2.4, 0.1, 0.15), transparent: true, blending: AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }));
  }

  get playerX(): number { return this.pb.x; }
  /** The lane our car is in or heading for. */
  private get playerLane(): number { return nearestLane(this.plan.x); }
  police(): boolean { return this.cars.some((c) => c.kind === 'police' && c.phase < 2 && !c.crashed); }
  rivals(): number { return this.cars.filter((c) => c.kind === 'rival').length; }

  // ── spawns ──
  private addCar(kind: Kind, lane: number, z: number, speed: number, glow: number, paint?: number): Car | null {
    // never spawn into another car
    if (!this.laneFree(LANES[lane], z - 12, z + 12, null)) return null;
    const rig = buildCar({
      paint: paint ?? PAINTS[(Math.random() * PAINTS.length) | 0], glow, glowTex: this.glowTex,
      police: kind === 'police', spoiler: kind !== 'traffic' || Math.random() < 0.3,
    });
    if (kind === 'traffic' || kind === 'overtake') rig.underglowMat.opacity = 0.55;
    this.scene.add(rig.group);
    for (const side of [-0.55, 0.55]) {
      const t = new Mesh(GEO.trail, this.trailMat);
      t.position.set(side, 0.05, 2.25 + 3.3);
      t.renderOrder = 1;
      rig.group.add(t);
    }
    const car: Car = {
      rig, kind, lane, laneNow: lane, x: LANES[lane], z, vx: 0, speed, target: speed, yaw: 0, yawRate: 0,
      mass: kind === 'police' ? 1.4 : 1, crashed: 0, age: 0, phase: 0, life: 0, yieldCool: 0, clearT: 0, pull: 0,
      ratio: speed / Math.max(1, this.cruise),
    };
    this.cars.push(car);
    return car;
  }

  /** Permitted outbound traffic: a car ahead we'll pass. Inbound: a car coming up from behind to overtake. */
  traffic(color: number, inbound: boolean, playerSpeed: number): void {
    const civil = this.cars.filter((c) => c.kind === 'traffic' || c.kind === 'overtake').length;
    if (civil >= this.maxCars) return;
    const lane = (Math.random() * 4) | 0;
    // overtakers use the lane farthest from ours, so they don't brush past the camera
    if (inbound) { this.addCar('overtake', this.playerLane < 2 ? 3 : 0, NEAR - 2, playerSpeed * 1.3, color); return; }
    const z = -this.far * (0.7 + Math.random() * 0.25);
    if (this.bandFull(z)) return;
    this.addCar('traffic', lane, z, this.cruise * (0.45 + Math.random() * 0.25), color);
  }

  /** DHCP: a rival appears up ahead with the device's name on a plate; we reel it in, race, it boosts away. */
  rival(name: string, color: number, playerSpeed: number): void {
    const existing = this.cars.find((c) => c.kind === 'rival' && c.plate?.mesh.userData.name === name);
    if (existing) { existing.life = Math.max(existing.life, 4); return; }
    if (this.rivals() >= 3) return;
    const lane = this.playerLane < 2 ? this.playerLane + 1 : this.playerLane - 1;
    const car = this.addCar('rival', lane, -90, playerSpeed - 10, color);
    if (!car) return;
    car.life = 7 + Math.random() * 4;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    drawNeon(c.getContext('2d')!, name.slice(0, 18), '#ffd84d', 512, 128);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const mat = curved(new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: new Color(0.8, 0.8, 0.8) }));
    const mesh = new Mesh(GEO.plate, mat);
    mesh.position.set(0, 2.1, 0);
    mesh.userData.name = name;
    car.rig.group.add(mesh);
    car.plate = { mesh, mat, tex };
  }

  /** IDS threat: a black-and-white closes in and runs alongside while the heat lasts. */
  pursuit(playerSpeed: number): void {
    const cop = this.cars.find((c) => c.kind === 'police' && c.phase < 2 && !c.crashed);
    if (cop) { cop.life = Math.max(cop.life, 10); return; }
    const car = this.addCar('police', this.playerLane < 2 ? 3 : 0, NEAR + 10, playerSpeed + 18, 0xff2244, 0x0d0f16);
    if (car) car.life = 12;
  }

  /** Blocked traffic: a barricade across one or two lanes ahead. */
  roadblock(): void {
    if (this.blocks.length > 5) return;
    const lane = (Math.random() * 4) | 0;
    const lanes = Math.random() < 0.35 ? [lane, lane < 3 ? lane + 1 : lane - 1] : [lane];
    const group = new Group();
    const pieces: Mesh[] = [];
    const barrier = this.barrierMat ??= curved(new MeshStandardMaterial({ map: this.stripeTex, roughness: 0.5, metalness: 0.1, emissive: new Color(0.25, 0.02, 0.03) }));
    const glowMat = curved(new MeshBasicMaterial({
      map: this.glowTex, color: new Color(0.9, 0.08, 0.1), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    for (const l of lanes) {
      for (const o of [-1.1, 0, 1.1]) {
        const p = new Mesh(GEO.barrier, barrier);
        p.position.set(LANES[l] + o, 0, 0);
        group.add(p);
        pieces.push(p);
      }
      const beacon = new Mesh(GEO.beacon, glowMat);
      beacon.position.set(LANES[l], 1.6, 0.3);
      group.add(beacon);
    }
    const z = -this.far * 0.65;
    group.position.z = z;
    this.scene.add(group);
    this.blocks.push({ group, pieces, lanes, z, smashed: false, vel: [], glowMat });
  }

  /** Wi-Fi: a neon gate over the road. Joins light it up; failures leave it dim and broken. */
  gate(name: string, good: boolean): void {
    if (this.gates.length > 3) return;
    const group = new Group();
    const mat = curved(new MeshBasicMaterial({ color: new Color(0xc08cff).multiplyScalar(good ? 2.4 : 0.9), toneMapped: false, side: DoubleSide }));
    const arch = new Mesh(good ? GEO.arch : GEO.broken, mat);
    if (!good) arch.rotation.z = 0.45;
    group.add(arch);
    for (const side of [-1, 1]) {
      const post = new Mesh(GEO.post, this.postMat);
      post.position.set(side * 11, 0.6, 0);
      group.add(post);
    }
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    drawNeon(c.getContext('2d')!, name.slice(0, 18), good ? '#c08cff' : '#ff6b9a', 512, 128);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const lmat = curved(new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    const label = new Mesh(GEO.label, lmat);
    label.position.y = 11.9;
    group.add(label);
    const z = -this.far * 0.75;
    group.position.z = z;
    this.scene.add(group);
    this.gates.push({ group, z, mat, bright: 0, target: good ? 1 : 0.4, label: { mat: lmat, tex } });
  }

  // ── update ──
  /** `cruise`: the pace we want (traffic speeds are shares of it). */
  update(dt: number, t: number, playerSpeed: number, cruise: number, aggression: number, camera: PerspectiveCamera): TrafficHits {
    this.aggression = Math.max(0, Math.min(1, aggression));
    const hits: TrafficHits = { smashed: 0, passed: 0, speedLimit: Infinity, boost: 0, playerDv: 0, impacts: [], honk: false };
    const pb = this.pb;
    pb.speed = playerSpeed;
    this.cruise = cruise;
    // sub-step so fast closing speeds can't tunnel through each other on a slow frame
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.02)));
    const h = dt / steps;

    this.drivePlayer(hits, dt);
    for (const c of this.cars) this.driveCar(c, playerSpeed, dt, cruise);

    for (let k = 0; k < steps; k++) {
      this.integrate(pb, h, 0);
      for (const c of this.cars) this.integrate(c, h, playerSpeed);
      this.collide(hits);
      this.hitBarricades(hits, h);
    }
    hits.playerDv = pb.speed - playerSpeed;

    // render our car: heading, the tail hanging out on hard moves (it lags, so it swings and catches), a little roll
    const heading = -Math.atan2(pb.vx, Math.max(6, pb.speed));
    const slide = pb.crashed ? 0 : Math.min(1, Math.abs(pb.vx) / 9) * (0.15 + this.agg * 1.1);
    this.drift += (Math.max(-0.5, Math.min(0.5, heading * slide * 2.2)) - this.drift) * Math.min(1, dt * 3.5);
    const pg = this.player.group;
    pg.position.set(pb.x, 0, 0);
    pg.rotation.set(0, pb.yaw + this.drift, Math.max(-0.08, Math.min(0.08, pb.vx * 0.012)));
    this.spin(this.player, playerSpeed, dt);
    this.player.underglowMat.opacity = 0.85 + 0.15 * Math.sin(t * 1.3);

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      c.age += dt;
      c.rig.group.position.set(c.x, 0, c.z);
      c.rig.group.rotation.set(0, c.yaw, 0);
      this.spin(c.rig, c.speed, dt);
      if (c.plate) c.plate.mesh.quaternion.copy(camera.quaternion);
      if (c.rig.bar) {
        // a slow, soft sway between red and blue: a glow, never a strobe
        const k = 0.5 + 0.5 * Math.sin(c.age * 3.2), live = c.crashed ? 0.3 : 1;
        c.rig.bar.red.color.setRGB((3 * k + 0.2) * live, 0.08, 0.12);
        c.rig.bar.blue.color.setRGB(0.1, 0.35, (3.2 * (1 - k) + 0.2) * live);
        c.rig.bar.glowMat.color.setRGB((0.9 * k + 0.1) * live, 0.15 * live, (1.0 * (1 - k) + 0.15) * live);
      }
      c.rig.group.visible = this.far + c.z > 2;
      if (c.z > NEAR + 15 || c.z < -this.far - 40) {
        if (c.kind === 'traffic' && c.z > NEAR) hits.passed++;
        if (c.plate) { c.plate.mat.dispose(); c.plate.tex.dispose(); }
        disposeCar(c.rig);
        this.cars.splice(i, 1);
      }
    }

    this.updateBlocks(dt, playerSpeed);
    this.updateGates(dt, playerSpeed);
    return hits;
  }

  // ── drivers ──
  /**
   * Our driver plans in space and time. A few times a second it tries about a
   * hundred moves (anywhere across the road, between lanes and along the curb
   * included, each at cruising speed, with a boost, or braking) and flies each
   * one forward against where every car will be over the next couple of
   * seconds, with our own sideways grip and acceleration. The best clean move
   * wins; lane centres, short moves and not braking are preferred. Barricades
   * count as open road: we smash those.
   *
   * There is always a path. When nothing is clean, frustration builds: gaps it
   * accepts get tighter, it flicks across harder (the tail hangs out), it gets
   * heavier to shove with, braking stops being an option, and the cars in the
   * way are asked to clear it: the outside lanes squeeze onto the curb, others
   * change lanes or floor it.
   */
  private drivePlayer(hits: TrafficHits, dt: number): void {
    const pb = this.pb;
    // a busy network drives a battering ram; having no clean way through makes anyone pushy
    const agg = this.agg = Math.max(this.aggression, Math.min(0.95, this.boxed * 1.1));
    pb.mass = 1.25 + agg * 3;
    if (pb.crashed) return;
    this.planT -= dt;
    if (this.planT <= 0) { this.planT = 0.08; this.replan(agg); }
    this.boxed = this.plan.safe ? Math.max(0, this.boxed - dt * 1.5) : this.boxed + dt;
    if (this.plan.speed < pb.speed - 0.5) hits.speedLimit = this.plan.speed;
    else if (this.plan.speed > this.cruise + 0.5) hits.boost = this.plan.speed - this.cruise;
    hits.honk = this.boxed > 0.6 && this.boxed - dt <= 0.6;
  }

  /** How hard our driver pushes: 0 on a quiet network, 1 when it's slammed. Set by the theme. */
  aggression = 0;

  private replan(agg: number): void {
    const pb = this.pb, H = 1.8, DT = 0.1, N = 18, S = N + 1;
    // where each car that matters will be, step by step (relative to us at our current speed)
    const cars = this.cars.filter((c) => c.z < 60 && c.z > -(pb.speed + 20) * H - 20);
    const cx = new Float32Array(cars.length * S), cz = new Float32Array(cars.length * S);
    cars.forEach((c, i) => {
      const goal = LANES[c.laneNow] + c.pull, rel = pb.speed - c.speed;
      for (let n = 0; n <= N; n++) {
        const t = n * DT;
        if (c.crashed) {
          // a wreck scrubs off speed (so it drops back on us fast) and slides for the shoulder
          const stop = c.speed / 9, tt = Math.min(t, stop);
          cx[i * S + n] = c.x + c.vx * Math.min(t, 1.2) + (Math.sign(c.x || 1) * SHOULDER - c.x) * Math.min(1, t * t * 0.4);
          cz[i * S + n] = c.z + pb.speed * t - (c.speed * tt - 4.5 * tt * tt);
        } else {
          cx[i * S + n] = c.x + Math.max(-5 * t, Math.min(5 * t, goal - c.x));
          cz[i * S + n] = c.z + rel * t;
        }
      }
    });
    const kUp = 0.9 + agg * 1.3, kDown = 6;
    const speeds = [this.cruise, this.cruise + 8 + agg * 10, Math.max(8, Math.min(pb.speed, this.cruise) * 0.6)];
    const maxVx = 9.5 + agg * 6;
    // how close counts as a hit: some breathing room when calm, a coat of paint when it's wild
    const mx = 2 * HALF_W + 0.4 - agg * 0.36, mz = 2 * HALF_L + 2.5 - agg * 1.9;

    type Option = { score: number; x: number; speed: number; mode: number; safe: boolean; blocker: Car | null };
    let best: Option | null = null, bestGo: Option | null = null;
    for (let s = 0; s < speeds.length; s++) {
      const D = speeds[s] - pb.speed, k = D < 0 ? kDown : kUp;
      const shiftAt = (t: number) => D * (t - (1 - Math.exp(-k * t)) / k);   // extra distance our speed change covers
      const shiftH = shiftAt(H), vH = pb.speed + D * (1 - Math.exp(-k * H));
      for (let x = -PLAYER_EDGE; x <= PLAYER_EDGE + 1e-3; x += 0.46) {
        // fly the move
        let px = pb.x, vx = pb.vx, hitT = H, blocker: Car | null = null;
        for (let n = 1; n <= N && !blocker; n++) {
          const want = Math.max(-maxVx, Math.min(maxVx, (x - px) * 3));
          vx += (want - vx) * Math.min(1, DT * 7);
          px += vx * DT;
          const shift = shiftAt(n * DT);
          for (let i = 0; i < cars.length; i++) {
            const j = i * S + n, wreck = cars[i].crashed ? 1.4 : 0;   // a spinning car is as wide as it is long
            if (Math.abs(cx[j] - px) < mx + wreck && Math.abs(cz[j] + shift) < mz + wreck) { hitT = (n - 1) * DT; blocker = cars[i]; break; }
          }
        }
        // past the horizon: how long until we'd run up on whatever is ahead in that line
        let ttc = 8, limiter: Car | null = null;
        for (const c of this.cars) {
          const z = c.z + (pb.speed - c.speed) * H + shiftH;
          const lx = c.crashed ? c.x : LANES[c.laneNow] + c.pull;
          if (z > 0 || Math.abs(lx - x) > mx) continue;
          const closing = vH - c.speed;
          if (closing > 0.3) {
            const tt = Math.max(0, -z - mz) / closing;
            if (tt < ttc) { ttc = tt; limiter = c; }
          }
        }
        let offLane = 9;
        for (const l of LANES) offLane = Math.min(offLane, Math.abs(l - x));
        const safe = !blocker;
        const score = (safe ? 60 : (hitT / H) * 40 - 30)
          + Math.min(ttc, 4) * 6                               // open road ahead (past a few seconds it's all the same)
          - Math.abs(x - pb.x) * (1.6 - agg * 1.1)             // effort: the wilder it gets, the less a long move costs
          - offLane * (2.2 - agg * 1.3)                        // lane centres look like driving
          - (Math.abs(x) > 6.6 ? 5 - agg * 3.5 : 0)            // the curb is for when it's wild
          - (s === 2 ? 26 + agg * 34 : s === 1 ? 3 : 0)        // braking is the last resort, and when it's busy hardly one
          + (Math.abs(x - this.plan.x) < 0.5 ? 3 : 0) + (s === this.plan.mode ? 5 : 0);   // commit to a plan
        const opt: Option = { score, x, speed: speeds[s], mode: s, safe, blocker: blocker ?? (ttc < 3 ? limiter : null) };
        if (!best || score > best.score) best = opt;
        if (s !== 2 && (!bestGo || score > bestGo.score)) bestGo = opt;
      }
    }
    this.plan = { x: best!.x, speed: best!.speed, mode: best!.mode, safe: best!.safe && best!.mode !== 2 };
    this.lastOptions = { best, bestGo };
    // clear the way: whoever stands in the best line that doesn't brake
    const inWay = bestGo?.blocker;
    if (inWay && (!this.plan.safe || inWay.z < 0)) this.clearWay(inWay);
  }

  /** We asked this car to get out of our way. */
  private clearWay(c: Car): void {
    if (c.crashed || c.kind === 'police') return;
    c.clearT = Math.max(c.clearT, 2.5);
  }

  /** A car we asked to clear the way: behind us it lets us in; ahead it squeezes onto the curb, changes lanes, or floors it. */
  private makeWay(c: Car, dt: number): void {
    c.yieldCool = Math.max(0, c.yieldCool - dt);
    if (c.clearT <= 0) {
      // back into its lane once we're clear of it
      if (c.pull && Math.abs(c.z) > 14) c.pull = 0;
      return;
    }
    c.clearT -= dt;
    const pb = this.pb, px = this.plan.x;
    if (c.z > 0) { c.target = Math.min(c.target, pb.speed - 5); return; }
    if (c.pull) return;                                            // already on the curb: we go by on the inside
    const edge = c.laneNow === 0 ? -1 : c.laneNow === 3 ? 1 : 0;
    if (edge && Math.sign(LANES[c.laneNow] - px) !== -edge) { c.pull = edge * PULL; return; }
    if (c.yieldCool <= 0 && Math.abs(c.x - LANES[c.laneNow]) < 0.6) {
      const away = px < c.x ? [c.lane + 1, c.lane - 1] : [c.lane - 1, c.lane + 1];
      for (const l of away) {
        if (l < 0 || l > 3 || Math.abs(LANES[l] - px) < 2.6) continue;
        if (this.laneFree(LANES[l], c.z - 9, c.z + 8, c)) { c.lane = l; c.laneNow = l; c.yieldCool = 2; return; }
      }
    }
    c.target = Math.max(c.target, Math.max(pb.speed, this.cruise) + 5 + this.agg * 8);    // nowhere to go: get out ahead of us
  }

  /** Never fill every lane at one distance: new traffic skips a band that already has three cars. */
  private bandFull(z: number): boolean {
    let lanes = 0;
    for (let l = 0; l < 4; l++) if (!this.laneFree(LANES[l], z - 18, z + 18, null)) lanes++;
    return lanes >= 3;
  }

  /** Every other driver: its script picks a speed and lane; then it follows and overtakes like anyone. */
  private driveCar(c: Car, playerSpeed: number, dt: number, cruise: number): void {
    if (c.crashed) return;
    // scripted cars pace off our cruising speed, never our current one: if we get held up they pull
    // ahead and out of the way, instead of slowing with us into a moving wall
    const pace = Math.max(playerSpeed, cruise);
    if (c.kind === 'rival') {
      const hold = -6;
      if (c.phase === 0) { c.target = pace - Math.min(12, Math.max(1, (hold - c.z) * 0.25)); if (c.z > hold - 1) c.phase = 1; }
      else if (c.phase === 1) { c.target = pace + (c.z - hold) * 0.6 + Math.sin(c.age * 0.9) * 1.2; c.life -= dt; if (c.life <= 0) c.phase = 2; }
      else c.target = pace + 16;
    } else if (c.kind === 'police') {
      const beside = this.playerLane < 2 ? this.playerLane + 1 : this.playerLane - 1;
      const farLane = this.playerLane < 2 ? 3 : 0;
      const hold = -3 + Math.sin(c.age * 0.7) * 1.5;
      if (c.phase === 0) { c.target = pace + Math.min(14, Math.max(3, (c.z - hold) * 0.8)); c.lane = c.z > 0 ? farLane : beside; if (c.z < hold + 1) c.phase = 1; }
      else if (c.phase === 1) { c.target = pace + (c.z - hold) * 0.8; c.lane = beside; c.life -= dt; if (c.life <= 0) c.phase = 2; }
      else c.target = playerSpeed * 0.55;                  // shaken off: falls back
    } else {
      // traffic keeps its own pace (a share of our cruising speed, not of our current
      // speed), so our braking never drags the whole road into a jam
      c.target = cruise * c.ratio;
    }
    this.makeWay(c, dt);

    // scripted cars only cut in when the lane is clear alongside
    if (c.kind === 'rival' || c.kind === 'police') {
      if (c.lane !== c.laneNow && this.laneFree(LANES[c.lane], c.z - 8, c.z + 8, c)) c.laneNow = c.lane;
    } else {
      c.laneNow = c.lane;
    }

    // follow the car (or barricade, or wreck) ahead: overtake if there's room, otherwise brake to its pace
    const ahead = this.roomAhead(c.x, c.z, c);
    if (ahead.gap < 40 && c.target > ahead.speed) {
      let moved = false;
      // anyone not holding a scripted position may overtake (rivals on their way out, police falling back)
      const free = c.kind === 'traffic' || c.kind === 'overtake' || c.phase !== 1;
      if (free && Math.abs(c.x - LANES[c.laneNow]) < 0.5) {
        for (const l of [c.lane - 1, c.lane + 1]) {
          if (l < 0 || l > 3) continue;
          if (this.laneFree(LANES[l], c.z - 14, c.z + 9, c) && this.roomAhead(LANES[l], c.z, c).gap > ahead.gap + 8) {
            c.lane = l; c.laneNow = l; moved = true;
            break;
          }
        }
      }
      if (!moved) c.target = Math.min(c.target, ahead.speed + Math.max(0, ahead.gap - 8) * 0.6);
    }
  }

  // ── physics ──
  private integrate(b: Body, h: number, playerSpeed: number): void {
    const isPlayer = b === this.pb;
    if (b.crashed) {
      // out of control: tyres scrub the speed off, the spin slowly dies, it slides for the shoulder
      b.crashed += h;
      b.speed = Math.max(0, b.speed - (isPlayer ? 5 : 9) * h);
      b.vx *= Math.exp(-h * 1.2);
      b.yawRate *= Math.exp(-h * (isPlayer ? 2.2 : 0.8));
      if (!isPlayer && b.crashed > 0.5) b.vx += (Math.sign(b.x || 1) * SHOULDER - b.x) * 1.6 * h;
      if (isPlayer && b.crashed > 1.4) b.crashed = 0;        // we always catch it
    } else {
      const car = b as Car;
      if (!isPlayer) {
        // gentle on the throttle, firm on the brakes, hard when the gap is closing fast
        const accel = car.target > car.speed ? 6 : car.speed - car.target > 8 ? 22 : 14;
        car.speed += Math.max(-accel * h, Math.min(accel * h, car.target - car.speed));
      }
      const laneX = isPlayer ? this.plan.x : LANES[car.laneNow] + car.pull;
      // we flick across (harder the wilder it gets); traffic drifts over at a civilian pace
      const maxVx = isPlayer ? 9.5 + this.agg * 6 : 5;
      const wantVx = Math.max(-maxVx, Math.min(maxVx, (laneX - b.x) * (isPlayer ? 3 : 1.8)));
      b.vx += (wantVx - b.vx) * Math.min(1, h * (isPlayer ? 7 : 4));
      b.yawRate *= Math.exp(-h * 5);
    }
    // grip turns the car to face where it's going; a spin fights it
    const heading = -Math.atan2(b.vx, Math.max(6, b.speed));
    if (!b.crashed) b.yaw += (heading - b.yaw) * Math.min(1, h * 6);
    b.yaw += b.yawRate * h;

    b.x += b.vx * h;
    if (!isPlayer) b.z += (playerSpeed - b.speed) * h;
    // the curb
    if (Math.abs(b.x) > ROAD_EDGE) {
      b.x = Math.sign(b.x) * ROAD_EDGE;
      b.vx = -b.vx * 0.3;
      b.yawRate *= 0.6;
    }
  }

  private all(): Body[] { return [this.pb, ...this.cars]; }

  /**
   * Box-vs-box contact between every pair (separating axis test on the two
   * cars' footprints): push apart along the shallowest axis, trade momentum,
   * turn off-centre hits into spin.
   */
  private collide(hits: TrafficHits): void {
    const bodies = this.all();
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (Math.abs(a.x - b.x) > 2 * HALF_L || Math.abs(a.z - b.z) > 2 * HALF_L) continue;
        const c = overlap(a, b);
        if (c) this.resolve(a, b, c.nx, c.nz, c.depth, c.px, c.pz, hits);
      }
    }
  }

  private resolve(a: Body, b: Body, nx: number, nz: number, pen: number, px: number, pz: number, hits: TrafficHits): void {
    const pa = a === this.pb, pbb = b === this.pb;
    const wa = 1 / a.mass, wb = 1 / b.mass;
    // a sideways touch means someone was merging into someone: both drivers abort
    // and hold the lane they're actually in, instead of leaning on each other
    if (Math.abs(nx) > Math.abs(nz)) {
      for (const body of [a, b]) {
        if (body.crashed) continue;
        if (body === this.pb) { this.planT = 0; continue; }          // our driver re-plans around it at once
        const nearest = nearestLane(body.x - (body as Car).pull);
        (body as Car).lane = nearest; (body as Car).laneNow = nearest;
      }
    }
    // push apart (our car never moves along the road: the other takes all of that)
    const sx = pen / (wa + wb);
    a.x += nx * sx * wa; b.x -= nx * sx * wb;
    if (pa) b.z -= nz * pen; else if (pbb) a.z += nz * pen;
    else { a.z += nz * sx * wa; b.z -= nz * sx * wb; }

    // velocities in the road plane: (vx, -speed)
    const rvx = a.vx - b.vx, rvz = (-a.speed) - (-b.speed);
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const j = (-(1 + RESTITUTION) * vn) / (wa + wb);
    a.vx += j * nx * wa; a.speed -= j * nz * wa;
    b.vx -= j * nx * wb; b.speed += j * nz * wb;

    // off-centre impulses spin each car: tau = r.z*F.x - r.x*F.z
    const spinA = ((pz - a.z) * (j * nx) - (px - a.x) * (j * nz)) * wa * 0.45;
    const spinB = ((pz - b.z) * (-j * nx) - (px - b.x) * (-j * nz)) * wb * 0.45;
    a.yawRate += spinA; b.yawRate += spinB;

    const strength = j;
    if (strength > 0.8) hits.impacts.push({ x: px, z: pz, strength, player: pa || pbb });
    for (const body of [a, b]) {
      // we lose it on the change in our own speed, so a heavy, wild driver shrugs off what spins a civilian
      const shock = body === this.pb ? j * wa * (pa ? 1 : 0) + j * wb * (pbb ? 1 : 0) : strength;
      if (shock > (body === this.pb ? CRASH * 1.2 : CRASH) && !body.crashed) {
        body.crashed = 0.001;
        body.yawRate += (Math.random() < 0.5 ? -1 : 1) * (body === this.pb ? 1.5 : 2 + Math.random() * 2.5);
      }
    }
    if (this.pb.yawRate > 3) this.pb.yawRate = 3;
    if (this.pb.yawRate < -3) this.pb.yawRate = -3;
    this.pb.speed = Math.max(4, this.pb.speed);
  }

  /** Barricades are solid: whatever hits one smashes it, pays for it in speed, and gets knocked sideways. */
  private hitBarricades(hits: TrafficHits, h: number): void {
    void h;
    for (const bl of this.blocks) {
      if (bl.smashed || bl.z < -40 || bl.z > 40) continue;
      for (const body of this.all()) {
        if (Math.abs(body.z - bl.z) > AXLE + R + 0.6) continue;
        const piece = bl.pieces.find((p) => Math.abs(p.position.x - body.x) < 0.5 + R);
        if (!piece) continue;
        bl.smashed = true;
        hits.smashed++;
        const hitSpeed = Math.max(4, body === this.pb ? body.speed : Math.abs(body.speed - this.pb.speed) + body.speed * 0.3);
        bl.vel = bl.pieces.map((p) => ({
          x: (p.position.x - body.x) * 1.5 + (Math.random() - 0.5) * 5, y: 3 + Math.random() * 5,
          z: -hitSpeed * (0.25 + Math.random() * 0.2), r: (Math.random() - 0.5) * 12,
        }));
        body.speed *= body === this.pb ? 0.8 + this.aggression * 0.15 : 0.5;
        body.vx += (body.x - piece.position.x || (Math.random() - 0.5)) * 2;
        body.yawRate += (Math.random() - 0.5) * (body === this.pb ? 1.6 : 4);
        if (body !== this.pb) body.crashed = body.crashed || 0.001;
        hits.impacts.push({ x: piece.position.x, z: bl.z, strength: CRASH, player: body === this.pb });
        break;
      }
    }
  }

  // ── keeping track of the road ──
  /** Cars count as in the same lane when they're closer than this sideways (m). */
  private static readonly WIDE = 2.3;
  /** Bumper-to-bumper length used for gaps (m). */
  private static readonly LENGTH = 5.2;

  /** The nearest thing ahead of a point in a lane: cars (ours included), wrecks and, unless `blocks` is false, barricades. */
  private roomAhead(x: number, z: number, self: Car | null, blocks = true): { gap: number; speed: number; car: Car | null } {
    let gap = 250, speed = Infinity, car: Car | null = null;
    for (const c of this.cars) {
      if (c === self || Math.abs(c.x - x) > Traffic.WIDE || c.z >= z) continue;
      const g = z - c.z - Traffic.LENGTH;
      if (g < gap) { gap = g; speed = c.speed; car = c; }
    }
    if (self && Math.abs(this.pb.x - x) < Traffic.WIDE && z > 0) {
      const g = z - Traffic.LENGTH;
      if (g < gap) { gap = g; speed = this.pb.speed; car = null; }
    }
    if (blocks) {
      for (const b of this.blocks) {
        if (b.smashed || b.z >= z || !b.lanes.some((l) => Math.abs(LANES[l] - x) < Traffic.WIDE)) continue;
        const g = z - b.z - 3;
        if (g < gap) { gap = g; speed = 0; car = null; }
      }
    }
    return { gap: Math.max(0, gap), speed, car };
  }

  /** True when nothing (ours included) occupies a lane between z0 and z1. */
  private laneFree(x: number, z0: number, z1: number, self: Car | null): boolean {
    for (const c of this.cars) {
      if (c === self) continue;
      const inLane = Math.abs(c.x - x) < Traffic.WIDE || (!c.crashed && Math.abs(LANES[c.laneNow] - x) < Traffic.WIDE);
      if (inLane && c.z > z0 && c.z < z1) return false;
    }
    if (Math.abs(this.pb.x - x) < Traffic.WIDE && 0 > z0 && 0 < z1 && self !== null) return false;
    return true;
  }

  // ── scenery on the road ──
  private updateBlocks(dt: number, playerSpeed: number): void {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      b.z += playerSpeed * dt;
      b.group.position.z = b.z;
      if (b.smashed) {
        b.pieces.forEach((p, k) => {
          const vel = b.vel[k];
          if (!vel) return;
          vel.y -= 18 * dt;
          p.position.x += vel.x * dt;
          p.position.y = Math.max(0, p.position.y + vel.y * dt);
          p.position.z += vel.z * dt;
          if (p.position.y <= 0) { vel.x *= 0.9; vel.z *= 0.9; vel.r *= 0.9; }
          p.rotation.x += vel.r * dt;
          p.rotation.y += vel.r * 0.7 * dt;
        });
        b.glowMat.opacity = Math.max(0, b.glowMat.opacity - dt * 1.5);
      }
      if (b.z > NEAR + 20) {
        b.group.removeFromParent();
        b.glowMat.dispose();
        this.blocks.splice(i, 1);
      }
    }
  }

  /** Gates ease up as they come into view and glow brighter as we drive under. */
  private updateGates(dt: number, playerSpeed: number): void {
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const g = this.gates[i];
      g.z += playerSpeed * dt;
      g.group.position.z = g.z;
      const near = g.z > -60 ? 1.4 : 1;
      g.bright += (g.target * near - g.bright) * Math.min(1, dt * 1.5);
      g.mat.color.set(0xc08cff).multiplyScalar(0.2 + g.bright * 2.4);
      if (g.label) g.label.mat.opacity = Math.min(1, g.bright * 1.2);
      if (g.z > NEAR + 20) {
        g.group.removeFromParent();
        g.mat.dispose();
        g.label?.mat.dispose();
        g.label?.tex.dispose();
        this.gates.splice(i, 1);
      }
    }
  }

  private spin(rig: CarRig, speed: number, dt: number): void {
    for (const w of rig.wheels) w.rotation.x -= (speed / 0.36) * dt;
  }
}
