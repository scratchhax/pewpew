import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed } from '../../sound/synth';

/**
 * Panopticon's soundtrack: a spy thriller that scores itself.
 *
 *   cold war         : 92 bpm D minor analog ostinato, sub octaves, rim clicks, a slow pad
 *   signal intercept : 118 bpm glitchy electronica, blips, gated hats, glassy chords
 *   deep cover       : 70 bpm drone, sonar pings, a sparse detuned piano
 *   zero day         : 128 bpm industrial: a heavy kick, off-beat reese, metal on metal
 *   dead drop        : 138 bpm swung spy jazz: walking bass, brushes, vibes, muted brass
 *
 * The operation plays along: a lock-on tone for threats, data chirps for DNS,
 * a launch rumble for new devices, and the eye of god has its own sounds
 * (sonar acquire, the dive, enhance blips, a teletype for the dossier, and a
 * low stamp for TARGET IDENTIFIED) while the music ducks under it.
 */

class ColdWar extends Style {
  readonly id = 'coldwar';
  readonly bpm = 92;
  readonly root = 36.71;                                   // D
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-2, 2, 5], [-5, -2, 2], [-3, 1, 4]];      // Dm Bb Gm A
  readonly barsPerChord = 2;
  readonly leadOct = 3;
  readonly level = 1;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (this.isChordStart(i)) s.pad(b, t, this.tones(i, 2), 0.013, this.barsPerChord * 16 * this.stepDur * 0.9, 900);
    const c = this.tones(i, 3);
    if (pos % 2 === 0) s.arp(b, t, c[[0, 2, 1, 2][(pos / 2) % 4]] * (pos === 12 ? 2 : 1), 0.014, 900 + m.tension * 1500, pos % 4 ? 0.35 : -0.35);
    if (pos % 4 === 0) s.bassPulse(b, t, this.tones(i, 1)[0], 0.06);
    if (pos === 0 || pos === 10) s.kick(b, t, 0.1);
    if (pos === 4 || pos === 12) s.noiseHit(b, t, { type: 'bandpass', f: 2200, q: 3, g: 0.03, a: 0.001, r: 0.04, pan: 0.2 });
    if (pos % 4 === 2) s.hat(b, t, 0.006, -0.3);
    if (m.night > 0.4 && pos === 0 && Math.floor(i / 16) % 4 === 3) s.taiko(b, t, 0.06, 0);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f, g * 0.4, 0.3, pan); }
}

class Intercept extends Style {
  readonly id = 'intercept';
  readonly bpm = 118;
  readonly root = 55;                                      // A
  readonly scale = [0, 2, 3, 5, 7, 10];
  readonly chords = [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -4, 0, 3], [-2, 2, 5, 9]];
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.8;
  private gate: boolean[] = [];

  enter(): void { this.newGate(); }
  private newGate(): void { this.gate = Array.from({ length: 16 }, (_, k) => k % 4 === 0 || Math.random() < 0.4); }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 && bar % 4 === 0) this.newGate();
    if (this.isChordStart(i)) for (const f of this.tones(i, 3)) s.glass(b, t, f, 0.006, (f % 2) - 0.5);
    if (pos === 0 || pos === 7 || pos === 10) s.kick(b, t, 0.13);
    if (pos === 4 || pos === 12) s.clap(b, t, 0.035, 0.1);
    if (this.gate[pos]) s.hat(b, t, 0.012, pos % 2 ? 0.4 : -0.4);
    if (Math.random() < 0.22 + m.tension * 0.2) {
      const c = this.tones(i, 5);
      s.chip(b, t, pick(c), 0.006, this.stepDur * 0.3, (Math.random() - 0.5) * 1.4);
    }
    if (pos % 2 === 0) s.tone(b, t, this.tones(i, 1)[0], { type: 'sine', g: 0.07, a: 0.004, r: 0.18, glide: 0.9 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.5, pan, 0.45); }
}

