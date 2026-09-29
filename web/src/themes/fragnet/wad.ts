/**
 * A small, dependency-free IWAD reader, shared by the browser (upload your
 * own DOOM.WAD to the relay and the scene parses it live) and by the Node
 * script that builds the bundled Freedoom asset pack. No DOM anywhere in
 * here: everything decodes to plain typed arrays.
 *
 * Formats are the classic ones: a lump directory at the end of the file,
 * wall textures composited from RLE column-post patches, 64x64 colormapped
 * flats, PLAYPAL's fourteen palettes and COLORMAP's thirty-four light
 * tables - the same tables the original engine painted its corridors with.
 */

export interface LumpEntry { name: string; offset: number; size: number }

export class Wad {
  readonly magic: string;
  readonly lumps: LumpEntry[] = [];
  private readonly bytes: Uint8Array;
  private readonly dv: DataView;

  constructor(buf: ArrayBuffer) {
    this.bytes = new Uint8Array(buf);
    this.dv = new DataView(buf);
    this.magic = String.fromCharCode(this.bytes[0], this.bytes[1], this.bytes[2], this.bytes[3]);
    if (this.magic !== 'IWAD' && this.magic !== 'PWAD') throw new Error('not a WAD file');
    const count = this.dv.getInt32(4, true);
    const dir = this.dv.getInt32(8, true);
    if (dir + count * 16 > buf.byteLength) throw new Error('truncated WAD directory');
    for (let i = 0; i < count; i++) {
      const o = dir + i * 16;
      let name = '';
      for (let k = 0; k < 8; k++) { const c = this.bytes[o + 8 + k]; if (c) name += String.fromCharCode(c); }
      this.lumps.push({ name, offset: this.dv.getUint32(o, true), size: this.dv.getInt32(o + 4, true) });
    }
  }

  /** First lump with this exact name, or -1. */
  find(name: string): number {
    for (let i = 0; i < this.lumps.length; i++) if (this.lumps[i].name === name) return i;
    return -1;
  }

  bytesOf(i: number): Uint8Array {
    const l = this.lumps[i];
    return this.bytes.subarray(l.offset, l.offset + l.size);
  }
}

// ── patches (sprites and texture members) ─────────────────────────────────

export interface SprFrame { w: number; h: number; lo: number; to: number; idx: Uint8Array }

/**
 * Decode a patch lump into a width*height index map (255 = transparent).
 * Two dialects live in the wild. The classic one: 32-bit header fields,
 * the column array at +16, and posts of topdelta / length / 0xff / pixels
 * / 0xff, the top accumulating down the column. Freedoom's compact one:
 * 16-bit header fields, the column array at +8, and posts of top / length
 * / pixels(length + 2), a lone 0xff ending the column. Header shape picks
 * the dialect; the walk cannot confuse the two once chosen.
 */
export function decodePatch(wad: Wad, i: number): SprFrame {
  const b = wad.bytesOf(i);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let w: number, h: number, lo: number, to: number, colBase: number, classic: boolean;
  const w32 = dv.getUint32(0, true), h32 = dv.getUint32(4, true);
  if (w32 > 0 && w32 <= 1024 && h32 > 0 && h32 <= 1024 && 16 + w32 * 4 < b.length && dv.getUint32(16, true) >= 16 + w32 * 4) {
    w = w32; h = h32; lo = dv.getInt32(8, true); to = dv.getInt32(12, true); colBase = 16; classic = true;
  } else {
    w = dv.getUint16(0, true); h = dv.getUint16(2, true); lo = dv.getInt16(4, true); to = dv.getInt16(6, true);
    colBase = 8; classic = false;
    if (w <= 0 || h <= 0 || w > 1024 || h > 1024 || dv.getUint32(8, true) < 8 + w * 4) throw new Error('suspicious patch format');
  }
  const idx = new Uint8Array(w * h).fill(255);
  for (let col = 0; col < w; col++) {
    let p = dv.getUint32(colBase + col * 4, true);
    let top = 0;
    for (;;) {
      if (p >= b.length) break;
      const t = b[p++];
      if (t === 0xff) break;
      if (classic) top += t; else top = t;
      const len = b[p++];
      if (classic) {
        p++;                                    // 0xff between length and data
        for (let k = 0; k < len && top + k < h; k++) idx[(top + k) * w + col] = b[p + k];
        p += len + 1;                           // pixels and their trailing 0xff
      } else {
        const n = len + 2;
        for (let k = 0; k < n && top + k < h; k++) idx[(top + k) * w + col] = b[p + k];
        p += n;
        if (b[p] === 0xff) break;               // a lone 0xff ends the column
      }
    }
  }
  return { w, h, lo, to, idx };
}

