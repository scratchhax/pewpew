import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/throttle.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { Throttle } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('throttles per key and permits the next window', () => {
  let now = 0;
  const t = new Throttle(() => now);
  assert.equal(t.allow('a', 3), true);
  assert.equal(t.allow('b', 3), true);
  now = 2_999;
  assert.equal(t.allow('a', 3), false);
  assert.equal(t.allow('b', 3), false);
  now = 3_000;
  assert.equal(t.allow('a', 3), true);
  assert.equal(t.allow('b', 3), true);
});

test('cleanup keeps recent keys and drops expired ones after the cap is hit', () => {
  let now = 0;
  const t = new Throttle(() => now);
  for (let i = 0; i < 4001; i++) t.allow(`k${i}`, 12);
  now = 1_000;
  assert.equal(t.allow('k0', 12), false);
  now = 120_001;
  assert.equal(t.allow('k0', 12), true);
});
