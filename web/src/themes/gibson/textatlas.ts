import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';

/**
 * The listings on the tower faces, like the film's cyberspace: glowing cyan
 * words — STATUS, ERROR, REPORT, Security, R606, >OVERRIDE — each set inside
 * a thin digital box, with dim hex/binary log lines underneath, covering the
 * faces and scrolling slowly up or down. Words seen in live traffic
 * (hostnames, DNS queries, addresses) join the pool, so the wall quietly
 * fills with your own network. The whole atlas redraws every few seconds;
 * towers pick cells with per-face hashes, so no two faces match.
 *
 * The atlas is a grid of cells sized to match one line-strip on a tower face
 * (1 world unit wide : uPitch tall), so glyphs keep their aspect and read as
 * words in boxes, not stripes.
 */

const COLS = 8;
const ROWS = 6;
const CW = 128;
const CH = 96;

const TOKENS = [
  'STATUS', 'REPORT', 'ERROR', 'Security', 'COMFRO', 'CONFOR', 'CEPORS',
  'IDLEGRO', 'IDEEIBD', 'CH57', '7P57', 'R606', 'SARE', '4S67', '3816',
  '4567', 'CH5T', '>OVERRIDE', '>DUMPSEG', '>VMERASE', 'log', 'mov', 'nop',
  'QUE', 'PASSWORD', '11010011', '01101010', '10110x011', '0x1F8A', '20fx89c',
  '5563', '1286', '35563', 'GARBAGE', 'GOD', 'ACCEPTED', '>>> ',
];

const SUBS = [
  '0x0F4A SEG OK', '10110 01101', '01101 00110', 'CRC FAIL 12K',
  'SYS::LOG 771', 'MEM DUMP 64K', 'IO 0x3C RDY', 'PING 12MS', 'SEG 77 OK',
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
    const pick = (): string =>
      this.words.length && Math.random() < 0.34
        ? this.words[(Math.random() * this.words.length) | 0]
        : TOKENS[(Math.random() * TOKENS.length) | 0];
    const box = (word: string, x: number, y: number): void => {
      const size = word.length > 11 ? 15 : word.length > 8 ? 19 : 24;
      c.font = `bold ${size}px "Courier New", monospace`;
      const bw = c.measureText(word).width + 12;
      if (bw > CW - 10) return;
      const bh = size + 8;
      const bx = x + 4 + Math.random() * (CW - 8 - bw);
      c.strokeStyle = 'rgba(52, 200, 255, 0.4)';
      c.lineWidth = 2;
      c.strokeRect(bx, y, bw, bh);
      c.fillStyle = word === 'GARBAGE' || word === 'GOD' ? '#e8fbff' : '#5fe6ff';
      c.fillText(word, bx + 6, y + bh - 6);
    };
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * CW, y = r * CH;
        box(pick(), x, y + 3 + Math.random() * 8);
        if (Math.random() < 0.85) box(pick(), x, y + 38 + Math.random() * 8);
        if (Math.random() < 0.8) {
          c.font = `bold 15px "Courier New", monospace`;
          c.fillStyle = 'rgba(40, 165, 205, 0.7)';
          c.fillText(SUBS[(Math.random() * SUBS.length) | 0], x + 7, y + CH - 8);
        }
      }
    }
    this.texture.needsUpdate = true;
  }
}
