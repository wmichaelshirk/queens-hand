<script lang="ts">
  interface PlayerBreakdown {
    player: number;
    role: string | null;
    items: { label: string; delta: number }[];
    total: number;
  }

  interface HandSummary {
    seatNames: string[];
    runningTotals: number[];
    breakdown: PlayerBreakdown[] | null;
    gameTarget: number | null;
    losers: number[] | null;
  }

  interface ContinuationState {
    votes: Record<string, 'continue' | 'quit'>;
    myVote: 'continue' | 'quit' | null;
  }

  interface Props {
    summary: HandSummary;
    continuation: ContinuationState | null;
    phase: string;
    busy?: boolean;
    onDismiss: () => void;
    onVote: (v: 'continue' | 'quit') => void;
  }

  let { summary, continuation, phase, busy = false, onDismiss, onVote }: Props = $props();

  const isGameOver = $derived(phase === 'game_over');
  // Must vote before dismissing during between-hands
  const mustVote = $derived(continuation !== null && !continuation.myVote);

  function deltaClass(delta: number): string {
    if (delta > 0) return 'pos';
    if (delta < 0) return 'neg';
    return 'neutral';
  }

  function fmtDelta(delta: number): string {
    if (delta === 0) return '—';
    return (delta > 0 ? '+' : '') + delta;
  }

  function seatName(player: number): string {
    return summary.seatNames[player] ?? `Player ${player + 1}`;
  }
</script>

