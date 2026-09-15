import { Box3, Mesh, Object3D, PerspectiveCamera, Quaternion, Vector3, type Scene } from 'three';
import type { AudioCues } from '../../theme';
import { R, fmtCoord, type City } from './geo';
import type { Planet } from './planet';
import { Site, type ViewMode } from './site';
import { VIGNETTES } from './vignettes';
import type { World } from './world';

/**
 * The eye of god. A tasking runs as one eased sequence:
 *
 *   acquire  the camera swings round to put the target under it; a reticle closes in
 *   dive     down through the atmosphere into the cloud deck
 *   enhance  out of the cloud over a little scene of someone up to no good,
 *            blocky at first, sharpening in steps as a scan line sweeps
 *   track    boxes lock onto the people, vehicles and objects; the dossier
 *            types itself out; TARGET IDENTIFIED eases in
 *   release  back into the cloud and up to orbit
 */

export interface EyeTarget {
  ip: string;
  city: City;
  district: string;
  reason: 'threat' | 'block' | 'sweep';
  signal: string;
  klass: string;
  hits: number;
  firstSeen: number;
}

type Phase = 'idle' | 'acquire' | 'dive' | 'enhance' | 'track' | 'release';
const DUR: Record<Exclude<Phase, 'idle'>, number> = { acquire: 3, dive: 3.4, enhance: 4.6, track: 16.5, release: 3.2 };
const STEPS = [32, 16, 8, 4, 1];
const D_ORBIT = 360;

const ease = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface EyeView { scene: Scene; camera: PerspectiveCamera; closeUp: boolean; mode: ViewMode | null; }

export class Eye {
  phase: Phase = 'idle';
  private t = 0;
  private target: EyeTarget | null = null;
  private site: Site | null = null;
  private lastVignette = '';
  private el: HTMLElement;
  private parts: Record<string, HTMLElement> = {};
  private boxes = new Map<Object3D, HTMLElement>();
  private dossierText = '';
  private typed = 0;
  private stepShown = -1;
  private stamped = false;
  private locked = new Set<Object3D>();
  private tmp = new Vector3();
  private box = new Box3();
  private q = new Quaternion();
  private fromDir = new Vector3();
  private surfacePt = new Vector3();
  private count = 0;
  shadows = true;
  private modeText = '';
  private part = new Box3();

  constructor(private world: World, private planet: Planet, overlay: HTMLElement, private audio: AudioCues) {
    this.el = document.createElement('div');
    this.el.className = 'eye';
    this.el.innerHTML = `
      <div class="eye-top"><span class="eye-tag">EYE OF GOD</span><span class="eye-task"></span></div>
      <div class="eye-reticle"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="eye-readout"></div>
      <div class="eye-enhance"></div>
      <div class="eye-mode"></div>
      <div class="eye-boxes"></div>
      <pre class="eye-dossier"></pre>
      <div class="eye-stamp">TARGET IDENTIFIED</div>`;
    overlay.appendChild(this.el);
    for (const k of ['top', 'task', 'reticle', 'readout', 'enhance', 'mode', 'boxes', 'dossier', 'stamp']) {
      this.parts[k] = this.el.querySelector(`.eye-${k}`)!;
    }
  }

  get active(): boolean { return this.phase !== 'idle'; }
  get closeUp(): boolean { return this.phase === 'enhance' || this.phase === 'track' || (this.phase === 'release' && this.t < 0.9); }

