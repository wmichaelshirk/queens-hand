'use strict';

/**
 * Information Set Monte Carlo Tree Search (ISMCTS).
 *
 * Each iteration samples a determinization (a fully-observable world consistent
 * with public knowledge) via engine.determinize, then runs a standard MCTS
 * pass on that world. Move statistics aggregate across all worlds.
 *
 * UCB1 uses an "availability count" per child — the number of iterations in
 * which that move was legal at the parent — rather than the parent visit count.
 * This is the key correction for hidden-information games: a move seen rarely
 * across determinizations should be explored more aggressively.
 *
 * Reward pipeline (applied at every terminal state):
 *   1. Base reward   — hand penalties or cumulative scores (horizon option)
 *   2. Side goals    — weighted bonus functions on the terminal state
 *   3. Normalisation — scale to [0,1] when rewardNorm bounds are supplied
 *
 * Difficulty is controlled via epsilon: with probability epsilon the final
 * move selection is random instead of optimal, producing intentional-looking
 * mistakes rather than random noise.
 */

const engine = require('../engines/slobberhannes');

const DEFAULT_ITERATIONS = 300;
const UCB_C = Math.SQRT2;

// ── Node ──────────────────────────────────────────────────────────────────────

function makeNode(move = null) {
  return {
    move,               // Card | null (root is null)
    children: new Map(), // cardKey → node
    visits: 0,
    totalReward: 0,
    availCount: 0,      // times this move was legal at the parent during selection
  };
}

function cardKey(card) {
  return `${card.rank}${card.suit}`;
}

// ── UCB1 ──────────────────────────────────────────────────────────────────────

function ucb1(child) {
  if (child.visits === 0) return Infinity;
  return (child.totalReward / child.visits) +
    UCB_C * Math.sqrt(Math.log(child.availCount) / child.visits);
}

function bestUCB1(node, legalMoves) {
  let best = null;
  let bestScore = -Infinity;
  for (const move of legalMoves) {
    const child = node.children.get(cardKey(move));
    if (!child) continue;
    const s = ucb1(child);
    if (s > bestScore) { bestScore = s; best = child; }
  }
  return best;
}

// ── Rollout ───────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function simulate(worldState, rolloutPolicy) {
  let s = worldState;
  while (!engine.isHandOver(s)) {
    const moves = engine.getLegalMoves(s);
    s = engine.applyMove(s, rolloutPolicy ? rolloutPolicy(s, moves) : pick(moves));
  }
  return s;
}

// ── Reward ────────────────────────────────────────────────────────────────────

function computeReward(terminal, playerIndex, options) {
  const { horizon, rewardNorm, sideGoals } = options;

  let r = horizon === 'game'
    ? -terminal.scores[playerIndex]
    : engine.getReward(terminal, playerIndex);

  for (const { weight = 1, evaluate } of sideGoals) {
    r += weight * evaluate(terminal, playerIndex);
  }

  if (rewardNorm) {
    const { min, max } = rewardNorm;
    if (max !== min) r = (r - min) / (max - min);
  }

  return r;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Choose a card for playerIndex using ISMCTS.
 *
 * @param {object}  state               - current game state (may contain hidden info)
 * @param {number}  playerIndex         - the player making the decision
 * @param {object}  [options]
 * @param {number}  [options.iterations=1000]        - simulation budget
 * @param {'hand'|'game'} [options.horizon='hand']   - 'hand' optimises this hand's
 *   penalties only; 'game' uses cumulative scores for a longer-term strategy
 * @param {{min:number,max:number}} [options.rewardNorm]  - normalise reward to [0,1];
 *   supply when mixing games with different score spreads
 * @param {number}  [options.epsilon=0]              - [0,1] final-selection noise;
 *   non-zero produces intentional-looking mistakes for difficulty scaling
 * @param {Function} [options.rolloutPolicy]         - fn(state, legalMoves) → card;
 *   biases simulations toward rare high-value lines (e.g. declaration bonuses)
 * @param {Array}   [options.sideGoals]              - [{weight, evaluate}] where
 *   evaluate(terminalState, playerIndex) → number adds to the base reward
 * @param {null}    [options.teamBeliefs]            - reserved for future team inference
 * @returns {object} card to play
 */
function chooseCard(state, playerIndex, options = {}) {
  const {
    iterations    = DEFAULT_ITERATIONS,
    horizon       = 'hand',
    rewardNorm    = null,
    epsilon       = 0.0,
    rolloutPolicy = null,
    sideGoals     = [],
  } = options;

  const rewardOpts = { horizon, rewardNorm, sideGoals };
  const root = makeNode();

  for (let iter = 0; iter < iterations; iter++) {
    const world = engine.determinize(state, playerIndex);

    // ── Selection ─────────────────────────────────────────────────────────
    let node = root;
    let worldState = world;
    const path = [root];

    while (!engine.isHandOver(worldState)) {
      const legal = engine.getLegalMoves(worldState);

      // Increment availability for every legal child — only legal-in-this-world
      // moves count toward the availability denominator in UCB1.
      for (const m of legal) {
        const child = node.children.get(cardKey(m));
        if (child) child.availCount++;
      }

      const unvisited = legal.filter(m => !node.children.has(cardKey(m)));
      if (unvisited.length > 0) break; // expand below

      const next = bestUCB1(node, legal);
      if (!next) break; // all legal children somehow null — shouldn't occur
      worldState = engine.applyMove(worldState, next.move);
      node = next;
      path.push(node);
    }

    // ── Expansion ──────────────────────────────────────────────────────────
    if (!engine.isHandOver(worldState)) {
      const legal = engine.getLegalMoves(worldState);
      const unvisited = legal.filter(m => !node.children.has(cardKey(m)));

      if (unvisited.length > 0) {
        const expandMove = pick(unvisited);
        const child = makeNode(expandMove);
        node.children.set(cardKey(expandMove), child);
        worldState = engine.applyMove(worldState, expandMove);
        node = child;
        path.push(node);
      }
    }

    // ── Simulation ─────────────────────────────────────────────────────────
    const terminal = simulate(worldState, rolloutPolicy);

    // ── Backpropagation ─────────────────────────────────────────────────────
    const reward = computeReward(terminal, playerIndex, rewardOpts);
    for (const n of path) {
      n.visits++;
      n.totalReward += reward;
    }
  }

  // ── Move selection ─────────────────────────────────────────────────────────
  const legalMoves = engine.getLegalMoves(state);

  // epsilon-greedy: occasional random pick keeps difficulty looking intentional
  if (epsilon > 0 && Math.random() < epsilon) {
    return pick(legalMoves);
  }

  let bestMove = legalMoves[0]; // fallback if tree is somehow empty
  let bestAvg = -Infinity;

  for (const move of legalMoves) {
    const child = root.children.get(cardKey(move));
    if (!child || child.visits === 0) continue;
    const avg = child.totalReward / child.visits;
    if (avg > bestAvg) { bestAvg = avg; bestMove = move; }
  }

  return bestMove;
}

module.exports = { chooseCard };
