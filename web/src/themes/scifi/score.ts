import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Synth } from '../../sound/synth';

/**
 * Orbital Command's soundtrack. Six styles take turns (or one is pinned, or
 * "Classic" hands back to the original generative band):
 *
 *   neon cruise    : synthwave: four-on-the-floor, octave bass, a saw hook
 *   blade cosmos   : slow brassy swells, cold bell arpeggios, a sub under it all
 *   stellar organ  : a pipe-organ ostinato over a ticking clock
 *   arcade         : a chiptune shooter: square bass, noise drums, a riff
 *   deep drift     : a drone, slow swells and pulsar pings in three-over-four
 *   fleet battle   : string ostinato, brass stabs, taiko drums
 *
 * The station's sounds play along, on the beat and in key: defense lasers and
 * explosions on every intercept, a rocket launch per threat, a warp-in for
 * each DHCP planet, rising pings for Wi-Fi joins, a shockwave for system
 * events, and a shield thump with a red-alert tone while rockets are alive.
 */

// ── neon cruise ────────────────────────────────────────────────────────────
class Neon extends Style {
  readonly id = 'neon';
  readonly bpm = 100;
  readonly root = 55;                                          // A
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];    // Am F C G
  readonly barsPerChord = 1;
  readonly leadOct = 3;
  private hook: number[] = [];

  enter(): void { this.newHook(); }
  private newHook(): void { this.hook = Array.from({ length: 3 }, () => (Math.random() * 3) | 0); }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const root = this.tones(i, 1)[0];
    if (this.isChordStart(i)) {
      s.pad(b, t, this.tones(i, 2), 0.016, 16 * this.stepDur * 0.9, 1100 + m.tension * 1400);
      if (bar % 8 === 0) this.newHook();
    }
    if (pos % 2 === 0) s.bassPulse(b, t, pos % 4 === 2 ? root * 2 : root, 0.075 + m.night * 0.02);
    if (pos % 4 === 0 && (m.night > 0.15 || pos === 0 || pos === 8)) s.kick(b, t, 0.15);
    if ((pos === 4 || pos === 12) && m.night > 0.2) s.snare(b, t, 0.055);
    if (pos % 4 === 2) s.hat(b, t, 0.02, 0.3);
    if (m.night > 0.5 && pos % 2 === 1) s.hat(b, t, 0.01, -0.3);
    if (m.night > 0.4) s.arp(b, t, this.tones(i, 4)[[0, 1, 2, 1][pos % 4]], 0.014, 2200 + m.tension * 1500, pos % 2 ? 0.4 : -0.4);
    if (bar % 4 === 3 && [0, 6, 10].includes(pos)) {
      const n = [0, 6, 10].indexOf(pos);
      s.sawLead(b, t, this.tones(i, 3)[this.hook[n]], 0.028, 4 * this.stepDur, n === 1 ? 0.25 : -0.15);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f, g * 0.45, 0.2, pan); }
}

// ── blade cosmos ───────────────────────────────────────────────────────────
class Cosmos extends Style {
  readonly id = 'cosmos';
  readonly level = 0.45;
  readonly bpm = 64;
  readonly root = 36.71;                                       // D
  readonly scale = [0, 2, 3, 5, 7, 9, 10];                     // dorian
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [7, 10, 14]];   // Dm Bb C Am
  readonly barsPerChord = 2;
  readonly leadOct = 4;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur * 0.85;
      const low = this.tones(i, 2);
      s.sawLead(b, t, low[0], 0.022, hold, -0.3);
      s.sawLead(b, t + 0.15, low[2], 0.016, hold * 0.9, 0.3);
      s.pad(b, t, this.tones(i, 3), 0.01, hold, 1500);
      s.tone(b, t, this.tones(i, 1)[0], { g: 0.07, a: 0.6, h: hold, r: 1.5 });
    }
    if (pos % 2 === 0 && Math.random() < 0.32 + m.night * 0.3) {
      s.bell(b, t, this.tones(i, 4)[(i / 2) % 3], 0.028, pos % 4 ? 0.5 : -0.5, 0.55);
    }
    if (m.night > 0.6 && bar % 2 === 1 && pos === 0) s.taiko(b, t, 0.12);
    if (m.night > 0.8 && pos === 12) s.tom(b, t, 80, 0.1, 0.2);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.bell(this.bus, t, f, g * 0.7, pan, 0.5); }
}

