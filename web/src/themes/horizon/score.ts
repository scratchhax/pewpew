import type { AudioEngine, Cue, ScoreFactory, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, semis, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Bus, Synth } from '../../sound/synth';

/**
 * Event Horizon's soundtrack: slow, wide and cold, the sound of being very
 * far from anything.
 *
 *   deep field : a pipe-organ chord breathing every four bars over a sub
 *                drone, glass tones drifting in the gaps
 *   long orbit : a soft eighth-note pulse under the organ, the sense of
 *                something turning; traffic plays the pulse a melody
 *   tidal      : what a star sounds like coming apart — low cellos, a slow
 *                heartbeat and a wordless choir a semitone off
 *
 * On auto the observatory picks from the traffic (quiet → deep field, busy →
 * long orbit, a star being shredded → tidal). Effects stay in key: blocked
 * hosts fall with a pitch that sinks and darkens like their light does,
 * lookups ring like glass, new moons are a struck bell.
 */

class DeepField extends Style {
  readonly id = 'deep'; readonly bpm = 54; readonly root = 146.83 / 4;   // D, aeolian
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 7, 12, 15], [-4, 3, 8, 12], [-2, 5, 10, 14], [-5, 2, 7, 10]];
  readonly barsPerChord = 4; readonly leadOct = 4;
  readonly level = 1.05;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const span = this.barSteps * this.barsPerChord;
    const g = 0.75 + m.night * 0.35;
    if (i % span === 0) {
      const c = this.tones(i, 2);
      const hold = this.stepDur * span * 0.8;
      for (let k = 0; k < c.length; k++) this.s.organ(this.bus, t + k * 0.04, c[k], 0.013 * g, hold, (k - 1.5) * 0.35);
      this.s.tone(this.bus, t, c[0] / 2, { g: 0.05 * g, a: 3, h: hold * 0.7, r: 4, lp: 220 });
    }
    if (i % 32 === 20 && Math.random() < 0.55) {
      const c = this.tones(i, 4);
      this.s.glass(this.bus, t, pick(c), 0.018 * g, (Math.random() - 0.5) * 1.2);
    }
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.glass(this.bus, t, f, g * 0.55, pan);
  }
}

class LongOrbit extends Style {
  readonly id = 'orbit'; readonly bpm = 76; readonly root = 146.83 / 4;   // D, dorian lift
  readonly scale = [0, 2, 3, 5, 7, 9, 10];
  readonly chords = [[0, 7, 10, 15], [-2, 5, 9, 14], [-4, 3, 8, 12], [-7, 0, 5, 9]];
  readonly barsPerChord = 2; readonly leadOct = 4;
  readonly level = 0.95;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const span = this.barSteps * this.barsPerChord;
    const g = 0.7 + m.night * 0.4;
    if (i % span === 0) {
      const c = this.tones(i, 2);
      const hold = this.stepDur * span * 0.85;
      for (let k = 0; k < c.length; k++) this.s.organ(this.bus, t + k * 0.03, c[k], 0.01 * g, hold, (k - 1.5) * 0.4);
      this.s.tone(this.bus, t, c[0] / 2, { g: 0.045 * g, a: 2, h: hold * 0.6, r: 3, lp: 200 });
    }
    // the turning pulse: soft eighths walking the chord, accent on the bar
    if (i % 2 === 0) {
      const c = this.tones(i, 3);
      const f = c[(i / 2) % c.length];
      const acc = i % 16 === 0 ? 1.5 : i % 4 === 0 ? 1.1 : 0.8;
      this.s.tone(this.bus, t, f, { type: 'triangle', g: 0.011 * acc * g, a: 0.01, h: 0.05, r: 0.5, lp: 1800, pan: (i % 4 ? 0.3 : -0.3), rev: 0.5, echo: 0.35 });
    }
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.bell(this.bus, t, f, g * 0.6, pan, 0.4);
  }
}

class Tidal extends Style {
  readonly id = 'tidal'; readonly bpm = 60; readonly root = 146.83 / 4;   // D phrygian, darker
  readonly scale = [0, 1, 3, 5, 7, 8, 10];
  readonly chords = [[0, 7, 12, 13], [1, 8, 13, 15], [-4, 3, 8, 13], [-2, 5, 10, 13]];
  readonly barsPerChord = 2; readonly leadOct = 4;
  readonly level = 1;
  constructor(s: Synth, parent: Bus) { super(s, parent); }
  step(i: number, t: number, m: Mood): void {
    const span = this.barSteps * this.barsPerChord;
    const g = 0.8 + m.night * 0.3;
    if (i % span === 0) {
      const c = this.tones(i, 1);
      const hold = this.stepDur * span * 0.8;
      this.s.cello(this.bus, t, c[0], 0.05 * g, hold, -0.3);
      this.s.cello(this.bus, t + 0.12, c[1], 0.035 * g, hold, 0.3);
      this.s.choir(this.bus, t + 0.4, this.tones(i, 3).slice(1, 4), 0.012 * g, hold * 0.7);
    }
    if (i % 16 === 0) this.s.heart(this.bus, t, 0.05 * g);
  }
  lead(t: number, f: number, g: number, pan: number): void {
    this.s.glass(this.bus, t, f, g * 0.45, pan);
  }
}

const STYLES: StyleDef[] = [
  { id: 'deep', name: 'Deep field', make: (s, b) => new DeepField(s, b) },
  { id: 'orbit', name: 'Long orbit', make: (s, b) => new LongOrbit(s, b) },
  { id: 'tidal', name: 'Tidal', make: (s, b) => new Tidal(s, b) },
];

