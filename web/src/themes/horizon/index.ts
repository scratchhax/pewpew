import meta from './meta';
import { Vector3 } from 'three';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { HORIZON_BUDGETS, HORIZON_CONTROLS, HORIZON_DEFAULTS, HORIZON_HUD } from './settings';
import { View, type ViewBudgets } from './view';
import { Bodies, type Moon } from './bodies';
import { Orbits, Labels } from './overlay';
import { bbColor } from './blackbody';
import { MAX_GLOW, MAX_SPH } from './tracer';
import { horizonScore } from './score';
import './hud.css';

/**
 * Event Horizon: a black hole, ray traced. Every pixel follows a real
 * Schwarzschild light path, so the accretion disk wraps over and under the
 * shadow, the photon ring hugs it, and the stars behind smear into arcs.
 *
 * Your network feeds it. Allowed traffic heats the disk in hot spots that
 * shear into arcs as they orbit (and sends knots up the jets); blocked
 * hosts fall in from the dark, reddening and slowing as time stretches at
 * the horizon; an IDS threat is a star on a doomed orbit, torn into a
 * stream that wraps the hole and floods the disk with light; DNS lookups are
 * light circling the photon ring; DHCP leases are moons with your devices'
 * names; Wi-Fi joins send a gravitational-wave ripple across the disk; and
 * traffic weather is how hard the hole is feeding.
 */
export const horizon: Theme<typeof HORIZON_DEFAULTS> = {
  id: 'horizon',
  title: meta.title,
  hud: HORIZON_HUD,
  accentHue: meta.accentHue,
  defaults: HORIZON_DEFAULTS,
  budgets: HORIZON_BUDGETS,
  controls: HORIZON_CONTROLS,
  score: horizonScore,
  create,
};
export default horizon;

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const bell = (t: number) => { const s = Math.sin(Math.PI * Math.max(0, Math.min(1, t))); return s * s; };
const DEG = Math.PI / 180;

