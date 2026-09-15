import {
  BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, Euler,
  type Scene, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The board: an endless circuit board generated in sections ahead of the
 * camera and dropped behind it. Each section is a painted texture (solder mask,
 * traces, gold pads and vias, silkscreen outlines and text) under real 3D parts
 * (chips with pins and laser-etched tops, electrolytic capacitor towers, heat
 * sinks, fans, headers, crystals, LEDs), merged into a handful of draw calls.
 *
 * Four "streets" of parallel traces run the length of the board; every chip
 * gets branch traces to its nearest street, and those are the routes packets
 * travel. The same generator also builds the inside of a chip (style 'die'):
 * a silicon floor of standard-cell rows, memory macros and copper buses.
 */

export const W = 200;                          // board width (x from -100 to 100)
export const CH = 128;                         // section length
export const STREETS = [-64, -22, 22, 64];
export const TRACE_OFFS = [-4, -2, 0, 2, 4];
export type Style = 'pcb' | 'die';
export type ChipKind = 'cpu' | 'ram' | 'rom' | 'fw' | 'rf' | 'ic' | 'socket' | 'macro';

export interface Chip {
  x: number; z: number; w: number; d: number; h: number;
  kind: ChipKind;
  name: string;
  top?: Mesh;                    // the lid (a labelled plane)
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
const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpS = new Vector3(), tmpP = new Vector3(), tmpE = new Euler();

/** Shared materials for every section of one board. */
export class BoardMaterials {
  readonly plastic: MeshStandardMaterial;
  readonly metal: MeshStandardMaterial;
  readonly led: MeshBasicMaterial;
  readonly fan: MeshStandardMaterial;
  constructor(env: Texture) {
    this.plastic = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, envMap: env, envMapIntensity: 0.5 });
    this.metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.92, envMap: env, envMapIntensity: 1.2 });
    this.led = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.fan = new MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.1, envMap: env, envMapIntensity: 0.5 });
  }
}

type PartList = 'plastic' | 'metal' | 'led';

export class Chunk {
  readonly group = new Group();
  readonly chips: Chip[] = [];
  readonly routes: Route[] = [];
  readonly fans: Group[] = [];
  readonly antennas: Array<{ x: number; z: number }> = [];
  readonly z0: number;
  private heights: Float32Array;
  private geos: Record<PartList, BufferGeometry[]> = { plastic: [], metal: [], led: [] };
  private textures: Texture[] = [];
  private g: CanvasRenderingContext2D;
  private gm: CanvasRenderingContext2D;
  private k: number;
  private r: () => number;
  private pal: typeof PALETTE.pcb;
  private ref = 1;

  constructor(readonly board: Board, readonly index: number) {
    this.z0 = -index * CH;
    this.r = rng(index * 7919 + (board.style === 'die' ? 50021 : 13));
    this.pal = PALETTE[board.style];
    this.heights = new Float32Array(Math.ceil(W / 4) * Math.ceil(CH / 4));
    const px = board.detail, py = Math.round(px * CH / W);
    this.k = px / W;
    const c = document.createElement('canvas'), cm = document.createElement('canvas');
    c.width = cm.width = px; c.height = cm.height = py;
    this.g = c.getContext('2d')!;
    this.gm = cm.getContext('2d')!;
    this.paintBase(px, py);
    if (board.style === 'pcb') this.buildPcb(); else this.buildDie();
    this.finish(c, cm);
  }

  // ── canvas helpers: x in board units, u = distance into the section (0..CH) ──
  private cx(x: number): number { return (x + W / 2) * this.k; }
  private cy(u: number): number { return (CH - u) * this.k; }
  /** World z for a section-local u. */
  z(u: number): number { return this.z0 - u; }

