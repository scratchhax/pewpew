import {
  AdditiveBlending, AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry,
  DirectionalLight, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial, LineLoop, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Quaternion, RingGeometry, Scene, ShaderMaterial, Sprite,
  SpriteMaterial, Vector3, type Texture,
} from 'three';
import { R, dirOf, type City } from './geo';
import type { Planet } from './planet';

/**
 * Everything in orbit and on the surface that events create: signal arcs
 * between cities (a comet head running a great circle, cut off mid-flight when
 * blocked), rings where things land, tracking markers on attackers, your
 * devices as satellites, uplink beams, and the labels that name them.
 * Everything eases in and out; nothing blinks.
 */

export const COL = {
  allow: new Color(0x5ce6a4), block: new Color(0xff6b6b), dns: new Color(0x55b5ff),
  dhcp: new Color(0xffd84d), wifi: new Color(0xc08cff), threat: new Color(0xff9a45), system: new Color(0x9fb4c8),
  home: new Color(0x7ef3ff),
};

export function glowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

const ARC_N = 72;
const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

interface Arc {
  line: Line; mat: ShaderMaterial; head: Sprite;
  pts: Vector3[]; t: number; dur: number; cut: number; life: number; busy: boolean; onCut?: () => void; cutDone: boolean;
}

interface Ring { mesh: Mesh; mat: MeshBasicMaterial; t: number; life: number; size: number; busy: boolean; }

interface Marker {
  key: string; city: City; group: Group; ring: Mesh; ringMat: MeshBasicMaterial; beamMat: LineBasicMaterial;
  age: number; life: number; fade: number; label: HTMLElement; text: string;
}

export interface Sat {
  name: string; kind: 'device' | 'ap';
  group: Group; glow: Sprite; glowMat: SpriteMaterial; path: LineLoop; pathMat: LineBasicMaterial;
  r: number; incl: number; node: number; phase: number; speed: number;
  heat: number; seen: number; label: HTMLElement; pos: Vector3; born: number;
}

interface Beam { line: Line; mat: LineBasicMaterial; head: Sprite; from: Sat | null; to: Vector3 | null; t: number; life: number; busy: boolean; color: Color; jitter: boolean; }

export class Orbit {
  maxArcs = 40;
  maxSats = 24;
  readonly sats = new Map<string, Sat>();
  private arcs: Arc[] = [];
  private rings: Ring[] = [];
  private markers = new Map<string, Marker>();
  private beams: Beam[] = [];
  private glowTex = glowTexture();
  private ringGeo = new RingGeometry(0.72, 1, 64);
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private homeGroup = new Group();
  private homeLabel: HTMLElement;
  private satBody: { body: BoxGeometry; panel: BoxGeometry; dish: ConeGeometry; mast: CylinderGeometry };
  private mats: { foil: MeshStandardMaterial; panel: MeshStandardMaterial; white: MeshStandardMaterial };
  private clock = 0;
  labelsOn = true;

