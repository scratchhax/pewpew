import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed } from '../../sound/synth';

/**
 * Mainframe's soundtrack: a 90s rave running on the board.
 *
 *   acid trace    : 126 bpm acid house, a squelching 303 line, 909 kicks and claps
 *   phreak breaks : 136 bpm breakbeat, hoover stabs, rave piano
 *   deep dive     : 138 bpm trance, offbeat bass, gated supersaws, pluck arps
 *   jungle bus    : 170 bpm jungle, chopped breaks and a rolling reese
 *   handshake     : 100 bpm electro, 808s, a robotic square riff, modem sweeps
 *
 * The board plays along: glassy shatters in key when a firewall stops a
 * packet, a glitch stutter as a worm crawls in, ICE chirps and a small blast
 * when it's killed, data chirps from the lookup towers, servo whirrs from the
 * pick-and-place arm, antenna pings, and the dive's own
 * sounds (lock, a rising rush, the whoosh through the die, traceroute ticks,
 * a big hit for INTRUSION TRACED). Fans hum and the board buzzes underneath.
 */

class Acid extends Style {
  readonly id = 'acid';
  readonly bpm = 126;
  readonly root = 55;                                        // A
  readonly scale = [0, 3, 5, 7, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [-4, 0, 3]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.9;
  private seq: Array<{ n: number; acc: boolean; on: boolean; slide: boolean }> = [];

  enter(): void { this.newSeq(); }
  private newSeq(): void {
    this.seq = Array.from({ length: 16 }, (_, k) => ({ n: pick([0, 0, 0, 12, 7, 10, 3, 5]), acc: Math.random() < 0.3, on: k % 4 === 0 || Math.random() < 0.6, slide: Math.random() < 0.2 }));
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 && bar % 4 === 0) this.newSeq();
    if (pos % 4 === 0) s.kick(b, t, 0.18);
    if (pos === 4 || pos === 12) s.clap(b, t, 0.045, 0.05);
    if (pos % 4 === 2) s.hat(b, t, 0.016, 0.3, true);
    else if (m.night > 0.3) s.hat(b, t, 0.007, -0.3);
    const st = this.seq[pos];
    if (st.on) {
      const f = this.tones(i, 1)[0] * Math.pow(2, st.n / 12);
      const sweep = 380 + (0.5 + 0.5 * Math.sin(bar * 0.6 + pos * 0.05)) * 2200 + m.tension * 1600;
      s.tone(b, t, f, { type: 'sawtooth', g: st.acc ? 0.05 : 0.032, a: 0.003, h: st.slide ? this.stepDur * 0.9 : 0.02, r: 0.09, lp: sweep, lpTo: sweep * 0.3, q: 14, glide: st.slide ? 1.06 : undefined, pan: 0.05 });
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.arp(this.bus, t, f, g * 0.5, 2600, pan); }
}

class Breaks extends Style {
  readonly id = 'breaks';
  readonly bpm = 136;
  readonly root = 36.71;                                     // D
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.85;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 || pos === 10 || (bar % 2 === 1 && pos === 7)) s.kick(b, t, 0.18);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.07, 0.05);
    if ((pos === 7 || pos === 15) && Math.random() < 0.6) s.snare(b, t, 0.022, -0.2);
    if (pos % 2 === 0) s.hat(b, t, 0.012, pos % 4 ? 0.3 : -0.3);
    if (this.isChordStart(i)) {
      // the hoover: a detuned saw that dives into the note
      const f = this.tones(i, 2)[0];
      s.tone(b, t, f * 1.5, { type: 'sawtooth', g: 0.045, a: 0.01, h: 0.35, r: 0.4, detune: 38, glide: 0.667, lp: 2600, lpTo: 900, q: 1.2, rev: 0.4 });
    }
    if (bar % 2 === 1 && (pos === 3 || pos === 6 || pos === 11)) for (const f of this.tones(i, 3)) s.piano(b, t, f, 0.018, 0, 0.3);
    if (pos % 2 === 0) s.bassPulse(b, t, this.tones(i, 1)[0] * (pos % 8 === 6 ? 2 : 1), 0.05 + m.tension * 0.02);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.piano(this.bus, t, f, g * 0.6, pan, 0.3); }
}

