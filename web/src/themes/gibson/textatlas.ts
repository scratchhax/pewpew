import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';

/**
 * The listings on the tower faces, like the film's edge-lit perspex: sparse,
 * big readable words — STATUS, REPORT, R606, >OVERRIDE, Security Xv7, hex and
 * binary strings — stacked with wide gaps, scrolling slowly up or down. Words
 * seen in live traffic (hostnames, DNS queries, addresses) join the pool, so
 * the wall quietly fills with your own network. The whole atlas redraws every
 * few seconds; towers pick cells with per-face hashes, so no two faces match.
 *
 * The atlas is a grid of cells sized to match one line-strip on a tower face
 * (1 world unit wide : uPitch tall), so glyphs keep their aspect and read as
 * words, not stripes.
 */

const COLS = 8;
const ROWS = 6;
const CW = 128;
const CH = 160;

const TOKENS = [
  'STATUS', 'REPORT', 'COMFRO', 'CONFOR', 'CEPORS', 'IDLEGRO', 'IDEEIBD',
  'CH57', '7P57', 'R606', 'SARE', '4S67', '3816', '4567', 'CH5T',
  'ERROR', 'Security Xv7', '>OVERRIDE', '>DUMPSEG', '>VMERASE', 'log', 'mov', 'nop', 'QUE', 'Mt',
  '5563', '1286', '35563', '20fx89c', '11100110x01', '11000010x011', '00000x0110x', '00000x111',
  'GARBAGE', 'GOD', 'PASSWORD', 'ACCEPTED', '>>> ',
];

export class TextAtlas {
  readonly texture: CanvasTexture;
  readonly cols = COLS;
  readonly rows = ROWS;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private words: string[] = [];

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

  /** A word from live traffic joins the listings. */
  addWord(s: string | null | undefined): void {
    if (!s) return;
    const w = s.toUpperCase().replace(/\s+/g, ' ').slice(0, 14);
    if (!w) return;
    this.words.push(w);
    if (this.words.length > 400) this.words.splice(0, 200);
  }

  rebuild(): void {
    const c = this.ctx;
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        if (Math.random() < 0.28) continue;
        let word: string;
        if (this.words.length && Math.random() < 0.38) word = this.words[(Math.random() * this.words.length) | 0];
        else word = TOKENS[(Math.random() * TOKENS.length) | 0];
        const size = word.length > 11 ? 30 : word.length > 8 ? 40 : 52;
        c.font = `bold ${size}px "Courier New", monospace`;
        const w = c.measureText(word).width;
        if (w > CW - 12) continue;
        const x = 4 + Math.random() * (CW - 8 - w);
        const y = CH * (0.34 + Math.random() * 0.36);
        c.fillStyle = word === 'GARBAGE' || word === 'GOD' ? '#ffffff' : '#e8f4ff';
        c.fillText(word, col * CW + x, r * CH + y);
      }
    }
    this.texture.needsUpdate = true;
  }
}
