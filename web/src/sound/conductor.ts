import type { AudioEngine, Cue, MusicPulse, Score, SfxOpts, TrackClock } from '../audio';
import type { State } from '../state';
import { Bus, Synth, type Bed } from './synth';

/**
 * Shared machinery for a theme's soundtrack: a set of styles that take turns
 * (or one pinned from settings), a sample-accurate clock, a grid that event
 * sounds snap to, chord lookup so effects play in key, mixer buses (music,
 * effects through a limiter, ambience), and the pulse visuals follow.
 *
 * A theme extends `Conductor` with its styles, what each event sounds like,
 * and its ambience. See themes/zombie/score.ts and themes/scifi/score.ts.
 */

export interface Mood {
  night: number;       // 0 calm … 0.5 storm … 1 hurricane (eased)
  tension: number;     // 0..1, rises with blocks and threats, bleeds away
  threat: boolean;     // an attack is on screen right now
}

/** Core audio settings every score reads. */
export interface CoreAudio {
  melody: boolean; deviceVoices: boolean; melodyBal: number;
  gBlock: number; gAllow: number; gDns: number; gWifi: number; gDhcp: number; gThreat: number;
  gateBlock: number; gateAllow: number; gateDns: number; gateWifi: number; gateDhcp: number; gateThreat: number;
}

export const semis = (root: number, s: number, oct: number) => root * Math.pow(2, oct + s / 12);
export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const pick = <T>(a: readonly T[]) => a[(Math.random() * a.length) | 0];

/** A style: key, tempo, harmony and its own arrangement. */
export abstract class Style {
  abstract readonly id: string;
  abstract readonly bpm: number;
  abstract readonly root: number;          // tonic frequency at octave 0
  abstract readonly scale: number[];       // for melody (semitones)
  abstract readonly chords: number[][];    // semitones from the tonic
  abstract readonly barsPerChord: number;
  abstract readonly leadOct: number;
  /** Sixteenths per bar (16 = 4/4, 12 = 3/4). */
  readonly barSteps: number = 16;
  /** Mix trim so every style sits at about the same loudness. */
  readonly level: number = 1;
  readonly bus: Bus;
  fadingUntil = 0;

  constructor(protected s: Synth, parent: Bus) {
    this.bus = Bus.under(s.ctx, parent, 0);
  }

  get stepDur(): number { return 60 / this.bpm / 4; }
  chordAt(step: number): number[] {
    return this.chords[Math.floor(step / this.barSteps / this.barsPerChord) % this.chords.length];
  }
  tones(step: number, oct: number): number[] { return this.chordAt(step).map((s) => semis(this.root, s, oct)); }
  isChordStart(step: number): boolean { return step % (this.barSteps * this.barsPerChord) === 0; }
  /** A scale tone near `deg` (can be negative / past an octave). */
  scaleTone(deg: number, oct: number): number {
    const n = this.scale.length;
    const o = Math.floor(deg / n);
    return semis(this.root, this.scale[((deg % n) + n) % n], oct + o);
  }

  enter(_t: number): void {}
  exit(_t: number): void {}
  abstract step(i: number, t: number, m: Mood): void;
  /** A melody note played by traffic (allow events). */
  abstract lead(t: number, f: number, g: number, pan: number): void;
}

/** The "style" while a background track plays: no notes of its own, just the track's tempo and key. */
class TrackStyle extends Style {
  readonly id = 'track';
  readonly bpm: number;
  readonly root: number;
  readonly scale: number[];
  readonly chords: number[][];
  readonly barsPerChord = 1;
  readonly leadOct = 4;

  constructor(s: Synth, parent: Bus, clock: TrackClock) {
    super(s, parent);
    this.bpm = clock.bpm;
    this.root = 16.3516 * Math.pow(2, clock.root / 12);   // the key's tonic at octave 0
    this.scale = clock.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    this.chords = [clock.minor ? [0, 3, 7] : [0, 4, 7]];
  }

  step(): void {}
  lead(): void {}
}

export interface StyleDef {
  id: string;
  name: string;
  make: (s: Synth, bus: Bus) => Style;
}

