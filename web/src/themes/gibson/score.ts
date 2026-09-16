import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed } from '../../sound/synth';

/**
 * The Gibson's soundtrack: cold machine music for the storage wall.
 *
 *   factory floor : 128 bpm techno, four on the floor, offbeat hats,
 *                   a rumbling bass and metal clangs off the racks
 *   modem dial    : 110 bpm electro-industrial, 808s, a square riff,
 *                   glitch stutters and carrier sweeps
 *   nine volt     : 140 bpm EBM, a gated reese, driving snares, a distant siren
 *   dead pixels   : 92 bpm dark downtempo, a long drone, sparse kicks, tape hiss
 *
 * The wall plays along: a soft tick as a pulse climbs a face, the denial
 * crackle, the servo whirr of a new tower being written, the two rising tones
 * of a target lock, and a big hit with a supersaw chord when the intruder
 * file is found. Server hum and static hiss underneath.
 */

class Factory extends Style {
  readonly id = 'factory';
  readonly bpm = 128;
  readonly root = 41.2;                                      // E
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [-4, 0, 3]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.8;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (pos % 4 === 0) s.kick(b, t, 0.19);
    if (pos % 4 === 2) s.hat(b, t, 0.018, 0.25, true);
    if (pos % 2 === 1) s.hat(b, t, 0.006, -0.3);
    if (pos % 4 === 2 || (pos === 14 && m.tension > 0.3)) s.bassPulse(b, t, this.tones(i, 1)[0], 0.055 + m.tension * 0.02);
    if (this.isChordStart(i)) s.tone(b, t, this.tones(i, 3)[0], { type: 'sawtooth', g: 0.03, a: 0.004, h: 0.22, r: 0.3, detune: 24, lp: 1500, lpTo: 500, q: 2, pan: -0.2 });
    if ((pos === 6 || pos === 11) && Math.random() < 0.28 + m.tension * 0.3) s.noiseHit(b, t, { type: 'bandpass', f: pick([2400, 3400, 5200]), q: 9, g: 0.02 + m.tension * 0.014, a: 0.001, h: 0.02, r: 0.09, pan: 0.5, echo: 0.3 });
    if (m.night > 0.35 && pos % 8 === 4) s.reese(b, t, this.tones(i, 1)[0] * 2, 0.03, this.stepDur * 3);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.tone(this.bus, t, f, { type: 'triangle', g: g * 0.6, a: 0.002, h: 0.05, r: 0.14, pan, echo: 0.3 }); }
}

