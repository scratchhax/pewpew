import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Synth } from '../../sound/synth';

/**
 * Last Outpost's soundtrack. Six styles take turns (or one is pinned):
 *
 *   horror synth    : a pulsing minor ostinato over a drone and cold bells
 *   lonely survivor : fingerpicked guitar and a detuned piano over the wind
 *   80s slasher     : driving octave bass, gated snare, a brass hook
 *   dark ambient    : drones, distant swells and scraping metal
 *   dead west       : banjo rolls, a bowed fiddle, boot stomps, slide guitar
 *   broken lullaby  : a warped music box in 3/4
 *
 * The compound's sounds are part of the band: shots, groans, radio chirps,
 * creaking doors and the generator are snapped to the beat and pitched to the
 * chord that's playing. Night (traffic weather) thickens the arrangement; a
 * horde brings a heartbeat and swells that land on the downbeat. The shared
 * clock, rotation and pulse live in sound/conductor.ts.
 */

// ── horror synth ───────────────────────────────────────────────────────────
class Carpenter extends Style {
  readonly id = 'carpenter';
  readonly bpm = 96;
  readonly root = 55;                                          // A
  readonly scale = [0, 2, 3, 5, 7, 8, 11];                     // harmonic minor
  readonly chords = [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]];   // Am F Dm E
  readonly barsPerChord = 2;
  readonly leadOct = 3;
  private motif: number[] = [];

  enter(): void { this.newMotif(); }
  private newMotif(): void {
    // five-note bell figure over chord tones, the last note held
    this.motif = Array.from({ length: 5 }, (_, i) => (i === 4 ? 0 : (Math.random() * 3) | 0));
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 2);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.pad(b, t, [tones[0] / 4, tones[0] / 2, tones[2] / 2], 0.035, hold, 380 + m.night * 500);
      if (m.night > 0.6) s.choir(b, t, this.tones(i, 2), 0.018 * m.night, hold);
      if (Math.floor(i / 16) % 8 === 0) this.newMotif();
    }
    // the ostinato: 16ths at night, 8ths by day; the filter opens with tension
    const pattern = [0, 1, 2, 1, 0, 1, 2, 3];
    if (m.night > 0.3 || pos % 2 === 0) {
      const k = pattern[pos % 8];
      const f = k === 3 ? tones[0] * 2 : tones[k];
      const cutoff = 650 + m.night * 900 + m.tension * 1600;
      const accent = pos % 4 === 0 ? 1 : 0.7;
      s.arp(b, t, f, (0.035 + m.night * 0.025) * accent, cutoff, pos % 2 ? 0.25 : -0.25);
    }
    if (m.night > 0.35 && pos % 4 === 0) s.bassPulse(b, t, tones[0] / 4, 0.09 + m.night * 0.05);
    // cold bell figure every other bar
    if (bar % 2 === 1 && [0, 3, 6, 10, 12].includes(pos)) {
      const n = [0, 3, 6, 10, 12].indexOf(pos);
      if (Math.random() < 0.55 + m.night * 0.3) s.bell(b, t, this.tones(i, 3)[this.motif[n]], 0.05, 0, 0.35);
    }
    // toms roll in as night falls
    if (m.night > 0.45 && pos === 8) s.tom(b, t, 90, 0.16);
    if (m.night > 0.8 && (pos === 14 || pos === 6)) s.tom(b, t, pos === 14 ? 120 : 75, 0.12, pos === 14 ? 0.3 : -0.3);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.8, pan, 0.4); }
}