export interface ConductorConfig {
  styles: StyleDef[];
  /** Setting holding the pinned style id ('rotate' or unknown = rotate). */
  styleKey: string;
  /** Setting holding minutes per style while rotating. */
  rotateKey: string;
  /** Music bus level at the default Music bed (0.65). */
  musicGain?: number;
}

export abstract class Conductor implements Score {
  protected s: Synth;
  protected music: Bus;
  protected sfxBus: Bus;
  protected amb: Bus;
  protected styles = new Map<string, Style>();
  protected cur: Style;
  protected mood: Mood = { night: 0, tension: 0, threat: false };
  protected musicLevel = -1;
  private order: string[];
  private rotatedAt: number;
  private stepIdx = 0;
  private nextStep = 0;
  protected epoch = 0;                       // audio time of step 0 of the current style
  private lastSlot = new Map<string, number>();
  private leadDeg = 4;
  private heartAt = -99;
  private meter: AnalyserNode;
  private meterBuf = new Float32Array(512);
  private energy = 0;
  private pulseAt = 0;
  private bedLevels = new WeakMap<Bed, number>();

  constructor(protected e: AudioEngine, private cfg: ConductorConfig) {
    const ctx = e.ctx;
    this.s = new Synth(e);
    this.music = new Bus(ctx, e.out, e.reverb, e.echo, 0);
    // a level meter on the music (not the effects) for visuals that move with it
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.music.dry.connect(this.meter);
    // sound effects go through their own limiter so punchy hits never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 4; comp.ratio.value = 10;
    comp.attack.value = 0.001; comp.release.value = 0.14;
    comp.connect(e.out);
    this.sfxBus = new Bus(ctx, comp, e.reverb, e.echo, 1);
    this.amb = new Bus(ctx, e.out, e.reverb, e.echo, 1);

    for (const d of cfg.styles) this.styles.set(d.id, d.make(this.s, this.music));
    this.order = cfg.styles.map((d) => d.id);
    this.rotatedAt = ctx.currentTime;
    const first = this.wanted() ?? pick(this.order);
    this.cur = this.styles.get(first)!;
    this.begin(this.cur, ctx.currentTime);
  }

  protected get core(): CoreAudio { return this.e.settings as unknown as CoreAudio; }
  protected setting<T>(key: string): T { return (this.e.settings as unknown as Record<string, T>)[key]; }

  /** The pinned style, or null when rotating. A score can override this (e.g. to follow the scene). */
  protected wanted(): string | null {
    const v = this.setting<string>(this.cfg.styleKey);
    return this.styles.has(v) ? v : null;
  }

  private begin(style: Style, t: number): void {
    style.fadingUntil = 0;
    style.bus.set(style.level, t, 1.2);
    style.enter(t);
    this.cur = style;
    this.stepIdx = 0;
    this.nextStep = t + 0.1;
    this.epoch = this.nextStep;
    this.e.setEchoTime(style.stepDur * 3);            // dotted eighth
  }

  private switchTo(id: string, t: number): void {
    if (id === this.cur.id) return;
    const old = this.cur;
    old.bus.set(0, t, 1.5);
    old.fadingUntil = t + 7;
    this.handover(t);
    this.begin(this.styles.get(id)!, t + 0.6);
  }

  // ── hooks for the theme ──
  /** Something that covers a style change (default: a low swell). */
  protected handover(t: number): void { this.s.boom(this.sfxBus, t, 0.04); }
  /** Beds and other continuous sound; `on` is false while the score is silent. */
  protected ambience(_dt: number, _state: State, _now: number, _on: boolean): void {}
  /** Called on every step while `mood.threat` (after the style's own step). */
  protected threatStep(_i: number, _t: number, _g: number): void {}
  /** True to hand the whole soundtrack back to the engine's built-in band. */
  passthrough(): boolean { return false; }

  abstract cue(kind: Cue, srcIp?: string): void;
  abstract sfx(name: string, opts?: SfxOpts): void;
  abstract noiseVoice(kind: Cue, when: number): void;

