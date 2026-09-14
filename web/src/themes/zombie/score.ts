import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Bus, Synth, type Bed } from './synth';

/**
 * Last Outpost's soundtrack. Three styles take turns (or one is pinned):
 *
 *   horror synth    : a pulsing minor ostinato over a drone and cold bells
 *   lonely survivor : fingerpicked guitar and a detuned piano over the wind
 *   dark ambient    : drones, distant swells and scraping metal
 *
 * The compound's sounds are part of the band: shots, groans, radio chirps,
 * creaking doors and the generator are snapped to the beat and pitched to the
 * chord that's playing. Night (traffic weather) thickens the arrangement; a
 * horde brings a heartbeat and swells that land on the downbeat.
 */

export type StyleId = 'carpenter' | 'survivor' | 'ambient';
const ORDER: StyleId[] = ['carpenter', 'survivor', 'ambient'];

export const MUSIC_STYLES: Array<[string, string]> = [
  ['rotate', 'Rotate'], ['carpenter', 'Horror synth'], ['survivor', 'Lonely survivor'], ['ambient', 'Dark ambient'],
];

/** The theme settings the score reads (the rest are core audio settings). */
interface ScoreSettings {
  audio: boolean; melody: boolean; deviceVoices: boolean; melodyBal: number;
  gBlock: number; gAllow: number; gDns: number; gWifi: number; gDhcp: number; gThreat: number;
  gateBlock: number; gateAllow: number; gateDns: number; gateWifi: number; gateDhcp: number; gateThreat: number;
  zMusicStyle: string; zMusicRotate: number; zGunfire: number; zAmbience: number;
}

interface Mood {
  night: number;       // 0 overcast day … 0.5 dusk … 1 horde night (eased)
  tension: number;     // 0..1, rises with zombies and hordes, bleeds away
  threat: boolean;     // a horde is attacking right now
}

const semis = (root: number, s: number, oct: number) => root * Math.pow(2, oct + s / 12);
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = <T>(a: readonly T[]) => a[(Math.random() * a.length) | 0];

/** A style: key, tempo, harmony and its own arrangement. */
abstract class Style {
  abstract readonly id: StyleId;
  abstract readonly bpm: number;
  abstract readonly root: number;          // tonic frequency at octave 0
  abstract readonly scale: number[];       // for melody (semitones)
  abstract readonly chords: number[][];    // semitones from the tonic
  abstract readonly barsPerChord: number;
  readonly bus: Bus;
  fadingUntil = 0;

  constructor(protected s: Synth, parent: Bus) {
    this.bus = Bus.under(s.ctx, parent, 0);
  }

  get stepDur(): number { return 60 / this.bpm / 4; }
  chordAt(step: number): number[] {
    return this.chords[Math.floor(step / 16 / this.barsPerChord) % this.chords.length];
  }
  tones(step: number, oct: number): number[] { return this.chordAt(step).map((s) => semis(this.root, s, oct)); }
  isChordStart(step: number): boolean { return step % (16 * this.barsPerChord) === 0; }
  /** A scale tone near `deg` (can be negative / past an octave). */
  scaleTone(deg: number, oct: number): number {
    const n = this.scale.length;
    const o = Math.floor(deg / n);
    return semis(this.root, this.scale[((deg % n) + n) % n], oct + o);
  }

  enter(_t: number): void {}
  exit(_t: number): void {}
  abstract step(i: number, t: number, m: Mood): void;
  /** A melody note played by traffic (allow events). */
  abstract lead(t: number, f: number, g: number, pan: number): void;
  abstract readonly leadOct: number;
}

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

// ── the conductor ──────────────────────────────────────────────────────────
class Conductor implements Score {
  private s: Synth;
  private music: Bus;
  private sfxBus: Bus;
  private amb: Bus;
  private styles: Record<StyleId, Style>;
  private cur: Style;
  private rotIdx: number;
  private rotatedAt: number;
  private stepIdx = 0;
  private nextStep = 0;
  private epoch = 0;                         // audio time of step 0 of the current style
  private mood: Mood = { night: 0, tension: 0, threat: false };
  private lastSlot = new Map<string, number>();
  private leadDeg = 4;
  private wind: Bed;
  private rain: Bed;
  private musicLevel = -1;