// ── lonely survivor ────────────────────────────────────────────────────────
class Survivor extends Style {
  readonly id = 'survivor';
  readonly bpm = 72;
  readonly root = 36.71;                                       // D
  readonly scale = [0, 2, 3, 5, 7, 8, 10];                     // natural minor
  readonly chords = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];    // Dm Bb F C
  readonly barsPerChord = 2;
  readonly leadOct = 3;
  private phrases: number[][] = [];
  private phrase = 0;

  enter(): void {
    this.phrases = [this.newPhrase(), this.newPhrase(), this.newPhrase()];
  }
  /** Eight quarter-note slots of scale degrees (null = rest), shaped as an arc. */
  private newPhrase(): number[] {
    const out: number[] = [];
    let d = 4 + ((Math.random() * 3) | 0);
    for (let k = 0; k < 8; k++) {
      d += k < 4 ? pick([0, 1, 1, 2, -1]) : pick([0, -1, -1, -2, 1]);
      d = Math.max(0, Math.min(9, d));
      out.push(Math.random() < (k % 2 ? 0.45 : 0.2) ? -1 : d);
    }
    out[7] = -1;
    return out;
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const low = this.tones(i, 1), mid = this.tones(i, 2);
    if (this.isChordStart(i)) {
      if (m.night > 0.45) s.cello(b, t, low[0], 0.05 * m.night, this.barsPerChord * 16 * this.stepDur * 0.8, -0.2);
      if (i % (16 * this.barsPerChord * 2) === 0 && Math.random() < 0.5) {
        this.phrase = (this.phrase + 1) % this.phrases.length;
        if (Math.random() < 0.4) this.phrases[this.phrase] = this.newPhrase();
      }
    }
    // travis-style picking on 8ths: bass, then chord tones
    if (pos % 2 === 0) {
      const pat = [low[0], mid[2], mid[1], mid[2], low[2], mid[2], mid[1], mid[0] * 2];
      const bass = pos === 0 || pos === 8;
      s.pluck(b, t, pat[pos / 2], (bass ? 0.1 : 0.065) * (0.8 + m.night * 0.3), bass ? -0.15 : 0.25);
    }
    // the piano phrase on quarter notes
    if (pos % 4 === 0) {
      const slot = (Math.floor(i / 4)) % 8;
      const d = this.phrases[this.phrase][slot];
      if (d >= 0 && Math.random() < 0.8) s.piano(b, t, this.scaleTone(d, 3), 0.075, 0.1, 0.3);
    }
    // a music box glint now and then
    if (pos === 6 && Math.random() < 0.07) s.musicBox(b, t, this.tones(i, 4)[(Math.random() * 3) | 0], 0.03, 0.5);
    if (m.night > 0.8 && pos === 0 && Math.floor(i / 16) % 2 === 0) s.tom(b, t, 70, 0.14);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.piano(this.bus, t, f, g, pan, 0.4); }
}

// ── dark ambient ───────────────────────────────────────────────────────────
class Ambient extends Style {
  readonly id = 'ambient';
  readonly bpm = 60;
  readonly root = 34.65;                                       // C#
  readonly scale = [0, 1, 3, 5, 7, 8, 10];                     // phrygian
  readonly chords = [[0, 7, 15], [1, 8, 13], [0, 3, 10], [-4, 3, 8]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  private bed: ReturnType<Synth['drone']> | null = null;

  enter(t: number): void {
    this.bed = this.s.drone(this.bus, this.tones(0, 1));
    this.bed.level.gain.setTargetAtTime(0.06, t, 2);
  }
  exit(t: number): void {
    this.bed?.level.gain.setTargetAtTime(0, t, 1);
    this.bed?.stop(t + 5);
    this.bed = null;
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (this.isChordStart(i)) this.bed?.glide(this.tones(i, 1), t);
    if (pos === 0) this.bed?.level.gain.setTargetAtTime(0.05 + m.night * 0.04, t, 3);
    if (pos === 0 && Math.random() < 0.5) {
      s.swell(b, t, this.tones(i, 3 + (Math.random() < 0.4 ? 1 : 0))[(Math.random() * 3) | 0], 0.035, 7, (Math.random() - 0.5) * 1.2);
    }
    if (pos === 8 && Math.random() < 0.08 + m.night * 0.22) {
      s.scrape(b, t, 500 + Math.random() * 900, 0.12, (Math.random() - 0.5) * 1.6);
    }
    if (pos === 4 && Math.random() < 0.06) s.piano(b, t, this.tones(i, 2)[0], 0.05, -0.4, 0.5);
    if (m.night > 0.7 && pos === 0 && bar % 2 === 0) s.boom(b, t, 0.12 * m.night);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.glass(this.bus, t, f, g * 0.8, pan); }
}

// ── 80s slasher ────────────────────────────────────────────────────────────
class Slasher extends Style {
  readonly id = 'slasher';
  readonly bpm = 112;
  readonly root = 41.2;                                        // E
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]];   // Em C Am B
  readonly barsPerChord = 1;
  readonly leadOct = 3;
  private hook: number[] = [];

  enter(): void { this.newHook(); }
  private newHook(): void {
    // a four-note brass hook on chord tones, answered an octave down
    this.hook = Array.from({ length: 4 }, () => (Math.random() * 3) | 0);
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const bass = this.tones(i, 1)[0], mid = this.tones(i, 3);
    // the engine: eighth-note bass jumping octaves, sixteenths when it's dark
    if (pos % 2 === 0 || m.night > 0.5) {
      const up = pos % 4 === 2;
      s.bassPulse(b, t, up ? bass * 2 : bass, (pos % 2 ? 0.05 : 0.085) + m.night * 0.035);
    }
    if (this.isChordStart(i)) {
      s.pad(b, t, this.tones(i, 2), 0.02, 16 * this.stepDur * 0.9, 900 + m.tension * 1200);
      if (bar % 8 === 0) this.newHook();
    }
    // drums come in with the dusk
    if (m.night > 0.2 || bar % 2 === 1) {
      if (pos === 0 || pos === 8 || (m.night > 0.6 && pos === 10)) s.kick(b, t, 0.17);
      if (pos === 4 || pos === 12) s.snare(b, t, 0.075, 0.05);
      if (pos % 2 === 0) s.hat(b, t, pos % 4 === 2 ? 0.03 : 0.018, 0.35, pos === 14 && m.night > 0.6);
    }
    // brass hook every fourth bar
    if (bar % 4 === 3 && pos % 4 === 0) {
      s.sawLead(b, t, mid[this.hook[pos / 4]] / (pos === 12 ? 2 : 1), 0.035, 3 * this.stepDur, pos % 8 ? 0.3 : -0.3);
    }
    if (m.night > 0.7 && pos % 2 === 1) {
      s.arp(b, t, this.tones(i, 4)[(pos >> 1) % 3], 0.018, 1800 + m.tension * 1500, pos % 4 === 1 ? 0.5 : -0.5);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f, g * 0.5, 0.25, pan); }
}

