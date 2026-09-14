import { Application, Container, Graphics, RenderTexture, Sprite, Text, TextStyle } from 'pixi.js';
import type { FrameName } from './assets/atlas';
import type { ZTextures } from './textures';
import { fade } from './fx';
import { Layout, Point, seeded } from './layout';
import { hash01 } from '../../state';

export interface Layers {
  ground: Container;     // baked terrain
  decals: Container;     // blood
  props: Container;      // tents, buildings, mast, generator
  actors: Container;     // zombies, survivors (managed elsewhere)
  walls: Container;      // walls, towers, guards
  canopy: Container;     // trees over everything on the ground
  lights: Container;     // additive night lights (above the darkness)
  labels: Container;     // names, readable at night
}

interface Tower { base: Sprite; guard: Sprite; cone: Sprite; aim: number; target: number; idle: number; recoil: number }
interface Building { host: string; slot: number; roof: Sprite; label: Text; lamp: Sprite; pulse: number; color: number; shake: number }
interface Tent { name: string; slot: number; cot: Sprite; label: Text; age: number; seen: number }

const LABEL = new TextStyle({ fill: 0xf3e6c8, fontFamily: 'monospace', fontSize: 10, stroke: { color: 0x1b140c, width: 3 } });
const BUILDING_LABEL = new TextStyle({ fill: 0xffe2b0, fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold', stroke: { color: 0x1b140c, width: 3 } });
const WALL_DARK = 0x3a3a3a, WALL_TRIM = 0xe86a17;
const GRASS_TINT = 0xbfcfa8, CONCRETE_TINT = 0xe0d4c0, TREE_TINT = 0xd0dcbc;
/** Tent names fade out once a device has been quiet this long (seconds). */
const LABEL_RECENT = 30;

/** The walled compound: static terrain, walls and towers, and the buildings
 *  and tents that appear as hosts and devices show up in the logs. */
export class Compound {
  L!: Layout;
  towers: Tower[] = [];
  private groundRT: RenderTexture | null = null;
  private groundSprite = new Sprite();
  private wallG = new Graphics();
  private mast = new Sprite();
  private mastLight = new Sprite();
  private gen = new Sprite();
  private genLight = new Sprite();
  private gateLamps: Sprite[] = [];
  private buildings = new Map<string, Building>();
  private tents = new Map<string, Tent>();
  private t = 0;
  private flicker = 0;
  maxTents = 28;

  constructor(private app: Application, private layers: Layers, private tex: ZTextures) {
    layers.ground.addChild(this.groundSprite);
    layers.walls.addChild(this.wallG);
    for (const s of [this.mastLight, this.genLight]) {
      s.texture = tex.glow; s.anchor.set(0.5); s.blendMode = 'add';
      layers.lights.addChild(s);
    }
    this.mast.texture = tex.frame('mast'); this.mast.anchor.set(0.5);
    this.gen.texture = tex.frame('barrel_grey'); this.gen.anchor.set(0.5);
    layers.props.addChild(this.mast, this.gen);
  }

  /** (Re)build everything that depends on the viewport. */
  layout(L: Layout, resolution: number): void {
    this.L = L;
    this.bakeGround(resolution);
    this.drawWalls();
    this.placeTowers();
    this.mast.position.set(L.mast.x, L.mast.y); this.mast.scale.set(0.9 * L.unit);
    this.gen.position.set(L.generator.x, L.generator.y); this.gen.scale.set(0.8 * L.unit);
    this.mastLight.position.set(L.mast.x, L.mast.y);
    this.genLight.position.set(L.generator.x, L.generator.y);
    for (const b of this.buildings.values()) this.placeBuilding(b);
    for (const t of this.tents.values()) this.placeTent(t);
  }

  rebakeGround(resolution: number): void { if (this.L) this.bakeGround(resolution); }

  // ── terrain ──────────────────────────────────────────────────────────────
  private bakeGround(resolution: number): void {
    const L = this.L, rnd = seeded(L.w * 7919 + L.h);
    const build = new Container();
    const T = 64;
    const put = (name: FrameName, x: number, y: number, opts: { rot?: number; scale?: number; alpha?: number; tint?: number } = {}) => {
      const s = new Sprite(this.tex.frame(name));
      s.anchor.set(0.5);
      s.position.set(x, y);
      s.rotation = opts.rot ?? 0;
      s.scale.set(opts.scale ?? 1);
      s.alpha = opts.alpha ?? 1;
      if (opts.tint !== undefined) s.tint = opts.tint;
      build.addChild(s);
    };
    const inside = (x: number, y: number, pad = 0) =>
      x > L.x0 - pad && x < L.x1 + pad && y > L.y0 - pad && y < L.y1 + pad;

    // muted grass everywhere (the pack's green is loud under a busy HUD)
    for (let y = T / 2; y < L.h + T; y += T) {
      for (let x = T / 2; x < L.w + T; x += T) {
        put((['grass_0', 'grass_1', 'grass_2', 'grass_3'] as FrameName[])[(rnd() * 4) | 0], x, y,
          { tint: GRASS_TINT });
      }
    }
    // warm concrete courtyard, tiled from the compound corner
    for (let y = L.y0 + T / 2; y < L.y1 + T / 2; y += T) {
      for (let x = L.x0 + T / 2; x < L.x1 + T / 2; x += T) {
        put((['concrete_0', 'concrete_1', 'concrete_2'] as FrameName[])[(rnd() * 3) | 0],
          Math.min(x, L.x1 - T / 2), Math.min(y, L.y1 - T / 2), { tint: CONCRETE_TINT });
      }
    }
    // dirt tracks from each gate out to the screen edge
    for (const gate of L.gates) {
      for (let x = gate.x + gate.side * T / 2; gate.side < 0 ? x > -T : x < L.w + T; x += gate.side * T) {
        put(rnd() < 0.5 ? 'dirt_0' : 'dirt_1', x, gate.y, { tint: GRASS_TINT });
      }
    }
    // scattered scenery outside the walls
    const area = (L.w * L.h) / (1920 * 1080);
    for (let i = 0; i < 26 * area; i++) {
      const x = rnd() * L.w, y = rnd() * L.h;
      if (inside(x, y, 70) || Math.abs(y - L.cy) < 40) continue;
      const pick = rnd();
      const name: FrameName = pick < 0.35 ? (rnd() < 0.5 ? 'rock_0' : 'rock_1')
        : pick < 0.65 ? 'bush_small' : pick < 0.8 ? 'planks' : pick < 0.9 ? 'bricks' : 'barrel';
      put(name, x, y, { rot: rnd() * Math.PI * 2, scale: (0.7 + rnd() * 0.5) * L.unit });
    }
    // supplies stacked inside against the walls
    for (let i = 0; i < 10; i++) {
      const side = i % 4;
      const along = 0.15 + rnd() * 0.7;
      const x = side < 2 ? L.x0 + along * L.hw * 2 : (side === 2 ? L.x0 + 26 * L.unit : L.x1 - 26 * L.unit);
      const y = side < 2 ? (side === 0 ? L.y0 + 26 * L.unit : L.y1 - 26 * L.unit) : L.y0 + along * L.hh * 2;
      if (Math.abs(y - L.cy) < L.gateHalf * 2 && side >= 2) continue;
      put(rnd() < 0.6 ? 'crate' : (rnd() < 0.5 ? 'crate_small' : 'barrel'), x, y,
        { rot: (rnd() - 0.5) * 0.5, scale: 0.75 * L.unit });
    }

    this.groundRT?.destroy(true);
    this.groundRT = RenderTexture.create({ width: L.w, height: L.h, resolution });
    this.app.renderer.render({ container: build, target: this.groundRT });
    build.destroy({ children: true });
    this.groundSprite.texture = this.groundRT;

    // tree canopies sit above the actors, so zombies shuffle out from under them
    for (const c of [...this.layers.canopy.children]) c.destroy();
    const trees = seeded(L.w + L.h * 31);
    for (let i = 0; i < 18 * area; i++) {
      const x = trees() * L.w, y = trees() * L.h;
      if (inside(x, y, 110) || Math.abs(y - L.cy) < 70) continue;
      const s = new Sprite(this.tex.frame(trees() < 0.75 ? 'tree' : 'tree_autumn'));
      s.anchor.set(0.5);
      s.position.set(x, y);
      s.rotation = trees() * Math.PI * 2;
      s.scale.set((0.8 + trees() * 0.6) * L.unit);
      s.tint = TREE_TINT;
      s.alpha = 0.96;
      this.layers.canopy.addChild(s);
    }
  }

  private drawWalls(): void {
    const L = this.L, g = this.wallG, W = L.wall;
    g.clear();
    const seg = (x1: number, y1: number, x2: number, y2: number) => {
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: W, color: WALL_DARK, cap: 'square' });
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: Math.max(2, W * 0.28), color: WALL_TRIM, cap: 'square' });
    };
    seg(L.x0, L.y0, L.x1, L.y0);
    seg(L.x0, L.y1, L.x1, L.y1);
    for (const x of [L.x0, L.x1]) {
      seg(x, L.y0, x, L.cy - L.gateHalf);
      seg(x, L.cy + L.gateHalf, x, L.y1);
    }
    // gate posts + lamps
    for (const l of this.gateLamps) l.destroy();
    this.gateLamps = [];
    for (const gate of L.gates) {
      for (const dy of [-L.gateHalf, L.gateHalf]) {
        g.rect(gate.x - W * 0.8, gate.y + dy - W * 0.8, W * 1.6, W * 1.6).fill({ color: WALL_TRIM });
        const lamp = new Sprite(this.tex.glow);
        lamp.anchor.set(0.5); lamp.blendMode = 'add'; lamp.tint = 0xffc36b;
        lamp.position.set(gate.x, gate.y + dy);
        lamp.scale.set(1.3 * L.unit);
        this.layers.lights.addChild(lamp);
        this.gateLamps.push(lamp);
      }
    }
  }

  private placeTowers(): void {
    for (const t of this.towers) { t.base.destroy(); t.guard.destroy(); t.cone.destroy(); }
    this.towers = this.L.towers.map((p) => {
      const base = new Sprite(this.tex.frame('tower'));
      base.anchor.set(0.5); base.position.set(p.x, p.y); base.scale.set(0.95 * this.L.unit);
      const guard = new Sprite(this.tex.frame('guard'));
      guard.anchor.set(0.38, 0.5); guard.position.set(p.x, p.y); guard.scale.set(0.9 * this.L.unit);
      const out = Math.atan2(p.y - this.L.cy, p.x - this.L.cx);
      const cone = new Sprite(this.tex.glow);
      cone.anchor.set(0.08, 0.5); cone.blendMode = 'add'; cone.tint = 0xfff0c8;
      cone.position.set(p.x, p.y);
      this.layers.walls.addChild(base, guard);
      this.layers.lights.addChild(cone);
      return { base, guard, cone, aim: out, target: out, idle: out, recoil: 0 };
    });
  }

  /** Swing a guard onto a target; returns the muzzle position. */
  aim(i: number, p: Point): Point {
    const t = this.towers[i];
    t.target = Math.atan2(p.y - t.base.y, p.x - t.base.x);
    t.aim = t.target;                        // snap: shots must line up
    t.recoil = 1;
    const reach = 26 * this.L.unit;
    return { x: t.base.x + Math.cos(t.aim) * reach, y: t.base.y + Math.sin(t.aim) * reach };
  }

  // ── buildings (AP / gateway hosts) ───────────────────────────────────────
  building(host: string): Building {
    let b = this.buildings.get(host);
    if (b) return b;
    const used = new Set([...this.buildings.values()].map((x) => x.slot));
    const slots = this.L.buildings.length;
    let slot = (hash01(host) * slots) | 0;
    for (let i = 0; i < slots && used.has(slot); i++) slot = (slot + 1) % slots;
    if (used.has(slot)) {
      // all taken: the quietest building hands its slot over
      const quiet = [...this.buildings.values()].sort((a, c) => a.pulse - c.pulse)[0];
      this.removeBuilding(quiet);
      slot = quiet.slot;
    }
    const roof = new Sprite(this.tex.frame(hash01(host + 'roof') < 0.5 ? 'roof_orange' : 'roof_green'));
    roof.anchor.set(0.5);
    const label = new Text({ text: host.toUpperCase(), style: BUILDING_LABEL });
    label.anchor.set(0.5);
    const lamp = new Sprite(this.tex.glow);
    lamp.anchor.set(0.5); lamp.blendMode = 'add';
    b = { host, slot, roof, label, lamp, pulse: 0, color: 0xffffff, shake: 0 };
    this.layers.props.addChild(roof);
    this.layers.labels.addChild(label);
    this.layers.lights.addChild(lamp);
    this.buildings.set(host, b);
    this.placeBuilding(b);
    return b;
  }

  private removeBuilding(b: Building): void {
    b.roof.destroy(); b.label.destroy(); b.lamp.destroy();
    this.buildings.delete(b.host);
  }

  private placeBuilding(b: Building): void {
    const p = this.L.buildings[b.slot];
    const size = 0.46 * this.L.unit;
    b.roof.position.set(p.x, p.y); b.roof.scale.set(size);
    b.label.position.set(p.x, p.y);
    b.lamp.position.set(p.x, p.y);
  }

  /** Door of a building: middle of the side facing the courtyard centre. */
  door(host: string): Point {
    const b = this.building(host), p = this.L.buildings[b.slot];
    const half = 192 * 0.46 * this.L.unit / 2;
    return { x: p.x, y: p.y + (p.y < this.L.cy ? half : -half) };
  }

  buildingEvent(host: string, kind: 'good' | 'bad' | 'info', color: number): void {
    const b = this.building(host);
    b.pulse = Math.min(1.5, b.pulse + (kind === 'bad' ? 0.9 : 0.5));
    b.color = color;
    if (kind === 'bad') b.shake = 0.35;
  }

  setBuildingsVisible(on: boolean): void {
    for (const b of this.buildings.values()) { b.roof.visible = on; b.label.visible = on; b.lamp.visible = on; }
  }

  // ── tents (DHCP devices) ──────────────────────────────────────────────────
  /** A device's tent, pitched on first sight (oldest one struck when full).
   *  `delay` seconds hold a new tent invisible until its owner walks in. */
  tent(name: string, delay = 0): { pos: Point; isNew: boolean } {
    const now = performance.now();
    let t = this.tents.get(name);
    if (t) { t.seen = now; return { pos: this.L.camp[t.slot], isNew: false }; }
    const slots = Math.min(this.maxTents, this.L.camp.length);
    while (this.tents.size >= slots) this.strikeOldest();
    const used = new Set([...this.tents.values()].map((x) => x.slot));
    let slot = (hash01(name) * this.L.camp.length) | 0;
    while (used.has(slot)) slot = (slot + 1) % this.L.camp.length;
    const cot = new Sprite(this.tex.frame(hash01(name + 'c') < 0.5 ? 'cot_green' : 'cot_orange'));
    cot.anchor.set(0.5);
    cot.alpha = 0;
    const label = new Text({ text: name, style: LABEL });
    label.anchor.set(0.5, 0);
    label.alpha = 0;
    t = { name, slot, cot, label, age: -delay, seen: now };
    this.layers.props.addChild(cot);
    this.layers.labels.addChild(label);
    this.tents.set(name, t);
    this.placeTent(t);
    return { pos: this.L.camp[slot], isNew: true };
  }

  setMaxTents(n: number): void {
    this.maxTents = n;
    while (this.tents.size > Math.min(n, this.L?.camp.length ?? n)) this.strikeOldest();
  }

  private strikeOldest(): void {
    let oldest: Tent | null = null;
    for (const t of this.tents.values()) if (!oldest || t.seen < oldest.seen) oldest = t;
    if (!oldest) return;
    oldest.cot.destroy(); oldest.label.destroy();
    this.tents.delete(oldest.name);
  }

  private placeTent(t: Tent): void {
    const L = this.L;
    const p = L.camp[t.slot % L.camp.length];
    t.cot.position.set(p.x, p.y);
    t.cot.scale.set(0.24 * L.unit);
    // alternate columns label below / above the cot so neighbours don't collide
    const col = Math.round((p.x - (L.cx - L.hw * 0.42)) / ((L.hw * 0.84) / 10));
    const below = col % 2 === 0;
    t.label.anchor.set(0.5, below ? 0 : 1);
    t.label.position.set(p.x, p.y + (below ? 1 : -1) * 24 * L.unit);
  }

  /** A stable courtyard spot for any key (e.g. a LAN IP with no tent). */
  campSpot(key: string): Point {
    const p = this.L.camp[(hash01(key) * this.L.camp.length) | 0];
    return { x: p.x + (hash01(key + 'x') - 0.5) * 14, y: p.y + (hash01(key + 'y') - 0.5) * 10 };
  }

  /** Radio mast blink / generator flicker hooks. */
  mastPing(): void { this.mastLight.alpha = 1; }
  generatorFlicker(): void { this.flicker = 0.6; }

  update(dt: number, darkness: number, alarm: number): void {
    this.t += dt;
    this.flicker = Math.max(0, this.flicker - dt);
    const flick = this.flicker > 0 ? (Math.sin(this.t * 60) > 0 ? 0.25 : 1) : 1;
    const night = darkness * flick;

    this.towers.forEach((tw, i) => {
      // idle guards sweep their watch arc; firing snaps them onto a target
      tw.recoil = Math.max(0, tw.recoil - dt * 3);
      if (tw.recoil <= 0) {
        const sweep = tw.idle + Math.sin(this.t * 0.35 + i * 1.7) * 0.9;
        tw.aim += (sweep - tw.aim) * Math.min(1, dt * 1.2);
      }
      tw.guard.rotation = tw.aim;
      tw.cone.rotation = tw.aim;
      tw.cone.scale.set(5.2 * this.L.unit, 1.7 * this.L.unit);
      fade(tw.cone, night * 0.45);
      tw.cone.tint = alarm > 0 && Math.sin(this.t * 10) > 0 ? 0xff5a4a : 0xfff0c8;
    });

    for (const lamp of this.gateLamps) lamp.alpha = 0.08 + night * 0.6;

    this.mastLight.alpha = Math.max(0.1 + night * 0.3, this.mastLight.alpha - dt * 2);
    this.mastLight.tint = 0x55b5ff;
    this.mastLight.scale.set(0.9 * this.L.unit * (1 + this.mastLight.alpha * 0.6));
    this.genLight.tint = 0xffd27a;
    this.genLight.alpha = (0.1 + night * 0.4) * flick;
    this.genLight.scale.set(1.4 * this.L.unit);

    for (const b of this.buildings.values()) {
      b.pulse = Math.max(0, b.pulse - dt * 0.9);
      b.shake = Math.max(0, b.shake - dt);
      const p = this.L.buildings[b.slot];
      const jig = b.shake > 0 ? (Math.random() - 0.5) * 5 * b.shake : 0;
      b.roof.position.set(p.x + jig, p.y);
      b.roof.tint = b.pulse > 0.05 ? mix(0xffffff, b.color, Math.min(0.55, b.pulse * 0.4)) : 0xffffff;
      b.lamp.tint = b.color;
      b.lamp.scale.set(2.4 * this.L.unit * (1 + b.pulse * 0.3));
      fade(b.lamp, Math.min(0.9, b.pulse * 0.5 + night * 0.25) * flick);
    }
    const now = performance.now();
    for (const t of this.tents.values()) {
      t.age += dt;
      const a = Math.max(0, Math.min(1, t.age * 1.5));
      fade(t.cot, a);
      // names show while a device is active, then fade so the camp stays readable
      const quiet = (now - t.seen) / 1000;
      const want = quiet < LABEL_RECENT ? 0.9 : 0;
      fade(t.label, t.label.alpha + (a * want - t.label.alpha) * Math.min(1, dt * 1.5));
    }
  }
}

function mix(a: number, b: number, f: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
