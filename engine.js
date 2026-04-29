'use strict';

/**
 * Pure Slobberhannes rules engine. No I/O, no side effects.
 *
 * All public functions either return new values or new state objects;
 * none mutate their arguments. States are plain JSON-serializable objects
 * so that callers (ISMCTS, tests, replays) can freely clone and branch them.
 *
 * State shape:
 * {
 *   hands:         Card[][]   — one array per player (index 0 = human)
 *   scores:        number[]   — cumulative game scores (carried across hands)
 *   handPenalties: number[]   — penalty points earned in the current hand (pre-sweep)
 *   trickNum:      number     — 0-based index of the trick currently being played
 *   leader:        number     — playerIndex who leads the current trick
 *   currentTrick:  Play[]     — cards played so far in the current trick
 *   trickLog:      TrickRecord[] — completed tricks this hand
 *   phase:         'playing' | 'hand_over' | 'game_over'
 *   loseAt:        number     — score threshold that ends the game
 * }
 *
 * Card:        { suit: string, rank: string }
 * Play:        { playerIndex: number, card: Card }
 * TrickRecord: { plays: Play[], ledSuit: string, winner: number,
 *                penalties: number[], penaltyLabels: string[] }
 */

const SUITS = ['♣', '♦', '♥', '♠'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_ORDER = Object.fromEntries(SUITS.map((s, i) => [s, i]));
const TRICKS_PER_HAND = 8;
const PLAYER_COUNT = 4;
const DEFAULT_LOSE_AT = 10;

// ── Deck primitives ───────────────────────────────────────────────────────────

function createDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank })));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardEquals(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

function isQueenOfClubs(c) {
  return c.rank === 'Q' && c.suit === '♣';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _trickWinnerPos(trick, ledSuit) {
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    const curr = trick[i].card;
    const prev = trick[best].card;
    if (curr.suit === ledSuit && prev.suit !== ledSuit) { best = i; continue; }
    if (curr.suit === ledSuit && prev.suit === ledSuit &&
        RANK_ORDER[curr.rank] > RANK_ORDER[prev.rank]) best = i;
  }
  return best;
}

// A player who earns all three base penalties pays 4 instead of 3.
function _applySweepBonus(penalties) {
  return penalties.map(p => p >= 3 ? p + 1 : p);
}

// ── State factory ─────────────────────────────────────────────────────────────

/**
 * Create the initial state for one hand.
 * @param {{ scores?: number[], firstLeader?: number, loseAt?: number }} config
 */
function dealState({ scores = [0, 0, 0, 0], firstLeader = 0, loseAt = DEFAULT_LOSE_AT } = {}) {
  const deck = shuffle(createDeck());
  const hands = Array.from({ length: PLAYER_COUNT }, (_, i) =>
    deck.slice(i * TRICKS_PER_HAND, (i + 1) * TRICKS_PER_HAND)
  );
  return {
    hands,
    scores: [...scores],
    handPenalties: Array(PLAYER_COUNT).fill(0),
    trickNum: 0,
    leader: firstLeader,
    currentTrick: [],
    trickLog: [],
    phase: 'playing',
    loseAt,
  };
}

function cloneState(state) {
  return structuredClone(state);
}

// ── Query functions (no mutation) ─────────────────────────────────────────────

/** Whose turn is it? Returns -1 when the hand is not in progress. */
function getCurrentPlayer(state) {
  if (state.phase !== 'playing') return -1;
  return (state.leader + state.currentTrick.length) % PLAYER_COUNT;
}

/**
 * Legal cards the current player may play.
 * Must follow the led suit when possible; otherwise any card is legal.
 */
function getLegalMoves(state) {
  if (state.phase !== 'playing') return [];
  const pi = getCurrentPlayer(state);
  const hand = state.hands[pi];
  if (state.currentTrick.length === 0) return [...hand];
  const ledSuit = state.currentTrick[0].card.suit;
  const followers = hand.filter(c => c.suit === ledSuit);
  return followers.length > 0 ? [...followers] : [...hand];
}

function isHandOver(state) {
  return state.phase === 'hand_over' || state.phase === 'game_over';
}

function isGameOver(state) {
  return state.phase === 'game_over';
}

/**
 * Penalty points earned in the current hand.
 * When the hand is complete, includes the sweep bonus.
 * During play, returns the running total (sweep not yet confirmed).
 */
function getHandResult(state) {
  return _applySweepBonus(state.handPenalties);
}

/**
 * Cumulative game scores and the loser(s).
 * `loser` is the index of the first player at the maximum score,
 * `losers` lists all tied players. Both are null while the game is ongoing.
 */
function getGameResult(state) {
  if (!isGameOver(state)) return { scores: [...state.scores], loser: null, losers: null };
  const max = Math.max(...state.scores);
  const losers = state.scores.flatMap((s, i) => s === max ? [i] : []);
  return { scores: [...state.scores], loser: losers[0], losers };
}

// ── Transition ────────────────────────────────────────────────────────────────

/**
 * Apply a move (card) for the current player. Returns a new state; never mutates.
 * Throws if the card is not in the player's hand or the move is illegal.
 */
function applyMove(state, card) {
  if (state.phase !== 'playing') throw new Error('Not in playing phase');

  const s = cloneState(state);
  const pi = getCurrentPlayer(s);

  const idx = s.hands[pi].findIndex(c => cardEquals(c, card));
  if (idx === -1) throw new Error(`Card ${JSON.stringify(card)} not in player ${pi}'s hand`);
  s.hands[pi].splice(idx, 1);

  s.currentTrick.push({ playerIndex: pi, card: { ...card } });

  if (s.currentTrick.length === PLAYER_COUNT) {
    const ledSuit = s.currentTrick[0].card.suit;
    const winPos = _trickWinnerPos(s.currentTrick, ledSuit);
    const winner = s.currentTrick[winPos].playerIndex;

    const isFirstTrick = s.trickNum === 0;
    const isLastTrick  = s.trickNum === TRICKS_PER_HAND - 1;
    const hasQoC       = s.currentTrick.some(t => isQueenOfClubs(t.card));

    const trickPenalties = Array(PLAYER_COUNT).fill(0);
    const penaltyLabels  = [];
    if (isFirstTrick) { trickPenalties[winner]++; penaltyLabels.push('first trick'); }
    if (isLastTrick)  { trickPenalties[winner]++; penaltyLabels.push('last trick'); }
    if (hasQoC)       { trickPenalties[winner]++; penaltyLabels.push('Queen of Clubs'); }

    s.trickLog.push({
      plays: s.currentTrick,
      ledSuit,
      winner,
      penalties: trickPenalties,
      penaltyLabels,
    });

    for (let i = 0; i < PLAYER_COUNT; i++) s.handPenalties[i] += trickPenalties[i];

    s.trickNum++;
    s.leader = winner;
    s.currentTrick = [];

    if (s.trickNum === TRICKS_PER_HAND) {
      const final = _applySweepBonus(s.handPenalties);
      for (let i = 0; i < PLAYER_COUNT; i++) s.scores[i] += final[i];
      s.phase = s.scores.some(sc => sc >= s.loseAt) ? 'game_over' : 'hand_over';
    }
  }

  return s;
}

// ── ISMCTS interface ──────────────────────────────────────────────────────────

/**
 * Produce a determinized world consistent with public information from
 * perspectivePlayer's point of view. Their hand is kept fixed; all other
 * players' hands are reshuffled among themselves (maintaining hand sizes).
 *
 * For ISMCTS: call this once per simulation to sample a possible world,
 * then run a standard MCTS rollout on the resulting fully-observable state.
 */
function determinize(state, perspectivePlayer) {
  if (isHandOver(state)) return cloneState(state);

  const s       = cloneState(state);
  const sizes   = s.hands.map(h => h.length);
  const hidden  = s.hands.flatMap((h, i) => i === perspectivePlayer ? [] : h);
  const reshuffled = shuffle(hidden);
  let cursor = 0;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    if (i !== perspectivePlayer) {
      s.hands[i] = reshuffled.slice(cursor, cursor + sizes[i]);
      cursor += sizes[i];
    }
  }
  return s;
}

/**
 * Scalar reward for ISMCTS rollouts.
 * Returns the negative hand-penalty for playerIndex (higher = better, max 0).
 * Returns null while the hand is in progress.
 */
function getReward(state, playerIndex) {
  if (!isHandOver(state)) return null;
  return -getHandResult(state)[playerIndex];
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  SUITS, RANKS, RANK_ORDER, SUIT_ORDER, TRICKS_PER_HAND, PLAYER_COUNT, DEFAULT_LOSE_AT,
  // Card utilities
  createDeck, shuffle, cardEquals, isQueenOfClubs,
  // State lifecycle
  dealState, cloneState,
  // Queries
  getCurrentPlayer, getLegalMoves, isHandOver, isGameOver,
  getHandResult, getGameResult,
  // Transition
  applyMove,
  // ISMCTS
  determinize, getReward,
};
