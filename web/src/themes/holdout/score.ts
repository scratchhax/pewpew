import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Synth, Bus } from '../../sound/synth';

/**
 * The Holdout's soundtrack: horror, not rhythm. Three styles driven by scene
 * pressure, all built from drones, sub-thumps, sour strings and long silences:
 *
 *   night  (0–0.28)  : no beat. A reese drone, noise breaths, one detuned
 *                      piano note every few bars, knocks heard through walls.
 *   siege  (0.28–0.55): the pulse starts — a sub-thump every few bars, a far
 *                      taiko, a nail string left ringing on the minor second.
 *   horde  (0.55–1.0): half-time war drums, bow-scratch stabs, a growl under
 *                      everything, the heartbeat accelerating.
 *
 * Pressure is the compound's threat level. The conductor crossfades between
 * styles when the threshold is crossed. A pinned style (from settings)
 * overrides pressure. Nothing here is allowed to sound like a groove.
 */

// ── night ───────────────────────────────────────────────────────────────────
class Night extends Style {
  readonly id = 'drone';
  readonly bpm = 50;
  readonly root = 41.2;                                          // E1
  readonly scale = [0, 1, 3, 5, 6, 8, 10];                       // phrygian, and a minor 2nd
  readonly chords = [[0, 1, 5], [0, 1, 5], [-1, 0, 4], [0, 1, 5]];
  readonly barsPerChord = 8;
  readonly leadOct = 6;
  readonly level = 1.05;
  private breathT = 3;
  private noteT = 5;
  private knockT = 12;

  enter(): void { this.breathT = 3; this.noteT = 5; this.knockT = 12; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const tones = this.tones(i, 1);
    // the drone: a reese two-note sour bed, re-tuned once every eight bars
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.reese(b, t, tones[0], 0.05, hold * 0.96);
      s.tone(b, t, tones[0] / 2, { g: 0.05, a: 2, h: hold * 0.8, r: 3, lp: 120 });
      // once it's been a while, a string joins and stays wrong
      if (m.tension > 0.35) s.nail(b, t, this.scaleTone(5, 4), 0.012, hold * 0.5, 0.4);
    }
    // noise breaths, drifting across the room
    this.breathT -= this.stepDur;
    if (this.breathT <= 0) {
      s.breath(b, t, 0.03 + m.night * 0.02, (Math.random() * 2 - 1) * 0.9);
      this.breathT = 7 + Math.random() * 9;
    }
    // one piano note, high, far, drenched in the room — then nothing for a while
    this.noteT -= this.stepDur;
    if (this.noteT <= 0 && pos % 2 === 0) {
      s.piano(b, t, this.scaleTone(pick([0, 1, 4, 5, 7]), 6), 0.028, (Math.random() - 0.5) * 1.2, 0.5);
      this.noteT = 8 + Math.random() * 10;
    }
    // something is knocking on the outside of the compound
    this.knockT -= this.stepDur;
    if (this.knockT <= 0 && m.night > 0.35) {
      s.knock(b, t, 0.05, (Math.random() * 2 - 1) * 0.8);
      this.knockT = 14 + Math.random() * 18;
    }
    // whispers drift past at night
    if (m.night > 0.4 && pos === 8 && Math.random() < 0.3) {
      s.whisper(b, t, 0.02 + m.night * 0.02, (Math.random() * 2 - 1) * 0.9);
    }
    // the compound's own heartbeat once the dark is full in
    if (m.night > 0.55 && pos % 8 === 0) s.heart(b, t, 0.05 * m.night);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.piano(this.bus, t, f, g * 0.6, pan, 0.5); }
}

// ── siege ────────────────────────────────────────────────────────────────────
class Siege extends Style {
  readonly id = 'siege';
  readonly bpm = 60;
  readonly root = 41.2;                                          // E1
  readonly scale = [0, 1, 3, 5, 6, 8, 10];
  readonly chords = [[0, 1, 5], [0, 1, 5], [-1, 0, 4], [0, 1, 5]];
  readonly barsPerChord = 4;
  readonly leadOct = 6;
  readonly level = 1;
  private noteT = 4;

