import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import ts from 'typescript';

const themesDir = new URL('../src/themes/', import.meta.url);

async function loadMeta(id) {
  const source = await readFile(new URL(`${id}/meta.ts`, themesDir), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  return mod.default;
}

test('every theme folder has an index and picker metadata', async () => {
  const dirs = (await readdir(themesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.ok(dirs.length > 0, 'no theme folders found');
  const metas = [];
  for (const id of dirs) {
    const hasIndex = existsSync(new URL(`${id}/index.ts`, themesDir));
    const hasMeta = existsSync(new URL(`${id}/meta.ts`, themesDir));
    assert.ok(hasIndex, `${id}: missing index.ts`);
    assert.ok(hasMeta, `${id}: missing meta.ts`);
    metas.push([id, await loadMeta(id)]);
  }

  const orders = new Set();
  for (const [id, meta] of metas) {
    assert.equal(typeof meta.title, 'string', `${id}: title must be a string`);
    assert.ok(meta.title.trim(), `${id}: title must not be empty`);
    assert.equal(typeof meta.blurb, 'string', `${id}: blurb must be a string`);
    assert.ok(meta.blurb.trim(), `${id}: blurb must not be empty`);
    assert.match(meta.accent, /^#[0-9a-f]{6}$/i, `${id}: accent must be a six-digit hex colour`);
    assert.equal(typeof meta.accentHue, 'number', `${id}: accentHue must be a number`);
    assert.ok(meta.accentHue >= 0 && meta.accentHue < 360, `${id}: accentHue must be in [0, 360)`);
    assert.equal(typeof meta.order, 'number', `${id}: order must be a number`);
    assert.ok(Number.isInteger(meta.order) && meta.order >= 0, `${id}: order must be a non-negative integer`);
    assert.ok(!orders.has(meta.order), `${id}: duplicate order ${meta.order}`);
    orders.add(meta.order);
  }
});
