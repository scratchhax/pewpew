import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, semis, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Bus, Synth } from '../../sound/synth';

/**
 * Clockwork's soundtrack: a steam-powered music box.
 *
 *   tick  : a slow waltz on plucked steel teeth, bass drum on the downbeat
 *   build : an insistent minor ostinato, hammers on the two-beat
 *   steam : a full calliope rush, arpeggios whistling over the top
 *
 * By default the machine picks the tune from its own boiler pressure (tick →
 * build → steam); settings can pin one or rotate. The sound effects are the
 * machine itself — bearings, gates, stamps, clamps, whistles and the great
 * clutch — and they play in the tune's key.
 */

/** A plucked music-box tooth: fast attack, quick shimmering decay. */
function pluck(s: Synth, bus: Bus, t: number, f: number, g: number, pan = 0): void {
  s.tone(bus, t, f, { type: 'sine', g, a: 0.001, h: 0.02, r: 0.34, pan });
  s.tone(bus, t, f * 3.01, { type: 'sine', g: g * 0.16, a: 0.001, h: 0.01, r: 0.14, pan });
}

function thump(s: Synth, bus: Bus, t: number, g: number): void {
  s.tone(bus, t, 150, { type: 'triangle', g, a: 0.001, r: 0.11, glide: 0.25 });
}

class Tick extends Style {
  readonly id = 'tick'; readonly bpm = 84; readonly root = 261.63 / 4;   // C
  readonly scale = [0, 2, 4, 5, 7, 9, 11];
  readonly chords = [[0, 4, 7], [7, 11, 14], [5, 9, 12], [7, 11, 14]];
  readonly barsPerChord = 1; readonly leadOct = 4; readonly barSteps = 12;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const g = 0.5 + m.night * 0.5;
    if (i % 12 === 0) thump(this.s, this.bus, t, 0.1 * g);
    if (i % 3 === 0) {
      const c = this.tones(i, 3);
      pluck(this.s, this.bus, t, c[(i / 3) % 3], 0.035 * g);
    }
    if (i % 12 === 6 && Math.random() < 0.5) pluck(this.s, this.bus, t, this.scaleTone(7 + ((i / 12) % 3) * 2, 5), 0.028 * g, 0.3);
  }
  lead(t: number, f: number, g: number, pan: number): void { pluck(this.s, this.bus, t, f, g * 1.4, pan); }
}

class Build extends Style {
  readonly id = 'build'; readonly bpm = 104; readonly root = 220 / 4;    // A minor
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 10, 14]];
  readonly barsPerChord = 1; readonly leadOct = 4;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const g = 0.5 + m.night * 0.5;
    if (i % 16 === 0) thump(this.s, this.bus, t, 0.11 * g);
    if (i % 4 === 0) {
      const c = this.tones(i, 2);
      this.s.tone(this.bus, t, c[0], { type: 'triangle', g: 0.05 * g, a: 0.002, h: 0.06, r: 0.08 });
      this.s.tone(this.bus, t + 0.14, c[0] * 1.0, { type: 'triangle', g: 0.04 * g, a: 0.002, h: 0.05, r: 0.06 });
    }
    if (i % 8 === 4) this.s.noiseHit(this.bus, t, { type: 'bandpass', f: 1600, q: 0.8, g: 0.03 * g, a: 0.001, r: 0.07 });
    if (i % 16 === 14) {
      const c = this.tones(i, 4);
      this.s.tone(this.bus, t, c[1], { type: 'square', g: 0.018 * g, a: 0.002, h: 0.08, r: 0.1, lp: 2400 });
    }
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.tone(this.bus, t, f, { type: 'triangle', g: g * 1.5, a: 0.002, h: 0.05, r: 0.2, pan });
  }
}

