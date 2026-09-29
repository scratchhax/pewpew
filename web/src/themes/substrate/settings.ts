import type { CoreSettings } from '../../settings';
import type { Budgets } from '../../perf';
import type { Control } from '../../theme';
import type { HudLabelOverrides } from '../../hud/hud';

/**
 * Substrate's own settings. Keys are c-prefixed (for *crack*, the scene's only
 * primitive): every theme shares one saved settings object, so another scene's
 * budgets never leak in here. `s` was already taken by Orbital Command.
 */
export const SUBSTRATE_DEFAULTS = {
  cSeeds: true,          // hosts plant the seed cells the lattice grows from
  cAllowCracks: true,    // allow → a crack sets off across the plate
  cBlockScars: true,     // block → a short, agitated crack that leaves a dark scar
  cThreatFracture: true, // threat → a long fracture cuts clean across the picture
  cBlooms: true,         // dns → a wash of pigment pools at a junction
  cSprouts: true,        // dhcp → a new device plants a new seed cell
  cSpores: true,         // wifi → faint pigment drifts off the gateway
  cLabels: true,         // the host that owns the busiest district gets named
  cSand: true,           // the watercolour wash beside each crack (the whole look)
  cHairline: true,       // the thin dark line of the crack itself

  cCycleSec: 120,        // seconds of growth before the picture is finished
  cInk: 1,               // pigment strength (sand alpha multiplier)
  cCurve: 1,             // how much the cracks wander, × the traffic-driven range
  cRotate: true,         // a different paper and pigment cast per picture
  cPaper: 0,             // 0 = warm paper, 1 = dark plate (when not rotating)

  // soundtrack
  cNib: 0.8,             // the drawing itself: nib on paper
  cRoom: 0.6,            // room air and the low drone under it
  cChime: 0.7,           // the small notes events ring

  // scene budgets = the HIGH preset (the Theme contract requires this)
  cDensity: 200,         // concurrent cracks
  cGrains: 64,           // grains per wash — the texture of the pigment
  cSteps: 0.75,          // crack advances per 1/60s (fractional: see the note)
  cGridScale: 1,         // lattice cells per CSS pixel
  cMaxGrains: 48000,     // grains drawn in any one frame
};

export type SubstrateSettings = CoreSettings & typeof SUBSTRATE_DEFAULTS;

/**
 * The tiers stay close together on purpose, and LOW overrides the renderer's
 * own `renderScale`.
 *
 * Every other scene is shading pixels or pushing geometry, so dropping
 * resolution is the right lever for them. Substrate is not: per frame it walks
 * a few hundred cells of Int32Array and stamps some soft dots into a texture
 * that is never cleared, and none of that gets cheaper with fewer pixels.
 * What resolution *does* buy here is the whole look — a hairline lattice and a
 * graded wash — so the first cut of LOW (0.6 render scale over a 0.6-scale
 * lattice, 16 grains a stroke) threw away the gradients to save work the scene
 * was not doing. Theme budgets are spread over the renderer preset in
 * `applyTier`, which lets a scene say so.
 *
 * A crack advances 0.42 of a cell per step, and `cSteps` counts steps per
 * 1/60s of REAL time rather than per frame, so a slow screen takes bigger
 * steps and finishes the same picture in the same two minutes. It is still
 * deliberately below
 * one on most tiers: the picture is meant to take a couple of minutes, and a
 * whole step every frame would have every crack across the plate inside ten
 * seconds, before any lattice exists for it to stop against.
 */
export const SUBSTRATE_BUDGETS: Budgets = {
  low: { cDensity: 150, cGrains: 40, cSteps: 0.7, cGridScale: 0.85, cMaxGrains: 16000, renderScale: 0.85 },
  medium: { cDensity: 175, cGrains: 52, cSteps: 0.72, cGridScale: 1, cMaxGrains: 28000, renderScale: 1 },
  high: { cDensity: 200, cGrains: 64, cSteps: 0.75, cGridScale: 1, cMaxGrains: 48000 },
  ultra: { cDensity: 360, cGrains: 96, cSteps: 0.65, cGridScale: 1.25, cMaxGrains: 90000 },
};

type Key = keyof typeof SUBSTRATE_DEFAULTS;
const toggle = (key: Key, label: string): Control => ({ kind: 'toggle', key, label });
const range = (key: Key, label: string, min: number, max: number, step: number): Control =>
  ({ kind: 'range', key, label, min, max, step });

export const SUBSTRATE_CONTROLS = {
  scene: [
    toggle('cAllowCracks', 'Allow cracks'), toggle('cBlockScars', 'Block scars'),
    toggle('cThreatFracture', 'Threat fractures'), toggle('cBlooms', 'DNS blooms'),
    toggle('cSprouts', 'DHCP seeds'), toggle('cSpores', 'Wi-Fi drift'),
    toggle('cSeeds', 'Hosts plant the lattice'), toggle('cSand', 'Pigment wash'),
    toggle('cHairline', 'Crack hairlines'), toggle('cLabels', 'Name the busiest district'),
  ],
  budgets: [
    range('cCycleSec', 'Seconds per picture', 30, 600, 10),
    range('cInk', 'Pigment strength', 0.2, 3, 0.05),
    range('cCurve', 'Wander', 0, 2, 0.05),
    range('cDensity', 'Cracks at once', 20, 400, 10),
    range('cGrains', 'Grains per wash', 8, 128, 4),
    range('cSteps', 'Growth rate', 0.1, 3, 0.05),
    range('cGridScale', 'Lattice resolution', 0.5, 1.5, 0.05),
    range('cMaxGrains', 'Grains per frame', 4000, 120000, 2000),
  ],
  color: [
    toggle('cRotate', 'A new paper each picture'),
    range('cPaper', 'Plate darkness', 0, 1, 0.05),
  ],
  audio: [
    range('cNib', 'Drawing', 0, 1, 0.05),
    range('cRoom', 'Room', 0, 1, 0.05),
    range('cChime', 'Notes', 0, 1, 0.05),
  ],
  colorHint: `Hue shift & intensity recolour the HUD accent. The pigment follows
    the colour law — allow green, block red, DNS blue, DHCP yellow, Wi-Fi violet,
    threat amber — shaded per host and per domain, so the picture is coloured by
    whatever your network actually did.`,
};

/** The HUD as a plate the network is drawing on. */
export const SUBSTRATE_HUD: HudLabelOverrides = {
  mark: '▧',
  uplink: 'PLATE',
  link: 'SUBSTRATE',
  weather: { calm: 'SETTLING', storm: 'CRAZING', hurricane: 'SHATTERING' },
  status: 'PLATE STATE',
  threat: 'FRC',
  power: 'INK',
  telemetry: 'PLATE NOTES',
  uptime: 'DRAWING',
  contacts: 'HOSTS',
  nodes: 'SEEDS',
  denied: 'SCARRED',
  traffic: 'FLOW',
  mostWanted: 'BUSIEST DISTRICTS',
  noHostiles: '— UNBROKEN —',
  spectrum: 'PIGMENT SPECTRUM',
  flux: 'GROWTH',
  scan: 'PLATE (RADAR)',
  comms: 'PLATE RECORDS',
  panel: {
    uplink: 'Plate', threatBar: 'Fracture / ink bars', telemetry: 'Plate notes',
    mostWanted: 'Busiest districts', terminal: 'Plate records', oscilloscope: 'Growth',
    spectrum: 'Pigment spectrum', radar: 'Plate (radar)',
  },
};
