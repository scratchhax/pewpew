import { CORE_DEFAULTS, CoreSettings, ThemeSettings, loadSettings, saveSettings } from './settings';
import { resolveBootPerf, applyTier, guessTier, perfKeys, AutoTuner } from './perf';
import { State } from './state';
import { Feed } from './ws';
import { classify } from './events';
import { Throttle } from './throttle';
import { FrameLoop } from './loop';
import { hsl } from './palette';
import { Hud, hudLabels } from './hud/hud';
import { Audio } from './audio';
import { SettingsPanel } from './hud/settingsPanel';
import { mountTrackUi } from './hud/trackUi';
import { analyseTrack, listTracks, saveMeta, trackUrl, type TrackListing } from './tracks';
import type { Theme } from './theme';
import type { NetEvent } from './types';

/**
 * Boot the viewer with a theme. Everything here is theme-independent: the
 * feed, classification, sim state, HUD, audio, settings, quality presets and
 * the frame loop. The theme only draws.
 */
export async function boot<T extends ThemeSettings>(theme: Theme<T>): Promise<void> {
  const defaults = { ...CORE_DEFAULTS, ...theme.defaults } as CoreSettings & T;
  const keys = perfKeys(theme.budgets);
  const settings = loadSettings(defaults, keys.filter((k) => k in theme.defaults));
  const state = new State();
  const params = new URLSearchParams(location.search);
  // quality tier is settled before the renderer exists: antialias and GPU
  // power preference can only be chosen at init
  const bootPerf = resolveBootPerf(settings, theme.budgets);
  const initAntialias = settings.antialias;
  const initPowerPref = settings.powerPref;

  document.body.dataset.theme = theme.id;
  const labels = hudLabels(theme.hud);
  const hud = new Hud(settings, labels);
  const audio = new Audio(settings, theme.score);
  hud.attachAudio(audio);
  const throttle = new Throttle();

  const scene = await theme.create(
    { settings, state, throttle, audio, mount: document.getElementById('app')! },
    { antialias: settings.antialias, powerPref: settings.powerPref, resolution: settings.renderScale },
  );
  if (params.has('diag')) (window as any).__diag = { ...scene.diag?.() };

  // HUD accent follows the colour knobs (event-law colours stay fixed)
  function applyColors(): void {
    const hex = hsl((theme.accentHue ?? 172) + settings.hueShift, 0.8 * settings.colorSat, 0.61);
    const css = `#${hex.toString(16).padStart(6, '0')}`;
    document.documentElement.style.setProperty('--accent', css);
  }
  applyColors();

  const loop = new FrameLoop(onFrame);

  /** Push every live perf value into the loop and the theme (idempotent). */
  function applyPerf(): void {
    loop.maxFps = settings.fpsCap;
    scene.setResolution(settings.renderScale);
    scene.applyBudgets();
  }
  applyPerf();

  const tuner = new AutoTuner(settings, theme.budgets, bootPerf, (tier) => {
    console.info(`[pewpew] auto quality: frames low, stepping down to ${tier}`);
    applyPerf();
    scene.settingsChanged('quality');
    panel.refresh();
  });
  if (params.has('diag')) Object.assign((window as any).__diag, { settings, tuner, loop, scene });

  const panel = new SettingsPanel(settings, { ...theme, hudToggles: labels.panel }, defaults, keys, (key) => {
    // key undefined = reset to defaults: re-resolve everything
    if (key === 'quality' || key === undefined) {
      if (settings.quality === 'auto') {
        const g = guessTier(bootPerf.gpu);
        bootPerf.why = g.why;
        applyTier(settings, theme.budgets, g.tier);
        tuner.reset(g.tier);
      } else if (settings.quality === 'custom') {
        tuner.reset(null);
      } else {
        applyTier(settings, theme.budgets, settings.quality);
        tuner.reset(settings.quality);
      }
      saveSettings(settings);
    }
    hud.applySettings(settings);
    audio.setVolume(settings.volume);
    audio.setReverb(settings.reverb);
    audio.setEcho(settings.echo);
    audio.setEnabled(settings.audio);
    audio.setTrackVolume(settings.trackVolume);
    scene.settingsChanged(key);
    applyColors();
    applyPerf();
  }, () => ({
    tier: settings.quality === 'custom' ? null : tuner.tier,
    why: bootPerf.why,
    reloadNeeded: settings.antialias !== initAntialias || settings.powerPref !== initPowerPref,
  }), (el) => mountTrackUi(el, { themeId: theme.id, themeTitle: theme.title, listing: () => trackListing, refresh: syncTracks }));

  // ── background tracks: the relay says which track this theme plays; every screen follows ──
  let trackListing: TrackListing | null = null;
  let analysing: string | null = null;
  async function syncTracks(): Promise<void> {
    trackListing = await listTracks();
    const name = trackListing?.assign[theme.id] ?? null;
    const info = name ? trackListing!.tracks.find((t) => t.name === name) : undefined;
    if (!name || !info) { audio.setTrack(null); return; }
    if (!info.meta) {
      // nobody has analysed it yet (e.g. uploaded with curl): do it here, once, and share the result
      if (analysing === name) return;
      analysing = name;
      try {
        const meta = await analyseTrack(name);
        await saveMeta(name, meta);
        info.meta = meta;
      } catch (err) {
        console.warn('[pewpew] track analysis failed', err);
        return;
      } finally {
        analysing = null;
      }
    }
    audio.setTrack(name, trackUrl(name), info.meta);
  }
  void syncTracks();
  setInterval(() => { void syncTracks(); }, 20_000);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); panel.toggle(); }
  });

  // ── event pipeline: HUD log + audio see every event; the theme decides
  // what's worth drawing (with the throttle) ──
  function route(ev: NetEvent, replay = false): void {
    if (!replay) hud.log(ev);
    const se = classify(ev);
    if (!se) return;
    if (!replay && settings.noiseGate > 0) {
      // noise gate screams at the raw feed — every connection may be heard
      // (density = noiseGate), independent of what the theme draws
      const k = se.kind === 'threat' || se.kind === 'block' ? 'block'
        : se.kind === 'system' ? null : se.kind;
      if (k) audio.cueNoise(k, ev.src_ip ?? undefined);
    }
    state.onEvent(se.kind === 'dns' || se.kind === 'dhcp' ? 'net'
      : se.kind === 'wifi' ? (se.wifi === 'bad' ? 'wifi-bad' : se.wifi === 'joined' ? 'wifi-good' : 'net')
      : se.kind);
    scene.event(se, replay);
  }

  let routed = 0;
  let frames = 0, worstFrameMs = 0;
  const feed = new Feed(
    (ev, meta) => { routed++; if (meta?.demo) hud.showDemo(true); route(ev, false); },
    (events, meta) => {
      if (meta?.demo) hud.showDemo(true);
      hud.setConnected(true);
      for (const ev of events) route(ev, true);
    },
  );
  if (feed.demoMode) { hud.setConnected(true); hud.showDemo(true); }

  if (params.has('debug')) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:50%;transform:translateX(-50%);bottom:6px;
      z-index:50;font:11px monospace;color:#7fd4ff;background:rgba(0,0,0,0.65);
      padding:4px 12px;letter-spacing:1px;display:flex;align-items:center;gap:10px;
      white-space:nowrap;max-width:calc(100vw - 12px);overflow:hidden;`;
    const perfTxt = document.createElement('span');
    d.appendChild(perfTxt);
    const txt = document.createElement('span');
    const btn = document.createElement('button');
    btn.textContent = 'TEST';
    btn.style.cssText = `font:10px monospace;background:#08202e;color:#7fd4ff;
      border:1px solid rgba(127,212,255,0.35);cursor:pointer;padding:1px 8px;`;
    btn.addEventListener('click', () => audio.testTone());
    d.appendChild(txt);
    d.appendChild(btn);
    document.body.appendChild(d);
    setInterval(() => {
      const s = audio.dbgStats();
      const sp = Math.min(400, Math.max(60, 1000 / Math.max(0.5, s.rate))).toFixed(0);
      txt.textContent = `routed ${routed}/s | cues ${s.cues} fires ${s.fires}`
        + ` | q ${s.queue} sp ${sp}ms | alive ${s.alive} drop ${s.dropped}`
        + ` | rms ${s.rms.toFixed(3)} | ${__BUILD__}`;
      routed = 0;
      const tier = settings.quality === 'custom' ? 'CUSTOM'
        : `${settings.quality === 'auto' ? 'AUTO:' : ''}${(tuner.tier ?? '').toUpperCase()}`;
      const extra = Object.entries(scene.stats()).map(([k, v]) => ` | ${k} ${v}`).join('');
      perfTxt.textContent = `${frames} fps | worst ${worstFrameMs.toFixed(0)}ms`
        + ` | ${tier} x${settings.renderScale} cap ${settings.fpsCap || '-'}${extra} |`;
      frames = 0; worstFrameMs = 0;
    }, 1000);
  }

  // ── main loop ──
  // Anti burn-in: very slow ~±2% screen wander (+ occasional anchor reshuffle)
  // so no pixel pattern is ever painted in exactly the same place.
  let wanderSeed = Math.random() * Math.PI * 2;
  let nextAnchorShuffle = performance.now() + 10 * 60_000;
  const hudEl = document.getElementById('hud')!;

  function onFrame(now: number, elapsedMs: number): void {
    tuner.frame(now);
    frames++;
    worstFrameMs = Math.max(worstFrameMs, elapsedMs);
    const dtReal = Math.min(0.05, elapsedMs / 1000);
    state.update(dtReal);
    const dt = dtReal * settings.speed * state.timeScale;
    const t = now / 1000;
    const w = window.innerWidth, h = window.innerHeight;

    const wanderX = Math.sin(t * 0.07 + wanderSeed) * w * 0.02;
    const wanderY = Math.cos(t * 0.053 + wanderSeed) * h * 0.02;
    if (performance.now() > nextAnchorShuffle) {
      wanderSeed = Math.random() * Math.PI * 2;
      nextAnchorShuffle = performance.now() + 10 * 60_000;
    }

    audio.update(state);
    scene.frame({ dt, dtReal, t, wanderX, wanderY });
    hudEl.style.transform = `translate(${(wanderX * 0.4).toFixed(1)}px, ${(wanderY * 0.4).toFixed(1)}px)`;
    hud.update(dt, state, settings);
  }
  loop.start();
}
