#!/usr/bin/env node

import type { Card } from './types';
import type { State } from './engines/slobberhannes';
import * as engine from './engines/slobberhannes';
import * as display from './display';
import * as greedy from './ai/greedy';
import * as ismcts from './ai/ismcts';
import * as straw from './engines/strohmandeln';

const NAMES_BY_COUNT: Record<number, string[]> = {
  3: ['You', 'West', 'East'],
  4: ['You', 'West', 'North', 'East'],
  5: ['You', 'South West', 'North West', 'North East', 'South East'],
  6: ['You', 'South West', 'North West', 'North', 'North East', 'South East'],
};

type AiFn = (state: State, pi: number) => Card;

// Returns a move function (state, pi) => card, or null for the human seat.
// Player 1 (West / South West) uses ISMCTS; all others use greedy.
function aiFor(playerIndex: number): AiFn | null {
  if (playerIndex === 0) return null;
  if (playerIndex === 1) return (state, pi) => ismcts.chooseMove(engine, state, pi);
  return (state, pi) => {
    const ledSuit = state.currentTrick.length > 0 ? state.currentTrick[0]!.card.suit : null;
    return greedy.chooseCard(state.hands[pi] ?? [], ledSuit);
  };
}

// ── Slobberhannes hand loop ────────────────────────────────────────────────────

async function playHand(initialState: State, playerNames: string[]): Promise<State> {
  let state = initialState;

  while (!engine.isHandOver(state)) {
    const pi = engine.getCurrentPlayer(state);

    if (state.currentTrick.length === 0) {
      display.printTrickHeader(state.trickNum, state.tricksPerHand, playerNames[state.leader] ?? `Player ${state.leader}`);
    }

    let card: Card;
    const ai = aiFor(pi);

    if (!ai) {
      display.printTable(state.currentTrick, playerNames);
      display.printHand(state.hands[0] ?? [], engine.getLegalMoves(state));
      card = await display.askCard(state);
    } else {
      card = ai(state, pi);
      display.printAIPlay(playerNames[pi] ?? `Player ${pi}`, card);
    }

    const prevTrickCount = state.trickLog.length;
    ({ state } = engine.applyMove(state, card));

    if (state.trickLog.length > prevTrickCount) {
      display.printTrickResult(state.trickLog.at(-1)!, playerNames);
    }
  }

  return state;
}

// ── Slobberhannes session loop ────────────────────────────────────────────────

async function runSlobberhannes(): Promise<void> {
  display.printWelcome();

  const playerCount  = await display.askPlayerCount(NAMES_BY_COUNT);
  const playerNames  = NAMES_BY_COUNT[playerCount] ?? [];

  let scores  = Array<number>(playerCount).fill(0);
  let handNum = Math.floor(Math.random() * playerCount);

  while (true) {
    display.printScoreboard(playerNames, scores, engine.DEFAULT_LOSE_AT);
    await display.askContinue();

    let state = engine.dealState({ scores, playerCount, firstLeader: handNum % playerCount });
    state = await playHand(state, playerNames);

    display.printHandSummary(playerNames, state);
    scores = engine.getGameResult(state).scores;

    if (engine.isGameOver(state)) {
      display.printGameOver(playerNames, state);
      break;
    }

    handNum++;
  }
}

// ── Strohmandeln ──────────────────────────────────────────────────────────────

const STRAW_NAMES = ['You', 'Opponent'];

const A = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  yellow: '\x1b[33m',
};

function hr(len = 50): string { return '─'.repeat(len); }

function printStrawWelcome(): void {
  console.log(`\n${A.bold}╔════════════════════════════════════╗`);
  console.log(      `║    S T R O H M A N D E L N        ║`);
  console.log(      `╚════════════════════════════════════╝${A.reset}`);
  console.log('\n2-player Austrian Tarock with a 54-card deck.');
  console.log('Each player gets 15 hand cards + 3 strawman piles of 4 (face-down except the top).');
  console.log('Bid to become declarer. Score 36+ card points to win the hand.');
  console.log('Scoring: Beck system (win=+2, draw=0, loss=−3; doubled after a draw).\n');
}

function printStrawScoreboard(scores: number[], multiplier: number, dealerIndex: number): void {
  console.log(`\n${A.bold}Scores${A.reset}  You: ${scores[0] ?? 0}   Opponent: ${scores[1] ?? 0}`);
  console.log(`Dealer: ${STRAW_NAMES[dealerIndex]}${multiplier > 1 ? `   ${A.yellow}Hand multiplier: ×${multiplier}${A.reset}` : ''}`);
}

