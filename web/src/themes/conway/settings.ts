import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Game of Life's own settings. Keys are l-prefixed: every theme shares one
 * saved settings object, so another scene's budgets never leak in here.
 */
export const CONWAY_DEFAULTS = {
  lStep: 150,                // ms per generation
  lSeed: 0.35,               // ambient seeding, 0..1
  lColor: 'event' as string, // event | green | ice
  lFog: true,                // drifting fog haze behind the field
  lWeather: true,            // traffic weather seeds the field

  // soundtrack
  lMusicStyle: 'auto' as string, // auto | drizzle | shower | deluge
  lRainAmb: 0.35,                // rain hiss bed under the beat
};

export type ConwaySettings = CoreSettings & typeof CONWAY_DEFAULTS;

export const CONWAY_BUDGETS: Budgets = {
  low: { lStep: 260, lSeed: 0.25 },
  medium: { lStep: 200, lSeed: 0.3 },
  high: { lStep: 150, lSeed: 0.35 },
  ultra: { lStep: 120, lSeed: 0.4 },
};

type Key = keyof typeof CONWAY_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });
const select = (key: Key, label: string, options: Array<[string, string]>): Control =>
  ({ kind: 'select', key, label, options });

export const CONWAY_MUSIC_STYLES: Array<[string, string]> = [
  ['auto', 'Auto (weather)'],
  ['drizzle', 'Drizzle (trip-hop)'],
  ['shower', 'Shower (big beat)'],
  ['deluge', 'Deluge (industrial)'],
];

export const CONWAY_CONTROLS = {
  scene: [
    range('lStep', 'Generation (ms)', 40, 500, 10),
    range('lSeed', 'Seeding', 0, 1, 0.05),
    select('lColor', 'Colour', [['event', 'Green, red for blocks'], ['green', 'Classic green'], ['ice', 'Ice']]),
    toggle('lFog', 'Fog haze'),
    toggle('lWeather', 'Weather is traffic'),
  ],
  budgets: [] as Control[],
  color: [] as Control[],
  audio: [
    { kind: 'select', key: 'lMusicStyle', label: 'Music', options: CONWAY_MUSIC_STYLES } as Control,
    range('lRainAmb', 'Rain hiss', 0, 1, 0.05),
  ],
  colorHint: `The field keeps its own colours: green for traffic that passes,
        red for blocks, orange for intrusions. Hue shift & intensity stay
        with the HUD.`,
};

/** Stencilled on the field's readout. */
export const CONWAY_HUD: HudLabelOverrides = {
  mark: '❖',
  uplink: 'FEED',
  link: 'EVOLVING',
  weather: { calm: 'SPARSE', storm: 'DENSE', hurricane: 'SWARM' },
  status: 'GAME OF LIFE',
  threat: 'GUN',
  power: 'CAPTURE',
  telemetry: 'GENERATIONS',
  uptime: 'ALIVE FOR',
  contacts: 'HOSTS',
  nodes: 'NODES',
  denied: 'BLOCKS',
  traffic: 'CELLS',
  mostWanted: 'FASTEST GROWING',
  noHostiles: '— FIELD CALM —',
  spectrum: 'STATIC',
  flux: 'BIRTH RATE',
  scan: 'FIELD MAP',
  comms: 'GENERATION LOG',
  panel: {
    uplink: 'Feed', threatBar: 'Gun / capture', telemetry: 'Generations',
    mostWanted: 'Fastest growing', terminal: 'Generation log', oscilloscope: 'Birth rate',
    spectrum: 'Static', radar: 'Field map',
  },
};
