<script lang="ts">
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { page } from "$app/stores";
  import {
    isLoggedIn, guestSession, signOut,
    convex, watchQuery,
  } from "$lib/convex";

  const gameId = $derived($page.params.gameId);

  // ── Auth guard ─────────────────────────────────────────────────────────────────

  $effect(() => {
    if (browser && !$isLoggedIn) goto("/login");
  });

  // ── Player record ──────────────────────────────────────────────────────────────

  const me = watchQuery<{ _id: string; displayName: string } | null>("auth:getMe" as any, {});

  let currentPlayer = $derived(
    $me ?? ($guestSession
      ? { _id: $guestSession.playerId, displayName: $guestSession.displayName }
      : null)
  );

  // ── Table data ─────────────────────────────────────────────────────────────────

  type TableSeat = { seatIndex: number; playerId: string; displayName: string; isBot: boolean };
  type TableData = {
    _id: string;
    gameType: "slobberhannes" | "strohmandeln";
    status: "waiting" | "active" | "finished";
    seatCount: number;
    createdAt: number;
    seats: TableSeat[];
  };

  const GAME_NAMES: Record<string, string> = {
    slobberhannes: "Slobberhannes",
    strohmandeln: "Strohmandeln",
  };

  // watchQuery is constructed once; gameId won't change for this page
  const tableData = watchQuery<TableData | null>("games:getTable" as any, { gameId });

  const myId = $derived(currentPlayer?._id);
  const isSeated = $derived(
    $tableData?.seats.some((s) => s.playerId === myId) ?? false
  );
  const isFull = $derived(
    ($tableData?.seats.length ?? 0) >= ($tableData?.seatCount ?? 4)
  );

  // ── Table chat ─────────────────────────────────────────────────────────────────

  type TableMsg = { _id: string; playerId: string; displayName: string; text: string; ts: number };

  const messages = watchQuery<TableMsg[]>("games:getTableMessages" as any, { gameId });

  let chatText = $state("");
  let chatEl = $state<HTMLDivElement | undefined>(undefined);

  $effect(() => {
    if ($messages && chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  });

  async function sendMessage() {
    const text = chatText.trim();
    if (!text) return;
    chatText = "";
    await convex.mutation("games:sendTableMessage" as any, {
      gameId,
      text,
      guestUserId: $guestSession?.userId,
    });
  }

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  // ── Join ───────────────────────────────────────────────────────────────────────

  let joining = $state(false);

  async function joinTable() {
    if (joining) return;
    joining = true;
    try {
      await convex.mutation("games:joinTable" as any, {
        gameId,
        guestUserId: $guestSession?.userId,
      });
    } finally {
      joining = false;
    }
  }
</script>

{#if $isLoggedIn}
<div class="shell">

  <!-- Header -->
  <header class="site-header">
    <div class="header-left">
      <button class="back-btn" onclick={() => goto("/")}>← Lobby</button>
      {#if $tableData}
        <span class="table-title">{GAME_NAMES[$tableData.gameType]}</span>
        <span class="status-badge" class:live={$tableData.status === "active"}>
          {$tableData.status === "active" ? "live" : $tableData.status === "finished" ? "finished" : "waiting"}
        </span>
      {/if}
    </div>
    <div class="header-right">
      {#if currentPlayer}
        <span class="player-name">{currentPlayer.displayName}</span>
      {/if}
      <button class="btn sm" onclick={signOut}>Sign out</button>
    </div>
  </header>

  <!-- Body -->
  <div class="body">

    <!-- Left: game area -->
    <main class="game-area">
      {#if !$tableData}
        <p class="muted centered">Loading table…</p>

      {:else if $tableData.status === "waiting"}
        <div class="waiting-room">
          <h2 class="waiting-title">{GAME_NAMES[$tableData.gameType]}</h2>
          <p class="waiting-sub">Waiting for players…</p>

          <div class="seat-grid">
            {#each Array($tableData.seatCount) as _, i}
              {@const seat = $tableData.seats.find((s) => s.seatIndex === i)}
              <div class="seat-slot" class:filled={!!seat} class:mine={seat?.playerId === myId}>
                <div class="seat-index">Seat {i + 1}</div>
                {#if seat}
                  <div class="seat-name">{seat.displayName}{seat.isBot ? " 🤖" : ""}</div>
                {:else}
                  <div class="seat-empty">Empty</div>
                  {#if !isSeated && !isFull}
                    <button class="btn accent-sm" onclick={joinTable} disabled={joining}>
                      {joining ? "Joining…" : "Sit here"}
                    </button>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>

          {#if isSeated && $tableData.seats.length < $tableData.seatCount}
            <p class="waiting-hint">
              Waiting for {$tableData.seatCount - $tableData.seats.length} more
              player{$tableData.seatCount - $tableData.seats.length === 1 ? "" : "s"}…
            </p>
          {/if}
        </div>

      {:else if $tableData.status === "active"}
        <div class="game-placeholder">
          <p class="muted centered">Game in progress — table view coming in Phase 1.</p>
        </div>

      {:else}
        <div class="game-placeholder">
          <p class="muted centered">This game has ended.</p>
          <button class="btn accent-sm" onclick={() => goto("/")}>Back to lobby</button>
        </div>
      {/if}
    </main>

    <!-- Right: players + chat -->
    <aside class="sidebar">

      <!-- Players at the table -->
      <section class="sidebar-section players-section">
        <h3 class="label">At the table</h3>
        {#if $tableData}
          <ul class="player-list">
            {#each Array($tableData.seatCount) as _, i}
              {@const seat = $tableData.seats.find((s) => s.seatIndex === i)}
              <li class="player-row" class:mine={seat?.playerId === myId} class:empty={!seat}>
                <span class="seat-num">{i + 1}</span>
                {#if seat}
                  <span class="player-label">
                    {seat.displayName}{seat.isBot ? " 🤖" : ""}
                    {#if seat.playerId === myId}<span class="you">(you)</span>{/if}
                  </span>
                {:else}
                  <span class="empty-label">—</span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Loading…</p>
        {/if}
      </section>

      <!-- Chat -->
      <section class="sidebar-section chat-section">
        <h3 class="label">Table chat</h3>
        <div class="messages" bind:this={chatEl}>
          {#if $messages && $messages.length > 0}
            {#each $messages as msg (msg._id)}
              <div class="msg" class:own={msg.playerId === currentPlayer?._id}>
                <span class="msg-name">{msg.displayName}</span>
                <span class="msg-text">{msg.text}</span>
              </div>
            {/each}
          {:else}
            <p class="muted">No messages yet.</p>
          {/if}
        </div>

        <form class="chat-form" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
          <input
            class="input"
            placeholder="Say something…"
            bind:value={chatText}
            onkeydown={onChatKeydown}
          />
          <button type="submit" class="btn accent-sm">Send</button>
        </form>
      </section>

    </aside>
  </div><!-- .body -->
</div><!-- .shell -->
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Header ──────────────────────────────────────────────────────────────── */
  .site-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1.25rem;
    background: #12192e;
    border-bottom: 1px solid #0f3460;
    flex-shrink: 0;
    gap: 1rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .back-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0;
  }
  .back-btn:hover { color: #ccc; }

  .table-title {
    font-size: 1rem;
    font-weight: 700;
    color: #e94560;
  }

  .status-badge {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: #2a3a50;
    color: #888;
    border-radius: 4px;
    padding: 0.15rem 0.45rem;
  }
  .status-badge.live { background: #1a3a1a; color: #4caf50; }

  .player-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ccc;
  }

  /* ── Body layout ─────────────────────────────────────────────────────────── */
  .body {
    display: grid;
    grid-template-columns: 1fr 280px;
    flex: 1;
    overflow: hidden;
  }

  /* ── Game area ───────────────────────────────────────────────────────────── */
  .game-area {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 2rem;
  }

  .waiting-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    max-width: 480px;
    width: 100%;
  }

  .waiting-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #e94560;
  }

  .waiting-sub {
    color: #888;
    font-size: 0.9rem;
  }

  .seat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    width: 100%;
  }

  .seat-slot {
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
    text-align: center;
  }

  .seat-slot.filled { border-color: #1a4a80; }
  .seat-slot.mine   { border-color: #e94560; background: #1e1020; }

  .seat-index { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  .seat-name  { font-size: 0.9rem; font-weight: 600; color: #ddd; }
  .seat-empty { font-size: 0.85rem; color: #444; }

  .waiting-hint {
    color: #666;
    font-size: 0.85rem;
    font-style: italic;
  }

  .game-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────────── */
  .sidebar {
    display: flex;
    flex-direction: column;
    background: #16213e;
    border-left: 1px solid #0f3460;
    overflow: hidden;
  }

  .sidebar-section {
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .players-section {
    flex-shrink: 0;
    border-bottom: 1px solid #0f3460;
  }

  .chat-section {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
    flex-shrink: 0;
  }

  /* ── Players list ────────────────────────────────────────────────────────── */
  .player-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .player-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
  }

  .player-row.empty { opacity: 0.4; }

  .seat-num {
    font-size: 0.7rem;
    color: #555;
    background: #0d1f38;
    border-radius: 3px;
    padding: 0.1rem 0.35rem;
    flex-shrink: 0;
  }

  .player-row.mine .player-label { color: #e94560; }

  .player-label { color: #ccc; }
  .empty-label  { color: #444; }

  .you {
    font-size: 0.72rem;
    color: #666;
    margin-left: 0.2rem;
  }

  /* ── Chat ────────────────────────────────────────────────────────────────── */
  .messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.25rem 0;
    min-height: 0;
  }

  .msg {
    display: flex;
    gap: 0.4rem;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .msg.own .msg-name { color: #e94560; }

  .msg-name {
    font-weight: 600;
    color: #888;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .msg-text {
    color: #ddd;
    word-break: break-word;
  }

  .chat-form {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .chat-form .input {
    flex: 1;
    min-width: 0;
  }

  /* ── Shared ──────────────────────────────────────────────────────────────── */
  .input {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 0.65rem;
    font-size: 0.85rem;
    outline: none;
    box-sizing: border-box;
  }

  .input:focus { border-color: #e94560; }

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
  .btn.sm       { padding: 0.25rem 0.6rem; font-size: 0.8rem; }

  .btn.accent-sm {
    background: #e94560;
    border-color: #e94560;
    color: #fff;
    padding: 0.35rem 0.75rem;
    font-size: 0.82rem;
  }

  .btn.accent-sm:hover    { background: #c73652; }
  .btn.accent-sm:disabled { opacity: 0.45; cursor: default; }

  .muted {
    color: #555;
    font-size: 0.85rem;
    font-style: italic;
  }

  .centered { text-align: center; }
</style>
