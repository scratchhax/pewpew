import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { SPY_MUSIC } from './score';

/**
 * Panopticon's own settings. Keys are o-prefixed: all themes share one saved
 * settings object.
 */
export const SPY_DEFAULTS = {
  oArcs: true,           // allow / block → signal arcs across the planet
  oTargets: true,        // threat → tracking markers on the attacker
  oSatellites: true,     // dhcp / wifi → your devices as satellites
  oUplinks: true,        // dns → uplink beams
  oRipples: true,        // system → a ripple through the atmosphere
  oClouds: true,         // weather systems (storms thicken them)
  oGrid: true,           // lat/long graticule over the planet
  oEye: true,            // the eye of god: zoom, enhance, identify
  oEyeThreats: 3,        // IDS/IPS threats inside a minute that task the eye
  oEyeEvery: 5,          // otherwise, a random tasking about this often (minutes)
  oMusicVisuals: true,   // city lights and the grid breathe with the music

  // soundtrack
  oMusicStyle: 'rotate' as string,
  oMusicRotate: 6,
  oSfx: 0.7,             // surveillance sounds: locks, enhance, teletype, stamps
  oAmbience: 0.5,        // operations-room hum and radio static

  // scene budgets = the HIGH preset
  oPlanetRes: 2048,      // planet texture width (px)
  oMaxArcs: 40,
  oMaxSats: 24,
  oStars: 1,
  oBloom: true,
  oShadows: true,        // shadows in the close-up
};

export const SPY_BUDGETS: Budgets = {
  low: { oPlanetRes: 1024, oMaxArcs: 16, oMaxSats: 10, oStars: 0.4, oBloom: false, oShadows: false },
  medium: { oPlanetRes: 2048, oMaxArcs: 28, oMaxSats: 16, oStars: 0.7, oBloom: true, oShadows: false },
  high: { oPlanetRes: 2048, oMaxArcs: 40, oMaxSats: 24, oStars: 1, oBloom: true, oShadows: true },
  ultra: { oPlanetRes: 4096, oMaxArcs: 64, oMaxSats: 32, oStars: 1.5, oBloom: true, oShadows: true },
};

type Key = keyof typeof SPY_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const SPY_CONTROLS = {
  scene: [
    toggle('oArcs', 'Signal arcs (allow/block)'), toggle('oTargets', 'Tracking (threat)'),
    toggle('oSatellites', 'Satellites (DHCP, Wi-Fi)'), toggle('oUplinks', 'Uplinks (DNS)'),
    toggle('oRipples', 'Ripples (system)'), toggle('oClouds', 'Clouds & storms'),
    toggle('oGrid', 'Grid'), toggle('oMusicVisuals', 'Move with the music'),
    toggle('oEye', 'Eye of god'),
    range('oEyeThreats', 'Eye: threats in a minute', 1, 12, 1),
    range('oEyeEvery', 'Eye: random every (min)', 1, 30, 1),
  ],
  audio: [
    { kind: 'select', key: 'oMusicStyle', label: 'Music', options: SPY_MUSIC } as Control,
    range('oMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('oSfx', 'Surveillance sounds', 0, 1, 0.05),
    range('oAmbience', 'Room & static', 0, 1, 0.05),
  ],
  budgets: [
    { kind: 'select', key: 'oPlanetRes', label: 'Planet detail', numeric: true,
      options: [['1024', '1024'], ['2048', '2048'], ['4096', '4096']] } as Control,
    range('oMaxArcs', 'Signal arcs', 8, 80, 1),
    range('oMaxSats', 'Satellites', 4, 40, 1),
    range('oStars', 'Stars', 0, 2, 0.05),
    toggle('oBloom', 'Bloom'),
    toggle('oShadows', 'Close-up shadows'),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (arcs green and red, uplinks blue, satellites yellow and purple, tracking amber) stay fixed.`,
};

export const SPY_HUD: HudLabelOverrides = {
  uplink: 'SIGINT',
  link: 'UPLINK',
  weather: { calm: 'DEFCON 5', storm: 'DEFCON 3', hurricane: 'DEFCON 1' },
  status: 'THREATCON',
  threat: 'THR',
  power: 'SIG',
  telemetry: 'OPERATIONS',
  uptime: 'WATCH TIME',
  contacts: 'INTERCEPTS',
  nodes: 'ASSETS',
  denied: 'INTERDICTIONS',
  traffic: 'SIGNALS',
  mostWanted: 'PERSONS OF INTEREST',
  noHostiles: '— NO TARGETS —',
  spectrum: 'SPECTRUM',
  flux: 'CARRIER',
  scan: 'TRACKING',
  comms: 'INTERCEPT LOG',
  panel: {
    uplink: 'SIGINT', threatBar: 'Threatcon bars', telemetry: 'Operations',
    mostWanted: 'Persons of interest', terminal: 'Intercept log', oscilloscope: 'Carrier',
    spectrum: 'Spectrum', radar: 'Tracking (radar)',
  },
};
