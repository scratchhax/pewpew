/**
 * Mode 7: the SNES flip-board in software, written the way fragnet writes its
 * corridor — one pass into a Uint32 buffer, then CSS upscales it with hard
 * pixel edges. For every screen row below the horizon we know the ground
 * distance it looks at (`d = camH·f / (y − horizon)`), and the strip of the
 * world bitmap under that row is `camera + F·d ± R·lat`. That is two
 * multiplies per pixel and a texel fetch: cheaper per pixel than a raycast
 * column, and it wobbles like the real board.
 */

const TEXP = 1024;          // world bitmap side (must be a power of two)

export interface Cam {
  x: number; y: number;     // position on the world bitmap, texture units
  heading: number;          // radians; 0 = looking along +x
  speedFrac: number;        // 0..1.4, drives the wobble and the field of view
  bob: number;              // horizon offset in buffer px (hills of the board)
}

export class Mode7 {
  private img: ImageData | null = null;
  private px: Uint32Array | null = null;
  W = 0; H = 0; scale = 1;
  horizonY = 0;
  private fx = 1; private fy = 0;      // forward
  private rx = 0; private ry = 1;      // right
  private focal = 1;
  /** The focal length the last ground pass actually used, after the speed
   *  widening. Sprites project with this so they stay pinned to the road. */
  drawFocal = 1;
  readonly camH = 9.2;                 // camera height above the plane, units

  constructor(private canvas: HTMLCanvasElement, private ctx: CanvasRenderingContext2D) {
    canvas.style.display = 'block';
    canvas.style.imageRendering = 'pixelated';
    ctx.imageSmoothingEnabled = false;
  }

  /** fragnet's rule: whole-pixel integer upscale that fills the window. */
  resize(winW: number, winH: number, rows: number): void {
    const scale = Math.max(1, Math.round(winH / rows));
    const w = Math.floor(winW / scale), h = Math.floor(winH / scale);
    if (w === this.W && h === this.H) return;
    this.scale = scale; this.W = w; this.H = h;
    this.canvas.width = w; this.canvas.height = h;
    this.canvas.style.width = `${w * scale}px`;
    this.canvas.style.height = `${h * scale}px`;
    this.canvas.style.margin = `${Math.max(0, (window.innerHeight - h * scale) / 2)}px auto`;
    this.img = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
    this.focal = h * 1.33;
  }

