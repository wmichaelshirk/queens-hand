<script lang="ts">
  let {
    name,
    isBot,
    score,
    isDealer = false,
    isDeclarer = false,
    declarerActive = false,
    isCurrentTurn = false,
  }: {
    name: string;
    isBot: boolean;
    score?: number;
    isDealer?: boolean;
    isDeclarer?: boolean;
    declarerActive?: boolean;
    isCurrentTurn?: boolean;
  } = $props();
</script>

<div class="player-token" class:current-turn={isCurrentTurn}>
  <div class="avatar-wrap">
    <div class="avatar">{isBot ? '🤖' : '?'}</div>
    {#if isDealer}
      <div class="badge badge-dealer">D</div>
    {/if}
    {#if isDeclarer}
      <div class="badge badge-role">⚔️</div>
    {:else if declarerActive}
      <div class="badge badge-role">🛡️</div>
    {/if}
    {#if score !== undefined}
      <div class="badge badge-score">{score}</div>
    {/if}
  </div>
  <div class="player-name">{name}</div>
</div>

<style>
  .player-token {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  /* ── Avatar ──────────────────────────────────────────────────────── */

  .avatar-wrap {
    position: relative;
    width: 40px;
    height: 40px;
    margin-bottom: 10px; /* clearance for score badge below */
  }

  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #1a2a40;
    border: 2px solid #2a3a50;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    color: #555;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .current-turn .avatar {
    border-color: #e94560;
    box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.3);
  }

  /* ── Badges ──────────────────────────────────────────────────────── */

  .badge {
    position: absolute;
    min-width: 18px;
    height: 18px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.5rem;
    font-weight: 700;
    padding: 0 3px;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }

  .badge-dealer {
    top: -5px;
    left: -5px;
    background: #7eb8e0;
    color: #0a1a2e;
    letter-spacing: 0.05em;
  }

  .badge-role {
    top: -5px;
    right: -5px;
    background: #1a2a40;
    border: 1px solid #2a3a50;
    font-size: 0.7rem;
  }

  .badge-score {
    bottom: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a2a40;
    border: 1px solid #2a3a50;
    color: #aaa;
    font-size: 0.55rem;
    min-width: 20px;
    padding: 1px 4px;
    white-space: nowrap;
  }

  /* ── Name ────────────────────────────────────────────────────────── */

  .player-name {
    font-size: 0.62rem;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    max-width: 68px;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
