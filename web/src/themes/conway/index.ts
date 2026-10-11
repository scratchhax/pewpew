import { Application } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { CONWAY_DEFAULTS, CONWAY_BUDGETS, CONWAY_CONTROLS, CONWAY_HUD } from './settings';
import { LifeScene } from './life';
import { conwayScore } from './score';

/**
 * Game of Life: Conway's automaton played with the firewall log. Every
 * live cell is a glyph from tonight's traffic - green for what passes, red
 * for what burns - and events drop patterns instead of lines: a PASS glides
 * across as a glider, a BLOCK settles into a still life, an IDS alarm drops
 * a Gosper gun spraying gliders forever. Newborn cells flash white and
 * elders cool to embers, so the generations are visible as flow. The
 * weather is the traffic: drizzle leaves the field sparse, a hurricane
 * seeds it into soup - until the population's own predator thins it.
 */
export const conway: Theme<typeof CONWAY_DEFAULTS> = {
  id: 'conway',
  title: 'GAME OF LIFE',
  hud: CONWAY_HUD,
  accentHue: 130,
  defaults: CONWAY_DEFAULTS,
  budgets: CONWAY_BUDGETS,
  controls: CONWAY_CONTROLS,
  score: conwayScore,
  create,
};
export default conway;

async function create(host: ThemeHost<typeof CONWAY_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, audio } = host;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#000000',
    antialias: false,
    preference: 'webgl',
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);

  const scene = new LifeScene(app.screen.width, app.screen.height);
  app.stage.addChild(scene.view);

  // an intrusion keeps the sky lit for a while
  let threatT = 0;

  function lineFor(e: SceneEvent): { line: string; cls: number } {
    const ev = e.ev;
    switch (e.kind) {
      case 'threat':
        return { line: `IDS ${ev.rule_name || ev.rule_desc || 'intrusion'} < ${ev.src_ip ?? '?'}`, cls: 2 };
      case 'block':
        return { line: `BLOCK ${ev.dst_ip ?? '?'} < ${ev.src_ip ?? '?'} ${ev.service_name ?? ''}`, cls: 1 };
      case 'dns':
        return ev.dns_blocked
          ? { line: `DENY ${ev.dns_query ?? '?'}`, cls: 1 }
          : { line: `LOOKUP ${ev.dns_query ?? '?'}${ev.dns_answer ? ` > ${ev.dns_answer}` : ''}`, cls: 0 };
      case 'dhcp':
        return { line: `LEASE ${ev.hostname || ev.mac_address || '?'} ${ev.src_ip ?? ''}`, cls: 0 };
      case 'wifi':
        return { line: `JOINED ${ev.hostname || ev.mac_address || '?'}`, cls: 0 };
      case 'allow':
        return { line: `PASS ${ev.dst_ip ?? '?'} < ${ev.src_ip ?? '?'} ${ev.service_name ?? ''}`, cls: 0 };
      default:
        return { line: `SYS ${ev.syslog_host || ev.rule_desc || 'node'}`, cls: 0 };
    }
  }

  function event(e: SceneEvent): void {
    const { line, cls } = lineFor(e);
    scene.push(line, cls);
    scene.seedEvent(e.kind, cls);
    audio.cueSong(e.kind, e.ev.src_ip ?? e.ev.dst_ip ?? undefined);
    if (e.kind === 'threat') threatT = 6;
  }

  let lastW = 0, lastH = 0;

  function frame(f: FrameInfo): void {
    const dt = f.dt;
    const w = app.screen.width, h = app.screen.height;
    if (w !== lastW || h !== lastH) {
      scene.resize(w, h);
      lastW = w; lastH = h;
    }

    // the weather is the traffic: storms seed the field harder
    const wet = settings.lWeather ? (state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0) : 0;
    const colorMode = settings.lColor === 'green' ? 1 : settings.lColor === 'ice' ? 2 : 0;

    scene.step(dt, { stepMs: settings.lStep, seed: settings.lSeed, wet });
    scene.uniforms(f.t, {
      fog: settings.lFog,
      colorMode,
      resX: w * app.renderer.resolution,
      resY: h * app.renderer.resolution,
      wanderX: f.wanderX / w,
      wanderY: f.wanderY / h,
    });

    threatT = Math.max(0, threatT - f.dtReal);
    audio.setThreatActive(threatT > 0);

    app.render();
  }

  return {
    event,
    frame,
    applyBudgets() {},
    settingsChanged() {},
    setResolution(scale) {
      if (app.renderer.resolution !== scale) app.renderer.resolution = scale;
    },
    stats: () => ({ cells: scene.cols * scene.rows }),
    diag: () => ({ app, conway: scene, audio }),
  };
}
