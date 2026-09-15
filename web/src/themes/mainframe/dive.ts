import { MeshStandardMaterial, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { AudioCues } from '../../theme';
import { Board, type Chip } from './board';
import { Flight } from './flight';
import { COL, Traffic } from './traffic';
import type { World } from './world';

/**
 * Diving into a chip. It triggers like Panopticon's eye of god (a burst of
 * threats, a persistent offender, or a random sweep), and runs as one eased
 * sequence of about 23 seconds:
 *
 *   lock     a chip up ahead is tasked: its lid is re-etched with the target's
 *            address and it glows while the camera lines up
 *   descend  the camera swoops down onto the chip, the lid fades to show the die
 *   through  a gold whiteout and a lattice rushing past: through the silicon
 *   inside   flying low over the die: standard cells, memory macros, copper
 *            buses, the target's traffic streaming amber; a traceroute to the
 *            target types itself out and INTRUSION TRACED eases in
 *   surface  back out through the lattice onto the board
 */

export interface DiveTarget {
  ip: string;
  signal: string;
  klass: string;
  hits: number;
  firstSeen: number;
  reason: 'threat' | 'block' | 'sweep';
}

type Phase = 'idle' | 'lock' | 'descend' | 'through' | 'inside' | 'surface';
const DUR = { lock: 3, descend: 3.2, through: 1.2, inside: 13.5, surface: 2.4 };

const ease = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const CARRIERS = ['ironline', 'corvid-ix', 'halcyon', 'bluemoth', 'northgate', 'tessera', 'kestrel', 'ambernet', 'lodestar', 'vantablack'];
const METROS = ['fra', 'ams', 'lon', 'nyc', 'chi', 'sjc', 'sin', 'tyo', 'syd', 'dal', 'mia', 'par', 'waw', 'gru'];

/** A made-up traceroute to the target: plausible hops, latency climbing. */
export function traceroute(ip: string): string[] {
  let h = hash(ip);
  const next = () => { h = Math.imul(h ^ (h >>> 13), 1103515245) + 12345 >>> 0; return h; };
  const rows: string[] = [];
  const n = 6 + (next() % 4);
  let ms = 0.3 + (next() % 7) / 10;
  const row = (i: number, addr: string, name: string) => `${String(i).padStart(2, '0')}  ${addr.padEnd(16)} ${name.padEnd(28).slice(0, 28)} ${ms.toFixed(1).padStart(6)} ms`;
  rows.push(row(1, '192.168.1.1', 'gateway.lan'));
  ms += 6 + (next() % 60) / 10;
  rows.push(row(2, `100.${64 + (next() % 60)}.${next() % 250}.${1 + (next() % 250)}`, 'cgnat.isp-edge.net'));
  for (let i = 3; i < n; i++) {
    ms += 3 + (next() % 180) / 10;
    const carrier = CARRIERS[next() % CARRIERS.length], metro = METROS[next() % METROS.length];
    rows.push(row(i, `${20 + (next() % 200)}.${next() % 250}.${next() % 250}.${1 + (next() % 250)}`, `${metro}-core${1 + (next() % 9)}.${carrier}.net`));
  }
  ms += 4 + (next() % 90) / 10;
  rows.push(row(n, ip, 'TARGET'));
  return rows;
}

/** The silicon under a lid, painted onto the lid itself: a gold lattice of blocks with a hot core, fading in by k. */
function paintDie(cv: HTMLCanvasElement, k: number): void {
  const g = cv.getContext('2d')!, w = cv.width, h = cv.height;
  g.fillStyle = 'rgba(8,5,2,' + (0.25 + k * 0.75).toFixed(2) + ')'; g.fillRect(0, 0, w, h);
  const step = 14;
  for (let y = 10; y < h - 10; y += step) for (let x = 10; x < w - 10; x += step) {
    const d = Math.hypot((x - w / 2) / w, (y - h / 2) / h) * 2;
    g.fillStyle = 'rgba(255,' + Math.round(200 - d * 90) + ',' + Math.round(100 - d * 70) + ',' + (k * (0.95 - d * 0.55)).toFixed(2) + ')';
    g.fillRect(x, y, step - 4, step - 4);
  }
  g.strokeStyle = 'rgba(255,220,150,' + (k * 0.9).toFixed(2) + ')'; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10);
}

export interface DiveView { scene: Scene; camera: PerspectiveCamera; inside: boolean; controlsCamera: boolean; }