  start(target: EyeTarget, vignette?: string, force?: ViewMode): void {
    if (this.active) return;
    this.target = target;
    this.count++;
    this.phase = 'acquire';
    this.t = 0;
    this.stepShown = -1;
    this.stamped = false;
    this.typed = 0;
    this.locked.clear();
    // build the scene now, while the camera is still swinging round (so the swap never hitches)
    const pool = VIGNETTES.filter((v) => v.id !== this.lastVignette);
    const v = VIGNETTES.find((x) => x.id === vignette) ?? pool[Math.floor(Math.random() * pool.length)];
    this.lastVignette = v.id;
    const dark = this.planet.daylight(target.city.lat, target.city.lon) < 0.5;
    const mode: ViewMode = force ?? (dark ? (Math.random() < 0.7 ? 'night' : 'thermal')
      : v.nightOnly ? 'thermal' : (Math.random() < 0.75 ? 'day' : 'thermal'));
    this.site?.dispose();
    const lit = force ? force !== 'day' : dark || v.nightOnly;
    this.site = new Site(v, mode, lit, this.shadows, (Math.random() * 1e9) | 0);
    this.el.classList.add('on');
    this.parts.task.textContent = `TASKING EOG-${(4400 + ((this.count * 37) % 600)).toString()} · ${target.ip}`;
    this.modeText = mode === 'thermal' ? 'LWIR · THERMAL · IRONBOW' : mode === 'night' ? 'NIR · NIGHT VISION · GAIN 64' : 'EO · DAYLIGHT · PAN';
    this.dossierText = this.dossier(target, v.activity);
    this.parts.dossier.textContent = '';
    this.parts.stamp.classList.remove('on');
    this.parts.enhance.classList.remove('on');
    this.parts.boxes.replaceChildren();
    this.boxes.clear();
    this.audio.sfx('acquire');
    this.audio.sfx('eyeDuck', { variant: '1' });
  }

  private dossier(t: EyeTarget, activity: string): string {
    const time = new Date(t.firstSeen).toTimeString().slice(0, 8);
    const pad = (k: string) => k.padEnd(12, ' ');
    const conf = (86 + Math.random() * 12).toFixed(1);
    return [
      `${pad('TARGET')}${t.ip}`,
      `${pad('SIGNAL')}${t.signal}`,
      `${pad('CLASS')}${t.klass}`,
      `${pad('LOCATION')}${t.district}, ${t.city.name}`,
      `${pad('')}${t.city.region.name}`,
      `${pad('COORDS')}${fmtCoord(t.city.lat, t.city.lon, 4)}`,
      `${pad('CONTACTS')}${t.hits} in the last minute`,
      `${pad('FIRST SEEN')}${time}`,
      `${pad('ACTIVITY')}${activity}`,
      `${pad('MATCH')}GAIT ${conf}% · ${t.reason === 'sweep' ? 'ROUTINE SWEEP' : 'PRIORITY TASKING'}`,
    ].join('\n');
  }

