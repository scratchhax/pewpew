import { Color, Vector3 } from 'three';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { isInternalIp } from '../../state';
import { AQUARIUM_BUDGETS, AQUARIUM_CONTROLS, AQUARIUM_DEFAULTS, AQUARIUM_HUD } from './settings';
import { createWorld } from './world';
import { W } from './water';
import { Reef } from './reef';
import { Life, type Fish } from './fish';
import { Bubbles } from './bubbles';
import { scaleNormals } from './skins';
import { aquariumScore } from './score';
import './hud.css';

/**
 * Aquarium: a reef tank in the spirit of the old marine aquarium screensavers,
 * in real 3D. Allowed traffic swims across as schools of chromis, blocked
 * traffic sends in a pufferfish that swells up at the intruder, an IDS threat
 * brings a reef shark through (and everything small scatters), DNS lookups rise
 * from the air stone as bubbles, DHCP leases add a resident fish with the
 * device's name, Wi-Fi joins open the treasure chest (failures slam it shut),
 * system events dim the tank light, and traffic weather stirs the water up.
 * Rendered with three.js.
 */
export const aquarium: Theme<typeof AQUARIUM_DEFAULTS> = {
  id: 'aquarium',
  title: 'AQUARIUM',
  hud: AQUARIUM_HUD,
  accentHue: 192,
  defaults: AQUARIUM_DEFAULTS,
  budgets: AQUARIUM_BUDGETS,
  controls: AQUARIUM_CONTROLS,
  score: aquariumScore,
  create,
};
export default aquarium;

interface Label { el: HTMLDivElement; at: () => Vector3 | null; until: number; lift: number; shown: boolean; }