async function create(host: ThemeHost<typeof HORIZON_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const budgets = (): ViewBudgets => ({
    traceRes: settings.ehTraceRes, steps: settings.ehSteps, diskRes: settings.ehDiskRes, octaves: settings.ehDetail,
    haze: settings.ehHaze, jets: settings.ehJets, bloom: settings.ehBloom, streak: settings.ehStreak,
  });
  const view = new View(host.mount, init.antialias, init.powerPref === 'default' ? undefined : init.powerPref, init.resolution, budgets());
  const bodies = new Bodies();
  const orbits = new Orbits(view.overlay);
  const labels = new Labels();
  const cam = view.camera;

  // a few nameless moons so the sky is never empty; named devices take their places
  for (let i = 0; i < 3; i++) bodies.moon(`~${Math.random().toString(36).slice(2, 8)}`, false, true);

  function applyBudgets(): void {
    view.applyBudgets(budgets());
    const sph = Math.min(MAX_SPH, Math.ceil(settings.ehBodies * 0.5));
    bodies.maxSph = sph;
    bodies.maxGlows = Math.min(MAX_GLOW, Math.max(1, settings.ehBodies - sph));
    bodies.setMaxMoons(Math.min(settings.ehMoonMax, sph));
    labels.enabled = settings.ehLabels;
    orbits.enabled = settings.ehOrbits;
  }
  applyBudgets();

  // camera basis for spawning things into view
  const right = new Vector3(), up = new Vector3(), fwd = new Vector3();
  function basis(): void {
    cam.updateMatrixWorld();
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    fwd.setFromMatrixColumn(cam.matrixWorld, 2).multiplyScalar(-1);
  }
  const projected = new Vector3();
  const panAt = (p: Vector3) => { projected.copy(p).project(cam); return Math.max(-0.9, Math.min(0.9, projected.x * 0.8)); };

  const moonLabels = new Map<Moon, ReturnType<Labels['add']>>();
  // null means gone for good (the label is dropped), so only return it once the moon starts to leave
  const moonAnchor = (m: Moon) => () => (bodies.moons.includes(m) && m.leaving < 0 ? m.pos : null);
  /** A moon keeps its name for as long as it orbits: bright after a lease, then quiet. */
  function labelMoon(m: Moon, sub: string | null | undefined, loudMs: number): void {
    if (!m.labelled) return;
    const have = moonLabels.get(m) ?? null;
    if (labels.isLive(have)) { labels.wake(have, loudMs); return; }
    const l = labels.add('moon', m.name, sub, moonAnchor(m), Infinity, 0, loudMs);
    if (l) moonLabels.set(m, l);
  }

  // allowed traffic gathers into hot spots, released every second or so per direction
  const pending = { out: 0, in: 0, outAt: 0, inAt: 0, outKey: '', inKey: '' };
  let releases = 0;
  function releaseHotspots(now: number): void {
    for (const dir of ['out', 'in'] as const) {
      const n = pending[dir];
      if (n <= 0) continue;
      if (n >= 4 || now - pending[`${dir}At`] > 1400) {
        bodies.hotspot(pending[`${dir}Key`] || String(Math.random()), dir === 'out', Math.min(1.7, 0.7 + n * 0.09));
        if (++releases % 3 === 0 && settings.ehJets) bodies.knot(dir === 'out', Math.min(1.6, 0.6 + n * 0.05));
        pending[dir] = 0;
        pending[`${dir}Key`] = '';
      }
    }
  }

  // gravitational-wave ripples across the disk (wifi)
  const ripples: Array<{ age: number; amp: number; life: number; phase: number }> = [];
  // system-log dimming
  let dimTarget = 1, dimHoldUntil = 0, nextDimAt = 0;
  const sysTimes: number[] = [];
  const bootAt = performance.now();
  let tdeQueued: string | null = null;

  function startTde(label: string): void {
    const e = bodies.tdeStart(label, cam.position);
    if (!e) { tdeQueued = label; return; }
    labels.add('threat', label.split(' · ')[0], label.split(' · ')[1] ?? 'tidal disruption', () => (bodies.tde === e && e.phase === 'approach' ? e.pos : null), 40000, 18);
    audio.sfx('approach', { pan: panAt(e.pos) });
  }
  bodies.onShred = () => {
    const e = bodies.tde;
    audio.sfx('shred');
    if (e) {
      const at = e.peri.clone();
      const until = performance.now() + 9000;
      labels.add('threat', 'Tidal disruption', e.label.split(' · ')[0], () => (performance.now() < until ? at : null), 9000, 26);
    }
  };

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    const now = performance.now();
    if (replay) {
      // backfill: devices that leased recently are already in orbit
      if (se.kind === 'dhcp' && settings.ehMoons && ev.hostname) labelMoon(bodies.moon(ev.hostname, true), null, 0);
      return;
    }
    switch (se.kind) {
      case 'allow': {
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        if (!settings.ehHotspots || !throttle.allow(`eh|alw|${ev.src_ip}|${ev.dst_ip}`, 1)) break;
        const dir = se.scope === 'inbound' ? 'in' : 'out';
        if (pending[dir] === 0) pending[`${dir}At`] = now;
        pending[dir] += 1;
        if (!pending[`${dir}Key`]) pending[`${dir}Key`] = `${ev.src_ip}|${ev.dst_ip}`;
        break;
      }
      case 'block': {
        audio.cueSong('block', ev.src_ip ?? undefined);
        if (!settings.ehInfall || !ev.src_ip || !throttle.allow(`eh|blk|${ev.src_ip}`, 8) || !throttle.allow('eh|blk', 1.6)) break;
        basis();
        const f = bodies.infall(ev.src_ip, cam.position, right, up);
        if (!f) break;
        const sub = [ev.dst_port ? `:${ev.dst_port}` : '', ev.protocol ?? ''].filter(Boolean).join(' ').toLowerCase() || 'blocked';
        labels.add('infall', ev.src_ip, sub, () => (bodies.infallers.includes(f) && (f.t < 3 || f.glow > 0.08) ? f.pos : null), 20000, 14);
        audio.sfx('infall', { pan: panAt(f.pos) });
        break;
      }
      case 'threat': {
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!settings.ehShred) break;
        const label = `${ev.src_ip ?? ev.dst_ip ?? 'unknown'}${ev.rule_desc ? ` · ${ev.rule_desc.slice(0, 48)}` : ''}`;
        if (!bodies.tdeActive) startTde(label);
        else tdeQueued = label;
        break;
      }
      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!settings.ehGlints || !ev.dns_query || !throttle.allow(`eh|dns|${ev.dns_query}`, 6) || !throttle.allow('eh|glint', 0.9)) break;
        const g = bodies.glint(ev.dns_query, cam.position);
        if (!g) break;
        // the label sits just outside the ring where the light first appears, not chasing it round
        basis();
        const at = right.clone().multiplyScalar(Math.cos(g.ang)).addScaledVector(up, Math.sin(g.ang)).normalize().multiplyScalar(3.6);
        labels.add('dns', ev.dns_query.length > 42 ? `…${ev.dns_query.slice(-41)}` : ev.dns_query, ev.dns_blocked ? 'blocked lookup' : null, () => (bodies.glints.includes(g) ? at : null), 4200, 0);
        audio.sfx('glint', { pan: panAt(at) });
        break;
      }
      case 'dhcp': {
        if (!settings.ehMoons || !throttle.allow(`eh|dhcp|${ev.syslog_host}|${ev.hostname}|${ev.mac_address}`, 5)) break;
        audio.cueSong('dhcp');
        const name = ev.hostname || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? null);
        if (!name) break;
        const fresh = !bodies.moons.some((m) => m.name === name && m.leaving < 0);
        const m = bodies.moon(name, true);
        labelMoon(m, ev.src_ip ?? ev.mac_address ?? null, fresh ? 16000 : 9000);
        if (fresh) audio.sfx('capture', { pan: panAt(m.pos) });
        break;
      }
      case 'wifi': {
        if (!settings.ehRipples || se.wifi === 'other' || !throttle.allow(`eh|wifi|${ev.syslog_host}|${ev.wifi_event}`, 4) || ripples.length >= 4) break;
        audio.cueSong('wifi');
        const joined = se.wifi === 'joined';
        ripples.push({ age: 0, amp: joined ? 1 : 0.5, life: 7, phase: Math.random() * 6.28 });
        audio.sfx('ripple', { variant: joined ? 'joined' : 'bad' });
        break;
      }
      case 'system': {
        sysTimes.push(now);
        while (sysTimes.length && now - sysTimes[0] > 300000) sysTimes.shift();
        if (throttle.allow(`eh|sys|${ev.syslog_host}`, 6)) audio.cueSong('system');
        let recent = 0;
        for (let i = sysTimes.length - 1; i >= 0 && now - sysTimes[i] < 20000; i--) recent++;
        const usual = (sysTimes.length - recent) / Math.max(1, Math.min(14, (now - bootAt - 20000) / 20000));
        if (!settings.ehDimming || now < nextDimAt || now - bootAt < 60000 || recent < Math.max(6, usual * 3)) break;
        nextDimAt = now + 120000;
        dimTarget = 0.55; dimHoldUntil = now + 3000;
        audio.sfx('dim');
        break;
      }
    }
  }

  // ── frame ──
  /** Look constants, kept in one place (and live-tunable from ?diag). */
  const tune = { diskGain: 1.5, haze: 0.04, jet: 0.06, bloom: 0.06, streak: 0.05, exposure: 1.0, moonLight: 1, sky: 2.2 };
  let churn = 0.2, accretion = 0.9, dim = 1, time = 0, camT = 0, push = 0;
  let camFix: number[] | null = null;
  const target = new Vector3();
  const swallowed = { n: 0 };
  bodies.onSwallow = () => { swallowed.n++; };

  let frozen = false;   // ?diag: hold the simulation still and step it by hand
  function advance(seconds: number, step = 1 / 30): void {
    for (let t = 0; t < seconds; t += step) {
      time += step;
      for (const r of ripples) r.age += step;
      bodies.update(step, view.disk);
      view.disk.update(view.renderer, step, { time, accretion, churn, feed: bodies.feed, temp: settings.ehTemp, dim });
    }
  }

  function frame(f: FrameInfo): void {
    const dt = frozen ? 0 : Math.min(f.dt, 0.05), dtReal = f.dtReal;
    const now = performance.now();
    time += dt;

    const w = state.weather;
    churn += ((w === 'hurricane' ? 1 : w === 'storm' ? 0.6 : 0.22) - churn) * Math.min(1, dtReal * 0.15);
    accretion += ((0.7 + 0.45 * state.energy + 0.25 * churn) - accretion) * Math.min(1, dtReal * 0.2);
    if (now > dimHoldUntil) dimTarget = 1;
    dim += (dimTarget - dim) * Math.min(1, dtReal * (dimTarget < dim ? 1.2 : 0.4));

    releaseHotspots(now);
    if (!bodies.tdeActive && tdeQueued && settings.ehShred) { const l = tdeQueued; tdeQueued = null; startTde(l); }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += dt;
      if (r.age > r.life) ripples.splice(i, 1);
    }
    view.disk.ripples.forEach((v, i) => {
      const r = ripples[i];
      if (r) v.set(2.6 + r.age * 2.3, r.amp * bell(r.age / r.life), 0.75 + r.age * 0.12, r.phase);
      else v.set(0, 0, 1, 0);
    });

    bodies.update(dt, view.disk);
    view.disk.update(view.renderer, dt, {
      time, accretion, churn, feed: bodies.feed, temp: settings.ehTemp, dim,
    });
    bodies.pack(view.u, time);

    // light
    const u = view.u;
    const beaming = settings.ehBeaming;
    u.uTime.value = time;
    u.uBeam.value = 3.2 * beaming;
    u.uShift.value = beaming;
    u.uDiskGain.value = tune.diskGain;
    u.uHaze.value = tune.haze * accretion * (1 + bodies.feed * 0.8) * dim;
    u.uJet.value = settings.ehJetGain * (0.3 + 0.8 * state.energy + 0.25 * bodies.feed) * tune.jet;
    const hc = bbColor(5600 * settings.ehTemp);
    u.uHazeCol.value.setRGB(hc[0], hc[1], hc[2]);
    const jc = bbColor(26000);
    u.uJetCol.value.setRGB(jc[0] * 0.8, jc[1] * 0.85, jc[2]);
    const lc = bbColor(6800 * settings.ehTemp * (1 + bodies.feed * 0.15));
    u.uLightCol.value.setRGB(lc[0], lc[1], lc[2]);
    u.uDiskLight.value = tune.moonLight * accretion * dim * (1 + bodies.feed * 0.35);
    u.uStarGain.value = 1;
    u.uSkyGain.value = tune.sky;

    const pc = view.post.composite.uniforms;
    pc.uExposure.value = tune.exposure * settings.ehExposure;
    pc.uBloomGain.value = settings.ehBloom ? tune.bloom : 0;
    pc.uStreakGain.value = settings.ehStreak ? tune.streak : 0;

    // camera: a slow orbit, a little above the disk, now and then rising for the overhead view
    if (settings.ehCamera) camT += dtReal;
    const az = 0.6 + camT * ((Math.PI * 2) / 520);
    const rise = smooth((Math.sin(camT * ((Math.PI * 2) / 390) - 0.3) / 0.7));
    const elev = (7 + 4 * Math.sin(camT * ((Math.PI * 2) / 113)) + 15 * rise) * DEG;
    push += ((bodies.tdeActive ? 1 : 0) - push) * Math.min(1, dtReal * 0.25);   // ease in over several seconds
    const dist = 30 + 4.5 * Math.sin(camT * ((Math.PI * 2) / 157) + 1) - 3 * smooth(push);
    cam.position.set(Math.cos(elev) * Math.cos(az) * dist, Math.sin(elev) * dist, Math.cos(elev) * Math.sin(az) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    basis();
    const sway = Math.sin(camT * ((Math.PI * 2) / 233)) * 1.8;
    target.set(0, 0, 0).addScaledVector(right, sway + f.wanderX * 0.004).addScaledVector(up, 0.25 - f.wanderY * 0.004);
    if (camFix) { cam.position.set(camFix[0], camFix[1], camFix[2]); target.set(camFix[3] ?? 0, camFix[4] ?? 0, camFix[5] ?? 0); }
    cam.lookAt(target);

    orbits.update(bodies.moons, dtReal);
    view.render();
    labels.update(cam, window.innerWidth, window.innerHeight);
    audio.setThreatActive(bodies.tdeActive);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { view.setPixelRatio(scale); },
    resize(width, height) { view.resize(width, height); },
    destroy() { orbits.dispose(); labels.dispose(); view.dispose(); },
    stats: () => {
      const [tw, th] = view.traceSize;
      return { trace: `${tw}×${th}`, steps: settings.ehSteps, splats: view.disk.splats, ...bodies.counts(), swallowed: swallowed.n };
    },
    diag: () => ({
      view, bodies, labels, orbits, settings, state, audio, camera: cam, renderer: view.renderer, tune,
      cam: (...v: number[]) => { camFix = v.length ? v : null; },
      freeze: (on = true) => { frozen = on; },
      advance,
      threat: (label = '203.0.113.9 · ET EXPLOIT test') => startTde(label),
      fall: (ip = '198.51.100.7') => { basis(); return bodies.infall(ip, cam.position, right, up); },
      glint: (q = 'example.com') => bodies.glint(q, cam.position),
      ripple: () => ripples.push({ age: 0, amp: 1, life: 7, phase: Math.random() * 6.28 }),
    }),
  };
}
