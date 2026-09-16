import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { GIBSON_MUSIC } from './score';

/**
 * The Gibson's own settings. Keys are g-prefixed (g + a capital letter): all
 * themes share one saved settings object.
 */
export const GIBSON_DEFAULTS = {
  gPulses: true,        // allow → light pulses run up a tower's face
  gLookups: true,       // dns → the domain joins the scrolling listings
  gWrites: true,        // dhcp → a new tower rises out of the floor
  gBanners: true,       // ACCESS GRANTED / DENIED / PASSWORD ACCEPTED billboards
  gLock: true,          // threat → the camera swings to lock a red intruder file
  gMusicVisuals: true,  // glow and listings breathe with the music
  gScrollSpeed: 1,      // how fast the wall drifts toward you

  // soundtrack
  gMusicStyle: 'rotate' as string,
  gMusicRotate: 6,
  gSfx: 0.7,            // lock-on tones, denials, file writes, the found hit
  gAmbience: 0.5,       // server hum and static hiss

  // scene budgets = the HIGH preset
  gGridW: 12,           // columns of towers
  gRows: 10,            // tower rows deep
  gBloom: true,
  gSmooth: true,        // multisampled edges (applies on reload)
};

export const GIBSON_BUDGETS: Budgets = {
  low: { gGridW: 8, gRows: 6, gBloom: false, gSmooth: false },
  medium: { gGridW: 10, gRows: 8, gBloom: true, gSmooth: true },
  high: { gGridW: 12, gRows: 10, gBloom: true, gSmooth: true },
  ultra: { gGridW: 16, gRows: 14, gBloom: true, gSmooth: true },
};

type Key = keyof typeof GIBSON_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const GIBSON_CONTROLS = {
  scene: [
    toggle('gPulses', 'Face pulses (allow)'),
    toggle('gLookups', 'Scrolling listings (DNS)'),
    toggle('gWrites', 'New towers (DHCP)'),
    toggle('gBanners', 'Access banners'),
    toggle('gLock', 'Target lock (threat)'),
    toggle('gMusicVisuals', 'Move with the music'),
    range('gScrollSpeed', 'Scroll speed', 0.3, 2.5, 0.05),
  ],
  audio: [
    { kind: 'select', key: 'gMusicStyle', label: 'Music', options: GIBSON_MUSIC } as Control,
    range('gMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('gSfx', 'Access sounds', 0, 1, 0.05),
    range('gAmbience', 'Hum & static', 0, 1, 0.05),
  ],
  budgets: [
    { kind: 'select', key: 'gGridW', label: 'Grid width (columns)', numeric: true,
      options: [['8', '8'], ['10', '10'], ['12', '12'], ['16', '16']] } as Control,
    range('gRows', 'Depth (rows)', 4, 14, 1),
    toggle('gBloom', 'Bloom'),
    toggle('gSmooth', 'Smooth edges (on reload)'),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. The wall's own
        colours stay fixed: white-cyan edges and words, red for denials and flagged towers, cyan traces.`,
};

/** The terminal framing over the storage wall. */
export const GIBSON_HUD: HudLabelOverrides = {
  mark: '▣',
  uplink: 'UPLINK',
  link: 'ONLINE',
  weather: { calm: 'STANDBY', storm: 'PAGING', hurricane: 'FLOOD' },
  status: 'CORE',
  threat: 'LOAD',
  power: 'PWR',
  telemetry: 'SYSTEM',
  uptime: 'UPTIME',
  contacts: 'HOSTS',
  nodes: 'NODES',
  denied: 'DENIED',
  traffic: 'PACKETS',
  mostWanted: 'SUSPECTS',
  noHostiles: '— NOTHING FLAGGED —',
  spectrum: 'SPECTRUM',
  flux: 'TEMPO',
  scan: 'TRACE',
  comms: 'TERMINAL',
  panel: {
    uplink: 'Uplink status', threatBar: 'Core load', telemetry: 'System',
    mostWanted: 'Suspects', terminal: 'Terminal', oscilloscope: 'Tempo',
    spectrum: 'Spectrum', radar: 'Trace (radar)',
  },
};
