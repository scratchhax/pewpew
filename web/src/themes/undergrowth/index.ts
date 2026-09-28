import { Vector3 } from 'three';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { isInternalIp } from '../../state';
import { UNDERGROWTH_DEFAULTS, UNDERGROWTH_BUDGETS, UNDERGROWTH_CONTROLS, UNDERGROWTH_HUD } from './settings';
import { createWorld } from './world';
import { UndergrowthView, lift } from './web3d';
import { Flycam } from './camera';
import { undergrowthScore } from './score';
import { Sim, type SimNode } from '../mycelium/filaments';
import './hud.css';

/**
 * Undergrowth: the Mycelium garden, seen from inside. The same living mat —
 * the same localStorage, the same half-life — lifted into a shallow 3D volume
 * in a dark subterranean void, and you are flying through it: a slow
 * autopilot that rides the filaments toward whatever carries the most
 * traffic, passing pulses of light, mushroom groves at the junctions, a
 * scorch where a flow was stopped, and a blight that creeps the web before
 * the web burns it off. Rendered with three.js.
 */
export const undergrowth: Theme<typeof UNDERGROWTH_DEFAULTS> = {
  id: 'undergrowth',
  title: 'UNDERGROWTH',
  hud: UNDERGROWTH_HUD,
  accentHue: 155,
  defaults: UNDERGROWTH_DEFAULTS,
  budgets: UNDERGROWTH_BUDGETS,
  controls: UNDERGROWTH_CONTROLS,
  score: undergrowthScore,
  create,
};
export default undergrowth;

// the mat lives in a fixed virtual space so the world is viewport-independent
const VW = 1920, VH = 1080;