/** Composite a TEXTURE1 entry from its member patches into one index map.
 *  Classic definitions keep width/height at +8/+10, patch count at +15 and
 *  8-byte member records; some IWADs (freedoom among them) pad the header
 *  out to +12/+20 and give each member two spare words. The first width
 *  word tells them apart, definition by definition.
 */
export function decodeTexture(wad: Wad, name: string): { w: number; h: number; idx: Uint8Array } | null {
  const ti = wad.find('TEXTURE1'), t2 = wad.find('TEXTURE2');
  for (const dir of [ti, t2]) {
    if (dir < 0) continue;
    const b = wad.bytesOf(dir);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const count = dv.getInt32(0, true);
    for (let k = 0; k < count; k++) {
      const def = dv.getInt32(4 + k * 4, true);
      const nmBytes = b.subarray(def, def + 8);
      let nm = '';
      for (let j = 0; j < 8; j++) if (nmBytes[j]) nm += String.fromCharCode(nmBytes[j]);
      if (nm !== name) continue;
      const classic = dv.getUint16(def + 8, true) !== 0;
      const w = dv.getUint16(def + (classic ? 8 : 12), true);
      const h = dv.getUint16(def + (classic ? 10 : 14), true);
      const pc = dv.getUint16(def + (classic ? 15 : 20), true);
      const stride = classic ? 8 : 10;
      const base = def + (classic ? 17 : 22);
      const idx = new Uint8Array(w * h);       // palette entry 0: the dark between panels
      for (let j = 0; j < pc; j++) {
        const px = dv.getUint16(base + j * stride, true), py = dv.getUint16(base + 2 + j * stride, true);
        const pi = dv.getUint16(base + 4 + j * stride, true);
        const pName = pname(wad, pi);
        if (!pName) continue;
        const li = wad.find(pName);
        if (li < 0) continue;
        let patch: SprFrame;
        try { patch = decodePatch(wad, li); } catch { continue; }
        for (let c = 0; c < patch.w; c++) {
          const dx = px + c;
          if (dx >= w) continue;
          for (let r = 0; r < patch.h; r++) {
            const dy = py + r;
            if (dy >= h) continue;
            const v = patch.idx[r * patch.w + c];
            if (v !== 255) idx[dy * w + dx] = v;
          }
        }
      }
      return { w, h, idx };
    }
  }
  return null;
}

function pname(wad: Wad, i: number): string | null {
  const li = wad.find('PNAMES');
  if (li < 0) return null;
  const b = wad.bytesOf(li);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getInt32(0, true);
  if (i >= count) return null;
  const nm = b.subarray(4 + i * 8, 12 + i * 8);
  let s = '';
  for (let k = 0; k < 8; k++) if (nm[k]) s += String.fromCharCode(nm[k]);
  return s;
}

/** A flat is a bare 64x64 index map. */
export function decodeFlat(wad: Wad, name: string): Uint8Array | null {
  const i = wad.find(name);
  if (i < 0) return null;
  const b = wad.bytesOf(i);
  if (b.length < 4096) return null;
  return b.slice(0, 4096);
}

export function paletteOf(wad: Wad): Uint8Array {
  const i = wad.find('PLAYPAL');
  if (i < 0) throw new Error('no PLAYPAL');
  return wad.bytesOf(i).slice(0, 768);
}

export function colormapOf(wad: Wad): Uint8Array {
  const i = wad.find('COLORMAP');
  if (i < 0) throw new Error('no COLORMAP');
  return wad.bytesOf(i).slice(0, 34 * 256);
}

// ── the table the renderer paints from ────────────────────────────────────

/**
 * Everything the software renderer needs, decoupled from where it came
 * from: the bundled Freedoom pack JSON, an uploaded DOOM.WAD parsed in the
 * browser, or the procedural fallback baked from art.ts.
 */
