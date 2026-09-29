/**
 * Procedural 16-bit pixel art, the fragnet way: tiny offscreen canvases drawn
 * with hard edges and upscaled nearest by the renderer. Karts are built from a
 * hue so all eight seats look like a family; ghosts are the desaturated
 * haunt of a host that went quiet.
 */

const W_R = 26, H_R = 20;

function sprite(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  return [cv, c];
}

const hsl = (h: number, s: number, l: number): string => `hsl(${h}, ${s}%, ${l}%)`;

/** A kart seen from behind: fenders, wing, helmet, twin tyres. */
export function kartRear(hue: number): HTMLCanvasElement {
  const [cv, c] = sprite(W_R, H_R);
  const ink = '#0b0c10';
  // rear tyres
  c.fillStyle = ink; c.fillRect(2, 11, 4, 8); c.fillRect(W_R - 6, 11, 4, 8);
  c.fillStyle = '#3b3e46'; c.fillRect(3, 12, 2, 2); c.fillRect(W_R - 5, 12, 2, 2);
  // diffuser + body
  c.fillStyle = ink; c.fillRect(5, 15, W_R - 10, 3);
  c.fillStyle = hsl(hue, 72, 42); c.fillRect(5, 8, W_R - 10, 7);
  c.fillStyle = hsl(hue, 78, 56); c.fillRect(6, 8, W_R - 12, 2);
  c.fillStyle = hsl(hue, 70, 30); c.fillRect(5, 13, W_R - 10, 2);
  // rear wing
  c.fillStyle = ink; c.fillRect(7, 3, 2, 4); c.fillRect(W_R - 9, 3, 2, 4);
  c.fillStyle = hsl(hue, 80, 62); c.fillRect(5, 2, W_R - 10, 2);
  // helmet (the leader wears white; everyone else gets the team colour)
  c.fillStyle = '#e8e6df'; c.fillRect(11, 5, 4, 4);
  c.fillStyle = hsl(hue, 85, 50); c.fillRect(11, 6, 4, 1);
  // tail lights
  c.fillStyle = '#ff4040'; c.fillRect(6, 14, 2, 1); c.fillRect(W_R - 8, 14, 2, 1);
  return cv;
}

/** A kart seen from the front (when we overtake it). */
export function kartFront(hue: number): HTMLCanvasElement {
  const [cv, c] = sprite(W_R, H_R);
  const ink = '#0b0c10';
  c.fillStyle = ink; c.fillRect(2, 11, 4, 8); c.fillRect(W_R - 6, 11, 4, 8);
  c.fillStyle = hsl(hue, 72, 46); c.fillRect(5, 9, W_R - 10, 6);
  c.fillStyle = hsl(hue, 70, 32); c.fillRect(5, 13, W_R - 10, 2);
  c.fillStyle = '#d8d5cc'; c.fillRect(6, 12, W_R - 12, 2);   // front bumper
  c.fillStyle = ink; c.fillRect(7, 3, 2, 4); c.fillRect(W_R - 9, 3, 2, 4);
  c.fillStyle = hsl(hue, 80, 62); c.fillRect(5, 2, W_R - 10, 2);
  c.fillStyle = '#e8e6df'; c.fillRect(11, 5, 4, 4);
  c.fillStyle = '#20222a'; c.fillRect(11, 7, 4, 1);          // visor facing us
  c.fillStyle = '#fff3a0'; c.fillRect(7, 10, 2, 2); c.fillRect(W_R - 9, 10, 2, 2);   // headlights
  return cv;
}

/** A kart seen from the side (passing across our view). */
export function kartSide(hue: number): HTMLCanvasElement {
  const [cv, c] = sprite(30, 18);
  const ink = '#0b0c10';
  c.fillStyle = ink; c.fillRect(3, 12, 5, 6); c.fillRect(22, 12, 5, 6);
  c.fillStyle = '#3b3e46'; c.fillRect(4, 13, 3, 2); c.fillRect(23, 13, 3, 2);
  c.fillStyle = hsl(hue, 72, 42); c.fillRect(2, 9, 26, 4);
  c.fillStyle = hsl(hue, 78, 56); c.fillRect(4, 9, 22, 1);
  c.fillStyle = hsl(hue, 70, 28); c.fillRect(2, 12, 26, 1);
  c.fillStyle = ink; c.fillRect(24, 6, 2, 4);                // nose
  c.fillStyle = hsl(hue, 74, 48); c.fillRect(20, 7, 5, 2);
  c.fillStyle = '#e8e6df'; c.fillRect(13, 4, 4, 4);          // helmet
  c.fillStyle = hsl(hue, 85, 50); c.fillRect(15, 5, 2, 1);
  c.fillStyle = hsl(hue, 80, 60); c.fillRect(6, 5, 8, 2);    // air box behind the head
  return cv;
}

/** The red shell: it flies, it homes, it should not be this fast. */
export function shell(): HTMLCanvasElement {
  const [cv, c] = sprite(20, 14);
  c.fillStyle = '#7a1216'; c.beginPath(); c.arc(11, 7, 6, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#d0262c'; c.beginPath(); c.arc(11, 7, 4.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffd86a'; c.fillRect(13, 5, 2, 4);          // wing stripe
  c.fillStyle = '#ff8a3c'; c.fillRect(0, 5, 5, 3);           // rocket flames
  c.fillStyle = '#ffe98a'; c.fillRect(1, 6, 3, 1);
  c.fillStyle = '#f4f2ea'; c.fillRect(15, 6, 3, 2);          // nose cone
  return cv;
}

/** Oil slick: a block's calling card. */
export function oil(): HTMLCanvasElement {
  const [cv, c] = sprite(24, 12);
  c.fillStyle = '#0c0d12';
  c.beginPath(); c.ellipse(12, 6, 11, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3b2a55';
  c.beginPath(); c.ellipse(9, 5, 4, 1.6, 0.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#22534a';
  c.beginPath(); c.ellipse(15, 7, 3, 1.2, -0.3, 0, Math.PI * 2); c.fill();
  return cv;
}

/** The sponsor board: whatever your network looked up last. */
export function board(text: string, hue: number): HTMLCanvasElement {
  const w = 112, h = 26;
  const [cv, c] = sprite(w, h);
  c.fillStyle = '#0b0d12'; c.fillRect(0, 0, w, h);
  c.strokeStyle = hsl(hue, 80, 55); c.lineWidth = 2;
  c.strokeRect(1, 1, w - 2, h - 2);
  c.fillStyle = '#f2efe4';
  c.font = 'bold 11px monospace';
  c.textBaseline = 'middle';
  const t = text.length > 15 ? `${text.slice(0, 14)}…` : text;
  c.fillText(t, 6, h / 2 + 1);
  return cv;
}

/** Desaturate a kart into the ghost of a host that stopped talking. */
export function ghost(src: HTMLCanvasElement): HTMLCanvasElement {
  const [cv, c] = sprite(src.width, src.height);
  c.drawImage(src, 0, 0);
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * 0.55 + 60;
    d[i] = l; d[i + 1] = l; d[i + 2] = Math.min(255, l + 8);
  }
  c.putImageData(img, 0, 0);
  return cv;
}
