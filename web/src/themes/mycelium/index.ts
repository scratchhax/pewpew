import { Application } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { isInternalIp, hash01 } from '../../state';
import { MYCELIUM_DEFAULTS, MYCELIUM_BUDGETS, MYCELIUM_CONTROLS, MYCELIUM_HUD } from './settings';
import { loadTextures } from './textures';
import { Garden, type MNode } from './garden';
import { View } from './view';
import { myceliumScore } from './score';
import './hud.css';

/**
 * Mycelium: your network as a forest floor seen at night through
 * bioluminescence. Permitted traffic feeds a web of hyphae between the
 * hosts — hyphae thicken with use and thin with neglect, and the garden
 * persists, so after a week the screen is a portrait of your network's
 * habits. DNS lookups push up mushrooms wearing the domain's name, DHCP
 * leases sprout new hosts, Wi-Fi is drifting spore light, blocks leave
 * scorch that heals, and IDS threats are a blight the web burns off.
 * Talking to the world outside sends pale tendrils out past the clearing.
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
  const garden = new Garden();
  const view = new View(app, tex);

  function resize(): void {
    view.resize(app.screen.width, app.screen.height);
    garden.setSize(app.screen.width, app.screen.height);
  }
  resize();
  app.renderer.on('resize', () => resize());

  // the saved garden wakes up: decayed for the days it slept
  if (settings.mPersist) garden.restore(settings.mFadeDays);

  function applyBudgets(): void {
    view.setBudgets({ mSporeDrift: settings.mSporeDrift, mGlow: settings.mGlow,
      mMaxPulses: settings.mMaxPulses, mMaxParticles: settings.mMaxParticles,
      mMaxBlooms: settings.mMaxBlooms, mLabels: settings.mLabels });
    garden.maxNodes = settings.mMaxNodes;
    garden.maxEdges = settings.mMaxEdges;
  }
  applyBudgets();

  // ── the event law ─────────────────────────────────────────────────────────
  let simT = 0;
  const now = (): number => simT;
  let threatUntil = 0;
  let lastScorch = -9, lastBloom = -9;

  /** An internal host's nodule; external IPs never become nodes. */
  function nodeFor(ip: string | null | undefined, label?: string, t = 0): MNode | null {
    if (!ip || !isInternalIp(ip)) return null;
    return garden.node(ip, label, t);
  }

  /** The gateway nodule: the root every out-bound flow routes through. */
  function gatewayNode(): MNode {
    const root = garden.node('192.168.1.1', 'GATEWAY', simT);
    if (root.born === simT) { root.nx = 0.52; root.ny = 0.56; }   // the root sits mid-clearing
    return root;
  }

  function bloomNear(n: MNode, domain: string, t: number): void {
    const dx = (hash01(`${domain}|${n.id}`) * 2 - 1) * 42 * Math.min(1600, app.screen.width) / 900;
    const dy = (12 + hash01(`${n.id}|${domain}`) * 26) * view.unitPx();
    view.bloomAt(n.nx * app.screen.width + dx, n.ny * app.screen.height + dy, domain);
    audio.sfx('bloom', { pan: ((n.nx * 2 - 1) * 0.8) });
    void t;
  }

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    const feed = replay ? 0.04 : 0.09;   // snapshot backfill feeds quietly too

    switch (se.kind) {
      case 'allow': {
        if (replay) { grow(se, feed); break; }
        if (grow(se, 0.09) && settings.mHyphae && throttle.allow(`pul|${ev.src_ip}|${ev.dst_ip}`, 1.1)) {
          const pulse = pulseFor(se);
          if (pulse) view.pulseEdge(pulse.e, pulse.dir);
        }
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        break;
      }

      case 'dns': {
        const n = nodeFor(ev.src_ip);
        if (!n) break;
        garden.touch(n, 0.25);
        if (replay) break;
        audio.cueSong('dns', ev.src_ip ?? undefined);
        const domain = ev.dns_query ?? '';
        if (!domain || !settings.mBlooms) break;
        if (now() - lastBloom < 0.9 || !throttle.allow(`blm|${ev.src_ip}|${domain}`, 2.2)) break;
        lastBloom = now();
        bloomNear(n, domain, 0);
        break;
      }

      case 'dhcp': {
        const ip = ev.src_ip ?? null;
        const name = ev.hostname ||
          (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : undefined);
        const n = nodeFor(ip, name, simT);
        if (!n) break;
        garden.touch(n, 0.5);
        if (replay) break;
        audio.cueSong('dhcp');
        if (settings.mSprouts) {
          view.ringAt(n.nx * app.screen.width, n.ny * app.screen.height, 0xffdfae, 70);
          view.emit(n.nx * app.screen.width, n.ny * app.screen.height, 0x5ff0cf, 10, 40 * view.unitPx(), 1.4);
          audio.sfx('sprout', { pan: (n.nx * 2 - 1) * 0.8 });
        }
        break;
      }

      case 'wifi': {
        if (replay) break;
        audio.cueSong('wifi');
        if (!settings.mSpores) break;
        const ap = garden.node(ev.syslog_host ?? 'gateway', undefined, simT);
        const x = ap.nx * app.screen.width, y = ap.ny * app.screen.height;
        garden.touch(ap, 0.3);
        const bad = se.wifi === 'bad';
        view.emit(x, y - 8, bad ? 0x9a6a55 : 0xffdfae, bad ? 6 : 10, 26 * view.unitPx(), bad ? 2.2 : 3.2);
        if (throttle.allow('spore', 1.5)) audio.sfx('spore', { pan: (ap.nx * 2 - 1) * 0.8 });
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
        if (dst) { x = (src.nx + dst.nx) / 2; y = (src.ny + dst.ny) / 2; }
        else {
          const a = hash01(`${ev.dst_ip}|${src.id}`) * Math.PI * 2;
          x = src.nx + Math.cos(a) * 0.09; y = src.ny + Math.sin(a) * 0.09;
        }
        view.scorchAt(x * app.screen.width, y * app.screen.height);
        audio.sfx('scorch', { pan: (x * 2 - 1) * 0.8 });
        break;
      }

      case 'threat': {
        if (replay) break;
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!settings.mBlight) break;
        // the blight crawls for the brightest nodule: what the network loves most
        let target: MNode | null = null;
        for (const n of garden.nodes.values()) if (!target || n.w > target.w) target = n;
        if (!target) target = garden.node('10.0.0.1', 'gateway', simT);
        garden.touch(target, 0.4);
        view.blightAt(target.nx * app.screen.width, target.ny * app.screen.height);
        threatUntil = Math.max(threatUntil, now() + 9.6);
        audio.sfx('burn');
        break;
      }

      case 'system': {
        if (replay) break;
        audio.cueSong('system');
        const n = garden.node(ev.syslog_host ?? 'gateway', undefined, simT);
        garden.touch(n, 0.2);
        view.ringAt(n.nx * app.screen.width, n.ny * app.screen.height, 0x2f9f88, 60);
        break;
      }
    }
  }

  /** Feed the web for one flow event; returns the edge (or tendril) grown. */
  function grow(se: SceneEvent, amount: number): boolean {
    if (!settings.mHyphae) return false;
    const ev = se.ev;
    const src = nodeFor(ev.src_ip, undefined, simT);
    const dst = nodeFor(ev.dst_ip, undefined, simT);
    if (src && dst && src !== dst) {
      garden.boost(src, dst, amount);
      garden.touch(src, 0.22); garden.touch(dst, 0.22);
      return true;
    }
    const ext = src ?? dst;
    const other = src ? ev.dst_ip : ev.src_ip;
    if (ext && other && !isInternalIp(other)) {
      // everything leaving the clearing routes through the root: host → gateway
      // hypha, then one pale tendril out past the edge of the known
      const root = gatewayNode();
      if (ext !== root) garden.boost(ext, root, amount * 0.8);
      garden.tendril(root, other, amount * 0.5);
      garden.touch(ext, 0.16); garden.touch(root, 0.14);
      return true;
    }
    if (ext) garden.touch(ext, 0.12);
    return false;
  }

  /** The edge + direction a flow's light should run along. */
  function pulseFor(se: SceneEvent): { e: import('./garden').MEdge; dir: 1 | -1 } | null {
    const ev = se.ev;
    const src = nodeFor(ev.src_ip, undefined, simT);
    const dst = nodeFor(ev.dst_ip, undefined, simT);
    if (src && dst && src !== dst) return { e: garden.boost(src, dst, 0), dir: 1 };
    const root = gatewayNode();
    if (src && src !== root && ev.dst_ip && !isInternalIp(ev.dst_ip)) return { e: garden.boost(src, root, 0), dir: 1 };
    if (dst && dst !== root && ev.src_ip && !isInternalIp(ev.src_ip)) return { e: garden.boost(dst, root, 0), dir: -1 };
    if (src === root && ev.dst_ip && !isInternalIp(ev.dst_ip)) return { e: garden.tendril(root, ev.dst_ip, 0), dir: 1 };
    if (dst === root && ev.src_ip && !isInternalIp(ev.src_ip)) return { e: garden.tendril(root, ev.src_ip, 0), dir: -1 };
    return null;
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  function frame(f: FrameInfo): void {
    const { dt, t } = f;
    simT = t;

    garden.decay(dt, settings.mFadeDays);
    if (settings.mPersist) garden.tick(t);

    view.setWeather(state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0);
    audio.setThreatActive(t < threatUntil);

    // camera: the anti-burn-in wander plus a slow breathing drift-zoom
    const zoom = 1 + 0.006 * Math.sin(t * 0.043);
    view.world.pivot.set(app.screen.width / 2, app.screen.height / 2);
    view.world.position.set(app.screen.width / 2 + f.wanderX, app.screen.height / 2 + f.wanderY);
    view.world.scale.set(zoom);

    view.update(dt, t, garden);
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
      nodes: garden.nodes.size, hyphae: garden.edges.size,
      blooms: view.bloomCount(), pulses: view.pulseCount(),
      garden: settings.mPersist ? 'kept' : 'ephemeral',
    }),
    diag: () => ({
      app, garden, view,
      bloom: (d?: string) => { const n = anyNode(); bloomNear(n, d ?? 'EXAMPLE.COM', 0); },
      scorch: () => { const n = anyNode(); view.scorchAt(n.nx * app.screen.width + 30, n.ny * app.screen.height + 20); },
      blight: () => { const n = anyNode(); view.blightAt(n.nx * app.screen.width, n.ny * app.screen.height); threatUntil = now() + 9.6; },
      sprout: () => { const ip = `10.0.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`; const n = garden.node(ip, `dev-${(Math.random() * 9999 | 0)}`, simT); garden.touch(n, 0.6); },
    }),
  };

  function anyNode(): MNode {
    let pick: MNode | null = null;
    for (const n of garden.nodes.values()) if (!pick || Math.random() < 0.5) pick = n;
    return pick ?? garden.node('10.0.0.1', 'gateway', simT);
  }
}
