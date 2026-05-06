import type { Card, BareEvent, EngineResult, Move } from '../types';

// ── Tarock deck constants ──────────────────────────────────────────────────────

// Tarocks ranked high → low: Sküs, Mond (XXI), XX … II, Pagat (I)
const TAROCK_RANKS = [
  '★', 'XXI', 'XX', 'XIX', 'XVIII', 'XVII', 'XVI', 'XV', 'XIV', 'XIII', 'XII',
  'XI', 'X', 'IX',  'VIII',  'VII',  'VI',  'V',  'IV',  'III',  'II',  'I',
] as const;

// Black-suit ranks high → low; red-suit ranks high → low
const BLACK_RANKS = ['K', 'Q', 'Kn', 'J', '10', '9', '8', '7'] as const;
const RED_RANKS   = ['K', 'Q', 'Kn', 'J', 'A',  '2', '3', '4'] as const;

const BLACK_SUITS = ['♣', '♠'] as const;
const RED_SUITS   = ['♥', '♦'] as const;

// Numeric strength (higher = stronger)
const TAROCK_RANK_ORDER: Record<string, number> = Object.fromEntries(
  [...TAROCK_RANKS].reverse().map((r, i) => [r, i])   // Pagat=0, Sküs=21
);
const BLACK_RANK_ORDER: Record<string, number> = Object.fromEntries(
  [...BLACK_RANKS].reverse().map((r, i) => [r, i])    // 7=0, K=7
);
const RED_RANK_ORDER: Record<string, number> = Object.fromEntries(
  [...RED_RANKS].reverse().map((r, i) => [r, i])      // 4=0, K=7
);

// Individual card-point values (before group deduction)
const CARD_POINT_VALUES: Record<string, number> = {
  '★': 4, 'XXI': 4, 'I': 4, // Trull (Sküs, Mond, Pagat)
  K: 4, Q: 3, Kn: 2, J: 1,  // court cards (all suits)
};

function cardPointValue(card: Card): number {
  return CARD_POINT_VALUES[card.rank] ?? 0;
}

/**
 * Standard Austrian tarock point counting is group cards in threes, deduct 2 per group.
 * But we will use the "original" system since it's more straightforward:
 * Add the card points, + 1 point per 3 cards.
 * The two players' counts sum to exactly 70.
 */
function countCardPoints(cards: Card[]): number {
  const groups = Math.floor(cards.length / 3);
  return cards.reduce((sum, c) => sum + cardPointValue(c), 0) + groups;
}

function isTarock(c: Card): boolean { return c.suit === 'T'; }

const PLAYER_COUNT          = 2  as const;
// Typical hand outcome magnitude: Beck win/loss ≈ ±2–3; Furr/Mayr ≈ ±3–4; Valat ≈ ±12–15.
// getReward normalises via tanh(r / REWARD_SCALE) → [0, 1]: normal results spread across
// [0.1, 0.9]; extreme outliers (Valat) compress gracefully toward the tails.
const REWARD_SCALE          = 4;   // private to engine; not exported
const INITIAL_HAND_SIZE     = 15;   // 3 packets of 5 per player
const STRAWMAN_PILE_COUNT   = 3;
const STRAWMAN_PILE_SIZE    = 4;
const TRICKS_PER_HAND       = INITIAL_HAND_SIZE + STRAWMAN_PILE_COUNT * STRAWMAN_PILE_SIZE; // 27
const DECLARER_WINS_AT      = 36;   // card points needed by declarer; 70 total
const DECLARER_MAJOR_WIN_AT = 45;   // Schneider threshold for declarer (Furr/Mayr)
const DEFENDER_MAJOR_WIN_AT = 44;   // Schneider threshold for defender (Furr/Mayr)

// Cards required for each announcement
const TRULL_RANKS       = new Set(['★', 'XXI', 'I']);
const ROYAL_TRULL_RANKS = new Set<string>(['K']);  // need 4 of these

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Play {
  playerIndex: number;
  card: Card;
}

export interface TrickRecord {
  plays:   Play[];
  ledSuit: string;
  winner:  number;
}

/**
 * A single strawman packet of four cards, stored bottom-to-top.
 *   cards[0]            — bottom, face-down while any card sits above it
 *   cards[length − 1]   — top, face-up and immediately playable
 * Once the bottom card is the last remaining it is revealed and becomes playable.
 */
export interface StrawmanPile {
  cards: Card[];
}

export interface Announcement {
  name:   string;   // 'Trull' | 'RoyalTrull'
  player: number;
}

// ── Scoring systems ───────────────────────────────────────────────────────────

/**
 * Everything derivable from a completed hand that scoring systems need.
 * Trull/RoyalTrull winners come from announcements, not captured cards.
 * All other fields are computed from the trick log.
 */
export interface HandSummary {
  declarer:           number;
  declarerCardPoints: number;
  defenderCardPoints: number;
  tricksWon:          [number, number];  // [player0 tricks, player1 tricks]
  pagatUltimoWinner:  number | null;     // who won the last trick with Pagat (I)
  uhuWinner:          number | null;     // who won the penultimate trick with Uhu (II)
  kakaduWinner:       number | null;     // who won the antepenultimate trick with Kakadu (III)
  quapilWinner:       number | null;     // who won the preantepenultimate trick with Quapil (IV)
  valatWinner:        number | null;     // who won all 27 tricks
  mondFangWinner:     number | null;     // who captured Mond (XXI) with Sküs (★)
  trullWinner:        number | null;     // who announced Trull (all of {★, XXI, I} in hand)
  royalTrullWinner:   number | null;     // who announced Royal Trull (all 4 kings in hand)
}

