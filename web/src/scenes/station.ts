import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { State } from '../state';

/** Central command station: pulsing core, rotating hex, orbiting guard dots. */
export class Station {
  private glowTex: Texture;
  private cloudLayer = new Container();
  private clouds: { s: Sprite; life: number; ox?: number; oy?: number; maxAlpha?: number }[] = [];
  private core: Sprite;
  private bloom: Sprite;
  private ringG: Graphics;
  private hexG: Graphics;
  private structG: Graphics;
  private orbiters: Sprite[] = [];
  private verts: Sprite[] = [];
  private sparks: { s: Sprite; r: number; a: number; sp: number; ecc: number }[] = [];
  private aura: { s: Sprite; r: number; a: number; sp: number; wob: number;
    wosp: number; sc: number; al: number }[] = [];
  private pulse = 0;         // 0..1 energy flash
  private t = 0;
  private phi1 = Math.random() * Math.PI * 2;   // flight pattern, unique per boot
  private phi2 = Math.random() * Math.PI * 2;
  readonly center = { x: 0, y: 0 };

  constructor(private layer: Container, glow: Texture, private w: number, private h: number) {
    this.glowTex = glow;
    // wide soft bloom behind everything — the lush outer atmosphere of the core
    this.bloom = new Sprite(glow);
    this.bloom.anchor.set(0.5);
    this.bloom.scale.set(4.2);
    this.bloom.tint = 0x35e0ff;
    this.bloom.alpha = 0.22;
    this.bloom.blendMode = 'add';
    this.bloom.x = this.w / 2;
    this.bloom.y = this.h / 2;

    this.core = new Sprite(glow);
    this.core.anchor.set(0.5);
    this.core.scale.set(2.3);
    this.core.tint = 0x35e0ff;
    this.core.alpha = 0.75;
    this.core.blendMode = 'add';
    this.core.x = this.w / 2;
    this.core.y = this.h / 2;

    this.ringG = new Graphics();
    this.hexG = new Graphics();
    this.structG = new Graphics();
    this.structG.blendMode = 'add';

    for (let i = 0; i < 3; i++) {
      const o = new Sprite(glow);
      o.anchor.set(0.5);
      o.scale.set(0.22);
      o.tint = 0x9ff3ff;
      this.orbiters.push(o);
    }
    // six vertex nodes that light up the outer hull corners
    for (let i = 0; i < 6; i++) {
      const v = new Sprite(glow);
      v.anchor.set(0.5);
      v.scale.set(0.42);
      v.tint = 0xbff6ff;
      v.blendMode = 'add';
      this.verts.push(v);
    }
    // accretion sparks whipping around the reactor
    for (let i = 0; i < 6; i++) {
      const s = new Sprite(glow);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.scale.set(0.14 + Math.random() * 0.12);
      this.sparks.push({
        s, r: 0.75 + Math.random() * 0.55, a: Math.random() * Math.PI * 2,
        sp: 1.4 + Math.random() * 2.0, ecc: 0.55 + Math.random() * 0.4,
      });
    }
    // gassy ethereal aura — soft blobs on a slow swirling differential orbit
    for (let i = 0; i < 11; i++) {
      const s = new Sprite(glow);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.aura.push({
        s, r: 1.35 + Math.random() * 0.75, a: Math.random() * Math.PI * 2,
        sp: 0.3 + Math.random() * 0.55, wob: 0.10 + Math.random() * 0.16,
        wosp: 0.5 + Math.random() * 0.9, sc: 1.3 + Math.random() * 1.7,
        al: 0.09 + Math.random() * 0.09,
      });
    }
    layer.addChild(this.bloom, ...this.aura.map((a) => a.s), this.cloudLayer,
      this.ringG, this.hexG, this.structG,
      this.core, ...this.verts, ...this.sparks.map((sp) => sp.s), ...this.orbiters);
    this.layout();
  }

  layout(): void {
    this.center.x = this.w / 2;
    this.center.y = this.h / 2;
    this.layer.position.set(0, 0);
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; this.layout(); }

  flash(strength = 0.6): void { this.pulse = Math.min(1, this.pulse + strength); }