// ── stellar organ ──────────────────────────────────────────────────────────
class Organ extends Style {
  readonly id = 'organ';
  readonly level = 1.3;
  readonly bpm = 88;
  readonly root = 55;                                          // A
  readonly scale = [0, 2, 3, 5, 7, 8, 10];
  readonly chords = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [7, 10, 14]];   // Am F C Em
  readonly barsPerChord = 2;
  readonly leadOct = 3;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const mid = this.tones(i, 3);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur * 0.95;
      s.organ(b, t, this.tones(i, 2)[0], 0.012 + m.night * 0.006, hold, 0);
      if (m.night > 0.4) s.choir(b, t, this.tones(i, 2), 0.01 * m.night, hold * 0.8);
      if (bar % 8 === 0 && i > 0) s.boom(b, t, 0.05);
    }
    // the ostinato climbs through the chord on eighths
    if (pos % 2 === 0) {
      const k = [0, 2, 1, 2][(pos / 2) % 4];
      s.organ(b, t, mid[k], 0.009 + m.night * 0.004, this.stepDur * 1.5, (k - 1) * 0.35);
    }
    // the clock
    if (pos % 4 === 0) s.noiseHit(b, t, { type: 'bandpass', f: 5200, q: 8, g: 0.05, a: 0.001, r: 0.025, pan: 0.2 });
    if (m.night > 0.3 && pos % 4 === 2) s.noiseHit(b, t, { type: 'bandpass', f: 3200, q: 8, g: 0.035, a: 0.001, r: 0.025, pan: -0.2 });
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.organ(this.bus, t, f, g * 0.25, 0.15, pan); }
}

// ── arcade ─────────────────────────────────────────────────────────────────
class Arcade extends Style {
  readonly id = 'arcade';
  readonly level = 1.35;
  readonly bpm = 138;
  readonly root = 32.7;                                        // C
  readonly scale = [0, 3, 5, 7, 10];                           // minor pentatonic
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]];   // Cm Ab Bb Gm
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  private riff: number[] = [];

  enter(): void { this.newRiff(); }
  private newRiff(): void {
    let d = 5;
    this.riff = Array.from({ length: 8 }, (_, k) => {
      d = Math.max(2, Math.min(10, d + pick([-2, -1, 1, 1, 2, 0])));
      return k % 4 === 3 && Math.random() < 0.5 ? -1 : d;
    });
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const root = this.tones(i, 2)[0];
    if (bar % 8 === 0 && pos === 0) this.newRiff();
    if (pos % 2 === 0) s.chip(b, t, pos % 4 === 2 ? root * 2 : root, 0.022, this.stepDur * 1.2, -0.1);
    if (pos === 0 || pos === 8 || (m.night > 0.5 && pos === 6)) s.chipDrum(b, t, 0.09, false);
    if (pos === 4 || pos === 12) s.chipDrum(b, t, 0.05, true);
    if (m.night > 0.4 && pos % 2 === 1) s.chipDrum(b, t, 0.014, true);
    if (m.night > 0.25 || pos % 2 === 0) {
      s.chip(b, t, this.tones(i, 4)[[0, 1, 2, 1][pos % 4]], 0.008, this.stepDur * 0.6, 0.35);
    }
    if (bar % 2 === 1 && pos % 2 === 0) {
      const d = this.riff[pos / 2];
      if (d >= 0) s.chip(b, t, this.scaleTone(d, 4), 0.018, this.stepDur * 1.6, 0);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.chip(this.bus, t, f, g * 0.25, 0.06, pan, 1.5); }
}

// ── deep drift ─────────────────────────────────────────────────────────────
class Drift extends Style {
  readonly id = 'drift';
  readonly level = 0.45;
  readonly bpm = 56;
  readonly root = 41.2;                                        // E
  readonly scale = [0, 2, 4, 6, 7, 9, 11];                     // lydian
  readonly chords = [[0, 4, 7], [2, 6, 9], [-3, 0, 4], [-5, -1, 2]];    // E F# C#m B
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  private bed: ReturnType<Synth['drone']> | null = null;

  enter(t: number): void {
    this.bed = this.s.drone(this.bus, this.tones(0, 1));
    this.bed.level.gain.setTargetAtTime(0.05, t, 2);
  }
  exit(t: number): void {
    this.bed?.level.gain.setTargetAtTime(0, t, 1);
    this.bed?.stop(t + 5);
    this.bed = null;
  }

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    if (this.isChordStart(i)) {
      this.bed?.glide(this.tones(i, 1), t);
      s.swell(b, t, this.tones(i, 3)[(Math.random() * 3) | 0], 0.03, 8, (Math.random() - 0.5));
    }
    // pulsars: every third sixteenth against the four-beat bar
    if (i % (m.night > 0.3 ? 3 : 6) === 0) {
      const c = this.tones(i, 5);
      s.ping(b, t, c[(i / 3) % 3], 0.01, ((i / 3) % 2 ? 0.6 : -0.6));
    }
    if (m.night > 0.7 && pos === 0 && bar % 4 === 0) s.boom(b, t, 0.08);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.glass(this.bus, t, f, g * 0.8, pan); }
}

