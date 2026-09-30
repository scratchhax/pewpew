import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, type Mood, type StyleDef } from '../../sound/conductor';

/**
 * SLIPSTREAM's soundtrack: 16-bit race-pop, major key, shuffled.
 *
 *   circuit  : 172 bpm — claps on the backbeat, a bass bouncing root to
 *              fifth, off-beat brass stabs, a bell hook over the top
 *   seaside  : 152 bpm cruise — organ pad, chopped guitar, horn, bells
 *   rainbow  : 184 bpm sprint — plucked bass, brass, glass sparkle, bells
 *
 * Three rules hold across all of them, because the previous version broke all
 * three and came out sounding like a warning rather than a race. Every chord
 * in every style is major - SEASIDE used to be C natural minor, with Cm, Ab,
 * Fm and Gm, and on rotate it played a third of the time. Every melody is
 * written in the major pentatonic, so no passing note can land on a flattened
 * third or seventh even by accident. And everything shuffles: the off-beat
 * sixteenth lands about a third of a step late, which is the difference
 * between a loop that marches and one that bounces.
 *
 * Each style states a two-bar HOOK up in the fifth octave, on bells, so there
 * is something to whistle. The reese bass and the supersaw are gone - those
 * are drum-and-bass and trance textures and neither belongs on a kart track.
 *
 * On top: the start-lights beeps, the pit radio blip, the shell's screaming
 * fly-past, spin-out slides, lap chimes — and a square-wave engine purr
 * whose pitch rides the hero's speed.
 */

/** A frequency `n` semitones above the tonic, `oct` octaves up. */
const semisOf = (root: number, n: number, oct: number): number => root * Math.pow(2, oct + n / 12);

/**
 * Major pentatonic, for every melody in this score. Picking the notes from a
 * five-note major scale means no phrase can land on a flattened third or
 * seventh, which is the interval that was making the old soundtrack sound
 * like a warning rather than a race.
 */
const PENTA = [0, 2, 4, 7, 9];

/**
 * A shuffled sixteenth. The off-beat lands late, which is the whole difference
 * between a loop that marches and one that bounces. Everything in this score
 * swings; nothing did before.
 */
const SWING = 0.3;

class Circuit extends Style {
  readonly id = 'green';
  readonly bpm = 172;
  readonly root = 43.65;                                     // F
  readonly scale = PENTA;
  // I - IV - V - I, all major
  readonly chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];
  readonly barsPerChord = 1;
  readonly leadOct = 5;
  readonly level = 0.62;

  /** Two bars of tune, as pentatonic degrees; -1 is a rest. */
  private static readonly HOOK = [
    0, -1, 2, 4, -1, 2, 0, -1, 4, -1, 5, 7, -1, 5, 4, -1,
    2, -1, 4, 5, -1, 7, 9, -1, 7, -1, 5, 4, 2, -1, 0, -1,
  ];

  private sw(pos: number, t: number): number { return pos % 2 ? t + this.stepDur * SWING : t; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, ch = this.chordAt(i);
    const st = this.sw(pos, t);

    // kick on the one and the and-of-three, claps on two and four
    if (pos === 0 || pos === 6 || pos === 10) s.kick(b, t, pos === 0 ? 0.115 : 0.07);
    if (pos === 4 || pos === 12) { s.snare(b, t, 0.036, pos === 12 ? 0.25 : -0.25); s.stomp(b, t, 0.024); }
    if (pos % 2 === 1) s.hat(b, st, 0.012, pos % 4 ? 0.4 : -0.4, pos === 15);

    // bass bounces root to fifth, eighths, shuffled
    if (pos % 2 === 0) {
      const n = [0, 2, 0, 1, 0, 2, 0, 1][pos >> 1];
      s.pluck(b, st, semisOf(this.root, ch[n % ch.length], 1), 0.055, -0.2, 0.15);
    }

    // brass on the off-beats: the chorus of every kart racer ever written
    if (pos === 2 || pos === 7 || pos === 11) {
      for (const n of ch) s.brass(b, st, semisOf(this.root, n, 3), pos === 7 ? 0.042 : 0.032, this.stepDur * 1.3, pos === 7 ? 0.3 : -0.3);
    }

    const hk = Circuit.HOOK[i % 32];
    if (hk >= 0) s.bell(b, st, this.scaleTone(hk, 5), 0.055, 0.15, 0.25);

    if (this.isChordStart(i)) s.crash(b, t, 0.028, 0.2, 0.9);
    if (m.tension > 0.5 && pos === 14) s.ping(b, st, this.scaleTone(9, 5), 0.014, 0.5);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.bell(this.bus, t, f, g * 1.1, pan);
  }
}

