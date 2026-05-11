<script lang="ts">
  import type { Card } from '$lib/gameTypes';
  import type { SlotName } from '$lib/tableLayout';
  import PlayingCard from './PlayingCard.svelte';

  interface Props {
    trick: { playerIndex: number; card: Card }[];
    lastCompletedTrick?: { plays: { playerIndex: number; card: Card }[]; winner: number } | null;
    trickNum: number;
    seatName: (engineIndex: number) => string;
    seatSlot: (engineIndex: number) => SlotName;
  }

  let { trick, lastCompletedTrick, trickNum, seatName, seatSlot }: Props = $props();

  let showLastTrick = $state(false);
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (lastCompletedTrick) {
      showLastTrick = true;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { showLastTrick = false; }, 1000);
    }
    return () => clearTimeout(clearTimer);
  });

  const displayPlays = $derived(
    trick.length > 0
      ? trick
      : (showLastTrick && lastCompletedTrick ? lastCompletedTrick.plays : [])
  );

  const SLOT_STYLE: Record<SlotName, string> = {
    bottom:     'bottom: 0;    left: 50%; transform: translateX(-50%);',
    top:        'top: 0;       left: 50%; transform: translateX(-50%);',
    left:       'left: 12px;   top: 50%;  transform: translateY(-50%);',
    right:      'right: 12px;  top: 50%;  transform: translateY(-50%);',
    'top-left':  'top: 12px;   left: 24px;',
    'top-right': 'top: 12px;   right: 24px;',
  };
</script>

<div class="trick-area">
  <div class="trick-label">Trick {trickNum + 1}</div>
  <div class="trick-compass" data-zone="trick">
    {#if displayPlays.length > 0}
      {#each displayPlays as play (play.playerIndex)}
        {@const slot = seatSlot(play.playerIndex)}
        <div class="compass-card slot-{slot}" style={SLOT_STYLE[slot]}>
          <PlayingCard card={play.card} size="trick" />
        </div>
      {/each}
    {:else}
      <div class="trick-empty"></div>
    {/if}
  </div>
</div>

<style>
  .trick-area {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }

  .trick-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
  }

  .trick-compass {
    position: relative;
    width: 200px;
    height: 180px;
    flex-shrink: 0;
  }

  .compass-card {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
  }

  .trick-player-name {
    font-size: 0.6rem;
    color: #666;
    white-space: nowrap;
  }

  .trick-empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 1.2rem;
    color: #333;
  }
</style>
