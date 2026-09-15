import {
  BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Uint16BufferAttribute,
  Uint32BufferAttribute, Vector3, type Scene, type Texture,
} from 'three';

/**
 * The board: an endless circuit board generated in sections ahead of the
 * camera and dropped behind it. Each section is a painted texture (solder mask,
 * traces, gold pads and vias, silkscreen outlines and text) under real 3D parts
 * (chips with pins and laser-etched lids, electrolytic capacitor towers, heat
 * sinks, case fans, headers, crystals, LEDs). Parts are written straight into
 * a few shared vertex buffers per section, and every static chip lid shares
 * one label atlas, so a section costs a handful of draw calls. A plain board
 * skirt runs out past the edges so the view never ends in black.
 *
 * Six "streets" of parallel traces run the length of the board; every chip
 * gets branch traces to its nearest street, and those are the routes packets
 * travel. The same generator also builds the inside of a chip (style 'die'):
 * a silicon floor of standard-cell rows, memory macros and copper buses.
 */

export const W = 320;                          // board width (x from -160 to 160)
export const HALF = W / 2;
export const CH = 128;                         // section length
export const STREETS = [-120, -64, -22, 22, 64, 120];
export const TRACE_OFFS = [-4, -2, 0, 2, 4];
const X_BLOCKS: Array<[number, number]> = [[-157, -127], [-113, -71], [-57, -29], [-15, 15], [29, 57], [71, 113], [127, 157]];
export type Style = 'pcb' | 'die';
export type ChipKind = 'cpu' | 'ram' | 'rom' | 'fw' | 'rf' | 'ic' | 'socket' | 'macro';

export interface Chip {
  x: number; z: number; w: number; d: number; h: number;
  kind: ChipKind;
  name: string;
  top?: Mesh;                    // a lid of its own (lookup towers, dive targets)
  canvas?: HTMLCanvasElement;
  tex?: CanvasTexture;
  chunk: Chunk;
  used?: boolean;
  /** Under a heat sink or fan: its lid can't be seen. */
  covered?: boolean;
  routes: Route[];
}

export interface Route { pts: Vector3[]; lens: number[]; total: number; chip: Chip | null; }

export function makeRoute(pts: Vector3[], chip: Chip | null = null): Route {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, lens, total: lens[lens.length - 1], chip };
}

function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = {
  pcb: { mask: '#0b3a27', trace: '#1c6a45', traceHi: '#2a8a5c', pad: '#d4aa4a', silk: '#e9efe6', hole: '#1a1208' },
  die: { mask: '#140c26', trace: '#9a6232', traceHi: '#d09048', pad: '#e0b458', silk: '#b9a8ff', hole: '#07040e' },
};

const MAKERS = ['PWW', 'KRN', 'MXT', 'VLX', 'NQS', 'TRX', 'OMN', 'ZYG', 'HLX'];

// ── fast merged geometry: parts are appended into flat arrays, no per-part objects ──
interface Template { pos: ArrayLike<number>; nor: ArrayLike<number>; uv: ArrayLike<number>; idx: ArrayLike<number>; }
function template(g: BufferGeometry): Template {
  return { pos: g.getAttribute('position').array, nor: g.getAttribute('normal').array, uv: g.getAttribute('uv').array, idx: g.getIndex()!.array };
}

class Mesher {
  private pos: number[] = []; private nor: number[] = []; private col: number[] = []; private uv: number[] = []; private idx: number[] = [];

  add(t: Template, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number, color: Color, uvRect?: [number, number, number, number]): void {
    const c = Math.cos(rotY), s = Math.sin(rotY), base = this.pos.length / 3, n = t.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const px = t.pos[i * 3] * sx, py = t.pos[i * 3 + 1] * sy, pz = t.pos[i * 3 + 2] * sz;
      this.pos.push(x + px * c + pz * s, y + py, z - px * s + pz * c);
      const nx = t.nor[i * 3], ny = t.nor[i * 3 + 1], nz = t.nor[i * 3 + 2];
      this.nor.push(nx * c + nz * s, ny, -nx * s + nz * c);
      this.col.push(color.r, color.g, color.b);
      const u = t.uv[i * 2], v = t.uv[i * 2 + 1];
      if (uvRect) this.uv.push(uvRect[0] + u * uvRect[2], uvRect[1] + v * uvRect[3]); else this.uv.push(u, v);
    }
    for (let j = 0; j < t.idx.length; j++) this.idx.push(base + t.idx[j]);
  }

  build(): BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new Uint32BufferAttribute(this.idx, 1) : new Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = [];
    return g;
  }
}

/** Shared materials and textures for every section of one board. */
export class BoardMaterials {
  readonly plastic: MeshStandardMaterial;
  readonly metal: MeshStandardMaterial;
  readonly led: MeshBasicMaterial;
  readonly blades: MeshStandardMaterial;
  readonly grille: MeshStandardMaterial;
  constructor(env: Texture) {
    this.plastic = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, envMap: env, envMapIntensity: 0.5 });
    this.metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9, envMap: env, envMapIntensity: 1.0 });
    this.led = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.blades = new MeshStandardMaterial({ map: fanBlades(), alphaTest: 0.5, side: DoubleSide, roughness: 0.45, metalness: 0.1, envMap: env, envMapIntensity: 0.6 });
    this.grille = new MeshStandardMaterial({ map: fanGrille(), alphaTest: 0.5, roughness: 0.55, metalness: 0.05, envMap: env, envMapIntensity: 0.4 });
  }
}

