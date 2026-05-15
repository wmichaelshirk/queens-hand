<script lang="ts">
  import type { Card } from '$lib/gameTypes';
  import { isRedSuit, centerSymbol } from '$lib/cardFaceUtils';

  interface Props {
    card?: Card | null;
    playable?: boolean;
    dimmed?: boolean;
    selected?: boolean;   // permanently elevated (discard-toggle state)
    size?: 'normal' | 'trick' | 'straw';
    onclick?: () => void;
  }

  let { card = null, playable = false, dimmed = false, selected = false, size = 'normal', onclick }: Props = $props();
</script>

{#snippet face()}
  {#if card}
    <span class="card-top-left">
      <span class="cr-rank">{card.rank}</span>
      <span class="cr-suit">{card.suit === 'T' ? '' : card.suit}</span>
    </span>
    <span class="card-center">{centerSymbol(card.rank, card.suit)}</span>
    <span class="card-bottom-right">
      <span class="cr-rank">{card.rank}</span>
      <span class="cr-suit">{card.suit === 'T' ? '' : card.suit}</span>
    </span>
  {/if}
{/snippet}

{#if playable}
  <div
    class="card-lift-zone"
    class:straw-zone={size === 'straw'}
    role="button"
    tabindex="0"
    {onclick}
    onkeydown={(e) => e.key === 'Enter' && onclick?.()}
  >
    <div
      class="playing-card card-playable"
      class:card-red={card && isRedSuit(card.suit)}
      class:card-tarock={card?.suit === 'T'}
      class:card-selected={selected}
      class:trick-card={size === 'trick'}
      class:straw-card={size === 'straw'}
      data-card-id={card ? `${card.suit}${card.rank}` : undefined}
      data-flip-id={card ? `card-${card.suit}${card.rank}` : undefined}
    >
      {@render face()}
    </div>
  </div>
{:else}
  <div
    class="playing-card"
    class:card-red={card && isRedSuit(card.suit)}
    class:card-tarock={card?.suit === 'T'}
    class:card-dimmed={dimmed}
    class:face-down={!card}
    class:trick-card={size === 'trick'}
    class:straw-card={size === 'straw'}
    data-card-id={card ? `${card.suit}${card.rank}` : undefined}
    data-flip-id={card ? `card-${card.suit}${card.rank}` : undefined}
  >
    {@render face()}
  </div>
{/if}

<style>
  .card-lift-zone {
    display: inline-flex;
    flex-shrink: 0;
    width: 70px;
    height: 98px; /* 98px card + 18px hover buffer below */
    align-items: flex-start;
    overflow: visible;
    cursor: pointer;
  }

  .card-lift-zone.straw-zone {
    width: 65px;
    height: 109px; /* 91px card + 18px hover buffer below */
  }

  .playing-card {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    justify-content: space-between;
    width: 70px;
    height: 98px;
    background: #f8f5ee;
    border: 1px solid #bbb;
    border-radius: 8px;
    padding: 4px 5px;
    font-family:  'Courier New', Courier, monospace;
    color: #1a1a2e;
    user-select: none;
    z-index: 0;
    overflow: hidden;
    flex-shrink: 0;
  }

  .playing-card.card-red    { color: #c0392b; }
  .playing-card.card-tarock { color: #6c3fbd; }

  .card-lift-zone .card-playable {
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }

  .playing-card.card-playable {
    /* box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    border-width: 2px; */
  }

  .card-lift-zone:hover .card-playable,
  .card-lift-zone .card-playable.card-selected {
    transform: translateY(-18px);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
  }

  .card-lift-zone .card-playable.card-selected {
    border-color: #e94560;
    box-shadow: 0 10px 24px rgba(233, 69, 96, 0.45);
  }

  .playing-card.card-dimmed {
    filter: brightness(0.7);
  }

  .playing-card.face-down {
    background: #1a3464;
    border-color: #0f244a;
    cursor: default;
    overflow: hidden;
  }
  .playing-card.face-down::after {
    content: '';
    position: absolute;
    inset: 5px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    background: repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.04),
      rgba(255, 255, 255, 0.04) 2px,
      transparent 2px,
      transparent 8px
    );
  }

  .playing-card.trick-card { width: 70px; height: 98px; }
  .playing-card.straw-card { width: 65px; height: 91px; }

  .card-top-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    align-self: self-start;
    line-height: 1;
    gap: 0px;
  }
  .card-bottom-right {
    display: flex;
    flex-direction: column;
    align-items: center;
    align-self: self-end;
    line-height: 1;
    transform: rotate(180deg);
    gap: 0px;
    align-self: flex-end;
  }
  .cr-rank { font-size: 1rem; font-weight: 800; }
  .cr-suit { 
    font-size: 1rem;
    transform: scale(1.3);
    font-weight: 800;  
  }

  .card-center {
    text-align: center;
    font-size: 1.25rem;
    line-height: 1;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }

  .playing-card:not(.card-tarock) .card-center {
    transform: scale(2);
  }
</style>
