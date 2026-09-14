import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Last Outpost's own settings. Keys are z-prefixed: every theme shares one
 * saved settings object, so a sci-fi particle budget never leaks in here.
 */
export const ZOMBIE_DEFAULTS = {
  zZombies: true,        // block → zombies shot down at the fence
  zHordes: true,         // IDS threat → brute + pack breach, alarm
  zScavengers: true,     // allow (border) → supply runs in and out
  zCouriers: true,       // allow (LAN↔LAN) → survivors walking between tents
  zRadio: true,          // dns → radio pulses to the mast
  zNewcomers: true,      // dhcp → survivors arriving, tents going up
  zBuildings: true,      // AP / gateway hosts as buildings (wifi, dhcp, system)
  zDayNight: true,       // weather darkens the map, lights come on
  zRain: true,
  zBlood: true,
  zScreenShake: true,

  // scene budgets = the HIGH preset
  zMaxParticles: 3000,
  zMaxZombies: 12,
  zMaxDecals: 140,
  zRainDensity: 1,
  zMaxTents: 28,
  zNightExtras: true,     // fog + survivor flashlights (fill-heavy on small GPUs)
};

export type ZombieSettings = CoreSettings & typeof ZOMBIE_DEFAULTS;

export const ZOMBIE_BUDGETS: Budgets = {
  low: { zMaxParticles: 600, zMaxZombies: 8, zMaxDecals: 30, zRainDensity: 0.3, zMaxTents: 16, zNightExtras: false },
  medium: { zMaxParticles: 1500, zMaxZombies: 10, zMaxDecals: 70, zRainDensity: 0.6, zMaxTents: 22, zNightExtras: true },
  high: { zMaxParticles: 3000, zMaxZombies: 12, zMaxDecals: 140, zRainDensity: 1, zMaxTents: 28, zNightExtras: true },
  ultra: { zMaxParticles: 6000, zMaxZombies: 18, zMaxDecals: 260, zRainDensity: 1.5, zMaxTents: 36, zNightExtras: true },
};

type Key = keyof typeof ZOMBIE_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const ZOMBIE_CONTROLS = {
  scene: [
    toggle('zZombies', 'Block zombies'), toggle('zHordes', 'Threat hordes'),
    toggle('zScavengers', 'Supply runs'), toggle('zCouriers', 'LAN couriers'),
    toggle('zRadio', 'DNS radio'), toggle('zNewcomers', 'DHCP arrivals'),
    toggle('zBuildings', 'AP buildings'), toggle('zDayNight', 'Day / night'),
    toggle('zRain', 'Rain'), toggle('zBlood', 'Blood'), toggle('zScreenShake', 'Screen shake'),
  ],
  budgets: [
    range('zMaxParticles', 'Particles', 200, 6000, 100),
    range('zMaxZombies', 'Zombies', 4, 18, 1),
    range('zMaxDecals', 'Blood decals', 0, 260, 10),
    range('zRainDensity', 'Rain', 0, 1.5, 0.05),
    range('zMaxTents', 'Tents', 8, 36, 1),
    toggle('zNightExtras', 'Fog + flashlights'),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (block/allow/dns/dhcp/wifi) and the radio log legend stay fixed so the
        colour law holds.`,
};

export const ZOMBIE_HUD: HudLabelOverrides = {
  uplink: 'RADIO',
  link: 'ON AIR',
  weather: { calm: 'DAYLIGHT', storm: 'DUSK', hurricane: 'HORDE NIGHT' },
  status: 'COMPOUND',
  threat: 'DGR',
  power: 'SUP',
  telemetry: 'SURVIVAL LOG',
  uptime: 'HOLDING OUT',
  contacts: 'SURVIVORS',
  nodes: 'OUTPOSTS',
  denied: 'ZOMBIES DOWN',
  traffic: 'RADIO CALLS',
  mostWanted: 'HOT ZONES',
  noHostiles: '— ALL QUIET —',
  spectrum: 'NOISE LEVEL',
  flux: 'ACTIVITY',
  scan: 'PERIMETER',
  comms: 'RADIO LOG',
  panel: {
    uplink: 'Radio', threatBar: 'Danger / supply bars', telemetry: 'Survival log',
    mostWanted: 'Hot zones', terminal: 'Radio log', oscilloscope: 'Activity',
    spectrum: 'Noise level', radar: 'Perimeter (radar)',
  },
};