class DeepCover extends Style {
  readonly id = 'deepcover';
  readonly bpm = 70;
  readonly root = 41.2;                                    // E
  readonly scale = [0, 2, 3, 7, 8];
  readonly chords = [[0, 7, 12], [-4, 3, 8], [-2, 5, 10], [-5, 2, 7]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 1.2;
  private drone: (Bed & { glide(f: number[], t: number): void }) | null = null;

  enter(t: number): void {
    if (!this.drone) this.drone = this.s.drone(this.bus, this.tones(0, 1));
    this.drone.level.gain.setTargetAtTime(0.05, t, 2);
  }
  exit(t: number): void { this.drone?.level.gain.setTargetAtTime(0, t, 1); }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (this.isChordStart(i)) this.drone?.glide(this.tones(i, 1), t);
    if (pos === 0 && bar % 2 === 0) s.ping(b, t, this.tones(i, 5)[0], 0.02, -0.3);
    if (pos % 4 === 2 && Math.random() < 0.3) s.piano(b, t, pick(this.tones(i, 3)), 0.03, (Math.random() - 0.5), 0.4);
    if (m.tension > 0.3 && pos % 8 === 0) s.heart(b, t, 0.05 * m.tension);
    if (m.night > 0.5 && pos === 8 && bar % 4 === 1) s.swell(b, t, this.tones(i, 2)[1], 0.02, 5);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.piano(this.bus, t, f, g * 0.5, pan, 0.45); }
}

class ZeroDay extends Style {
  readonly id = 'zeroday';
  readonly bpm = 128;
  readonly root = 32.7;                                    // C
  readonly scale = [0, 1, 3, 5, 7, 8, 10];
  readonly chords = [[0, 7, 12], [0, 7, 12], [1, 8, 13], [-2, 5, 10]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.7;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos % 4 === 0) s.kick(b, t, 0.18);
    if (pos % 4 === 2) s.reese(b, t, this.tones(i, 1)[0] * 2, 0.03, this.stepDur * 1.2);
    if (pos === 4 || pos === 12) s.clap(b, t, 0.04, -0.1);
    s.hat(b, t, pos % 2 ? 0.006 : 0.011, pos % 4 === 1 ? 0.35 : -0.25);
    if (pos === 0 && bar % 4 === 2) s.scrape(b, t, 1600 + Math.random() * 800, 0.03, (Math.random() - 0.5));
    if (pos === 14 && (m.night > 0.3 || bar % 2 === 1)) s.noiseHit(b, t, { type: 'bandpass', f: 900, q: 8, g: 0.04, a: 0.001, r: 0.15, pan: 0.4, echo: 0.3 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.arp(this.bus, t, f, g * 0.5, 1800, pan); }
}

class DeadDrop extends Style {
  readonly id = 'deaddrop';
  readonly bpm = 138;
  readonly root = 41.2;                                    // E
  readonly scale = [0, 2, 3, 5, 7, 9, 11];                 // melodic minor
  readonly chords = [[0, 3, 7, 11], [5, 8, 12, 14], [7, 11, 14, 17], [0, 3, 7, 9]];   // Em(maj7) Am6 B7 Em6
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.9;
  private walk = 0;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const swing = pos % 4 === 2 ? this.stepDur * 0.33 : 0;
    const tt = t + swing;
    // walking bass on the beats
    if (pos % 4 === 0) {
      const c = this.tones(i, 1);
      const steps = [c[0], c[1], c[2], c[1] * 0.94];
      this.walk = (this.walk + 1) % 4;
      s.pluck(b, t, steps[pos / 4] ?? c[0], 0.07, -0.1, 0.15);
    }
    // ride and brushes
    if (pos % 4 === 0 || pos % 4 === 2) s.hat(b, tt, pos % 4 === 0 ? 0.012 : 0.008, 0.35, pos % 8 === 0);
    if (pos === 4 || pos === 12) s.noiseHit(b, t, { type: 'bandpass', f: 3000, q: 0.7, g: 0.03, a: 0.02, r: 0.18, pan: -0.2 });
    // vibes comping
    if ((pos === 0 || pos === 6) && Math.random() < 0.8) for (const f of this.tones(i, 3).slice(1)) s.bell(b, pos === 6 ? tt : t, f, 0.008, 0.25, 0.25);
    // muted brass stabs when tension rises
    if (m.tension > 0.25 && pos === 14) s.brass(b, tt, this.tones(i, 3)[0], 0.02, this.stepDur, 0.2);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.6, pan, 0.35); }
}

