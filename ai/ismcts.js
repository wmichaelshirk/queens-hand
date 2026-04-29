'use strict';

/**
 * Information Set Monte Carlo Tree Search (ISMCTS) — stub.
 *
 * ISMCTS handles hidden-information games by sampling many "determinizations"
 * of the current state (possible worlds consistent with public knowledge) and
 * running standard MCTS across them, aggregating move statistics.
 *
 * Engine API required by this module (all pure functions from engine.js):
 *
 *   determinize(state, perspectivePlayer) → sampledState
 *     Fixes the perspective player's hand; redistributes all hidden cards
 *     randomly among the other players.  Call once per simulation iteration.
 *
 *   getLegalMoves(state) → Card[]
 *     Returns the legal cards for the current player.  Used at each node.
 *
 *   applyMove(state, card) → newState
 *     Pure state transition.  Used to advance the simulation.
 *
 *   isHandOver(state) → boolean
 *     Terminal check.  Rollouts terminate at hand end, not game end.
 *
 *   getReward(state, playerIndex) → number | null
 *     Scalar reward in (-∞, 0]: negative hand-penalties.  Higher = better.
 *     Returns null while the hand is in progress.
 *
 * Suggested implementation outline:
 *   1. For each iteration:
 *      a. world = engine.determinize(state, playerIndex)
 *      b. Selection   — descend the tree using UCB1, treating each world as
 *                       fully observable. Track visit counts per (node, move).
 *      c. Expansion   — add an unvisited child for a random legal move.
 *      d. Simulation  — random rollout from the expanded node to hand end.
 *      e. Backprop    — update visit counts and total rewards up the tree.
 *   2. Return the move with the highest average reward across all worlds.
 *
 * Because different determinizations may disagree on which moves are legal at
 * a given information set, use "determinization-compatible" node selection:
 * only follow a branch if the move is legal in the current sampled world.
 */

/**
 * Choose a card for playerIndex using ISMCTS.
 *
 * @param {object}  state       - current game state (may contain hidden info)
 * @param {number}  playerIndex - the player making the decision
 * @param {object}  [options]
 * @param {number}  [options.iterations=1000] - number of MCTS simulations
 * @returns {object} card to play
 */
function chooseCard(state, playerIndex, options = {}) {
  const { iterations = 1000 } = options;
  void iterations; // suppress lint until implemented
  throw new Error('ISMCTS not yet implemented — use ai/greedy.js for now');
}

module.exports = { chooseCard };