  constructor(private e: AudioEngine) {
    const ctx = e.ctx;
    this.s = new Synth(e);
    this.music = new Bus(ctx, e.out, e.reverb, e.echo, 0);
    // sound effects go through their own limiter so punchy shots never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 4; comp.ratio.value = 10;
    comp.attack.value = 0.001; comp.release.value = 0.14;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    comp.connect(makeup).connect(e.out);
    this.sfxBus = new Bus(ctx, comp, e.reverb, e.echo, 1);
    this.amb = new Bus(ctx, e.out, e.reverb, e.echo, 1);
    this.wind = this.s.wind(this.amb);
    this.rain = this.s.rain(this.amb);

    this.styles = {
      carpenter: new Carpenter(this.s, this.music),
      survivor: new Survivor(this.s, this.music),
      ambient: new Ambient(this.s, this.music),
    };
    this.rotIdx = (Math.random() * ORDER.length) | 0;
    this.rotatedAt = ctx.currentTime;
    const first = this.wanted() ?? ORDER[this.rotIdx];
    this.cur = this.styles[first];
    this.begin(this.cur, ctx.currentTime);
  }

  private get set(): ScoreSettings { return this.e.settings as unknown as ScoreSettings; }

  /** The pinned style, or null when rotating. */
  private wanted(): StyleId | null {
    const v = this.set.zMusicStyle;
    return (ORDER as string[]).includes(v) ? v as StyleId : null;
  }

  private begin(style: Style, t: number): void {
    style.fadingUntil = 0;
    style.bus.set(1, t, 1.2);
    style.enter(t);
    this.cur = style;
    this.stepIdx = 0;
    this.nextStep = t + 0.1;
    this.epoch = this.nextStep;
    this.e.setEchoTime(style.stepDur * 3);            // dotted eighth
  }

  private switchTo(id: StyleId, t: number): void {
    if (id === this.cur.id) return;
    const old = this.cur;
    old.bus.set(0, t, 1.5);
    old.fadingUntil = t + 7;
    // a low swell covers the handover
    this.s.boom(this.sfxBus, t, 0.04);
    this.begin(this.styles[id], t + 0.6);
  }

  // ── time ──
  /** The next grid time `q16` sixteenths wide, at least `lead` seconds from now. */
  private quant(q16: number, lead = 0.03): number {
    const now = this.s.ctx.currentTime, grid = this.cur.stepDur * q16;
    const k = Math.ceil((now + lead - this.epoch) / grid);
    return this.epoch + Math.max(0, k) * grid;
  }

  /** Book a grid slot for a sound; repeats roll onto the next slots. -1 = too far behind, drop it. */
  private slot(name: string, q16: number, maxWait: number): number {
    const now = this.s.ctx.currentTime, grid = this.cur.stepDur * q16;
    let t = this.quant(q16);
    const last = this.lastSlot.get(name) ?? -1;
    if (last >= t - 1e-4) t = last + grid;
    if (t - now > maxWait) return -1;
    this.lastSlot.set(name, t);
    return t;
  }

  private chordAt(t: number, oct: number): number[] {
    const step = Math.max(0, Math.floor((t - this.epoch) / this.cur.stepDur));
    return this.cur.tones(step, oct);
  }

  // ── Score ──
  update(dt: number, state: State): void {
    const ctx = this.s.ctx, now = ctx.currentTime, st = this.set;
    this.s.budget = 110;

    const nightTarget = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.mood.night += (nightTarget - this.mood.night) * Math.min(1, dt * 0.15);
    this.mood.tension = Math.max(0, this.mood.tension - dt * 0.025);

    const musicLevel = st.melody ? 1.9 * st.melodyBal / 0.65 : 0;
    if (Math.abs(musicLevel - this.musicLevel) > 0.005) {
      this.music.set(musicLevel, now, 0.5);
      this.musicLevel = musicLevel;
    }
    const wet = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.wind, st.zAmbience * (0.28 + this.mood.night * 0.3), now);
    this.setBed(this.rain, st.zAmbience * wet * 0.22, now);

    // rotation
    const pinned = this.wanted();
    if (pinned) {
      if (pinned !== this.cur.id) { this.switchTo(pinned, now); this.rotatedAt = now; }
    } else if (now - this.rotatedAt > Math.max(1, st.zMusicRotate) * 60) {
      this.rotIdx = (ORDER.indexOf(this.cur.id) + 1) % ORDER.length;
      this.rotatedAt = now;
      this.switchTo(ORDER[this.rotIdx], now);
    }
    for (const style of Object.values(this.styles)) {
      if (style.fadingUntil && now > style.fadingUntil) { style.fadingUntil = 0; style.exit(now); }
    }

