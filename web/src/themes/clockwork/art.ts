import { Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import atlasUrl from './assets/machine.png';
import { FRAMES, type BakedFrame } from './assets/machine';

/**
 * The baked hero art, sliced out of one atlas.
 *
 * Every part was generated once, as a still in a rest pose, and its motion
 * frames were derived by rotating that single source about a stated pivot
 * (see scripts/bake-clockwork.mjs). So a part's frames are guaranteed to be
 * the same object at different angles, which is the one thing a generator
 * cannot promise you.
 *
 * Each frame carries the pivot's position inside it, because a rotated frame
 * is a different size and a different shape from its neighbours. Place a part
 * by its pivot and the swing stays hinged; place it by its corner and it
 * wanders.
 */
export interface Part {
  frames: Texture[];
  /** Pivot offset inside each frame, in world units. */
  pivots: Array<[number, number]>;
}

export type Parts = Record<string, Part>;

export async function loadParts(): Promise<Parts> {
  const sheet = await Assets.load<Texture>(atlasUrl);
  sheet.source.scaleMode = 'nearest';
  const out: Parts = {};
  for (const [name, frames] of Object.entries(FRAMES)) {
    out[name] = {
      frames: frames.map((f: BakedFrame) =>
        new Texture({ source: sheet.source, frame: new Rectangle(f.x, f.y, f.w, f.h) })),
      pivots: frames.map((f: BakedFrame) => [f.px, f.py] as [number, number]),
    };
  }
  return out;
}

/** A sprite that knows how to sit on its pivot. */
export class PartSprite extends Sprite {
  constructor(private part: Part) {
    super(part.frames[0]);
  }

  /** Show frame `i`, with the part's pivot at (x, y) in world units. */
  place(i: number, x: number, y: number): void {
    const n = this.part.frames.length;
    const k = ((i % n) + n) % n;
    this.texture = this.part.frames[k];
    const [px, py] = this.part.pivots[k];
    this.x = Math.round(x - px);
    this.y = Math.round(y - py);
  }

  /** Frames available, so callers can map a 0..1 progress onto them. */
  get count(): number { return this.part.frames.length; }
}

/** 0..1 progress -> frame index, clamped to the ends. */
export const frameAt = (u: number, n: number): number =>
  Math.max(0, Math.min(n - 1, Math.round(u * (n - 1))));
