
/*
 * DREIERTAROCK — 3-player Austrian Tarock — Rules as implemented
 * Sources: Mayr & Sedlaczek (2016); McLeod, J.; Dummett & McLeod (2004)
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * DECK  (54 cards)
 *   Tarocks / trumps (high → low):
 *     Sküs (★), Mond (XXI), XX … II, Pagat (I).   22 cards total.
 *   Black suits ♣ ♠ (high → low):  K Q Kn J 10 9 8 7.
 *   Red suits   ♥ ♦ (high → low):  K Q Kn J A 2 3 4.
 *
 * PLAYERS: 3 (or 4 — when 4 are seated, the dealer takes no further part in
 *   that hand; the other three play as usual).
 *
 * DEAL  (forehand = activePlayers[0]; packets dealt forehand-first)
 *   Hand:     1 packet of 8 cards → 8 hand cards per player.
 *   Talon:    2 packets of 3 cards → 6 talon cards, in 2 groups of 3.
 *   Hand:     1 packet of 8 cards → 16 total hand cards per player.
 *   (48 cards to hands + 6 talon = 54; dealer's seat gets no cards when 4 play.)
 *
 * BIDDING  ("bidding with immediate hold")
 *   Forehand bids first and MUST bid (Single, Solo, or Solo Valat; cannot pass).
 *   Later players may pass or name a higher bid.  When a later player outbids an
 *   earlier one, the earlier player must immediately "hold" (match the bid) or
 *   pass.  Holding is modelled as MAKE_BID at the current level — only legal when
 *   you are responding to someone who just outbid you (isInPair=true).
 *   If both later players pass Forehand's Single, Forehand may choose to play
 *   Single or switch to Trischaken (phase = 'contract_choice').
 *
 *   BID VALUES (Mayr / St. Louis):
 *     Trischaken  — 3 / 1   (not bid directly; chosen by Forehand after uncontested Single)
 *     Single      — 3 / 1
 *     Double      — 4 / 2
 *     Triple      — 5 / 3
 *     Quadruple   — 6 / (–)
 *     Quintuple   — 7 / (–)
 *     Solo        — 12 / 4
 *     Solo Valat  — 96 / 32
 *   Any player wishing to bid Solo or Solo Valat must do so at their first
 *   opportunity; it cannot be bid after having made a lower bid.
 *
 * EXCHANGE  (Single / Double / Triple / Quadruple / Quintuple only)
 *   Both talon groups (3 cards each) are revealed to all players.
 *   The declarer selects one group to take into their hand; the unchosen 3 cards
 *   immediately become won cards for the defenders (their "first trick").
 *   The declarer then discards 3 cards face-down to their own won pile.
 *   Discard restrictions: may never discard a King, Pagat (I), Mond (XXI), or
 *   Sküs (★); may only discard other Tarocks when no non-restricted cards remain.
 *   In Solo and Solo Valat, there is no exchange; the talon is set aside.
 *
 * DECLARING PHASE  (after exchange/discard; before any tricks)
 *   Players take turns in circular order starting from the declarer (forehand in Trischaken).
 *   Any player may announce a bonus (if they hold the required card) or Kontra any
 *   eligible target, or simply pass.  The phase ends when 2 players pass consecutively
 *   (consecutivePasses >= activePlayerCount - 1).
 *
 *   Announcements (cannot announce Mond Fang — it is always automatic):
 *     Pagat   — hold Tarock I
 *     Uhu     — hold Tarock II
 *     Kakadu  — hold Tarock III
 *     Trull   — hold Sküs (★)
 *     Kings   — hold all 4 Kings
 *   Announcing a bonus doubles its value; failing an announcement doubles
 *   the penalty (same formula — the player scores ±doubleValue).
 *   In Trischaken no bonuses may be announced.
 *
 *   Kontra chain (per target: 'game' or any announced bonus):
 *     none → ×2 (Kontra) → ×4 (Rekontra) → ×8 (Subkontra)
 *     Opponents of the target's owner may Kontra; owner's team may Rekontra; repeat.
 *     In Trischaken, each player independently may Kontra the game; multiplier = 3 × 2^n.
 *
 * TRICK-PLAY  (Farbzwang — compulsory-follow rules)
 *   1. Must follow the led suit if able.
 *   2. If void in led suit, must play a Tarock.
 *   3. If void in both, may play any card.
 *   Trischaken only: Pagat (I) may not be played at all until it is the player's last Tarock.
 *   Trick won by: the highest Tarock played; or, if no Tarock, the highest card of
 *   the led suit.  Off-suit non-Tarock cards cannot win.
 *
 * CARD POINTS  (both teams' totals always sum to 70)
 *   Trull (★, XXI, I): 4 pts each.  Kings: 4 pts each.
 *   Queens: 3 pts.  Knights (Kn): 2 pts.  Jacks: 1 pt.  All others: 0 pts.
 *   Counting: Σ(individual values) + floor((n+1)/3) for n cards captured.
 *
 * WINNING CONDITION
 *   Declarer must capture ≥ 36 card points (out of 70) to win the hand.
 *   Exactly 35 = LOSS for the declarer.
 *   Solo Valat: declarer must win every trick (all 16). Loss of a single trick
 *   loses the game.
 *
 * SCORING SYSTEMS  (selected via DealConfig.scoring)
 *
 *   Mayr (default):
 *     Game values as listed under BIDS above.
 *     Bonuses: Pagat Ultimo ±4, Uhu ±6, Kakadu ±8, Mond Fang ±1, Trull ±1, Kings ±1.
 *     Valat (bonus): win all 16 tricks (not under Solo Valat contract).
 *       Replaces game value with 24 AND replaces all bonuses entirely (no other bonuses score).
 *     All bonus values are doubled if announced, and doubled again if the contract is Solo.
 *
 *   St. Louis:
 *     Game values as listed above.
 *     Bonuses: Pagat ±1, Uhu ±2, Kakadu ±3, Mond Fang ±1, Trull ±1, Kings ±1.
 *     Valat (also called "Slam"): win all 16 tricks. Multiplies game value by 4.
 *       Replaces all bonuses entirely (no other bonuses score).
 *     Trischaken with Stichzwang: each player must overtake if possible. Winner of the last
 *       trick also takes the 6 talon cards (scored as captured cards).
 *
 * TRISCHAKEN SETTLEMENT
 *   No declarer — every player for themselves.
 *   If one player took no card points: receives game value × multiplier from each other.
 *   If all three took points: the player with the most pays game value × multiplier to each other.
 *   If two players tie for most: both are treated as highest and each pays the third.
 *
 * VALAT BONUS: win all 16 tricks; replaces game value and ALL bonuses entirely (both scoring systems).
 *   Mayr: game value becomes 24.  St. Louis: game value ×4 (also called "Slam").
 *
 * SESSION
 *   No fixed end condition. The session layer asks after each hand_over whether to continue.
 */

/* OPTIONS
 * "Mayr" scoring is described above and is the default.
 *
 * "St. Louis" scoring differences:
 *   Bid values: Trischaken/Single=1, Double=2, Triple=3, Solo=4, Solo Valat=32.
 *   Bonuses: Pagat=1, Uhu=2, Kakadu=3, Mond Fang=1, Trull=1, Kings=1.
 *   Valat / Slam (all tricks): ×4 game value; all bonuses replaced entirely.
 *   Trischaken adds Stichzwang (must overtake if able); last-trick winner takes talon.
 *
 * Optional add-ons (not yet implemented):
 *   "With 40" — 2 (Mayr) / 1 (St. Louis): take ≥ 40 card points (must be announced).
 *   "With 50" — 4 (Mayr) / 2 (St. Louis): take ≥ 50 card points (must be announced).
 */

import type { Card, BareEvent, DealEvent, EngineResult, Move, DeclaringSubAction } from '../types';
import type { ISMCTSEngine } from '../lib/engine';
import { bipartiteMatch } from '../lib/matching';
import {
  TAROCK_RANKS, TAROCK_RANK_ORDER, BLACK_RANK_ORDER, RED_RANK_ORDER,
  BLACK_RANKS, RED_RANKS, BLACK_SUITS, RED_SUITS, BLACK_SUITS_SET,
  TRULL_RANKS, cardKey,
  cardPointValue, countCardPoints, countCardPoints42, isTarock, cardEquals,
  createDeck, createDeck42, shuffle,
  trickWinner, birdWinnerAtPos, inferVoids, type BonusOutcome, asBonusOutcome,
  currentTrickWinnerCard, headsCurrentTrick,
  weakestMove, strongestMove, followTrickPolicy,
} from '../lib/tarock';
import type { TarockPlay, TarockTrickRecord } from '../lib/tarock';

export const GAME_NAME = 'Dreiertarock';
export const GAME_ICON = '🃏';

// ── Bid levels ─────────────────────────────────────────────────────────────────

export const BID_LEVELS = [
  'Single', 'Double', 'Triple', 'Quadruple', 'Quintuple', 'SuitSolo', 'Solo', 'SoloValat',
] as const;
export type BidLevel = typeof BID_LEVELS[number];

// Contracts include all bid levels plus Trischaken (not a bid — chosen post-auction)
export type Contract = BidLevel | 'Trischaken';

// Bid ordering per deck type (-1 = not available in this variant)
type BidEntry = { rank: number; jump: boolean };
const BID_META_54: Record<BidLevel, BidEntry> = {
  Single:    { rank: 0,  jump: false },
  Double:    { rank: 1,  jump: false },
  Triple:    { rank: 2,  jump: false },
  Quadruple: { rank: 3,  jump: false },
  Quintuple: { rank: 4,  jump: false },
  SuitSolo:  { rank: -1, jump: false },
  Solo:      { rank: 5,  jump: true  },
  SoloValat: { rank: 6,  jump: true  },
};
const BID_META_42: Record<BidLevel, BidEntry> = {
  Single:    { rank: 0,  jump: false },
  Double:    { rank: 1,  jump: false },
  Triple:    { rank: 2,  jump: false },
  Quadruple: { rank: -1, jump: false },
  Quintuple: { rank: -1, jump: false },
  SuitSolo:  { rank: 3,  jump: true  },
  Solo:      { rank: 4,  jump: true  },
  SoloValat: { rank: 5,  jump: true  },
};
function _bidMeta(bid: BidLevel, deckType: '54' | '42'): BidEntry {
  return (deckType === '42' ? BID_META_42 : BID_META_54)[bid];
}
function _bidRank(bid: BidLevel, deckType: '54' | '42'): number { return _bidMeta(bid, deckType).rank; }
function _isJumpBid(level: BidLevel, deckType: '54' | '42'): boolean { return _bidMeta(level, deckType).jump; }

// Bids that require the talon exchange
const EXCHANGE_CONTRACTS    = new Set<Contract>(['Single', 'Double', 'Triple', 'Quadruple', 'Quintuple']);
const EXCHANGE_CONTRACTS_42 = new Set<Contract>(['Single', 'Double', 'Triple']);
function _isExchangeContract(contract: Contract, deckType: '54' | '42'): boolean {
  return (deckType === '42' ? EXCHANGE_CONTRACTS_42 : EXCHANGE_CONTRACTS).has(contract);
}

// ── Scoring systems ────────────────────────────────────────────────────────────

