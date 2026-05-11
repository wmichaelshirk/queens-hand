<script lang="ts">
  import PlayingCard from './PlayingCard.svelte';
  import { isVerticalSlot } from '$lib/tableLayout';
  import type { SlotName } from '$lib/tableLayout';

  let { name, isBot, cardCount, slot, score, isCurrentTurn = false, isDealer = false }: {
    name: string;
    isBot: boolean;
    cardCount: number;
    slot: SlotName;
    score?: number;
    isCurrentTurn?: boolean;
    isDealer?: boolean;
  } = $props();

  const vertical = $derived(isVerticalSlot(slot));
</script>

<div class="player-token" class:current-turn={isCurrentTurn} class:is-dealer={isDealer} class:vertical>

  {#if slot === 'left'}
    <!-- Info on the outside-left, rotated -90° (reads bottom→top) -->
    <div class="info-wrap">
      <div class="token-info rotate-neg">
        <div class="avatar">{isBot ? ' 🤖' : '?'}</div>
        <span class="token-name">{name}</span>
        {#if score !== undefined}<span class="token-score">{score}</span>{/if}
        {#if isDealer}<span class="dealer-chip">D</span>{/if}
      </div>
    </div>
    <div class="card-stack vert left-stack" style="--n: {cardCount}">
      {#if cardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(cardCount) as _}<PlayingCard />{/each}
      {/if}
    </div>

  {:else if slot === 'right'}
    <!-- Cards first, then info on the outside-right, rotated +90° (reads top→bottom) -->
    <div class="card-stack vert right-stack" style="--n: {cardCount}">
      {#if cardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(cardCount) as _}<PlayingCard />{/each}
      {/if}
    </div>
    <div class="info-wrap">
      <div class="token-info rotate-pos">
        <div class="avatar">{isBot ? ' 🤖' : '?'}</div>
        <span class="token-name">{name}</span>
        {#if score !== undefined}<span class="token-score">{score}</span>{/if}
        {#if isDealer}<span class="dealer-chip">D</span>{/if}
      </div>
    </div>

  {:else if slot === 'bottom'}
    <!-- Current player: info strip only, no card backs -->
    <div class="token-info">
      <div class="avatar">?</div>
      <span class="token-name">{name}{isBot ? ' 🤖' : ''}</span>
      {#if score !== undefined}<span class="token-score">{score}</span>{/if}
      {#if isDealer}<span class="dealer-chip">D</span>{/if}
    </div>

  {:else}
    <!-- Horizontal top slots: info on top, fan below -->
    <div class="token-info">
      <div class="avatar">{isBot ? ' 🤖' : '?'}</div>
      <span class="token-name">{name}</span>
      {#if score !== undefined}<span class="token-score">{score}</span>{/if}
      {#if isDealer}<span class="dealer-chip">D</span>{/if}
    </div>
    <div class="card-stack horiz" style="--n: {cardCount}">
      {#if cardCount === 0}
        <span class="no-cards">—</span>
      {:else}
        {#each Array(cardCount) as _}<PlayingCard />{/each}
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

  .dealer-chip {
    font-size: 0.6rem;
    font-weight: 700;
    color: #0a1a2e;
    background: #7eb8e0;
    border-radius: 3px;
    padding: 0.05rem 0.3rem;
    line-height: 1.4;
    letter-spacing: 0.05em;
    flex-shrink: 0;
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
    /* compress from -20px (few cards) to -50px (many cards) to stay within ~240px */
    margin-left: clamp(-50px, calc(240px / var(--n, 1) - 70px), -20px);
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
    /* compress from -50px (few cards) to -80px (many cards) to stay within ~200px */
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
