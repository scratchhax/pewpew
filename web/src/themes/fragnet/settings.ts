import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { FRAGNET_MUSIC } from './score';

/**
 * FRAGNET's own settings. Keys are d-prefixed (d + a capital letter): all
 * themes share one saved settings object.
 */
export const FRAGNET_DEFAULTS = {
  dShots: true,         // allow → the marine fires, ammo ticks up
  dDemons: true,        // threat → a demon spawns and the marine frags it
  dDoors: true,         // block → a blast door seals red somewhere
  dSecrets: true,       // dhcp → a secret wall opens with the hostname
  dPlates: true,        // dns → domain name plates light up on walls
  dTele: true,          // wifi → teleporters spin up / zap
  dWeapon: true,        // the shotgun in frame
  dGore: true,          // gib bursts when a demon pops
  dMusicVisuals: true,  // lamps and the gun breathe with the music
  dWalkSpeed: 1,        // patrol pace
  dFrags: 5,            // traces per level before the exit opens

  // soundtrack
  dMusicStyle: 'rotate' as string,
  dMusicRotate: 6,
  dSfx: 0.75,           // shotgun, growls, doors, pickups
  dAmbience: 0.5,       // boiler hum, distant rumble

  // scene budgets = the HIGH preset
  dMapSize: 32,         // maze edge in cells
  dPixRes: 240,         // internal render height in pixels (DOOM was 200)
};

export const FRAGNET_BUDGETS: Budgets = {
  low: { dMapSize: 20, dPixRes: 180 },
  medium: { dMapSize: 26, dPixRes: 216 },
  high: { dMapSize: 32, dPixRes: 240 },
  ultra: { dMapSize: 48, dPixRes: 360 },
};

type Key = keyof typeof FRAGNET_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const FRAGNET_CONTROLS = {
  scene: [
    toggle('dShots', 'Marine fires (allow)'),
    toggle('dDemons', 'Demons & auto-frag (threat)'),
    toggle('dDoors', 'Blast doors seal (block)'),
    toggle('dSecrets', 'Secret walls (DHCP)'),
    toggle('dPlates', 'Domain name plates (DNS)'),
    toggle('dTele', 'Teleporters (Wi-Fi)'),
    toggle('dWeapon', 'Weapon view'),
    toggle('dGore', 'Gib bursts'),
    toggle('dMusicVisuals', 'Move with the music'),
    range('dWalkSpeed', 'Patrol speed', 0.3, 2.5, 0.05),
    range('dFrags', 'Traces per level', 1, 15, 1),
  ],
  audio: [
    { kind: 'select', key: 'dMusicStyle', label: 'Music', options: FRAGNET_MUSIC } as Control,
    range('dMusicRotate', 'Rotate every (min)', 1, 30, 0.5),
    range('dSfx', 'Combat sounds', 0, 1, 0.05),
    range('dAmbience', 'Boiler & rumble', 0, 1, 0.05),
  ],
  budgets: [
    range('dMapSize', 'Maze size (cells)', 12, 56, 2),
    range('dPixRes', 'Screen pixels (height)', 144, 480, 8),
  ],
  color: [],
};

/** HUD panels re-badged for the corridor shooter. */
export const FRAGNET_HUD: HudLabelOverrides = {
  uplink: 'UPLINK', status: 'SUIT STATUS', threat: 'HELL', power: 'ARMOR',
  telemetry: 'LOGBOOK', contacts: 'HOSTS', nodes: 'NODES', denied: 'DENIED',
  mostWanted: 'MOST FRAGGED', noHostiles: '— HELL IS QUIET —',
  spectrum: 'SPECTRUM ANALYSER', flux: 'HELL FLUX', comms: 'FRAG LOG',
  weather: { calm: 'CLEAR', storm: 'BLOOD MOON', hurricane: 'APEX WORSTED' },
  panel: {
    uplink: 'Uplink', threatBar: 'Suit status bars', telemetry: 'Logbook',
    mostWanted: 'Most fragged', terminal: 'Frag log', oscilloscope: 'Hell flux',
    spectrum: 'Spectrum', radar: 'Radar', scanlines: 'Scanlines',
  },
};