class Trance extends Style {
  readonly id = 'trance';
  readonly bpm = 138;
  readonly root = 43.65;                                     // F
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-2, 2, 5]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.6;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (pos % 4 === 0) s.kick(b, t, 0.17);
    if (pos % 4 === 2) { s.bassPulse(b, t, this.tones(i, 1)[0] * 2, 0.06); s.hat(b, t, 0.014, 0.25, true); }
    if (pos === 4 || pos === 12) s.clap(b, t, 0.03, -0.05);
    if (this.isChordStart(i)) s.pad(b, t, this.tones(i, 3), 0.01, this.barsPerChord * 16 * this.stepDur * 0.9, 1400 + m.night * 1200);
    const c = this.tones(i, 4);
    if (pos % 2 === 1) s.pluck(b, t, c[[0, 1, 2, 1, 2, 0, 1, 2][((pos - 1) / 2) % 8]] * (pos > 8 ? 2 : 1), 0.022, pos % 4 === 1 ? 0.4 : -0.4, 0.4);
    if (m.night > 0.35 && pos % 2 === 0) for (const f of this.tones(i, 3)) s.supersaw(b, t, f, 0.005, this.stepDur * 0.6, 0);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.pluck(this.bus, t, f, g * 0.7, pan, 0.4); }
}

class Jungle extends Style {
  readonly id = 'jungle';
  readonly bpm = 170;
  readonly root = 41.2;                                      // E
  readonly scale = [0, 2, 3, 7, 8, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.55;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 || pos === 10) s.kick(b, t, 0.16);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.06, 0.1);
    if ([6, 9, 14, 15].includes(pos) && Math.random() < 0.55) s.snare(b, t, 0.02 + Math.random() * 0.02, (Math.random() - 0.5) * 0.6);
    if (pos % 2 === 0) s.hat(b, t, 0.011, pos % 4 ? 0.35 : -0.35);
    if (this.isChordStart(i)) s.reese(b, t, this.tones(i, 1)[0], 0.05, this.barsPerChord * 16 * this.stepDur * 0.45);
    if (i % (this.barsPerChord * 16) === this.barsPerChord * 8) s.reese(b, t, this.tones(i, 1)[0] * (bar % 4 === 1 ? 1.5 : 1), 0.045, 8 * this.stepDur);
    if (pos === 0 && m.night > 0.4) s.eight08(b, t, this.tones(i, 1)[0], 0.1, 0.6);
    if (pos === 8 && bar % 4 === 3) s.scratch(b, t, 0.035, this.stepDur * 3, 0.2);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.6, pan, 0.4); }
}

class Handshake extends Style {
  readonly id = 'handshake';
  readonly bpm = 100;
  readonly root = 32.7;                                      // C
  readonly scale = [0, 3, 5, 7, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-5, -2, 2]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.8;
  private riff: number[] = [];

  enter(): void { this.newRiff(); }
  private newRiff(): void { this.riff = Array.from({ length: 16 }, (_, k) => (k % 3 === 0 || Math.random() < 0.3 ? pick([0, 3, 5, 7, 10, 12]) : -1)); }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 && bar % 4 === 0) this.newRiff();
    if (pos === 0 || pos === 6 || pos === 10) s.eight08(b, t, this.tones(i, 1)[0], 0.12, 0.45);
    if (pos === 4 || pos === 12) s.clap(b, t, 0.04, 0);
    if (pos % 2 === 1) s.hat(b, t, 0.01, 0.3);
    const n = this.riff[pos];
    if (n >= 0) s.chip(b, t, this.tones(i, 3)[0] * Math.pow(2, n / 12), 0.012, this.stepDur * 0.6, pos % 2 ? 0.3 : -0.3);
    if (pos === 8 && bar % 4 === 2) s.noiseHit(b, t, { type: 'bandpass', f: 600, fTo: 3400, q: 6, g: 0.03 + m.tension * 0.02, a: 0.05, h: 0.4, r: 0.5, pan: 0.3, echo: 0.3 });
    if (this.isChordStart(i)) s.pad(b, t, this.tones(i, 2), 0.009, this.barsPerChord * 16 * this.stepDur * 0.8, 900);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.chip(this.bus, t, f, g * 0.35, 0.08, pan); }
}

