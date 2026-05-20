import type { Card, BareEvent, DealEvent, EngineResult, Move } from '../types';
import type { ISMCTSEngine } from '../lib/engine';
import { bipartiteMatch } from '../lib/matching';
import {
  TAROCK_RANKS, BLACK_RANKS, RED_RANKS, BLACK_SUITS, RED_SUITS,
  TRULL_RANKS,
  cardPointValue, countCardPoints, isTarock, cardEquals, createDeck, shuffle,
  trickWinner as _trickWinnerFn,
  birdWinnerAtPos as _birdWinnerAtPosFn, inferVoids as _inferVoidsFn,
  followTrickPolicy,
} from '../lib/tarock';
import type { TarockPlay, TarockTrickRecord } from '../lib/tarock';

export const GAME_NAME = "Strohmandeln";
export const GAME_ICON = "👨🏻‍🌾";

/*
 * STROHMANDELN — 2-player Austrian Tarock — Rules as implemented
 * Sources: Mayr & Sedlaczek (2016); McLeod, J.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * DECK  (54 cards)
 *   Tarocks / trumps (high → low):
 *     Sküs (★), Mond (XXI), XX … II, Pagat (I).   22 cards total.
 *   Black suits ♣ ♠ (high → low):  K Q Kn J 10 9 8 7.
 *   Red suits   ♥ ♦ (high → low):  K Q Kn J A 2 3 4.
 *
 * DEAL  (forehand = 1 − dealerIndex; packets dealt forehand-first)
 *   Hand:     3 packets of 5 cards  → 15 hand cards per player.
 *   Strawman: 3 piles  of 4 cards   → 12 pile cards per player (face-down).
 *   After dealing, each pile's top card is face-up.  Initial uncovering:
 *     Tarock or King on top → immediately transferred to owner's hand (public,
 *     CARD_REVEALED + CARDS_MOVED); cascades until a normal suit card stops it.
 *     The bottom card of a pile only enters the hand when it becomes the last
 *     remaining card in that pile (CARDS_MOVED, reason 'bottom-to-hand').
 *
 * BIDDING
 *   Forehand bids first.  Each player may bid 'play' (MAKE_BID) or PASS_BID.
 *   The first player to bid 'play' becomes the declarer; play phase begins.
 *   If both pass: hand is played without a declarer (no-bid hand; smaller stakes).
 *
 * TRICK-PLAY  (Farbzwang — compulsory-follow rules)
 *   1. Must follow the led suit if able.
 *   2. If void in led suit, must play a Tarock.
 *   3. If void in both, may play any card.
 *   Trick won by: the highest Tarock played; or, if no Tarock, the highest card
 *   of the led suit.  Off-suit non-Tarock cards cannot win.
 *   When a pile top is played, the newly exposed card is processed:
 *     Tarock or King → cascades to hand (public); normal suit card → new pile top.
 *
 * CARD POINTS  (both players' totals always sum to 70)
 *   Trull (★, XXI, I): 4 pts each.  Kings: 4 pts each.
 *   Queens: 3 pts.  Knights (Kn): 2 pts.  Jacks: 1 pt.  All others: 0 pts.
 *   Counting: Σ(individual values) + floor((n+1)/3) for n cards captured.
 *     Groups of 3 contribute +1; a leftover pair also contributes +1;
 *     a single leftover card contributes nothing.
 *
 * WINNING CONDITION
 *   Declarer must capture ≥ 36 card points (out of 70) to win the hand.
 *   Exactly 35 each = LOSS for the declarer (35 is not a draw when there is a declarer).
 *   No-bid hand: whoever captures more card points wins noDeclarerValue × multiplier.
 *   No-bid draw (35–35): multiplier doubles for the next round (2 hands); no score transfer.
 *
 * HAND MULTIPLIER
 *   Starts at 1.  Only a no-bid 35–35 draw triggers doubling; the multiplier
 *   applies for the next round (2 hands) and does not compound (a second no-bid
 *   draw refreshes the 2-hand window rather than stacking).
 *   The multiplier applies to the entire score (basic delta + bonuses).
 *
 * SCORING SYSTEMS  (select via DealConfig.scoring)
 *
 *   Beck (1972) — default:
 *     Win: +2.  Loss: −3.  No-bid winner: +1.
 *     Bonuses (±1): Pagat Ultimo, Trull announcement, Royal Trull announcement.
 *     Trull/Royal Trull must be announced at lead time; the announcer must then
 *     immediately play a qualifying card (Trull card or King respectively).
 *     Trull = hold all three of {★, XXI, I} accessible (hand + pile tops).
 *     Royal Trull = hold all four Kings accessible.
 *
 *   Mayr & Sedlaczek (2008):
 *     Win: +3.  Loss: −4.  No-bid winner: +2.
 *     Bonuses (±1): Pagat Ultimo, Uhu, Kakadu, Quapil, Mond Fang, Trull, Royal Trull.
 *     Bonus (±12): Valat (win all 27 tricks); 
 *        replaces game value, Trull, and Royal Trull — Mond Fang and birds still score.
 *     Trull/Royal Trull: awarded to whoever captures all required cards.
 *     
 *
 * BONUS REFERENCE
 *   Pagat Ultimo  (±1): win the last trick        with Tarock I.
 *   Uhu           (±1): win the penultimate trick  with Tarock II.
 *   Kakadu        (±1): win the antepenultimate    with Tarock III.
 *   Quapil        (±1): win the 4th-from-last      with Tarock IV.
 *   Valat         (±12): win all 27 tricks.  Replaces game value, Trull,
 *                        and Royal Trull; Mond Fang and birds still apply.
 *   Mond Fang     (±1): capture Mond (XXI) in a trick that also contains Sküs (★).
 *   Trull         (±1): capture (or announce, in Beck) all of {★, XXI, I}.
 *   Royal Trull   (±1): capture (or announce, in Beck) all four Kings.
 *
 * SESSION
 *   Strohmandeln has no fixed end condition.  The session layer asks players
 *   after each hand_over whether to continue (isGameOver always returns false).
 */

