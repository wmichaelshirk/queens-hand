export type Card = { suit: string; rank: string };
export type StrawmanPileInfo = { topCard: Card | null; depth: number };
export type DeclaringSubAction =
  | { type: 'MAKE_ANNOUNCEMENT'; announcement: string }
  | { type: 'KONTRA'; target: string };

export type Move =
  | { type: "PLAY_CARD"; card: Card }
  | { type: "MAKE_BID"; bid: string }
  | { type: "PASS_BID" }
  | { type: "MAKE_ANNOUNCEMENT"; announcement: string }
  | { type: "PASS_ANNOUNCEMENT" }
  | { type: "CHOOSE_CONTRACT"; contract: string }
  | { type: "CHOOSE_TALON"; choice: "first" | "second" }
  | { type: "DISCARD_CARD"; card: Card }
  | { type: "KONTRA"; target: string }
  | { type: "SUBMIT_DECLARATION"; actions: DeclaringSubAction[] }
  | { type: "SUBMIT_DISCARDS"; cards: Card[] };

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
  | { type: 'ANNOUNCEMENT_MADE'; player: number; announcement: string }
  | { type: 'CONTRACT_SET'; declarer: number; contract: string }
  | { type: 'GAME_OVER'; losers?: number[] }
  | { type: 'TURN_CHANGED' | 'GAME_STARTED' | 'HAND_STARTED' }
  | { type: 'DEAL'; dealer: number; to: number; zone: 'hand' | 'strawman'; pile?: number; count: number };

export type GameSeat = {
  seatIndex: number;
  playerId: string;
  displayName: string;
  isBot: boolean;
  enginePlayerIndex: number;
  handSize: number;
};

export type GamePublicState = {
  currentTrick: { playerIndex: number; card: Card }[];
  scores: number[];
  currentTurn: number;
  dealer: number;
  trickNum: number;
  phase: string;
  lastCompletedTrick: { plays: { playerIndex: number; card: Card }[]; winner: number } | null;
  recentEvents: AnimEvent[];
  currentBid: string | null;
  declarer?: number;
};

export type ContinuationState = {
  votes: Record<string, 'continue' | 'quit'>;
  myVote: 'continue' | 'quit' | null;
};

export type HandSummary = {
  deltas: { player: number; delta: number; reason: string }[];
  runningTotals: number[];
  seatNames: string[];
  breakdown: { player: number; role: string | null; items: { label: string; delta: number }[]; total: number }[] | null;
  gameTarget: number | null;
  losers: number[] | null;
};

export type TalonState = {
  revealed: boolean;
  groups: [Card[], Card[]];
};

export type GameState = {
  publicState: GamePublicState;
  myHand: Card[];
  legalMoves: Move[];
  seats: GameSeat[];
  gameType: string;
  strawmen: StrawmanPileInfo[][] | null;
  talon: TalonState | null;
  continuation: ContinuationState | null;
  lastHandSummary: HandSummary | null;
} | null;