/** A case fan's rotor seen from above: seven swept blades and a hub with a sticker. */
function fanBlades(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const P = (r: number, a: number): [number, number] => [256 + Math.cos(a) * r, 256 + Math.sin(a) * r];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.beginPath();
    g.moveTo(...P(60, a - 0.34));
    g.quadraticCurveTo(...P(150, a - 0.12), ...P(234, a + 0.1));
    g.arc(256, 256, 234, a + 0.1, a + 0.66);
    g.quadraticCurveTo(...P(150, a + 0.5), ...P(60, a + 0.34));
    g.closePath();
    const gr = g.createRadialGradient(256, 256, 60, 256, 256, 240);
    gr.addColorStop(0, '#3a3e47'); gr.addColorStop(1, '#1c1e23');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(170,180,195,0.35)'; g.lineWidth = 2; g.stroke();
  }
  g.beginPath(); g.arc(256, 256, 66, 0, Math.PI * 2); g.fillStyle = '#16181c'; g.fill();
  g.lineWidth = 4; g.strokeStyle = '#2e3139'; g.stroke();
  g.beginPath(); g.arc(256, 256, 48, 0, Math.PI * 2); g.fillStyle = '#0f4c86'; g.fill();
  g.fillStyle = '#e8f2ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = "bold 24px 'Courier New', monospace"; g.fillText('PWW', 256, 248);
  g.font = "12px 'Courier New', monospace"; g.fillText('12V 0.35A', 256, 270);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The fan frame's top: filled corners round a circular opening, with a thin rim. */
