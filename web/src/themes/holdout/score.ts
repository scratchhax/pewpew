import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Synth, Bus } from '../../sound/synth';

/**
 * The Holdout's soundtrack. Three styles driven by scene pressure:
 *
 *   drone  (0–0.28)  : night watch — sub drones, whispers, a warped music box, a heartbeat
 *   siege  (0.28–0.55): war drums — taiko and stomps, string stabs, a far-off organ
 *   horde  (0.55–1.0): the charge — taiko ensemble, cello spiccato, grinding strings, choir
 *
 * Pressure is the compound's threat level: it rises with blocks and threats,
 * decays slowly. The conductor crossfades between styles over ~1.5 s when the
 * threshold is crossed. A pinned style (from settings) overrides pressure.
 */

// ── drone ───────────────────────────────────────────────────────────────────
class Drone extends Style {
  readonly id = 'drone';
  readonly bpm = 60;
  readonly root = 41.2;                                          // E1
  readonly scale = [0, 1, 4, 5, 7, 8, 10];                       // phrygian
  readonly chords = [[0, 1, 5], [0, 1, 5], [-1, 0, 4], [0, 1, 5]];
  readonly barsPerChord = 4;
  readonly leadOct = 3;
  readonly level = 1.1;
  private bellT = 0;
  private whisperT = 4;

  enter(): void { this.bellT = 0; this.whisperT = 4; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 1);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.pad(b, t, [tones[0] / 2, tones[0], tones[0] * 1.01], 0.04, hold, 300 + m.night * 200);
      // a sub-drone an octave under: felt more than heard
      s.pad(b, t, [tones[0] / 2, tones[0] / 2 * 1.007], 0.03, hold, 150);
      // sometimes a cello note joins from far away
      if (Math.random() < 0.5) s.cello(b, t, tones[0], 0.03, hold * 0.6, (Math.random() - 0.5) * 0.8);
    }
    // slow sub pulse on beats
    if (pos % 4 === 0) s.bassPulse(b, t, tones[0] / 2, 0.06 + m.tension * 0.03);
    // whispers drift through at night, panning like someone walking past
    this.whisperT -= this.stepDur;
    if (this.whisperT <= 0 && m.night > 0.3) {
      s.whisper(b, t, 0.02 + m.night * 0.025, (Math.random() * 2 - 1) * 0.9);
      this.whisperT = 6 + Math.random() * 10;
    }
    // a warped music box picks out a camp melody, half the notes missing
    if (bar % 2 === 1 && pos === 8 && Math.random() < 0.35) {
      s.warpedBox(b, t, this.tones(i, 3)[pick([0, 1, 2])], 0.03,
        0.06 + Math.random() * 0.1, (Math.random() - 0.5) * 0.7);
    }
    // cold bell, sparse
    this.bellT -= this.stepDur;
    if (this.bellT <= 0 && bar % 2 === 1 && pos === 8 && Math.random() < 0.4) {
      s.bell(b, t, this.tones(i, 3)[pick([0, 2])], 0.04, 0, 0.5);
      this.bellT = 2 + Math.random() * 2;
    }
    // wind chimes on the wire fence
    if (bar % 4 === 2 && pos === 12 && Math.random() < 0.4) {
      s.glass(b, t, this.tones(i, 4)[pick([1, 2])], 0.018, (Math.random() - 0.5) * 1.2);
    }
    // distant swell at night
    if (m.night > 0.5 && bar % 4 === 0 && pos === 0) {
      s.swell(b, t, tones[0] * 4, 0.02 * m.night, 4, 0.3);
    }
    // the compound's own heartbeat once the dark is full in
    if (m.night > 0.55 && pos % 8 === 0) s.heart(b, t, 0.045 * m.night);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.7, pan, 0.5); }
}

