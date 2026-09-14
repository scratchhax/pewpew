import type { MusicPulse } from '../audio';

/** Tempo the scene keeps when there's no music to follow (audio off or not started). */
const IDLE_BPM = 84;

/**
 * The scene's sense of the music. `beat` always runs forward smoothly: with
 * no music it free-runs at a walking tempo, and with music it's nudged toward
 * the soundtrack's clock at no more than ±50% speed, so a new song (a new
 * downbeat) never makes anything jump. Loudness, the heartbeat and the bar's
 * downbeat are eased too: things move in time, nothing blinks.
 */
export class Groove {
  beat = Math.random() * 8;
  beatsPerBar = 4;
  /** 0..1, slow (about a second). */
  energy = 0.35;
  /** 0..1 heartbeat during a horde, softened. */
  heart = 0;
  /** 0..1 swell on each bar's downbeat, softened. */
  downbeat = 0;
  style = '';

  update(dt: number, p: MusicPulse | null): void {
    const bpm = p?.bpm ?? IDLE_BPM;
    this.beat += dt * bpm / 60;
    if (p) {
      this.beatsPerBar = p.beatsPerBar;
      this.style = p.style;
      // phase error inside a two-bar cycle, wrapped to the nearest way round
      const cycle = p.beatsPerBar * 2;
      const err = ((((p.beat - this.beat) % cycle) + cycle * 1.5) % cycle) - cycle / 2;
      const maxNudge = dt * (bpm / 60) * 0.5;
      this.beat += Math.max(-maxNudge, Math.min(maxNudge, err * Math.min(1, dt * 2)));
    }
    this.energy += ((p?.energy ?? 0.35) - this.energy) * Math.min(1, dt * 0.8);
    this.heart += ((p?.heart ?? 0) - this.heart) * Math.min(1, dt * 6);
    const barPhase = ((this.beat % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
    const hit = p ? Math.exp(-barPhase * 1.4) : 0;
    this.downbeat += (hit - this.downbeat) * Math.min(1, dt * 4);
  }
}
