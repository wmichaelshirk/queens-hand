/**
 * Strohmandeln AI-vs-AI benchmark.
 * Player 0 (Smart): ISMCTS with 300 iterations.
 * Player 1 (Dumb):  ISMCTS with 10 iterations.
 * Runs 100 hands; reports bidding, win/loss, avg card points, and bonus stats.
 */

import * as straw from './engines/strohmandeln';
import { chooseMove } from './ai/ismcts';

// ── Hand runner ───────────────────────────────────────────────────────────────

function playHand(
  scores: number[],
  dealerIndex: number,
  handMultiplier: number,
  iters: [number, number],
): straw.State {
  const initial = straw.dealState({ scores, dealerIndex, scoring: 'Beck', handMultiplier });
  let state = straw.uncoverStrawmenInitial(initial).state;

  while (!straw.isHandOver(state)) {
    const pi   = straw.getCurrentPlayer(state);
    const move = chooseMove(straw, state, pi, { iterations: iters[pi] ?? 10 });
    ({ state } = straw.applyMove(state, move));
  }
  return state;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const HANDS = 100;
const ITERS: [number, number] = [300, 10];

const pct = (n: number, d: number) =>
  d === 0 ? ' n/a' : `${((n / d) * 100).toFixed(0).padStart(3)}%`;

const decCount   = [0, 0];
const decWin     = [0, 0];
const decLoss    = [0, 0];
const cardPtsSum = [0, 0];
const pagatUlt   = [0, 0];
const uhu        = [0, 0];
const mondFang   = [0, 0];
let noBidder     = 0;

let scores: number[]   = [0, 0];
let dealerIndex        = 0;
let handMultiplier     = 1;

console.log('Strohmandeln AI-vs-AI Benchmark');
console.log(`  Player 0 (Smart): ISMCTS ${ITERS[0]} iter`);
console.log(`  Player 1 (Dumb):  ISMCTS ${ITERS[1]} iter`);
console.log(`  Beck scoring — ${HANDS} hands\n`);

const start = Date.now();

for (let h = 0; h < HANDS; h++) {
  const state   = playHand(scores, dealerIndex, handMultiplier, ITERS);
  const summary = straw.computeHandSummary(state);

  scores         = [...state.scores];
  handMultiplier = state.nextHandMultiplier;
  dealerIndex    = 1 - dealerIndex;

  if (summary === null || state.declarer === null) {
    noBidder++;
  } else {
    const d = summary.declarer;
    decCount[d]!++;
    cardPtsSum[d]! += summary.declarerCardPoints;

    if (summary.declarerCardPoints >= straw.DECLARER_WINS_AT) decWin[d]!++;
    else                                                        decLoss[d]!++;

    if (summary.pagatUltimoWinner !== null) pagatUlt[summary.pagatUltimoWinner]!++;
    if (summary.uhuWinner         !== null) uhu[summary.uhuWinner]!++;
    if (summary.mondFangWinner    !== null) mondFang[summary.mondFangWinner]!++;
  }

  if ((h + 1) % 10 === 0) {
    const t = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(
      `  Hand ${String(h + 1).padStart(3)}  Smart ${String(scores[0]).padStart(4)}` +
      `  Dumb ${String(scores[1]).padStart(4)}  (${t}s)\n`
    );
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const avgPts  = (pi: number) =>
  decCount[pi]! > 0 ? (cardPtsSum[pi]! / decCount[pi]!).toFixed(1) : 'n/a';

console.log('\n══════════════════════════════════════════');
console.log('           RESULTS SUMMARY (100 hands)');
console.log(`══════════════════════════════════════════`);
console.log(`Elapsed: ${elapsed}s\n`);

console.log('─── Bidding ───────────────────────────────');
console.log(`  No bidder (both passed):  ${noBidder} hands`);
console.log(`  Smart declared:           ${decCount[0]} times`);
console.log(`  Dumb  declared:           ${decCount[1]} times`);

console.log('\n─── Declarer results (need 36+ card pts) ──');
console.log(`  Smart  won: ${String(decWin[0]).padStart(3)} / ${decCount[0]}  (${pct(decWin[0]!, decCount[0]!)})   avg card pts when declarer: ${avgPts(0)}`);
console.log(`  Smart lost: ${String(decLoss[0]).padStart(3)} / ${decCount[0]}  (${pct(decLoss[0]!, decCount[0]!)})`);
console.log(`  Dumb   won: ${String(decWin[1]).padStart(3)} / ${decCount[1]}  (${pct(decWin[1]!, decCount[1]!)})   avg card pts when declarer: ${avgPts(1)}`);
console.log(`  Dumb  lost: ${String(decLoss[1]).padStart(3)} / ${decCount[1]}  (${pct(decLoss[1]!, decCount[1]!)})`);

console.log('\n─── Bonuses achieved ──────────────────────');
console.log(`  Pagat Ultimo (win last trick with I):    Smart ${pagatUlt[0]}  Dumb ${pagatUlt[1]}`);
console.log(`  Uhu (win penultimate trick with II):     Smart ${uhu[0]}  Dumb ${uhu[1]}`);
console.log(`  Mond Fang (capture XXI with ★):         Smart ${mondFang[0]}  Dumb ${mondFang[1]}`);

console.log('\n─── Cumulative game points ────────────────');
console.log(`  Smart: ${scores[0]}   Dumb: ${scores[1]}`);
