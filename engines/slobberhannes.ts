import type { Card, BareEvent, EngineResult } from '../types';
import type { ISMCTSEngine } from '../lib/engine';
import { bipartiteMatch } from '../lib/matching';

export const GAME_NAME = "Slobberhannes";
export const GAME_ICON = "Q♣";
/*
 * SLOBBERHANNES — Rules as implemented
 * Source: McLeod, J. (pagat.com/tricks/slobber.html); Parlett, D. "The Penguin Book of Card Games."
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * PLAYERS & DECK
 *   4 players  — standard 32-card German deck (7 8 9 10 J Q K A in ♣ ♦ ♥ ♠).
 *   5–6 players — 30-card deck: 7♣ and 7♠ removed (5 players: 6 cards each;
 *                 6 players: 5 cards each).  This matches McLeod/pagat.com.
 *   3 players  — this engine uses the same 30-card deck (10 cards each).
 *     ⚠  DEVIATION: standard references give 3 players a 24-card deck — all
 *        sevens AND eights removed — yielding 8 cards each, matching the
 *        4-player hand size.  The 30-card/10-per-player variant is playable
 *        but does not appear in McLeod or Parlett as the canonical form.
 *
 * DEAL & LEAD
 *   Cards are shuffled and dealt in equal hands.  The first leader is supplied
 *   externally (typically rotates among players each hand).
 *
 * TRICK-PLAY
 *   Players must follow the led suit if possible; otherwise any card may be played.
 *   The trick is won by the highest card of the led suit.  Off-suit cards never win.
 *   There are no trumps.
 *
 * PENALTIES  (lower cumulative score is better)
 *   Each of the following earns 1 penalty point for the player who wins it:
 *     • The first trick of the hand.
 *     • The last trick of the hand.
 *     • Any trick containing the Queen of Clubs (Q♣).
 *   Slobberhannes sweep: if one player earns all three in the same hand,
 *   they score 4 points instead of 3.
 *
 * SESSION / WINNING CONDITION
 *   The session ends when any player's cumulative penalty score reaches or
 *   exceeds `loseAt` (default: 10).  The player with the highest score loses.
 *   If multiple players tie at the highest score, all are listed as losers.
 */

const SUITS = ['♣', '♦', '♥', '♠'] as const;
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
const RANK_ORDER: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_ORDER: Record<string, number> = Object.fromEntries(SUITS.map((s, i) => [s, i]));
const SUPPORTED_PLAYER_COUNTS = [3, 4, 5, 6] as const;
const DEFAULT_PLAYER_COUNT = 4;
const DEFAULT_LOSE_AT = 10;

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Play {
  playerIndex: number;
  card: Card;
}

export interface TrickRecord {
  plays: Play[];
  ledSuit: string;
  winner: number;
  penalties: number[];
  penaltyLabels: string[];
}

export interface State {
  hands:         Card[][];
  scores:        number[];
  handPenalties: number[];
  playerCount:   number;
  tricksPerHand: number;
  trickNum:      number;
  leader:        number;
  currentTrick:  Play[];
  trickLog:      TrickRecord[];
  phase:         'playing' | 'hand_over' | 'game_over';
  loseAt:        number;
}

export interface GameResult {
  scores: number[];
  loser:  number | null;
  losers: number[] | null;
}

export interface DealConfig {
  scores?:      number[] | null;
  firstLeader?: number;
  loseAt?:      number;
  playerCount?: number;
}

// ── Deck primitives ───────────────────────────────────────────────────────────

function createDeck(): Card[] {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank })));
}

