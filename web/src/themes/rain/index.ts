import { Application } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { RAIN_DEFAULTS, RAIN_BUDGETS, RAIN_CONTROLS, RAIN_HUD } from './settings';
import { Rain } from './rain';
import { Rain3D } from './rain3d';
import { rainScore } from './score';

/**
 * The Rain: the firewall log as digital rain, glmatrix style. Two cameras:
 * `fall` is a flat plane of columns with a white spinner at the head and a
 * fading trail, foggy depth layers drifting behind; `fly` is the real thing
 * - a 3D field of log columns the camera moves through, each one carrying a
 * real line that approaches, grows, and passes you. Either way the glyphs
 * are tonight's log: every event writes a line - BLOCK, LOOKUP, LEASE, IDS
 * - green for traffic that passes, red for what gets denied, orange for
 * intrusions. When nothing happens the columns fall as static. The weather
 * is the traffic, so a storm outside is a downpour here, and in fly mode a
 * hurricane is a fast dive through it.
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

  let mode: 'fall' | 'fly' = settings.rCam === 'fall' ? 'fall' : 'fly';
  let scene: Rain | Rain3D = build();

  function build(): Rain | Rain3D {
    const s = mode === 'fly'
      ? new Rain3D(app.screen.width, app.screen.height)
      : new Rain(app.screen.width, app.screen.height);
    s.glyphW = settings.rGlyph;
    s.resize(app.screen.width, app.screen.height);
    app.stage.addChild(s.view);
    return s;
  }

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
    const want: 'fall' | 'fly' = settings.rCam === 'fall' ? 'fall' : 'fly';
    if (want !== mode) {
      mode = want;
      app.stage.removeChild(scene.view);
      scene = build();
      lastW = 0; lastH = 0;
    }
    if (w !== lastW || h !== lastH || scene.dirtyGrid || Math.abs(settings.rGlyph - scene.glyphW) >= 0.5) {
      scene.glyphW = settings.rGlyph;
      scene.resize(w, h);
      lastW = w; lastH = h;
    }

    // the weather is the traffic: storms fall faster and thicker
    const wet = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    const colorMode = settings.rColor === 'green' ? 1 : settings.rColor === 'ice' ? 2 : 0;

    if (mode === 'fly') {
      // the dive is weather too: drizzle drifts through, deluge falls through
      const flySpeed = settings.rWeather ? 0.45 + wet * 1.35 : 0.6;
      const s = scene as Rain3D;
      s.step(dt, { flySpeed, density: settings.rDensity, trail: settings.rTrail });
      s.uniforms(f.t, {
        trail: settings.rTrail,
        fog: settings.rFog,
        colorMode,
        columns: settings.rColumns,
        glyph: settings.rGlyph,
        aspect: w / h,
        vpX: 0.5 + Math.sin(f.t * 0.031) * 0.1,
        vpY: 0.5 + Math.cos(f.t * 0.023) * 0.07,
        wanderX: f.wanderX / w,
        wanderY: f.wanderY / h,
      });
    } else {
      const wSpeed = settings.rWeather ? 1 + wet * 0.7 : 1;
      const wDens = settings.rWeather ? 0.75 + wet * 0.25 : 1;
      const s = scene as Rain;
      s.step(dt, {
        speed: settings.rSpeed,
        density: settings.rDensity,
        trail: settings.rTrail,
        flicker: settings.rFlicker,
        weatherSpeed: wSpeed,
        weatherDensity: wDens,
      });
      s.uniforms(f.t, {
        trail: settings.rTrail,
        waves: settings.rWaves,
        fog: settings.rFog,
        pan: settings.rPan,
        colorMode,
        farLayers: settings.rFarLayers,
      });
      s.wander(f.wanderX / w, f.wanderY / h);
    }

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
