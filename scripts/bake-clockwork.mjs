#!/usr/bin/env node
// Bakes Clockwork's hero art.
//
//   node scripts/bake-clockwork.mjs
//
// Reads the generated stickers from
// web/src/themes/clockwork/assets/raw/*.png (see that folder's PROMPTS.md),
// keys out any leftover magenta, trims, and derives every MOTION FRAME from
// the single still by rotating it about a stated pivot. One image in, a whole
// animation out.
//
// That is the point of the whole pipeline. Asking a generator for eight
// consistent frames of a rotating bearing gets you eight different bearings;
// a rotation matrix gets you the same bearing eight times. So the artist draws
// each part once, in its rest pose, and the maths does the rest.
//
// Frames are rendered at full source resolution, rotated there, and only then
// downscaled - rotating a twenty-pixel sprite destroys it. They are baked at
// half the target size and nearest-upscaled back, so the hero art has the same
// chunky pixel grid as the parts that are drawn in code and the two do not sit
// in one frame looking like they came from different games.
//
// Output: assets/machine.png (the atlas) and assets/machine.ts (the manifest,
// with each frame's rect and the pivot's position inside it).
//
// Uses a private headless Chrome for the canvas work and always kills it.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '..', 'web', 'src', 'themes', 'clockwork', 'assets');
const raw = path.join(assets, 'raw');

/**
 * What to bake, and how each part moves.
 *
 *   h / w   the drawn size in world units (one bearing is 8, the scene is
 *           640x360). Give w for things whose length is the meaningful
 *           dimension, like the see-saw plank.
 *   pivot   where the part turns, as a fraction of its trimmed box. The engine
 *           puts this point at the station's world position.
 *   arc     [from, to] degrees across the frames.
 *   spin    full 360 rotation in N frames (a ball, a gear, a flywheel).
 *   period  for spin: the angle after which the shape repeats, so a 12-tooth
 *           gear only needs 30 degrees of frames to turn forever.
 */
const PARTS = {
  // the movers
  bearing: { h: 8, spin: 8, period: 360, pivot: [0.5, 0.5] },
  domino: { h: 18, pivot: [0.5, 1.0], arc: [0, 83], frames: 6 },
  seesaw: { w: 44, pivot: [0.5, 0.5], arc: [-13, 13], frames: 5 },
  cart: { h: 20, pivot: [0.78, 1.0], arc: [0, -32], frames: 4 },
  gear: { h: 60, spin: 8, period: 30, pivot: [0.5, 0.5] },
  flywheel: { h: 56, spin: 8, period: 60, pivot: [0.5, 0.5] },
  lever: { h: 22, pivot: [0.5, 0.06], arc: [0, -34], frames: 5 },
  bell: { h: 14, pivot: [0.5, 0.1], arc: [-13, 13], frames: 5 },
  gate: { h: 28, pivot: [0.5, 0] },
  whistle: { h: 16, pivot: [0.5, 1] },
  plate: { h: 9, pivot: [0.5, 0.5] },
  // the furniture
  boiler: { h: 78, pivot: [0.5, 0.5] },
  firebox: { h: 46, pivot: [0.5, 0.5] },
  hopper: { h: 14, pivot: [0.5, 0.5] },
  funnel: { h: 16, pivot: [0.5, 0.5] },
  rack: { h: 72, pivot: [0.5, 0.5] },
};

/** World pixels per baked pixel: 2 gives the chunky grid the code parts have. */
const CHUNK = 2;

const files = (await readdir(raw)).filter((f) => f.endsWith('.png')).sort();
if (!files.length) {
  console.error(`no PNGs in ${raw} - see PROMPTS.md`);
  process.exit(1);
}
const unknown = files.map((f) => f.replace(/\.png$/, '')).filter((n) => !PARTS[n]);
if (unknown.length) console.warn(`! not in the part table, skipping: ${unknown.join(', ')}`);

/**
 * Serve both the page and the PNGs, so the canvas work is same-origin.
 * Loading the images into an about:blank page taints the canvas and
 * getImageData throws, which is how the key-and-trim pass needs to read them.
 */
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>bake</title><body></body>');
    return;
  }
  // read first, then write headers: a miss used to throw ERR_HTTP_HEADERS_SENT
  let body;
  try { body = await readFile(path.join(raw, path.basename(url))); }
  catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'image/png' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const profile = await mkdtemp(path.join(tmpdir(), 'cw-bake-'));