class Seaside extends Style {
  readonly id = 'sunset';
  readonly bpm = 152;
  readonly root = 36.71;                                     // D
  readonly scale = PENTA;
  // I - IV - V - IV, all major. It used to be Cm, Ab, Fm, Gm.
  readonly chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]];
  readonly barsPerChord = 2;
  readonly leadOct = 5;
  readonly level = 0.58;

  // fuller than a cruise usually asks for: with the old sparse version the
  // style sat at 7.9% of its energy above 1.5 kHz against 11-12% for the
  // other two, which is a tune nobody can hear
  private static readonly HOOK = [
    4, -1, 5, 4, -1, 2, 0, -1, 2, -1, 4, 5, -1, 4, 2, -1,
    5, -1, 7, 5, -1, 4, 2, -1, 4, -1, 2, 0, -1, 2, 4, -1,
  ];

  private sw(pos: number, t: number): number { return pos % 2 ? t + this.stepDur * SWING : t; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, ch = this.chordAt(i);
    const st = this.sw(pos, t);

    if (pos === 0 || pos === 8) s.kick(b, t, 0.095);
    if (pos === 4 || pos === 12) { s.snare(b, t, 0.032, 0); s.stomp(b, t, 0.02); }
    if (pos % 2 === 1) s.hat(b, st, 0.011, 0.35);

    // organ pad holds the chord, guitar chops the off-beats
    if (this.isChordStart(i)) for (const n of ch) s.organ(b, t, semisOf(this.root, n, 3), 0.02, this.stepDur * 26, -0.3);
    if (pos % 4 === 3) for (const n of ch) s.guitar(b, st, semisOf(this.root, n, 3), 0.024, true, 0.32);
    if (pos % 4 === 0) s.pluck(b, t, semisOf(this.root, ch[(pos >> 2) % ch.length], 1), 0.05, -0.25, 0.2);
    if (pos === 8) s.horn(b, t, semisOf(this.root, ch[2], 3), 0.03, 0.35);
    if (pos % 4 === 2) s.glass(b, st, semisOf(this.root, ch[(pos >> 2) % ch.length], 5), 0.02, -0.35);

    const hk = Seaside.HOOK[i % 32];
    if (hk >= 0) s.bell(b, st, this.scaleTone(hk, 5), 0.05, 0.2, 0.3);

    if (m.tension > 0.55 && pos === 14) s.ping(b, st, this.scaleTone(7, 5), 0.012, -0.4);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.glass(this.bus, t, f, g * 1.1, pan);
  }
}

class Rainbow extends Style {
  readonly id = 'rainbow';
  readonly bpm = 184;
  readonly root = 49;                                        // G
  readonly scale = PENTA;
  // I - IV - V - IV, all major. It used to lean on a reese and a supersaw.
  readonly chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]];
  readonly barsPerChord = 1;
  readonly leadOct = 5;
  readonly level = 0.56;

  private static readonly HOOK = [
    7, 9, 7, 5, 4, -1, 5, 7, 9, -1, 7, 5, -1, 4, 2, -1,
    0, 2, 4, 5, 7, 9, 11, -1, 9, 7, 5, 4, 2, 0, -1, -1,
  ];

  private sw(pos: number, t: number): number { return pos % 2 ? t + this.stepDur * SWING : t; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, ch = this.chordAt(i);
    const st = this.sw(pos, t);

    if (pos % 4 === 0) s.kick(b, t, 0.105);
    if (pos === 4 || pos === 12) { s.snare(b, t, 0.034, 0); s.stomp(b, t, 0.022); }
    if (pos % 2 === 1) s.hat(b, st, 0.011, pos % 4 ? 0.45 : -0.45);

    // a bouncing plucked bass, not a reese
    if (pos % 2 === 0) s.pluck(b, st, semisOf(this.root, ch[(pos >> 1) % 2 ? 2 : 0], 1), 0.05, -0.2, 0.12);
    // sparkle on the off-beats
    if (pos % 4 === 2) s.glass(b, st, semisOf(this.root, ch[(pos >> 2) % ch.length], 5), 0.024, ((pos / 15) * 2 - 1) * 0.6);
    if (pos === 0 || pos === 8) for (const n of ch) s.brass(b, t, semisOf(this.root, n, 3), 0.03, this.stepDur * 2.2, 0.25);

    const hk = Rainbow.HOOK[i % 32];
    if (hk >= 0) s.bell(b, st, this.scaleTone(hk, 5), 0.05, 0.15, -0.2);

    if (this.isChordStart(i) && (i / 16) % 4 === 0) s.crash(b, t, 0.026, -0.3, 0.8);
    if (m.tension > 0.5 && pos === 6) s.ping(b, st, this.scaleTone(11, 5), 0.013, 0.4);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.bell(this.bus, t, f, g, pan);
  }
}

