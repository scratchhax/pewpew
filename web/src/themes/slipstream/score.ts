import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, type Mood, type StyleDef } from '../../sound/conductor';

/**
 * SLIPSTREAM's soundtrack: 16-bit race-pop through a cartridge speaker.
 *
 *   green flag   : 168 bpm chip four-on-the-floor, walking bass blips, a
 *                  lead that runs the circuit like the karts do
 *   sunset drift : 138 bpm cruising organ rock, tom heartbeat, wide pads
 *
 * On top: the start-lights beeps, the pit radio blip, the shell's screaming
 * fly-past, spin-out slides, lap chimes — and a square-wave engine purr
 * whose pitch rides the hero's speed.
 */

class GreenFlag extends Style {
  readonly id = 'green';
  readonly bpm = 168;
  readonly root = 41.2;                                      // E
  readonly scale = [0, 2, 4, 7, 9];
  readonly chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.6;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    if (pos % 4 === 0) s.kick(b, t, 0.15);
    if (pos === 4 || pos === 12) s.snare(b, t, 0.06, pos === 12 ? 0.3 : -0.3);
    if (pos % 2 === 1) s.hat(b, t, 0.013, pos % 4 ? 0.35 : -0.35);
    // chip bassline: root eighths with a pickup
    if (pos % 2 === 0) {
      const bass = this.tones(i, 1)[0] * (pos === 6 || pos === 14 ? 2 : 1);
      s.chip(b, t, bass, 0.03, this.stepDur * 0.9, pos % 4 ? 0.3 : -0.3);
    }
    if (m.tension > 0.4 && pos === 8) s.chip(b, t, this.tones(i, 5)[0], 0.012, 0.1, 0.4, 5);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.chip(this.bus, t, f, g, 0.16, pan, 0);
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
    if (pos % 8 === 0) s.kick(b, t, 0.11);
    if (pos % 8 === 4) s.tom(b, t, 110, 0.05, 0.2);
    if (pos % 4 === 2) s.hat(b, t, 0.01, 0.4);
    if (pos === 0) s.organ(b, t, this.tones(i, 3)[0], 0.028, this.stepDur * 14, -0.3);
    if ((pos === 6 || pos === 10) && this.id) s.chip(b, t, this.tones(i, 4)[2] ?? this.tones(i, 4)[0], 0.008, 0.2, 0.4);
    if (m.tension > 0.5 && pos === 12) s.snare(b, t, 0.03, 0);
  }

  lead(t: number, f: number, g: number, pan: number): void {
    this.s.piano(this.bus, t, f, g * 1.2, pan);
  }
}

const STYLES: StyleDef[] = [
  { id: 'green', name: 'Green flag — chip race-pop', make: (s, bus) => new GreenFlag(s, bus) },
  { id: 'sunset', name: 'Sunset drift — cruising', make: (s, bus) => new SunsetDrift(s, bus) },
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
