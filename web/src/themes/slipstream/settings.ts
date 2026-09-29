import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { SLIP_MUSIC } from './score';

/**
 * SLIPSTREAM's own settings. Keys are k-prefixed: all themes share one
 * saved settings object.
 */
export const SLIP_DEFAULTS = {
  kTrack: 'auto' as string,   // auto | bowl | twisty | long
  kCam: 'hero' as string,     // hero (busiest host) | leader
  kDraft: true,               // allow → the racer drafts forward
  kBoard: true,               // dns → sprint burst + the domain on the board
  kPit: true,                 // dhcp → a new driver takes a seat
  kOil: true,                 // block → oil slick, the racer spins
  kShell: true,               // threat → a red shell hunts the leader
  kPads: true,                // wifi → boost pads light along the straights
  kCaution: true,             // system → yellow flag, the pack eases off
  kChevrons: true,            // speed chevrons when the traffic floods
  kWobble: true,              // the old flip-mode background wobble
  kMinimap: true,             // the corner map with the running order
  kPace: 1,                   // race pace multiplier

  // soundtrack
  kMusicStyle: 'rotate' as string,
  kMusicRotate: 6,
  kSfx: 0.75,                 // shells, spins, beeps, laps
  kEngine: 0.35,              // engine purr under the music

  // scene budgets = the HIGH preset
  kRows: 270,                 // internal ground rows (SNES is 224)
};

export const SLIP_BUDGETS: Budgets = {
  low: { kRows: 160 },
  medium: { kRows: 220 },
  high: { kRows: 270 },
  ultra: { kRows: 400 },
};

type Key = keyof typeof SLIP_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const SLIP_CONTROLS = {
  scene: [
    { kind: 'select', key: 'kTrack', label: 'Circuit', options: [
      ['auto', 'Auto — home track by hostname'],
      ['bowl', 'Sunset Bowl — wide and fast'],
      ['twisty', 'Corkscrew — the technical loop'],
      ['long', 'Long Lap — one brutal hairpin'],
    ] } as Control,
    { kind: 'select', key: 'kCam', label: 'Camera follows', options: [
      ['hero', 'The busiest host'],
      ['leader', 'The race leader'],
    ] } as Control,
    toggle('kDraft', 'Draft surges (allow)'),
    toggle('kBoard', 'Sprint & sponsor board (DNS)'),
    toggle('kPit', 'New drivers take seats (DHCP)'),
    toggle('kOil', 'Oil spins (block)'),
    toggle('kShell', 'Red shells at the leader (threat)'),
    toggle('kPads', 'Boost pads (Wi-Fi joins)'),
    toggle('kCaution', 'Yellow cautions (system)'),
    toggle('kChevrons', 'Speed chevrons'),
    toggle('kWobble', 'Background wobble'),
    toggle('kMinimap', 'Corner minimap'),
    range('kPace', 'Race pace', 0.4, 2, 0.05),
  ],
  audio: [
    { kind: 'select', key: 'kMusicStyle', label: 'Music', options: SLIP_MUSIC } as Control,
    range('kMusicRotate', 'Rotate every (min)', 1, 30, 0.5),
    range('kSfx', 'Race sounds', 0, 1, 0.05),
    range('kEngine', 'Engine purr', 0, 1, 0.05),
  ],
  budgets: [
    { kind: 'select', key: 'kRows', label: 'Screen', options: [
      ['160', 'Chunky (16-bit)'], ['270', 'Classic (SNES)'], ['400', 'Sharp (hi-res)'],
    ], numeric: true } as Control,
  ],
  color: [],
};

/** HUD panels re-badged for the race. */
export const SLIP_HUD: HudLabelOverrides = {
  uplink: 'RACE CONTROL', status: 'DRIVER STATUS', threat: 'RACE CONTROL', power: 'FUEL',
  telemetry: 'RACE LOG', contacts: 'THE GRID', nodes: 'TRACK', denied: 'DENIED',
  mostWanted: 'FRONT RUNNERS', noHostiles: '— GRID IS QUIET —',
  spectrum: 'THRACOUSTICS', flux: 'RACE FLUX', comms: 'TEAM RADIO',
  weather: { calm: 'CLEAR SKY', storm: 'DOWNPOUR', hurricane: 'STORM FLAG' },
  panel: {
    uplink: 'Race control', threatBar: 'Driver status bars', telemetry: 'Race log',
    mostWanted: 'Front runners', terminal: 'Team radio', oscilloscope: 'Race flux',
    spectrum: 'Thracooustics', radar: 'Radar', scanlines: 'Scanlines',
  },
};