  /** Bake the sky once: dusk gradient, two tileable ridges, and a low sun. */
  bakeSky(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = 2048; cv.height = 72;
    const c = cv.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 0, 72);
    g.addColorStop(0, '#070912'); g.addColorStop(0.62, '#1a1c33'); g.addColorStop(1, '#5c4668');
    c.fillStyle = g; c.fillRect(0, 0, 2048, 72);
    // low pixel sun
    const sunx = 700;
    for (let r = 26; r > 0; r -= 2) {
      c.fillStyle = `rgba(255, ${190 + (26 - r) * 2 | 0}, ${90 + r * 4}, ${0.25 + (26 - r) / 40})`;
      c.beginPath(); c.arc(sunx, 58, r, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#ffd86a';
    c.beginPath(); c.arc(sunx, 58, 12, 0, Math.PI * 2); c.fill();
    const ridge = (base: number, amp: number, k1: number, k2: number, ph: number, col: string) => {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(0, 72);
      for (let x = 0; x <= 2048; x += 8) {
        const a = (x / 2048) * Math.PI * 2;
        c.lineTo(x, base - amp * (0.6 * Math.abs(Math.sin(a * k1 + ph)) + 0.4 * Math.sin(a * k2 + ph * 2)));
      }
      c.lineTo(2048, 72); c.closePath(); c.fill();
    };
    ridge(34, 16, 4, 9, 1.2, '#232642');
    ridge(44, 12, 7, 13, 4.1, '#141730');
    return cv;
  }

  /**
   * Draw sky + ground for this camera. `sky` is the baked strip; its x scrolls
   * with heading so the mountains turn with the board.
   */
  renderGround(cam: Cam, tex: Uint32Array, sky: HTMLCanvasElement): void {
    const { W, H, px, img } = this;
    if (!px || !img) return;
    const h = cam.heading;
    this.fx = Math.cos(h); this.fy = Math.sin(h);
    this.rx = -this.fy; this.ry = this.fx;
    // The field of view opens as the pace builds - the ground rushes past the
    // edges of the screen and the horizon pulls away. It is the oldest speed
    // cue there is and it costs one multiply. Eased, never snapped.
    const f = this.focal * (1 - 0.13 * Math.min(1, cam.speedFrac));
    this.drawFocal = f;
    const hy = Math.max(1, Math.min(H - 6, Math.round(H * 0.42 + cam.bob)));
    this.horizonY = hy;

    // ground first (raw writes), then the sky slice covers the rows above
    // the horizon; its x scrolls with heading so the mountains turn with us
    const fogFar = 1500;
    for (let y = hy; y < H; y++) {
      const d = this.camH * f / (y - hy + 0.5);
      const k = d / f;
      let tw = (cam.x + this.fx * d - this.rx * (W * 0.5 * k)) | 0;
      let th = (cam.y + this.fy * d - this.ry * (W * 0.5 * k)) | 0;
      const sx1 = this.rx * k, sy1 = this.ry * k;
      const fogT = Math.min(0.94, (d / fogFar) * (d / fogFar));
      const inv = 1 - fogT;
      const fr = 26 * fogT, fg = 28 * fogT, fb = 40 * fogT;   // dusk mist
      let o = y * W;
      for (let x = 0; x < W; x++, o++) {
        const t = tex[(th & (TEXP - 1)) * TEXP + (tw & (TEXP - 1))];
        const r = t & 255, g = (t >>> 8) & 255, b = (t >>> 16) & 255;
        px[o] = 0xff000000 | ((((b * inv + fb) | 0) & 255) << 16) | ((((g * inv + fg) | 0) & 255) << 8) | ((r * inv + fr) | 0);
        tw += sx1; th += sy1;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    const sx = ((h / (Math.PI * 2)) * 2048 * 2) % 2048;
    const w1 = Math.min(W, 2048 - sx);
    this.ctx.drawImage(sky, sx, 0, w1, 72, 0, 0, w1, hy);
    if (sx + W > 2048) this.ctx.drawImage(sky, 0, 0, sx + W - 2048, 72, 2048 - sx, 0, sx + W - 2048, hy);
  }

  /** Project a world point onto the buffer. Null if behind or at the camera. */
  project(wx: number, wy: number, cam: Cam): { sx: number; baseY: number; depth: number; k: number } | null {
    const dx = wx - cam.x, dy = wy - cam.y;
    const depth = dx * this.fx + dy * this.fy;
    if (depth < 1.5) return null;
    const lat = dx * this.rx + dy * this.ry;
    // the focal the ground was drawn with, or sprites drift off the road as
    // the field of view opens
    const k = this.drawFocal / depth;
    return { sx: this.W / 2 + lat * k, baseY: this.horizonY + this.camH * k, depth, k };
  }

  /**
   * Draw a sprite standing on the plane at (wx, wy). Sorted by the caller
   * (back to front); clipped to below the horizon so nothing pokes into the sky.
   */
  drawSprite(spr: HTMLCanvasElement, wx: number, wy: number, cam: Cam, worldH: number, alpha = 1, lift = 0): boolean {
    const p = this.project(wx, wy, cam);
    if (!p) return false;
    // `worldH` is how tall the thing stands on the board, in board units, and
    // the width follows the sprite's own aspect. It used to be the other way
    // round, which meant the same kart was 1.28 units tall seen from behind and
    // 0.75 from the side - it shrank when it turned - and left every prop sized
    // against nothing, so the item box came out twice the height of a kart.
    const sh = worldH * p.k;
    const sw = sh * (spr.width / spr.height);
    if (sw < 1 || p.sx < -sw || p.sx > this.W + sw) return false;
    const ctx = this.ctx;
    const was = ctx.globalAlpha;
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.horizonY, this.W, this.H - this.horizonY);
    ctx.clip();
    // hard pixel shadow, then the sprite
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(p.sx - sw * 0.34, p.baseY - 1, sw * 0.68, Math.max(1, p.k * 0.18));
    ctx.drawImage(spr, Math.round(p.sx - sw / 2), Math.round(p.baseY - sh - lift * p.k), Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
    ctx.restore();
    ctx.globalAlpha = was;
    return true;
  }

  /** Speed chevrons rushing up the screen edges, classic race-TV style. */
  drawChevrons(intensity: number, t: number, col = 'rgba(255,255,255,0.5)'): void {
    const { ctx, W, H } = this;
    if (intensity <= 0.02) return;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    // more of them, running faster, the harder we are going: they used to
    // appear only under a boost, so cruising had no speed cue at all
    const n = 4 + Math.round(intensity * 5);
    const rate = 1.5 + intensity * 3.4;
    for (let side = 0; side < 2; side++) {
      const x0 = side ? W - 26 : 6;
      for (let i = 0; i < n; i++) {
        const ph = ((t * rate + i / n) % 1);
        const y = H * (0.35 + 0.62 * ph);
        ctx.globalAlpha = intensity * (1 - ph) * 0.8;
        ctx.beginPath();
        ctx.moveTo(x0, y - 7); ctx.lineTo(x0 + 12, y); ctx.lineTo(x0, y + 7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
