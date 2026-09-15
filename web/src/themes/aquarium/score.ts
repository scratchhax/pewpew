import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed } from '../../sound/synth';

/**
 * The aquarium's soundtrack: slow, warm and a little wet.
 *
 *   lagoon     : 80 bpm lounge, soft electric piano chords, a round bass, a rim click
 *   tidepool   : 96 bpm bossa, plucked marimba-ish patterns and a shaker
 *   kelp dub   : 70 bpm dub, echoing chord stabs, a deep sub and a lazy snare
 *   the abyss  : 58 bpm, pads, glass notes and a far-off choir
 *
 * The tank plays along: bubbles blip in key as they rise and pop, a school
 * swishes past, a puffer inflates with a swelling tone, the shark brings a low
 * cello and a slow heartbeat, a new resident gets a glass chime, the chest
 * creaks open (or bangs shut), and the light dims with a sinking tone. The
 * pump hums and the water moves underneath.
 */

class Lagoon extends Style {
  readonly id = 'lagoon';
  readonly bpm = 80;
  readonly root = 36.71;                                    // D
  readonly scale = [0, 2, 4, 7, 9, 11];
  readonly chords = [[0, 4, 11], [-3, 3, 7], [5, 9, 16], [2, 5, 12]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.9;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (pos === 0 || pos === 10) s.kick(b, t, 0.08);
    if (pos === 4 || pos === 12) s.noiseHit(b, t, { type: 'bandpass', f: 1900, q: 3, g: 0.03, r: 0.05, pan: 0.2, rev: 0.3 });
    if (pos % 4 === 2) s.hat(b, t, 0.006, -0.3);
    if (this.isChordStart(i) || (i % 32 === 22)) for (const f of this.tones(i, 3)) s.piano(b, t, f, 0.016, (f % 3) - 1, 0.25);
    if (pos === 0 || pos === 7 || pos === 10) s.tone(b, t, this.tones(i, 1)[pos === 7 ? 2 : 0], { g: 0.07, a: 0.01, h: 0.2, r: 0.4, lp: 500 });
    if (m.night > 0.3 && pos % 8 === 6) s.pluck(b, t, pick(this.tones(i, 4)), 0.01, 0.4, 0.5);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.45, pan, 0.4); }
}

class Tidepool extends Style {
  readonly id = 'tidepool';
  readonly bpm = 96;
  readonly root = 43.65;                                    // F
  readonly scale = [0, 2, 4, 5, 7, 9];
  readonly chords = [[0, 4, 9], [2, 5, 9], [-1, 2, 7], [0, 4, 7]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.8;
  private pattern: number[] = [];

  enter(): void { this.newPattern(); }
  private newPattern(): void { this.pattern = Array.from({ length: 16 }, (_, k) => ([0, 3, 6, 10, 12].includes(k) || Math.random() < 0.15 ? Math.floor(Math.random() * 3) : -1)); }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 && bar % 4 === 0) this.newPattern();
    // bossa: bass on 1 and the "and" of 2, rim on the clave
    if (pos === 0 || pos === 6) s.tone(b, t, this.tones(i, 1)[pos ? 2 : 0], { g: 0.07, a: 0.01, h: 0.15, r: 0.3, lp: 600 });
    if ([0, 3, 6, 10, 12].includes(pos)) s.noiseHit(b, t, { type: 'bandpass', f: 2400, q: 4, g: 0.018, r: 0.04, pan: -0.25 });
    s.hat(b, t, pos % 2 ? 0.004 : 0.007, 0.35);
    const n = this.pattern[pos];
    if (n >= 0) s.pluck(b, t, this.tones(i, 3)[n] * (pos > 8 ? 2 : 1), 0.02, pos % 2 ? 0.3 : -0.3, 0.35);
    if (this.isChordStart(i)) s.pad(b, t, this.tones(i, 2), 0.006 + m.night * 0.004, this.barsPerChord * 16 * this.stepDur * 0.8, 900);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.musicBox(this.bus, t, f, g * 0.4, pan); }
}

