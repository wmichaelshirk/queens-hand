import type { Card } from '../types';
import type { State } from '../engines/slobberhannes';
import * as engine from '../engines/slobberhannes';

const DEFAULT_ITERATIONS = 300;
const UCB_C = Math.SQRT2;

// ── Node ──────────────────────────────────────────────────────────────────────

interface MCTSNode {
  move:        Card | null;
  children:    Map<string, MCTSNode>;
  visits:      number;
  totalReward: number;
  availCount:  number;
}

function makeNode(move: Card | null = null): MCTSNode {
  return {
    move,
    children: new Map(),
    visits: 0,
    totalReward: 0,
    availCount: 0,
  };
}

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

// ── UCB1 ──────────────────────────────────────────────────────────────────────

function ucb1(child: MCTSNode): number {
  if (child.visits === 0) return Infinity;
  return (child.totalReward / child.visits) +
    UCB_C * Math.sqrt(Math.log(child.availCount) / child.visits);
}

function bestUCB1(node: MCTSNode, legalMoves: Card[]): MCTSNode | null {
  let best: MCTSNode | null = null;
  let bestScore = -Infinity;
  for (const move of legalMoves) {
    const child = node.children.get(cardKey(move));
    if (!child) continue;
    const s = ucb1(child);
    if (s > bestScore) { bestScore = s; best = child; }
  }
  return best;
}

// ── Rollout ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

type RolloutPolicy = (state: State, legalMoves: Card[]) => Card;

function simulate(worldState: State, rolloutPolicy: RolloutPolicy | null): State {
  let s = worldState;
  while (!engine.isHandOver(s)) {
    const moves = engine.getLegalMoves(s);
    ({ state: s } = engine.applyMove(s, rolloutPolicy ? rolloutPolicy(s, moves) : pick(moves)));
  }
  return s;
}

// ── Reward ────────────────────────────────────────────────────────────────────

interface SideGoal {
  weight?: number;
  evaluate: (terminal: State, playerIndex: number) => number;
}

interface RewardOptions {
  horizon:   'hand' | 'game';
  sideGoals: SideGoal[];
}

function computeReward(terminal: State, playerIndex: number, options: RewardOptions): number {
  const { horizon, sideGoals } = options;

  // getReward already returns a normalised [0, 1] value; game-horizon uses raw scores.
  let r = horizon === 'game'
    ? -(terminal.scores[playerIndex] ?? 0)
    : (engine.getReward(terminal, playerIndex) ?? 0);

  for (const { weight = 1, evaluate } of sideGoals) {
    r += weight * evaluate(terminal, playerIndex);
  }

  return r;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface ChooseCardOptions {
  iterations?:    number;
  horizon?:       'hand' | 'game';
  epsilon?:       number;
  rolloutPolicy?: RolloutPolicy | null;
  sideGoals?:     SideGoal[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

function chooseCard(state: State, playerIndex: number, options: ChooseCardOptions = {}): Card {
  const {
    iterations    = DEFAULT_ITERATIONS,
    horizon       = 'hand',
    epsilon       = 0.0,
    rolloutPolicy = null,
    sideGoals     = [],
  } = options;

  const rewardOpts: RewardOptions = { horizon, sideGoals };
  const root = makeNode();

  for (let iter = 0; iter < iterations; iter++) {
    const world = engine.determinize(state, playerIndex);

    // ── Selection ─────────────────────────────────────────────────────────
    let node = root;
    let worldState = world;
    const path: MCTSNode[] = [root];

    while (!engine.isHandOver(worldState)) {
      const legal = engine.getLegalMoves(worldState);

      for (const m of legal) {
        const child = node.children.get(cardKey(m));
        if (child) child.availCount++;
      }

      const unvisited = legal.filter(m => !node.children.has(cardKey(m)));
      if (unvisited.length > 0) break;

      const next = bestUCB1(node, legal);
      if (!next) break;
      ({ state: worldState } = engine.applyMove(worldState, next.move!));
      node = next;
      path.push(node);
    }

    // ── Expansion ──────────────────────────────────────────────────────────
    if (!engine.isHandOver(worldState)) {
      const legal = engine.getLegalMoves(worldState);
      const unvisited = legal.filter(m => !node.children.has(cardKey(m)));

      if (unvisited.length > 0) {
        const expandMove = pick(unvisited);
        const child = makeNode(expandMove);
        node.children.set(cardKey(expandMove), child);
        ({ state: worldState } = engine.applyMove(worldState, expandMove));
        node = child;
        path.push(node);
      }
    }

    // ── Simulation ─────────────────────────────────────────────────────────
    const terminal = simulate(worldState, rolloutPolicy);

    // ── Backpropagation ─────────────────────────────────────────────────────
    const reward = computeReward(terminal, playerIndex, rewardOpts);
    for (const n of path) {
      n.visits++;
      n.totalReward += reward;
    }
  }

  // ── Move selection ─────────────────────────────────────────────────────────
  const legalMoves = engine.getLegalMoves(state);

  if (epsilon > 0 && Math.random() < epsilon) {
    return pick(legalMoves);
  }

  let bestMove = legalMoves[0]!;
  let bestAvg = -Infinity;

  for (const move of legalMoves) {
    const child = root.children.get(cardKey(move));
    if (!child || child.visits === 0) continue;
    const avg = child.totalReward / child.visits;
    if (avg > bestAvg) { bestAvg = avg; bestMove = move; }
  }

  return bestMove;
}

export { chooseCard };
