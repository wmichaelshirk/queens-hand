export type Card = { suit: string; rank: string };
export type StrawmanPileInfo = { topCard: Card | null; depth: number };
export type Move =
  | { type: "PLAY_CARD"; card: Card }
  | { type: "MAKE_BID"; bid: string }
  | { type: "PASS_BID" }
  | { type: "MAKE_ANNOUNCEMENT"; announcement: string };

export type CardLocation =
  | { zone: 'hand'; player: number }
  | { zone: 'trick' }
  | { zone: 'won'; player: number }
  | { zone: 'strawman'; player: number; pile: number };

export type CardTransfer = { card: Card; from: CardLocation; to: CardLocation };

export type AnimEvent =
  | { type: 'CARD_PLAYED'; player: number; card: Card }
  | { type: 'TRICK_RESOLVED'; winner: number; transfers: CardTransfer[] }
  | { type: 'CARD_REVEALED'; player: number; pile: number; card: Card }
  | { type: 'CARDS_MOVED'; transfers: CardTransfer[]; reason: string }
  | { type: 'BID_MADE'; player: number; bid: string }
  | { type: 'BID_PASSED'; player: number }
  | { type: 'HAND_SCORED'; deltas: { player: number; delta: number; reason: string }[]; runningTotals: number[] }
  | { type: 'TURN_CHANGED' | 'ANNOUNCEMENT_MADE' | 'CONTRACT_SET' | 'GAME_STARTED' | 'HAND_STARTED' | 'GAME_OVER' };
