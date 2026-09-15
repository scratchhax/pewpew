import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry,
  Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Scene, type Texture,
} from 'three';
import { STREETS, TRACE_OFFS, makeRoute, type Board, type Chip, type Route } from './board';

/**
 * Everything that moves on the board: light pulses racing along the traces
 * (streaks with bright heads), red pulses shattering against firewall chips,
 * worms crawling toward a chip while ICE hunts them down, lookup towers
 * scrolling a domain across their LED lids, a pick-and-place arm fitting new
 * parts, antenna rings, glows under chips, and addresses drifting in the air.
 * Nothing blinks: glows and rings ease in and out.
 */

export const COL = {
  allow: new Color(0x5ce6a4), block: new Color(0xff5a5a), dns: new Color(0x55b5ff), dhcp: new Color(0xffd84d),
  wifi: new Color(0xc08cff), threat: new Color(0xff9a45), ice: new Color(0x7ef3ff), target: new Color(0xffb347),
};

const AMBIENT = [new Color(0x2a6a78), new Color(0x3a4a8a), new Color(0x2e7a5a), new Color(0x5a5a7a)];

function streakTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 128, 0, 0);          // bottom = head (v = 0 = the front)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 128);
  const side = g.createLinearGradient(0, 0, 32, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.35, 'rgba(0,0,0,0)'); side.addColorStop(0.65, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side; g.fillRect(0, 0, 32, 128);
  return new CanvasTexture(c);
}

export function glowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

interface Packet {
  route: Route; d: number; speed: number; color: Color; len: number; width: number;
  onEnd?: () => void; alive: boolean; fade: number;
}

interface Shard { pos: Vector3; vel: Vector3; life: number; age: number; color: Color; }

interface Worm {
  route: Route; head: number; speed: number; age: number; chip: Chip | null; dying: number; ice: Packet[]; iced: boolean;
}

interface Glow { mesh: Mesh; mat: MeshBasicMaterial; target: number; level: number; chip: Chip | null; hold: number; }

interface Display { chip: Chip; text: string; age: number; life: number; }

interface Arm { group: Group; part: Mesh; label: Mesh; chip: Chip; age: number; name: string; }

interface Ring { mesh: Mesh; mat: MeshBasicMaterial; age: number; life: number; good: boolean; busy: boolean; }

interface Floater { sprite: Sprite; canvas: HTMLCanvasElement; tex: CanvasTexture; age: number; life: number; vy: number; busy: boolean; }

const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpS = new Vector3(), tmpV = new Vector3(), tmpD = new Vector3(), UP = new Vector3(0, 1, 0);

