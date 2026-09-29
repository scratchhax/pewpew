import {
  Application, Container, Graphics, Particle, ParticleContainer,
  RenderTexture, Sprite, Texture,
} from 'pixi.js';
import type { CrackKind } from './crack';

/**
 * Substrate's renderer.
 *
 * The one thing that matters here: the picture lives in a RenderTexture that
 * is NEVER cleared while a cycle runs. Every frame we draw only what grew
 * this frame — a handful of hairline segments and a drift of pigment grains —
 * straight into that texture with `clear: false`, and the plate keeps the rest.
 * That is how a two-minute drawing costs the same per frame at second 110 as
 * it did at second 2, and it is why the scene can afford tens of thousands of
 * grains a frame.
 *
 * Pigment goes through a single ParticleContainer: one draw call, one shared
 * soft-dot texture, per-grain colour. We write `Particle.color` directly
 * (packed BGR + alpha byte) rather than going through the `tint`/`alpha`
 * setters, which would run a Color parse per grain — at 30k grains a frame
 * that is the difference between free and not.
 */

/** Size of the soft dot every grain is stamped from. */
const DOT = 16;

const KINDS: CrackKind[] = ['allow', 'block', 'threat', 'wifi', 'system'];

/** Blend `b` into `a` by `k`. */
function mix(a: number, b: number, k: number): number {
  const q = (s: number, t: number): number => ((s + (t - s) * k) | 0) & 0xff;
  return (q((a >> 16) & 0xff, (b >> 16) & 0xff) << 16)
       | (q((a >> 8) & 0xff, (b >> 8) & 0xff) << 8)
       | q(a & 0xff, b & 0xff);
}

/**
 * Pigment grain footprint, in lattice cells. Tarbell stamps a hard single
 * pixel; a soft dot reads better at our scale, but every cell of extra radius
 * spreads the same alpha over more area and washes the colour out, so this
 * stays close to a pixel.
 */
const GRAIN_PX = 1.6;

export interface PaperLook {
  /** Background the plate is cleared to. */
  paper: number;
  /** Colour of the crack hairline. */
  line: number;
  lineAlpha: number;
  /** Pigment brightens the plate instead of staining it. */
  additive: boolean;
}

/** Warm paper, near-black plate, and everything between. */
export function paperLook(t: number): PaperLook {
  const k = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number): number => {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    return (((ar + (br - ar) * k) | 0) << 16)
         | (((ag + (bg - ag) * k) | 0) << 8)
         | ((ab + (bb - ab) * k) | 0);
  };
  return {
    paper: lerp(0xf4efe3, 0x07080b),
    line: k < 0.5 ? 0x0d0b09 : 0xe2ebf0,
    lineAlpha: k < 0.5 ? 0.9 : 0.5,
    additive: k >= 0.5,
  };
}

export class View {
  /**
   * The picture is two accumulating layers, not one.
   *
   * Pigment goes into `plate`; the crack hairlines go into `ink`, which is
   * composited over it. Painting both into a single buffer looks right for a
   * few seconds and then fails: a wash laid at second fifty draws straight
   * over every hairline near it, so by the end of a two-minute cycle the
   * lattice has been quietly buried under its own colour and the plate reads
   * as a haze. Keeping the ink above the paint means a line drawn in the first
   * second is still a line in the last one.
   */
  private plate: RenderTexture;
  private picture: Sprite;
  private ink: RenderTexture;
  private inkLayer: Sprite;
  /** An empty root, for clearing a target with nothing in it. */
  private empty = new Container();
  /** Sits behind the picture, so fading the picture out reveals paper and not void. */
  private bg: Graphics;
  /**
   * This frame's hairlines, one bucket per event kind. Cracks each carry their
   * own shade, but stroking a Graphics per crack would be a draw call per
   * crack; bucketing by kind keeps the colour law in the structure at five
   * stroke calls a frame however busy the plate gets.
   */
  private lines: Record<CrackKind, Graphics> = {
    allow: new Graphics(), block: new Graphics(), threat: new Graphics(),
    wifi: new Graphics(), system: new Graphics(),
  };
  private lineGroup = new Container();
  private grainGroup = new Container();
  private grains: ParticleContainer;
  private dot: Texture;
  /** Grain pool. Only ever grows; `particleChildren` is re-pointed at a slice of it. */
  private pool: Particle[] = [];
  private n = 0;
  private cap = 30000;