export class Dive {
  phase: Phase = 'idle';
  private t = 0;
  private target: DiveTarget | null = null;
  private chip: Chip | null = null;
  private innerBoard: Board | null = null;
  private innerTraffic: Traffic | null = null;
  private innerFlight = Object.assign(new Flight(), { lift: 17 });
  private from = new Vector3();
  private lookOffset = new Vector3();
  private fromUp = new Vector3(0, 1, 0);
  private fromFov = 60;
  private vel = new Vector3();
  private lastPos = new Vector3();
  private velInit = false;
  private look = new Vector3();
  private el: HTMLElement;
  private parts: Record<string, HTMLElement> = {};
  private trace: string[] = [];
  private shownRows = 0;
  private stamped = false;
  private spawnT = 0;
  private floatT = 0;
  private tmp = new Vector3();
  steerX: number | null = null;
  speedFactor = 1;
  detail = 1024;
  maxPackets = 400;
  exitZ = 0;

  constructor(private world: World, private board: Board, private traffic: Traffic, private audio: AudioCues, overlay: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dive';
    this.el.innerHTML = `
      <div class="dive-top"><span class="dive-tag">DIVE</span><span class="dive-task"></span></div>
      <div class="dive-reticle"><i></i><i></i><i></i><i></i></div>
      <div class="dive-level"></div>
      <pre class="dive-trace"></pre>
      <div class="dive-stamp">INTRUSION TRACED</div>`;
    overlay.appendChild(this.el);
    for (const k of ['task', 'reticle', 'level', 'trace', 'stamp']) this.parts[k] = this.el.querySelector(`.dive-${k}`)!;
  }

  get active(): boolean { return this.phase !== 'idle'; }
  get inside(): boolean { return this.phase === 'inside' || (this.phase === 'through' && this.t > 0.8) || (this.phase === 'surface' && this.t < 0.9); }

  /** Task a chip ahead of the camera. Returns false if there's nothing suitable in view. */
  start(target: DiveTarget, camZ: number, speed = 26): boolean {
    if (this.active) return false;
    // a chip about as far ahead as the camera will naturally travel while it locks on and swoops down
    const reach = speed * 0.85 * (DUR.lock + DUR.descend * 0.8);
    const cands = this.board.chips(camZ - reach + 45, camZ - reach - 45).filter((c) => c.w >= 10 && !c.covered && c.kind !== 'socket' && c.kind !== 'macro');
    if (!cands.length) return false;
    const prefer = cands.filter((c) => c.kind === 'cpu' || c.kind === 'fw');
    const pool = prefer.length ? prefer : cands;
    const chip = pool.reduce((a, b) => (Math.abs(b.z - (camZ - reach)) < Math.abs(a.z - (camZ - reach)) ? b : a));
    this.chip = chip;
    this.target = target;
    this.phase = 'lock';
    this.t = 0;
    this.shownRows = 0;
    this.stamped = false;
    this.trace = traceroute(target.ip);
    this.board.etch(chip, target.ip, true);
    this.traffic.glow(chip, COL.target, 1, 30);
    this.steerX = chip.x;
    this.speedFactor = 0.85;
    this.velInit = false;
    // the lid glows with the die as the camera comes down onto it
    const lid = chip.top!.material as MeshStandardMaterial;
    lid.emissive.setRGB(1, 0.78, 0.45);
    lid.emissiveMap = chip.tex!;
    lid.emissiveIntensity = 0;
    lid.needsUpdate = true;
    if (!this.innerBoard) {
      this.innerBoard = new Board(this.world.inner, 'die', this.world.env);
      this.innerTraffic = new Traffic(this.world.inner, this.innerBoard);
    }
    this.innerBoard.detail = this.detail;
    this.innerBoard.words = this.board.words;
    this.innerTraffic!.max = this.maxPackets;
    this.el.classList.add('on');
    this.parts.task.textContent = `TRACING ${target.ip}`;
    this.parts.level.textContent = '';
    this.parts.trace.textContent = '';
    this.parts.stamp.classList.remove('on');
    this.audio.sfx('lock');
    this.audio.sfx('duck', { variant: '1' });
    return true;
  }

  private innerCamZ(): number { return this.innerFlight.z; }

