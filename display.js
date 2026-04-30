'use strict';

/**
 * All terminal I/O for Slobberhannes.
 * This module owns the readline interface; call close() once at program exit.
 * No game logic lives here — only formatting and prompting.
 */

const readline  = require('readline');
const engine    = require('./engines/slobberhannes');
const { SUIT_ORDER, RANK_ORDER } = engine;

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const A = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
};

function cardStr(c) {
  const col = (c.suit === '♥' || c.suit === '♦') ? A.red : '';
  return `${col}${c.rank}${c.suit}${col ? A.reset : ''}`;
}

function hr(len = 52) { return '─'.repeat(len); }

function cardSort(a, b) {
  const sd = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  return sd !== 0 ? sd : RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
}

// Shared by printHand and askCard — keeps displayed numbers and input indices in sync.
function sortedLegalMoves(hand, legalMoves) {
  return hand.filter(c => legalMoves.some(m => engine.cardEquals(m, c))).sort(cardSort);
}

// ── Static screens ─────────────────────────────────────────────────────────────

function printWelcome() {
  console.log(`\n${A.bold}╔════════════════════════════════════╗`);
  console.log(      `║    S L O B B E R H A N N E S      ║`);
  console.log(      `╚════════════════════════════════════╝${A.reset}`);
  console.log('\nRules:');
  console.log('  • 32-card deck (7–A in all four suits), 4 players, 8 tricks per round');
  console.log('  • Avoid winning: the first trick, the last trick, and the Q♣ trick');
  console.log('  • Each costs 1 point.  Sweep all three? Pay 4 instead of 3.');
  console.log(`  • First player to reach ${engine.DEFAULT_LOSE_AT} points loses.\n`);
}

function printScoreboard(names, scores, loseAt) {
  console.log(`\n${A.bold}Scoreboard${A.reset}`);
  names.forEach((name, i) => {
    const filled = '█'.repeat(scores[i]);
    const empty  = '░'.repeat(Math.max(0, loseAt - scores[i]));
    console.log(`  ${name.padEnd(6)} ${String(scores[i]).padStart(2)}  ${filled}${empty}`);
  });
}

function printGameOver(names, state) {
  const result = engine.getGameResult(state);
  console.log(`\n${A.bold}═══ GAME OVER ═══${A.reset}`);
  names.forEach((n, i) => console.log(`  ${n}: ${result.scores[i]} pts`));
  const loserNames = result.losers.map(i => names[i]);
  console.log(`\n${A.red}Loser${loserNames.length > 1 ? 's' : ''}: ${loserNames.join(' & ')} (${result.scores[result.loser]} pts)${A.reset}\n`);
}

// ── Per-trick display ─────────────────────────────────────────────────────────

function printTrickHeader(trickNum, totalTricks, leaderName) {
  console.log(`\n${hr()}`);
  console.log(`  Trick ${trickNum + 1} of ${totalTricks}   Leader: ${A.bold}${leaderName}${A.reset}`);
  console.log(hr());
}

/**
 * Display the player's hand.
 * Valid (legal) moves are sorted and numbered; invalid cards are greyed with no number.
 */
function printHand(hand, legalMoves) {
  const valid   = sortedLegalMoves(hand, legalMoves);
  const validSet = new Set(valid);
  const invalid = hand.filter(c => !validSet.has(c)).sort(cardSort);

  const parts = [
    ...valid.map((c, i) => `[${i + 1}]${cardStr(c)}`),
    ...invalid.map(c => `${A.dim}${c.rank}${c.suit}${A.reset}`),
  ];
  console.log(`  Your hand: ${parts.join('  ')}`);
}

function printTable(trick, names) {
  if (!trick.length) return;
  const entries = trick.map(t => `${A.dim}${names[t.playerIndex]}${A.reset}:${cardStr(t.card)}`);
  console.log(`  Table:     ${entries.join('  ')}`);
}

function printAIPlay(name, card) {
  console.log(`  ${name} plays: ${cardStr(card)}`);
}

function printTrickResult(trickRecord, names) {
  const { winner, penaltyLabels } = trickRecord;
  const pts = penaltyLabels.length;
  let line = `\n  ${A.bold}${names[winner]}${A.reset} wins the trick.`;
  if (pts > 0) line += `  ${A.yellow}+${pts} (${penaltyLabels.join(', ')})${A.reset}`;
  console.log(line);
}

// ── Hand summary ──────────────────────────────────────────────────────────────

function printHandSummary(names, state) {
  const penalties = engine.getHandResult(state);
  console.log(`\n${A.bold}Hand summary${A.reset}`);
  names.forEach((name, i) => {
    const delta = penalties[i] > 0
      ? `${A.yellow}+${penalties[i]}${A.reset}`
      : ` 0`;
    console.log(`  ${name.padEnd(6)}: ${delta}   total: ${state.scores[i]}`);
  });
}

// ── Input ─────────────────────────────────────────────────────────────────────

/**
 * Prompt the human player to choose a card.
 * Accepts 1-based indices into the sorted valid-moves list shown by printHand.
 */
async function askCard(state) {
  const hand       = state.hands[engine.getCurrentPlayer(state)];
  const legalMoves = engine.getLegalMoves(state);
  const ledSuit    = state.currentTrick.length > 0 ? state.currentTrick[0].card.suit : null;

  const valid = sortedLegalMoves(hand, legalMoves);

  if (ledSuit) {
    const hint = valid.length < hand.length ? `Must follow ${ledSuit}` : `No ${ledSuit} — play anything`;
    console.log(`  ${A.dim}(${hint})${A.reset}`);
  }

  while (true) {
    const raw = await ask(`  Your play [1-${valid.length}]: `);
    const idx = parseInt(raw, 10) - 1;
    if (idx >= 0 && idx < valid.length) return valid[idx];
    console.log(`  Enter a number 1–${valid.length}.`);
  }
}

/**
 * Ask how many players will play. Shows each option with its seat names.
 * @param {{ [count: number]: string[] }} namesByCount  — e.g. { 3: ['You','West','East'], ... }
 * @returns {number} chosen player count
 */
async function askPlayerCount(namesByCount) {
  const counts = Object.keys(namesByCount).map(Number).sort((a, b) => a - b);
  console.log('\nHow many players?');
  for (const n of counts) {
    const others = namesByCount[n].filter(name => name !== 'You');
    console.log(`  [${n}]  You vs ${others.join(', ')}`);
  }
  while (true) {
    const raw = await ask(`\nPlayer count [${counts.join('/')}]: `);
    const n = parseInt(raw, 10);
    if (counts.includes(n)) return n;
    console.log(`  Enter one of: ${counts.join(', ')}`);
  }
}

/** Pause until the user presses Enter. */
async function askContinue(prompt = 'Press Enter to deal...') {
  await ask(`\n${prompt}`);
}

function close() { rl.close(); }

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  cardStr,
  printWelcome, printScoreboard, printGameOver,
  printTrickHeader, printHand, printTable, printAIPlay,
  printTrickResult, printHandSummary,
  askCard, askPlayerCount, askContinue, close,
};
