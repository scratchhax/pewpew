import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Bus } from '../../sound/synth';

/**
 * The Rain's soundtrack: weather, not rhythm. Three styles that follow the
 * traffic instead of a clock, all built from water droplets, low drones and
 * distant thunder:
 *
 *   drizzle (calm)      : no beat. A soft drone, sparse high droplets, one
 *                         piano note every few bars, hiss barely there.
 *   shower  (storm)     : the pulse arrives - a sub-thump every few bars,
 *                         a cello under the droplets, thunder testing far off.
 *   deluge  (hurricane) : the sky opens: a low pulse every bar, risers,
 *                         choir swells, the rain bed full.
 *
 * The weather is the traffic, so the music follows the weather. Event sounds
 * are hydrology: DNS is a droplet, a block is distant thunder, a threat is
 * lightning - crack first, rumble after.
 */

// ── drizzle ──────────────────────────────────────────────────────────────────
class Drizzle extends Style {
  readonly id = 'drizzle';
  readonly bpm = 54;
  readonly root = 55;                                             // A1
  readonly scale = [0, 2, 3, 5, 7, 8, 10];                        // natural minor
  readonly chords = [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [0, 3, 7]];
  readonly barsPerChord = 8;
  readonly leadOct = 5;
  readonly level = 1.1;
  private dropT = 3;
  private noteT = 7;

  enter(): void { this.dropT = 3; this.noteT = 7; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const tones = this.tones(i, 1);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.pad(b, t, tones.map((f) => f * 2), 0.02, hold * 0.95, 420);
      s.tone(b, t, tones[0], { g: 0.045, a: 2.5, h: hold * 0.7, r: 3, lp: 140 });
    }
    // droplets: high, wet, echoing off the tiles
    this.dropT -= this.stepDur;
    if (this.dropT <= 0 && pos % 2 === 0) {
      const c = this.tones(i, 5);
      s.pluck(b, t, c[pick([1, 2])] * 2, 0.02 + m.night * 0.008, (Math.random() - 0.5) * 1.4, 0.6);
      this.dropT = 2.5 + Math.random() * 5;
    }
    // one piano note, then a long pause, like the pause between drops
    this.noteT -= this.stepDur;
    if (this.noteT <= 0 && pos % 2 === 0) {
      s.piano(b, t, this.scaleTone(pick([0, 2, 4, 7]), 5), 0.024, (Math.random() - 0.5) * 1.2, 0.45);
      this.noteT = 10 + Math.random() * 12;
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.pluck(this.bus, t, f * 2, g * 0.8, pan, 0.5); }
}

// ── shower ───────────────────────────────────────────────────────────────────
class Shower extends Style {
  readonly id = 'shower';
  readonly bpm = 66;
  readonly root = 55;
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [0, 3, 7]];
  readonly barsPerChord = 4;
  readonly leadOct = 5;
  readonly level = 1;
  private dropT = 2;

  enter(): void { this.dropT = 2; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 1);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.pad(b, t, tones.map((f) => f * 2), 0.022, hold * 0.94, 520);
      s.tone(b, t, tones[0], { g: 0.05, a: 1.5, h: hold * 0.75, r: 2.2, lp: 150 });
      if (Math.random() < 0.7) s.cello(b, t, tones[0] * 2, 0.026, hold * 0.5, (Math.random() - 0.5) * 0.9);
    }
    // the pulse: thunder walking far away, four bars apart
    if (pos === 0 && bar % 4 === 0) s.subHit(b, t, 0.09);
    if (pos === 8 && bar % 4 === 2) s.taiko(b, t, 0.045, 0.4);
    // heavier droplets, closer together
    this.dropT -= this.stepDur;
    if (this.dropT <= 0 && pos % 2 === 0) {
      const c = this.tones(i, 5);
      s.pluck(b, t, c[pick([0, 1, 2])] * 2, 0.022, (Math.random() - 0.5) * 1.5, 0.55);
      this.dropT = 1.2 + Math.random() * 2.6;
    }
    // the sheet getting wider: a soft swell under the change
    if (pos === 0 && bar % 2 === 1) s.swell(b, t, tones[0] * 4, 0.016, 16 * this.stepDur, -0.3);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.pluck(this.bus, t, f * 2, g * 0.8, pan, 0.5); }
}

// ── deluge ───────────────────────────────────────────────────────────────────
class Deluge extends Style {
  readonly id = 'deluge';
  readonly bpm = 84;
  readonly root = 55;
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [0, 3, 7]];
  readonly barsPerChord = 2;
  readonly leadOct = 5;
  readonly level = 0.95;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 1);
    // the sky keeps one steady low beat, like rain on a tin roof
    if (pos === 0) s.bassPulse(b, t, tones[0] * 2, 0.05 + m.tension * 0.02);
    if (pos === 8) s.subHit(b, t, 0.08 + m.tension * 0.03);
    if (pos === 12 && bar % 2 === 1) s.taiko(b, t, 0.055, -0.35);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.pad(b, t, tones.map((f) => f * 2), 0.024, hold * 0.92, 650);
      s.tone(b, t, tones[0], { g: 0.055, a: 0.8, h: hold * 0.8, r: 1.4, lp: 170 });
      s.choir(b, t, tones.map((f) => f * 4), 0.012, hold * 0.6);
    }
    // the whole sheet leaning in, then letting go
    if (i % (16 * 8) === 16 * 6) s.riser(b, t, 16 * this.stepDur, 0.02);
    // dense droplets, almost static
    if (pos % 2 === 0 && Math.random() < 0.5) {
      const c = this.tones(i, 5);
      s.pluck(b, t, c[pick([0, 1, 2])] * 2, 0.014, (Math.random() - 0.5) * 1.6, 0.5);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.pluck(this.bus, t, f * 2, g * 0.7, pan, 0.45); }
}

