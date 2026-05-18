
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
 *     Bonuses: Pagat ±1, Uhu ±2, Kakadu ±3, Mond Fang ±1.
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
 *   Bonuses: Pagat=1, Uhu=2, Kakadu=3, Mond Fang=1 (Trull/Kings not separate bonuses).
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
  BLACK_RANKS, RED_RANKS, BLACK_SUITS, RED_SUITS,
  cardPointValue, countCardPoints, isTarock, cardEquals, createDeck, shuffle,
  trickWinner, birdWinnerAtPos, inferVoids,
} from '../lib/tarock';
import type { TarockPlay, TarockTrickRecord } from '../lib/tarock';

export const GAME_NAME = 'Dreiertarock';
export const GAME_ICON = '🃏';

// ── Bid levels ─────────────────────────────────────────────────────────────────

export const BID_LEVELS = [
  'Single', 'Double', 'Triple', 'Quadruple', 'Quintuple', 'Solo', 'SoloValat',
] as const;
export type BidLevel = typeof BID_LEVELS[number];

// Contracts include all bid levels plus Trischaken (not a bid — chosen post-auction)
export type Contract = BidLevel | 'Trischaken';

// Bid ordering for comparison (higher index = stronger bid)
const BID_RANK: Record<BidLevel, number> = {
  Single: 0, Double: 1, Triple: 2, Quadruple: 3, Quintuple: 4, Solo: 5, SoloValat: 6,
};

// Bids that require the talon exchange
const EXCHANGE_CONTRACTS = new Set<Contract>(['Single', 'Double', 'Triple', 'Quadruple', 'Quintuple']);

// Trull ranks (Sküs, Mond, Pagat) — restricted from discard
const TRULL_RANKS = new Set(['★', 'XXI', 'I']);

// ── Scoring systems ────────────────────────────────────────────────────────────

export type ScoringSystemName = 'Mayr' | 'StLouis';

export const SCORING_SYSTEMS: Record<ScoringSystemName, { name: string }> = {
  Mayr:    { name: 'Mayr' },
  StLouis: { name: 'St. Louis' },
};

const MAYR_GAME_VALUES: Record<Contract, number> = {
  Trischaken: 3, Single: 3, Double: 4, Triple: 5, Quadruple: 6, Quintuple: 7,
  Solo: 12, SoloValat: 96,
};

const STLOUIS_GAME_VALUES: Record<Contract, number> = {
  Trischaken: 1, Single: 1, Double: 2, Triple: 3, Quadruple: 3, Quintuple: 3,
  Solo: 4, SoloValat: 32,
};

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
  valatWinner:       number | null;       // won all 16 tricks
  pagatUltimoWinner: number | null;
  uhuWinner:         number | null;
  kakaduWinner:      number | null;
  mondFangWinner:    number | null;
  trullWinner:       number | null;       // who captured all 3 Trull cards (★, XXI, I)
  kingsWinner:       number | null;       // who captured all 4 Kings
  announcements:     Announcement[];
  kontraItems:       KontraItem[];
  scoring:           ScoringSystemName;
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
}