export const HORIZON_MUSIC: Array<[string, string]> = [
  ['auto', 'Follow the sky'], ['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name]),
];

class HorizonConductor extends Conductor {
  private activity = 0;
  private hum: Bed & { glide(freqs: number[], t: number): void };
  private shredding = false;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'ehMusicStyle', rotateKey: 'ehMusicRotate', musicGain: 1.5 });
    this.hum = this.s.drone(this.amb, [36.71, 55.0, 73.42]);
  }

  update(dt: number, state: State): void {
    const target = Math.min(1, state.rate30s / 700);
    this.activity += (target - this.activity) * Math.min(1, dt * 0.2);
    super.update(dt, state);
  }

  setThreatActive(on: boolean): void {
    this.shredding = on;
    super.setThreatActive(on);
  }

  protected wanted(): string | null {
    const v = this.setting<string>('ehMusicStyle');
    if (v !== 'auto') return super.wanted();
    if (this.shredding) return 'tidal';
    return this.activity < 0.3 ? 'deep' : 'orbit';
  }

  protected handover(t: number): void {
    this.s.swell(this.sfxBus, t, semis(this.cur.root, 12, 2), 0.03, 6);
  }

  protected ambience(_dt: number, _state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('ehAmbience') : 0;
    this.setBed(this.hum, amb * (0.045 + this.activity * 0.03 + (this.shredding ? 0.03 : 0)), now);
  }

  cue(kind: Cue, srcIp?: string): void {
    if (kind === 'allow') { this.playLead(srcIp, 0.05); return; }
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    if (!this.core.deviceVoices) return;
    const s = this.s, bus = this.sfxBus, t = s.ctx.currentTime + 0.01, pan = opts.pan ?? 0;
    const key = (sm: number, oct: number) => semis(this.cur.root, sm, oct);
    const v = (this.setting<number>('ehSfx') ?? 0.7) * 1.5;
    const st = this.core;
    switch (name) {
      case 'infall': { // a tone that sinks and darkens, like the light does
        if (!this.notes) {
          s.noiseHit(bus, t, { type: 'bandpass', f: 1800, fTo: 120, q: 3, g: 0.02 * v * st.gBlock, a: 0.6, r: 3.5, pan, rev: 0.7 });
          break;
        }
        const f = key(pick([7, 12, 15]), 4);
        s.tone(bus, t, f, { type: 'sine', g: 0.022 * v * st.gBlock, a: 0.8, h: 1.5, r: 3.2, glide: 0.25, lp: 3000, lpTo: 180, pan, rev: 0.7, echo: 0.3 });
        s.noiseHit(bus, t + 0.4, { type: 'bandpass', f: 2400, fTo: 160, q: 4, g: 0.012 * v * st.gBlock, a: 1, r: 3, pan, rev: 0.7 });
        break;
      }
      case 'glint': // light round the photon ring (dns)
        if (!this.notes) break;
        s.tone(bus, t, key(pick([12, 19, 24]), 5), { type: 'sine', g: 0.012 * v * st.gDns, a: 0.02, h: 0.05, r: 1.6, pan, rev: 0.8, echo: 0.5 });
        break;
      case 'capture': // a new moon (dhcp)
        if (!this.notes) break;
        s.bell(bus, t, key(pick([0, 7]), 4), 0.02 * v * st.gDhcp, pan, 0.4);
        s.bell(bus, t + 0.18, key(12, 4), 0.014 * v * st.gDhcp, pan, 0.4);
        break;
      case 'ripple': { // a gravitational wave crosses the disk (wifi)
        const bad = opts.variant === 'bad';
        s.swell(bus, t, key(bad ? 1 : 7, 3), (bad ? 0.012 : 0.018) * v * st.gWifi, 3.5, pan);
        break;
      }
      case 'shred': { // the star comes apart
        const g = v * st.gThreat;
        s.boom(bus, t, 0.05 * g);
        s.noiseHit(bus, t + 0.1, { type: 'bandpass', f: 300, fTo: 2400, q: 1.5, g: 0.02 * g, a: 2.4, h: 0.5, r: 3, rev: 0.8 });
        s.swell(bus, t + 0.3, key(1, 2), 0.035 * g, 7);
        break;
      }
      case 'approach': // a star on its way in
        s.swell(bus, t, key(0, 2), 0.03 * v * st.gThreat, 8, pan);
        break;
      case 'dim': // a burst of system logs: the disk dims
        s.noiseHit(bus, t, { type: 'lowpass', f: 2200, fTo: 160, g: 0.02 * v, a: 0.3, r: 2.4, rev: 0.7 });
        break;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    if (this.s.busy(10) || !this.notes) return;
    const pan = (Math.random() - 0.5) * 1.4;
    if (kind === 'allow') this.s.tone(this.sfxBus, when, semis(this.cur.root, pick([12, 19, 24]), 4), { type: 'sine', g: 0.004, a: 0.004, r: 0.4, pan, rev: 0.7 });
    else this.s.noiseHit(this.sfxBus, when, { type: 'bandpass', f: 900, q: 2, g: kind === 'block' || kind === 'threat' ? 0.007 : 0.004, a: 0.01, r: 0.3, pan, rev: 0.6 });
  }
}

export const horizonScore: ScoreFactory = (e: AudioEngine) => new HorizonConductor(e);
