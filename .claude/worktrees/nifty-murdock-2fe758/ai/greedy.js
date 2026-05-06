'use strict';

/**
 * Greedy duck strategy: always play the lowest-ranking legal card to avoid
 * winning tricks. When leading, avoids the Queen of Clubs if possible.
 *
 * Interface consumed by index.js:
 *   chooseCard(hand, ledSuit) → Card
 *
 * (The full state is not required here, but ISMCTS will receive it.)
 */

const { RANK_ORDER, isQueenOfClubs } = require('../engine');

function lowest(cards) {
  return cards.reduce((low, c) => RANK_ORDER[c.rank] < RANK_ORDER[low.rank] ? c : low);
}

/**
 * @param {object[]} hand      - player's current hand
 * @param {string|null} ledSuit - suit of the first card played this trick, null if leading
 * @returns {object} card to play
 */
function chooseCard(hand, ledSuit) {
  if (!ledSuit) {
    // Leading: prefer not to lead Q♣
    const safe = hand.filter(c => !isQueenOfClubs(c));
    return lowest(safe.length > 0 ? safe : hand);
  }

  const followers = hand.filter(c => c.suit === ledSuit);
  return lowest(followers.length > 0 ? followers : hand);
}

module.exports = { chooseCard };