/**
 * A scoring system returns the basic game value and bonus value separately so the
 * draw-doubling multiplier can be applied to basic only (bonuses are never doubled).
 * Both values are from the declarer's perspective; defenderDelta = −declarerDelta.
 */
export interface ScoringSystem {
  readonly name:           string;
  readonly noDeclarerValue: number;   // value when both players passed; dealer pays forehand
  scoreHand(summary: HandSummary): { basicDelta: number; bonusDelta: number };
}

export type ScoringSystemName = 'Beck' | 'Furr' | 'Mayr';

// Bonus helper: ±value depending on whether the achiever is the declarer.
function _bonus(achiever: number | null, declarer: number, value: number): number {
  if (achiever === null) return 0;
  return achiever === declarer ? value : -value;
}

/**
 * Beck (1972) — the standard reference system.
 * Flat game values (no Schneider tier); Pagat Ultimo; Trull/Royal Trull by announcement.
 * Sources: Beck 1972 as summarised in Mayr & Sedlaczek 2008.
 */
const BECK: ScoringSystem = {
  name:            'Beck',
  noDeclarerValue: 1,
  scoreHand(s) {
    const basicDelta = s.declarerCardPoints >= DECLARER_WINS_AT ? 2
                     : s.declarerCardPoints === DECLARER_WINS_AT - 1 ? 0
                     : -3;
    const bonusDelta = _bonus(s.pagatUltimoWinner, s.declarer, 1)
                     + _bonus(s.trullWinner,        s.declarer, 1)
                     + _bonus(s.royalTrullWinner,   s.declarer, 1);
    return { basicDelta, bonusDelta };
  },
};

function _furrMayrBonuses(s: HandSummary): number {
  return _bonus(s.pagatUltimoWinner, s.declarer, 1)
       + _bonus(s.uhuWinner,         s.declarer, 1)
       + _bonus(s.kakaduWinner,      s.declarer, 1)
       + _bonus(s.valatWinner,       s.declarer, 12)
       + _bonus(s.mondFangWinner,    s.declarer, 1)
       + _bonus(s.trullWinner,       s.declarer, 1)
       + _bonus(s.royalTrullWinner,  s.declarer, 1);
  // TODO: Rostopschin (Tarocks VII and VIII played in consecutive tricks) ±1
}

/**
 * Furr (2009) — extended system with major-win tier and full bonus menu.
 * Note: despite appearing in the comparison table, Quapil is NOT in Furr per the source text.
 * Sources: Furr 2009.
 */
const FURR: ScoringSystem = {
  name:            'Furr',
  noDeclarerValue: 2,
  scoreHand(s) {
    const declarerWon = s.declarerCardPoints >= DECLARER_WINS_AT;
    const basicDelta  = s.declarerCardPoints === DECLARER_WINS_AT - 1 ? 0
                      : declarerWon
                          ? (s.declarerCardPoints >= DECLARER_MAJOR_WIN_AT ? 4 : 3)
                          : (s.defenderCardPoints >= DEFENDER_MAJOR_WIN_AT ? -5 : -4);
    return { basicDelta, bonusDelta: _furrMayrBonuses(s) };
  },
};

/**
 * Mayr & Sedlaczek (2008) — like Furr but without Major Win and Rostopschin.
 * Sources: Mayr & Sedlaczek 2008.
 */
const MAYR: ScoringSystem = {
  name:            'Mayr',
  noDeclarerValue: 2,
  scoreHand(s) {
    const basicDelta  = s.declarerCardPoints >= DECLARER_WINS_AT ? 3
                     : s.declarerCardPoints === DECLARER_WINS_AT - 1 ? 0
                     : -4;
    const bonusDelta  = _furrMayrBonuses(s)
                      + _bonus(s.quapilWinner, s.declarer, 1);
    return { basicDelta, bonusDelta };
  },
};

export const SCORING_SYSTEMS: Record<ScoringSystemName, ScoringSystem> = {
  Beck: BECK,
  Furr: FURR,
  Mayr: MAYR,
};

// ── State types ───────────────────────────────────────────────────────────────

export interface State {
  hands:              Card[][];          // main hand per player (15 initial cards, shrinks)
  strawmen:           StrawmanPile[][];  // [player][STRAWMAN_PILE_COUNT piles]
  capturedCards:      Card[][];          // all cards won by each player
  scores:             number[];          // cumulative game-point totals (zero-sum)
  playerCount:        typeof PLAYER_COUNT;
  phase:              'bidding' | 'playing' | 'hand_over' | 'game_over';
  declarer:           number | null;     // null = both players passed (hand still played, 0 scoring)
  bidder:             number;            // whose turn it is to bid
  dealerIndex:        number;            // who dealt this hand
  scoring:            ScoringSystemName;
  leader:             number;            // who leads the current trick
  currentTrick:       Play[];
  trickLog:           TrickRecord[];
  trickNum:           number;
  announcements:      Announcement[];    // announcements made this hand (Trull, RoyalTrull)
  pendingAnnouncement: string | null;    // if set, current player must play a card from this set
  handMultiplier:     number;            // basic game multiplier for this hand (2 after a draw)
  nextHandMultiplier: number;            // multiplier the session should pass to the next dealState
  revealedInHand:     Card[][];          // per-player cards in hand publicly seen by both players
  // No targetScore — Strohmandeln is played for a hard score with no fixed session length.
  // The session layer asks players after each hand_over whether to continue.
}

