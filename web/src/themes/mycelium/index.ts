import { Application } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { isInternalIp, hash01 } from '../../state';
import { MYCELIUM_DEFAULTS, MYCELIUM_BUDGETS, MYCELIUM_CONTROLS, MYCELIUM_HUD } from './settings';
import { loadTextures } from './textures';
import { Sim, type SimNode } from './filaments';
import { View } from './view';
import { myceliumScore } from './score';
import './hud.css';

/**
 * Mycelium: your network as a forest floor seen at night through
 * bioluminescence. The substrate is not drawn from traffic — it GROWS:
 * hyphal tips wander the loam, branch, and fuse with one another into a
 * meshed, looped network of filaments. Traffic is nutrient light: allowed
 * flows send pulses running along the existing filaments, and well-used
 * routes grow bolder while forgotten ones thin to ghost traces. The gateway
 * is just another nodule. DNS lookups push mushrooms up at busy junctions,
 * which wilt into spore clouds that seed new growth; DHCP leases root new
 * nodules; Wi-Fi drifts spore light; blocks scorch the mat, which grows
 * around the wound; IDS threats are a blight the web burns off.
 */
export const mycelium: Theme<typeof MYCELIUM_DEFAULTS> = {
  id: 'mycelium',
  title: 'MYCELIUM',
  hud: MYCELIUM_HUD,
  accentHue: 155,
  defaults: MYCELIUM_DEFAULTS,
  budgets: MYCELIUM_BUDGETS,
  score: myceliumScore,
  controls: MYCELIUM_CONTROLS,
  create,
};
export default mycelium;