class Modem extends Style {
  readonly id = 'modem';
  readonly bpm = 110;
  readonly root = 36.71;                                     // D
  readonly scale = [0, 3, 5, 7, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.75;
  private riff: number[] = [];

  enter(): void { this.newRiff(); }
  private newRiff(): void { this.riff = Array.from({ length: 16 }, (_, k) => (k % 3 === 0 || Math.random() < 0.3 ? pick([0, 3, 5, 7, 12]) : -1)); }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 && bar % 4 === 0) this.newRiff();
    if (pos === 0 || pos === 6 || pos === 10) s.eight08(b, t, this.tones(i, 1)[0], 0.13, 0.5);
    if (pos === 4 || pos === 12) s.clap(b, t, 0.045, 0);
    if (pos % 2 === 1) s.hat(b, t, 0.011, pos % 4 ? 0.3 : -0.3);
    const n = this.riff[pos];
    if (n >= 0) s.tone(b, t, this.tones(i, 3)[0] * Math.pow(2, n / 12), { type: 'square', g: 0.014, a: 0.002, h: this.stepDur * 0.5, r: 0.06, lp: 2200, pan: 0.15 });
    if (this.isChordStart(i)) s.reese(b, t, this.tones(i, 1)[0], 0.045, this.barsPerChord * 16 * this.stepDur * 0.5);
    if (Math.random() < 0.05 + m.tension * 0.2) { for (let k = 0; k < 3; k++) s.noiseHit(b, t + k * 0.018 + Math.random() * 0.01, { type: 'bandpass', f: 1400 + Math.random() * 3200, q: 8, g: 0.012, a: 0.001, r: 0.02, pan: 0.4 }); }
    if (pos === 8 && bar % 4 === 2) s.noiseHit(b, t, { type: 'bandpass', f: 600, fTo: 3400, q: 5, g: 0.028 + m.tension * 0.015, a: 0.06, h: 0.5, r: 0.4, pan: -0.3, echo: 0.4 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.chip(this.bus, t, f, g * 0.4, 0.08, pan); }
}

class NineVolt extends Style {
  readonly id = 'ninevolt';
  readonly bpm = 140;
  readonly root = 32.7;                                      // C
  readonly scale = [0, 2, 3, 7, 8, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.62;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos % 4 === 0) s.kick(b, t, 0.2);
    if (pos === 14 && bar % 2 === 1) s.kick(b, t, 0.15);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.075, 0.05);
    if (pos % 2 === 0) s.hat(b, t, 0.012, pos % 4 ? 0.35 : -0.35);
    if (pos % 4 === 0) s.reese(b, t, this.tones(i, 1)[0], 0.05 + m.night * 0.015, this.stepDur * 2.6);
    if (this.isChordStart(i)) for (const f of this.tones(i, 3)) s.supersaw(b, t, f, 0.006, this.stepDur * 2.2, 0);
    if (pos === 0 && bar % 8 === 6) s.tone(b, t, this.tones(i, 4)[0], { type: 'sawtooth', g: 0.016, a: 0.15, h: 0.5, r: 0.5, glide: 1.3, lp: 2600, pan: 0.4, rev: 0.5 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.glass(this.bus, t, f, g * 0.5, pan); }
}

class DeadPixels extends Style {
  readonly id = 'deadpixels';
  readonly bpm = 92;
  readonly root = 27.5;                                      // A1
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-5, -2, 2], [-2, 2, 5]];
  readonly barsPerChord = 4;
  readonly leadOct = 4;
  readonly level = 0.68;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 && bar % 2 === 0) s.kick(b, t, 0.13);
    if (pos === 8 && bar % 4 === 3) s.tom(b, t, 90, 0.04, -0.3);
    if (pos % 4 === 2 && m.tension > 0.25) s.hat(b, t, 0.005, 0.3);
    if (this.isChordStart(i)) s.pad(b, t, this.tones(i, 2), 0.011, this.barsPerChord * 16 * this.stepDur * 0.9, 420 + m.night * 300);
    if ((pos === 6 || pos === 13) && Math.random() < 0.3) s.pluck(b, t, this.tones(i, 4)[Math.floor(Math.random() * 3)], 0.014, (Math.random() - 0.5) * 1.2, 0.6);
    if (m.night > 0.4 && pos === 12 && bar % 4 === 2) s.noiseHit(b, t, { type: 'bandpass', f: 900, fTo: 220, q: 2, g: 0.02, a: 0.2, h: 0.6, r: 0.8, pan: -0.4, rev: 0.6 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.5, pan, 0.6); }
}

const STYLES: StyleDef[] = [
  { id: 'factory', name: 'Factory floor', make: (s, b) => new Factory(s, b) },
  { id: 'modem', name: 'Modem dial', make: (s, b) => new Modem(s, b) },
  { id: 'ninevolt', name: 'Nine volt', make: (s, b) => new NineVolt(s, b) },
  { id: 'deadpixels', name: 'Dead pixels', make: (s, b) => new DeadPixels(s, b) },
];

