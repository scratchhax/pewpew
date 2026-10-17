import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { CLOCKWORK_MUSIC } from './score';

/**
 * Clockwork's own settings. Keys are k-prefixed: all themes share one saved
 * settings object.
 */
export const CLOCKWORK_DEFAULTS = {
  kBalls: true,          // allow → ball bearings down the run
  cGates: true,          // block → gate slams under a rolling ball
  kMail: true,           // dns → pneumatic envelope up the tube
  kPlates: true,         // dhcp → nameplate stamped onto the rack
  kClamp: true,          // wifi → coupling arm clamps a hose
  kWhistle: true,        // threat → whistle, warning lamp, coal cart
  kShudder: true,        // system → the master clutch drops
  kChains: true,         // mechanisms trip their neighbours
  kSteam: true,          // ambient steam from the valves

  // soundtrack
  kMusicStyle: 'auto' as string,   // auto | tick | build | steam
  kMusicRotate: 5,
  kSfx: 0.8,                       // clacks, whistles, stamps
  kAmb: 0.5,                       // furnace and steam bed

  // scene budgets = the HIGH preset
  kMaxParticles: 400,
  kGearTeeth: 16,        // teeth on the big gears (detail)
  kMaxBalls: 24,
  kSteamDensity: 1,
  kRack: 24,             // nameplates the rack can hold
};

export const CLOCKWORK_BUDGETS: Budgets = {
  low: { kMaxParticles: 120, kGearTeeth: 10, kMaxBalls: 10, kSteamDensity: 0.35, kRack: 12 },
  medium: { kMaxParticles: 250, kGearTeeth: 13, kMaxBalls: 16, kSteamDensity: 0.65, kRack: 18 },
  high: { kMaxParticles: 400, kGearTeeth: 16, kMaxBalls: 24, kSteamDensity: 1, kRack: 24 },
  ultra: { kMaxParticles: 700, kGearTeeth: 20, kMaxBalls: 36, kSteamDensity: 1.5, kRack: 32 },
};

type Key = keyof typeof CLOCKWORK_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const CLOCKWORK_CONTROLS = {
  scene: [
    toggle('kBalls', 'Ball bearings (allow)'), toggle('cGates', 'Safety gates (block)'),
    toggle('kMail', 'Pneumatic mail (DNS)'), toggle('kPlates', 'Nameplates (DHCP)'),
    toggle('kClamp', 'Coupling arm (Wi-Fi)'), toggle('kWhistle', 'Whistle & coal cart (threat)'),
    toggle('kShudder', 'Master clutch (system)'), toggle('kChains', 'Chain reactions'),
    toggle('kSteam', 'Valve steam'),
  ],
  budgets: [
    range('kMaxParticles', 'Particles', 60, 900, 20),
    range('kGearTeeth', 'Gear teeth', 8, 22, 1),
    range('kMaxBalls', 'Ball bearings', 6, 48, 2),
    range('kSteamDensity', 'Steam', 0, 1.5, 0.05),
    range('kRack', 'Nameplate rack', 8, 40, 2),
  ],
  color: [] as Control[],
  audio: [
    { kind: 'select', key: 'kMusicStyle', label: 'Music', options: CLOCKWORK_MUSIC } as Control,
    range('kMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('kSfx', 'Machine sounds', 0, 1, 0.05),
    range('kAmb', 'Furnace & steam', 0, 1, 0.05),
  ],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (bearings green, gates red, mail blue, plates yellow, couplings purple,
        the alarm amber) stay fixed.`,
};

export const CLOCKWORK_HUD: HudLabelOverrides = {
  uplink: 'MACHINE',
  link: 'FIRED UP',
  weather: { calm: 'IDLE TICK', storm: 'PRESSURE BUILD', hurricane: 'FULL STEAM' },
  status: 'PRESSURE',
  threat: 'ALARM',
  power: 'FIRE',
  telemetry: 'STOKED',
  uptime: 'RUN TIME',
  contacts: 'THE RACK',
  nodes: 'POST',
  denied: 'DENIED',
  traffic: 'COAL',
  mostWanted: 'WORST OFFENDERS',
  noHostiles: '- ALL IS TICKING -',
  spectrum: 'GAUGES',
  flux: 'PRESSURE',
  scan: 'CLUTCH',
  comms: 'MACHINE LOG',
  panel: {
    uplink: 'Machine status', threatBar: 'Alarm / fire meters', telemetry: 'Stoked today',
    mostWanted: 'Worst offenders', terminal: 'Machine log', oscilloscope: 'Pressure',
    spectrum: 'Gauges', radar: 'Clutch',
  },
};