// ── siege ────────────────────────────────────────────────────────────────────
class Siege extends Style {
  readonly id = 'siege';
  readonly bpm = 96;
  readonly root = 55;                                            // A1
  readonly scale = [0, 2, 3, 5, 7, 8, 11];                       // harmonic minor
  readonly chords = [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]];
  readonly barsPerChord = 2;
  readonly leadOct = 3;
  readonly level = 1;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 2);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.pad(b, t, [tones[0] / 2, tones[0], tones[1]], 0.03, hold, 500 + m.tension * 800);
      // a church organ two rooms away, only on the chord change
      s.organ(b, t, tones[0], 0.018, hold * 0.5, -0.3);
    }
    // pulsing ostinato: 8ths, filter opens with tension
    if (pos % 2 === 0 || m.tension > 0.5) {
      const pattern = [0, 1, 2, 1, 0, 2, 3, 2];
      const k = pattern[(pos / 2) % 8 | 0];
      const f = k === 3 ? tones[0] * 2 : tones[k % 3];
      const cutoff = 600 + m.tension * 1400;
      const accent = pos % 4 === 0 ? 1 : 0.7;
      s.arp(b, t, f, (0.03 + m.tension * 0.02) * accent, cutoff, pos % 4 < 2 ? -0.2 : 0.2);
    }
    // war drums: taiko on the ground beats, stomps on the off beats
    if (pos === 0) s.taiko(b, t, 0.13 + m.tension * 0.05, -0.25);
    if (pos === 6 || pos === 8) s.taiko(b, t, 0.07 + m.tension * 0.04, 0.25);
    if (pos === 4 || pos === 12) s.stomp(b, t, 0.07 + m.tension * 0.05);
    if (m.tension > 0.3 && pos === 14) s.taiko(b, t, 0.05, 0);
    // strings stab off the beat once the pressure is on
    if (m.tension > 0.45 && pos % 4 === 2) {
      s.strings(b, t, tones[0] * 2, 0.02 + m.tension * 0.02, pos % 8 === 2 ? -0.35 : 0.35);
    }
    // bass pulse
    if (pos % 4 === 0) s.bassPulse(b, t, tones[0] / 4, 0.08 + m.tension * 0.04);
    // cold bell figure
    if (bar % 2 === 1 && [0, 4, 8, 12].includes(pos) && Math.random() < 0.5) {
      s.bell(b, t, this.tones(i, 3)[pick([0, 1, 2])], 0.035, 0, 0.3);
    }
    // every 8 bars something is about to happen
    if (i % 128 === 96) s.riser(b, t, 16 * this.stepDur, 0.022);
    // intensity layer: 16th hats when it's really pressing
    if (m.tension > 0.75 && pos % 2 === 1) s.hat(b, t, 0.02, 0, false);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.pluck(this.bus, t, f, g * 0.8, pan); }
}

// ── horde ────────────────────────────────────────────────────────────────────
class Horde extends Style {
  readonly id = 'horde';
  readonly bpm = 120;
  readonly root = 55;                                            // A1
  readonly scale = [0, 2, 3, 5, 7, 8, 10];                       // natural minor
  readonly chords = [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [7, 11, 14]];
  readonly barsPerChord = 1;
  readonly leadOct = 3;
  readonly level = 0.9;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 2);
    // driving 8th-note bass
    if (pos % 2 === 0) {
      const f = pos % 8 === 6 ? tones[0] * 1.5 : tones[0] / 2;
      s.bassPulse(b, t, f, 0.1 + m.tension * 0.04);
    }
    // taiko ensemble: the pattern is the charge
    if (pos === 0 || pos === 3 || pos === 8 || pos === 11) {
      s.taiko(b, t, pos === 0 ? 0.14 : 0.07, pos % 8 === 0 ? -0.2 : 0.2);
    }
    // kick on 1 and 3
    if (pos === 0 || pos === 8) s.kick(b, t, 0.14);
    // stomps answer the gated snare on 2 and 4
    if (pos === 4 || pos === 12) {
      s.snare(b, t, 0.08 + m.tension * 0.04, 0);
      s.stomp(b, t, 0.08 + m.tension * 0.04);
    }
    // cellos sawing 8th spiccato under everything
    if (pos % 2 === 0) {
      s.cello(b, t, tones[0], 0.03 + m.tension * 0.015, this.stepDur * 1.4, pos % 4 === 0 ? -0.25 : 0.25);
    }
    // hats on 16ths when tension is high
    if (m.tension > 0.5 && pos % 2 === 1) s.hat(b, t, 0.03, 0, false);
    // sawtooth stabs on chord changes
    if (pos === 0 && bar % 2 === 0) {
      s.sawLead(b, t, tones[0], 0.04, this.stepDur * 4, 0);
    }
    // every 4th bar the strings lurch: root plus its neighbour, grinding
    if (bar % 4 === 0 && pos === 0) {
      s.strings(b, t, tones[0] * 2, 0.045, -0.3);
      s.strings(b, t, tones[0] * 2 * 1.06, 0.035, 0.3);
    }
    // tom fills
    if (bar % 4 === 3 && pos >= 12) s.tom(b, t, 90 + pos * 15, 0.1, (pos - 14) * 0.15);
    // pad for weight, choir under the chord changes
    if (this.isChordStart(i)) {
      s.pad(b, t, [tones[0] / 2, tones[0]], 0.025, 16 * this.stepDur, 400);
      s.choir(b, t, [tones[0] * 2, tones[1] * 2], 0.016, 16 * this.stepDur);
    }
    // intensity layer: doubled bass and open hats at the very top
    if (m.tension > 0.8 && pos % 2 === 1) s.bassPulse(b, t, tones[0] / 2, 0.05);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f, g * 0.6, 0.15, pan); }
}