  // ── time ──
  /** The next grid time `q16` sixteenths wide, at least `lead` seconds from now. */
  protected quant(q16: number, lead = 0.03): number {
    const now = this.s.ctx.currentTime, grid = this.cur.stepDur * q16;
    const k = Math.ceil((now + lead - this.epoch) / grid);
    return this.epoch + Math.max(0, k) * grid;
  }

  /** Book a grid slot for a sound; repeats roll onto the next slots. -1 = too far behind, drop it. */
  protected slot(name: string, q16: number, maxWait: number): number {
    const now = this.s.ctx.currentTime, grid = this.cur.stepDur * q16;
    let t = this.quant(q16);
    const last = this.lastSlot.get(name) ?? -1;
    if (last >= t - 1e-4) t = last + grid;
    if (t - now > maxWait) return -1;
    this.lastSlot.set(name, t);
    return t;
  }

  /** The chord sounding at audio time `t`, as frequencies at octave `oct`. */
  protected chordAt(t: number, oct: number): number[] {
    const step = Math.max(0, Math.floor((t - this.epoch) / this.cur.stepDur));
    return this.cur.tones(step, oct);
  }

  protected panFor(srcIp?: string): number {
    return srcIp ? ((hash(srcIp) % 200) - 100) / 100 * 0.8 : (Math.random() - 0.5) * 1.2;
  }

  /** Traffic plays the tune: one lead note per eighth at most, walking the scale. */
  protected playLead(srcIp: string | undefined, gain = 0.07): void {
    const st = this.core;
    if (!st.melody || Math.random() >= st.gateAllow * 0.6) return;
    const t = this.slot('lead', 2, 0.6);
    if (t < 0) return;
    const chord = this.chordAt(t, this.cur.leadOct);
    let f: number;
    if (Math.random() < 0.55) {
      f = chord[srcIp ? hash(srcIp) % 3 : (Math.random() * 3) | 0];
    } else {
      this.leadDeg += pick([-2, -1, -1, 1, 1, 2]);
      if (this.leadDeg < 0 || this.leadDeg > 9) this.leadDeg = 3 + ((Math.random() * 4) | 0);
      f = this.cur.scaleTone(this.leadDeg, this.cur.leadOct);
    }
    this.cur.lead(t, f, gain * st.gAllow * Math.min(1.5, this.musicLevel), this.panFor(srcIp));
  }

  protected setBed(bed: Bed, level: number, t: number): void {
    const cur = this.bedLevels.get(bed) ?? -1;
    if (Math.abs(cur - level) < 0.002) return;
    this.bedLevels.set(bed, level);
    bed.level.gain.setTargetAtTime(level, t, 1.5);
  }

  protected bumpTension(by: number): void { this.mood.tension = Math.min(1, this.mood.tension + by); }
  /** Mark a heartbeat (or any attack pulse) at `t` for `pulse().heart`. */
  protected markHeart(t: number): void { this.heartAt = t; }

  // ── Score ──
  update(dt: number, state: State): void {
    const ctx = this.s.ctx, now = ctx.currentTime, st = this.core;
    const silent = this.passthrough() && !this.track;

    const nightTarget = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.mood.night += (nightTarget - this.mood.night) * Math.min(1, dt * 0.15);
    this.mood.tension = Math.max(0, this.mood.tension - dt * 0.025);

    const musicLevel = st.melody && !silent ? (this.cfg.musicGain ?? 1.9) * st.melodyBal / 0.65 : 0;
    if (Math.abs(musicLevel - this.musicLevel) > 0.005) {
      this.music.set(musicLevel, now, 0.5);
      this.musicLevel = musicLevel;
    }
    this.ambience(dt, state, now, !silent);
    if (silent) return;

    // a background track owns the tempo: follow its media clock, no rotation
    if (this.track) {
      this.followTrack(now);
    } else {
    // rotation
    const pinned = this.wanted();
    if (pinned) {
      if (pinned !== this.cur.id) { this.switchTo(pinned, now); this.rotatedAt = now; }
    } else if (now - this.rotatedAt > Math.max(1, this.setting<number>(this.cfg.rotateKey)) * 60) {
      this.rotatedAt = now;
      this.switchTo(this.order[(this.order.indexOf(this.cur.id) + 1) % this.order.length], now);
    }
    }
    for (const style of this.styles.values()) {
      if (style.fadingUntil && now > style.fadingUntil) { style.fadingUntil = 0; style.exit(now); }
    }

    // the clock: schedule a little ahead so notes land exactly on the grid
    if (this.nextStep < now - 0.25) {                  // tab slept: pick the beat back up
      const skip = Math.ceil((now - this.nextStep) / this.cur.stepDur);
      this.stepIdx += skip;
      this.nextStep += skip * this.cur.stepDur;
    }
    let guard = 0;
    while (this.nextStep < now + 0.12 && guard++ < 8) {
      const t = this.nextStep, i = this.stepIdx;
      if (this.musicLevel > 0) this.cur.step(i, t, this.mood);
      if (this.mood.threat && st.deviceVoices) {
        const g = st.gThreat * st.gateThreat;
        if (g > 0) this.threatStep(i, t, g);
      }
      this.stepIdx++;
      this.nextStep = this.epoch + this.stepIdx * this.cur.stepDur;
    }
  }

