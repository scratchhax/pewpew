import { Graphics, Text, type TextStyleFontWeight } from 'pixi.js';

/**
 * LCARS drawing kit: the Starfleet chrome is pure vector — bars with rounded
 * ends, quarter-annulus elbows, pips — so it rasterises crisp at any
 * resolution, 720p through 4K. The event law colours (allow green, block red,
 * …) stay exactly as in every other scene; LCARS colours are structure only.
 */

/** The canonical LCARS palette (structure), plus the fixed event law (data). */
export const L = {
  black: '#000000',
  // The classic LCARS chart colours: warm, saturated, flat on black.
  red: '#CC6666', dkred: '#993333',
  orange: '#FF9966', peach: '#FFCC99', tan: '#CC9966', yellow: '#FFCC66',
  salmon: '#FF9999', lilac: '#CC99CC', purple: '#CC99FF',
  blue: '#9999FF', deepblue: '#6666CC', paleblue: '#9999CC',
  cyan: '#66CCCC', green: '#99FF99',
  gray: '#999999', white: '#FFFFFF',
};

/** The event law, identical in every scene. */
export const EV: Record<string, number> = {
  allow: 0x5ce6a4, block: 0xff6b6b, threat: 0xff9a45, dns: 0x55b5ff,
  dhcp: 0xffd84d, wifi: 0xc08cff, system: 0x7d99b3,
};

export const FONT = 'Antonio';

/** A label in the house style: Antonio, uppercase, letterspaced. */
export function label(text: string, size: number, color: string, weight = 600, align: 'left' | 'center' | 'right' = 'left'): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: FONT, fontWeight: String(weight) as TextStyleFontWeight, fontSize: Math.round(size),
      fill: color, letterSpacing: size * 0.06,
    },
  });
  t.resolution = 2;
  if (align !== 'left') { t.anchor.set(align === 'center' ? 0.5 : 1, 0); }
  return t;
}

/** A horizontal bar with rounded ends. */
export function hbar(g: Graphics, x: number, y: number, w: number, h: number, color: number | string): void {
  g.roundRect(x, y, w, h, h / 2).fill(color);
}

/** A vertical bar with rounded ends. */
export function vbar(g: Graphics, x: number, y: number, w: number, h: number, color: number | string): void {
  g.roundRect(x, y, w, h, w / 2).fill(color);
}

/**
 * A quarter-annulus elbow centred on (cx, cy) spanning the upper-left
 * quadrant (from straight-left to straight-up), outer radius ro, inner ri.
 */
export function elbow(g: Graphics, cx: number, cy: number, ro: number, ri: number, color: number | string): void {
  g.moveTo(cx - ro, cy);
  g.arc(cx, cy, ro, Math.PI, Math.PI * 1.5);
  g.lineTo(cx + ri, cy - ri);
  g.arc(cx, cy, ri, Math.PI * 1.5, Math.PI, true);
  g.closePath().fill(color);
}

/** A quarter-annulus elbow spanning the lower-left quadrant. */
export function elbowBL(g: Graphics, cx: number, cy: number, ro: number, ri: number, color: number | string): void {
  g.moveTo(cx - ro, cy);
  g.arc(cx, cy, ro, Math.PI, Math.PI * 0.5, true);
  g.lineTo(cx - ri, cy + ri);
  g.arc(cx, cy, ri, Math.PI * 0.5, Math.PI, false);
  g.closePath().fill(color);
}

/** A small rounded pip (the LCARS "button"). */
export function pip(g: Graphics, x: number, y: number, w: number, h: number, color: number | string): void {
  g.roundRect(x, y, w, h, Math.min(w, h) * 0.35).fill(color);
}

/** A panel header: rounded-left bar with the title knocked out in black. */
export function header(g: Graphics, x: number, y: number, w: number, h: number, color: number | string): void {
  hbar(g, x, y, w, h, color);
}
