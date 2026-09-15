/** Performance tier. `auto` picks one at boot and steps down if frames drop;
 *  `custom` means the individual perf values are the user's own. */
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type PowerPref = 'low-power' | 'default' | 'high-performance';

/**
 * Settings every viewer theme shares: HUD panels, audio, the global tint and
 * the renderer side of the quality system. A theme adds its own keys (scene
 * toggles, scene budgets) and all of them live in ONE saved object, so HUD and
 * audio preferences carry across themes and old saves keep loading.
 */
export interface CoreSettings {
  terminal: boolean;
  oscilloscope: boolean;
  spectrum: boolean;
  radar: boolean;
  telemetry: boolean;
  mostWanted: boolean;
  uplink: boolean;
  threatBar: boolean;
  scanlines: boolean;
  audio: boolean;
  volume: number;
  melody: boolean;
  deviceVoices: boolean;
  noiseGate: number;      // chaos: fraction of raw events that fire noise 0..1
  gBlock: number;
  gAllow: number;
  gDns: number;
  gWifi: number;
  gDhcp: number;
  gThreat: number;
  gateBlock: number;      // per-type gate openness 0..1 (1 = every hit passes)
  gateAllow: number;
  gateDns: number;
  gateWifi: number;
  gateDhcp: number;
  gateThreat: number;
  deviceMix: number;
  reverb: number;         // hangar reverb wet 0..1
  echo: number;           // dotted-delay level 0..1
  melodyBal: number;      // music bed vs event hits 0..1
  trackVolume: number;    // uploaded background track level 0..1
  hueShift: number;       // rotate theme/HUD accent hues 0..360
  colorSat: number;       // colour intensity 0..1
  speed: number;          // global sim speed multiplier
  demo: boolean;

  // ── performance: renderer side (see perf.ts; themes add scene budgets) ──
  quality: Quality;
  renderScale: number;    // canvas pixels per CSS pixel (1 = classic look)
  fpsCap: number;         // 0 = uncapped
  antialias: boolean;     // renderer init only: needs a reload
  powerPref: PowerPref;   // renderer init only: needs a reload
}

/** A theme's own settings bag: flat keys of simple values. */
export type ThemeSettings = Record<string, boolean | number | string>;

export const CORE_DEFAULTS: CoreSettings = {
  terminal: true,
  oscilloscope: true,
  spectrum: true,
  radar: true,
  telemetry: true,
  mostWanted: true,
  uplink: true,
  threatBar: true,
  scanlines: false,
  audio: true,
  volume: 0.5,
  melody: true,
  deviceVoices: true,
  noiseGate: 0,
  gBlock: 1,
  gAllow: 0.8,
  gDns: 1,
  gWifi: 1,
  gDhcp: 1,
  gThreat: 1,
  gateBlock: 1,
  gateAllow: 1,
  gateDns: 1,
  gateWifi: 1,
  gateDhcp: 1,
  gateThreat: 1,
  deviceMix: 1,
  reverb: 0.3,
  echo: 0.5,
  melodyBal: 0.65,
  trackVolume: 0.8,
  hueShift: 0,
  colorSat: 1,
  speed: 1,
  demo: false,

  // renderer perf values = the HIGH preset; `auto` overwrites them at boot
  quality: 'auto',
  renderScale: 1,
  fpsCap: 0,
  antialias: false,
  powerPref: 'low-power',
};

const KEY = 'pewpew.settings.v1';

/** Keys pinned by URL params for this page load: never written to storage. */
const locked = new Set<string>();
export function lockSetting(key: string): void { locked.add(key); }
export function isLocked(key: string): boolean { return locked.has(key); }

/**
 * Load saved settings over `defaults` (core + theme). `perfKeys` are the
 * theme's scene-budget keys: a save from before quality presets existed that
 * hand-tuned one of them keeps its numbers as `custom` instead of auto.
 */
export function loadSettings<S extends CoreSettings>(defaults: S, perfKeys: string[]): S {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const d = defaults as unknown as Record<string, unknown>;
      if (saved.quality === undefined &&
          perfKeys.some((k) => saved[k] !== undefined && saved[k] !== d[k])) {
        saved.quality = 'custom';
      }
      return { ...defaults, ...saved } as S;
    }
  } catch { /* ignore */ }
  return { ...defaults };
}

export function saveSettings(s: CoreSettings): void {
  try {
    let out: Record<string, unknown> = { ...s };
    if (locked.size > 0) {
      // URL overrides are per-load: keep whatever was stored before for those
      const prev = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
      for (const k of locked) {
        if (k in prev) out[k] = prev[k]; else delete out[k];
      }
    }
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch { /* ignore */ }
}

/** Wipe saved prefs and restore `defaults` into the live object (in place). */
export function resetSettings<S extends CoreSettings>(live: S, defaults: S): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  Object.assign(live, defaults);
}