async function create(host: ThemeHost<typeof UNDERGROWTH_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  // one-time migration: 12 was the old default, so a stored 12 is "never touched"
  if (settings.uCamSpeed === 12) settings.uCamSpeed = UNDERGROWTH_DEFAULTS.uCamSpeed;

  const world = createWorld(host.mount, init.antialias, init.powerPref === 'default' ? undefined : init.powerPref, init.resolution);
  const overlay = document.createElement('div');
  overlay.id = 'ug-host';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:8;overflow:hidden;';
  document.body.appendChild(overlay);

  const sim = new Sim();
  sim.setSize(VW, VH);
  if (settings.uPersist) sim.restore(settings.uFadeMin);

  const view = new UndergrowthView(world.scene, overlay, world.camera, {
    edges: 15000, nodes: 60, pulses: 700, spores: 2200,
  });
  const cam = new Flycam(sim, world.camera, lift(VW * 0.5, VH * 0.45, new Vector3()));

  function applyBudgets(): void {
    sim.maxSegs = settings.uMaxEdges;
    sim.maxNodes = settings.uMaxNodes;
    sim.maxShrooms = settings.uMaxBlooms;
    sim.maxPulses = settings.uMaxPulses;
    world.setSpecks(settings.uDust);
    world.setBloom(settings.quality !== 'low');
  }
  applyBudgets();

  function setPx(): void {
    const pr = world.renderer.getPixelRatio();
    view.setPx(window.innerHeight * pr / 1080);
  }
  function resize(): void {
    world.resize(window.innerWidth, window.innerHeight);
    setPx();
  }
  resize();
  window.addEventListener('resize', resize);

  // ── the event law (the same law as the garden seen from above) ────────────
  let simT = 0;
  const now = (): number => simT;
  let threatUntil = 0;
  let lastScorch = -9, lastBloom = -9;

  function nodeFor(ip: string | null | undefined, label?: string): SimNode | null {
    if (!ip || !isInternalIp(ip)) return null;
    return sim.host(ip, label, simT);
  }

  function bloomAt(n: SimNode, domain: string, blocked: boolean): void {
    const j = sim.junctionNear(n.x, n.y, 210);
    const x = j ? j.x : n.x + (Math.random() * 2 - 1) * 46;
    const y = j ? j.y : n.y + (14 + Math.random() * 30);
    sim.fruit(x, y, domain, blocked);
    if (settings.uFocus) cam.focusAt(x, y, now());
    audio.sfx('bloom', { pan: panFor(x, y) });
  }

  function panFor(x: number, y: number): number {
    // the camera's right-hand axis decides the side, like the 2-D screen does
    const p = cam.pos;
    const dx = (x * 0.05 - p.x), dz = (y * 0.05 - p.z);
    const rx = p.z, rz = -p.x; // camera right ≈ perpendicular to forward in the loam plane
    return Math.max(-0.9, Math.min(0.9, (dx * rx + dz * rz) / 40));
  }

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;

    switch (se.kind) {
      case 'allow': {
        grow(se, replay);
        if (!replay) audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        break;
      }

      case 'dns': {
        const n = nodeFor(ev.src_ip);
        if (!n) break;
        sim.touchNode(n, 0.25);
        if (replay) break;
        audio.cueSong('dns', ev.src_ip ?? undefined);
        const domain = ev.dns_query ?? '';
        if (!domain || !settings.uBlooms) break;
        if (now() - lastBloom < 0.9 || !throttle.allow(`blm|${ev.src_ip}|${domain}`, 2.2)) break;
        lastBloom = now();
        bloomAt(n, domain, ev.dns_blocked === true);
        break;
      }

      case 'dhcp': {
        const ip = ev.src_ip ?? null;
        const name = ev.hostname ||
          (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : undefined);
        const n = nodeFor(ip, name);
        if (!n) break;
        sim.touchNode(n, 0.5);
        if (replay) break;
        audio.cueSong('dhcp');
        if (settings.uSprouts) {
          view.ripple(n.x, n.y, now());
          audio.sfx('sprout', { pan: panFor(n.x, n.y) });
        }
        break;
      }

      case 'wifi': {
        if (replay) break;
        audio.cueSong('wifi');
        if (!settings.uSpores) break;
        const ap = sim.host(ev.syslog_host ?? 'gateway', undefined, simT);
        sim.touchNode(ap, 0.3);
        const bad = se.wifi === 'bad';
        if (!bad) sim.puff(ap.x, ap.y, 5, 0xffdfae);
        if (throttle.allow('spore', 1.5)) audio.sfx('spore', { pan: panFor(ap.x, ap.y) });
        break;
      }

      case 'block': {
        if (replay) break;
        audio.cueSong('block', ev.src_ip ?? undefined);
        if (!settings.uScorch || now() - lastScorch < 1.1) break;
        const src = nodeFor(ev.src_ip) ?? nodeFor(ev.dst_ip);
        if (!src) break;
        lastScorch = now();
        const dst = nodeFor(ev.dst_ip === src.id ? ev.src_ip : ev.dst_ip);
        let x: number, y: number;
        if (dst) { x = (src.x + dst.x) / 2; y = (src.y + dst.y) / 2; }
        else {
          const a = Math.random() * Math.PI * 2;
          const d = Math.min(VW, VH) * 0.09;
          x = src.x + Math.cos(a) * d; y = src.y + Math.sin(a) * d;
        }
        sim.scorch(x, y);
        audio.sfx('scorch', { pan: panFor(x, y) });
        break;
      }

      case 'threat': {
        if (replay) break;
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!settings.uBlight) break;
        let target = sim.brightest();
        if (!target) target = sim.host('10.0.0.1', 'gateway', simT);
        sim.touchNode(target, 0.4);
        sim.blight(target);
        threatUntil = Math.max(threatUntil, now() + 9.6);
        if (settings.uFocus) cam.focusAt(target.x, target.y, now());
        audio.sfx('burn', { pan: panFor(target.x, target.y) });
        break;
      }

      case 'system': {
        if (replay) break;
        audio.cueSong('system');
        const n = sim.host(ev.syslog_host ?? 'gateway', undefined, simT);
        sim.touchNode(n, 0.2);
        view.ripple(n.x, n.y, now());
        break;
      }
    }
  }

  /** The light of a flow carries its protocol's colour. */
  function protoCol(ev: SceneEvent['ev']): number {
    const p = (ev.protocol ?? '').toLowerCase();
    if (p.includes('ssh')) return 0x8fc4ff;
    if (p.includes('dns')) return 0xb9a0ff;
    if (p.includes('wireguard') || p.includes('https')) return 0xffc86a;
    if (p.includes('icmp')) return 0xff9a6a;
    return 0xdffff4;
  }

  function grow(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    const src = nodeFor(ev.src_ip);
    const dst = nodeFor(ev.dst_ip);
    if (src && dst && src !== dst) {
      if (settings.uHyphae) sim.sendLight(src, dst, protoCol(ev), replay);
      sim.touchNode(src, replay ? 0.05 : 0.18);
      sim.touchNode(dst, replay ? 0.05 : 0.18);
      return;
    }
    const ext = src ?? dst;
    const other = src ? ev.dst_ip : ev.src_ip;
    if (ext && other && !isInternalIp(other)) {
      if (settings.uHyphae) sim.sendLightOut(ext, other, 0xffdfae, replay);
      sim.touchNode(ext, replay ? 0.04 : 0.14);
      return;
    }
    if (ext) sim.touchNode(ext, 0.08);
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  function frame(f: FrameInfo): void {
    const { dt, t, wanderX, wanderY } = f;
    simT = t;

    sim.step(dt, settings.uFadeMin);
    if (settings.uPersist) sim.tick(t);

    cam.setSpeed(settings.uCamSpeed);
    cam.update(dt, t, wanderX, wanderY);

    const passed = view.update(sim, t, { glow: settings.uGlow, hosts: settings.uLabels });
    if (passed !== 0 && throttle.allow('whoosh', 0.9)) {
      audio.sfx('whoosh', { pan: passed < 0 ? -0.75 : 0.75 });
    }

    const storm = state.weather === 'hurricane' ? 2 : state.weather === 'storm' ? 1.4 : 1;
    world.update(dt, t, settings.uSporeDrift * storm);
    world.render();
    audio.setThreatActive(t < threatUntil);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); setPx(); },
    setResolution(scale) {
      if (world.renderer.getPixelRatio() !== scale) {
        world.setPixelRatio(scale);
        setPx();
      }
    },
    stats: () => ({
      ...view.stats(sim),
      flight: `${cam.pos.x.toFixed(0)},${cam.pos.z.toFixed(0)}`,
      garden: settings.uPersist ? 'kept' : 'ephemeral',
    }),
    diag: () => ({
      sim,
      cam: () => ({ pos: [cam.pos.x, cam.pos.y, cam.pos.z], quat: [cam.quat.x, cam.quat.y, cam.quat.z, cam.quat.w], speed: cam.speedNow, ...cam.routeInfo }),
      flyTo: (ip: string) => {
        const n = sim.host(ip, ip, now());
        cam.teleport(n.x, n.y);
        return n;
      },
      bloom: (d?: string, blocked?: boolean) => { const n = anyNode(); bloomAt(n, d ?? 'EXAMPLE.COM', blocked === true); },
      scorch: () => { const n = anyNode(); sim.scorch(n.x + 30, n.y + 20); },
      blight: () => { const n = anyNode(); sim.blight(n); threatUntil = now() + 9.6; },
      sprout: (name?: string) => {
        const ip = `10.0.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
        const n = sim.host(ip, name ?? `dev-${(Math.random() * 9999) | 0}`, simT);
        sim.touchNode(n, 0.6);
      },
    }),
  };

  function anyNode(): SimNode {
    let pick: SimNode | null = null;
    for (const n of sim.nodes.values()) if (!pick || Math.random() < 0.5) pick = n;
    return pick ?? sim.host('10.0.0.1', 'gateway', simT);
  }
}
