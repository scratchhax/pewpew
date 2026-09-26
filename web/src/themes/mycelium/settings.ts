import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Mycelium's own settings. Keys are m-prefixed: every theme shares one saved
 * settings object, so another scene's budgets never leak in here.
 */
export const MYCELIUM_DEFAULTS = {
  mHyphae: true,         // allow → hyphae thicken, light pulses run them
  mBlooms: true,         // dns → a mushroom rises with the domain on it
  mSprouts: true,        // dhcp → a new host takes root
  mSpores: true,         // wifi → spore light drifts between devices
  mScorch: true,         // block → a scorch patch that slowly heals
  mBlight: true,         // threat → blight swarm crawls in and burns off
  mLabels: true,         // device labels under the nodes
  mPersist: true,        // the garden survives reloads (localStorage)
  mFadeMin: 20,          // hypha memory half-life in minutes: how fast neglect shows
  mGlow: 1,              // overall bioluminescence
  mSporeDrift: 1,        // ambient spores and fireflies

  // soundtrack
  mAmbience: 0.7,        // undergrowth hiss + wind bed
  mBells: 0.8,           // glass bells the events ring
  mPadDepth: 0.6,        // drone depth

  // scene budgets = the HIGH preset
  mMaxNodes: 40,
  mMaxEdges: 9000,
  mMaxPulses: 380,
  mMaxBlooms: 10,
  mMaxParticles: 1200,
};

export type MyceliumSettings = CoreSettings & typeof MYCELIUM_DEFAULTS;

export const MYCELIUM_BUDGETS: Budgets = {
  low: { mMaxNodes: 24, mMaxEdges: 3000, mMaxPulses: 120, mMaxBlooms: 5, mMaxParticles: 350 },
  medium: { mMaxNodes: 32, mMaxEdges: 5000, mMaxPulses: 220, mMaxBlooms: 7, mMaxParticles: 700 },
  high: { mMaxNodes: 40, mMaxEdges: 8000, mMaxPulses: 380, mMaxBlooms: 10, mMaxParticles: 1200 },
  ultra: { mMaxNodes: 60, mMaxEdges: 12000, mMaxPulses: 700, mMaxBlooms: 16, mMaxParticles: 2200 },
};

type Key = keyof typeof MYCELIUM_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const MYCELIUM_CONTROLS = {
  scene: [
    toggle('mHyphae', 'Growing hyphae'), toggle('mBlooms', 'DNS blooms'),
    toggle('mSprouts', 'DHCP sprouts'), toggle('mSpores', 'Wi-Fi spores'),
    toggle('mScorch', 'Block scorch'), toggle('mBlight', 'Threat blight'),
    toggle('mLabels', 'Device labels'), toggle('mPersist', 'Keep the garden'),
  ],
  budgets: [
    range('mFadeMin', 'Hypha half-life (minutes)', 5, 120, 5),
    range('mGlow', 'Bioluminescence', 0.2, 2, 0.05),
    range('mSporeDrift', 'Spore drift', 0, 2, 0.05),
    range('mMaxNodes', 'Hosts', 8, 60, 1),
    range('mMaxEdges', 'Filaments', 1500, 15000, 500),
    range('mMaxPulses', 'Light pulses', 60, 700, 20),
    range('mMaxBlooms', 'Blooms', 3, 16, 1),
  ],
  color: [] as Control[],
  audio: [
    range('mAmbience', 'Undergrowth', 0, 1, 0.05),
    range('mBells', 'Bells', 0, 1, 0.05),
    range('mPadDepth', 'Drone depth', 0, 1, 0.05),
  ],
  colorHint: `Hue shift & intensity recolour the HUD accent. The garden's own
    palette (teal hyphae, cream blooms, red blight) stays fixed so the colour
    law holds.`,
};

/** Field notes of a quiet, patient organism. */
export const MYCELIUM_HUD: HudLabelOverrides = {
  mark: '❋',
  uplink: 'CLIMATE',
  link: 'MYCELIUM',
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
