import { Application } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { RAIN_DEFAULTS, RAIN_BUDGETS, RAIN_CONTROLS, RAIN_HUD } from './settings';
import { Rain } from './rain';
import { rainScore } from './score';

/**
 * The Rain: the firewall log as digital rain, glmatrix style - columns of
 * glyphs falling out of the dark with a white spinner at the head and a
 * fading trail behind it, depth layers drifting behind the near one. The
 * glyphs are not the matrix: they are tonight's log. Every event writes a
 * line - BLOCK, LOOKUP, LEASE, IDS - and the columns carry it down the
 * screen one character at a time, green for traffic that passes, red for
 * what gets denied, orange for intrusions. When nothing happens the columns
 * fall as static. The weather is the traffic, so a storm outside is a
 * downpour here.
 */
export const rain: Theme<typeof RAIN_DEFAULTS> = {
  id: 'rain',
  title: 'THE RAIN',
  hud: RAIN_HUD,
  accentHue: 130,
  defaults: RAIN_DEFAULTS,
  budgets: RAIN_BUDGETS,
  controls: RAIN_CONTROLS,
  score: rainScore,
  create,
};
export default rain;

async function create(host: ThemeHost<typeof RAIN_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
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

  const scene = new Rain(app.screen.width, app.screen.height);
  scene.glyphW = settings.rGlyph;
  scene.resize(app.screen.width, app.screen.height);
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
    audio.cueSong(e.kind, e.ev.src_ip ?? e.ev.dst_ip ?? undefined);
    if (e.kind === 'threat') threatT = 6;
  }

  let lastW = 0, lastH = 0;

  function frame(f: FrameInfo): void {
    const dt = f.dt;
    const w = app.screen.width, h = app.screen.height;
    if (w !== lastW || h !== lastH || scene.dirtyGrid || Math.abs(settings.rGlyph - scene.glyphW) >= 0.5) {
      scene.glyphW = settings.rGlyph;
      scene.resize(w, h);
      lastW = w; lastH = h;
    }

    // the weather is the traffic: storms fall faster and thicker
    const wet = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    const wSpeed = settings.rWeather ? 1 + wet * 0.7 : 1;
    const wDens = settings.rWeather ? 0.75 + wet * 0.25 : 1;

    scene.step(dt, {
      speed: settings.rSpeed,
      density: settings.rDensity,
      trail: settings.rTrail,
      flicker: settings.rFlicker,
      weatherSpeed: wSpeed,
      weatherDensity: wDens,
    });
    scene.uniforms(f.t, {
      trail: settings.rTrail,
      waves: settings.rWaves,
      fog: settings.rFog,
      pan: settings.rPan,
      colorMode: settings.rColor === 'green' ? 1 : settings.rColor === 'ice' ? 2 : 0,
      farLayers: settings.rFarLayers,
    });
    scene.wander(f.wanderX / w, f.wanderY / h);

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
    stats: () => ({ cols: scene.cols, rows: scene.rows }),
    diag: () => ({ app, rain: scene, audio }),
  };
}