  enter(): void { this.noteT = 4; }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 1);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.reese(b, t, tones[0], 0.05, hold * 0.96);
      s.tone(b, t, tones[0] / 2, { g: 0.05, a: 1.5, h: hold * 0.8, r: 2.5, lp: 120 });
      // the nail string rings through every change
      s.nail(b, t, this.scaleTone(5, 4), 0.014 + m.tension * 0.008, hold * 0.6, 0.35);
      // a cello from the next room
      if (Math.random() < 0.6) s.cello(b, t, tones[0], 0.03, hold * 0.5, (Math.random() - 0.5) * 0.8);
    }
    // the pulse: a sub-thump, not a beat — four bars apart
    if (pos === 0 && bar % 4 === 0) s.subHit(b, t, 0.11);
    if (pos === 8 && bar % 4 === 2) s.subHit(b, t, 0.07, 0.3);
    // one taiko, far away, answering itself
    if (pos === 8 && bar % 2 === 1) s.taiko(b, t, 0.05 + m.tension * 0.03, -0.4);
    // the heartbeat, patient
    if (pos % 8 === 0) s.heart(b, t, 0.045 + m.tension * 0.02);
    // bows start moving when it gets close
    if (m.tension > 0.55 && this.isChordStart(i)) {
      s.bowHit(b, t, tones[0] * 2, 0.03, -0.3);
    }
    // a last sparse piano note, before the drums take over
    this.noteT -= this.stepDur;
    if (this.noteT <= 0 && pos % 2 === 0 && m.tension < 0.45) {
      s.piano(b, t, this.scaleTone(pick([0, 1, 7]), 6), 0.024, (Math.random() - 0.5) * 1.2, 0.5);
      this.noteT = 10 + Math.random() * 8;
    }
    // every eight bars the room starts leaning forward
    if (i % (16 * 8) === 16 * 6) s.riser(b, t, 16 * this.stepDur, 0.02);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.piano(this.bus, t, f, g * 0.5, pan, 0.5); }
}

// ── horde ────────────────────────────────────────────────────────────────────
class Horde extends Style {
  readonly id = 'horde';
  readonly bpm = 84;
  readonly root = 41.2;                                          // E1
  readonly scale = [0, 1, 3, 5, 6, 8, 10];
  readonly chords = [[0, 1, 5], [0, 1, 5], [-1, 0, 4], [0, 1, 5]];
  readonly barsPerChord = 2;
  readonly leadOct = 6;
  readonly level = 0.95;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, bar = Math.floor(i / 16), pos = i % 16;
    const tones = this.tones(i, 1);
    // half-time war drums: one hit per bar, a stomp answering it
    if (pos === 0) s.subHit(b, t, 0.13);
    if (pos === 8) s.stomp(b, t, 0.09 + m.tension * 0.03);
    if (pos === 12) s.taiko(b, t, 0.06, 0.35);
    if (m.tension > 0.7 && pos === 6) s.subHit(b, t, 0.08, -0.3);
    // the drone, changing its mind faster now
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.reese(b, t, tones[0], 0.05, hold * 0.94);
      s.tone(b, t, tones[0] / 2, { g: 0.05, a: 0.8, h: hold * 0.8, r: 1.5, lp: 130 });
      // a bow dragged across the change
      s.bowHit(b, t, tones[0] * 2, 0.035, -0.25);
      s.bowHit(b, t + 0.2, tones[0] * 2 * 0.94, 0.025, 0.3);
    }
    // the growl: a voice under the floor
    if (pos === 0 && bar % 2 === 0) s.groan(b, t, tones[0], 0.05, -0.2, 3.2);
    // the nail, louder, closer
    if (pos === 0 && bar % 4 === 0) s.nail(b, t, this.scaleTone(5, 4), 0.02, 16 * this.stepDur, 0.3);
    // the heartbeat, and it is accelerating
    if (pos % (m.tension > 0.8 ? 2 : 4) === 0) s.heart(b, t, 0.05 + m.tension * 0.03);
    // every eight bars the door is coming off
    if (i % (16 * 8) === 16 * 6) s.riser(b, t, 16 * this.stepDur, 0.028);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bowHit(this.bus, t, f, g * 0.4, pan); }
}

