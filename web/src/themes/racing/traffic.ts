import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, SRGBColorSpace, TorusGeometry, type PerspectiveCamera, type Scene, type Texture,
} from 'three';
import { curved, bendAt } from './bend';
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

type Kind = 'traffic' | 'overtake' | 'rival' | 'police';

interface Car {
  rig: CarRig;
  kind: Kind;
  lane: number;
  x: number;
  z: number;
  speed: number;
  age: number;
  phase: number;          // rival/police script phase
  life: number;
  glow: number;           // underglow colour
  plate?: { mesh: Mesh; mat: MeshBasicMaterial; tex: CanvasTexture };
  trail: Mesh[];          // wet-road taillight reflections
}

interface Block {
  group: Group;
  pieces: Mesh[];
  lanes: number[];
  z: number;
  smashed: boolean;
  vel: Array<{ x: number; y: number; z: number; r: number }>;
  age: number;
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

export interface TrafficHits { smashed: number; passed: number }

/**
 * Everything on the road: the player's car and its lane-picking driver,
 * traffic, rivals that pull alongside with a hostname plate, a police chase,
 * roadblocks and Wi-Fi gates. The road scrolls under the player; every other
 * car moves at its own speed relative to that.
 */
export class Traffic {
  player: CarRig;
  playerX = LANES[1];
  private playerLane = 1;
  private playerYaw = 0;
  private cars: Car[] = [];
  private blocks: Block[] = [];
  private gates: Gate[] = [];
  private stripeTex: Texture;
  private streakTex: Texture;
  private trailMat: MeshBasicMaterial;
  private postMat = curved(new MeshStandardMaterial({ color: 0x15151c }));
  private barrierMat: MeshStandardMaterial | null = null;
  maxCars = 20;
  far = 700;
  nitro = 0;

  constructor(private scene: Scene, private glowTex: Texture) {
    this.player = buildCar({ paint: 0x1e2cff, glow: 0x3ff0ff, glowTex });
    scene.add(this.player.group);
    this.stripeTex = stripes();
    this.streakTex = streak();
    this.trailMat = curved(new MeshBasicMaterial({
      map: this.streakTex, color: new Color(2.4, 0.1, 0.15), transparent: true, blending: AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }));
  }

  police(): boolean { return this.cars.some((c) => c.kind === 'police' && c.phase < 2); }
  rivals(): number { return this.cars.filter((c) => c.kind === 'rival').length; }

  // ── spawns ──
  private addCar(kind: Kind, lane: number, z: number, speed: number, glow: number, paint?: number): Car {
    const rig = buildCar({
      paint: paint ?? PAINTS[(Math.random() * PAINTS.length) | 0], glow, glowTex: this.glowTex,
      police: kind === 'police', spoiler: kind !== 'traffic' || Math.random() < 0.3,
    });
    if (kind === 'traffic' || kind === 'overtake') rig.underglowMat.opacity = 0.55;
    this.scene.add(rig.group);
    const trail: Mesh[] = [];
    for (const side of [-0.55, 0.55]) {
      const t = new Mesh(GEO.trail, this.trailMat);
      t.position.set(side, 0.05, 2.25 + 3.3);
      t.renderOrder = 1;
      rig.group.add(t);
      trail.push(t);
    }
    const car: Car = { rig, kind, lane, x: LANES[lane], z, speed, age: 0, phase: 0, life: 0, glow, trail };
    this.cars.push(car);
    return car;
  }

  /** Permitted outbound traffic: a car ahead we'll pass. Inbound: a car coming up from behind to overtake. */
  traffic(color: number, inbound: boolean, playerSpeed: number): void {
    const civil = this.cars.filter((c) => c.kind === 'traffic' || c.kind === 'overtake').length;
    if (civil >= this.maxCars) return;
    const lane = (Math.random() * 4) | 0;
    // overtakers use the lane farthest from ours, so they don't brush past the camera
    if (inbound) this.addCar('overtake', this.playerLane < 2 ? 3 : 0, NEAR - 2, playerSpeed * 1.3, color);
    else this.addCar('traffic', lane, -this.far * (0.7 + Math.random() * 0.25), playerSpeed * (0.45 + Math.random() * 0.25), color);
  }

