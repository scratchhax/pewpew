import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/state.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { State } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('counts only events inside the 30s window and expires them at the boundary', () => {
  let now = 0;
  const s = new State(() => now);
  s.onEvent('allow');
  now = 10_000;
  s.onEvent('block');
  now = 20_000;
  s.onEvent('threat');

  assert.equal(s.rate30s, 3);
  assert.equal(s.blocks30s(), 1);
  assert.equal(s.threats30s(), 1);

  now = 30_000;
  assert.equal(s.rate30s, 3);
  assert.equal(s.blocks30s(), 1);

  now = 30_001;
  assert.equal(s.rate30s, 2);
  assert.equal(s.blocks30s(), 1);
  assert.equal(s.threats30s(), 1);

  now = 40_001;
  assert.equal(s.rate30s, 1);
  assert.equal(s.blocks30s(), 0);
  assert.equal(s.threats30s(), 1);

  now = 50_001;
  assert.equal(s.rate30s, 0);
  assert.equal(s.threats30s(), 0);
});

test('compacts expired timestamps without changing the live counts', () => {
  let now = 0;
  const s = new State(() => now);
  for (let i = 0; i < 5000; i++) {
    now = i * 10;
    s.onEvent('allow');
  }
  now = 100_000;
  assert.equal(s.rate30s, 0);
  now = 95_000;
  s.onEvent('allow');
  assert.equal(s.rate30s, 1);
});

test('weather follows the cached 30s rate', () => {
  let now = 0;
  const s = new State(() => now);
  assert.equal(s.weather, 'calm');
  for (let i = 0; i < 300; i++) s.onEvent('allow');
  s.update(0.5);
  assert.equal(s.weather, 'storm');
  for (let i = 0; i < 900; i++) s.onEvent('block');
  s.update(0.5);
  assert.equal(s.weather, 'hurricane');
});
