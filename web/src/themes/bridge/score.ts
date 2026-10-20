import type { AudioEngine, Cue, Score, ScoreFactory, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, semis, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Bus, Synth } from '../../sound/synth';

/**
 * Bridge's soundtrack: the sounds of a ready room at 0300.
 *
 *   idle  : a low hypo hum with slow, sparse computer chirps
 *   ops   : a quiet sequencer pulse, the deck is busy
 *   alert : red alert — an urgent two-note bass pulse and tense stabs
 *
 * By default the console picks from traffic (idle → ops → alert, and alert
 * whenever a threat is on screen); settings can pin one or rotate. The
 * effects are the interface itself: LCARS two-tone beeps, confirmations,
 * docking clicks and the red-alert klaxon, all in the current key.
 */

/** The classic LCARS interface chirp: two quick descending tones. */
function chirp(s: Synth, bus: Bus, t: number, f: number, g: number, pan = 0): void {
  s.tone(bus, t, f, { type: 'sine', g, a: 0.002, h: 0.045, r: 0.03, pan });
  s.tone(bus, t + 0.07, f * 0.72, { type: 'sine', g: g * 0.9, a: 0.002, h: 0.05, r: 0.05, pan });
}

class Idle extends Style {
  readonly id = 'idle'; readonly bpm = 60; readonly root = 220 / 4;   // A minor, slow
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [8, 12, 15], [5, 9, 12], [3, 7, 10]];
  readonly barsPerChord = 2; readonly leadOct = 4;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const g = 0.5 + m.night * 0.5;
    if (i % 32 === 0) this.s.pad(this.bus, t, this.tones(i, 2), 0.05 * g, 3.4, 420);
    if (i % 16 === 8 && Math.random() < 0.5) chirp(this.s, this.bus, t, semis(this.root, 12, 5), 0.012 * g, 0.4);
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.tone(this.bus, t, f, { type: 'sine', g: g * 1.3, a: 0.002, h: 0.05, r: 0.25, pan });
  }
}

class Ops extends Style {
  readonly id = 'ops'; readonly bpm = 100; readonly root = 220 / 4;   // A minor
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [5, 8, 12], [8, 12, 15], [7, 10, 14]];
  readonly barsPerChord = 1; readonly leadOct = 4;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const g = 0.5 + m.night * 0.5;
    if (i % 16 === 0) this.s.tone(this.bus, t, semis(this.root, 0, 1), { type: 'triangle', g: 0.07 * g, a: 0.004, h: 0.12, r: 0.12, lp: 500 });
    // quiet 16th pulse, accented
    if (i % 2 === 0) {
      const c = this.tones(i, 3);
      const f = c[(i / 2) % 3];
      this.s.tone(this.bus, t, f, { type: 'triangle', g: (i % 8 === 0 ? 0.03 : 0.016) * g, a: 0.002, h: 0.03, r: 0.06, lp: 2600, pan: (i % 4 ? 0.25 : -0.25) });
    }
    if (i % 16 === 12) this.s.noiseHit(this.bus, t, { type: 'bandpass', f: 5200, q: 1.2, g: 0.014 * g, a: 0.001, r: 0.05 });
    if (i % 32 === 30) chirp(this.s, this.bus, t, semis(this.root, 15, 5), 0.012 * g, -0.3);
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.tone(this.bus, t, f, { type: 'triangle', g: g * 1.5, a: 0.002, h: 0.04, r: 0.16, lp: 4000, pan });
  }
}

class Alert extends Style {
  readonly id = 'alert'; readonly bpm = 132; readonly root = 233.08 / 4;  // Bb minor, urgent
  readonly scale = [0, 1, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [1, 4, 8], [0, 3, 7], [8, 11, 15]];
  readonly barsPerChord = 1; readonly leadOct = 4;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const g = 0.55 + m.night * 0.45;
    // urgent two-note bass pulse
    if (i % 4 === 0) this.s.tone(this.bus, t, semis(this.root, i % 8 === 0 ? 0 : 1, 1), { type: 'sawtooth', g: 0.06 * g, a: 0.004, h: 0.08, r: 0.08, lp: 380 });
    if (i % 8 === 4) this.s.noiseHit(this.bus, t, { type: 'bandpass', f: 3400, q: 0.9, g: 0.02 * g, a: 0.001, r: 0.07 });
    if (i % 16 === 0) this.s.pad(this.bus, t, this.tones(i, 2), 0.04 * g, 1.4, 900);
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.tone(this.bus, t, f, { type: 'square', g: g * 0.9, a: 0.002, h: 0.03, r: 0.1, lp: 3200, pan });
  }
}

const STYLES: StyleDef[] = [
  { id: 'idle', name: 'Hypo watch', make: (s, b) => new Idle(s, b) },
  { id: 'ops', name: 'Ops pulse', make: (s, b) => new Ops(s, b) },
  { id: 'alert', name: 'Red alert', make: (s, b) => new Alert(s, b) },
];