// ── the conductor ────────────────────────────────────────────────────────────
const STYLES: StyleDef[] = [
  { id: 'drone', name: 'Night', make: (s, b) => new Night(s, b) },
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
    if (i % 32 === 0 && i > 0) this.s.subHit(this.sfxBus, t, 0.07 * g);
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
        // one high piano note per query, if the room is quiet enough
        if (!this.notes || Math.random() >= st.gateDns * 0.25) return;
        const t = this.slot('piano', 2, 0.5);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.piano(this.sfxBus, t, c[pick([1, 2])] * 2, 0.018 * st.gDns, pan, 0.5);
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
        // a new arrival: two knocks, then the creak of the gate
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('knock', 4, 1.5);
        if (t < 0) return;
        s.knock(this.sfxBus, t, 0.06 * st.gDhcp, pan);
        s.knock(this.sfxBus, t + 0.22, 0.045 * st.gDhcp, pan);
        s.creak(this.sfxBus, t + 0.5, this.chordAt(t, 3)[0], 0.025 * st.gDhcp, pan, 0.9);
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
    } else if (name === 'claw') {
      // claws on the palings: a dry scrape over a small thud, quiet on purpose
      const t = this.slot('claw', 2, 0.25);
      if (t < 0) return;
      s.noiseHit(this.sfxBus, t, { type: 'bandpass', f: 900, fTo: 260, q: 1.6, g: 0.03 * st.gBlock, a: 0.004, r: 0.16, pan });
      s.tone(this.sfxBus, t, 70, { g: 0.035 * st.gBlock, a: 0.002, r: 0.12, glide: 0.6, lp: 300, pan });
    } else if (name === 'wallbreak') {
      // the wall goes: a sub-thump, a shock, and bows falling down the scale
      const t = this.slot('wallbreak', 1, 1.2);
      if (t < 0) return;
      s.subHit(this.sfxBus, t, 0.15 * st.gBlock);
      s.shock(this.sfxBus, t, this.chordAt(t, 1)[0] * 2, 0.07 * st.gBlock);
      const c = this.chordAt(t, 2)[0];
      s.bowHit(this.sfxBus, t, c * 2, 0.04 * st.gBlock, pan);
      s.bowHit(this.sfxBus, t + 0.22, c * 1.7, 0.035 * st.gBlock, pan);
      s.bowHit(this.sfxBus, t + 0.44, c * 1.4, 0.03 * st.gBlock, pan);
    } else if (name === 'survivorDown') {
      // the death knell: a knock, a low cello, two piano notes a semitone
      // apart, and the heartbeat skipping
      const t = this.slot('survivorDown', 1, 0.8);
      if (t < 0) return;
      s.knock(this.sfxBus, t, 0.09 * st.gBlock, pan);
      s.cello(this.sfxBus, t, this.chordAt(t, 1)[0], 0.1 * st.gBlock, 0.5, pan);
      const c = this.chordAt(t, 5);
      s.piano(this.sfxBus, t + 0.08, c[1] * 2, 0.035, pan, 0.6);
      s.piano(this.sfxBus, t + 0.08, c[1] * 2 * 1.059, 0.028, pan, 0.6);
      this.markHeart(t);
    } else if (name === 'voice') {
      // the radio behind the log line: a murmur on the handset, never words
      const t = this.slot('voice', 6, 0.3);
      if (t < 0) return;
      s.voice(this.sfxBus, t, 0.05 * st.gBlock, pan, opts.variant === 'urgent');
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
        if (this.notes) s.piano(this.sfxBus, when, chord[1] * 2, 0.016 * st.gDns, pan, 0.5);
        break;
      default:
        if (this.notes) s.piano(this.sfxBus, when, pick(chord) * 2, 0.02 * (kind === 'allow' ? st.gAllow : kind === 'wifi' ? st.gWifi : st.gDhcp), pan, 0.5);
    }
  }
}

export function holdoutScore(e: AudioEngine): Score { return new HoldoutConductor(e); }
