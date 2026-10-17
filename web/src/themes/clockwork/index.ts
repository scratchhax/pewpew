import { Application, Container } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { CLOCKWORK_DEFAULTS, CLOCKWORK_BUDGETS, CLOCKWORK_CONTROLS, CLOCKWORK_HUD } from './settings';
import { Machine, loadHeroes, WORLD_W, WORLD_H } from './machine';
import { clockworkScore } from './score';

/**
 * Clockwork: the network as one enormous steam-powered Rube Goldberg machine.
 * Allowed traffic drops ball bearings down a switchback run into a counter
 * tray; blocks slam a safety gate under them; DNS queries ride a pneumatic
 * tube up to the directory board (bell included); DHCP leases get a brass
 * nameplate stamped and slotted on the rack; Wi-Fi associations make the
 * coupling arm clamp a hose; IDS threats blow the whistle, spin the warning
 * lamp and catapult the coal cart; a system event drops the master clutch and
 * the whole frame shudders. Boiler pressure follows the traffic, and pressure
 * picks the tune. Mechanisms trip their neighbours — chain reactions.
 */
export const clockwork: Theme<typeof CLOCKWORK_DEFAULTS> = {
  id: 'clockwork',
  title: 'CLOCKWORK',
  hud: CLOCKWORK_HUD,
  accentHue: 42,
  defaults: CLOCKWORK_DEFAULTS,
  budgets: CLOCKWORK_BUDGETS,
  controls: CLOCKWORK_CONTROLS,
  score: clockworkScore,
  create,
};
export default clockwork;

async function create(host: ThemeHost<typeof CLOCKWORK_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#0d0a12',
    antialias: false,
    roundPixels: true,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);
  app.canvas.style.imageRendering = 'pixelated';

  const screen = new Container();
  app.stage.addChild(screen);

  const machine = new Machine(
    settings as unknown as Record<string, any>,
    (name, x) => audio.sfx(name, { pan: Math.max(-0.8, Math.min(0.8, (((x ?? 640) - focusX) / machine.vw) * 1.6 - 0.8)) }),
    (text) => host.hud.say(text),
    await loadHeroes(),
  );
  screen.addChild(machine.world);

  // pixel scale: about 260 world pixels tall, whole-number
  let S = 4, focusX = 640;
  function layout(): void {
    const W = app.screen.width, H = app.screen.height;
    S = Math.max(2, Math.round(H / 300));
    screen.scale.set(S);
    machine.vw = Math.ceil(W / S);
    machine.vh = Math.ceil(H / S);
  }
  layout();
  app.renderer.on('resize', layout);

  // traffic rate → boiler pressure (wall clock, so a slow frame isn't a spike)
  let arrivals = 0, rateFast = 0, rateSlow = 0, lastWall = performance.now() / 1000, bootT = -1;
  let pressure = 0;

  function event(se: SceneEvent): void {
    const ev = se.ev;
    arrivals++;
    switch (se.kind) {
      case 'allow':
        audio.cueSong('allow', ev.src_ip ?? undefined);
        machine.fire('allow');
        break;
      case 'block':
        audio.cueSong('block', ev.src_ip ?? undefined);
        machine.fire('block');
        break;
      case 'threat':
        audio.cueSong('threat', ev.src_ip ?? undefined);
        machine.fire('threat');
        break;
      case 'dns':
        if (!throttle.allow(`dns|${ev.dns_query}`, 4)) break;
        audio.cueSong('dns', ev.src_ip ?? undefined);
        machine.fire('dns', ev.dns_query ?? '');
        break;
      case 'dhcp': {
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        const name = ev.hostname || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4)}` : ev.src_ip ?? 'anon');
        audio.cueSong('dhcp');
        machine.fire('dhcp', name);
        break;
      }
      case 'wifi':
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        audio.cueSong('wifi');
        machine.fire('wifi');
        break;
      case 'system':
        if (!throttle.allow(`sys|${ev.syslog_host}`, 4)) break;
        audio.cueSong('system');
        machine.fire('system');
        break;
    }
    const a = machine.anchorFor(se.kind);
    focusX = a.x;
    machine.focus(a.x, a.y);
  }

  function frame(f: FrameInfo): void {
    const { dt, dtReal, t } = f;
    if (bootT < 0) bootT = t;

    const wall = performance.now() / 1000, wallDt = Math.min(1, Math.max(1e-3, wall - lastWall));
    lastWall = wall;
    rateFast += (arrivals / wallDt - rateFast) * Math.min(1, wallDt * 1.2);
    rateSlow += (rateFast - rateSlow) * Math.min(1, wallDt * 0.08);
    arrivals = 0;
    const target = Math.min(1, rateSlow / 30);
    pressure += (target - pressure) * Math.min(1, dtReal * 0.4);

    machine.update(dt, pressure);
    const sh = Math.sin(t * 47) * (machine.shake > 0 ? 1 : 0);
    machine.applyCamera(sh * machine.shake, Math.cos(t * 39) * machine.shake);

    // the HUD reads the gauges
    host.hud.setExtraStat('PRESSURE', `${Math.round(pressure * 100)}%`);
    host.hud.setExtraStat('GEAR RATE', `${(0.25 + pressure * 1.9).toFixed(1)}x`);
    audio.setThreatActive(machine.pressure > 0.8 && state.threat > 0.5);

    screen.position.set(Math.round(f.wanderX * 0.2), Math.round(f.wanderY * 0.2));
    app.render();
  }

  return {
    event,
    frame,
    applyBudgets() {},
    settingsChanged() {},
    setResolution(scale) { if (app.renderer.resolution !== scale) app.renderer.resolution = scale; },
    stats: () => ({ world: `${WORLD_W}x${WORLD_H}` }),
    diag: () => ({ app, machine }),
  };
}
