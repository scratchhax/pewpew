import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Packet Rush's own settings. Keys are p-prefixed: all themes share one saved
 * settings object.
 */
export const RUSH_DEFAULTS = {
  pGems: true,           // allow → gems
  pBaddies: true,        // block → crawlers and hoppers (and brick walls on bursts)
  pQueries: true,        // dns → query blocks with the domain and a power-up
  pRivals: true,         // dhcp → rival runners with the hostname
  pFlags: true,          // wifi → checkpoint flags
  pDrone: true,          // threat → the hunter drone
  pWeather: true,        // rain in the factory, embers in the castle
  pTurbo: true,          // bursts of traffic light the turbo

  // scene budgets = the HIGH preset
  pMaxBaddies: 10,
  pMaxGems: 140,
  pParticles: 400,
  pWeatherDensity: 1,
};

export const RUSH_BUDGETS: Budgets = {
  low: { pMaxBaddies: 6, pMaxGems: 60, pParticles: 120, pWeatherDensity: 0.3 },
  medium: { pMaxBaddies: 8, pMaxGems: 100, pParticles: 250, pWeatherDensity: 0.6 },
  high: { pMaxBaddies: 10, pMaxGems: 140, pParticles: 400, pWeatherDensity: 1 },
  ultra: { pMaxBaddies: 14, pMaxGems: 200, pParticles: 700, pWeatherDensity: 1.5 },
};

type Key = keyof typeof RUSH_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const RUSH_CONTROLS = {
  scene: [
    toggle('pGems', 'Gems (allow)'), toggle('pBaddies', 'Baddies (block)'),
    toggle('pQueries', 'Query blocks (DNS)'), toggle('pRivals', 'Rivals (DHCP)'),
    toggle('pFlags', 'Checkpoints (Wi-Fi)'), toggle('pDrone', 'Hunter drone (threat)'),
    toggle('pWeather', 'Rain & embers'), toggle('pTurbo', 'Turbo on bursts'),
  ],
  budgets: [
    range('pMaxBaddies', 'Baddies', 3, 20, 1),
    range('pMaxGems', 'Gems', 30, 250, 10),
    range('pParticles', 'Particles', 60, 900, 20),
    range('pWeatherDensity', 'Weather', 0, 1.5, 0.05),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (gems green, baddies red, query blocks blue, rivals yellow, flags purple,
        the drone amber) stay fixed.`,
};

export const RUSH_HUD: HudLabelOverrides = {
  uplink: 'WORLD',
  link: 'ONLINE',
  weather: { calm: 'GREEN HILLS', storm: 'NEON FACTORY', hurricane: 'LAVA CASTLE' },
  status: 'POWER',
  threat: 'HEAT',
  power: 'BOOST',
  telemetry: 'RUN STATS',
  uptime: 'RUN TIME',
  contacts: 'PLAYERS',
  nodes: 'CHECKPOINTS',
  denied: 'BADDIES',
  traffic: 'PACKETS',
  mostWanted: 'BOSS ROSTER',
  noHostiles: '- NO BOSSES -',
  spectrum: 'SOUND TEST',
  flux: 'SPEED',
  scan: 'RADAR',
  comms: 'QUEST LOG',
  panel: {
    uplink: 'World', threatBar: 'Heat / boost bars', telemetry: 'Run stats',
    mostWanted: 'Boss roster', terminal: 'Quest log', oscilloscope: 'Speed',
    spectrum: 'Sound test', radar: 'Radar',
  },
};
