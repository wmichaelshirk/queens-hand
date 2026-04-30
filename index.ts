#!/usr/bin/env node

import type { Card } from './types';
import type { State } from './engines/slobberhannes';
import * as engine from './engines/slobberhannes';
import * as display from './display';
import * as greedy from './ai/greedy';
import * as ismcts from './ai/ismcts';

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
  if (playerIndex === 1) return (state, pi) => ismcts.chooseCard(state, pi);
  return (state, pi) => {
    const ledSuit = state.currentTrick.length > 0 ? state.currentTrick[0]!.card.suit : null;
    return greedy.chooseCard(state.hands[pi] ?? [], ledSuit);
  };
}

// ── Hand loop ─────────────────────────────────────────────────────────────────

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

// ── Game loop ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  display.printWelcome();

  const playerCount  = await display.askPlayerCount(NAMES_BY_COUNT);
  const playerNames  = NAMES_BY_COUNT[playerCount] ?? [];

  let scores  = Array<number>(playerCount).fill(0);
  let handNum = Math.floor(Math.random() * playerCount);

  // ELO ratings — uncomment once elo.updateRatings() is implemented:
  // import * as elo from './elo';
  // let ratings = elo.createRatings(playerCount);

  while (true) {
    display.printScoreboard(playerNames, scores, engine.DEFAULT_LOSE_AT);
    await display.askContinue();

    let state = engine.dealState({ scores, playerCount, firstLeader: handNum % playerCount });
    state = await playHand(state, playerNames);

    display.printHandSummary(playerNames, state);
    scores = engine.getGameResult(state).scores;

    // ratings = elo.updateRatings(ratings, engine.getGameResult(state));

    if (engine.isGameOver(state)) {
      display.printGameOver(playerNames, state);
      break;
    }

    handNum++;
  }

  display.close();
}

main().catch(err => { console.error(err); display.close(); process.exit(1); });