// ── fleet battle ───────────────────────────────────────────────────────────
class Battle extends Style {
  readonly id = 'battle';
  readonly level = 1.25;
  readonly bpm = 120;
  readonly root = 36.71;                                       // D
  readonly scale = [0, 2, 3, 5, 7, 8, 11];                     // harmonic minor
  readonly chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [7, 11, 14]];   // Dm Bb C A
  readonly barsPerChord = 1;
  readonly leadOct = 3;

  step(i: number, t: number, m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const mid = this.tones(i, 3);
    if (this.isChordStart(i)) {
      for (const [k, f] of this.tones(i, 2).entries()) s.sawLead(b, t, f, 0.014, 0.3, (k - 1) * 0.4);
      if (m.night > 0.6) s.choir(b, t, this.tones(i, 2), 0.01, 16 * this.stepDur * 0.8);
    }
    // the string ostinato: sixteenths when it's busy, eighths when it's calm
    if (m.night > 0.3 || pos % 2 === 0) {
      const k = [0, 0, 2, 0, 1, 0, 2, 0][pos % 8];
      s.strings(b, t, k === 0 ? mid[0] : mid[k], pos % 4 === 0 ? 0.022 : 0.015, pos % 2 ? 0.3 : -0.3);
    }
    if (pos === 0) s.taiko(b, t, 0.14);
    if (m.night > 0.3 && (pos === 6 || pos === 10)) s.taiko(b, t, 0.09, pos === 6 ? -0.3 : 0.3);
    if (m.night > 0.6 && pos === 12) s.snare(b, t, 0.05);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f, g * 0.45, 0.2, pan); }
}

// ── the conductor ──────────────────────────────────────────────────────────
const STYLES: StyleDef[] = [
  { id: 'neon', name: 'Neon cruise', make: (s, b) => new Neon(s, b) },
  { id: 'cosmos', name: 'Blade cosmos', make: (s, b) => new Cosmos(s, b) },
  { id: 'organ', name: 'Stellar organ', make: (s, b) => new Organ(s, b) },
  { id: 'arcade', name: 'Arcade', make: (s, b) => new Arcade(s, b) },
  { id: 'drift', name: 'Deep drift', make: (s, b) => new Drift(s, b) },
  { id: 'battle', name: 'Fleet battle', make: (s, b) => new Battle(s, b) },
];

export const SCIFI_MUSIC: Array<[string, string]> = [
  ['rotate', 'Rotate'], ...STYLES.map((d): [string, string] => [d.id, d.name]), ['classic', 'Classic band'],
];