  /** Advance the sequence. `orbitPos` is where the orbit camera would be right now. Returns what to render. */
  update(dt: number, orbitPos: Vector3, wanderX: number, wanderY: number): EyeView | null {
    if (!this.active || !this.target || !this.site) return null;
    const cam = this.world.camera, lens = this.world.lens.uniforms;
    this.t += dt;
    const city = this.target.city;
    const surf = this.planet.surface(city.lat, city.lon, 0, this.surfacePt);
    const normal = this.tmp.copy(surf).normalize();
    const aspect = window.innerWidth / window.innerHeight;
    lens.uTime.value += dt;
    let view: EyeView | null = null;

    switch (this.phase) {
      case 'acquire': {
        const u = ease(this.t / DUR.acquire);
        this.fromDir.copy(orbitPos).normalize();
        this.q.setFromUnitVectors(this.fromDir, normal);
        const dir = this.fromDir.clone().applyQuaternion(new Quaternion().slerp(this.q, u));
        cam.position.copy(dir).multiplyScalar(D_ORBIT);
        cam.up.set(0, 1, 0);
        cam.lookAt(new Vector3().lerp(surf, u));
        cam.fov = 38;
        this.reticle(surf, 1 - u * 0.6, 1);
        this.readout(city, D_ORBIT - R, 1 + u);
        if (this.t >= DUR.acquire) { this.phase = 'dive'; this.t = 0; this.audio.sfx('dive'); }
        break;
      }
      case 'dive': {
        const u = ease(this.t / DUR.dive);
        const alt = (D_ORBIT - R) * (1 - u) + 7 * u;
        cam.position.copy(normal).multiplyScalar(R + alt);
        cam.lookAt(surf);
        cam.fov = 38 - u * 16;
        lens.uCloud.value = clamp01((42 - alt) / 30);
        lens.uCloudDark.value = this.site.kit.night ? 1 : 0;
        this.reticle(surf, 0.4 - u * 0.2, 1 - u);
        this.readout(city, alt, 2 + u * 10);
        if (this.t >= DUR.dive) { this.phase = 'enhance'; this.t = 0; this.parts.reticle.style.opacity = '0'; this.parts.mode.textContent = this.modeText; }
        break;
      }
      case 'enhance': {
        const step = Math.min(STEPS.length - 1, Math.floor(Math.max(0, this.t - 1.0) / 0.8));
        if (step !== this.stepShown && this.t > 1.0) {
          this.stepShown = step;
          this.parts.enhance.textContent = step >= STEPS.length - 1 ? 'ENHANCE · LOCK' : `ENHANCE ×${2 ** (step + 1)}`;
          this.parts.enhance.classList.add('on');
          this.audio.sfx('enhance', { count: step });
        }
        const inStep = this.t > 1.0 ? ((this.t - 1.0) % 0.8) / 0.8 : 0;
        const px = this.t < 1.0 ? STEPS[0] : STEPS[Math.max(0, step - 1)] + (STEPS[step] - STEPS[Math.max(0, step - 1)]) * ease(inStep * 2.5);
        lens.uPixel.value = Math.max(1, px);
        lens.uScan.value = this.t > 1.0 && inStep < 0.85 ? 1 - inStep / 0.85 : -1;
        lens.uCloud.value = clamp01(1 - this.t / 1.2);
        lens.uModeMix.value = 1;
        lens.uMode.value = this.site.mode === 'day' ? 1 : this.site.mode === 'night' ? 2 : 3;
        lens.uGrain.value = this.site.mode === 'night' ? 0.13 : 0.06;
        const zoom = this.t < 1.0 ? 0 : clamp01((step + ease(inStep * 2)) / (STEPS.length - 1));
        this.site.update(dt, zoom, aspect, wanderX, wanderY);
        this.readout(city, (0.12 + (1 - zoom) * 0.9), 12 + zoom * 88, true);
        view = { scene: this.site.kit.scene, camera: this.site.camera, closeUp: true, mode: this.site.mode };
        if (this.t >= DUR.enhance) {
          this.phase = 'track'; this.t = 0;
          lens.uPixel.value = 1; lens.uScan.value = -1;
          setTimeout(() => this.parts.enhance.classList.remove('on'), 900);
          this.audio.sfx('type', { count: this.dossierText.length });
        }
        break;
      }
      case 'track': {
        this.site.update(dt, 1, aspect, wanderX, wanderY);
        this.typed = Math.min(this.dossierText.length, this.typed + dt * (this.dossierText.length / 3.6));
        const shown = this.dossierText.slice(0, Math.floor(this.typed));
        if (this.parts.dossier.textContent !== shown) this.parts.dossier.textContent = shown;
        this.el.classList.add('dossier');
        if (this.t > 4.6 && !this.stamped) { this.stamped = true; this.parts.stamp.classList.add('on'); this.audio.sfx('stamp'); }
        this.drawBoxes();
        this.readout(city, 0.12, 100, true);
        view = { scene: this.site.kit.scene, camera: this.site.camera, closeUp: true, mode: this.site.mode };
        if (this.t >= DUR.track) { this.phase = 'release'; this.t = 0; this.audio.sfx('release'); this.clearBoxes(); }
        break;
      }
      case 'release': {
        if (this.t < 0.9) {
          this.site.update(dt, 1 - this.t / 0.9 * 0.3, aspect, wanderX, wanderY);
          lens.uCloud.value = clamp01(this.t / 0.8);
          view = { scene: this.site.kit.scene, camera: this.site.camera, closeUp: true, mode: this.site.mode };
        } else {
          const u = ease((this.t - 0.9) / (DUR.release - 0.9));
          lens.uModeMix.value = 0; lens.uMode.value = 0; lens.uGrain.value = 0.03;
          lens.uCloud.value = clamp01(1 - (this.t - 0.9) / 0.9);
          this.fromDir.copy(orbitPos).normalize();
          this.q.setFromUnitVectors(normal, this.fromDir);
          const dir = normal.clone().applyQuaternion(new Quaternion().slerp(this.q, u));
          const alt = 12 + (D_ORBIT - R - 12) * u;
          cam.position.copy(dir).multiplyScalar(R + alt);
          cam.up.set(0, 1, 0);
          cam.lookAt(new Vector3().copy(surf).lerp(new Vector3(0, 0, 0), u));
          cam.fov = 22 + u * 16;
          this.el.classList.remove('dossier');
          this.parts.stamp.classList.remove('on');
          this.parts.mode.textContent = '';
          this.readout(city, alt, 100 - u * 99);
        }
        if (this.t >= DUR.release) this.finish();
        break;
      }
    }
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    return view ?? { scene: this.world.scene, camera: cam, closeUp: false, mode: null };
  }

