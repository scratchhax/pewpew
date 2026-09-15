import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, semis, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Bus, Synth } from '../../sound/synth';

/**
 * Packet Rush's soundtrack: a chip band. Pulse waves at the classic 12.5%, 25%
 * and 50% widths, a triangle bass, noise drums and fast arpeggio chords, playing
 * five original tunes. Each tune's melody is written in phrases (a motif, the
 * motif again with a twist, a contrasting line, and the motif coming home),
 * rewritten every few loops so it never goes stale.
 *
 *   hills     : bouncy major overworld
 *   sky       : an airship march
 *   caves     : an echoing underground minor groove
 *   factory   : a driving minor rush with 32nd-note arps
 *   castle    : a harmonic-minor siege
 *
 * By default the music follows the world (hills, sky and caves take turns on a
 * calm network; the factory in a storm; the castle in a hurricane). The game's
 * sound effects are instant (jumps, stomps, gems with a climbing combo, block
 * bumps, power-ups, brick crunches, checkpoint fanfares, bombs) and pitched to
 * the tune's key.
 */

// ── the chip kit ───────────────────────────────────────────────────────────
class Chip {
  private waves = new Map<number, PeriodicWave>();

  constructor(private s: Synth) {
    // band-limited pulse waves: a0 = duty, an = 2/(n pi) sin(n pi duty)
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 40, real = new Float32Array(n), imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      this.waves.set(duty, s.ctx.createPeriodicWave(real, imag, { disableNormalization: false }));
    }
  }

  /** A pulse note. `vib` adds vibrato after a moment; `slide` glides to f*slide; `arp` cycles semitone offsets fast. */
  pulse(bus: Bus, t: number, f: number, g: number, len: number, duty: 0.125 | 0.25 | 0.5,
        o: { vib?: number; slide?: number; pan?: number; echo?: number; decay?: number; arp?: number[]; arpRate?: number } = {}): void {
    const s = this.s;
    if (s.busy(2) || f <= 0) return;
    const r = o.decay ?? 0.035;
    const env = s.env(t, g, 0.002, Math.max(0, len - 0.01), r);
    if (!env) return;
    const end = t + len + r;
    const osc = s.ctx.createOscillator();
    osc.setPeriodicWave(this.waves.get(duty)!);
    osc.frequency.setValueAtTime(f, t);
    if (o.arp) {
      const rate = o.arpRate ?? 1 / 48;
      let k = 0;
      for (let tt = t; tt < t + len; tt += rate, k++) osc.frequency.setValueAtTime(f * Math.pow(2, o.arp[k % o.arp.length] / 12), tt);
    }
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f * o.slide), t + len);
    if (o.vib && len > 0.18) {
      const lfo = s.ctx.createOscillator(), depth = s.ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * o.vib, t + Math.min(0.25, len * 0.6));
      lfo.connect(depth).connect(osc.frequency);
      s.run(lfo, t, end);
    }
    s.run(osc, t, end);
    osc.connect(env);
    s.out(env, bus, o.pan ?? 0, 0, o.echo ?? 0);
  }

  tri(bus: Bus, t: number, f: number, g: number, len: number, slideTo = 0): void {
    this.s.tone(bus, t, f, { type: 'triangle', g, a: 0.003, h: Math.max(0, len - 0.02), r: 0.03, glide: slideTo || undefined });
  }

  kick(bus: Bus, t: number, g: number): void {
    this.s.tone(bus, t, 190, { type: 'triangle', g, a: 0.001, r: 0.13, glide: 0.22 });
    this.s.noiseHit(bus, t, { type: 'lowpass', f: 900, g: g * 0.35, a: 0.001, r: 0.03, rate: 0.4 });
  }
  snare(bus: Bus, t: number, g: number, pan = 0): void {
    this.s.noiseHit(bus, t, { type: 'bandpass', f: 2200, q: 0.6, g, a: 0.001, r: 0.12, rate: 0.6, pan });
    this.s.tone(bus, t, 230, { type: 'triangle', g: g * 0.45, a: 0.001, r: 0.06, glide: 0.7 });
  }
  hat(bus: Bus, t: number, g: number, open = false, pan = 0): void {
    this.s.noiseHit(bus, t, { type: 'highpass', f: 7000, g, a: 0.001, r: open ? 0.14 : 0.025, pan });
  }
  crash(bus: Bus, t: number, g: number): void {
    this.s.noiseHit(bus, t, { type: 'highpass', f: 3000, g, a: 0.002, r: 0.9, rate: 0.7 });
  }
}