// ── dead west ──────────────────────────────────────────────────────────────
class Frontier extends Style {
  readonly id = 'frontier';
  readonly bpm = 84;
  readonly root = 41.2;                                        // E
  readonly scale = [0, 2, 3, 5, 7, 9, 10];                     // dorian
  readonly chords = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];    // Em C G D
  readonly barsPerChord = 2;
  readonly leadOct = 3;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const low = this.tones(i, 2), high = this.tones(i, 3);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur * 0.85;
      s.fiddle(b, t, low[0], 0.06, hold, -0.35);
      if (m.night > 0.4) s.fiddle(b, t + 0.2, low[2], 0.035 * m.night, hold * 0.8, 0.35);
    }
    // a forward roll on the banjo: sparse by day, full at night
    const roll = [low[0], high[0], high[1], low[2], high[2], high[0], high[1], high[2]];
    if (pos % 2 === 0 && (m.night > 0.3 || pos % 4 === 0 || Math.random() < 0.4)) {
      s.banjo(b, t, roll[pos / 2], pos === 0 ? 0.085 : 0.055, pos % 4 === 0 ? -0.1 : 0.3);
    }
    // boots on the porch
    if (pos === 0 || pos === 8) s.stomp(b, t, 0.14 + m.night * 0.06);
    if (m.night > 0.6 && (pos === 6 || pos === 14)) s.stomp(b, t, 0.07);
    // a lonesome slide phrase now and then
    if (pos === 12 && Math.floor(i / 16) % 4 === 3 && Math.random() < 0.7) {
      s.slide(b, t, this.scaleTone(4 + ((Math.random() * 3) | 0), 3), 0.05, 0.2);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.slide(this.bus, t, f, g * 0.8, pan); }
}

// ── broken lullaby ─────────────────────────────────────────────────────────
class Lullaby extends Style {
  readonly id = 'lullaby';
  readonly bpm = 76;
  readonly barSteps = 12;                                      // 3/4
  readonly root = 32.7;                                        // C
  readonly scale = [0, 2, 3, 5, 7, 8, 11];                     // harmonic minor
  readonly chords = [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]];   // Cm Ab Fm G
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  private tune: number[] = [];
  private warpPhase = Math.random() * 10;

  enter(): void { this.newTune(); }
  /** Two bars of 3/4 in eighths (6 slots each): a rocking lullaby line, -1 = rest. */
  private newTune(): void {
    const t: number[] = [];
    let d = 7 + ((Math.random() * 3) | 0);
    for (let k = 0; k < 12; k++) {
      if (k % 6 === 0) d = 7 + pick([0, 2, 4]);
      else d += pick([-1, -1, 1, 2, -2, 0]);
      d = Math.max(4, Math.min(12, d));
      t.push(k % 6 === 5 || (k % 2 === 1 && Math.random() < 0.35) ? -1 : d);
    }
    this.tune = t;
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 12, bar = Math.floor(i / 12);
    // the tape wanders: a slow wow, deeper when the night gets bad
    this.warpPhase += this.stepDur * 0.35;
    const warp = Math.sin(this.warpPhase) * (10 + m.night * 22) + Math.sin(this.warpPhase * 2.7) * 5;
    if (this.isChordStart(i)) {
      s.glass(b, t, this.tones(i, 3)[0], 0.02, 0);
      if (bar % 8 === 0) this.newTune();
    }
    // oom-pah-pah low music box
    if (pos % 4 === 0) {
      const low = this.tones(i, 3);
      s.warpedBox(b, t, pos === 0 ? low[0] / 2 : low[1 + (pos / 4) % 2] / 2, pos === 0 ? 0.05 : 0.03, warp, pos === 0 ? -0.2 : 0.2);
    }
    // the tune on eighths
    if (pos % 2 === 0) {
      const d = this.tune[((bar % 2) * 6) + pos / 2];
      if (d >= 0) s.warpedBox(b, t, this.scaleTone(d, 4), 0.055, warp, 0.15);
    }
    if (m.night > 0.5 && pos === 6 && Math.random() < 0.3) s.whisper(b, t, 0.03 * m.night, (Math.random() - 0.5) * 1.6);
    if (m.night > 0.75 && pos === 0 && bar % 4 === 0) s.swell(b, t, this.tones(i, 2)[0], 0.03, 5);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.warpedBox(this.bus, t, f, g * 0.7, 0, pan); }
}