// ── Engine constants ───────────────────────────────────────────────────────────

const PLAYER_COUNT          = 2  as const;
// Typical hand outcome magnitude: Beck win/loss ≈ ±2–3; Mayr ≈ ±3–4; Valat ≈ ±12–15.
// getReward normalises via tanh(r / REWARD_SCALE) → [0, 1]: normal results spread across
// [0.1, 0.9]; extreme outliers (Valat) compress gracefully toward the tails.
const REWARD_SCALE          = 4;   // private to engine; not exported
const INITIAL_HAND_SIZE     = 15;  // 3 packets of 5 per player
const STRAWMAN_PILE_COUNT   = 3;
const STRAWMAN_PILE_SIZE    = 4;
const TRICKS_PER_HAND       = INITIAL_HAND_SIZE + STRAWMAN_PILE_COUNT * STRAWMAN_PILE_SIZE; // 27
const DECLARER_WINS_AT      = 36;   // card points needed by declarer; 70 total

// Cards required for each announcement (TRULL_RANKS imported from lib/tarock)
const ROYAL_TRULL_RANKS = new Set<string>(['K']);  // need 4 of these

// ── Domain types ──────────────────────────────────────────────────────────────

export type Play        = TarockPlay;
export type TrickRecord = TarockTrickRecord;

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
 * A scoring system returns basicDelta and bonusDelta separately.
 * The hand multiplier is applied to (basicDelta + bonusDelta) together.
 * Both values are from the declarer's perspective; defenderDelta = −declarerDelta.
 */
export interface ScoringSystem {
  readonly name:           string;
  readonly noDeclarerValue: number;   // value when both players passed; dealer pays forehand
  scoreHand(summary: HandSummary): { basicDelta: number; bonusDelta: number };
}

export type ScoringSystemName = 'Beck' | 'Mayr';

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
    const basicDelta = s.declarerCardPoints >= DECLARER_WINS_AT ? 2 : -3;
    const bonusDelta = _bonus(s.pagatUltimoWinner, s.declarer, 1)
                     + _bonus(s.trullWinner,        s.declarer, 1)
                     + _bonus(s.royalTrullWinner,   s.declarer, 1);
    return { basicDelta, bonusDelta };
  },
};

function _MayrBonuses(s: HandSummary): number {
  return _bonus(s.pagatUltimoWinner, s.declarer, 1)
       + _bonus(s.uhuWinner,         s.declarer, 1)
       + _bonus(s.kakaduWinner,      s.declarer, 1)
       + _bonus(s.mondFangWinner,    s.declarer, 1)
       + _bonus(s.trullWinner,       s.declarer, 1)
       + _bonus(s.royalTrullWinner,  s.declarer, 1);
}

function _valatBonuses(s: HandSummary, includeQuapil = false): number {
  return _bonus(s.pagatUltimoWinner, s.declarer, 1)
       + _bonus(s.uhuWinner,         s.declarer, 1)
       + _bonus(s.kakaduWinner,      s.declarer, 1)
       + _bonus(s.mondFangWinner,    s.declarer, 1)
       + (includeQuapil ? _bonus(s.quapilWinner, s.declarer, 1) : 0);
}


