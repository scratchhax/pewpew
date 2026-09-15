import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { AQUARIUM_MUSIC } from './score';

/**
 * The aquarium's own settings. Keys are q-prefixed (q + a capital letter): all
 * themes share one saved settings object.
 */
export const AQUARIUM_DEFAULTS = {
  qSchools: true,        // allow → schools of chromis swim across
  qPuffers: true,        // block → a pufferfish swells up at the intruder
  qSharks: true,         // threat → a reef shark cruises through
  qBubbles: true,        // dns → bubbles rise from the air stone with the domain
  qResidents: true,      // dhcp → a new resident fish with the device's name
  qChest: true,          // wifi → the treasure chest opens (or slams shut)
  qDimming: true,        // system → the tank light dims
  qLabels: true,         // names and addresses beside the fish
  qResidentMax: 12,      // residents on the reef before the oldest swims off
  qCurrent: 1,           // how much the water moves
  qCamera: true,         // slow camera drift around the reef

  // soundtrack
  qMusicStyle: 'rotate' as string,
  qMusicRotate: 6,
  qSfx: 0.7,             // bubbles, puffs, the shark, the chest
  qAmbience: 0.5,        // pump hum and water

  // scene budgets = the HIGH preset
  qMaxFish: 300,
  qSpecks: 2000,
  qShadows: true,
  qCaustics: true,
  qBloom: true,
  qSmooth: true,         // multisampled edges (applies on reload)
};

export const AQUARIUM_BUDGETS: Budgets = {
  low: { qMaxFish: 120, qSpecks: 600, qShadows: false, qCaustics: true, qBloom: false, qSmooth: false },
  medium: { qMaxFish: 200, qSpecks: 1200, qShadows: false, qCaustics: true, qBloom: true, qSmooth: true },
  high: { qMaxFish: 300, qSpecks: 2000, qShadows: true, qCaustics: true, qBloom: true, qSmooth: true },
  ultra: { qMaxFish: 460, qSpecks: 3000, qShadows: true, qCaustics: true, qBloom: true, qSmooth: true },
};

type Key = keyof typeof AQUARIUM_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const AQUARIUM_CONTROLS = {
  scene: [
    toggle('qSchools', 'Schools (allow)'), toggle('qPuffers', 'Pufferfish (block)'),
    toggle('qSharks', 'Shark (threat)'), toggle('qBubbles', 'Bubbles (DNS)'),
    toggle('qResidents', 'Residents (DHCP)'), toggle('qChest', 'Treasure chest (Wi-Fi)'),
    toggle('qDimming', 'Light dims (system)'), toggle('qLabels', 'Names & addresses'),
    range('qResidentMax', 'Residents on the reef', 2, 30, 1),
    range('qCurrent', 'Current', 0, 2, 0.05),
    toggle('qCamera', 'Camera drift'),
  ],
  audio: [
    { kind: 'select', key: 'qMusicStyle', label: 'Music', options: AQUARIUM_MUSIC } as Control,
    range('qMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('qSfx', 'Tank sounds', 0, 1, 0.05),
    range('qAmbience', 'Pump & water', 0, 1, 0.05),
  ],
  budgets: [
    range('qMaxFish', 'Fish', 60, 500, 10),
    range('qSpecks', 'Specks in the water', 0, 3000, 100),
    toggle('qShadows', 'Shadows'),
    toggle('qCaustics', 'Caustics'),
    toggle('qBloom', 'Bloom'),
    toggle('qSmooth', 'Smooth edges (on reload)'),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. The fish keep their own colours.`,
};

export const AQUARIUM_HUD: HudLabelOverrides = {
  uplink: 'PUMP',
  link: 'FLOWING',
  weather: { calm: 'CALM WATER', storm: 'CHOPPY', hurricane: 'RIP CURRENT' },
  status: 'REEF',
  threat: 'PREDATOR',
  power: 'LIGHT',
  telemetry: 'WATER',
  uptime: 'UPTIME',
  contacts: 'FISH',
  nodes: 'RESIDENTS',
  denied: 'REPELLED',
  traffic: 'SCHOOLS',
  mostWanted: 'PREDATORS',
  noHostiles: '— THE REEF IS QUIET —',
  spectrum: 'SONAR',
  flux: 'CURRENT',
  scan: 'SONAR',
  comms: 'TANK LOG',
  panel: {
    uplink: 'Pump', threatBar: 'Reef bars', telemetry: 'Water',
    mostWanted: 'Predators', terminal: 'Tank log', oscilloscope: 'Current',
    spectrum: 'Sonar', radar: 'Sonar (radar)',
  },
};
