'use strict';

/**
 * ELO rating system for Slobberhannes — stub.
 *
 * Multi-player ELO works by decomposing a 4-player result into pairwise
 * comparisons.  In Slobberhannes the "loser" (first to reach loseAt) is
 * treated as having lost against each other player; everyone else is treated
 * as having beaten the loser.  Tied losers split the loss.
 *
 * Required input:
 *   ratings    number[]   — current rating per player (seat-indexed)
 *   gameResult             — return value of engine.getGameResult(finalState)
 *              { scores: number[], loser: number, losers: number[] }
 *
 * Separation note: ELO only cares about game-level outcomes (who lost), not
 * hand-level penalties.  Hand results (engine.getHandResult) are the training
 * signal for ISMCTS reward shaping, not for rating updates.
 */

const DEFAULT_K      = 32;
const DEFAULT_RATING = 1500;

/** Expected score for A in a head-to-head against B (standard ELO formula). */
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update ratings after one completed game.
 * Each non-loser is treated as having beaten each loser in a 1v1 comparison.
 * Ties among losers each receive a fractional loss share.
 * Returns a new array; does not mutate `ratings`.
 *
 * @param {number[]} ratings
 * @param {{ scores: number[], loser: number, losers: number[] }} gameResult
 * @param {number} [k]
 * @returns {number[]}
 */
function updateRatings(ratings, gameResult, k = DEFAULT_K) {
  // TODO: implement multi-player ELO update
  void gameResult; void k;
  return [...ratings];
}

/** Create a fresh ratings array of length playerCount at the default rating. */
function createRatings(playerCount = 4) {
  return Array(playerCount).fill(DEFAULT_RATING);
}

module.exports = { DEFAULT_K, DEFAULT_RATING, expectedScore, updateRatings, createRatings };
