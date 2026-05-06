// ── Cards ─────────────────────────────────────────────────────────────────────

// 'T' is the trump/tarock suit used by Tarock game variants.
// The Fool is { suit: 'T', rank: '★' }.
export type Suit = '♣' | '♦' | '♥' | '♠' | 'T';

// rank is a plain string so each game engine can define its own valid set
// without forcing all games' ranks into a single union type.
// Slobberhannes: '7'–'A'. Tarock trumps: '1'–'21'. Fool: '★'.
export interface Card {
  suit: Suit;
  rank: string;
}

// ── Card locations ────────────────────────────────────────────────────────────

// Anywhere a card can physically reside during or after a game.
export type CardLocation =
  | { zone: 'hand';    player: number }
  | { zone: 'trick' }                    // face-up in the current trick
  | { zone: 'won';     player: number }  // collected trick pile
  | { zone: 'talon' }                    // face-down stock / widow
  | { zone: 'discard' };

// A single card movement the UI should animate or apply.
export interface CardTransfer {
  card: Card;
  from: CardLocation;
  to:   CardLocation;
}

// ── Players ───────────────────────────────────────────────────────────────────

export interface PlayerInfo {
  index:       number;
  displayName: string;
  isBot:       boolean;
}

// ── Moves (client → server) ───────────────────────────────────────────────────

export interface PlayCardMove {
  type: 'PLAY_CARD';
  card: Card;
}

export interface MakeBidMove {
  type: 'MAKE_BID';
  bid:  string;   // game-specific bid identifier
}

export interface PassBidMove {
  type: 'PASS_BID';
}

export interface MakeAnnouncementMove {
  type:         'MAKE_ANNOUNCEMENT';
  announcement: string;   // game-specific
}

export type Move = PlayCardMove | MakeBidMove | PassBidMove | MakeAnnouncementMove;

// ── Events (server → clients) ─────────────────────────────────────────────────
//
// Design principle: events are prescriptive. The engine encodes the full
// outcome — including all card destinations — so the UI needs no game-specific
// knowledge to animate or render a result correctly.
//
// The engine emits BareEvent values (no seq/ts/gameId). The server wraps each
// one into a GameEvent before broadcasting and persisting.

export interface GameEvent<T extends BareEvent = BareEvent> {
  seq:    number;   // monotonic counter per game session
  ts:     number;   // unix ms
  gameId: string;
  event:  T;
}

// ── Bare events (returned by engine functions) ────────────────────────────────

export interface GameStartedEvent {
  type:    'GAME_STARTED';
  players: PlayerInfo[];
  variant: string;   // e.g. 'slobberhannes', 'french-tarot'
}

export interface HandStartedEvent {
  type:       'HAND_STARTED';
  handNumber: number;
  dealer:     number;
}

// Each player receives only their own hand; opponents' cards are omitted.
export interface CardsDealtEvent {
  type:  'CARDS_DEALT';
  hands: { [playerIndex: number]: Card[] };
}

export interface BidMadeEvent {
  type:   'BID_MADE';
  player: number;
  bid:    string;
}

export interface BidPassedEvent {
  type:   'BID_PASSED';
  player: number;
}

// Emitted once the bidding phase resolves and the contract is known.
export interface ContractSetEvent {
  type:      'CONTRACT_SET';
  declarer:  number;
  contract:  string;
  partners?: number[];   // for team-based games
}

export interface AnnouncementMadeEvent {
  type:         'ANNOUNCEMENT_MADE';
  player:       number;
  announcement: string;
}

export interface CardPlayedEvent {
  type:   'CARD_PLAYED';
  player: number;
  card:   Card;
}

// Emitted when a trick is fully played out.
// `transfers` lists every card movement — most cards go to the winner,
// but exceptions (e.g. the Fool returning to its player) are included
// explicitly. The UI executes the transfer list without knowing why.
export interface TrickResolvedEvent {
  type:      'TRICK_RESOLVED';
  winner:    number;
  transfers: CardTransfer[];
}

// General-purpose card movement not tied to a trick: talon exchange,
// widow reveal, kitty discard, etc.
export interface CardsMovedEvent {
  type:      'CARDS_MOVED';
  transfers: CardTransfer[];
  reason:    string;   // e.g. 'talon-exchange', 'kitty-discard'
}

// Per-hand score breakdown. `delta` may be negative (loss).
export interface HandScoredEvent {
  type:          'HAND_SCORED';
  deltas:        { player: number; delta: number; reason: string }[];
  runningTotals: number[];
}

export interface GameOverEvent {
  type:          'GAME_OVER';
  finalScores:   number[];
  losers?:       number[];   // penalty-based games (Slobberhannes)
  winners?:      number[];   // target-based games
  ratingDeltas?: number[];   // populated server-side after Elo update
}

// Tells clients whose turn it is and what phase we are in.
// `legalMoves` is sent only to the player whose turn it is.
export interface TurnChangedEvent {
  type:        'TURN_CHANGED';
  player:      number;
  phase:       GamePhase;
  legalMoves?: Card[];
}

export type BareEvent =
  | GameStartedEvent
  | HandStartedEvent
  | CardsDealtEvent
  | BidMadeEvent
  | BidPassedEvent
  | ContractSetEvent
  | AnnouncementMadeEvent
  | CardPlayedEvent
  | TrickResolvedEvent
  | CardsMovedEvent
  | HandScoredEvent
  | GameOverEvent
  | TurnChangedEvent;

// ── Game phases ───────────────────────────────────────────────────────────────

export type GamePhase = 'bidding' | 'playing' | 'hand_over' | 'game_over';

// ── Engine contract ───────────────────────────────────────────────────────────
//
// Every engine move function must return this shape. The engine is pure:
// it never stamps seq/ts/gameId and has no knowledge of transport or observers.

export interface EngineResult<TState> {
  state:  TState;
  events: BareEvent[];
}
