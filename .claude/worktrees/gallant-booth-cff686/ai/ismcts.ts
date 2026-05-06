import type { ISMCTSEngine } from '../lib/engine';

export type { ISMCTSEngine };

const DEFAULT_ITERATIONS = 300;
const UCB_C = Math.SQRT2;

// ── Node ──────────────────────────────────────────────────────────────────────

interface Node<TMove extends object> {
  move:        TMove | null;
  children:    Map<string, Node<TMove>>;
  visits:      number;
  totalReward: number;
  avail:       number;
}

function makeNode<TMove extends object>(move: TMove | null = null): Node<TMove> {
  return { move, children: new Map(), visits: 0, totalReward: 0, avail: 0 };
}

// ── UCB1 ──────────────────────────────────────────────────────────────────────

function bestUCB<TMove extends object>(
  node:   Node<TMove>,
  legal:  TMove[],
  keyFn:  (m: TMove) => string,
): Node<TMove> | null {
  let best: Node<TMove> | null = null;
  let bestV = -Infinity;
  for (const m of legal) {
    const c = node.children.get(keyFn(m));
    if (!c) continue;
    if (c.visits === 0) return c;
    const v = c.totalReward / c.visits + UCB_C * Math.sqrt(Math.log(c.avail) / c.visits);
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface ChooseMoveOptions<TState, TMove extends object> {
  iterations?:    number;
  epsilon?:       number;
  moveKey?:       (move: TMove) => string;
  rolloutPolicy?: ((state: TState, legal: TMove[]) => TMove) | null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function chooseMove<TState, TMove extends object>(
  eng:         ISMCTSEngine<TState, TMove>,
  state:       TState,
  playerIndex: number,
  options:     ChooseMoveOptions<TState, TMove> = {},
): TMove {
  const {
    iterations    = DEFAULT_ITERATIONS,
    epsilon       = 0,
    moveKey       = (m: TMove) => JSON.stringify(m),
    rolloutPolicy = null,
  } = options;

  const root = makeNode<TMove>();

  for (let i = 0; i < iterations; i++) {
    let ws   = eng.determinize(state, playerIndex);
    let node = root;
    const path: Node<TMove>[] = [root];

    // ── Selection ─────────────────────────────────────────────────────────
    while (!eng.isHandOver(ws)) {
      const legal = eng.getLegalMoves(ws);
      for (const m of legal) {
        const c = node.children.get(moveKey(m));
        if (c) c.avail++;
      }
      const unvisited = legal.filter(m => !node.children.has(moveKey(m)));
      if (unvisited.length > 0) break;
      const next = bestUCB(node, legal, moveKey);
      if (!next) break;
      ({ state: ws } = eng.applyMove(ws, next.move!, true));
      node = next;
      path.push(node);
    }

    // ── Expansion ──────────────────────────────────────────────────────────
    if (!eng.isHandOver(ws)) {
      const legal     = eng.getLegalMoves(ws);
      const unvisited = legal.filter(m => !node.children.has(moveKey(m)));
      if (unvisited.length > 0) {
        const m     = pick(unvisited);
        const child = makeNode(m);
        node.children.set(moveKey(m), child);
        ({ state: ws } = eng.applyMove(ws, m, true));
        node = child;
        path.push(node);
      }
    }

    // ── Rollout ────────────────────────────────────────────────────────────
    let s = ws;
    while (!eng.isHandOver(s)) {
      const legal = eng.getLegalMoves(s);
      if (legal.length === 0) break;
      ({ state: s } = eng.applyMove(s, rolloutPolicy ? rolloutPolicy(s, legal) : pick(legal), true));
    }

    // ── Backpropagation ────────────────────────────────────────────────────
    const reward = eng.getReward(s, playerIndex) ?? 0;
    for (const n of path) { n.visits++; n.totalReward += reward; }
  }

  // ── Move selection ─────────────────────────────────────────────────────────
  const legal = eng.getLegalMoves(state);
  if (epsilon > 0 && Math.random() < epsilon) return pick(legal);

  let best    = legal[0]!;
  let bestAvg = -Infinity;
  for (const m of legal) {
    const c = root.children.get(moveKey(m));
    if (!c || c.visits === 0) continue;
    const avg = c.totalReward / c.visits;
    if (avg > bestAvg) { bestAvg = avg; best = m; }
  }
  return best;
}

export { chooseMove };
