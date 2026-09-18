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
  private seq = -1;
  private seqT = 0;
  private bobPhase = 0;
  private visible = true;

  /** Pre-render the palette-indexed weapon frames onto true-colour canvases. */
  load(frames: GunFrames | null, palette: Uint8Array): void {
    this.canvases.clear();
    if (!frames) return;
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
        // a hair brighter than the corridor, so the gun never becomes a
        // black hole against a dark wall the way DOOM's own art tends to
        const r = Math.min(255, palette[v * 3] * 1.08 + 5) | 0;
        const g = Math.min(255, palette[v * 3 + 1] * 1.08 + 5) | 0;
        const b = Math.min(255, palette[v * 3 + 2] * 1.08 + 5) | 0;
        data[i] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
      ctx.putImageData(img, 0, 0);
      this.canvases.set(key, cvs);
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
    const key = this.seq >= 0 ? SEQUENCE[this.seq][0] : 'A';
    const cvs = this.canvases.get(key) ?? this.canvases.get('A');
    if (!cvs) return;
    const gh = H * 0.5;
    const gw = gh * (cvs.width / cvs.height);
    const bobX = Math.sin(this.bobPhase) * W * 0.01;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * H * 0.01;
    const recoil = this.seq >= 0 ? H * 0.04 * (1 - this.seqT / SEQUENCE[this.seq][1]) : 0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cvs, (W - gw) / 2 + bobX, H - gh * 0.86 + bobY + recoil, gw, gh);
  }
}
