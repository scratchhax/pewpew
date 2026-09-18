#!/usr/bin/env node
// Builds FRAGNET's bundled texture pack from a free IWAD (Freedoom 1, BSD).
//
//   node --experimental-strip-types scripts/mkfragnetpack.mjs <freedoom1.wad>
//
// The WAD itself never goes into the repository: this reads only the
// handful of textures, flats and sprite frames the scene uses and writes
// web/public/fragnet/pack.json - index maps, PLAYPAL and COLORMAP, base64.
// An uploaded DOOM.WAD parsed live in the browser overrides the pack.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wad, extractTable, tableToPack } from '../web/src/themes/fragnet/wad.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) {
  console.error('usage: mkfragnetpack.mjs <iwad>');
  process.exit(1);
}
const buf = await readFile(src);
const wad = new Wad(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (!wad.lumps.some((l) => l.name === 'PLAYPAL')) {
  console.error('not an IWAD? no PLAYPAL');
  process.exit(1);
}
const table = extractTable(wad);
for (const role of ['demon', 'fireball', 'gun']) {
  if (!table.sprites[role]) {
    console.error(`IWAD has no sprites for the "${role}" role`);
    process.exit(1);
  }
}
const pack = tableToPack(table, `${path.basename(src)} (${wad.lumps.length} lumps)`);
const out = path.join(here, '..', 'web', 'public', 'fragnet', 'pack.json');
await writeFile(out, JSON.stringify(pack));
const mb = (JSON.stringify(pack).length / 1e6).toFixed(2);
console.log(`wrote ${out} (${mb} MB): ${Object.keys(table.flats).length} flats, ${Object.keys(table.walls).length} walls, ` +
  Object.entries(table.sprites).map(([r, f]) => `${r}:${Object.keys(f).length}`).join(' '));
