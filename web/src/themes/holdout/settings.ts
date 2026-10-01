import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { MUSIC_STYLES } from './score';

/**
 * The Holdout's own settings. Keys are h-prefixed: every theme shares one
 * saved settings object, so a sci-fi particle budget never leaks in here.
 */
export const HOLDOUT_DEFAULTS = {
  hBlock: 'zombie' as string,    // block → any visual
  hAllow: 'scavenger' as string, // allow → any visual
  hThreat: 'horde' as string,    // threat → any visual
  hDns: 'radio' as string,       // dns → any visual
  hDhcp: 'arrival' as string,    // dhcp → any visual
  hWifi: 'visit' as string,      // wifi → any visual
  hSystem: 'brownout' as string, // system → any visual
  hBuildings: true,            // AP / gateway hosts as buildings
  hDayNight: true,             // weather darkens the map, lights come on
  hRain: true,
  hBlood: true,
  hScreenShake: true,

  // soundtrack
  hMusicStyle: 'pressure' as string, // pressure | drone | siege | horde
  hGunfire: 0.8,                     // gunshot volume
  hAmbience: 0.6,                    // wind + rain
  hMusicVisuals: true,               // zombies shamble in time, lights breathe with the music

  // scene budgets = the HIGH preset
  hMaxParticles: 3000,
  hMaxZombies: 12,
  hMaxDecals: 140,
  hRainDensity: 1,
  hMaxTents: 28,
  hNightExtras: true,     // fog + survivor flashlights (fill-heavy on small GPUs)
};

export type HoldoutSettings = CoreSettings & typeof HOLDOUT_DEFAULTS;

export const HOLDOUT_BUDGETS: Budgets = {
  low: { hMaxParticles: 600, hMaxZombies: 8, hMaxDecals: 30, hRainDensity: 0.3, hMaxTents: 16, hNightExtras: false },
  medium: { hMaxParticles: 1500, hMaxZombies: 10, hMaxDecals: 70, hRainDensity: 0.6, hMaxTents: 22, hNightExtras: true },
  high: { hMaxParticles: 3000, hMaxZombies: 12, hMaxDecals: 140, hRainDensity: 1, hMaxTents: 28, hNightExtras: true },
  ultra: { hMaxParticles: 6000, hMaxZombies: 18, hMaxDecals: 260, hRainDensity: 1.5, hMaxTents: 36, hNightExtras: true },
};

type Key = keyof typeof HOLDOUT_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

const select = (key: Key, label: string, options: Array<[string, string]>): Control =>
  ({ kind: 'select', key, label, options });

const VISUALS: Array<[string, string]> = [
  ['zombie', 'Zombie'],
  ['sprinter', 'Sprinter'],
  ['horde', 'Horde'],
  ['scavenger', 'Scavenger'],
  ['parachute', 'Supply drop'],
  ['radio', 'Radio'],
  ['arrival', 'Arrival'],
  ['visit', 'Visit'],
  ['brownout', 'Brownout'],
  ['alarm', 'Alarm'],
  ['none', 'None'],
];

export const HOLDOUT_CONTROLS = {
  scene: [
    select('hBlock', 'Blocked traffic', VISUALS),
    select('hAllow', 'Allowed traffic', VISUALS),
    select('hThreat', 'Threats', VISUALS),
    select('hDns', 'DNS', VISUALS),
    select('hDhcp', 'DHCP', VISUALS),
    select('hWifi', 'Wi-Fi', VISUALS),
    select('hSystem', 'System', VISUALS),
    toggle('hBuildings', 'Buildings'), toggle('hDayNight', 'Day / night'),
    toggle('hRain', 'Rain'), toggle('hBlood', 'Blood'), toggle('hScreenShake', 'Screen shake'),
    toggle('hMusicVisuals', 'Move with the music'),
  ],
  budgets: [
    range('hMaxParticles', 'Particles', 200, 6000, 100),
    range('hMaxZombies', 'Zombies', 4, 18, 1),
    range('hMaxDecals', 'Blood decals', 0, 260, 10),
    range('hRainDensity', 'Rain', 0, 1.5, 0.05),
    range('hMaxTents', 'Tents', 8, 36, 1),
    toggle('hNightExtras', 'Fog + flashlights'),
  ],
  color: [] as Control[],
  audio: [
    { kind: 'select', key: 'hMusicStyle', label: 'Music', options: MUSIC_STYLES } as Control,
    range('hGunfire', 'Gunfire', 0, 1, 0.05),
    range('hAmbience', 'Wind & rain', 0, 1, 0.05),
  ],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (block/allow/dns/dhcp/wifi) and the radio log legend stay fixed so the
        colour law holds.`,
};

/** Stencilled on the holdout's command board. */
export const HOLDOUT_HUD: HudLabelOverrides = {
  mark: '⛨',
  uplink: 'UPLINK',
  link: 'ACTIVE',
  weather: { calm: 'CALM', storm: 'STORM', hurricane: 'HORDE NIGHT' },
  status: 'LAST OUTPOST',
  threat: 'THREAT',
  power: 'SUPPLY',
  telemetry: 'COMMAND LOG',
  uptime: 'DAYS HOLDING',
  contacts: 'SURVIVORS',
  nodes: 'POSTS',
  denied: 'KILLS',
  traffic: 'UPLINK CALLS',
  mostWanted: 'HOT SECTORS',
  noHostiles: '— PERIMETER QUIET —',
  spectrum: 'SIGNAL NOISE',
  flux: 'ACTIVITY',
  scan: 'PERIMETER',
  comms: 'COMMS LOG',
  panel: {
    uplink: 'Uplink', threatBar: 'Threat / supply', telemetry: 'Command log',
    mostWanted: 'Hot sectors', terminal: 'Comms log', oscilloscope: 'Activity',
    spectrum: 'Signal noise', radar: 'Perimeter (radar)',
  },
};
