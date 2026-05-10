import type { Card } from './gameTypes';

const TRUMP_RANK: Record<string, number> = {
  I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6, VIII: 7, IX: 8, X: 9,
  XI: 10, XII: 11, XIII: 12, XIV: 13, XV: 14, XVI: 15, XVII: 16, XVIII: 17,
  XIX: 18, XX: 19, XXI: 20, "★": 21,
};

const WHIST_SUIT: Record<string, number> = { T: 0, "♣": 1, "♦": 2, "♠": 3, "♥": 4 };
const WHIST_RANK: Record<string, number> = {
  "2": 0,
  "3": 1,
  "4": 2,
  "5": 3,
  "6": 4,
  "7": 5,
  "8": 6, "9": 7, "10": 8, J: 9, Q: 10, K: 11, A: 12,
};

export function whistSort(a: Card, b: Card): number {
  const sd = (WHIST_SUIT[a.suit] ?? 99) - (WHIST_SUIT[b.suit] ?? 99);
  if (sd !== 0) return sd;
  return (WHIST_RANK[a.rank] ?? 50) - (WHIST_RANK[b.rank] ?? 50);
}

// Tarock rank ordering is suit-dependent:
//   Red (♥, ♦): 4 < 3 < 2 < A < J < Kn < Q < K
//   Black (♣, ♠): 7 < 8 < 9 < 10 < J < Kn < Q < K
const TAROCK_SUIT: Record<string, number> = { T: 0, "♣": 1, "♦": 2, "♠": 3, "♥": 4 };
const RED_RANK: Record<string, number> = { "4": 0, "3": 1, "2": 2, A: 3, J: 4, Kn: 5, Q: 6, K: 7 };
const BLACK_RANK: Record<string, number> = { "7": 0, "8": 1, "9": 2, "10": 3, J: 4, Kn: 5, Q: 6, K: 7 };

function tarockRank(card: Card): number {
  if (card.suit === "♥" || card.suit === "♦") return RED_RANK[card.rank] ?? 50;
  if (card.suit === "♣" || card.suit === "♠") return BLACK_RANK[card.rank] ?? 50;
  return TRUMP_RANK[card.rank] ?? 50;
}

export function tarockSort(a: Card, b: Card): number {
  const sd = (TAROCK_SUIT[a.suit] ?? 99) - (TAROCK_SUIT[b.suit] ?? 99);
  if (sd !== 0) return sd;
  return tarockRank(a) - tarockRank(b);
}