export type ScoringSystemName = 'Mayr' | 'StLouis';

export const SCORING_SYSTEMS: Record<ScoringSystemName, { name: string }> = {
  Mayr:    { name: 'Mayr' },
  StLouis: { name: 'St. Louis' },
};

const MAYR_GAME_VALUES: Record<Contract, number> = {
  Trischaken: 3, Single: 3, Double: 4, Triple: 5, Quadruple: 6, Quintuple: 7,
  SuitSolo: 0, Solo: 12, SoloValat: 96,
};

const STLOUIS_GAME_VALUES: Record<Contract, number> = {
  Trischaken: 1, Single: 1, Double: 2, Triple: 3, Quadruple: 3, Quintuple: 3,
  SuitSolo: 0, Solo: 4, SoloValat: 32,
};

// 42-card game values (used regardless of scoring system in 42-card games)
const FORTYTWO_GAME_VALUES: Record<Contract, number> = {
  Trischaken: 1, Single: 1, Double: 2, Triple: 3, Quadruple: 0, Quintuple: 0,
  SuitSolo: 4, Solo: 4, SoloValat: 32,
};

type BonusConfigKey = '54-Mayr' | '54-StLouis' | '42';
const BONUS_CONFIGS: Record<BonusConfigKey, Array<{ name: string; base: number }>> = {
  '54-Mayr': [
    { name: 'Pagat',    base: 4 }, { name: 'Uhu',      base: 6 }, { name: 'Kakadu',   base: 8 },
    { name: 'MondFang', base: 1 }, { name: 'Trull',    base: 1 }, { name: 'Kings',    base: 1 },
  ],
  '54-StLouis': [
    { name: 'Pagat',    base: 1 }, { name: 'Uhu',      base: 2 }, { name: 'Kakadu',   base: 3 },
    { name: 'MondFang', base: 1 }, { name: 'Trull',    base: 1 }, { name: 'Kings',    base: 1 },
  ],
  '42': [
    { name: 'Pagat',    base: 1 }, { name: 'MondFang', base: 1 }, { name: 'Trull',    base: 1 },
    { name: 'Kings',    base: 1 }, { name: 'Absolute', base: 1 }, { name: 'Valat',    base: 4 },
  ],
};

function _bonusWinner(summary: HandSummary, name: string): BonusOutcome {
  switch (name) {
    case 'Pagat':    return summary.pagatUltimoWinner;
    case 'Uhu':      return summary.uhuWinner;
    case 'Kakadu':   return summary.kakaduWinner;
    case 'MondFang': return asBonusOutcome(summary.mondFangWinner);
    case 'Trull':    return asBonusOutcome(summary.trullWinner);
    case 'Kings':    return asBonusOutcome(summary.kingsWinner);
    case 'Absolute': return asBonusOutcome(summary.absoluteWinner);
    case 'Valat':    return asBonusOutcome(summary.valatWinner);
    default:         return { type: 'absent' };
  }
}

export interface BonusResult {
  name:       string;
  winner:     number | null;   // who earned this bonus (null = nobody / not applicable)
  baseValue:  number;
  multiplier: number;          // includes announced ×2 + Solo ×2 + kontra chain
  delta:      number;          // signed from declarer's perspective (+ = good for declarer)
}

export interface HandSummary {
  contract:          Contract;
  declarer:          number | null;       // null in Trischaken
  activePlayers:     number[];
  cardPoints:        Record<number, number>;   // player index → card points
  tricksWon:         Record<number, number>;
  valatWinner:       number | null;       // won all tricks
  pagatUltimoWinner: BonusOutcome;
  uhuWinner:         BonusOutcome;
  kakaduWinner:      BonusOutcome;
  mondFangWinner:    number | null;
  trullWinner:       number | null;       // captured (54-card) or dealt (42-card) all 3 Trull
  kingsWinner:       number | null;       // captured (54-card) or dealt (42-card) all 4 Kings
  absoluteWinner:    number | null;       // declarer scored ≥ 57 pts (42-card only)
  announcements:     Announcement[];
  kontraItems:       KontraItem[];
  scoring:           ScoringSystemName;
  deckType:          '54' | '42';
}

// ── Domain types ───────────────────────────────────────────────────────────────

export type Play        = TarockPlay;
export type TrickRecord = TarockTrickRecord;

export interface Announcement {
  name:   string;   // 'Pagat' | 'Uhu' | 'Kakadu' | 'Trull' | 'Kings'
  player: number;
}

export interface KontraItem {
  target:      string;        // 'game' | announcement name
  multiplier:  1 | 2 | 4 | 8;
  kontraBy:    number | null;
  rekontraBy:  number | null;
  subkontraBy: number | null;
}

// ── State ──────────────────────────────────────────────────────────────────────

export interface State {
  playerCount:   3 | 4;
  activePlayers: number[];        // 3 non-dealer players (indices into hands/scores)
  hands:         Card[][];        // length = playerCount; dealer's hand is [] when 4 play
  capturedCards: Card[][];        // per player index
  scores:        number[];        // cumulative game points; length = playerCount
  phase:         'bidding' | 'contract_choice' | 'exchange' | 'discard' | 'declaring' | 'playing' | 'hand_over' | 'game_over';
  dealerIndex:   number;
  scoring:       ScoringSystemName;
  deckType:      '54' | '42';

  // Bidding
  currentBid:    BidLevel | null;
  currentHolder: number | null;   // player index who holds the current high bid
  bidder:        number;          // whose turn to act NOW
  biddingQueue:  number[];        // active players not yet entered the auction
  isInPair:      boolean;         // true: bidder is responding to currentHolder who outbid them
  biddingContested: boolean;      // true once any player other than forehand has bid or responded
  bidLog:        Array<{ player: number; bid: BidLevel | 'pass' }>;

  // Contract
  contract:      Contract | null;
  declarer:      number | null;   // null in Trischaken

  // Talon (2 groups of 3, ordered as dealt)
  talonGroups:   [Card[], Card[]];
  talonRevealed: boolean;         // true once exchange phase begins

  // Discard
  discardsRemaining: number;

  // Declaring (announcements + Kontra, circular until all pass)
  announcements:     Announcement[];
  kontraItems:       KontraItem[];
  declaringBidder:   number;      // whose turn in the declaring phase
  consecutivePasses: number;      // reset on any non-pass action; phase ends at activePlayerCount

  // Play
  leader:       number;
  currentTrick: TarockPlay[];
  trickLog:     TarockTrickRecord[];
  trickNum:     number;

  // 42-card deal bonuses (set at start of playing phase; null in 54-card games)
  declarerHadTrull: boolean | null;
  declarerHadKings: boolean | null;

  // Cached scoring results (set in _finalizeHand; avoids recomputation in getReward)
  _summary?: HandSummary;
  _deltas?:  Record<number, number>;
}