  private look: PaperLook = paperLook(0);
  private grainScale = GRAIN_PX / DOT;
  private law: Record<CrackKind, number> = {
    allow: 0x808080, block: 0x808080, threat: 0x808080,
    wifi: 0x808080, system: 0x808080,
  };

  /** Lattice size. */
  w = 0;
  h = 0;
  private screenW = 0;
  private screenH = 0;

  readonly stage = new Container();

  constructor(private app: Application) {
    this.dot = makeDot();
    this.bg = new Graphics();
    this.plate = RenderTexture.create({ width: 16, height: 16 });
    this.picture = new Sprite(this.plate);
    this.ink = RenderTexture.create({ width: 16, height: 16 });
    this.inkLayer = new Sprite(this.ink);
    this.grains = new ParticleContainer({
      texture: this.dot,
      // positions and colours change every frame; nothing else does
      dynamicProperties: { position: true, color: true, rotation: false, uvs: false, vertex: false },
    });
    for (const k of KINDS) this.lineGroup.addChild(this.lines[k]);
    // Both passes render through a plain Container root rather than handing
    // the renderer a bare leaf: a ParticleContainer given straight to
    // renderer.render() as its own root draws nothing, silently.
    this.grainGroup.addChild(this.grains);
    this.stage.addChild(this.bg, this.picture, this.inkLayer);
  }

  /** The event colours the hairlines are tinted toward. Set once by the theme. */
  setLaw(law: Record<CrackKind, number>): void {
    this.law = law;
  }

  /**
   * Rebuild the plate at a new lattice size. The picture cannot survive this
   * (the lattice is the picture), so the caller restarts the cycle.
   */
  resize(screenW: number, screenH: number, latticeW: number, latticeH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
    this.w = latticeW;
    this.h = latticeH;
    this.plate.destroy(true);
    this.ink.destroy(true);
    this.plate = RenderTexture.create({ width: latticeW, height: latticeH, antialias: false });
    this.ink = RenderTexture.create({ width: latticeW, height: latticeH, antialias: false });
    this.picture.texture = this.plate;
    this.inkLayer.texture = this.ink;
    // 4% of overscan gives the anti burn-in wander somewhere to go without
    // ever pulling the edge of the plate into view
    this.picture.width = screenW * 1.04;
    this.picture.height = screenH * 1.04;
    this.inkLayer.width = this.picture.width;
    this.inkLayer.height = this.picture.height;
    this.bg.clear().rect(0, 0, screenW, screenH).fill({ color: this.look.paper });
    this.clearPlate();
  }

  /** Set the sheet: paper, ink and whether pigment stains or brightens. */
  setLook(look: PaperLook): void {
    this.look = look;
    this.grains.blendMode = look.additive ? 'add' : 'normal';
    if (this.screenW) {
      this.bg.clear().rect(0, 0, this.screenW, this.screenH).fill({ color: look.paper });
    }
  }

  /** Wash the plate back to bare paper, and the ink back to nothing. */
  clearPlate(): void {
    const g = new Graphics().rect(0, 0, this.w, this.h).fill({ color: this.look.paper });
    this.app.renderer.render({ container: g, target: this.plate, clear: true });
    g.destroy();
    // the ink layer sits over the paint, so it clears to transparent, not paper
    this.app.renderer.render({
      container: this.empty, target: this.ink, clear: true, clearColor: [0, 0, 0, 0],
    });
  }

