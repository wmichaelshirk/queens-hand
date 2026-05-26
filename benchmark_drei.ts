/**
 * Dreiertarock phase-budget benchmark.
 * Player 0: ISMCTS with configurable per-phase iteration counts.
 * Players 1,2: uniform-random (any legal move).
 *
 * Sweeps several configs to find how low we can go on bidding/declaring
 * without degrading play quality or bird announcement success rates.
 */

import * as drei                   from './engines/dreiertarock';
import { chooseMove }              from './ai/ismcts';
import { birdWinnerAtPos }         from './lib/tarock';

// ── Configuration ──────────────────────────────────────────────────────────────

const ISMCTS_PLAYER    = 0;
const HANDS_PER_CONFIG = 200;

interface PhaseConfig { bidding: number; declaring: number; playing: number; }

const CONFIGS: Array<{ label: string; c: PhaseConfig }> = [
  { label: 'All-300 (baseline)', c: { bidding: 300, declaring: 300, playing: 300 } },
  { label: 'Pre-100           ', c: { bidding: 100, declaring: 100, playing: 300 } },
  { label: 'Pre-50            ', c: { bidding:  50, declaring:  50, playing: 300 } },
  { label: 'Pre-20            ', c: { bidding:  20, declaring:  20, playing: 300 } },
  { label: 'Pre-10            ', c: { bidding:  10, declaring:  10, playing: 300 } },
  { label: 'All-50 (fast)     ', c: { bidding:  50, declaring:  50, playing:  50 } },
];

// ── Move helpers ───────────────────────────────────────────────────────────────

function randomMove(state: drei.State) {
  const legal = drei.getLegalMoves(state);
  return legal[Math.floor(Math.random() * legal.length)]!;
}

function ismctsMove(state: drei.State, cfg: PhaseConfig) {
  const iters =
    (state.phase === 'bidding' || state.phase === 'contract_choice') ? cfg.bidding :
    (state.phase === 'declaring' || state.phase === 'exchange')       ? cfg.declaring :
    cfg.playing;
  return chooseMove(drei, state, ISMCTS_PLAYER, {
    iterations:    iters,
    movePrior:     drei.movePrior,
    rolloutPolicy: drei.rolloutPolicy,
    moveKey:       drei.moveKey,
  });
}

// ── Hand runner ────────────────────────────────────────────────────────────────

function playHand(scores: number[], dealerIndex: number, cfg: PhaseConfig): drei.State {
  let state = drei.dealState({ scores, dealerIndex, playerCount: 3, scoring: 'Mayr' });
  while (!drei.isHandOver(state)) {
    const pi   = drei.getCurrentPlayer(state);
    const move = pi === ISMCTS_PLAYER ? ismctsMove(state, cfg) : randomMove(state);
    ({ state } = drei.applyMove(state, move));
  }
  return state;
}

// ── Config runner ──────────────────────────────────────────────────────────────

interface ConfigResult {
  label:      string;
  declCount:  number;   // hands where ISMCTS was declarer
  declWin:    number;   // wins as declarer (≥36 card pts)
  pagatAnn:   number;   // times ISMCTS announced Pagat
  pagatOk:    number;   // Pagat announcements that succeeded
  uhuAnn:     number;
  uhuOk:      number;
  kakaduAnn:  number;
  kakaduOk:   number;
  scoreDelta: number;   // cumulative (ISMCTS - avg_opponent) per-hand score deltas
  msTotal:    number;
}

