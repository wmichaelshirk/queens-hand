<script lang="ts">
  import type { Card, Move } from '$lib/gameTypes';
  import PlayingCard from './PlayingCard.svelte';

  interface Props {
    cards: Card[];
    legalMoves: Move[];
    isMyTurn: boolean;
    busy: boolean;
    onplay: (card: Card) => void;
  }

  let { cards, legalMoves, isMyTurn, busy, onplay }: Props = $props();

  const SUIT_ORDER: Record<string, number> = { T: 0, "♣": 1, "♦": 2, "♥": 3, "♠": 4 };
  const RANK_ORDER: Record<string, number> = {
    "7": 0, "8": 1, "9": 2, "10": 3, J: 4, Q: 5, K: 6, A: 7,
    Kn: 8,
    I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6, VIII: 7, IX: 8, X: 9,
    XI: 10, XII: 11, XIII: 12, XIV: 13, XV: 14, XVI: 15, XVII: 16, XVIII: 17,
    XIX: 18, XX: 19, XXI: 20, "★": 21,
  };

  function sortHand(hand: Card[]): Card[] {
    return [...hand].sort((a, b) => {
      const sd = (SUIT_ORDER[a.suit] ?? 99) - (SUIT_ORDER[b.suit] ?? 99);
      if (sd !== 0) return sd;
      return (RANK_ORDER[a.rank] ?? 50) - (RANK_ORDER[b.rank] ?? 50);
    });
  }

  function isLegal(card: Card): boolean {
    return legalMoves.some(
      (m) => m.type === "PLAY_CARD" && m.card.suit === card.suit && m.card.rank === card.rank
    );
  }
</script>

<div class="hand-section">
  <div class="hand-label">
    {isMyTurn ? "Your turn — click a card to play" : "Your hand"}
  </div>
  <div class="hand-cards">
    {#each sortHand(cards) as card (`${card.suit}${card.rank}`)}
      {@const legal = isMyTurn && isLegal(card)}
      <div class="card-wrap">
        <PlayingCard
          {card}
          playable={legal}
          dimmed={isMyTurn && !legal}
          onclick={legal && !busy ? () => onplay(card) : undefined}
        />
      </div>
    {/each}
  </div>
</div>

<style>
  .hand-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
    border-top: 1px solid #0f3460;
    padding-top: 1.5rem;
  }

  .hand-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
  }

  .hand-cards {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    padding-bottom: 20px;
  }

  .card-wrap {
    position: relative;
    margin-left: -35px;
  }
  .card-wrap:first-child {
    margin-left: 0;
  }
</style>
