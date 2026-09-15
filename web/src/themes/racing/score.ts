import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed } from '../../sound/synth';

/**
 * Midnight Run's soundtrack. Seven styles take turns (or one is pinned):
 *
 *   tokyo drift    : a written song: horn hook, swung beat, whistle, crowd shouts, koto
 *   street breaks  : big-beat breaks, an acid bass line, stabs
 *   liquid dnb     : 172 bpm rollers, a reese bass, airy pads
 *   chrome riff    : drop-D palm-muted power chords and a heavy backbeat
 *   night drive    : slow synthwave, arpeggios and a saw lead
 *   trap lights    : half-time 808 slides, hat rolls, a bell line
 *   eurobeat rush  : four-on-the-floor, octave bass, supersaw riffs
 *
 * The car is part of the band: the engine note is pitched to the chord and
 * climbs through each gear with speed, shifts land with a turbo blow-off,
 * nitro whooshes, barricades crash in key, rivals pass by with a doppler rev,
 * horns honk a fifth for roadblocks, and a soft siren wails while the police
 * are on us.
 */

// ── street breaks ──────────────────────────────────────────────────────────
class Breaks extends Style {
  readonly id = 'breaks';
  readonly bpm = 132;
  readonly root = 55;                                          // A
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];     // Am Am F G
  readonly barsPerChord = 1;
  readonly leadOct = 3;
  readonly level = 1;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const root = this.tones(i, 1)[0];
    // the break: kick 0 / 10, snare 4 / 12, ghost snare, hats on the offbeat
    if (pos === 0 || pos === 10 || (m.night > 0.4 && pos === 7)) s.kick(b, t, 0.17);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.065);
    if (pos === 14 && Math.random() < 0.5) s.snare(b, t, 0.025, 0.3);
    if (pos % 2 === 1) s.hat(b, t, pos % 4 === 3 ? 0.02 : 0.012, 0.3, pos === 15);
    // acid line: resonant filter opens with tension
    const acid = [0, 0, 12, 0, 7, 0, 10, 12];
    if (pos % 2 === 0) s.arp(b, t, root * Math.pow(2, acid[pos / 2] / 12), 0.03, 500 + m.tension * 2500 + m.night * 800, 0);
    if (this.isChordStart(i) && m.night > 0.3) {
      for (const f of this.tones(i, 3)) s.supersaw(b, t, f, 0.008, 0.12, 0);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.arp(this.bus, t, f, g * 0.5, 2400, pan); }
}

// ── liquid dnb ─────────────────────────────────────────────────────────────
class Dnb extends Style {
  readonly id = 'dnb';
  readonly bpm = 172;
  readonly root = 43.65;                                       // F
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 2, 5, 9], [-5, -2, 2, 5]];   // Fm7 Dbmaj7 Eb Cm
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.48;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.pad(b, t, this.tones(i, 3).slice(0, 3), 0.012, hold * 0.9, 1800);
      s.reese(b, t, this.tones(i, 1)[0], 0.05, hold * 0.45);
    }
    if (i % (this.barsPerChord * 16) === this.barsPerChord * 8) s.reese(b, t, this.tones(i, 1)[0], 0.045, 8 * this.stepDur * 0.9);
    if (pos === 0 || pos === 10) s.kick(b, t, 0.16);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.06);
    if (m.night > 0.3 && pos === 7) s.snare(b, t, 0.02, -0.3);
    if (pos % 2 === 0) s.hat(b, t, 0.014, pos % 4 === 2 ? 0.35 : -0.35);
    if (m.night > 0.6 && pos % 2 === 1) s.hat(b, t, 0.008, 0.2);
    if (pos % 4 === 2 && Math.random() < 0.3) s.bell(b, t, this.tones(i, 4)[(Math.random() * 4) | 0], 0.018, 0.3, 0.5);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.6, pan, 0.5); }
}

// ── chrome riff ────────────────────────────────────────────────────────────
class Riff extends Style {
  readonly id = 'riff';
  readonly bpm = 96;
  readonly root = 36.71;                                       // D (drop D)
  readonly scale = [0, 3, 5, 6, 7, 10];                        // blues-ish minor
  readonly chords = [[0, 7, 12], [0, 7, 12], [3, 10, 15], [-2, 5, 10]];
  readonly barsPerChord = 1;
  readonly leadOct = 3;
  readonly level = 0.9;
  private riff: boolean[] = [];

