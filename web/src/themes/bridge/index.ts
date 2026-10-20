import { Application, Container } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { BRIDGE_DEFAULTS, BRIDGE_BUDGETS, BRIDGE_CONTROLS, BRIDGE_HUD } from './settings';
import { Console } from './console';
import { bridgeScore } from './score';
import './hud.css';

/**
 * Bridge: your network as the LCARS console of a Federation starship. The
 * whole screen is the interface - peach elbows and pips frame a long-range
 * sensor sweep where events land as coloured blips, a subspace data feed
 * scrolls the log, DHCP leases sign the crew manifest, DNS lookups appear on
 * the library computer, Wi-Fi joins light docking-uplink ports, blocks snap
 * the force field, and a threat throws the deck into red alert. The stardate
 * ticks and the sweep always turns: the deck is never asleep. Vector chrome
 * throughout, crisp from 720p to 4K.
 */
export const bridge: Theme<typeof BRIDGE_DEFAULTS> = {
  id: 'bridge',
  title: 'BRIDGE',
  hud: BRIDGE_HUD,
  accentHue: 25,
  defaults: BRIDGE_DEFAULTS,
  budgets: BRIDGE_BUDGETS,
  controls: BRIDGE_CONTROLS,
  score: bridgeScore,
  create,
};
export default bridge;

async function create(host: ThemeHost<typeof BRIDGE_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  // the house font must be in before any text is measured
  try { await Promise.all([document.fonts.load('600 20px Antonio'), document.fonts.load('700 20px Antonio')]); } catch { /* fallback font */ }

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#000000',
    antialias: true,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    // pure vector: adaptive downscaling only blurs it (and shifts the
    // edge-flush chrome), so the canvas always renders at native resolution
    resolution: 1,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);

  const screen = new Container();
  app.stage.addChild(screen);
  const console_ = new Console(screen, settings as unknown as Record<string, any>);

  function layout(): void {
    console_.resize(app.screen.width, app.screen.height);
  }
  layout();
  app.renderer.on('resize', layout);

  let alertUntil = -9;
  let lastBeep = -9;
  const now = () => performance.now() / 1000;

  function event(se: SceneEvent): void {
    const ev = se.ev;
    const ip = ev.src_ip ?? '?';
    switch (se.kind) {
      case 'allow':
        console_.event('allow', ip, { dst: ev.dst_ip ?? undefined, port: ev.dst_port ? String(ev.dst_port) : undefined, proto: ev.protocol ?? undefined });
        if (now() - lastBeep > 0.15) { lastBeep = now(); audio.sfx('beep'); }
        audio.cueSong('allow', ip);
        break;
      case 'block':
        console_.event('block', ip, { dst: ev.dst_ip ?? undefined, port: ev.dst_port ? String(ev.dst_port) : undefined, proto: ev.protocol ?? undefined });
        audio.sfx('force');
        audio.cueSong('block', ip);
        break;
      case 'threat': {
        const sig = (ev.rule_desc || ev.rule_name || `INTRUSION ${ip}`).replace(/^ET\s+/i, '').slice(0, 30);
        console_.event('threat', ip, { dst: sig, proto: 'IDS' });
        console_.alert();
        if (settings.bAlert !== false) {
          alertUntil = now() + 3;
          audio.sfx('klaxon');
        }
        audio.cueSong('threat', ip);
        break;
      }
      case 'dns':
        if (!throttle.allow(`dns|${ev.dns_query}`, 4) || !ev.dns_query) break;
        console_.event('dns', ip, { dst: ev.dns_query, proto: 'DNS' });
        audio.cueSong('dns', ip);
        break;
      case 'dhcp': {
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        const name = ev.hostname || (ev.mac_address ? `DEV-${ev.mac_address.replace(/:/g, '').slice(-4)}` : ip);
        console_.event('dhcp', name, { dst: ip, proto: 'DHCP' });
        audio.sfx('confirm');
        audio.cueSong('dhcp');
        break;
      }
      case 'wifi':
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        console_.event('wifi', ev.syslog_host ?? 'CLIENT', { dst: se.wifi === 'bad' ? 'REJECTED' : 'DOCKED', proto: 'WPA' });
        audio.sfx('port');
        audio.cueSong('wifi');
        break;
      case 'system':
        if (!throttle.allow(`sys|${ev.syslog_host}`, 4)) break;
        console_.event('system', ev.syslog_host ?? 'CORE', { dst: 'CORE', proto: 'SYS' });
        audio.sfx('powerdown');
        audio.cueSong('system');
        break;
    }
  }

  const t0 = performance.now() / 1000;

  function frame(f: FrameInfo): void {
    const { dt, t } = f;
    const activity = Math.min(1, state.rate30s / 600);
    console_.update(dt, t, activity, {
      rate: state.rate30s, denied: state.blocks30s(), threats: state.threats30s(),
      threat: state.threat, energy: state.energy, uptime: t - t0,
    });
    audio.setThreatActive(now() < alertUntil);
    screen.position.set(Math.round(f.wanderX * 0.2), Math.round(f.wanderY * 0.2));
    app.render();
  }

  return {
    event,
    frame,
    applyBudgets() {},
    settingsChanged() {},
    setResolution() {}, // vector at native res; runtime rescaling shifts the chrome
    stats: () => ({ chrome: 'vector', sweep: settings.bSweep ? 'on' : 'off' }),
    diag: () => ({ app, console: console_ }),
  };
}
