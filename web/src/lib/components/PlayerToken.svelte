<script lang="ts">
  import PlayingCard from './PlayingCard.svelte';
  import { isVerticalSlot } from '$lib/tableLayout';
  import type { SlotName } from '$lib/tableLayout';

  let { name, isBot, cardCount, slot, score, isCurrentTurn = false }: {
    name: string;
    isBot: boolean;
    cardCount: number;
    slot: SlotName;
    score?: number;
    isCurrentTurn?: boolean;
  } = $props();

  const MAX_H = 10;
  const MAX_V = 6;

  const vertical = $derived(isVerticalSlot(slot));
  const maxCards = $derived(vertical ? MAX_V : MAX_H);
  const shownCount = $derived(Math.min(cardCount, maxCards));
  const overflow = $derived(cardCount > maxCards ? cardCount - maxCards : 0);
</script>

<div class="player-token" class:current-turn={isCurrentTurn} class:vertical>

  {#if slot === 'left'}
    <!-- Info on the outside-left, rotated -90° (reads bottom→top) -->
    <div class="info-wrap">
      <div class="token-info rotate-neg">
        <div class="avatar">?</div>
        <span class="token-name">{name}{isBot ? ' 🤖' : ''}</span>
        {#if score !== undefined}<span class="token-score">{score}</span>{/if}
      </div>
    </div>
    <div class="card-stack vert">
      {#if cardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(shownCount) as _}<PlayingCard />{/each}
        {#if overflow > 0}<span class="overflow">+{overflow}</span>{/if}
      {/if}
    </div>

  {:else if slot === 'right'}
    <!-- Cards first, then info on the outside-right, rotated +90° (reads top→bottom) -->
    <div class="card-stack vert">
      {#if cardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(shownCount) as _}<PlayingCard />{/each}
        {#if overflow > 0}<span class="overflow">+{overflow}</span>{/if}
      {/if}
    </div>
    <div class="info-wrap">
      <div class="token-info rotate-pos">
        <div class="avatar">?</div>
        <span class="token-name">{name}{isBot ? ' 🤖' : ''}</span>
        {#if score !== undefined}<span class="token-score">{score}</span>{/if}
      </div>
    </div>

  {:else if slot === 'bottom'}
    <!-- Current player: info strip only, no card backs -->
    <div class="token-info">
      <div class="avatar">?</div>
      <span class="token-name">{name}{isBot ? ' 🤖' : ''}</span>
      {#if score !== undefined}<span class="token-score">{score}</span>{/if}
    </div>

  {:else}
    <!-- Horizontal top slots: info on top, fan below -->
    <div class="token-info">
      <div class="avatar">?</div>
      <span class="token-name">{name}{isBot ? ' 🤖' : ''}</span>
      {#if score !== undefined}<span class="token-score">{score}</span>{/if}
    </div>
    <div class="card-stack horiz">
      {#if cardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(shownCount) as _}<PlayingCard />{/each}
        {#if overflow > 0}<span class="overflow">+{overflow}</span>{/if}
      {/if}
    </div>
  {/if}

</div>

<style>
  .player-token {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .player-token.vertical {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  /* ── Info section ────────────────────────────────────────────── */

  .token-info {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
    border: 2px solid transparent;
    border-radius: 6px;
    padding: 0.2rem 0.45rem;
    background: transparent;
    transition: border-color 0.15s, background 0.15s;
  }

  .current-turn .token-info {
    border-color: #e94560;
    background: #1e0a14;
  }

  /* Narrow wrapper so rotated info takes minimal layout space */
  .info-wrap {
    width: 36px;
    flex-shrink: 0;
    overflow: visible;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rotate-neg { transform: rotate(-90deg); }
  .rotate-pos { transform: rotate(90deg); }

  .avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #1a2a40;
    border: 1px solid #2a3a50;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    color: #555;
    flex-shrink: 0;
  }

  .token-name {
    font-size: 0.72rem;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .token-score {
    font-size: 0.72rem;
    font-weight: 700;
    color: #aaa;
    background: #1a2a40;
    border: 1px solid #2a3a50;
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    line-height: 1;
  }

  /* ── Card stacks ─────────────────────────────────────────────── */

  /* Horizontal fan (top, top-left, top-right) */
  .card-stack.horiz {
    display: flex;
    align-items: flex-end;
  }
  .card-stack.horiz :global(.playing-card) {
    margin-left: -28px;
    transition: none;
  }
  .card-stack.horiz :global(.playing-card:first-child) {
    margin-left: 0;
  }

  /* Vertical stack (left, right) */
  .card-stack.vert {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .card-stack.vert :global(.playing-card) {
    margin-top: -63px;
    transition: none;
  }
  .card-stack.vert :global(.playing-card:first-child) {
    margin-top: 0;
  }

  .overflow {
    font-size: 0.72rem;
    color: #666;
    align-self: center;
    margin-left: 4px;
  }
  .card-stack.vert .overflow {
    margin-left: 0;
    margin-top: 6px;
  }

  .no-cards {
    font-size: 0.8rem;
    color: #444;
    font-style: italic;
  }
</style>
