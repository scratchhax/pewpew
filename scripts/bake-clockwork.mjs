#!/usr/bin/env node
// Bakes Clockwork's hero art: LLM-generated stickers in
// web/src/themes/clockwork/assets/raw/*.png (see PROMPTS.md) get chroma-keyed
// (magenta -> transparent), scaled to world size, quantised to the scene
// palette, trimmed and packed into assets/machine.png + assets/machine.ts.
//
//   node scripts/bake-clockwork.mjs
//
// Uses a private headless Chrome for the canvas work and always kills it.

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '..', 'web', 'src', 'themes', 'clockwork', 'assets');
const raw = path.join(assets, 'raw');
const PORT = 9333;

/** name -> target height in world pixels (role sizes: the boiler is the goal
 *  everything connects to; fittings are sized against it). */
const PARTS = {
  boiler: 380, furnace: 180, gauge: 130, stamp: 110, cart: 80,
  whistle: 90, lamp: 70, clamp: 60, bell: 60, hopper: 90,
};

/** The scene palette (sprites.ts) - everything quantises to this. */
const PALETTE = [
  '#14121c', '#262833', '#3a3d4d', '#565a6e', '#767b92',
  '#6e4f1d', '#a87c2a', '#d9a94a', '#f2d489', '#8f4f2e', '#c07a4a',
  '#4a3320', '#6b4a2e', '#3f7d6a', '#d8c9a0', '#a89772',
  '#ff7a2a', '#ffb347', '#ffd88a', '#9aa4b8', '#e8eef8',
  '#191621', '#211c2c', '#2a2336',
  '#5ce6a4', '#ff6b6b', '#ff9a45', '#55b5ff', '#ffd84d', '#c08cff', '#7d99b3',
];

const html = `<!doctype html><meta charset="utf-8"><title>bake</title><script>
const PALETTE = ${JSON.stringify(PALETTE.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]))};
const PARTS = ${JSON.stringify(PARTS)};
function load(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
window.bake = async (names) => {
  const frames = {}, cells = [];
  for (const name of names) {
    const img = await load(name + '.png?' + Date.now());
    // scale to target height
    const s = PARTS[name] / img.naturalHeight;
    const w = Math.max(4, Math.round(img.naturalWidth * s)), h = PARTS[name];
    // PIXELATE: render at half size, quantise there, blow back up with hard
    // pixels - the stickers must share the procedural parts' chunky language.
    const pw = Math.max(4, Math.round(w * 0.5)), ph = Math.max(4, Math.round(h * 0.5));
    let sm = document.createElement('canvas'); sm.width = pw; sm.height = ph;
    let sx = sm.getContext('2d'); sx.imageSmoothingEnabled = true;
    sx.drawImage(img, 0, 0, pw, ph);
    const d = sx.getImageData(0, 0, pw, ph);
    for (let i = 0; i < d.data.length; i += 4) {
      const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
      const magenta = Math.abs(r - 255) + g + Math.abs(b - 255);
      if (magenta < 170 || (r > 190 && b > 190 && g < 110)) { d.data[i + 3] = 0; continue; }
      if (d.data[i + 3] < 40) { d.data[i + 3] = 0; continue; }
      let best = 0, bd = 1e9;
      for (let p = 0; p < PALETTE.length; p++) {
        const dr = r - PALETTE[p][0], dg = g - PALETTE[p][1], db = b - PALETTE[p][2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = p; }
      }
      d.data[i] = PALETTE[best][0]; d.data[i + 1] = PALETTE[best][1]; d.data[i + 2] = PALETTE[best][2]; d.data[i + 3] = 255;
    }
    sx.putImageData(d, 0, 0);
    let c = document.createElement('canvas'); c.width = w; c.height = h;
    let x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(sm, 0, 0, w, h);
    const d2 = x.getImageData(0, 0, w, h);
    // trim
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let j = 0; j < h; j++) for (let i2 = 0; i2 < w; i2++) {
      if (d2.data[(j * w + i2) * 4 + 3] > 8) { if (i2 < x0) x0 = i2; if (i2 > x1) x1 = i2; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    }
    if (x1 < 0) throw new Error(name + ': fully keyed out - is the background magenta?');
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    const c2 = document.createElement('canvas'); c2.width = tw; c2.height = th;
    c2.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
    cells.push({ name, c: c2 });
  }
  // shelf pack, 1024 wide
  const AW = 1024; let px = 0, py = 0, rowH = 0, ah = 0;
  for (const cell of cells) {
    if (px + cell.c.width + 2 > AW) { px = 0; py += rowH + 2; rowH = 0; }
    frames[cell.name] = [px, py, cell.c.width, cell.c.height];
    px += cell.c.width + 2; rowH = Math.max(rowH, cell.c.height);
    ah = Math.max(ah, py + rowH);
  }
  const atlas = document.createElement('canvas'); atlas.width = AW; atlas.height = ah;
  const ax = atlas.getContext('2d'); ax.imageSmoothingEnabled = false;
  for (const cell of cells) { const f = frames[cell.name]; ax.drawImage(cell.c, f[0], f[1]); }
  return { frames, w: AW, h: ah, png: atlas.toDataURL('image/png') };
};
</script>`;

