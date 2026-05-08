<script lang="ts">
  import type { Card } from '$lib/gameTypes';
  import PlayingCard from './PlayingCard.svelte';

  interface Props {
    trick: { playerIndex: number; card: Card }[];
    trickNum: number;
    seatName: (engineIndex: number) => string;
  }

  let { trick, trickNum, seatName }: Props = $props();
</script>

<div class="trick-area">
  <div class="trick-label">Trick {trickNum + 1}</div>
  {#if trick.length > 0}
    <div class="trick-cards">
      {#each trick as play}
        <div class="trick-card-wrap">
          <PlayingCard card={play.card} size="trick" />
          <span class="trick-player-name">{seatName(play.playerIndex)}</span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="trick-empty">—</div>
  {/if}
</div>

<style>
  .trick-area {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
  }

  .trick-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
  }

  .trick-cards {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
  }

  .trick-card-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
  }

  .trick-player-name {
    font-size: 0.65rem;
    color: #666;
  }

  .trick-empty { font-size: 1.2rem; color: #333; }
</style>
