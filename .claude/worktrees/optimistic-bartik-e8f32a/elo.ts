import type { GameResult } from './engines/slobberhannes';

const DEFAULT_K      = 32;
const DEFAULT_RATING = 1500;

/** Expected score for A in a head-to-head against B (standard ELO formula). */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update ratings after one completed game.
 * Each non-loser is treated as having beaten each loser in a 1v1 comparison.
 * Ties among losers each receive a fractional loss share.
 * Returns a new array; does not mutate `ratings`.
 */
function updateRatings(ratings: number[], gameResult: GameResult, k: number = DEFAULT_K): number[] {
  // TODO: implement multi-player ELO update
  void gameResult; void k;
  return [...ratings];
}

/** Create a fresh ratings array of length playerCount at the default rating. */
function createRatings(playerCount: number = 4): number[] {
  return Array<number>(playerCount).fill(DEFAULT_RATING);
}

export { DEFAULT_K, DEFAULT_RATING, expectedScore, updateRatings, createRatings };