class KelpDub extends Style {
  readonly id = 'dub';
  readonly bpm = 70;
  readonly root = 41.2;                                     // E
  readonly scale = [0, 3, 5, 7, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.85;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (pos === 0) s.kick(b, t, 0.1);
    if (pos === 8) s.snare(b, t, 0.025, 0.1);
    if (pos === 4 || pos === 12) for (const f of this.tones(i, 3)) s.tone(b, t, f, { type: 'square', g: 0.008, a: 0.005, h: 0.05, r: 0.15, lp: 1800, pan: 0.3, echo: 0.7, rev: 0.3 });
    if (pos % 4 === 2) s.hat(b, t, 0.005, -0.3);
    if (pos === 0 || pos === 3 || pos === 11) s.tone(b, t, this.tones(i, 1)[0], { g: 0.1, a: 0.01, h: 0.25, r: 0.3, lp: 220 });
    if (m.night > 0.4 && pos === 14) s.noiseHit(b, t, { type: 'bandpass', f: 800, fTo: 2400, q: 5, g: 0.012, a: 0.1, r: 0.6, echo: 0.6 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.pluck(this.bus, t, f, g * 0.6, pan, 0.5); }
}

class Abyss extends Style {
  readonly id = 'abyss';
  readonly bpm = 58;
  readonly root = 34.65;                                    // C#
  readonly scale = [0, 2, 3, 7, 8];
  readonly chords = [[0, 7, 15], [-4, 3, 12], [-2, 5, 14], [-5, 3, 10]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 1;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const hold = this.barsPerChord * 16 * this.stepDur;
    if (this.isChordStart(i)) {
      s.pad(b, t, this.tones(i, 2), 0.009, hold * 0.8, 600 + m.night * 500);
      s.tone(b, t, this.tones(i, 1)[0], { g: 0.05, a: 2, h: hold * 0.6, r: 3, lp: 300 });
    }
    if (i % 32 === 16 && Math.random() < 0.6) s.choir(b, t, this.tones(i, 3), 0.004, hold * 0.35);
    if (pos === 6 || (pos === 13 && Math.random() < 0.5)) s.glass(b, t, pick(this.tones(i, 4)), 0.008, (Math.random() - 0.5) * 0.8);
    if (pos === 0 && i % 64 === 0) s.tom(b, t, 60, 0.03, 0);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.glass(this.bus, t, f, g * 0.35, pan); }
}

const STYLES: StyleDef[] = [
  { id: 'lagoon', name: 'Lagoon', make: (s, b) => new Lagoon(s, b) },
  { id: 'tidepool', name: 'Tidepool', make: (s, b) => new Tidepool(s, b) },
  { id: 'dub', name: 'Kelp dub', make: (s, b) => new KelpDub(s, b) },
  { id: 'abyss', name: 'The abyss', make: (s, b) => new Abyss(s, b) },
];

export const AQUARIUM_MUSIC: Array<[string, string]> = [['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name])];

class TankConductor extends Conductor {
  private hum: Bed;
  private water: Bed;
  private fizz: Bed;
  private blipT = 0;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'qMusicStyle', rotateKey: 'qMusicRotate', musicGain: 1.7 });
    this.s.budget = 160;
    this.hum = this.s.drone(this.amb, [55, 82.4, 110]);
    this.water = this.s.wind(this.amb);
    this.fizz = this.s.rain(this.amb);
  }

  protected ambience(dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('qAmbience') : 0;
    const rough = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.hum, amb * 0.012, now);
    this.setBed(this.water, amb * (0.05 + rough * 0.08), now);
    this.setBed(this.fizz, amb * 0.004, now);
    // the air stone: a few soft blips now and then
    this.blipT -= dt;
    if (amb > 0 && this.blipT <= 0) {
      this.blipT = 0.4 + Math.random() * 1.8;
      const t = now + 0.02;
      this.s.tone(this.sfxBus, t, 500 + Math.random() * 700, { g: 0.006 * amb, a: 0.002, r: 0.05, glide: 1.7, pan: -0.5 + (Math.random() - 0.5) * 0.3 });
    }
  }

  protected threatStep(i: number, t: number, g: number): void {
    if (i % 16 === 0) { this.s.heart(this.sfxBus, t, 0.05 * g); this.markHeart(t); }
  }

