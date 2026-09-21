import type { SprFrame } from './wad';

/**
 * The marine's shotgun, the way it was always meant to sit: a flat sprite
 * pinned to the bottom centre of the screen, bobbing with the walk and
 * punching through its frames when it fires - fire, pump back, pump
 * forward, ready. It is painted into the same low-res ImageData canvas as
 * the corridor, so the pixels match and the gun can never float or tilt or
 * point at the ceiling.
 */

export interface GunFrames { A?: SprFrame; B?: SprFrame; C?: SprFrame; D?: SprFrame }

/** Fire timing: flash, pump back, pump forward, then idle. */
const SEQUENCE: Array<[keyof GunFrames, number]> = [['B', 0.1], ['C', 0.14], ['D', 0.14]];

export class Gun2D {
  private canvases = new Map<string, HTMLCanvasElement>();
  private idleKey = 'A';
  private seq = -1;
  private seqT = 0;
  private bobPhase = 0;
  private visible = true;

  /** Pre-render the palette-indexed weapon frames onto true-colour canvases. */
  load(frames: GunFrames | null, palette: Uint8Array): void {
    this.canvases.clear();
    if (!frames) return;
    let bestArea = -1;
    for (const [key, f] of Object.entries(frames)) {
      if (!f) continue;
      const cvs = document.createElement('canvas');
      cvs.width = f.w; cvs.height = f.h;
      const ctx = cvs.getContext('2d')!;
      const img = ctx.createImageData(f.w, f.h);
      const data = new Uint32Array(img.data.buffer);
      for (let i = 0; i < f.w * f.h; i++) {
        const v = f.idx[i];
        if (v === 255) { data[i] = 0; continue; }
        // full bright, exactly like the game draws its weapon: the palette
        // as-is, no LUT, no lift - the gun is the brightest thing on screen
        data[i] = 0xff000000 | (palette[v * 3 + 2] << 16) | (palette[v * 3 + 1] << 8) | palette[v * 3];
      }
      ctx.putImageData(img, 0, 0);
      this.canvases.set(key, cvs);
      // some WADs make the idle frame a muzzle-only stub; the ready pose is
      // whichever frame actually shows the whole gun
      if (f.w * f.h > bestArea) { bestArea = f.w * f.h; this.idleKey = key; }
    }
  }

  fire(): void {
    if (!this.canvases.size) return;
    this.seq = 0;
    this.seqT = 0;
  }

  get firing(): boolean { return this.seq >= 0; }

  update(dt: number, bobPhase: number, _moving: boolean, visible: boolean): void {
    this.bobPhase = bobPhase;
    this.visible = visible;
    if (this.seq >= 0) {
      this.seqT += dt;
      if (this.seqT >= SEQUENCE[this.seq][1]) {
        this.seqT = 0;
        this.seq++;
        if (this.seq >= SEQUENCE.length) this.seq = -1;
      }
    }
  }

  /** Paint the gun into the internal-resolution buffer's canvas. */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    if (!this.visible || !this.canvases.size) return;
    const key = this.seq >= 0 ? SEQUENCE[this.seq][0] : this.idleKey;
    const cvs = this.canvases.get(key) ?? this.canvases.get(this.idleKey);
    if (!cvs) return;
    // the game's own placement: native pixel size on a 200-line screen,
    // bottom edge flush with the screen bottom (hands and all), centered a
    // hair right of middle
    const s = H / 200;
    const gw = cvs.width * s, gh = cvs.height * s;
    const bobX = Math.sin(this.bobPhase) * 2 * s;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 2 * s;
    const recoil = this.seq >= 0 ? 6 * s * (1 - this.seqT / SEQUENCE[this.seq][1]) : 0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cvs, (W - gw) / 2 + W * 0.015 + bobX, H - gh + bobY + recoil, gw, gh);
  }
}