// ── the conductor ────────────────────────────────────────────────────────────
const STYLES: StyleDef[] = [
  { id: 'drone', name: 'Drone', make: (s, b) => new Drone(s, b) },
  { id: 'siege', name: 'Siege', make: (s, b) => new Siege(s, b) },
  { id: 'horde', name: 'Horde', make: (s, b) => new Horde(s, b) },
];

export const MUSIC_STYLES: Array<[string, string]> = [
  ['pressure', 'Auto (pressure)'],
  ...STYLES.map((d): [string, string] => [d.id, d.name]),
];

class HoldoutConductor extends Conductor {
  private wind: Bed;
  private rain: Bed;
  private pressure = 0;
  private lastStyle = 'drone';

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'hMusicStyle', rotateKey: 'hMusicStyle' });
    this.wind = this.makeWind(this.amb);
    this.rain = this.s.rain(this.amb);
  }

  /** Wind that doesn't sound like waves: low, irregular, no periodic swell. */
  private makeWind(parent: Bus): Bed {
    const s = this.s, ctx = s.ctx, t = ctx.currentTime, end = t + 1e6;
    const src = s.noise(t, end, 0.3);
    // low bandpass at 200 Hz, wide Q — sounds like wind, not surf
    const bp = s.filter('bandpass', 200, 0.5);
    // slow, irregular filter sweep: two LFOs at non-integer ratio
    const sweep1 = s.osc('sine', 0.023, t, end);
    sweep1.connect(s.gain(120)).connect(bp.frequency);
    const sweep2 = s.osc('sine', 0.041, t, end);
    sweep2.connect(s.gain(60)).connect(bp.frequency);
    // gain: two slow LFOs at irrational ratio = never repeats like waves
    const level = s.gain(0);
    const gust = s.gain(1);
    const lfo1 = s.osc('sine', 0.031, t, end);
    lfo1.connect(s.gain(0.2)).connect(gust.gain);
    const lfo2 = s.osc('sine', 0.053, t, end);
    lfo2.connect(s.gain(0.12)).connect(gust.gain);
    // very subtle high-frequency tremolo adds rustle
    const trem = s.gain(1);
    const tremLfo = s.osc('sine', 0.7, t, end);
    tremLfo.connect(s.gain(0.04)).connect(trem.gain);
    src.connect(bp).connect(gust).connect(trem).connect(level);
    s.out(level, parent, 0, 0.35);
    return { level, stop: (at) => { for (const n of [src, sweep1, sweep2, lfo1, lfo2, tremLfo]) n.stop(at); } };
  }

  /** Pressure-driven style selection: override the base rotation logic. */
  protected wanted(): string | null {
    const pinned = this.setting<string>('hMusicStyle');
    if (pinned !== 'pressure' && this.styles.has(pinned)) return pinned;
    const p = this.mood.tension;
    const target = p < 0.28 ? 'drone' : p < 0.55 ? 'siege' : 'horde';
    return target;
  }

  /** Override update to track pressure and set mood.tension from the scene. */
  override update(dt: number, state: State): void {
    // decay tension (pressure) slowly
    this.mood.tension = Math.max(0, this.mood.tension - dt * 0.02);
    super.update(dt, state);
  }

  /** Externally set pressure (from the scene's frame loop). */
  setPressure(p: number): void {
    this.mood.tension = Math.max(this.mood.tension, Math.min(1, p));
  }

  protected ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('hAmbience') : 0;
    const wet = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.wind, amb * (0.28 + this.mood.night * 0.3), now);
    this.setBed(this.rain, amb * wet * 0.22, now);
  }

  protected threatStep(i: number, t: number, g: number): void {
    if (i % 8 === 0) { this.s.heart(this.sfxBus, t, 0.11 * g); this.markHeart(t); }
    if (!this.notes) return;
    if (i % 32 === 16) this.s.riser(this.sfxBus, t, 16 * this.cur.stepDur, 0.03 * g);
    if (i % 32 === 0 && i > 0) this.s.boom(this.sfxBus, t, 0.06 * g);
  }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.core, s = this.s;
    const pan = this.panFor(srcIp);
    if (kind === 'allow') { this.playLead(srcIp); return; }
    if (!st.deviceVoices) return;
    switch (kind) {
      case 'block': {
        this.bumpTension(0.05);
        if (Math.random() >= st.gateBlock * 0.7) return;
        const t = this.slot('groan', 4, 1.3);
        if (t < 0) return;
        const root = this.chordAt(t, 1)[pick([0, 0, 2])];
        s.groan(this.sfxBus, t, root, 0.09 * st.gBlock, pan, 1.3 + Math.random() * 0.8);
        return;
      }
      case 'threat': {
        this.bumpTension(0.25);
        if (Math.random() >= st.gateThreat) return;
        const t = this.slot('roar', 4, 1.5);
        if (t < 0) return;
        const [r, third, fifth] = this.chordAt(t, 0);
        const g = 0.12 * st.gThreat;
        s.groan(this.sfxBus, t, r * 2, g, pan - 0.3, 2.4);
        s.groan(this.sfxBus, t + 0.12, third * 2, g * 0.8, pan + 0.3, 2.2);
        s.groan(this.sfxBus, t + 0.25, fifth, g * 0.7, pan, 2.6);
        s.boom(this.sfxBus, t, 0.07 * st.gThreat);
        return;
      }
      case 'dns': {
        if (!this.notes || Math.random() >= st.gateDns * 0.35) return;
        const t = this.slot('chirp', 2, 0.5);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.chirp(this.sfxBus, t, c[0], c[1], 0.02 * st.gDns, pan);
        return;
      }
      case 'wifi': {
        if (Math.random() >= st.gateWifi * 0.8) return;
        const t = this.slot('creak', 4, 1);
        if (t < 0) return;
        const f = this.chordAt(t, 2)[pick([0, 1, 2])];
        s.creak(this.sfxBus, t, f, 0.035 * st.gWifi, pan, Math.random() < 0.6 ? 1.12 : 0.84);
        return;
      }
      case 'dhcp': {
        if (!this.notes || Math.random() >= st.gateDhcp) return;
        const t = this.slot('arrive', 4, 1.5);
        if (t < 0) return;
        this.chordAt(t, 3).forEach((f, k) => s.musicBox(this.sfxBus, t + k * 0.07, f, 0.022 * st.gDhcp, pan + (k - 1) * 0.3));
        return;
      }
      case 'system': {
        const t = this.slot('generator', 4, 1.2);
        if (t < 0) return;
        s.sputter(this.sfxBus, t, this.chordAt(t, 1)[0], 0.06);
        return;
      }
    }
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const st = this.core, s = this.s;
    if (!st.deviceVoices) return;
    const pan = opts.pan ?? 0;
    if (name === 'shot') {
      if (this.setting<number>('hGunfire') <= 0) return;
      this.bumpTension(0.02);
      for (let n = 0; n < Math.min(4, opts.count ?? 1); n++) {
        const t = this.slot('shot', 0.5, 0.3);
        if (t < 0) return;
        const ring = this.chordAt(t, 4)[pick([0, 1, 2])];
        s.gunshot(this.sfxBus, t, 0.2 * this.setting<number>('hGunfire') * (n ? 0.8 : 1), pan, ring);
      }
    } else if (name === 'breach') {
      const t = this.slot('breach', 1, 0.4);
      if (t < 0) return;
      s.boom(this.sfxBus, t, 0.1 * st.gBlock);
      const f = this.chordAt(t, 3)[0];
      for (const [m, g, r] of [[1, 0.06, 1.4], [2.43, 0.04, 0.9], [3.87, 0.03, 0.6], [5.61, 0.02, 0.35]] as const) {
        s.tone(this.sfxBus, t, f * m, { g: g * st.gBlock, a: 0.002, r, pan, rev: 0.6 });
      }
    } else if (name === 'groan') {
      const t = this.slot('groan', 4, 1.3);
      if (t < 0) return;
      const root = this.chordAt(t, 1)[pick([0, 0, 2])];
      s.groan(this.sfxBus, t, root, 0.06 * st.gBlock, pan, 1.4 + Math.random() * 0.9);
    } else if (name === 'thunder') {
      const t = this.slot('thunder', 2, 3);
      if (t < 0) return;
      s.thunder(this.sfxBus, t, 0.16 * st.gBlock, pan);
    } else if (name === 'howl') {
      // a groan pushed up two octaves reads as a yipping, feral howl
      const t = this.slot('howl', 3, 1.4);
      if (t < 0) return;
      const root = this.chordAt(t, 1)[pick([1, 2])];
      s.groan(this.sfxBus, t, root * 2.5, 0.07 * st.gBlock, pan, 0.9 + Math.random() * 0.5);
    } else if (name === 'wallbreak') {
      // the wall goes: boom, a shock on the chord, and strings falling down
      const t = this.slot('wallbreak', 1, 1.2);
      if (t < 0) return;
      s.boom(this.sfxBus, t, 0.14 * st.gBlock);
      s.shock(this.sfxBus, t, this.chordAt(t, 1)[0] * 2, 0.07 * st.gBlock);
      const c = this.chordAt(t, 2)[0];
      s.strings(this.sfxBus, t, c, 0.05 * st.gBlock, pan);
      s.strings(this.sfxBus, t + 0.14, c * 0.84, 0.04 * st.gBlock, pan);
      s.strings(this.sfxBus, t + 0.28, c * 0.71, 0.035 * st.gBlock, pan);
    } else if (name === 'survivorDown') {
      // one of ours: a glass note, a low cello stab, and a skipped heartbeat
      const t = this.slot('survivorDown', 1, 0.8);
      if (t < 0) return;
      s.glass(this.sfxBus, t, this.chordAt(t, 4)[pick([1, 2])], 0.045, pan);
      s.cello(this.sfxBus, t, this.chordAt(t, 1)[0], 0.09 * st.gBlock, 0.5, pan);
      this.markHeart(t);
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const chord = this.chordAt(when, 3);
    switch (kind) {
      case 'block': case 'threat':
        s.gunshot(this.sfxBus, when, 0.25 * this.setting<number>('hGunfire') * st.gBlock, pan, chord[0] * 2);
        break;
      case 'dns':
        if (this.notes) s.chirp(this.sfxBus, when, chord[0] * 4, chord[1] * 4, 0.02 * st.gDns, pan);
        break;
      default:
        if (this.notes) s.pluck(this.sfxBus, when, pick(chord), 0.04 * (kind === 'allow' ? st.gAllow : kind === 'wifi' ? st.gWifi : st.gDhcp), pan);
    }
  }
}

export function holdoutScore(e: AudioEngine): Score { return new HoldoutConductor(e); }