  private paintBase(px: number, py: number): void {
    const g = this.g, r = this.r;
    g.fillStyle = this.pal.mask; g.fillRect(0, 0, px, py);
    for (let i = 0; i < (px * py) / 180; i++) {
      const v = r();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.05})` : `rgba(0,0,0,${(0.5 - v) * 0.12})`;
      g.fillRect(r() * px, r() * py, 1 + r() * 3, 1 + r() * 3);
    }
    this.gm.fillStyle = '#000'; this.gm.fillRect(0, 0, px, py);
    if (this.board.style === 'die') {
      g.strokeStyle = 'rgba(160,140,255,0.06)'; g.lineWidth = 1;
      for (let x = -100; x <= 100; x += 2) { g.beginPath(); g.moveTo(this.cx(x), 0); g.lineTo(this.cx(x), py); g.stroke(); }
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
  private part(list: PartList, geo: BufferGeometry, x: number, y: number, u: number, sx: number, sy: number, sz: number, color: Color | number, rotY = 0): void {
    const g = geo.clone();
    tmpE.set(0, rotY, 0);
    tmpM.compose(tmpP.set(x, y, this.z(u)), tmpQ.setFromEuler(tmpE), tmpS.set(sx, sy, sz));
    g.applyMatrix4(tmpM);
    const col = color instanceof Color ? color : new Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
    this.geos[list].push(g);
  }

  private raise(x: number, u: number, w: number, d: number, h: number): void {
    const cols = Math.ceil(W / 4);
    for (let cxI = Math.floor((x - w / 2 + 100) / 4); cxI <= Math.floor((x + w / 2 + 100) / 4); cxI++) {
      for (let cuI = Math.floor((u - d / 2) / 4); cuI <= Math.floor((u + d / 2) / 4); cuI++) {
        if (cxI < 0 || cxI >= cols || cuI < 0 || cuI >= this.heights.length / cols) continue;
        const i = cuI * cols + cxI;
        this.heights[i] = Math.max(this.heights[i], h);
      }
    }
  }

  heightAt(x: number, z: number): number {
    const cols = Math.ceil(W / 4);
    const cxI = Math.floor((x + 100) / 4), cuI = Math.floor((this.z0 - z) / 4);
    if (cxI < 0 || cxI >= cols || cuI < 0 || cuI >= this.heights.length / cols) return 0;
    return this.heights[cuI * cols + cxI];
  }

  private chip(x: number, u: number, w: number, d: number, h: number, kind: ChipKind, pins = true): Chip {
    const B = this.board.geo, r = this.r, pal = this.pal;
    const body = new Color(this.board.style === 'die' ? 0x2a2440 : 0x121316).offsetHSL(0, 0, (r() - 0.5) * 0.03);
    this.part('plastic', B.box, x, 0.25 + h / 2, u, w, h, d, body);
    this.raise(x, u, w + 2, d + 2, h + 0.3);
    const name = `${MAKERS[Math.floor(r() * MAKERS.length)]}${Math.floor(1000 + r() * 9000)}`;
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
    // the lid: a laser-etched label, redrawable (targets, lookup towers)
    if (w >= 8) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = Math.max(64, Math.round(256 * d / w));
      const tex = new CanvasTexture(cv);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      this.textures.push(tex);
      const top = new Mesh(this.board.geo.plane, new MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0, envMap: this.board.env, envMapIntensity: 0.3, transparent: false }));
      top.scale.set(w * 0.96, d * 0.96, 1);
      top.rotation.x = -Math.PI / 2;
      top.position.set(x, 0.25 + h + 0.02, this.z(u));
      this.group.add(top);
      chip.top = top; chip.canvas = cv; chip.tex = tex;
      this.board.etch(chip);
    }
    this.chips.push(chip);
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

  private cap(x: number, u: number, rad: number, h: number): void {
    const B = this.board.geo, r = this.r;
    const sleeve = [0x1b3f9a, 0x121214, 0x3a1b5a, 0x0f4a52][Math.floor(r() * 4)];
    this.part('plastic', B.cyl, x, h / 2 + 0.2, u, rad, h, rad, sleeve);
    this.part('metal', B.disc, x, h + 0.21, u, rad * 0.96, 1, rad * 0.96, 0xd2d4d8);
    this.part('plastic', B.box, x + rad * 0.55, h * 0.5 + 0.2, u, 0.25, h * 0.98, rad * 0.9, 0xd8d8d8);
    this.g.strokeStyle = this.pal.silk; this.g.lineWidth = Math.max(1, 0.25 * this.k);
    this.g.beginPath(); this.g.arc(this.cx(x), this.cy(u), (rad + 0.6) * this.k, 0, Math.PI * 2); this.g.stroke();
    this.text(x + rad + 0.8, u - rad, `C${this.ref++}`, 1.5);
    this.raise(x, u, rad * 2, rad * 2, h + 0.3);
  }

  private smd(x: number, u: number, len: number, wid: number, horiz: boolean): void {
    const B = this.board.geo, r = this.r;
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
    this.part('led', this.board.geo.box, x, 0.5, u, 0.9, 0.5, 0.6, color);
    this.rect(x, u, 1.4, 0.9, this.pal.pad, true);
  }

  private heatsink(x: number, u: number, w: number, d: number, h: number, base: number): void {
    const B = this.board.geo;
    this.part('metal', B.box, x, base + 0.3, u, w, 0.6, d, 0xb9bcc2);
    const fins = Math.floor(w / 1.4);
    for (let i = 0; i < fins; i++) this.part('metal', B.box, x - w / 2 + 0.7 + i * (w - 1.4) / Math.max(1, fins - 1), base + 0.6 + h / 2, u, 0.35, h, d, 0xa9adb5);
    this.raise(x, u, w, d, base + h + 0.6);
  }

  private fan(x: number, u: number, size: number, base: number): void {
    const B = this.board.geo;
    const t = 1.2;
    this.part('plastic', B.box, x, base + t / 2, u - size / 2 + 0.6, size, t, 1.2, 0x1a1b1f);
    this.part('plastic', B.box, x, base + t / 2, u + size / 2 - 0.6, size, t, 1.2, 0x1a1b1f);
    this.part('plastic', B.box, x - size / 2 + 0.6, base + t / 2, u, 1.2, t, size, 0x1a1b1f);
    this.part('plastic', B.box, x + size / 2 - 0.6, base + t / 2, u, 1.2, t, size, 0x1a1b1f);
    const rotor = new Group();
    rotor.position.set(x, base + t * 0.6, this.z(u));
    const hub = new Mesh(B.cyl, this.board.mats.fan);
    hub.scale.set(size * 0.14, 0.5, size * 0.14);
    rotor.add(hub);
    for (let i = 0; i < 7; i++) {
      const blade = new Mesh(B.box, this.board.mats.fan);
      blade.scale.set(size * 0.36, 0.08, size * 0.11);
      blade.position.set(Math.cos((i / 7) * Math.PI * 2) * size * 0.25, 0, Math.sin((i / 7) * Math.PI * 2) * size * 0.25);
      blade.rotation.set(0.35, -(i / 7) * Math.PI * 2, 0);
      rotor.add(blade);
    }
    this.group.add(rotor);
    this.fans.push(rotor);
    this.raise(x, u, size, size, base + t);
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
    // a cross street half-way
    for (const o of [-3, -1, 1, 3]) this.line([[-100, 64 + o], [100, 64 + o]], 0.5, pal.trace);
    const xs: Array<[number, number]> = [[-99, -71], [-57, -29], [-15, 15], [29, 57], [71, 99]];
    const us: Array<[number, number]> = [[3, 58], [70, 125]];
    const blocks: Array<{ x0: number; x1: number; u0: number; u1: number }> = [];
    for (const [x0, x1] of xs) for (const [u0, u1] of us) blocks.push({ x0, x1, u0, u1 });
    blocks.sort(() => r() - 0.5);
    const kinds = ['rom', 'fw', 'socket', 'antenna', ...Array.from({ length: 6 }, () => ['cpu', 'ram', 'power', 'passives', 'connector', 'cpu', 'ram', 'power'][Math.floor(r() * 8)])];
    blocks.forEach((b, i) => this.district(kinds[i], b));
    // board text: made of whatever the network has been saying lately
    for (let i = 0; i < 3; i++) {
      const s = this.board.words();
      if (s) this.text(-96 + r() * 150, 4 + r() * 120, s, 2.2, pal.silk, 0.55);
    }
    this.text(STREETS[0] - 7, 62, `REV ${String.fromCharCode(65 + (this.index % 6))}`, 2, pal.silk, 0.6, 'right');
  }

  private district(kind: string, b: { x0: number; x1: number; u0: number; u1: number }): void {
    const r = this.r;
    const cx = (b.x0 + b.x1) / 2, cu = (b.u0 + b.u1) / 2, bw = b.x1 - b.x0, bd = b.u1 - b.u0;
    switch (kind) {
      case 'cpu': {
        const s = Math.min(bw - 6, 24);
        const cpu = this.chip(cx, cu, s, s, 2.2, 'cpu');
        if (r() < 0.65) {
          cpu.covered = true;
          if (r() < 0.5) this.heatsink(cx, cu, s * 0.9, s * 0.9, 6 + r() * 4, 2.45);
          else this.fan(cx, cu, s * 0.9, 2.45);
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
        this.part('plastic', this.board.geo.box, cx, 1.6, cu, 6, 2.8, 6, 0x2b2c30);
        this.raise(cx, cu, 6, 6, 3);
        this.chip(cx, b.u0 + 3, 7, 5, 1.2, 'ic');
        break;
      }
      case 'passives': {
        for (let i = 0; i < 40; i++) this.smd(b.x0 + 2 + r() * (bw - 4), b.u0 + 2 + r() * (bd - 4), 1.8 + r(), 1 + r() * 0.4, r() < 0.5);
        this.chip(cx, cu, 8, 8, 1.3, 'ic');
        for (let i = 0; i < 5; i++) this.led(b.x0 + 3 + i * 2.2, b.u1 - 3, [0x39ff88, 0xff4040, 0x40a0ff, 0xffb030][i % 4]);
        break;
      }
      case 'connector': {
        const len = bd - 8;
        this.part('plastic', this.board.geo.box, cx, 1.8, cu, 5, 3.2, len, 0x141414);
        for (let i = 0; i < Math.floor(len / 2.54); i++) for (const o of [-1.2, 1.2]) {
          this.part('metal', this.board.geo.box, cx + o, 4, b.u0 + 4 + 1.27 + i * 2.54, 0.6, 1.6, 0.6, 0xd4a64a);
        }
        this.raise(cx, cu, 5, len, 5);
        this.text(cx + 4, b.u0 + 3, 'J' + this.ref++, 1.6);
        break;
      }
      case 'rom': {
        // a lookup tower: a tall chip whose lid is an LED display
        this.chip(cx, cu, Math.min(bw - 6, 20), 9, 5.5, 'rom');
        this.part('metal', this.board.geo.box, cx - 8, 0.9, cu + 8, 4, 1.2, 2, 0xc8c8cc);   // crystal
        this.raise(cx - 8, cu + 8, 4, 2, 1.5);
        break;
      }
      case 'fw': {
        const c = this.chip(cx, cu, 14, 14, 2.6, 'fw');
        c.name = `FW-${String(this.index % 100).padStart(2, '0')}`;
        this.board.etch(c);
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
        const chip: Chip = { x: cx, z: this.z(cu), w: s, d: s, h: 0, kind: 'socket', name: `U${this.ref++}`, chunk: this, routes: [], used: false };
        this.chips.push(chip);
        for (let i = 0; i < 3; i++) this.smd(cx + (r() - 0.5) * (bw - 6), cu + (r() < 0.5 ? -1 : 1) * (s / 2 + 5), 2, 1.2, true);
        break;
      }
      case 'antenna': {
        // a meandering printed antenna in exposed gold, and the RF chip under a shield can
        const pts: Array<[number, number]> = [];
        for (let i = 0; i < 9; i++) { pts.push([b.x0 + 3 + i * ((bw - 6) / 8), b.u0 + 4]); pts.push([b.x0 + 3 + i * ((bw - 6) / 8), b.u0 + 12]); if (i % 2) pts.reverse(); }
        const zig: Array<[number, number]> = [];
        for (let i = 0; i < 9; i++) { const x = b.x0 + 3 + i * ((bw - 6) / 8); zig.push(i % 2 ? [x, b.u0 + 12] : [x, b.u0 + 4]); zig.push(i % 2 ? [x, b.u0 + 4] : [x, b.u0 + 12]); }
        this.line(zig, 0.8, this.pal.pad, true);
        this.antennas.push({ x: cx, z: this.z(b.u0 + 8) });
        this.part('metal', this.board.geo.box, cx, 1.1, cu + 8, 12, 1.6, 10, 0xc3c6cc);
        this.raise(cx, cu + 8, 12, 10, 1.8);
        this.text(cx - 6, cu + 14.5, 'RF SHIELD', 1.5);
        break;
      }
    }
  }

  private buildDie(): void {
    const r = this.r, pal = this.pal;
    // copper buses instead of streets, much wider, and a lattice of thin metal
    for (const sx of STREETS) for (const off of TRACE_OFFS) this.line([[sx + off, 0], [sx + off, CH]], 1.0, off === 0 ? pal.traceHi : pal.trace, true);
    for (let u = 8; u < CH; u += 16) this.line([[-100, u], [100, u]], 0.35, pal.trace, true);
    const xs: Array<[number, number]> = [[-99, -71], [-57, -29], [-15, 15], [29, 57], [71, 99]];
    for (const [x0, x1] of xs) {
      for (let u0 = 3; u0 < CH - 10; u0 += 30) {
        if (r() < 0.35) {
          // a memory macro: a flat block with a fine grid lid
          const c = this.chip((x0 + x1) / 2, u0 + 12, x1 - x0 - 4, 22, 1.2 + r() * 1.4, 'macro', false);
          this.board.etch(c);
        } else {
          // standard-cell rows
          for (let row = 0; row < 7; row++) {
            let x = x0 + 1;
            while (x < x1 - 2) {
              const w = 0.8 + r() * 3.2;
              const h = 0.4 + r() * 1.4;
              const col = new Color().setHSL(0.7 + r() * 0.25, 0.45, 0.2 + r() * 0.2);
              this.part('plastic', this.board.geo.box, x + w / 2, h / 2, u0 + 2 + row * 3.6, w - 0.25, h, 2.6, col);
              this.raise(x + w / 2, u0 + 2 + row * 3.6, w, 2.6, h);
              x += w + 0.3;
            }
          }
        }
        this.via((x0 + x1) / 2, u0 + 26, 0.9);
      }
      // routes: short links from cells to the nearest bus
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
    const floor = new Mesh(B.geo.plane, new MeshStandardMaterial({
      map, metalnessMap: metal, metalness: 1, roughness: B.style === 'die' ? 0.35 : 0.48, envMap: B.env, envMapIntensity: 0.9,
    }));
    floor.scale.set(W, CH, 1);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, this.z0 - CH / 2);
    this.group.add(floor);
    for (const list of ['plastic', 'metal', 'led'] as PartList[]) {
      if (!this.geos[list].length) continue;
      const merged = mergeGeometries(this.geos[list], false);
      for (const g of this.geos[list]) g.dispose();
      this.geos[list] = [];
      if (merged) this.group.add(new Mesh(merged, B.mats[list]));
    }
    B.scene.add(this.group);
  }

  dispose(): void {
    this.board.scene.remove(this.group);
    this.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      if (!Object.values(this.board.geo).includes(o.geometry)) o.geometry.dispose();
      const m = o.material as MeshStandardMaterial;
      if (m !== this.board.mats.plastic && m !== this.board.mats.metal && m !== this.board.mats.led && m !== this.board.mats.fan) {
        if (m.map && !this.textures.includes(m.map)) m.map.dispose();       // labels on parts fitted later
        m.dispose();
      }
    });
    for (const t of this.textures) t.dispose();
  }
}

export class Board {
  readonly chunks = new Map<number, Chunk>();
  readonly geo = {
    box: new BoxGeometry(1, 1, 1),
    cyl: new CylinderGeometry(1, 1, 1, 20, 1, true),
    disc: new CircleGeometry(1, 20).rotateX(-Math.PI / 2),
    plane: new PlaneGeometry(1, 1),
  };
  readonly mats: BoardMaterials & Record<PartList, MeshStandardMaterial | MeshBasicMaterial>;
  detail = 1024;
  /** Recent strings from the network (IPs, hostnames, domains, rules) for the silkscreen. */
  words: () => string = () => '';

  constructor(readonly scene: Scene, readonly style: Style, readonly env: Texture) {
    this.mats = new BoardMaterials(env) as BoardMaterials & Record<PartList, MeshStandardMaterial | MeshBasicMaterial>;
  }

  /** Keep sections from just behind `camZ` to `ahead` sections in front; builds at most one per call. */
  update(camZ: number, ahead: number): void {
    const cur = Math.floor(-camZ / CH);
    for (const [i, c] of this.chunks) if (i < cur - 1 || i > cur + ahead + 1) { c.dispose(); this.chunks.delete(i); }
    for (let i = cur - 1; i <= cur + ahead; i++) {
      if (i < 0 || this.chunks.has(i)) continue;
      this.chunks.set(i, new Chunk(this, i));
      return;
    }
  }

  /** Build every section in range now (at load, or on arrival inside a chip). */
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

  fans(): Group[] {
    const out: Group[] = [];
    for (const c of this.chunks.values()) out.push(...c.fans);
    return out;
  }

  /** (Re)draw a chip's lid: maker, part number, date code, and an optional line of data. */
  etch(chip: Chip, data?: string, hot = false): void {
    if (!chip.canvas || !chip.tex) return;
    const g = chip.canvas.getContext('2d')!, w = chip.canvas.width, h = chip.canvas.height;
    if (chip.kind === 'macro') {
      g.fillStyle = '#231a3e'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(200,170,255,0.35)'; g.lineWidth = 1;
      for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y < h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = 'rgba(230,210,255,0.8)'; g.font = "bold 18px 'Courier New', monospace"; g.fillText(data ?? `SRAM ${chip.name}`, 10, 26);
      chip.tex.needsUpdate = true;
      return;
    }
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, hot ? '#2a0f0a' : '#17181b'); grd.addColorStop(1, hot ? '#1a0806' : '#0e0f11');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.arc(18, h - 18, 7, 0, Math.PI * 2); g.fill();                   // pin-1 dimple
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
    chip.tex.needsUpdate = true;
  }
}
