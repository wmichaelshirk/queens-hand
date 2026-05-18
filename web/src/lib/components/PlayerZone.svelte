<script lang="ts">
  import PlayingCard from './PlayingCard.svelte';
  import PlayerToken from './PlayerToken.svelte';
  import { isVerticalSlot } from '$lib/tableLayout';
  import type { SlotName } from '$lib/tableLayout';

  let {
    name, isBot, cardCount, slot, score,
    isCurrentTurn = false, isDealer = false,
    isDeclarer = false, declarerActive = false,
  }: {
    name: string;
    isBot: boolean;
    cardCount: number;
    slot: SlotName;
    score?: number;
    isCurrentTurn?: boolean;
    isDealer?: boolean;
    isDeclarer?: boolean;
    declarerActive?: boolean;
  } = $props();

  const vertical = $derived(isVerticalSlot(slot));
  const safeCardCount = $derived(Math.max(0, Math.floor(cardCount ?? 0)));
</script>

<div class="player-zone" class:vertical>

  {#if slot === 'left'}
    <div class="info-wrap">
      <PlayerToken {name} {isBot} {score} {isDealer} {isDeclarer} {declarerActive} {isCurrentTurn} />
    </div>
    <div class="card-stack vert left-stack" style="--n: {safeCardCount}">
      {#if safeCardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(safeCardCount) as _}<PlayingCard />{/each}
      {/if}
    </div>

  {:else if slot === 'right'}
    <div class="card-stack vert right-stack" style="--n: {safeCardCount}">
      {#if safeCardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(safeCardCount) as _}<PlayingCard />{/each}
      {/if}
    </div>
    <div class="info-wrap">
      <PlayerToken {name} {isBot} {score} {isDealer} {isDeclarer} {declarerActive} {isCurrentTurn} />
    </div>

  {:else if slot === 'bottom'}
    <PlayerToken {name} {isBot} {score} {isDealer} {isDeclarer} {declarerActive} {isCurrentTurn} />

  {:else}
    <!-- Horizontal top slots: token on top, fan below -->
    <PlayerToken {name} {isBot} {score} {isDealer} {isDeclarer} {declarerActive} {isCurrentTurn} />
    <div class="card-stack horiz" style="--n: {safeCardCount}">
      {#if safeCardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(safeCardCount) as _}<PlayingCard />{/each}
      {/if}
    </div>
  {/if}

</div>

<style>
  .player-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .player-zone.vertical {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  /* Narrow wrapper for side-slot tokens */
  .info-wrap {
    width: 64px;
    flex-shrink: 0;
    overflow: visible;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Card stacks ─────────────────────────────────────────────── */

  .card-stack.horiz {
    display: flex;
    align-items: flex-end;
  }
  .card-stack.horiz :global(.playing-card) {
    margin-left: clamp(-50px, calc(240px / var(--n, 1) - 70px), -20px);
    transition: none;
  }
  .card-stack.horiz :global(.playing-card:first-child) {
    margin-left: 0;
  }

  .card-stack.vert {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .card-stack.vert :global(.playing-card) {
    margin-top: clamp(-80px, calc(200px / var(--n, 1) - 98px), -50px);
    transition: none;
  }
  .card-stack.vert :global(.playing-card:first-child) {
    margin-top: 0;
  }

  .card-stack.left-stack :global(.playing-card) {
    transform: rotate(-90deg);
  }
  .card-stack.right-stack :global(.playing-card) {
    transform: rotate(90deg);
  }

  .no-cards {
    font-size: 0.8rem;
    color: #444;
    font-style: italic;
  }
</style>
