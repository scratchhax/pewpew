import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';
import type { Bed, Bus } from '../../sound/synth';

/**
 * The Rain's soundtrack: the red-pilot scene, not the club. Three drone
 * styles that follow the traffic instead of a clock - no drums, ever; the
 * weather changes how dense and how dark the drones are, never adds a beat:
 *
 *   drizzle (calm)      : one low drone breathing under a slow minor pad,
 *                         a lone high note now and then.
 *   shower  (storm)     : the drone doubles, a choir joins on the changes,
 *                         swells drift past.
 *   deluge  (hurricane) : a dissonant cluster - root and minor second
 *                         grinding, choir thick, chords turning every bar.
 *
 * The weather is the traffic, so the music follows the weather. Event
 * sounds are hardware, not hydrology: DNS is a data blip, a block is a
 * snare crack and a zap, a threat is the alarm - two-tone siren, crash,
 * and a blast underneath.
 */

// Am - Am - F - G, the key of "someone is watching you"
const CHORDS = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// ── drizzle: one drone, breathing ────────────────────────────────────────────
class Drizzle extends Style {
  readonly id = 'drizzle';
  readonly bpm = 40;
  readonly root = 55;                                             // A1
  readonly scale = MINOR;
  readonly chords = CHORDS;
  readonly barsPerChord = 4;
  readonly leadOct = 5;
  readonly level = 1.05;

  step(i: number, t: number, _m: Mood): void {
    const s = this.s, b = this.bus;
    const tones = this.tones(i, 1);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.reese(b, t, tones[0] / 2, 0.05, hold * 0.95);
      s.pad(b, t, tones.map((f) => f * 2), 0.012, hold, 340);
      s.cello(b, t, tones[0] * 2, 0.018, hold * 0.6, -0.3);
    }
    // a lone high note, drifting, rarely
    if (i % 16 === 8 && Math.random() < 0.12) {
      s.strings(b, t, tones[pick([1, 2])] * 4, 0.012, (Math.random() - 0.5) * 1.2);
    }
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.ping(this.bus, t, f * 2, g * 0.3, pan); }
}

// ── shower: the drone doubles, a choir joins ─────────────────────────────────
class Shower extends Style {
  readonly id = 'shower';
  readonly bpm = 52;
  readonly root = 55;
  readonly scale = MINOR;
  readonly chords = CHORDS;
  readonly barsPerChord = 2;
  readonly leadOct = 5;
  readonly level = 1;

  step(i: number, t: number, _m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const tones = this.tones(i, 1);
    if (this.isChordStart(i)) {
      const hold = this.barsPerChord * 16 * this.stepDur;
      s.reese(b, t, tones[0] / 2, 0.06, hold * 0.95);
      s.pad(b, t, tones.map((f) => f * 2), 0.014, hold, 420);
      s.choir(b, t, tones.map((f) => f * 2), 0.01, hold * 0.8);
      s.cello(b, t, tones[0] * 2, 0.02, hold * 0.5, 0.25);
    }
    // the second drone, a fifth below, breathing against the first
    if (pos === 0 && bar % 2 === 1) s.reese(b, t, tones[0] * 0.75, 0.04, this.barsPerChord * 16 * this.stepDur * 0.5);
    // a swell drifting past, off one ear or the other
    if (pos === 12 && Math.random() < 0.15) s.swell(b, t, tones[1] * 4, 0.012, 2.5, Math.random() < 0.5 ? -0.5 : 0.5);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.ping(this.bus, t, f * 2, g * 0.3, pan); }
}

// ── deluge: the cluster ──────────────────────────────────────────────────────
class Deluge extends Style {
  readonly id = 'deluge';
  readonly bpm = 60;
  readonly root = 55;
  readonly scale = MINOR;
  readonly chords = CHORDS;
  readonly barsPerChord = 1;
  readonly leadOct = 5;
  readonly level = 0.95;

  step(i: number, t: number, _m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const tones = this.tones(i, 1);
    const root = tones[0] / 2;
    if (this.isChordStart(i)) {
      const hold = 16 * this.stepDur;
      // root and minor second grinding: the drone with a blade in it
      s.reese(b, t, root, 0.07, hold * 0.95);
      s.reese(b, t, root * 1.0595, 0.035, hold * 0.9);
      s.pad(b, t, tones.map((f) => f * 2), 0.016, hold, 500);
      s.choir(b, t, tones.map((f) => f * 2), 0.014, hold * 0.9);
      s.cello(b, t, tones[0] * 2, 0.025, hold * 0.6, -0.2);
    }
    if (pos === 8) s.strings(b, t, tones[1] * 4, 0.014, 0.3);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.ping(this.bus, t, f * 2, g * 0.3, pan); }
}

