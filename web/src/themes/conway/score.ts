import type { AudioEngine, Score } from '../../audio';
import { rainScoreFor } from '../rain/score';

/**
 * Game of Life plays the rain's drone styles - the same weather-driven
 * dark ambient set - but none of its weather: no rain hiss, no wind.
 * A petri dish is silent but for the drones.
 */
export function conwayScore(e: AudioEngine): Score {
  return rainScoreFor(e, 'lMusicStyle', '', false);
}
