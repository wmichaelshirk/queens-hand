import type { Card } from './gameTypes';

const TRUMP_RANK: Record<string, number> = {
  I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6, VIII: 7, IX: 8, X: 9,
  XI: 10, XII: 11, XIII: 12, XIV: 13, XV: 14, XVI: 15, XVII: 16, XVIII: 17,
  XIX: 18, XX: 19, XXI: 20, "★": 21,
};

const SLOB_SUIT: Record<string, number> = { T: 0, "♣": 1, "♦": 2, "♠": 3, "♥": 4 };
const SLOB_RANK: Record<string, number> = {
  "7": 0, "8": 1, "9": 2, "10": 3, J: 4, Kn: 5, Q: 6, K: 7, A: 8,
  ...TRUMP_RANK,
};

export function slobberhannesSort(a: Card, b: Card): number {
  const sd = (SLOB_SUIT[a.suit] ?? 99) - (SLOB_SUIT[b.suit] ?? 99);
  if (sd !== 0) return sd;
  return (SLOB_RANK[a.rank] ?? 50) - (SLOB_RANK[b.rank] ?? 50);
}

// Strohmandeln rank ordering is suit-dependent:
//   Red (♥, ♦): 4 < 3 < 2 < A < J < Kn < Q < K
//   Black (♣, ♠): 7 < 8 < 9 < 10 < J < Kn < Q < K
const STRAW_SUIT: Record<string, number> = { T: 0, "♣": 1, "♦": 2, "♠": 3, "♥": 4 };
const RED_RANK: Record<string, number> = { "4": 0, "3": 1, "2": 2, A: 3, J: 4, Kn: 5, Q: 6, K: 7 };
const BLACK_RANK: Record<string, number> = { "7": 0, "8": 1, "9": 2, "10": 3, J: 4, Kn: 5, Q: 6, K: 7 };

function strawRank(card: Card): number {
  if (card.suit === "♥" || card.suit === "♦") return RED_RANK[card.rank] ?? 50;
  if (card.suit === "♣" || card.suit === "♠") return BLACK_RANK[card.rank] ?? 50;
  return TRUMP_RANK[card.rank] ?? 50;
}

export function strohmandelnSort(a: Card, b: Card): number {
  const sd = (STRAW_SUIT[a.suit] ?? 99) - (STRAW_SUIT[b.suit] ?? 99);
  if (sd !== 0) return sd;
  return strawRank(a) - strawRank(b);
}
