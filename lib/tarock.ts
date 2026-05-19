import type { Card } from '../types';

// ── Deck constants ─────────────────────────────────────────────────────────────

export const TAROCK_RANKS = [
  '★', 'XXI', 'XX', 'XIX', 'XVIII', 'XVII', 'XVI', 'XV', 'XIV', 'XIII', 'XII',
  'XI', 'X', 'IX', 'VIII', 'VII', 'VI', 'V', 'IV', 'III', 'II', 'I',
] as const;

export const BLACK_RANKS = ['K', 'Q', 'Kn', 'J', '10', '9', '8', '7'] as const;
export const RED_RANKS   = ['K', 'Q', 'Kn', 'J', 'A',  '2', '3', '4'] as const;

export const BLACK_SUITS     = ['♣', '♠'] as const;
export const RED_SUITS       = ['♥', '♦'] as const;
export const BLACK_SUITS_SET = new Set<string>(BLACK_SUITS);

export const TAROCK_RANK_ORDER: Record<string, number> = Object.fromEntries(
  [...TAROCK_RANKS].reverse().map((r, i) => [r, i])  // Pagat=0, Sküs=21
);
export const BLACK_RANK_ORDER: Record<string, number> = Object.fromEntries(
  [...BLACK_RANKS].reverse().map((r, i) => [r, i])   // 7=0, K=7
);
export const RED_RANK_ORDER: Record<string, number> = Object.fromEntries(
  [...RED_RANKS].reverse().map((r, i) => [r, i])     // 4=0, K=7
);

export const CARD_POINT_VALUES: Record<string, number> = {
  '★': 4, 'XXI': 4, 'I': 4,
  K: 4, Q: 3, Kn: 2, J: 1,
};

// ── Shared types ───────────────────────────────────────────────────────────────

export interface TarockPlay {
  playerIndex: number;
  card: Card;
}

export interface TarockTrickRecord {
  plays:   TarockPlay[];
  ledSuit: string;
  winner:  number;
}

// ── Card utilities ─────────────────────────────────────────────────────────────

export function cardPointValue(card: Card): number {
  return CARD_POINT_VALUES[card.rank] ?? 0;
}

/**
 * Austrian Tarock card-point counting: Σ(individual values) + floor((n+1)/3).
 * Groups of 3 contribute +1; a leftover pair contributes +1; a lone card nothing.
 */
export function countCardPoints(cards: Card[]): number {
  const groups = Math.floor((cards.length + 1) / 3);
  return cards.reduce((sum, c) => sum + cardPointValue(c), 0) + groups;
}

export function isTarock(c: Card): boolean { return c.suit === 'T'; }

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function createDeck(): Card[] {
  const tarocks: Card[] = TAROCK_RANKS.map(rank => ({ suit: 'T' as const, rank }));
  const suitCards: Card[] = [
    ...BLACK_SUITS.flatMap(suit => BLACK_RANKS.map(rank => ({ suit, rank }))),
    ...RED_SUITS.flatMap(suit   => RED_RANKS.map(rank   => ({ suit, rank }))),
  ];
  return [...tarocks, ...suitCards]; // 22 + 32 = 54
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

// ── Trick resolution ───────────────────────────────────────────────────────────

export function trickStrength(card: Card, ledSuit: string): number {
  if (isTarock(card)) return 1000 + (TAROCK_RANK_ORDER[card.rank] ?? 0);
  if (card.suit !== ledSuit) return -1;
  return (BLACK_SUITS_SET.has(card.suit) ? BLACK_RANK_ORDER : RED_RANK_ORDER)[card.rank] ?? 0;
}

export function trickWinner(trick: TarockPlay[], ledSuit: string): number {
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (trickStrength(trick[i]!.card, ledSuit) > trickStrength(trick[best]!.card, ledSuit)) {
      best = i;
    }
  }
  return trick[best]!.playerIndex;
}

// ── Rollout-policy helpers (shared by engine rolloutPolicy functions) ──────────

/** Numeric strength of a card for rollout ordering (higher = stronger). */
export function cardRank(c: Card): number {
  if (isTarock(c)) return TAROCK_RANK_ORDER[c.rank] ?? 0;
  return (BLACK_SUITS_SET.has(c.suit) ? BLACK_RANK_ORDER : RED_RANK_ORDER)[c.rank] ?? 0;
}