const STYLES: StyleDef[] = [
  { id: 'acid', name: 'Acid trace', make: (s, b) => new Acid(s, b) },
  { id: 'breaks', name: 'Phreak breaks', make: (s, b) => new Breaks(s, b) },
  { id: 'trance', name: 'Deep dive', make: (s, b) => new Trance(s, b) },
  { id: 'jungle', name: 'Jungle bus', make: (s, b) => new Jungle(s, b) },
  { id: 'handshake', name: 'Handshake', make: (s, b) => new Handshake(s, b) },
];

export const MAINFRAME_MUSIC: Array<[string, string]> = [['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name])];

class BoardConductor extends Conductor {
  private hum: Bed;
  private buzz: Bed;
  private air: Bed;
  private flySpeed = 26;
  private duck = 1;
  private duckTarget = 1;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'mMusicStyle', rotateKey: 'mMusicRotate', musicGain: 1.6 });
    this.s.budget = 180;
    this.hum = this.s.drone(this.amb, [49, 98.5, 147]);
    this.buzz = this.s.rain(this.amb);
    this.air = this.s.wind(this.amb);
  }

  update(dt: number, state: State): void {
    super.update(dt, state);
    if (Math.abs(this.duck - this.duckTarget) > 0.001) {
      this.duck += (this.duckTarget - this.duck) * Math.min(1, dt * 1.5);
      if (this.musicLevel > 0) this.music.set(this.musicLevel * this.duck, this.s.ctx.currentTime, 0.2);
    }
  }

  protected ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('mAmbience') : 0;
    const hot = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.hum, amb * (0.02 + hot * 0.02), now);
    this.setBed(this.buzz, amb * (0.006 + hot * 0.01), now);
    this.setBed(this.air, amb * Math.min(0.2, 0.04 + (this.flySpeed - 20) * 0.003), now);
  }

  protected threatStep(i: number, t: number, g: number): void {
    if (i % 8 === 0) this.markHeart(t);
    if (i % 16 === 6 && this.notes) this.s.chip(this.sfxBus, t, this.chordAt(t, 5)[0], 0.006 * g, 0.03, 0.4);
  }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.core;
    if (kind === 'allow') { this.playLead(srcIp, 0.06); return; }
    if (kind === 'block') this.bumpTension(0.04);
    else if (kind === 'threat') this.bumpTension(0.22);
    void st;
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const s = this.s, st = this.core, fx = this.setting<number>('mSfx');
    if (name === 'fly') { this.flySpeed = opts.count ?? this.flySpeed; return; }
    if (name === 'duck') { this.duckTarget = opts.variant === '1' ? 0.5 : 1; return; }
    if (!st.deviceVoices || fx <= 0) return;
    const pan = Math.max(-0.9, Math.min(0.9, (opts.pan ?? 0)));
    const now = s.ctx.currentTime + 0.02;
    switch (name) {
      case 'shatter': {
        if (Math.random() >= st.gateBlock) return;
        const t = this.slot('shatter', 1, 0.3);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.noiseHit(this.sfxBus, t, { type: 'highpass', f: 3500, g: 0.05 * fx * st.gBlock, a: 0.001, r: 0.18, pan, rev: 0.3 });
        c.forEach((f, k) => s.tone(this.sfxBus, t + k * 0.012, f * (1 + k * 0.5), { type: 'triangle', g: 0.012 * fx * st.gBlock, a: 0.001, r: 0.35, pan: pan + (k - 1) * 0.2, rev: 0.4 }));
        return;
      }
      case 'worm': {
        if (Math.random() >= st.gateThreat) return;
        for (let k = 0; k < 7; k++) s.noiseHit(this.sfxBus, now + k * 0.055 + Math.random() * 0.02, { type: 'bandpass', f: 400 + Math.random() * 2400, q: 6, g: 0.035 * fx * st.gThreat, a: 0.001, h: 0.02, r: 0.03, pan });
        s.tone(this.sfxBus, now, 55, { type: 'square', g: 0.02 * fx * st.gThreat, a: 0.01, h: 0.3, r: 0.2, lp: 400, pan });
        return;
      }
      case 'ice': {
        const t = this.slot('ice', 1, 0.3);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        for (let k = 0; k < 3; k++) s.chip(this.sfxBus, t + k * 0.05, c[k % c.length] * (k === 2 ? 2 : 1), 0.008 * fx, 0.04, pan);
        return;
      }
      case 'kill': {
        const t = this.slot('kill', 1, 0.3);
        if (t < 0) return;
        s.blast(this.sfxBus, t, 0.08 * fx * st.gThreat, pan, this.chordAt(t, 3)[0]);
        return;
      }
      case 'lookup': {
        if (!this.notes || Math.random() >= st.gateDns) return;
        const t = this.slot('lookup', 2, 0.5);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.chirp(this.sfxBus, t, c[0], c[1], 0.014 * fx * st.gDns, pan);
        return;
      }
      case 'servo':
        s.tone(this.sfxBus, now, 180, { type: 'sawtooth', g: 0.02 * fx * st.gDhcp, a: 0.1, h: 1.1, r: 0.2, glide: 1.8, lp: 1400, q: 3, pan });
        return;
      case 'click':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 2200, q: 2, g: 0.05 * fx * st.gDhcp, a: 0.001, r: 0.04, pan });
        s.tom(this.sfxBus, now, 140, 0.05 * fx * st.gDhcp, pan);
        return;
      case 'join': {
        if (!this.notes || Math.random() >= st.gateWifi) return;
        const t = this.slot('join', 2, 0.6);
        if (t < 0) return;
        this.chordAt(t, 4).forEach((f, k) => s.ping(this.sfxBus, t + k * this.cur.stepDur, f, 0.01 * fx * st.gWifi, pan));
        return;
      }
      case 'fail':
        s.crackle(this.sfxBus, now, 0.03 * fx * st.gWifi, pan);
        return;
      case 'lock': {
        const f = this.notes ? this.chordAt(now, 5)[0] : 1318.5;
        s.tone(this.sfxBus, now, f, { type: 'triangle', g: 0.03 * fx, a: 0.005, h: 0.1, r: 0.12, rev: 0.3 });
        s.tone(this.sfxBus, now + 0.2, f * 1.5, { type: 'triangle', g: 0.03 * fx, a: 0.005, h: 0.18, r: 0.3, rev: 0.4 });
        return;
      }
      case 'descend':
        s.riser(this.sfxBus, now, 3.0, 0.07 * fx);
        return;
      case 'through':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 5000, fTo: 200, q: 1.5, g: 0.12 * fx, a: 0.3, h: 0.2, r: 1.2, rev: 0.6 });
        s.boom(this.sfxBus, now + 0.6, 0.12 * fx);
        return;
      case 'trace':
        for (let k = 0; k < 6; k++) s.noiseHit(this.sfxBus, now + k * 0.04, { type: 'bandpass', f: 2800 + Math.random() * 1200, q: 4, g: 0.018 * fx, a: 0.001, r: 0.02, pan: -0.4 });
        return;
      case 'traced': {
        s.boom(this.sfxBus, now, 0.14 * fx);
        if (this.notes) for (const f of this.chordAt(now, 3)) s.supersaw(this.sfxBus, now, f, 0.012 * fx, 0.5, 0);
        return;
      }
      case 'ascend':
        // lifting off the chip: a long rising rush that settles into the flight
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 180, fTo: 2600, q: 1.2, g: 0.07 * fx, a: 0.4, h: 1.2, r: 1.6, rev: 0.4 });
        s.tone(this.sfxBus, now, 55, { g: 0.06 * fx, a: 0.3, h: 0.8, r: 1.4, glide: 2, rev: 0.3 });
        return;
      case 'surface':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 250, fTo: 4200, q: 1.5, g: 0.08 * fx, a: 0.8, r: 0.9, rev: 0.4 });
        return;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    if (kind === 'block' || kind === 'threat') s.noiseHit(this.sfxBus, when, { type: 'bandpass', f: 1800, q: 3, g: 0.012 * st.gBlock, a: 0.001, r: 0.05, pan });
    else if (this.notes) s.chip(this.sfxBus, when, pick(this.chordAt(when, 5)), 0.004 * (kind === 'allow' ? st.gAllow : st.gDns), 0.03, pan);
  }
}

export function mainframeScore(e: AudioEngine): Score { return new BoardConductor(e); }