async function create(host: ThemeHost<typeof MYCELIUM_DEFAULTS>,
                      init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#05070a',
    antialias: init.antialias,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);

  const tex = loadTextures();
  const sim = new Sim();
  const view = new View(app, tex);

  function resize(): void {
    view.resize(app.screen.width, app.screen.height);
    sim.setSize(app.screen.width, app.screen.height);
  }
  resize();
  app.renderer.on('resize', () => resize());

  // the saved mat wakes up: faded for the time it slept
  if (settings.mPersist) sim.restore(settings.mFadeMin);

  function applyBudgets(): void {
    view.setBudgets({ mSporeDrift: settings.mSporeDrift, mGlow: settings.mGlow,
      mMaxParticles: settings.mMaxParticles, mLabels: settings.mLabels });
    sim.maxSegs = settings.mMaxEdges;
    sim.maxNodes = settings.mMaxNodes;
    sim.maxShrooms = settings.mMaxBlooms;
    sim.maxPulses = settings.mMaxPulses;
  }
  applyBudgets();

  // ── the event law ─────────────────────────────────────────────────────────
  let simT = 0;
  const now = (): number => simT;
  let threatUntil = 0;
  let lastScorch = -9, lastBloom = -9;

  function nodeFor(ip: string | null | undefined, label?: string): SimNode | null {
    if (!ip || !isInternalIp(ip)) return null;
    return sim.host(ip, label, simT);
  }

  function bloomAt(n: SimNode, domain: string): void {
    const j = sim.junctionNear(n.x, n.y, 210 * Math.max(1, app.screen.width / 1200));
    const x = j ? j.x : n.x + (hash01(`${domain}|${n.id}`) * 2 - 1) * 46;
    const y = j ? j.y : n.y + (14 + hash01(`${n.id}|${domain}`) * 30);
    sim.fruit(x, y, domain);
    audio.sfx('bloom', { pan: ((x / app.screen.width) * 2 - 1) * 0.8 });
  }

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;

    switch (se.kind) {
      case 'allow': {
        const grew = grow(se, replay);
        if (!replay) {
          void grew;
          audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        }
        break;
      }

      case 'dns': {
        const n = nodeFor(ev.src_ip);
        if (!n) break;
        sim.touchNode(n, 0.25);
        if (replay) break;
        audio.cueSong('dns', ev.src_ip ?? undefined);
        const domain = ev.dns_query ?? '';
        if (!domain || !settings.mBlooms) break;
        if (now() - lastBloom < 0.9 || !throttle.allow(`blm|${ev.src_ip}|${domain}`, 2.2)) break;
        lastBloom = now();
        bloomAt(n, domain);
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
        if (settings.mSprouts) {
          view.ringAt(n.x, n.y, 0xffdfae, 70);
          view.emit(n.x, n.y, 0x5ff0cf, 10, 40 * view.unitPx(), 1.4);
          audio.sfx('sprout', { pan: (n.x / app.screen.width * 2 - 1) * 0.8 });
        }
        break;
      }

      case 'wifi': {
        if (replay) break;
        audio.cueSong('wifi');
        if (!settings.mSpores) break;
        const ap = sim.host(ev.syslog_host ?? 'gateway', undefined, simT);
        sim.touchNode(ap, 0.3);
        const bad = se.wifi === 'bad';
        view.emit(ap.x, ap.y - 8, bad ? 0x9a6a55 : 0xffdfae, bad ? 6 : 10, 26 * view.unitPx(), bad ? 2.2 : 3.2);
        if (!bad) sim.puff(ap.x, ap.y - 10, 5);
        if (throttle.allow('spore', 1.5)) audio.sfx('spore', { pan: (ap.x / app.screen.width * 2 - 1) * 0.8 });
        break;
      }

      case 'block': {
        if (replay) break;
        audio.cueSong('block', ev.src_ip ?? undefined);
        if (!settings.mScorch || now() - lastScorch < 1.1) break;
        const src = nodeFor(ev.src_ip) ?? nodeFor(ev.dst_ip);
        if (!src) break;
        lastScorch = now();
        const dst = nodeFor(ev.dst_ip === src.id ? ev.src_ip : ev.dst_ip);
        let x: number, y: number;
        if (dst) { x = (src.x + dst.x) / 2; y = (src.y + dst.y) / 2; }
        else {
          const a = hash01(`${ev.dst_ip}|${src.id}`) * Math.PI * 2;
          const d = Math.min(app.screen.width, app.screen.height) * 0.09;
          x = src.x + Math.cos(a) * d; y = src.y + Math.sin(a) * d;
        }
        sim.scorch(x, y);
        audio.sfx('scorch', { pan: (x / app.screen.width * 2 - 1) * 0.8 });
        break;
      }

      case 'threat': {
        if (replay) break;
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!settings.mBlight) break;
        // the blight crawls for the brightest nodule: what the network loves most
        let target = sim.brightest();
        if (!target) target = sim.host('10.0.0.1', 'gateway', simT);
        sim.touchNode(target, 0.4);
        sim.blight(target);
        threatUntil = Math.max(threatUntil, now() + 9.6);
        audio.sfx('burn');
        break;
      }

      case 'system': {
        if (replay) break;
        audio.cueSong('system');
        const n = sim.host(ev.syslog_host ?? 'gateway', undefined, simT);
        sim.touchNode(n, 0.2);
        view.ringAt(n.x, n.y, 0x2f9f88, 60);
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

  /** Run nutrient light for one flow event. Returns whether light moved. */
  function grow(se: SceneEvent, replay: boolean): boolean {
    const ev = se.ev;
    const src = nodeFor(ev.src_ip);
    const dst = nodeFor(ev.dst_ip);
    if (src && dst && src !== dst) {
      const ok = sim.sendLight(src, dst, protoCol(ev), replay || !settings.mHyphae);
      sim.touchNode(src, replay ? 0.05 : 0.18);
      sim.touchNode(dst, replay ? 0.05 : 0.18);
      return ok;
    }
    const ext = src ?? dst;
    const other = src ? ev.dst_ip : ev.src_ip;
    if (ext && other && !isInternalIp(other)) {
      // traffic out to the internet runs along filaments toward the margin
      const ok = sim.sendLightOut(ext, other, 0xffdfae, replay || !settings.mHyphae);
      sim.touchNode(ext, replay ? 0.04 : 0.14);
      return ok;
    }
    if (ext) sim.touchNode(ext, 0.08);
    return false;
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  function frame(f: FrameInfo): void {
    const { dt, t } = f;
    simT = t;

    sim.step(dt, settings.mFadeMin);
    if (settings.mPersist) sim.tick(t);

    view.setWeather(state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0);
    audio.setThreatActive(t < threatUntil);

    // camera: the anti-burn-in wander plus a slow breathing drift-zoom
    const zoom = 1 + 0.006 * Math.sin(t * 0.043);
    view.world.pivot.set(app.screen.width / 2, app.screen.height / 2);
    view.world.position.set(app.screen.width / 2 + f.wanderX, app.screen.height / 2 + f.wanderY);
    view.world.scale.set(zoom);

    view.update(dt, t, sim);
    app.render();
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) {
      if (app.renderer.resolution !== scale) app.renderer.resolution = scale;
    },
    stats: () => ({
      nodes: sim.nodes.size, hyphae: sim.segCount(),
      blooms: sim.shrooms.length, pulses: sim.pulses.length,
      garden: settings.mPersist ? 'kept' : 'ephemeral',
    }),
    diag: () => ({
      app, sim, view,
      bloom: (d?: string) => { const n = anyNode(); bloomAt(n, d ?? 'EXAMPLE.COM'); },
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
