import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed } from '../../sound/synth';

/**
 * FRAGNET's soundtrack: corridor-shooter metal through a blown-out console.
 *
 *   riff city   : 150 bpm thrash, galloping low saw, crashy hats, a scream
 *                 of a lead when the marine is shooting
 *   machine god : 132 bpm industrial EBM, gated reese stabs, marching snare
 *   grave drip  : 76 bpm doom crawl, one grinding note, dripping caverns
 *
 * The marine plays along: the shotgun crack, a demon's pain growl, the wet
 * pop of a frag, blast doors, the pickup blip, teleporter sweeps and distant
 * thunder when the systems talk. Boiler hum and a low hell rumble underneath.
 */

class RiffCity extends Style {
  readonly id = 'riffcity';
  readonly bpm = 150;
  readonly root = 41.2;                                       // E
  readonly scale = [0, 2, 3, 5, 6, 7, 10];
  readonly chords = [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [-5, -2, 2]];
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.62;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (pos % 4 === 0) s.kick(b, t, 0.17);
    if (pos === 3 || pos === 7 || pos === 11 || pos === 14) s.kick(b, t, 0.12);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.085, 0.05);
    if (pos % 2 === 1) s.hat(b, t, 0.012, pos % 4 ? 0.35 : -0.35);
    if (pos % 8 === 0 || pos === 6 || pos === 14) s.reese(b, t, this.tones(i, 1)[0], 0.055, this.stepDur * 1.7);
    if ((pos === 2 || pos === 10) && Math.random() < 0.5) s.noiseHit(b, t, { type: 'bandpass', f: 3200, q: 3, g: 0.02, a: 0.001, h: 0.01, r: 0.12, pan: 0.4 });
    if (m.tension > 0.45 && pos % 4 === 2) s.supersaw(b, t, this.tones(i, 3)[0] * 2, 0.007, this.stepDur * 1.4, -0.3);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.tone(this.bus, t, f, { type: 'sawtooth', g: g * 0.5, a: 0.002, h: 0.07, r: 0.1, lp: 3400, detune: 12, pan, echo: 0.25 });
  }
}

class MachineGod extends Style {
  readonly id = 'machinegod';
  readonly bpm = 132;
  readonly root = 32.7;                                       // C
  readonly scale = [0, 1, 3, 6, 7, 10];
  readonly chords = [[0, 3, 7], [-1, 2, 6], [0, 3, 7], [5, 8, 12]];
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.6;
  private stab: number[] = [0, -1, -1, 0, -1, 3, -1, -1, 0, -1, -1, 2, -1, 0, -1, -1];

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (pos % 4 === 0) s.kick(b, t, 0.19);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.07, 0.04);
    if (pos % 2 === 0) s.hat(b, t, 0.01, pos % 4 ? 0.3 : -0.3);
    const n = this.stab[pos];
    if (n >= 0) s.tone(b, t, this.tones(i, 1)[0] * Math.pow(2, n / 12), { type: 'square', g: 0.03, a: 0.002, h: this.stepDur * 0.6, r: 0.05, lp: 900, pan: -0.15 });
    if (this.isChordStart(i)) s.reese(b, t, this.tones(i, 1)[0], 0.05, this.barsPerChord * 16 * this.stepDur * 0.45);
    if (m.tension > 0.3 && pos === 8) s.tom(b, t, 110, 0.045, 0.2);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.chip(this.bus, t, f, g * 0.4, 0.07, pan); }
}

class GraveDrip extends Style {
  readonly id = 'gravdrip';
  readonly bpm = 76;
  readonly root = 27.5;                                       // A1
  readonly scale = [0, 1, 3, 5, 6, 8, 10];
  readonly chords = [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [0, 3, 7]];
  readonly barsPerChord = 4;
  readonly leadOct = 4;
  readonly level = 0.64;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (pos === 0 && bar % 2 === 0) s.kick(b, t, 0.16);
    if (pos === 8) s.tom(b, t, 82, 0.05, -0.25);
    if (this.isChordStart(i)) s.pad(b, t, this.tones(i, 2), 0.013, this.barsPerChord * 16 * this.stepDur * 0.9, 300);
    if ((pos === 5 || pos === 13) && Math.random() < 0.35) {
      s.bell(b, t, 400 + Math.random() * 900, 0.006, (Math.random() - 0.5) * 1.4, 0.7);
    }
    if (m.tension > 0.4 && pos === 12 && bar % 4 === 3) s.noiseHit(b, t, { type: 'lowpass', f: 400, q: 1, g: 0.03, a: 0.3, h: 0.8, r: 1.2, pan: 0.3, rev: 0.7 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f * 2, g * 0.4, pan, 0.5); }
}

const STYLES: StyleDef[] = [
  { id: 'riffcity', name: 'Riff city', make: (s, b) => new RiffCity(s, b) },
  { id: 'machinegod', name: 'Machine god', make: (s, b) => new MachineGod(s, b) },
  { id: 'grave', name: 'Grave drip', make: (s, b) => new GraveDrip(s, b) },
];