type Note = { semi: number; len: number };

/**
 * Writes an 8-bar melody for a style in phrases: A, A with a twist, B, A coming
 * home to the tonic. Strong beats land on chord tones; the notes between walk
 * the scale toward them.
 */
function writeMelody(style: Style, rhythmBank: Array<Array<[number, number]>>, low = 7, high = 21): Map<number, Note> {
  const out = new Map<number, Note>();
  const scaleUp = (from: number, steps: number) => {
    // move by scale steps from a semitone
    const sc = style.scale, n = sc.length;
    let oct = Math.floor(from / 12), idx = sc.findIndex((x) => x >= ((from % 12) + 12) % 12);
    if (idx < 0) { idx = 0; oct++; }
    idx += steps;
    oct += Math.floor(idx / n); idx = ((idx % n) + n) % n;
    return oct * 12 + sc[idx];
  };
  const nearestChordTone = (step: number, near: number) => {
    const chord = style.chordAt(step);
    let best = near, bestD = Infinity;
    for (let o = 0; o <= 2; o++) for (const c of chord) {
      const v = c + 12 * o;
      if (v < low || v > high) continue;
      const d = Math.abs(v - near);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  };
  const phrase = (bar0: number, rhythm: Array<[number, number]>, start: number, direction: number, home: boolean) => {
    let cur = start;
    for (let b = 0; b < 2; b++) {
      rhythm.forEach(([pos, len], k) => {
        const step = (bar0 + b) * 16 + pos;
        const strong = pos % 8 === 0 || len >= 4;
        const last = home && b === 1 && k === rhythm.length - 1;
        if (last) cur = nearestChordTone(step, 12);          // the tonic, to come home
        else if (strong) cur = nearestChordTone(step, cur + direction * 2);
        else cur = Math.max(low, Math.min(high, scaleUp(cur, Math.random() < 0.7 ? direction : -direction)));
        out.set(step, { semi: cur, len: last ? Math.max(len, 6) : len });
      });
      direction = Math.random() < 0.35 ? -direction : direction;
    }
    return cur;
  };
  const rA = pick(rhythmBank), rB = pick(rhythmBank.filter((r) => r !== rA)) ?? rA;
  const startA = nearestChordTone(0, 12 + (Math.random() < 0.5 ? 4 : 7));
  phrase(0, rA, startA, 1, false);
  // A again, the tail twisted
  phrase(2, rA, startA, Math.random() < 0.5 ? 1 : -1, false);
  phrase(4, rB, Math.min(high, startA + 5), -1, false);
  phrase(6, rA, startA, 1, true);
  return out;
}

const RHYTHMS: Array<Array<[number, number]>> = [
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]],
  [[0, 1], [2, 1], [3, 3], [6, 2], [8, 6], [14, 2]],
  [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]],
  [[0, 6], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
  [[0, 2], [3, 1], [4, 2], [6, 2], [8, 3], [11, 1], [12, 4]],
];

/** Shared bits of every chip style: the chip kit, a melody that renews, and a melody player. */
abstract class ChipStyle extends Style {
  protected chip: Chip;
  protected melody = new Map<number, Note>();
  protected abstract readonly rhythms: Array<Array<[number, number]>>;

  constructor(s: Synth, parent: Bus) {
    super(s, parent);
    this.chip = new Chip(s);
  }

