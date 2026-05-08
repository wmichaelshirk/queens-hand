<script lang="ts">
  import type { Card } from '$lib/gameTypes';

  interface Props {
    card?: Card | null;
    playable?: boolean;
    dimmed?: boolean;
    size?: 'normal' | 'trick' | 'straw';
    onclick?: () => void;
  }

  let { card = null, playable = false, dimmed = false, size = 'normal', onclick }: Props = $props();

  function isRedSuit(suit: string) { return suit === '♥' || suit === '♦'; }
</script>

<div
  class="playing-card"
  class:card-red={card && isRedSuit(card.suit)}
  class:card-tarock={card?.suit === 'T'}
  class:card-playable={playable}
  class:card-dimmed={dimmed}
  class:face-down={!card}
  class:trick-card={size === 'trick'}
  class:straw-card={size === 'straw'}
  role={playable ? 'button' : undefined}
  tabindex={playable ? 0 : -1}
  {onclick}
  onkeydown={(e) => e.key === 'Enter' && onclick?.()}
>
  {#if card}
    <span class="card-top-left">
      <span class="cr-rank">{card.rank}</span>
      <span class="cr-suit">{card.suit === 'T' ? '★' : card.suit}</span>
    </span>
    <span class="card-center">{card.suit === 'T' ? card.rank : card.suit}</span>
    <span class="card-bottom-right">
      <span class="cr-rank">{card.rank}</span>
      <span class="cr-suit">{card.suit === 'T' ? '★' : card.suit}</span>
    </span>
  {/if}
</div>

<style>
  .playing-card {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    justify-content: space-between;
    width: 54px;
    height: 80px;
    background: #f8f5ee;
    border: 1px solid #bbb;
    border-radius: 7px;
    padding: 3px 4px;
    font-family: system-ui, sans-serif;
    color: #1a1a2e;
    user-select: none;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    flex-shrink: 0;
  }

  .playing-card.card-red    { color: #c0392b; }
  .playing-card.card-tarock { color: #6c3fbd; }

  .playing-card.card-playable {
    cursor: pointer;
    transform: translateY(-8px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    border-color: #f1c40f;
    border-width: 2px;
  }
  .playing-card.card-playable:hover {
    transform: translateY(-12px);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
  }

  .playing-card.card-dimmed {
    opacity: 0.32;
    filter: grayscale(20%);
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
    inset: 4px;
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

  .playing-card.trick-card { width: 54px; height: 80px; }
  .playing-card.straw-card { width: 52px; height: 76px; }

  .card-top-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1;
    gap: 0px;
  }
  .card-bottom-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1;
    transform: rotate(180deg);
    gap: 0px;
    align-self: flex-end;
  }
  .cr-rank { font-size: 0.72rem; font-weight: 800; line-height: 1.1; }
  .cr-suit { font-size: 0.58rem; line-height: 1; }

  .card-center {
    text-align: center;
    font-size: 1.35rem;
    line-height: 1;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }
</style>