  update(dt: number, camera: PerspectiveCamera, wanderX: number, wanderY: number): DiveView | null {
    if (!this.active || !this.chip || !this.target) return null;
    const lens = this.world.lens.uniforms, chip = this.chip;
    this.t += dt;
    const top = new Vector3(chip.x, chip.h, chip.z);
    let view: DiveView = { scene: this.world.scene, camera, inside: false, controlsCamera: false };
    // keep the die ready while we line up
    if (this.phase === 'lock' || this.phase === 'descend') this.innerBoard!.update(this.innerCamZ(), 5);

    switch (this.phase) {
      case 'lock': {
        this.reticle(top, camera, 1 - this.t / DUR.lock * 0.5);
        // track the flight's real velocity, so the swoop leaves at the same speed and heading
        if (this.velInit && dt > 0) this.vel.lerp(this.tmp.copy(camera.position).sub(this.lastPos).divideScalar(dt), Math.min(1, dt * 4));
        else if (dt > 0) { this.vel.set(0, 0, -20); this.velInit = true; }
        this.lastPos.copy(camera.position);
        if (this.t >= DUR.lock) {
          this.phase = 'descend'; this.t = 0;
          this.from.copy(camera.position);
          this.vel.y = 0;
          const dir = camera.getWorldDirection(this.tmp);
          this.lookOffset.copy(dir).multiplyScalar(camera.position.y / Math.max(0.2, -dir.y));
          this.fromUp.copy(camera.up);
          this.fromFov = camera.fov;
          this.audio.sfx('descend');
        }
        break;
      }
      case 'descend': {
        const s = clamp01(this.t / DUR.descend);
        const u = ease(s);
        // a Hermite curve: it leaves with the flight's own velocity and settles gently above the chip
        const s2 = s * s, s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
        const ex = chip.x, ey = chip.h + 4.5, ez = chip.z + 3.5;
        camera.position.set(
          this.from.x * h00 + this.vel.x * DUR.descend * h10 + ex * h01,
          this.from.y * h00 + ey * h01 - 5 * h11,
          this.from.z * h00 + this.vel.z * DUR.descend * h10 + ez * h01 - 3 * h11,
        );
        // never through a capacitor tower or heat sink on the way down
        if (u < 0.9) {
          let h = 0;
          for (let dx = -4; dx <= 4; dx += 4) for (let dz = -4; dz <= 4; dz += 4) h = Math.max(h, this.board.heightAt(camera.position.x + dx, camera.position.z + dz));
          camera.position.y = Math.max(camera.position.y, h + 4);
        }
        const b = Math.min(1, s / 0.75), blend = b * b * (3 - 2 * b);
        this.look.copy(camera.position).add(this.lookOffset).lerp(top, blend);
        camera.up.copy(this.fromUp).lerp(this.tmp.set(0, 1, 0), Math.min(1, s * 2.5)).normalize();
        camera.lookAt(this.look);
        camera.fov = this.fromFov + (44 - this.fromFov) * u;
        camera.updateProjectionMatrix();
        lens.uZoom.value = clamp01((u - 0.4) / 0.6) * 0.9;
        const lid = chip.top!.material as MeshStandardMaterial;
        const k = clamp01((u - 0.4) / 0.45);
        if (k > 0) { paintDie(chip.canvas!, k); chip.tex!.needsUpdate = true; }
        lid.emissiveIntensity = k * 2.4;
        this.reticle(top, camera, 0.5 - u * 0.4, 1 - u);
        view.controlsCamera = true;
        if (this.t >= DUR.descend) { this.phase = 'through'; this.t = 0; this.audio.sfx('through'); }
        break;
      }
      case 'through': {
        const u = this.t / DUR.through;
        lens.uDive.value = clamp01(u / 0.7);
        lens.uZoom.value = 0.9 * (1 - clamp01((u - 0.7) / 0.3));
        if (this.t < 0.8) {
          camera.position.lerp(this.tmp.set(chip.x, chip.h + 0.6, chip.z + 0.4), Math.min(1, dt * 3));
          camera.lookAt(top);
          view.controlsCamera = true;
        } else {
          if (!view.inside && this.t - dt < 0.8) {
            this.innerFlight.alt = 5;
            this.innerBoard!.fill(this.innerCamZ(), 5);
          }
          this.innerStep(dt, camera, wanderX, wanderY, 0.2);
          view = { scene: this.world.inner, camera, inside: true, controlsCamera: true };
        }
        if (this.t >= DUR.through) {
          this.phase = 'inside'; this.t = 0;
          this.parts.level.textContent = `LEVEL 2 · DIE · ${chip.name}`;
          this.el.classList.add('inside');
        }
        break;
      }
      case 'inside': {
        lens.uDive.value = 1 - clamp01(this.t / 0.9);
        lens.uZoom.value = 0;
        this.innerStep(dt, camera, wanderX, wanderY, 1);
        const rows = Math.min(this.trace.length, Math.floor(Math.max(0, this.t - 1.2) / 0.75));
        if (rows !== this.shownRows) {
          this.shownRows = rows;
          const t = this.target;
          const lines = [`TRACEROUTE ${t.ip}`, '', ...this.trace.slice(0, rows)];
          if (rows === this.trace.length) lines.push('', `SIGNAL   ${t.signal}`, `CLASS    ${t.klass}`, `CONTACTS ${t.hits} in the last minute`);
          this.parts.trace.textContent = lines.join('\n');
          this.audio.sfx('trace', { count: rows });
        }
        if (this.t > 8.4 && !this.stamped) { this.stamped = true; this.parts.stamp.classList.add('on'); this.audio.sfx('traced'); }
        view = { scene: this.world.inner, camera, inside: true, controlsCamera: true };
        if (this.t >= DUR.inside) { this.phase = 'surface'; this.t = 0; this.audio.sfx('surface'); }
        break;
      }
      case 'surface': {
        if (this.t < 0.9) {
          lens.uDive.value = clamp01(this.t / 0.8);
          this.innerStep(dt, camera, wanderX, wanderY, 1);
          view = { scene: this.world.inner, camera, inside: true, controlsCamera: true };
        } else {
          if (this.t - dt < 0.9) {
            this.el.classList.remove('inside');
            this.parts.stamp.classList.remove('on');
            this.parts.trace.textContent = '';
            this.parts.level.textContent = '';
            const lid = chip.top?.material as MeshStandardMaterial | undefined;
            if (lid) { lid.emissiveIntensity = 0; lid.emissiveMap = null; lid.needsUpdate = true; }
            this.exitZ = chip.z - 8;
            this.steerX = null;
            this.speedFactor = 1;
          }
          lens.uDive.value = 1 - clamp01((this.t - 0.9) / 1.2);
          view = { scene: this.world.scene, camera, inside: false, controlsCamera: false };
        }
        if (this.t >= DUR.surface) this.finish();
        break;
      }
    }
    return view;
  }