export class Traffic {
  max = 700;
  speedScale = 1;
  dim = 1;
  private packets: Packet[] = [];
  private mesh: InstancedMesh;
  private shards: Shard[] = [];
  private shardMesh: InstancedMesh;
  private worms: Worm[] = [];
  private wormMesh: InstancedMesh;
  private glows: Glow[] = [];
  private displays: Display[] = [];
  private arms: Arm[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private glowTex = glowTexture();
  private col = new Color();
  private jitterT = 0;
  private jitter: number[] = [];
  onEvent: (name: string, x: number) => void = () => {};

  constructor(private scene: Scene, private board: Board) {
    const quad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(quad, new MeshBasicMaterial({ map: streakTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), 1600);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.shardMesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: this.glowTex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), 500);
    this.shardMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.count = 0;
    scene.add(this.shardMesh);
    this.wormMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0x2a0a06, emissive: 0xff5a1a, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.3 }), 120);
    this.wormMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.wormMesh.frustumCulled = false;
    this.wormMesh.count = 0;
    scene.add(this.wormMesh);
    for (let i = 0; i < 16; i++) this.jitter.push(0);
  }

  get count(): number { return this.packets.length; }

  // ── packets ──────────────────────────────────────────────────────────────
  private launch(route: Route, color: Color, speed: number, len: number, onEnd?: () => void, width = 0.9): Packet | null {
    if (this.packets.length >= this.max) return null;
    const p: Packet = { route, d: 0, speed, color: color.clone(), len, width, onEnd, alive: true, fade: 1 };
    this.packets.push(p);
    return p;
  }

  /** Where the camera is across the board: traffic spawns on the streets in view. */
  camX = 0;

  private streetX(r: () => number = Math.random): number {
    const near = STREETS.filter((s) => Math.abs(s - this.camX) < 75);
    const pool = near.length ? near : STREETS;
    return pool[Math.floor(r() * pool.length)] + TRACE_OFFS[Math.floor(r() * TRACE_OFFS.length)];
  }

  /** Traffic along a street: outbound races ahead from behind the camera, inbound comes at it. */
  flow(color: Color, outbound: boolean, camZ: number, branch = false): void {
    const x = this.streetX();
    if (branch) {
      const routes = this.board.routes(camZ - 30, camZ - 170).filter((rt) => Math.abs(rt.pts[0].x - this.camX) < 80);
      const rt = routes[Math.floor(Math.random() * routes.length)];
      if (rt) {
        const start = new Vector3(rt.pts[0].x, 0.12, outbound ? camZ + 30 : camZ - 260);
        this.launch(makeRoute([start, ...rt.pts], rt.chip), color, 55 + Math.random() * 25, 6 + Math.random() * 4, undefined, 1.05);
        return;
      }
    }
    const z0 = outbound ? camZ + 30 : camZ - 300, z1 = outbound ? camZ - 300 : camZ + 40;
    this.launch(makeRoute([new Vector3(x, 0.12, z0), new Vector3(x, 0.12, z1)]), color, 45 + Math.random() * 40, 6 + Math.random() * 6, undefined, 1.1);
  }

  /** The board's own chatter between events: dim clock and bus pulses, so it's never still. */
  ambient(camZ: number): void {
    const c = AMBIENT[Math.floor(Math.random() * AMBIENT.length)];
    this.flow(c, Math.random() < 0.55, camZ, Math.random() < 0.35);
  }

  /** A blocked packet: runs at a firewall chip ahead and shatters on its pins. */
  strike(camZ: number): void {
    const fws = this.board.chips(camZ - 40, camZ - 170, 'fw').filter((c) => c.routes.length && Math.abs(c.x - this.camX) < 85);
    const chip = fws[Math.floor(Math.random() * fws.length)];
    if (!chip) { this.flow(COL.block, true, camZ); return; }
    const rt = chip.routes[Math.floor(Math.random() * chip.routes.length)];
    const start = new Vector3(rt.pts[0].x, 0.12, camZ + 20);
    const end = rt.pts[rt.pts.length - 1];
    this.launch(makeRoute([start, ...rt.pts], chip), COL.block, 70 + Math.random() * 20, 6, () => {
      this.burst(end, COL.block, 16);
      this.glow(chip, COL.block, 1, 1.4);
      this.onEvent('shatter', end.x);
    });
  }

  // ── worms and ICE ────────────────────────────────────────────────────────
  worm(camZ: number): Chip | null {
    if (this.worms.length >= 4) return null;
    const chips = this.board.chips(camZ - 70, camZ - 160).filter((c) => (c.kind === 'cpu' || c.kind === 'ram' || c.kind === 'ic') && c.routes.length && Math.abs(c.x - this.camX) < 80);
    const chip = chips[Math.floor(Math.random() * chips.length)];
    if (!chip) return null;
    const rt = chip.routes[Math.floor(Math.random() * chip.routes.length)];
    const start = new Vector3(rt.pts[0].x, 0.12, rt.pts[0].z + 45);
    const route = makeRoute([start, ...rt.pts], chip);
    this.worms.push({ route, head: 0, speed: 9, age: 0, chip, dying: -1, ice: [], iced: false });
    this.glow(chip, COL.threat, 0.9, 12);
    this.onEvent('worm', start.x);
    return chip;
  }

  private stepWorms(dt: number): void {
    this.jitterT -= dt;
    if (this.jitterT <= 0) { this.jitterT = 0.09; for (let i = 0; i < this.jitter.length; i++) this.jitter[i] = (Math.random() - 0.5) * 0.35; }
    let n = 0;
    const SEG = 12;
    for (const w of [...this.worms]) {
      w.age += dt;
      if (w.dying < 0) {
        w.head = Math.min(w.route.total, w.head + w.speed * dt);
        // ICE launches from the chip back down the route and hunts the head
        if (!w.iced && w.age > 3) {
          w.iced = true;
          const rev = makeRoute([...w.route.pts].reverse().map((p) => p.clone()), null);
          for (let i = 0; i < 3; i++) {
            const p = this.launch(rev, COL.ice, 30 + i * 6, 3.5, undefined, 0.8);
            if (p) { p.d = -i * 3; w.ice.push(p); }
          }
          this.onEvent('ice', w.route.pts[w.route.pts.length - 1].x);
        }
        for (const p of w.ice) {
          if (p.alive && p.d + w.head >= w.route.total - 1.2) {
            p.alive = false;
            if (w.dying < 0) { w.dying = 0; this.onEvent('kill', this.pointAt(w.route, w.head, tmpV).x); }
          }
        }
        if (w.head >= w.route.total && w.dying < 0) { w.dying = 0; this.onEvent('kill', w.route.pts[w.route.pts.length - 1].x); }
      } else {
        w.dying += dt;
      }
      const alive = w.dying < 0 ? SEG : Math.max(0, SEG - Math.floor(w.dying / 0.09));
      for (let s = 0; s < SEG; s++) {
        const d = w.head - s * 1.25;
        if (d < 0) break;
        this.pointAt(w.route, d, tmpV);
        if (s >= alive) {
          if (w.dying >= 0 && Math.floor((w.dying - dt) / 0.09) < SEG - s && Math.floor(w.dying / 0.09) >= SEG - s) this.burst(tmpV, s % 2 ? COL.threat : COL.ice, 4);
          continue;
        }
        const sc = 1 - s / (SEG * 1.4);
        tmpV.x += this.jitter[s % this.jitter.length] * (w.dying >= 0 ? 3 : 1);
        tmpV.y = 0.45 + Math.sin(w.age * 9 - s * 0.8) * 0.18;
        tmpM.compose(tmpV, tmpQ.identity(), tmpS.set(0.95 * sc, 0.7 * sc, 1.05 * sc));
        this.wormMesh.setMatrixAt(n++, tmpM);
        if (n >= 120) break;
      }
      if (w.dying >= 0 && alive === 0 && w.dying > SEG * 0.09 + 0.2) {
        this.worms.splice(this.worms.indexOf(w), 1);
        if (w.chip) this.glow(w.chip, COL.ice, 0.5, 1);
      }
    }
    this.wormMesh.count = n;
    this.wormMesh.instanceMatrix.needsUpdate = true;
  }

  get wormsAlive(): number { return this.worms.filter((w) => w.dying < 0).length; }

  // ── shards ───────────────────────────────────────────────────────────────
  burst(at: Vector3, color: Color, n: number): void {
    for (let i = 0; i < n && this.shards.length < 480; i++) {
      const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 10;
      this.shards.push({ pos: at.clone().setY(0.3), vel: new Vector3(Math.cos(a) * v, 2 + Math.random() * 6, Math.sin(a) * v), life: 0.5 + Math.random() * 0.5, age: 0, color: color.clone() });
    }
  }

  private stepShards(dt: number): void {
    let n = 0;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.age += dt;
      if (s.age >= s.life) { this.shards.splice(i, 1); continue; }
      s.vel.y -= 14 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.15) { s.pos.y = 0.15; s.vel.y *= -0.3; s.vel.x *= 0.7; s.vel.z *= 0.7; }
      const k = 1 - s.age / s.life;
      tmpM.compose(s.pos, tmpQ.identity(), tmpS.set(0.9 * k + 0.2, 1, 0.9 * k + 0.2));
      this.shardMesh.setMatrixAt(n, tmpM);
      this.shardMesh.setColorAt(n, this.col.copy(s.color).multiplyScalar(k * 2));
      n++;
    }
    this.shardMesh.count = n;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
  }

  // ── glows under chips ────────────────────────────────────────────────────
  glow(chip: Chip, color: Color, level: number, hold: number): void {
    let g = this.glows.find((x) => x.chip === chip) ?? this.glows.find((x) => x.level < 0.01 && x.target === 0);
    if (!g) {
      if (this.glows.length >= 24) g = this.glows[0];
      else {
        const mat = new MeshBasicMaterial({ map: this.glowTex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 });
        const mesh = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
        this.scene.add(mesh);
        g = { mesh, mat, target: 0, level: 0, chip: null, hold: 0 };
        this.glows.push(g);
      }
    }
    g.chip = chip;
    g.mat.color.copy(color);
    g.target = level;
    g.hold = hold;
    g.mesh.position.set(chip.x, 0.2, chip.z);
    g.mesh.scale.set(chip.w * 2.4 + 6, 1, chip.d * 2.4 + 6);
  }

  private stepGlows(dt: number): void {
    for (const g of this.glows) {
      g.hold -= dt;
      const target = g.hold > 0 ? g.target : 0;
      g.level += (target - g.level) * Math.min(1, dt * (target > g.level ? 4 : 1.2));
      g.mat.opacity = g.level;
      g.mesh.visible = g.level > 0.01;
      if (g.chip && !this.board.chunks.has(g.chip.chunk.index)) { g.level = 0; g.target = 0; g.chip = null; g.mesh.visible = false; }
    }
  }

  // ── lookup towers ────────────────────────────────────────────────────────
  lookup(domain: string, camZ: number): boolean {
    const roms = this.board.chips(camZ - 45, camZ - 160, 'rom').filter((c) => c.canvas && Math.abs(c.x - this.camX) < 85 && !this.displays.some((d) => d.chip === c));
    const chip = roms[0];
    if (!chip || !chip.routes.length) return false;
    const rt = chip.routes[Math.floor(Math.random() * chip.routes.length)];
    this.launch(makeRoute([new Vector3(rt.pts[0].x, 0.12, camZ + 20), ...rt.pts], chip), COL.dns, 75, 5, () => {
      this.displays.push({ chip, text: domain.toUpperCase(), age: 0, life: 6 });
      this.glow(chip, COL.dns, 0.55, 5);
      this.onEvent('lookup', chip.x);
    });
    return true;
  }

  private stepDisplays(dt: number): void {
    for (const d of [...this.displays]) {
      d.age += dt;
      const cv = d.chip.canvas!, g = cv.getContext('2d')!, w = cv.width, h = cv.height;
      g.fillStyle = '#050608'; g.fillRect(0, 0, w, h);
      // an LED matrix: 1 dot = 4 px, lit where the scrolling text is
      const cols = Math.floor(w / 5), rows = Math.floor(h / 5);
      const text = `${d.text}  ·  `;
      const px = d.age * 34;
      g.font = `bold ${rows * 5 - 6}px 'Courier New', monospace`;
      const tw = Math.max(1, g.measureText(text).width);
      g.save();
      g.beginPath(); g.rect(0, 0, w, h); g.clip();
      g.fillStyle = '#6fc4ff';
      g.textBaseline = 'middle';
      for (let x = -((px % tw)); x < w; x += tw) g.fillText(text, x, h / 2 + 1);
      g.restore();
      // dot mask: darken the gaps so it reads as LEDs
      g.fillStyle = 'rgba(5,6,8,0.8)';
      for (let c = 0; c <= cols; c++) g.fillRect(c * 5 - 1, 0, 1.6, h);
      for (let r = 0; r <= rows; r++) g.fillRect(0, r * 5 - 1, w, 1.6);
      const fade = Math.min(1, (d.life - d.age) / 0.6);
      if (fade < 1) { g.fillStyle = `rgba(5,6,8,${1 - Math.max(0, fade)})`; g.fillRect(0, 0, w, h); }
      d.chip.tex!.needsUpdate = true;
      if (d.age >= d.life || !this.board.chunks.has(d.chip.chunk.index)) {
        this.displays.splice(this.displays.indexOf(d), 1);
        if (this.board.chunks.has(d.chip.chunk.index)) this.board.etch(d.chip);
      }
    }
  }

  // ── pick and place ───────────────────────────────────────────────────────
  place(name: string, camZ: number): boolean {
    if (this.arms.length >= 3) return false;
    const sockets = this.board.chips(camZ - 55, camZ - 150, 'socket').filter((c) => !c.used && Math.abs(c.x - this.camX) < 85);
    const chip = sockets[0];
    if (!chip) return false;
    chip.used = true;
    const group = new Group();
    const metal = new MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.3 });
    const rail = new Mesh(new BoxGeometry(1.2, 60, 1.2), metal);
    rail.position.y = 30;
    const head = new Mesh(new BoxGeometry(4, 3, 4), new MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.5, roughness: 0.4, emissive: 0x302000 }));
    const nozzle = new Mesh(new CylinderGeometry(0.4, 0.25, 2.2, 10), metal);
    nozzle.position.y = -2.6;
    const lamp = new Mesh(new BoxGeometry(0.8, 0.3, 0.8), new MeshBasicMaterial({ color: COL.dhcp, toneMapped: false }));
    lamp.position.set(1.6, -1.2, 1.6);
    head.add(nozzle, lamp);
    rail.position.y = 31.5;
    group.add(rail, head);
    const part = new Mesh(new BoxGeometry(chip.w, 1.2, chip.d), new MeshStandardMaterial({ color: 0x141518, roughness: 0.6 }));
    part.position.y = -4.3;
    head.add(part);
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#131417'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffd84d'; g.font = "bold 30px 'Courier New', monospace"; g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = name.toUpperCase().slice(0, 14);
    g.fillText(label, 128, 110);
    g.fillStyle = 'rgba(210,210,215,0.6)'; g.font = "20px 'Courier New', monospace"; g.fillText('DHCP LEASE', 128, 150);
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    const top = new Mesh(new PlaneGeometry(chip.w * 0.95, chip.d * 0.95).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: tex, toneMapped: true }));
    top.position.y = 0.62;
    part.add(top);
    group.position.set(chip.x, 0, chip.z);
    this.scene.add(group);
    this.arms.push({ group, part, label: top, chip, age: 0, name });
    this.onEvent('servo', chip.x);
    return true;
  }

  private stepArms(dt: number): void {
    for (const a of [...this.arms]) {
      a.age += dt;
      const head = a.group.children[1] as Mesh;
      const rail = a.group.children[0] as Mesh;
      // down (1.4 s), release, up (1.4 s)
      const y = a.age < 1.4 ? 40 - easeOut(a.age / 1.4) * 34.8 : a.age < 2 ? 5.2 : 5.2 + easeOut((a.age - 2) / 1.4) * 40;
      head.position.y = y;
      rail.position.y = y + 31.5;
      if (a.age >= 1.45 && a.part.parent === head) {
        head.remove(a.part);
        a.part.position.set(a.chip.x, 0.85, a.chip.z);
        this.board.chunks.get(a.chip.chunk.index)?.group.add(a.part);
        this.glow(a.chip, COL.dhcp, 0.7, 1.6);
        this.onEvent('click', a.chip.x);
      }
      if (a.age > 3.6 || !this.board.chunks.has(a.chip.chunk.index)) {
        this.scene.remove(a.group);
        const stranded = a.part.parent !== null && a.part.parent !== this.board.chunks.get(a.chip.chunk.index)?.group;
        a.group.traverse((o) => {
          if (!(o instanceof Mesh) || (!stranded && (o === a.part || o === a.label))) return;
          o.geometry.dispose();
          const m = o.material as MeshStandardMaterial;
          m.map?.dispose();
          m.dispose();
        });
        this.arms.splice(this.arms.indexOf(a), 1);
      }
    }
  }

  // ── antennas ─────────────────────────────────────────────────────────────
  antenna(good: boolean, camZ: number): boolean {
    const ants = this.board.antennas(camZ - 30, camZ - 150).filter((a) => Math.abs(a.x - this.camX) < 85);
    const a = ants[Math.floor(Math.random() * ants.length)];
    if (!a) return false;
    for (let i = 0; i < (good ? 3 : 2); i++) {
      let r = this.rings.find((x) => !x.busy);
      if (!r) {
        if (this.rings.length >= 18) return true;
        const mat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
        const mesh = new Mesh(new RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), mat);
        this.scene.add(mesh);
        r = { mesh, mat, age: 0, life: 1, good, busy: false };
        this.rings.push(r);
      }
      r.mesh.position.set(a.x, 0.3 + i * 0.02, a.z);
      r.mat.color.copy(good ? COL.wifi : COL.block).lerp(COL.wifi, good ? 0 : 0.4);
      r.age = -i * 0.35; r.life = good ? 1.8 : 0.9; r.good = good; r.busy = true; r.mesh.visible = false;
    }
    this.onEvent(good ? 'join' : 'fail', a.x);
    return true;
  }

  private stepRings(dt: number): void {
    for (const r of this.rings) {
      if (!r.busy) continue;
      r.age += dt;
      if (r.age < 0) continue;
      const k = r.age / r.life;
      r.mesh.visible = true;
      r.mesh.scale.setScalar(1 + easeOut(k) * (r.good ? 22 : 9));
      r.mat.opacity = Math.max(0, 1 - k) * (r.good ? 0.9 : 0.7);
      if (k >= 1) { r.busy = false; r.mesh.visible = false; }
    }
  }

  // ── floating text ────────────────────────────────────────────────────────
  float(text: string, camZ: number, color = '#9ff4ff'): void {
    let f = this.floaters.find((x) => !x.busy);
    if (!f) {
      if (this.floaters.length >= 22) return;
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 64;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
      this.scene.add(sprite);
      f = { sprite, canvas, tex, age: 0, life: 1, vy: 1, busy: false };
      this.floaters.push(f);
    }
    const g = f.canvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 64);
    g.font = "bold 40px 'Courier New', monospace";
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text.slice(0, 22), 6, 34);
    f.tex.needsUpdate = true;
    f.sprite.scale.set(10, 1.25, 1);
    f.sprite.position.set(this.camX + (Math.random() - 0.5) * 70, 2.5 + Math.random() * 5, camZ - 45 - Math.random() * 80);
    f.age = 0; f.life = 5 + Math.random() * 3; f.vy = 0.6 + Math.random() * 0.8; f.busy = true; f.sprite.visible = true;
  }

  private stepFloaters(dt: number): void {
    for (const f of this.floaters) {
      if (!f.busy) continue;
      f.age += dt;
      f.sprite.position.y += f.vy * dt;
      const k = f.age / f.life;
      (f.sprite.material as SpriteMaterial).opacity = Math.min(1, f.age / 0.8, (f.life - f.age) / 1.2) * 0.75;
      if (k >= 1) { f.busy = false; f.sprite.visible = false; }
    }
  }

  // ── frame ────────────────────────────────────────────────────────────────
  pointAt(route: Route, d: number, out: Vector3, dir?: Vector3): Vector3 {
    const { pts, lens } = route;
    if (d <= 0) { out.copy(pts[0]); if (dir) dir.copy(pts[1]).sub(pts[0]).normalize(); return out; }
    let i = 1;
    while (i < lens.length - 1 && lens[i] < d) i++;
    const a = pts[i - 1], b = pts[i];
    const seg = Math.max(1e-6, lens[i] - lens[i - 1]);
    const t = Math.min(1, (d - lens[i - 1]) / seg);
    out.copy(a).lerp(b, t);
    if (dir) dir.copy(b).sub(a).normalize();
    return out;
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const p = this.packets[i];
      if (!p.alive) { this.packets.splice(i, 1); continue; }
      p.d += p.speed * this.speedScale * dt;
      if (p.d >= p.route.total) {
        p.alive = false;
        p.onEnd?.();
        this.packets.splice(i, 1);
        continue;
      }
      if (p.d < 0) continue;
      this.pointAt(p.route, p.d, tmpV, tmpD);
      const len = Math.min(p.len, p.d + 0.5);
      tmpV.addScaledVector(tmpD, -len * 0.5 + 0.3);
      tmpQ.setFromAxisAngle(UP, Math.atan2(tmpD.x, tmpD.z));
      tmpM.compose(tmpV, tmpQ, tmpS.set(p.width, 1, len));
      this.mesh.setMatrixAt(n, tmpM);
      this.mesh.setColorAt(n, this.col.copy(p.color).multiplyScalar(2.2 * this.dim));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.stepShards(dt);
    this.stepWorms(dt);
    this.stepGlows(dt);
    this.stepDisplays(dt);
    this.stepArms(dt);
    this.stepRings(dt);
    this.stepFloaters(dt);
  }

  /** Drop everything behind the camera that can never be seen again. */
  cull(camZ: number): void {
    for (const p of this.packets) {
      const end = p.route.pts[p.route.pts.length - 1];
      if (end.z > camZ + 60 && p.route.pts[0].z > camZ + 60) p.alive = false;
    }
  }

  counts(): Record<string, number> {
    return { packets: this.packets.length, shards: this.shards.length, worms: this.worms.length, displays: this.displays.length, arms: this.arms.length };
  }
}
