<script lang="ts">
  import type { Card } from '$lib/gameTypes';
  import PlayingCard from './PlayingCard.svelte';

  interface Props {
    lastTrick: { plays: { playerIndex: number; card: Card }[]; winner: number } | null;
    playerNames: string[];
  }

  const { lastTrick, playerNames }: Props = $props();

  let open = $state(false);

  function toggle() { open = !open; }

  function name(idx: number): string {
    return playerNames[idx] ?? `P${idx + 1}`;
  }
</script>

{#if lastTrick}
  <div class="last-trick-wrap">
    <button class="toggle-btn" onclick={toggle} aria-expanded={open}>
      Last trick {open ? '▲' : '▼'}
    </button>
    {#if open}
      <div class="popover">
        <div class="plays">
          {#each lastTrick.plays as play (play.playerIndex)}
            <div class="play-entry" class:is-winner={play.playerIndex === lastTrick.winner}>
              <PlayingCard card={play.card} size="straw" />
              <span class="play-name">{name(play.playerIndex)}</span>
            </div>
          {/each}
        </div>
        <div class="winner-label">Won by {name(lastTrick.winner)}</div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .last-trick-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .toggle-btn {
    background: transparent;
    border: 1px solid #1a3050;
    border-radius: 6px;
    color: #666;
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    padding: 2px 10px;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
  }

  .toggle-btn:hover {
    color: #aaa;
    border-color: #2a4060;
  }

  .popover {
    margin-top: 0.5rem;
    background: #0d1e35;
    border: 1px solid #1a3050;
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    min-width: max-content;
    z-index: 10;
  }

  .plays {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .play-entry {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .play-entry.is-winner :global(.playing-card) {
    box-shadow: 0 0 0 2px #e94560;
  }

  .play-name {
    font-size: 0.65rem;
    color: #888;
    max-width: 65px;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .play-entry.is-winner .play-name {
    color: #e94560;
  }

  .winner-label {
    font-size: 0.7rem;
    color: #888;
    letter-spacing: 0.04em;
  }
</style>