/** Show pile tops and full hand during bidding (no trick in progress yet). */
function printStrawBidView(state: straw.State, names: string[]): void {
  const oppPiles = (state.strawmen[1] ?? []).map(_pileCell).join('   ');
  console.log(`  ${(names[1] ?? 'Opp').padEnd(8)} piles:  ${oppPiles}`);

  const myPiles = (state.strawmen[0] ?? []).map(_pileCell).join('   ');
  console.log(`  ${(names[0] ?? 'You').padEnd(8)} piles:  ${myPiles}`);

  const hand = [...(state.hands[0] ?? [])].sort(strawCardSort);
  console.log(`  Your hand:       ${hand.map(c => display.cardStr(c)).join('  ')}`);
}

async function askStrawBid(state: straw.State, names: string[], isForehand: boolean): Promise<'play' | 'pass'> {
  printStrawBidView(state, names);
  const role = isForehand ? 'forehand' : 'dealer';
  console.log(`\n  You are ${A.bold}${role}${A.reset}. Do you want to be declarer?`);
  console.log('  [1] Play (become declarer)');
  console.log('  [2] Pass');
  while (true) {
    const raw = await display.ask('  Your bid [1/2]: ');
    if (raw.trim() === '1') return 'play';
    if (raw.trim() === '2') return 'pass';
    console.log('  Enter 1 or 2.');
  }
}

// Sort keys derived from the engine's exported rank arrays (computed once).
const _tOrd = new Map<string, number>([...straw.TAROCK_RANKS].reverse().map((r, i) => [r, i]));
const _bOrd = new Map<string, number>([...straw.BLACK_RANKS].reverse().map((r, i) => [r, i]));
const _rOrd = new Map<string, number>([...straw.RED_RANKS].reverse().map((r, i) => [r, i]));
const _sOrd = new Map<string, number>([['T', 0], ['♣', 1], ['♠', 2], ['♥', 3], ['♦', 4]]);

function strawCardSort(a: Card, b: Card): number {
  const sd = (_sOrd.get(a.suit) ?? 5) - (_sOrd.get(b.suit) ?? 5);
  if (sd !== 0) return sd;
  if (a.suit === 'T') return (_tOrd.get(b.rank) ?? 0) - (_tOrd.get(a.rank) ?? 0);
  const ord = (a.suit === '♣' || a.suit === '♠') ? _bOrd : _rOrd;
  return (ord.get(b.rank) ?? 0) - (ord.get(a.rank) ?? 0);
}

/** One pile cell: top card + remaining count if > 1, or em-dash if empty. */
function _pileCell(p: straw.StrawmanPile, i: number): string {
  if (p.cards.length === 0) return `P${i + 1}: ${A.dim}—${A.reset}`;
  const top   = p.cards[p.cards.length - 1]!;
  const count = p.cards.length > 1 ? `${A.dim}×${p.cards.length}${A.reset}` : '';
  return `P${i + 1}:${display.cardStr(top)}${count}`;
}

/**
 * Full board display for the human's turn.
 * Shows opponent pile tops, the current trick, the player's own pile tops,
 * and the player's full hand (legal plays lit, illegal plays dimmed).
 */
function printStrawBoard(state: straw.State, names: string[]): void {
  const legalKeys = new Set(
    straw.getLegalMoves(state)
      .filter((m): m is { type: 'PLAY_CARD'; card: Card } => m.type === 'PLAY_CARD')
      .map(m => `${m.card.rank}${m.card.suit}`)
  );

  // Opponent pile tops
  const oppPiles = (state.strawmen[1] ?? []).map(_pileCell).join('   ');
  console.log(`  ${(names[1] ?? 'Opp').padEnd(8)} piles:  ${oppPiles}`);

  // Current trick (or lead prompt)
  if (state.currentTrick.length > 0) {
    const entries = state.currentTrick.map(p =>
      `${names[p.playerIndex] ?? `P${p.playerIndex}`}: ${display.cardStr(p.card)}`);
    console.log(`  Table:           ${entries.join('   ')}`);
  } else {
    console.log(`  Table:           ${A.dim}(you lead)${A.reset}`);
  }

  // Player's own pile tops
  const myPiles = (state.strawmen[0] ?? []).map(_pileCell).join('   ');
  console.log(`  ${(names[0] ?? 'You').padEnd(8)} piles:  ${myPiles}`);

  // Player's full hand: legal = normal colour, illegal = dimmed
  const hand = [...(state.hands[0] ?? [])].sort(strawCardSort);
  const handStr = hand.map(c =>
    legalKeys.has(`${c.rank}${c.suit}`)
      ? display.cardStr(c)
      : `${A.dim}${c.rank}${c.suit}${A.reset}`
  ).join('  ');
  console.log(`  Your hand:       ${handStr}`);
}