// ── the conductor ──────────────────────────────────────────────────────────
const STYLES: StyleDef[] = [
  { id: 'carpenter', name: 'Horror synth', make: (s, b) => new Carpenter(s, b) },
  { id: 'survivor', name: 'Lonely survivor', make: (s, b) => new Survivor(s, b) },
  { id: 'slasher', name: '80s slasher', make: (s, b) => new Slasher(s, b) },
  { id: 'ambient', name: 'Dark ambient', make: (s, b) => new Ambient(s, b) },
  { id: 'frontier', name: 'Dead west', make: (s, b) => new Frontier(s, b) },
  { id: 'lullaby', name: 'Broken lullaby', make: (s, b) => new Lullaby(s, b) },
];

export const MUSIC_STYLES: Array<[string, string]> = [['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name])];

class ZombieConductor extends Conductor {
  private wind: Bed;
  private rain: Bed;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'zMusicStyle', rotateKey: 'zMusicRotate' });
    this.wind = this.s.wind(this.amb);
    this.rain = this.s.rain(this.amb);
  }

  protected ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('zAmbience') : 0;
    const wet = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.wind, amb * (0.28 + this.mood.night * 0.3), now);
    this.setBed(this.rain, amb * wet * 0.22, now);
  }

  /** While a horde attacks: a heartbeat on the beat, a swell into every fourth bar. */
  protected threatStep(i: number, t: number, g: number): void {
    const bars4 = this.cur.barSteps * 4;
    if (i % 8 === 0) { this.s.heart(this.sfxBus, t, 0.11 * g); this.markHeart(t); }
    if (i % bars4 === bars4 / 2) this.s.riser(this.sfxBus, t, (bars4 / 2) * this.cur.stepDur, 0.03 * g);
    if (i % bars4 === 0 && i > 0) this.s.boom(this.sfxBus, t, 0.06 * g);
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
        if (Math.random() >= st.gateDns * 0.35) return;
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
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('arrive', 4, 1.5);
        if (t < 0) return;
        // someone made it in: a gentle strummed chord of whatever's playing
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
      if (this.setting<number>('zGunfire') <= 0) return;
      this.bumpTension(0.02);
      // rounds land on the 32nd grid, so a brute's burst becomes a drum roll
      for (let n = 0; n < Math.min(4, opts.count ?? 1); n++) {
        const t = this.slot('shot', 0.5, 0.3);
        if (t < 0) return;
        const ring = this.chordAt(t, 4)[pick([0, 1, 2])];
        s.gunshot(this.sfxBus, t, 0.2 * this.setting<number>('zGunfire') * (n ? 0.8 : 1), pan, ring);
      }
    } else if (name === 'breach') {
      const t = this.slot('breach', 1, 0.4);
      if (t < 0) return;
      s.boom(this.sfxBus, t, 0.1 * st.gBlock);
      const f = this.chordAt(t, 3)[0];
      for (const [m, g, r] of [[1, 0.06, 1.4], [2.43, 0.04, 0.9], [3.87, 0.03, 0.6], [5.61, 0.02, 0.35]] as const) {
        s.tone(this.sfxBus, t, f * m, { g: g * st.gBlock, a: 0.002, r, pan, rev: 0.6 });
      }
    }
  }

  /** Noise gate (raw feed): small versions of the compound's sounds. */
  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const chord = this.chordAt(when, 3);
    switch (kind) {
      case 'block': case 'threat':
        s.gunshot(this.sfxBus, when, 0.25 * this.setting<number>('zGunfire') * st.gBlock, pan, chord[0] * 2);
        break;
      case 'dns':
        s.chirp(this.sfxBus, when, chord[0] * 4, chord[1] * 4, 0.02 * st.gDns, pan);
        break;
      default:
        s.pluck(this.sfxBus, when, pick(chord), 0.04 * (kind === 'allow' ? st.gAllow : kind === 'wifi' ? st.gWifi : st.gDhcp), pan);
    }
  }
}

export function zombieScore(e: AudioEngine): Score { return new ZombieConductor(e); }
