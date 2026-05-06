import * as readline from 'readline';
import type { Card } from './types';
import type { State, TrickRecord, Play } from './engines/slobberhannes';
import * as engine from './engines/slobberhannes';

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const A = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
};

function cardStr(c: Card): string {
  const col = (c.suit === '♥' || c.suit === '♦') ? A.red : '';
  return `${col}${c.rank}${c.suit}${col ? A.reset : ''}`;
}

function hr(len = 52): string { return '─'.repeat(len); }

// Fallback to Infinity so unknown suits (e.g. Tarock 'T') sort to the end
// rather than silently producing NaN comparisons.
function cardSort(a: Card, b: Card): number {
  const sd = (engine.SUIT_ORDER[a.suit] ?? Infinity) - (engine.SUIT_ORDER[b.suit] ?? Infinity);
  return sd !== 0 ? sd : (engine.RANK_ORDER[a.rank] ?? Infinity) - (engine.RANK_ORDER[b.rank] ?? Infinity);
}

function sortedLegalMoves(hand: Card[], legalMoves: Card[]): Card[] {
  return hand.filter(c => legalMoves.some(m => engine.cardEquals(m, c))).sort(cardSort);
}

// ── Static screens ─────────────────────────────────────────────────────────────

function printWelcome(): void {
  console.log(`\n${A.bold}╔════════════════════════════════════╗`);
  console.log(      `║    S L O B B E R H A N N E S      ║`);
  console.log(      `╚════════════════════════════════════╝${A.reset}`);
  console.log('\nRules:');
  console.log('  • 32-card deck (7–A in all four suits), 4 players, 8 tricks per round');
  console.log('  • Avoid winning: the first trick, the last trick, and the Q♣ trick');
  console.log('  • Each costs 1 point.  Sweep all three? Pay 4 instead of 3.');
  console.log(`  • First player to reach ${engine.DEFAULT_LOSE_AT} points loses.\n`);
}

function printScoreboard(names: string[], scores: number[], loseAt: number): void {
  console.log(`\n${A.bold}Scoreboard${A.reset}`);
  names.forEach((name, i) => {
    const score   = scores[i] ?? 0;
    const filled = '█'.repeat(score);
    const empty  = '░'.repeat(Math.max(0, loseAt - score));
    console.log(`  ${name.padEnd(6)} ${String(score).padStart(2)}  ${filled}${empty}`);
  });
}

function printGameOver(names: string[], state: State): void {
  const result = engine.getGameResult(state);
  console.log(`\n${A.bold}═══ GAME OVER ═══${A.reset}`);
  names.forEach((n, i) => console.log(`  ${n}: ${result.scores[i] ?? 0} pts`));
  const loserNames = (result.losers ?? []).map(i => names[i] ?? `Player ${i}`);
  const loserScore = result.loser !== null ? (result.scores[result.loser] ?? 0) : 0;
  console.log(`\n${A.red}Loser${loserNames.length > 1 ? 's' : ''}: ${loserNames.join(' & ')} (${loserScore} pts)${A.reset}\n`);
}

// ── Per-trick display ─────────────────────────────────────────────────────────

function printTrickHeader(trickNum: number, totalTricks: number, leaderName: string): void {
  console.log(`\n${hr()}`);
  console.log(`  Trick ${trickNum + 1} of ${totalTricks}   Leader: ${A.bold}${leaderName}${A.reset}`);
  console.log(hr());
}

function printHand(hand: Card[], legalMoves: Card[]): void {
  const valid    = sortedLegalMoves(hand, legalMoves);
  const validSet = new Set(valid);
  const invalid  = hand.filter(c => !validSet.has(c)).sort(cardSort);

  const parts = [
    ...valid.map((c, i) => `[${i + 1}]${cardStr(c)}`),
    ...invalid.map(c => `${A.dim}${c.rank}${c.suit}${A.reset}`),
  ];
  console.log(`  Your hand: ${parts.join('  ')}`);
}

function printTable(trick: Play[], names: string[]): void {
  if (!trick.length) return;
  const entries = trick.map(t => `${A.dim}${names[t.playerIndex] ?? `P${t.playerIndex}`}${A.reset}:${cardStr(t.card)}`);
  console.log(`  Table:     ${entries.join('  ')}`);
}

function printAIPlay(name: string, card: Card): void {
  console.log(`  ${name} plays: ${cardStr(card)}`);
}

function printTrickResult(trickRecord: TrickRecord, names: string[]): void {
  const { winner, penaltyLabels } = trickRecord;
  const pts = penaltyLabels.length;
  let line = `\n  ${A.bold}${names[winner] ?? `Player ${winner}`}${A.reset} wins the trick.`;
  if (pts > 0) line += `  ${A.yellow}+${pts} (${penaltyLabels.join(', ')})${A.reset}`;
  console.log(line);
}

// ── Hand summary ──────────────────────────────────────────────────────────────

function printHandSummary(names: string[], state: State): void {
  const penalties = engine.getHandResult(state);
  console.log(`\n${A.bold}Hand summary${A.reset}`);
  names.forEach((name, i) => {
    const p = penalties[i] ?? 0;
    const delta = p > 0
      ? `${A.yellow}+${p}${A.reset}`
      : ` 0`;
    console.log(`  ${name.padEnd(6)}: ${delta}   total: ${state.scores[i] ?? 0}`);
  });
}

// ── Input ─────────────────────────────────────────────────────────────────────

async function askCard(state: State): Promise<Card> {
  const hand       = state.hands[engine.getCurrentPlayer(state)] ?? [];
  const legalMoves = engine.getLegalMoves(state);
  const ledSuit    = state.currentTrick.length > 0 ? state.currentTrick[0]!.card.suit : null;

  const valid = sortedLegalMoves(hand, legalMoves);

  if (ledSuit) {
    const hint = valid.length < hand.length ? `Must follow ${ledSuit}` : `No ${ledSuit} — play anything`;
    console.log(`  ${A.dim}(${hint})${A.reset}`);
  }

  while (true) {
    const raw = await ask(`  Your play [1-${valid.length}]: `);
    const idx = parseInt(raw, 10) - 1;
    if (idx >= 0 && idx < valid.length) return valid[idx]!;
    console.log(`  Enter a number 1–${valid.length}.`);
  }
}

async function askPlayerCount(namesByCount: Record<number, string[]>): Promise<number> {
  const counts = Object.keys(namesByCount).map(Number).sort((a, b) => a - b);
  console.log('\nHow many players?');
  for (const n of counts) {
    const others = (namesByCount[n] ?? []).filter(name => name !== 'You');
    console.log(`  [${n}]  You vs ${others.join(', ')}`);
  }
  while (true) {
    const raw = await ask(`\nPlayer count [${counts.join('/')}]: `);
    const n = parseInt(raw, 10);
    if (counts.includes(n)) return n;
    console.log(`  Enter one of: ${counts.join(', ')}`);
  }
}

async function askContinue(prompt = 'Press Enter to deal...'): Promise<void> {
  await ask(`\n${prompt}`);
}

function close(): void { rl.close(); }

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  ask,
  cardStr,
  printWelcome, printScoreboard, printGameOver,
  printTrickHeader, printHand, printTable, printAIPlay,
  printTrickResult, printHandSummary,
  askCard, askPlayerCount, askContinue, close,
};
