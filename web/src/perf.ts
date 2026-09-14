import { CoreSettings, ThemeSettings, lockSetting } from './settings';

/**
 * Performance presets + auto tuning.
 *
 * The relay does no rendering: every viewer draws the scene on its own GPU,
 * and viewers range from a gaming PC to a Pi 5 kiosk. A quality tier bundles
 * every knob that trades looks for frame time: the renderer knobs here, plus
 * the scene budgets the active theme declares. HIGH is the classic look, so a
 * capable machine sees no change.
 */

export type Tier = 'low' | 'medium' | 'high' | 'ultra';
export const TIERS: Tier[] = ['low', 'medium', 'high', 'ultra'];

export type RendererPerf = Pick<CoreSettings, 'renderScale' | 'fpsCap' | 'antialias' | 'powerPref'>;

/** Read once by the renderer at init; changing them needs a page reload. */
export const INIT_ONLY_KEYS: string[] = ['antialias', 'powerPref'];

export function rendererPreset(tier: Tier): RendererPerf {
  switch (tier) {
    case 'low': return { renderScale: 0.6, fpsCap: 30, antialias: false, powerPref: 'low-power' };
    case 'medium': return { renderScale: 0.8, fpsCap: 60, antialias: false, powerPref: 'default' };
    case 'high': return { renderScale: 1, fpsCap: 0, antialias: false, powerPref: 'low-power' };
    case 'ultra': return {
      renderScale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
      fpsCap: 0, antialias: true, powerPref: 'high-performance',
    };
  }
}

export const RENDERER_KEYS = Object.keys(rendererPreset('high'));

/** The active theme's scene budgets per tier (see Theme.budgets). */
export type Budgets = Record<Tier, Partial<ThemeSettings>>;

/** Every key a preset writes: moving any of them by hand means `custom`. */
export function perfKeys(budgets: Budgets): string[] {
  return [...RENDERER_KEYS, ...Object.keys(budgets.high)];
}

/** Values pinned by URL params (?scale, ?fps): re-applied over every preset. */
const urlPins: Partial<RendererPerf> = {};

/**
 * Write a tier's values into the live settings. `live` skips the init-only
 * keys, so an auto step-down never leaves a phantom "reload pending".
 */
export function applyTier(s: CoreSettings, budgets: Budgets, tier: Tier, live = false): void {
  const v: Record<string, unknown> = { ...rendererPreset(tier), ...budgets[tier] };
  if (live) for (const k of INIT_ONLY_KEYS) delete v[k];
  Object.assign(s, v, urlPins);
}

/** `?quality=low|medium|high|ultra|auto`, `?scale=0.6`, `?fps=30`. */
function readUrlOverrides(s: CoreSettings): void {
  const q = new URLSearchParams(location.search);
  const quality = q.get('quality');
  if (quality && (quality === 'auto' || (TIERS as string[]).includes(quality))) {
    s.quality = quality as CoreSettings['quality'];
    lockSetting('quality');
  }
  const scale = parseFloat(q.get('scale') ?? '');
  if (isFinite(scale) && scale > 0) {
    urlPins.renderScale = Math.min(2, Math.max(0.25, scale));
    lockSetting('renderScale');
  }
  const fps = parseInt(q.get('fps') ?? '', 10);
  if (isFinite(fps) && fps >= 0) {
    urlPins.fpsCap = fps;
    lockSetting('fpsCap');
  }
}

/** Unmasked WebGL renderer string, or null if WebGL is unavailable. */
function probeGpu(): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return null;
  }
}

/**
 * Boot-time guess for `auto`. Never picks ULTRA (antialias + DPR scale is an
 * opt-in), and errs high: the tuner can only step down, never back up.
 */
