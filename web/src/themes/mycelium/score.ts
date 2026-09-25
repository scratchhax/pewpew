import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Bus, Synth } from '../../sound/synth';
import type { MyceliumSettings } from './settings';

/**
 * Mycelium's soundtrack: free ambient, no beat grid. A slow drone breathes
 * through a four-chord cycle under an undergrowth bed of wind; glass bells
 * ring out the network's life (DNS as high bells, leases as warm glasses,
 * flows as soft low plucks), and blocks are muffled earth thuds. Under
 * threat a minor-second swell creeps in with a slow pulse, resolving into a
 * bright burn-off. Everything rides the user's reverb; sparse by design.
 */

const PENT = [220, 262, 294, 330, 392, 440, 524, 588, 660, 784, 880, 1046];   // A minor pentatonic, 2 octaves
const CHORDS = [[110, 165, 220], [87.3, 131, 175], [131, 196, 262], [98, 147, 196]];   // Am F C G roots

export function myceliumScore(e: AudioEngine): Score { return new SporeScore(e); }

class SporeScore implements Score {
  private s: Synth;
  private music: Bus;
  private drone: Bus;
  private windB: Bus;
  private sfxB: Bus;
  private droneBed: ReturnType<Synth['drone']>;
  private windBed: ReturnType<Synth['wind']>;
  private chord = 0;
  private chordAt = 0;
  private soloAt = 2.5;
  private heartAt = 0;
  private threat = false;
  private lastCue = new Map<string, number>();
  private settings: MyceliumSettings;

  constructor(private e: AudioEngine) {
    this.s = new Synth(e);
    this.settings = e.settings as unknown as MyceliumSettings;
    this.music = new Bus(e.ctx, e.out, e.reverb, e.echo, 1);
    this.drone = Bus.under(e.ctx, this.music, 0.9);
    this.windB = Bus.under(e.ctx, this.music, 0.8);
    this.sfxB = new Bus(e.ctx, e.out, e.reverb, e.echo, 1);
    this.droneBed = this.s.drone(this.drone, CHORDS[0]);
    this.windBed = this.s.wind(this.windB);
  }

