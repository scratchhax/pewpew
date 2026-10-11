import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Net Fighter's own settings. Keys are a-prefixed: every theme shares one
 * saved settings object, so another scene's budgets never leak in here.
 */
export const NETFIGHTER_DEFAULTS = {
  aSpeed: 1,                   // fight tempo multiplier
  aWeather: true,              // traffic weather: rain, lightning, mood
  aMusicStyle: 'auto' as string, // auto | sparring | intense | boss

  // scene budgets = the HIGH preset
  aRain: 1,                    // rain density, 0..1
};

export type NetFighterSettings = CoreSettings & typeof NETFIGHTER_DEFAULTS;

export const NETFIGHTER_BUDGETS: Budgets = {
  low: { aRain: 0.4 },
  medium: { aRain: 0.7 },
  high: { aRain: 1 },
  ultra: { aRain: 1 },
};

type Key = keyof typeof NETFIGHTER_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });
const select = (key: Key, label: string, options: Array<[string, string]>): Control =>
  ({ kind: 'select', key, label, options });

export const NETFIGHTER_MUSIC_STYLES: Array<[string, string]> = [
  ['auto', 'Auto (weather)'],
  ['sparring', 'Sparring (groove)'],
  ['intense', 'Intense (fight theme)'],
  ['boss', 'Boss (heavy)'],
];

export const NETFIGHTER_CONTROLS = {
  scene: [
    range('aSpeed', 'Fight tempo', 0.5, 2, 0.05),
    toggle('aWeather', 'Weather is traffic'),
  ],
  budgets: [
    range('aRain', 'Rain density', 0, 1, 0.05),
  ],
  color: [] as Control[],
  audio: [
    { kind: 'select', key: 'aMusicStyle', label: 'Music', options: NETFIGHTER_MUSIC_STYLES } as Control,
  ],
  colorHint: `The fight keeps its own colours: green for Traffic, red for
        Firewall. Hue shift & intensity stay with the HUD.`,
};

/** Stencilled on the fight's readout. */
export const NETFIGHTER_HUD: HudLabelOverrides = {
  mark: '⚡',
  uplink: 'FEED',
  link: 'LIVE FIGHT',
  weather: { calm: 'WARM-UP', storm: 'MAIN EVENT', hurricane: 'FINAL BOSS' },
  status: 'NET FIGHTER',
  threat: 'SUPER',
  power: 'CAPTURE',
  telemetry: 'ROUND STATS',
  uptime: 'FIGHTING FOR',
  contacts: 'HOSTS',
  nodes: 'FANS',
  denied: 'BLOCKS LANDED',
  traffic: 'HITS',
  mostWanted: 'FAVOURITE FIGHTER',
  noHostiles: '— SPARRING —',
  spectrum: 'CROWD NOISE',
  flux: 'COMBO',
  scan: 'STAGE MAP',
  comms: 'PLAY-BY-PLAY',
  panel: {
    uplink: 'Feed', threatBar: 'Super meter', telemetry: 'Round stats',
    mostWanted: 'Favourite fighter', terminal: 'Play-by-play', oscilloscope: 'Combo',
    spectrum: 'Crowd noise', radar: 'Stage map',
  },
};