// ── the conductor ────────────────────────────────────────────────────────────
const STYLES: StyleDef[] = [
  { id: 'drizzle', name: 'Drizzle', make: (s, b) => new Drizzle(s, b) },
  { id: 'shower', name: 'Shower', make: (s, b) => new Shower(s, b) },
  { id: 'deluge', name: 'Deluge', make: (s, b) => new Deluge(s, b) },
];

class RainConductor extends Conductor {
  private rain: Bed | null = null;
  private wind: Bed | null = null;
  private keys: { music: string; amb: string };

  constructor(e: AudioEngine, keys?: { music: string; amb: string }, beds = true) {
    super(e, { styles: STYLES, styleKey: keys?.music ?? 'rMusicStyle', rotateKey: keys?.music ?? 'rMusicStyle' });
    this.keys = keys ?? { music: 'rMusicStyle', amb: 'rRainAmb' };
    if (beds) {
      this.rain = this.s.rain(this.amb);
      this.wind = this.makeWind(this.amb);
    }
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
    const pinned = this.setting<string>(this.cfg.styleKey);
    if (pinned !== 'auto' && this.styles.has(pinned)) return pinned;
    const n = this.mood.night;
    return n < 0.25 ? 'drizzle' : n < 0.6 ? 'shower' : 'deluge';
  }

  protected override ambience(_dt: number, state: State, now: number, on: boolean): void {
    if (!this.rain || !this.wind) return;
    const amb = on ? this.setting<number>(this.keys.amb) : 0;
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
        // a lookup: one data blip, echoing down the corridor
        if (Math.random() >= st.gateDns * 0.3) return;
        const t = this.slot('blip', 2, 0.5);
        if (t < 0) return;
        const c = this.chordAt(t, 5);
        s.ping(this.sfxBus, t, c[pick([1, 2])] * 4, 0.022 * st.gDns, pan);
        return;
      }
      case 'block': {
        // denied: a snare crack and a zap - the door is shut
        this.bumpTension(0.04);
        if (Math.random() >= st.gateBlock * 0.6) return;
        const t = this.slot('crack', 2, 1);
        if (t < 0) return;
        s.snare(this.sfxBus, t, 0.09 * st.gBlock, pan);
        s.zap(this.sfxBus, t + 0.02, this.chordAt(t, 2)[0], 0.05 * st.gBlock, pan);
        return;
      }
      case 'threat': {
        // the alarm: two-tone siren, crash, and a blast underneath
        this.bumpTension(0.22);
        if (Math.random() >= st.gateThreat) return;
        const t = this.slot('alarm', 4, 1.5);
        if (t < 0) return;
        const f = this.chordAt(t, 3)[0];
        s.alert(this.sfxBus, t, f * 4, 0.05 * st.gThreat, 0.28);
        s.crash(this.sfxBus, t, 0.05 * st.gThreat, pan, f * 4);
        s.blast(this.sfxBus, t + 0.05, 0.07 * st.gThreat, pan, f);
        return;
      }
      case 'dhcp': {
        // a lease: a kick thump and a blip for the new tenant
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('thump', 4, 1);
        if (t < 0) return;
        s.kick(this.sfxBus, t, 0.1 * st.gDhcp);
        s.ping(this.sfxBus, t + 0.05, this.chordAt(t, 4)[pick([0, 2])] * 4, 0.018 * st.gDhcp, pan);
        return;
      }
      case 'wifi': {
        if (Math.random() >= st.gateWifi * 0.8) return;
        const t = this.slot('join', 4, 1);
        if (t < 0) return;
        s.hat(this.sfxBus, t, 0.025 * st.gWifi, pan, true);
        s.ping(this.sfxBus, t + 0.03, this.chordAt(t, 4)[pick([0, 1, 2])] * 4, 0.016 * st.gWifi, -pan);
        return;
      }
      case 'system': {
        const t = this.slot('low', 4, 1.2);
        if (t < 0) return;
        s.boom(this.sfxBus, t, 0.05);
        s.reese(this.sfxBus, t, this.chordAt(t, 1)[0] / 2, 0.05, 0.6);
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
    if (kind === 'threat') {
      s.blast(this.sfxBus, when, 0.07 * st.gThreat, pan, chord[0]);
    } else if (kind === 'block') {
      s.snare(this.sfxBus, when, 0.07 * st.gBlock, pan);
    } else if (this.notes) {
      s.ping(this.sfxBus, when, chord[pick([0, 1, 2])] * 2, 0.014 * (kind === 'allow' ? st.gAllow : kind === 'dns' ? st.gDns : st.gDhcp), pan);
    }
  }
}

export function rainScore(e: AudioEngine): Score { return new RainConductor(e); }

/** The same score played by another scene with its own setting keys.
 *  `beds: false` drops the rain hiss and wind - not every scene is wet. */
export function rainScoreFor(e: AudioEngine, music: string, amb: string, beds = true): Score {
  return new RainConductor(e, { music, amb }, beds);
}