/** Prompt the human to pick a legal move (announcement or card play). */
async function askStrawMove(state: straw.State): Promise<Move> {
  if (state.pendingAnnouncement !== null) {
    console.log(`  ${A.yellow}Must play a ${state.pendingAnnouncement} card.${A.reset}`);
  }

  const legal = straw.getLegalMoves(state);
  const annMoves  = legal.filter((m): m is { type: 'MAKE_ANNOUNCEMENT'; announcement: string } =>
    m.type === 'MAKE_ANNOUNCEMENT');
  const cardMoves = legal.filter((m): m is { type: 'PLAY_CARD'; card: Card } =>
    m.type === 'PLAY_CARD').sort((a, b) => strawCardSort(a.card, b.card));
  const ordered: Move[] = [...annMoves, ...cardMoves];

  const parts = ordered.map((m, i) => {
    if (m.type === 'MAKE_ANNOUNCEMENT') return `[${i + 1}] ${A.yellow}Announce ${m.announcement}${A.reset}`;
    if (m.type === 'PLAY_CARD')         return `[${i + 1}] ${display.cardStr(m.card)}`;
    return `[${i + 1}] ${m.type}`;
  });
  console.log(`  Play:            ${parts.join('   ')}`);

  while (true) {
    const raw = await display.ask(`  Your move [1-${ordered.length}]: `);
    const idx = parseInt(raw, 10) - 1;
    if (idx >= 0 && idx < ordered.length) return ordered[idx]!;
    console.log(`  Enter a number 1–${ordered.length}.`);
  }
}

import type { BareEvent, Move } from './types';

/**
 * Print any CARD_REVEALED and CARDS_MOVED pile-events from a batch of events.
 * Called after initial uncovering and after each card-play move.
 */
function printPileEvents(events: BareEvent[], names: string[]): void {
  for (const ev of events) {
    if (ev.type === 'CARD_REVEALED') {
      const pName = names[ev.player] ?? `P${ev.player}`;
      console.log(`  ${A.yellow}${pName} P${ev.pile + 1}: ${display.cardStr(ev.card)} revealed → hand${A.reset}`);
    } else if (ev.type === 'CARDS_MOVED') {
      for (const t of ev.transfers) {
        const from = t.from;
        if (from.zone !== 'strawman') continue;
        const pName = names[from.player] ?? `P${from.player}`;
        if (ev.reason === 'bottom-to-hand') {
          console.log(`  ${pName} P${from.pile + 1}: bottom card → hand (face-down)`);
        }
        // tarock-or-king CARDS_MOVED is already reported by the preceding CARD_REVEALED
      }
    }
  }
}

function strawAiPickMove(state: straw.State, pi: number): Move {
  return ismcts.chooseMove(straw, state, pi);
}

