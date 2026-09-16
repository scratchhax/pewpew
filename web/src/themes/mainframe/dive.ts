import { MeshStandardMaterial, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { AudioCues } from '../../theme';
import { Board, makeRoute, STREETS, type Chip } from './board';
import { BlastDoors, BurnLine, Corruption, ENDINGS, FirewallRing, Ripple, type Ending } from './endings';
import { Flight } from './flight';
import { COL, Traffic } from './traffic';
import type { World } from './world';

/**
 * Diving into a chip. It triggers like Panopticon's eye of god (a burst of
 * threats, a persistent offender, or a random sweep), and runs as one eased
 * sequence of about 30 seconds, with a story: something got in, we find it,
 * and we deal with it:
 *
 *   lock     a chip up ahead is tasked: its lid is re-etched with the target's
 *            address and it glows while the camera lines up
 *   descend  the camera swoops down onto the chip, the lid fades to show the die
 *   through  a gold whiteout and a lattice rushing past: through the silicon
 *   inside   flying low over the die: standard cells, memory macros, copper
 *            buses. Red corruption spreads over the die while a traceroute to
 *            the target types itself out, and INTRUSION TRACED eases in. Then
 *            the counter-measure, one of three, picked at random:
 *              purge       ICE floods the buses and a wave sweeps the die clean
 *              quarantine  blast doors seal the buses, the intruder shatters
 *              counter     a counter-strike launches back up the line
 *   surface  back out through the lattice and up off the chip, where the board
 *            shows what happened (a shockwave, firewall walls around the chip),
 *            or, after a counter-strike, riding it away down the attacker's street
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
/** surface = 0.9 s rising inside the die, then the climb off the chip back to cruising height. */
const EXIT = 3.2;
/** The counter-strike's ride out is a little longer than a plain climb. */
const EXIT_CHASE = 4.8;
const DUR = { lock: 3, descend: 3.2, through: 1.2, inside: 16 };
/** When the counter-measure starts inside the chip (after INTRUSION TRACED). */
const RESOLVE = 9.6;

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
  private innerFlight = Object.assign(new Flight(), { lift: 30 });
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
  /** Where the flight picks up again after a dive (changes once per dive). */
  exitZ = 0;
  exitX = 0;
  exitAlt = 80;
  /** The board flight, so the climb out can end exactly where it will take over. */
  flight: Flight | null = null;
  private cruiseAlt = 80;
  private cruiseSpeed = 26;
  private exitFrom = new Vector3();
  private exitTo = new Vector3();
  private exitLook = new Vector3();
  /** Which ending this dive is building toward; set forceEnding to pick one (diagnostics). */
  ending: Ending = 'purge';
  forceEnding: Ending | null = null;
  private corruption: Corruption | null = null;
  private doors: BlastDoors | null = null;
  private innerRipple: Ripple | null = null;
  private boardRipple: Ripple | null = null;
  private walls: FirewallRing | null = null;
  private spawnMode: 'normal' | 'ice' | 'clean' = 'normal';
  private seedT = 0;
  private chase: Vector3[] = [];
  private chaseLens: number[] = [];
  private burn: BurnLine | null = null;
  private strikeSpeed = 150;
  private get surfaceDur(): number { return 0.9 + (this.ending === 'counter' ? EXIT_CHASE : EXIT); }

  constructor(private world: World, private board: Board, private traffic: Traffic, private audio: AudioCues, overlay: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dive';
    this.el.innerHTML = `
      <div class="dive-top"><span class="dive-tag">DIVE</span><span class="dive-task"></span></div>
      <div class="dive-reticle"><i></i><i></i><i></i><i></i></div>
      <div class="dive-level"></div>
      <div class="dive-status"></div>
      <pre class="dive-trace"></pre>
      <div class="dive-stamp">INTRUSION TRACED</div>`;
    overlay.appendChild(this.el);
    for (const k of ['task', 'reticle', 'level', 'status', 'trace', 'stamp']) this.parts[k] = this.el.querySelector(`.dive-${k}`)!;
  }

  get active(): boolean { return this.phase !== 'idle'; }
  get inside(): boolean { return this.phase === 'inside' || (this.phase === 'through' && this.t > 0.8) || (this.phase === 'surface' && this.t < 0.9); }

  /** Task a chip ahead of the camera. Returns false if there's nothing suitable in view. */
  start(target: DiveTarget, camZ: number, speed = 26): boolean {
    if (this.active) return false;
    // a chip about as far ahead as the camera will naturally travel while it locks on and swoops down
    const reach = speed * 0.85 * (DUR.lock + DUR.descend * 0.8);
    const cands = this.board.chips(camZ - reach + 45, camZ - reach - 45).filter((c) => c.w >= 10 && !c.covered && c.kind !== 'socket' && c.kind !== 'macro' && Math.abs(c.x - this.world.camera.position.x) < 90);
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
    this.cruiseAlt = this.world.camera.position.y;
    this.walls = null;
    this.cruiseSpeed = speed;
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
    this.parts.status.textContent = '';
    this.parts.stamp.classList.remove('on', 'safe', 'hazard');
    this.parts.stamp.textContent = 'INTRUSION TRACED';
    this.ending = this.forceEnding ?? ENDINGS[Math.floor(Math.random() * ENDINGS.length)];
    this.spawnMode = 'normal';
    this.seedT = 0;
    if (!this.corruption) this.corruption = new Corruption(this.world.inner);
    this.corruption.reset();
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
        const T = this.t;
        lens.uDive.value = 1 - clamp01(T / 0.9);
        lens.uZoom.value = 0;
        // slow down for the counter-measure, so it can be watched
        const slow = 1 - 0.55 * clamp01((T - RESOLVE) / 1.2);
        this.innerStep(dt, camera, wanderX, wanderY, 1, 30 * slow);
        const ix = this.innerFlight.x, iz = this.innerFlight.z;
        // the infection spreads over the die ahead of us until the counter-measure starts
        if (T > 0.4 && T < RESOLVE) {
          this.seedT -= dt;
          if (this.seedT <= 0) { this.seedT = 0.22; this.corruption!.seed(ix + (Math.random() - 0.5) * 150, iz - 40 - Math.random() * 170); }
        }
        const rows = Math.min(this.trace.length, Math.floor(Math.max(0, T - 1.2) / 0.75));
        if (rows !== this.shownRows) {
          this.shownRows = rows;
          const t = this.target;
          const lines = [`TRACEROUTE ${t.ip}`, '', ...this.trace.slice(0, rows)];
          if (rows === this.trace.length) lines.push('', `SIGNAL   ${t.signal}`, `CLASS    ${t.klass}`, `CONTACTS ${t.hits} in the last minute`);
          this.parts.trace.textContent = lines.join('\n');
          this.audio.sfx('trace', { count: rows });
        }
        if (T > 1.2 && T - dt <= 1.2) this.status('INTRUSION DETECTED · CORRUPTION SPREADING', 'bad');
        if (T > 8.4 && !this.stamped) { this.stamped = true; this.parts.stamp.classList.add('on'); this.audio.sfx('traced'); }
        this.resolveInside(T, dt, ix, iz);
        this.corruption!.update(dt);
        this.doors?.update(dt);
        this.innerRipple?.update(dt);
        view = { scene: this.world.inner, camera, inside: true, controlsCamera: true };
        if (T >= DUR.inside) { this.phase = 'surface'; this.t = 0; this.audio.sfx('surface'); }
        break;
      }
      case 'surface': {
        const T = this.t;
        if (T < 0.9) {
          lens.uDive.value = clamp01(T / 0.8);
          this.innerStep(dt, camera, wanderX, wanderY, 1, 14);
          this.corruption!.update(dt);
          view = { scene: this.world.inner, camera, inside: true, controlsCamera: true };
        } else {
          if (T - dt < 0.9) this.emerge(chip, top);
          const k = T - 0.9;
          // the purge shockwave goes out once the whiteout has cleared enough to see it
          if (this.ending === 'purge' && k >= 0.7 && k - dt < 0.7) { this.boardRipple = new Ripple(this.world.scene, chip.x, chip.z, COL.ice, 190, 2.4); this.audio.sfx('purge'); }
          if (this.ending === 'counter') this.rideOut(k, dt, camera, chip, top);
          else this.climbOut(k, camera, chip, top);
          lens.uDive.value = 1 - clamp01(k / 0.9);
          this.boardRipple?.update(dt);
          this.walls?.rise(k / (EXIT * 0.8));
          view = { scene: this.world.scene, camera, inside: false, controlsCamera: true };
        }
        if (T >= this.surfaceDur) {
          const lid = chip.top?.material as MeshStandardMaterial | undefined;
          if (lid) { lid.emissive.setRGB(1, 1, 1); lid.emissiveIntensity = 0.55; lid.needsUpdate = true; }
          this.steerX = null;
          this.speedFactor = 1;
          this.exitX = this.exitTo.x;
          this.exitAlt = this.cruiseAlt;
          this.exitZ = this.exitTo.z;       // the flight takes over from here (index watches exitZ)
          this.finish();
        }
        break;
      }
    }
    return view;
  }

  /** The flight inside the die, with the target's traffic streaming along the buses. */
  private status(text: string, tone: 'bad' | 'act' | 'good'): void {
    const el = this.parts.status;
    el.textContent = text;
    el.className = `dive-status ${tone}`;
  }

  /** Swap the stamp for the outcome: fade out, change, ease back in. */
  private restamp(text: string, tone: 'safe' | 'hazard'): void {
    const st = this.parts.stamp;
    st.classList.remove('on');
    setTimeout(() => {
      if (!this.active) return;
      st.textContent = text;
      st.classList.remove('safe', 'hazard');
      st.classList.add(tone, 'on');
    }, 500);
  }

  /** The counter-measure inside the chip, by ending. */
  private resolveInside(T: number, dt: number, ix: number, iz: number): void {
    const at = (t: number) => T >= t && T - dt < t;
    const traffic = this.innerTraffic!;
    if (this.ending === 'purge') {
      if (at(RESOLVE)) { this.status('DEPLOYING ICE', 'act'); this.spawnMode = 'ice'; this.audio.sfx('ice'); }
      if (at(RESOLVE + 0.9)) {
        const cz = iz - 70;
        this.innerRipple = new Ripple(this.world.inner, ix, cz, COL.ice, 260, 2.8);
        this.corruption!.purgeFrom(ix, cz, 260 / 2.8);
        this.status('PURGE WAVE', 'act');
        this.audio.sfx('purge');
      }
      if (at(RESOLVE + 2.4)) { traffic.shatter(COL.target); this.spawnMode = 'clean'; }
      if (at(RESOLVE + 3.4)) { this.restamp('THREAT PURGED', 'safe'); this.status('DIE CLEAN · ALL BUSES NOMINAL', 'good'); this.audio.sfx('purged'); }
    } else if (this.ending === 'quarantine') {
      if (at(RESOLVE)) {
        this.status('SEALING BUSES', 'act');
        const xs = STREETS.filter((x) => Math.abs(x - ix) < 95).sort((p, q) => Math.abs(p - ix) - Math.abs(q - ix));
        this.doors = new BlastDoors(this.world.inner, xs, iz - 95);
        this.doors.onLand = (x, z) => { this.audio.sfx('door', { pan: (x - ix) / 90 }); traffic.burst(new Vector3(x, 0.3, z), COL.threat, 8); };
      }
      if (this.doors?.landed && this.spawnMode === 'normal') {
        this.spawnMode = 'clean';
        traffic.shatter(COL.target);
        this.corruption!.contain();
        this.status('INTRUDER CUT OFF · QUARANTINE HOLDING', 'act');
      }
      if (at(RESOLVE + 2.8)) { this.restamp('QUARANTINED', 'hazard'); this.audio.sfx('sealed'); }
    } else {
      if (at(RESOLVE)) { this.status('COUNTER-TRACE · LOCKING SOURCE', 'act'); this.audio.sfx('lock'); }
      if (at(RESOLVE + 1.2)) {
        this.status('COUNTER-STRIKE AWAY · RIDE IT OUT', 'act');
        this.spawnMode = 'clean';
        for (let i = 0; i < 26; i++) setTimeout(() => { if (this.phase === 'inside') traffic.flow(COL.ice, true, this.innerFlight.z); }, i * 45);
        this.corruption!.drain();
        this.audio.sfx('counter');
      }
    }
  }

  /** Out of the lattice just above the lid: set up what the board shows for this ending. */
  private emerge(chip: Chip, top: Vector3): void {
    this.el.classList.remove('inside');
    this.parts.trace.textContent = '';
    this.parts.level.textContent = '';
    this.doors?.dispose(); this.doors = null;
    this.innerRipple?.dispose(); this.innerRipple = null;
    this.corruption!.reset();
    const ip = this.target?.ip ?? '';
    const lid = chip.top?.material as MeshStandardMaterial | undefined;
    this.exitFrom.set(chip.x, chip.h + 4.5, chip.z + 3.5);
    this.exitTo.set(chip.x, this.cruiseAlt, chip.z + 3.5 - this.cruiseSpeed * EXIT * 0.5);
    if (this.ending === 'purge') {
      this.board.etch(chip, `SECURED ${ip}`, 'safe');
      if (lid) lid.emissive.setRGB(0.7, 1, 1);
      this.traffic.glow(chip, COL.ice, 1, 6);
      this.status('THREAT PURGED · CHIP SECURED', 'good');
      this.audio.sfx('ascend');
    } else if (this.ending === 'quarantine') {
      this.board.etch(chip, 'QUARANTINED', 'hazard');
      if (lid) lid.emissive.setRGB(1, 0.8, 0.5);
      this.traffic.glow(chip, COL.block, 0.9, 30);
      this.walls = new FirewallRing(chip.chunk.group, chip);
      this.status('CHIP QUARANTINED · FIREWALL UP', 'act');
      this.audio.sfx('ascend');
    } else {
      this.board.etch(chip, `BLOCKED ${ip}`, 'safe');
      if (lid) lid.emissive.setRGB(0.7, 1, 1);
      this.traffic.glow(chip, COL.ice, 1, 4);
      // the ride: from the lid, along the chip's trace to its street, and away down the street as the camera climbs
      const rt = chip.routes[0];
      const street = rt ? rt.pts[0] : new Vector3(STREETS.reduce((p, q) => (Math.abs(q - chip.x) < Math.abs(p - chip.x) ? q : p)), 0, chip.z);
      const pin = rt ? rt.pts[rt.pts.length - 1] : new Vector3(chip.x, 0, chip.z);
      this.chase = [
        this.exitFrom.clone(),
        new Vector3(pin.x, 9, pin.z),
        new Vector3(street.x, 12, street.z - 6),
        new Vector3(street.x, this.cruiseAlt, street.z - 300),
      ];
      this.chaseLens = [0];
      for (let i = 1; i < this.chase.length; i++) this.chaseLens.push(this.chaseLens[i - 1] + this.chase[i].distanceTo(this.chase[i - 1]));
      this.exitTo.copy(this.chase[3]);
      // the counter-strike itself: a bright bolt racing ahead along the attacker's route
      const flat = [new Vector3(pin.x, 0.12, pin.z), new Vector3(street.x, 0.12, street.z), new Vector3(street.x, 0.12, street.z - 520)];
      this.traffic.trail(makeRoute(flat), COL.ice, this.strikeSpeed, 22, 3.4);
      // the route catches fire behind the strike as it goes
      this.burn?.dispose();
      this.burn = new BurnLine(this.world.scene, [flat[0], flat[1], new Vector3(street.x, 0.12, street.z - 360)]);
      this.status('COUNTER-STRIKE · FOLLOWING THE LINE', 'act');
      this.audio.sfx('chase');
    }
  }

  /** Purge and quarantine: rise straight off the chip into the flight, seeing the result below. */
  private climbOut(k: number, camera: PerspectiveCamera, chip: Chip, top: Vector3): void {
    const lens = this.world.lens.uniforms;
    const s = clamp01(k / EXIT);
    const up = s * s * (3 - 2 * s);
    camera.position.set(chip.x, this.exitFrom.y + (this.exitTo.y - this.exitFrom.y) * up, this.exitFrom.z + (this.exitTo.z - this.exitFrom.z) * s * s);
    const pose = this.flight ? this.flight.pose(chip.x, this.exitTo.y, camera.position.z, this.cruiseSpeed, this.exitLook) : { y: this.exitTo.y, fov: 58 };
    camera.position.y += (pose.y - this.exitTo.y) * up;
    const b = clamp01(s / 0.85), swing = b * b * (3 - 2 * b);
    this.look.copy(top).lerp(this.exitLook, swing);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    camera.fov = 44 + (pose.fov - 44) * up;
    camera.updateProjectionMatrix();
    lens.uZoom.value = 0.9 * (1 - clamp01(s / 0.6)) ** 2;
    const lid = chip.top?.material as MeshStandardMaterial | undefined;
    if (lid) lid.emissiveIntensity = 0.55 + 1.85 * (1 - up);
  }

  private chaseAt(d: number, out: Vector3): Vector3 {
    const L = this.chaseLens, P = this.chase;
    if (d >= L[L.length - 1]) {
      const last = P[P.length - 1], prev = P[P.length - 2];
      return out.copy(last).addScaledVector(this.tmp.copy(last).sub(prev).normalize(), d - L[L.length - 1]);
    }
    let i = 1;
    while (i < L.length - 1 && L[i] < d) i++;
    const u = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
    return out.copy(P[i - 1]).lerp(P[i], u);
  }

  /** Counter-strike: ride out along the trace and away down the attacker's street, the route burning out behind. */
  private rideOut(k: number, dt: number, camera: PerspectiveCamera, chip: Chip, top: Vector3): void {
    const lens = this.world.lens.uniforms;
    const s = clamp01(k / EXIT_CHASE);
    const total = this.chaseLens[this.chaseLens.length - 1];
    // leaves the lid gently, runs flat out, and eases down to cruising speed as the flight takes over
    const vEnd = this.cruiseSpeed * EXIT_CHASE / Math.max(1, total);
    const f = (3 * s * s - 2 * s * s * s) + vEnd * (s * s * s - s * s);
    const d = total * f;
    this.chaseAt(d, camera.position);
    if (s < 0.6) camera.position.y = Math.max(camera.position.y, this.board.heightAt(camera.position.x, camera.position.z) + 4);
    const ahead = this.chaseAt(d + 45, new Vector3()).setY(0);
    const pose = this.flight ? this.flight.pose(this.exitTo.x, this.exitTo.y, this.exitTo.z, this.cruiseSpeed, this.exitLook) : { y: this.exitTo.y, fov: 58 };
    const fromChip = clamp01(s / 0.25), toFlight = clamp01((s - 0.7) / 0.3);
    this.look.copy(top).lerp(ahead, fromChip * fromChip * (3 - 2 * fromChip)).lerp(this.exitLook, toFlight * toFlight * (3 - 2 * toFlight));
    camera.position.y += (pose.y - this.exitTo.y) * toFlight;
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    camera.fov = 44 + (pose.fov - 44) * clamp01(s * 1.4);
    camera.updateProjectionMatrix();
    lens.uZoom.value = 0.55 * Math.sin(Math.PI * clamp01(s * 1.15));
    const lid = chip.top?.material as MeshStandardMaterial | undefined;
    if (lid) lid.emissiveIntensity = 0.55 + 1.85 * (1 - clamp01(s * 3));
    // the attacker's route burns just behind the strike, ahead of us, and cools as we fly over it
    this.burn?.ignite(this.strikeSpeed * k - 6);
    if (s >= 0.5 && s - dt / EXIT_CHASE < 0.5) { this.restamp('SOURCE BLOCKED', 'safe'); this.status('ATTACKER ROUTE BURNED · SOURCE BLOCKED', 'good'); this.audio.sfx('blocked'); }
  }

  /** Effects that outlive the dive itself (the burning route cooling off). Call every frame. */
  afterglow(dt: number): void {
    if (!this.burn) return;
    this.burn.update(dt);
    if (this.burn.done) { this.burn.dispose(); this.burn = null; }
  }

  private innerStep(dt: number, camera: PerspectiveCamera, wanderX: number, wanderY: number, busy: number, speed = 30): void {
    const board = this.innerBoard!, traffic = this.innerTraffic!;
    this.innerFlight.update(dt, board, camera, { speed, low: 5, wanderX, wanderY });
    board.update(this.innerFlight.z, 5);
    const z = this.innerFlight.z;
    this.spawnT -= dt * busy;
    while (this.spawnT < 0) {
      // while the intruder is loose its traffic streams amber; ICE floods the buses during a purge
      this.spawnT += this.spawnMode === 'ice' ? 0.02 : 0.045;
      const r = Math.random();
      if (this.spawnMode === 'ice') traffic.flow(COL.ice, Math.random() < 0.5, z, Math.random() < 0.5);
      else if (r < 0.3 && this.spawnMode === 'normal') traffic.flow(COL.target, Math.random() < 0.6, z, Math.random() < 0.4);
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
    this.boardRipple?.dispose(); this.boardRipple = null;
    this.doors?.dispose(); this.doors = null;
    this.innerRipple?.dispose(); this.innerRipple = null;
    this.corruption?.reset();
    this.walls = null;
    this.parts.status.textContent = '';
    this.parts.stamp.classList.remove('on');
    this.chip = null;
    this.audio.sfx('duck', { variant: '0' });
  }

  debug(): Record<string, unknown> {
    return { phase: this.phase, t: +this.t.toFixed(2), chip: this.chip?.name, inner: this.innerTraffic?.counts() };
  }
}
