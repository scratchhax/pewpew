import { Vector3 } from 'three';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { isInternalIp } from '../../state';
import type { NetEvent } from '../../types';
import { Groove } from '../../sound/groove';
import { SPY_BUDGETS, SPY_CONTROLS, SPY_DEFAULTS, SPY_HUD } from './settings';
import { createWorld } from './world';
import { Planet } from './planet';
import { Orbit, COL } from './orbit';
import { Eye, type EyeTarget } from './eye';
import type { ViewMode } from './site';
import { districtName, hashStr } from './geo';
import { spyScore } from './score';
import './hud.css';

/**
 * Panopticon: your network as a planet under watch. Not Earth: a generated,
 * Earth-like world with its own nations and cities, where every outside IP
 * has a home. Allowed traffic runs as green arcs between your ground station
 * and the world, blocks are red arcs cut off mid-flight, IDS threats put a
 * tracking marker on the attacker, DNS lookups are uplink beams, your devices
 * orbit as satellites (APs too), system events ripple through the atmosphere,
 * and traffic weather is the DEFCON level.
 *
 * Now and then (a burst of threats, a persistent offender, or just a random
 * sweep) the eye of god tasks a target: the camera dives through the clouds,
 * enhances, and catches someone doing something they shouldn't, then pulls
 * back out to orbit. Rendered with three.js.
 */
export const spy: Theme<typeof SPY_DEFAULTS> = {
  id: 'spy',
  title: 'PANOPTICON',
  hud: SPY_HUD,
  accentHue: 44,
  defaults: SPY_DEFAULTS,
  budgets: SPY_BUDGETS,
  controls: SPY_CONTROLS,
  score: spyScore,
  create,
};
export default spy;

interface Intel {
  ip: string;
  first: number;
  hits: number[];
  blocks: number[];
  threats: number;
  signal: string;
  klass: string;
}

const D_ORBIT = 360;

