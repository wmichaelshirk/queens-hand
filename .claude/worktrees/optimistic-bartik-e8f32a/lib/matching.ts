/**
 * Generic bipartite matching via Kuhn's augmenting-path algorithm.
 * Used by game engines to assign hidden cards to player/pile slots
 * while respecting suit-void constraints derived from trick history.
 */

function _augment(
  ci:      number,
  match:   number[],
  visited: Uint8Array,
  canUse:  (ci: number, si: number) => boolean,
): boolean {
  for (let si = 0; si < match.length; si++) {
    if (visited[si]) continue;
    if (!canUse(ci, si)) continue;
    visited[si] = 1;
    if (match[si] === -1 || _augment(match[si]!, match, visited, canUse)) {
      match[si] = ci;
      return true;
    }
  }
  return false;
}

/**
 * Run Kuhn's algorithm over cardCount items × slotCount slots.
 * canUse(cardIdx, slotIdx) returns true when that item may occupy that slot.
 * Returns match[slotIdx] = cardIdx for every slot, or null if any slot cannot be filled.
 */
export function bipartiteMatch(
  cardCount: number,
  slotCount: number,
  canUse:    (cardIdx: number, slotIdx: number) => boolean,
): number[] | null {
  const match = new Array<number>(slotCount).fill(-1);
  for (let ci = 0; ci < cardCount; ci++) {
    _augment(ci, match, new Uint8Array(slotCount), canUse);
  }
  return match.some(m => m === -1) ? null : match;
}