async function playStrohmandelnHand(
  initialState: straw.State,
  names: string[],
): Promise<straw.State> {
  // ── Initial strawman uncovering (before bidding) ──
  const { state: uncoveredState, events: uncoverEvents } = straw.uncoverStrawmenInitial(initialState);
  let state = uncoveredState;
  console.log('\n  ── Strawman uncovering ──');
  printPileEvents(uncoverEvents, names);

  // ── Bidding ──
  while (state.phase === 'bidding') {
    const pi = straw.getCurrentPlayer(state);
    const isForehand = pi !== state.dealerIndex;

    if (pi === 0) {
      const bid = await askStrawBid(state, names, isForehand);
      ({ state } = straw.applyMove(state, bid === 'play'
        ? { type: 'MAKE_BID', bid: 'play' }
        : { type: 'PASS_BID' }));
    } else {
      const move  = strawAiPickMove(state, pi);
      const role  = isForehand ? 'forehand' : 'dealer';
      const label = move.type === 'MAKE_BID' ? `${A.bold}Play${A.reset}` : `${A.dim}Pass${A.reset}`;
      console.log(`\n  ${names[pi]} (${role}) bids: ${label}`);
      ({ state } = straw.applyMove(state, move));
    }
  }

  if (state.declarer === null) {
    console.log(`\n  Both passed — no declarer. Playing for no stakes; eldest leads.`);
  } else {
    const declarerName = names[state.declarer] ?? `Player ${state.declarer}`;
    console.log(`\n  ${A.bold}${declarerName}${A.reset} is the declarer. Need 36+ card points to win.`);
  }

  // ── Playing ──
  while (!straw.isHandOver(state)) {
    const pi = straw.getCurrentPlayer(state);

    if (state.currentTrick.length === 0 && state.pendingAnnouncement === null) {
      console.log(`\n${hr()}`);
      console.log(`  Trick ${state.trickNum + 1} of ${straw.TRICKS_PER_HAND}   Leader: ${A.bold}${names[state.leader]}${A.reset}`);
      console.log(hr());
    }

    let playEvents: BareEvent[] = [];

    if (pi === 0) {
      printStrawBoard(state, names);
      const move = await askStrawMove(state);
      if (move.type === 'MAKE_ANNOUNCEMENT') {
        console.log(`  ${A.yellow}You announce: ${move.announcement}!${A.reset}`);
      }
      ({ state, events: playEvents } = straw.applyMove(state, move));
    } else {
      const move = strawAiPickMove(state, pi);
      if (move.type === 'PLAY_CARD') {
        console.log(`  ${names[pi]} plays: ${display.cardStr(move.card)}`);
      } else if (move.type === 'MAKE_ANNOUNCEMENT') {
        console.log(`  ${names[pi]} announces: ${A.bold}${move.announcement}${A.reset}`);
      }
      ({ state, events: playEvents } = straw.applyMove(state, move));
    }

    printPileEvents(playEvents, names);

    // Show trick result when the trick is just completed
    if (state.currentTrick.length === 0 && state.trickLog.length > 0) {
      const last = state.trickLog.at(-1)!;
      console.log(`\n  ${A.bold}${names[last.winner]}${A.reset} wins the trick.`);
    }
  }

  // ── Hand summary ──
  const result   = straw.getHandResult(state);
  const summary  = straw.computeHandSummary(state);
  console.log(`\n${A.bold}Hand result${A.reset}`);

  if (result && summary && state.declarer !== null) {
    const sys  = straw.SCORING_SYSTEMS[state.scoring];
    const { basicDelta, bonusDelta } = sys.scoreHand(summary);
    const total = basicDelta * state.handMultiplier + bonusDelta;
    const d   = state.declarer;
    const def = 1 - d;

    console.log(`  ${(names[d] ?? '?').padEnd(8)} (declarer): ${result.declarerPoints} card pts`);
    console.log(`  ${(names[def] ?? '?').padEnd(8)} (defender): ${result.defenderPoints} card pts`);

    if (state.handMultiplier > 1) {
      console.log(`  Basic delta ×${state.handMultiplier} (carry-over multiplier)`);
    }
    const sign = (n: number) => n > 0 ? `+${n}` : `${n}`;
    console.log(`  Game points:  ${names[d]}: ${A.yellow}${sign(total)}${A.reset}   ${names[def]}: ${A.yellow}${sign(-total)}${A.reset}`);
    if (basicDelta === 0) console.log(`  ${A.yellow}Draw — next hand is doubled.${A.reset}`);
  } else {
    console.log('  No scoring — neither player bid.');
  }

  console.log(`\n  Running totals:  You: ${state.scores[0]}   Opponent: ${state.scores[1]}`);
  return state;
}

async function runStrohmandeln(): Promise<void> {
  printStrawWelcome();

  let scores: number[]  = [0, 0];
  let dealerIndex       = Math.random() < 0.5 ? 0 : 1;
  let handMultiplier    = 1;

  while (true) {
    printStrawScoreboard(scores, handMultiplier, dealerIndex);
    await display.askContinue();

    const initialState = straw.dealState({
      scores,
      dealerIndex,
      scoring:       'Beck',
      handMultiplier,
    });

    const finalState = await playStrohmandelnHand(initialState, STRAW_NAMES);

    scores         = [...finalState.scores];
    handMultiplier = finalState.nextHandMultiplier;
    dealerIndex    = 1 - dealerIndex;

    await display.askContinue('Play another hand? Press Enter to continue, or Ctrl+C to quit...');
  }
}

// ── Game selector ─────────────────────────────────────────────────────────────

async function askGame(): Promise<'slobberhannes' | 'strohmandeln'> {
  console.log(`\n${A.bold}Which game?${A.reset}`);
  console.log('  [1]  Slobberhannes  (3–6 players, avoid tricks)');
  console.log('  [2]  Strohmandeln   (2 players, Austrian Tarock)');
  while (true) {
    const raw = await display.ask('\nChoice [1/2]: ');
    if (raw.trim() === '1') return 'slobberhannes';
    if (raw.trim() === '2') return 'strohmandeln';
    console.log('  Enter 1 or 2.');
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const game = await askGame();

  if (game === 'strohmandeln') {
    await runStrohmandeln();
  } else {
    await runSlobberhannes();
  }

  display.close();
}

main().catch(err => { console.error(err); display.close(); process.exit(1); });
