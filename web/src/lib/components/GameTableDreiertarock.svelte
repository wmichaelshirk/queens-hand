<script lang="ts">
  import type { Move, Card, GameState } from '$lib/gameTypes';
  import { getSlotForSeat } from '$lib/tableLayout';
  import { tarockSort } from '$lib/cardSort';
  import PlayerZone from './PlayerZone.svelte';
  import Trick from './Trick.svelte';
  import HandCards from './HandCards.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import LastTrickPopover from './LastTrickPopover.svelte';

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
  const declarerEngineIdx = $derived(displayState.publicState.declarer);

  // Talon exchange: choose first or second group
  const talonMoves = $derived(
    isMyTurn
      ? (displayState.legalMoves ?? []).filter(
          (m): m is { type: 'CHOOSE_TALON'; choice: 'first' | 'second' } => m.type === 'CHOOSE_TALON'
        )
      : []
  );

  // Discard phase: cards that may legally be discarded
  const legalDiscardCards = $derived(
    isMyTurn
      ? (displayState.legalMoves ?? [])
          .filter((m): m is { type: 'DISCARD_CARD'; card: Card } => m.type === 'DISCARD_CARD')
          .map(m => m.card)
      : []
  );
  const inDiscardPhase = $derived(legalDiscardCards.length > 0);

  let selectedDiscards = $state<Card[]>([]);

  $effect(() => {
    // Clear selection when entering a fresh discard phase
    if (inDiscardPhase) selectedDiscards = [];
  });

  function toggleDiscard(card: Card) {
    const idx = selectedDiscards.findIndex(c => c.suit === card.suit && c.rank === card.rank);
    if (idx >= 0) {
      selectedDiscards = selectedDiscards.filter((_, i) => i !== idx);
    } else if (selectedDiscards.length < 3) {
      selectedDiscards = [...selectedDiscards, card];
    }
  }

  function isDiscardSelected(card: Card): boolean {
    return selectedDiscards.some(c => c.suit === card.suit && c.rank === card.rank);
  }

  function isDiscardLegal(card: Card): boolean {
    return legalDiscardCards.some(c => c.suit === card.suit && c.rank === card.rank);
  }

  function submitDiscards() {
    if (selectedDiscards.length !== 3) return;
    onPlayMove({ type: 'SUBMIT_DISCARDS', cards: selectedDiscards });
  }

  function seatName(engineIndex: number): string {
    return displayState.seats.find(s => s.enginePlayerIndex === engineIndex)?.displayName ?? `Player ${engineIndex + 1}`;
  }
</script>