  /** Repaint just the sheet behind the picture, for the wash cross-fade. */
  setBg(color: number): void {
    if (!this.screenW) return;
    this.bg.clear().rect(0, 0, this.screenW, this.screenH).fill({ color });
  }

  /** How much of the picture is showing, 0..1 — the cycle fades this. */
  setPictureAlpha(a: number): void {
    this.picture.alpha = a;
    this.inkLayer.alpha = a;
  }

  /** Anti burn-in drift: nudge the oversized plate rather than the art. */
  setWander(x: number, y: number): void {
    this.picture.x = -this.screenW * 0.02 + x;
    this.picture.y = -this.screenH * 0.02 + y;
    this.inkLayer.x = this.picture.x;
    this.inkLayer.y = this.picture.y;
  }

  setGrainSize(px: number): void {
    this.grainScale = px / DOT;
  }

  // ── the frame ────────────────────────────────────────────────────────────

  beginFrame(cap: number): void {
    this.cap = cap;
    this.n = 0;
    for (const k of KINDS) this.lines[k].clear();
  }

  /** Pigment sink handed to the Plate. */
  sand = (x: number, y: number, color: number, alpha: number): void => {
    if (this.n >= this.cap) return;
    let p = this.pool[this.n];
    if (!p) {
      p = new Particle({ texture: this.dot, anchorX: 0.5, anchorY: 0.5 });
      this.pool[this.n] = p;
    }
    p.x = x;
    p.y = y;
    p.scaleX = this.grainScale;
    p.scaleY = this.grainScale;
    // pack straight into the wire format: BGR in the low 24 bits, alpha on top
    const a = alpha < 0 ? 0 : alpha > 1 ? 255 : (alpha * 255) | 0;
    p.color = (((color & 0xff) << 16) | (color & 0xff00) | ((color >> 16) & 0xff))
            + (a << 24);
    this.n++;
  };

  /** Hairline sink handed to the Plate. */
  line = (x0: number, y0: number, x1: number, y1: number, kind: CrackKind): void => {
    this.lines[kind].moveTo(x0, y0).lineTo(x1, y1);
  };

  /** Commit this frame's growth into the plate. */
  flush(): void {
    const r = this.app.renderer;

    // Pigment goes down first and the crack is drawn on top of it. The other
    // way round the wash buries its own hairline — the grains nearest the
    // crack are the strongest ones — and the whole lattice goes soft.
    if (this.n > 0) {
      const ch = this.grains.particleChildren;
      ch.length = this.n;
      for (let i = 0; i < this.n; i++) ch[i] = this.pool[i];
      this.grains.update();
      r.render({ container: this.grainGroup, target: this.plate, clear: false });
    }

    // the hairline stays mostly ink — the structure has to read crisp — but
    // carries enough of its event's hue that a scar is visibly a scar
    for (const k of KINDS) {
      this.lines[k].stroke({
        width: 1.4,
        color: mix(this.look.line, this.law[k], 0.12),
        alpha: this.look.lineAlpha,
      });
    }
    r.render({ container: this.lineGroup, target: this.ink, clear: false });
  }

  /** Grains drawn in the last frame — for the debug overlay. */
  get lastGrains(): number {
    return this.n;
  }

  destroy(): void {
    this.grains.particleChildren.length = 0;
    this.pool.length = 0;
    this.grains.destroy();
    for (const k of KINDS) this.lines[k].destroy();
    this.lineGroup.destroy();
    this.grainGroup.destroy();
    this.bg.destroy();
    this.picture.destroy();
    this.inkLayer.destroy();
    this.empty.destroy();
    this.plate.destroy(true);
    this.ink.destroy(true);
    this.dot.destroy(true);
  }
}

/**
 * A soft round dot. Grains are stamped from this and overlap in their
 * thousands at very low alpha, which is what turns discrete points into a
 * watercolour wash — hard pixels read as noise instead.
 */
function makeDot(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = DOT;
  const ctx = c.getContext('2d')!;
  const r = DOT / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DOT, DOT);
  return Texture.from(c);
}