export interface DealConfig {
  scores?:      number[] | null;
  dealerIndex?: number;
  scoring?:     ScoringSystemName;
  playerCount?: 3 | 4;
  deckType?:    '54' | '42';
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HAND_SIZE      = 16;  // 2 packets of 8 per active player (54-card)
const TALON_SIZE     = 6;
const TALON_GROUPS   = 2;
const GROUP_SIZE     = 3;
const REWARD_SCALE   = 24;  // each-against-each; ordinary Double+Pagat ≈ ±24; Solo+bonuses ≈ ±64

// Deck-type config table
const DECK = {
  '54': { handSize: 16, tricksPerHand: 16, declarerWinsAt: 36, cardMidpoint: 35, cardTotal: 70 },
  '42': { handSize: 12, tricksPerHand: 12, declarerWinsAt: 46, cardMidpoint: 45, cardTotal: 90 },
} as const;

// ── Deck + state factory ───────────────────────────────────────────────────────

export function dealState({
  scores      = null,
  dealerIndex = 0,
  scoring     = 'Mayr',
  playerCount = 3,
  deckType    = '54',
}: DealConfig = {}): State {
  const deck = shuffle(deckType === '42' ? createDeck42() : createDeck());

  // active players = all seats except dealer (when 4 play)
  const activePlayers: number[] = [];
  for (let i = 1; i <= 3; i++) activePlayers.push((dealerIndex + i) % playerCount);

  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  let pos = 0;
  const packetSize = DECK[deckType].handSize / 2;  // 8 for 54-card, 6 for 42-card

  // Two packets per player (forehand-first) interleaved with talon
  for (const pi of activePlayers) {
    hands[pi]!.push(...deck.slice(pos, pos + packetSize)); pos += packetSize;
  }
  const talonGroup0 = deck.slice(pos, pos + GROUP_SIZE); pos += GROUP_SIZE;
  const talonGroup1 = deck.slice(pos, pos + GROUP_SIZE); pos += GROUP_SIZE;
  for (const pi of activePlayers) {
    hands[pi]!.push(...deck.slice(pos, pos + packetSize)); pos += packetSize;
  }

  const forehand = activePlayers[0]!;

  return {
    playerCount,
    activePlayers,
    hands,
    capturedCards:    Array.from({ length: playerCount }, () => []),
    scores:           scores ? [...scores] : Array(playerCount).fill(0),
    phase:            'bidding',
    dealerIndex,
    scoring,
    deckType,

    currentBid:    null,
    currentHolder: null,
    bidder:        forehand,
    biddingQueue:  activePlayers.slice(1),
    isInPair:      false,
    biddingContested: false,
    bidLog:        [],

    contract:  null,
    declarer:  null,

    talonGroups:   [talonGroup0, talonGroup1],
    talonRevealed: false,

    discardsRemaining: 0,

    announcements:     [],
    kontraItems:       [],
    declaringBidder:   forehand,
    consecutivePasses: 0,

    leader:       forehand,
    currentTrick: [],
    trickLog:     [],
    trickNum:     0,

    declarerHadTrull: null,
    declarerHadKings: null,
  };
}

export function getDealEvents(dealerIndex: number, playerCount: 3 | 4 = 3, deckType: '54' | '42' = '54'): DealEvent[] {
  const activePlayers: number[] = [];
  for (let i = 1; i <= 3; i++) activePlayers.push((dealerIndex + i) % playerCount);
  const packetSize = DECK[deckType].handSize / 2;
  const events: DealEvent[] = [];
  for (const pi of activePlayers)
    events.push({ type: 'DEAL', dealer: dealerIndex, to: pi, zone: 'hand', count: packetSize });
  // talon — emitted as dealt to a sentinel player (-1) so the UI shows it face-down
  events.push({ type: 'DEAL', dealer: dealerIndex, to: -1, zone: 'hand', count: TALON_SIZE });
  for (const pi of activePlayers)
    events.push({ type: 'DEAL', dealer: dealerIndex, to: pi, zone: 'hand', count: packetSize });
  return events;
}

const _clone: <T>(x: T) => T = typeof structuredClone === 'function'
  ? structuredClone
  : (x) => JSON.parse(JSON.stringify(x)) as typeof x;

function cloneState(state: State): State { return _clone(state); }

// ── Query functions ────────────────────────────────────────────────────────────

function isHandOver(state: State): boolean {
  return state.phase === 'hand_over' || state.phase === 'game_over';
}

function isGameOver(_state: State): boolean { return false; }

function getCurrentPlayer(state: State): number {
  if (state.phase === 'bidding') return state.bidder;
  if (state.phase === 'contract_choice') return state.activePlayers[0]!;
  if (state.phase === 'exchange') return state.declarer!;
  if (state.phase === 'discard') return state.declarer!;
  if (state.phase === 'declaring') return state.declaringBidder;
  if (state.phase === 'playing') {
    return state.activePlayers[
      (state.activePlayers.indexOf(state.leader) + state.currentTrick.length)
      % state.activePlayers.length
    ]!;
  }
  return -1;
}

function getLegalMoves(state: State): Move[] {
  switch (state.phase) {
    case 'bidding':          return _legalBids(state);
    case 'contract_choice':  return _legalContractChoices();
    case 'exchange':         return _legalTalonChoices();
    case 'discard':          return _legalDiscards(state);
    case 'declaring':        return _legalDeclaringMoves(state);
    case 'playing':          return _legalCardPlays(state).map(card => ({ type: 'PLAY_CARD' as const, card }));
    default:                 return [];
  }
}

// ── Bidding ────────────────────────────────────────────────────────────────────

function _legalBids(state: State): Move[] {
  const { bidder, currentBid, currentHolder, isInPair, activePlayers, deckType } = state;
  const forehand = activePlayers[0]!;
  const isForehandFirstTurn = bidder === forehand && currentBid === null;

  const isBiddersFirstBid = !state.bidLog.some(b => b.player === bidder);

  const moves: Move[] = [];

  // Forehand cannot pass on their mandatory first bid
  if (!isForehandFirstTurn) {
    moves.push({ type: 'PASS_BID' });
  }

  for (const level of BID_LEVELS) {
    const rank = _bidRank(level, deckType);
    if (rank === -1) continue;  // not available in this variant

    if (_isJumpBid(level, deckType)) {
      // Jump bids: only at your very first opportunity, before you've bid or passed anything.
      if (!isBiddersFirstBid) continue;
      if (currentBid && (_bidRank(currentBid, deckType) >= rank)) continue;
      moves.push({ type: 'MAKE_BID', bid: level });
      continue;
    }

    // Stepped bids (Single … Triple/Quintuple depending on variant):
    if (currentBid === null) {
      // Forehand's opening: only Single is legal
      if (level === 'Single') moves.push({ type: 'MAKE_BID', bid: level });
    } else {
      const cur = _bidRank(currentBid, deckType);
      if (rank < cur) continue;           // below current — never legal
      if (rank > cur + 1) continue;       // multi-step jump — illegal
      if (isInPair && rank > cur) continue; // responding to outbid: can only hold or pass
      if (rank === cur) {
        // Hold: only when responding to someone who just outbid you
        if (!isInPair || bidder === currentHolder) continue;
      }
      moves.push({ type: 'MAKE_BID', bid: level });
    }
  }

  return moves;
}

function _legalContractChoices(): Move[] {
  return [
    { type: 'CHOOSE_CONTRACT', contract: 'Single' },
    { type: 'CHOOSE_CONTRACT', contract: 'Trischaken' },
  ];
}

function _legalTalonChoices(): Move[] {
  return [
    { type: 'CHOOSE_TALON', choice: 'first' },
    { type: 'CHOOSE_TALON', choice: 'second' },
  ];
}

// ── Discard ────────────────────────────────────────────────────────────────────

function _legalDiscards(state: State): Move[] {
  const pi   = state.declarer!;
  const hand = state.hands[pi] ?? [];
  const rem  = state.discardsRemaining;

  // Cards that can always be discarded (not King, not Trull)
  const free = hand.filter(c => c.rank !== 'K' && !TRULL_RANKS.has(c.rank) && !isTarock(c));
  // Non-restricted tarocks (II through XX, not ★)
  const tarockFallback = hand.filter(c => isTarock(c) && !TRULL_RANKS.has(c.rank));

  const legal = free.length >= rem ? free : [...free, ...tarockFallback];
  return legal.map(card => ({ type: 'DISCARD_CARD' as const, card }));
}

// ── Declaring ─────────────────────────────────────────────────────────────────

function _legalDeclaringMoves(state: State): Move[] {
  const pi       = state.declaringBidder;
  const moves: Move[] = [{ type: 'PASS_ANNOUNCEMENT' }];

  // Trischaken: no announcements; each player may Kontra the game exactly once
  if (state.contract === 'Trischaken') {
    const gameItem = state.kontraItems.find(k => k.target === 'game');
    if (gameItem) {
      const alreadyKontrad = [gameItem.kontraBy, gameItem.rekontraBy, gameItem.subkontraBy].includes(pi);
      if (!alreadyKontrad) moves.push({ type: 'KONTRA', target: 'game', level: 'Kontra' });
    }
    return moves;
  }

  // Announcements (non-Trischaken only)
  const hand    = state.hands[pi] ?? [];
  const already = new Set(state.announcements.map(a => a.name));

  if (state.deckType === '42') {
    if (!already.has('Pagat')    && hand.some(c => isTarock(c) && c.rank === 'I')) moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Pagat' });
    if (!already.has('Absolute'))                                                   moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Absolute' });
    if (!already.has('Valat'))                                                      moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Valat' });
    // St. Louis: Trull/Kings become announceable (scored from captured cards, same as 54-card)
    if (state.scoring === 'StLouis') {
      if (!already.has('Trull') && hand.some(c => isTarock(c) && c.rank === '★')) moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Trull' });
      if (!already.has('Kings'))                                                    moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Kings' });
    }
  } else {
    if (!already.has('Pagat')  && hand.some(c => isTarock(c) && c.rank === 'I'))   moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Pagat' });
    if (!already.has('Uhu')    && hand.some(c => isTarock(c) && c.rank === 'II'))  moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Uhu' });
    if (!already.has('Kakadu') && hand.some(c => isTarock(c) && c.rank === 'III')) moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Kakadu' });
    if (!already.has('Trull')  && hand.some(c => isTarock(c) && c.rank === '★'))   moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Trull' });
    if (!already.has('Kings'))                                                       moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Kings' });
  }

  // Kontra chain (non-Trischaken only)
  for (const item of state.kontraItems) {
    if (item.multiplier >= 8) continue;

    const levelName  = KONTRA_LEVEL[item.multiplier]!;
    const ownerTeam  = _ownerTeam(item.target, state);
    const isOpponent = !ownerTeam.includes(pi);

    if (item.multiplier === 1 && isOpponent) {
      moves.push({ type: 'KONTRA', target: item.target, level: levelName });
    } else if (item.multiplier === 2 && !isOpponent) {
      moves.push({ type: 'KONTRA', target: item.target, level: levelName });
    } else if (item.multiplier === 4 && isOpponent) {
      moves.push({ type: 'KONTRA', target: item.target, level: levelName });
    }
  }

  return moves;
}

/** Returns player indices on the same "team" as the target's owner. */
function _ownerTeam(target: string, state: State): number[] {
  if (state.contract === 'Trischaken') return [];   // no teams in Trischaken
  if (target === 'game') {
    return state.declarer !== null ? [state.declarer] : [];
  }
  const ann = state.announcements.find(a => a.name === target);
  if (!ann) return [];
  // In a declared game, declarer's team = [declarer]; defenders are a team
  if (state.declarer !== null) {
    return ann.player === state.declarer ? [state.declarer] : state.activePlayers.filter(p => p !== state.declarer);
  }
  return [ann.player];
}

// ── Card play ─────────────────────────────────────────────────────────────────

// Returns the tarock ranks (e.g. 'I', 'II', 'III') that the current player has announced
// as birds but may not yet legally play (outside their required trick window).
function _birdRestrictedRanks(state: State): Set<string> {
  if (state.announcements.length === 0) return new Set();
  const pi         = getCurrentPlayer(state);
  const tricksLeft = DECK[state.deckType].tricksPerHand - state.trickLog.length;
  const restricted = new Set<string>();
  for (const ann of state.announcements) {
    if (ann.player !== pi) continue;
    if (ann.name === 'Pagat'  && tricksLeft > 1) restricted.add('I');
    if (ann.name === 'Uhu'    && tricksLeft > 2) restricted.add('II');
    if (ann.name === 'Kakadu' && tricksLeft > 3) restricted.add('III');
  }
  return restricted;
}

function _legalCardPlays(state: State): Card[] {
  if (state.phase !== 'playing') return [];
  const pi   = getCurrentPlayer(state);
  const hand = state.hands[pi] ?? [];

  // Trischaken: Pagat may not be played at all until it is the player's last Tarock
  const effective = (state.contract === 'Trischaken' && hand.filter(isTarock).length > 1)
    ? hand.filter(c => !(isTarock(c) && c.rank === 'I'))
    : hand;

  // Bird restriction: announced bird cards cannot be played before their target trick.
  // Compelled exception (fallback): if filtering would leave no candidates, skip it.
  const restricted = _birdRestrictedRanks(state);
  const withBird   = (cards: Card[]) => {
    if (restricted.size === 0) return cards;
    const f = cards.filter(c => !(isTarock(c) && restricted.has(c.rank)));
    return f.length > 0 ? f : cards;
  };

  if (state.currentTrick.length === 0) {
    // SuitSolo: cannot lead a trump while holding any suit cards
    if (state.contract === 'SuitSolo') {
      const suitCards = effective.filter(c => !isTarock(c));
      if (suitCards.length > 0) return withBird(suitCards);
    }
    return withBird(effective);
  }

  const ledSuit   = state.currentTrick[0]!.card.suit;
  const followers = effective.filter(c => c.suit === ledSuit);

  let candidates: Card[];
  if (followers.length > 0) {
    candidates = withBird(followers);
  } else {
    const tarocks = effective.filter(isTarock);
    candidates = withBird(tarocks.length > 0 ? tarocks : effective);
  }

  // Stichzwang (St. Louis Trischaken only): must overtake the current winning card if able.
  // Bird restrictions are a no-op in Trischaken (no announcements), so no interaction here.
  if (state.contract === 'Trischaken' && state.scoring === 'StLouis') {
    const winningCard = currentTrickWinnerCard(state.currentTrick, ledSuit);
    if (winningCard) {
      const heading = candidates.filter(c => headsCurrentTrick(c, winningCard, ledSuit));
      if (heading.length > 0) return heading;
    }
  }

  return candidates;
}

// ── Transitions ────────────────────────────────────────────────────────────────

function applyMove(state: State, move: Move, simulate = false): EngineResult<State> {
  switch (state.phase) {
    case 'bidding':         return _applyBid(state, move, simulate);
    case 'contract_choice': return _applyContractChoice(state, move, simulate);
    case 'exchange':        return _applyTalonChoice(state, move, simulate);
    case 'discard':         return _applyDiscard(state, move, simulate);
    case 'declaring':       return _applyDeclaring(state, move, simulate);
    case 'playing':         return _applyCardPlay(state, move, simulate);
    default: throw new Error(`applyMove called in terminal phase: ${state.phase}`);
  }
}

// ── Bid transition ─────────────────────────────────────────────────────────────

function _applyBid(state: State, move: Move, simulate: boolean): EngineResult<State> {
  const s      = cloneState(state);
  const events: BareEvent[] = [];
  const pi     = s.bidder;

  if (move.type === 'PASS_BID') {
    if (!simulate) events.push({ type: 'BID_PASSED', player: pi });
    s.bidLog.push({ player: pi, bid: 'pass' });

    if (s.isInPair) {
      // Pair ends — current holder wins this pair
      s.isInPair = false;
    }
    if (s.biddingQueue.length === 0) {
      _finalizeBidding(s, events, simulate);
    } else {
      s.bidder = s.biddingQueue.shift()!;
    }
    
    return { state: s, events };
  }

  if (move.type !== 'MAKE_BID') throw new Error(`Expected MAKE_BID or PASS_BID in bidding phase`);

  const level = move.bid as BidLevel;
  if (!simulate) events.push({ type: 'BID_MADE', player: pi, bid: level });
  s.bidLog.push({ player: pi, bid: level });

  const prevHolder = s.currentHolder;
  const prevBid    = s.currentBid;

  if (prevBid !== null && _bidRank(level, s.deckType) === _bidRank(prevBid, s.deckType) && s.isInPair) {
    // Hold: bidder takes the current bid at the same level.
    // isInPair=false: the original outbidder is now free to raise or pass.
    s.currentHolder = pi;
    s.bidder        = prevHolder!;
    s.isInPair      = false;
    // biddingContested stays true
  } else {
    // Raise (or initial bid)
    s.currentBid    = level;
    s.currentHolder = pi;
    s.biddingContested = s.biddingContested || pi !== s.activePlayers[0]!;

    if (prevHolder !== null && !_isJumpBid(level, s.deckType)) {
      // Step bid — previous holder must immediately hold or pass
      s.bidder   = prevHolder;
      s.isInPair = true;
    } else {
      // Jump bid or first bid — previous holder cannot respond;
      // move on to the next queued player or finalize
      s.isInPair = false;
      if (s.biddingQueue.length === 0) {
        _finalizeBidding(s, events, simulate);
      } else {
        s.bidder = s.biddingQueue.shift()!;
      }
    }
  }

  return { state: s, events };
}

function _finalizeBidding(s: State, events: BareEvent[], simulate: boolean): void {
  if (s.currentHolder === null) {
    // Shouldn't happen: forehand must bid
    throw new Error('Bidding ended with no holder');
  }

  const forehand = s.activePlayers[0]!;
  const contract = s.currentBid!;

  // Uncontested Single by forehand → offer choice of Single or Trischaken
  if (contract === 'Single' && s.currentHolder === forehand && !s.biddingContested) {
    s.phase = 'contract_choice';
    return;
  }

  _setContract(s, contract, s.currentHolder, events, simulate);
}

function _setContract(s: State, contract: Contract, declarer: number | null, events: BareEvent[], simulate: boolean): void {
  s.contract = contract;
  s.declarer = contract === 'Trischaken' ? null : declarer;

  if (!simulate) {
    if (contract === 'Trischaken') {
      events.push({ type: 'CONTRACT_SET', declarer: declarer ?? -1, contract: 'Trischaken' });
    } else {
      events.push({ type: 'CONTRACT_SET', declarer: declarer!, contract });
    }
  }

  if (_isExchangeContract(contract, s.deckType)) {
    s.phase        = 'exchange';
    s.talonRevealed = true;
    if (!simulate) {
      const [g0, g1] = s.talonGroups;
      events.push({
        type:      'CARDS_MOVED',
        transfers: [
          ...g0!.map(card => ({ card, from: { zone: 'talon' as const }, to: { zone: 'talon' as const } })),
          ...g1!.map(card => ({ card, from: { zone: 'talon' as const }, to: { zone: 'talon' as const } })),
        ],
        reason: 'talon-reveal',
      });
    }
  } else {
    // For SuitSolo (42-card): both talon groups go to the first defender (no exchange)
    if (contract === 'SuitSolo' && s.declarer !== null) {
      const firstDefender = s.activePlayers.find(p => p !== s.declarer)!;
      const allTalon = [...s.talonGroups[0]!, ...s.talonGroups[1]!];
      for (const c of allTalon) s.capturedCards[firstDefender]!.push(c);
      if (!simulate) {
        events.push({
          type: 'CARDS_MOVED',
          transfers: allTalon.map(card => ({
            card,
            from: { zone: 'talon' as const },
            to:   { zone: 'won' as const, player: firstDefender },
          })),
          reason: 'talon-exchange',
        });
      }
    }
    // Solo, SoloValat, SuitSolo, or Trischaken — skip to declaring
    _enterDeclaring(s);
  }
}

// ── Contract choice ────────────────────────────────────────────────────────────

function _applyContractChoice(state: State, move: Move, simulate: boolean): EngineResult<State> {
  if (move.type !== 'CHOOSE_CONTRACT') throw new Error('Expected CHOOSE_CONTRACT');
  const s      = cloneState(state);
  const events: BareEvent[] = [];
  const contract = move.contract as Contract;
  _setContract(s, contract, s.activePlayers[0]!, events, simulate);
  return { state: s, events };
}

// ── Talon exchange ─────────────────────────────────────────────────────────────

function _applyTalonChoice(state: State, move: Move, simulate: boolean): EngineResult<State> {
  if (move.type !== 'CHOOSE_TALON') throw new Error('Expected CHOOSE_TALON');
  const s        = cloneState(state);
  const events: BareEvent[] = [];
  const declarer = s.declarer!;

  const chosenIdx  = move.choice === 'first' ? 0 : 1;
  const rejectedIdx = 1 - chosenIdx;
  const chosen   = s.talonGroups[chosenIdx]!;
  const rejected = s.talonGroups[rejectedIdx]!;

  // Chosen group → declarer's hand
  for (const card of chosen) s.hands[declarer]!.push(card);

  // Rejected group → first defender's captured pile ("first trick of opponents")
  const firstDefender = s.activePlayers.find(p => p !== declarer)!;
  for (const card of rejected) s.capturedCards[firstDefender]!.push(card);

  if (!simulate) {
    events.push({
      type: 'CARDS_MOVED',
      transfers: [
        ...chosen.map(card => ({ card, from: { zone: 'talon' as const }, to: { zone: 'hand' as const, player: declarer } })),
        ...rejected.map(card => ({ card, from: { zone: 'talon' as const }, to: { zone: 'won' as const, player: firstDefender } })),
      ],
      reason: 'talon-exchange',
    });
  }

  s.phase            = 'discard';
  s.discardsRemaining = GROUP_SIZE;
  return { state: s, events };
}

// ── Discard ────────────────────────────────────────────────────────────────────

function _applyDiscard(state: State, move: Move, simulate: boolean): EngineResult<State> {
  if (move.type === 'SUBMIT_DISCARDS') {
    const s        = cloneState(state);
    const events: BareEvent[] = [];
    const declarer = s.declarer!;
    const cards    = move.cards;

    const transfers: { card: Card; from: { zone: 'hand'; player: number }; to: { zone: 'won'; player: number } }[] = [];
    for (const card of cards) {
      const idx = (s.hands[declarer] ?? []).findIndex(c => cardEquals(c, card));
      if (idx === -1) throw new Error(`Discard card not found in declarer's hand`);
      s.hands[declarer]!.splice(idx, 1);
      s.capturedCards[declarer]!.push(card);
      transfers.push({ card, from: { zone: 'hand' as const, player: declarer }, to: { zone: 'won' as const, player: declarer } });
    }

    if (!simulate) {
      events.push({ type: 'CARDS_MOVED', transfers, reason: 'declarer-discard' });
    }

    s.discardsRemaining = 0;
    _enterDeclaring(s);
    return { state: s, events };
  }

  if (move.type !== 'DISCARD_CARD') throw new Error('Expected DISCARD_CARD or SUBMIT_DISCARDS');
  const s        = cloneState(state);
  const events: BareEvent[] = [];
  const declarer = s.declarer!;
  const card     = move.card;

  const idx = (s.hands[declarer] ?? []).findIndex(c => cardEquals(c, card));
  if (idx === -1) throw new Error(`Discard card not found in declarer's hand`);
  s.hands[declarer]!.splice(idx, 1);
  s.capturedCards[declarer]!.push(card);

  if (!simulate) {
    events.push({
      type: 'CARDS_MOVED',
      transfers: [{ card, from: { zone: 'hand' as const, player: declarer }, to: { zone: 'won' as const, player: declarer } }],
      reason: 'declarer-discard',
    });
  }

  s.discardsRemaining--;
  if (s.discardsRemaining === 0) {
    _enterDeclaring(s);
  }

  return { state: s, events };
}

// ── Declaring helpers ─────────────────────────────────────────────────────────

const KONTRA_LEVEL: Record<number, 'Kontra' | 'Rekontra' | 'Subkontra'> = {
  1: 'Kontra', 2: 'Rekontra', 4: 'Subkontra',
};

function _applyKontraToItem(
  item: KontraItem, pi: number, target: string,
  events: BareEvent[], simulate: boolean,
  levelOverride?: 'Kontra' | 'Rekontra' | 'Subkontra'
): void {
  const levelName = levelOverride ?? KONTRA_LEVEL[item.multiplier]!;
  item.multiplier = Math.min(item.multiplier * 2, 8) as 1 | 2 | 4 | 8;
  if      (!item.kontraBy)    item.kontraBy    = pi;
  else if (!item.rekontraBy)  item.rekontraBy  = pi;
  else                        item.subkontraBy = pi;
  if (!simulate) events.push({ type: 'ANNOUNCEMENT_MADE', player: pi, announcement: `${levelName}:${target}` });
}

function _handleDeclaringPass(s: State, pi: number, events: BareEvent[], simulate: boolean): void {
  if (!simulate) events.push({ type: 'ANNOUNCEMENT_MADE', player: pi, announcement: 'pass' });
  s.consecutivePasses++;
  // Trischaken counts all actions (not resets on Kontra); non-Trischaken resets on any declaration.
  const passThreshold = s.contract === 'Trischaken'
    ? s.activePlayers.length
    : (s.announcements.length > 0 || s.kontraItems.some(k => k.kontraBy !== null))
      ? s.activePlayers.length - 1
      : s.activePlayers.length;
  if (s.consecutivePasses >= passThreshold) {
    _enterPlaying(s);
  } else {
    s.declaringBidder = _nextActive(s.activePlayers, pi);
  }
}

// ── Enter declaring phase ──────────────────────────────────────────────────────

function _enterDeclaring(s: State): void {
  s.phase = 'declaring';
  s.declaringBidder   = s.declarer ?? s.activePlayers[0]!;  // declarer first; forehand in Trischaken
  s.consecutivePasses = 0;
  s.announcements     = [];

  // Seed kontraItems with a 'game' entry
  s.kontraItems = [{ target: 'game', multiplier: 1, kontraBy: null, rekontraBy: null, subkontraBy: null }];
}

// ── Declaring transition ───────────────────────────────────────────────────────

function _applyDeclaring(state: State, move: Move, simulate: boolean): EngineResult<State> {
  const s      = cloneState(state);
  const events: BareEvent[] = [];
  const pi     = s.declaringBidder;

  if (move.type === 'PASS_ANNOUNCEMENT') {
    _handleDeclaringPass(s, pi, events, simulate);
    return { state: s, events };
  }

  if (move.type === 'MAKE_ANNOUNCEMENT') {
    s.consecutivePasses = 0;
    const ann = move.announcement;
    s.announcements.push({ name: ann, player: pi });
    s.kontraItems.push({ target: ann, multiplier: 1, kontraBy: null, rekontraBy: null, subkontraBy: null });
    if (!simulate) events.push({ type: 'ANNOUNCEMENT_MADE', player: pi, announcement: ann });
    s.declaringBidder = _nextActive(s.activePlayers, pi);
    return { state: s, events };
  }

  if (move.type === 'KONTRA') {
    const target = move.target;
    const item   = s.kontraItems.find(k => k.target === target);
    if (!item) throw new Error(`Kontra target '${target}' not found`);

    if (s.contract === 'Trischaken') {
      // Each player gets exactly one action; all Kontras are independent and named 'Kontra'.
      // consecutivePasses counts total actions taken (not reset on Kontra here).
      _applyKontraToItem(item, pi, target, events, simulate, 'Kontra');
      s.consecutivePasses++;
      if (s.consecutivePasses >= s.activePlayers.length) {
        _enterPlaying(s);
      } else {
        s.declaringBidder = _nextActive(s.activePlayers, pi);
      }
    } else {
      s.consecutivePasses = 0;
      _applyKontraToItem(item, pi, target, events, simulate);
      s.declaringBidder = _nextActive(s.activePlayers, pi);
    }
    return { state: s, events };
  }

  if (move.type === 'SUBMIT_DECLARATION') {
    const actions = move.actions as DeclaringSubAction[];
    if (actions.length === 0) {
      // Empty batch = pass
      _handleDeclaringPass(s, pi, events, simulate);
      return { state: s, events };
    }

    s.consecutivePasses = 0;

    // Process announcements before kontras so a kontra can target a just-announced bonus
    const announcements = actions.filter((a): a is { type: 'MAKE_ANNOUNCEMENT'; announcement: string } => a.type === 'MAKE_ANNOUNCEMENT');
    const kontras       = actions.filter((a): a is { type: 'KONTRA'; target: string } => a.type === 'KONTRA');

    for (const ann of announcements) {
      s.announcements.push({ name: ann.announcement, player: pi });
      s.kontraItems.push({ target: ann.announcement, multiplier: 1, kontraBy: null, rekontraBy: null, subkontraBy: null });
      if (!simulate) events.push({ type: 'ANNOUNCEMENT_MADE', player: pi, announcement: ann.announcement });
    }

    for (const k of kontras) {
      const item = s.kontraItems.find(ki => ki.target === k.target);
      if (!item) throw new Error(`Kontra target '${k.target}' not found in batch`);
      _applyKontraToItem(item, pi, k.target, events, simulate);
    }

    s.declaringBidder = _nextActive(s.activePlayers, pi);
    return { state: s, events };
  }

  throw new Error(`Unexpected move type in declaring phase: ${move.type}`);
}

function _nextActive(activePlayers: number[], current: number): number {
  const idx = activePlayers.indexOf(current);
  return activePlayers[(idx + 1) % activePlayers.length]!;
}

function _enterPlaying(s: State): void {
  s.phase = 'playing';

  // In 42-card, declarer leads first trick in SuitSolo/Solo/SoloValat
  const declarerLeads = s.deckType === '42' && s.declarer !== null
    && (s.contract === 'SuitSolo' || s.contract === 'Solo' || s.contract === 'SoloValat');
  s.leader       = declarerLeads ? s.declarer! : s.activePlayers[0]!;
  s.currentTrick = [];

  // 42-card: detect deal bonuses (Kings/Trull in hand at start of play)
  // Kings and Trull are discard-restricted, so they're always in hands[] if received
  if (s.deckType === '42' && s.declarer !== null) {
    const hand = s.hands[s.declarer] ?? [];
    s.declarerHadTrull = [...TRULL_RANKS].every(r => hand.some(c => isTarock(c) && c.rank === r));
    s.declarerHadKings = [...BLACK_SUITS, ...RED_SUITS].every(suit => hand.some(c => c.rank === 'K' && c.suit === suit));
  }
}

// ── Card play transition ───────────────────────────────────────────────────────

function _applyCardPlay(state: State, move: Move, simulate: boolean): EngineResult<State> {
  if (move.type !== 'PLAY_CARD') throw new Error('Expected PLAY_CARD');
  const s      = cloneState(state);
  const events: BareEvent[] = [];
  const pi     = getCurrentPlayer(s);
  const card   = move.card;

  const idx = (s.hands[pi] ?? []).findIndex(c => cardEquals(c, card));
  if (idx === -1) throw new Error(`Card not in player ${pi}'s hand`);
  s.hands[pi]!.splice(idx, 1);

  s.currentTrick.push({ playerIndex: pi, card: { ...card } });
  if (!simulate) events.push({ type: 'CARD_PLAYED', player: pi, card: { ...card } });

  if (s.currentTrick.length === s.activePlayers.length) {
    const ledSuit  = s.currentTrick[0]!.card.suit;
    const isSuitSolo = s.contract === 'SuitSolo';
    const winner   = trickWinner(s.currentTrick, ledSuit, isSuitSolo);

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

    if (s.trickNum === DECK[s.deckType].tricksPerHand) {
      _finalizeHand(s, events, simulate);
    }
  }

  // St. Louis Trischaken: last trick winner takes talon
  if (
    s.phase === 'hand_over' &&
    s.contract === 'Trischaken' &&
    s.scoring === 'StLouis'
  ) {
    const lastWinner = s.trickLog[s.trickLog.length - 1]!.winner;
    for (const group of s.talonGroups) {
      for (const c of group) s.capturedCards[lastWinner]!.push(c);
    }
    if (!simulate) {
      events.push({
        type: 'CARDS_MOVED',
        transfers: [...s.talonGroups[0]!, ...s.talonGroups[1]!].map(c => ({
          card: c,
          from: { zone: 'talon' as const },
          to:   { zone: 'won' as const, player: lastWinner },
        })),
        reason: 'trischaken-talon',
      });
    }
  }

  return { state: s, events };
}

// ── Hand finalization + scoring ────────────────────────────────────────────────

function _finalizeHand(s: State, events: BareEvent[], simulate: boolean): void {
  const summary = _computeHandSummary(s);
  const deltas  = _computeDeltas(summary);
  s._summary = summary;
  s._deltas  = deltas;

  for (let pi = 0; pi < s.playerCount; pi++) {
    if (deltas[pi] !== undefined) s.scores[pi]! += deltas[pi]!;
  }

  if (!simulate) {
    events.push({
      type:          'HAND_SCORED',
      deltas:        Object.entries(deltas).map(([p, d]) => ({ player: Number(p), delta: d, reason: 'hand-result' })),
      runningTotals: [...s.scores],
    });
  }

  s.phase = 'hand_over';
}

function _computeHandSummary(s: State): HandSummary {
  const { activePlayers, trickLog, capturedCards, contract, declarer, announcements, kontraItems, scoring, deckType } = s;

  const cardPoints: Record<number, number> = {};
  const tricksWon:  Record<number, number> = {};
  for (const pi of activePlayers) {
    cardPoints[pi] = deckType === '42'
      ? countCardPoints42(capturedCards[pi] ?? [])
      : countCardPoints(capturedCards[pi] ?? []);
    tricksWon[pi] = 0;
  }
  for (const { winner } of trickLog) tricksWon[winner] = (tricksWon[winner] ?? 0) + 1;

  const totalTricks = trickLog.length;
  const valatWinner = activePlayers.find(p => tricksWon[p] === totalTricks) ?? null;

  let mondFangWinner: number | null = null;
  for (const { plays, winner } of trickLog) {
    const hasSküs  = plays.some(p => p.card.suit === 'T' && p.card.rank === '★');
    const mondPlay = plays.find(p => p.card.suit === 'T' && p.card.rank === 'XXI');
    if (hasSküs && mondPlay) {
      // Only scores when the capture crosses team lines (declarer vs defenders).
      const crossTeam = declarer !== null && (winner === declarer) !== (mondPlay.playerIndex === declarer);
      if (crossTeam) mondFangWinner = winner;
      break;
    }
  }

  let trullWinner: number | null = null;
  let kingsWinner: number | null = null;

  if (deckType === '42' && s.scoring !== 'StLouis') {
    // 42-card Mayr: Trull/Kings bonus = declarer had them dealt at start of play
    trullWinner = (s.declarerHadTrull && declarer !== null) ? declarer : null;
    kingsWinner = (s.declarerHadKings && declarer !== null) ? declarer : null;
  } else {
    // 54-card, or 42-card + StLouis: Trull/Kings from captured cards
    for (const pi of activePlayers) {
      const cap = capturedCards[pi] ?? [];
      if ([...TRULL_RANKS].every(r => cap.some(c => isTarock(c) && c.rank === r))) {
        trullWinner = pi; break;
      }
    }
    for (const pi of activePlayers) {
      const cap = capturedCards[pi] ?? [];
      if ([...BLACK_SUITS, ...RED_SUITS].every(suit => cap.some(c => c.rank === 'K' && c.suit === suit))) {
        kingsWinner = pi; break;
      }
    }
  }

  // Absolute bonus (42-card only): declarer scored ≥ 57 card points
  const absoluteWinner = (deckType === '42' && declarer !== null && (cardPoints[declarer] ?? 0) >= 57)
    ? declarer
    : null;

  return {
    contract:          contract!,
    declarer,
    activePlayers,
    cardPoints,
    tricksWon,
    valatWinner,
    pagatUltimoWinner: birdWinnerAtPos(trickLog, 1, 'I'),
    uhuWinner:         deckType === '42' ? { type: 'absent' } : birdWinnerAtPos(trickLog, 2, 'II'),
    kakaduWinner:      deckType === '42' ? { type: 'absent' } : birdWinnerAtPos(trickLog, 3, 'III'),
    mondFangWinner,
    trullWinner,
    kingsWinner,
    absoluteWinner,
    announcements,
    kontraItems,
    scoring,
    deckType,
  };
}

function _computeDeltas(summary: HandSummary): Record<number, number> {
  const deltas: Record<number, number> = {};
  for (const pi of summary.activePlayers) deltas[pi] = 0;

  if (summary.contract === 'Trischaken') {
    _scoreTrischaken(summary, deltas);
  } else {
    _scoreDeclaredGame(summary, deltas);
  }

  return deltas;
}

function _gameKontraMultiplier(kontraItems: KontraItem[]): number {
  return kontraItems.find(k => k.target === 'game')?.multiplier ?? 1;
}

function _bonusKontraMultiplier(kontraItems: KontraItem[], name: string): number {
  return kontraItems.find(k => k.target === name)?.multiplier ?? 1;
}

function _trisachakenDelta(summary: HandSummary, pi: number): number {
  const { activePlayers, cardPoints, scoring, kontraItems } = summary;
  const payment = (scoring === 'StLouis' ? 1 : 3) * _gameKontraMultiplier(kontraItems);
  const zeroPts = activePlayers.filter(p => cardPoints[p] === 0);
  const maxPts  = Math.max(...activePlayers.map(p => cardPoints[p]!));
  const winners = activePlayers.filter(p => cardPoints[p] === maxPts);

  if (zeroPts.includes(pi))  return (activePlayers.length - zeroPts.length) * payment;
  if (zeroPts.length > 0)    return -(zeroPts.length * payment);
  if (winners.includes(pi))  return -((activePlayers.length - winners.length) * payment);
  return winners.length * payment;
}

function _scoreTrischaken(summary: HandSummary, deltas: Record<number, number>): void {
  const { activePlayers, cardPoints, scoring, kontraItems } = summary;
  const payment = (scoring === 'StLouis' ? 1 : 3) * _gameKontraMultiplier(kontraItems);
  const zeroPts = activePlayers.filter(p => cardPoints[p] === 0);
  const maxPts  = Math.max(...activePlayers.map(p => cardPoints[p]!));
  const winners = activePlayers.filter(p => cardPoints[p] === maxPts);

  if (zeroPts.length > 0) {
    for (const zp of zeroPts) {
      for (const other of activePlayers) {
        if (other !== zp) { deltas[zp]! += payment; deltas[other]! -= payment; }
      }
    }
  } else {
    for (const w of winners) {
      for (const other of activePlayers) {
        if (other !== w) { deltas[w]! -= payment; deltas[other]! += payment; }
      }
    }
  }
}

function _soloMultiplier(contract: Contract, deckType: '54' | '42'): number {
  if (deckType === '42') return (contract === 'SuitSolo' || contract === 'Solo') ? 2 : 1;
  return (contract === 'Solo' || contract === 'SoloValat') ? 2 : 1;
}

function _effectiveWinner(
  result:    BonusOutcome,
  ann:       Announcement | null,
  declarer:  number,
  defenders: number[],
): number {
  if (result.type === 'won') return result.player;
  const loser = result.type === 'attempted' ? result.player : ann!.player;
  return loser === declarer ? defenders[0]! : declarer;
}

function _scoreDeclaredGame(summary: HandSummary, deltas: Record<number, number>): void {
  const { contract, declarer, activePlayers, cardPoints, scoring, valatWinner, deckType } = summary;
  if (declarer === null) return;

  const defenders = activePlayers.filter(p => p !== declarer);
  // Solo multiplier: ×2 for SuitSolo/Solo in 42-card; ×2 for Solo/SoloValat in 54-card
  const soloMult = _soloMultiplier(contract, deckType);
  const gameValues = deckType === '42' ? FORTYTWO_GAME_VALUES
    : scoring === 'StLouis' ? STLOUIS_GAME_VALUES : MAYR_GAME_VALUES;
  const gameMult  = _gameKontraMultiplier(summary.kontraItems);

  let gameScore = 0;
  const declarerPts = cardPoints[declarer] ?? 0;
  const declarerWinsAt = DECK[deckType].declarerWinsAt;

  if (deckType !== '42' && scoring === 'StLouis' && valatWinner !== null) {
    // Slam: game value ×4
    const base = gameValues[contract];
    gameScore = (valatWinner === declarer ? 1 : -1) * base * 4 * gameMult;
  } else if (deckType !== '42' && scoring === 'Mayr' && valatWinner !== null) {
    // Valat replaces game value with 24
    gameScore = (valatWinner === declarer ? 1 : -1) * 24 * gameMult;
  } else if (contract === 'SoloValat') {
    // Solo Valat: win iff you won all tricks
    const won = valatWinner === declarer;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
  } else {
    const won = declarerPts >= declarerWinsAt;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
  }

  // Each-against-each: declarer receives/pays per defender
  deltas[declarer]! += gameScore * defenders.length;
  for (const d of defenders) deltas[d]! -= gameScore;

  // Bonuses — same each-against-each settlement
  const isValat = valatWinner !== null;
  const _applyBonus = (result: BonusOutcome, name: string, baseVal: number) => {
    const ann      = summary.announcements.find(a => a.name === name) ?? null;
    const announced = ann !== null;
    if (result.type === 'absent' && !announced) return;

    const kontra  = _bonusKontraMultiplier(summary.kontraItems, name);
    const annMult = announced ? 2 : 1;
    const value   = baseVal * soloMult * annMult * kontra;

    const effectiveWinner = _effectiveWinner(result, ann, declarer, defenders);
    const sign = effectiveWinner === declarer ? 1 : -1;
    deltas[declarer]! += sign * value * defenders.length;
    for (const d of defenders) deltas[d]! -= sign * value;
  };

  if (deckType === '42') {
    for (const { name, base } of BONUS_CONFIGS['42']) _applyBonus(_bonusWinner(summary, name), name, base);
  } else if (!isValat) {
    for (const { name, base } of BONUS_CONFIGS[`54-${scoring}`]) _applyBonus(_bonusWinner(summary, name), name, base);
  }
}

// ── Score breakdown (for display) ─────────────────────────────────────────────

export interface PlayerScoreBreakdown {
  player: number;
  role:   'declarer' | 'defender' | 'none';
  items:  Array<{ label: string; delta: number }>;
  total:  number;
}

function _buildBreakdownItems(summary: HandSummary, pi: number): Array<{ label: string; delta: number }> {
  const items: Array<{ label: string; delta: number }> = [];
  const { contract, declarer, activePlayers, cardPoints, scoring, valatWinner, kontraItems, announcements, deckType } = summary;

  // Card points — informational (delta = 0, displays as "—" in the modal)
  items.push({ label: `Card pts: ${cardPoints[pi] ?? 0}`, delta: 0 });

  if (contract === 'Trischaken') {
    const gameMult = _gameKontraMultiplier(kontraItems);
    const zeroPts  = activePlayers.filter(p => cardPoints[p] === 0);
    const maxPts   = Math.max(...activePlayers.map(p => cardPoints[p]!));
    const winners  = activePlayers.filter(p => cardPoints[p] === maxPts);
    const delta    = _trisachakenDelta(summary, pi);

    let label: string;
    if (zeroPts.includes(pi))    label = '0 pts ✓';
    else if (zeroPts.length > 0) label = 'Trischaken (paid)';
    else if (winners.includes(pi)) label = 'Most pts ✗';
    else label = 'Trischaken ✓';
    if (gameMult > 1) label += ` ×${gameMult}`;

    items.push({ label, delta });
    return items;
  }

  // Declared game
  if (declarer === null) return items;
  const defenders  = activePlayers.filter(p => p !== declarer);
  const soloMultiplier = _soloMultiplier(contract, deckType);
  const gameValues = deckType === '42' ? FORTYTWO_GAME_VALUES
    : scoring === 'StLouis' ? STLOUIS_GAME_VALUES : MAYR_GAME_VALUES;
  const gameMult   = _gameKontraMultiplier(kontraItems);
  const declarerPts = cardPoints[declarer] ?? 0;
  const isValat    = valatWinner !== null;
  const contractDisplay = contract === 'SoloValat' ? 'Solo Valat'
    : contract === 'SuitSolo' ? 'Suit Solo' : contract;
  const declarerWinsAt = DECK[deckType].declarerWinsAt;

  // Game score: amount per defender, signed by outcome
  let gameScore = 0;
  let gameLabel = '';

  if (deckType !== '42' && isValat && scoring === 'StLouis') {
    const base = gameValues[contract];
    gameScore = (valatWinner === declarer ? 1 : -1) * base * 4 * gameMult;
    gameLabel = valatWinner === declarer ? 'Slam ✓' : 'Slam ✗';
  } else if (deckType !== '42' && isValat && scoring === 'Mayr') {
    gameScore = (valatWinner === declarer ? 1 : -1) * 24 * gameMult;
    gameLabel = valatWinner === declarer ? 'Valat ✓' : 'Valat ✗';
  } else if (contract === 'SoloValat') {
    const won = valatWinner === declarer;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
    gameLabel = won ? 'Solo Valat ✓' : 'Solo Valat ✗';
  } else {
    const won = declarerPts >= declarerWinsAt;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
    const ptsNote = pi === declarer ? ` (${declarerPts} pts)` : ` (${declarerPts} pts dec.)`;
    gameLabel = `${contractDisplay} ${won ? '✓' : '✗'}${ptsNote}`;
  }

  if (gameMult > 1) gameLabel += ` ×${gameMult}`;

  const gameDelta = pi === declarer
    ? gameScore * defenders.length
    : -gameScore;
  items.push({ label: gameLabel, delta: gameDelta });

  // Bonuses
  const skipBonuses = deckType !== '42' && isValat;
  if (!skipBonuses) {
    const addBonus = (result: BonusOutcome, name: string, baseVal: number) => {
      const ann      = announcements.find(a => a.name === name) ?? null;
      const announced = ann !== null;
      if (result.type === 'absent' && !announced) return;

      const kontra  = _bonusKontraMultiplier(kontraItems, name);
      const annMult = announced ? 2 : 1;
      const value   = baseVal * soloMultiplier * annMult * kontra;

      const effectiveWinner = _effectiveWinner(result, ann, declarer, defenders);
      const sign = effectiveWinner === declarer ? 1 : -1;

      const deltaPi = pi === declarer
        ? sign * value * defenders.length
        : -(sign * value);

      if (deltaPi === 0) return;

      let label = name;
      label += result.type === 'won' ? ' ✓' : ' ✗';
      const mods: string[] = [];
      if (announced) mods.push('ann.');
      if (soloMultiplier > 1) mods.push('solo ×2');
      if (kontra > 1) mods.push(`kontra ×${kontra}`);
      if (mods.length > 0) label += ` (${mods.join(', ')})`;

      items.push({ label, delta: deltaPi });
    };

    const bonusKey = (deckType === '42' ? '42' : `54-${scoring}`) as BonusConfigKey;
    for (const { name, base } of BONUS_CONFIGS[bonusKey]) addBonus(_bonusWinner(summary, name), name, base);
  }

  return items;
}

export function computeScoreBreakdown(state: State): PlayerScoreBreakdown[] | null {
  if (!isHandOver(state)) return null;
  const summary = state._summary ?? _computeHandSummary(state);
  const deltas  = state._deltas  ?? _computeDeltas(summary);

  return state.activePlayers.map(pi => {
    const role: 'declarer' | 'defender' | 'none' =
      state.contract === 'Trischaken' ? 'none'
      : pi === state.declarer         ? 'declarer'
      : 'defender';
    const total = deltas[pi] ?? 0;
    const items = _buildBreakdownItems(summary, pi);
    return { player: pi, role, items, total };
  });
}

// ── ISMCTS interface ───────────────────────────────────────────────────────────

/**
 * Stichzwang (St. Louis Trischaken): each player must overtake if able.
 * If a player plays a card that doesn't head the trick when a heading card exists,
 * we can prove they lacked all cards that would have headed it.
 * Returns a map: player → Set of "suit+rank" keys they provably cannot hold.
 */
function _inferStichzwangAbsences(
  trickLog:          TarockTrickRecord[],
  perspectivePlayer: number,
): Map<number, Set<string>> {
  const absences = new Map<number, Set<string>>();
  const addAbsent = (pi: number, key: string) => {
    if (!absences.has(pi)) absences.set(pi, new Set());
    absences.get(pi)!.add(key);
  };

  for (const { plays, ledSuit } of trickLog) {
    const ledOrder = BLACK_SUITS_SET.has(ledSuit) ? BLACK_RANK_ORDER : RED_RANK_ORDER;
    let highestTarockOrder = -1;
    let highestLedOrder    = -1;

    for (const { playerIndex: pi, card } of plays) {
      if (pi !== perspectivePlayer) {
        if (isTarock(card)) {
          const ro = TAROCK_RANK_ORDER[card.rank] ?? 0;
          if (highestTarockOrder >= 0 && ro < highestTarockOrder) {
            // Played a lower Tarock when a higher one was winning — lacked all higher ones
            for (const [rank, order] of Object.entries(TAROCK_RANK_ORDER)) {
              if (order > ro && order <= highestTarockOrder) addAbsent(pi, 'T' + rank);
            }
          }
        } else if (card.suit === ledSuit && highestTarockOrder < 0) {
          // Followed led suit (no Tarock yet) — check rank
          const ro = ledOrder[card.rank] ?? 0;
          if (highestLedOrder >= 0 && ro < highestLedOrder) {
            // Played lower in led suit — lacked all higher cards of that suit
            for (const [rank, order] of Object.entries(ledOrder)) {
              if (order > ro && order <= highestLedOrder) addAbsent(pi, ledSuit + rank);
            }
          }
        }
      }
      // Advance running maximum
      if (isTarock(card)) {
        highestTarockOrder = Math.max(highestTarockOrder, TAROCK_RANK_ORDER[card.rank] ?? 0);
      } else if (card.suit === ledSuit) {
        highestLedOrder = Math.max(highestLedOrder, ledOrder[card.rank] ?? 0);
      }
    }
  }

  return absences;
}

function determinize(state: State, perspectivePlayer: number): State {
  if (isHandOver(state)) return cloneState(state);

  const s      = cloneState(state);
  const voids  = inferVoids(s.trickLog, perspectivePlayer);
  const opponents = s.activePlayers.filter(p => p !== perspectivePlayer);

  // Collect hidden cards from all opponents' hands
  const hidden: Card[] = [];
  for (const opp of opponents) hidden.push(...(s.hands[opp] ?? []));

  // Unrevealed talon: both groups are fully hidden — include in pool with no constraints
  if (!s.talonRevealed) {
    hidden.push(...s.talonGroups[0]!, ...s.talonGroups[1]!);
  }

  // After exchange the chosen talon group is publicly known (both groups were revealed before
  // the pick). Those cards entered the declarer's hand and can NEVER be in another player's
  // hand, so pin them to the declarer's slots in the bipartite matching.
  const chosenTalonKeys = new Set<string>();
  if (s.talonRevealed && s.declarer !== null && s.phase !== 'exchange') {
    const declarer       = s.declarer;
    const firstDefender  = s.activePlayers.find(p => p !== declarer)!;
    const defCapKeys     = new Set((s.capturedCards[firstDefender] ?? []).map(cardKey));
    // The rejected group is the one whose cards all appear in firstDefender's captured pile
    const rejectedIdx = s.talonGroups.findIndex(g => g.every(c => defCapKeys.has(cardKey(c))));
    if (rejectedIdx !== -1) {
      for (const c of s.talonGroups[1 - rejectedIdx]!) chosenTalonKeys.add(cardKey(c));
    }
  }

  // St. Louis Trischaken Stichzwang: if a player doesn't head the trick they had no heading card
  const stichAbsences = (s.contract === 'Trischaken' && s.scoring === 'StLouis')
    ? _inferStichzwangAbsences(s.trickLog, perspectivePlayer)
    : new Map<number, Set<string>>();

  const oppHandSizes = opponents.map(opp => (s.hands[opp] ?? []).length);
  const totalSlots   = oppHandSizes.reduce((a, b) => a + b, 0) + (s.talonRevealed ? 0 : TALON_SIZE);

  const slotToPlayer: number[] = [];
  for (let i = 0; i < opponents.length; i++) {
    for (let j = 0; j < oppHandSizes[i]!; j++) slotToPlayer.push(opponents[i]!);
  }
  if (!s.talonRevealed) {
    for (let j = 0; j < TALON_SIZE; j++) slotToPlayer.push(-1); // talon: unconstrained
  }

  const shuffled = shuffle(hidden);

  const canUse = (ci: number, si: number): boolean => {
    const owner = slotToPlayer[si]!;
    const card  = shuffled[ci]!;
    const key   = cardKey(card);

    // Chosen talon cards can only go into the declarer's slots
    if (chosenTalonKeys.has(key) && owner !== s.declarer) return false;

    if (owner === -1) return true;  // talon slot: unconstrained

    // Farbzwang suit-void inference
    if (voids.get(owner)?.has(card.suit)) return false;

    // Stichzwang rank-absence inference (St. Louis Trischaken)
    if (stichAbsences.get(owner)?.has(key)) return false;

    return true;
  };

  const match = bipartiteMatch(shuffled.length, totalSlots, canUse);

  if (!match) {
    // Fallback: plain shuffle ignoring constraints
    const pool = shuffle(hidden);
    let offset = 0;
    for (let i = 0; i < opponents.length; i++) {
      const sz = oppHandSizes[i]!;
      s.hands[opponents[i]!] = pool.slice(offset, offset + sz);
      offset += sz;
    }
    if (!s.talonRevealed) {
      s.talonGroups[0] = pool.slice(offset, offset + GROUP_SIZE);
      s.talonGroups[1] = pool.slice(offset + GROUP_SIZE, offset + TALON_SIZE);
    }
    return s;
  }

  // Write assignments back
  let slotOffset = 0;
  for (let i = 0; i < opponents.length; i++) {
    const sz = oppHandSizes[i]!;
    s.hands[opponents[i]!] = match.slice(slotOffset, slotOffset + sz).map(ci => shuffled[ci]!);
    slotOffset += sz;
  }
  if (!s.talonRevealed) {
    s.talonGroups[0] = match.slice(slotOffset, slotOffset + GROUP_SIZE).map(ci => shuffled[ci]!);
    s.talonGroups[1] = match.slice(slotOffset + GROUP_SIZE, slotOffset + TALON_SIZE).map(ci => shuffled[ci]!);
  }

  return s;
}

function getReward(state: State, playerIndex: number): number | null {
  if (!isHandOver(state)) return null;

  // Inactive dealer in 4-player mode
  if (!state.activePlayers.includes(playerIndex)) return 0.5;

  // cardBonus: creates a gradient within a win/loss so bots keep playing purposefully
  let cardBonus = 0;
  const countPts = state.deckType === '42' ? countCardPoints42 : countCardPoints;
  const midpoint = DECK[state.deckType].cardMidpoint;
  const totalPts = DECK[state.deckType].cardTotal;
  if (state.contract === 'Trischaken') {
    const myPts = countPts(state.capturedCards[playerIndex] ?? []);
    cardBonus = (midpoint - myPts) / totalPts * 0.2;
  } else if (state.declarer !== null) {
    const declarerPts = countPts(state.capturedCards[state.declarer] ?? []);
    const margin = (declarerPts - midpoint) / midpoint;
    cardBonus = (playerIndex === state.declarer ? margin : -margin) * 0.2;
  }

  const deltas = state._deltas ?? _computeDeltas(state._summary ?? _computeHandSummary(state));
  const raw    = (deltas[playerIndex] ?? 0) + cardBonus;
  return (Math.tanh(raw / REWARD_SCALE) + 1) / 2;
}

// ── Bid prior ──────────────────────────────────────────────────────────────────
//
// Weights legal moves during ISMCTS expansion so iterations are spent on
// plausible bids first. Hand strength uses the Mayr & Sedlaczek (2016) feature-
// valuation heuristic — expected card-point yield from structural features:
//
//   Void suit (Fehlfarbe):       +11  entire suit ruffable
//   Singleton King:              +10  1 guaranteed trick + suit stripped by Tarocks
//   King + Queen (any length):    +8  protected King, likely 1 safe trick
//   Sküs (★) or Mond (XXI):      +9  each; guaranteed high-trump winners
//   Long King (≥4 cards, no Q):  +5  freeable with Tarock length
//   Queen + Knight (no King):    +3  semi-protected, modest contribution
//
// Exchange contracts (Single–Quintuple) add TALON_EXPECTED_PTS (declarer picks
// the better half). Solo subtracts a 5-pt risk margin (opponents keep the talon).

const TALON_EXPECTED_PTS = 4.5;
const EVAL_SUITS = [...BLACK_SUITS, ...RED_SUITS] as const;

// Minimum Tarock count below which a bid level is implausible regardless of suit strength.
// Single needs ~10 for control; SoloValat needs near-complete Tarock dominance.
const MIN_TAROCKS: Record<BidLevel, number> = {
  Single: 8, Double: 9, Triple: 9, Quadruple: 10, Quintuple: 10, SuitSolo: 0, Solo: 10, SoloValat: 12,
};
const MIN_TAROCKS_42: Record<BidLevel, number> = {
  Single: 6, Double: 7, Triple: 8, Quadruple: 99, Quintuple: 99, SuitSolo: 0, Solo: 9, SoloValat: 11,
};

// Expected card-point thresholds. Exchange-contract evaluation includes TALON_EXPECTED_PTS;
// Solo evaluation includes a -5 risk margin — both already baked into _evaluateHand.
const BID_LEVEL_THRESHOLDS: Record<BidLevel, number> = {
  Single:    34,  // min 36 to win; talon adds ~4.5; threshold allows borderline hands
  Double:    37,  // previous holder claimed strength; need margin above 36
  Triple:    40,
  Quadruple: 43,
  Quintuple: 46,
  SuitSolo:  999, // not used for 54-card
  Solo:      38,  // text examples: solid Solo ≈ 44 expected pts; risky ≈ 39; -5 already applied
  SoloValat: 50,  // must win all 16 tricks
};
// 42-card thresholds: calibrated to _evaluateHand output scale (~5–40 for typical hands).
// Anchors: 7T+Sküs+2V → exchangeStr≈33; 8T+Sküs+2V → soloStr≈24.
// SoloValat threshold is negative because all-tarock hands score near zero in the evaluator
// (no suit features) — the min-tarocks gate (11) is the real control for SoloValat.
const BID_LEVEL_THRESHOLDS_42: Record<BidLevel, number> = {
  Single:    28,   // 7T+Sküs+2V → prior≈0.93; 7T no Trull → prior≈0
  Double:    31,   // same hand → prior≈0.67
  Triple:    34,   // same hand → prior≈0.16; need meaningfully stronger hand
  Quadruple: 999,  // unused
  Quintuple: 999,  // unused
  SuitSolo:  22,   // soloStr; no talon but opponents can't ruff suits
  Solo:      23,   // 8T+Sküs+2V → soloStr≈24 → prior≈0.62
  SoloValat: -8,   // min-tarocks gate (11) is primary control; threshold must be negative
};

// Returns expected card-point yield from structural hand features (talon adjustment excluded).
// Accepts pre-computed tarocks slice (hand.filter(isTarock)) to avoid redundant passes.
function _evaluateHand(hand: Card[], tarocks: Card[]): number {
  let strength = 0;

  const tarockCount = tarocks.length;

  if (tarocks.some(c => c.rank === '★'))   strength += 9;   // Sküs — guaranteed winner
  if (tarocks.some(c => c.rank === 'XXI')) strength += 9;   // Mond — strong winner

  for (const suit of EVAL_SUITS) {
    const cards = hand.filter(c => c.suit === suit);
    const n     = cards.length;
    const hasK  = cards.some(c => c.rank === 'K');
    const hasQ  = cards.some(c => c.rank === 'Q');
    const hasKn = cards.some(c => c.rank === 'Kn');

    if (n === 0) {
      strength += 11;                    // Fehlfarbe — can ruff entire suit
    } else if (hasK && n === 1) {
      strength += 10;                    // blanker König — singleton, 1 guaranteed trick
    } else if (hasK && hasQ) {
      strength += 8;                     // König mit Dame — protected regardless of length
    } else if (hasK && n >= 4) {
      strength += 5;                     // König zu siebt — long King, freeable
    } else if (!hasK && hasQ && hasKn) {
      strength += 3;                     // Dame mit Cavall — semi-protected
    }
  }

  // Tarock length: each below 10 is a control liability; each above adds trick-taking power
  strength += (tarockCount - 10) * 0.8;

  return strength;
}

function scoreTalonGroup(group: Card[], hand: Card[], scoring: ScoringSystemName): number {
  let score = 0;
  const isMayr = scoring !== 'StLouis';

  for (const card of group) {
    if (card.rank === 'K') {
      score += 1;
    } else if (isTarock(card)) {
      const order = TAROCK_RANK_ORDER[card.rank] ?? 0;
      if (card.rank === '★')        score += 2;
      else if (card.rank === 'XXI') score += 2;
      else if (order >= 15)         score += 1.3;  // XVI–XX
      else                          score += 1;
    }
  }

  const birds = [
    { rank: 'I',   bonus: isMayr ? 2 : 1   },
    { rank: 'II',  bonus: isMayr ? 3 : 1.5 },
    { rank: 'III', bonus: isMayr ? 4 : 2   },
  ];

  for (const bird of birds) {
    const inGroup = group.some(c => isTarock(c) && c.rank === bird.rank);
    const inHand  = hand.some(c => isTarock(c) && c.rank === bird.rank);
    if (inGroup && !inHand && group.some(c => isTarock(c) && c.rank !== bird.rank)) {
      score += bird.bonus;
    }
  }

  return score;
}

export function movePrior(state: State, legal: Move[]): number[] | null {
  if (state.phase === 'exchange') {
    const declarer = state.declarer!;
    const hand     = state.hands[declarer] ?? [];
    const scores   = state.talonGroups.map(g => scoreTalonGroup(g, hand, state.scoring));
    return legal.map(m => m.type === 'CHOOSE_TALON'
      ? (m.choice === 'first' ? scores[0]! : scores[1]!)
      : 1
    );
  }

  // During declaring, weight bird announcements by tarock holding strength.
  // A player needs many high tarocks (XV+) to drain opponents and protect a bird
  // card until its required trick; low tarock counts should heavily discourage birds.
  if (state.phase === 'declaring') {
    const pi      = getCurrentPlayer(state);
    const hand    = state.hands[pi] ?? [];
    const tarocks = hand.filter(isTarock);
    const tc      = tarocks.length;
    const highTc  = tarocks.filter(c => (TAROCK_RANK_ORDER[c.rank] ?? 0) >= (TAROCK_RANK_ORDER['XV'] ?? 14)).length; // XV–★

    return legal.map(m => {
      if (m.type !== 'MAKE_ANNOUNCEMENT') return 1.0;
      switch (m.announcement) {
        case 'Pagat':   return Math.max(0.05, Math.min(3, (tc - 5) * 0.5 + highTc * 0.3));
        case 'Uhu':     return Math.max(0.05, Math.min(3, (tc - 4) * 0.5 + highTc * 0.2));
        case 'Kakadu':  return Math.max(0.05, Math.min(3, (tc - 3) * 0.5 + highTc * 0.1));
        default: return 1.0;
      }
    });
  }

  if (state.phase !== 'bidding') return null;

  const player      = getCurrentPlayer(state);
  const hand        = state.hands[player] ?? [];
  const tarocks     = hand.filter(isTarock);
  const tarockCount = tarocks.length;
  const baseStr     = _evaluateHand(hand, tarocks);
  const is42        = state.deckType === '42';
  const exchangeStr = baseStr + TALON_EXPECTED_PTS;
  const soloStr     = baseStr - 5;
  const thresholds  = is42 ? BID_LEVEL_THRESHOLDS_42 : BID_LEVEL_THRESHOLDS;
  const minTarocks  = is42 ? MIN_TAROCKS_42 : MIN_TAROCKS;

  return legal.map(m => {
    if (m.type === 'PASS_BID') {
      const singleThreshold = thresholds.Single;
      const margin = exchangeStr - singleThreshold;
      return Math.max(0.05, 1 / (1 + Math.exp(margin * 0.5)));
    }
    if (m.type !== 'MAKE_BID') return 1;

    const level    = m.bid as BidLevel;
    const forSolo  = level === 'Solo' || level === 'SoloValat' || (is42 && level === 'SuitSolo');
    const strength = forSolo ? soloStr : exchangeStr;
    const threshold = thresholds[level];

    if (tarockCount < minTarocks[level]) return 0.05;

    const margin = strength - threshold;
    return Math.max(0.05, 1 / (1 + Math.exp(-margin * 0.5)));
  });
}

// ── Rollout policy ─────────────────────────────────────────────────────────────
//
// Used by ISMCTS as the simulation policy after tree expansion.
// Non-play phases fall back to random; during trick play:
//   - Leading: strongest non-Sküs safe tarock (mid-high trump strategy). Sküs is kept in
//     reserve to capture Mond Fang opportunities or overtrump. Block: Mond without Sküs
//     (Mond Fang bait), Pagat while other tarocks remain (Ultimo). Fall back to weakest
//     suit card, then Sküs as last resort if no safe tarock exists.
//   - Following: weakest winning card; weakest overall if unable to win.
//
// This ensures e.g. ★ is always played in rollouts when XXI is led, making
// MondFang risk accurately priced instead of diluted 1/N across legal tarocks.

export function rolloutPolicy(state: State, legal: Move[]): Move {
  if (state.phase === 'exchange') {
    const declarer = state.declarer!;
    const hand     = state.hands[declarer] ?? [];
    const [s0, s1] = state.talonGroups.map(g => scoreTalonGroup(g, hand, state.scoring));
    const best = (s0 ?? 0) >= (s1 ?? 0) ? 'first' : 'second';
    return legal.find(m => m.type === 'CHOOSE_TALON' && (m as { choice: string }).choice === best) ?? legal[0]!;
  }

  if (state.phase !== 'playing') return legal[Math.floor(Math.random() * legal.length)]!;

  // legal already excludes announced bird cards outside their target trick (enforced by _legalCardPlays).
  const plays = legal.filter((m): m is { type: 'PLAY_CARD'; card: Card } => m.type === 'PLAY_CARD');

  // Trischaken strategy is too complex for simple rollout heuristics: optimal play can require
  // deliberately taking low-scoring tricks to void a suit and shed high-point cards later.
  // Any directional heuristic will be systematically wrong in some situations; random is less
  // biased and lets ISMCTS find the right line through tree search.
  if (state.contract === 'Trischaken') return plays[Math.floor(Math.random() * plays.length)]!;

  if (state.currentTrick.length === 0) {
    const pi      = getCurrentPlayer(state);
    const hand    = state.hands[pi] ?? [];
    const tarocks = hand.filter(isTarock);
    const hasSküs = tarocks.some(c => c.rank === '★');

    // SuitSolo leading: prefer leading a suit card to avoid wasting trumps.
    // Declarer wants to pull out opponents' suit cards; lead low suits first.
    if (state.contract === 'SuitSolo') {
      const suitPlays = plays.filter(m => !isTarock(m.card));
      if (suitPlays.length > 0) return weakestMove(suitPlays);
      // Only trumps remain (must mean _legalCardPlays already allows it)
      return weakestMove(plays);
    }

    const blocked = new Set<string>();
    if (!hasSküs) blocked.add('TXXI');           // Mond Fang bait without Sküs
    if (tarocks.length > 1) blocked.add('TI');   // Pagat Ultimo potential

    // Mid-high trump: strongest non-Sküs safe tarock. Sküs stays in reserve — it is the
    // only card that can capture the Mond (Mond Fang) or overtrump any future trick.
    const nonSkuzTarocks = plays.filter(m => isTarock(m.card) && m.card.rank !== '★' && !blocked.has(cardKey(m.card)));
    if (nonSkuzTarocks.length > 0) return strongestMove(nonSkuzTarocks);

    // No safe non-Sküs tarock: weakest non-blocked card (suit cards before Sküs by rank).
    const pool = plays.filter(m => !blocked.has(cardKey(m.card)));
    return weakestMove(pool.length > 0 ? pool : plays);
  }

  return followTrickPolicy(plays, state.currentTrick, state.contract === 'SuitSolo');
}

// ── Move key (compact ISMCTS map key — avoids JSON.stringify overhead) ────────

export function moveKey(m: Move): string {
  switch (m.type) {
    case 'PLAY_CARD':         return `PC:${m.card.suit}${m.card.rank}`;
    case 'DISCARD_CARD':      return `DC:${m.card.suit}${m.card.rank}`;
    case 'MAKE_BID':          return `MB:${m.bid}`;
    case 'PASS_BID':          return 'PB';
    case 'PASS_ANNOUNCEMENT': return 'PA';
    case 'MAKE_ANNOUNCEMENT': return `MA:${m.announcement}`;
    case 'KONTRA':            return `K:${m.target}`;   // level is a display hint per types.ts
    case 'CHOOSE_CONTRACT':   return `CC:${m.contract}`;
    case 'CHOOSE_TALON':      return `CT:${m.choice}`;
    case 'SUBMIT_DECLARATION':
      return `SD:${m.actions.map(a => a.type === 'KONTRA' ? `K:${a.target}` : `MA:${a.announcement}`).join(',')}`;
    case 'SUBMIT_DISCARDS':
      return `SDS:${m.cards.map(c => `${c.suit}${c.rank}`).sort().join(',')}`;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

export {
  // Constants
  TAROCK_RANKS, BLACK_RANKS, RED_RANKS, BLACK_SUITS, RED_SUITS,
  HAND_SIZE, TALON_SIZE,
  // Card utilities (re-exported from lib/tarock for adapter convenience)
  cardPointValue, countCardPoints, countCardPoints42, isTarock, cardEquals, createDeck, createDeck42, shuffle,
  // Lifecycle (dealState, getDealEvents are already exported via `export function`)
  cloneState,
  // Queries
  getCurrentPlayer, getLegalMoves, isHandOver, isGameOver,
  // Transition
  applyMove,
  // ISMCTS
  determinize, getReward,
};

// Compile-time verification that this module satisfies the ISMCTS engine contract.
const _: ISMCTSEngine<State, Move> = { getLegalMoves, applyMove, isHandOver, determinize, getReward, getCurrentPlayer };
