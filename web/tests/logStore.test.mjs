import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/logStore.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { LogStore, matches, MAX_EVENTS, MAX_TEXT_BYTES, MAX_EVENT_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const event = (extra = {}) => ({ log_type: 'firewall', timestamp: '2026-09-14T12:00:00Z', src_ip: '192.168.1.10', dst_ip: '1.1.1.1', rule_action: 'block', ...extra });
const filter = (extra = {}) => ({ search: '', type: '', action: '', host: '', ...extra });

test('evicts oldest records at the event cap and keeps monotonically increasing IDs', () => {
  const store = new LogStore();
  for (let i = 0; i < MAX_EVENTS + 100; i++) store.add(event());
  assert.equal(store.records.size, MAX_EVENTS);
  assert.equal(store.records.keys().next().value, 101);
  assert.equal(store.records.has(1), false);
  assert.equal(store.lastId, MAX_EVENTS + 100);
});

test('byte budget wins before count budget, even for giant raw payloads', () => {
  const store = new LogStore();
  for (let i = 0; i < 1000; i++) store.add(event({ raw_log: '🛰'.repeat(100_000), rule_desc: 'x'.repeat(100_000) }));
  assert.ok(store.bytes <= MAX_TEXT_BYTES);
  assert.ok(store.records.size < MAX_EVENTS);
  assert.equal(store.bytes, [...store.records.values()].reduce((sum, r) => sum + r.bytes, 0));
  for (const r of store.records.values()) {
    assert.ok(r.truncated);
    assert.ok(r.bytes <= MAX_EVENT_BYTES);
    assert.equal(r.event.src_ip, '192.168.1.10');
    assert.equal(r.bytes, Object.values(r.event).reduce((sum, v) => sum + (typeof v === 'string' ? v.length * 2 : 0), 0));
  }
});

test('combines search, event/action/host filters and exact identity pivots', () => {
  const r = new LogStore().add(event({ syslog_host: 'GW', mac_address: 'AA:BB:CC:DD:EE:FF', rule_desc: 'Suspicious traffic', threat: true }));
  assert.ok(matches(r, filter({ search: 'SUSPICIOUS', type: 'threat', action: 'block', host: 'GW', pivot: { field: 'ip', value: '1.1.1.1' } })));
  assert.ok(matches(r, filter({ pivot: { field: 'mac', value: 'aa:bb:cc:dd:ee:ff' } })));
  assert.ok(!matches(r, filter({ pivot: { field: 'ip', value: '192.168.1.1' } })));
  assert.ok(!matches(r, filter({ pivot: { field: 'host', value: '192.168.1.10' } })));
  assert.ok(!matches(r, filter({ type: 'dns' })));
  assert.ok(!matches(r, filter({ action: 'allow' })));
  assert.ok(!matches(r, filter({ host: 'AP' })));
  assert.ok(!matches(r, filter({ search: 'absent' })));
  assert.ok(matches(new LogStore().add(event({ raw_log: '<script>literal text</script>' })), filter({ search: '<script>' })));
});

test('seeds only once, excludes snapshot traffic from sparkline, and clear releases history', () => {
  const store = new LogStore();
  store.seed([event(), event({ log_type: 'system' })]);
  store.seed([event()]);
  assert.equal(store.records.size, 2);
  assert.equal(store.buckets.reduce((n, b) => n + b.count, 0), 0);
  store.add(event());
  assert.equal(store.buckets.reduce((n, b) => n + b.count, 0), 1);
  store.clear();
  assert.equal(store.bytes, 0);
  assert.equal(store.records.size, 0);
  assert.equal(store.buckets.length, 60);
  assert.equal(store.buckets.reduce((n, b) => n + b.count, 0), 0);
  store.seed([event()]);
  assert.equal(store.records.size, 0, 'reconnect must not restore cleared history');
});
