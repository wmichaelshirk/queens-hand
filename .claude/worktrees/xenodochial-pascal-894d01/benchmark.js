'use strict';

/**
 * Benchmark: ISMCTS (player 0) vs 3 Greedy opponents over N games.
 * "Winning" = fewest cumulative penalty points at game end.
 * Chance baseline for 4 equal players: 25% win rate, 25% loss rate.
 */

const engine  = require('./engine');
const ismcts  = require('./ai/ismcts');
const greedy  = require('./ai/greedy');

const GAMES             = 100;
const ISMCTS_PLAYER     = 0;
const ISMCTS_ITERATIONS = 300;
const PLAYER_COUNT      = 4;

// ── Move selectors ────────────────────────────────────────────────────────────

function greedyMove(state) {
  const pi      = engine.getCurrentPlayer(state);
  const hand    = state.hands[pi];
  const ledSuit = state.currentTrick.length > 0 ? state.currentTrick[0].card.suit : null;
  return greedy.chooseCard(hand, ledSuit);
}

function ismctsMove(state) {
  return ismcts.chooseCard(state, ISMCTS_PLAYER, { iterations: ISMCTS_ITERATIONS });
}

// ── Game runner ───────────────────────────────────────────────────────────────

function playGame() {
  let state = engine.dealState({ playerCount: PLAYER_COUNT });

  while (!engine.isGameOver(state)) {
    if (state.phase === 'hand_over') {
      state = engine.dealState({
        scores:      state.scores,
        firstLeader: state.leader,
        playerCount: PLAYER_COUNT,
        loseAt:      state.loseAt,
      });
    }

    const pi   = engine.getCurrentPlayer(state);
    const card = pi === ISMCTS_PLAYER ? ismctsMove(state) : greedyMove(state);
    state = engine.applyMove(state, card);
  }

  return engine.getGameResult(state);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const ismctsScores  = [];
const greedyAvgScores = [];
let wins   = 0;  // ISMCTS has strictly lowest score
let losses = 0;  // ISMCTS is among the losers (highest score, eliminated)
let ties   = 0;  // ISMCTS ties for lowest score

console.log(`Slobberhannes benchmark — ${GAMES} games`);
console.log(`ISMCTS player ${ISMCTS_PLAYER} (${ISMCTS_ITERATIONS} iter) vs 3 Greedy`);
console.log(`Chance baseline: 25% win, 25% loss\n`);

const start = Date.now();

for (let g = 0; g < GAMES; g++) {
  const result   = playGame();
  const myScore  = result.scores[ISMCTS_PLAYER];
  const others   = result.scores.filter((_, i) => i !== ISMCTS_PLAYER);
  const minOther = Math.min(...others);

  ismctsScores.push(myScore);
  greedyAvgScores.push(others.reduce((a, b) => a + b, 0) / others.length);

  if (myScore < minOther)                        wins++;
  else if (result.losers.includes(ISMCTS_PLAYER)) losses++;
  else if (myScore === minOther)                  ties++;

  if ((g + 1) % 10 === 0) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const tag = result.losers.includes(ISMCTS_PLAYER) ? 'LOSS'
              : myScore < minOther                    ? 'win '
              :                                         'tie ';
    console.log(
      `  Game ${String(g + 1).padStart(3)}: ISMCTS ${myScore} | ` +
      `Greedy ${others.join('/')} [${tag}]  (${elapsed}s elapsed)`
    );
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// Score stats
const sorted = [...ismctsScores].sort((a, b) => a - b);
const mean   = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
const pct    = (n) => ((n / GAMES) * 100).toFixed(1);

const ismctsMean  = mean(ismctsScores).toFixed(2);
const greedyMean  = mean(greedyAvgScores).toFixed(2);
const scoreDelta  = (mean(ismctsScores) - mean(greedyAvgScores)).toFixed(2);
const deltaSign   = scoreDelta > 0 ? '+' : '';

console.log('\n══════════════════════════════════════════');
console.log('              RESULTS SUMMARY');
console.log('══════════════════════════════════════════');
console.log(`Games:           ${GAMES}   (${elapsed}s)`);
console.log(`ISMCTS iters:    ${ISMCTS_ITERATIONS} per decision`);
console.log('');
console.log('Outcome (lower score is better):');
console.log(`  Wins  (lowest score):   ${String(wins).padStart(3)}  ${pct(wins)}%  vs 25% chance`);
console.log(`  Losses (eliminated):    ${String(losses).padStart(3)}  ${pct(losses)}%  vs 25% chance`);
console.log(`  Ties  (shared lowest):  ${String(ties).padStart(3)}  ${pct(ties)}%`);
console.log('');
console.log('Score at game end (lower = better):');
console.log(`  ISMCTS avg:  ${ismctsMean}  (chance ~${greedyMean})`);
console.log(`  Score delta: ${deltaSign}${scoreDelta}  (negative = ISMCTS beats greedy)`);
console.log('');
console.log('ISMCTS score distribution:');
console.log(`  Min:    ${sorted[0]}`);
console.log(`  P25:    ${sorted[Math.floor(GAMES * 0.25)]}`);
console.log(`  Median: ${sorted[Math.floor(GAMES * 0.50)]}`);
console.log(`  P75:    ${sorted[Math.floor(GAMES * 0.75)]}`);
console.log(`  Max:    ${sorted[GAMES - 1]}`);