async function create(host: ThemeHost<typeof AQUARIUM_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const world = createWorld(host.mount, init.antialias, init.powerPref === 'default' ? undefined : init.powerPref, init.resolution, settings.qSmooth);
  const overlay = document.createElement('div');
  overlay.id = 'aq-overlay';
  document.body.appendChild(overlay);

  const reef = new Reef(world.scene);
  const life = new Life(world.scene, scaleNormals());
  life.ground = (x, z) => reef.ground(x, z);
  life.anemone.copy(reef.anemone);
  const bubbles = new Bubbles(world.scene);
  const panFor = (x: number) => Math.max(-0.9, Math.min(0.9, (x - world.camera.position.x) / 60));
  life.onSfx = (name, x) => audio.sfx(name, { pan: panFor(x) });
  let popGate = 0;
  bubbles.onPop = (x) => { const now = performance.now(); if (now > popGate) { popGate = now + 120; audio.sfx('pop', { pan: panFor(x) }); } };

  function applyBudgets(): void {
    life.maxFish = settings.qMaxFish;
    life.maxResidents = settings.qResidentMax;
    world.setShadows(settings.qShadows);
    world.setSpecks(settings.qSpecks);
    W.uCaustic.value = settings.qCaustics ? 1.4 : 0;
    W.uSunBase.value = settings.qCaustics ? 0.55 : 0.85;
  }
  applyBudgets();
  window.addEventListener('resize', () => world.resize(window.innerWidth, window.innerHeight));

  // ── labels: names and addresses that follow a fish or a bubble ──
  const labels: Label[] = [];
  function label(text: string | null | undefined, color: string, at: () => Vector3 | null, ms: number, lift: number): Label | null {
    if (!settings.qLabels || !text) return null;
    if (labels.length > 24) { const old = labels.shift()!; old.el.remove(); }
    const el = document.createElement('div');
    el.className = 'aq-label';
    el.textContent = text;
    el.style.color = color;
    overlay.appendChild(el);
    const l = { el, at, until: performance.now() + ms, lift, shown: false };
    labels.push(l);
    return l;
  }
  let chestLabel: Label | null = null;
  const followFish = (f: Fish) => () => (life.fish.includes(f) ? f.pos : null);
  const proj = new Vector3();
  function updateLabels(): void {
    const now = performance.now(), w = window.innerWidth, h = window.innerHeight;
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i];
      const p = l.at();
      const expired = !p || now > l.until;
      if (p) {
        proj.copy(p); proj.y += l.lift;
        proj.project(world.camera);
        const onScreen = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
        if (onScreen) l.el.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) translate(-50%, -100%)`;
        const want = onScreen && !expired;
        if (want !== l.shown) { l.shown = want; l.el.classList.toggle('on', want); }
      } else if (l.shown) { l.shown = false; l.el.classList.remove('on'); }
      // gone for good once faded out
      if (expired && !l.shown && now > l.until + 1200) { l.el.remove(); labels.splice(i, 1); }
      else if (expired && now > l.until + 1200 && !p) { l.el.remove(); labels.splice(i, 1); }
    }
  }

  const routable = (ip?: string | null): ip is string => !!ip && !isInternalIp(ip) && !/^(0\.|127\.|169\.254\.|22[4-9]\.|2[3-5]\d\.|ff|fe8)/i.test(ip);

  // allowed traffic gathers into schools: a few flows per fish, released every few seconds per direction
  const pending = { out: 0, in: 0, outAt: 0, inAt: 0, outLabel: '', inLabel: '' };
  function releaseSchools(now: number): void {
    for (const dir of ['out', 'in'] as const) {
      const n = pending[dir];
      const at = pending[`${dir}At`];
      if (n <= 0) continue;
      if (n >= 10 || now - at > 4000) {
        const size = Math.max(3, Math.min(16, Math.round(n)));
        const f = life.school(size, dir === 'out');
        if (f) label(pending[`${dir}Label`], '#b8ffd8', followFish(f), 6000, f.def.length * 1.2);
        pending[dir] = 0;
        pending[`${dir}Label`] = '';
      }
    }
  }

  let dimTarget = 1, dimHoldUntil = 0, nextDimAt = 0;
  const sysTimes: number[] = [];
  const bootAt = performance.now();
  let sharkQueued = false, sharkLabel = '';
  function event(se: SceneEvent, replay: boolean): void {
    if (replay) return;
    const ev = se.ev;
    const now = performance.now();
    switch (se.kind) {
      case 'allow': {
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        if (!settings.qSchools || !throttle.allow(`alw|${ev.src_ip}|${ev.dst_ip}`, 0.5)) break;
        const dir = se.scope === 'inbound' ? 'in' : 'out';
        if (pending[dir] === 0) pending[`${dir}At`] = now;
        pending[dir] += 0.5;
        const ext = routable(ev.dst_ip) ? ev.dst_ip : routable(ev.src_ip) ? ev.src_ip : null;
        if (ext && !pending[`${dir}Label`]) pending[`${dir}Label`] = ext;
        break;
      }
      case 'block': {
        audio.cueSong('block', ev.src_ip ?? undefined);
        if (!settings.qPuffers || !throttle.allow(`blk|${ev.src_ip}`, 6) || !throttle.allow('blk|puffer', 2.5)) break;
        const f = life.puffer();
        if (f) label(ev.src_ip, '#ffb0a0', followFish(f), 16000, f.def.length * 1.3);
        break;
      }
      case 'threat': {
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!settings.qSharks) break;
        if (!life.sharkAlive) {
          const f = life.shark();
          if (f) label(`${ev.src_ip ?? ''}${ev.rule_desc ? ` · ${ev.rule_desc.slice(0, 40)}` : ''}`, '#ffc080', followFish(f), 30000, 3);
        } else { sharkQueued = true; sharkLabel = ev.src_ip ?? ''; }
        break;
      }
      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!settings.qBubbles || !ev.dns_query || !throttle.allow(`dns|${ev.dns_query}`, 5) || !throttle.allow('dns|bubble', 0.7)) break;
        const tint = new Color(0.55, 0.8, 1);
        const id = bubbles.emit(reef.bubbler, 0.55, tint, 0.2);
        for (let k = 0; k < 6; k++) setTimeout(() => bubbles.emit(reef.bubbler, 0.15 + Math.random() * 0.2, tint, 0.5), k * 90);
        if (id) label(ev.dns_query, '#9fdcff', () => bubbles.position(id), 9000, 1.2);
        audio.sfx('bubble', { pan: panFor(reef.bubbler.x) });
        break;
      }
      case 'dhcp': {
        if (!settings.qResidents || !throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        audio.cueSong('dhcp');
        const name = ev.hostname || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? 'device');
        const f = life.resident();
        if (f) label(name, '#ffe488', followFish(f), 14000, f.def.length * 0.9);
        break;
      }
      case 'wifi': {
        if (!settings.qChest || se.wifi === 'other' || !throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        audio.cueSong('wifi');
        const joined = se.wifi === 'joined';
        reef.chest(joined, now);
        if (joined) {
          const tint = new Color(0.85, 0.6, 1);
          for (let k = 0; k < 18; k++) setTimeout(() => bubbles.emit(reef.chestMouth, 0.12 + Math.random() * 0.3, tint, 3), 500 + k * 70);
          if (chestLabel) chestLabel.until = 0;
          chestLabel = label(ev.hostname ?? ev.syslog_host, '#d8b0ff', () => reef.chestMouth, 5000, 3.5);
        }
        audio.sfx(joined ? 'chest-open' : 'chest-slam', { pan: panFor(reef.chestMouth.x) });
        break;
      }
      case 'system': {
        // gateways and APs log system lines all the time, so one line means nothing:
        // only a burst well above this network's usual rate (a reboot, a re-provision)
        // dims the light, and at most every couple of minutes
        sysTimes.push(now);
        while (sysTimes.length && now - sysTimes[0] > 300000) sysTimes.shift();
        if (throttle.allow(`sys|${ev.syslog_host}`, 6)) audio.cueSong('system');
        let recent = 0;
        for (let i = sysTimes.length - 1; i >= 0 && now - sysTimes[i] < 20000; i--) recent++;
        const usual = (sysTimes.length - recent) / Math.max(1, Math.min(14, (now - bootAt - 20000) / 20000));
        if (!settings.qDimming || now < nextDimAt || now - bootAt < 60000 || recent < Math.max(6, usual * 3)) break;
        nextDimAt = now + 120000;
        dimTarget = 0.6; dimHoldUntil = now + 2500;
        audio.sfx('dim');
        break;
      }
    }
  }

  // ── frame ──
  let rough = 0, light = 1, warm = 0, camT = Math.random() * 1000, ambientBubble = 0;
  const lookAt = new Vector3();
  let camFix: number[] | null = null;
  function frame(f: FrameInfo): void {
    const { dt, dtReal } = f;
    const now = performance.now();
    const w = state.weather;
    rough += ((w === 'hurricane' ? 1 : w === 'storm' ? 0.45 : 0) - rough) * Math.min(1, dtReal * 0.2);
    if (now > dimHoldUntil) dimTarget = 1;
    light += (dimTarget - light) * Math.min(1, dtReal * (dimTarget < light ? 1.8 : 0.6));
    const sharkNow = life.sharkAlive;
    warm += ((sharkNow ? 1 : 0) - warm) * Math.min(1, dtReal * 0.5);
    if (!sharkNow && sharkQueued && settings.qSharks) {
      sharkQueued = false;
      const s = life.shark();
      if (s) label(sharkLabel, '#ffc080', followFish(s), 30000, 3);
    }

    const current = (0.25 + rough * 1.1) * settings.qCurrent;
    W.uTime.value += dtReal;
    W.uCurrent.value = current;
    W.uLight.value = light;
    W.uWarm.value = warm;
    W.uMurk.value = 0.0085 + rough * 0.0035;
    world.sun.intensity = 2.6 * light * (1 - rough * 0.25);
    world.hemi.intensity = 1.2 * (0.4 + 0.6 * light);
    world.rim.intensity = warm * 1.6 * light;
    world.lens.uniforms.uTime.value += dtReal;

    life.speedScale = 1 + rough * 0.5;
    life.current = current;
    releaseSchools(now);
    life.update(Math.min(dt, 0.05));
    reef.update(dtReal, now);

    // the air stone never stops; the chest breathes bubbles while it's open
    ambientBubble -= dtReal * (5 + rough * 6);
    while (ambientBubble < 0) { ambientBubble += 1; bubbles.emit(reef.bubbler, 0.08 + Math.random() * 0.18, undefined, 0.25); }
    if (reef.lidOpen > 0.5 && Math.random() < dtReal * 6) bubbles.emit(reef.chestMouth, 0.1 + Math.random() * 0.2, new Color(1, 0.85, 0.6), 3);
    bubbles.update(dtReal, current, W.uSurfaceY.value);

    // camera: a slow drift around the reef, barely noticeable moment to moment
    if (settings.qCamera) camT += dtReal;
    const cam = world.camera;
    cam.position.set(Math.sin(camT * 0.021) * 12 + f.wanderX * 0.02, 17 + Math.sin(camT * 0.033) * 2.5 - f.wanderY * 0.02, 64 + Math.sin(camT * 0.017) * 6);
    lookAt.set(Math.sin(camT * 0.021 + 0.9) * 7, 15 + Math.sin(camT * 0.027) * 1.5, -12);
    if (camFix) { cam.position.set(camFix[0], camFix[1], camFix[2]); lookAt.set(camFix[3], camFix[4], camFix[5]); }
    cam.lookAt(lookAt);
    world.update(dtReal, { x: current * 1.2, y: 0.15, z: 0 });
    updateLabels();
    audio.setThreatActive(sharkNow);
    world.render(settings.qBloom);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { world.setPixelRatio(scale); },
    stats: () => ({ calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles, fish: life.fish.length, bubbles: bubbles.count, ...life.counts }),
    diag: () => ({ renderer: world.renderer, scene: world.scene, camera: world.camera, world, reef, life, bubbles, W, audio, cam: (...v: number[]) => { camFix = v.length ? v : null; } }),
  };
}
