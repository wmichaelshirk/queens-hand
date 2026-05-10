<script lang="ts">
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import {
    isAuthenticated, isLoggedIn, guestSession,
    signOut, convex, watchQuery, convexAuthenticated, authResolving,
  } from "$lib/convex";

  // ── Auth guard ────────────────────────────────────────────────────────────────

  $effect(() => {
    if (browser && !$isLoggedIn && !$authResolving) {
      goto("/login");
    }
  });

  // ── Player record ─────────────────────────────────────────────────────────────

  $effect(() => {
    if ($convexAuthenticated) {
      convex.mutation("auth:ensurePlayer" as any, {}).catch(() => {});
    }
  });

  const me = watchQuery<{ _id: string; displayName: string } | null>("auth:getMe" as any, {});

  let currentPlayer = $derived(
    $me ?? ($guestSession
      ? { _id: $guestSession.playerId, displayName: $guestSession.displayName }
      : null)
  );

  // ── Presence ──────────────────────────────────────────────────────────────────

  let presenceInterval: ReturnType<typeof setInterval>;

  $effect(() => {
    if ($isLoggedIn) {
      const guestUserId = $guestSession?.userId;
      convex.mutation("lobby:ping" as any, { guestUserId }).catch(() => {});
      presenceInterval = setInterval(() => {
        convex.mutation("lobby:ping" as any, { guestUserId }).catch(() => {});
      }, 30_000);
    }
    return () => clearInterval(presenceInterval);
  });

  const onlinePlayers = watchQuery<Array<{ _id: string; displayName: string }>>(
    "lobby:getOnline" as any, {}
  );

  // ── Display name editing ──────────────────────────────────────────────────────

  let editingName = $state(false);
  let newName = $state("");

  function startEditName() {
    newName = currentPlayer?.displayName ?? "";
    editingName = true;
  }

  async function saveName() {
    if (!newName.trim()) return;
    await convex.mutation("auth:updateDisplayName" as any, { displayName: newName.trim() });
    editingName = false;
  }

  // ── Chat ──────────────────────────────────────────────────────────────────────

  const messages = watchQuery<
    Array<{ _id: string; playerId: string; displayName: string; text: string; ts: number }>
  >("lobby:getMessages" as any, {});

  let chatText = $state("");
  let chatEl = $state<HTMLDivElement | undefined>(undefined);

  $effect(() => {
    if ($messages && chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  });

  async function sendMessage() {
    const text = chatText.trim();
    if (!text) return;
    chatText = "";
    await convex.mutation("lobby:sendMessage" as any, {
      text,
      guestUserId: $guestSession?.userId,
    });
  }

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  // ── Tables ────────────────────────────────────────────────────────────────────

  type TableSeat = { seatIndex: number; playerId: string; displayName: string; isBot: boolean };
  type ActiveTable = {
    _id: string;
    gameType: "slobberhannes" | "strohmandeln";
    status: "waiting" | "active";
    seatCount: number;
    createdAt: number;
    seats: TableSeat[];
  };

  const activeTables = watchQuery<ActiveTable[]>("games:listActiveTables" as any, {});

  const GAME_NAMES: Record<string, string> = {
    slobberhannes: "Slobberhannes",
    strohmandeln: "Strohmandeln",
  };

  let newTableGameType = $state<"slobberhannes" | "strohmandeln">("slobberhannes");
  let creatingTable = $state(false);

  async function createTable() {
    if (creatingTable) return;
    creatingTable = true;
    try {
      const gameId = await convex.mutation("games:createTable" as any, {
        gameType: newTableGameType,
        guestUserId: $guestSession?.userId,
      });
      goto(`/table/${gameId}`);
    } finally {
      creatingTable = false;
    }
  }
</script>

{#if $isLoggedIn}
<div class="shell">

  <!-- Header -->
  <header class="site-header">
    <span class="site-title">The Queen's Hand</span>
    <div class="header-right">
      {#if currentPlayer}
        <div class="me">
          {#if $guestSession}
            <span class="name">{currentPlayer.displayName}</span>
            <span class="badge">guest</span>
          {:else if editingName}
            <input class="input sm" bind:value={newName} onkeydown={(e) => e.key === "Enter" && saveName()} />
            <button class="link-btn" onclick={saveName}>save</button>
          {:else}
            <span class="name">{currentPlayer.displayName}</span>
            <button class="link-btn" onclick={startEditName}>edit</button>
          {/if}
        </div>
      {/if}
      <button class="btn sm" onclick={signOut}>Sign out</button>
    </div>
  </header>

  <div class="lobby">

  <!-- Column 1: Players online -->
  <aside class="pane players">
    <h3 class="label">Online now</h3>
    <ul class="player-list">
      {#if $onlinePlayers && $onlinePlayers.length > 0}
        {#each $onlinePlayers as p (p._id)}
          <li class:me={p._id === currentPlayer?._id}>
            {p.displayName}
            {#if p._id === currentPlayer?._id}<span class="you">(you)</span>{/if}
          </li>
        {/each}
      {:else}
        <li class="muted">No one else is here yet.</li>
      {/if}
    </ul>
  </aside>

  <!-- Column 2: Chat -->
  <main class="pane chat">
    <h3 class="label">Lobby</h3>

    <div class="messages" bind:this={chatEl}>
      {#if $messages && $messages.length > 0}
        {#each $messages as msg (msg._id)}
          <div class="msg" class:own={msg.playerId === currentPlayer?._id}>
            <span class="msg-name">{msg.displayName}</span>
            <span class="msg-text">{msg.text}</span>
          </div>
        {/each}
      {:else}
        <p class="muted">No messages yet. Say hi!</p>
      {/if}
    </div>

    <form class="chat-form" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
      <input class="input" placeholder="Say something…" bind:value={chatText} onkeydown={onChatKeydown} />
      <button type="submit" class="btn accent-sm">Send</button>
    </form>
  </main>

  <!-- Column 3: Tables -->
  <section class="pane tables">
    <h3 class="label">Tables</h3>

    <div class="table-list">

      <!-- Create card -->
      <div class="table-card create">
        <div class="card-title">New Table</div>
        <div class="game-picker">
          <button
            class="pick-btn"
            class:selected={newTableGameType === "slobberhannes"}
            onclick={() => newTableGameType = "slobberhannes"}
          ><span class="pick-icon">Q♣</span> Slobberhannes</button>
          <button
            class="pick-btn"
            class:selected={newTableGameType === "strohmandeln"}
            onclick={() => newTableGameType = "strohmandeln"}
          ><span class="pick-icon">★</span> Strohmandeln</button>
        </div>
        <div class="card-footer">
          <button class="btn accent-sm" onclick={createTable} disabled={creatingTable}>
            {creatingTable ? "Creating…" : "Create Table"}
          </button>
        </div>
      </div>

      <!-- Active tables -->
      {#if $activeTables}
        {#each $activeTables as table (table._id)}
          {@const myId = currentPlayer?._id}
          {@const isSeated = table.seats.some((s) => s.playerId === myId)}
          <div class="table-card">
            <div class="card-header">
              <span class="game-icon-sm">{table.gameType === "slobberhannes" ? "Q♣" : "★"}</span>
              <span class="card-title">{GAME_NAMES[table.gameType]}</span>
              <span class="status" class:live={table.status === "active"}>
                {table.status === "active" ? "live" : "waiting"}
              </span>
            </div>
            <div class="seats">
              {#each Array(table.seatCount) as _, i}
                {@const seat = table.seats.find((s) => s.seatIndex === i)}
                <span class="seat" class:filled={!!seat} class:mine={seat?.playerId === myId} class:ready={seat?.ready}>
                  {seat ? seat.displayName : "─"}
                </span>
              {/each}
            </div>
            <div class="card-footer">
              <span class="seat-count">
                {table.seats.length}/{table.seatCount}
                {#if table.minSeatCount < table.seatCount}
                  <span class="seat-min">(min {table.minSeatCount})</span>
                {/if}
              </span>
              <button class="btn accent-sm" onclick={() => goto(`/table/${table._id}`)}>
                {isSeated ? "Enter" : "Watch"}
              </button>
            </div>
          </div>
        {/each}
      {/if}

    </div>
  </section>

  </div><!-- .lobby -->
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
  }

  .site-title {
    font-size: 1rem;
    font-weight: 700;
    color: #e94560;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .lobby {
    display: grid;
    grid-template-columns: 200px 400px 1fr;
    flex: 1;
    overflow: hidden;
  }

  /* ── Panes ───────────────────────────────────────────────────────────────── */
  .pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .pane.players {
    background: #16213e;
    border-right: 1px solid #0f3460;
    padding: 1.25rem 1rem;
    gap: 1rem;
    overflow-y: auto;
  }

  .pane.chat {
    padding: 1.25rem;
    gap: 0.75rem;
  }

  .pane.tables {
    background: #16213e;
    border-left: 1px solid #0f3460;
    padding: 1.25rem 1rem;
    gap: 1rem;
    overflow-y: auto;
  }

  .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
    flex-shrink: 0;
  }

  /* ── Players pane ────────────────────────────────────────────────────────── */
  .me {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .name { font-weight: 600; }

  .badge {
    font-size: 0.7rem;
    background: #333;
    color: #888;
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
  }

  .player-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .player-list li {
    font-size: 0.9rem;
    padding: 0.2rem 0;
    color: #ccc;
  }

  .player-list li.me { color: #e94560; }

  .you {
    font-size: 0.75rem;
    color: #666;
    margin-left: 0.25rem;
  }

  /* ── Chat pane ───────────────────────────────────────────────────────────── */
  .messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem 0;
    min-height: 0;
  }

  .msg {
    display: flex;
    gap: 0.5rem;
    font-size: 0.9rem;
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
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .chat-form .input {
    flex: 1;
    min-width: 0;
  }

  /* ── Tables pane ─────────────────────────────────────────────────────────── */
  .table-list {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 0.6rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .table-card {
    background: #1a2a4a;
    border: 1px solid #0f3460;
    border-radius: 8px;
    padding: 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1 1 160px;
    max-width: 220px;
  }

  .table-card.create {
    border-style: dashed;
    border-color: #2a4a70;
    background: #141e33;
  }

  .game-icon-sm {
    font-size: 0.72rem;
    font-weight: 700;
    color: #4caf50;
    background: #0d2a18;
    border: 1px solid #1a5a30;
    border-radius: 4px;
    padding: 0.05rem 0.3rem;
    margin-right: 0.25rem;
  }

  .pick-icon {
    font-size: 0.72rem;
    opacity: 0.85;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ccc;
  }

  .status {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: #2a3a50;
    color: #888;
    border-radius: 4px;
    padding: 0.1rem 0.4rem;
  }

  .status.live {
    background: #1a3a1a;
    color: #4caf50;
  }

  .game-picker {
    display: flex;
    gap: 0.4rem;
  }

  .pick-btn {
    flex: 1;
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 5px;
    color: #888;
    font-size: 0.78rem;
    padding: 0.35rem 0.4rem;
    cursor: pointer;
  }

  .pick-btn:hover { background: #1a4a80; color: #ccc; }
  .pick-btn.selected { border-color: #e94560; color: #e0e0e0; }

  .seats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .seat {
    font-size: 0.78rem;
    color: #555;
    background: #0d1f38;
    border-radius: 4px;
    padding: 0.15rem 0.45rem;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .seat.filled { color: #aaa; background: #1a3050; }
  .seat.mine   { color: #e94560; background: #2a1520; }
  .seat.ready  { outline: 1px solid #4caf50; }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .seat-count {
    font-size: 0.75rem;
    color: #555;
  }

  .seat-min {
    color: #444;
  }

  /* ── Shared controls ─────────────────────────────────────────────────────── */
  .input {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    outline: none;
    box-sizing: border-box;
  }

  .input:focus { border-color: #e94560; }
  .input.sm    { padding: 0.25rem 0.5rem; font-size: 0.85rem; }

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

  .link-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 0.8rem;
    text-decoration: underline;
    padding: 0;
  }

  .link-btn:hover { color: #ccc; }

  .muted {
    color: #555;
    font-size: 0.85rem;
    font-style: italic;
  }
</style>