export const GIBSON_MUSIC: Array<[string, string]> = [['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name])];

class WallConductor extends Conductor {
  private hum: Bed;
  private hiss: Bed;
  private air: Bed;
  private scrollSpeed = 12;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'gMusicStyle', rotateKey: 'gMusicRotate', musicGain: 1.5 });
    this.s.budget = 170;
    this.hum = this.s.drone(this.amb, [36.71, 55, 73.42]);
    this.hiss = this.s.rain(this.amb);
    this.air = this.s.wind(this.amb);
  }

  protected ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('gAmbience') : 0;
    const hot = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.hum, amb * (0.024 + hot * 0.02), now);
    this.setBed(this.hiss, amb * (0.005 + hot * 0.008), now);
    this.setBed(this.air, amb * Math.min(0.18, 0.03 + (this.scrollSpeed - 10) * 0.004), now);
  }

  protected threatStep(i: number, t: number, g: number): void {
    if (i % 8 === 0) this.markHeart(t);
    if (i % 16 === 6) this.s.noiseHit(this.sfxBus, t, { type: 'bandpass', f: 2600 + (i % 3) * 700, q: 6, g: 0.006 * g, a: 0.001, r: 0.03, pan: 0.3 });
  }

  cue(kind: Cue, srcIp?: string): void {
    if (kind === 'allow') { this.playLead(srcIp, 0.05); return; }
    if (kind === 'block') this.bumpTension(0.05);
    else if (kind === 'threat') this.bumpTension(0.25);
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const s = this.s, st = this.core, fx = this.setting<number>('gSfx');
    if (name === 'scroll') { this.scrollSpeed = opts.count ?? this.scrollSpeed; return; }
    if (!st.deviceVoices || fx <= 0) return;
    const pan = Math.max(-0.9, Math.min(0.9, (opts.pan ?? 0)));
    const now = s.ctx.currentTime + 0.02;
    switch (name) {
      case 'pulse':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 4200, q: 5, g: 0.012 * fx * st.gAllow, a: 0.001, r: 0.05, pan });
        return;
      case 'denied':
        s.crackle(this.sfxBus, now, 0.04 * fx * st.gBlock, pan);
        s.tone(this.sfxBus, now, 196, { type: 'square', g: 0.02 * fx * st.gBlock, a: 0.01, h: 0.14, r: 0.1, lp: 700, glide: 0.6, pan });
        return;
      case 'write': {
        s.tone(this.sfxBus, now, 150, { type: 'sawtooth', g: 0.022 * fx * st.gDhcp, a: 0.08, h: 0.7, r: 0.2, glide: 2, lp: 1300, q: 3, pan });
        const t = this.slot('writeclick', 4, 0.3);
        if (t >= 0) s.chip(this.sfxBus, t, this.notes ? this.chordAt(t, 5)[0] : 880, 0.008 * fx * st.gDhcp, 0.05, pan);
        return;
      }
      case 'granted': {
        if (!this.notes) return;
        const t = this.slot('granted', 4, 0.4);
        if (t < 0) return;
        this.chordAt(t, 4).forEach((f, k) => s.ping(this.sfxBus, t + k * this.cur.stepDur, f, 0.012 * fx * st.gWifi, pan));
        return;
      }
      case 'lock': {
        const f = this.notes ? this.chordAt(now, 5)[0] : 1046.5;
        s.tone(this.sfxBus, now, f, { type: 'triangle', g: 0.03 * fx, a: 0.005, h: 0.09, r: 0.12, rev: 0.3 });
        s.tone(this.sfxBus, now + 0.18, f * 1.5, { type: 'triangle', g: 0.03 * fx, a: 0.005, h: 0.16, r: 0.3, rev: 0.4 });
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 300, fTo: 2400, q: 4, g: 0.04 * fx, a: 0.25, r: 0.2 });
        return;
      }
      case 'found':
        s.boom(this.sfxBus, now, 0.14 * fx);
        if (this.notes) for (const f of this.chordAt(now, 3)) s.supersaw(this.sfxBus, now, f, 0.014 * fx, 0.6, 0);
        return;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    if (kind === 'block' || kind === 'threat') s.noiseHit(this.sfxBus, when, { type: 'bandpass', f: 1600, q: 4, g: 0.01 * st.gBlock, a: 0.001, r: 0.05, pan });
    else if (this.notes) s.chip(this.sfxBus, when, pick(this.chordAt(when, 5)), 0.004 * (kind === 'allow' ? st.gAllow : st.gDns), 0.03, pan);
  }
}

export function gibsonScore(e: AudioEngine): Score { return new WallConductor(e); }
