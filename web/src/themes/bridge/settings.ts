import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { BRIDGE_MUSIC } from './score';

/**
 * Bridge's own settings. Keys are b-prefixed: all themes share one saved
 * settings object.
 */
export const BRIDGE_DEFAULTS = {
  bSweep: true,        // the long-range sweep
  bBlips: true,        // event blips on the sweep
  bFeed: true,         // the subspace relay data feed
  bBars: true,         // the bottom bar bank
  bWave: true,         // shield harmonics waveform
  bAlert: true,        // red alert strobe on threats
  bPorts: true,        // docking uplink ports (Wi-Fi)
  bMusicStyle: 'auto' as string,   // auto | rotate | a style
  bMusicRotate: 5,
  bSfx: 0.8,           // interface beeps
  bAmb: 0.5,           // hypo hum

  // scene budgets = the HIGH preset
  bMaxBlips: 60,
  bFeedRows: 12,
  bHistory: 48,        // events in the history strip
};

export const BRIDGE_BUDGETS: Budgets = {
  low: { bMaxBlips: 24, bFeedRows: 7, bHistory: 24 },
  medium: { bMaxBlips: 40, bFeedRows: 10, bHistory: 36 },
  high: { bMaxBlips: 60, bFeedRows: 12, bHistory: 48 },
  ultra: { bMaxBlips: 100, bFeedRows: 16, bHistory: 72 },
};

type Key = keyof typeof BRIDGE_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const BRIDGE_CONTROLS = {
  scene: [
    toggle('bSweep', 'Long-range scan'), toggle('bBlips', 'Contacts'),
    toggle('bFeed', 'Intrusion log'), toggle('bBars', 'Threat analysis'),
    toggle('bWave', 'Shield harmonics'), toggle('bAlert', 'Red alert (threats)'),
    toggle('bPorts', 'Docking uplink ports (Wi-Fi)'),
  ],
  budgets: [
    range('bMaxBlips', 'Blips', 10, 120, 2),
    range('bFeedRows', 'Feed rows', 4, 20, 1),
    range('bHistory', 'History strip (events)', 12, 96, 4),
  ],
  color: [] as Control[],
  audio: [
    { kind: 'select', key: 'bMusicStyle', label: 'Music', options: BRIDGE_MUSIC } as Control,
    range('bMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('bSfx', 'Interface beeps', 0, 1, 0.05),
    range('bAmb', 'Hypo hum', 0, 1, 0.05),
  ],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
      (blips, feed rows and bars: allow green, block red, DNS blue, DHCP yellow,
      Wi-Fi purple, threats amber, system grey) stay fixed; the LCARS chrome is
      structure only.`,
};

export const BRIDGE_HUD: HudLabelOverrides = {
  uplink: 'UPLINK',
  link: 'ACTIVE',
  weather: { calm: 'CONDITION GREEN', storm: 'CONDITION YELLOW', hurricane: 'CONDITION RED' },
  status: 'SHIP STATUS',
  threat: 'SHIELDS',
  power: 'WARP CORE',
  telemetry: 'LOG',
  uptime: 'MISSION DAY',
  contacts: 'CREW',
  nodes: 'STATIONS',
  denied: 'REFUSALS',
  traffic: 'PACKETS',
  mostWanted: 'CONTACTS',
  noHostiles: '- SENSORS CLEAR -',
  spectrum: 'EM SPECTRUM',
  flux: 'SUBSPACE FLUX',
  scan: 'SCAN',
  comms: 'COMMS',
  panel: {
    uplink: 'Uplink status', threatBar: 'Shield / core meters', telemetry: 'Mission log',
    mostWanted: 'Detected contacts', terminal: 'Comms log', oscilloscope: 'Subspace flux',
    spectrum: 'EM spectrum', radar: 'Sensor sweep',
  },
};
