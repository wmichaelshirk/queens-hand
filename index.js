#!/usr/bin/env node
'use strict';

/**
 * Game loop — orchestrates the engine, display, and AI.
 * No game logic or formatting lives here; swap display or AI independently.
 */

const engine  = require('./engine');
const display = require('./display');
const greedy  = require('./ai/greedy');
// const ismcts = require('./ai/ismcts'); // swap in when implemented

const PLAYER_NAMES = ['You', 'West', 'North', 'East'];

// AI selector: index 0 is human (null), others use greedy for now.
function aiFor(playerIndex) {
  if (playerIndex === 0) return null;
  return greedy;
}

// ── Hand loop ─────────────────────────────────────────────────────────────────

/**
 * Play one complete hand from start to terminal state.
 * Drives the engine purely through getLegalMoves / applyMove;
 * all display calls are isolated to this function.
 *
 * @param {object} state - initial state from engine.dealState()
 * @returns {object} terminal hand state
 */
async function playHand(state) {
  while (!engine.isHandOver(state)) {
    const pi      = engine.getCurrentPlayer(state);
    const ledSuit = state.currentTrick.length > 0
      ? state.currentTrick[0].card.suit
      : null;

    if (state.currentTrick.length === 0) {
      display.printTrickHeader(state.trickNum, engine.TRICKS_PER_HAND, PLAYER_NAMES[state.leader]);
    }

    let card;
    const ai = aiFor(pi);

    if (!ai) {
      // Human turn: show context then ask
      display.printTable(state.currentTrick, PLAYER_NAMES);
      display.printHand(state.hands[0], engine.getLegalMoves(state));
      card = await display.askCard(state);
    } else {
      card = ai.chooseCard(state.hands[pi], ledSuit);
      display.printAIPlay(PLAYER_NAMES[pi], card);
    }

    const prevTrickCount = state.trickLog.length;
    state = engine.applyMove(state, card);

    if (state.trickLog.length > prevTrickCount) {
      display.printTrickResult(state.trickLog.at(-1), PLAYER_NAMES);
    }
  }

  return state;
}

// ── Game loop ─────────────────────────────────────────────────────────────────

async function main() {
  display.printWelcome();

  let scores  = Array(engine.PLAYER_COUNT).fill(0);
  let handNum = Math.floor(Math.random() * engine.PLAYER_COUNT);

  // ELO ratings — uncomment once elo.updateRatings() is implemented:
  // const elo     = require('./elo');
  // let ratings   = elo.createRatings(engine.PLAYER_COUNT);

  while (true) {
    display.printScoreboard(PLAYER_NAMES, scores, engine.DEFAULT_LOSE_AT);
    await display.askContinue();

    let state = engine.dealState({ scores, firstLeader: handNum % engine.PLAYER_COUNT });
    state = await playHand(state);

    display.printHandSummary(PLAYER_NAMES, state);
    scores = engine.getGameResult(state).scores;

    // ratings = elo.updateRatings(ratings, engine.getGameResult(state));

    if (engine.isGameOver(state)) {
      display.printGameOver(PLAYER_NAMES, state);
      break;
    }

    handNum++;
  }

  display.close();
}

main().catch(err => { console.error(err); display.close(); process.exit(1); });
