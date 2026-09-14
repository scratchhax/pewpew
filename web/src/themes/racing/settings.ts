import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { RACING_MUSIC } from './score';

/**
 * Midnight Run's own settings. Keys are r-prefixed: all themes share one
 * saved settings object.
 */
export const RACING_DEFAULTS = {
  rTraffic: true,        // allow → cars on the road
  rRoadblocks: true,     // block → barricades
  rPolice: true,         // threat → police chase
  rRivals: true,         // dhcp → rivals with name plates
  rBillboards: true,     // dns → signs show the domain
  rGates: true,          // wifi → neon gates
  rWeather: true,        // storm / hurricane → rain
  rShake: true,          // camera nudge when smashing a barricade
  rMusicVisuals: true,   // neon and underglow breathe with the music

  // soundtrack
  rMusicStyle: 'rotate' as string,
  rMusicRotate: 6,       // minutes per style while rotating
  rEngine: 0.7,          // engine, gear shifts, nitro
  rAmbience: 0.6,        // road roar and rain

  // scene budgets = the HIGH preset
  rMaxCars: 20,
  rDrawDistance: 700,
  rRain: 1,
  rBloom: true,
  rLens: true,
};

export const RACING_BUDGETS: Budgets = {
  low: { rMaxCars: 8, rDrawDistance: 380, rRain: 0.35, rBloom: false, rLens: false },
  medium: { rMaxCars: 14, rDrawDistance: 520, rRain: 0.6, rBloom: true, rLens: false },
  high: { rMaxCars: 20, rDrawDistance: 700, rRain: 1, rBloom: true, rLens: true },
  ultra: { rMaxCars: 32, rDrawDistance: 900, rRain: 1.5, rBloom: true, rLens: true },
};

type Key = keyof typeof RACING_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const RACING_CONTROLS = {
  scene: [
    toggle('rTraffic', 'Traffic (allow)'), toggle('rRoadblocks', 'Roadblocks (block)'),
    toggle('rPolice', 'Police chase (threat)'), toggle('rRivals', 'Rivals (DHCP)'),
    toggle('rBillboards', 'DNS billboards'), toggle('rGates', 'Wi-Fi gates'),
    toggle('rWeather', 'Rain'), toggle('rShake', 'Camera nudge'),
    toggle('rMusicVisuals', 'Move with the music'),
  ],
  audio: [
    { kind: 'select', key: 'rMusicStyle', label: 'Music', options: RACING_MUSIC } as Control,
    range('rMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('rEngine', 'Engine & nitro', 0, 1, 0.05),
    range('rAmbience', 'Road & rain', 0, 1, 0.05),
  ],
  budgets: [
    range('rMaxCars', 'Cars on the road', 4, 40, 1),
    range('rDrawDistance', 'Draw distance (m)', 250, 1000, 10),
    range('rRain', 'Rain', 0, 1.5, 0.05),
    toggle('rBloom', 'Bloom'),
    toggle('rLens', 'Lens (vignette, fringe)'),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (block/allow/dns/dhcp/wifi) and the log legend stay fixed.`,
};

export const RACING_HUD: HudLabelOverrides = {
  uplink: 'SAT NAV',
  link: 'ONLINE',
  weather: { calm: 'DRY', storm: 'WET', hurricane: 'MONSOON' },
  status: 'CAR',
  threat: 'HEAT',
  power: 'NOS',
  telemetry: 'RACE LOG',
  uptime: 'TIME ON ROAD',
  contacts: 'CARS SEEN',
  nodes: 'CREW',
  denied: 'ROADBLOCKS',
  traffic: 'DISTANCE',
  mostWanted: 'MOST WANTED',
  noHostiles: '— CLEAR ROAD —',
  spectrum: 'EQUALIZER',
  flux: 'TACHOMETER',
  scan: 'RADAR',
  comms: 'POLICE SCANNER',
  panel: {
    uplink: 'Sat nav', threatBar: 'Heat / nitro bars', telemetry: 'Race log',
    mostWanted: 'Most wanted', terminal: 'Police scanner', oscilloscope: 'Tachometer',
    spectrum: 'Equalizer', radar: 'Radar',
  },
};
