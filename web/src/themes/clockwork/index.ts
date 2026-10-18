import { Application, Container } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { CLOCKWORK_DEFAULTS, CLOCKWORK_BUDGETS, CLOCKWORK_CONTROLS, CLOCKWORK_HUD } from './settings';
import { Machine, WORLD_W, WORLD_H, type Kind } from './machine';
import { loadParts } from './art';

/**
 * Clockwork: the network as one steam-powered Rube Goldberg machine.
 *
 * Every event is a ball bearing dropped into the hopper at the top left. It
 * rolls the rail, runs the dominoes, tips the see-saw, is flung to the funnel,
 * falls the standpipe, rides the coal cart down its rail and is tipped into
 * the firebox under the boiler. One run, travelled end to end, every time -
 * what changes between event kinds is the colour of the bearing and what it
 * sets off on the way past, never the route. Boiler pressure follows your
 * traffic, and the whole machine turns over faster as it climbs.
 */
export const clockwork: Theme<typeof CLOCKWORK_DEFAULTS> = {
  id: 'clockwork',
  title: 'CLOCKWORK',
  hud: CLOCKWORK_HUD,
  accentHue: 42,
  defaults: CLOCKWORK_DEFAULTS,
  budgets: CLOCKWORK_BUDGETS,
  controls: CLOCKWORK_CONTROLS,
  create,
};
export default clockwork;

async function create(host: ThemeHost<typeof CLOCKWORK_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const app = new Application();
  await app.init({
    // exactly the world, not the window: see layout() below
    width: WORLD_W,
    height: WORLD_H,
    background: '#0d0a12',
    antialias: false,
    roundPixels: true,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: 1,
    autoDensity: false,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);
  app.canvas.style.imageRendering = 'pixelated';

  const screen = new Container();
  app.stage.addChild(screen);

  const machine = new Machine(
    settings as unknown as Record<string, unknown>,
    (name, x) => audio.sfx(name, { pan: Math.max(-0.8, Math.min(0.8, ((x ?? WORLD_W / 2) - WORLD_W / 2) / 260)) }),
    await loadParts(),
  );
  screen.addChild(machine.world);

  /**
   * The renderer draws 640x360 and CSS blows it up by a whole number, which is
   * pixel-exact at 1280x720, 1920x1080 and 2560x1440 (640 divides all three)
   * and costs a ninth of the fill at 1080p. Scaling the stage instead, which
   * is what this did first, resamples every sprite every frame and held the
   * scene to 34.8 fps.
   *
   * The previous version of this scene used a 1500x850 world, which lands on
   * integer scale 1 at 1080p and left a fifth of the screen empty down the
   * right.
   */
  function layout(): void {
    const W = window.innerWidth, H = window.innerHeight;
    const q = Math.max(1, Math.min(Math.floor(W / WORLD_W), Math.floor(H / WORLD_H)));
    app.canvas.style.width = `${WORLD_W * q}px`;
    app.canvas.style.height = `${WORLD_H * q}px`;
    app.canvas.style.display = 'block';
    app.canvas.style.margin = `${Math.max(0, (H - WORLD_H * q) / 2)}px auto`;
  }
  layout();
  window.addEventListener('resize', layout);

  // traffic rate -> boiler pressure, on the wall clock so a slow frame is not a spike
  let arrivals = 0, rateFast = 0, rateSlow = 0, lastWall = performance.now() / 1000;
  let pressure = 0;

  function fire(kind: Kind): void { machine.fire(kind); }

  function event(se: SceneEvent): void {
    const ev = se.ev;
    arrivals++;
    switch (se.kind) {
      case 'allow': audio.cueSong('allow', ev.src_ip ?? undefined); fire('allow'); break;
      case 'block': audio.cueSong('block', ev.src_ip ?? undefined); fire('block'); break;
      case 'threat': audio.cueSong('threat', ev.src_ip ?? undefined); fire('threat'); break;
      case 'dns':
        if (!throttle.allow(`dns|${ev.dns_query}`, 4)) break;
        audio.cueSong('dns', ev.src_ip ?? undefined); fire('dns'); break;
      case 'dhcp':
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        audio.cueSong('dhcp'); fire('dhcp'); break;
      case 'wifi':
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        audio.cueSong('wifi'); fire('wifi'); break;
      case 'system':
        if (!throttle.allow(`sys|${ev.syslog_host}`, 4)) break;
        audio.cueSong('system'); fire('system'); break;
    }
  }

  function frame(f: FrameInfo): void {
    const { dt, dtReal } = f;
    const wall = performance.now() / 1000, wallDt = Math.min(1, Math.max(1e-3, wall - lastWall));
    lastWall = wall;
    rateFast += (arrivals / wallDt - rateFast) * Math.min(1, wallDt * 1.2);
    rateSlow += (rateFast - rateSlow) * Math.min(1, wallDt * 0.08);
    arrivals = 0;
    pressure += (Math.min(1, rateSlow / 30) - pressure) * Math.min(1, dtReal * 0.4);

    machine.update(dt, pressure);

    host.hud.setExtraStat('PRESSURE', `${Math.round(pressure * 100)}%`);
    host.hud.setExtraStat('RUN RATE', `${(0.55 + pressure * 1.25).toFixed(2)}x`);
    audio.setThreatActive(pressure > 0.8 && state.threat > 0.5);

    app.render();
  }

  return {
    event,
    frame,
    applyBudgets() {},
    settingsChanged() {},
    // The buffer is the world, fixed. A render-scale knob would only blur a
    // pixel-art scene whose whole point is the integer upscale.
    setResolution() {},
    stats: () => ({ world: `${WORLD_W}x${WORLD_H}` }),
    diag: () => ({ app, machine, census: () => machine.census() }),
  };
}