export interface TexTable {
  palette: Uint8Array;                     // 768 bytes, PLAYPAL table 0
  cmap: Uint8Array;                        // 34 * 256, COLORMAP
  flats: Record<string, Uint8Array>;       // 64*64 index maps (FFLOOR/CEIL keys)
  walls: Record<string, { w: number; h: number; idx: Uint8Array }>;
  sprites: Record<string, Record<string, SprFrame>>;  // role -> frame letter
}

/** Which lumps an IWAD must provide for this scene, by role. Roles collect
 *  up to the first few candidates that exist as texture variants (`role2`,
 *  `role3`, ...), so sectors can pick each room its own look. */
export const WANT = {
  flats: { floor: ['FLAT10', 'FLOOR4_8', 'FLOOR1', 'FLAT6'], ceil: ['FLAT1', 'CEIL3_3', 'CEIL5_1', 'CEIL4_3'],
    hellFloor: ['FLAT8', 'LAVA3'], hellCeil: ['FLAT5', 'LAVA1', 'ROCK1'],
    techFloor: ['FLAT4', 'FLOOR0_1', 'FLOOR7_1'], exitFloor: ['FLOOR6_1', 'FLAT14', 'FLOOR4_6'],
    exitCeil: ['FLOOR6_2', 'FLAT20', 'CEIL4_2'],
    lampCeil: ['FLAT14', 'CEIL5_2', 'FLAT20', 'CEIL4_3'] },
  walls: { tech: ['TEKWALL1', 'TEKBLUE', 'COMP2', 'TEKWALL4'], brick: ['BRICK8', 'BRICK1', 'BRICK12', 'METAL1', 'WALL2'],
    hell: ['SLADWALL', 'A-DROCK1', 'ROCK1', 'HELL5'], door: ['DOOR1', 'DOOR3', 'DOOR2'],
    exit: ['EXITDOOR', 'DOOR5', 'DOOR9', 'DOOR1'], exitSign: ['EXITSIGN', 'EXITSGN2'] },
  sprites: {
    // demons: walk frames cycle a/b, pain e/f, death h..k with the last left as a corpse
    demon: ['TROO', 'SARG'],
    fireball: ['BAL7', 'BAIL'],
    health: ['STIM', 'MEDK', 'MDKT'],
    ammo: ['SHEL', 'AMMO', 'RCLP'],
    gun: ['SHTG', 'SGN'],
  },
};

/**
 * Lump index of a sprite's frame: exact rotation 1 or 0 lumps first, then
 * the eight-character mirrored pairs ("TROOA2A8") some IWADs use.
 */
export function findSpriteLump(wad: Wad, prefix: string, L: string): number {
  const key = prefix + L;
  const exact = wad.find(key + '1');
  if (exact >= 0) return exact;
  const exact0 = wad.find(key + '0');
  if (exact0 >= 0) return exact0;
  for (let i = 0; i < wad.lumps.length; i++) if (wad.lumps[i].name.startsWith(key + '1')) return i;
  for (let i = 0; i < wad.lumps.length; i++) if (wad.lumps[i].name.startsWith(key + '0')) return i;
  return -1;
}

/** Pull everything WANT names out of any IWAD; missing candidates fall through. */
export function extractTable(wad: Wad): TexTable {
  const table: TexTable = { palette: paletteOf(wad), cmap: colormapOf(wad), flats: {}, walls: {}, sprites: {} };
  const flatKeys: Array<keyof typeof WANT.flats> = Object.keys(WANT.flats) as Array<keyof typeof WANT.flats>;
  for (const key of flatKeys) {
    let v = 0;
    for (const cand of WANT.flats[key]) {
      if (v >= 3) break;
      const f = decodeFlat(wad, cand);
      if (f) { table.flats[v === 0 ? key : `${key}${v + 1}`] = f; v++; }
    }
  }
  const wallKeys: Array<keyof typeof WANT.walls> = Object.keys(WANT.walls) as Array<keyof typeof WANT.walls>;
  for (const key of wallKeys) {
    let v = 0;
    for (const cand of WANT.walls[key]) {
      if (v >= 4) break;
      const t = decodeTexture(wad, cand);
      if (t) { table.walls[v === 0 ? key : `${key}${v + 1}`] = t; v++; }
    }
  }
  const roles: Array<keyof typeof WANT.sprites> = Object.keys(WANT.sprites) as Array<keyof typeof WANT.sprites>;
  for (const role of roles) {
    for (const prefix of WANT.sprites[role]) {
      const frames: Record<string, SprFrame> = {};
      const letters = role === 'gun' ? 'ABCDEFGH' : 'abcdefghijklmnopqrst'.toUpperCase();
      for (const L of letters) {
        const i = findSpriteLump(wad, prefix, L);
        if (i < 0) continue;
        try { frames[L] = decodePatch(wad, i); } catch { /* a broken frame must not sink the set */ }
      }
      if (Object.keys(frames).length) { table.sprites[role] = frames; break; }
    }
  }
  return table;
}

