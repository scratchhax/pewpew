// Run against `npm run dev -- --host 127.0.0.1`. No browser test dependency.
// The first Chrome/Chromium/Edge found for this platform is used; CHROME_BIN
// overrides it, and is what you want on anything the list below misses.
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const CANDIDATES = {
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
};

async function findBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const path of CANDIDATES[process.platform] ?? []) {
    try { await access(path, constants.X_OK); return path; } catch { /* keep looking */ }
  }
  throw new Error(`No Chrome/Chromium found on ${process.platform}. Tried:\n  `
    + (CANDIDATES[process.platform] ?? ['(no known locations for this platform)']).join('\n  ')
    + '\nSet CHROME_BIN to the browser executable, e.g. CHROME_BIN=/path/to/chrome npm run test:browser');
}

const profile = await mkdtemp(join(tmpdir(), 'pewpew-browser-'));
const chrome = spawn(await findBrowser(), [
  '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let next = 0, buffer = '', session;
const pending = new Map();
chrome.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    const p = pending.get(message.id);
    if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
  }
});
const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const check = async (expression, message) => assert.equal(await evaluate(expression), true, message);
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const tick = () => delay(220);

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  session = (await send('Target.attachToTarget', { targetId, flatten: true }, undefined)).sessionId;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/tests/fixtures/log-inspector.html' });
  for (let i = 0; i < 50; i++) { if (await evaluate('!!window.inspector')) break; await delay(100); }
  await check('!!window.inspector', 'fixture loads');
  await evaluate(`window.makeEvent = (i, extra = {}) => ({log_type:'firewall', timestamp:'2026-09-14T12:00:00Z', src_ip:'192.168.1.10', dst_ip:'1.1.1.1', rule_action:'block', raw_log:'event '+i, ...extra});
    for(let i=0;i<6000;i++) inspector.store.add(makeEvent(i));
    document.querySelector('#open').focus(); document.querySelector('#open').click();`);
  await tick();
  await check('inspector.store.records.size === 5000 && document.querySelectorAll(".log-row").length < 50', 'record and DOM caps');
  await check('document.activeElement.matches("[data-filter=search]")', 'search receives focus');
  await click('.log-row'); await tick();
  await check('!inspector.following && document.querySelector(".log-detail").textContent.includes("192.168.1.10")', 'selection pauses and shows details');
  await click('[data-pivot="ip"]'); await tick();
  await check('document.querySelector(".log-chips").textContent.includes("ip: 192.168.1.10")', 'address pivot is visible');
  await click('[data-command="back"]'); await tick();
  await evaluate(`for(let i=0;i<5001;i++) inspector.store.add(makeEvent(i));`); await tick();
  await check('document.querySelector(".log-detail").textContent.includes("no longer retained")', 'paused selection expires');
  await click('[data-command="live"]'); await tick();
  await check('inspector.following && document.querySelectorAll(".log-row").length < 50', 'resume remains virtualized');
  await click('[data-command="clear"]'); await tick();
  await check('inspector.store.records.size === 0 && inspector.store.bytes === 0 && !document.querySelector(".log-row")', 'clear releases history and rows');
  await evaluate(`inspector.store.add(makeEvent(0, {log_type:'system', raw_log:'<img src=x onerror="window.injected=true">'}));`); await tick();
  await click('.log-row'); await tick();
  await check('!window.injected && !document.querySelector(".log-detail img") && document.querySelector(".log-detail pre").textContent.includes("<img")', 'raw text cannot inject HTML');
  await evaluate(`Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async text=>{window.copied=text;}}});`);
  await click('[data-command="copy"]'); await tick();
  await check('JSON.parse(window.copied).raw_log.includes("<img")', 'copy JSON preserves literal retained text');
  await evaluate(`document.querySelector('.log-detail details').open=true`);
  await click('[data-format="raw"]'); await tick();
  await check('window.copied.startsWith("<img")', 'copy raw text');
  await evaluate(`inspector.store.add(makeEvent(1, {raw_log:undefined})); document.querySelector('[data-command="live"]').click();`); await tick();
  await evaluate(`document.querySelectorAll('.log-row')[1].click()`); await tick();
  await check('document.querySelector(".log-detail").textContent.includes("not available")', 'missing raw data is explicit');
  await check(`(() => {const s=document.querySelector('[data-filter="search"]'); s.value='no-match';
    s.dispatchEvent(new Event('input',{bubbles:true}));
    return !!document.querySelector('.log-row');})()`, 'search is debounced, not applied on the keystroke');
  await delay(500);
  await check('!document.querySelector(".log-row") && document.querySelector(".log-rows").textContent.includes("No matching")', 'empty search results');
  await click('[data-command="reset"]'); await tick();
  await evaluate(`document.querySelector('.log-list').focus(); document.querySelector('.log-list').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));`); await tick();
  await check('document.querySelector(".log-list").hasAttribute("aria-activedescendant")', 'keyboard selection is exposed');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await tick();
  await check(`(() => {const d=document.querySelector('#log-inspector').getBoundingClientRect();const l=document.querySelector('.log-list').getBoundingClientRect();const detail=document.querySelector('.log-detail').getBoundingClientRect();return d.width<=390 && d.height<=844 && detail.top>=l.bottom && detail.height>100;})()`, 'mobile inspector fits and stacks');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await check('getComputedStyle(document.querySelector("#log-inspector")).animationName === "none"', 'reduced motion');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await tick();
  await check('!inspector.isOpen && inspector.ids.length === 0 && document.querySelectorAll(".log-row").length === 0 && document.activeElement.id === "open"', 'Escape releases rendered references and restores focus');
  console.log('PASS: browser interaction, virtual rows, expiration, injection, keyboard, mobile and reduced motion');

  if (process.argv.includes('--stress')) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`inspector.store.clear(); inspector.follow(); inspector.open();
      window.stressCount=0; window.stressTimer=setInterval(()=>{for(let i=0;i<20;i++) inspector.store.add(makeEvent(++stressCount,{raw_log:('traffic '+stressCount+' ').repeat(300)}));},100);`);
    const samples = [];
    for (let second = 1; second <= 300; second++) {
      await delay(1000);
      if (second % 60) continue;
      await send('HeapProfiler.collectGarbage');
      const heap = await send('Runtime.getHeapUsage');
      const stats = await evaluate('({events:stressCount, retained:inspector.store.records.size, bytes:inspector.store.bytes, rows:document.querySelectorAll(".log-row").length})');
      assert.ok(stats.retained <= 5000 && stats.bytes <= 8*1024*1024 && stats.rows < 50);
      samples.push(heap.usedSize);
      console.log(JSON.stringify({ second, ...stats, heapMiB: +(heap.usedSize/1024/1024).toFixed(2) }));
    }
    await evaluate('clearInterval(stressTimer)');
    assert.ok(samples.at(-1) <= samples[0] * 1.3 + 2*1024*1024, 'post-GC heap must plateau');
    console.log('PASS: five-minute 200 events/sec inspector stress; memory plateau and rendering caps');
  }

  await send('Page.navigate', { url: 'http://127.0.0.1:5173/?demo=1&rate=40' });
  for (let i = 0; i < 100; i++) { if (await evaluate('!!document.querySelector("#expand-log")')) break; await delay(100); }
  await click('#expand-log'); await tick();
  await check('document.querySelector("#log-inspector").open', 'real app opens inspector');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
  await check('!document.querySelector("#log-inspector").open && document.querySelector("#settings").style.display !== "none"', 'F1 closes inspector before settings');
  await evaluate('document.querySelector("#expand-log").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await check('document.querySelector("#log-inspector").open && document.querySelector("#settings").style.display === "none"', 'L opens inspector and hides settings');
  await check(`(() => {document.querySelector('[data-command="clear"]').click();return document.querySelector('#terminal-body').children.length===0;})()`, 'clear also releases compact log rows');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
  await click('#expand-log');
  await check('document.querySelector("#log-inspector").open && document.querySelector("#settings").style.display === "none"', 'Expand also hides settings');
  console.log('PASS: application integration and F1/L shortcuts');
} finally {
  chrome.kill();
  await delay(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