function runConfig(label: string, cfg: PhaseConfig): ConfigResult {
  const res: ConfigResult = {
    label, declCount: 0, declWin: 0,
    pagatAnn: 0, pagatOk: 0, uhuAnn: 0, uhuOk: 0, kakaduAnn: 0, kakaduOk: 0,
    scoreDelta: 0, msTotal: 0,
  };

  let scores      = [0, 0, 0];
  let dealerIndex = 0;

  for (let h = 0; h < HANDS_PER_CONFIG; h++) {
    const t0    = Date.now();
    const state = playHand(scores, dealerIndex, cfg);
    res.msTotal += Date.now() - t0;

    // Per-hand score delta: ISMCTS delta vs average opponent delta
    const ismctsDelta = state.scores[ISMCTS_PLAYER]! - scores[ISMCTS_PLAYER]!;
    const opp1Delta   = state.scores[1]! - scores[1]!;
    const opp2Delta   = state.scores[2]! - scores[2]!;
    res.scoreDelta   += ismctsDelta - (opp1Delta + opp2Delta) / 2;

    scores      = [...state.scores];
    dealerIndex = (dealerIndex + 1) % 3;

    // Declarer stats
    if (state.declarer === ISMCTS_PLAYER) {
      res.declCount++;
      const pts = drei.countCardPoints(state.capturedCards[ISMCTS_PLAYER] ?? []);
      if (pts >= 36) res.declWin++;
    }

    // Bird announcement stats (Trischaken has no announcements)
    if (state.contract !== 'Trischaken') {
      const announced = new Set(
        state.announcements.filter(a => a.player === ISMCTS_PLAYER).map(a => a.name)
      );
      const pagatWinner  = birdWinnerAtPos(state.trickLog, 1, 'I');
      const uhuWinner    = birdWinnerAtPos(state.trickLog, 2, 'II');
      const kakaduWinner = birdWinnerAtPos(state.trickLog, 3, 'III');

      if (announced.has('Pagat'))  { res.pagatAnn++;  if (pagatWinner.type  === 'won' && pagatWinner.player  === ISMCTS_PLAYER) res.pagatOk++;  }
      if (announced.has('Uhu'))    { res.uhuAnn++;    if (uhuWinner.type    === 'won' && uhuWinner.player    === ISMCTS_PLAYER) res.uhuOk++;    }
      if (announced.has('Kakadu')) { res.kakaduAnn++; if (kakaduWinner.type === 'won' && kakaduWinner.player === ISMCTS_PLAYER) res.kakaduOk++; }
    }
  }

  return res;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const pct = (n: number, d: number) =>
  d === 0 ? ' n/a' : `${((n / d) * 100).toFixed(0).padStart(3)}%`;

console.log('Dreiertarock Phase-Budget Benchmark');
console.log(`  Player 0: ISMCTS  |  Players 1,2: random  |  Mayr scoring`);
console.log(`  ${HANDS_PER_CONFIG} hands per config\n`);

const results: ConfigResult[] = [];
const totalStart = Date.now();

for (const { label, c } of CONFIGS) {
  process.stdout.write(`Running "${label.trim()}" (bid=${c.bidding} dec=${c.declaring} play=${c.playing})... `);
  const res     = runConfig(label, c);
  const elapsed = ((res.msTotal) / 1000).toFixed(1);
  process.stdout.write(`done (${elapsed}s)\n`);
  results.push(res);
}

const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
console.log(`\nTotal elapsed: ${totalElapsed}s`);

// ── Summary table ──────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════════════════════════');
console.log(`  RESULTS  (${HANDS_PER_CONFIG} hands each  |  player 0 = ISMCTS vs random  |  Mayr scoring)`);
console.log('════════════════════════════════════════════════════════════════════════════════════');
console.log();

const header = [
  'Config               ',
  'Decl',
  'Win% ',
  'Pagat ann/ok     ',
  'Uhu ann/ok       ',
  'Kakadu ann/ok    ',
  'ΔScore',
  'ms/h',
].join('  ');
console.log(header);
console.log('─'.repeat(header.length));

for (const r of results) {
  const declPct  = pct(r.declCount, HANDS_PER_CONFIG);
  const winPct   = pct(r.declWin,   r.declCount);
  const pagatStr = `${r.pagatOk}/${r.pagatAnn} (${pct(r.pagatOk, r.pagatAnn)})`.padEnd(16);
  const uhuStr   = `${r.uhuOk}/${r.uhuAnn} (${pct(r.uhuOk, r.uhuAnn)})`.padEnd(16);
  const kakStr   = `${r.kakaduOk}/${r.kakaduAnn} (${pct(r.kakaduOk, r.kakaduAnn)})`.padEnd(16);
  const delta    = (r.scoreDelta / HANDS_PER_CONFIG >= 0 ? '+' : '') +
                   (r.scoreDelta / HANDS_PER_CONFIG).toFixed(2);
  const msph     = Math.round(r.msTotal / HANDS_PER_CONFIG).toString().padStart(4);

  console.log(
    `${r.label.padEnd(22)} ${declPct}  ${winPct}  ${pagatStr}  ${uhuStr}  ${kakStr}  ${delta.padStart(6)}  ${msph}`
  );
}

console.log();
console.log('Notes:');
console.log('  Decl    = hands where ISMCTS was declarer (out of ' + HANDS_PER_CONFIG + ')');
console.log('  Win%    = declarer win rate when ISMCTS declared (need ≥36 card pts)');
console.log('  ann/ok  = times announced / times succeeded');
console.log('  ΔScore  = avg per-hand score delta (ISMCTS − avg opponent)  positive = better');
console.log('  ms/h    = avg milliseconds per hand');
