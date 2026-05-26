<script lang="ts">
  import type { AnimEvent } from '$lib/gameTypes';
  import SpeechBubble from './SpeechBubble.svelte';

  let {
    name,
    isBot,
    enginePlayerIndex,
    recentEvents = [],
    isDealer = false,
    isDeclarer = false,
    declarerActive = false,
    isCurrentTurn = false,
  }: {
    name: string;
    isBot: boolean;
    enginePlayerIndex: number;
    recentEvents?: AnimEvent[];
    isDealer?: boolean;
    isDeclarer?: boolean;
    declarerActive?: boolean;
    isCurrentTurn?: boolean;
  } = $props();

  let speechText = $state<string | null>(null);
  let _speechTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const announcements: string[] = [];
    let singleText: string | null = null;
    for (const ev of recentEvents) {
      if (ev.type === 'BID_MADE' && ev.player === enginePlayerIndex)
        singleText ??= ev.bid;
      else if (ev.type === 'BID_PASSED' && ev.player === enginePlayerIndex)
        singleText ??= 'Pass';
      else if (ev.type === 'CONTRACT_SET' && ev.declarer === enginePlayerIndex)
        singleText ??= ev.contract;
      else if (ev.type === 'ANNOUNCEMENT_MADE' && ev.player === enginePlayerIndex)
        announcements.push(ev.announcement === 'pass' ? 'Pass' : ev.announcement);
    }
    const text = announcements.length > 0 ? announcements.join(', ') : singleText;
    if (text !== null) {
      if (_speechTimer) clearTimeout(_speechTimer);
      speechText = text;
      _speechTimer = setTimeout(() => { speechText = null; }, 5000);
    }
    return () => { if (_speechTimer) clearTimeout(_speechTimer); };
  });
</script>

<div class="player-token" class:current-turn={isCurrentTurn}>
  <SpeechBubble text={speechText} />
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
  </div>
  <div class="player-name">{name}</div>
</div>

<style>
  .player-token {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    z-index: 2;
  }

  /* ── Avatar ──────────────────────────────────────────────────────── */

  .avatar-wrap {
    position: relative;
    width: 48px;
    height: 48px;
  }

  .avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #1a2a40;
    border: 2px solid #2a3a50;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
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
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }

  .badge-dealer {
    top: -7px;
    left: -7px;
    background: #7eb8e0;
    color: #0a1a2e;
    letter-spacing: 0.05em;
    border: 1px solid #5a9ec0;
  }

  .badge-role {
    top: -7px;
    right: -7px;
    background: #888;
    border: 1px solid #2a3a50;
  }

  /* ── Name ────────────────────────────────────────────────────────── */

  .player-name {
    background-color: #555;
    padding: 4px 6px;
    border-radius: 8px;
    font-size: 1rem;
    color: #bbb;
    letter-spacing: 0.06em;
    max-width: 10rem;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid black
  }
</style>
