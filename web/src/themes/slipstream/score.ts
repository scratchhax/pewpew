import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, type Mood, type StyleDef } from '../../sound/conductor';

/**
 * SLIPSTREAM's soundtrack: 16-bit race-pop played by a band, not a bleeper.
 *
 *   grand prix   : 164 bpm shuffle — claps on the backbeat, a walking bass,
 *                  off-beat brass stabs and a bell hook over the top
 *   sunset drift : 138 bpm cruise — muted guitar comp, horn pad, organ
 *   rainbow      : 176 bpm sprint — supersaw lead over four on the floor,
 *                  glass arpeggio riding the bar
 *
 * Every style states a HOOK: a short phrase keyed to the bar, so there is
 * something to remember. Both of the originals were a drum machine and one
 * chip voice playing root notes, which is why nothing stuck.
 *
 * On top: the start-lights beeps, the pit radio blip, the shell's screaming
 * fly-past, spin-out slides, lap chimes — and a square-wave engine purr
 * whose pitch rides the hero's speed.
 */

class GrandPrix extends Style {
  readonly id = 'green';
  readonly bpm = 164;
  readonly root = 43.65;                                     // F
  readonly scale = [0, 2, 4, 5, 7, 9, 11];
  readonly chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9]];
  readonly barsPerChord = 1;
  readonly leadOct = 5;
  readonly level = 0.62;

  /** The hook: scale degrees per sixteenth, -1 for a rest. Two bars long. */
  private static readonly HOOK = [
    4, -1, 2, -1, 0, -1, 2, 4, -1, -1, 5, -1, 4, -1, 2, -1,
    0, -1, -1, 2, 4, -1, 7, -1, 5, -1, 4, 2, -1, -1, -1, -1,
  ];

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const ch = this.chordAt(i);

    // shuffled backbeat: kick on 1 and the and-of-3, claps on 2 and 4
    if (pos === 0 || pos === 6 || pos === 10) s.kick(b, t, pos === 0 ? 0.16 : 0.1);
    if (pos === 4 || pos === 12) {
      s.snare(b, t, 0.055, pos === 12 ? 0.25 : -0.25);
      s.stomp(b, t, 0.03);                                   // handclap layer
    }
    if (pos % 2 === 1) s.hat(b, t, 0.012, pos % 4 ? 0.4 : -0.4, pos === 15);

    // walking bass: root, fifth, octave, and a chromatic lead-in to the turn
    if (pos % 2 === 0) {
      const deg = [0, 0, 2, 0, 1, 0, 2, 1][pos >> 1];
      const f = semisOf(this.root, ch[deg % ch.length], 1) * (pos === 14 ? 2 : 1);
      s.guitar(b, t, f, 0.05, true, -0.2);
      if (pos === 0 || pos === 8) s.chip(b, t, f, 0.022, this.stepDur * 1.6, -0.35);
    }

    // brass stabs on the off-beats, the sound of a kart racer's chorus
    if (pos === 2 || pos === 7 || pos === 11) {
      const g = pos === 7 ? 0.03 : 0.022;
      for (const n of ch) s.brass(b, t, semisOf(this.root, n, 3), g, this.stepDur * 1.4, pos === 7 ? 0.3 : -0.3);
    }

    // the hook, on bells, two bars long
    const hk = GrandPrix.HOOK[i % 32];
    if (hk >= 0) s.bell(b, t, this.scaleTone(hk, 5), 0.028, 0.15, 0.25);

    // crash over the turn into a new chord
    if (this.isChordStart(i)) s.crash(b, t, 0.03, 0.2, 0.9);
    if (m.tension > 0.45 && pos === 14) s.zap(b, t, this.scaleTone(7, 5), 0.016, 0.5);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.bell(this.bus, t, f, g * 1.1, pan);
  }
}

class Rainbow extends Style {
  readonly id = 'rainbow';
  readonly bpm = 176;
  readonly root = 49;                                        // G
  readonly scale = [0, 2, 4, 7, 9, 11];
  readonly chords = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]];
  readonly barsPerChord = 1;
  readonly leadOct = 5;
  readonly level = 0.55;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const ch = this.chordAt(i);
    if (pos % 4 === 0) s.kick(b, t, 0.15);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.05, 0);
    if (pos % 2 === 1) s.hat(b, t, 0.011, pos % 4 ? 0.45 : -0.45);
    if (pos % 2 === 0) s.reese(b, t, semisOf(this.root, ch[0], 1), 0.03, this.stepDur * 1.8);
    // glass arpeggio climbing the chord across the bar
    s.glass(b, t, semisOf(this.root, ch[pos % ch.length], 4 + ((pos >> 2) & 1)), 0.012, ((pos / 15) * 2 - 1) * 0.6);
    if (pos === 0 || pos === 8) {
      for (const n of ch) s.supersaw(b, t, semisOf(this.root, n, 3), 0.018, this.stepDur * 6, 0.2);
    }
    if (m.tension > 0.5 && pos === 6) s.crash(b, t, 0.022, -0.4, 0.7);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.supersaw(this.bus, t, f, g * 0.9, 0.2, pan);
  }
}

class SunsetDrift extends Style {
  readonly id = 'sunset';
  readonly bpm = 138;
  readonly root = 32.7;                                      // C
  readonly scale = [0, 2, 3, 5, 7, 10];
  readonly chords = [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 10, 14]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.55;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const ch = this.chordAt(i);
    if (pos % 8 === 0) s.kick(b, t, 0.12);
    if (pos % 8 === 4) s.tom(b, t, 110, 0.05, 0.2);
    if (pos % 4 === 2) s.hat(b, t, 0.01, 0.4);
    // muted guitar comp on the off-beats: the cruise
    if (pos % 4 === 3) for (const n of ch) s.guitar(b, t, semisOf(this.root, n, 3), 0.016, true, 0.3);
    // bass walks the chord instead of sitting on the root
    if (pos % 4 === 0) s.guitar(b, t, semisOf(this.root, ch[(pos >> 2) % ch.length], 1), 0.045, false, -0.25);
    if (pos === 0) s.organ(b, t, semisOf(this.root, ch[0], 3), 0.026, this.stepDur * 14, -0.3);
    if (pos === 8) s.horn(b, t, semisOf(this.root, ch[2], 3), 0.02, 0.35);
    if (pos === 6 || pos === 10) s.glass(b, t, semisOf(this.root, ch[2], 5), 0.01, 0.4);
    if (m.tension > 0.5 && pos === 12) s.snare(b, t, 0.03, 0);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.piano(this.bus, t, f, g * 1.2, pan);
  }
}

/** A frequency `n` semitones above the tonic, `oct` octaves up. */
const semisOf = (root: number, n: number, oct: number): number => root * Math.pow(2, oct + n / 12);

const STYLES: StyleDef[] = [
  { id: 'green', name: 'Grand prix — brass and bells', make: (s, bus) => new GrandPrix(s, bus) },
  { id: 'sunset', name: 'Sunset drift — cruising', make: (s, bus) => new SunsetDrift(s, bus) },
  { id: 'rainbow', name: 'Rainbow — supersaw sprint', make: (s, bus) => new Rainbow(s, bus) },
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