  private knobs(): { amb: number; bells: number; pad: number } {
    return { amb: this.settings.mAmbience ?? 0.7, bells: this.settings.mBells ?? 0.8, pad: this.settings.mPadDepth ?? 0.6 };
  }
  private pan(ip?: string): number {
    if (!ip) return (Math.random() - 0.5) * 0.8;
    let h = 0;
    for (const c of ip) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h % 1000) / 1000) * 1.4 - 0.7;
  }
  private gate(key: string, seconds: number): boolean {
    const now = this.s.ctx.currentTime;
    const last = this.lastCue.get(key) ?? -9;
    if (now - last < seconds) return false;
    this.lastCue.set(key, now);
    return true;
  }

  cue(kind: Cue, srcIp?: string): void {
    const t = this.s.ctx.currentTime + 0.02;
    const { bells } = this.knobs();
    if (bells <= 0.01) return;
    const p = this.pan(srcIp);
    switch (kind) {
      case 'dns':
        if (!this.gate('dns', 0.12)) return;
        this.s.glass(this.sfxB, t, PENT[7 + ((Math.random() * 5) | 0)], 0.05 * bells, p);
        break;
      case 'allow':
        if (!this.gate('allow', 0.45)) return;
        this.s.pluck(this.sfxB, t, PENT[1 + ((Math.random() * 4) | 0)], 0.03 * bells, p, 0.25);
        break;
      case 'dhcp':
        if (!this.gate('dhcp', 0.3)) return;
        this.s.glass(this.sfxB, t, PENT[4 + ((Math.random() * 2) | 0)], 0.06 * bells, p);
        break;
      case 'wifi':
        if (!this.gate('wifi', 0.2)) return;
        this.s.ping(this.sfxB, t, PENT[9 + ((Math.random() * 3) | 0)], 0.035 * bells, p);
        break;
      case 'block':
        if (!this.gate('block', 0.35)) return;
        this.s.tone(this.sfxB, t, 82, { g: 0.05, a: 0.02, r: 0.6, glide: 0.7, lp: 260, pan: p, rev: 0.3 });
        this.s.noiseHit(this.sfxB, t, { type: 'lowpass', f: 420, fTo: 140, g: 0.035, a: 0.01, r: 0.35, pan: p });
        break;
      case 'threat':
        this.s.swell(this.sfxB, t, 116.5, 0.07, 3.4, p);     // the blight arrives
        this.s.swell(this.sfxB, t, 123.5, 0.05, 3.8, -p);    // a semitone of dread
        break;
      case 'system':
        if (!this.gate('system', 4)) return;
        this.s.tone(this.sfxB, t, 110, { g: 0.045 * bells, a: 0.01, r: 2.6, pan: p, rev: 0.8 });
        break;
    }
  }

  sfx(name: string, opts?: SfxOpts): void {
    const t = this.s.ctx.currentTime + 0.015;
    const { bells } = this.knobs();
    if (bells <= 0.01) return;
    const p = opts?.pan ?? 0;
    switch (name) {
      case 'bloom':
        this.s.glass(this.sfxB, t, PENT[8 + ((Math.random() * 3) | 0)], 0.075 * bells, p);
        this.s.noiseHit(this.sfxB, t, { type: 'highpass', f: 5200, g: 0.012 * bells, a: 0.02, r: 0.3, pan: p });
        break;
      case 'sprout':
        this.s.tone(this.sfxB, t, PENT[3], { g: 0.055 * bells, a: 0.05, r: 0.9, glide: 1.5, pan: p, rev: 0.6, echo: 0.3 });
        break;
      case 'spore':
        this.s.ping(this.sfxB, t, PENT[10 + ((Math.random() * 2) | 0)], 0.03 * bells, p);
        break;
      case 'scorch':
        this.s.noiseHit(this.sfxB, t, { type: 'lowpass', f: 600, fTo: 120, g: 0.06, a: 0.005, r: 0.5, pan: p, rev: 0.4 });
        this.s.noiseHit(this.sfxB, t + 0.05, { type: 'bandpass', f: 3800, q: 2, g: 0.02, a: 0.02, r: 0.9, pan: p });
        break;
      case 'burn':
        this.s.noiseHit(this.sfxB, t, { type: 'bandpass', f: 700, fTo: 4200, q: 1.5, g: 0.07, a: 0.06, r: 0.7, pan: p, rev: 0.5 });
        this.s.bell(this.sfxB, t + 0.12, PENT[10], 0.06 * bells, p, 0.5);
        break;
      case 'heal':
        this.s.glass(this.sfxB, t, PENT[6], 0.03 * bells, p);
        break;
    }
  }

  setThreatActive(on: boolean): void { this.threat = on; }

  update(dt: number, state: State): void {
    const t = this.s.ctx.currentTime;
    const { amb, pad, bells } = this.knobs();
    const w = state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.55 : 0.2;

    // drone breathes; weather and traffic deepen it
    this.droneBed.level.gain.setTargetAtTime(0.05 * pad * (0.8 + w * 0.9), t, 1.5);
    this.chordAt -= dt;
    if (this.chordAt <= 0) {
      this.chordAt = 48 + Math.random() * 22;
      this.chord = (this.chord + 1) % CHORDS.length;
      this.droneBed.glide(CHORDS[this.chord], t);
    }
    // undergrowth: wind through leaf litter, denser in sporing weather
    this.windBed.level.gain.setTargetAtTime(0.028 * amb * (0.5 + w), t, 2);

    // the slow pulse of a threat, and its swell
    if (this.threat) {
      this.heartAt -= dt;
      if (this.heartAt <= 0) {
        this.heartAt = 1.15;
        this.s.heart(this.sfxB, t, 0.045);
      }
    }

    // ambient soloist: a bell sentence from the current chord, sparse
    this.soloAt -= dt * (0.6 + w * 1.2);
    if (this.soloAt <= 0) {
      this.soloAt = 6 + Math.random() * 11;
      if (bells > 0.02 && !this.s.busy(3)) {
        const root = CHORDS[this.chord][0];
        const f = root * 2 ** (1 + (Math.random() < 0.5 ? 1 : 2));
        this.s.glass(this.sfxB, t + 0.05, f, 0.028 * bells, (Math.random() - 0.5) * 1.2);
        if (Math.random() < 0.4) this.s.bell(this.sfxB, t + 1.6, f * (Math.random() < 0.5 ? 1.5 : 2), 0.02 * bells, (Math.random() - 0.5) * 1.2, 0.45);
      }
    }
  }

  /** The raw-feed noise gate, voiced softly: the garden murmuring. */
  noiseVoice(kind: Cue, when: number): void {
    const { bells } = this.knobs();
    if (bells <= 0.01) return;
    const p = (Math.random() - 0.5) * 1.2;
    switch (kind) {
      case 'allow': this.s.tone(this.sfxB, when, PENT[(Math.random() * 6) | 0], { g: 0.012, a: 0.05, r: 0.4, pan: p, rev: 0.5 }); break;
      case 'block': this.s.noiseHit(this.sfxB, when, { type: 'lowpass', f: 300, g: 0.015, a: 0.01, r: 0.3, pan: p }); break;
      case 'dns': this.s.noiseHit(this.sfxB, when, { type: 'highpass', f: 6000, g: 0.008, a: 0.005, r: 0.12, pan: p }); break;
      case 'wifi': this.s.ping(this.sfxB, when, PENT[9 + ((Math.random() * 3) | 0)], 0.012, p); break;
      case 'dhcp': this.s.tone(this.sfxB, when, 330, { g: 0.014, a: 0.04, r: 0.5, pan: p, rev: 0.6 }); break;
      default: break;
    }
  }
}