function fanGrille(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#121316';
  g.beginPath(); g.rect(0, 0, 512, 512); g.arc(256, 256, 244, 0, Math.PI * 2, true); g.fill('evenodd');
  g.strokeStyle = '#2a2d33'; g.lineWidth = 10; g.beginPath(); g.arc(256, 256, 240, 0, Math.PI * 2); g.stroke();
  for (const [x, y] of [[36, 36], [476, 36], [36, 476], [476, 476]]) {
    g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fillStyle = '#050506'; g.fill();
    g.strokeStyle = '#3a3d44'; g.lineWidth = 3; g.stroke();
  }
  g.strokeStyle = 'rgba(120,130,145,0.35)'; g.lineWidth = 3; g.strokeRect(2, 2, 508, 508);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

type PartList = 'plastic' | 'metal' | 'led' | 'lid' | 'grille';
const LID_ATLAS = 1024, LID_SLOT = 256;

export class Chunk {
  readonly group = new Group();
  readonly chips: Chip[] = [];
  readonly routes: Route[] = [];
  readonly fans: Mesh[] = [];
  readonly antennas: Array<{ x: number; z: number }> = [];
  readonly z0: number;
  readonly textures: Texture[] = [];
  private heights: Float32Array;
  private meshers: Record<PartList, Mesher> = { plastic: new Mesher(), metal: new Mesher(), led: new Mesher(), lid: new Mesher(), grille: new Mesher() };
  private g: CanvasRenderingContext2D;
  private gm: CanvasRenderingContext2D;
  private lidAtlas: HTMLCanvasElement;
  private lidSlot = 0;
  private k: number;
  private r: () => number;
  private pal: typeof PALETTE.pcb;
  private ref = 1;
  private col = new Color();

  constructor(readonly board: Board, readonly index: number) {
    this.z0 = -index * CH;
    this.r = rng(index * 7919 + (board.style === 'die' ? 50021 : 13));
    this.pal = PALETTE[board.style];
    this.heights = new Float32Array((W / 4) * (CH / 4));
    const px = board.detail, py = Math.round(px * CH / W);
    this.k = px / W;
    const c = document.createElement('canvas'), cm = document.createElement('canvas');
    c.width = cm.width = px; c.height = cm.height = py;
    this.g = c.getContext('2d')!;
    this.gm = cm.getContext('2d')!;
    this.lidAtlas = document.createElement('canvas');
    this.lidAtlas.width = this.lidAtlas.height = LID_ATLAS;
    this.paintBase(px, py);
    if (board.style === 'pcb') this.buildPcb(); else this.buildDie();
    this.finish(c, cm);
  }

  // ── canvas helpers: x in board units, u = distance into the section (0..CH) ──
  private cx(x: number): number { return (x + HALF) * this.k; }
  private cy(u: number): number { return (CH - u) * this.k; }
  /** World z for a section-local u. */
  z(u: number): number { return this.z0 - u; }

  private paintBase(px: number, py: number): void {
    const g = this.g, r = this.r;
    g.fillStyle = this.pal.mask; g.fillRect(0, 0, px, py);
    for (let i = 0; i < (px * py) / 260; i++) {
      const v = r();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.05})` : `rgba(0,0,0,${(0.5 - v) * 0.12})`;
      g.fillRect(r() * px, r() * py, 1 + r() * 3, 1 + r() * 3);
    }
    this.gm.fillStyle = '#000'; this.gm.fillRect(0, 0, px, py);
    if (this.board.style === 'die') {
      g.strokeStyle = 'rgba(160,140,255,0.06)'; g.lineWidth = 1;
      for (let x = -HALF; x <= HALF; x += 2) { g.beginPath(); g.moveTo(this.cx(x), 0); g.lineTo(this.cx(x), py); g.stroke(); }
    }
  }

  private line(pts: Array<[number, number]>, width: number, color: string, metal = false): void {
    for (const [ctx, col] of [[this.g, color], ...(metal ? [[this.gm, '#fff']] : [])] as Array<[CanvasRenderingContext2D, string]>) {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, width * this.k); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(([x, u], i) => (i ? ctx.lineTo(this.cx(x), this.cy(u)) : ctx.moveTo(this.cx(x), this.cy(u))));
      ctx.stroke();
    }
  }

  private rect(x: number, u: number, w: number, d: number, color: string, metal = false): void {
    this.g.fillStyle = color;
    this.g.fillRect(this.cx(x - w / 2), this.cy(u + d / 2), w * this.k, d * this.k);
    if (metal) { this.gm.fillStyle = '#fff'; this.gm.fillRect(this.cx(x - w / 2), this.cy(u + d / 2), w * this.k, d * this.k); }
  }

  private outline(x: number, u: number, w: number, d: number): void {
    const g = this.g;
    g.strokeStyle = this.pal.silk; g.globalAlpha = 0.75; g.lineWidth = Math.max(1, 0.25 * this.k);
    g.strokeRect(this.cx(x - w / 2), this.cy(u + d / 2), w * this.k, d * this.k);
    g.globalAlpha = 1;
  }

  private text(x: number, u: number, s: string, size: number, color = this.pal.silk, alpha = 0.85, align: CanvasTextAlign = 'left'): void {
    const g = this.g;
    g.save();
    g.globalAlpha = alpha; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
    g.font = `bold ${Math.max(6, size * this.k)}px 'Courier New', monospace`;
    g.fillText(s, this.cx(x), this.cy(u));
    g.restore();
  }

  private via(x: number, u: number, r = 0.55): void {
    for (const [ctx, col, rad] of [[this.g, this.pal.pad, r], [this.gm, '#fff', r], [this.g, this.pal.hole, r * 0.45]] as Array<[CanvasRenderingContext2D, string, number]>) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(this.cx(x), this.cy(u), Math.max(1, rad * this.k), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── parts ──
  private part(list: PartList, t: Template, x: number, y: number, u: number, sx: number, sy: number, sz: number, color: number | Color, rotY = 0, uvRect?: [number, number, number, number]): void {
    const c = color instanceof Color ? color : this.col.setHex(color);
    this.meshers[list].add(t, x, y, this.z(u), sx, sy, sz, rotY, c, uvRect);
  }

  private raise(x: number, u: number, w: number, d: number, h: number): void {
    const cols = W / 4, rows = CH / 4;
    for (let cxI = Math.floor((x - w / 2 + HALF) / 4); cxI <= Math.floor((x + w / 2 + HALF) / 4); cxI++) {
      for (let cuI = Math.floor((u - d / 2) / 4); cuI <= Math.floor((u + d / 2) / 4); cuI++) {
        if (cxI < 0 || cxI >= cols || cuI < 0 || cuI >= rows) continue;
        const i = cuI * cols + cxI;
        this.heights[i] = Math.max(this.heights[i], h);
      }
    }
  }

  heightAt(x: number, z: number): number {
    const cols = W / 4;
    const cxI = Math.floor((x + HALF) / 4), cuI = Math.floor((this.z0 - z) / 4);
    if (cxI < 0 || cxI >= cols || cuI < 0 || cuI >= CH / 4) return 0;
    return this.heights[cuI * cols + cxI];
  }

  private chip(x: number, u: number, w: number, d: number, h: number, kind: ChipKind, pins = true, label?: string): Chip {
    const B = this.board.tpl, r = this.r, pal = this.pal;
    const body = this.col.setHex(this.board.style === 'die' ? 0x2a2440 : 0x121316).offsetHSL(0, 0, (r() - 0.5) * 0.03);
    this.part('plastic', B.box, x, 0.25 + h / 2, u, w, h, d, body);
    this.raise(x, u, w + 2, d + 2, h + 0.3);
    const name = label ?? `${MAKERS[Math.floor(r() * MAKERS.length)]}${Math.floor(1000 + r() * 9000)}`;
    this.outline(x, u, w + 2.2, d + 2.2);
    this.text(x - w / 2 - 1, u + d / 2 + 1.6, `U${this.ref++}`, 1.6);
    const chip: Chip = { x, z: this.z(u), w, d, h: h + 0.25, kind, name, chunk: this, routes: [] };
    if (pins && this.board.style === 'pcb') {
      const pitch = w > 14 ? 1.3 : 1.6;
      for (const side of [0, 1, 2, 3]) {
        const len = side % 2 ? d : w;
        const n = Math.max(2, Math.floor((len - 1.5) / pitch));
        for (let i = 0; i < n; i++) {
          const o = -((n - 1) * pitch) / 2 + i * pitch;
          const px = side === 0 || side === 2 ? x + o : x + (side === 1 ? w / 2 + 0.7 : -w / 2 - 0.7);
          const pu = side === 1 || side === 3 ? u + o : u + (side === 0 ? d / 2 + 0.7 : -d / 2 - 0.7);
          const horiz = side === 1 || side === 3;
          this.part('metal', B.box, px, 0.3, pu, horiz ? 1.5 : 0.45, 0.22, horiz ? 0.45 : 1.5, 0xc8c8cc);
          this.rect(px, pu, horiz ? 1.9 : 0.6, horiz ? 0.6 : 1.9, pal.pad, true);
        }
      }
    }
    this.chips.push(chip);
    // lids: static ones share the section's label atlas; lookup towers get their own (they scroll)
    if (w >= 8 && kind !== 'rom') this.atlasLid(chip);
    if (kind === 'rom') this.board.lid(chip);
    // branch traces to the nearest street, and routes for packets
    const street = STREETS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
    const dir = Math.sign(street - x) || 1;
    const n = kind === 'ic' ? 2 : 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const pu = u + (i - (n - 1) / 2) * Math.min(2.2, (d - 2) / Math.max(1, n - 1));
      const pinX = x + dir * (w / 2 + 1.4);
      const off = TRACE_OFFS[Math.floor(r() * TRACE_OFFS.length)];
      const tx = street + off;
      const jog = (r() < 0.5 ? -1 : 1) * Math.min(3, Math.abs(tx - pinX) * 0.3);
      const bendX = tx - dir * Math.abs(jog);
      const pts2: Array<[number, number]> = [[tx, pu + jog], [bendX, pu], [pinX, pu]];
      this.line(pts2, 0.5, pal.trace);
      this.via(tx, pu + jog, 0.5);
      const route = makeRoute(pts2.map(([px, pz]) => new Vector3(px, 0.12, this.z(pz))), chip);
      chip.routes.push(route);
      this.routes.push(route);
    }
    return chip;
  }

  private atlasLid(chip: Chip): void {
    if (this.lidSlot >= (LID_ATLAS / LID_SLOT) ** 2) return;
    const per = LID_ATLAS / LID_SLOT;
    const ox = (this.lidSlot % per) * LID_SLOT, oy = Math.floor(this.lidSlot / per) * LID_SLOT;
    this.lidSlot++;
    const lw = LID_SLOT, lh = Math.max(64, Math.min(LID_SLOT, Math.round(LID_SLOT * chip.d / chip.w)));
    const g = this.lidAtlas.getContext('2d')!;
    g.save();
    g.translate(ox, oy);
    g.beginPath(); g.rect(0, 0, lw, lh); g.clip();
    drawLid(g, lw, lh, chip);
    g.restore();
    const uv: [number, number, number, number] = [ox / LID_ATLAS, 1 - (oy + lh) / LID_ATLAS, lw / LID_ATLAS, lh / LID_ATLAS];
    this.part('lid', this.board.tpl.quad, chip.x, chip.h + 0.02, this.z0 - chip.z, chip.w * 0.96, 1, chip.d * 0.96, 0xffffff, 0, uv);
  }

  private cap(x: number, u: number, rad: number, h: number): void {
    const B = this.board.tpl, r = this.r;
    const sleeve = [0x1b3f9a, 0x121214, 0x3a1b5a, 0x0f4a52][Math.floor(r() * 4)];
    this.part('plastic', B.cyl, x, h / 2 + 0.2, u, rad, h, rad, sleeve);
    this.part('metal', B.disc, x, h + 0.21, u, rad * 0.96, 1, rad * 0.96, 0xb8bcc4);
    this.part('plastic', B.box, x + rad * 0.55, h * 0.5 + 0.2, u, 0.25, h * 0.98, rad * 0.9, 0xd8d8d8);
    this.g.strokeStyle = this.pal.silk; this.g.lineWidth = Math.max(1, 0.25 * this.k);
    this.g.beginPath(); this.g.arc(this.cx(x), this.cy(u), (rad + 0.6) * this.k, 0, Math.PI * 2); this.g.stroke();
    this.text(x + rad + 0.8, u - rad, `C${this.ref++}`, 1.5);
    this.raise(x, u, rad * 2, rad * 2, h + 0.3);
  }

  private smd(x: number, u: number, len: number, wid: number, horiz: boolean): void {
    const B = this.board.tpl, r = this.r;
    const body = r() < 0.5 ? 0x191919 : 0xb89e6e;
    const L = horiz ? len : wid, D = horiz ? wid : len;
    this.part('plastic', B.box, x, 0.45, u, L * 0.7, 0.5, D * (horiz ? 1 : 0.7), body);
    for (const s of [-1, 1]) {
      const ex = horiz ? x + s * L * 0.42 : x, eu = horiz ? u : u + s * D * 0.42;
      this.part('metal', B.box, ex, 0.45, eu, horiz ? L * 0.16 : L, 0.52, horiz ? D : D * 0.16, 0xd9d9dc);
      this.rect(ex, eu, horiz ? L * 0.3 : L * 1.2, horiz ? D * 1.2 : D * 0.3, this.pal.pad, true);
    }
    this.raise(x, u, L, D, 0.8);
  }

  private led(x: number, u: number, color: number): void {
    this.part('led', this.board.tpl.box, x, 0.5, u, 0.9, 0.5, 0.6, color);
    this.rect(x, u, 1.4, 0.9, this.pal.pad, true);
  }

  private heatsink(x: number, u: number, w: number, d: number, h: number, base: number): void {
    const B = this.board.tpl;
    this.part('metal', B.box, x, base + 0.3, u, w, 0.6, d, 0xb9bcc2);
    const fins = Math.floor(w / 1.4);
    for (let i = 0; i < fins; i++) this.part('metal', B.box, x - w / 2 + 0.7 + i * (w - 1.4) / Math.max(1, fins - 1), base + 0.6 + h / 2, u, 0.35, h, d, 0xa9adb5);
    this.raise(x, u, w, d, base + h + 0.6);
  }

  /** A case fan: a square frame with a round opening, and a rotor of swept blades inside. */
  private fan(x: number, u: number, size: number, base: number): void {
    const B = this.board.tpl, H = 2.8, T = size * 0.08;
    for (const [dx, du, sw, sd] of [[0, -size / 2 + T / 2, size, T], [0, size / 2 - T / 2, size, T], [-size / 2 + T / 2, 0, T, size], [size / 2 - T / 2, 0, T, size]]) {
      this.part('plastic', B.box, x + dx, base + H / 2, u + du, sw, H, sd, 0x15161a);
    }
    this.part('plastic', B.disc, x, base + 0.15, u, size * 0.47, 1, size * 0.47, 0x050506);
    this.part('grille', B.quad, x, base + H + 0.01, u, size, 1, size, 0xffffff);
    const rotor = new Mesh(this.board.geo.quad, this.board.mats.blades);
    rotor.scale.set(size * 0.93, 1, size * 0.93);
    rotor.position.set(x, base + H * 0.55, this.z(u));
    this.group.add(rotor);
    this.fans.push(rotor);
    this.raise(x, u, size, size, base + H);
  }

  // ── districts ──
  private buildPcb(): void {
    const r = this.r, pal = this.pal;
    // streets: bundles of parallel traces the length of the section, with vias
    for (const sx of STREETS) {
      for (const off of TRACE_OFFS) {
        this.line([[sx + off, 0], [sx + off, CH]], 0.55, pal.traceHi);
        for (let u = r() * 10; u < CH; u += 12 + r() * 20) this.via(sx + off, u, 0.5);
      }
    }
    for (const o of [-3, -1, 1, 3]) this.line([[-HALF, 64 + o], [HALF, 64 + o]], 0.5, pal.trace);
    const us: Array<[number, number]> = [[3, 58], [70, 125]];
    const blocks: Array<{ x0: number; x1: number; u0: number; u1: number }> = [];
    for (const [x0, x1] of X_BLOCKS) for (const [u0, u1] of us) blocks.push({ x0, x1, u0, u1 });
    blocks.sort(() => r() - 0.5);
    const kinds = ['rom', 'fw', 'socket', 'antenna', ...Array.from({ length: blocks.length - 4 }, () => ['cpu', 'ram', 'power', 'passives', 'connector', 'quiet', 'quiet', 'ram', 'cpu', 'power'][Math.floor(r() * 10)])];
    blocks.forEach((b, i) => this.district(kinds[i], b));
    for (let i = 0; i < 4; i++) {
      const s = this.board.words();
      if (s) this.text(-150 + r() * 250, 4 + r() * 120, s, 2.2, pal.silk, 0.55);
    }
    this.text(STREETS[1] - 7, 62, `REV ${String.fromCharCode(65 + (this.index % 6))}`, 2, pal.silk, 0.6, 'right');
  }

  private district(kind: string, b: { x0: number; x1: number; u0: number; u1: number }): void {
    const r = this.r;
    const cx = (b.x0 + b.x1) / 2, cu = (b.u0 + b.u1) / 2, bw = b.x1 - b.x0, bd = b.u1 - b.u0;
    switch (kind) {
      case 'cpu': {
        const s = Math.min(bw - 6, 24);
        const cpu = this.chip(cx, cu, s, s, 2.2, 'cpu');
        if (r() < 0.6) {
          cpu.covered = true;
          if (r() < 0.55) this.heatsink(cx, cu, s + 0.4, s + 0.4, 6 + r() * 4, 2.45);
          else this.fan(cx, cu, s + 1.2, 2.45);
        }
        for (let i = 0; i < 8; i++) this.smd(cx + (r() - 0.5) * (bw - 4), cu + (r() < 0.5 ? -1 : 1) * (s / 2 + 3 + r() * 5), 2, 1.2, r() < 0.5);
        break;
      }
      case 'ram': {
        const n = 3 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) this.chip(cx, b.u0 + 4 + i * ((bd - 8) / Math.max(1, n - 1)), bw - 8, 6, 1.4, 'ram');
        break;
      }
      case 'power': {
        for (let i = 0; i < 5; i++) this.cap(b.x0 + 4 + r() * (bw - 8), b.u0 + 4 + r() * (bd - 8), 1.8 + r() * 1.6, 7 + r() * 8);
        this.part('plastic', this.board.tpl.box, cx, 1.6, cu, 6, 2.8, 6, 0x2b2c30);
        this.raise(cx, cu, 6, 6, 3);
        this.chip(cx, b.u0 + 3, 7, 5, 1.2, 'ic');
        break;
      }
      case 'passives': {
        for (let i = 0; i < 30; i++) this.smd(b.x0 + 2 + r() * (bw - 4), b.u0 + 2 + r() * (bd - 4), 1.8 + r(), 1 + r() * 0.4, r() < 0.5);
        this.chip(cx, cu, 8, 8, 1.3, 'ic');
        for (let i = 0; i < 5; i++) this.led(b.x0 + 3 + i * 2.2, b.u1 - 3, [0x39ff88, 0xff4040, 0x40a0ff, 0xffb030][i % 4]);
        break;
      }
      case 'quiet': {
        // open board: a few passives, test points and a big silkscreen label
        for (let i = 0; i < 8; i++) this.smd(b.x0 + 3 + r() * (bw - 6), b.u0 + 3 + r() * (bd - 6), 2, 1.2, r() < 0.5);
        for (let i = 0; i < 6; i++) this.via(b.x0 + 3 + r() * (bw - 6), b.u0 + 3 + r() * (bd - 6), 1.1);
        const s = this.board.words();
        if (s) this.text(cx, cu, s.slice(0, 12), 2.6, this.pal.silk, 0.6, 'center');
        break;
      }
      case 'connector': {
        const len = bd - 8;
        this.part('plastic', this.board.tpl.box, cx, 1.8, cu, 5, 3.2, len, 0x141414);
        for (let i = 0; i < Math.floor(len / 2.54); i++) for (const o of [-1.2, 1.2]) {
          this.part('metal', this.board.tpl.box, cx + o, 4, b.u0 + 4 + 1.27 + i * 2.54, 0.6, 1.6, 0.6, 0xd4a64a);
        }
        this.raise(cx, cu, 5, len, 5);
        this.text(cx + 4, b.u0 + 3, 'J' + this.ref++, 1.6);
        break;
      }
      case 'rom': {
        this.chip(cx, cu, Math.min(bw - 6, 20), 9, 5.5, 'rom');
        this.part('metal', this.board.tpl.box, cx - 8, 0.9, cu + 8, 4, 1.2, 2, 0xc8c8cc);
        this.raise(cx - 8, cu + 8, 4, 2, 1.5);
        break;
      }
      case 'fw': {
        this.chip(cx, cu, 14, 14, 2.6, 'fw', true, `FW-${String(this.index % 100).padStart(2, '0')}`);
        for (let i = 0; i < 3; i++) this.led(cx - 3 + i * 3, cu - 10, 0xff3030);
        break;
      }
      case 'socket': {
        const s = 10;
        for (const side of [0, 1, 2, 3]) for (let i = 0; i < 6; i++) {
          const o = -4 + i * 1.6;
          const px = side % 2 ? cx + (side === 1 ? s / 2 + 0.7 : -s / 2 - 0.7) : cx + o;
          const pu = side % 2 ? cu + o : cu + (side === 0 ? s / 2 + 0.7 : -s / 2 - 0.7);
          this.rect(px, pu, side % 2 ? 1.9 : 0.6, side % 2 ? 0.6 : 1.9, this.pal.pad, true);
        }
        this.outline(cx, cu, s + 2.2, s + 2.2);
        this.text(cx, cu, 'DNP', 2, this.pal.silk, 0.7, 'center');
        this.chips.push({ x: cx, z: this.z(cu), w: s, d: s, h: 0, kind: 'socket', name: `U${this.ref++}`, chunk: this, routes: [], used: false });
        for (let i = 0; i < 3; i++) this.smd(cx + (r() - 0.5) * (bw - 6), cu + (r() < 0.5 ? -1 : 1) * (s / 2 + 5), 2, 1.2, true);
        break;
      }
      case 'antenna': {
        const zig: Array<[number, number]> = [];
        for (let i = 0; i < 9; i++) { const x = b.x0 + 3 + i * ((bw - 6) / 8); zig.push(i % 2 ? [x, b.u0 + 12] : [x, b.u0 + 4]); zig.push(i % 2 ? [x, b.u0 + 4] : [x, b.u0 + 12]); }
        this.line(zig, 0.8, this.pal.pad, true);
        this.antennas.push({ x: cx, z: this.z(b.u0 + 8) });
        this.part('metal', this.board.tpl.box, cx, 1.1, cu + 8, 12, 1.6, 10, 0xc3c6cc);
        this.raise(cx, cu + 8, 12, 10, 1.8);
        this.text(cx - 6, cu + 14.5, 'RF SHIELD', 1.5);
        break;
      }
    }
  }

  private buildDie(): void {
    const r = this.r, pal = this.pal;
    for (const sx of STREETS) for (const off of TRACE_OFFS) this.line([[sx + off, 0], [sx + off, CH]], 1.0, off === 0 ? pal.traceHi : pal.trace, true);
    for (let u = 8; u < CH; u += 16) this.line([[-HALF, u], [HALF, u]], 0.35, pal.trace, true);
    const cell = new Color();
    for (const [x0, x1] of X_BLOCKS) {
      for (let u0 = 3; u0 < CH - 10; u0 += 30) {
        if (r() < 0.35) {
          this.chip((x0 + x1) / 2, u0 + 12, x1 - x0 - 4, 22, 1.2 + r() * 1.4, 'macro', false);
        } else {
          for (let row = 0; row < 7; row++) {
            let x = x0 + 1;
            while (x < x1 - 2) {
              const w = 1 + r() * 3.4;
              const h = 0.4 + r() * 1.4;
              cell.setHSL(0.7 + r() * 0.25, 0.45, 0.2 + r() * 0.2);
              this.part('plastic', this.board.tpl.box, x + w / 2, h / 2, u0 + 2 + row * 3.6, w - 0.25, h, 2.6, cell);
              this.raise(x + w / 2, u0 + 2 + row * 3.6, w, 2.6, h);
              x += w + 0.3;
            }
          }
        }
        this.via((x0 + x1) / 2, u0 + 26, 0.9);
      }
      for (let i = 0; i < 6; i++) {
        const u = 4 + r() * (CH - 8);
        const x = x0 + r() * (x1 - x0);
        const street = STREETS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
        const pts2: Array<[number, number]> = [[street, u], [x, u]];
        this.line(pts2, 0.5, pal.traceHi, true);
        this.routes.push(makeRoute(pts2.map(([px, pz]) => new Vector3(px, 0.12, this.z(pz))), null));
      }
    }
  }

  private finish(c: HTMLCanvasElement, cm: HTMLCanvasElement): void {
    const B = this.board;
    const map = new CanvasTexture(c), metal = new CanvasTexture(cm);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = metal.anisotropy = 8;
    this.textures.push(map, metal);
    const floor = new Mesh(B.geo.quad, new MeshStandardMaterial({
      map, metalnessMap: metal, metalness: 1, roughness: B.style === 'die' ? 0.35 : 0.48, envMap: B.env, envMapIntensity: 0.9,
    }));
    floor.scale.set(W, 1, CH);
    floor.position.set(0, 0, this.z0 - CH / 2);
    this.group.add(floor);
    for (const list of ['plastic', 'metal', 'led', 'grille'] as PartList[]) {
      const geo = this.meshers[list].build();
      if (geo) this.group.add(new Mesh(geo, B.mats[list as 'plastic']));
    }
    const lids = this.meshers.lid.build();
    if (lids) {
      const tex = new CanvasTexture(this.lidAtlas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      this.textures.push(tex);
      this.group.add(new Mesh(lids, new MeshStandardMaterial({ map: tex, roughness: 0.7, envMap: B.env, envMapIntensity: 0.3 })));
    }
    B.scene.add(this.group);
  }

  dispose(): void {
    this.board.scene.remove(this.group);
    const shared = new Set<unknown>([...Object.values(this.board.geo), ...Object.values(this.board.mats)]);
    this.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      if (!shared.has(o.geometry)) o.geometry.dispose();
      const m = o.material as MeshStandardMaterial;
      if (shared.has(m)) return;
      if (m.map && !this.textures.includes(m.map)) m.map.dispose();       // labels on parts fitted later
      m.dispose();
    });
    for (const t of this.textures) t.dispose();
  }
}

/** A chip's lid: maker, part number, date code, and an optional line of data. */
function drawLid(g: CanvasRenderingContext2D, w: number, h: number, chip: Chip, data?: string, hot = false): void {
  if (chip.kind === 'macro') {
    g.fillStyle = '#231a3e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,170,255,0.35)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(230,210,255,0.8)'; g.font = "bold 18px 'Courier New', monospace"; g.textBaseline = 'alphabetic';
    g.fillText(data ?? `SRAM ${chip.name}`, 10, 26);
    return;
  }
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, hot ? '#2a0f0a' : '#17181b'); grd.addColorStop(1, hot ? '#1a0806' : '#0e0f11');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.beginPath(); g.arc(18, h - 18, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = hot ? 'rgba(255,170,120,0.9)' : 'rgba(205,210,215,0.62)';
  g.textBaseline = 'top';
  const big = Math.round(Math.min(34, h * 0.22));
  g.font = `bold ${big}px 'Courier New', monospace`;
  g.fillText(chip.name, 16, 12);
  g.font = `${Math.round(big * 0.6)}px 'Courier New', monospace`;
  g.fillText(chip.kind === 'fw' ? 'PACKET FILTER' : chip.kind === 'rom' ? 'LOOKUP' : chip.kind.toUpperCase() + ' ' + (2300 + (chip.name.length * 37) % 99), 16, 16 + big);
  if (data) {
    g.fillStyle = hot ? '#ffb070' : 'rgba(180,240,255,0.85)';
    g.font = `bold ${Math.round(big * 0.7)}px 'Courier New', monospace`;
    g.fillText(data, 16, h - big * 0.9 - 10);
  }
}

export class Board {
  readonly chunks = new Map<number, Chunk>();
  readonly geo = {
    box: new BoxGeometry(1, 1, 1),
    cyl: new CylinderGeometry(1, 1, 1, 16, 1, true),
    disc: new CircleGeometry(1, 20).rotateX(-Math.PI / 2),
    quad: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  readonly tpl = { box: template(this.geo.box), cyl: template(this.geo.cyl), disc: template(this.geo.disc), quad: template(this.geo.quad) };
  readonly mats: BoardMaterials;
  private skirt: Mesh;
  detail = 1024;
  /** Recent strings from the network (IPs, hostnames, domains, rules) for the silkscreen. */
  words: () => string = () => '';
  /** Milliseconds the last section took to build. */
  lastBuildMs = 0;

  constructor(readonly scene: Scene, readonly style: Style, readonly env: Texture) {
    this.mats = new BoardMaterials(env);
    // the board runs on past the edges: a plain, repeating mask with vias
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = PALETTE[style].mask; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = PALETTE[style].trace;
    for (let i = 0; i < 128; i += 32) g.fillRect(i + 14, 0, 3, 128);
    g.fillStyle = PALETTE[style].pad;
    for (let i = 0; i < 128; i += 32) { g.beginPath(); g.arc(i + 15.5, 60, 3, 0, Math.PI * 2); g.fill(); }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(60, 60);
    tex.anisotropy = 8;
    this.skirt = new Mesh(new PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: tex, roughness: 0.6, envMap: env, envMapIntensity: 0.4 }));
    this.skirt.position.y = -0.06;
    scene.add(this.skirt);
  }

  /** Keep sections from just behind `camZ` to `ahead` sections in front; builds at most one per call. */
  update(camZ: number, ahead: number): void {
    this.skirt.position.z = camZ - 600 - ((camZ % 40) + 40) % 40;
    const cur = Math.floor(-camZ / CH);
    for (const [i, c] of this.chunks) if (i < cur - 1 || i > cur + ahead + 1) { c.dispose(); this.chunks.delete(i); }
    for (let i = cur - 1; i <= cur + ahead; i++) {
      if (i < 0 || this.chunks.has(i)) continue;
      const t0 = performance.now();
      this.chunks.set(i, new Chunk(this, i));
      this.lastBuildMs = performance.now() - t0;
      return;
    }
  }

  fill(camZ: number, ahead: number): void {
    for (let n = 0; n < ahead + 3; n++) this.update(camZ, ahead);
  }

  heightAt(x: number, z: number): number {
    const c = this.chunks.get(Math.floor(-z / CH));
    return c ? c.heightAt(x, z) : 0;
  }

  chips(z0: number, z1: number, kind?: ChipKind): Chip[] {
    const out: Chip[] = [];
    for (const c of this.chunks.values()) {
      if (c.z0 < z1 - CH || c.z0 - CH > z0) continue;
      for (const ch of c.chips) if (ch.z <= z0 && ch.z >= z1 && (!kind || ch.kind === kind)) out.push(ch);
    }
    return out;
  }

  routes(z0: number, z1: number): Route[] {
    const out: Route[] = [];
    for (const c of this.chunks.values()) for (const r of c.routes) if (r.pts[0].z <= z0 && r.pts[0].z >= z1) out.push(r);
    return out;
  }

  antennas(z0: number, z1: number): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [];
    for (const c of this.chunks.values()) for (const a of c.antennas) if (a.z <= z0 && a.z >= z1) out.push(a);
    return out;
  }

  fans(): Mesh[] {
    const out: Mesh[] = [];
    for (const c of this.chunks.values()) out.push(...c.fans);
    return out;
  }

  /** Give a chip a lid of its own (drawn over its atlas label) so it can be redrawn: lookup towers, dive targets. */
  lid(chip: Chip): void {
    if (chip.canvas) return;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = Math.max(64, Math.round(256 * chip.d / chip.w));
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    chip.chunk.textures.push(tex);
    const top = new Mesh(this.geo.quad, new MeshStandardMaterial({ map: tex, roughness: 0.7, envMap: this.env, envMapIntensity: 0.3 }));
    top.scale.set(chip.w * 0.96, 1, chip.d * 0.96);
    top.position.set(chip.x, chip.h + 0.04, chip.z);
    chip.chunk.group.add(top);
    chip.top = top; chip.canvas = cv; chip.tex = tex;
    this.etch(chip);
  }

  /** (Re)draw a chip's own lid. */
  etch(chip: Chip, data?: string, hot = false): void {
    if (!chip.canvas) this.lid(chip);
    const cv = chip.canvas!;
    drawLid(cv.getContext('2d')!, cv.width, cv.height, chip, data, hot);
    chip.tex!.needsUpdate = true;
  }
}