/** The card currently winning the in-progress trick, or null if the trick is empty. */
export function currentTrickWinnerCard(trick: TarockPlay[], ledSuit: string): Card | null {
  if (trick.length === 0) return null;
  const tarocks = trick.filter(p => isTarock(p.card));
  if (tarocks.length > 0) {
    return tarocks.reduce((best, p) =>
      (TAROCK_RANK_ORDER[p.card.rank] ?? 0) > (TAROCK_RANK_ORDER[best.card.rank] ?? 0) ? p : best
    ).card;
  }
  const ledCards = trick.filter(p => p.card.suit === ledSuit);
  if (ledCards.length === 0) return null;
  const rankOrder = BLACK_SUITS_SET.has(ledSuit) ? BLACK_RANK_ORDER : RED_RANK_ORDER;
  return ledCards.reduce((best, p) =>
    (rankOrder[p.card.rank] ?? 0) > (rankOrder[best.card.rank] ?? 0) ? p : best
  ).card;
}

/** True if `card` would beat `winningCard` given the led suit. */
export function headsCurrentTrick(card: Card, winningCard: Card, ledSuit: string): boolean {
  if (isTarock(winningCard)) {
    return isTarock(card) && (TAROCK_RANK_ORDER[card.rank] ?? 0) > (TAROCK_RANK_ORDER[winningCard.rank] ?? 0);
  }
  if (isTarock(card)) return true;
  if (card.suit !== ledSuit) return false;
  const rankOrder = BLACK_SUITS_SET.has(ledSuit) ? BLACK_RANK_ORDER : RED_RANK_ORDER;
  return (rankOrder[card.rank] ?? 0) > (rankOrder[winningCard.rank] ?? 0);
}

/** Pick the weakest move by card rank (lowest rank = smallest card-point risk). */
export function weakestMove<M extends { card: Card }>(moves: M[]): M {
  return moves.reduce((a, b) => cardRank(a.card) < cardRank(b.card) ? a : b);
}

/** Rollout follow policy: weakest winning card, or weakest overall if unable to win. */
export function followTrickPolicy<M extends { card: Card }>(
  plays: M[],
  trick:  TarockPlay[],
): M {
  const ledSuit    = trick[0]!.card.suit;
  const winnerCard = currentTrickWinnerCard(trick, ledSuit);
  if (winnerCard) {
    const winning = plays.filter(m => headsCurrentTrick(m.card, winnerCard, ledSuit));
    if (winning.length > 0) return weakestMove(winning);
  }
  return weakestMove(plays);
}

// ── Bird bonus utilities ───────────────────────────────────────────────────────

/**
 * Returns the winner of the trick at position `fromEnd` from the end of the log,
 * but only if the specified `birdRank` Tarock was played in that trick.
 * fromEnd=1 → last trick, fromEnd=2 → penultimate, etc.
 */
export function birdWinnerAtPos(
  trickLog: TarockTrickRecord[],
  fromEnd:  number,
  birdRank: string,
): number | null {
  const idx = trickLog.length - fromEnd;
  if (idx < 0) return null;
  const trick = trickLog[idx]!;
  const play  = trick.plays.find(p => p.card.suit === 'T' && p.card.rank === birdRank);
  if (!play) return null;
  return trick.winner;
}

// ── Void inference ─────────────────────────────────────────────────────────────

/**
 * Scan the trick log for provable suit/tarock voids (for all players except
 * perspectivePlayer, whose hand is known).
 *
 * Farbzwang: must follow led suit; if void, must play Tarock; if void in both, play anything.
 * So a non-leading player who plays off-suit:
 *   - is void in the led suit (always)
 *   - if they played a non-Tarock, is also void in Tarocks
 */
export function inferVoids(
  trickLog:          TarockTrickRecord[],
  perspectivePlayer: number,
): Map<number, Set<string>> {
  const voids = new Map<number, Set<string>>();
  const addVoid = (pi: number, suit: string) => {
    if (!voids.has(pi)) voids.set(pi, new Set());
    voids.get(pi)!.add(suit);
  };
  for (const { ledSuit, plays } of trickLog) {
    for (let i = 1; i < plays.length; i++) {
      const { playerIndex, card } = plays[i]!;
      if (playerIndex === perspectivePlayer) continue;
      if (card.suit !== ledSuit) {
        addVoid(playerIndex, ledSuit);
        if (!isTarock(card)) addVoid(playerIndex, 'T');
      }
    }
  }
  return voids;
}