const chrome = spawn('/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio',
  '--remote-debugging-pipe', '--no-first-run', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

let next = 0, buffer = '', session;
const pending = new Map();
chrome.stdio[4].on('data', (c) => {
  buffer += c.toString();
  let e;
  while ((e = buffer.indexOf('\0')) >= 0) {
    const m = JSON.parse(buffer.slice(0, e));
    buffer = buffer.slice(e + 1);
    const p = pending.get(m.id);
    if (!p) continue;
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
const send = (method, params = {}, sid = session) => new Promise((res, rej) => {
  const id = ++next;
  pending.set(id, { resolve: res, reject: rej });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0');
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

const PAGE = `
const CHUNK = ${CHUNK};
const PARTS = ${JSON.stringify(PARTS)};
const PORT = ${port};

const load = (src) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
});
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };

/** Key any leftover opaque magenta, then trim to the content box. */
function keyAndTrim(img) {
  const c = cv(img.width, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    if (p[i] > 180 && p[i + 1] < 90 && p[i + 2] > 180) p[i + 3] = 0;   // #ff00ff
  }
  x.putImageData(d, 0, 0);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
    if (p[(yy * c.width + xx) * 4 + 3] > 8) {
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    }
  }
  if (x1 < 0) return c;
  const t = cv(x1 - x0 + 1, y1 - y0 + 1);
  t.getContext('2d').drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
  return t;
}

/**
 * One frame: rotate the full-resolution source about its pivot, then scale to
 * the baked size. Rotating first and shrinking second is the whole trick -
 * rotating a twenty-pixel sprite tears it apart.
 */
function frame(src, deg, pivot, scale) {
  const a = deg * Math.PI / 180;
  const px = src.width * pivot[0], py = src.height * pivot[1];
  // corners of the source, rotated about the pivot, to find the new extent
  const cs = Math.cos(a), sn = Math.sin(a);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const [cx, cy] of [[0, 0], [src.width, 0], [0, src.height], [src.width, src.height]]) {
    const dx = cx - px, dy = cy - py;
    const rx = dx * cs - dy * sn, ry = dx * sn + dy * cs;
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
  }
  const big = cv(Math.ceil(maxX - minX), Math.ceil(maxY - minY));
  const bx = big.getContext('2d');
  bx.imageSmoothingQuality = 'high';
  bx.translate(-minX, -minY);
  bx.rotate(a);
  bx.drawImage(src, -px, -py);
  // the pivot now sits at (-minX, -minY) in the rotated canvas
  const pivotInBig = [-minX, -minY];

  // bake small, then nearest-upscale, so the pixels are chunky like the code art
  const smallW = Math.max(1, Math.round(big.width * scale / CHUNK));
  const smallH = Math.max(1, Math.round(big.height * scale / CHUNK));
  const small = cv(smallW, smallH);
  const sx = small.getContext('2d');
  sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
  sx.drawImage(big, 0, 0, smallW, smallH);

  const out = cv(smallW * CHUNK, smallH * CHUNK);
  const ox = out.getContext('2d');
  ox.imageSmoothingEnabled = false;
  ox.drawImage(small, 0, 0, out.width, out.height);
  return { canvas: out, pivot: [pivotInBig[0] * scale, pivotInBig[1] * scale] };
}

window.bake = async (names) => {
  const made = [];
  for (const name of names) {
    const spec = PARTS[name];
    if (!spec) continue;
    const src = keyAndTrim(await load('http://127.0.0.1:' + PORT + '/' + name + '.png'));
    const scale = spec.h ? spec.h / src.height : spec.w / src.width;
    const angles = [];
    if (spec.spin) {
      const period = spec.period ?? 360;
      for (let i = 0; i < spec.spin; i++) angles.push((i / spec.spin) * period);
    } else if (spec.arc) {
      const n = spec.frames ?? 2;
      for (let i = 0; i < n; i++) angles.push(spec.arc[0] + (spec.arc[1] - spec.arc[0]) * (n === 1 ? 0 : i / (n - 1)));
    } else angles.push(0);
    const frames = angles.map((d) => frame(src, d, spec.pivot ?? [0.5, 0.5], scale));
    made.push({ name, frames, src: [src.width, src.height], scale });
  }

  // shelf-pack, tallest first
  const all = [];
  for (const m of made) m.frames.forEach((f, i) => all.push({ m, f, i }));
  all.sort((a, b) => b.f.canvas.height - a.f.canvas.height);
  const W = 1024;
  let cx = 0, cy = 0, shelf = 0;
  for (const it of all) {
    const w = it.f.canvas.width, h = it.f.canvas.height;
    if (cx + w + 1 > W) { cx = 0; cy += shelf + 1; shelf = 0; }
    it.rect = [cx, cy, w, h];
    cx += w + 1;
    if (h > shelf) shelf = h;
  }
  const H = cy + shelf + 1;
  const atlas = cv(W, H);
  const ax = atlas.getContext('2d');
  ax.imageSmoothingEnabled = false;
  for (const it of all) ax.drawImage(it.f.canvas, it.rect[0], it.rect[1]);

  const manifest = {};
  for (const m of made) {
    manifest[m.name] = m.frames.map((f, i) => {
      const it = all.find((a) => a.m === m && a.i === i);
      return { x: it.rect[0], y: it.rect[1], w: it.rect[2], h: it.rect[3], px: +f.pivot[0].toFixed(2), py: +f.pivot[1].toFixed(2) };
    });
  }
  return JSON.stringify({ png: atlas.toDataURL('image/png'), manifest, size: [W, H] });
};
`;

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  session = (await send('Target.attachToTarget', { targetId, flatten: true }, undefined)).sessionId;
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  for (let i = 0; i < 100; i++) {
    if (await ev('document.readyState === "complete"').catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await ev(PAGE);
  const names = files.map((f) => f.replace(/\.png$/, '')).filter((n) => PARTS[n]);
  const out = JSON.parse(await ev(`window.bake(${JSON.stringify(names)})`));

  await writeFile(path.join(assets, 'machine.png'), Buffer.from(out.png.split(',')[1], 'base64'));
  const ts = `// GENERATED by scripts/bake-clockwork.mjs - do not edit.
// Each part is a list of frames; (px, py) is where the part's pivot sits
// inside that frame, so the engine can place a rotating part by its pivot.
export interface BakedFrame { x: number; y: number; w: number; h: number; px: number; py: number }
export const ATLAS_SIZE: [number, number] = [${out.size[0]}, ${out.size[1]}];
export const FRAMES: Record<string, BakedFrame[]> = ${JSON.stringify(out.manifest, null, 2)};
`;
  await writeFile(path.join(assets, 'machine.ts'), ts);

  console.log(`atlas ${out.size[0]}x${out.size[1]}`);
  for (const [name, frames] of Object.entries(out.manifest)) {
    const f = frames[0];
    console.log(`  ${name.padEnd(10)} ${String(frames.length).padStart(2)} frame(s)  ${f.w}x${f.h}`);
  }
} finally {
  chrome.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