  enter(): void { this.melody = writeMelody(this, this.rhythms); }

  /** Play the melody's note at this step (if one starts here). */
  protected sing(i: number, t: number, g: number, duty: 0.125 | 0.25 | 0.5, oct: number, o: { vib?: number; echo?: number; harmony?: number } = {}): void {
    const loopStep = i % (8 * 16);
    if (loopStep === 0 && i > 0 && Math.floor(i / (8 * 16)) % 2 === 0) this.melody = writeMelody(this, this.rhythms);
    const n = this.melody.get(loopStep);
    if (!n) return;
    const f = semis(this.root, n.semi, oct), len = n.len * this.stepDur * 0.92;
    this.chip.pulse(this.bus, t, f, g, len, duty, { vib: len > 0.2 ? o.vib ?? 0.012 : 0, echo: o.echo ?? 0.18, pan: 0.05 });
    if (o.harmony) {
      // a third or so under, on another channel
      const chord = this.chordAt(i).map((c) => c + 12);
      const under = chord.filter((c) => c < n.semi).pop() ?? n.semi - 5;
      this.chip.pulse(this.bus, t, semis(this.root, under, oct), g * o.harmony, len, 0.5, { pan: -0.25 });
    }
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.chip.pulse(this.bus, t, f * 2, g * 0.3, 0.05, 0.125, { pan, echo: 0.35 });
  }
}

// ── hills: the overworld ───────────────────────────────────────────────────
class Hills extends ChipStyle {
  readonly id = 'hills';
  readonly bpm = 148;
  readonly root = 32.7;                                                         // C
  readonly scale = [0, 2, 4, 5, 7, 9, 11];
  readonly chords = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];           // C Am F G
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.9;
  protected readonly rhythms = RHYTHMS;

  step(i: number, t: number, m: Mood): void {
    const c = this.chip, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const ch = this.tones(i, 2);
    // boom-chick bass with a walk up into the next chord
    if (pos === 0 || pos === 8) c.tri(b, t, ch[0], 0.2, this.stepDur * 3);
    if (pos === 4 || pos === 12) c.tri(b, t, ch[2] / 2 * (pos === 12 ? 1 : 1), 0.16, this.stepDur * 1.6);
    if (pos === 14) c.tri(b, t, this.tones(i + 2, 2)[0] * Math.pow(2, -2 / 12), 0.14, this.stepDur);
    // drums
    if (pos === 0 || pos === 8 || (pos === 10 && bar % 2)) c.kick(b, t, 0.2);
    if (pos === 4 || pos === 12) c.snare(b, t, 0.1);
    if (pos % 2 === 0) c.hat(b, t, pos % 4 === 2 ? 0.035 : 0.018);
    // chord chicks: a fast arpeggio on the offbeats
    if (pos === 4 || pos === 12) c.pulse(b, t, ch[0] * 4, 0.035, this.stepDur * 1.5, 0.125, { arp: [0, this.chordAt(i)[1] - this.chordAt(i)[0], this.chordAt(i)[2] - this.chordAt(i)[0]], pan: 0.3 });
    // the tune, with a harmony line on the second half of the loop
    this.sing(i, t, 0.075, 0.25, this.leadOct, { harmony: bar % 16 >= 8 ? 0.45 : 0 });
    if (m.tension > 0.5 && pos === 14) c.snare(b, t, 0.05, 0.2);
    if (bar % 8 === 7 && pos >= 12) c.snare(b, t, 0.04 + (pos - 12) * 0.015, -0.2);
  }
}

