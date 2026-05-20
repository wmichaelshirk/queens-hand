<script lang="ts">
  import type { Card, Move } from '$lib/gameTypes';
  import { whistSort } from '$lib/cardSort';
  import PlayingCard from './PlayingCard.svelte';

  interface Props {
    cards: Card[];
    legalMoves: Move[];
    isMyTurn: boolean;
    busy: boolean;
    onplay: (card: Card) => void;
    sortFn?: (a: Card, b: Card) => number;
    // Discard mode: toggle-select up to 3 cards
    discardMode?: boolean;
    discardLegal?: Card[];
    discardSelected?: Card[];
  }

  let { cards, legalMoves, isMyTurn, busy, onplay, sortFn = whistSort, discardMode = false, discardLegal = [], discardSelected = [] }: Props = $props();

  function sortHand(hand: Card[]): Card[] {
    return [...hand].sort(sortFn);
  }

  function isLegal(card: Card): boolean {
    return legalMoves.some(
      (m) => m.type === "PLAY_CARD" && m.card.suit === card.suit && m.card.rank === card.rank
    );
  }

  function isDiscardLegal(card: Card): boolean {
    return discardLegal.some(c => c.suit === card.suit && c.rank === card.rank);
  }

  function isDiscardSelected(card: Card): boolean {
    return discardSelected.some(c => c.suit === card.suit && c.rank === card.rank);
  }
</script>

<div class="hand-section">
  <div class="hand-cards">
    {#each sortHand(cards) as card (`${card.suit}${card.rank}`)}
      {#if discardMode}
        {@const canDiscard = isDiscardLegal(card)}
        {@const isSelected = isDiscardSelected(card)}
        <div class="card-wrap">
          <PlayingCard
            {card}
            playable={canDiscard}
            dimmed={!canDiscard}
            selected={isSelected}
            onclick={canDiscard && !busy ? () => onplay(card) : undefined}
          />
        </div>
      {:else}
        {@const legal = isMyTurn && isLegal(card)}
        <div class="card-wrap">
          <PlayingCard
            {card}
            playable={legal}
            dimmed={isMyTurn && !legal}
            onclick={legal && !busy ? () => onplay(card) : undefined}
          />
        </div>
      {/if}
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
