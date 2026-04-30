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
 *   playerCount:   number     — 3 | 4 | 5 | 6
 *   tricksPerHand: number     — cards dealt to each player (deck.length / playerCount)
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
const SUPPORTED_PLAYER_COUNTS = [3, 4, 5, 6];
const DEFAULT_PLAYER_COUNT = 4;
const DEFAULT_LOSE_AT = 10;

// ── Deck primitives ───────────────────────────────────────────────────────────

function createDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank })));
}

// 4 players use the full 32-card deck (8 cards each).
// 3, 5, and 6 players use a 30-card deck — 7♣ and 7♠ are omitted (10, 6, 5 each).
function deckForPlayerCount(playerCount) {
  const deck = createDeck();
  if (playerCount === 4) return deck;
  return deck.filter(c => !(c.rank === '7' && (c.suit === '♣' || c.suit === '♠')));
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
 * @param {{ scores?: number[], firstLeader?: number, loseAt?: number, playerCount?: number }} config
 */
function dealState({ scores = null, firstLeader = 0, loseAt = DEFAULT_LOSE_AT, playerCount = DEFAULT_PLAYER_COUNT } = {}) {
  if (!SUPPORTED_PLAYER_COUNTS.includes(playerCount)) {
    throw new Error(`Unsupported player count: ${playerCount}. Must be one of ${SUPPORTED_PLAYER_COUNTS.join(', ')}`);
  }
  const deck = shuffle(deckForPlayerCount(playerCount));
  const tricksPerHand = deck.length / playerCount;
  const hands = Array.from({ length: playerCount }, (_, i) =>
    deck.slice(i * tricksPerHand, (i + 1) * tricksPerHand)
  );
  return {
    hands,
    scores: scores ? [...scores] : Array(playerCount).fill(0),
    handPenalties: Array(playerCount).fill(0),
    playerCount,
    tricksPerHand,
    trickNum: 0,
    leader: firstLeader,
    currentTrick: [],
    trickLog: [],
    phase: 'playing',
    loseAt,
  };
}

const _clone = typeof structuredClone === 'function'
  ? structuredClone
  : (x) => JSON.parse(JSON.stringify(x));

function cloneState(state) {
  return _clone(state);
}

// ── Query functions (no mutation) ─────────────────────────────────────────────

/** Whose turn is it? Returns -1 when the hand is not in progress. */
function getCurrentPlayer(state) {
  if (state.phase !== 'playing') return -1;
  return (state.leader + state.currentTrick.length) % state.playerCount;
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

  if (s.currentTrick.length === s.playerCount) {
    const ledSuit = s.currentTrick[0].card.suit;
    const winPos = _trickWinnerPos(s.currentTrick, ledSuit);
    const winner = s.currentTrick[winPos].playerIndex;

    const isFirstTrick = s.trickNum === 0;
    const isLastTrick  = s.trickNum === s.tricksPerHand - 1;
    const hasQoC       = s.currentTrick.some(t => isQueenOfClubs(t.card));

    const trickPenalties = Array(s.playerCount).fill(0);
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

    for (let i = 0; i < s.playerCount; i++) s.handPenalties[i] += trickPenalties[i];

    s.trickNum++;
    s.leader = winner;
    s.currentTrick = [];

    if (s.trickNum === s.tricksPerHand) {
      const final = _applySweepBonus(s.handPenalties);
      for (let i = 0; i < s.playerCount; i++) s.scores[i] += final[i];
      s.phase = s.scores.some(sc => sc >= s.loseAt) ? 'game_over' : 'hand_over';
    }
  }

  return s;
}

// ── ISMCTS interface ──────────────────────────────────────────────────────────

/**
 * Scan trickLog for suit-void evidence.
 * When a non-leading player fails to follow the led suit they are provably
 * void in that suit for the rest of the hand.
 * Returns Map<playerIndex, Set<suit>>.
 */
function _inferVoids(trickLog, perspectivePlayer) {
  const voids = new Map();
  for (const { ledSuit, plays } of trickLog) {
    for (let i = 1; i < plays.length; i++) {   // plays[0] is the leader — no inference
      const { playerIndex, card } = plays[i];
      if (playerIndex === perspectivePlayer) continue;
      if (card.suit !== ledSuit) {
        if (!voids.has(playerIndex)) voids.set(playerIndex, new Set());
        voids.get(playerIndex).add(ledSuit);
      }
    }
  }
  return voids;
}

/**
 * Kuhn's augmenting-path step.
 * Tries to assign card ci to a free slot, recursively displacing the current
 * occupant of any slot if that occupant can be moved elsewhere.
 * match[slotIdx] = cardIdx assigned to it (-1 = empty).
 */
function _augment(ci, match, visited, canUse) {
  for (let si = 0; si < match.length; si++) {
    if (visited[si]) continue;
    if (!canUse(ci, si)) continue;
    visited[si] = 1;
    if (match[si] === -1 || _augment(match[si], match, visited, canUse)) {
      match[si] = ci;
      return true;
    }
  }
  return false;
}

/**
 * Assign cards to players via bipartite matching, respecting suit-void constraints.
 *
 * cards:   Card[]  — pre-shuffled hidden cards (shuffle drives randomness)
 * players: { index: number, count: number }[]
 * voids:   Map<playerIndex, Set<suit>>
 *
 * Returns Map<playerIndex, Card[]>.
 * Throws if constraints are unsatisfiable (should never occur in a valid game state).
 */
function _randomMatchingAssign(cards, players, voids) {
  // One slot entry per card each player needs, in player order.
  const slots = players.flatMap(({ index, count }) =>
    Array.from({ length: count }, () => index)
  );

  const canUse = (ci, si) => {
    const pv = voids.get(slots[si]);
    return !pv || !pv.has(cards[ci].suit);
  };

  const match = new Array(slots.length).fill(-1);   // match[slot] = card index
  for (let ci = 0; ci < cards.length; ci++) {
    _augment(ci, match, new Uint8Array(slots.length), canUse);
  }

  if (match.some(m => m === -1)) {
    throw new Error('determinize: void constraints unsatisfiable — invalid game state');
  }

  const result = new Map(players.map(({ index }) => [index, []]));
  for (let si = 0; si < slots.length; si++) {
    result.get(slots[si]).push(cards[match[si]]);
  }
  return result;
}

/**
 * Produce a determinized world consistent with public information from
 * perspectivePlayer's point of view.
 *
 * Their hand is fixed. All other players' cards are reassigned via bipartite
 * matching that enforces suit-void constraints from the trick history: if
 * player P failed to follow suit S in any prior trick, they hold no S cards —
 * no determinization will assign them one. Pre-shuffling the hidden card pool
 * before matching is what drives randomness across calls.
 *
 * For ISMCTS: call once per simulation iteration to sample a possible world,
 * then run a standard MCTS rollout on the resulting fully-observable state.
 */
function determinize(state, perspectivePlayer) {
  if (isHandOver(state)) return cloneState(state);

  const s = cloneState(state);

  const voids   = _inferVoids(s.trickLog, perspectivePlayer);
  const hidden  = shuffle(s.hands.flatMap((h, i) => i === perspectivePlayer ? [] : h));
  const players = s.hands
    .map((h, i) => ({ index: i, count: h.length }))
    .filter(({ index }) => index !== perspectivePlayer);

  const assignment = _randomMatchingAssign(hidden, players, voids);
  for (const { index } of players) {
    s.hands[index] = assignment.get(index);
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
  SUITS, RANKS, RANK_ORDER, SUIT_ORDER,
  SUPPORTED_PLAYER_COUNTS, DEFAULT_PLAYER_COUNT, DEFAULT_LOSE_AT,
  // Card utilities
  createDeck, deckForPlayerCount, shuffle, cardEquals, isQueenOfClubs,
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
