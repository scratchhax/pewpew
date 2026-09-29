import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import type { State } from '../../state';
import { Bus, Synth } from '../../sound/synth';
import type { SubstrateSettings } from './settings';

/**
 * Substrate's soundtrack: a quiet room with someone drawing in it.
 *
 * No beat grid and no band — every other scene has one, and a band would be
 * completely wrong over a sheet of paper filling up in silence. What carries
 * this score is the drawing itself: a susurrus of nib ticks whose rate follows
 * how many cracks are actually growing, so the plate audibly gets busier as it
 * fills and goes quiet the moment it stops. Under that sits a room: a breath
 * of air and a very low drone moving through four chords, minutes apart.
 *
 * Events are small, dry and close: a pencil tick for a permitted flow, the nib
 * catching and tearing for a block, a struck low string for a fracture, a
 * music-box note where DNS pools, a woody koto pluck when a lease plants a new
 * seed.
 *
 * It is also the only score here with an ending, because it is the only scene
 * with one. The theme calls `finish`, `wash` and `fresh` as the cycle turns:
 * the drawing stops, a low gong marks the finished picture, a long filtered
 * breath takes it away, and a single sheet-laid tick starts the next one.
 */

/** D minor pentatonic — low, soft, nothing bright enough to sound like a bell choir. */
const PENT = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0, 440.0, 523.25, 587.33];

/** Dm, Bb, F, C as low triads: the room, not a progression anyone should notice. */
const CHORDS = [
  [73.42, 110.0, 146.83],
  [58.27, 87.31, 116.54],
  [87.31, 130.81, 174.61],
  [65.41, 98.0, 130.81],
];

export function substrateScore(e: AudioEngine): Score {
  return new PlateScore(e);
}

class PlateScore implements Score {
  private s: Synth;
  private music: Bus;
  private roomB: Bus;
  private sfxB: Bus;
  private droneBed: ReturnType<Synth['drone']>;
  private airBed: ReturnType<Synth['wind']>;
  private settings: SubstrateSettings;

  private chord = 0;
  private chordAt = 20;
  private threat = false;
  private lastCue = new Map<string, number>();

  /** Nib ticks per second the drawing currently wants, and the eased actual. */
  private nibTarget = 0;
  private nibRate = 0;
  /** Fractional tick accumulator, so rates below one a second still work. */
  private nibAcc = 0;
  /** Silences the nib through hold and fade — the drawing has stopped. */
  private drawing = true;

  constructor(private e: AudioEngine) {
    this.s = new Synth(e);
    this.settings = e.settings as unknown as SubstrateSettings;
    this.music = new Bus(e.ctx, e.out, e.reverb, e.echo, 1);
    this.roomB = Bus.under(e.ctx, this.music, 0.9);
    this.sfxB = new Bus(e.ctx, e.out, e.reverb, e.echo, 1);
    this.droneBed = this.s.drone(this.roomB, CHORDS[0]);
    this.airBed = this.s.wind(this.roomB);
  }

  private knobs(): { nib: number; room: number; chime: number } {
    return {
      nib: this.settings.cNib ?? 0.8,
      room: this.settings.cRoom ?? 0.6,
      chime: this.settings.cChime ?? 0.7,
    };
  }

  private pan(ip?: string): number {
    if (!ip) return (Math.random() - 0.5) * 0.9;
    let h = 0;
    for (const c of ip) h = (h * 31 + c.charCodeAt(0)) | 0;
    return ((h % 1000) / 1000) * 1.5 - 0.75;
  }

  private gate(key: string, seconds: number): boolean {
    const now = this.s.ctx.currentTime;
    const last = this.lastCue.get(key) ?? -9;
    if (now - last < seconds) return false;
    this.lastCue.set(key, now);
    return true;
  }

  /** One stroke of the nib: tiny, dry, anywhere across the sheet. */
  private nib(t: number, g: number): void {
    if (this.s.busy(2)) return;
    this.s.scratch(this.sfxB, t, g, 0.03 + Math.random() * 0.055, (Math.random() - 0.5) * 1.5);
  }

