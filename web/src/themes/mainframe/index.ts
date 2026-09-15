import { Color } from 'three';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { isInternalIp } from '../../state';
import type { NetEvent } from '../../types';
import { Groove } from '../../sound/groove';
import { MAINFRAME_BUDGETS, MAINFRAME_CONTROLS, MAINFRAME_DEFAULTS, MAINFRAME_HUD } from './settings';
import { createWorld } from './world';
import { Board } from './board';
import { Traffic, COL } from './traffic';
import { Flight } from './flight';
import { Dive, type DiveTarget } from './dive';
import { mainframeScore } from './score';
import './hud.css';

/**
 * Mainframe: flying low over a real circuit board while your network races
 * along its traces. Allowed traffic is light pulses streaking past, blocks
 * shatter against firewall chips, IDS threats are worms crawling toward a chip
 * until ICE hunts them down, DNS lookups scroll across lookup towers' LED lids,
 * DHCP leases get a new part fitted by a pick-and-place arm, Wi-Fi joins ring
 * out from printed antennas, system events brown the board out, and traffic
 * weather overclocks it. Every so often, on the same schedule as Panopticon's
 * eye of god, the camera dives into a chip and traces the intruder from inside
 * the silicon. Rendered with three.js.
 */
export const mainframe: Theme<typeof MAINFRAME_DEFAULTS> = {
  id: 'mainframe',
  title: 'MAINFRAME',
  hud: MAINFRAME_HUD,
  accentHue: 186,
  defaults: MAINFRAME_DEFAULTS,
  budgets: MAINFRAME_BUDGETS,
  controls: MAINFRAME_CONTROLS,
  score: mainframeScore,
  create,
};
export default mainframe;

interface Intel { ip: string; first: number; hits: number[]; blocks: number[]; threats: number; signal: string; klass: string; }

