import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';

export type MeshMode = 'law' | 'spectrum' | 'mono' | 'warm' | 'cool';

/** Orbital Command's own settings (stored alongside the core ones). */
export const SCIFI_DEFAULTS = {
  starfield: true,
  nebula: true,
  dust: true,
  constellations: true,
  crystals: true,
  asteroids: true,
  threatMissiles: true,     // IDS threats fly looping attack paths into the core
  ringObjects: true,
  apCores: true,
  eventStars: true,
  planets: true,
  screenShake: true,
  ambientShips: true,
  meshMode: 'spectrum' as MeshMode,   // host-mesh colouring scheme

  // scene budgets = the HIGH preset
  maxParticles: 4000,
  starDensity: 1,         // multiplier on the screen-area star count
  nebulaCount: 7,
  dustCount: 70,
  fxDetail: 1,            // 0..1: station aura/sparks, crystal trails & mist
  maxIpStars: 140,        // constellation node cap
  maxEventStars: 260,
};

export type SciFiSettings = CoreSettings & typeof SCIFI_DEFAULTS;

export const SCIFI_BUDGETS: Budgets = {
  low: {
    maxParticles: 800, starDensity: 0.4, nebulaCount: 3, dustCount: 20,
    fxDetail: 0.5, maxIpStars: 60, maxEventStars: 100,
  },
  medium: {
    maxParticles: 2000, starDensity: 0.7, nebulaCount: 5, dustCount: 45,
    fxDetail: 0.75, maxIpStars: 100, maxEventStars: 180,
  },
  high: {
    maxParticles: 4000, starDensity: 1, nebulaCount: 7, dustCount: 70,
    fxDetail: 1, maxIpStars: 140, maxEventStars: 260,
  },
  ultra: {
    maxParticles: 8000, starDensity: 1.5, nebulaCount: 9, dustCount: 140,
    fxDetail: 1, maxIpStars: 200, maxEventStars: 400,
  },
};

const toggle = (key: keyof typeof SCIFI_DEFAULTS, label: string): Control =>
  ({ kind: 'toggle', key, label });
const range = (key: keyof typeof SCIFI_DEFAULTS, label: string,
               min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const SCIFI_CONTROLS = {
  scene: [
    toggle('starfield', 'Starfield'), toggle('nebula', 'Nebula clouds'), toggle('dust', 'Space dust'),
    toggle('ambientShips', 'Ambient ships'), toggle('planets', 'DHCP planets'), toggle('eventStars', 'Event stars'),
    toggle('asteroids', 'Block asteroids'), toggle('threatMissiles', 'Threat missiles'),
    toggle('crystals', 'Allow crystals'),
    toggle('constellations', 'IP constellations'), toggle('ringObjects', 'Ring objects'),
    toggle('apCores', 'AP cores'), toggle('screenShake', 'Screen shake'),
  ],
  budgets: [
    range('maxParticles', 'Particles', 200, 8000, 100),
    range('starDensity', 'Star density', 0.25, 1.5, 0.05),
    range('nebulaCount', 'Nebulae', 0, 9, 1),
    range('dustCount', 'Dust motes', 0, 140, 10),
    range('fxDetail', 'FX detail', 0.25, 1, 0.05),
    range('maxIpStars', 'IP stars', 40, 200, 10),
    range('maxEventStars', 'Event stars', 50, 400, 10),
  ],
  color: [{
    kind: 'select', key: 'meshMode', label: 'Scheme',
    options: [
      ['spectrum', 'Spectrum (rainbow web)'], ['law', 'Event-law (all allow-green)'],
      ['mono', 'Mono (cyan)'], ['warm', 'Warm'], ['cool', 'Cool'],
    ],
  }] as Control[],
  colorGroup: 'Host-mesh palette',
  colorHint: `Hue shift & intensity sweep the mesh, nebula and HUD
        accent. Event colours (block/allow/dns/dhcp/wifi) and the terminal
        legend stay fixed so the colour law holds — pick the
        <b>Event-law</b> scheme to force the web green.`,
};
