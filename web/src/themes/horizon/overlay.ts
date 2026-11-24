import { AdditiveBlending, BufferAttribute, BufferGeometry, LineLoop, ShaderMaterial, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { Moon } from './bodies';

/**
 * Instrument graphics over the render: hairline orbit traces for the moons
 * and small labels that follow whatever they name. These are deliberately
 * NOT lensed: they read as the observatory's annotations, not as objects in
 * space. An orbit fades where it passes behind the hole, so a line never
 * cuts across the shadow, and every label eases in and out.
 */
const SEG = 160;

const orbitMat = () => new ShaderMaterial({
  uniforms: { uAlpha: { value: 0 }, uColor: { value: [0.75, 0.86, 1.0] } },
  vertexShader: /* glsl */`
    varying float vFade;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec3 toP = wp.xyz - cameraPosition;
      vec3 toH = -cameraPosition;
      float along = dot(toP, toH) / dot(toH, toH);
      float miss = length(cross(toP, toH)) / length(toP);
      float behind = smoothstep(0.92, 1.05, along);
      vFade = mix(1.0, smoothstep(2.8, 6.5, miss), behind);
      // the near side of the orbit is a touch brighter than the far side
      vFade *= mix(1.0, 0.55, smoothstep(0.85, 1.25, along));
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float uAlpha;
    uniform vec3 uColor;
    varying float vFade;
    void main() { gl_FragColor = vec4(uColor * uAlpha * vFade, 1.0); }`,
  blending: AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
});

export class Orbits {
  private lines = new Map<Moon, LineLoop>();
  enabled = true;
  private level = 0;

  constructor(private scene: Scene) {}

  update(moons: Moon[], dt: number): void {
    this.level += ((this.enabled ? 1 : 0) - this.level) * Math.min(1, dt * 1.5);
    for (const m of moons) {
      if (this.lines.has(m)) continue;
      const pos = new Float32Array(SEG * 3);
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const p = m.axisA.clone().multiplyScalar(Math.cos(a) * m.r).addScaledVector(m.axisB, Math.sin(a) * m.r);
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      const line = new LineLoop(geo, orbitMat());
      line.frustumCulled = false;
      this.scene.add(line);
      this.lines.set(m, line);
    }
    for (const [m, line] of this.lines) {
      if (!moons.includes(m)) {
        this.scene.remove(line);
        line.geometry.dispose();
        (line.material as ShaderMaterial).dispose();
        this.lines.delete(m);
        continue;
      }
      const mat = line.material as ShaderMaterial;
      mat.uniforms.uAlpha.value = 0.05 * m.grow * this.level * (m.labelled ? 1 : 0.6);
      line.visible = mat.uniforms.uAlpha.value > 0.001;
    }
  }

  dispose(): void {
    for (const line of this.lines.values()) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as ShaderMaterial).dispose();
    }
    this.lines.clear();
  }
}

export type LabelKind = 'moon' | 'infall' | 'threat' | 'dns' | 'note';

interface Label {
  el: HTMLDivElement;
  at: () => Vector3 | null;
  until: number;
  shown: boolean;
  lift: number;
  /** After this time the label stays but steps back (dimmer, no subtitle). */
  quietAt: number;
  quiet: boolean;
}

const FOREVER = 1e12;

export class Labels {
  private root: HTMLDivElement;
  private list: Label[] = [];
  private proj = new Vector3();
  enabled = true;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'eh-labels';
    document.body.appendChild(this.root);
  }

  /**
   * A label that follows `at()` for `ms` (or for as long as `at()` returns a
   * position, with `ms = Infinity`), stepping back to a quiet style after
   * `loudMs`.
   */
  add(kind: LabelKind, title: string | null | undefined, sub: string | null | undefined, at: () => Vector3 | null, ms: number, lift = 0, loudMs = Infinity): Label | null {
    if (!this.enabled || !title) return null;
    if (this.list.length > 22) {
      // make room: the oldest passing label goes first, standing ones (moons) last
      const i = Math.max(0, this.list.findIndex((l) => l.until < FOREVER));
      const [old] = this.list.splice(i, 1);
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = `eh-label eh-${kind}`;
    const t = document.createElement('b');
    t.textContent = title;
    el.appendChild(t);
    if (sub) {
      const s = document.createElement('i');
      s.textContent = sub;
      el.appendChild(s);
    }
    this.root.appendChild(el);
    const now = performance.now();
    const l: Label = {
      el, at, until: Number.isFinite(ms) ? now + ms : FOREVER, shown: false, lift,
      quietAt: Number.isFinite(loudMs) ? now + loudMs : FOREVER, quiet: false,
    };
    this.list.push(l);
    return l;
  }

  /** Bring a standing label forward again for a while (a moon whose device just renewed its lease). */
  wake(l: Label | null, loudMs: number): void { if (l) l.quietAt = Math.max(l.quietAt, performance.now() + loudMs); }

  isLive(l: Label | null): boolean { return !!l && this.list.includes(l); }

  update(cam: PerspectiveCamera, w: number, h: number): void {
    const now = performance.now();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const l = this.list[i];
      const p = l.at();
      if (!p) l.until = Math.min(l.until, now);
      const expired = !p || now > l.until || !this.enabled;
      if (p) {
        this.proj.copy(p);
        this.proj.project(cam);
        const onScreen = this.proj.z < 1 && Math.abs(this.proj.x) < 0.96 && Math.abs(this.proj.y) < 0.94;
        if (onScreen) {
          const x = ((this.proj.x + 1) / 2) * w, y = ((1 - this.proj.y) / 2) * h - l.lift;
          l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
        const want = onScreen && !expired;
        if (want !== l.shown) { l.shown = want; l.el.classList.toggle('on', want); }
        const quiet = now > l.quietAt;
        if (quiet !== l.quiet) { l.quiet = quiet; l.el.classList.toggle('quiet', quiet); }
      } else if (l.shown) { l.shown = false; l.el.classList.remove('on'); }
      if (expired && !l.shown && now > l.until + 1400) { l.el.remove(); this.list.splice(i, 1); }
    }
  }

  dispose(): void { this.root.remove(); this.list = []; }
}