const STYLES: StyleDef[] = [
  { id: 'coldwar', name: 'Cold war', make: (s, b) => new ColdWar(s, b) },
  { id: 'intercept', name: 'Signal intercept', make: (s, b) => new Intercept(s, b) },
  { id: 'deepcover', name: 'Deep cover', make: (s, b) => new DeepCover(s, b) },
  { id: 'zeroday', name: 'Zero day', make: (s, b) => new ZeroDay(s, b) },
  { id: 'deaddrop', name: 'Dead drop', make: (s, b) => new DeadDrop(s, b) },
];

export const SPY_MUSIC: Array<[string, string]> = [['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name])];

class OpsConductor extends Conductor {
  private hum: Bed;
  private staticBed: Bed;
  private duck = 1;
  private duckTarget = 1;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'oMusicStyle', rotateKey: 'oMusicRotate', musicGain: 1.6 });
    this.hum = this.s.drone(this.amb, [55, 110.4, 164.6]);
    this.staticBed = this.s.rain(this.amb);
  }

  update(dt: number, state: State): void {
    super.update(dt, state);
    // the music steps back while the eye of god works
    if (Math.abs(this.duck - this.duckTarget) > 0.001) {
      this.duck += (this.duckTarget - this.duck) * Math.min(1, dt * 1.5);
      if (this.musicLevel > 0) this.music.set(this.musicLevel * this.duck, this.s.ctx.currentTime, 0.2);
    }
  }

  protected ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('oAmbience') : 0;
    const storm = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.hum, amb * 0.025, now);
    this.setBed(this.staticBed, amb * (0.012 + storm * 0.05), now);
  }

  protected threatStep(i: number, t: number, g: number): void {
    if (i % 16 === 0) {
      this.markHeart(t);
      if (this.notes) this.s.ping(this.sfxBus, t, this.chordAt(t, 5)[0], 0.012 * g, 0.4);
    }
  }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.core, s = this.s;
    const pan = this.panFor(srcIp);
    if (kind === 'allow') { this.playLead(srcIp); return; }
    if (!st.deviceVoices) return;
    const fx = this.setting<number>('oSfx');
    switch (kind) {
      case 'block': {
        this.bumpTension(0.04);
        if (Math.random() >= st.gateBlock * 0.4) return;
        const t = this.slot('block', 2, 0.6);
        if (t < 0) return;
        const f = this.chordAt(t, 3)[0];
        if (this.notes) s.tone(this.sfxBus, t, f * 2, { type: 'triangle', g: 0.02 * st.gBlock, a: 0.002, r: 0.25, glide: 0.5, pan, rev: 0.3 });
        s.noiseHit(this.sfxBus, t, { type: 'bandpass', f: 1200, q: 2, g: 0.02 * st.gBlock * fx, a: 0.001, r: 0.07, pan });
        return;
      }
      case 'threat': {
        this.bumpTension(0.22);
        if (Math.random() >= st.gateThreat) return;
        const t = this.slot('lock', 4, 1);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.tone(this.sfxBus, t, c[0], { type: 'triangle', g: 0.02 * st.gThreat, a: 0.01, h: 0.08, r: 0.1, pan, rev: 0.2 });
        s.tone(this.sfxBus, t + 0.18, c[0] * 1.5, { type: 'triangle', g: 0.02 * st.gThreat, a: 0.01, h: 0.12, r: 0.2, pan, rev: 0.3 });
        return;
      }
      case 'dns': {
        if (!this.notes || Math.random() >= st.gateDns * 0.35) return;
        const t = this.slot('dns', 1, 0.4);
        if (t < 0) return;
        const c = this.chordAt(t, 6);
        for (let k = 0; k < 4; k++) s.chip(this.sfxBus, t + k * 0.035, c[(k * 2) % c.length], 0.004 * st.gDns, 0.02, pan);
        return;
      }
      case 'dhcp': {
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('launch', 4, 1.2);
        if (t < 0) return;
        s.launch(this.sfxBus, t, this.chordAt(t, 1)[0], 0.035 * st.gDhcp * (0.5 + fx), pan);
        return;
      }
      case 'wifi': {
        if (Math.random() >= st.gateWifi * 0.7) return;
        const t = this.slot('wifi', 4, 1);
        if (t < 0) return;
        if (this.notes) this.chordAt(t, 4).forEach((f, k) => s.ping(this.sfxBus, t + k * this.cur.stepDur, f, 0.01 * st.gWifi, pan));
        else s.crackle(this.sfxBus, t, 0.03 * st.gWifi, pan);
        return;
      }
      case 'system': {
        const t = this.slot('sys', 4, 1.2);
        if (t < 0) return;
        s.shock(this.sfxBus, t, this.chordAt(t, 1)[0], 0.05);
        return;
      }
    }
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const s = this.s, fx = this.setting<number>('oSfx');
    if (name === 'eyeDuck') { this.duckTarget = opts.variant === '1' ? 0.5 : 1; return; }
    if (!this.core.deviceVoices || fx <= 0) return;
    const now = s.ctx.currentTime + 0.02;
    switch (name) {
      case 'acquire': {
        const f = this.notes ? this.chordAt(now, 5)[0] : 1318.5;
        s.ping(this.sfxBus, now, f, 0.05 * fx, 0);
        s.ping(this.sfxBus, now + 0.9, f, 0.035 * fx, 0);
        s.ping(this.sfxBus, now + 1.8, f * 1.5, 0.03 * fx, 0);
        return;
      }
      case 'dive':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 300, fTo: 2400, q: 1.2, g: 0.07 * fx, a: 2.6, r: 0.8, rev: 0.4 });
        s.tone(this.sfxBus, now, 80, { g: 0.08 * fx, a: 2.4, h: 0.3, r: 0.8, glide: 0.6 });
        return;
      case 'enhance': {
        const base = 1760 * Math.pow(2, (opts.count ?? 0) / 12);
        for (let k = 0; k < 3; k++) s.tone(this.sfxBus, now + k * 0.05, base * [1, 1.26, 1.5][k], { type: 'square', g: 0.012 * fx, a: 0.002, r: 0.05, lp: 5000, pan: 0.2 });
        s.noiseHit(this.sfxBus, now, { type: 'highpass', f: 6000, g: 0.025 * fx, a: 0.001, h: 0.3, r: 0.2, rate: 2 });
        return;
      }
      case 'type': {
        const n = Math.min(60, Math.round((opts.count ?? 200) / 6));
        for (let k = 0; k < n; k++) {
          const at = now + (k / n) * 3.5 + Math.random() * 0.03;
          s.noiseHit(this.sfxBus, at, { type: 'bandpass', f: 2500 + Math.random() * 1500, q: 4, g: 0.02 * fx, a: 0.001, r: 0.025, pan: 0.5 });
        }
        return;
      }
      case 'lock': {
        const f = this.notes ? this.chordAt(now, 5)[1] : 1568;
        s.tone(this.sfxBus, now, f, { type: 'triangle', g: 0.014 * fx, a: 0.003, r: 0.12, pan: 0.3, echo: 0.2 });
        return;
      }
      case 'stamp':
        s.boom(this.sfxBus, now, 0.12 * fx);
        s.noiseHit(this.sfxBus, now, { type: 'lowpass', f: 900, g: 0.08 * fx, a: 0.001, r: 0.12 });
        if (this.notes) for (const f of this.chordAt(now, 3)) s.tone(this.sfxBus, now, f, { type: 'triangle', g: 0.012 * fx, a: 0.01, r: 1.8, rev: 0.5 });
        return;
      case 'release':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 2400, fTo: 250, q: 1.2, g: 0.06 * fx, a: 0.4, r: 2.2, rev: 0.4 });
        return;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    if (kind === 'block' || kind === 'threat') s.noiseHit(this.sfxBus, when, { type: 'bandpass', f: 1400, q: 3, g: 0.012 * st.gBlock, a: 0.001, r: 0.05, pan });
    else if (this.notes) s.ping(this.sfxBus, when, pick(this.chordAt(when, 5)), 0.006 * (kind === 'allow' ? st.gAllow : st.gDns), pan);
  }
}

export function spyScore(e: AudioEngine): Score { return new OpsConductor(e); }