// ── the conductor ────────────────────────────────────────────────────────────
const STYLES: StyleDef[] = [
  { id: 'drizzle', name: 'Drizzle', make: (s, b) => new Drizzle(s, b) },
  { id: 'shower', name: 'Shower', make: (s, b) => new Shower(s, b) },
  { id: 'deluge', name: 'Deluge', make: (s, b) => new Deluge(s, b) },
];

class RainConductor extends Conductor {
  private rain: Bed;
  private wind: Bed;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'rMusicStyle', rotateKey: 'rMusicStyle' });
    this.rain = this.s.rain(this.amb);
    this.wind = this.makeWind(this.amb);
  }

  /** Low wind under the rain: broad, dark, restless but never wavy. */
  private makeWind(parent: Bus): Bed {
    const s = this.s, ctx = s.ctx, t = ctx.currentTime, end = t + 1e6;
    const src = s.noise(t, end, 0.25);
    const lp = s.filter('lowpass', 320, 0.8);
    const level = s.gain(0);
    const gust = s.gain(1);
    const lfo1 = s.osc('sine', 0.027, t, end);
    lfo1.connect(s.gain(0.25)).connect(gust.gain);
    const lfo2 = s.osc('sine', 0.043, t, end);
    lfo2.connect(s.gain(0.15)).connect(gust.gain);
    src.connect(lp).connect(gust).connect(level);
    s.out(level, parent, 0, 0.3);
    return { level, stop: (at) => { for (const n of [src, lfo1, lfo2]) n.stop(at); } };
  }

  /** The weather is the traffic: the sky picks the style. */
  protected override wanted(): string | null {
    const pinned = this.setting<string>('rMusicStyle');
    if (pinned !== 'auto' && this.styles.has(pinned)) return pinned;
    const n = this.mood.night;
    return n < 0.25 ? 'drizzle' : n < 0.6 ? 'shower' : 'deluge';
  }

  protected override ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('rRainAmb') : 0;
    const wet = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.rain, amb * (0.1 + wet * 0.42), now);
    this.setBed(this.wind, amb * wet * 0.2, now);
  }

  override cue(kind: Cue, srcIp?: string): void {
    const st = this.core, s = this.s;
    const pan = this.panFor(srcIp);
    if (kind === 'allow') { this.playLead(srcIp); return; }
    if (!st.deviceVoices) return;
    switch (kind) {
      case 'dns': {
        // a droplet: one high wet plink, if the sky can spare one
        if (Math.random() >= st.gateDns * 0.3) return;
        const t = this.slot('drop', 2, 0.5);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.pluck(this.sfxBus, t, c[pick([1, 2])] * 4, 0.02 * st.gDns, pan, 0.6);
        return;
      }
      case 'block': {
        // denied: thunder rolling away in the next valley
        this.bumpTension(0.04);
        if (Math.random() >= st.gateBlock * 0.6) return;
        const t = this.slot('thunder', 4, 2.5);
        if (t < 0) return;
        s.thunder(this.sfxBus, t, 0.1 * st.gBlock, pan);
        return;
      }
      case 'threat': {
        // lightning: the crack first, the rumble a stride behind it
        this.bumpTension(0.22);
        if (Math.random() >= st.gateThreat) return;
        const t = this.slot('lightning', 4, 1.5);
        if (t < 0) return;
        s.crackle(this.sfxBus, t, 0.09 * st.gThreat, pan);
        s.crackle(this.sfxBus, t + 0.05, 0.06 * st.gThreat, -pan);
        s.thunder(this.sfxBus, t + 0.35, 0.13 * st.gThreat, pan);
        return;
      }
      case 'dhcp': {
        // a lease: water finding a new bucket
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('drip', 4, 1);
        if (t < 0) return;
        const f = this.chordAt(t, 4)[pick([0, 2])];
        s.tone(this.sfxBus, t, f * 4, { g: 0.03 * st.gDhcp, a: 0.001, r: 0.12, glide: 0.5, pan, rev: 0.5 });
        return;
      }
      case 'wifi': {
        if (Math.random() >= st.gateWifi * 0.8) return;
        const t = this.slot('ripple', 4, 1);
        if (t < 0) return;
        const c = this.chordAt(t, 4);
        s.glass(this.sfxBus, t, c[pick([0, 1, 2])] * 4, 0.02 * st.gWifi, pan);
        return;
      }
      case 'system': {
        const t = this.slot('groan', 4, 1.2);
        if (t < 0) return;
        s.groan(this.sfxBus, t, this.chordAt(t, 1)[0], 0.04, pan, 1.6);
        return;
      }
    }
  }

  override sfx(_name: string, _opts: SfxOpts = {}): void {}

  override noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(8)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const chord = this.chordAt(when, 5);
    if (kind === 'block' || kind === 'threat') {
      s.thunder(this.sfxBus, when, 0.08 * (kind === 'threat' ? st.gThreat : st.gBlock), pan);
    } else if (this.notes) {
      s.pluck(this.sfxBus, when, chord[pick([0, 1, 2])] * 2, 0.014 * (kind === 'allow' ? st.gAllow : kind === 'dns' ? st.gDns : st.gDhcp), pan, 0.55);
    }
  }
}

export function rainScore(e: AudioEngine): Score { return new RainConductor(e); }