async function create(host: ThemeHost<typeof MAINFRAME_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const world = createWorld(host.mount, init.antialias, init.powerPref === 'default' ? undefined : init.powerPref, init.resolution);
  const overlay = document.createElement('div');
  overlay.id = 'mf-overlay';
  document.body.appendChild(overlay);

  // recent words for the silkscreen
  const words: string[] = ['192.168.1.1', 'GATEWAY', 'DHCP POOL', 'WAN_IN', 'LAN_LOCAL', 'ETH0', 'VLAN 20'];
  const remember = (s?: string | null) => { if (s && s.length < 26) { words.push(s.toUpperCase()); if (words.length > 60) words.shift(); } };

  const board = new Board(world.scene, 'pcb', world.env);
  board.words = () => words[Math.floor(Math.random() * words.length)];
  const traffic = new Traffic(world.scene, board);
  traffic.onEvent = (name, x) => audio.sfx(name, { pan: (x - flight.x) / 60 });
  const flight = new Flight();
  const dive = new Dive(world, board, traffic, audio, overlay);
  const groove = new Groove();

  function applyBudgets(): void {
    traffic.max = settings.mMaxPackets;
    dive.maxPackets = Math.round(settings.mMaxPackets * 0.6);
    if (board.detail !== settings.mDetail) board.detail = settings.mDetail;
    dive.detail = settings.mDetail;
  }
  applyBudgets();
  board.fill(flight.z, settings.mChunks);
  window.addEventListener('resize', () => world.resize(window.innerWidth, window.innerHeight));

  // ── intelligence for the dive's triggers and trace panel ──
  const intel = new Map<string, Intel>();
  const threatTimes: Array<{ at: number; ip: string }> = [];
  const routable = (ip?: string | null): ip is string => {
    if (!ip || isInternalIp(ip)) return false;
    if (ip.includes(':')) return !/^(ff|fe8|::1?$)/i.test(ip);
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128));
  };
  const external = (ev: NetEvent): string | null => (routable(ev.src_ip) ? ev.src_ip : routable(ev.dst_ip) ? ev.dst_ip : null);
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
    it.signal = `${(ev.protocol ?? 'IP').toUpperCase()}${ev.dst_port ? ` ${ev.dst_port}` : ''} → ${ev.dst_ip ?? '?'}`;
    const rule = ev.rule_desc || ev.rule_name || 'traffic';
    if (kind === 'threat') { it.threats++; it.klass = `IDS · ${rule}`.slice(0, 54); threatTimes.push({ at: now, ip }); }
    else if (kind === 'block') { it.blocks.push(now); if (it.blocks.length > 200) it.blocks.splice(0, 100); if (!it.threats) it.klass = `DROPPED · ${rule}`.slice(0, 54); }
    else if (!it.klass) it.klass = `MONITORED · ${rule}`.slice(0, 54);
  };

  let dimTarget = 1, dim = 1, floatGate = 0;
  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    const ext = external(ev);
    if (ext && (se.kind === 'allow' || se.kind === 'block' || se.kind === 'threat')) note(ext, se.kind, ev);
    if (replay) return;
    const camZ = flight.z;
    const floatText = (s?: string | null, color?: string) => {
      if (!settings.mFloatText || !s || performance.now() < floatGate) return;
      floatGate = performance.now() + 700;
      traffic.float(s, camZ, color);
    };
    switch (se.kind) {
      case 'allow': {
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        if (!settings.mPackets || !throttle.allow(`alw|${ev.src_ip}|${ev.dst_ip}`, 0.5)) break;
        traffic.flow(COL.allow, se.scope !== 'inbound', camZ, se.scope === 'internal' || Math.random() < 0.3);
        if (Math.random() < 0.15) floatText(ext ?? ev.dst_ip);
        remember(ext);
        break;
      }
      case 'block': {
        audio.cueSong('block', ev.src_ip ?? undefined);
        if (!settings.mFirewalls || !throttle.allow(`blk|${ev.src_ip}|${ev.dst_port}`, 1.5)) break;
        traffic.strike(camZ);
        floatText(ext, '#ff8a8a');
        remember(ev.rule_name);
        break;
      }
      case 'threat': {
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!settings.mWorms || !throttle.allow(`thr|${ext}`, 2.5)) break;
        if (traffic.worm(camZ)) floatText(ext, '#ffb070');
        break;
      }
      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!settings.mLookups || !ev.dns_query || !throttle.allow(`dns|${ev.dns_query}`, 5) || !throttle.allow('dns|tower', 1.2)) break;
        if (!traffic.lookup(ev.dns_query, camZ)) traffic.flow(COL.dns, true, camZ, true);
        remember(ev.dns_query);
        break;
      }
      case 'dhcp': {
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        audio.cueSong('dhcp');
        const name = ev.hostname || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? 'device');
        if (settings.mParts && !traffic.place(name, camZ)) traffic.flow(COL.dhcp, true, camZ, true);
        remember(name);
        break;
      }
      case 'wifi': {
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        audio.cueSong('wifi');
        if (settings.mAntennas && se.wifi !== 'other') traffic.antenna(se.wifi === 'joined', camZ);
        remember(ev.syslog_host);
        break;
      }
      case 'system': {
        if (!throttle.allow(`sys|${ev.syslog_host}`, 6)) break;
        audio.cueSong('system');
        if (settings.mBrownouts) { dimTarget = 0.3; setTimeout(() => { dimTarget = 1; }, 900); audio.sfx('brownout'); }
        break;
      }
    }
  }

  // ── dive taskings: the same schedule as the eye of god ──
  const bootAt = Date.now();
  const sweepMs = () => Math.max(0.5, settings.mDiveSweep) * 60000;
  let cooldownUntil = bootAt + 15000;
  let nextSweep = bootAt + 20000;
  const randomSweep = () => sweepMs() * (0.6 + Math.random() * 0.8);

  function targetFor(ip: string, reason: DiveTarget['reason']): DiveTarget {
    const now = Date.now(), it = intel.get(ip);
    return { ip, reason, signal: it?.signal || 'PASSIVE TAP', klass: it?.klass || 'ROUTINE SWEEP', hits: it ? it.hits.filter((h) => now - h < 60000).length : 0, firstSeen: it?.first ?? now };
  }
  function sweepTarget(): DiveTarget {
    const now = Date.now();
    let best: Intel | null = null, score = 0;
    for (const it of intel.values()) {
      const s = it.hits.filter((h) => now - h < 300000).length + it.blocks.filter((h) => now - h < 300000).length * 2 + it.threats * 5;
      if (s > score) { score = s; best = it; }
    }
    return targetFor(best?.ip ?? `${45 + Math.floor(Math.random() * 150)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`, 'sweep');
  }
  function startDive(target: DiveTarget): boolean {
    if (!dive.start(target, flight.z, flight.speed)) return false;
    nextSweep = Date.now() + randomSweep();
    cooldownUntil = Date.now() + 25000 + Math.min(45000, sweepMs());
    return true;
  }
  function checkDive(): void {
    if (!settings.mDive || dive.active) return;
    const now = Date.now();
    if (now < cooldownUntil) return;
    while (threatTimes.length && now - threatTimes[0].at > 60000) threatTimes.shift();
    let target: DiveTarget | null = null;
    if (threatTimes.length >= settings.mDiveThreats) target = targetFor(threatTimes[threatTimes.length - 1].ip, 'threat');
    else for (const it of intel.values()) if (it.blocks.length >= 12 && it.blocks.filter((h) => now - h < 60000).length >= 12) { target = targetFor(it.ip, 'block'); break; }
    if (!target && now >= nextSweep) target = sweepTarget();
    if (target && startDive(target)) {
      if (target.reason === 'threat') threatTimes.length = 0;
      else if (target.reason === 'block') intel.get(target.ip)!.blocks.length = 0;
    }
  }

  // ── frame ──
  let heat = 0, lastExit = 0, ambientT = 0;
  const keyCool = new Color(0xcfe6ff), keyHot = new Color(0xffa860);

  function frame(f: FrameInfo): void {
    const { dt, dtReal } = f;
    groove.update(dtReal, settings.mMusicVisuals ? audio.pulse() : null);
    const w = state.weather;
    heat += ((w === 'hurricane' ? 1 : w === 'storm' ? 0.4 : 0) - heat) * Math.min(1, dtReal * 0.25);
    dim += (dimTarget - dim) * Math.min(1, dtReal * (dimTarget < dim ? 5 : 1.2));
    const pulse = settings.mMusicVisuals && groove.style ? 0.85 + groove.downbeat * 0.3 + groove.energy * 0.15 : 1;

    ambientT -= dtReal * (4 + heat * 6);
    while (ambientT < 0) { ambientT += 1 / 3; if (settings.mPackets) traffic.ambient(flight.z); }
    checkDive();
    const view = dive.update(dtReal, world.camera, f.wanderX, f.wanderY);
    if (dive.exitZ !== lastExit) { lastExit = dive.exitZ; flight.z = dive.exitZ; flight.alt = 18; }
    const rate = state.rate30s / 30;
    const speed = (24 + Math.min(20, rate * 0.6) + heat * 10) * settings.mFlightSpeed * dive.speedFactor;
    if (!view?.controlsCamera) {
      flight.update(dt, board, world.camera, { speed, steerX: dive.steerX, low: 9 - heat * 2, wanderX: f.wanderX, wanderY: f.wanderY });
    }
    audio.sfx('fly', { count: flight.speed });
    board.update(flight.z, settings.mChunks);
    traffic.camX = flight.x;
    traffic.speedScale = 1 + heat * 0.35;
    traffic.dim = dim * pulse;
    traffic.update(dt);
    traffic.cull(flight.z);
    for (const fan of board.fans()) fan.rotation.y += dt * (8 + heat * 16);
    board.mats.led.color.setScalar(dim * pulse);
    world.key.color.copy(keyCool).lerp(keyHot, heat * 0.8);
    world.key.intensity = 2.2 * (0.35 + 0.65 * dim);
    world.key.position.set(flight.x - 40, 90, flight.z + 30);
    world.key.target.position.set(flight.x, 0, flight.z - 40);
    (world.scene.fog as { density: number }).density = 0.0034 + heat * 0.0015;
    const lens = world.lens.uniforms;
    lens.uTime.value += dtReal;
    lens.uHaze.value = settings.mHaze ? heat : 0;
    lens.uHeat.value = heat * 0.7;
    audio.setThreatActive(traffic.wormsAlive > 0);
    world.render(view?.scene ?? world.scene, world.camera, settings.mBloom);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { world.setPixelRatio(scale); },
    stats: () => ({ calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles, dive: dive.phase, ...traffic.counts() }),
    diag: () => ({
      renderer: world.renderer, scene: world.scene, camera: world.camera, board, traffic, flight, dive, intel, audio,
      task: (ip?: string) => startDive(ip ? targetFor(ip, 'sweep') : sweepTarget()),
    }),
  };
}