<div class="table-layout">

  <!-- Row 1: top opponents -->
  {#if topRowSeats.length > 0}
    <div class="top-row">
      {#each topRowSeats as seat (seat.seatIndex)}
        <div data-player-zone={seat.enginePlayerIndex}>
          <PlayerZone
            name={seat.displayName}
            isBot={seat.isBot}
            cardCount={seat.handSize}
            slot={seat.slot}
            enginePlayerIndex={seat.enginePlayerIndex}
            recentEvents={displayState.publicState.recentEvents}
            isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
            isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
            isDeclarer={seat.enginePlayerIndex === declarerEngineIdx}
            declarerActive={declarerEngineIdx !== undefined}
          />
        </div>
      {/each}
    </div>
  {/if}

  <!-- Row 2: left | trick | right -->
  <div class="middle-row">
    <div class="side-left">
      {#each leftSeats as seat (seat.seatIndex)}
        <div data-player-zone={seat.enginePlayerIndex}>
          <PlayerZone
            name={seat.displayName}
            isBot={seat.isBot}
            cardCount={seat.handSize}
            slot="left"
            enginePlayerIndex={seat.enginePlayerIndex}
            recentEvents={displayState.publicState.recentEvents}
            isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
            isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
            isDeclarer={seat.enginePlayerIndex === declarerEngineIdx}
            declarerActive={declarerEngineIdx !== undefined}
          />
        </div>
      {/each}
    </div>

    <div class="table-center">
      <!-- Talon: face-down piles during bidding, revealed groups during exchange -->
      {#if displayState.talon}
        {@const talon = displayState.talon}
        {@const canChoose = isMyTurn && talonMoves.length > 0}
        <div class="talon-area">
          <div class="talon-label">
            {talon.revealed
              ? (talonMoves.length > 0 ? 'Choose a talon group' : 'Rejected talon')
              : 'Talon'}
          </div>
          <div class="talon-groups">
            {#if !talon.revealed}
              <div class="talon-group"><PlayingCard /><PlayingCard /><PlayingCard /></div>
              <div class="talon-group"><PlayingCard /><PlayingCard /><PlayingCard /></div>
            {:else}
              {#each ([0, 1] as const) as gi}
                {#if talon.groups[gi]?.length}
                  {@const move = talonMoves.find(m => m.choice === (gi === 0 ? 'first' : 'second'))}
                  <div
                    class="talon-group"
                    class:talon-choosable={canChoose && !!move}
                    role={canChoose && move ? 'button' : undefined}
                    tabindex={canChoose && move ? 0 : undefined}
                    onclick={canChoose && move ? () => onPlayMove(move) : undefined}
                    onkeydown={canChoose && move ? (e) => e.key === 'Enter' && !busy && onPlayMove(move) : undefined}
                  >
                    {#each talon.groups[gi] as card}
                      <PlayingCard {card} />
                    {/each}
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        </div>
      {/if}

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

      <LastTrickPopover
        lastTrick={displayState.publicState.lastCompletedTrick}
        playerNames={displayState.seats.map(s => s.displayName)}
      />
    </div>

    <div class="side-right">
      {#each rightSeats as seat (seat.seatIndex)}
        <div data-player-zone={seat.enginePlayerIndex}>
          <PlayerZone
            name={seat.displayName}
            isBot={seat.isBot}
            cardCount={seat.handSize}
            slot="right"
            enginePlayerIndex={seat.enginePlayerIndex}
            recentEvents={displayState.publicState.recentEvents}
            isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
            isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
            isDeclarer={seat.enginePlayerIndex === declarerEngineIdx}
            declarerActive={declarerEngineIdx !== undefined}
          />
        </div>
      {/each}
    </div>
  </div>

  <!-- Row 3: my seat + bid/announce buttons + hand -->
  <div class="bottom-row">
    {#if myBottomSeat}
      <div data-player-zone={myBottomSeat.enginePlayerIndex}>
        <PlayerZone
          name={myBottomSeat.displayName}
          isBot={myBottomSeat.isBot}
          cardCount={0}
          slot="bottom"
          enginePlayerIndex={myBottomSeat.enginePlayerIndex}
          recentEvents={displayState.publicState.recentEvents}
          isCurrentTurn={isMyTurn}
          isDealer={myBottomSeat.enginePlayerIndex === displayState.publicState.dealer}
          isDeclarer={myBottomSeat.enginePlayerIndex === declarerEngineIdx}
          declarerActive={declarerEngineIdx !== undefined}
        />
      </div>
    {/if}

    <!-- Discard phase: toggle cards in hand then submit all 3 -->
    {#if inDiscardPhase}
      <div class="discard-prompt">Select 3 cards to discard</div>
      <div class="discard-footer">
        <button
          class="discard-btn"
          onclick={submitDiscards}
          disabled={busy || selectedDiscards.length !== 3}
        >
          Discard ({selectedDiscards.length}/3)
        </button>
      </div>
    {/if}

    <div data-hand-area={myEngineIndex}>
      {#if displayState.myHand.length > 0}
        <HandCards
          cards={displayState.myHand}
          legalMoves={inDiscardPhase ? [] : displayState.legalMoves}
          {isMyTurn}
          {busy}
          onplay={(card) => {
            if (inDiscardPhase) {
              if (isDiscardLegal(card)) toggleDiscard(card);
            } else {
              onPlayMove({ type: 'PLAY_CARD', card });
            }
          }}
          discardMode={inDiscardPhase}
          discardSelected={selectedDiscards}
          discardLegal={legalDiscardCards}
          sortFn={tarockSort}
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

  .talon-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .talon-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #888;
  }

  .talon-groups {
    display: flex;
    gap: 1.25rem;
    align-items: center;
  }

  .talon-group {
    display: flex;
    gap: 4px;
    padding: 6px;
    border-radius: 8px;
    border: 1px solid transparent;
  }

  .talon-group.talon-choosable {
    cursor: pointer;
    border-color: #1a4a80;
  }

  .talon-group.talon-choosable:hover {
    border-color: #e94560;
    background: rgba(233, 69, 96, 0.08);
  }

  .discard-prompt {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #a06030;
  }

  .discard-footer {
    display: flex;
    justify-content: center;
  }

  .discard-btn {
    background: #3a1a08;
    border: 1px solid #b06030;
    border-radius: 6px;
    color: #e0a060;
    padding: 0.5rem 1.1rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  .discard-btn:hover:not(:disabled) { background: #5a2a10; border-color: #e08040; }
  .discard-btn:disabled { opacity: 0.45; cursor: default; }
</style>