  enter(): void { this.newRiff(); }
  private newRiff(): void { this.riff = Array.from({ length: 16 }, (_, k) => k % 4 === 0 || Math.random() < 0.45); }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const root = this.tones(i, 1)[0];
    if (bar % 4 === 0 && pos === 0) this.newRiff();
    // chugs on the riff's sixteenths, a ringing chord at the top of each bar
    if (this.riff[pos] && pos % 2 === 0) s.guitar(b, t, root, pos === 0 ? 0.05 : 0.035, pos !== 0, pos % 4 ? 0.35 : -0.35);
    if (pos === 0 && m.night > 0.3) s.guitar(b, t, root * 2, 0.025, false, 0);
    if (pos === 0 || pos === 8 || (m.night > 0.5 && (pos === 3 || pos === 11))) s.kick(b, t, 0.18);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.08);
    if (pos % 2 === 0) s.hat(b, t, 0.016, 0.25, pos === 14);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f, g * 0.45, 0.2, pan); }
}

// ── night drive ────────────────────────────────────────────────────────────
class Drive extends Style {
  readonly id = 'drive';
  readonly bpm = 88;
  readonly root = 41.2;                                        // E
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-2, 2, 5]];   // Em C A D
  readonly barsPerChord = 2;
  readonly leadOct = 3;
  readonly level = 1.05;
  private melody: number[] = [];

  enter(): void { this.newMelody(); }
  private newMelody(): void {
    let d = 7;
    this.melody = Array.from({ length: 8 }, (_, k) => {
      d = Math.max(4, Math.min(12, d + pick([-2, -1, 1, 2, 0])));
      return k % 4 === 3 ? -1 : d;
    });
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (this.isChordStart(i)) {
      s.pad(b, t, this.tones(i, 2), 0.016, this.barsPerChord * 16 * this.stepDur * 0.9, 1300);
      if (bar % 8 === 0) this.newMelody();
    }
    if (pos % 2 === 0) s.bassPulse(b, t, this.tones(i, 1)[0] * (pos % 4 === 2 ? 2 : 1), 0.07);
    if (pos === 0 || pos === 8) s.kick(b, t, 0.14);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.05);
    s.arp(b, t, this.tones(i, 4)[[0, 1, 2, 1][pos % 4]], 0.012, 1800 + m.tension * 1200, pos % 2 ? 0.45 : -0.45);
    if (bar % 2 === 1 && pos % 4 === 0) {
      const d = this.melody[pos / 4 + (bar % 4 === 3 ? 4 : 0)];
      if (d >= 0) s.sawLead(b, t, this.scaleTone(d, 3), 0.024, 3 * this.stepDur, 0.1);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f, g * 0.45, 0.2, pan); }
}

// ── trap lights ────────────────────────────────────────────────────────────
class Trap extends Style {
  readonly id = 'trap';
  readonly bpm = 140;
  readonly root = 38.89;                                       // Eb
  readonly scale = [0, 2, 3, 5, 7, 8, 11];                     // harmonic minor
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-5, -1, 2], [0, 3, 7]];    // Ebm Cb Bb Ebm
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.36;
  private prev808 = 0;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const root = this.tones(i, 1)[0];
    // half-time: kick + 808 on 0 and 11, snare on 8
    if (pos === 0 || pos === 11 || (m.night > 0.5 && pos === 6)) {
      s.eight08(b, t, root, 0.14, 0.5, this.prev808 && Math.random() < 0.4 ? this.prev808 : 0);
      this.prev808 = root;
    }
    if (pos === 8) s.snare(b, t, 0.07);
    // hats with rolls into the next bar
    if (pos % 2 === 0) s.hat(b, t, 0.014, 0.3);
    if (pos >= 12 && m.night > 0.2) {
      s.hat(b, t, 0.01, -0.3);
      s.hat(b, t + this.stepDur / 3, 0.008, -0.2);
      s.hat(b, t + (this.stepDur * 2) / 3, 0.008, -0.1);
    }
    if (pos % 4 === 2 && Math.random() < 0.55) s.bell(b, t, this.tones(i, 4)[(Math.random() * 3) | 0], 0.02, 0.2, 0.35);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.6, pan, 0.4); }
}