// 4 players use the full 32-card deck (8 cards each).
// 3, 5, and 6 players use a 30-card deck — 7♣ and 7♠ are omitted (10, 6, 5 each).
function deckForPlayerCount(playerCount: number): Card[] {
  const deck = createDeck();
  if (playerCount === 4) return deck;
  return deck.filter(c => !(c.rank === '7' && (c.suit === '♣' || c.suit === '♠')));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function isQueenOfClubs(c: Card): boolean {
  return c.rank === 'Q' && c.suit === '♣';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _trickWinnerPos(trick: Play[], ledSuit: string): number {
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    const curr = trick[i]!.card;
    const prev = trick[best]!.card;
    if (curr.suit === ledSuit && prev.suit !== ledSuit) { best = i; continue; }
    if (curr.suit === ledSuit && prev.suit === ledSuit &&
        (RANK_ORDER[curr.rank] ?? 0) > (RANK_ORDER[prev.rank] ?? 0)) best = i;
  }
  return best;
}

// A player who earns all three base penalties pays 4 instead of 3.
function _applySweepBonus(penalties: number[]): number[] {
  return penalties.map(p => p >= 3 ? p + 1 : p);
}

// ── State factory ─────────────────────────────────────────────────────────────

function dealState({
  scores = null,
  firstLeader = 0,
  loseAt = DEFAULT_LOSE_AT,
  playerCount = DEFAULT_PLAYER_COUNT,
}: DealConfig = {}): State {
  if (!(SUPPORTED_PLAYER_COUNTS as readonly number[]).includes(playerCount)) {
    throw new Error(`Unsupported player count: ${playerCount}. Must be one of ${SUPPORTED_PLAYER_COUNTS.join(', ')}`);
  }
  const deck = shuffle(deckForPlayerCount(playerCount));
  const tricksPerHand = deck.length / playerCount;
  const hands: Card[][] = Array.from({ length: playerCount }, (_, i) =>
    deck.slice(i * tricksPerHand, (i + 1) * tricksPerHand)
  );
  return {
    hands,
    scores: scores ? [...scores] : Array<number>(playerCount).fill(0),
    handPenalties: Array<number>(playerCount).fill(0),
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

const _clone: <T>(x: T) => T = typeof structuredClone === 'function'
  ? structuredClone
  : (x) => JSON.parse(JSON.stringify(x)) as typeof x;

function cloneState(state: State): State {
  return _clone(state);
}

// ── Query functions (no mutation) ─────────────────────────────────────────────

/** Whose turn is it? Returns -1 when the hand is not in progress. */
function getCurrentPlayer(state: State): number {
  if (state.phase !== 'playing') return -1;
  return (state.leader + state.currentTrick.length) % state.playerCount;
}

/**
 * Legal cards the current player may play.
 * Must follow the led suit when possible; otherwise any card is legal.
 */
function getLegalMoves(state: State): Card[] {
  if (state.phase !== 'playing') return [];
  const pi = getCurrentPlayer(state);
  const hand = state.hands[pi] ?? [];
  if (state.currentTrick.length === 0) return [...hand];
  const ledSuit = state.currentTrick[0]!.card.suit;
  const followers = hand.filter(c => c.suit === ledSuit);
  return followers.length > 0 ? [...followers] : [...hand];
}

function isHandOver(state: State): boolean {
  return state.phase === 'hand_over' || state.phase === 'game_over';
}

function isGameOver(state: State): boolean {
  return state.phase === 'game_over';
}

/**
 * Penalty points earned in the current hand.
 * When the hand is complete, includes the sweep bonus.
 * During play, returns the running total (sweep not yet confirmed).
 */
function getHandResult(state: State): number[] {
  return _applySweepBonus(state.handPenalties);
}

export interface PlayerHandBreakdown {
  player: number;
  items:  string[];  // each string is a 1-point penalty label; sweep adds 'sweep'
  total:  number;    // final penalty after sweep bonus
}

/**
 * Per-player penalty breakdown for the completed hand.
 * Aggregates penaltyLabels from the trick log and appends 'sweep' if the
 * sweep bonus (4th point) was triggered.
 */
function getHandBreakdown(state: State): PlayerHandBreakdown[] {
  const rawPenalties   = [...state.handPenalties];
  const finalPenalties = _applySweepBonus(rawPenalties);

  const labelsByPlayer = new Map<number, string[]>();
  for (const trick of state.trickLog) {
    if (trick.penaltyLabels.length > 0) {
      const existing = labelsByPlayer.get(trick.winner) ?? [];
      labelsByPlayer.set(trick.winner, [...existing, ...trick.penaltyLabels]);
    }
  }

  return Array.from({ length: state.playerCount }, (_, pi) => {
    const items = [...(labelsByPlayer.get(pi) ?? [])];
    if ((finalPenalties[pi] ?? 0) > (rawPenalties[pi] ?? 0)) items.push('sweep');
    return { player: pi, items, total: finalPenalties[pi] ?? 0 };
  });
}

/**
 * Cumulative game scores and the loser(s).
 * `loser` is the index of the first player at the maximum score,
 * `losers` lists all tied players. Both are null while the game is ongoing.
 */
function getGameResult(state: State): GameResult {
  if (!isGameOver(state)) return { scores: [...state.scores], loser: null, losers: null };
  const max = Math.max(...state.scores);
  const losers = state.scores.flatMap((s, i) => s === max ? [i] : []);
  return { scores: [...state.scores], loser: losers[0] ?? null, losers };
}

// ── Transition ────────────────────────────────────────────────────────────────

/**
 * Apply a move (card) for the current player. Returns a new state + events; never mutates.
 * Pass simulate=true in ISMCTS rollouts to skip event object construction.
 * Throws if the card is not in the player's hand or the move is illegal.
 */
function applyMove(state: State, card: Card, simulate = false): EngineResult<State> {
  if (state.phase !== 'playing') throw new Error('Not in playing phase');

  const s = cloneState(state);
  const pi = getCurrentPlayer(s);

  const idx = (s.hands[pi] ?? []).findIndex(c => cardEquals(c, card));
  if (idx === -1) throw new Error(`Card ${JSON.stringify(card)} not in player ${pi}'s hand`);
  s.hands[pi]!.splice(idx, 1);

  s.currentTrick.push({ playerIndex: pi, card: { ...card } });

  const events: BareEvent[] = [];
  if (!simulate) events.push({ type: 'CARD_PLAYED', player: pi, card: { ...card } });

  if (s.currentTrick.length === s.playerCount) {
    const ledSuit = s.currentTrick[0]!.card.suit;
    const winPos = _trickWinnerPos(s.currentTrick, ledSuit);
    const winner = s.currentTrick[winPos]!.playerIndex;

    const isFirstTrick = s.trickNum === 0;
    const isLastTrick  = s.trickNum === s.tricksPerHand - 1;
    const hasQoC       = s.currentTrick.some(t => isQueenOfClubs(t.card));

    const trickPenalties = Array<number>(s.playerCount).fill(0);
    const penaltyLabels: string[] = [];
    if (isFirstTrick) { trickPenalties[winner]!++; penaltyLabels.push('first trick'); }
    if (isLastTrick)  { trickPenalties[winner]!++; penaltyLabels.push('last trick'); }
    if (hasQoC)       { trickPenalties[winner]!++; penaltyLabels.push('Queen of Clubs'); }

    s.trickLog.push({
      plays: s.currentTrick,
      ledSuit,
      winner,
      penalties: trickPenalties,
      penaltyLabels,
    });

    for (let i = 0; i < s.playerCount; i++) s.handPenalties[i]! += trickPenalties[i]!;

    if (!simulate) {
      events.push({
        type: 'TRICK_RESOLVED',
        winner,
        transfers: s.currentTrick.map(p => ({
          card: p.card,
          from: { zone: 'trick' as const },
          to:   { zone: 'won' as const, player: winner },
        })),
      });
    }

    s.trickNum++;
    s.leader = winner;
    s.currentTrick = [];

    if (s.trickNum === s.tricksPerHand) {
      const final = _applySweepBonus(s.handPenalties);
      for (let i = 0; i < s.playerCount; i++) s.scores[i]! += final[i]!;
      const gameEnds = s.scores.some(sc => sc >= s.loseAt);
      s.phase = gameEnds ? 'game_over' : 'hand_over';

      if (!simulate) {
        const deltas = final.map((delta, player) => ({ player, delta, reason: 'hand-penalty' }));
        events.push({ type: 'HAND_SCORED', deltas, runningTotals: [...s.scores] });

        if (gameEnds) {
          const result = getGameResult(s);
          const gameOverEvent = result.losers
            ? { type: 'GAME_OVER' as const, finalScores: [...s.scores], losers: result.losers }
            : { type: 'GAME_OVER' as const, finalScores: [...s.scores] };
          events.push(gameOverEvent);
        }
      }
    }
  }

  return { state: s, events };
}

// ── ISMCTS interface ──────────────────────────────────────────────────────────

interface PlayerSlot {
  index: number;
  count: number;
}

/**
 * Scan trickLog for suit-void evidence.
 * When a non-leading player fails to follow the led suit they are provably
 * void in that suit for the rest of the hand.
 * Returns Map<playerIndex, Set<suit>>.
 */
function _inferVoids(trickLog: TrickRecord[], perspectivePlayer: number): Map<number, Set<string>> {
  const voids = new Map<number, Set<string>>();
  for (const { ledSuit, plays } of trickLog) {
    for (let i = 1; i < plays.length; i++) {   // plays[0] is the leader — no inference
      const play = plays[i]!;
      const { playerIndex, card } = play;
      if (playerIndex === perspectivePlayer) continue;
      if (card.suit !== ledSuit) {
        if (!voids.has(playerIndex)) voids.set(playerIndex, new Set());
        voids.get(playerIndex)!.add(ledSuit);
      }
    }
  }
  return voids;
}

/**
 * Assign cards to players via bipartite matching, respecting suit-void constraints.
 */
function _randomMatchingAssign(
  cards: Card[],
  players: PlayerSlot[],
  voids: Map<number, Set<string>>,
): Map<number, Card[]> {
  const slots = players.flatMap(({ index, count }) =>
    Array.from({ length: count }, () => index)
  );

  const canUse = (ci: number, si: number): boolean => {
    const pv = voids.get(slots[si]!);
    return !pv || !pv.has(cards[ci]!.suit);
  };

  const match = bipartiteMatch(cards.length, slots.length, canUse);
  if (!match) {
    throw new Error('determinize: void constraints unsatisfiable — invalid game state');
  }

  const result = new Map<number, Card[]>(players.map(({ index }) => [index, []]));
  for (let si = 0; si < slots.length; si++) {
    result.get(slots[si]!)!.push(cards[match[si]!]!);
  }
  return result;
}

/**
 * Produce a determinized world consistent with public information from
 * perspectivePlayer's point of view.
 */
function determinize(state: State, perspectivePlayer: number): State {
  if (isHandOver(state)) return cloneState(state);

  const s = cloneState(state);

  const voids   = _inferVoids(s.trickLog, perspectivePlayer);
  const hidden  = shuffle(s.hands.flatMap((h, i) => i === perspectivePlayer ? [] : h));
  const players = s.hands
    .map((h, i) => ({ index: i, count: h.length }))
    .filter(({ index }) => index !== perspectivePlayer);

  const assignment = _randomMatchingAssign(hidden, players, voids);
  for (const { index } of players) {
    s.hands[index] = assignment.get(index)!;
  }

  return s;
}

/**
 * Scalar reward for ISMCTS rollouts, normalised to [0, 1].
 * Penalties range [0, 4]; linear map: 0 penalties → 1.0, sweep (4) → 0.0.
 * Returns null while the hand is in progress.
 */
function getReward(state: State, playerIndex: number): number | null {
  if (!isHandOver(state)) return null;
  const penalty = getHandResult(state)[playerIndex] ?? 0;
  return (4 - penalty) / 4;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  // Constants
  SUITS, RANKS, RANK_ORDER, SUIT_ORDER,
  SUPPORTED_PLAYER_COUNTS, DEFAULT_PLAYER_COUNT, DEFAULT_LOSE_AT,
  // Card utilities
  createDeck, deckForPlayerCount, shuffle, cardEquals, isQueenOfClubs,
  // State lifecycle
  dealState, cloneState,
  // Queries
  getCurrentPlayer, getLegalMoves, isHandOver, isGameOver,
  getHandResult, getHandBreakdown, getGameResult,
  // Transition
  applyMove,
  // ISMCTS
  determinize, getReward,
};

// Compile-time verification that this module satisfies the ISMCTS engine contract.
const _: ISMCTSEngine<State, Card> = { getLegalMoves, applyMove, isHandOver, determinize, getReward };
