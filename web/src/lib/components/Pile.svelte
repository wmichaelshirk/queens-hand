<script lang="ts">
  import type { StrawmanPileInfo } from '$lib/gameTypes';
  import PlayingCard from './PlayingCard.svelte';

  interface Props {
    pile: StrawmanPileInfo;
  }

  let { pile }: Props = $props();
</script>

<div class="straw-pile" class:empty={!pile.topCard}>
  {#if pile.topCard}
    <PlayingCard card={pile.topCard} size="straw" />
    {#if pile.depth > 0}
      <div class="straw-depth">+{pile.depth}</div>
    {/if}
  {:else}
    <div class="straw-empty">—</div>
  {/if}
</div>

<style>
  .straw-pile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .straw-depth {
    font-size: 0.68rem;
    color: #666;
    letter-spacing: 0.04em;
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
    width: 52px;
    height: 76px;
  }
</style>
