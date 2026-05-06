import type { Card } from '../types';
import { RANK_ORDER, isQueenOfClubs } from '../engines/slobberhannes';

function lowest(cards: Card[]): Card {
  return cards.reduce((low, c) =>
    (RANK_ORDER[c.rank] ?? Infinity) < (RANK_ORDER[low.rank] ?? Infinity) ? c : low
  );
}

/**
 * Greedy duck strategy: always play the lowest-ranking legal card to avoid
 * winning tricks. When leading, avoids the Queen of Clubs if possible.
 */
function chooseCard(hand: Card[], ledSuit: string | null): Card {
  if (!ledSuit) {
    const safe = hand.filter(c => !isQueenOfClubs(c));
    return lowest(safe.length > 0 ? safe : hand);
  }

  const followers = hand.filter(c => c.suit === ledSuit);
  return lowest(followers.length > 0 ? followers : hand);
}

export { chooseCard };
