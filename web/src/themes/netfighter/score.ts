import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Conductor, Style, pick, type Mood, type StyleDef } from '../../sound/conductor';

/**
 * Net Fighter's soundtrack: a synth-rock battle theme for a street fight.
 * Three styles that follow the weather:
 *
 *   sparring (calm)     : a driving bass eighth-note groove, tight hats,
 *                         organ stabs - the warm-up.
 *   intense  (storm)    : full drums, power chords on the eighths, a saw
 *                         lead riff over the top.
 *   boss     (hurricane): heavy - guitar chugs, crash, supersaw lead, tom
 *                         rolls under the chaos.
 *
 * Event sounds are fight sounds, and they land on the beat: a jab is a
 * square stab, a kick a snare and a zap, a threat a siren and a blast,
 * a K.O. a gong and a fall.
 */

// Em - Em - C - D: the key of "walk it off"
const CHORDS = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// ── sparring: the groove ─────────────────────────────────────────────────────
class Sparring extends Style {
  readonly id = 'sparring';
  readonly bpm = 112;
  readonly root = 82;                                             // E2
  readonly scale = MINOR;
  readonly chords = CHORDS;
  readonly barsPerChord = 2;
  readonly leadOct = 4;
  readonly level = 0.9;

  step(i: number, t: number, _m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16;
    const tones = this.tones(i, 1);
    if (pos % 4 === 0) s.kick(b, t, 0.1);
    if (pos === 4 || pos === 12) s.hat(b, t, 0.02, 0.2);
    if (pos % 2 === 0) s.bassPulse(b, t, tones[0] / 2, 0.05);
    if (this.isChordStart(i)) s.organ(b, t, tones[1] * 2, 0.03, 16 * this.stepDur * 1.6, 0.15);
    if (pos === 14 && Math.random() < 0.3) s.pluck(b, t, tones[pick([0, 1, 2])] * 4, 0.03, 0.3);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.organ(this.bus, t, f * 2, g * 0.4, 0.18, pan); }
}

// ── intense: the fight is on ─────────────────────────────────────────────────
class Intense extends Style {
  readonly id = 'intense';
  readonly bpm = 140;
  readonly root = 82;
  readonly scale = MINOR;
  readonly chords = CHORDS;
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 0.95;

  step(i: number, t: number, _m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const tones = this.tones(i, 1);
    if (pos % 4 === 0) s.kick(b, t, 0.13);
    if (pos === 4 || pos === 12) { s.snare(b, t, 0.09); s.clap(b, t, 0.05, 0); }
    if (pos % 2 === 0) s.hat(b, t, 0.016, 0.25);
    // power chords on the eighths, fifth on the offbeat
    if (pos % 2 === 0) s.reese(b, t, tones[0] / 2 * (pos % 4 === 2 ? 1.5 : 1), 0.06, this.stepDur * 1.6);
    if (this.isChordStart(i)) s.pad(b, t, tones.map((f) => f * 2), 0.012, 16 * this.stepDur * 0.9, 700);
    // the riff: a two-note saw hook at the top of each bar
    if (pos === 0 || pos === 8) s.sawLead(b, t, tones[1] * 4, 0.04, this.stepDur * 1.4, -0.2);
    if (pos === 11) s.sawLead(b, t, tones[2] * 4, 0.035, this.stepDur * 0.9, 0.2);
    if (pos === 0 && bar % 4 === 0) s.crash(b, t, 0.04, 0.3, tones[0] * 4);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.sawLead(this.bus, t, f * 2, g * 0.45, 0.16, pan); }
}

// ── boss: final round ────────────────────────────────────────────────────────
class Boss extends Style {
  readonly id = 'boss';
  readonly bpm = 160;
  readonly root = 82;
  readonly scale = MINOR;
  readonly chords = CHORDS;
  readonly barsPerChord = 1;
  readonly leadOct = 4;
  readonly level = 1;

  step(i: number, t: number, _m: Mood): void {
    const s = this.s, b = this.bus, pos = i % 16, bar = Math.floor(i / 16);
    const tones = this.tones(i, 1);
    const root = tones[0] / 2;
    if (pos % 4 === 0) s.kick(b, t, 0.15);
    if (pos === 4 || pos === 12) { s.snare(b, t, 0.1); s.clap(b, t, 0.06, 0); }
    if (pos % 2 === 1) s.hat(b, t, 0.014, 0.2);
    // chugging guitars, the classic fight riff
    if (pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 11 || pos === 14) {
      s.guitar(b, t, pos === 6 || pos === 14 ? root * 1.5 : root, 0.08, true, -0.2);
    }
    if (this.isChordStart(i)) {
      s.guitar(b, t, root, 0.09, false, 0.25);
      s.reese(b, t, root, 0.08, 16 * this.stepDur * 0.95);
      s.crash(b, t, 0.04, 0.3, tones[0] * 4);
    }
    if (pos === 0 && bar % 2 === 0) s.supersaw(b, t, tones[1] * 4, 0.04, 0.22, -0.3);
    if (pos === 8 && bar % 2 === 1) s.tom(b, t, 90, 0.06, 0.3);
    if (i % 32 === 28) s.riser(b, t, 16 * this.stepDur, 0.014);
  }

  lead(t: number, f: number, g: number, pan: number): void { this.s.supersaw(this.bus, t, f * 2, g * 0.45, 0.16, pan); }
}

const STYLES: StyleDef[] = [
  { id: 'sparring', name: 'Sparring', make: (s, b) => new Sparring(s, b) },
  { id: 'intense', name: 'Intense', make: (s, b) => new Intense(s, b) },
  { id: 'boss', name: 'Boss', make: (s, b) => new Boss(s, b) },
];

