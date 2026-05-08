export type Card = { suit: string; rank: string };
export type StrawmanPileInfo = { topCard: Card | null; depth: number };
export type Move =
  | { type: "PLAY_CARD"; card: Card }
  | { type: "MAKE_BID"; bid: string }
  | { type: "PASS_BID" }
  | { type: "MAKE_ANNOUNCEMENT"; announcement: string };