  /** Soft event-colored cloud blooming around the core, drifting outward.
   *  Per-color throttle keeps constant allow traffic from turning the core
   *  into permanent green fog — clouds need dark time between blooms. */
  private lastCloud = new Map<number, number>();
  eventCloud(color: number, minGap = 0.9, alpha = 0.34): void {
    const now = performance.now() / 1000;
    const last = this.lastCloud.get(color) ?? -99;
    if (now - last < minGap) return;
    this.lastCloud.set(color, now);
    let c: { s: Sprite; life: number; ox?: number; oy?: number; maxAlpha?: number };
    if (this.clouds.length < 5) {
      const sp = new Sprite(this.glowTex);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      this.cloudLayer.addChild(sp);
      c = { s: sp, life: 0 };
      this.clouds.push(c);
    } else {
      c = this.clouds[(this.cloudIdx++) % this.clouds.length];
    }
    // seed offset so concurrent clouds don't stack dead-center
    const a = Math.random() * Math.PI * 2;
    c.ox = Math.cos(a) * 18; c.oy = Math.sin(a) * 14;
    // position NOW — a newborn sprite left at default (0,0) would flash in
    // the screen corner for a frame before update() catches it
    c.s.x = this.center.x + c.ox * 0.4;
    c.s.y = this.center.y + c.oy * 0.4;
    c.s.scale.set(2.6);
    c.s.tint = color;
    c.s.alpha = alpha;
    c.maxAlpha = alpha;
    c.life = 1;
  }
  private cloudIdx = 0;

  update(dt: number, state: State): void {
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * 1.6);

    // Lissajous roam: prime-ratio periods never visibly loop; storms add
    // smooth turbulence on top of the lazy drift
    const heat = state.heat ?? 0;
    const roamX = 0.20 * this.w * Math.sin((2 * Math.PI * this.t) / 47 + this.phi1);
    const roamY = 0.14 * this.h * Math.sin((2 * Math.PI * this.t) / 71 + this.phi2);
    const turb = heat * 10;
    this.center.x = this.w / 2 + roamX
      + Math.sin(this.t * 3.1) * turb + Math.sin(this.t * 5.3) * turb * 0.6;
    this.center.y = this.h / 2 + roamY
      + Math.sin(this.t * 4.3) * turb + Math.sin(this.t * 2.6) * turb * 0.6;
    const cx = this.center.x, cy = this.center.y;
    const threat = state.threat;

    // threat tint: cyan → amber → red
    const r = threat < 0.5 ? 0.2 + threat * 1.2 : 1;
    const g = threat < 0.5 ? 0.88 - threat * 0.5 : 0.35 - (threat - 0.5) * 0.55;
    const tint = toRgb(r, Math.max(0.1, g), 0.35 * (1 - threat));

    const breathe = 1 + Math.sin(this.t * 2.2) * 0.05 + this.pulse * 0.5
                    + state.energy * 0.35;
    this.bloom.x = cx;
    this.bloom.y = cy;
    this.bloom.tint = tint;
    this.bloom.scale.set(4.2 * (0.85 + breathe * 0.25 + this.pulse * 0.4));
    this.bloom.alpha = 0.16 + state.energy * 0.14 + this.pulse * 0.22;
    this.core.x = cx;
    this.core.y = cy;
    this.core.scale.set(2.3 * breathe);
    this.core.tint = tint;
    this.core.alpha = 0.75 + this.pulse * 0.25;

    const base = Math.min(this.w, this.h);

    this.ringG.clear();
    for (let i = 1; i <= 3; i++) {
      this.ringG.circle(cx, cy, base * 0.045 * i)
        .stroke({ width: 1.4, color: tint, alpha: 0.5 - i * 0.1 });
    }

    this.hexG.clear();
    this.structG.clear();
    const hr = base * 0.030;
    const outerRot = this.t * 0.28;
    const innerRot = -this.t * 0.5;
    const hr2 = hr * 0.56;
    const TAU = Math.PI * 2;

