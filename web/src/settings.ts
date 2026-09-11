export type MeshMode = 'law' | 'spectrum' | 'mono' | 'warm' | 'cool';

export interface Settings {
  starfield: boolean;
  nebula: boolean;
  dust: boolean;
  constellations: boolean;
  crystals: boolean;
  asteroids: boolean;
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
  noiseMode: boolean;
  gBlock: number;
  gAllow: number;
  gDns: number;
  gWifi: number;
  gDhcp: number;
  deviceMix: number;
  reverb: number;         // hangar reverb wet 0..1
  echo: number;           // dotted-delay level 0..1
  melodyBal: number;      // music bed vs event hits 0..1
  meshMode: MeshMode;     // host-mesh colouring scheme
  hueShift: number;       // rotate mesh/nebula/accent hues 0..360
  colorSat: number;       // colour intensity 0..1
  maxParticles: number;
  speed: number;          // global sim speed multiplier
  demo: boolean;
}

export const DEFAULTS: Settings = {
  starfield: true,
  nebula: true,
  dust: true,
  constellations: true,
  crystals: true,
  asteroids: true,
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
  noiseMode: false,
  gBlock: 1,
  gAllow: 0.8,
  gDns: 1,
  gWifi: 1,
  gDhcp: 1,
  deviceMix: 1,
  reverb: 0.3,
  echo: 0.5,
  melodyBal: 0.65,
  meshMode: 'spectrum',
  hueShift: 0,
  colorSat: 1,
  maxParticles: 4000,
  speed: 1,
  demo: false,
};

const KEY = 'pewpew.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Wipe saved prefs and restore DEFAULTS into the live object (in place). */
export function resetSettings(live: Settings): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  Object.assign(live, DEFAULTS);
}
