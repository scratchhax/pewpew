import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { HORIZON_MUSIC } from './score';

/**
 * Event Horizon's settings. Keys start with `eh` (all themes share one saved
 * settings object).
 */
export const HORIZON_DEFAULTS = {
  ehHotspots: true,      // allow → hot spots shear into arcs on the disk, knots up the jets
  ehInfall: true,        // block → the source falls in, reddening at the horizon
  ehShred: true,         // threat → a star is torn apart and feeds the disk
  ehGlints: true,        // dns → light circles the photon ring
  ehMoons: true,         // dhcp → a moon with the device's name
  ehRipples: true,       // wifi → a gravitational-wave ripple crosses the disk
  ehDimming: true,       // a burst of system logs → the disk dims
  ehLabels: true,        // names and addresses beside things
  ehOrbits: true,        // hairline orbit traces
  ehCamera: true,        // the slow orbit of the camera
  ehMoonMax: 9,          // moons before the least recently seen one leaves
  ehBeaming: 0.55,       // relativistic beaming and Doppler colour 0..1
  ehTemp: 1,             // disk temperature
  ehExposure: 1,         // overall brightness
  ehJetGain: 1,          // how bright the polar jets are

  // soundtrack
  ehMusicStyle: 'auto' as string,
  ehMusicRotate: 7,
  ehSfx: 0.7,
  ehAmbience: 0.55,

  // scene budgets = the HIGH preset
  ehTraceRes: 1,         // fraction of the canvas the tracer renders
  ehSteps: 240,          // geodesic steps per pixel
  ehBodies: 16,          // moons + glowing debris the tracer tests per step
  ehDiskRes: 2,          // 1 = 768×256, 2 = 1536×512, 3 = 3072×1024
  ehDetail: 5,           // turbulence octaves on the disk
  ehHaze: true,          // glowing haze above the disk
  ehJets: true,          // polar jets
  ehBloom: true,
  ehStreak: true,        // anamorphic lens streak
};

export const HORIZON_BUDGETS: Budgets = {
  low: { ehTraceRes: 0.5, ehSteps: 110, ehBodies: 6, ehDiskRes: 1, ehDetail: 3, ehHaze: false, ehJets: true, ehBloom: true, ehStreak: false },
  medium: { ehTraceRes: 0.7, ehSteps: 160, ehBodies: 10, ehDiskRes: 2, ehDetail: 4, ehHaze: true, ehJets: true, ehBloom: true, ehStreak: true },
  high: { ehTraceRes: 1, ehSteps: 240, ehBodies: 16, ehDiskRes: 2, ehDetail: 5, ehHaze: true, ehJets: true, ehBloom: true, ehStreak: true },
  ultra: { ehTraceRes: 1, ehSteps: 360, ehBodies: 24, ehDiskRes: 3, ehDetail: 6, ehHaze: true, ehJets: true, ehBloom: true, ehStreak: true },
};

type Key = keyof typeof HORIZON_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const HORIZON_CONTROLS = {
  scene: [
    toggle('ehHotspots', 'Hot spots & jet knots (allow)'), toggle('ehInfall', 'Infall (block)'),
    toggle('ehShred', 'Tidal disruption (threat)'), toggle('ehGlints', 'Photon ring glints (DNS)'),
    toggle('ehMoons', 'Moons (DHCP)'), toggle('ehRipples', 'Ripples (Wi-Fi)'),
    toggle('ehDimming', 'Disk dims (system log bursts)'), toggle('ehLabels', 'Names & addresses'),
    toggle('ehOrbits', 'Orbit traces'), toggle('ehCamera', 'Camera orbit'),
    range('ehMoonMax', 'Moons', 2, 12, 1),
  ],
  color: [
    range('ehBeaming', 'Relativistic beaming', 0, 1, 0.05),
    range('ehTemp', 'Disk temperature', 0.5, 1.8, 0.05),
    range('ehExposure', 'Exposure', 0.4, 2.5, 0.05),
    range('ehJetGain', 'Jets', 0, 2, 0.05),
  ],
  colorGroup: 'Light',
  colorHint: 'Beaming brightens the side of the disk turning toward you and shifts its colour; 0 is the even, symmetric look.',
  audio: [
    { kind: 'select', key: 'ehMusicStyle', label: 'Music', options: HORIZON_MUSIC } as Control,
    range('ehMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('ehSfx', 'Effects', 0, 1, 0.05),
    range('ehAmbience', 'Deep-space hum', 0, 1, 0.05),
  ],
  budgets: [
    range('ehTraceRes', 'Ray-trace resolution', 0.3, 1, 0.05),
    range('ehSteps', 'Geodesic steps', 60, 400, 10),
    range('ehBodies', 'Bodies traced', 2, 28, 1),
    { kind: 'select', key: 'ehDiskRes', label: 'Disk detail', numeric: true, options: [['1', 'Low'], ['2', 'High'], ['3', 'Ultra']] } as Control,
    range('ehDetail', 'Turbulence octaves', 2, 7, 1),
    toggle('ehHaze', 'Haze'),
    toggle('ehJets', 'Jets'),
    toggle('ehBloom', 'Bloom'),
    toggle('ehStreak', 'Lens streak'),
  ],
};

/** The HUD reads like an observatory's instrument panel. */
export const HORIZON_HUD: HudLabelOverrides = {
  mark: '',
  uplink: 'Observatory',
  link: 'Tracking',
  weather: { calm: 'Quiescent', storm: 'Flaring', hurricane: 'Outburst' },
  status: 'Accretion',
  threat: 'Tidal',
  power: 'Luminosity',
  telemetry: 'Telemetry',
  uptime: 'Exposure',
  contacts: 'Bodies',
  nodes: 'Moons',
  denied: 'Swallowed',
  traffic: 'Flux',
  mostWanted: 'Infall sources',
  noHostiles: 'Nothing falling in',
  spectrum: 'Spectrum',
  flux: 'Light curve',
  scan: 'Survey',
  comms: 'Event log',
  demo: 'Simulation',
  panel: {
    uplink: 'Observatory', threatBar: 'Accretion gauges', telemetry: 'Telemetry',
    mostWanted: 'Infall sources', terminal: 'Event log', oscilloscope: 'Light curve',
    spectrum: 'Spectrum', radar: 'Survey', scanlines: 'Scanlines',
  },
};