// ── sky: the airship march ─────────────────────────────────────────────────
class Sky extends ChipStyle {
  readonly id = 'sky';
  readonly bpm = 116;
  readonly root = 43.65;                                                        // F
  readonly scale = [0, 2, 4, 5, 7, 9, 11];
  readonly chords = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];           // F Dm Bb C
  readonly barsPerChord = 1;
  readonly leadOct = 3;
  readonly level = 0.75;
  protected readonly rhythms = [RHYTHMS[3], RHYTHMS[4], RHYTHMS[0], [[0, 4], [4, 4], [8, 3], [11, 1], [12, 4]] as Array<[number, number]>];

  step(i: number, t: number): void {
    const c = this.chip, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const ch = this.tones(i, 1);
    if (pos % 4 === 0) c.tri(b, t, pos % 8 === 0 ? ch[0] * 2 : ch[2], 0.2, this.stepDur * 3);
    if (pos === 0) c.kick(b, t, 0.18);
    if (pos === 8) c.kick(b, t, 0.12);
    // the snare march: a drag into beat 3, a roll to the bar line
    if (pos === 4 || pos === 12) c.snare(b, t, 0.09);
    if (pos === 11 || (pos >= 14 && bar % 2 === 1)) c.snare(b, t, 0.045);
    if (pos % 4 === 2) c.hat(b, t, 0.02);
    if (pos === 2 || pos === 10) c.pulse(b, t, this.tones(i, 3)[1], 0.03, this.stepDur * 1.6, 0.5, { pan: -0.3 });
    this.sing(i, t, 0.08, 0.25, this.leadOct + 1, { vib: 0.018, harmony: 0.4, echo: 0.12 });
    if (bar % 8 === 0 && pos === 0) c.crash(b, t, 0.03);
  }
}

// ── caves: underground ─────────────────────────────────────────────────────
class Caves extends ChipStyle {
  readonly id = 'caves';
  readonly bpm = 124;
  readonly root = 41.2;                                                         // E
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]];             // Em C D Em
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 1.1;
  protected readonly rhythms = [RHYTHMS[2], RHYTHMS[5], [[0, 1], [3, 1], [6, 2], [10, 1], [12, 3]] as Array<[number, number]>];

  step(i: number, t: number): void {
    const c = this.chip, b = this.bus, pos = i % 16;
    const r = this.tones(i, 1)[0];
    // a staccato ostinato: root, octave, fifth, flat seventh
    const riff = [1, 2, 1.5, 1.782, 1, 2, 1.5, 2][Math.floor(pos / 2)];
    if (pos % 2 === 0) c.tri(b, t, r * riff, 0.2, this.stepDur * 0.9);
    if (pos === 0 || pos === 10) c.kick(b, t, 0.15);
    if (pos === 4 || pos === 12) c.hat(b, t, 0.03, true, 0.3);
    if (pos % 4 === 2) c.pulse(b, t, this.tones(i, 4)[(pos / 2) % 3], 0.02, this.stepDur * 0.5, 0.125, { echo: 0.5, pan: 0.4 });
    this.sing(i, t, 0.06, 0.125, this.leadOct, { echo: 0.45, vib: 0.008 });
  }
}

// ── factory: the rush ──────────────────────────────────────────────────────
class Factory extends ChipStyle {
  readonly id = 'factory';
  readonly bpm = 168;
  readonly root = 36.71;                                                        // D
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]];           // Dm Bb C A
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.72;
  protected readonly rhythms = [RHYTHMS[1], RHYTHMS[3], RHYTHMS[5]];

  step(i: number, t: number, m: Mood): void {
    const c = this.chip, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const r = this.tones(i, 1)[0];
    // driving eighths with an octave kick on the offbeats
    if (pos % 2 === 0) c.tri(b, t, pos % 4 === 2 ? r * 2 : r, 0.2, this.stepDur * 1.7);
    if (pos === 0 || pos === 6 || pos === 8) c.kick(b, t, 0.2);
    if (pos === 4 || pos === 12) c.snare(b, t, 0.11);
    c.hat(b, t, pos % 2 ? 0.012 : 0.025);
    if (bar % 4 === 3 && pos >= 12) c.snare(b, t, 0.05 + (pos - 12) * 0.02, 0.15);
    // a wall of 32nd-note chord arps under everything
    if (pos % 4 === 0) {
      const ch = this.chordAt(i);
      c.pulse(b, t, semis(this.root, ch[0], 3), 0.028 + m.tension * 0.01, this.stepDur * 3.8, 0.125, { arp: [0, ch[1] - ch[0], ch[2] - ch[0], 12], arpRate: this.stepDur / 2, pan: -0.25 });
    }
    this.sing(i, t, 0.07, 0.5, this.leadOct, { vib: 0.01, harmony: bar % 8 >= 4 ? 0.35 : 0 });
    if (bar % 8 === 0 && pos === 0) c.crash(b, t, 0.035);
  }
}