/**
 * Mayr & Sedlaczek (2008) 
 * Sources: Mayr & Sedlaczek 2008.
 */
const MAYR: ScoringSystem = {
  name: 'Mayr',
  noDeclarerValue: 2,
  scoreHand(s) {
    if (s.valatWinner !== null) {
      return { basicDelta: _bonus(s.valatWinner, s.declarer, 12), bonusDelta: _valatBonuses(s, true) };
    }
    const basicDelta  = s.declarerCardPoints >= DECLARER_WINS_AT ? 3 : -4;
    const bonusDelta  = _MayrBonuses(s)
                      + _bonus(s.quapilWinner, s.declarer, 1);
    return { basicDelta, bonusDelta };
  },
};

export const SCORING_SYSTEMS: Record<ScoringSystemName, ScoringSystem> = {
  Beck: BECK,
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
  handMultiplier:     number;            // score multiplier for this hand (set from nextHandMultiplier at deal time)
  nextHandMultiplier: number;            // multiplier the session should pass to the next dealState
  revealedInHand:     Card[][];          // per-player cards in hand publicly seen by both players
  deferredPileReveal: { player: number; pileIdx: number } | null;  // set when leading from a pile; processed after trick resolves
  // No targetScore — Strohmandeln is played for a hard score with no fixed session length.
  // The session layer asks players after each hand_over whether to continue.
}

export interface DealConfig {
  scores?:          number[] | null;
  dealerIndex?:     number;
  scoring?:         ScoringSystemName;
  handMultiplier?:  number;   // pass previousState.nextHandMultiplier here
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
    deferredPileReveal:  null,
  };
}

function getDealEvents(dealerIndex: number): DealEvent[] {
  const forehand = 1 - dealerIndex;
  const order = [forehand, dealerIndex];
  const events: DealEvent[] = [];
  for (let packet = 0; packet < 3; packet++)
    for (const pi of order)
      events.push({ type: 'DEAL', dealer: dealerIndex, to: pi, zone: 'hand', count: 5 });
  for (let pile = 0; pile < STRAWMAN_PILE_COUNT; pile++)
    for (const pi of order)
      events.push({ type: 'DEAL', dealer: dealerIndex, to: pi, zone: 'strawman', pile, count: STRAWMAN_PILE_SIZE });
  return events;
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
  if (state.phase === 'bidding') return _getLegalBids(state);
  if (state.phase === 'playing') {
    const annMoves  = _getLegalAnnouncements(state);
    const cardMoves = _getLegalCards(state).map(card => ({ type: 'PLAY_CARD' as const, card }));
    return [...annMoves, ...cardMoves];
  }
  return [];
}

function _getLegalBids(state: State): Move[] {
  if (state.phase !== 'bidding') return [];
  return [
    { type: 'MAKE_BID', bid: 'play' },
    { type: 'PASS_BID' },
  ];
}

