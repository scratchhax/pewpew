import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { RUSH_MUSIC } from './score';

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
  pBosses: true,         // sustained threats → a boss fight
  pHero: 'bot' as string, // bot | cat | ghost

  // soundtrack
  pMusicStyle: 'world' as string,   // world | rotate | a tune
  pMusicRotate: 5,                  // minutes per calm tune
  pSfx: 0.8,                        // game sound effects
  pAmbience: 0.5,                   // rain in the factory

  // scene budgets = the HIGH preset
  pMaxBaddies: 10,
  pMaxGems: 140,
  pParticles: 400,
  pWeatherDensity: 1,
  pPlanRate: 20,         // how often the runner re-plans (per second)
  pParallax: true,       // clouds and the foreground strip (fill-heavy on small GPUs)
};

export const RUSH_BUDGETS: Budgets = {
  low: { pMaxBaddies: 6, pMaxGems: 60, pParticles: 120, pWeatherDensity: 0.3, pPlanRate: 10, pParallax: false },
  medium: { pMaxBaddies: 8, pMaxGems: 100, pParticles: 250, pWeatherDensity: 0.6, pPlanRate: 15, pParallax: true },
  high: { pMaxBaddies: 10, pMaxGems: 140, pParticles: 400, pWeatherDensity: 1, pPlanRate: 20, pParallax: true },
  ultra: { pMaxBaddies: 14, pMaxGems: 200, pParticles: 700, pWeatherDensity: 1.5, pPlanRate: 30, pParallax: true },
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
    toggle('pBosses', 'Boss fights (threat bursts)'),
    { kind: 'select', key: 'pHero', label: 'Hero', options: [['bot', 'Courier bot'], ['cat', 'Hacker cat'], ['ghost', 'Ghost']] } as Control,
  ],
  budgets: [
    range('pMaxBaddies', 'Baddies', 3, 20, 1),
    range('pMaxGems', 'Gems', 30, 250, 10),
    range('pParticles', 'Particles', 60, 900, 20),
    range('pWeatherDensity', 'Weather', 0, 1.5, 0.05),
    range('pPlanRate', 'Autoplay thinking (per s)', 5, 30, 1),
    toggle('pParallax', 'Clouds & foreground'),
  ],
  color: [] as Control[],
  audio: [
    { kind: 'select', key: 'pMusicStyle', label: 'Music', options: RUSH_MUSIC } as Control,
    range('pMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('pSfx', 'Game sounds', 0, 1, 0.05),
    range('pAmbience', 'Rain', 0, 1, 0.05),
  ],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (gems green, baddies red, query blocks blue, rivals yellow, flags purple,
        the drone amber) stay fixed.`,
};

export const RUSH_HUD: HudLabelOverrides = {
  uplink: 'COURSE',
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
  scan: 'ITEM BOX',
  comms: 'QUEST LOG',
  panel: {
    uplink: 'Course map', threatBar: 'Heat / boost meters', telemetry: 'Run stats',
    mostWanted: 'Boss roster', terminal: 'Quest log', oscilloscope: 'Speed',
    spectrum: 'Sound test', radar: 'Item box',
  },
};