// ── castle: the siege ──────────────────────────────────────────────────────
class Castle extends ChipStyle {
  readonly id = 'castle';
  readonly bpm = 138;
  readonly root = 27.5;                                                         // A
  readonly scale = [0, 2, 3, 5, 7, 8, 11];                                      // harmonic minor
  readonly chords = [[0, 3, 7], [5, 8, 12], [7, 11, 14], [0, 3, 7]];            // Am Dm E Am
  readonly barsPerChord = 1;
  readonly leadOct = 5;
  readonly level = 0.8;
  protected readonly rhythms = [[[0, 6], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 4], [12, 4]], RHYTHMS[4]] as Array<Array<[number, number]>>;

  step(i: number, t: number): void {
    const c = this.chip, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const r = this.tones(i, 2)[0];
    // a pedal that climbs chromatically into every fourth bar
    const climb = bar % 4 === 3 && pos >= 8 ? Math.pow(2, ((pos - 8) / 2) / 12) : 1;
    if (pos % 2 === 0) c.tri(b, t, r * climb, 0.2, this.stepDur * 1.5);
    if (pos === 0 || pos === 3 || pos === 8) c.kick(b, t, 0.18);
    if (pos === 4 || pos === 12) c.snare(b, t, 0.1);
    if (pos === 14 || pos === 15) c.snare(b, t, 0.04, -0.2);
    if (pos % 4 === 2) c.hat(b, t, 0.02);
    // an ominous diminished shimmer over the dominant
    if (pos === 0 && this.chordAt(i)[0] === 7) c.pulse(b, t, semis(this.root, 11, 4), 0.025, this.stepDur * 14, 0.125, { arp: [0, 3, 6, 9], arpRate: 1 / 24, pan: 0.3 });
    this.sing(i, t, 0.075, 0.25, this.leadOct - 1, { vib: 0.02, harmony: 0.4 });
    if (bar % 8 === 0 && pos === 0) c.crash(b, t, 0.04);
  }
}

// ── boss: the battle ───────────────────────────────────────────────────────
class BossBattle extends ChipStyle {
  readonly id = 'boss';
  readonly bpm = 176;
  readonly root = 30.87;                                                        // B
  readonly scale = [0, 2, 3, 5, 7, 8, 11];                                      // harmonic minor
  readonly chords = [[0, 3, 7], [-4, -1, 3], [-2, 1, 4], [-5, -1, 2]];          // Bm G A#dim F#
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.75;
  protected readonly rhythms = [RHYTHMS[1], RHYTHMS[5], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 3], [11, 3], [14, 2]] as Array<[number, number]>];

  step(i: number, t: number): void {
    const c = this.chip, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const r = this.tones(i, 1)[0];
    // a galloping bass: root, root, octave
    if (pos % 4 !== 3) c.tri(b, t, pos % 4 === 2 ? r * 2 : r, 0.2, this.stepDur * 0.9);
    if (pos % 4 === 0 || pos === 7 || pos === 14) c.kick(b, t, 0.2);
    if (pos === 4 || pos === 12) c.snare(b, t, 0.12);
    c.hat(b, t, pos % 2 ? 0.014 : 0.026);
    if (pos % 2 === 0) {
      const ch = this.chordAt(i);
      c.pulse(b, t, semis(this.root, ch[0], 4), 0.022, this.stepDur * 1.8, 0.125, { arp: [0, ch[1] - ch[0], ch[2] - ch[0], 12], arpRate: 1 / 60, pan: 0.3 });
    }
    this.sing(i, t, 0.075, 0.5, this.leadOct, { vib: 0.015, harmony: 0.45 });
    if (bar % 4 === 0 && pos === 0) c.crash(b, t, 0.04);
    if (bar % 4 === 3 && pos >= 8 && pos % 2 === 0) c.snare(b, t, 0.05 + (pos - 8) * 0.012, -0.2);
  }
}