class OrbitalConductor extends Conductor {
  private hum: ReturnType<Synth['drone']>;
  private wind: Bed;

  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'sMusicStyle', rotateKey: 'sMusicRotate' });
    this.hum = this.s.drone(this.amb, [55, 82.41, 110]);
    this.wind = this.s.wind(this.amb);
  }

  passthrough(): boolean { return this.setting<string>('sMusicStyle') === 'classic'; }

  protected handover(t: number): void { this.s.warp(this.sfxBus, t, this.chordAt(t, 3)[0], 0.03); }

  /** The station hums, space hisses, and storms crackle over the radio. */
  protected ambience(dt: number, state: State, now: number, on: boolean): void {
    const amb = on ? this.setting<number>('sAmbience') : 0;
    this.setBed(this.hum, amb * (0.05 + this.mood.night * 0.03), now);
    this.setBed(this.wind, amb * (0.06 + this.mood.night * 0.12), now);
    if (amb > 0 && state.weather !== 'calm' && Math.random() < dt * this.mood.night * 1.5) {
      this.s.crackle(this.amb, now + 0.05, 0.05 * amb, (Math.random() - 0.5) * 1.6);
    }
  }

  /** Rockets alive: a shield thump every two beats, a red-alert tone every four bars. */
  protected threatStep(i: number, t: number, g: number): void {
    const bars4 = this.cur.barSteps * 4;
    if (i % 8 === 0) { this.s.taiko(this.sfxBus, t, 0.09 * g); this.markHeart(t); }
    if (i % bars4 === 0) this.s.alert(this.sfxBus, t, this.chordAt(t, 4)[0], 0.025 * g, this.cur.stepDur * 4);
  }

  private get weapons(): number { return this.setting<number>('sWeapons'); }

  cue(kind: Cue, srcIp?: string): void {
    const st = this.core, s = this.s;
    const pan = this.panFor(srcIp);
    if (kind === 'allow') { this.playLead(srcIp); return; }
    if (!st.deviceVoices) return;
    switch (kind) {
      case 'block': {
        // contact: a low sonar ping as the asteroid appears (the laser comes on intercept)
        this.bumpTension(0.05);
        if (Math.random() >= st.gateBlock * 0.5) return;
        const t = this.slot('contact', 4, 1);
        if (t < 0) return;
        s.ping(this.sfxBus, t, this.chordAt(t, 3)[0], 0.025 * st.gBlock, pan);
        return;
      }
      case 'threat': {
        this.bumpTension(0.25);
        if (Math.random() >= st.gateThreat) return;
        const t = this.slot('launch', 2, 0.8);
        if (t < 0) return;
        s.launch(this.sfxBus, t, this.chordAt(t, 1)[0], 0.05 * st.gThreat, pan);
        return;
      }
      case 'dns': {
        if (Math.random() >= st.gateDns * 0.3) return;
        const t = this.slot('dns', 2, 0.5);
        if (t < 0) return;
        s.ping(this.sfxBus, t, this.chordAt(t, 5)[(Math.random() * 3) | 0], 0.012 * st.gDns, pan);
        return;
      }
      case 'dhcp': {
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('warp', 4, 1.5);
        if (t < 0) return;
        s.warp(this.sfxBus, t, this.chordAt(t, 3)[pick([0, 1, 2])], 0.04 * st.gDhcp, pan);
        return;
      }
      case 'system': {
        const t = this.slot('shock', 4, 1.2);
        if (t < 0) return;
        s.shock(this.sfxBus, t, this.chordAt(t, 1)[0], 0.07);
        return;
      }
    }
  }

  sfx(name: string, opts: SfxOpts = {}): void {
    const st = this.core, s = this.s;
    if (!st.deviceVoices) return;
    const pan = opts.pan ?? 0;
    const w = this.weapons;
    switch (name) {
      case 'intercept':
      case 'rocket': {
        if (w <= 0) return;
        const big = name === 'rocket';
        const t = this.slot('laser', 0.5, 0.3);
        if (t < 0) return;
        const c = this.chordAt(t, 3);
        s.zap(this.sfxBus, t, c[pick([0, 1, 2])], 0.05 * w, pan * 0.5);
        s.blast(this.sfxBus, t + this.cur.stepDur / 2, (big ? 0.2 : 0.12) * w, pan, c[0] * 2, big);
        this.bumpTension(big ? 0.05 : 0.02);
        return;
      }
      case 'impact': {
        if (w <= 0) return;
        const t = this.slot('impact', 1, 0.3);
        if (t < 0) return;
        s.blast(this.sfxBus, t, 0.24 * w, pan, this.chordAt(t, 2)[0], true);
        s.boom(this.sfxBus, t, 0.1 * w);
        return;
      }
      case 'wifi': {
        if (Math.random() >= st.gateWifi * 0.8) return;
        const t = this.slot('wifi', 4, 1);
        if (t < 0) return;
        const c = this.chordAt(t, 4);
        if (opts.variant === 'joined') {
          c.forEach((f, k) => s.ping(this.sfxBus, t + k * this.cur.stepDur, f, 0.016 * st.gWifi, pan));
        } else if (opts.variant === 'bad') {
          s.zap(this.sfxBus, t, c[0] / 2, 0.03 * st.gWifi, pan);
        } else {
          s.ping(this.sfxBus, t, c[1], 0.012 * st.gWifi, pan);
        }
        return;
      }
    }
  }

  /** Noise gate (raw feed): small versions of the station's sounds. */
  noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(10)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const c = this.chordAt(when, 4);
    switch (kind) {
      case 'block': case 'threat':
        s.zap(this.sfxBus, when, pick(c) / 2, 0.02 * this.weapons * st.gBlock, pan);
        break;
      case 'dns':
        s.ping(this.sfxBus, when, pick(c) * 2, 0.008 * st.gDns, pan);
        break;
      default:
        s.chip(this.sfxBus, when, pick(c), 0.01 * (kind === 'allow' ? st.gAllow : kind === 'wifi' ? st.gWifi : st.gDhcp), 0.05, pan);
    }
  }
}

export function scifiScore(e: AudioEngine): Score { return new OrbitalConductor(e); }