// ── eurobeat rush ──────────────────────────────────────────────────────────
class Euro extends Style {
  readonly id = 'euro';
  readonly bpm = 156;
  readonly root = 36.71;                                       // D
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]];   // Dm Bb C Am
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.78;
  private riff: number[] = [];

  enter(): void { this.newRiff(); }
  private newRiff(): void {
    this.riff = Array.from({ length: 16 }, (_, k) => (k % 3 === 2 ? -1 : [0, 2, 4, 5, 4, 2, 7, 5][k % 8]));
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const root = this.tones(i, 2)[0];
    if (bar % 8 === 0 && pos === 0) this.newRiff();
    if (pos % 4 === 0) s.kick(b, t, 0.16);
    if (pos % 4 === 2) s.bassPulse(b, t, root, 0.075);           // offbeat octave bass
    if (pos === 4 || pos === 12) s.snare(b, t, 0.045);
    if (pos % 4 === 2) s.hat(b, t, 0.018, 0.3, true);
    // the supersaw riff every other bar, arps underneath when it's busy
    if (bar % 2 === 1 && pos % 2 === 0) {
      const d = this.riff[pos];
      if (d >= 0) s.supersaw(b, t, this.scaleTone(d, 4), 0.014, this.stepDur * 1.5, 0);
    } else if (m.night > 0.3) {
      s.arp(b, t, this.tones(i, 4)[[0, 1, 2, 1][pos % 4]], 0.012, 2600, pos % 2 ? 0.4 : -0.4);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.supersaw(this.bus, t, f, g * 0.25, 0.1, pan); }
}

// ── tokyo drift ────────────────────────────────────────────────────────────
/** One note of a written part: step (16ths into the phrase), semitones above the tonic, length in steps. */
type Note = [step: number, semi: number, len: number, fall?: boolean];

/**
 * A mid-2000s Tokyo street-racing hip-hop anthem, written for this project
 * (the hook and every part are original; the sound is the era's): a horn
 * section hook with scoops and fall-offs, a hard swung beat with claps and
 * 808s, a whistle lead, crowd "hey!" shouts, koto and taiko, scratches and a
 * temple gong. Unlike the generative styles it's a *song*: fixed parts in a
 * 32-bar form (intro, verse, hook, break, hook) that loops.
 */
