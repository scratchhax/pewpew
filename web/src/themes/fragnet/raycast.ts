import type { TexTable, SprFrame } from './wad';
import { buildLUTs, redPalette, lightToTable } from './wad';
import { CS, EYE, WALL_H, DOOR, WALL, type Level } from './levelgen';

/**
 * The corridor painter: a software renderer in the old tradition. One
 * column at a time the maze is DDA-cast against the grid, walls, floors and
 * ceilings are textured straight from the WAD's index maps, and light is
 * whatever the COLORMAP says it is - no shaders, no fog pass, nothing
 * between the pixel and the palette. Sprites sort far-to-near and respect a
 * per-column z-buffer, so a demon leaning round a corner clips like it
 * should. Everything happens in an ImageData a few hundred pixels tall;
 * CSS does the stretching, nearest-neighbour, exactly like a CRT doing it
 * badly on purpose.
 */

/** Raw RGBA sprite (plates, glows): packed little-endian words, 0 = clear. */
export interface RgbaSprite { w: number; h: number; data: Uint32Array }

export interface Sprite {
  x: number; z: number;
  frame?: SprFrame;                 // palette-indexed sprite from the WAD
  rgba?: RgbaSprite;                // or a raw RGBA sprite
  scale: number;                    // height in world units
  zBase?: number;                   // height of the sprite's feet (default 0)
  add?: boolean;                    // additive blend (glows, fireballs)
  alpha?: number;                   // 0..1 for rgba sprites
}

interface CellStyle {
  wall: number;                     // key into the table's wall roles
  floorFlat: string; ceilFlat: string;
  light: number;
  flicker: boolean;
}

const ROOM_TECH: CellStyle = { wall: 0, floorFlat: 'techFloor', ceilFlat: 'ceil', light: 170, flicker: false };
const ROOM_BRICK: CellStyle = { wall: 1, floorFlat: 'floor', ceilFlat: 'ceil', light: 150, flicker: false };
const ROOM_HELL: CellStyle = { wall: 2, floorFlat: 'hellFloor', ceilFlat: 'hellCeil', light: 118, flicker: false };
const CORRIDOR: CellStyle = { wall: 0, floorFlat: 'floor', ceilFlat: 'ceil', light: 132, flicker: false };
const EXITROOM: CellStyle = { wall: 1, floorFlat: 'exitFloor', ceilFlat: 'exitCeil', light: 244, flicker: false };

const WALL_KEYS = ['tech', 'brick', 'hell', 'door'];
const FOG_START = 5.5, FOG_END = 17;

