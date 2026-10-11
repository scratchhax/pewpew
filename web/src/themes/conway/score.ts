import type { AudioEngine, Score } from '../../audio';
import { rainScoreFor } from '../rain/score';

/**
 * Game of Life plays the rain's score - the same weather-driven big-beat
 * set, on its own volume and style settings.
 */
export function conwayScore(e: AudioEngine): Score {
  return rainScoreFor(e, 'lMusicStyle', 'lRainAmb');
}