  /** The flight inside the die, with the target's traffic streaming along the buses. */
  private innerStep(dt: number, camera: PerspectiveCamera, wanderX: number, wanderY: number, busy: number): void {
    const board = this.innerBoard!, traffic = this.innerTraffic!;
    this.innerFlight.update(dt, board, camera, { speed: 40, low: 5, wanderX, wanderY });
    board.update(this.innerFlight.z, 5);
    const z = this.innerFlight.z;
    this.spawnT -= dt * busy;
    while (this.spawnT < 0) {
      this.spawnT += 0.045;
      const r = Math.random();
      if (r < 0.3) traffic.flow(COL.target, Math.random() < 0.6, z, Math.random() < 0.4);
      else traffic.flow(r < 0.65 ? COL.ice : COL.wifi, Math.random() < 0.5, z, Math.random() < 0.3);
    }
    this.floatT -= dt;
    if (this.floatT < 0 && this.target) {
      this.floatT = 1.1;
      traffic.float(Math.random() < 0.6 ? this.target.ip : `0x${((Math.random() * 0xffffffff) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`, z, Math.random() < 0.6 ? '#ffc070' : '#c9b8ff');
    }
    traffic.update(dt);
    traffic.cull(z);
    for (const f of board.fans()) f.rotation.y += dt * 12;
  }

  private reticle(p: Vector3, camera: PerspectiveCamera, size: number, alpha = 1): void {
    const s = this.tmp.copy(p).project(camera);
    const el = this.parts.reticle;
    if (s.z > 1) { el.style.opacity = '0'; return; }
    const px = (s.x * 0.5 + 0.5) * window.innerWidth, py = (-s.y * 0.5 + 0.5) * window.innerHeight;
    const d = 50 + size * 200;
    el.style.opacity = alpha.toFixed(2);
    el.style.width = el.style.height = `${d.toFixed(0)}px`;
    el.style.transform = `translate(${(px - d / 2).toFixed(1)}px, ${(py - d / 2).toFixed(1)}px)`;
  }

  private finish(): void {
    const lens = this.world.lens.uniforms;
    lens.uDive.value = 0; lens.uZoom.value = 0;
    this.phase = 'idle';
    this.el.classList.remove('on', 'inside');
    this.parts.reticle.style.opacity = '0';
    if (this.chip && this.board.chunks.has(this.chip.chunk.index)) this.board.etch(this.chip, `TRACED ${this.target?.ip ?? ''}`, true);
    this.chip = null;
    this.audio.sfx('duck', { variant: '0' });
  }

  debug(): Record<string, unknown> {
    return { phase: this.phase, t: +this.t.toFixed(2), chip: this.chip?.name, inner: this.innerTraffic?.counts() };
  }
}