  setThreatActive(on: boolean): void { this.mood.threat = on; }

  // ── background track ──
  protected track: TrackClock | null = null;
  /**
   * False while a background track is the music: event sounds that are really
   * notes (pings, chirps, arpeggios, drum pulses) sit out, so nothing composes
   * under the track. Sound effects (shots, blasts, crashes, horns, engine) stay.
   */
  protected get notes(): boolean { return !this.track; }
  private trackStyle: TrackStyle | null = null;

  setTrack(clock: TrackClock | null): void {
    const now = this.s.ctx.currentTime;
    if (this.track) { try { this.track.node.disconnect(this.meter); } catch { /* not connected */ } }
    this.track = clock;
    if (clock) {
      // a silent style carrying the track's tempo and key, so effects snap and tune to it
      const style = new TrackStyle(this.s, this.music, clock);
      clock.node.connect(this.meter);                 // visuals follow the track's loudness
      if (this.cur !== this.trackStyle) { this.cur.bus.set(0, now, 1); this.cur.fadingUntil = now + 5; }
      this.trackStyle = style;
      this.cur = style;
      this.followTrack(now, true);
    } else if (this.trackStyle) {
      this.trackStyle = null;
      const back = this.wanted() ?? this.order[0];
      this.begin(this.styles.get(back)!, now + 0.1);
    }
  }

  /** Keep our grid glued to the track: re-sync whenever the media clock and ours drift (seeks, loops, stalls). */
  private followTrack(now: number, force = false): void {
    const tr = this.track!, style = this.cur, beat = 60 / tr.bpm;
    const epoch = now - tr.beatAt() * beat;             // audio time of the track's beat 0
    if (force || Math.abs(epoch - this.epoch) > 0.03) {
      this.epoch = epoch;
      this.stepIdx = Math.ceil((now + 0.02 - epoch) / style.stepDur);
      this.nextStep = epoch + this.stepIdx * style.stepDur;
    }
  }

  pulse(): MusicPulse {
    const ctx = this.s.ctx;
    // what the speakers are playing now, not what's scheduled
    const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    const cur = this.cur;
    const wall = performance.now() / 1000;
    const dt = Math.min(0.1, wall - this.pulseAt);
    this.pulseAt = wall;
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    for (let k = 0; k < this.meterBuf.length; k++) sum += this.meterBuf[k] * this.meterBuf[k];
    const level = Math.min(1, Math.sqrt(sum / this.meterBuf.length) / 0.08);
    // loudness eases (about a second either way), so nothing pumps with each note
    this.energy += (level - this.energy) * Math.min(1, dt * 1.2);
    const sinceHeart = heard - this.heartAt;
    return {
      beat: (heard - this.epoch) / (cur.stepDur * 4),
      beatsPerBar: cur.barSteps / 4,
      bpm: cur.bpm,
      energy: this.energy,
      heart: sinceHeart >= 0 && this.mood.threat ? Math.exp(-sinceHeart / 0.25) : 0,
      style: this.track ? 'Background track' : this.cfg.styles.find((d) => d.id === cur.id)?.name ?? cur.id,
    };
  }
}