const STYLES: StyleDef[] = [
  { id: 'green', name: 'Circuit — brass and bells', make: (s, bus) => new Circuit(s, bus) },
  { id: 'sunset', name: 'Seaside — organ cruise', make: (s, bus) => new Seaside(s, bus) },
  { id: 'rainbow', name: 'Rainbow — bells and sparkle', make: (s, bus) => new Rainbow(s, bus) },
];

export const SLIP_MUSIC: Array<[string, string]> = [
  ['rotate', 'Rotate'], ...STYLES.map((d) => [d.id, d.name] as [string, string]),
];

class SlipConductor extends Conductor {
  private engineSpeed = 0;
  private lastPurr = 0;
  private lastBeep = 0;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'kMusicStyle', rotateKey: 'kMusicRotate', musicGain: 1.6 });
  }

  /** Called by the scene every frame with the hero's 0..1 speed. */
  setEngine(speed01: number): void { this.engineSpeed = speed01; }

  private get sfxG(): number { return (this.e.settings as unknown as { kSfx?: number }).kSfx ?? 0.75; }
  private get engG(): number { return (this.e.settings as unknown as { kEngine?: number }).kEngine ?? 0.35; }

  protected ambience(_dt: number, _state: State, now: number, on: boolean): void {
    if (!on || this.engG <= 0) return;
    if (now - this.lastPurr < 0.055) return;
    this.lastPurr = now;
    const sp = this.engineSpeed;
    if (sp < 0.03) return;
    const f = 30 + sp * 44;
    const g = 0.012 * this.engG * Math.min(1, 0.35 + sp);
    this.s.tone(this.amb, now, f, { type: 'square', g, a: 0.01, h: 0.02, r: 0.06, lp: 420, pan: -0.15 });
    this.s.tone(this.amb, now, f * 2.01, { type: 'square', g: g * 0.4, a: 0.01, h: 0.02, r: 0.05, lp: 900, pan: 0.15 });
  }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.core;
    const g = this.sfxG;
    if (g <= 0) return;
    const pan = this.panFor(srcIp);
    switch (kind) {
      case 'allow': this.playLead(srcIp, 0.06); break;
      case 'dns': {
        const t = this.slot('dns', 2, 0.5);
        if (t >= 0) this.s.chip(this.sfxBus, t, this.chordAt(t, 5)[1], 0.02 * g * st.gDns, 0.12, pan, 7);
        break;
      }
      case 'block': {
        const t = this.slot('blk', 1, 0.3);
        if (t >= 0) { this.s.snare(this.sfxBus, t, 0.05 * g * st.gBlock, pan); this.s.noiseHit(this.sfxBus, t, { type: 'lowpass', f: 500, g: 0.03 * g, a: 0.002, h: 0.05, r: 0.2, pan }); }
        break;
      }
      case 'threat': {
        const t = this.quant(1);
        this.s.tone(this.sfxBus, t, 880, { type: 'square', g: 0.04 * g, a: 0.01, h: 0.12, r: 0.1, pan });
        this.s.tone(this.sfxBus, t + 0.16, 660, { type: 'square', g: 0.04 * g, a: 0.01, h: 0.12, r: 0.14, pan });
        this.bumpTension(0.25);
        break;
      }
      case 'dhcp': {
        const t = this.slot('dhcp', 2, 0.4);
        if (t >= 0) this.s.pluck(this.sfxBus, t, this.chordAt(t, 3)[0] * 2, 0.03 * g, pan);
        break;
      }
      case 'wifi': {
        const t = this.slot('wifi', 2, 0.4);
        if (t >= 0) { this.s.chip(this.sfxBus, t, 900, 0.02 * g, 0.05, pan); this.s.chip(this.sfxBus, t + 0.09, 1350, 0.02 * g, 0.07, pan); }
        break;
      }
      case 'system': {
        const t = this.slot('sys', 4, 0.6);
        if (t >= 0) this.s.tom(this.sfxBus, t, 90, 0.05 * g, 0);
        break;
      }
    }
  }

  sfx(name: string, opts?: SfxOpts): void {
    const g = this.sfxG;
    if (g <= 0) return;
    const now = this.s.ctx.currentTime, pan = opts?.pan ?? 0;
    switch (name) {
      case 'count': {
        if (now - this.lastBeep < 0.1) return;
        this.lastBeep = now;
        this.s.chip(this.sfxBus, now, 660, 0.05 * g, 0.12, 0);
        break;
      }
      case 'go': {
        this.s.chip(this.sfxBus, now, 1320, 0.07 * g, 0.3, 0);
        this.s.chip(this.sfxBus, now + 0.05, 1760, 0.05 * g, 0.34, 0);
        break;
      }
      case 'boost': this.s.chip(this.sfxBus, now, 440, 0.045 * g, 0.22, pan, 19); break;
      case 'pad': this.s.chip(this.sfxBus, now, 700, 0.04 * g, 0.16, pan, 12); break;
      case 'pickup': {   // item box: coin-up double blip
        this.s.chip(this.sfxBus, now, 990, 0.045 * g, 0.06, pan);
        this.s.chip(this.sfxBus, now + 0.06, 1480, 0.05 * g, 0.16, pan);
        break;
      }
      case 'spin': {
        this.s.chip(this.sfxBus, now, 800, 0.04 * g, 0.3, pan, -14);
        this.s.noiseHit(this.sfxBus, now + 0.05, { type: 'bandpass', f: 1400, q: 2, g: 0.04 * g, a: 0.01, h: 0.1, r: 0.3, pan });
        break;
      }
      case 'shell': {   // a scream that flies past and homes in
        this.s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 2400, q: 1.2, g: 0.05 * g, a: 0.02, h: 0.16, r: 0.3, pan });
        this.s.tone(this.sfxBus, now, 220, { type: 'sawtooth', g: 0.03 * g, a: 0.05, h: 0.2, r: 0.2, lp: 2600, lpTo: 700, pan });
        break;
      }
      case 'shellhit': {
        this.s.boom(this.sfxBus, now, 0.09 * g);
        this.s.chip(this.sfxBus, now, 900, 0.05 * g, 0.35, 0, -17);
        break;
      }
      case 'lap': {
        const c = this.chordAt(now, 5);
        c.forEach((f, i) => this.s.bell(this.sfxBus, now + i * 0.07, f, 0.03 * g, (i - 1) * 0.4));
        break;
      }
      case 'pit': {
        this.s.chip(this.sfxBus, now, 320, 0.035 * g, 0.12, pan, 9);
        this.s.chip(this.sfxBus, now + 0.13, 640, 0.035 * g, 0.2, pan, 9);
        break;
      }
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    if (kind === 'block' || kind === 'threat') this.s.snare(this.sfxBus, when, 0.008, (Math.random() - 0.5) * 1.4);
    else this.s.chip(this.sfxBus, when, this.chordAt(when, 5)[1], 0.004, 0.03, (Math.random() - 0.5) * 1.4);
  }
}

/** The live score (scene swaps are whole-page reloads, so this is safe). */
let live: SlipConductor | null = null;

/** The scene's engine-purr hook: hero speed 0..1, every frame. */
export function engineSpeed(speed01: number): void { live?.setEngine(speed01); }

export function slipScore(e: AudioEngine): Score {
  const s = new SlipConductor(e);
  live = s;
  return s;
}
