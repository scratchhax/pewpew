import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';

/**
 * The listings that scroll down every tower face: a texture of fixed-height
 * lines, mostly hex and number junk with directory entries mixed in, like the
 * movie's storage wall. Words seen in live traffic (hostnames, DNS queries,
 * addresses) join the pool, so the wall quietly fills with your own network,
 * next to the lines from the film. The whole atlas redraws every few seconds;
 * towers pick lines with per-face offsets, so no two faces ever match.
 */

const ROW_H = 32;
const WIDTH = 512;
const ROWS = 64;

const JUNK: Array<() => string> = [
  () => (Math.random() * 0xffffffff >>> 0).toString(16).toUpperCase().padStart(8, '0'),
  () => (Math.random() * 0xffffff >>> 0).toString(16).toUpperCase(),
  () => String(Math.floor(Math.random() * 0xffffff)),
  () => (Math.random().toString(16).slice(2, 10).toUpperCase()),
  () => '00000000',
  () => '{{{{{{{{',
  () => '[][][][][][]',
  () => 'DEFAULT',
  () => '',
];

const MOVIE = [
  'ACCESS TO THIS COMPUTER',
  'AND ITS DATA IS RESTRICTED',
  'TO AUTHORIZED PERSONNEL',
  'PASSWORD ACCEPTED',
  '             GOD',
  'PERSONNEL   >>>',
  'SEA ROUTINGS   >>>',
  'GARBAGE   >>>',
  'COMPANY BUDGETS   >>>',
  'SCIENTIFIC BUDGETS   >>>',
  'ANNUAL RETURNS   >>>',
  'CENTRAL LIBRARY   >>>',
  'CENTRAL SERVER   >>>',
  'PAYMENT LEVELS   >>>',
  'RECRUITMENT   >>>',
  'OIL LOCATIONS   >>>',
  'NUCLEAR RESEARCH   >>>',
  'CONFIDENTIAL',
  'FILES',
  'DO NOT DELETE',
  'BEFORE FINAL',
  'BACKUP IS COMPLETED',
  'FILE 1  WAITING FOR BACKUP',
  'FILE 2  WAITING FOR BACKUP',
  'FILE 3  WAITING FOR BACKUP',
  'FILE 4  WAITING FOR BACKUP',
];

export class TextAtlas {
  readonly texture: CanvasTexture;
  readonly rows = ROWS;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private words: string[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = ROW_H * ROWS;
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
    const w = s.toUpperCase().replace(/\s+/g, ' ').slice(0, 26);
    if (!w) return;
    this.words.push(w);
    if (this.words.length > 400) this.words.splice(0, 200);
  }

  rebuild(): void {
    const c = this.ctx;
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.font = `bold ${ROW_H - 10}px "Courier New", monospace`;
    c.textBaseline = 'middle';
    for (let r = 0; r < ROWS; r++) {
      const y = r * ROW_H + ROW_H / 2;
      const roll = Math.random();
      let line: string;
      if (roll < 0.52) line = JUNK[(Math.random() * JUNK.length) | 0]();
      else if (roll < 0.72 && this.words.length) line = `${this.words[(Math.random() * this.words.length) | 0]}  >>>`;
      else line = MOVIE[(Math.random() * MOVIE.length) | 0];
      const hot = line === 'GARBAGE   >>>' || line.startsWith('PASSWORD');
      c.fillStyle = hot ? '#ffffff' : '#cfd6ff';
      c.fillText(line, 8, y);
    }
    this.texture.needsUpdate = true;
  }
}