    // outer hull hexagon
    const outer: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = outerRot + (i / 6) * TAU;
      outer.push(cx + Math.cos(a) * hr, cy + Math.sin(a) * hr);
    }
    this.hexG.poly(outer).closePath().stroke({ width: 2, color: 0xbff6ff, alpha: 0.9 });

    // counter-rotating inner core hexagon
    const inner: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = innerRot + (i / 6) * TAU;
      inner.push(cx + Math.cos(a) * hr2, cy + Math.sin(a) * hr2);
    }
    this.hexG.poly(inner).closePath().stroke({ width: 1.4, color: tint, alpha: 0.75 });

    // spokes linking inner and outer hull — twist as the cores counter-spin
    for (let i = 0; i < 6; i++) {
      this.hexG.moveTo(inner[i * 2], inner[i * 2 + 1])
        .lineTo(outer[i * 2], outer[i * 2 + 1])
        .stroke({ width: 1, color: tint, alpha: 0.5 });
    }

    // bright reactor core
    this.hexG.circle(cx, cy, hr * 0.2).fill({ color: 0xffffff, alpha: 0.9 });
    this.hexG.circle(cx, cy, hr * 0.34).stroke({ width: 1.2, color: 0xbff6ff, alpha: 0.85 });

    // gassy ethereal aura — soft blobs on a slow differential swirl, breathing
    // radially so the edge is wispy and moving, never a hard spinning rim
    for (const au of this.aura) {
      au.a += dt * au.sp * (1 + heat * 1.2 + this.pulse * 0.6);
      const wob = 1 + Math.sin(this.t * au.wosp + au.a) * au.wob;
      const rr = hr * au.r * wob * (1 + this.pulse * 0.14);
      au.s.x = cx + Math.cos(au.a) * rr;
      au.s.y = cy + Math.sin(au.a) * rr * 0.9;   // slightly flattened disc
      au.s.scale.set(au.sc * (1 + this.pulse * 0.2 + state.energy * 0.25));
      au.s.tint = tint;
      au.s.alpha = au.al * (0.7 + 0.3 * Math.sin(this.t * 1.3 + au.a))
        * (0.7 + state.energy * 0.7 + this.pulse * 0.6);
    }

    // diffraction flare spikes — the lens-flare "wow", energy-scaled
    const spikeLen = hr * (1.9 + state.energy * 1.4);
    const spikeRot = this.t * 0.15;
    for (let k = 0; k < 6; k++) {
      const a = spikeRot + (k / 6) * TAU;
      this.structG.moveTo(cx, cy)
        .lineTo(cx + Math.cos(a) * spikeLen, cy + Math.sin(a) * spikeLen)
        .stroke({ width: 1.3, color: 0xbff6ff, alpha: 0.1 + this.pulse * 0.28 });
    }

    // reactive shockwave ring — every flash sends a pulse out from the core
    if (this.pulse > 0.02) {
      const pr = hr * 1.1 + (1 - this.pulse) * hr * 2.2;
      this.structG.arc(cx, cy, pr, 0, TAU)
        .stroke({ width: 0.5 + this.pulse * 2.6, color: tint, alpha: this.pulse * 0.5 });
    }

    // vertex nodes light the hull corners, chasing around
    for (let i = 0; i < 6; i++) {
      const v = this.verts[i];
      const a = outerRot + (i / 6) * TAU;
      v.x = cx + Math.cos(a) * hr;
      v.y = cy + Math.sin(a) * hr;
      v.tint = tint;
      const beat = 0.5 + 0.5 * Math.sin(this.t * 2.6 - i * 0.9);
      v.alpha = 0.3 + this.pulse * 0.5 + beat * 0.35;
      v.scale.set(0.4 + this.pulse * 0.25 + beat * 0.08);
    }

    // accretion sparks — bright motes whipping in tight elliptical orbits
    for (const sp of this.sparks) {
      sp.a += sp.sp * dt * (1 + heat * 1.5 + this.pulse * 1.5);
      const rr = hr * sp.r;
      sp.s.x = cx + Math.cos(sp.a) * rr;
      sp.s.y = cy + Math.sin(sp.a) * rr * sp.ecc;
      sp.s.tint = 0xdffcff;
      sp.s.alpha = 0.55 + 0.45 * Math.sin(sp.a * 2);
    }

    this.orbiters.forEach((o, i) => {
      const a = this.t * (0.5 + i * 0.18) * (1 + heat * 1.5) + (i * Math.PI * 2) / 3;
      const rad = base * 0.06;
      o.x = cx + Math.cos(a) * rad;
      o.y = cy + Math.sin(a) * rad;
      o.tint = tint;
    });

    // event clouds: bloom outward and dissolve
    for (const c of this.clouds) {
      if (c.life <= 0) { c.s.alpha = 0; continue; }
      c.life = Math.max(0, c.life - dt * 1.1);
      const grow = 1 - c.life;
      c.s.x = cx + (c.ox ?? 0) * grow * 2.2;
      c.s.y = cy + (c.oy ?? 0) * grow * 2.2;
      c.s.scale.set(2.6 + grow * 5.5);
      c.s.alpha = c.life * (c.maxAlpha ?? 0.34);
    }
  }
}

export function toRgb(r: number, g: number, b: number): number {
  return ((clamp01(r) * 255) << 16) | ((clamp01(g) * 255) << 8) | (clamp01(b) * 255);
}
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