export const FRAGNET_MUSIC: Array<[string, string]> = [['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name])];

class HellConductor extends Conductor {
  private boiler: Bed;
  private rumble: Bed;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'dMusicStyle', rotateKey: 'dMusicRotate', musicGain: 1.4 });
    this.s.budget = 170;
    this.boiler = this.s.wind(this.amb);
    this.rumble = this.s.drone(this.amb, [27.5, 41.2, 55]);
  }

  protected ambience(_dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('dAmbience') : 0;
    const hot = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0;
    this.setBed(this.boiler, amb * (0.03 + hot * 0.03), now);
    this.setBed(this.rumble, amb * (0.014 + hot * 0.03), now);
  }

  protected threatStep(i: number, t: number, g: number): void {
    if (i % 8 === 0) this.markHeart(t);
    if (i % 4 === 2) this.s.tom(this.sfxBus, t, 70 + (i % 3) * 14, 0.03 * g, 0.2);
  }

  cue(kind: Cue, srcIp?: string): void {
    if (kind === 'allow') { this.playLead(srcIp, 0.04); return; }
    if (kind === 'block') this.bumpTension(0.06);
    else if (kind === 'threat') this.bumpTension(0.3);
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const s = this.s, st = this.core, fx = this.setting<number>('dSfx');
    if (!st.deviceVoices || fx <= 0) return;
    const pan = Math.max(-0.9, Math.min(0.9, (opts.pan ?? 0)));
    const now = s.ctx.currentTime + 0.02;
    switch (name) {
      case 'shot':
        s.boom(this.sfxBus, now, 0.11 * fx * st.gAllow);
        s.crackle(this.sfxBus, now, 0.055 * fx * st.gAllow, pan);
        return;
      case 'growl':
        s.tone(this.sfxBus, now, 92, { type: 'sawtooth', g: 0.05 * fx, a: 0.02, h: 0.2, r: 0.28, glide: 0.55, lp: 480, q: 4, pan, rev: 0.4 });
        return;
      case 'claw':
        s.noiseHit(this.sfxBus, now, { type: 'bandpass', f: 900, fTo: 220, q: 2.5, g: 0.05 * fx, a: 0.005, h: 0.08, r: 0.25, pan, rev: 0.3 });
        return;
      case 'pop':
        s.boom(this.sfxBus, now, 0.07 * fx);
        s.crackle(this.sfxBus, now + 0.02, 0.035 * fx, pan);
        return;
      case 'fragged':
        s.boom(this.sfxBus, now, 0.12 * fx);
        if (this.notes) for (const f of this.chordAt(now, 3)) s.supersaw(this.sfxBus, now, f, 0.012 * fx, 0.5, pan);
        return;
      case 'door':
        s.tone(this.sfxBus, now, 130, { type: 'square', g: 0.03 * fx * st.gBlock, a: 0.02, h: 0.6, r: 0.15, glide: 0.7, lp: 520, q: 3, pan });
        s.noiseHit(this.sfxBus, now + 0.55, { type: 'lowpass', f: 300, q: 1, g: 0.03 * fx * st.gBlock, a: 0.01, h: 0.1, r: 0.2, pan });
        return;
      case 'secret': {
        if (!this.notes) return;
        const t = this.slot('secret', 6, 0.5);
        if (t < 0) return;
        this.chordAt(t, 4).forEach((f, k) => s.ping(this.sfxBus, t + k * this.cur.stepDur * 0.5, f * 2, 0.012 * fx * st.gDhcp, pan));
        return;
      }
      case 'pickup':
        s.chip(this.sfxBus, now, 660, 0.016 * fx * st.gAllow, 0.05, pan);
        s.chip(this.sfxBus, now + 0.07, 990, 0.016 * fx * st.gAllow, 0.05, pan);
        return;
      case 'teleport':
        s.tone(this.sfxBus, now, 180, { type: 'sine', g: 0.035 * fx * st.gWifi, a: 0.25, h: 0.5, r: 0.3, glide: 3.4, pan, rev: 0.5 });
        return;
      case 'zap':
        s.crackle(this.sfxBus, now, 0.05 * fx * st.gWifi, pan);
        s.tone(this.sfxBus, now, 1400, { type: 'square', g: 0.02 * fx * st.gWifi, a: 0.002, h: 0.03, r: 0.1, glide: 0.3, pan });
        return;
      case 'thunder':
        s.noiseHit(this.sfxBus, now, { type: 'lowpass', f: 260, q: 1, g: 0.05 * fx, a: 0.06, h: 0.5, r: 1.4, pan: 0, rev: 0.8 });
        return;
    }
  }

  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    if (kind === 'block' || kind === 'threat') s.noiseHit(this.sfxBus, when, { type: 'bandpass', f: 1200, q: 3, g: 0.01 * st.gBlock, a: 0.001, r: 0.06, pan });
    else if (this.notes) s.chip(this.sfxBus, when, pick(this.chordAt(when, 5)), 0.004 * (kind === 'allow' ? st.gAllow : st.gDns), 0.03, pan);
  }
}

export function fragnetScore(e: AudioEngine): Score { return new HellConductor(e); }
