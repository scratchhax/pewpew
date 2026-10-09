import { Application, ColorMatrixFilter, Container, Graphics, Rectangle, RenderTexture, Sprite, Text, TextStyle, Texture } from 'pixi.js';
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
interface Building { host: string; slot: number; roof: Sprite; label: Text; lamp: Sprite; heat: number; glow: number; color: number; tint: number }
interface Tent { name: string; slot: number; sprite: Sprite; label: Text; age: number; seen: number }

const LABEL = new TextStyle({ fill: 0xf3e6c8, fontFamily: 'monospace', fontSize: 10, stroke: { color: 0x1b140c, width: 3 } });
const BUILDING_LABEL = new TextStyle({ fill: 0xffe2b0, fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold', stroke: { color: 0x1b140c, width: 3 } });
const WALL_DARK = 0x33332f, WALL_TRIM = 0xb85a17;
// dead, washed-out country: tints pull the pack's bright greens toward olive and grey
const GRASS_TINT = 0x8a8568, CONCRETE_TINT = 0x9c948a, TREE_TINT = 0x7e8472, DEAD_TREE_TINT = 0x7a6c5e;
const GROUND_WASH = 0x3c382c, OLD_BLOOD = 0x4a2a22;
/** Tent names fade out once a device has been quiet this long (seconds). */
const LABEL_RECENT = 30;
/** Muted canvas colours for tents (khaki, olive, rust, slate, sand). */
const TENT_TINTS = [0xc9b27a, 0x8f9a5e, 0xb8734a, 0x7f8f9e, 0xd8c49a];

/** The walled compound: static terrain, walls and towers, and the buildings
 *  and tents that appear as hosts and devices show up in the logs. */
export class Compound {
  L!: Layout;
  towers: Tower[] = [];
  private groundRT: RenderTexture | null = null;
  private groundSprite = new Sprite();
  private drained = new Map<FrameName, Texture>();
  private wallG = new Graphics();
  private perimeterG = new Graphics();
  private crackG = new Graphics();
  private perimeterLights: { x: number; y: number; heat: number }[] = [];
  private mast = new Sprite();
  private mastLight = new Sprite();
  private gen = new Sprite();
  private genLight = new Sprite();
  private gateLamps: Sprite[] = [];
  private buildings = new Map<string, Building>();
  private tents = new Map<string, Tent>();
  private t = 0;
  private brownout = 0;         // > 0 after a system event
  private power = 1;            // eased light level (dips during a brownout)
  private mastHeat = 0;
  private mastGlow = 0;
  private wallDamage = 0;       // 0-1, accumulates on breach, decays
  /** Per-side claw damage (0 top, 1 right, 2 bottom, 3 left) and the gaps
   *  that open when a side gives way. */
  private sideDamage = [0, 0, 0, 0];
  private sideCooldown = [0, 0, 0, 0];
  private gaps: { side: number; at: number; x: number; y: number }[] = [];
  private gapG = new Graphics();
  maxTents = 28;

  constructor(private app: Application, private layers: Layers, private tex: ZTextures) {
    layers.ground.addChild(this.groundSprite);
    layers.walls.addChild(this.wallG, this.crackG, this.perimeterG, this.gapG);
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
    const put = (name: FrameName | Texture, x: number, y: number, opts: { rot?: number; scale?: number; alpha?: number; tint?: number } = {}) => {
      const s = new Sprite(typeof name === 'string' ? this.tex.frame(name) : name);
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

    const area = (L.w * L.h) / (1920 * 1080);
    // dying grass everywhere
    for (let y = T / 2; y < L.h + T; y += T) {
      for (let x = T / 2; x < L.w + T; x += T) {
        put((['grass_0', 'grass_1', 'grass_2', 'grass_3'] as FrameName[])[(rnd() * 4) | 0], x, y,
          { tint: GRASS_TINT });
      }
    }
    // a grey-brown wash, soft bare-earth patches and darker mottling (round, so no tile grid shows)
    build.addChild(new Graphics().rect(0, 0, L.w, L.h).fill({ color: GROUND_WASH, alpha: 0.3 }));
    for (let i = 0; i < 30 * area; i++) {
      put(this.tex.glow, rnd() * L.w, rnd() * L.h,
        { tint: 0x5a4630, alpha: 0.3 + rnd() * 0.3, scale: (2 + rnd() * 3) * L.unit });
    }
    for (let i = 0; i < 40 * area; i++) {
      put(this.tex.glow, rnd() * L.w, rnd() * L.h,
        { tint: 0x000000, alpha: 0.12 + rnd() * 0.16, scale: (3 + rnd() * 5) * L.unit });
    }
    // old, dried stains outside the walls: plenty have died here before
    for (let i = 0; i < 16 * area; i++) {
      const x = rnd() * L.w, y = rnd() * L.h;
      if (inside(x, y, 20)) continue;
      put(this.tex.splats[(rnd() * this.tex.splats.length) | 0], x, y,
        { tint: OLD_BLOOD, alpha: 0.3 + rnd() * 0.25, rot: rnd() * Math.PI * 2, scale: (0.5 + rnd() * 0.6) * L.unit });
    }
    // cracked, grimy concrete courtyard, tiled from the compound corner
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
    this.groundRT = this.bakeDrained(build, resolution);
    this.groundSprite.texture = this.groundRT;

    // tree canopies sit above the actors, so zombies shuffle out from under them
    for (const c of [...this.layers.canopy.children]) c.destroy();
    const treeTex = { tree: this.drainedFrame('tree'), dead: this.drainedFrame('tree_autumn') };
    const trees = seeded(L.w + L.h * 31);
    for (let i = 0; i < 18 * area; i++) {
      const x = trees() * L.w, y = trees() * L.h;
      if (inside(x, y, 110) || Math.abs(y - L.cy) < 70) continue;
      const dead = trees() < 0.55;
      const s = new Sprite(dead ? treeTex.dead : treeTex.tree);
      s.anchor.set(0.5);
      s.position.set(x, y);
      s.rotation = trees() * Math.PI * 2;
      s.scale.set((0.8 + trees() * 0.6) * L.unit);
      s.tint = dead ? DEAD_TREE_TINT : TREE_TINT;
      s.alpha = 0.96;
      this.layers.canopy.addChild(s);
    }
  }

  /** Colour mostly drained and pulled down a notch: the grim look, applied at bake time only. */
  private drainFilter(): ColorMatrixFilter {
    const f = new ColorMatrixFilter();
    f.saturate(-0.55);
    f.brightness(0.8, true);
    return f;
  }

  /** Render a static full-screen container once into a drained texture. */
  private bakeDrained(build: Container, resolution: number): RenderTexture {
    const L = this.L;
    const drain = this.drainFilter();
    build.filters = [drain];
    build.filterArea = new Rectangle(0, 0, L.w, L.h);
    const rt = RenderTexture.create({ width: L.w, height: L.h, resolution });
    this.app.renderer.render({ container: build, target: rt, clear: true });
    drain.destroy();
    build.destroy({ children: true });
    return rt;
  }

  /** An atlas frame drained once into its own small texture (cached; per-frame cost unchanged). */
  private drainedFrame(name: FrameName): Texture {
    const hit = this.drained.get(name);
    if (hit) return hit;
    const src = this.tex.frame(name);
    const s = new Sprite(src);
    const drain = this.drainFilter();
    s.filters = [drain];
    const holder = new Container();
    holder.addChild(s);
    holder.filterArea = new Rectangle(0, 0, src.width, src.height);
    s.filterArea = holder.filterArea;
    const rt = RenderTexture.create({ width: src.width, height: src.height, resolution: 2 });
    this.app.renderer.render({ container: holder, target: rt, clear: true });
    drain.destroy();
    holder.destroy({ children: true });
    this.drained.set(name, rt);
    return rt;
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
    this.setupPerimeterLights();
  }

  private setupPerimeterLights(): void {
    const L = this.L;
    this.perimeterLights = [];
    const spacing = 40 * L.unit;
    // top wall
    for (let x = L.x0 + spacing; x < L.x1; x += spacing) this.perimeterLights.push({ x, y: L.y0 - L.wall, heat: 0 });
    // bottom wall
    for (let x = L.x0 + spacing; x < L.x1; x += spacing) this.perimeterLights.push({ x, y: L.y1 + L.wall, heat: 0 });
    // left wall
    for (let y = L.y0 + spacing; y < L.y1; y += spacing) {
      if (Math.abs(y - L.cy) < L.gateHalf) continue;
      this.perimeterLights.push({ x: L.x0 - L.wall, y, heat: 0 });
    }
    // right wall
    for (let y = L.y0 + spacing; y < L.y1; y += spacing) {
      if (Math.abs(y - L.cy) < L.gateHalf) continue;
      this.perimeterLights.push({ x: L.x1 + L.wall, y, heat: 0 });
    }
  }

  /** Update perimeter lights based on zombie positions. */
  updatePerimeter(zombies: Point[], dt: number): void {
    for (const light of this.perimeterLights) {
      let nearest = Infinity;
      for (const z of zombies) {
        const d = Math.hypot(z.x - light.x, z.y - light.y);
        if (d < nearest) nearest = d;
      }
      const target = nearest < 150 ? 1 : nearest < 250 ? 0.4 : 0;
      light.heat += (target - light.heat) * Math.min(1, dt * 4);
    }
  }

  /** Add a crack at a wall position. Persists until repaired. */
  addWallCrack(x: number, y: number): void {
    this.wallDamage = Math.min(1, this.wallDamage + 0.15);
    const rnd = Math.random;
    const cx = x + (rnd() - 0.5) * 10;
    const cy = y + (rnd() - 0.5) * 10;
    const g = this.crackG;
    const len = 8 + rnd() * 12;
    const a = rnd() * Math.PI * 2;
    g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len).stroke({ width: 2, color: 0x1a1a1a, alpha: 0.7 });
    g.moveTo(cx, cy).lineTo(cx + Math.cos(a + 0.5) * len * 0.6, cy + Math.sin(a + 0.5) * len * 0.6).stroke({ width: 1.5, color: 0x2a2020, alpha: 0.5 });
  }

  setWallDamage(d: number): void { this.wallDamage = Math.max(0, Math.min(1, d)); }
  getWallDamage(): number { return this.wallDamage; }

  // ── the wall giving way ────────────────────────────────────────────────────
  private sideOf(x: number, y: number): number {
    const L = this.L;
    const d = [Math.abs(y - L.y0), Math.abs(x - L.x1), Math.abs(y - L.y1), Math.abs(x - L.x0)];
    let best = 0;
    for (let i = 1; i < 4; i++) if (d[i] < d[best]) best = i;
    return best;
  }

  /** A claw tick on a wall side. Returns the gap point when that side breaks. */
  addClawDamage(x: number, y: number, by: number): Point | null {
    const side = this.sideOf(x, y);
    if (this.sideCooldown[side] > 0) return null;
    this.sideDamage[side] = Math.min(1, this.sideDamage[side] + by);
    if (this.sideDamage[side] < 1) return null;
    const L = this.L;
    const along = 0.25 + Math.random() * 0.5;
    const gx = side === 1 ? L.x1 : side === 3 ? L.x0 : L.x0 + along * (L.x1 - L.x0);
    const gy = side === 0 ? L.y0 : side === 2 ? L.y1 : L.y0 + along * (L.y1 - L.y0);
    this.gaps.push({ side, at: this.t, x: gx, y: gy });
    this.sideDamage[side] = 0;
    this.sideCooldown[side] = 30;
    return { x: gx, y: gy };
  }

  /** The nearest open gap within range (for things deciding to run for it). */
  gapNear(p: Point, range = 130): Point | null {
    let best: Point | null = null, bd = range * this.L.unit;
    for (const g of this.gaps) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < bd) { bd = d; best = { x: g.x, y: g.y }; }
    }
    return best;
  }

  /** A point just inside the wall at a gap (where infiltrators emerge). */
  insidePoint(gap: Point): Point {
    const L = this.L;
    const k = 2.6 * L.wall;
    const dx = L.cx - gap.x, dy = L.cy - gap.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: gap.x + (dx / d) * k, y: gap.y + (dy / d) * k };
  }

  /** The hole, then planks creeping over it, then it's a wall again. */
  private drawGaps(): void {
    const g = this.gapG;
    g.clear();
    const L = this.L, W = L.wall;
    for (let i = this.gaps.length - 1; i >= 0; i--) {
      const gap = this.gaps[i];
      const age = this.t - gap.at;
      if (age > 45) { this.gaps.splice(i, 1); continue; }
      const repair = Math.min(1, Math.max(0, (age - 12) / 30));
      const horiz = gap.side === 0 || gap.side === 2;
      const len = 34 * L.unit;
      // the hole
      g.rect(gap.x - (horiz ? len / 2 : W * 1.1), gap.y - (horiz ? W * 1.1 : len / 2),
        horiz ? len : W * 2.2, horiz ? W * 2.2 : len).fill({ color: 0x0a0806, alpha: 0.92 * (1 - repair) });
      // splintered ends
      for (const s of [-1, 1]) {
        const bx = horiz ? gap.x + s * len / 2 : gap.x;
        const by = horiz ? gap.y : gap.y + s * len / 2;
        const a = Math.atan2(L.cy - by, L.cx - bx);
        g.moveTo(bx, by).lineTo(bx + Math.cos(a) * W * 1.4, by + Math.sin(a) * W * 1.4)
          .stroke({ width: 2, color: 0x241c12, alpha: 0.9 * (1 - repair) });
      }
      // planks closing it as it repairs
      const planks = Math.round(repair * 4);
      for (let p = 0; p < planks; p++) {
        const off = (p - 1.5) * (len / 4);
        const px = horiz ? gap.x + off : gap.x;
        const py = horiz ? gap.y : gap.y + off;
        g.rect(px - (horiz ? len / 9 : W * 1.2), py - (horiz ? W * 1.2 : len / 9),
          horiz ? len / 4.5 : W * 2.4, horiz ? W * 2.4 : len / 4.5)
          .fill({ color: 0x8a6f4a, alpha: 0.85 });
      }
    }
  }

  /** Claw marks where a zombie clings to the wall: short parallel rakes. */
  addWallScratch(x: number, y: number): void {
    const g = this.crackG;
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * 3 + (Math.random() - 0.5) * 2;
      const len = 5 + Math.random() * 6;
      g.moveTo(x + ox, y).lineTo(x + ox + (Math.random() - 0.5) * 3, y + len)
        .stroke({ width: 1, color: 0x14100c, alpha: 0.5 });
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

  /** Start turning a guard toward a target it's about to engage (no shot). */
  watch(i: number, p: Point): void {
    const t = this.towers[i];
    t.target = Math.atan2(p.y - t.base.y, p.x - t.base.x);
    t.recoil = Math.max(t.recoil, 1);
  }

  /** Is this guard turned close enough to the target to fire down the barrel? */
  aimedAt(i: number, p: Point, tol = 0.3): boolean {
    const t = this.towers[i];
    const want = Math.atan2(p.y - t.base.y, p.x - t.base.x);
    return Math.abs(angleDelta(t.aim, want)) < tol;
  }

  /** Fire at a target; the guard turns onto it smoothly. Returns the muzzle. */
  aim(i: number, p: Point): Point {
    this.watch(i, p);
    const t = this.towers[i];
    const reach = 26 * this.L.unit;
    // the muzzle sits at the end of the barrel as it actually points, not
    // where it wants to point: rounds leave the gun, not the intention
    return { x: t.base.x + Math.cos(t.aim) * reach, y: t.base.y + Math.sin(t.aim) * reach };
  }

  /** Towers ordered by distance to a point (nearest first). */
  towersNear(p: Point): Array<{ i: number; d: number }> {
    return this.towers
      .map((t, i) => ({ i, d: Math.hypot(t.base.x - p.x, t.base.y - p.y) }))
      .sort((a, b) => a.d - b.d);
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
      const quiet = [...this.buildings.values()].sort((a, c) => a.heat - c.heat)[0];
      this.removeBuilding(quiet);
      slot = quiet.slot;
    }
    const roof = new Sprite(this.tex.frame(hash01(host + 'roof') < 0.5 ? 'roof_orange' : 'roof_green'));
    roof.anchor.set(0.5);
    const label = new Text({ text: host.toUpperCase(), style: BUILDING_LABEL });
    label.anchor.set(0.5);
    const lamp = new Sprite(this.tex.glow);
    lamp.anchor.set(0.5); lamp.blendMode = 'add';
    b = { host, slot, roof, label, lamp, heat: 0, glow: 0, color: 0xffd8a0, tint: 0xffd8a0 };
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

  /** Activity at a building: its lamp warms up slowly toward the event colour
   *  and cools off over a few seconds. No flashes, no roof tint, no shaking. */
  buildingEvent(host: string, kind: 'good' | 'bad' | 'info', color: number): void {
    const b = this.building(host);
    b.heat = Math.min(1, b.heat + (kind === 'bad' ? 0.35 : 0.2));
    b.color = color;
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
    const sprite = new Sprite(this.tex.tent);
    sprite.tint = TENT_TINTS[(hash01(name + 'c') * TENT_TINTS.length) | 0];
    sprite.anchor.set(0.5);
    sprite.alpha = 0;
    const label = new Text({ text: name, style: LABEL });
    label.anchor.set(0.5, 0);
    label.alpha = 0;
    t = { name, slot, sprite, label, age: -delay, seen: now };
    this.layers.props.addChild(sprite);
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
    oldest.sprite.destroy(); oldest.label.destroy();
    this.tents.delete(oldest.name);
  }

  private placeTent(t: Tent): void {
    const L = this.L;
    const p = L.camp[t.slot % L.camp.length];
    t.sprite.position.set(p.x, p.y);
    t.sprite.scale.set(0.62 * L.unit);
    // alternate columns label below / above the tent so neighbours don't collide
    const col = Math.round((p.x - (L.cx - L.hw * 0.42)) / ((L.hw * 0.84) / 10));
    const below = col % 2 === 0;
    t.label.anchor.set(0.5, below ? 0 : 1);
    t.label.position.set(p.x, p.y + (below ? 1 : -1) * 19 * L.unit);
  }

  /** A stable courtyard spot for any key (e.g. a LAN IP with no tent). */
  campSpot(key: string): Point {
    const p = this.L.camp[(hash01(key) * this.L.camp.length) | 0];
    return { x: p.x + (hash01(key + 'x') - 0.5) * 14, y: p.y + (hash01(key + 'y') - 0.5) * 10 };
  }

  /** DNS traffic: the mast light warms up a little (eased, never a blink). */
  mastPing(): void { this.mastHeat = Math.min(1, this.mastHeat + 0.25); }
  /** System event: the generator browns out — lights dim smoothly and recover. */
  generatorFlicker(): void { this.brownout = 1; }

  /** `groove`: the music (beat, loudness, downbeat) for lights and guards that move with it. */
  update(dt: number, darkness: number, alarm: number, groove?: { beat: number; beatsPerBar: number; energy: number; downbeat: number }): void {
    const beat = groove?.beat ?? this.t * 1.4, bpb = groove?.beatsPerBar ?? 4;
    const energy = groove?.energy ?? 0.35, downbeat = groove?.downbeat ?? 0;
    this.t += dt;
    // everything below eases: no on/off toggles, no per-event pops
    this.brownout = Math.max(0, this.brownout - dt * 0.6);
    this.power = ease(this.power, this.brownout > 0 ? 0.6 : 1, dt, 1.2);
    const night = darkness * this.power;

    this.towers.forEach((tw, i) => {
      // engaged guards turn onto their target (shortest way round); idle ones
      // drift back into a slow sweep of their watch arc. Never an instant snap.
      tw.recoil = Math.max(0, tw.recoil - dt * 0.8);
      const want = tw.recoil > 0 ? tw.target : tw.idle + Math.sin((beat / (bpb * 8)) * Math.PI * 2 + i * Math.PI / 2) * 0.9;   // one sweep every eight bars
      // capped turn rate: a guard swings at most ~3.5 rad/s, never whips round
      const turn = angleDelta(tw.aim, want) * Math.min(1, dt * (tw.recoil > 0 ? 5 : 1.2));
      const maxTurn = 3.5 * dt;
      tw.aim += Math.max(-maxTurn, Math.min(maxTurn, turn));
      tw.guard.rotation = tw.aim;
      tw.cone.rotation = tw.aim;
      tw.cone.scale.set(5.2 * this.L.unit, 1.7 * this.L.unit);
      // floodlights breathe with the music (slowly) and flicker faintly, like failing bulbs
      const flicker = 0.94 + 0.06 * Math.sin(this.t * 2.3 + i * 1.7) * Math.sin(this.t * 0.7 + i);
      fade(tw.cone, night * 0.4 * (0.85 + 0.3 * energy) * flicker);
      tw.cone.tint = mix(0xfff0c8, 0xff6a50, Math.min(1, alarm));   // alarm shifts to red, steadily
    });

    for (let i = 0; i < this.gateLamps.length; i++) {
      const flicker = 0.93 + 0.07 * Math.sin(this.t * 1.9 + i * 2.1);
      this.gateLamps[i].alpha = (0.08 + night * 0.55) * flicker;
    }

    this.mastHeat = Math.max(0, this.mastHeat - dt * 0.35);
    this.mastGlow = ease(this.mastGlow, this.mastHeat, dt, 1);
    this.mastLight.alpha = 0.1 + night * 0.25 + this.mastGlow * 0.25 + downbeat * 0.12;   // a soft swell on each bar
    this.mastLight.tint = 0x55b5ff;
    this.mastLight.scale.set(0.9 * this.L.unit * (1 + this.mastGlow * 0.3));
    this.genLight.tint = 0xffd27a;
    // the generator stutters while the power dips
    const genFlicker = this.brownout > 0 ? 0.7 + 0.3 * Math.sin(this.t * 23) : 1;
    this.genLight.alpha = (0.1 + night * 0.35) * this.power * genFlicker;
    this.genLight.scale.set(1.4 * this.L.unit);

    for (const b of this.buildings.values()) {
      b.heat = Math.max(0, b.heat - dt * 0.2);
      b.glow = ease(b.glow, b.heat, dt, 0.9);
      b.tint = mix(b.tint, b.color, Math.min(1, dt * 0.8));
      b.lamp.tint = b.tint;
      b.lamp.scale.set(1.8 * this.L.unit);
      fade(b.lamp, Math.min(0.45, b.glow * 0.3 + night * 0.2) * this.power);
    }
    const now = performance.now();
    for (const t of this.tents.values()) {
      t.age += dt;
      const a = Math.max(0, Math.min(1, t.age * 1.5));
      fade(t.sprite, a);
      // names show while a device is active, then fade so the camp stays readable
      const quiet = (now - t.seen) / 1000;
      const want = quiet < LABEL_RECENT ? 0.9 : 0;
      fade(t.label, t.label.alpha + (a * want - t.label.alpha) * Math.min(1, dt * 0.6));
    }

    // perimeter lights
    const pg = this.perimeterG;
    pg.clear();
    for (const light of this.perimeterLights) {
      const a = 0.15 + light.heat * 0.75;
      const color = light.heat > 0.3 ? 0xff3322 : 0x44aa44;
      pg.circle(light.x, light.y, 2.5).fill({ color, alpha: a });
    }

    // wall damage decay (repair over time)
    this.wallDamage = Math.max(0, this.wallDamage - dt * 0.005);
    if (this.wallDamage < 0.05) this.crackG.clear();

    // claw damage bleeds off slowly while nobody is on the wall; gaps plank over
    for (let s = 0; s < 4; s++) {
      this.sideCooldown[s] = Math.max(0, this.sideCooldown[s] - dt);
      this.sideDamage[s] = Math.max(0, this.sideDamage[s] - dt * 0.01);
    }
    this.drawGaps();
  }
}

function mix(a: number, b: number, f: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Frame-rate independent exponential approach: `rate` ≈ 1/seconds to settle. */
function ease(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * Math.min(1, dt * rate);
}

/** Signed shortest rotation from angle a to angle b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
