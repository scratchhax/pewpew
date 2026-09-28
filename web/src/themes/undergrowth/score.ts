import type { AudioEngine, Cue, Score, SfxOpts } from '../../audio';
import { Bus, Synth } from '../../sound/synth';
import { myceliumScore } from '../mycelium/score';

/**
 * Undergrowth plays the same score as the garden seen from above — this
 * scene flies the same mat — plus one sound only the flythrough has: a
 * soft whoosh when a pulse of light flies past the camera, panned to the
 * side it passes on.
 */
export function undergrowthScore(e: AudioEngine): Score {
  const inner = myceliumScore(e);
  const s = new Synth(e);
  const sfxB = new Bus(e.ctx, e.out, e.reverb, e.echo, 1);
  return {
    cue: (k: Cue, ip?: string) => inner.cue(k, ip),
    sfx: (name: string, opts?: SfxOpts) => {
      if (name === 'whoosh') {
        const t = e.ctx.currentTime;
        s.noiseHit(sfxB, t, { type: 'bandpass', f: 340, fTo: 1500, q: 1.6, g: 0.05, a: 0.04, r: 0.3, pan: opts?.pan ?? 0, rev: 0.2 });
        return;
      }
      inner.sfx(name, opts);
    },
    setThreatActive: (on: boolean) => inner.setThreatActive(on),
    update: (dt: number, state) => inner.update(dt, state),
    noiseVoice: (k: Cue, when: number) => inner.noiseVoice(k, when),
  };
}