class FighterConductor extends Conductor {
  constructor(e: AudioEngine) {
    super(e, { styles: STYLES, styleKey: 'aMusicStyle', rotateKey: 'aMusicStyle' });
  }

  /** The weather is the fight: the street picks the style. */
  protected override wanted(): string | null {
    const pinned = this.setting<string>(this.cfg.styleKey);
    if (pinned !== 'auto' && this.styles.has(pinned)) return pinned;
    const n = this.mood.night;
    return n < 0.25 ? 'sparring' : n < 0.6 ? 'intense' : 'boss';
  }

  protected override ambience(_dt: number, _state: State, _now: number, _on: boolean): void {}

  override cue(kind: Cue, srcIp?: string): void {
    const st = this.core, s = this.s;
    const pan = this.panFor(srcIp);
    if (kind === 'allow') { this.playLead(srcIp); return; }
    if (!st.deviceVoices) return;
    switch (kind) {
      case 'dns': {
        // the fireball: a sweeping whistle across the street
        if (Math.random() >= st.gateDns * 0.5) return;
        const t = this.slot('fire', 2, 0.5);
        if (t < 0) return;
        s.zap(this.sfxBus, t, this.chordAt(t, 5)[0] * 4, 0.03 * st.gDns, pan);
        s.ping(this.sfxBus, t + 0.06, this.chordAt(t, 5)[2] * 4, 0.02 * st.gDns, -pan);
        return;
      }
      case 'block': {
        // a clean guard: tom thud and a metallic zap
        this.bumpTension(0.04);
        if (Math.random() >= st.gateBlock * 0.6) return;
        const t = this.slot('guard', 2, 1);
        if (t < 0) return;
        s.tom(this.sfxBus, t, 110, 0.08 * st.gBlock, pan);
        s.zap(this.sfxBus, t + 0.02, this.chordAt(t, 2)[0], 0.04 * st.gBlock, pan);
        return;
      }
      case 'threat': {
        // the super: siren, crash, and the street shaking underneath
        this.bumpTension(0.24);
        if (Math.random() >= st.gateThreat) return;
        const t = this.slot('super', 4, 1.5);
        if (t < 0) return;
        const f = this.chordAt(t, 3)[0];
        s.alert(this.sfxBus, t, f * 4, 0.05 * st.gThreat, 0.28);
        s.crash(this.sfxBus, t, 0.05 * st.gThreat, pan, f * 4);
        s.blast(this.sfxBus, t + 0.05, 0.07 * st.gThreat, pan, f);
        return;
      }
      case 'dhcp': {
        if (Math.random() >= st.gateDhcp) return;
        const t = this.slot('join', 4, 1);
        if (t < 0) return;
        s.hat(this.sfxBus, t, 0.02 * st.gDhcp, pan);
        s.ping(this.sfxBus, t + 0.04, this.chordAt(t, 4)[pick([0, 2])] * 4, 0.016 * st.gDhcp, pan);
        return;
      }
      case 'wifi': {
        if (Math.random() >= st.gateWifi * 0.8) return;
        const t = this.slot('crowd', 4, 1);
        if (t < 0) return;
        s.hat(this.sfxBus, t, 0.022 * st.gWifi, pan, true);
        s.ping(this.sfxBus, t + 0.03, this.chordAt(t, 4)[pick([0, 1])] * 4, 0.015 * st.gWifi, -pan);
        return;
      }
      case 'system': {
        const t = this.slot('low', 4, 1.2);
        if (t < 0) return;
        s.boom(this.sfxBus, t, 0.05);
        return;
      }
    }
  }

  override sfx(name: string, opts: SfxOpts = {}): void {
    const s = this.s;
    const t = this.e.ctx.currentTime + 0.01;
    const pan = opts.pan ?? 0;
    if (name === 'jab') {
      s.chip(this.sfxBus, t, this.chordAt(t, 5)[pick([0, 1])] * 4, 0.028, 0.07, pan);
    } else if (name === 'hit') {
      s.snare(this.sfxBus, t, 0.08, pan);
      s.zap(this.sfxBus, t, this.chordAt(t, 2)[0] * 2, 0.04, pan);
    } else if (name === 'big') {
      s.tom(this.sfxBus, t, 80, 0.1, pan);
      s.blast(this.sfxBus, t, 0.05, pan, this.chordAt(t, 1)[0]);
    } else if (name === 'ko') {
      s.boom(this.sfxBus, t, 0.12);
      s.crash(this.sfxBus, t, 0.06, pan, this.chordAt(t, 3)[0] * 4);
      s.riser(this.sfxBus, t, 0.9, 0.05);
    } else if (name === 'round') {
      s.boom(this.sfxBus, t, 0.08);
      s.ping(this.sfxBus, t + 0.05, this.chordAt(t, 4)[2] * 4, 0.03, pan);
    }
  }

  override noiseVoice(kind: Cue, when: number): void {
    const st = this.core, s = this.s;
    if (s.busy(8)) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const chord = this.chordAt(when, 5);
    if (kind === 'threat') {
      s.blast(this.sfxBus, when, 0.07 * st.gThreat, pan, chord[0]);
    } else if (kind === 'block') {
      s.tom(this.sfxBus, when, 100, 0.06 * st.gBlock, pan);
    } else if (this.notes) {
      s.ping(this.sfxBus, when, chord[pick([0, 1, 2])] * 2, 0.014 * (kind === 'allow' ? st.gAllow : kind === 'dns' ? st.gDns : st.gDhcp), pan);
    }
  }
}

export function netFighterScore(e: AudioEngine): Score { return new FighterConductor(e); }