export interface DealConfig {
  scores?:      number[] | null;
  dealerIndex?: number;
  scoring?:     ScoringSystemName;
  playerCount?: 3 | 4;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HAND_SIZE      = 16;  // 2 packets of 8 per active player
const TALON_SIZE     = 6;
const TALON_GROUPS   = 2;
const GROUP_SIZE     = 3;
const TRICKS_PER_HAND = HAND_SIZE;   // 16 cards × 3 players / 3 per trick = 16
const DECLARER_WINS_AT = 36;
const REWARD_SCALE   = 24;  // each-against-each; ordinary Double+Pagat ≈ ±24; Solo+bonuses ≈ ±64

// ── Deck + state factory ───────────────────────────────────────────────────────

export function dealState({
  scores      = null,
  dealerIndex = 0,
  scoring     = 'Mayr',
  playerCount = 3,
}: DealConfig = {}): State {
  const deck = shuffle(createDeck());

  // active players = all seats except dealer (when 4 play)
  const activePlayers: number[] = [];
  for (let i = 1; i <= 3; i++) activePlayers.push((dealerIndex + i) % playerCount);

  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  let pos = 0;

  // Two packets of 8 (forehand-first) interleaved with talon
  // Deal order: [FH 8] [talon first 3] [MH 8] [talon second 3] [DL 8]
  // Per Mayr & Sedlaczek: 1 packet of 8 → talon group 1 (3) → talon group 2 (3) → 1 packet of 8
  // Simplified: packet1 (8 each) then talon (6) then packet2 (8 each)
  for (const pi of activePlayers) {
    hands[pi]!.push(...deck.slice(pos, pos + 8)); pos += 8;
  }
  const talonGroup0 = deck.slice(pos, pos + GROUP_SIZE); pos += GROUP_SIZE;
  const talonGroup1 = deck.slice(pos, pos + GROUP_SIZE); pos += GROUP_SIZE;
  for (const pi of activePlayers) {
    hands[pi]!.push(...deck.slice(pos, pos + 8)); pos += 8;
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
  };
}

export function getDealEvents(dealerIndex: number, playerCount: 3 | 4 = 3): DealEvent[] {
  const activePlayers: number[] = [];
  for (let i = 1; i <= 3; i++) activePlayers.push((dealerIndex + i) % playerCount);
  const events: DealEvent[] = [];
  for (const pi of activePlayers)
    events.push({ type: 'DEAL', dealer: dealerIndex, to: pi, zone: 'hand', count: 8 });
  // talon — emitted as dealt to a sentinel player (-1) so the UI shows it face-down
  events.push({ type: 'DEAL', dealer: dealerIndex, to: -1, zone: 'hand', count: TALON_SIZE });
  for (const pi of activePlayers)
    events.push({ type: 'DEAL', dealer: dealerIndex, to: pi, zone: 'hand', count: 8 });
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
  const { bidder, currentBid, currentHolder, isInPair, activePlayers } = state;
  const forehand = activePlayers[0]!;
  const isForehandFirstTurn = bidder === forehand && currentBid === null;

  const isBiddersFirstBid = !state.bidLog.some(b => b.player === bidder);

  const moves: Move[] = [];

  // Forehand cannot pass on their mandatory first bid
  if (!isForehandFirstTurn) {
    moves.push({ type: 'PASS_BID' });
  }

  for (const level of BID_LEVELS) {
    if (level === 'Solo' || level === 'SoloValat') {
      // Jump bids: only at your very first opportunity, before you've bid or passed anything.
      if (!isBiddersFirstBid) continue;
      if (currentBid && (BID_RANK[currentBid] >= BID_RANK[level])) continue;
      moves.push({ type: 'MAKE_BID', bid: level });
      continue;
    }

    // Stepped bids (Single … Quintuple):
    if (currentBid === null) {
      // Forehand's opening: only Single is legal
      if (level === 'Single') moves.push({ type: 'MAKE_BID', bid: level });
    } else {
      const rank = BID_RANK[level];
      const cur  = BID_RANK[currentBid];
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

  // Announcements (only non-Trischaken)
  if (state.contract !== 'Trischaken') {
    const hand    = state.hands[pi] ?? [];
    const already = new Set(state.announcements.map(a => a.name));

    if (!already.has('Pagat')  && hand.some(c => isTarock(c) && c.rank === 'I'))   moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Pagat' });
    if (!already.has('Uhu')    && hand.some(c => isTarock(c) && c.rank === 'II'))  moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Uhu' });
    if (!already.has('Kakadu') && hand.some(c => isTarock(c) && c.rank === 'III')) moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Kakadu' });
    if (!already.has('Trull')  && hand.some(c => isTarock(c) && c.rank === '★'))   moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Trull' });
    if (!already.has('Kings'))                                                     moves.push({ type: 'MAKE_ANNOUNCEMENT', announcement: 'Kings' });
  }

  // Kontra moves
  for (const item of state.kontraItems) {
    const nextLevel = item.multiplier === 1 ? 2 : item.multiplier === 2 ? 4 : item.multiplier === 4 ? 8 : null;
    if (nextLevel === null) continue;

    const levelName = _kontraLevelName(item);

    // Determine who "owns" this target (declarer owns 'game' and their own announcements)
    const ownerTeam = _ownerTeam(item.target, state);
    const isOpponent = !ownerTeam.includes(pi);

    if (item.multiplier === 1 && isOpponent) {
      moves.push({ type: 'KONTRA', target: item.target, level: levelName });
    } else if (item.multiplier === 2 && ownerTeam.includes(pi)) {
      moves.push({ type: 'KONTRA', target: item.target, level: levelName });
    } else if (item.multiplier === 4 && isOpponent) {
      moves.push({ type: 'KONTRA', target: item.target, level: levelName });
    }

    // Trischaken: each player can Kontra the game independently
    if (state.contract === 'Trischaken' && item.target === 'game') {
      const alreadyKontra = [item.kontraBy, item.rekontraBy, item.subkontraBy].includes(pi);
      if (!alreadyKontra && item.multiplier < 8) {
        if (!moves.some(m => m.type === 'KONTRA' && (m as {target:string}).target === 'game')) {
          moves.push({ type: 'KONTRA', target: 'game', level: levelName });
        }
      }
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

function _cardRank(c: Card): number {
  if (isTarock(c)) return TAROCK_RANK_ORDER[c.rank] ?? 0;
  const order = (BLACK_SUITS as readonly string[]).includes(c.suit) ? BLACK_RANK_ORDER : RED_RANK_ORDER;
  return order[c.rank] ?? 0;
}

function _currentTrickWinnerCard(trick: TarockPlay[], ledSuit: string): Card | null {
  if (trick.length === 0) return null;
  const tarocks = trick.filter(p => isTarock(p.card));
  if (tarocks.length > 0) {
    return tarocks.reduce((best, p) =>
      (TAROCK_RANK_ORDER[p.card.rank] ?? 0) > (TAROCK_RANK_ORDER[best.card.rank] ?? 0) ? p : best
    ).card;
  }
  const ledCards = trick.filter(p => p.card.suit === ledSuit);
  if (ledCards.length === 0) return null;
  const rankOrder = (BLACK_SUITS as readonly string[]).includes(ledSuit) ? BLACK_RANK_ORDER : RED_RANK_ORDER;
  return ledCards.reduce((best, p) =>
    (rankOrder[p.card.rank] ?? 0) > (rankOrder[best.card.rank] ?? 0) ? p : best
  ).card;
}

function _headsCurrentTrick(card: Card, winningCard: Card, ledSuit: string): boolean {
  const winnerIsTarock = isTarock(winningCard);
  if (winnerIsTarock) {
    return isTarock(card) && (TAROCK_RANK_ORDER[card.rank] ?? 0) > (TAROCK_RANK_ORDER[winningCard.rank] ?? 0);
  }
  if (isTarock(card)) return true;
  if (card.suit !== ledSuit) return false;
  const rankOrder = (BLACK_SUITS as readonly string[]).includes(ledSuit) ? BLACK_RANK_ORDER : RED_RANK_ORDER;
  return (rankOrder[card.rank] ?? 0) > (rankOrder[winningCard.rank] ?? 0);
}

function _legalCardPlays(state: State): Card[] {
  if (state.phase !== 'playing') return [];
  const pi   = getCurrentPlayer(state);
  const hand = state.hands[pi] ?? [];

  // Trischaken: Pagat may not be played at all until it is the player's last Tarock
  const effective = (state.contract === 'Trischaken' && hand.filter(isTarock).length > 1)
    ? hand.filter(c => !(isTarock(c) && c.rank === 'I'))
    : hand;

  if (state.currentTrick.length === 0) return effective;

  const ledSuit   = state.currentTrick[0]!.card.suit;
  const followers = effective.filter(c => c.suit === ledSuit);

  let candidates: Card[];
  if (followers.length > 0) {
    candidates = followers;
  } else {
    const tarocks = effective.filter(isTarock);
    candidates = tarocks.length > 0 ? tarocks : effective;
  }

  // Stichzwang (St. Louis Trischaken only): must overtake the current winning card if able
  if (state.contract === 'Trischaken' && state.scoring === 'StLouis') {
    const winningCard = _currentTrickWinnerCard(state.currentTrick, ledSuit);
    if (winningCard) {
      const heading = candidates.filter(c => _headsCurrentTrick(c, winningCard, ledSuit));
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

  if (prevBid !== null && BID_RANK[level] === BID_RANK[prevBid] && s.isInPair) {
    // Hold: bidder takes the current bid at the same level
    s.currentHolder = pi;
    s.bidder        = prevHolder!;
    s.isInPair      = true;
    // biddingContested stays true
  } else {
    // Raise (or initial bid)
    s.currentBid    = level;
    s.currentHolder = pi;
    s.biddingContested = s.biddingContested || pi !== s.activePlayers[0]!;

    if (prevHolder !== null && level !== 'Solo' && level !== 'SoloValat') {
      // Step bid — previous holder must immediately hold or pass
      s.bidder   = prevHolder;
      s.isInPair = true;
    } else {
      // Jump bid (Solo/SoloValat) or first bid — previous holder cannot respond;
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

  if (EXCHANGE_CONTRACTS.has(contract)) {
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
    // Solo, SoloValat, or Trischaken — skip to declaring
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

function _kontraLevelName(item: KontraItem): 'Kontra' | 'Rekontra' | 'Subkontra' {
  return item.multiplier === 1 ? 'Kontra' : item.multiplier === 2 ? 'Rekontra' : 'Subkontra';
}

function _applyKontraToItem(
  item: KontraItem, pi: number, target: string,
  events: BareEvent[], simulate: boolean
): void {
  const levelName = _kontraLevelName(item);
  item.multiplier = Math.min(item.multiplier * 2, 8) as 1 | 2 | 4 | 8;
  if      (!item.kontraBy)    item.kontraBy    = pi;
  else if (!item.rekontraBy)  item.rekontraBy  = pi;
  else                        item.subkontraBy = pi;
  if (!simulate) events.push({ type: 'ANNOUNCEMENT_MADE', player: pi, announcement: `${levelName}:${target}` });
}

function _handleDeclaringPass(s: State, pi: number, events: BareEvent[], simulate: boolean): void {
  if (!simulate) events.push({ type: 'ANNOUNCEMENT_MADE', player: pi, announcement: 'pass' });
  const anyDeclared = s.announcements.length > 0 || s.kontraItems.some(k => k.kontraBy !== null);
  const passThreshold = anyDeclared ? s.activePlayers.length - 1 : s.activePlayers.length;
  s.consecutivePasses++;
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
    s.consecutivePasses = 0;
    const target = move.target;
    const item   = s.kontraItems.find(k => k.target === target);
    if (!item) throw new Error(`Kontra target '${target}' not found`);
    _applyKontraToItem(item, pi, target, events, simulate);
    s.declaringBidder = _nextActive(s.activePlayers, pi);
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
  s.phase       = 'playing';
  s.leader      = s.activePlayers[0]!;
  s.currentTrick = [];
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
    const ledSuit = s.currentTrick[0]!.card.suit;
    const winner  = trickWinner(s.currentTrick, ledSuit);

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
  const deltas  = _computeDeltas(summary, s);

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
  const { activePlayers, trickLog, capturedCards, contract, declarer, announcements, kontraItems, scoring } = s;

  const cardPoints: Record<number, number> = {};
  const tricksWon:  Record<number, number> = {};
  for (const pi of activePlayers) {
    cardPoints[pi] = countCardPoints(capturedCards[pi] ?? []);
    tricksWon[pi]  = 0;
  }
  for (const { winner } of trickLog) tricksWon[winner] = (tricksWon[winner] ?? 0) + 1;

  const totalTricks = trickLog.length;
  const valatWinner = activePlayers.find(p => tricksWon[p] === totalTricks) ?? null;

  let mondFangWinner: number | null = null;
  for (const { plays, winner } of trickLog) {
    const hasSküs = plays.some(p => p.card.suit === 'T' && p.card.rank === '★');
    const hasMond  = plays.some(p => p.card.suit === 'T' && p.card.rank === 'XXI');
    if (hasSküs && hasMond) { mondFangWinner = winner; break; }
  }

  // Trull winner: whoever captured all 3 Trull cards (Sküs ★, Mond XXI, Pagat I)
  let trullWinner: number | null = null;
  for (const pi of activePlayers) {
    const cap = capturedCards[pi] ?? [];
    if (['★', 'XXI', 'I'].every(r => cap.some(c => isTarock(c) && c.rank === r))) {
      trullWinner = pi; break;
    }
  }

  // Kings winner: whoever captured all 4 Kings
  let kingsWinner: number | null = null;
  for (const pi of activePlayers) {
    const cap = capturedCards[pi] ?? [];
    if (['♣', '♠', '♥', '♦'].every(s => cap.some(c => c.rank === 'K' && c.suit === s))) {
      kingsWinner = pi; break;
    }
  }

  return {
    contract:          contract!,
    declarer,
    activePlayers,
    cardPoints,
    tricksWon,
    valatWinner,
    pagatUltimoWinner: birdWinnerAtPos(trickLog, 1, 'I'),
    uhuWinner:         birdWinnerAtPos(trickLog, 2, 'II'),
    kakaduWinner:      birdWinnerAtPos(trickLog, 3, 'III'),
    mondFangWinner,
    trullWinner,
    kingsWinner,
    announcements,
    kontraItems,
    scoring,
  };
}

function _computeDeltas(summary: HandSummary, s: State): Record<number, number> {
  const deltas: Record<number, number> = {};
  for (const pi of summary.activePlayers) deltas[pi] = 0;

  if (summary.contract === 'Trischaken') {
    _scoreTrischaken(summary, deltas, s);
  } else {
    _scoreDeclaredGame(summary, deltas, s);
  }

  return deltas;
}

function _gameKontraMultiplier(kontraItems: KontraItem[]): number {
  return kontraItems.find(k => k.target === 'game')?.multiplier ?? 1;
}

function _bonusKontraMultiplier(kontraItems: KontraItem[], name: string): number {
  return kontraItems.find(k => k.target === name)?.multiplier ?? 1;
}

function _scoreTrischaken(summary: HandSummary, deltas: Record<number, number>, s: State): void {
  const { activePlayers, cardPoints, scoring } = summary;
  const gameMult = _gameKontraMultiplier(summary.kontraItems);
  const baseValue = scoring === 'StLouis' ? 1 : 3;

  // Player with zero points receives baseValue × gameMult from each other
  const zeroPts = activePlayers.filter(p => cardPoints[p] === 0);
  const maxPts  = Math.max(...activePlayers.map(p => cardPoints[p]!));
  const winners = activePlayers.filter(p => cardPoints[p] === maxPts);

  const payment = baseValue * gameMult;

  if (zeroPts.length > 0) {
    for (const zp of zeroPts) {
      for (const other of activePlayers) {
        if (other !== zp) {
          deltas[zp]!    += payment;
          deltas[other]! -= payment;
        }
      }
    }
  } else {
    for (const w of winners) {
      for (const other of activePlayers) {
        if (other !== w) {
          deltas[w]!     -= payment;
          deltas[other]! += payment;
        }
      }
    }
  }
}

function _scoreDeclaredGame(summary: HandSummary, deltas: Record<number, number>, s: State): void {
  const { contract, declarer, activePlayers, cardPoints, scoring, valatWinner } = summary;
  if (declarer === null) return;

  const defenders = activePlayers.filter(p => p !== declarer);
  const isSolo    = contract === 'Solo' || contract === 'SoloValat';
  const gameValues = scoring === 'StLouis' ? STLOUIS_GAME_VALUES : MAYR_GAME_VALUES;
  const gameMult  = _gameKontraMultiplier(summary.kontraItems);

  let gameScore = 0;
  const declarerPts = cardPoints[declarer] ?? 0;

  if (scoring === 'StLouis' && valatWinner !== null) {
    // Slam: game value ×4
    const base = gameValues[contract];
    gameScore = (valatWinner === declarer ? 1 : -1) * base * 4 * gameMult;
  } else if (scoring === 'Mayr' && valatWinner !== null) {
    // Valat replaces game value with 24
    const kontra = gameMult;
    gameScore = (valatWinner === declarer ? 1 : -1) * 24 * kontra;
  } else if (contract === 'SoloValat') {
    // Solo Valat: win iff you won all tricks
    const won = valatWinner === declarer;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
  } else {
    const won = declarerPts >= DECLARER_WINS_AT;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
  }

  // Each-against-each: declarer receives/pays per defender
  deltas[declarer]! += gameScore * defenders.length;
  for (const d of defenders) deltas[d]! -= gameScore;

  // Bonuses — same each-against-each settlement
  const _applyBonus = (winner: number | null, name: string, baseVal: number) => {
    const ann      = summary.announcements.find(a => a.name === name) ?? null;
    const announced = ann !== null;
    if (winner === null && !announced) return;

    const kontra   = _bonusKontraMultiplier(summary.kontraItems, name);
    const soloMult = isSolo ? 2 : 1;
    const annMult  = announced ? 2 : 1;
    const value    = baseVal * soloMult * annMult * kontra;

    // If nobody won but it was announced → announcer's team pays (failure penalty).
    // Failure is also triggered when someone ELSE won, but that's the normal winner path
    // with doubled stakes (the announcement doubled the value for whoever wins).
    const effectiveWinner: number = winner !== null
      ? winner
      : ann!.player === declarer ? defenders[0]! : declarer;

    const sign = effectiveWinner === declarer ? 1 : -1;
    deltas[declarer]! += sign * value * defenders.length;
    for (const d of defenders) deltas[d]! -= sign * value;
  };

  const isValat = valatWinner !== null;

  if (!isValat) {
    if (scoring === 'Mayr') {
      _applyBonus(summary.pagatUltimoWinner, 'Pagat',    4);
      _applyBonus(summary.uhuWinner,         'Uhu',      6);
      _applyBonus(summary.kakaduWinner,      'Kakadu',   8);
      _applyBonus(summary.mondFangWinner,    'MondFang', 1);
      _applyBonus(summary.trullWinner,       'Trull',    1);
      _applyBonus(summary.kingsWinner,       'Kings',    1);
    } else {
      // StLouis — Trull and Kings do not score
      _applyBonus(summary.pagatUltimoWinner, 'Pagat',    1);
      _applyBonus(summary.uhuWinner,         'Uhu',      2);
      _applyBonus(summary.kakaduWinner,      'Kakadu',   3);
      _applyBonus(summary.mondFangWinner,    'MondFang', 1);
    }
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
  const { contract, declarer, activePlayers, cardPoints, scoring, valatWinner, kontraItems, announcements } = summary;

  // Card points — informational (delta = 0, displays as "—" in the modal)
  items.push({ label: `Card pts: ${cardPoints[pi] ?? 0}`, delta: 0 });

  if (contract === 'Trischaken') {
    const gameMult  = _gameKontraMultiplier(kontraItems);
    const baseValue = scoring === 'StLouis' ? 1 : 3;
    const payment   = baseValue * gameMult;

    const zeroPts = activePlayers.filter(p => cardPoints[p] === 0);
    const maxPts  = Math.max(...activePlayers.map(p => cardPoints[p]!));
    const winners = activePlayers.filter(p => cardPoints[p] === maxPts);

    let label: string;
    let delta: number;

    if (zeroPts.includes(pi)) {
      // Each non-zero player pays this player once
      const nonZeroCount = activePlayers.length - zeroPts.length;
      delta = nonZeroCount * payment;
      label = '0 pts ✓';
    } else if (zeroPts.length > 0) {
      // Pay each zero-pt player once
      delta = -(zeroPts.length * payment);
      label = 'Trischaken (paid)';
    } else if (winners.includes(pi)) {
      // Pay each non-winner once
      const nonWinnerCount = activePlayers.length - winners.length;
      delta = -(nonWinnerCount * payment);
      label = 'Most pts ✗';
    } else {
      // Receive from each winner once
      delta = winners.length * payment;
      label = 'Trischaken ✓';
    }

    if (gameMult > 1) label += ` ×${gameMult}`;
    items.push({ label, delta });
    return items;
  }

  // Declared game
  if (declarer === null) return items;
  const defenders  = activePlayers.filter(p => p !== declarer);
  const isSolo     = contract === 'Solo' || contract === 'SoloValat';
  const gameValues = scoring === 'StLouis' ? STLOUIS_GAME_VALUES : MAYR_GAME_VALUES;
  const gameMult   = _gameKontraMultiplier(kontraItems);
  const declarerPts = cardPoints[declarer] ?? 0;
  const isValat    = valatWinner !== null;
  const contractDisplay = contract === 'SoloValat' ? 'Solo Valat' : contract;

  // Game score: amount per defender, signed by outcome
  let gameScore = 0;
  let gameLabel = '';

  if (isValat && scoring === 'StLouis') {
    const base = gameValues[contract];
    gameScore = (valatWinner === declarer ? 1 : -1) * base * 4 * gameMult;
    gameLabel = valatWinner === declarer ? 'Slam ✓' : 'Slam ✗';
  } else if (isValat && scoring === 'Mayr') {
    gameScore = (valatWinner === declarer ? 1 : -1) * 24 * gameMult;
    gameLabel = valatWinner === declarer ? 'Valat ✓' : 'Valat ✗';
  } else if (contract === 'SoloValat') {
    const won = valatWinner === declarer;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
    gameLabel = won ? 'Solo Valat ✓' : 'Solo Valat ✗';
  } else {
    const won = declarerPts >= DECLARER_WINS_AT;
    gameScore = (won ? 1 : -1) * gameValues[contract] * gameMult;
    const ptsNote = pi === declarer ? ` (${declarerPts} pts)` : ` (${declarerPts} pts dec.)`;
    gameLabel = `${contractDisplay} ${won ? '✓' : '✗'}${ptsNote}`;
  }

  if (gameMult > 1) gameLabel += ` ×${gameMult}`;

  const gameDelta = pi === declarer
    ? gameScore * defenders.length
    : -gameScore;
  items.push({ label: gameLabel, delta: gameDelta });

  // Bonuses (skipped entirely when Valat replaces everything)
  if (!isValat) {
    const addBonus = (winner: number | null, name: string, baseVal: number) => {
      const ann      = announcements.find(a => a.name === name) ?? null;
      const announced = ann !== null;
      if (winner === null && !announced) return;

      const kontra   = _bonusKontraMultiplier(kontraItems, name);
      const soloMult = isSolo ? 2 : 1;
      const annMult  = announced ? 2 : 1;
      const value    = baseVal * soloMult * annMult * kontra;

      const effectiveWinner = winner !== null
        ? winner
        : ann!.player === declarer ? defenders[0]! : declarer;
      const sign = effectiveWinner === declarer ? 1 : -1;

      const deltaPi = pi === declarer
        ? sign * value * defenders.length
        : -(sign * value);

      if (deltaPi === 0) return;

      let label = name;
      label += winner !== null ? ' ✓' : ' ✗';
      const mods: string[] = [];
      if (announced) mods.push('ann.');
      if (soloMult > 1) mods.push('solo ×2');
      if (kontra > 1) mods.push(`kontra ×${kontra}`);
      if (mods.length > 0) label += ` (${mods.join(', ')})`;

      items.push({ label, delta: deltaPi });
    };

    if (scoring === 'Mayr') {
      addBonus(summary.pagatUltimoWinner, 'Pagat',    4);
      addBonus(summary.uhuWinner,         'Uhu',      6);
      addBonus(summary.kakaduWinner,      'Kakadu',   8);
      addBonus(summary.mondFangWinner,    'MondFang', 1);
      addBonus(summary.trullWinner,       'Trull',    1);
      addBonus(summary.kingsWinner,       'Kings',    1);
    } else {
      addBonus(summary.pagatUltimoWinner, 'Pagat',    1);
      addBonus(summary.uhuWinner,         'Uhu',      2);
      addBonus(summary.kakaduWinner,      'Kakadu',   3);
      addBonus(summary.mondFangWinner,    'MondFang', 1);
    }
  }

  return items;
}

export function computeScoreBreakdown(state: State): PlayerScoreBreakdown[] | null {
  if (!isHandOver(state)) return null;
  const summary = _computeHandSummary(state);
  const deltas  = _computeDeltas(summary, state);

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
    const ledOrder = (BLACK_SUITS as readonly string[]).includes(ledSuit)
      ? BLACK_RANK_ORDER : RED_RANK_ORDER;
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
    const defCapKeys     = new Set((s.capturedCards[firstDefender] ?? []).map(c => c.suit + c.rank));
    // The rejected group is the one whose cards all appear in firstDefender's captured pile
    const rejectedIdx = s.talonGroups.findIndex(g => g.every(c => defCapKeys.has(c.suit + c.rank)));
    if (rejectedIdx !== -1) {
      for (const c of s.talonGroups[1 - rejectedIdx]!) chosenTalonKeys.add(c.suit + c.rank);
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
    const key   = card.suit + card.rank;

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
  if (state.contract === 'Trischaken') {
    // Fewer personal pts = better (zero-pt player wins)
    const myPts = countCardPoints(state.capturedCards[playerIndex] ?? []);
    cardBonus = (35 - myPts) / 70 * 0.2;
  } else if (state.declarer !== null) {
    // Both teams keyed off the declarer's pts: declarer wants more, defenders want fewer
    const declarerPts = countCardPoints(state.capturedCards[state.declarer] ?? []);
    const margin = (declarerPts - 35) / 35;
    cardBonus = (playerIndex === state.declarer ? margin : -margin) * 0.2;
  }

  const deltas = _computeDeltas(_computeHandSummary(state), state);
  const raw    = (deltas[playerIndex] ?? 0) + cardBonus;
  return (Math.tanh(raw / REWARD_SCALE) + 1) / 2;
}

// ── Rollout policy ─────────────────────────────────────────────────────────────
//
// Used by ISMCTS as the simulation policy after tree expansion.
// Non-play phases fall back to random; during trick play:
//   - Leading: random (complex strategic decision left to the tree)
//   - Following: play the weakest legal card that beats the current winner;
//     if none exists, discard the weakest legal card.
//
// This ensures e.g. ★ is always played in rollouts when XXI is led, making
// MondFang risk accurately priced instead of diluted 1/N across legal tarocks.

export function rolloutPolicy(state: State, legal: Move[]): Move {
  if (state.phase !== 'playing') return legal[Math.floor(Math.random() * legal.length)]!;

  const plays = legal.filter((m): m is { type: 'PLAY_CARD'; card: Card } => m.type === 'PLAY_CARD');
  if (plays.length === 0) return legal[Math.floor(Math.random() * legal.length)]!;

  // Leading: random — strategic, leave it to the tree
  if (state.currentTrick.length === 0) return plays[Math.floor(Math.random() * plays.length)]!;

  const ledSuit    = state.currentTrick[0]!.card.suit;
  const winnerCard = _currentTrickWinnerCard(state.currentTrick, ledSuit);

  if (winnerCard) {
    const winning = plays.filter(m => _headsCurrentTrick(m.card, winnerCard, ledSuit));
    if (winning.length > 0) {
      // Weakest card that wins — conserve high tarocks for later
      return winning.reduce((a, b) => _cardRank(a.card) < _cardRank(b.card) ? a : b);
    }
  }

  // Can't win: discard weakest card to minimise card-point giveaway
  return plays.reduce((a, b) => _cardRank(a.card) < _cardRank(b.card) ? a : b);
}

// ── Exports ────────────────────────────────────────────────────────────────────

export {
  // Constants
  TAROCK_RANKS, BLACK_RANKS, RED_RANKS, BLACK_SUITS, RED_SUITS,
  HAND_SIZE, TALON_SIZE, TRICKS_PER_HAND, DECLARER_WINS_AT,
  // Card utilities (re-exported from lib/tarock for adapter convenience)
  cardPointValue, countCardPoints, isTarock, cardEquals, createDeck, shuffle,
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