async function main() {
  const files = (await readdir(raw)).filter((f) => f.endsWith('.png'));
  const names = Object.keys(PARTS).filter((n) => files.includes(`${n}.png`));
  if (!names.length) {
    console.error(`no PNGs in ${raw} - see PROMPTS.md`);
    process.exit(1);
  }
  const missing = Object.keys(PARTS).filter((n) => !files.includes(`${n}.png`));
  if (missing.length) console.warn('missing (skipped):', missing.join(', '));

  await writeFile(path.join(raw, 'bake.html'), html);
  const chrome = spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
    '--allow-file-access-from-files', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=200,200',
    'file://' + path.join(raw, 'bake.html'),
  ], { stdio: 'ignore' });
  const kill = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } };
  process.on('exit', kill);

  try {
    // wait for the debugger, open a page, run the bake
    let ws;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
        const sock = new WebSocket(r.webSocketDebuggerUrl);
        sock.addEventListener('error', () => sock.close());
        await new Promise((res, rej) => {
          sock.addEventListener('open', res);
          setTimeout(() => rej(new Error('ws timeout')), 3000);
        });
        ws = sock;
        break;
      } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!ws) throw new Error('chrome debugger never came up');
    ws.addEventListener('error', () => {});
    let id = 0;
    const send = (method, params = {}) => new Promise((res, rej) => {
      const mid = ++id;
      const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === mid) { ws.removeEventListener('message', h); d.error ? rej(new Error(d.error.message)) : res(d.result); } };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => rej(new Error('timeout ' + method)), 60000);
    });
    await send('Page.enable');
    await send('Page.navigate', { url: 'file://' + path.join(raw, 'bake.html') });
    await new Promise((r) => setTimeout(r, 1500));
    const out = await send('Runtime.evaluate', {
      expression: `window.bake(${JSON.stringify(names)})`, awaitPromise: true, returnByValue: true,
    });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? 'bake failed');
    const { frames, w, h, png } = out.result.value;

    const b64 = png.slice(png.indexOf(',') + 1);
    await writeFile(path.join(assets, 'machine.png'), Buffer.from(b64, 'base64'));
    const ts = `/**
 * Clockwork hero parts: LLM-generated stickers (see PROMPTS.md), chroma-keyed,
 * palette-quantised and packed by scripts/bake-clockwork.mjs.
 * frames[name] = [x, y, w, h] into machine.png, trimmed, at world scale.
 */
export const MACHINE_SIZE = [${w}, ${h}] as const;
export const MACHINE_FRAMES: Record<string, number[]> = ${JSON.stringify(frames)};
`;
    await writeFile(path.join(assets, 'machine.ts'), ts);
    console.log(`baked ${names.join(', ')} -> machine.png ${w}x${h}`);
  } finally {
    kill();
    await rm(path.join(raw, 'bake.html'), { force: true });
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((e) => { console.error(e && e.stack ? e.stack : require("node:util").inspect(e)); process.exit(1); });
