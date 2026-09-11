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
  deviceVoices: boolean;
  noiseMode: boolean;
  melodyWithNoise: boolean;
  gBlock: number;
  gAllow: number;
  gDns: number;
  gWifi: number;
  gDhcp: number;
  deviceMix: number;
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
  deviceVoices: true,
  noiseMode: false,
  melodyWithNoise: true,
  gBlock: 1,
  gAllow: 0.8,
  gDns: 1,
  gWifi: 1,
  gDhcp: 1,
  deviceMix: 1,
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
