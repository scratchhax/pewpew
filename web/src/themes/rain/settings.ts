import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * The Rain's own settings. Keys are r-prefixed: every theme shares one saved
 * settings object, so another scene's budgets never leak in here.
 */
export const RAIN_DEFAULTS = {
  rSpeed: 1,                 // fall speed multiplier
  rDensity: 1,               // share of columns that are alive
  rTrail: 12,                // trail length, in cells
  rGlyph: 15,                // glyph cell width in px (the font size)
  rColor: 'event' as string, // event | green | ice
  rFog: true,                // depth fog on the far layers
  rWaves: true,              // rolling brightness waves down the columns
  rFlicker: true,            // trail glyphs mutate while they fade
  rCam: 'fly' as string,     // fall (2D plane) | fly (3D field, camera moves)
  rPan: true,                // slow parallax drift between the layers (fall mode)
  rWeather: true,            // traffic weather drives the downpour

  // soundtrack
  rMusicStyle: 'auto' as string, // auto | drizzle | shower | deluge
  rRainAmb: 0.6,                 // rain hiss bed

  // scene budgets = the HIGH preset
  rFarLayers: 2,             // procedural depth layers behind the log (fall mode)
  rColumns: 64,              // columns in the 3D field (fly mode)
};

export type RainSettings = CoreSettings & typeof RAIN_DEFAULTS;

export const RAIN_BUDGETS: Budgets = {
  low: { rFarLayers: 0, rFlicker: false, rDensity: 0.6, rColumns: 24 },
  medium: { rFarLayers: 1, rFlicker: true, rDensity: 0.8, rColumns: 48 },
  high: { rFarLayers: 2, rFlicker: true, rDensity: 1, rColumns: 64 },
  ultra: { rFarLayers: 3, rFlicker: true, rDensity: 1.2, rColumns: 96 },
};

type Key = keyof typeof RAIN_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });
const select = (key: Key, label: string, options: Array<[string, string]>): Control =>
  ({ kind: 'select', key, label, options });

export const RAIN_MUSIC_STYLES: Array<[string, string]> = [
  ['auto', 'Auto (weather)'],
  ['drizzle', 'Drizzle'],
  ['shower', 'Shower'],
  ['deluge', 'Deluge'],
];

export const RAIN_CONTROLS = {
  scene: [
    range('rSpeed', 'Fall speed', 0.2, 3, 0.05),
    range('rDensity', 'Density', 0.2, 1.5, 0.05),
    range('rTrail', 'Trail length', 4, 30, 1),
    range('rGlyph', 'Glyph size', 10, 28, 1),
    select('rColor', 'Colour', [['event', 'Green, red for blocks'], ['green', 'Classic green'], ['ice', 'Ice']]),
    toggle('rFog', 'Depth fog'), toggle('rWaves', 'Brightness waves'),
    toggle('rFlicker', 'Glyph flicker'),
    select('rCam', 'Camera', [['fall', 'Falling (2D)'], ['fly', 'Fly through (3D)']]),
    toggle('rPan', 'Camera drift'),
    toggle('rWeather', 'Weather is traffic'),
  ],
  budgets: [
    range('rFarLayers', 'Depth layers', 0, 3, 1),
    range('rColumns', 'Fly columns', 8, 96, 8),
  ],
  color: [] as Control[],
  audio: [
    { kind: 'select', key: 'rMusicStyle', label: 'Music', options: RAIN_MUSIC_STYLES } as Control,
    range('rRainAmb', 'Rain hiss', 0, 1, 0.05),
  ],
  colorHint: `The rain keeps its own colours: green for traffic that passes,
        red for blocks, orange for intrusions. Hue shift & intensity stay
        with the HUD.`,
};

/** Stencilled on the rain's readout. */
export const RAIN_HUD: HudLabelOverrides = {
  mark: '≋',
  uplink: 'FEED',
  link: 'RECEIVING',
  weather: { calm: 'DRIZZLE', storm: 'SHOWER', hurricane: 'DELUGE' },
  status: 'THE RAIN',
  threat: 'LEAK',
  power: 'CAPTURE',
  telemetry: 'LOG FEED',
  uptime: 'RAINING FOR',
  contacts: 'HOSTS',
  nodes: 'NODES',
  denied: 'BLOCKED',
  traffic: 'DROPS',
  mostWanted: 'HEAVIEST RAIN',
  noHostiles: '— SKY CLEAR —',
  spectrum: 'STATIC',
  flux: 'DOWNPOUR',
  scan: 'RAINFALL MAP',
  comms: 'RAIN LOG',
  panel: {
    uplink: 'Feed', threatBar: 'Leak / capture', telemetry: 'Log feed',
    mostWanted: 'Heaviest rain', terminal: 'Rain log', oscilloscope: 'Downpour',
    spectrum: 'Static', radar: 'Rainfall map',
  },
};