// ── pack JSON (base64 typed arrays; read and written both sides) ──────────

export function b64encode(u: Uint8Array): string {
  const NBuffer = (globalThis as Record<string, unknown>).Buffer as
    | { from(b: ArrayBufferLike, off: number, len: number): { toString(enc: string): string } }
    | undefined;
  if (NBuffer) return NBuffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000)));
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const NBuffer = (globalThis as Record<string, unknown>).Buffer as
    | { from(b: string, enc: string): ArrayLike<number> }
    | undefined;
  if (NBuffer) return new Uint8Array(NBuffer.from(s, 'base64') as Uint8Array);
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export interface PackJSON {
  version: number; source: string;
  palette: string; cmap: string;
  flats: Record<string, string>;
  walls: Record<string, { w: number; h: number; idx: string }>;
  sprites: Record<string, Record<string, { w: number; h: number; lo: number; to: number; idx: string }>>;
}

export function tableToPack(table: TexTable, source: string): PackJSON {
  const pack: PackJSON = { version: 1, source, palette: b64encode(table.palette), cmap: b64encode(table.cmap), flats: {}, walls: {}, sprites: {} };
  for (const [k, f] of Object.entries(table.flats)) pack.flats[k] = b64encode(f);
  for (const [k, t] of Object.entries(table.walls)) pack.walls[k] = { w: t.w, h: t.h, idx: b64encode(t.idx) };
  for (const [role, frames] of Object.entries(table.sprites)) {
    pack.sprites[role] = {};
    for (const [L, f] of Object.entries(frames)) {
      pack.sprites[role][L] = { w: f.w, h: f.h, lo: f.lo, to: f.to, idx: b64encode(f.idx) };
    }
  }
  return pack;
}

export function packToTable(pack: PackJSON): TexTable {
  const table: TexTable = { palette: b64decode(pack.palette), cmap: b64decode(pack.cmap), flats: {}, walls: {}, sprites: {} };
  for (const [k, s] of Object.entries(pack.flats)) table.flats[k] = b64decode(s);
  for (const [k, t] of Object.entries(pack.walls)) table.walls[k] = { w: t.w, h: t.h, idx: b64decode(t.idx) };
  for (const [role, frames] of Object.entries(pack.sprites)) {
    table.sprites[role] = {};
    for (const [L, f] of Object.entries(frames)) table.sprites[role][L] = { w: f.w, h: f.h, lo: f.lo, to: f.to, idx: b64decode(f.idx) };
  }
  return table;
}

// ── light tables ──────────────────────────────────────────────────────────

/**
 * 34 packed RGBA lookup tables (little-endian words) from palette + colormap:
 * the renderer's whole lighting model is `pixel = lut[texel]`. Index 255 is
 * transparent everywhere, as the palette decrees.
 */
export function buildLUTs(palette: Uint8Array, cmap: Uint8Array): Uint32Array[] {
  const luts: Uint32Array[] = [];
  for (let t = 0; t < 34; t++) {
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      if (i === 255) { lut[i] = 0; continue; }
      const j = cmap[t * 256 + i];
      lut[i] = 0xff000000 | (palette[j * 3 + 2] << 16) | (palette[j * 3 + 1] << 8) | palette[j * 3];
    }
    luts.push(lut);
  }
  return luts;
}

/** Blood-moon variant of a palette: everything leans hell-red. */
export function redPalette(palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(palette.length);
  for (let i = 0; i < palette.length; i += 3) {
    const r = palette[i], g = palette[i + 1], b = palette[i + 2];
    out[i] = Math.min(255, r + g * 0.35 + b * 0.15);
    out[i + 1] = g * 0.4;
    out[i + 2] = b * 0.32;
  }
  return out;
}

/** The light-level (0-255) to COLORMAP-table mapping the original used. */
export const lightToTable = (light: number): number =>
  Math.max(0, Math.min(31, Math.round((255 - light) / 8)));
