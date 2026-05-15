<script lang="ts">
  import type { Move, GameState } from '$lib/gameTypes';
  import { getSlotForSeat } from '$lib/tableLayout';
  import { whistSort } from '$lib/cardSort';
  import PlayerToken from './PlayerToken.svelte';
  import Trick from './Trick.svelte';
  import HandCards from './HandCards.svelte';

  interface Props {
    displayState: NonNullable<GameState>;
    myEngineIndex: number;
    isMyTurn: boolean;
    busy: boolean;
    onPlayMove: (move: Move) => void;
  }

  const { displayState, myEngineIndex, isMyTurn, busy, onPlayMove }: Props = $props();

  const seatSlots = $derived(
    displayState.seats.map(s => ({
      ...s,
      slot: getSlotForSeat(
        myEngineIndex >= 0 ? myEngineIndex : 0,
        s.enginePlayerIndex,
        displayState.seats.length
      ),
    }))
  );

  const topRowSeats = $derived(
    seatSlots
      .filter(s => s.slot === 'top' || s.slot === 'top-left' || s.slot === 'top-right')
      .sort((a, b) => {
        const order: Record<string, number> = { 'top-left': 0, 'top': 1, 'top-right': 2 };
        return (order[a.slot] ?? 1) - (order[b.slot] ?? 1);
      })
  );
  const leftSeats    = $derived(seatSlots.filter(s => s.slot === 'left'));
  const rightSeats   = $derived(seatSlots.filter(s => s.slot === 'right'));
  const myBottomSeat = $derived(seatSlots.find(s => s.slot === 'bottom'));

  function seatName(engineIndex: number): string {
    return displayState.seats.find(s => s.enginePlayerIndex === engineIndex)?.displayName ?? `Player ${engineIndex + 1}`;
  }
</script>

<div class="table-layout">

  <!-- Row 1: top opponents -->
  {#if topRowSeats.length > 0}
    <div class="top-row">
      {#each topRowSeats as seat (seat.seatIndex)}
        <div data-player-token={seat.enginePlayerIndex}>
          <PlayerToken
            name={seat.displayName}
            isBot={seat.isBot}
            cardCount={seat.handSize}
            slot={seat.slot}
            score={displayState.publicState.scores[seat.enginePlayerIndex] ?? 0}
            isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
            isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
          />
        </div>
      {/each}
    </div>
  {/if}

  <!-- Row 2: left | trick | right -->
  <div class="middle-row">
    <div class="side-left">
      {#each leftSeats as seat (seat.seatIndex)}
        <div data-player-token={seat.enginePlayerIndex}>
          <PlayerToken
            name={seat.displayName}
            isBot={seat.isBot}
            cardCount={seat.handSize}
            slot="left"
            score={displayState.publicState.scores[seat.enginePlayerIndex] ?? 0}
            isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
            isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
          />
        </div>
      {/each}
    </div>

    <div class="table-center">
      <Trick
        trick={displayState.publicState.currentTrick}
        lastCompletedTrick={null}
        trickNum={displayState.publicState.trickNum}
        {seatName}
        seatSlot={(engineIdx) => getSlotForSeat(
          myEngineIndex >= 0 ? myEngineIndex : 0,
          engineIdx,
          displayState.seats.length
        )}
      />
    </div>

    <div class="side-right">
      {#each rightSeats as seat (seat.seatIndex)}
        <div data-player-token={seat.enginePlayerIndex}>
          <PlayerToken
            name={seat.displayName}
            isBot={seat.isBot}
            cardCount={seat.handSize}
            slot="right"
            score={displayState.publicState.scores[seat.enginePlayerIndex] ?? 0}
            isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
            isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
          />
        </div>
      {/each}
    </div>
  </div>

  <!-- Row 3: my seat + hand -->
  <div class="bottom-row">
    {#if myBottomSeat}
      <div data-player-token={myBottomSeat.enginePlayerIndex}>
        <PlayerToken
          name={myBottomSeat.displayName}
          isBot={myBottomSeat.isBot}
          cardCount={0}
          slot="bottom"
          score={displayState.publicState.scores[myBottomSeat.enginePlayerIndex] ?? 0}
          isCurrentTurn={isMyTurn}
          isDealer={myBottomSeat.enginePlayerIndex === displayState.publicState.dealer}
        />
      </div>
    {/if}

    <div data-hand-area={myEngineIndex}>
      {#if displayState.myHand.length > 0}
        <HandCards
          cards={displayState.myHand}
          legalMoves={displayState.legalMoves}
          {isMyTurn}
          {busy}
          onplay={(card) => onPlayMove({ type: 'PLAY_CARD', card })}
          sortFn={whistSort}
        />
      {/if}
    </div>
  </div>

</div>

<style>
  .table-layout {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex: 1;
    width: 100%;
  }

  .top-row {
    display: flex;
    justify-content: center;
    gap: 3rem;
  }

  .middle-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    width: 100%;
  }

  .side-left {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    gap: 1.5rem;
    flex-shrink: 0;
  }

  .table-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    min-width: 0;
  }

  .side-right {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1.5rem;
    flex-shrink: 0;
  }

  .bottom-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
  }
</style>
