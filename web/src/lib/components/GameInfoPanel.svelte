<script lang="ts">
  interface Props {
    phase: string;
    contract: string | null | undefined;
    currentBid: string | null | undefined;
    declarer: number | null | undefined;
    announcements: { name: string; player: number }[];
    kontraItems: { target: string; multiplier: number }[];
    scores: number[];
    playerNames: string[];
  }

  const {
    phase,
    contract,
    currentBid,
    declarer,
    announcements,
    kontraItems,
    scores,
    playerNames,
  }: Props = $props();

  const activeKontras = $derived(kontraItems.filter(k => k.multiplier > 1));

  const contractLabel = $derived.by(() => {
    if (phase === 'bidding') return currentBid ? `Bid: ${currentBid}` : 'Bidding…';
    if (phase === 'contract_choice') return 'Choose contract';
    return contract ?? null;
  });

  const declarerName = $derived(
    declarer != null ? (playerNames[declarer] ?? null) : null
  );

  const showGameInfo = $derived(contractLabel !== null || announcements.length > 0);
</script>

<div class="game-info-panel">
  {#if showGameInfo}
    <div class="game-info-left">
      {#if contractLabel}
        <span class="contract-label">{contractLabel}</span>
        {#if declarerName && phase !== 'bidding'}
          <span class="declarer-name">⚔️ {declarerName}</span>
        {/if}
      {/if}
      {#each announcements as ann (ann.name + ann.player)}
        <span class="chip chip-ann">{ann.name}</span>
      {/each}
      {#each activeKontras as k (k.target + k.multiplier)}
        <span class="chip chip-kontra">×{k.multiplier} {k.target}</span>
      {/each}
    </div>
  {/if}

  <div class="scoreboard">
    {#each playerNames as name, i (i)}
      <div class="score-entry" class:is-declarer={declarer === i}>
        <span class="score-name">{name}</span>
        <span class="score-val">{scores[i] ?? 0}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .game-info-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    padding: 0.25rem 0.5rem;
    background: rgba(10, 26, 46, 0.6);
    border: 1px solid #1a3050;
    border-radius: 8px;
    min-height: 2rem;
    box-sizing: border-box;
  }

  /* ── Left cluster ──────────────────────────────────────────────── */

  .game-info-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }

  .contract-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: #ccc;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .declarer-name {
    font-size: 0.8rem;
    color: #e0a060;
    white-space: nowrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .chip-ann {
    background: #0f3460;
    border: 1px solid #1a5090;
    color: #7eb8e0;
  }

  .chip-kontra {
    background: #3a1a08;
    border: 1px solid #b06030;
    color: #e0a060;
  }

  /* ── Scoreboard ────────────────────────────────────────────────── */

  .scoreboard {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .score-entry {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 1px 6px;
    background: #0a1a2e;
    border: 1px solid #1a2a40;
    border-radius: 6px;
  }

  .score-entry.is-declarer {
    border-color: #b06030;
    background: #1a1008;
  }

  .score-name {
    font-size: 0.7rem;
    color: #888;
    max-width: 6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .score-val {
    font-size: 0.8rem;
    font-weight: 700;
    color: #ccc;
    min-width: 1.5rem;
    text-align: right;
  }
</style>
