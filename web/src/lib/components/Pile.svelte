<script lang="ts">
  import type { StrawmanPileInfo } from '$lib/gameTypes';
  import PlayingCard from './PlayingCard.svelte';

  interface Props {
    pile: StrawmanPileInfo;
    playable?: boolean;
    dimmed?: boolean;
    onclick?: () => void;
    playerIndex?: number;
    pileIndex?: number;
  }

  let { pile, playable = false, dimmed = false, onclick, playerIndex, pileIndex }: Props = $props();

  const MAX_SHOWN = 6;
  const V = 4;  // px per level vertically
  const H = 2;  // px per level horizontally
</script>

<div class="straw-pile" class:empty={!pile.topCard}>
  {#if pile.topCard}
    {@const shown = Math.min(pile.depth, MAX_SHOWN)}
    <div class="pile-stack" style="--depth: {shown}">
      {#each Array(shown) as _, i}
        {@const idx = i + 1}
        <div
          class="pile-back"
          style="--i: {idx}; left: {(shown - idx) * H}px"
        >
          <PlayingCard size="straw" />
        </div>
      {/each}
      <div class="pile-face" style="left: {shown * H}px"
           data-pile-player={playerIndex}
           data-pile-index={pileIndex}>
        <PlayingCard card={pile.topCard} size="straw" {playable} {dimmed} {onclick} />
      </div>
    </div>
  {:else}
    <div class="straw-empty">—</div>
  {/if}
</div>

<style>
  .straw-pile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  /* container grows right and down to fit the offset stack */
  .pile-stack {
    position: relative;
    width: calc(65px + var(--depth) * 2px);
    height: calc(91px + var(--depth) * 4px);
  }

  /* face card: top of the stack, most offset up-right */
  .pile-face {
    position: absolute;
    top: 0;
    z-index: 10;
  }

  /* each back: --i steps down (V px) and left (H px) from the face card */
  .pile-back {
    position: absolute;
    top: calc(var(--i) * 4px);
    z-index: calc(10 - var(--i));
  }

  .straw-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    color: #2a3a50;
    background: #0d1528;
    border: 1px dashed #1a2a40;
    border-radius: 7px;
    width: 65px;
    height: 91px;
  }
</style>
