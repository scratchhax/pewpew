import type { CoreSettings, ThemeSettings, PowerPref } from './settings';
import type { State } from './state';
import type { Throttle } from './throttle';
import type { SceneEvent } from './events';
import type { Tier } from './perf';
import type { Cue, MusicPulse, ScoreFactory, SfxOpts } from './audio';
import type { HudLabelOverrides } from './hud/hud';

/**
 * A viewer theme: everything that decides how network events LOOK.
 *
 * The core (app.ts) owns the relay feed and demo generator, event
 * classification, sim state and weather, the HUD and comms log, the settings
 * panel, audio engine, quality presets + auto tuner and the frame loop. A theme
 * owns its renderer and scene, turns SceneEvents into visuals, and declares
 * its own settings, panel controls and per-tier scene budgets.
 */
export interface Theme<T extends ThemeSettings = ThemeSettings> {
  /** Short id, e.g. 'scifi'. */
  id: string;
  /** Settings panel title. */
  title: string;
  /** Rename HUD panels and readouts (the data behind them is shared). */
  hud?: HudLabelOverrides;
  /** Base hue (degrees) of the HUD accent before the hue-shift knob; default 172 (cyan).
   *  The page also gets data-theme="<id>" on <body> for theme CSS overrides. */
  accentHue?: number;
  /** The theme's own settings with defaults (merged over the core ones). */
  defaults: T;
  /** Scene budgets per quality tier. HIGH must equal `defaults`. */
  budgets: Record<Tier, Partial<T>>;
  /** Panel controls the theme contributes. */
  controls: {
    scene: Control[];
    budgets: Control[];
    color: Control[];
    colorGroup?: string;
    colorHint?: string;
    /** Extra controls on the Audio tab for the theme's own score. */
    audio?: Control[];
  };
  /** The theme's own music and sound design; without one the built-in (sci-fi) band plays. */
  score?: ScoreFactory;
  /** Create the renderer inside `host.mount`; resolves once ready to draw. */
  create(host: ThemeHost<T>, init: RendererInit): Promise<ThemeInstance>;
}

export interface ThemeInstance {
  /** One classified event. `replay` = snapshot backfill: update counters and
   *  ambient state, but don't fire one-shot effects or sounds. */
  event(e: SceneEvent, replay: boolean): void;
  /** Simulate and render one frame. */
  frame(f: FrameInfo): void;
  /** A setting changed (undefined = everything, e.g. reset). */
  settingsChanged(key?: string): void;
  /** Push the current scene budgets from settings into the scene. */
  applyBudgets(): void;
  /** Canvas pixels per CSS pixel, applied live. */
  setResolution(scale: number): void;
  /** Debug overlay extras, e.g. scene node count. */
  stats(): Record<string, string | number>;
  /** Objects exposed on `window.__diag` with `?diag`. */
  diag?(): Record<string, unknown>;
}

export interface ThemeHost<T extends ThemeSettings = ThemeSettings> {
  settings: CoreSettings & T;
  state: State;
  throttle: Throttle;
  audio: AudioCues;
  /** Element the theme mounts its canvas into (full-window, under the HUD). */
  mount: HTMLElement;
}

/** The slice of the audio engine a theme drives. */
export interface AudioCues {
  /** Musical cue for an effect the theme actually showed (after its gates). */
  cueSong(kind: Cue, srcIp?: string): void;
  /** Hold the "under attack" bed while the theme shows an active threat. */
  setThreatActive(on: boolean): void;
  /** A sound effect only the theme's own score defines (ignored by the built-in band). */
  sfx(name: string, opts?: SfxOpts): void;
  /** The theme score's musical clock (null until audio starts, or without a score). */
  pulse(): MusicPulse | null;
}

export interface RendererInit {
  antialias: boolean;
  powerPref: PowerPref;
  resolution: number;
}

export interface FrameInfo {
  /** Sim seconds: real time × sim speed × bullet-time. */
  dt: number;
  /** Wall seconds since last frame, clamped to 50ms. */
  dtReal: number;
  /** Wall clock in seconds. */
  t: number;
  /** Anti burn-in drift in px (±2% of the screen, very slow); the HUD rides
   *  40% of it, the theme should move its camera by it. */
  wanderX: number;
  wanderY: number;
}

/** Declarative settings panel control. */
export type Control =
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'range'; key: string; label: string; min: number; max: number; step: number }
  | { kind: 'select'; key: string; label: string; options: Array<[string, string]>; numeric?: boolean };