    // the clock: schedule a little ahead so notes land exactly on the grid
    if (this.nextStep < now - 0.25) {                  // tab slept: pick the beat back up
      const skip = Math.ceil((now - this.nextStep) / this.cur.stepDur);
      this.stepIdx += skip;
      this.nextStep += skip * this.cur.stepDur;
    }
    let guard = 0;
    while (this.nextStep < now + 0.12 && guard++ < 8) {
      const t = this.nextStep, i = this.stepIdx;
      if (this.musicLevel > 0) this.cur.step(i, t, this.mood);
      this.threatStep(i, t);
      this.stepIdx++;
      this.nextStep = this.epoch + this.stepIdx * this.cur.stepDur;
    }
  }

  private setBed(bed: Bed, level: number, t: number): void {
    const cur = (bed as Bed & { _v?: number })._v ?? -1;
    if (Math.abs(cur - level) < 0.002) return;
    (bed as Bed & { _v?: number })._v = level;
    bed.level.gain.setTargetAtTime(level, t, 1.5);
  }

  /** While a horde attacks: a heartbeat on the beat, a swell into every fourth bar. */
  private threatStep(i: number, t: number): void {
    const st = this.set;
    if (!this.mood.threat || !st.deviceVoices) return;
    const g = st.gThreat * st.gateThreat;
    if (g <= 0) return;
    if (i % 8 === 0) this.s.heart(this.sfxBus, t, 0.11 * g);
    if (i % 64 === 32) this.s.riser(this.sfxBus, t, 32 * this.cur.stepDur, 0.03 * g);
    if (i % 64 === 0 && i > 0) this.s.boom(this.sfxBus, t, 0.06 * g);
  }

  setThreatActive(on: boolean): void { this.mood.threat = on; }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.set, s = this.s;
    const pan = srcIp ? ((hash(srcIp) % 200) - 100) / 100 * 0.8 : (Math.random() - 0.5) * 1.2;
    if (kind === 'allow') {
      // traffic plays the tune: one lead note per eighth at most, walking the scale
      if (!st.melody || Math.random() >= st.gateAllow * 0.6) return;
      const t = this.slot('lead', 2, 0.6);
      if (t < 0) return;
      const chord = this.chordAt(t, this.cur.leadOct);
      let f: number;
      if (Math.random() < 0.55) {
        f = chord[srcIp ? hash(srcIp) % 3 : (Math.random() * 3) | 0];
      } else {
        this.leadDeg += pick([-2, -1, -1, 1, 1, 2]);
        if (this.leadDeg < 0 || this.leadDeg > 9) this.leadDeg = 3 + ((Math.random() * 4) | 0);
        f = this.cur.scaleTone(this.leadDeg, this.cur.leadOct);
      }
      this.cur.lead(t, f, 0.07 * st.gAllow * Math.min(1.5, this.musicLevel), pan);
      return;
    }
    if (!st.deviceVoices) return;
    switch (kind) {
      case 'block': {
        this.mood.tension = Math.min(1, this.mood.tension + 0.05);
        if (Math.random() >= st.gateBlock * 0.7) return;
        const t = this.slot('groan', 4, 1.3);
        if (t < 0) return;
        const root = this.chordAt(t, 1)[pick([0, 0, 2])];
        s.groan(this.sfxBus, t, root, 0.09 * st.gBlock, pan, 1.3 + Math.random() * 0.8);
        return;
      }
      case 'threat': {
        this.mood.tension = Math.min(1, this.mood.tension + 0.25);
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
    const st = this.set, s = this.s;
    if (!st.deviceVoices) return;
    const pan = opts.pan ?? 0;
    if (name === 'shot') {
      if (st.zGunfire <= 0) return;
      this.mood.tension = Math.min(1, this.mood.tension + 0.02);
      // rounds land on the 32nd grid, so a brute's burst becomes a drum roll
      for (let n = 0; n < Math.min(4, opts.count ?? 1); n++) {
        const t = this.slot('shot', 0.5, 0.3);
        if (t < 0) return;
        const ring = this.chordAt(t, 4)[pick([0, 1, 2])];
        s.gunshot(this.sfxBus, t, 0.2 * st.zGunfire * (n ? 0.8 : 1), pan, ring);
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
    const st = this.set, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const chord = this.chordAt(when, 3);
    switch (kind) {
      case 'block': case 'threat':
        s.gunshot(this.sfxBus, when, 0.25 * st.zGunfire * st.gBlock, pan, chord[0] * 2);
        break;
      case 'dns':
        s.chirp(this.sfxBus, when, chord[0] * 4, chord[1] * 4, 0.02 * st.gDns, pan);
        break;
      default:
        s.pluck(this.sfxBus, when, pick(chord), 0.04 * (kind === 'allow' ? st.gAllow : kind === 'wifi' ? st.gWifi : st.gDhcp), pan);
    }
  }
}

export function zombieScore(e: AudioEngine): Score { return new Conductor(e); }