<div class="modal-backdrop" onclick={mustVote ? undefined : onDismiss} role="presentation">
  <div class="modal-card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">

    <!-- Header -->
    <div class="modal-header">
      <span class="modal-title">{isGameOver ? 'Game over' : 'Hand complete'}</span>
      {#if !mustVote}
        <button class="close-btn" onclick={onDismiss} aria-label="Close">✕</button>
      {/if}
    </div>

    <!-- Breakdown grid -->
    <div class="breakdown">
      {#if summary.breakdown && summary.breakdown.length > 0}
        {#each summary.breakdown as pb (pb.player)}
          <div class="player-section">
            <div class="player-header">
              <span class="player-name">{seatName(pb.player)}</span>
              {#if pb.role}
                <span class="player-role">({pb.role})</span>
              {/if}
              <span class="player-total {deltaClass(pb.total)}">{fmtDelta(pb.total)}</span>
            </div>
            {#if pb.items.length > 0}
              <ul class="item-list">
                {#each pb.items as item}
                  <li class="item-row">
                    <span class="item-label">{item.label}</span>
                    <span class="item-delta {deltaClass(item.delta)}">{fmtDelta(item.delta)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      {:else}
        <p class="no-breakdown">No scoring this hand.</p>
      {/if}
    </div>

    <!-- Running scores -->
    <div class="scores-section">
      <div class="scores-label">Scores after this hand</div>
      <div class="scores-grid">
        {#each summary.runningTotals as total, i (i)}
          <div class="score-chip">
            <span class="score-name">{summary.seatNames[i] ?? `P${i + 1}`}</span>
            <span class="score-val">{total}</span>
          </div>
        {/each}
      </div>
      {#if summary.gameTarget !== null}
        <div class="game-target">Target: {summary.gameTarget} pts</div>
      {/if}
    </div>

    <!-- Game-over banner -->
    {#if isGameOver && summary.losers && summary.losers.length > 0}
      <div class="game-over-banner">
        {summary.losers.map(i => seatName(i)).join(' & ')}
        {summary.losers.length === 1 ? 'loses' : 'lose'}!
      </div>
    {/if}

    <!-- Actions -->
    <div class="modal-actions">
      {#if isGameOver}
        <button class="btn" onclick={onDismiss}>Leave Table</button>

      {:else if continuation}
        <!-- Vote chips showing all players' vote status -->
        <div class="vote-grid">
          {#each summary.seatNames as name, i (i)}
            {@const v = continuation.votes[String(i)]}
            <div class="vote-chip"
              class:voted-continue={v === 'continue'}
              class:voted-quit={v === 'quit'}
            >
              <span class="vote-name">{name}</span>
              <span class="vote-val">
                {v === 'continue' ? '✓ Continue' : v === 'quit' ? '✗ Quit' : '…'}
              </span>
            </div>
          {/each}
        </div>

        {#if !continuation.myVote}
          <div class="vote-buttons">
            <button class="btn vote-continue-btn" onclick={() => onVote('continue')} disabled={busy}>
              Continue
            </button>
            <button class="btn vote-quit-btn" onclick={() => onVote('quit')} disabled={busy}>
              Quit
            </button>
          </div>
        {:else}
          <p class="waiting-msg">Waiting for other players…</p>
        {/if}

      {:else}
        <button class="btn" onclick={onDismiss}>Got it</button>
      {/if}
    </div>

  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }

  .modal-card {
    background: #12213a;
    border: 1px solid #1e3a60;
    border-radius: 10px;
    width: 100%;
    max-width: 420px;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem 0.6rem;
    border-bottom: 1px solid #1e3a60;
  }

  .modal-title {
    font-size: 1rem;
    font-weight: 700;
    color: #e0e0e0;
    letter-spacing: 0.02em;
  }

  .close-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 1rem;
    cursor: pointer;
    padding: 0.1rem 0.3rem;
    line-height: 1;
  }
  .close-btn:hover { color: #999; }

  /* Breakdown */
  .breakdown {
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .player-section {
    background: #0d1c2e;
    border: 1px solid #1e3a60;
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
  }

  .player-header {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin-bottom: 0.25rem;
  }

  .player-name {
    font-weight: 700;
    color: #ccc;
    font-size: 0.92rem;
  }

  .player-role {
    color: #777;
    font-size: 0.75rem;
    font-style: italic;
  }

  .player-total {
    margin-left: auto;
    font-weight: 700;
    font-size: 0.95rem;
  }

  .item-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .item-row {
    display: flex;
    justify-content: space-between;
    padding: 0.05rem 0.5rem;
    font-size: 0.82rem;
  }

  .item-label { color: #888; }
  .item-delta { font-weight: 600; font-size: 0.82rem; }

  /* Delta colors — shared by player-total and item-delta */
  :global(.pos)     { color: #4caf50; }
  :global(.neg)     { color: #e94560; }
  :global(.neutral) { color: #666; }

  .no-breakdown {
    color: #666;
    font-style: italic;
    font-size: 0.85rem;
    text-align: center;
    padding: 0.5rem 0;
  }

  /* Scores */
  .scores-section {
    padding: 0.5rem 1rem 0.6rem;
    border-top: 1px solid #1e3a60;
  }

  .scores-label {
    font-size: 0.75rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.4rem;
  }

  .scores-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .score-chip {
    background: #0d1c2e;
    border: 1px solid #1e3a60;
    border-radius: 4px;
    padding: 0.2rem 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 52px;
  }

  .score-name { font-size: 0.7rem; color: #777; }
  .score-val  { font-size: 0.95rem; font-weight: 700; color: #ddd; }

  .game-target {
    margin-top: 0.35rem;
    font-size: 0.78rem;
    color: #666;
    font-style: italic;
  }

  /* Game-over banner */
  .game-over-banner {
    margin: 0 1rem;
    padding: 0.5rem 0.75rem;
    background: #1a0a12;
    border: 1px solid #e94560;
    border-radius: 6px;
    color: #e94560;
    font-weight: 700;
    font-size: 0.9rem;
    text-align: center;
  }

  /* Actions */
  .modal-actions {
    padding: 0.75rem 1rem 0.9rem;
    border-top: 1px solid #1e3a60;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .btn {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover    { background: #1a4a80; }
  .btn:disabled { opacity: 0.45; cursor: default; }

  .vote-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.25rem;
  }

  .vote-chip {
    background: #0d1c2e;
    border: 1px solid #2a3a50;
    border-radius: 5px;
    padding: 0.2rem 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 72px;
  }
  .vote-chip.voted-continue { border-color: #4caf50; background: #0f2a1f; }
  .vote-chip.voted-quit     { border-color: #e94560; background: #1e1020; }

  .vote-name { font-size: 0.7rem; color: #888; }
  .vote-val  { font-size: 0.82rem; font-weight: 600; color: #ccc; }
  .vote-chip.voted-continue .vote-val { color: #4caf50; }
  .vote-chip.voted-quit .vote-val     { color: #e94560; }

  .vote-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .vote-continue-btn {
    flex: 1;
    background: #0f2a1f;
    border-color: #4caf50;
    color: #4caf50;
  }
  .vote-continue-btn:hover:not(:disabled) { background: #1a5a30; }

  .vote-quit-btn {
    flex: 1;
    background: #1e1020;
    border-color: #e94560;
    color: #e94560;
  }
  .vote-quit-btn:hover:not(:disabled) { background: #2a1030; }

  .waiting-msg {
    color: #666;
    font-size: 0.85rem;
    font-style: italic;
    text-align: center;
    margin: 0;
  }
</style>
