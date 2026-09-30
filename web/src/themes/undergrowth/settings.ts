import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Undergrowth's own settings. Keys are u-prefixed: every theme shares one
 * saved settings object, so another scene's budgets never leak in here.
 * The mAmbience/mBells/mPadDepth keys are the shared mycelium score's own
 * knobs — this scene flies over the same garden it renders.
 */
export const UNDERGROWTH_DEFAULTS = {
  uHyphae: true,        // allow → light pulses run the threads you fly between
  uBlooms: true,        // dns → a mushroom rises at a busy junction
  uSprouts: true,       // dhcp → a new host takes root
  uSpores: true,        // wifi → spore light drifts off the gateway
  uScorch: true,        // block → a scorch scar where the flow ran
  uBlight: true,        // threat → a blight fog crawls the web
  uLabels: true,        // host and domain labels
  uAurora: true,        // an aurora ripples across the sky above the mat
  uFocus: true,         // the camera drifts toward fresh blooms and blights
  uPersist: true,       // the garden survives reloads (shared with the Mycelium scene)

  uCamSpeed: 5,         // flight speed through the mat, world units/s (a crossing of the mat in ~20 s)
  uGlow: 1,             // overall bioluminescence
  uSporeDrift: 1,       // ambient spores and dust

  uFadeMin: 20,         // hypha memory half-life in minutes: how fast neglect shows

  // soundtrack (the shared mycelium score)
  mAmbience: 0.7,       // undergrowth hiss + wind bed
  mBells: 0.8,          // glass bells the events ring
  mPadDepth: 0.6,       // drone depth

  // scene budgets = the HIGH preset
  uMaxNodes: 40,
  uMaxEdges: 8000,
  uMaxPulses: 380,
  uMaxBlooms: 10,
  uDust: 1200,          // ambient dust motes in the void
};

export type UndergrowthSettings = CoreSettings & typeof UNDERGROWTH_DEFAULTS;

export const UNDERGROWTH_BUDGETS: Budgets = {
  low: { uMaxNodes: 24, uMaxEdges: 3000, uMaxPulses: 120, uMaxBlooms: 5, uDust: 400 },
  medium: { uMaxNodes: 32, uMaxEdges: 5000, uMaxPulses: 220, uMaxBlooms: 7, uDust: 700 },
  high: { uMaxNodes: 40, uMaxEdges: 8000, uMaxPulses: 380, uMaxBlooms: 10, uDust: 1200 },
  ultra: { uMaxNodes: 60, uMaxEdges: 12000, uMaxPulses: 700, uMaxBlooms: 16, uDust: 2200 },
};

type Key = keyof typeof UNDERGROWTH_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const UNDERGROWTH_CONTROLS = {
  scene: [
    toggle('uHyphae', 'Light pulses'), toggle('uBlooms', 'DNS blooms'),
    toggle('uSprouts', 'DHCP sprouts'), toggle('uSpores', 'Wi-Fi spores'),
    toggle('uScorch', 'Block scorch'), toggle('uBlight', 'Threat blight'),
    toggle('uLabels', 'Labels'), toggle('uFocus', 'Follow events'), toggle('uPersist', 'Keep the garden'),
    toggle('uAurora', 'Aurora sky'),
  ],
  budgets: [
    range('uCamSpeed', 'Flight speed', 2, 30, 0.5),
    range('uGlow', 'Bioluminescence', 0.2, 2, 0.05),
    range('uSporeDrift', 'Spore drift', 0, 2, 0.05),
    range('uFadeMin', 'Hypha half-life (minutes)', 5, 120, 5),
    range('uMaxNodes', 'Hosts', 8, 60, 1),
    range('uMaxEdges', 'Filaments', 1500, 15000, 500),
    range('uMaxPulses', 'Light pulses', 60, 700, 20),
    range('uMaxBlooms', 'Blooms', 3, 16, 1),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. The garden's own
    palette (teal threads, cream blooms, violet-grey blocks, red blight) stays
    fixed so the colour law holds.`,
  audio: [
    range('mAmbience', 'Undergrowth', 0, 1, 0.05),
    range('mBells', 'Bells', 0, 1, 0.05),
    range('mPadDepth', 'Drone depth', 0, 1, 0.05),
  ],
};

/** Field notes from inside the mat. */
export const UNDERGROWTH_HUD: HudLabelOverrides = {
  mark: '❋',
  uplink: 'CLIMATE',
  link: 'UNDERGROWTH',
  weather: { calm: 'STILL', storm: 'DRUZZY', hurricane: 'SPORING' },
  status: 'COLONY',
  threat: 'BLT',
  power: 'VIG',
  telemetry: 'FIELD NOTES',
  uptime: 'GROWING',
  contacts: 'HOSTS',
  nodes: 'NODES',
  denied: 'SCORCHED',
  traffic: 'FLUX',
  mostWanted: 'GREATEST HUBS',
  noHostiles: '— DORMANT —',
  spectrum: 'SPORE SPECTRUM',
  flux: 'PULSE',
  scan: 'CLEARING',
  comms: 'FIELD RECORDS',
  panel: {
    uplink: 'Climate', threatBar: 'Blight / vigour bars', telemetry: 'Field notes',
    mostWanted: 'Greatest hubs', terminal: 'Field records', oscilloscope: 'Pulse',
    spectrum: 'Spore spectrum', radar: 'Clearing (radar)',
  },
};