async function create(host: ThemeHost<typeof SPY_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const world = createWorld(host.mount, init.antialias,
    init.powerPref === 'default' ? undefined : init.powerPref, init.resolution, settings.oShadows);
  const overlay = document.createElement('div');
  overlay.id = 'spy-overlay';
  document.body.appendChild(overlay);

  const planet = new Planet(world.renderer, world.scene, 7);
  let res = settings.oPlanetRes;
  await planet.build(res, settings.oStars);
  const geo = planet.geo;
  const orbit = new Orbit(world.scene, planet, overlay);
  const eye = new Eye(world, planet, overlay, audio);
  const groove = new Groove();

  let starDensity = settings.oStars;
  let rebuilding = false;
  function applyBudgets(): void {
    orbit.maxArcs = settings.oMaxArcs;
    orbit.maxSats = settings.oMaxSats;
    eye.shadows = settings.oShadows;
    if (Math.abs(starDensity - settings.oStars) > 0.01) { starDensity = settings.oStars; planet.setStars(starDensity); }
    if (settings.oPlanetRes !== res && !rebuilding) {
      res = settings.oPlanetRes;
      rebuilding = true;
      void planet.build(res, starDensity).finally(() => { rebuilding = false; });
    }
  }
  applyBudgets();
  window.addEventListener('resize', () => world.resize(window.innerWidth, window.innerHeight));

  // ── intelligence: who is doing what, for the eye's triggers and dossier ──
  const intel = new Map<string, Intel>();
  const threatTimes: Array<{ at: number; ip: string }> = [];
  const note = (ip: string, kind: 'allow' | 'block' | 'threat', ev: NetEvent) => {
    const now = Date.now();
    let it = intel.get(ip);
    if (!it) {
      if (intel.size > 3000) for (const [k, v] of intel) if (now - (v.hits[v.hits.length - 1] ?? 0) > 300000) intel.delete(k);
      it = { ip, first: now, hits: [], blocks: [], threats: 0, signal: '', klass: '' };
      intel.set(ip, it);
    }
    it.hits.push(now);
    if (it.hits.length > 400) it.hits.splice(0, 200);
    const proto = (ev.protocol ?? '').toUpperCase();
    it.signal = `${proto || 'IP'}${ev.dst_port ? ` ${ev.dst_port}` : ''} → ${ev.dst_ip ?? '?'}${ev.service_name ? ` (${ev.service_name})` : ''}`;
    const rule = ev.rule_desc || ev.rule_name || 'traffic';
    if (kind === 'threat') { it.threats++; it.klass = `IDS · ${rule}`.slice(0, 60); threatTimes.push({ at: now, ip }); }
    else if (kind === 'block') { it.blocks.push(now); if (it.blocks.length > 200) it.blocks.splice(0, 100); if (!it.threats) it.klass = `INTERDICTED · ${rule}`.slice(0, 60); }
    else if (!it.klass) it.klass = `MONITORED · ${rule}`.slice(0, 60);
  };
  const external = (ev: NetEvent): string | null =>
    ev.src_ip && !isInternalIp(ev.src_ip) ? ev.src_ip : ev.dst_ip && !isInternalIp(ev.dst_ip) ? ev.dst_ip : null;

  const home = geo.home;
  const ground = () => new Vector3();

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    const ext = external(ev);
    if (ext && (se.kind === 'allow' || se.kind === 'block' || se.kind === 'threat')) note(ext, se.kind, ev);
    if (replay) return;
    switch (se.kind) {
      case 'allow': {
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        if (!settings.oArcs) break;
        if (!ext) {
          if (throttle.allow('alw|lan', 1.2)) orbit.ping(home, COL.allow, 1.8, 1);
          break;
        }
        if (!throttle.allow(`alw|${ext}`, 1.6)) break;
        const city = geo.locate(ext);
        if (ext === ev.src_ip) orbit.arc(city, home, COL.allow);
        else orbit.arc(home, city, COL.allow);
        break;
      }
      case 'block': {
        audio.cueSong('block', ev.src_ip ?? undefined);
        if (!settings.oArcs || !ext || !throttle.allow(`blk|${ext}|${ev.dst_port}`, 2.5)) break;
        const city = geo.locate(ext);
        if (ext === ev.src_ip) orbit.arc(city, home, COL.block, 0.62);
        else orbit.arc(home, city, COL.block, 0.4);
        break;
      }
      case 'threat': {
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!ext) break;
        const city = geo.locate(ext);
        if (settings.oTargets && throttle.allow(`thr|${ext}`, 2)) {
          orbit.track(ext, city, `TRACK ${ext} · ${city.name.toUpperCase()}`);
          orbit.arc(city, home, COL.threat);
          orbit.ping(city, COL.threat, 5, 2.4);
        }
        break;
      }
      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!settings.oUplinks || !throttle.allow(`dns|${ev.dns_query ?? ''}`, 4) || !throttle.allow('dns|beam', 0.35)) break;
        const sat = orbit.nearestSat();
        if (sat) orbit.beam(sat, null, COL.dns, ground());
        else orbit.ping(home, COL.dns, 2.4, 1.2);
        break;
      }
      case 'dhcp': {
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        audio.cueSong('dhcp');
        if (!settings.oSatellites) break;
        const name = ev.hostname || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? 'device');
        const existed = orbit.sats.has(name);
        const sat = orbit.satellite(name, 'device');
        if (!existed) orbit.launch(sat);
        else orbit.beam(sat, null, COL.dhcp, ground(), false, 1);
        break;
      }
      case 'wifi': {
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        audio.cueSong('wifi');
        if (!settings.oSatellites || !ev.syslog_host || se.wifi === 'other') break;
        const sat = orbit.satellite(ev.syslog_host, 'ap');
        orbit.beam(sat, null, se.wifi === 'joined' ? COL.wifi : COL.block, ground(), se.wifi === 'bad', se.wifi === 'bad' ? 1.6 : 1.2);
        break;
      }
      case 'system': {
        if (!throttle.allow(`sys|${ev.syslog_host}`, 6)) break;
        audio.cueSong('system');
        if (settings.oRipples) planet.rippleFrom(home.lat, home.lon);
        break;
      }
    }
  }

  // ── the eye's taskings ──
  const bootAt = Date.now();
  let cooldownUntil = bootAt + 25000;
  let nextSweep = bootAt + randomSweep();
  function randomSweep(): number { return Math.max(1, settings.oEyeEvery) * 60000 * (0.6 + Math.random() * 0.8); }

  function targetFor(ip: string, reason: EyeTarget['reason']): EyeTarget {
    const now = Date.now();
    const it = intel.get(ip);
    const city = geo.locate(ip);
    return {
      ip, city, district: districtName(hashStr(ip)), reason,
      signal: it?.signal || 'PASSIVE COLLECTION',
      klass: it?.klass || 'ROUTINE SWEEP',
      hits: it ? it.hits.filter((h) => now - h < 60000).length : 0,
      firstSeen: it?.first ?? now,
    };
  }

  function sweepTarget(): EyeTarget {
    const now = Date.now();
    let best: Intel | null = null, bestScore = 0;
    for (const it of intel.values()) {
      const recent = it.hits.filter((h) => now - h < 300000).length;
      const score = recent + it.blocks.filter((h) => now - h < 300000).length * 2 + it.threats * 5;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    if (best) return targetFor(best.ip, 'sweep');
    const city = geo.cities[Math.floor(Math.random() * geo.cities.length)];
    const ip = `${city.region.name.length + 40}.${(hashStr(city.name) % 200) + 20}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
    return { ...targetFor(ip, 'sweep'), city };
  }

  function checkEye(): void {
    if (!settings.oEye || eye.active || rebuilding) return;
    const now = Date.now();
    if (now < cooldownUntil) return;
    while (threatTimes.length && now - threatTimes[0].at > 60000) threatTimes.shift();
    let target: EyeTarget | null = null;
    if (threatTimes.length >= settings.oEyeThreats) {
      target = targetFor(threatTimes[threatTimes.length - 1].ip, 'threat');
      threatTimes.length = 0;
    } else {
      for (const it of intel.values()) {
        if (it.blocks.length >= 25 && it.blocks.filter((h) => now - h < 60000).length >= 25) { target = targetFor(it.ip, 'block'); it.blocks.length = 0; break; }
      }
    }
    if (!target && now >= nextSweep) target = sweepTarget();
    if (target) startEye(target);
  }

  function startEye(target: EyeTarget, vignette?: string, mode?: ViewMode): void {
    orbit.track(target.ip, target.city, `TASKED ${target.ip} · ${target.city.name.toUpperCase()}`, 60);
    eye.start(target, vignette, mode);
    nextSweep = Date.now() + randomSweep();
    cooldownUntil = Date.now() + 90000;
  }

  // ── frame ──
  let orbitAngle = 0.35, alert = 0;
  const orbitPos = new Vector3();

  function frame(f: FrameInfo): void {
    const { dt, dtReal, t } = f;
    groove.update(dtReal, settings.oMusicVisuals ? audio.pulse() : null);
    const pulse = settings.oMusicVisuals && groove.style ? groove.energy * 0.5 + groove.downbeat * 0.5 : 0;
    const w = state.weather;
    const cover = w === 'hurricane' ? 1 : w === 'storm' ? 0.5 : 0;
    planet.update({ dt, cloudCover: cover, clouds: settings.oClouds, grid: settings.oGrid ? 1 : 0, pulse });
    alert += ((w === 'hurricane' ? 0.75 : w === 'storm' ? 0.3 : 0) - alert) * Math.min(1, dtReal * 0.3);
    world.lens.uniforms.uAlert.value = eye.closeUp ? 0 : alert;

    orbitAngle += dtReal * 0.016;
    const elev = 0.24 + Math.sin(t * 0.037) * 0.1;
    orbitPos.set(Math.sin(orbitAngle) * Math.cos(elev), Math.sin(elev), Math.cos(orbitAngle) * Math.cos(elev)).multiplyScalar(D_ORBIT);

    checkEye();
    const view = eye.update(dtReal, orbitPos, f.wanderX, f.wanderY);
    if (!eye.active) {
      const cam = world.camera;
      cam.position.copy(orbitPos);
      cam.position.x += f.wanderX * 0.05;
      cam.position.y += f.wanderY * 0.05;
      cam.up.set(0, 1, 0);
      cam.lookAt(0, 0, 0);
      cam.fov = 38;
      cam.aspect = window.innerWidth / window.innerHeight;
      cam.updateProjectionMatrix();
    }
    orbit.update(dt, world.camera, !eye.closeUp && !(eye.active && eye.phase === 'dive'));
    audio.setThreatActive(threatTimes.length > 0 && Date.now() - threatTimes[threatTimes.length - 1].at < 15000);

    const closeUp = view?.closeUp ?? false;
    world.bloom.strength = !closeUp ? 0.6 : view?.mode === 'night' ? 0.5 : view?.mode === 'thermal' ? 0.08 : 0.25;
    world.bloom.threshold = !closeUp ? 0.78 : view?.mode === 'night' ? 0.75 : 0.9;
    world.lens.uniforms.uVignette.value = closeUp ? 0.75 : 0.55;
    world.render(view?.scene ?? world.scene, view?.camera ?? world.camera, settings.oBloom);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { world.setPixelRatio(scale); },
    stats: () => ({ calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles, eye: eye.phase, ...orbit.counts() }),
    diag: () => ({
      renderer: world.renderer, scene: world.scene, camera: world.camera, planet, orbit, eye, geo, intel, audio,
      task: (vignette?: string, mode?: ViewMode, ip?: string) => startEye(ip ? targetFor(ip, 'sweep') : sweepTarget(), vignette, mode),
    }),
  };
}
