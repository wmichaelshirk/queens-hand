<script lang="ts">
  import type { Move, GameState } from '$lib/gameTypes';
  import { getSlotForSeat } from '$lib/tableLayout';
  import { tarockSort } from '$lib/cardSort';
  import PlayerZone from './PlayerZone.svelte';
  import Trick from './Trick.svelte';
  import HandCards from './HandCards.svelte';
  import Pile from './Pile.svelte';
  import LastTrickPopover from './LastTrickPopover.svelte';

  interface Props {
    displayState: NonNullable<GameState>;
    myEngineIndex: number;
    isMyTurn: boolean;
    busy: boolean;
    onPlayMove: (move: Move) => void;
  }

  const { displayState, myEngineIndex, isMyTurn, busy, onPlayMove }: Props = $props();

  // Strohmandeln is always 2-player: one opponent at top, player at bottom.
  const opponentEngineIdx = $derived(myEngineIndex === 0 ? 1 : 0);

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

  const topSeat    = $derived(seatSlots.find(s => s.slot === 'top'));
  const myBottomSeat = $derived(seatSlots.find(s => s.slot === 'bottom'));
  const declarerEngineIdx = $derived(displayState.publicState.declarer);

  const nonCardMoves = $derived(
    (displayState.legalMoves ?? []).filter(m => m.type !== 'PLAY_CARD')
  );

  function seatName(engineIndex: number): string {
    return displayState.seats.find(s => s.enginePlayerIndex === engineIndex)?.displayName ?? `Player ${engineIndex + 1}`;
  }

  function moveLabel(move: Move): string {
    if (move.type === 'MAKE_BID') return move.bid;
    if (move.type === 'PASS_BID') return 'Pass';
    if (move.type === 'MAKE_ANNOUNCEMENT') return move.announcement;
    return '?';
  }
</script>

<div class="table-layout">

  <!-- Row 1: opponent token -->
  {#if topSeat}
    <div class="top-row">
      <div data-player-zone={topSeat.enginePlayerIndex}>
        <PlayerZone
          name={topSeat.displayName}
          isBot={topSeat.isBot}
          cardCount={topSeat.handSize}
          slot="top"
          enginePlayerIndex={topSeat.enginePlayerIndex}
          recentEvents={displayState.publicState.recentEvents}
          isCurrentTurn={topSeat.enginePlayerIndex === displayState.publicState.currentTurn}
          isDealer={topSeat.enginePlayerIndex === displayState.publicState.dealer}
          isDeclarer={topSeat.enginePlayerIndex === declarerEngineIdx}
          declarerActive={declarerEngineIdx !== undefined}
        />
      </div>
    </div>
  {/if}

  <!-- Row 2: opponent piles + trick (no left/right seats in 2-player) -->
  <div class="middle-row">
    <div class="table-center">
      {#if displayState.strawmen}
        {@const opponentPiles = displayState.strawmen[opponentEngineIdx] ?? []}
        <div class="strawmen-piles">
          {#each opponentPiles as pile, i (i)}
            <Pile {pile} playerIndex={opponentEngineIdx} pileIndex={i} />
          {/each}
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
  </div>

  <!-- Row 3: my token + my piles + bid buttons + hand -->
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

    {#if displayState.strawmen}
      {@const myPiles = displayState.strawmen[myEngineIndex] ?? []}
      <div class="strawmen-piles">
        {#each myPiles as pile, i (i)}
          {@const topCard = pile.topCard}
          {@const pilePlayable = isMyTurn && !!topCard && (displayState.legalMoves ?? []).some(
            m => m.type === 'PLAY_CARD' && m.card.suit === topCard.suit && m.card.rank === topCard.rank
          )}
          <Pile
            {pile}
            playable={pilePlayable}
            dimmed={isMyTurn && !pilePlayable}
            onclick={pilePlayable && !busy && topCard
              ? () => onPlayMove({ type: 'PLAY_CARD', card: topCard })
              : undefined}
            playerIndex={myEngineIndex}
            pileIndex={i}
          />
        {/each}
      </div>
    {/if}

    {#if isMyTurn && nonCardMoves.length > 0}
      <div class="move-section">
        <div class="move-prompt">Choose your action:</div>
        <div class="move-grid">
          {#each nonCardMoves as move, i (i)}
            <button class="move-btn" onclick={() => onPlayMove(move)} disabled={busy}>
              {moveLabel(move)}
            </button>
          {/each}
        </div>
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
  }

  .middle-row {
    display: flex;
    align-items: center;
    flex: 1;
    width: 100%;
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

  .bottom-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
  }

  .strawmen-piles {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .move-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }

  .move-prompt {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #666;
  }

  .move-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }

  .move-btn {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 0.75rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    min-width: 52px;
    text-align: center;
  }
  .move-btn:hover:not(:disabled) { background: #1a5a90; border-color: #e94560; }
  .move-btn:disabled { opacity: 0.45; cursor: default; }
</style>
