export type MeshMode = 'law' | 'spectrum' | 'mono' | 'warm' | 'cool';
/** Performance tier. `auto` picks one at boot and steps down if frames drop;
 *  `custom` means the individual perf values below are the user's own. */
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type PowerPref = 'low-power' | 'default' | 'high-performance';

export interface Settings {
  starfield: boolean;
  nebula: boolean;
  dust: boolean;
  constellations: boolean;
  crystals: boolean;
  asteroids: boolean;
  threatMissiles: boolean;   // IDS threats fly looping attack paths into the core
  ringObjects: boolean;
  apCores: boolean;
  terminal: boolean;
  oscilloscope: boolean;
  spectrum: boolean;
  radar: boolean;
  telemetry: boolean;
  mostWanted: boolean;
  uplink: boolean;
  threatBar: boolean;
  eventStars: boolean;
  planets: boolean;
  screenShake: boolean;
  scanlines: boolean;
  ambientShips: boolean;
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
  meshMode: MeshMode;     // host-mesh colouring scheme
  hueShift: number;       // rotate mesh/nebula/accent hues 0..360
  colorSat: number;       // colour intensity 0..1
  speed: number;          // global sim speed multiplier
  demo: boolean;

  // ── performance (see perf.ts for the preset table) ──
  quality: Quality;
  renderScale: number;    // canvas pixels per CSS pixel (1 = today's look)
  fpsCap: number;         // 0 = uncapped
  antialias: boolean;     // renderer init only: needs a reload
  powerPref: PowerPref;   // renderer init only: needs a reload
  maxParticles: number;
  starDensity: number;    // multiplier on the screen-area star count
  nebulaCount: number;
  dustCount: number;
  fxDetail: number;       // 0..1: station aura/sparks, crystal trails & mist
  maxIpStars: number;     // constellation node cap
  maxEventStars: number;
}

export const DEFAULTS: Settings = {
  starfield: true,
  nebula: true,
  dust: true,
  constellations: true,
  crystals: true,
  asteroids: true,
  threatMissiles: true,
  ringObjects: true,
  apCores: true,
  terminal: true,
  oscilloscope: true,
  spectrum: true,
  radar: true,
  telemetry: true,
  mostWanted: true,
  uplink: true,
  threatBar: true,
  eventStars: true,
  planets: true,
  screenShake: true,
  scanlines: false,
  ambientShips: true,
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
  meshMode: 'spectrum',
  hueShift: 0,
  colorSat: 1,
  speed: 1,
  demo: false,

  // perf values = the HIGH preset, i.e. exactly how the scene ran before
  // presets existed; `auto` overwrites them at boot
  quality: 'auto',
  renderScale: 1,
  fpsCap: 0,
  antialias: false,
  powerPref: 'low-power',
  maxParticles: 4000,
  starDensity: 1,
  nebulaCount: 7,
  dustCount: 70,
  fxDetail: 1,
  maxIpStars: 140,
  maxEventStars: 260,
};

const KEY = 'pewpew.settings.v1';

/** Keys pinned by URL params for this page load: never written to storage. */
const locked = new Set<keyof Settings>();
export function lockSetting(key: keyof Settings): void { locked.add(key); }
export function isLocked(key: keyof Settings): boolean { return locked.has(key); }

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Saved before presets existed: a hand-tuned particle budget means the
      // user already chose their own perf, so keep it instead of auto.
      if (saved.quality === undefined && saved.maxParticles !== undefined &&
          saved.maxParticles !== DEFAULTS.maxParticles) {
        saved.quality = 'custom';
      }
      return { ...DEFAULTS, ...saved };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    let out: Partial<Settings> = s;
    if (locked.size > 0) {
      // URL overrides are per-load: keep whatever was stored before for those
      const prev = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...s };
      for (const k of locked) {
        if (k in prev) merged[k] = prev[k]; else delete merged[k];
      }
      out = merged as Partial<Settings>;
    }
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch { /* ignore */ }
}

/** Wipe saved prefs and restore DEFAULTS into the live object (in place). */
export function resetSettings(live: Settings): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  Object.assign(live, DEFAULTS);
}