  cue(kind: Cue, srcIp?: string): void {
    const t = this.s.ctx.currentTime + 0.02;
    const { nib, chime } = this.knobs();
    const p = this.pan(srcIp);

    switch (kind) {
      case 'allow':
        // the bulk of any feed: it belongs in the susurrus, not in a note.
        // Only now and then does one settle into an audible pitch.
        if (!this.gate('allow', 1.7) || chime <= 0.01) return;
        this.s.pluck(this.sfxB, t, PENT[1 + ((Math.random() * 4) | 0)], 0.018 * chime, p, 0.4);
        break;

      case 'block':
        // the nib catching and tearing
        if (!this.gate('block', 0.5)) return;
        this.s.scratch(this.sfxB, t, 0.05 * nib, 0.13, p);
        this.s.noiseHit(this.sfxB, t, { type: 'lowpass', f: 380, fTo: 150, g: 0.03, a: 0.005, r: 0.28, pan: p });
        break;

      case 'threat':
        // a fracture: a low string struck, and a semitone of unease under it
        if (!this.gate('threat', 2.2)) return;
        this.s.swell(this.sfxB, t, 73.42, 0.06, 3.2, p);
        this.s.swell(this.sfxB, t + 0.1, 77.78, 0.04, 3.6, -p);
        this.s.scrape(this.sfxB, t, 320, 0.02, p);
        break;

      case 'dns':
        if (!this.gate('dns', 0.5) || chime <= 0.01) return;
        this.s.musicBox(this.sfxB, t, PENT[6 + ((Math.random() * 5) | 0)], 0.035 * chime, p);
        break;

      case 'dhcp':
        // a new seed planted: something woody, with a little bend in it
        if (!this.gate('dhcp', 0.7) || chime <= 0.01) return;
        this.s.koto(this.sfxB, t, PENT[2 + ((Math.random() * 3) | 0)], 0.04 * chime, p);
        break;

      case 'wifi':
        if (!this.gate('wifi', 1.1)) return;
        this.s.whisper(this.sfxB, t, 0.018 * nib, p);
        break;

      case 'system':
        if (!this.gate('system', 6) || chime <= 0.01) return;
        this.s.tone(this.sfxB, t, 110, { g: 0.03 * chime, a: 0.02, r: 2.4, pan: p, rev: 0.8 });
        break;
    }
  }

  sfx(name: string, opts?: SfxOpts): void {
    const t = this.s.ctx.currentTime + 0.015;
    const { nib, chime } = this.knobs();

    switch (name) {
      case 'draw': {
        // the theme reports how many cracks are live; the nib follows it
        const live = opts?.count ?? 0;
        this.nibTarget = Math.min(14, Math.sqrt(live) * 1.5);
        this.drawing = true;
        break;
      }

      case 'finish':
        // the picture is done: the drawing stops and the room is left ringing
        this.drawing = false;
        this.nibTarget = 0;
        if (chime > 0.01) {
          this.s.gong(this.sfxB, t, 98, 0.05 * chime);
          this.s.pad(this.music, t + 0.3, CHORDS[this.chord].map((f) => f * 2), 0.016 * chime, 4.5, 520);
        }
        break;

      case 'wash':
        // and is taken away: a long breath down, never a cut
        this.drawing = false;
        this.nibTarget = 0;
        this.s.noiseHit(this.sfxB, t, {
          type: 'lowpass', f: 2400, fTo: 180, q: 0.8,
          g: 0.05 * nib, a: 1.2, h: 0.6, r: 3.2, rev: 0.8,
        });
        break;

      case 'fresh':
        // a clean sheet laid down
        this.drawing = true;
        if (nib > 0.01) this.s.scratch(this.sfxB, t, 0.03 * nib, 0.2, 0);
        break;
    }
  }

  setThreatActive(on: boolean): void {
    this.threat = on;
  }

  update(dt: number, state: State): void {
    const t = this.s.ctx.currentTime;
    const { nib, room } = this.knobs();

    // the room: a breath of air and a drone that moves minutes apart
    this.airBed.level.gain.setTargetAtTime(0.02 * room, t, 2.5);
    this.droneBed.level.gain.setTargetAtTime(0.035 * room * (0.7 + state.energy * 0.5), t, 2);
    this.chordAt -= dt;
    if (this.chordAt <= 0) {
      this.chordAt = 55 + Math.random() * 30;
      this.chord = (this.chord + 1) % CHORDS.length;
      this.droneBed.glide(CHORDS[this.chord], t);
    }

    // The nib. Rate eases toward its target so the drawing never switches on
    // or off abruptly, and stops entirely once the picture is finished.
    const want = this.drawing ? this.nibTarget : 0;
    this.nibRate += (want - this.nibRate) * Math.min(1, dt * 1.6);
    if (nib > 0.01 && this.nibRate > 0.05) {
      this.nibAcc += this.nibRate * dt;
      let n = Math.min(3, this.nibAcc | 0);
      this.nibAcc -= n;
      while (n-- > 0) {
        // threat roughens the stroke: pressing harder into the paper
        const g = (0.012 + Math.random() * 0.012) * nib * (this.threat ? 1.5 : 1);
        this.nib(t + Math.random() * 0.05, g);
      }
    }
  }

  /** The raw-feed noise gate: the sheet murmuring, barely there. */
  noiseVoice(kind: Cue, when: number): void {
    const { nib, chime } = this.knobs();
    const p = (Math.random() - 0.5) * 1.4;
    switch (kind) {
      case 'allow':
        if (nib > 0.01) this.s.scratch(this.sfxB, when, 0.008 * nib, 0.03, p);
        break;
      case 'block':
        this.s.noiseHit(this.sfxB, when, { type: 'lowpass', f: 300, g: 0.012, a: 0.005, r: 0.2, pan: p });
        break;
      case 'dns':
        if (chime > 0.01) this.s.ping(this.sfxB, when, PENT[8 + ((Math.random() * 3) | 0)], 0.008 * chime, p);
        break;
      case 'dhcp':
        if (chime > 0.01) this.s.pluck(this.sfxB, when, PENT[3], 0.01 * chime, p, 0.3);
        break;
      case 'wifi':
        this.s.crackle(this.sfxB, when, 0.01 * nib, p);
        break;
      default:
        break;
    }
  }
}