export function guessTier(gpu: string | null): { tier: Tier; why: string } {
  if (gpu === null) return { tier: 'low', why: 'no WebGL' };
  if (/llvmpipe|swiftshader|softpipe|software|basic render/i.test(gpu))
    return { tier: 'low', why: 'software renderer' };
  // Pi 4/5 (V3D / VideoCore), phone & SBC GPUs
  if (/v3d|videocore|broadcom|mali|adreno|powervr|vivante/i.test(gpu))
    return { tier: 'low', why: 'embedded GPU' };
  if (matchMedia('(pointer: coarse)').matches)
    return { tier: 'medium', why: 'touch device' };
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (cores <= 4) return { tier: 'medium', why: `${cores} CPU cores` };
  if (mem !== undefined && mem <= 4) return { tier: 'medium', why: `${mem}GB memory` };
  if (/intel.*\b(u?hd) graphics/i.test(gpu)) return { tier: 'medium', why: 'integrated GPU' };
  return { tier: 'high', why: 'capable GPU' };
}

export interface BootPerf {
  /** Tier in effect, or null when the user runs custom values. */
  tier: Tier | null;
  gpu: string | null;
  why: string;
}

/**
 * Resolve the perf settings before the renderer exists: URL params first,
 * then the saved quality, then (for auto) a hardware guess.
 */
export function resolveBootPerf(s: CoreSettings, budgets: Budgets): BootPerf {
  readUrlOverrides(s);
  const gpu = probeGpu();
  if (s.quality === 'custom') {
    Object.assign(s, urlPins);
    return { tier: null, gpu, why: 'custom' };
  }
  if (s.quality === 'auto') {
    const g = guessTier(gpu);
    applyTier(s, budgets, g.tier);
    return { tier: g.tier, gpu, why: g.why };
  }
  applyTier(s, budgets, s.quality);
  return { tier: s.quality, gpu, why: 'preset' };
}

const WARMUP_MS = 8000;   // boot + the 500-event snapshot replay burst
const SETTLE_MS = 4000;   // after a step: rebuilds hitch for a moment
const WINDOW_MS = 5000;

/**
 * Auto mode frame watchdog. Measures real frames per second over a rolling
 * window and drops one tier when it stays well under target. It only ever
 * steps DOWN, so it can't oscillate; a reload starts from the guess again.
 */
export class AutoTuner {
  tier: Tier | null;
  fps = 0;
  private frames = 0;
  private windowStart = 0;
  private holdUntil = 0;
  private lastFrame = 0;

  constructor(private s: CoreSettings, private budgets: Budgets, boot: BootPerf,
              private onStep: (tier: Tier) => void) {
    this.tier = boot.tier;
    this.hold(WARMUP_MS);
    document.addEventListener('visibilitychange', () => this.hold(SETTLE_MS));
  }

  /** Restart measuring (tier change, tab back in view, user picked auto). */
  reset(tier: Tier | null, ms = SETTLE_MS): void {
    this.tier = tier;
    this.hold(ms);
  }

  private hold(ms: number): void {
    const now = performance.now();
    this.holdUntil = now + ms;
    this.windowStart = this.holdUntil;
    this.frames = 0;
  }

  frame(now: number): void {
    // a stall (hidden tab, blocked main thread) isn't a rendering problem
    if (now - this.lastFrame > 1000) this.hold(SETTLE_MS);
    this.lastFrame = now;
    if (now < this.holdUntil) return;
    this.frames++;
    const span = now - this.windowStart;
    if (span < WINDOW_MS) return;
    this.fps = (this.frames * 1000) / span;
    this.frames = 0;
    this.windowStart = now;

    if (this.s.quality !== 'auto' || this.tier === null || this.tier === 'low') return;
    const target = this.s.fpsCap > 0 ? Math.min(60, this.s.fpsCap) : 60;
    if (this.fps < target * 0.75) {
      const next = TIERS[TIERS.indexOf(this.tier) - 1];
      this.tier = next;
      applyTier(this.s, this.budgets, next, true);
      this.hold(SETTLE_MS);
      this.onStep(next);
    }
  }
}