  /** DHCP: a rival pulls up alongside with the device's name on a plate, then boosts away. */
  rival(name: string, color: number, playerSpeed: number): void {
    const existing = this.cars.find((c) => c.kind === 'rival' && c.plate && (c.plate.mesh.userData.name === name));
    if (existing) { existing.life = Math.max(existing.life, 4); return; }
    if (this.rivals() >= 3) return;
    const lane = this.playerLane < 2 ? this.playerLane + 1 : this.playerLane - 1;
    // appears up ahead; we reel it in until we're side by side
    const car = this.addCar('rival', lane, -90, playerSpeed - 10, color);
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

  /** IDS threat: a black-and-white comes up behind and sits on our bumper while the heat lasts. */
  pursuit(playerSpeed: number): void {
    const cop = this.cars.find((c) => c.kind === 'police' && c.phase < 2);
    if (cop) { cop.life = Math.max(cop.life, 10); return; }
    const car = this.addCar('police', this.playerLane < 2 ? 3 : 0, NEAR + 10, playerSpeed + 18, 0xff2244, 0x0d0f16);
    car.life = 12;
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
    this.blocks.push({ group, pieces, lanes, z, smashed: false, vel: [], age: 0, glowMat });
  }

  /** Wi-Fi: a neon gate over the road. Joins light it up; failures leave it dim and broken. */
  gate(name: string, good: boolean): void {
    if (this.gates.length > 3) return;
    const group = new Group();
    const mat = curved(new MeshBasicMaterial({ color: new Color(0xc08cff).multiplyScalar(good ? 2.4 : 0.9), toneMapped: false, side: DoubleSide }));
    const arch = new Mesh(good ? GEO.arch : GEO.broken, mat);
    arch.position.y = 0;
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
  update(dt: number, t: number, playerSpeed: number, camera: PerspectiveCamera): TrafficHits {
    const hits: TrafficHits = { smashed: 0, passed: 0 };

    // the driver: pick the lane with the most room ahead, glide over to it
    const room = (lane: number) => {
      let clear = 200;
      for (const c of this.cars) if (c.lane === lane && c.z < 2 && c.z > -120 && c.kind === 'traffic') clear = Math.min(clear, -c.z);
      for (const b of this.blocks) if (!b.smashed && b.lanes.includes(lane) && b.z < 2 && b.z > -140) clear = Math.min(clear, -b.z * 0.8);
      return clear;
    };
    const here = room(this.playerLane);
    if (here < 70) {
      let best = this.playerLane, bestRoom = here;
      for (const l of [this.playerLane - 1, this.playerLane + 1]) {
        if (l < 0 || l > 3) continue;
        const r = room(l);
        if (r > bestRoom + 10) { best = l; bestRoom = r; }
      }
      this.playerLane = best;
    }
    const want = LANES[this.playerLane];
    const lateral = Math.max(-7, Math.min(7, (want - this.playerX) * 2.2));
    this.playerX += lateral * dt;
    this.playerYaw += ((-lateral * 0.03) - this.playerYaw) * Math.min(1, dt * 6);
    const pg = this.player.group;
    pg.position.set(this.playerX, 0, 0);
    pg.rotation.set(0, this.playerYaw, lateral * 0.01);
    this.spin(this.player, playerSpeed, dt);
    this.player.underglowMat.opacity = 0.85 + 0.15 * Math.sin(t * 1.3);

    // cars
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      c.age += dt;
      if (c.kind === 'rival') {
        // catch up, hold alongside, then boost away
        // reel it in to our front quarter (a car's length ahead, in full view), duel, then it boosts away
        const hold = -6;
        if (c.phase === 0) { c.speed = playerSpeed - Math.min(12, Math.max(1, (hold - c.z) * 0.25)); if (c.z > hold - 1) c.phase = 1; }
        else if (c.phase === 1) { c.speed = playerSpeed + (c.z - hold) * 0.6 + Math.sin(c.age * 0.9) * 1.2; c.life -= dt; if (c.life <= 0) c.phase = 2; }
        else c.speed += dt * 14;
      } else if (c.kind === 'police') {
        // closes in along the far lane (clear of the camera), then cuts in beside us, just ahead
        const beside = this.playerLane < 2 ? this.playerLane + 1 : this.playerLane - 1;
        const farLane = this.playerLane < 2 ? 3 : 0;
        const hold = -3 + Math.sin(c.age * 0.7) * 1.5;
        if (c.phase === 0) { c.speed = playerSpeed + Math.max(3, (c.z - hold) * 1.2); c.lane = c.z > 0 ? farLane : beside; if (c.z < hold + 1) c.phase = 1; }
        else if (c.phase === 1) {
          c.speed = playerSpeed + (c.z - hold) * 0.8;
          c.lane = beside;
          c.life -= dt;
          if (c.life <= 0) c.phase = 2;
        } else c.speed = Math.max(0, c.speed - dt * 22);   // shaken off: falls back
        if (c.rig.bar) {
          // a slow, soft sway between red and blue: a glow, never a strobe
          const k = 0.5 + 0.5 * Math.sin(c.age * 3.2);
          c.rig.bar.red.color.setRGB(3 * k + 0.2, 0.08, 0.12);
          c.rig.bar.blue.color.setRGB(0.1, 0.35, 3.2 * (1 - k) + 0.2);
          c.rig.bar.glowMat.color.setRGB(0.9 * k + 0.1, 0.15, 1.0 * (1 - k) + 0.15);
        }
      }
      const targetX = LANES[c.lane];
      c.x += (targetX - c.x) * Math.min(1, dt * 2);
      c.z += (playerSpeed - c.speed) * dt;
      c.rig.group.position.set(c.x, 0, c.z);
      this.spin(c.rig, c.speed, dt);
      if (c.plate) c.plate.mesh.quaternion.copy(camera.quaternion);

      // fade in over the horizon, out as they pass
      const fadeFar = Math.min(1, (this.far + c.z) / 80);
      c.rig.group.visible = fadeFar > 0.02;
      if (c.z > NEAR + 15 || c.z < -this.far - 40) {
        if (c.kind === 'traffic' && c.z > NEAR) hits.passed++;
        if (c.plate) { c.plate.mat.dispose(); c.plate.tex.dispose(); }
        disposeCar(c.rig);
        this.cars.splice(i, 1);
      }
    }

    // roadblocks
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      b.age += dt;
      b.z += playerSpeed * dt;
      b.group.position.z = b.z;
      if (!b.smashed && b.z > -2.5 && b.z < 2.5 && b.lanes.some((l) => Math.abs(LANES[l] - this.playerX) < 2.2)) {
        b.smashed = true;
        hits.smashed++;
        b.vel = b.pieces.map((p) => ({
          x: (p.position.x - this.playerX) * 2 + (Math.random() - 0.5) * 6, y: 4 + Math.random() * 5,
          z: -playerSpeed * 0.3 - Math.random() * 10, r: (Math.random() - 0.5) * 12,
        }));
      }
      if (b.smashed) {
        b.pieces.forEach((p, k) => {
          const vel = b.vel[k];
          vel.y -= 18 * dt;
          p.position.x += vel.x * dt;
          p.position.y = Math.max(0, p.position.y + vel.y * dt);
          p.position.z += vel.z * dt;
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

    // gates ease up as they come into view and glow brighter as we drive under
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
    void bendAt;
    return hits;
  }

  private spin(rig: CarRig, speed: number, dt: number): void {
    for (const w of rig.wheels) w.rotation.x -= (speed / 0.36) * dt;
  }
}