  cue(kind: Cue, srcIp?: string): void {
    if (kind === 'allow') { this.playLead(srcIp, 0.05); return; }
    if (kind === 'block') this.bumpTension(0.03);
    else if (kind === 'threat') this.bumpTension(0.2);
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const s = this.s, st = this.core, fx = this.setting<number>('qSfx');
    if (!st.deviceVoices || fx <= 0) return;
    const pan = Math.max(-0.9, Math.min(0.9, opts.pan ?? 0));
    const now = s.ctx.currentTime + 0.02;
    switch (name) {
      case 'bubble': {
        if (Math.random() >= st.gateDns) return;
        const t = this.slot('bubble', 1, 0.4);
        if (t < 0) return;
        const c = this.notes ? this.chordAt(t, 5) : [880, 1100, 1320];
        for (let k = 0; k < 3; k++) s.tone(this.sfxBus, t + k * 0.07, c[k % c.length], { g: 0.012 * fx * st.gDns, a: 0.003, r: 0.09, glide: 1.25, pan, rev: 0.4 });
        return;
      }
      case 'pop':
        if (Math.random() < 0.5) s.tone(this.sfxBus, now, 900 + Math.random() * 900, { g: 0.004 * fx, a: 0.001, r: 0.03, glide: 1.9, pan });
        return;
      case 'school':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 500, fTo: 1600, q: 1.2, g: 0.018 * fx * st.gAllow, a: 0.4, h: 0.3, r: 0.9, pan, rev: 0.4 });
        return;
      case 'puffer':
        s.noiseHit(this.sfxBus, now, { type: 'lowpass', f: 500, g: 0.02 * fx * st.gBlock, a: 0.2, r: 0.6, pan, rev: 0.3 });
        return;
      case 'puff': {
        if (Math.random() >= st.gateBlock) return;
        s.tone(this.sfxBus, now, 140, { type: 'triangle', g: 0.05 * fx * st.gBlock, a: 0.5, h: 0.3, r: 0.4, glide: 2.2, lp: 900, pan, rev: 0.4 });
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 300, fTo: 900, q: 2, g: 0.03 * fx * st.gBlock, a: 0.6, r: 0.5, pan });
        return;
      }
      case 'deflate':
        s.tone(this.sfxBus, now, 300, { type: 'triangle', g: 0.025 * fx * st.gBlock, a: 0.05, h: 0.4, r: 0.6, glide: 0.4, lp: 700, pan, rev: 0.3 });
        return;
      case 'shark': {
        const f = this.notes ? this.chordAt(now, 1)[0] : 55;
        s.cello(this.sfxBus, now, f, 0.04 * fx * st.gThreat, 3.5, pan);
        s.cello(this.sfxBus, now + 0.8, f * 1.06, 0.03 * fx * st.gThreat, 2.5, pan);
        return;
      }
      case 'resident': {
        if (!this.notes || Math.random() >= st.gateDhcp) return;
        const t = this.slot('resident', 2, 0.6);
        if (t < 0) return;
        this.chordAt(t, 5).forEach((f, k) => s.glass(this.sfxBus, t + k * 0.12, f, 0.01 * fx * st.gDhcp, pan));
        return;
      }
      case 'chest-open':
        s.creak(this.sfxBus, now, 190, 0.05 * fx * st.gWifi, pan, 1.6);
        if (this.notes && Math.random() < st.gateWifi) this.chordAt(now + 0.6, 5).forEach((f, k) => s.bell(this.sfxBus, now + 0.6 + k * 0.1, f, 0.01 * fx * st.gWifi, pan, 0.4));
        return;
      case 'chest-slam':
        s.creak(this.sfxBus, now, 260, 0.03 * fx * st.gWifi, pan, 0.6);
        s.tom(this.sfxBus, now + 0.35, 90, 0.08 * fx * st.gWifi, pan);
        s.noiseHit(this.sfxBus, now + 0.35, { type: 'lowpass', f: 700, g: 0.04 * fx * st.gWifi, r: 0.5, pan, rev: 0.4 });
        return;
      case 'dim':
        s.tone(this.sfxBus, now, 330, { g: 0.03 * fx, a: 0.2, h: 0.3, r: 1.4, glide: 0.5, lp: 1200, rev: 0.6 });
        return;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    if (kind === 'block' || kind === 'threat') s.noiseHit(this.sfxBus, when, { type: 'lowpass', f: 400, g: 0.01 * st.gBlock, a: 0.01, r: 0.1, pan });
    else if (this.notes) s.tone(this.sfxBus, when, pick(this.chordAt(when, 5)), { g: 0.003 * (kind === 'allow' ? st.gAllow : st.gDns), a: 0.002, r: 0.06, glide: 1.3, pan });
  }
}

export function aquariumScore(e: AudioEngine): Score { return new TankConductor(e); }