export interface DealConfig {
  scores?:          number[] | null;
  dealerIndex?:     number;
  scoring?:         ScoringSystemName;
  handMultiplier?:  number;   // pass previousState.nextHandMultiplier here
}

// ── Deck construction ─────────────────────────────────────────────────────────

function createDeck(): Card[] {
  const tarocks: Card[] = TAROCK_RANKS.map(rank => ({ suit: 'T' as const, rank }));
  const suitCards: Card[] = [
    ...BLACK_SUITS.flatMap(suit => BLACK_RANKS.map(rank => ({ suit, rank }))),
    ...RED_SUITS.flatMap(suit   => RED_RANKS.map(rank   => ({ suit, rank }))),
  ];
  return [...tarocks, ...suitCards]; // 22 + 32 = 54
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

// ── Trick resolution ──────────────────────────────────────────────────────────

/**
 * Returns a comparable strength value for a card in a trick.
 * Tarocks always beat suit cards. Off-suit non-tarock cards cannot win (−1).
 */
function _trickStrength(card: Card, ledSuit: string): number {
  if (isTarock(card)) return 1000 + (TAROCK_RANK_ORDER[card.rank] ?? 0);
  if (card.suit !== ledSuit) return -1;
  const order = (BLACK_SUITS as readonly string[]).includes(card.suit)
    ? BLACK_RANK_ORDER
    : RED_RANK_ORDER;
  return order[card.rank] ?? 0;
}

function _trickWinner(trick: Play[], ledSuit: string): number {
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (_trickStrength(trick[i]!.card, ledSuit) > _trickStrength(trick[best]!.card, ledSuit)) {
      best = i;
    }
  }
  return trick[best]!.playerIndex;
}

// ── State factory ─────────────────────────────────────────────────────────────

/**
 * Deal a new hand. In the physical game strawmen are dealt after bidding, but
 * dealing them upfront is equivalent — phases control when they are accessible.
 *
 * Deal order per packet: forehand first, then dealer (standard Austrian tarock).
 * Pass `handMultiplier: previousState.nextHandMultiplier` when continuing a session.
 */
function dealState({
  scores         = null,
  dealerIndex    = 0,
  scoring        = 'Beck',
  handMultiplier = 1,
}: DealConfig = {}): State {
  const deck     = shuffle(createDeck());
  const forehand = 1 - dealerIndex;
  const order    = [forehand, dealerIndex]; // who gets each packet first

  const hands: Card[][] = [[], []];
  let pos = 0;

  // 3 packets of 5 to each player
  for (let packet = 0; packet < 3; packet++) {
    for (const pi of order) {
      hands[pi]!.push(...deck.slice(pos, pos + 5));
      pos += 5;
    }
  }
  // pos = 30; each player has 15 cards

  // 3 strawman piles of 4 cards to each player
  const strawmen: StrawmanPile[][] = [[], []];
  for (let pile = 0; pile < STRAWMAN_PILE_COUNT; pile++) {
    for (const pi of order) {
      strawmen[pi]!.push({ cards: [...deck.slice(pos, pos + STRAWMAN_PILE_SIZE)] });
      pos += STRAWMAN_PILE_SIZE;
    }
  }
  // pos = 54; each player has 15 + 12 = 27 cards

  return {
    hands,
    strawmen,
    capturedCards:       [[], []],
    scores:              scores ? [...scores] : [0, 0],
    playerCount:         PLAYER_COUNT,
    phase:               'bidding',
    declarer:            null,
    bidder:              forehand,
    dealerIndex,
    scoring,
    leader:              forehand,
    currentTrick:        [],
    trickLog:            [],
    trickNum:            0,
    announcements:       [],
    pendingAnnouncement: null,
    handMultiplier,
    nextHandMultiplier:  1,
    revealedInHand:      [[], []],
  };
}

const _clone: <T>(x: T) => T = typeof structuredClone === 'function'
  ? structuredClone
  : (x) => JSON.parse(JSON.stringify(x)) as typeof x;

function cloneState(state: State): State {
  return _clone(state);
}

// ── Query functions (no mutation) ─────────────────────────────────────────────

function getCurrentPlayer(state: State): number {
  if (state.phase === 'bidding') return state.bidder;
  if (state.phase !== 'playing') return -1;
  return (state.leader + state.currentTrick.length) % PLAYER_COUNT;
}

/** All cards currently accessible to player pi: hand + top card of each non-empty pile. */
function _playableCards(state: State, pi: number): Card[] {
  const tops = (state.strawmen[pi] ?? [])
    .filter(p => p.cards.length > 0)
    .map(p => p.cards[p.cards.length - 1]!);
  return [...(state.hands[pi] ?? []), ...tops];
}