class Steam extends Style {
  readonly id = 'steam'; readonly bpm = 128; readonly root = 293.66 / 4;  // D mixolydian
  readonly scale = [0, 2, 4, 5, 7, 9, 10];
  readonly chords = [[0, 4, 7], [10, 14, 17], [5, 9, 12], [7, 11, 14]];
  readonly barsPerChord = 1; readonly leadOct = 4;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const g = 0.55 + m.night * 0.45;
    if (i % 16 === 0) thump(this.s, this.bus, t, 0.12 * g);
    if (i % 8 === 4) this.s.noiseHit(this.bus, t, { type: 'bandpass', f: 1900, q: 0.7, g: 0.035 * g, a: 0.001, r: 0.08 });
    // rolling calliope arpeggio
    if (i % 2 === 0) {
      const c = this.tones(i, 4);
      const f = c[(i / 2) % 3] * (i % 8 === 6 ? 2 : 1);
      this.s.tone(this.bus, t, f, { type: 'sawtooth', g: 0.016 * g, a: 0.002, h: 0.05, r: 0.09, lp: 3000, q: 1.5, pan: ((i / 2) % 2 ? 0.35 : -0.35) });
    }
    if (i % 16 === 0) {
      const c = this.tones(i, 2);
      this.s.tone(this.bus, t, c[0], { type: 'square', g: 0.03 * g, a: 0.002, h: 0.2, r: 0.15, lp: 900 });
    }
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.tone(this.bus, t, f, { type: 'sawtooth', g: g * 0.9, a: 0.002, h: 0.04, r: 0.14, lp: 4000, pan });
  }
}

const STYLES: StyleDef[] = [
  { id: 'tick', name: 'Music-box waltz', make: (s, b) => new Tick(s, b) },
  { id: 'build', name: 'Hammer ostinato', make: (s, b) => new Build(s, b) },
  { id: 'steam', name: 'Full-steam calliope', make: (s, b) => new Steam(s, b) },
];