class Tokyo extends Style {
  readonly id = 'tokyo';
  readonly bpm = 128;
  readonly root = 34.65;                                       // C#
  readonly scale = [0, 3, 5, 6, 7, 10];                        // minor blues
  readonly chords = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];     // C#m C#m A B
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.4;

  // the hook: two bars for the horn section, answered in the second bar (octave 3 above C#)
  private static readonly HOOK: Note[] = [
    [0, 7, 2], [3, 7, 1], [4, 10, 1], [6, 7, 2], [10, 3, 1], [11, 5, 1], [12, 6, 1], [14, 7, 2, true],
    [16, 7, 2], [19, 10, 1], [20, 12, 2], [23, 10, 1], [24, 7, 1], [26, 5, 1], [28, 3, 1], [30, 0, 2, true],
  ];
  // verse stabs: short and punchy on the offbeats
  private static readonly STABS: Note[] = [[0, 7, 1], [6, 7, 1], [10, 10, 1, true], [16, 3, 1], [22, 5, 1], [27, 7, 2, true]];
  // whistle answer in the verse and the break
  private static readonly WHISTLE: Note[] = [[0, 15, 3], [4, 17, 2], [6, 19, 4], [12, 17, 3], [16, 15, 2], [19, 12, 2], [22, 10, 6]];
  // koto figure for the intro and the break
  private static readonly KOTO: Note[] = [[0, 12, 2], [2, 13, 2], [4, 17, 2], [6, 19, 2], [8, 20, 4], [12, 19, 2], [14, 17, 2]];

  /** Where we are in the 32-bar song. */
  private section(bar: number): 'intro' | 'verse' | 'hook' | 'break' {
    const b = bar % 32;
    return b < 4 ? 'intro' : b < 12 ? 'verse' : b < 20 ? 'hook' : b < 24 ? 'break' : 'hook';
  }

  private play(part: Note[], stepInPhrase: number, t: number, voice: (f: number, len: number, fall: boolean) => void): void {
    for (const [st, semi, len, fall] of part) {
      if (st === stepInPhrase) voice(this.root * Math.pow(2, 3 + semi / 12), len * this.stepDur, !!fall);
    }
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const sec = this.section(bar), p2 = ((bar % 2) * 16) + pos;       // step within a two-bar phrase
    const root = this.tones(i, 1)[0];
    const swing = pos % 2 === 1 ? this.stepDur * 0.14 : 0;
    const busy = m.night > 0.3 || m.tension > 0.3;

    // ── drums ──
    if (bar % 32 === 0 && pos === 0) s.gong(b, t, this.root * 4, 0.04);
    if (sec === 'intro' || sec === 'break') {
      if (pos === 0 || (sec === 'break' && pos === 10)) s.taiko(b, t, 0.16, -0.15);
      if (sec === 'break' && pos === 8) s.taiko(b, t, 0.1, 0.25);
      if (pos % 4 === 2) s.hat(b, t + swing, 0.01, 0.3);
      if (sec === 'break' && bar % 4 === 3 && pos === 8) s.riser(b, t, 8 * this.stepDur, 0.04);
    } else {
      const kicks = busy ? [0, 3, 7, 10] : [0, 7, 10];
      if (kicks.includes(pos)) {
        s.kick(b, t, pos === 0 ? 0.22 : 0.16);
        if (pos !== 3) s.eight08(b, t, pos === 7 ? root * 1.335 : root, 0.12, pos === 0 ? 0.4 : 0.22);
      }
      if (pos === 4 || pos === 12) { s.clap(b, t, 0.13, pos === 4 ? -0.1 : 0.1); s.snare(b, t, 0.04); }
      if (sec === 'hook' && pos === 11) s.clap(b, t, 0.05, 0.3);             // pickup clap into the backbeat
      s.hat(b, t + swing, pos % 2 ? 0.016 : 0.009, pos % 2 ? 0.3 : -0.25, pos === 14 && bar % 2 === 1);
      if (sec === 'hook' && pos === 0 && bar % 2 === 0) s.taiko(b, t, 0.09, 0.2);
    }

    // ── crowd ──
    if ((sec === 'hook' && bar % 2 === 1 && pos === 12) || (sec === 'intro' && bar % 4 === 3 && pos === 12)) {
      s.hey(b, t, 0.09);
    }

    // ── horns ──
    const horn = (f: number, len: number, fall: boolean) => {
      s.section(b, t, f, 0.03, len * 0.85, -0.3, fall);
      s.section(b, t + 0.008, f * 2, 0.018, len * 0.85, 0.3, fall);     // the octave above, like a real section
      s.section(b, t + 0.004, f / 2, 0.02, len * 0.8, 0, false);        // and the bari underneath
    };
    if (sec === 'hook') this.play(Tokyo.HOOK, p2, t, horn);
    if (sec === 'verse') this.play(Tokyo.STABS, p2, t, (f, len, fall) => s.section(b, t, f, 0.028, len * 0.7, 0.2, fall));

    // ── whistle, koto, scratches ──
    if ((sec === 'verse' && bar % 4 >= 2) || sec === 'break') {
      let prev = 0;
      for (const [st, semi, len] of Tokyo.WHISTLE) {
        if (st === p2) s.whistle(b, t, this.root * Math.pow(2, 4 + semi / 12), 0.022, len * this.stepDur, prev, 0.15);
        if (st < p2) prev = this.root * Math.pow(2, 4 + semi / 12);
      }
    }
    if (sec === 'intro' || (sec === 'break' && bar % 2 === 0)) {
      this.play(Tokyo.KOTO, pos, t, (f) => s.koto(b, t, f, 0.045, -0.1));
    }
    if ((sec === 'verse' && bar % 4 === 3 && pos === 12) || (sec === 'hook' && bar % 8 === 3 && pos === 12)) {
      s.scratch(b, t, 0.06, this.stepDur * 2, 0.25);
      s.scratch(b, t + this.stepDur * 2, 0.05, this.stepDur * 2, -0.25);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.koto(this.bus, t, f, g * 0.7, pan); }
}