/**
 * Legal cards for the current player during the playing phase (Farbzwang rules).
 * Internal helper — callers should use getLegalMoves for the unified Move[] interface.
 */
function _getLegalCards(state: State): Card[] {
  if (state.phase !== 'playing') return [];
  const pi       = getCurrentPlayer(state);
  const playable = _playableCards(state, pi);

  if (state.pendingAnnouncement !== null) {
    // Player just announced — must play a card from the declared set to prove the claim.
    if (state.pendingAnnouncement === 'Trull') {
      return playable.filter(c => isTarock(c) && TRULL_RANKS.has(c.rank));
    }
    if (state.pendingAnnouncement === 'RoyalTrull') {
      return playable.filter(c => c.rank === 'K');
    }
  }

  if (state.currentTrick.length === 0) return playable;

  const ledSuit   = state.currentTrick[0]!.card.suit;
  const followers = playable.filter(c => c.suit === ledSuit);
  if (followers.length > 0) return followers;

  const tarocks = playable.filter(isTarock);
  if (tarocks.length > 0) return tarocks;

  return playable;
}

/**
 * All legal moves for the current player across every phase:
 *   - bidding  → MAKE_BID / PASS_BID
 *   - playing  → MAKE_ANNOUNCEMENT (optional, when leading) + PLAY_CARD moves
 *   - terminal → []
 */
function getLegalMoves(state: State): Move[] {
  if (state.phase === 'bidding') return getLegalBids(state);
  if (state.phase === 'playing') {
    const annMoves  = getLegalAnnouncements(state);
    const cardMoves = _getLegalCards(state).map(card => ({ type: 'PLAY_CARD' as const, card }));
    return [...annMoves, ...cardMoves];
  }
  return [];
}

/**
 * Legal bid moves for the current player during the bidding phase.
 * Both players always have the option to play or pass.
 */
function getLegalBids(state: State): Move[] {
  if (state.phase !== 'bidding') return [];
  return [
    { type: 'MAKE_BID', bid: 'play' },
    { type: 'PASS_BID' },
  ];
}

/**
 * Announcement moves available to the current player.
 * Only available when leading (pendingAnnouncement is null, currentTrick is empty)
 * and the player holds all required cards and has not yet made that announcement.
 */
function getLegalAnnouncements(state: State): Move[] {
  if (state.phase !== 'playing') return [];
  if (state.scoring !== 'Beck') return [];
  if (state.pendingAnnouncement !== null) return [];
  if (state.currentTrick.length !== 0) return [];

  const pi      = getCurrentPlayer(state);
  const playable = _playableCards(state, pi);
  const moves: Move[] = [];

  const alreadyAnnounced = new Set(state.announcements.map(a => a.name));

  if (!alreadyAnnounced.has('Trull')) {
    const trullCards = playable.filter(c => isTarock(c) && TRULL_RANKS.has(c.rank));
    if (trullCards.length === TRULL_RANKS.size) {
      moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Trull' });
    }
  }

  if (!alreadyAnnounced.has('RoyalTrull')) {
    const kings = playable.filter(c => c.rank === 'K');
    if (kings.length >= 4) {
      moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'RoyalTrull' });
    }
  }

  return moves;
}

function isHandOver(state: State): boolean {
  return state.phase === 'hand_over' || state.phase === 'game_over';
}

// Strohmandeln sessions have no fixed end condition — the engine never sets game_over.
// The session layer emits GAME_OVER after players choose not to continue.
function isGameOver(_state: State): boolean { return false; }

/**
 * Card-point totals for a completed hand.
 * Returns null if no hand was played (both players passed).
 */