function _getLegalAnnouncements(state: State): Move[] {
  if (state.phase !== 'playing') return [];
  if (state.scoring !== 'Beck') return [];
  if (state.pendingAnnouncement !== null) return [];
  if (state.currentTrick.length !== 0) return [];

  const pi       = getCurrentPlayer(state);
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

function _birdWinnerAtPos(trickLog: TrickRecord[], fromEnd: number): number | null {
  return _birdWinnerAtPosFn(trickLog, fromEnd, TAROCK_RANKS.at(-fromEnd)!);
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

export interface PlayerScoreBreakdown {
  player: number;
  role:   'declarer' | 'defender' | 'none';  // 'none' = no-bid hand
  items:  Array<{ label: string; delta: number }>;  // delta from this player's perspective
  total:  number;
}

/**
 * Produce per-item score line-items from the declarer's perspective.
 * Each item's declarerDelta: positive = good for declarer.
 * Only non-zero items are included (only things that actually scored).
 */
function _breakdownItems(
  scoring: ScoringSystemName,
  s:       HandSummary,
): Array<{ label: string; declarerDelta: number }> {
  const items: Array<{ label: string; declarerDelta: number }> = [];

  const bi = (achiever: number | null, label: string, val = 1) => {
    const d = _bonus(achiever, s.declarer, val);
    if (d !== 0) items.push({ label, declarerDelta: d });
  };

  if (scoring === 'Beck') {
    const won = s.declarerCardPoints >= DECLARER_WINS_AT;
    items.push({ label: `game (${won ? 'win' : 'loss'}, ${s.declarerCardPoints}–${s.defenderCardPoints})`, declarerDelta: won ? 2 : -3 });
    bi(s.pagatUltimoWinner, 'Pagat Ultimo');
    bi(s.trullWinner,       'Trull');
    bi(s.royalTrullWinner,  'Royal Trull');

  } else { // Mayr
    if (s.valatWinner !== null) {
      bi(s.valatWinner, 'Valat', 12);
      bi(s.pagatUltimoWinner, 'Pagat Ultimo');
      bi(s.uhuWinner,         'Uhu');
      bi(s.kakaduWinner,      'Kakadu');
      bi(s.mondFangWinner,    'Mond Fang');
      bi(s.quapilWinner,      'Quapil');
      // Trull + Royal Trull replaced by Valat
    } else {
      const won = s.declarerCardPoints >= DECLARER_WINS_AT;
      items.push({ label: `game (${won ? 'win' : 'loss'}, ${s.declarerCardPoints}–${s.defenderCardPoints})`, declarerDelta: won ? 3 : -4 });
      bi(s.pagatUltimoWinner, 'Pagat Ultimo');
      bi(s.uhuWinner,         'Uhu');
      bi(s.kakaduWinner,      'Kakadu');
      bi(s.mondFangWinner,    'Mond Fang');
      bi(s.trullWinner,       'Trull');
      bi(s.royalTrullWinner,  'Royal Trull');
      bi(s.quapilWinner,      'Quapil');
    }
  }

  return items;
}

/**
 * Per-player score breakdown for the completed hand, ready for display.
 * Returns null only for a no-bid 35–35 draw (no scores change hands).
 * All deltas are from each individual player's perspective and already
 * scaled by the hand multiplier.
 */
function computeScoreBreakdown(state: State): PlayerScoreBreakdown[] | null {
  if (!isHandOver(state)) return null;

  // No-bid hand
  if (state.declarer === null) {
    const p0pts = countCardPoints(state.capturedCards[0] ?? []);
    const p1pts = countCardPoints(state.capturedCards[1] ?? []);

    if (p0pts === p1pts) {
      // 35-35 draw: no score transfers, but bonuses that occurred are still informational
      const bonusItems: Array<{ player: number; label: string }> = [];

      // Pagat Ultimo (all scoring systems)
      const pagatWinner = _birdWinnerAtPos(state.trickLog, 1);
      if (pagatWinner !== null) bonusItems.push({ player: pagatWinner, label: 'Pagat Ultimo' });

      if (state.scoring !== 'Beck') {
        // Mayr Birds
        const uhuWinner    = _birdWinnerAtPos(state.trickLog, 2);
        const kakaduWinner = _birdWinnerAtPos(state.trickLog, 3);
        const quapilWinner = _birdWinnerAtPos(state.trickLog, 4);
        if (uhuWinner    !== null) bonusItems.push({ player: uhuWinner,    label: 'Uhu' });
        if (kakaduWinner !== null) bonusItems.push({ player: kakaduWinner, label: 'Kakadu' });
        if (quapilWinner !== null) bonusItems.push({ player: quapilWinner, label: 'Quapil' });

        // Mond Fang ( Mayr)
        for (const { plays, winner } of state.trickLog) {
          const hasSküs = plays.some(p => p.card.suit === 'T' && p.card.rank === '★');
          const hasMond  = plays.some(p => p.card.suit === 'T' && p.card.rank === 'XXI');
          if (hasSküs && hasMond) { bonusItems.push({ player: winner, label: 'Mond Fang' }); break; }
        }

        // Trull / Royal Trull from captured cards (Mayr — Beck requires announcement)
        const hasTrull = (cards: Card[]) => {
          const ranks = new Set(cards.filter(c => c.suit === 'T').map(c => c.rank));
          return ranks.has('★') && ranks.has('XXI') && ranks.has('I');
        };
        const hasRoyalTrull = (cards: Card[]) => cards.filter(c => c.rank === 'K').length >= 4;
        for (let pi = 0; pi < 2; pi++) {
          const cards = state.capturedCards[pi] ?? [];
          if (hasTrull(cards))      bonusItems.push({ player: pi, label: 'Trull' });
          if (hasRoyalTrull(cards)) bonusItems.push({ player: pi, label: 'Royal Trull' });
        }
      }

      return [0, 1].map(pi => ({
        player: pi,
        role:   'none' as const,
        items:  [
          { label: 'game (draw)', delta: 0 },
          ...bonusItems.filter(b => b.player === pi).map(b => ({ label: b.label, delta: 0 })),
        ],
        total:  0,
      }));
    }

    const rawItems = _noBidBreakdownItems(state);
    const mult     = state.handMultiplier;
    return [0, 1].map(pi => {
      const sign  = pi === 0 ? 1 : -1;
      const items = rawItems
        .map(({ label, p0Delta }) => ({ label, delta: p0Delta * sign * mult }))
        .filter(it => it.delta !== 0);
      return { player: pi, role: 'none' as const, items, total: items.reduce((s, it) => s + it.delta, 0) };
    });
  }

  const summary = computeHandSummary(state);
  if (!summary) return null;

  const rawItems = _breakdownItems(state.scoring, summary);
  const mult     = state.handMultiplier;
  const decl     = state.declarer;
  const def      = 1 - decl;

  const makeBreakdown = (pi: number, role: 'declarer' | 'defender'): PlayerScoreBreakdown => {
    const sign  = pi === decl ? 1 : -1;
    const items = rawItems
      .map(({ label, declarerDelta }) => ({ label, delta: declarerDelta * sign * mult }))
      .filter(it => it.delta !== 0);
    return { player: pi, role, items, total: items.reduce((sum, it) => sum + it.delta, 0) };
  };

  return [makeBreakdown(decl, 'declarer'), makeBreakdown(def, 'defender')]
    .sort((a, b) => a.player - b.player);
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
function _uncoverPile(s: State, pi: number, pileIdx: number, events: BareEvent[], simulate: boolean): void {
  const pile = s.strawmen[pi]![pileIdx]!;

  while (true) {
    if (pile.cards.length === 0) break;

    if (pile.cards.length === 1) {
      const card = pile.cards.pop()!;
      s.hands[pi]!.push(card);
      if (!simulate) events.push({
        type: 'CARDS_MOVED',
        transfers: [{ card, from: { zone: 'strawman', player: pi, pile: pileIdx }, to: { zone: 'hand', player: pi } }],
        reason: 'bottom-to-hand',
      });
      break;
    }

    const top = pile.cards[pile.cards.length - 1]!;
    if (isTarock(top) || top.rank === 'K') {
      if (!simulate) events.push({ type: 'CARD_REVEALED', player: pi, pile: pileIdx, card: top });
      pile.cards.pop();
      s.hands[pi]!.push(top);
      s.revealedInHand[pi]!.push(top);
      if (!simulate) events.push({
        type: 'CARDS_MOVED',
        transfers: [{ card: top, from: { zone: 'strawman', player: pi, pile: pileIdx }, to: { zone: 'hand', player: pi } }],
        reason: 'tarock-or-king',
      });
    } else {
      // Normal suit card: stays as the new visible pile top.
      // Emit CARD_REVEALED (same semantics as T/K reveal — card is now face-up);
      // the absence of a following CARDS_MOVED tells the client it stays in the pile.
      if (!simulate) events.push({ type: 'CARD_REVEALED', player: pi, pile: pileIdx, card: top });
      break;
    }
  }
}

/**
 * Apply handMultiplier to the entire score (basic + bonuses) and reset multiplier to 1.
 * The no-bid draw path sets nextHandMultiplier; declared hands always clear it.
 */
function _gamePointsForHand(s: State): { declarerDelta: number; defenderDelta: number } {
  const summary = computeHandSummary(s);
  if (!summary) return { declarerDelta: 0, defenderDelta: 0 };

  const { basicDelta, bonusDelta } = SCORING_SYSTEMS[s.scoring].scoreHand(summary);
  const totalDelta = (basicDelta + bonusDelta) * s.handMultiplier;

  s.nextHandMultiplier = 1;

  return { declarerDelta: totalDelta, defenderDelta: -totalDelta };
}

/**
 * Total hand delta for a no-bid non-draw hand, from player 0's perspective.
 * Covers game value (or Valat replacement) + all applicable bonuses.
 * Apply as: scores[0] += result * mult; scores[1] -= result * mult.
 */
function _noBidDelta(state: State): number {
  const tl    = state.trickLog;
  const p0pts = countCardPoints(state.capturedCards[0] ?? []);
  const p1pts = countCardPoints(state.capturedCards[1] ?? []);
  if (p0pts === p1pts) return 0;

  let delta = 0;

  const valatWinner = state.scoring !== 'Beck' && tl.length > 0
    ? (tl.every(t => t.winner === 0) ? 0 : tl.every(t => t.winner === 1) ? 1 : null)
    : null;

  if (valatWinner !== null) {
    delta += _bonus(valatWinner, 0, 12);
  } else {
    const winner = p0pts > p1pts ? 0 : 1;
    delta += _bonus(winner, 0, SCORING_SYSTEMS[state.scoring].noDeclarerValue);
  }

  // Birds: ±1 per bird — winner of the bird trick gets +1 (zero-sum, so loser gets −1).
  // This covers both success (bird player won) and failure (bird player lost) automatically.
  const birdPositions = state.scoring === 'Beck' ? [1] : [1, 2, 3, 4];
  for (const fromEnd of birdPositions) {
    delta += _bonus(_birdWinnerAtPos(tl, fromEnd), 0, 1);
  }

  if (state.scoring === 'Beck') {
    for (const ann of state.announcements) {
      if (ann.name === 'Trull' || ann.name === 'RoyalTrull') {
        delta += _bonus(ann.player, 0, 1);
      }
    }
    return delta;
  }

  // Mayr: Mond Fang applies regardless of Valat
  for (const { plays, winner } of tl) {
    const hasSküs = plays.some(p => p.card.suit === 'T' && p.card.rank === '★');
    const hasMond  = plays.some(p => p.card.suit === 'T' && p.card.rank === 'XXI');
    if (hasSküs && hasMond) { delta += _bonus(winner, 0, 1); break; }
  }

  // Mayr: Trull / Royal Trull from captured cards (replaced by Valat if applicable)
  if (valatWinner === null) {
    const hasTrull = (cs: Card[]) => {
      const r = new Set(cs.filter(c => c.suit === 'T').map(c => c.rank));
      return r.has('★') && r.has('XXI') && r.has('I');
    };
    const hasRoyalTrull = (cs: Card[]) => cs.filter(c => c.rank === 'K').length >= 4;
    for (let pi = 0; pi < 2; pi++) {
      const cards = state.capturedCards[pi] ?? [];
      if (hasTrull(cards))      delta += _bonus(pi, 0, 1);
      if (hasRoyalTrull(cards)) delta += _bonus(pi, 0, 1);
    }
  }

  return delta;
}

/**
 * Labeled line-items for a no-bid non-draw hand, from player 0's perspective.
 * Mirrors _noBidDelta but produces display items for computeScoreBreakdown.
 */
function _noBidBreakdownItems(state: State): Array<{ label: string; p0Delta: number }> {
  const tl    = state.trickLog;
  const p0pts = countCardPoints(state.capturedCards[0] ?? []);
  const p1pts = countCardPoints(state.capturedCards[1] ?? []);
  if (p0pts === p1pts) return [];

  const items: Array<{ label: string; p0Delta: number }> = [];
  const bi = (achiever: number | null, label: string, val = 1) => {
    const d = _bonus(achiever, 0, val);
    if (d !== 0) items.push({ label, p0Delta: d });
  };

  const valatWinner = state.scoring !== 'Beck' && tl.length > 0
    ? (tl.every(t => t.winner === 0) ? 0 : tl.every(t => t.winner === 1) ? 1 : null)
    : null;

  if (valatWinner !== null) {
    bi(valatWinner, 'Valat', 12);
  } else {
    const winner = p0pts > p1pts ? 0 : 1;
    bi(winner, `game (no-bid, ${p0pts}–${p1pts})`, SCORING_SYSTEMS[state.scoring].noDeclarerValue);
  }

  const birdPositions = state.scoring === 'Beck' ? [1] : [1, 2, 3, 4];
  const birdLabels    = ['Pagat Ultimo', 'Uhu', 'Kakadu', 'Quapil'] as const;
  for (const fromEnd of birdPositions) {
    bi(_birdWinnerAtPos(tl, fromEnd), birdLabels[fromEnd - 1]!);
  }

  if (state.scoring === 'Beck') {
    for (const ann of state.announcements) {
      if (ann.name === 'Trull' || ann.name === 'RoyalTrull') {
        bi(ann.player, ann.name === 'Trull' ? 'Trull' : 'Royal Trull');
      }
    }
    return items;
  }

  for (const { plays, winner } of tl) {
    const hasSküs = plays.some(p => p.card.suit === 'T' && p.card.rank === '★');
    const hasMond  = plays.some(p => p.card.suit === 'T' && p.card.rank === 'XXI');
    if (hasSküs && hasMond) { bi(winner, 'Mond Fang'); break; }
  }

  if (valatWinner === null) {
    const hasTrull = (cs: Card[]) => {
      const r = new Set(cs.filter(c => c.suit === 'T').map(c => c.rank));
      return r.has('★') && r.has('XXI') && r.has('I');
    };
    const hasRoyalTrull = (cs: Card[]) => cs.filter(c => c.rank === 'K').length >= 4;
    for (let pi = 0; pi < 2; pi++) {
      const cards = state.capturedCards[pi] ?? [];
      if (hasTrull(cards))      bi(pi, 'Trull');
      if (hasRoyalTrull(cards)) bi(pi, 'Royal Trull');
    }
  }

  return items;
}

// ── Transitions ───────────────────────────────────────────────────────────────

function applyMove(state: State, move: Move, simulate = false): EngineResult<State> {
  if (state.phase === 'bidding') return _applyBid(state, move, simulate);
  if (state.phase === 'playing') {
    if (move.type === 'MAKE_ANNOUNCEMENT') return _applyAnnouncement(state, move.announcement, simulate);
    if (move.type === 'PLAY_CARD')         return _applyCardPlay(state, move.card, simulate);
    throw new Error(`Unexpected move type during playing phase: ${move.type}`);
  }
  throw new Error(`applyMove called in terminal phase: ${state.phase}`);
}

function _applyBid(state: State, move: Move, simulate: boolean): EngineResult<State> {
  if (move.type !== 'MAKE_BID' && move.type !== 'PASS_BID') {
    throw new Error('Expected MAKE_BID or PASS_BID during bidding phase');
  }
  const s      = cloneState(state);
  const pi     = s.bidder;
  const events: BareEvent[] = [];

  if (move.type === 'MAKE_BID') {
    if (!simulate) events.push({ type: 'BID_MADE', player: pi, bid: 'play' });
    s.declarer = pi;
    s.phase    = 'playing';
    if (!simulate) events.push({ type: 'CONTRACT_SET', declarer: pi, contract: 'play' });
  } else {
    if (!simulate) events.push({ type: 'BID_PASSED', player: pi });
    if (pi !== s.dealerIndex) {
      s.bidder = s.dealerIndex;
    } else {
      s.declarer = null;
      s.phase    = 'playing';
    }
  }

  // Piles were face-down during bidding; uncover them now that play begins.
  if (s.phase === 'playing') {
    for (let p = 0; p < PLAYER_COUNT; p++) {
      for (let pIdx = 0; pIdx < STRAWMAN_PILE_COUNT; pIdx++) {
        _uncoverPile(s, p, pIdx, events, simulate);
      }
    }
  }

  return { state: s, events };
}

/**
 * Handle a Trull or Royal Trull announcement.
 * The bonus is deferred to end-of-hand (stored in state.announcements).
 * After announcing, the player still leads — but must play a card from the declared set.
 */
function _applyAnnouncement(state: State, announcement: string, simulate: boolean): EngineResult<State> {
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

  const events: BareEvent[] = [];
  if (!simulate) events.push({ type: 'ANNOUNCEMENT_MADE', player: pi, announcement });

  return { state: s, events };
}

function _applyCardPlay(state: State, card: Card, simulate: boolean): EngineResult<State> {
  const s      = cloneState(state);
  const pi     = getCurrentPlayer(s);
  const events: BareEvent[] = [];

  const removedFrom = _removePlayedCard(s, pi, card);
  if (removedFrom === null) {
    throw new Error(`Card ${JSON.stringify(card)} not available for player ${pi}`);
  }

  // Track whether the current player played from a pile; _uncoverPile is called
  // after TRICK_RESOLVED so animations fire in order: card-to-trick → trick-sweep → pile-flip.
  // Leading from a pile defers the reveal to the move that completes the trick.
  const currentPileReveal = typeof removedFrom === 'number'
    ? { player: pi, pileIdx: removedFrom }
    : null;

  if (s.pendingAnnouncement !== null) s.pendingAnnouncement = null;

  s.currentTrick.push({ playerIndex: pi, card: { ...card } });
  if (!simulate) events.push({ type: 'CARD_PLAYED', player: pi, card: { ...card } });

  if (s.currentTrick.length === PLAYER_COUNT) {
    const ledSuit = s.currentTrick[0]!.card.suit;
    const winner  = _trickWinnerFn(s.currentTrick, ledSuit);

    for (const { card: c } of s.currentTrick) s.capturedCards[winner]!.push(c);
    s.trickLog.push({ plays: [...s.currentTrick], ledSuit, winner });

    if (!simulate) {
      events.push({
        type:      'TRICK_RESOLVED',
        winner,
        transfers: s.currentTrick.map(p => ({
          card: p.card,
          from: { zone: 'trick' as const },
          to:   { zone: 'won'   as const, player: winner },
        })),
      });
    }

    s.trickNum++;
    s.leader       = winner;
    s.currentTrick = [];

    if (s.trickNum === TRICKS_PER_HAND) {
      if (s.declarer !== null) {
        const { declarerDelta, defenderDelta } = _gamePointsForHand(s);
        const defender = 1 - s.declarer;

        s.scores[s.declarer]! += declarerDelta;
        s.scores[defender]!   += defenderDelta;

        if (!simulate) {
          events.push({
            type:          'HAND_SCORED',
            deltas:        [
              { player: s.declarer, delta: declarerDelta, reason: 'hand-result' },
              { player: defender,   delta: defenderDelta, reason: 'hand-result' },
            ],
            runningTotals: [...s.scores],
          });
        }
      } else {
        const p0pts = countCardPoints(s.capturedCards[0] ?? []);
        const p1pts = countCardPoints(s.capturedCards[1] ?? []);
        if (p0pts === p1pts) {
          s.nextHandMultiplier = 2;   // no-bid draw: refresh to ×2 for next round (no compounding)
        } else {
          s.nextHandMultiplier = 1;
          const totalDelta = _noBidDelta(s) * s.handMultiplier;
          s.scores[0]! += totalDelta;
          s.scores[1]! -= totalDelta;
          if (!simulate) {
            events.push({
              type:          'HAND_SCORED',
              deltas:        [
                { player: 0, delta:  totalDelta, reason: 'no-declarer' },
                { player: 1, delta: -totalDelta, reason: 'no-declarer' },
              ],
              runningTotals: [...s.scores],
            });
          }
        }
      }

      s.phase = 'hand_over';
    }

    // Pile reveals follow all trick events: leader's deferred reveal first, then follower's.
    if (s.deferredPileReveal !== null) {
      _uncoverPile(s, s.deferredPileReveal.player, s.deferredPileReveal.pileIdx, events, simulate);
      s.deferredPileReveal = null;
    }
    if (currentPileReveal !== null) {
      _uncoverPile(s, currentPileReveal.player, currentPileReveal.pileIdx, events, simulate);
    }
  } else {
    // Trick incomplete (first card played): defer pile reveal to after trick resolution.
    if (currentPileReveal !== null) {
      s.deferredPileReveal = currentPileReveal;
    }
  }

  return { state: s, events };
}

// ── ISMCTS interface ──────────────────────────────────────────────────────────

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
  const voids    = _inferVoidsFn(s.trickLog, perspectivePlayer);

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

  const match = bipartiteMatch(shuffled.length, totalSlots, canUse);

  if (!match) {
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
    raw = base * state.handMultiplier + cardPtBonus;
  } else {
    const summary = computeHandSummary(state);
    if (!summary) return (Math.tanh(cardPtBonus / REWARD_SCALE) + 1) / 2;
    const { basicDelta, bonusDelta } = SCORING_SYSTEMS[state.scoring].scoreHand(summary);
    const totalDelta  = (basicDelta + bonusDelta) * state.handMultiplier;
    const signedDelta = playerIndex === state.declarer ? totalDelta : -totalDelta;
    raw = signedDelta + cardPtBonus;
  }

  return (Math.tanh(raw / REWARD_SCALE) + 1) / 2;
}

// ── Rollout policy ─────────────────────────────────────────────────────────────

export function rolloutPolicy(state: State, legal: Move[]): Move {
  if (state.phase !== 'playing') return legal[Math.floor(Math.random() * legal.length)]!;

  const plays = legal.filter((m): m is { type: 'PLAY_CARD'; card: Card } => m.type === 'PLAY_CARD');

  // Leading: random — strategic, leave it to the tree
  if (state.currentTrick.length === 0) return plays[Math.floor(Math.random() * plays.length)]!;

  return followTrickPolicy(plays, state.currentTrick);
}

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  // Constants
  TAROCK_RANKS, BLACK_RANKS, RED_RANKS, BLACK_SUITS, RED_SUITS,
  PLAYER_COUNT, INITIAL_HAND_SIZE, STRAWMAN_PILE_COUNT, STRAWMAN_PILE_SIZE,
  TRICKS_PER_HAND, DECLARER_WINS_AT,
  // Scoring systems
  BECK, MAYR,
  // Card utilities
  createDeck, shuffle, cardEquals, cardPointValue, countCardPoints, isTarock,
  // State lifecycle
  dealState, getDealEvents, cloneState,
  // Queries
  getCurrentPlayer, getLegalMoves,
  isHandOver, isGameOver, getHandResult, computeHandSummary, computeScoreBreakdown,
  // Transition
  applyMove,
  // ISMCTS
  determinize, getReward,
};

// Compile-time verification that this module satisfies the ISMCTS engine contract.
const _: ISMCTSEngine<State, Move> = { getLegalMoves, applyMove, isHandOver, determinize, getReward, getCurrentPlayer };