  constructor(private scene: Scene, private planet: Planet, private overlay: HTMLElement) {
    const sun = new DirectionalLight(0xfff4e6, 2.4);
    sun.position.copy(planet.sunDir).multiplyScalar(500);
    scene.add(sun, new AmbientLight(0x6070a0, 0.25));
    this.satBody = {
      body: new BoxGeometry(1.1, 1.1, 1.7), panel: new BoxGeometry(3.2, 0.05, 1.0),
      dish: new ConeGeometry(0.7, 0.45, 20, 1, true), mast: new CylinderGeometry(0.04, 0.04, 1.2, 6),
    };
    this.mats = {
      foil: new MeshStandardMaterial({ color: 0xc9953c, metalness: 0.55, roughness: 0.38, emissive: 0x2a1a05 }),
      panel: new MeshStandardMaterial({ color: 0x1b2f5c, metalness: 0.4, roughness: 0.3, emissive: 0x050a1a }),
      white: new MeshStandardMaterial({ color: 0xdadde4, metalness: 0.2, roughness: 0.5, emissive: 0x101014, side: DoubleSide }),
    };
    // the ground station: your network
    const home = planet.geo.home;
    const hd = dirOf(home.lat, home.lon);
    const ring = new Mesh(this.ringGeo, new MeshBasicMaterial({ color: COL.home, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    ring.scale.setScalar(1.3);
    const dotM = new Mesh(new RingGeometry(0, 0.35, 24), (ring.material as MeshBasicMaterial).clone());
    this.homeGroup.add(ring, dotM);
    this.homeGroup.position.copy(hd).multiplyScalar(R + 0.15);
    this.homeGroup.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), hd);
    planet.spin.add(this.homeGroup);
    this.homeLabel = this.label(`GROUND STATION · ${home.name.toUpperCase()}`, 'home');
  }

  private label(text: string, cls: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `spy-label ${cls}`;
    el.textContent = text;
    this.overlay.appendChild(el);
    return el;
  }

  // ── arcs ──────────────────────────────────────────────────────────────────
  /** A signal from one city to another; `cut` < 1 stops it part-way (intercepted). */
  arc(from: City, to: City, color: Color, cut = 1, onCut?: () => void): void {
    let a = this.arcs.find((x) => !x.busy);
    if (!a) {
      if (this.arcs.length >= this.maxArcs) {
        a = this.arcs.reduce((p, q) => (q.t / q.life > p.t / p.life ? q : p));
      } else {
        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(new Float32Array(ARC_N * 3), 3));
        const ts = new Float32Array(ARC_N);
        for (let i = 0; i < ARC_N; i++) ts[i] = i / (ARC_N - 1);
        geom.setAttribute('aT', new Float32BufferAttribute(ts, 1));
        const mat = new ShaderMaterial({
          uniforms: { uHead: { value: 0 }, uTail: { value: 0.25 }, uCut: { value: 1 }, uColor: { value: new Color() }, uAlpha: { value: 1 } },
          vertexShader: 'attribute float aT; varying float vT; void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: `precision mediump float; uniform float uHead, uTail, uCut, uAlpha; uniform vec3 uColor; varying float vT;
            void main() {
              if (vT > uCut) discard;
              float comet = smoothstep(uHead - uTail, uHead, vT) * step(vT, uHead);
              float trail = step(vT, uHead) * 0.22;
              gl_FragColor = vec4(uColor * (comet * 1.6 + trail) * uAlpha, 1.0);
            }`,
          transparent: true, blending: AdditiveBlending, depthWrite: false,
        });
        const line = new Line(geom, mat);
        line.frustumCulled = false;
        const head = new Sprite(new SpriteMaterial({ map: this.glowTex, blending: AdditiveBlending, depthWrite: false, transparent: true }));
        head.scale.setScalar(2.6);
        this.planet.spin.add(line, head);
        a = { line, mat, head, pts: Array.from({ length: ARC_N }, () => new Vector3()), t: 0, dur: 1, cut: 1, life: 1, busy: false, cutDone: false };
        this.arcs.push(a);
      }
    }
    const da = dirOf(from.lat, from.lon), db = dirOf(to.lat, to.lon);
    const ang = da.angleTo(db);
    const lift = R * Math.min(0.32, 0.03 + ang * 0.22);
    const pos = a.line.geometry.getAttribute('position') as Float32BufferAttribute;
    const q = new Quaternion(), axis = new Vector3().crossVectors(da, db);
    if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
    axis.normalize();
    for (let i = 0; i < ARC_N; i++) {
      const t = i / (ARC_N - 1);
      q.setFromAxisAngle(axis, ang * t);
      const p = a.pts[i].copy(da).applyQuaternion(q).multiplyScalar(R + 0.3 + lift * Math.sin(Math.PI * t));
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    a.dur = 1.1 + ang * 1.1;
    a.cut = cut;
    a.life = a.dur * Math.min(1, cut) + 1.6;
    a.t = 0;
    a.busy = true;
    a.cutDone = false;
    a.onCut = cut < 1 ? onCut : undefined;
    a.mat.uniforms.uColor.value.copy(color);
    a.mat.uniforms.uCut.value = cut;
    a.mat.uniforms.uTail.value = Math.min(0.35, 0.08 + 0.5 / Math.max(1, ang * 10));
    (a.head.material as SpriteMaterial).color.copy(color).multiplyScalar(1.6);
    a.line.visible = a.head.visible = true;
  }

  private stepArcs(dt: number): void {
    for (const a of this.arcs) {
      if (!a.busy) continue;
      a.t += dt;
      const travel = Math.min(a.cut, easeOut(a.t / a.dur) * 1.0);
      const headT = Math.min(a.cut, a.t / a.dur);
      a.mat.uniforms.uHead.value = headT >= a.cut ? a.cut : travel;
      const fade = a.t > a.life - 1.2 ? Math.max(0, (a.life - a.t) / 1.2) : 1;
      a.mat.uniforms.uAlpha.value = fade;
      const idx = Math.min(ARC_N - 1, Math.floor(Math.min(1, a.mat.uniforms.uHead.value) * (ARC_N - 1)));
      a.head.position.copy(a.pts[idx]);
      (a.head.material as SpriteMaterial).opacity = fade * (headT >= a.cut && a.cut >= 1 ? Math.max(0, 1 - (a.t - a.dur) * 2) : 1);
      if (a.cut < 1 && headT >= a.cut && !a.cutDone) {
        a.cutDone = true;
        a.onCut?.();
        this.burstAt(a.pts[idx], COL.block);
      }
      if (a.t >= a.life) { a.busy = false; a.line.visible = a.head.visible = false; }
    }
  }

  // ── rings ─────────────────────────────────────────────────────────────────
  /** An expanding ring on the surface (or at a planet-local point). */
  ping(city: City, color: Color, size = 3.5, life = 1.6): void {
    const d = dirOf(city.lat, city.lon);
    this.ringAt(d.clone().multiplyScalar(R + 0.2), d, color, size, life);
  }

  private burstAt(p: Vector3, color: Color): void {
    this.ringAt(p, p.clone().normalize(), color, 2.2, 1.1);
  }

  private ringAt(p: Vector3, normal: Vector3, color: Color, size: number, life: number): void {
    let r = this.rings.find((x) => !x.busy);
    if (!r) {
      if (this.rings.length > 60) r = this.rings[0];
      else {
        const mat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
        const mesh = new Mesh(this.ringGeo, mat);
        this.planet.spin.add(mesh);
        r = { mesh, mat, t: 0, life: 1, size: 1, busy: false };
        this.rings.push(r);
      }
    }
    r.mesh.position.copy(p);
    r.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    r.mat.color.copy(color);
    r.t = 0; r.life = life; r.size = size; r.busy = true; r.mesh.visible = true;
  }

  private stepRings(dt: number): void {
    for (const r of this.rings) {
      if (!r.busy) continue;
      r.t += dt;
      const k = r.t / r.life;
      r.mesh.scale.setScalar(0.2 + easeOut(k) * r.size);
      r.mat.opacity = Math.max(0, 1 - k) * 0.9;
      if (k >= 1) { r.busy = false; r.mesh.visible = false; }
    }
  }

  // ── tracking markers ──────────────────────────────────────────────────────
  track(key: string, city: City, text: string, life = 45): void {
    let m = this.markers.get(key);
    if (!m) {
      if (this.markers.size >= 12) {
        const oldest = [...this.markers.values()].reduce((a, b) => (b.age > a.age ? b : a));
        this.dropMarker(oldest);
      }
      const d = dirOf(city.lat, city.lon);
      const group = new Group();
      group.position.copy(d).multiplyScalar(R + 0.2);
      group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), d);
      const ringMat = new MeshBasicMaterial({ color: COL.threat, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, opacity: 0 });
      const ring = new Mesh(this.ringGeo, ringMat);
      const inner = new Mesh(new RingGeometry(0.9, 1, 4), ringMat);
      inner.scale.setScalar(1.4);
      const beamGeo = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, 7)]);
      const beamMat = new LineBasicMaterial({ color: COL.threat, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
      group.add(ring, inner, new Line(beamGeo, beamMat));
      this.planet.spin.add(group);
      m = { key, city, group, ring, ringMat, beamMat, age: 0, life, fade: 0, label: this.label(text, 'track'), text };
      this.markers.set(key, m);
    }
    m.age = 0;
    m.life = life;
    if (m.text !== text) { m.text = text; m.label.textContent = text; }
  }

  private dropMarker(m: Marker): void {
    this.planet.spin.remove(m.group);
    m.group.traverse((o) => { if (o instanceof Mesh || o instanceof Line) { if (o.geometry !== this.ringGeo) o.geometry.dispose(); } });
    m.ringMat.dispose();
    m.beamMat.dispose();
    m.label.remove();
    this.markers.delete(m.key);
  }

  private stepMarkers(dt: number): void {
    for (const m of [...this.markers.values()]) {
      m.age += dt;
      const target = m.age < m.life ? 1 : 0;
      m.fade += (target - m.fade) * Math.min(1, dt * 1.5);
      const breathe = 0.75 + 0.25 * Math.sin(this.clock * 2.2 + m.city.lat * 10);
      m.ringMat.opacity = m.fade * 0.85 * breathe;
      m.beamMat.opacity = m.fade * 0.6;
      m.ring.scale.setScalar(2.2 + Math.sin(this.clock * 1.3) * 0.25);
      if (m.age > m.life && m.fade < 0.02) this.dropMarker(m);
    }
  }

  // ── satellites ────────────────────────────────────────────────────────────
  satellite(name: string, kind: 'device' | 'ap'): Sat {
    let s = this.sats.get(name);
    if (s) { s.heat = 1; s.seen = this.clock; return s; }
    if (this.sats.size >= this.maxSats) {
      const stale = [...this.sats.values()].reduce((a, b) => (b.seen < a.seen ? b : a));
      this.dropSat(stale);
    }
    const group = new Group();
    const body = new Mesh(this.satBody.body, this.mats.foil);
    const pl = new Mesh(this.satBody.panel, this.mats.panel), pr = pl.clone();
    pl.position.x = -2.2; pr.position.x = 2.2;
    group.add(body, pl, pr);
    if (kind === 'ap') {
      const dish = new Mesh(this.satBody.dish, this.mats.white);
      dish.rotation.x = -Math.PI / 2; dish.position.z = -1.2;
      group.add(dish);
    } else {
      const mast = new Mesh(this.satBody.mast, this.mats.white);
      mast.rotation.x = Math.PI / 2; mast.position.z = -1.3;
      group.add(mast);
    }
    const color = kind === 'ap' ? COL.wifi : COL.dhcp;
    const glowMat = new SpriteMaterial({ map: this.glowTex, color: color.clone(), blending: AdditiveBlending, depthWrite: false, transparent: true });
    const glow = new Sprite(glowMat);
    glow.scale.setScalar(6);
    group.add(glow);
    group.scale.setScalar(kind === 'ap' ? 0.9 : 0.7);
    const h = hashName(name);
    const r = R * (kind === 'ap' ? 1.22 + (h % 7) * 0.02 : 1.36 + (h % 23) * 0.017);
    const incl = ((h >>> 3) % 1000) / 1000 * 1.3 - 0.65 + (kind === 'ap' ? 0 : 0.2);
    const node = ((h >>> 11) % 1000) / 1000 * Math.PI * 2;
    const pts: Vector3[] = [];
    for (let i = 0; i < 128; i++) pts.push(orbitPoint(r, incl, node, (i / 128) * Math.PI * 2, new Vector3()));
    const pathMat = new LineBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    const path = new LineLoop(new BufferGeometry().setFromPoints(pts), pathMat);
    this.scene.add(group, path);
    s = {
      name, kind, group, glow, glowMat, path, pathMat, r, incl, node,
      phase: ((h >>> 17) % 1000) / 1000 * Math.PI * 2, speed: (0.05 + ((h >>> 5) % 100) / 100 * 0.05) * (R * 1.3 / r) ** 1.5,
      heat: 1, seen: this.clock, label: this.label(name.toUpperCase(), kind), pos: new Vector3(), born: this.clock,
    };
    this.sats.set(name, s);
    return s;
  }

  private dropSat(s: Sat): void {
    this.scene.remove(s.group, s.path);
    s.path.geometry.dispose();
    s.label.remove();
    this.sats.delete(s.name);
  }

  /** A new device: a launch trail from the ground station up to its orbit. */
  launch(s: Sat): void {
    const home = this.planet.surface(this.planet.geo.home.lat, this.planet.geo.home.lon, 0.5);
    this.beam(null, s, COL.dhcp, home, false, 2.2);
  }

  // ── beams ─────────────────────────────────────────────────────────────────
  /** A beam between a satellite and the ground station (`up` = from the ground). */
  beam(from: Sat | null, to: Sat | null, color: Color, ground: Vector3 | null = null, jitter = false, life = 1.3): void {
    let b = this.beams.find((x) => !x.busy);
    if (!b) {
      if (this.beams.length > 24) b = this.beams[0];
      else {
        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(new Float32Array(2 * 3 * 8), 3));
        const mat = new LineBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false });
        const line = new Line(geom, mat);
        line.frustumCulled = false;
        const head = new Sprite(new SpriteMaterial({ map: this.glowTex, blending: AdditiveBlending, depthWrite: false, transparent: true }));
        head.scale.setScalar(2.2);
        this.scene.add(line, head);
        b = { line, mat, head, from: null, to: null, t: 0, life: 1, busy: false, color: new Color(), jitter: false };
        this.beams.push(b);
      }
    }
    b.from = from ?? to;
    b.to = ground;
    b.t = 0; b.life = life; b.busy = true; b.jitter = jitter;
    b.color.copy(color);
    b.mat.color.copy(color);
    (b.head.material as SpriteMaterial).color.copy(color).multiplyScalar(1.5);
    b.line.visible = b.head.visible = true;
    (b as Beam & { up: boolean }).up = !from;
  }

  private stepBeams(dt: number): void {
    const home = this.planet.surface(this.planet.geo.home.lat, this.planet.geo.home.lon, 0.4, this.tmp2);
    for (const b of this.beams) {
      if (!b.busy) continue;
      b.t += dt;
      const sat = b.from!;
      const g = b.to ?? home;
      if (b.to) b.to.copy(home);
      const pos = b.line.geometry.getAttribute('position') as Float32BufferAttribute;
      const up = (b as Beam & { up: boolean }).up;
      for (let i = 0; i < 8; i++) {
        const k = i / 7;
        this.tmp.copy(g).lerp(sat.pos, k);
        if (b.jitter) this.tmp.addScaledVector(randDir(), Math.sin(k * Math.PI) * 0.9 * Math.random());
        pos.setXYZ(i, this.tmp.x, this.tmp.y, this.tmp.z);
      }
      pos.needsUpdate = true;
      const k = b.t / b.life;
      b.mat.opacity = Math.max(0, 1 - k) * (b.jitter ? 0.55 : 0.8);
      const travel = easeOut(Math.min(1, b.t / (b.life * 0.6)));
      b.head.position.copy(up ? g : sat.pos).lerp(up ? sat.pos : g, travel);
      (b.head.material as SpriteMaterial).opacity = Math.max(0, 1 - k);
      if (k >= 1) { b.busy = false; b.line.visible = b.head.visible = false; }
    }
  }

  /** The closest satellite to the ground station (for an uplink), or null. */
  nearestSat(): Sat | null {
    const home = this.planet.surface(this.planet.geo.home.lat, this.planet.geo.home.lon, 0, this.tmp2);
    let best: Sat | null = null, bd = Infinity;
    for (const s of this.sats.values()) {
      const d = s.pos.distanceToSquared(home);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  update(dt: number, camera: PerspectiveCamera, showLabels: boolean): void {
    this.clock += dt;
    for (const s of this.sats.values()) {
      s.phase += s.speed * dt;
      orbitPoint(s.r, s.incl, s.node, s.phase, s.pos);
      s.group.position.copy(s.pos);
      s.group.lookAt(0, 0, 0);
      s.heat = Math.max(0, s.heat - dt * 0.25);
      s.glowMat.opacity = 0.35 + s.heat * 0.65;
      s.pathMat.opacity = 0.012 + s.heat * 0.09 + Math.max(0, 1 - (this.clock - s.born) / 6) * 0.14;
    }
    this.stepArcs(dt);
    this.stepRings(dt);
    this.stepMarkers(dt);
    this.stepBeams(dt);
    this.placeLabels(camera, showLabels);
  }

  private placeLabels(camera: PerspectiveCamera, show: boolean): void {
    const w = window.innerWidth, h = window.innerHeight;
    const put = (el: HTMLElement, p: Vector3, alpha: number, surface: boolean) => {
      const vis = show && alpha > 0.02 && !this.hidden(p, camera, surface);
      if (!vis) { if (el.style.opacity !== '0') el.style.opacity = '0'; return; }
      this.tmp.copy(p).project(camera);
      if (this.tmp.z > 1) { el.style.opacity = '0'; return; }
      el.style.opacity = alpha.toFixed(2);
      el.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    };
    const home = this.planet.geo.home;
    put(this.homeLabel, this.planet.surface(home.lat, home.lon, 0.5, new Vector3()), 0.9, true);
    for (const m of this.markers.values()) put(m.label, this.planet.surface(m.city.lat, m.city.lon, 7, new Vector3()), m.fade, true);
    for (const s of this.sats.values()) put(s.label, s.pos, 0.35 + s.heat * 0.6, false);
  }

  /** Behind the planet from the camera's point of view. */
  private hidden(p: Vector3, camera: PerspectiveCamera, surface: boolean): boolean {
    const c = camera.position;
    if (surface) return this.tmp.copy(p).normalize().dot(this.tmp2.copy(c).sub(p)) < 0;
    const v = this.tmp.copy(p).sub(c);
    const len2 = v.lengthSq();
    const t = Math.max(0, Math.min(1, -c.dot(v) / len2));
    const closest = this.tmp2.copy(c).addScaledVector(v, t);
    return t < 1 && closest.length() < R;
  }

  hideLabels(): void {
    for (const el of this.overlay.querySelectorAll<HTMLElement>('.spy-label')) el.style.opacity = '0';
  }

  counts(): Record<string, number> {
    return { arcs: this.arcs.filter((a) => a.busy).length, sats: this.sats.size, markers: this.markers.size, beams: this.beams.filter((b) => b.busy).length };
  }
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function orbitPoint(r: number, incl: number, node: number, a: number, out: Vector3): Vector3 {
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  // tilt by the inclination about X, then swing the node about Y
  const y1 = -z * Math.sin(incl), z1 = z * Math.cos(incl);
  return out.set(x * Math.cos(node) + z1 * Math.sin(node), y1, -x * Math.sin(node) + z1 * Math.cos(node));
}

const _rd = new Vector3();
function randDir(): Vector3 {
  return _rd.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}