function getHandResult(state: State): { declarerPoints: number; defenderPoints: number } | null {
  if (state.declarer === null) return null;
  const defender = 1 - state.declarer;
  return {
    declarerPoints: countCardPoints(state.capturedCards[state.declarer] ?? []),
    defenderPoints: countCardPoints(state.capturedCards[defender]       ?? []),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Find who won a trick with the Bird (trumps I - IV) at a given position from the end.
 * fromEnd=1 = last trick (Pagat Ultimo), 2 = penultimate (Uhu), etc.
 * Returns the winner's player index, or null if Pagat was not played there or did not win.
 */
function _birdWinnerAtPos(trickLog: TrickRecord[], fromEnd: number): number | null {
  const idx = trickLog.length - fromEnd;
  if (idx < 0) return null;
  const trick = trickLog[idx]!;
  const play  = trick.plays.find(p => p.card.suit === 'T' && p.card.rank === TAROCK_RANKS.at(-fromEnd));
  if (!play) return null;
  return trick.winner === play.playerIndex ? trick.winner : null;
}

/** Derive everything a scoring system needs from a completed hand. */
function computeHandSummary(state: State): HandSummary | null {
  if (state.declarer === null) return null;
  const { declarer, trickLog, capturedCards, announcements } = state;
  const defender = 1 - declarer;

  const tricksWon: [number, number] = [0, 0];
  for (const { winner } of trickLog) tricksWon[winner]!++;

  const valatWinner = tricksWon[0] === trickLog.length ? 0
    : tricksWon[1] === trickLog.length ? 1
    : null;

  let mondFangWinner: number | null = null;
  for (const { plays, winner } of trickLog) {
    const hasSküs = plays.some(p => p.card.suit === 'T' && p.card.rank === '★');
    const hasMond  = plays.some(p => p.card.suit === 'T' && p.card.rank === 'XXI');
    if (hasSküs && hasMond) { mondFangWinner = winner; break; }
  }

  let trullWinner: number | null = null;
  let royalTrullWinner: number | null = null;
  if (state.scoring === 'Beck') {
    const t  = announcements.find(a => a.name === 'Trull');
    const rt = announcements.find(a => a.name === 'RoyalTrull');
    trullWinner      = t  ? t.player  : null;
    royalTrullWinner = rt ? rt.player : null;
  } else {
    const hasTrull = (cards: Card[]) => {
      const ranks = new Set(cards.filter(c => c.suit === 'T').map(c => c.rank));
      return ranks.has('★') && ranks.has('XXI') && ranks.has('I');
    };
    const hasRoyalTrull = (cards: Card[]) => cards.filter(c => c.rank === 'K').length >= 4;
    if      (hasTrull(capturedCards[declarer] ?? [])) trullWinner = declarer;
    else if (hasTrull(capturedCards[defender] ?? [])) trullWinner = defender;
    if      (hasRoyalTrull(capturedCards[declarer] ?? [])) royalTrullWinner = declarer;
    else if (hasRoyalTrull(capturedCards[defender] ?? [])) royalTrullWinner = defender;
  }

  return {
    declarer,
    declarerCardPoints: countCardPoints(capturedCards[declarer] ?? []),
    defenderCardPoints: countCardPoints(capturedCards[defender] ?? []),
    tricksWon,
    pagatUltimoWinner: _birdWinnerAtPos(trickLog, 1),
    uhuWinner:         _birdWinnerAtPos(trickLog, 2),
    kakaduWinner:      _birdWinnerAtPos(trickLog, 3),
    quapilWinner:      _birdWinnerAtPos(trickLog, 4),
    valatWinner,
    mondFangWinner,
    trullWinner,
    royalTrullWinner,
  };
}

/**
 * Remove a card from the player's hand or the top of one of their strawman piles.
 * Returns the pile index (0-based) if removed from a pile, 'hand' if from hand,
 * or null if the card was not found.
 */
function _removePlayedCard(s: State, pi: number, card: Card): number | 'hand' | null {
  const idx = (s.hands[pi] ?? []).findIndex(c => cardEquals(c, card));
  if (idx !== -1) {
    s.hands[pi]!.splice(idx, 1);
    const ri = (s.revealedInHand[pi] ?? []).findIndex(c => cardEquals(c, card));
    if (ri !== -1) s.revealedInHand[pi]!.splice(ri, 1);
    return 'hand';
  }
  const piles = s.strawmen[pi] ?? [];
  for (let pileIdx = 0; pileIdx < piles.length; pileIdx++) {
    const pile = piles[pileIdx]!;
    if (pile.cards.length > 0 && cardEquals(pile.cards[pile.cards.length - 1]!, card)) {
      pile.cards.pop();
      return pileIdx;
    }
  }
  return null;
}

/**
 * After a card is played from a pile, process automatic transfers for the newly
 * exposed top card (and any cascade beneath it):
 *   • Tarock or King → CARD_REVEALED then CARDS_MOVED to owner's hand (repeats).
 *   • Last card in pile (length === 1) → CARDS_MOVED to hand without being revealed.
 *   • Any other suit card → stays face-up as the new playable pile top (stop).
 */
function _uncoverPile(s: State, pi: number, pileIdx: number, events: BareEvent[]): void {
  const pile = s.strawmen[pi]![pileIdx]!;
  const loc  = { zone: 'strawman' as const, player: pi, pile: pileIdx };

  while (true) {
    if (pile.cards.length === 0) break;

    if (pile.cards.length === 1) {
      const card = pile.cards.pop()!;
      s.hands[pi]!.push(card);
      events.push({ type: 'CARDS_MOVED', transfers: [{ card, from: loc, to: { zone: 'hand', player: pi } }], reason: 'bottom-to-hand' });
      break;
    }

    const top = pile.cards[pile.cards.length - 1]!;
    if (isTarock(top) || top.rank === 'K') {
      events.push({ type: 'CARD_REVEALED', player: pi, pile: pileIdx, card: top });
      pile.cards.pop();
      s.hands[pi]!.push(top);
      s.revealedInHand[pi]!.push(top);
      events.push({ type: 'CARDS_MOVED', transfers: [{ card: top, from: loc, to: { zone: 'hand', player: pi } }], reason: 'tarock-or-king' });
      // Loop: check whether the card beneath is also a T/K, or if the pile hit 1.
    } else {
      break;
    }
  }
}

/**
 * Process the initial strawman uncovering for both players (called once after dealing,
 * before bidding begins).
 *
 * For each pile (left-to-right per player):
 *   1. If the face-up top is a Tarock or King, it is "set aside" (CARD_REVEALED) and
 *      will be added to the player's hand after all piles are processed so the opponent
 *      can view it during that window.
 *   2. The bottom card is transferred to the player's hand immediately, face-down
 *      (CARDS_MOVED, reason 'bottom-to-hand' — no preceding CARD_REVEALED).
 *
 * After all piles: set-aside T/K cards are moved to hand (CARDS_MOVED, reason 'tarock-or-king').
 * No intra-pile cascade is triggered here; cascades only occur during play via _uncoverPile.
 */
/**
 * Process the initial strawman uncovering for both players (called once after dealing,
 * before bidding begins). Each pile is processed left-to-right via _uncoverPile:
 * T/K tops cascade immediately to the player's hand (CARD_REVEALED + CARDS_MOVED);
 * normal suit cards stop the cascade and remain face-up as the playable pile top.
 * The bottom card is NOT moved here — it only goes to hand when it becomes the
 * last remaining card in its pile (handled by _uncoverPile during play).
 */
function uncoverStrawmenInitial(state: State): EngineResult<State> {
  const s      = cloneState(state);
  const events: BareEvent[] = [];

  for (let pi = 0; pi < PLAYER_COUNT; pi++) {
    for (let pileIdx = 0; pileIdx < STRAWMAN_PILE_COUNT; pileIdx++) {
      _uncoverPile(s, pi, pileIdx, events);
    }
  }

  return { state: s, events };
}

/**
 * Apply handMultiplier to the basic game delta; bonuses are never doubled.
 * Also sets nextHandMultiplier: 2 on a draw (35–35), 1 otherwise.
 */
function _gamePointsForHand(s: State): { declarerDelta: number; defenderDelta: number } {
  const summary = computeHandSummary(s);
  if (!summary) return { declarerDelta: 0, defenderDelta: 0 };

  const { basicDelta, bonusDelta } = SCORING_SYSTEMS[s.scoring].scoreHand(summary);
  const totalDelta = basicDelta * s.handMultiplier + bonusDelta;

  // Set multiplier for the next hand: draw doubles it; any other result resets it.
  s.nextHandMultiplier = basicDelta === 0 ? 2 : 1;

  return { declarerDelta: totalDelta, defenderDelta: -totalDelta };
}

// ── Transitions ───────────────────────────────────────────────────────────────

function applyMove(state: State, move: Move): EngineResult<State> {
  if (state.phase === 'bidding') return _applyBid(state, move);
  if (state.phase === 'playing') {
    if (move.type === 'MAKE_ANNOUNCEMENT') return _applyAnnouncement(state, move.announcement);
    if (move.type === 'PLAY_CARD')         return _applyCardPlay(state, move.card);
    throw new Error(`Unexpected move type during playing phase: ${move.type}`);
  }
  throw new Error(`applyMove called in terminal phase: ${state.phase}`);
}

function _applyBid(state: State, move: Move): EngineResult<State> {
  if (move.type !== 'MAKE_BID' && move.type !== 'PASS_BID') {
    throw new Error('Expected MAKE_BID or PASS_BID during bidding phase');
  }
  const s      = cloneState(state);
  const pi     = s.bidder;
  const events: BareEvent[] = [];

  if (move.type === 'MAKE_BID') {
    events.push({ type: 'BID_MADE', player: pi, bid: 'play' });
    s.declarer = pi;
    s.phase    = 'playing';
    events.push({ type: 'CONTRACT_SET', declarer: pi, contract: 'play' });
  } else {
    events.push({ type: 'BID_PASSED', player: pi });
    if (pi !== s.dealerIndex) {
      // Forehand passed; dealer gets their chance.
      s.bidder = s.dealerIndex;
    } else {
      // Both passed — no declarer. Hand is still played; eldest leads as always.
      s.declarer = null;
      s.phase    = 'playing';
    }
  }

  return { state: s, events };
}

/**
 * Handle a Trull or Royal Trull announcement.
 * The bonus is deferred to end-of-hand (stored in state.announcements).
 * After announcing, the player still leads — but must play a card from the declared set.
 */
function _applyAnnouncement(state: State, announcement: string): EngineResult<State> {
  const pi = getCurrentPlayer(state);
  if (state.currentTrick.length !== 0) {
    throw new Error('Announcements can only be made when leading');
  }
  if (state.pendingAnnouncement !== null) {
    throw new Error('Already have a pending announcement — play a card first');
  }
  if (state.announcements.some(a => a.name === announcement)) {
    throw new Error(`${announcement} has already been announced this hand`);
  }

  const s = cloneState(state);
  s.announcements.push({ name: announcement, player: pi });
  s.pendingAnnouncement = announcement;

  const events: BareEvent[] = [
    { type: 'ANNOUNCEMENT_MADE', player: pi, announcement },
  ];

  return { state: s, events };
}

function _applyCardPlay(state: State, card: Card): EngineResult<State> {
  const s      = cloneState(state);
  const pi     = getCurrentPlayer(s);
  const events: BareEvent[] = [];

  const removedFrom = _removePlayedCard(s, pi, card);
  if (removedFrom === null) {
    throw new Error(`Card ${JSON.stringify(card)} not available for player ${pi}`);
  }
  if (typeof removedFrom === 'number') {
    _uncoverPile(s, pi, removedFrom, events);
  }

  // Clear pendingAnnouncement once the required card has been played.
  if (s.pendingAnnouncement !== null) s.pendingAnnouncement = null;

  s.currentTrick.push({ playerIndex: pi, card: { ...card } });
  events.push({ type: 'CARD_PLAYED', player: pi, card: { ...card } });

  if (s.currentTrick.length === PLAYER_COUNT) {
    const ledSuit = s.currentTrick[0]!.card.suit;
    const winner  = _trickWinner(s.currentTrick, ledSuit);

    for (const { card: c } of s.currentTrick) s.capturedCards[winner]!.push(c);
    s.trickLog.push({ plays: [...s.currentTrick], ledSuit, winner });

    events.push({
      type:      'TRICK_RESOLVED',
      winner,
      transfers: s.currentTrick.map(p => ({
        card: p.card,
        from: { zone: 'trick' as const },
        to:   { zone: 'won'   as const, player: winner },
      })),
    });

    s.trickNum++;
    s.leader       = winner;
    s.currentTrick = [];

    if (s.trickNum === TRICKS_PER_HAND) {
      if (s.declarer !== null) {
        const { declarerDelta, defenderDelta } = _gamePointsForHand(s);
        const defender = 1 - s.declarer;

        s.scores[s.declarer]! += declarerDelta;
        s.scores[defender]!   += defenderDelta;

        events.push({
          type:          'HAND_SCORED',
          deltas:        [
            { player: s.declarer, delta: declarerDelta, reason: 'hand-result' },
            { player: defender,   delta: defenderDelta, reason: 'hand-result' },
          ],
          runningTotals: [...s.scores],
        });
      } else {
        // No declarer: whoever wins more card points wins noDeclarerValue.
        // Draw (35–35) doubles the multiplier for the next hand.
        const p0pts = countCardPoints(s.capturedCards[0] ?? []);
        const p1pts = countCardPoints(s.capturedCards[1] ?? []);
        if (p0pts === p1pts) {
          s.nextHandMultiplier = s.handMultiplier * 2;
        } else {
          s.nextHandMultiplier = 1;
          const winner = p0pts > p1pts ? 0 : 1;
          const loser  = 1 - winner;
          const delta  = SCORING_SYSTEMS[s.scoring].noDeclarerValue * s.handMultiplier;
          s.scores[winner]! += delta;
          s.scores[loser]!  -= delta;
          events.push({
            type:          'HAND_SCORED',
            deltas:        [
              { player: winner, delta:  delta, reason: 'no-declarer-win' },
              { player: loser,  delta: -delta, reason: 'no-declarer-loss' },
            ],
            runningTotals: [...s.scores],
          });
        }
      }

      s.phase = 'hand_over';
      // Session layer emits GAME_OVER after asking players whether to continue.
      // Pass state.nextHandMultiplier into the next dealState({ handMultiplier: ... }).
    }
  }

  return { state: s, events };
}

// ── ISMCTS interface ──────────────────────────────────────────────────────────

/**
 * Scan the trick log for provable suit/tarock voids (opponents only).
 *
 * Farbzwang (follow-suit obligation):
 *   1. Must follow the led suit if possible.
 *   2. Otherwise must play a Tarock.
 *   3. Otherwise play any card.
 *
 * So when a non-leading player plays off-suit:
 *   - They are void in the led suit (always).
 *   - If they played a non-Tarock off-suit, they are also void in Tarocks
 *     (they would have been forced to play one otherwise).
 */
function _inferVoids(
  trickLog: TrickRecord[],
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

/**
 * Kuhn's augmenting-path step.
 * Tries to assign card ci to a free slot, displacing the current occupant if needed.
 * match[slotIdx] = cardIdx assigned to it (-1 = empty).
 */
function _augment(
  ci: number,
  match: number[],
  visited: Uint8Array,
  canUse: (ci: number, si: number) => boolean,
): boolean {
  for (let si = 0; si < match.length; si++) {
    if (visited[si]) continue;
    if (!canUse(ci, si)) continue;
    visited[si] = 1;
    if (match[si] === -1 || _augment(match[si]!, match, visited, canUse)) {
      match[si] = ci;
      return true;
    }
  }
  return false;
}

/**
 * Produce a determinized world consistent with perspectivePlayer's information.
 *
 * Hidden cards (all redistributed together):
 *   - Opponent's entire hand  — void constraints from Farbzwang apply.
 *   - ALL face-down pile cards (indices 0..length-2) for BOTH players.
 *     Even perspectivePlayer's own pile bottoms are unknown until they become
 *     the last card in the pile.  No void constraints apply to pile slots.
 *
 * Bipartite matching (Kuhn's algorithm) assigns cards to slots while respecting
 * the void constraints on the opponent's hand slots. Pile slots are unconstrained.
 * Falls back to a plain random shuffle if constraints are unsatisfiable.
 */
function determinize(state: State, perspectivePlayer: number): State {
  if (isHandOver(state)) return cloneState(state);

  const s        = cloneState(state);
  const opponent = 1 - perspectivePlayer;
  const voids    = _inferVoids(s.trickLog, perspectivePlayer);

  // ── Collect hidden cards and their destination slots ──────────────────────

  // Cards in the opponent's hand that were publicly revealed (T/K from piles) are
  // known to the perspective player and must stay pinned in the opponent's hand.
  const oppRevealed = s.revealedInHand[opponent]!;
  const oppUnknown  = s.hands[opponent]!.filter(
    c => !oppRevealed.some(r => cardEquals(r, c))
  );
  const oppHandSize = oppUnknown.length;   // only unknown slots need filling

  const hidden: Card[] = [...oppUnknown];

  type PileSlot = { owner: number; pileIdx: number; pos: number };
  const pileSlots: PileSlot[] = [];

  for (let pi = 0; pi < PLAYER_COUNT; pi++) {
    for (let pileIdx = 0; pileIdx < STRAWMAN_PILE_COUNT; pileIdx++) {
      const pile = s.strawmen[pi]![pileIdx]!;
      // Indices 0..length-2 are face-down; index length-1 is the face-up top (known).
      for (let pos = 0; pos < pile.cards.length - 1; pos++) {
        hidden.push(pile.cards[pos]!);
        pileSlots.push({ owner: pi, pileIdx, pos });
      }
    }
  }

  // ── Bipartite matching ─────────────────────────────────────────────────────

  const totalSlots = oppHandSize + pileSlots.length;
  // Slots 0..oppHandSize-1 belong to opponent (void-constrained).
  // Slots oppHandSize..totalSlots-1 are pile slots (unconstrained, sentinel = PLAYER_COUNT).
  const slotOwner = new Array<number>(totalSlots);
  for (let i = 0; i < oppHandSize; i++)          slotOwner[i]                = opponent;
  for (let i = 0; i < pileSlots.length; i++)     slotOwner[oppHandSize + i]  = PLAYER_COUNT;

  const shuffled = shuffle(hidden);

  const canUse = (ci: number, si: number): boolean => {
    if (slotOwner[si] === PLAYER_COUNT) return true;   // pile slot: always ok
    const pv = voids.get(slotOwner[si]!);
    return !pv || !pv.has(shuffled[ci]!.suit);
  };

  const match = new Array<number>(totalSlots).fill(-1);
  for (let ci = 0; ci < shuffled.length; ci++) {
    _augment(ci, match, new Uint8Array(totalSlots), canUse);
  }

  if (match.some(m => m === -1)) {
    // Void constraints unsatisfiable (shouldn't occur in valid states) — plain shuffle.
    const pool = shuffle(hidden);
    s.hands[opponent] = [...oppRevealed, ...pool.splice(0, oppHandSize)];
    for (const { owner, pileIdx, pos } of pileSlots) {
      s.strawmen[owner]![pileIdx]!.cards[pos] = pool.shift()!;
    }
    return s;
  }

  // ── Write assignments back ─────────────────────────────────────────────────

  // Pinned (known) cards stay; fill remaining hand slots with matched unknowns.
  s.hands[opponent] = [
    ...oppRevealed,
    ...match.slice(0, oppHandSize).map(ci => shuffled[ci]!),
  ];
  for (let i = 0; i < pileSlots.length; i++) {
    const { owner, pileIdx, pos } = pileSlots[i]!;
    s.strawmen[owner]![pileIdx]!.cards[pos] = shuffled[match[oppHandSize + i]!]!;
  }

  return s;
}

/**
 * Scalar reward for ISMCTS rollouts, normalised to [0, 1] via tanh.
 * Raw value = actual game-point delta + fractional card-point tiebreaker.
 * Card-point bonus (±0.2 max) never overrides a real scoring difference (min delta = ±1)
 * but ensures the tree plays well even in decided positions.
 * Returns null while the hand is in progress.
 */
function getReward(state: State, playerIndex: number): number | null {
  if (!isHandOver(state)) return null;

  // Fractional card-point bonus: breaks ties within the same integer outcome.
  const myPts       = countCardPoints(state.capturedCards[playerIndex] ?? []);
  const cardPtBonus = (myPts - 35) / 70 * 0.4;

  let raw: number;
  if (state.declarer === null) {
    const noDecVal = SCORING_SYSTEMS[state.scoring].noDeclarerValue;
    const base     = myPts > 35 ? noDecVal : myPts < 35 ? -noDecVal : 0;
    raw = base + cardPtBonus;
  } else {
    const summary = computeHandSummary(state);
    if (!summary) return (Math.tanh(cardPtBonus / REWARD_SCALE) + 1) / 2;
    const { basicDelta, bonusDelta } = SCORING_SYSTEMS[state.scoring].scoreHand(summary);
    const totalDelta  = basicDelta * state.handMultiplier + bonusDelta;
    const signedDelta = playerIndex === state.declarer ? totalDelta : -totalDelta;
    raw = signedDelta + cardPtBonus;
  }

  return (Math.tanh(raw / REWARD_SCALE) + 1) / 2;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  // Constants
  TAROCK_RANKS, BLACK_RANKS, RED_RANKS, BLACK_SUITS, RED_SUITS,
  PLAYER_COUNT, INITIAL_HAND_SIZE, STRAWMAN_PILE_COUNT, STRAWMAN_PILE_SIZE,
  TRICKS_PER_HAND, DECLARER_WINS_AT, DECLARER_MAJOR_WIN_AT, DEFENDER_MAJOR_WIN_AT,
  // Scoring systems
  BECK, FURR, MAYR,
  // Card utilities
  createDeck, shuffle, cardEquals, cardPointValue, countCardPoints, isTarock,
  // State lifecycle
  dealState, cloneState, uncoverStrawmenInitial,
  // Queries
  getCurrentPlayer, getLegalMoves, getLegalBids, getLegalAnnouncements,
  isHandOver, isGameOver, getHandResult, computeHandSummary,
  // Transition
  applyMove,
  // ISMCTS
  determinize, getReward,
};
