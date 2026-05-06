/**
 * Strohmandeln AI-vs-AI benchmark.
 * Player 0 (Smart): ISMCTS with 300 iterations.
 * Player 1 (Dumb):  ISMCTS with 10 iterations.
 * Runs 100 hands; reports bidding, win/loss, avg card points, and bonus stats.
 */

import type { Move } from './types';
import * as straw from './engines/strohmandeln';

// ── ISMCTS for Strohmandeln ───────────────────────────────────────────────────

function moveKey(m: Move): string {
  switch (m.type) {
    case 'PLAY_CARD':         return `P:${m.card.rank}${m.card.suit}`;
    case 'MAKE_BID':          return `B:${m.bid}`;
    case 'PASS_BID':          return 'PASS';
    case 'MAKE_ANNOUNCEMENT': return `A:${m.announcement}`;
  }
}

/** Legal moves for the current phase (announcements excluded). */
function phaseMoves(state: straw.State): Move[] {
  if (state.phase === 'bidding') return straw.getLegalBids(state);
  if (state.phase === 'playing')
    return straw.getLegalMoves(state).map(c => ({ type: 'PLAY_CARD' as const, card: c }));
  return [];
}

function rollout(s: straw.State): straw.State {
  while (!straw.isHandOver(s)) {
    const moves = phaseMoves(s);
    if (moves.length === 0) break;
    ({ state: s } = straw.applyMove(s, moves[Math.floor(Math.random() * moves.length)]!));
  }
  return s;
}

interface SMNode {
  move:        Move | null;
  children:    Map<string, SMNode>;
  visits:      number;
  totalReward: number;
  avail:       number;
}

const newNode = (move: Move | null = null): SMNode =>
  ({ move, children: new Map(), visits: 0, totalReward: 0, avail: 0 });

function bestUCB(node: SMNode, moves: Move[]): SMNode | null {
  let best: SMNode | null = null;
  let bestV = -Infinity;
  for (const m of moves) {
    const c = node.children.get(moveKey(m));
    if (!c) continue;
    if (c.visits === 0) return c;
    const v = c.totalReward / c.visits
            + Math.SQRT2 * Math.sqrt(Math.log(c.avail) / c.visits);
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

function ismctsMove(state: straw.State, pi: number, iterations: number): Move {
  const root = newNode();

  for (let i = 0; i < iterations; i++) {
    let ws   = straw.determinize(state, pi);
    let node = root;
    const path: SMNode[] = [root];

    // ── Selection ──────────────────────────────────────────────────────────
    while (!straw.isHandOver(ws)) {
      const moves = phaseMoves(ws);
      for (const m of moves) {
        const c = node.children.get(moveKey(m));
        if (c) c.avail++;
      }
      const unvisited = moves.filter(m => !node.children.has(moveKey(m)));
      if (unvisited.length > 0) break;
      const next = bestUCB(node, moves);
      if (!next) break;
      ({ state: ws } = straw.applyMove(ws, next.move!));
      node = next;
      path.push(node);
    }

    // ── Expansion ──────────────────────────────────────────────────────────
    if (!straw.isHandOver(ws)) {
      const moves     = phaseMoves(ws);
      const unvisited = moves.filter(m => !node.children.has(moveKey(m)));
      if (unvisited.length > 0) {
        const expMove = unvisited[Math.floor(Math.random() * unvisited.length)]!;
        const child   = newNode(expMove);
        node.children.set(moveKey(expMove), child);
        ({ state: ws } = straw.applyMove(ws, expMove));
        node = child;
        path.push(node);
      }
    }

    // ── Rollout + backpropagation ───────────────────────────────────────────
    const reward = straw.getReward(rollout(ws), pi) ?? 0;
    for (const n of path) { n.visits++; n.totalReward += reward; }
  }

  // Best move by average reward
  const moves = phaseMoves(state);
  let best = moves[0]!;
  let bestAvg = -Infinity;
  for (const m of moves) {
    const c = root.children.get(moveKey(m));
    if (!c || c.visits === 0) continue;
    const avg = c.totalReward / c.visits;
    if (avg > bestAvg) { bestAvg = avg; best = m; }
  }
  return best;
}

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
    const move = ismctsMove(state, pi, iters[pi] ?? 10);
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