const STYLES: StyleDef[] = [
  { id: 'hills', name: 'Green hills', make: (s, b) => new Hills(s, b) },
  { id: 'sky', name: 'Airship march', make: (s, b) => new Sky(s, b) },
  { id: 'caves', name: 'Underground', make: (s, b) => new Caves(s, b) },
  { id: 'factory', name: 'Factory rush', make: (s, b) => new Factory(s, b) },
  { id: 'castle', name: 'Castle siege', make: (s, b) => new Castle(s, b) },
  { id: 'boss', name: 'Boss battle', make: (s, b) => new BossBattle(s, b) },
];

export const RUSH_MUSIC: Array<[string, string]> = [
  ['world', 'Follow the world'], ['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name]),
];

const CALM = ['hills', 'sky', 'caves'];

class RushConductor extends Conductor {
  private kit: Chip;
  private rain: Bed;
  private gemCombo = 0;
  private gemAt = -9;
  private calmPick = 0;
  private calmAt = 0;
  private bossOn = false;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'pMusicStyle', rotateKey: 'pMusicRotate', musicGain: 0.55 });
    this.kit = new Chip(this.s);
    this.rain = this.s.rain(this.amb);
  }

  /** 'world': the tune follows the scene; otherwise the usual pin or rotation. */
  protected wanted(): string | null {
    const v = this.setting<string>('pMusicStyle');
    // a boss fight takes over the music whatever's pinned (unless a tune is pinned by hand)
    if (this.bossOn && (v === 'world' || v === 'rotate')) return 'boss';
    if (v !== 'world') return super.wanted();
    const night = this.mood?.night ?? 0;
    if (night > 0.72) return 'castle';
    if (night > 0.28) return 'factory';
    // calm: the overworld tunes take turns
    const now = this.s?.ctx.currentTime ?? 0;
    const minutes = Math.max(1, this.setting<number>('pMusicRotate') ?? 5);
    if (now - (this.calmAt ?? 0) > minutes * 60) { this.calmAt = now; this.calmPick = ((this.calmPick ?? 0) + 1) % CALM.length; }
    return CALM[this.calmPick ?? 0];
  }

  protected handover(t: number): void {
    // a little "stage change" run instead of a boom
    [0, 4, 7, 12].forEach((sm, k) => this.kit.pulse(this.sfxBus, t + k * 0.05, semis(this.cur.root, sm, 4), 0.03, 0.05, 0.25));
  }

  protected ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('pAmbience') : 0;
    this.setBed(this.rain, amb * (state.weather === 'storm' ? 0.12 : state.weather === 'hurricane' ? 0.06 : 0), now);
  }

  /** The hunter drone: a two-tone warning under the music while it's after us. */
  protected threatStep(i: number, t: number, g: number): void {
    if (i % 8 === 0) this.markHeart(t);
    if (!this.notes || i % 8 !== 0) return;
    const f = semis(this.cur.root, 12, 3);
    this.kit.pulse(this.sfxBus, t, (i / 8) % 2 ? f * 1.5 : f, 0.022 * g, this.cur.stepDur * 3, 0.125, { pan: 0.4 });
  }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.core;
    if (kind === 'allow') { this.playLead(srcIp, 0.05); return; }
    if (!st.deviceVoices || !this.notes) return;
    const k = this.kit, now = this.s.ctx.currentTime;
    if (kind === 'dhcp') {
      // a rival is coming: a little "ready?" chime, on the beat
      const t = this.slot('dhcp', 4, 1);
      if (t < 0) return;
      [0, 7].forEach((sm, j) => k.pulse(this.sfxBus, t + j * 0.08, semis(this.cur.root, sm + 12, 4), 0.035 * st.gDhcp, 0.07, 0.125, { pan: -0.3 }));
    } else if (kind === 'system') {
      // a power flicker: a falling buzz
      k.pulse(this.sfxBus, now + 0.01, 180, 0.03, 0.35, 0.5, { slide: 0.35 });
    }
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const st = this.core;
    if (!st.deviceVoices) return;
    const k = this.kit, bus = this.sfxBus, t = this.s.ctx.currentTime + 0.005, pan = opts.pan ?? 0;
    const key = (sm: number, oct: number) => semis(this.cur.root, sm, oct);
    const v = (this.setting<number>('pSfx') ?? 0.8) * 1.8;
    switch (name) {
      case 'jump': k.pulse(bus, t, key(0, 3) * 1.5, 0.05 * v, 0.14, 0.25, { slide: 2.2, pan }); break;
      case 'double': k.pulse(bus, t, key(7, 3) * 1.5, 0.05 * v, 0.12, 0.125, { slide: 2, pan }); k.pulse(bus, t + 0.05, key(12, 4), 0.03 * v, 0.08, 0.25, { slide: 1.5, pan }); break;
      case 'rivalJump': k.pulse(bus, t, key(5, 3) * 1.5, 0.014 * v, 0.1, 0.25, { slide: 2, pan }); break;
      case 'land': this.s.noiseHit(bus, t, { type: 'lowpass', f: 500, g: 0.03 * v, r: 0.04, rate: 0.3, pan }); break;
      case 'gem': {
        // coins climb the scale while you keep grabbing them
        this.gemCombo = t - this.gemAt < 0.7 ? Math.min(14, this.gemCombo + 1) : 0;
        this.gemAt = t;
        const deg = this.gemCombo;
        const sc = [0, 2, 4, 5, 7, 9, 11];
        const sm = sc[deg % 7] + 12 * Math.floor(deg / 7);
        k.pulse(bus, t, key(sm + 7, 5), 0.032 * v * st.gAllow, 0.045, 0.125, { pan });
        k.pulse(bus, t + 0.045, key(sm + 12, 5), 0.032 * v * st.gAllow, 0.12, 0.125, { pan, decay: 0.08 });
        break;
      }
      case 'stomp':
        k.pulse(bus, t, 700, 0.05 * v, 0.1, 0.5, { slide: 0.25, pan });
        this.s.noiseHit(bus, t, { type: 'bandpass', f: 1200, g: 0.04 * v, r: 0.06, pan });
        break;
      case 'query':
        k.tri(bus, t, key(0, 2), 0.14 * v, 0.06);
        [0, 4, 7, 12, 16].forEach((sm, j) => k.pulse(bus, t + 0.04 + j * 0.035, key(sm, 5), 0.028 * v * st.gDns, 0.04, 0.25, { pan }));
        break;
      case 'power':
        [0, 4, 7, 12, 4, 7, 12, 16, 7, 12, 16, 19].forEach((sm, j) => k.pulse(bus, t + j * 0.03, key(sm, 4), 0.035 * v, 0.035, 0.125, { pan }));
        break;
      case 'shieldPop':
        this.s.tone(bus, t, 500, { type: 'sine', g: 0.06 * v, a: 0.002, r: 0.12, glide: 2.5, pan });
        break;
      case 'brick':
        this.s.noiseHit(bus, t, { type: 'bandpass', f: 900, q: 0.5, g: 0.07 * v * st.gBlock, r: 0.16, rate: 0.35, pan });
        k.tri(bus, t, 110, 0.12 * v, 0.07, 55);
        break;
      case 'flag': {
        // a checkpoint fanfare on the next beat
        const at = Math.max(t, this.quant(4, 0.02));
        [[0, 0.08], [4, 0.08], [7, 0.08], [12, 0.32]].forEach(([sm, len], j) => k.pulse(bus, at + j * 0.09, key(sm, 4), 0.045 * v * st.gWifi, len, 0.25, { vib: 0.015, echo: 0.2 }));
        break;
      }
      case 'flagBroken': k.pulse(bus, t, key(7, 4), 0.04 * v * st.gWifi, 0.3, 0.5, { slide: 0.5 }); break;
      case 'hurt':
        k.pulse(bus, t, key(7, 4), 0.06 * v, 0.28, 0.5, { slide: 0.3, pan });
        for (let j = 0; j < 4; j++) k.pulse(bus, t + 0.05 + j * 0.04, key(12 + j * 2, 5), 0.015 * v, 0.03, 0.125, { pan: pan + (j - 1.5) * 0.3 });
        break;
      case 'bossStart': {
        this.bossOn = true;
        // a warning siren, three rises
        for (let j = 0; j < 3; j++) k.pulse(bus, t + j * 0.28, key(0, 4), 0.045 * v, 0.24, 0.5, { slide: 1.5 });
        break;
      }
      case 'bossEnd': this.bossOn = false; break;
      case 'bossSlam':
        k.tri(bus, t + 0.25, 80, 0.3 * v, 0.3, 30);
        this.s.noiseHit(bus, t + 0.25, { type: 'lowpass', f: 700, g: 0.12 * v, r: 0.35, rate: 0.4 });
        break;
      case 'bossHit':
        k.pulse(bus, t, key(12, 4), 0.07 * v, 0.2, 0.5, { slide: 0.4 });
        this.s.noiseHit(bus, t, { type: 'bandpass', f: 1500, g: 0.08 * v, r: 0.2 });
        break;
      case 'bossDown': {
        this.s.noiseHit(bus, t, { type: 'lowpass', f: 2500, fTo: 150, g: 0.16 * v, a: 0.002, r: 0.9, rate: 0.5 });
        // the victory fanfare on the next beat
        const at = Math.max(t + 0.5, this.quant(4, 0.3));
        [[0, 0.12], [0, 0.12], [0, 0.12], [4, 0.36], [2, 0.36], [4, 0.2], [7, 0.7]].reduce((when, [sm, len]) => {
          k.pulse(bus, when, key(sm + 12, 4), 0.05 * v, len * 0.9, 0.25, { vib: 0.015, echo: 0.2 });
          k.pulse(bus, when, key(sm + 7, 4), 0.025 * v, len * 0.9, 0.5);
          return when + len;
        }, at);
        break;
      }
      case 'rescue': k.pulse(bus, t, key(0, 3), 0.05 * v, 0.3, 0.25, { slide: 4 }); break;
      case 'rivalDash': this.s.noiseHit(bus, t, { type: 'bandpass', f: 800, fTo: 4000, g: 0.03 * v, r: 0.25, pan }); break;
      case 'bombDrop': k.pulse(bus, t, 1400, 0.02 * v * st.gThreat, 0.5, 0.125, { slide: 0.35, pan }); break;
      case 'boom':
        this.s.noiseHit(bus, t, { type: 'lowpass', f: 1800, fTo: 200, g: 0.12 * v * st.gThreat, a: 0.002, r: 0.45, rate: 0.5, pan });
        k.tri(bus, t, 150, 0.2 * v, 0.2, 40);
        break;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    if (this.s.busy(10) || !this.notes) return;
    const c = this.chordAt(when, 5);
    this.kit.pulse(this.sfxBus, when, pick(c), kind === 'block' || kind === 'threat' ? 0.012 : 0.008, 0.03, 0.125, { pan: (Math.random() - 0.5) * 1.4 });
  }
}

export function rushScore(e: AudioEngine): Score { return new RushConductor(e); }