// ── the conductor ──────────────────────────────────────────────────────────
const STYLES: StyleDef[] = [
  { id: 'tokyo', name: 'Tokyo drift', make: (s, b) => new Tokyo(s, b) },
  { id: 'breaks', name: 'Street breaks', make: (s, b) => new Breaks(s, b) },
  { id: 'drive', name: 'Night drive', make: (s, b) => new Drive(s, b) },
  { id: 'dnb', name: 'Liquid DnB', make: (s, b) => new Dnb(s, b) },
  { id: 'riff', name: 'Chrome riff', make: (s, b) => new Riff(s, b) },
  { id: 'trap', name: 'Trap lights', make: (s, b) => new Trap(s, b) },
  { id: 'euro', name: 'Eurobeat rush', make: (s, b) => new Euro(s, b) },
];

export const RACING_MUSIC: Array<[string, string]> = [['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name])];

/** Top speed of each gear (m/s). */
const GEARS = [0, 11, 20, 30, 41, 54, 70, 90];

class StreetConductor extends Conductor {
  private engine: { oscs: OscillatorNode[]; lp: BiquadFilterNode; level: GainNode };
  private road: Bed;
  private rain: Bed;
  private speed = 0;
  private nitro = 0;
  private gear = 1;
  private shiftAt = -1;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'rMusicStyle', rotateKey: 'rMusicRotate' });
    this.road = this.s.wind(this.amb);
    this.rain = this.s.rain(this.amb);
    // the engine: two detuned saws and a sub, through a filter that opens with revs
    const ctx = this.s.ctx, t = ctx.currentTime, end = t + 1e6;
    const lp = this.s.filter('lowpass', 400, 2.5);
    const level = this.s.gain(0);
    const oscs = [
      this.s.osc('sawtooth', 55, t, end, -9), this.s.osc('sawtooth', 55, t, end, 9), this.s.osc('square', 27.5, t, end),
    ];
    oscs.forEach((o, k) => o.connect(this.s.gain(k === 2 ? 0.5 : 0.35)).connect(lp));
    lp.connect(level);
    this.s.out(level, this.amb, 0, 0.05);
    this.engine = { oscs, lp, level };
    this.engineBed = { level, stop: () => {} };
  }

  private engineBed: Bed;

  protected ambience(dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('rAmbience') : 0;
    const eng = on ? this.setting<number>('rEngine') : 0;
    const wet = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.road, amb * (0.08 + Math.min(1, this.speed / 70) * 0.22), now);
    this.setBed(this.rain, amb * wet * 0.2, now);

    // gears: revs climb from the chord root to its octave; shifts wait for the next eighth
    const top = GEARS[this.gear], bottom = GEARS[this.gear - 1];
    if (this.speed > top && this.gear < GEARS.length - 1 && this.shiftAt < 0) this.shiftAt = this.slot('shift', 2, 0.5);
    if (this.speed < bottom * 0.92 && this.gear > 1) this.gear--;
    if (this.shiftAt > 0 && now >= this.shiftAt - 0.02) {
      this.gear++;
      if (eng > 0) this.s.blowoff(this.sfxBus, this.shiftAt, 0.05 * eng);
      this.shiftAt = -1;
    }
    const lo = GEARS[this.gear - 1], hi = GEARS[this.gear];
    const rev = Math.max(0, Math.min(1, (this.speed - lo) / Math.max(1, hi - lo)));
    const root = this.chordAt(now, 1)[0];
    const f = root * Math.pow(2, rev * 0.9 + this.nitro * 0.1);
    this.engine.oscs[0].frequency.setTargetAtTime(f, now, 0.08);
    this.engine.oscs[1].frequency.setTargetAtTime(f, now, 0.08);
    this.engine.oscs[2].frequency.setTargetAtTime(f / 2, now, 0.08);
    this.engine.lp.frequency.setTargetAtTime(300 + rev * 900 + this.nitro * 900, now, 0.1);
    this.setBed(this.engineBed, eng * (0.08 + rev * 0.05 + this.nitro * 0.05), now);
    void dt;
  }

  /** Police on us: a soft, slow siren wail across two chord tones. */
  protected threatStep(i: number, t: number, g: number): void {
    const bars2 = this.cur.barSteps * 2;
    if (i % 8 === 0) this.markHeart(t);
    if (i % bars2 === 0) {
      const c = this.chordAt(t, 4), len = bars2 * this.cur.stepDur;
      this.s.tone(this.sfxBus, t, c[0], { type: 'triangle', g: 0.018 * g, a: len * 0.45, h: 0.05, r: len * 0.5, glide: 1.5, lp: 2200, rev: 0.4, pan: 0.3 });
    }
  }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.core, s = this.s;
    const pan = this.panFor(srcIp);
    if (kind === 'allow') { this.playLead(srcIp); return; }
    if (!st.deviceVoices) return;
    switch (kind) {
      case 'block': {
        this.bumpTension(0.05);
        if (Math.random() >= st.gateBlock * 0.45) return;
        const t = this.slot('horn', 4, 1);
        if (t < 0) return;
        s.horn(this.sfxBus, t, this.chordAt(t, 3)[0], 0.03 * st.gBlock, pan);
        return;
      }
      case 'threat': {
        this.bumpTension(0.25);
        return;
      }
      case 'dns': {
        if (Math.random() >= st.gateDns * 0.3) return;
        const t = this.slot('dns', 2, 0.5);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.chirp(this.sfxBus, t, c[0], c[1], 0.014 * st.gDns, pan);
        return;
      }
      case 'dhcp': {
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('rival', 4, 1.5);
        if (t < 0) return;
        s.passBy(this.sfxBus, t, this.chordAt(t, 2)[0], 0.05 * st.gDhcp, pan);
        return;
      }
      case 'wifi': {
        if (Math.random() >= st.gateWifi * 0.8) return;
        const t = this.slot('gate', 4, 1);
        if (t < 0) return;
        this.chordAt(t, 4).forEach((f, k) => s.ping(this.sfxBus, t + k * this.cur.stepDur, f, 0.014 * st.gWifi, pan));
        return;
      }
      case 'system': {
        const t = this.slot('grid', 4, 1.2);
        if (t < 0) return;
        s.shock(this.sfxBus, t, this.chordAt(t, 1)[0], 0.06);
        return;
      }
    }
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const st = this.core, s = this.s;
    if (name === 'drive') {
      // every frame from the theme: speed in m/s (count) and nitro 0..100 (variant)
      this.speed = opts.count ?? this.speed;
      this.nitro = Number(opts.variant ?? 0) / 100;
      return;
    }
    if (!st.deviceVoices) return;
    const eng = this.setting<number>('rEngine');
    const pan = opts.pan ?? 0;
    const hard = Math.min(1.5, (opts.count ?? 5) / 6);
    if (name === 'honk') {
      // boxed in: a long lean on the horn, pitched to the chord
      const t = s.ctx.currentTime + 0.02;
      const f = this.chordAt(t, 3)[0];
      for (const m of [1, 1.5]) s.tone(this.sfxBus, t, f * m, { type: 'square', g: 0.02 * eng + 0.01, a: 0.01, h: 0.5, r: 0.1, lp: 1800, pan, rev: 0.25 });
      return;
    }
    if (name === 'smash') {
      const t = this.slot('smash', 1, 0.3);
      if (t < 0) return;
      s.crash(this.sfxBus, t, 0.2 * st.gBlock * hard, pan, this.chordAt(t, 3)[0]);
    } else if (name === 'bump') {
      // a light panel knock: no waiting for the grid, it's contact
      const t = s.ctx.currentTime + 0.01;
      s.tom(this.sfxBus, t, 110, 0.12 * hard, pan);
      s.noiseHit(this.sfxBus, t, { type: 'bandpass', f: 1600, q: 1, g: 0.05 * hard, a: 0.002, r: 0.08, pan });
    } else if (name === 'nitro' && eng > 0) {
      const t = this.slot('nitro', 2, 0.4);
      if (t < 0) return;
      s.warp(this.sfxBus, t, this.chordAt(t, 2)[0], 0.05 * eng, 0);
      s.noiseHit(this.sfxBus, t, { type: 'lowpass', f: 900, fTo: 2400, g: 0.06 * eng, a: 0.3, h: 0.6, r: 0.8, rev: 0.2 });
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const c = this.chordAt(when, 4);
    if (kind === 'block' || kind === 'threat') s.horn(this.sfxBus, when, c[0] / 2, 0.012 * st.gBlock, pan);
    else s.ping(this.sfxBus, when, pick(c), 0.008 * (kind === 'allow' ? st.gAllow : st.gDns), pan);
  }
}

export function racingScore(e: AudioEngine): Score { return new StreetConductor(e); }