export class SoftRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private buf: Uint32Array = new Uint32Array(0);
  private img: ImageData | null = null;
  private zbuf = new Float32Array(0);
  private W = 0; private H = 0;

  private table: TexTable | null = null;
  private luts: Uint32Array[] = [];
  private lutsRed: Uint32Array[] = [];

  private level: Level | null = null;
  private styles: CellStyle[] = [];      // per cell, floor cells only meaningful
  private doorAt = new Map<number, number>();   // cell index -> door slot

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
  }

  /** Swap the whole art source (pack, uploaded WAD, or procedural fallback). */
  setTable(t: TexTable): void {
    this.table = t;
    this.luts = buildLUTs(t.palette, t.cmap);
    this.lutsRed = buildLUTs(redPalette(t.palette), t.cmap);
  }

  /** Bake per-cell materials and lights for a level. */
  setLevel(level: Level): void {
    this.level = level;
    const n = level.w * level.h;
    const styles: CellStyle[] = new Array(n).fill(CORRIDOR);
    for (let ri = 0; ri < level.rooms.length; ri++) {
      const r = level.rooms[ri];
      const isExit = r.cx === level.exit[0] && r.cy === level.exit[1];
      const style = isExit ? EXITROOM : ri % 4 === 3 ? ROOM_HELL : ri % 2 === 0 ? ROOM_TECH : ROOM_BRICK;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) styles[y * level.w + x] = style;
      }
    }
    for (const [lx, ly] of level.lamps) {
      for (let y = ly - 2; y <= ly + 2; y++) {
        for (let x = lx - 2; x <= lx + 2; x++) {
          if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
          const i = y * level.w + x;
          if (level.grid[i] === WALL) continue;
          const d = Math.max(Math.abs(x - lx), Math.abs(y - ly));
          if (d > 2) continue;
          styles[i] = { ...styles[i], light: Math.max(styles[i].light, d === 0 ? 232 : 196), flicker: true };
        }
      }
    }
    this.styles = styles;
    this.doorAt.clear();
    level.doors.forEach((d, i) => this.doorAt.set(d.y * level.w + d.x, i));
  }

  setPixRes(heightPx: number): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const h = Math.max(120, Math.round(heightPx));
    const w = Math.max(160, Math.round(h * aspect));
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    this.canvas.width = w; this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.zbuf = new Float32Array(w);
  }

  resize(_w: number, _h: number): void { /* resolution is dPixRes-driven; nothing else to do */ }

  get context(): CanvasRenderingContext2D { return this.ctx; }
  get width(): number { return this.W; }
  get height(): number { return this.H; }

  render(camX: number, camZ: number, heading: number, sprites: Sprite[], t: number, heat: number, flash: number): void {
    const { buf, W, H, table } = this;
    if (!table || !this.img || !this.level) return;
    const level = this.level;
    const dirX = Math.sin(heading), dirZ = Math.cos(heading);
    const planeX = Math.cos(heading), planeZ = -Math.sin(heading);
    const halfW = W / 2;
    const cy = H / 2 + this.bobPx;
    const pxPerUnit = (d: number): number => halfW / Math.max(0.02, d);
    const red = heat > 0.5;
    const luts = red ? this.lutsRed : this.luts;
    const boost = flash * 0.9;

    // ── walls, floor, ceiling ──
    const posCellX = camX / CS, posCellZ = camZ / CS;
    for (let x = 0; x < W; x++) {
      const cam2 = (2 * x) / W - 1;
      const rayX = dirX + planeX * cam2, rayZ = dirZ + planeZ * cam2;
      let mapX = Math.floor(posCellX), mapZ = Math.floor(posCellZ);
      const stepX = rayX > 0 ? 1 : -1, stepZ = rayZ > 0 ? 1 : -1;
      const dDX = Math.abs(1 / (rayX || 1e-9)), dDZ = Math.abs(1 / (rayZ || 1e-9));
      let sideX = rayX > 0 ? (mapX + 1 - posCellX) * dDX : (posCellX - mapX) * dDX;
      let sideZ = rayZ > 0 ? (mapZ + 1 - posCellZ) * dDZ : (posCellZ - mapZ) * dDZ;
      let side = 0, hit = 0, guard = 0;
      while (!hit && guard++ < 96) {
        if (sideX < sideZ) { sideX += dDX; mapX += stepX; side = 0; }
        else { sideZ += dDZ; mapZ += stepZ; side = 1; }
        if (mapX < 0 || mapZ < 0 || mapX >= level.w || mapZ >= level.h) { hit = 2; break; }
        const cell = level.grid[mapZ * level.w + mapX];
        if (cell === WALL) hit = 1;
        else if (cell === DOOR) {
          const slot = this.doorAt.get(mapZ * level.w + mapX);
          const door = slot === undefined ? null : level.doors[slot];
          if (door && door.sealed > 0) hit = 3;                       // sealed: red steel
        }
      }
      const perp = side === 0 ? sideX - dDX : sideZ - dDZ;
      const dist = Math.max(0.05, perp) * CS;
      this.zbuf[x] = dist;
      const ppu = pxPerUnit(dist);
      const wallTop = cy + (EYE - WALL_H) * ppu;
      const wallBot = cy + EYE * ppu;

      // texture choice for the face
      let tex = table.walls.tech;
      let style: CellStyle | null = null;
      if (hit === 1) {
        // the floor cell we came from owns the face's material and light
        const fx = side === 0 ? mapX - stepX : mapX;
        const fz = side === 1 ? mapZ - stepZ : mapZ;
        style = this.styles[fz * level.w + fx] ?? CORRIDOR;
        tex = this.wallTex(table, WALL_KEYS[style.wall]);
      } else if (hit === 3) {
        tex = this.wallTex(table, 'door');
      }
      const colLuts = hit === 3 ? this.lutsRed : luts;
      const colLight = hit === 3 ? 236 : style ? this.effLight(style, dist, t, boost, 0, 0) : 90;
      const lut = colLuts[lightToTable(colLight)];

      // wall span
      let wallU = side === 0 ? (posCellZ + perp * rayZ) % 1 : (posCellX + perp * rayX) % 1;
      if (wallU < 0) wallU += 1;
      let texX = (wallU * tex.w) | 0;
      if (side === 0 && rayX > 0) texX = tex.w - 1 - texX;
      if (side === 1 && rayZ < 0) texX = tex.w - 1 - texX;
      const y0 = Math.max(0, Math.ceil(wallTop)), y1 = Math.min(H - 1, Math.floor(wallBot));
      const vScale = (tex.h * WALL_H) / (CS * Math.max(1, wallBot - wallTop));
      for (let y = y0; y <= y1; y++) {
        let texY = (((y - wallTop) * vScale) | 0) % tex.h;
        if (texY < 0) texY += tex.h;
        buf[y * W + x] = lut[tex.idx[texY * tex.w + texX]];
      }

      // ceiling above and floor below, one flat per cell, lit by the cell
      const floorStyle = style ?? CORRIDOR;
      const fTex = table.flats[floorStyle.floorFlat] ?? table.flats.floor;
      const cTex = table.flats[floorStyle.ceilFlat] ?? table.flats.ceil;
      if (fTex) {
        for (let y = y1 + 1; y < H; y++) {
          const d = (EYE * halfW) / (y - cy);
          const wx = camX + rayX * d, wz = camZ + rayZ * d;
          const cxi = (wx / CS) | 0, czi = (wz / CS) | 0;
          const st = this.styles[czi * level.w + cxi] ?? floorStyle;
          const lt = this.clampL(lightToTable(this.effLight(st, d, t, boost, cxi, czi) * 0.92));
          const px = ((((wx / CS) % 1) * 64) | 0) & 63, py = ((((wz / CS) % 1) * 64) | 0) & 63;
          buf[y * W + x] = luts[lt][fTex[py * 64 + px]];
        }
      }
      if (cTex) {
        const ceilH = WALL_H - EYE;
        for (let y = 0; y < y0; y++) {
          const d = (ceilH * halfW) / (cy - y);
          const wx = camX + rayX * d, wz = camZ + rayZ * d;
          const cxi = (wx / CS) | 0, czi = (wz / CS) | 0;
          const st = this.styles[czi * level.w + cxi] ?? floorStyle;
          const lt = this.clampL(lightToTable(this.effLight(st, d, t, boost, cxi, czi) * 0.8));
          const px = ((((wx / CS) % 1) * 64) | 0) & 63, py = ((((wz / CS) % 1) * 64) | 0) & 63;
          buf[y * W + x] = luts[lt][cTex[py * 64 + px]];
        }
      }
    }

    // ── sprites, far to near, z-buffered ──
    const invDet = 1 / (planeX * dirZ - dirX * planeZ);
    const order = sprites
      .map((s, i) => [s, (s.x - camX) ** 2 + (s.z - camZ) ** 2] as const)
      .sort((a, b) => b[1] - a[1]);
    for (const [s] of order) {
      const dx = s.x - camX, dz = s.z - camZ;
      const tX = invDet * (dirZ * dx - dirX * dz);
      const tZ = invDet * (-planeZ * dx + planeX * dz);
      if (tZ < 0.15 || tZ > 40) continue;
      const ppu = pxPerUnit(tZ);
      const sw = s.frame ? s.scale * (s.frame.w / s.frame.h) * ppu : s.scale * (s.rgba!.w / s.rgba!.h) * ppu;
      const sh = s.scale * ppu;
      const zBase = s.zBase ?? 0;
      const top = cy + (EYE - zBase - s.scale) * ppu;
      const cxS = halfW + (tX / tZ) * halfW;
      const x0 = Math.max(0, Math.ceil(cxS - sw / 2)), x1 = Math.min(W - 1, Math.floor(cxS + sw / 2));
      const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H - 1, Math.floor(top + sh));
      const cellStyle = this.styles[((s.z / CS) | 0) * level.w + ((s.x / CS) | 0)] ?? CORRIDOR;
      const light = s.add ? 255 : this.effLight(cellStyle, tZ, t, boost, (s.x / CS) | 0, (s.z / CS) | 0);
      if (s.frame) {
        const f = s.frame;
        const lut = luts[lightToTable(light)];
        for (let x = x0; x <= x1; x++) {
          if (tZ >= this.zbuf[x]) continue;
          const u = (((x - (cxS - sw / 2)) * f.w) / sw) | 0;
          if (u < 0 || u >= f.w) continue;
          for (let y = y0; y <= y1; y++) {
            const v = (((y - top) * f.h) / sh) | 0;
            if (v < 0 || v >= f.h) continue;
            const px = lut[f.idx[v * f.w + u]];
            if (px) buf[y * W + x] = px;
          }
        }
      } else if (s.rgba) {
        const r = s.rgba;
        const a = s.alpha ?? 1;
        for (let x = x0; x <= x1; x++) {
          if (tZ >= this.zbuf[x]) continue;
          const u = (((x - (cxS - sw / 2)) * r.w) / sw) | 0;
          if (u < 0 || u >= r.w) continue;
          for (let y = y0; y <= y1; y++) {
            const v = (((y - top) * r.h) / sh) | 0;
            if (v < 0 || v >= r.h) continue;
            const src = r.data[v * r.w + u];
            if (!src) continue;
            const dst = buf[y * W + x];
            if (s.add) {
              const rr = Math.min(255, (dst & 0xff) + ((src & 0xff) * a)) | 0;
              const gg = Math.min(255, ((dst >> 8) & 0xff) + (((src >> 8) & 0xff) * a)) | 0;
              const bb = Math.min(255, ((dst >> 16) & 0xff) + (((src >> 16) & 0xff) * a)) | 0;
              buf[y * W + x] = 0xff000000 | (bb << 16) | (gg << 8) | rr;
            } else {
              const al = ((src >> 24) & 0xff) / 255 * a;
              if (al < 0.05) continue;
              const rr = ((dst & 0xff) * (1 - al) + (src & 0xff) * al) | 0;
              const gg = (((dst >> 8) & 0xff) * (1 - al) + ((src >> 8) & 0xff) * al) | 0;
              const bb = (((dst >> 16) & 0xff) * (1 - al) + ((src >> 16) & 0xff) * al) | 0;
              buf[y * W + x] = 0xff000000 | (bb << 16) | (gg << 8) | rr;
            }
          }
        }
      }
    }

    this.ctx.putImageData(this.img, 0, 0);
  }

  /** Vertical eye bob in render pixels, set by the caller each frame. */
  bobPx = 0;

  private wallTex(table: TexTable, key: string): { w: number; h: number; idx: Uint8Array } {
    return table.walls[key] ?? table.walls.tech ?? { w: 64, h: 64, idx: new Uint8Array(64 * 64) };
  }

  private clampL(v: number): number { return v < 0 ? 0 : v > 31 ? 31 : v | 0; }

  /** Distance falloff, lamp flicker and the muzzle-flash boost. */
  private effLight(style: CellStyle, distWorld: number, t: number, boost: number, cx: number, cz: number): number {
    let l = style.light;
    if (style.flicker) {
      const h = Math.sin(cx * 127.1 + cz * 311.7) * 43758.5453;
      l *= 0.86 + 0.14 * Math.abs(Math.sin(t * (8 + (h - Math.floor(h)) * 6) + h));
    }
    if (distWorld > FOG_START) l *= Math.max(0.1, 1 - (distWorld - FOG_START) / (FOG_END - FOG_START));
    return Math.min(255, l * (1 + boost));
  }

  /** Line of sight between two floor points, for demon aggro. */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    const level = this.level;
    if (!level) return false;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return true;
    const steps = Math.ceil((len / CS) * 4);
    for (let k = 1; k < steps; k++) {
      const f = k / steps;
      const x = ax + dx * f, z = az + dz * f;
      if (level.grid[((z / CS) | 0) * level.w + ((x / CS) | 0)] === WALL) return false;
    }
    return true;
  }
}