  private finish(): void {
    const lens = this.world.lens.uniforms;
    lens.uCloud.value = 0; lens.uModeMix.value = 0; lens.uMode.value = 0; lens.uPixel.value = 1; lens.uScan.value = -1; lens.uGrain.value = 0.03;
    this.phase = 'idle';
    this.el.classList.remove('on', 'dossier');
    this.parts.dossier.textContent = '';
    this.site?.dispose();
    this.site = null;
    this.audio.sfx('eyeDuck', { variant: '0' });
  }

  private reticle(p: Vector3, size: number, alpha: number): void {
    const s = this.tmp.copy(p).project(this.world.camera);
    const el = this.parts.reticle;
    const px = (s.x * 0.5 + 0.5) * window.innerWidth, py = (-s.y * 0.5 + 0.5) * window.innerHeight;
    const d = 60 + size * 220;
    el.style.opacity = alpha.toFixed(2);
    el.style.width = el.style.height = `${d.toFixed(0)}px`;
    el.style.transform = `translate(${(px - d / 2).toFixed(1)}px, ${(py - d / 2).toFixed(1)}px)`;
  }

  private readout(city: City, altUnits: number, zoom: number, ground = false): void {
    const km = ground ? altUnits : altUnits * 63.7;
    const txt = `${fmtCoord(city.lat, city.lon, 4)}\nALT ${km >= 10 ? Math.round(km).toLocaleString('en-US') : km.toFixed(2)} KM\nZOOM ${zoom.toFixed(0)}×`;
    if (this.parts.readout.textContent !== txt) this.parts.readout.textContent = txt;
  }

  private drawBoxes(): void {
    if (!this.site) return;
    const cam = this.site.camera, w = window.innerWidth, h = window.innerHeight;
    for (const tr of this.site.script.tracked) {
      let el = this.boxes.get(tr.obj);
      if (!el) {
        el = document.createElement('div');
        el.className = `eye-box ${tr.kind}`;
        el.innerHTML = '<span></span>';
        this.parts.boxes.appendChild(el);
        this.boxes.set(tr.obj, el);
      }
      const shown = this.site.time >= (tr.from ?? 0) && visibleChain(tr.obj);
      if (!shown) { el.style.opacity = '0'; continue; }
      this.bounds(tr.obj);
      if (this.box.isEmpty()) { el.style.opacity = '0'; continue; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const { min, max } = this.box;
      for (let i = 0; i < 8; i++) {
        this.tmp.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(cam);
        const sx = (this.tmp.x * 0.5 + 0.5) * w, sy = (-this.tmp.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      const padX = Math.max(6, (22 - (x1 - x0)) / 2), padY = Math.max(6, (22 - (y1 - y0)) / 2);
      x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
      if (!this.locked.has(tr.obj)) { this.locked.add(tr.obj); this.audio.sfx('lock'); el.dataset.t = String(this.site.time); }
      const since = this.site.time - Number(el.dataset.t ?? 0);
      const conf = Math.min(97.5, 58 + since * 9 + (tr.label.length % 5));
      const text = `${tr.label} · ${conf.toFixed(1)}%`;
      const span = el.firstElementChild as HTMLElement;
      if (span.textContent !== text) span.textContent = text;
      el.style.opacity = '1';
      el.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px)`;
      el.style.width = `${(x1 - x0).toFixed(1)}px`;
      el.style.height = `${(y1 - y0).toFixed(1)}px`;
    }
  }

  /** World bounds of the solid parts only (no headlight washes, glows or light pools). */
  private bounds(obj: Object3D): void {
    this.box.makeEmpty();
    obj.updateWorldMatrix(true, true);
    obj.traverse((o) => {
      if (!(o instanceof Mesh) || o.userData.heat === -1 || !o.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      this.part.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld);
      this.box.union(this.part);
    });
  }

  private clearBoxes(): void {
    for (const el of this.boxes.values()) el.style.opacity = '0';
  }

  debug(): Record<string, unknown> {
    return { phase: this.phase, t: +this.t.toFixed(2), vignette: this.site?.vignette.id, mode: this.site?.mode };
  }
}

function visibleChain(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