export const BRIDGE_MUSIC: Array<[string, string]> = [
  ['auto', 'Follow the deck'], ['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name]),
];

class BridgeConductor extends Conductor {
  /** Deck activity 0..1, read off the event rate. */
  activity = 0;
  private hum: Bed & { glide(freqs: number[], t: number): void };

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'bMusicStyle', rotateKey: 'bMusicRotate', musicGain: 0.6 });
    this.hum = this.s.drone(this.amb, [55, 82.41, 110]);
  }

  update(dt: number, state: State): void {
    const target = Math.min(1, state.rate30s / 600);
    this.activity += (target - this.activity) * Math.min(1, dt * 0.4);
    super.update(dt, state);
  }

  /** 'auto': the deck picks its own mood; a live threat always wins. */
  protected wanted(): string | null {
    const v = this.setting<string>('bMusicStyle');
    if (v !== 'auto') return super.wanted();
    if (this.mood.threat) return 'alert';
    return this.activity < 0.22 ? 'idle' : this.activity < 0.6 ? 'ops' : 'alert';
  }

  protected handover(t: number): void {
    chirp(this.s, this.sfxBus, t, semis(this.cur.root, 12, 5), 0.02);
  }

  protected ambience(_dt: number, _state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('bAmb') : 0;
    this.setBed(this.hum, amb * (0.05 + this.activity * 0.09), now);
  }

  cue(kind: Cue, srcIp?: string): void {
    if (kind === 'allow') { this.playLead(srcIp, 0.05); return; }
    if (!this.core.deviceVoices || !this.notes) return;
    const t = this.s.ctx.currentTime + 0.005;
    const key = (sm: number, oct: number) => semis(this.cur.root, sm, oct);
    if (kind === 'dns') this.s.tone(this.sfxBus, t, key(15, 5), { type: 'sine', g: 0.016, a: 0.002, h: 0.03, r: 0.12, glide: 0.8 });
    else if (kind === 'dhcp') chirp(this.s, this.sfxBus, t, key(10, 4), 0.012);
    else if (kind === 'wifi') this.s.noiseHit(this.sfxBus, t, { type: 'bandpass', f: 3200, q: 1.4, g: 0.01, a: 0.001, r: 0.05 });
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    if (!this.core.deviceVoices) return;
    const s = this.s, bus = this.sfxBus, t = s.ctx.currentTime + 0.005, pan = opts.pan ?? 0;
    const key = (sm: number, oct: number) => semis(this.cur.root, sm, oct);
    const v = (this.setting<number>('bSfx') ?? 0.8) * 1.6;
    const st = this.core;
    switch (name) {
      case 'beep': // the classic two-tone interface chirp
        chirp(s, bus, t, 1150, 0.03 * v * st.gAllow, pan);
        break;
      case 'confirm': // crew manifest entry (dhcp)
        s.tone(bus, t, key(7, 4), { type: 'sine', g: 0.024 * v * st.gDhcp, a: 0.002, h: 0.04, r: 0.03, pan });
        s.tone(bus, t + 0.06, key(12, 4), { type: 'sine', g: 0.024 * v * st.gDhcp, a: 0.002, h: 0.05, r: 0.06, pan });
        break;
      case 'force': // force field snaps on a block
        s.tone(bus, t, 130, { type: 'square', g: 0.05 * v * st.gBlock, a: 0.002, h: 0.04, r: 0.16, lp: 600, glide: 0.55, pan });
        s.noiseHit(bus, t, { type: 'bandpass', f: 900, q: 0.8, g: 0.03 * v * st.gBlock, a: 0.001, r: 0.1, rate: 0.5, pan });
        break;
      case 'port': // docking uplink port lights (wifi)
        s.noiseHit(bus, t, { type: 'highpass', f: 4200, g: 0.016 * v * st.gWifi, a: 0.001, r: 0.04, pan });
        s.tone(bus, t + 0.03, 2050, { type: 'sine', g: 0.018 * v * st.gWifi, a: 0.002, h: 0.03, r: 0.06, pan });
        break;
      case 'klaxon': { // red alert
        const g = 0.05 * v * st.gThreat;
        for (let k = 0; k < 2; k++) {
          const t0 = t + k * 0.66;
          s.tone(bus, t0, 466, { type: 'sawtooth', g, a: 0.01, h: 0.24, r: 0.06, lp: 2400 });
          s.tone(bus, t0 + 0.3, 622, { type: 'sawtooth', g, a: 0.01, h: 0.24, r: 0.06, lp: 2400 });
        }
        break;
      }
      case 'powerdown': // main power dips (system)
        s.tone(bus, t, 300, { type: 'sawtooth', g: 0.05 * v, a: 0.004, h: 0.05, r: 0.4, lp: 700, glide: 0.22 });
        s.noiseHit(bus, t + 0.04, { type: 'lowpass', f: 1800, fTo: 200, g: 0.04 * v, a: 0.002, r: 0.35, rate: 0.4 });
        break;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    if (this.s.busy(10) || !this.notes) return;
    if (kind === 'allow') this.s.tone(this.sfxBus, when, semis(this.cur.root, 12, 5), { type: 'sine', g: 0.006, a: 0.002, h: 0.02, r: 0.08, pan: (Math.random() - 0.5) * 1.4 });
    else this.s.noiseHit(this.sfxBus, when, { type: 'bandpass', f: 2600, q: 1.5, g: kind === 'block' || kind === 'threat' ? 0.01 : 0.006, a: 0.001, r: 0.03, pan: (Math.random() - 0.5) * 1.4 });
  }
}

export const bridgeScore: ScoreFactory = (e: AudioEngine) => new BridgeConductor(e);
