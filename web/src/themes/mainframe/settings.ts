import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';
import { MAINFRAME_MUSIC } from './score';

/**
 * Mainframe's own settings. Keys are m-prefixed (m + a capital letter): all
 * themes share one saved settings object.
 */
export const MAINFRAME_DEFAULTS = {
  mPackets: true,        // allow → light pulses along the traces
  mFirewalls: true,      // block → pulses shatter against firewall chips
  mWorms: true,          // threat → worms crawl the traces, ICE hunts them
  mLookups: true,        // dns → the domain scrolls across a lookup tower
  mParts: true,          // dhcp → a pick-and-place arm fits a new part
  mAntennas: true,       // wifi → antenna rings
  mBrownouts: true,      // system → a brownout rolls down the board
  mFloatText: true,      // addresses and hex drifting in the air
  mDive: true,           // dive into a chip: triggers like the eye of god
  mDiveThreats: 3,       // IDS/IPS threats inside a minute that trigger a dive
  mDiveSweep: 2,         // otherwise, a dive about this often (minutes)
  mFlightSpeed: 1,       // how fast the camera flies
  mMusicVisuals: true,   // LEDs and packets breathe with the music

  // soundtrack
  mMusicStyle: 'rotate' as string,
  mMusicRotate: 6,
  mSfx: 0.7,             // packet zips, shatters, glitches, servos, the dive
  mAmbience: 0.5,        // fan hum and electrical buzz

  // scene budgets = the HIGH preset
  mMaxPackets: 900,
  mChunks: 4,            // board sections drawn ahead
  mDetail: 1280,         // board texture width per section (px)
  mBloom: true,
  mSmooth: true,         // multisampled edges (applies on reload)
};

export const MAINFRAME_BUDGETS: Budgets = {
  low: { mMaxPackets: 400, mChunks: 3, mDetail: 768, mBloom: false, mSmooth: false },
  medium: { mMaxPackets: 650, mChunks: 3, mDetail: 1024, mBloom: true, mSmooth: true },
  high: { mMaxPackets: 900, mChunks: 4, mDetail: 1280, mBloom: true, mSmooth: true },
  ultra: { mMaxPackets: 1300, mChunks: 5, mDetail: 2048, mBloom: true, mSmooth: true },
};

type Key = keyof typeof MAINFRAME_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const MAINFRAME_CONTROLS = {
  scene: [
    toggle('mPackets', 'Packets (allow)'), toggle('mFirewalls', 'Firewalls (block)'),
    toggle('mWorms', 'Worms & ICE (threat)'), toggle('mLookups', 'Lookup towers (DNS)'),
    toggle('mParts', 'Pick-and-place (DHCP)'), toggle('mAntennas', 'Antennas (Wi-Fi)'),
    toggle('mBrownouts', 'Brownouts (system)'), toggle('mFloatText', 'Floating addresses'),
    toggle('mMusicVisuals', 'Move with the music'),
    range('mFlightSpeed', 'Flight speed', 0.4, 2, 0.05),
    toggle('mDive', 'Dive into a chip'),
    range('mDiveThreats', 'Dive: threats in a minute', 1, 12, 1),
    range('mDiveSweep', 'Dive: random every (min)', 0.5, 30, 0.5),
  ],
  audio: [
    { kind: 'select', key: 'mMusicStyle', label: 'Music', options: MAINFRAME_MUSIC } as Control,
    range('mMusicRotate', 'Rotate every (min)', 1, 30, 1),
    range('mSfx', 'Board sounds', 0, 1, 0.05),
    range('mAmbience', 'Fans & buzz', 0, 1, 0.05),
  ],
  budgets: [
    range('mMaxPackets', 'Packets', 100, 1500, 50),
    range('mChunks', 'Board ahead (sections)', 3, 10, 1),
    { kind: 'select', key: 'mDetail', label: 'Board detail', numeric: true,
      options: [['768', '768'], ['1024', '1024'], ['1536', '1536'], ['2048', '2048']] } as Control,
    toggle('mBloom', 'Bloom'),
    toggle('mSmooth', 'Smooth edges (on reload)'),
  ],
  color: [] as Control[],
  colorHint: `Hue shift & intensity recolour the HUD accent. Event colours
        (packets green, shatters red, lookups blue, parts yellow, antennas purple, worms amber) stay fixed.`,
};

/** Instrument modules racked over the board. */
export const MAINFRAME_HUD: HudLabelOverrides = {
  mark: '▸',
  uplink: 'BUS',
  link: 'ONLINE',
  weather: { calm: 'NOMINAL', storm: 'HEAVY LOAD', hurricane: 'OVERCLOCK' },
  status: 'CORE',
  threat: 'TMP',
  power: 'VCC',
  telemetry: 'SYSTEM',
  uptime: 'UPTIME',
  contacts: 'HOSTS',
  nodes: 'NODES',
  denied: 'DROPPED',
  traffic: 'PACKETS',
  mostWanted: 'INTRUDERS',
  noHostiles: '— SYSTEM CLEAN —',
  spectrum: 'FREQUENCY',
  flux: 'CLOCK',
  scan: 'SCOPE',
  comms: 'SERIAL CONSOLE',
  panel: {
    uplink: 'Bus status', threatBar: 'Core bars', telemetry: 'System',
    mostWanted: 'Intruders', terminal: 'Serial console', oscilloscope: 'Clock',
    spectrum: 'Frequency', radar: 'Scope (radar)',
  },
};
