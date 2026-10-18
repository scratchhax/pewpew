import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Clockwork's own settings. Keys are k-prefixed: all themes share one saved
 * settings object.
 */
export const CLOCKWORK_DEFAULTS = {
  kGuide: false,         // draw the causal path as a line (staging aid)
  kDominoes: true,       // the domino run on the top rail
  kCart: true,           // the coal cart leg
  kSteam: true,          // ambient steam from the valves
  kSideEffects: true,    // gates, bells and whistles hung off the main run

  // soundtrack
  kMusicStyle: 'auto' as string,
  kMusicRotate: 5,
  kSfx: 0.8,
  kAmb: 0.5,

  // scene budgets = the HIGH preset
  kMaxTokens: 14,        // bearings in flight along the run at once
  kMaxParticles: 400,
  kSteamDensity: 1,
};

export const CLOCKWORK_BUDGETS: Budgets = {
  low: { kMaxTokens: 5, kMaxParticles: 110, kSteamDensity: 0.35 },
  medium: { kMaxTokens: 9, kMaxParticles: 240, kSteamDensity: 0.65 },
  high: { kMaxTokens: 14, kMaxParticles: 400, kSteamDensity: 1 },
  ultra: { kMaxTokens: 22, kMaxParticles: 700, kSteamDensity: 1.5 },
};

type Key = keyof typeof CLOCKWORK_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const CLOCKWORK_CONTROLS = {
  scene: [
    toggle('kDominoes', 'Domino run'),
    toggle('kCart', 'Coal cart'),
    toggle('kSideEffects', 'Gates, bells and whistles'),
    toggle('kSteam', 'Valve steam'),
    toggle('kGuide', 'Show the causal path'),
  ],
  budgets: [
    range('kMaxTokens', 'Bearings on the run', 3, 30, 1),
    range('kMaxParticles', 'Particles', 60, 900, 20),
    range('kSteamDensity', 'Steam density', 0, 2, 0.05),
  ],
  color: [],
};

/**
 * The shared HUD, renamed for a boiler room. Kept from the first attempt at
 * this scene: the panel vocabulary was the part of it that worked.
 */
export const CLOCKWORK_HUD: HudLabelOverrides = {
  uplink: 'MACHINE',
  link: 'FIRED UP',
  weather: { calm: 'IDLE TICK', storm: 'PRESSURE BUILD', hurricane: 'FULL STEAM' },
  status: 'PRESSURE',
  threat: 'ALARM',
  power: 'FIRE',
  telemetry: 'STOKED',
  uptime: 'RUN TIME',
  contacts: 'THE RACK',
  nodes: 'POST',
  denied: 'DENIED',
  traffic: 'COAL',
  mostWanted: 'WORST OFFENDERS',
  noHostiles: '- ALL IS TICKING -',
  spectrum: 'GAUGES',
  flux: 'PRESSURE',
  scan: 'CLUTCH',
  comms: 'MACHINE LOG',
  panel: {
    uplink: 'Machine status', threatBar: 'Alarm / fire meters', telemetry: 'Stoked today',
    mostWanted: 'Worst offenders', terminal: 'Machine log', oscilloscope: 'Pressure',
    spectrum: 'Gauges', radar: 'Clutch',
  },
};
