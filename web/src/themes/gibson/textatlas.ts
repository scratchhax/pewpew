import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';

/**
 * The listings on the tower faces, like the film's cyberspace: glowing words
 * set in thin digital boxes, scrolling slowly up or down the faces. The words
 * are the network's own log stream - the addresses, domains, hostnames,
 * services and devices from live traffic - each drawn in the color the comms
 * log gives that kind of message: green allow, red block, orange threat,
 * blue DNS, yellow DHCP, violet Wi-Fi. Long words shrink to fit their box,
 * so a whole hostname reads on one line. Until the stream has filled the
 * pool, a quiet hum of generic wall-words keeps the faces busy; the real log
 * takes over from there. The atlas repaints a few cells at a time, so new
 * words trickle in while the towers keep scrolling.
 */

const COLS = 8;
const ROWS = 6;
const CW = 128;
const CH = 96;

/** the comms log's own palette (styles.css), so wall and log agree */
export type WordKind = 'allow' | 'block' | 'threat' | 'dns' | 'dhcp' | 'wifi' | 'system';
const KIND_COLOR: Record<WordKind, string> = {
  allow: '#5ce6a4', block: '#ff6b6b', threat: '#ff9a45', dns: '#55b5ff',
  dhcp: '#ffd84d', wifi: '#c08cff', system: '#7d99b3',
};

const AMBIENT: Array<[string, string]> = [
  ['STATUS', '#5fe6ff'], ['REPORT', '#5fe6ff'], ['SECURITY', '#5fe6ff'],
  ['R606', '#5fe6ff'], ['>OVERRIDE', '#9fefff'], ['>DUMPSEG', '#9fefff'],
  ['LOG', '#5fe6ff'], ['NOP', '#5fe6ff'], ['QUE', '#5fe6ff'],
  ['PASSWORD', '#dff2ff'], ['ACCEPTED', '#dff2ff'], ['GOD', '#e8fbff'],
  ['01101010', '#3fa8c8'], ['0x1F8A', '#3fa8c8'], ['1286', '#3fa8c8'],
  ['35563', '#3fa8c8'], ['SEG 77 OK', '#3fa8c8'], ['CRC 12K', '#3fa8c8'],
];

interface Word { t: string; c: string }

export class TextAtlas {
  readonly texture: CanvasTexture;
  readonly cols = COLS;
  readonly rows = ROWS;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private words: Word[] = [];
  private seen = new Set<string>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW * COLS;
    this.canvas.height = CH * ROWS;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = SRGBColorSpace;
    this.rebuild();
  }

  /** A piece of the log stream joins the listings, in its log color. */
  addWord(s: string | null | undefined, kind: WordKind = 'system'): void {
    if (!s) return;
    const w = s.toUpperCase().replace(/[^0-9A-Z._:@-]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 14);
    if (!w || this.seen.has(w)) return;
    this.seen.add(w);
    this.words.push({ t: w, c: KIND_COLOR[kind] ?? '#5fe6ff' });
    if (this.words.length > 400) {
      const dropped = this.words.splice(0, 200);
      for (const d of dropped) this.seen.delete(d.t);
    }
  }

  get streamSize(): number { return this.words.length; }

  private first = true;

  /**
   * Repaint only a few cells and leave the rest alone: the canvas is
   * persistent, so listings keep scrolling by undisturbed and new words
   * trickle in, instead of every face flashing to fresh text at once.
   */
  rebuild(): void {
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        if (this.first || Math.random() < 0.18) this.drawCell(col, r);
      }
    }
    this.first = false;
    this.texture.needsUpdate = true;
  }

  /** Prefer the live log once it has a decent pool; ambient hum before and between. */
  private pick(): Word {
    if (this.words.length >= 30 && Math.random() < 0.85) {
      return this.words[(Math.random() * this.words.length) | 0];
    }
    if (this.words.length && Math.random() < 0.4) {
      return this.words[(Math.random() * this.words.length) | 0];
    }
    const [t, c] = AMBIENT[(Math.random() * AMBIENT.length) | 0];
    return { t, c };
  }

  private drawCell(col: number, row: number): void {
    const c = this.ctx;
    const x = col * CW, y = row * CH;
    c.fillStyle = '#000';
    c.fillRect(x, y, CW, CH);
    this.box(this.pick(), x, y + 3 + Math.random() * 8);
    if (Math.random() < 0.85) this.box(this.pick(), x, y + 38 + Math.random() * 8);
    if (Math.random() < 0.8) {
      // the small print: another line of the stream, dimmed
      const w = this.pick();
      c.font = `bold 15px "Courier New", monospace`;
      c.fillStyle = rgba(w.c, 0.5);
      c.fillText(w.t, x + 7, y + CH - 8);
    }
  }

  /** A word in a thin digital box, in its log color, shrunk to fit the cell. */
  private box(w: Word, x: number, by: number): void {
    const c = this.ctx;
    const base = w.t.length > 11 ? 15 : w.t.length > 8 ? 19 : 24;
    c.font = `bold ${base}px "Courier New", monospace`;
    // long hostnames and domains shrink until they fit their box; nothing
    // gets skipped, the wall is meant to read like a real log
    let text = w.t;
    let size = base;
    for (;;) {
      const mw = c.measureText(text).width;
      if (mw <= CW - 16) break;
      const shrink = Math.floor(size * (CW - 16) / mw);
      if (shrink >= 11 && shrink < size) {
        size = shrink;
        c.font = `bold ${size}px "Courier New", monospace`;
        continue;
      }
      text = text.slice(0, Math.max(2, text.length - 2));
      if (text.length <= 2) return;
    }
    const bw = c.measureText(text).width + 12;
    const bh = size + 8;
    const bx = x + 4 + Math.random() * Math.max(0, CW - 8 - bw);
    c.strokeStyle = rgba(w.c, 0.4);
    c.lineWidth = 2;
    c.strokeRect(bx, by, bw, bh);
    c.shadowColor = w.c;
    c.shadowBlur = 4;
    c.fillStyle = w.c;
    c.fillText(text, bx + 6, by + bh - 6);
    c.shadowBlur = 0;
  }
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