export const CLOCKWORK_MUSIC: Array<[string, string]> = [
  ['auto', 'Follow the machine'], ['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name]),
];

class ClockworkConductor extends Conductor {
  /** Boiler pressure 0..1, read off the event rate. */
  pressure = 0;
  private hiss: Bed;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'kMusicStyle', rotateKey: 'kMusicRotate', musicGain: 0.55 });
    this.hiss = this.s.rain(this.amb);
  }

  update(dt: number, state: State): void {
    const target = Math.min(1, state.rate30s / 900);
    this.pressure += (target - this.pressure) * Math.min(1, dt * 0.4);
    super.update(dt, state);
  }

  /** 'auto': the tune follows the boiler pressure. */
  protected wanted(): string | null {
    const v = this.setting<string>('kMusicStyle');
    if (v !== 'auto') return super.wanted();
    return this.pressure < 0.3 ? 'tick' : this.pressure < 0.68 ? 'build' : 'steam';
  }

  protected handover(t: number): void {
    // a little wind-up chime between tunes
    [0, 7, 12, 16].forEach((sm, k) => pluck(this.s, this.sfxBus, t + k * 0.07, semis(this.cur.root, sm, 4), 0.03));
  }

  protected ambience(_dt: number, _state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('kAmb') : 0;
    // the furnace breathes harder under pressure
    this.setBed(this.hiss, amb * (0.05 + this.pressure * 0.1), now);
  }

  cue(kind: Cue, srcIp?: string): void {
    if (kind === 'allow') { this.playLead(srcIp, 0.05); return; }
    if (!this.core.deviceVoices || !this.notes) return;
    const t = this.s.ctx.currentTime + 0.005;
    const key = (sm: number, oct: number) => semis(this.cur.root, sm, oct);
    if (kind === 'dns') this.s.tone(this.sfxBus, t, key(12, 4), { type: 'sine', g: 0.02, a: 0.002, h: 0.05, r: 0.2, glide: 1.6 });
    else if (kind === 'dhcp') this.s.tone(this.sfxBus, t, key(0, 2), { type: 'square', g: 0.02, a: 0.001, h: 0.02, r: 0.05, lp: 1200 });
    else if (kind === 'wifi') this.s.noiseHit(this.sfxBus, t, { type: 'bandpass', f: 2600, q: 1.2, g: 0.016, a: 0.001, r: 0.12, rate: 0.5 });
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    if (!this.core.deviceVoices) return;
    const s = this.s, bus = this.sfxBus, t = s.ctx.currentTime + 0.005, pan = opts.pan ?? 0;
    const key = (sm: number, oct: number) => semis(this.cur.root, sm, oct);
    const v = (this.setting<number>('kSfx') ?? 0.8) * 1.6;
    const st = this.core;
    switch (name) {
      case 'release': // bearing drops from the chute
        s.tone(bus, t, key(0, 3), { type: 'sine', g: 0.03 * v, a: 0.001, h: 0.03, r: 0.1, glide: 0.5, pan });
        break;
      case 'clack': // bearing lands in the counter tray
        s.noiseHit(bus, t, { type: 'bandpass', f: 2400, q: 1.6, g: 0.05 * v * st.gAllow, a: 0.001, r: 0.05, pan });
        s.tone(bus, t, key(7, 5), { type: 'triangle', g: 0.03 * v, a: 0.001, h: 0.02, r: 0.08, pan });
        break;
      case 'gate': // safety gate slams
        s.tone(bus, t, 110, { type: 'square', g: 0.07 * v * st.gBlock, a: 0.001, h: 0.03, r: 0.14, lp: 700, glide: 0.5, pan });
        s.noiseHit(bus, t, { type: 'lowpass', f: 900, g: 0.05 * v * st.gBlock, a: 0.001, r: 0.09, rate: 0.4, pan });
        break;
      case 'mail': // envelope rockets up the tube
        s.noiseHit(bus, t, { type: 'bandpass', f: 700, fTo: 3200, q: 1.4, g: 0.035 * v * st.gDns, a: 0.002, r: 0.3, pan });
        break;
      case 'bell': // directory bell
        s.tone(bus, t, key(12, 5), { type: 'sine', g: 0.035 * v * st.gDns, a: 0.001, h: 0.02, r: 0.5 });
        s.tone(bus, t, key(12, 5) * 2.01, { type: 'sine', g: 0.014 * v, a: 0.001, h: 0.01, r: 0.35 });
        break;
      case 'stamp': // nameplate press
        s.noiseHit(bus, t, { type: 'lowpass', f: 600, g: 0.06 * v * st.gDhcp, a: 0.001, r: 0.07, rate: 0.3, pan });
        s.tone(bus, t + 0.02, key(0, 2), { type: 'triangle', g: 0.04 * v, a: 0.001, h: 0.02, r: 0.1, pan });
        break;
      case 'clamp': // coupling arm locks on
        s.tone(bus, t, key(5, 3), { type: 'square', g: 0.03 * v * st.gWifi, a: 0.001, h: 0.02, r: 0.06, lp: 1800, glide: 1.4, pan });
        s.noiseHit(bus, t + 0.05, { type: 'highpass', f: 4000, g: 0.02 * v, a: 0.002, r: 0.16, pan });
        break;
      case 'whistle': // the alarm whistle
        s.tone(bus, t, key(0, 4) * 2, { type: 'sawtooth', g: 0.045 * v * st.gThreat, a: 0.01, h: 0.35, r: 0.2, lp: 3500, pan });
        s.tone(bus, t, key(4, 4) * 2, { type: 'sawtooth', g: 0.03 * v * st.gThreat, a: 0.015, h: 0.35, r: 0.2, lp: 3500, pan });
        break;
      case 'coal': // coal cart dumps its load
        s.noiseHit(bus, t, { type: 'lowpass', f: 1400, fTo: 300, g: 0.08 * v * st.gThreat, a: 0.002, r: 0.3, rate: 0.4, pan });
        break;
      case 'shudder': { // the master clutch drops
        s.tone(bus, t, 90, { type: 'square', g: 0.09 * v, a: 0.002, h: 0.05, r: 0.4, lp: 500, glide: 0.35 });
        s.noiseHit(bus, t + 0.05, { type: 'lowpass', f: 2200, fTo: 200, g: 0.07 * v, a: 0.002, r: 0.5, rate: 0.4 });
        break;
      }
      case 'chain': // a trip cord tugs
        s.tone(bus, t, key(7, 4), { type: 'sine', g: 0.014 * v, a: 0.001, h: 0.02, r: 0.06, glide: 1.3, pan });
        break;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    if (this.s.busy(10) || !this.notes) return;
    const c = this.chordAt(when, 5);
    if (kind === 'allow') pluck(this.s, this.sfxBus, when, c[0], 0.008, (Math.random() - 0.5) * 1.4);
    else this.s.noiseHit(this.sfxBus, when, { type: 'bandpass', f: 2000, q: 1.5, g: kind === 'block' || kind === 'threat' ? 0.012 : 0.007, a: 0.001, r: 0.04, pan: (Math.random() - 0.5) * 1.4 });
  }
}

export function clockworkScore(e: AudioEngine): Score { return new ClockworkConductor(e); }
