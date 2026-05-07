<script lang="ts">
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { page } from "$app/stores";
  import {
    isLoggedIn, guestSession, signOut,
    convex, watchQuery,
  } from "$lib/convex";
  import { GAME_OPTIONS } from "$lib/gameConfig";

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

  // ── Presence heartbeat (includes tableId so watchers list works) ───────────────

  let presenceInterval: ReturnType<typeof setInterval>;

  $effect(() => {
    if ($isLoggedIn && gameId) {
      const guestUserId = $guestSession?.userId;
      const ping = () =>
        convex.mutation("lobby:ping" as any, { guestUserId, tableId: gameId }).catch(() => {});
      ping();
      presenceInterval = setInterval(ping, 30_000);
    }
    return () => {
      clearInterval(presenceInterval);
      // Clear tableId from presence when leaving the page
      if ($isLoggedIn) {
        convex.mutation("lobby:ping" as any, {
          guestUserId: $guestSession?.userId,
          tableId: undefined,
        }).catch(() => {});
      }
    };
  });

  // ── Table data ─────────────────────────────────────────────────────────────────

  type TableSeat = {
    seatIndex: number;
    playerId: string;
    displayName: string;
    isBot: boolean;
    ready: boolean;
    connected: boolean;
  };

  type Watcher = { userId: string; displayName: string };

  type TableData = {
    _id: string;
    gameType: "slobberhannes" | "strohmandeln";
    status: "waiting" | "active" | "finished" | "between_hands";
    seatCount: number;
    minSeatCount: number;
    creatorPlayerId: string;
    settings: Record<string, unknown>;
    createdAt: number;
    seats: TableSeat[];
    watchers: Watcher[];
  };

  const GAME_NAMES: Record<string, string> = {
    slobberhannes: "Slobberhannes",
    strohmandeln: "Strohmandeln",
  };

  const tableData = watchQuery<TableData | null>("games:getTable" as any, { gameId });

  const myId = $derived(currentPlayer?._id);
  const mySeat = $derived($tableData?.seats.find((s) => s.playerId === myId) ?? null);
  const isSeated = $derived(mySeat !== null);
  const isReady = $derived(mySeat?.ready ?? false);
  const isCreator = $derived($tableData?.creatorPlayerId === myId);
  const isFull = $derived(($tableData?.seats.length ?? 0) >= ($tableData?.seatCount ?? 0));
  const canStart = $derived(
    !!$tableData &&
    $tableData.status === "waiting" &&
    $tableData.seats.length >= $tableData.minSeatCount
  );

  // ── Settings (creator edits locally, saves on change) ─────────────────────────

  let localSettings = $state<Record<string, unknown>>({});

  $effect(() => {
    if ($tableData?.settings) {
      localSettings = { ...$tableData.settings };
    }
  });

  async function saveSettings() {
    await convex.mutation("games:updateSettings" as any, {
      gameId,
      settings: localSettings,
      guestUserId: $guestSession?.userId,
    });
  }

  // ── Game state (active game) ───────────────────────────────────────────────────

  type GameSeat = {
    seatIndex: number;
    playerId: string;
    displayName: string;
    isBot: boolean;
    enginePlayerIndex: number;
    handSize: number;
  };

  type GamePublicState = {
    currentTrick: { playerIndex: number; card: { suit: string; rank: string } }[];
    scores: number[];
    currentTurn: number;
    trickNum: number;
    phase: string;
  };

  type Move =
    | { type: "PLAY_CARD"; card: { suit: string; rank: string } }
    | { type: "MAKE_BID"; bid: string }
    | { type: "PASS_BID" }
    | { type: "MAKE_ANNOUNCEMENT"; announcement: string };

  type StrawmanPileInfo = { topCard: Card | null; depth: number };

  type ContinuationState = {
    votes: Record<string, "continue" | "quit">;
    myVote: "continue" | "quit" | null;
  };

  type GameState = {
    publicState: GamePublicState;
    myHand: Card[];
    legalMoves: Move[];
    seats: GameSeat[];
    gameType: string;
    strawmen: StrawmanPileInfo[][] | null;  // [enginePlayerIndex][pileIndex], Strohmandeln only
    continuation: ContinuationState | null;
  } | null;

  const gameState = watchQuery<GameState>(
    "games:getMyGameState" as any,
    { gameId, guestUserId: $guestSession?.userId }
  );

  const myEngineIndex = $derived(
    $gameState?.seats.find((s) => s.playerId === myId)?.enginePlayerIndex ?? -1
  );

  const isMyTurn = $derived(
    myEngineIndex >= 0 && $gameState?.publicState.currentTurn === myEngineIndex
  );

  function moveLabel(move: Move): string {
    if (move.type === "PLAY_CARD") return `${move.card.rank}${move.card.suit}`;
    if (move.type === "MAKE_BID") return move.bid;
    if (move.type === "PASS_BID") return "Pass";
    if (move.type === "MAKE_ANNOUNCEMENT") return move.announcement;
    return "?";
  }

  function isRedSuit(suit: string): boolean {
    return suit === "♥" || suit === "♦";
  }

  // Suit order: Tarock, ♣, ♦, ♥, ♠ — rank order covers both engines
  const SUIT_ORDER: Record<string, number> = { T: 0, "♣": 1, "♦": 2, "♥": 3, "♠": 4 };
  const RANK_ORDER: Record<string, number> = {
    // Slobberhannes
    "7": 0, "8": 1, "9": 2, "10": 3, J: 4, Q: 5, K: 6, A: 7,
    // Strohmandeln suit cards
    Kn: 8,
    // Strohmandeln Tarock (I = weakest, ★ = strongest)
    I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6, VIII: 7, IX: 8, X: 9,
    XI: 10, XII: 11, XIII: 12, XIV: 13, XV: 14, XVI: 15, XVII: 16, XVIII: 17,
    XIX: 18, XX: 19, XXI: 20, "★": 21,
  };

  type Card = { suit: string; rank: string };

  function sortHand(cards: Card[]): Card[] {
    return [...cards].sort((a, b) => {
      const sd = (SUIT_ORDER[a.suit] ?? 99) - (SUIT_ORDER[b.suit] ?? 99);
      if (sd !== 0) return sd;
      return (RANK_ORDER[a.rank] ?? 50) - (RANK_ORDER[b.rank] ?? 50);
    });
  }

  function isLegalMove(card: Card): boolean {
    return ($gameState?.legalMoves ?? []).some(
      (m) => m.type === "PLAY_CARD" && m.card.suit === card.suit && m.card.rank === card.rank
    );
  }

  function seatName(engineIndex: number): string {
    return $gameState?.seats.find((s) => s.enginePlayerIndex === engineIndex)?.displayName ?? `Player ${engineIndex + 1}`;
  }

  async function playMove(move: Move) {
    if (busy) return;
    busy = true;
    try {
      await convex.mutation("games:applyMove" as any, {
        gameId,
        move,
        guestUserId: $guestSession?.userId,
      });
    } finally {
      busy = false;
    }
  }

  async function voteContinue(vote: "continue" | "quit") {
    if (busy) return;
    busy = true;
    try {
      await convex.mutation("games:voteContinue" as any, {
        gameId,
        vote,
        guestUserId: $guestSession?.userId,
      });
    } finally {
      busy = false;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────────

  let busy = $state(false);

  async function sitDown(seatIndex: number) {
    if (busy) return;
    busy = true;
    try {
      await convex.mutation("games:sitDown" as any, {
        gameId,
        seatIndex,
        guestUserId: $guestSession?.userId,
      });
    } finally {
      busy = false;
    }
  }

  async function addBot(seatIndex: number) {
    if (busy) return;
    busy = true;
    try {
      await convex.mutation("games:addBot" as any, {
        gameId,
        seatIndex,
        guestUserId: $guestSession?.userId,
      });
    } finally {
      busy = false;
    }
  }

  async function standUp() {
    if (busy) return;
    busy = true;
    try {
      await convex.mutation("games:standUp" as any, {
        gameId,
        guestUserId: $guestSession?.userId,
      });
    } finally {
      busy = false;
    }
  }

  async function leaveTable() {
    if (isSeated) {
      // Remain seated — just navigate away. Will appear disconnected in sidebar.
      goto("/");
      return;
    }
    // Non-seated watcher explicitly leaving — may trigger table deletion.
    if (busy) return;
    busy = true;
    try {
      await convex.mutation("games:leaveTable" as any, {
        gameId,
        guestUserId: $guestSession?.userId,
      });
    } finally {
      busy = false;
    }
    goto("/");
  }

  async function toggleReady() {
    if (busy) return;
    busy = true;
    try {
      if (isReady) {
        await convex.mutation("games:unready" as any, {
          gameId,
          guestUserId: $guestSession?.userId,
        });
      } else {
        await convex.mutation("games:markReady" as any, {
          gameId,
          guestUserId: $guestSession?.userId,
        });
      }
    } finally {
      busy = false;
    }
  }

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
</script>

{#if $isLoggedIn}
<div class="shell">

  <!-- Header -->
  <header class="site-header">
    <div class="header-left">
      <button class="back-btn" onclick={leaveTable}>← Lobby</button>
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

    <!-- Left: game area / waiting room -->
    <main class="game-area">
      {#if !$tableData}
        <p class="muted centered">Loading table…</p>

      {:else if $tableData.status === "waiting"}
        <div class="waiting-room">
          <h2 class="waiting-title">{GAME_NAMES[$tableData.gameType]}</h2>

          <p class="waiting-sub">
            {$tableData.seats.length} of {$tableData.seatCount} seated
            {#if $tableData.minSeatCount < $tableData.seatCount}
              · {$tableData.minSeatCount} needed to start
            {/if}
          </p>

          <!-- Seat grid -->
          <div class="seat-grid">
            {#each Array($tableData.seatCount) as _, i}
              {@const seat = $tableData.seats.find((s) => s.seatIndex === i)}
              <div
                class="seat-slot"
                class:filled={!!seat}
                class:mine={seat?.playerId === myId}
                class:ready={seat?.ready}
              >
                <div class="seat-index">Seat {i + 1}</div>
                {#if seat}
                  <div class="seat-name">{seat.displayName}{seat.isBot ? " 🤖" : ""}</div>
                  <div class="seat-state">{seat.ready ? "✓ ready" : "not ready"}</div>
                {:else}
                  <div class="seat-empty">Empty</div>
                  {#if !isFull && $tableData.status === "waiting"}
                    {#if !isSeated}
                      <button class="btn accent-sm" onclick={() => sitDown(i)} disabled={busy}>
                        Sit here
                      </button>
                    {/if}
                    {#if isCreator}
                      <button class="btn sm" onclick={() => addBot(i)} disabled={busy}>
                        + Bot
                      </button>
                    {/if}
                  {/if}
                {/if}
              </div>
            {/each}
          </div>

          <!-- Seated player actions -->
          {#if isSeated}
            <div class="action-row">
              <button
                class="btn ready-btn"
                class:active={isReady}
                onclick={toggleReady}
                disabled={busy || !canStart}
                title={!canStart ? `Need ${$tableData.minSeatCount} players to start` : ""}
              >
                {isReady ? "✓ Ready — click to unready" : canStart ? "Start game" : `Waiting for ${$tableData.minSeatCount - $tableData.seats.length} more player${$tableData.minSeatCount - $tableData.seats.length === 1 ? "" : "s"}…`}
              </button>
              <button class="btn sm" onclick={standUp} disabled={busy}>Stand up</button>
            </div>
          {/if}

          <!-- Settings panel (only shown when game has options) -->
          {#if $tableData.status === "waiting"}
            {@const options = GAME_OPTIONS[$tableData.gameType] ?? []}
            {#if options.length > 0}
              <div class="settings-panel" class:readonly={!isCreator}>
                <div class="settings-title">
                  Table settings
                  {#if isCreator}<span class="creator-badge">creator</span>{/if}
                </div>
                {#each options as opt}
                  <div class="setting-row">
                    <span class="setting-label">{opt.label}</span>
                    {#if isCreator}
                      {#if opt.type === 'select'}
                        <select
                          class="input select-input"
                          value={String(localSettings[opt.key] ?? opt.default)}
                          onchange={(e) => {
                            localSettings = { ...localSettings, [opt.key]: (e.target as HTMLSelectElement).value };
                            saveSettings();
                          }}
                        >
                          {#each opt.choices as choice}
                            <option value={choice.value}>{choice.label}</option>
                          {/each}
                        </select>
                      {/if}
                    {:else}
                      <span class="setting-value">
                        {opt.choices.find(c => c.value === String(localSettings[opt.key] ?? opt.default))?.label ?? opt.default}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}

        </div>

      {:else if $tableData.status === "active" || $tableData.status === "between_hands"}
        <div class="game-active">
          {#if $gameState}
            <div class="turn-banner" class:my-turn={isMyTurn}>
              {#if $gameState.continuation}
                Hand complete
              {:else}
                {isMyTurn ? "Your turn" : `Waiting for ${seatName($gameState.publicState.currentTurn)}…`}
              {/if}
            </div>

            <div class="scores-row">
              {#each $gameState.seats as seat (seat.seatIndex)}
                <div class="score-chip" class:active-turn={seat.enginePlayerIndex === $gameState.publicState.currentTurn}>
                  <span class="score-name">{seat.displayName}{seat.isBot ? " 🤖" : ""}</span>
                  <span class="score-val">{$gameState.publicState.scores[seat.enginePlayerIndex] ?? 0}</span>
                </div>
              {/each}
            </div>

            <!-- Between-hands vote (Strohmandeln only) -->
            {#if $gameState.continuation}
              {@const cont = $gameState.continuation}
              <div class="vote-section">
                <div class="vote-prompt">Hand complete — play another?</div>
                <div class="vote-grid">
                  {#each $gameState.seats as seat (seat.seatIndex)}
                    {@const v = cont.votes[String(seat.enginePlayerIndex)]}
                    <div class="vote-chip" class:voted={!!v} class:voted-continue={v === 'continue'} class:voted-quit={v === 'quit'}>
                      <span class="vote-name">{seat.displayName}{seat.isBot ? " 🤖" : ""}</span>
                      <span class="vote-val">
                        {v === 'continue' ? '✓ Continue' : v === 'quit' ? '✗ Quit' : '…'}
                      </span>
                    </div>
                  {/each}
                </div>
                {#if !cont.myVote}
                  <div class="vote-actions">
                    <button class="btn vote-continue-btn" onclick={() => voteContinue('continue')} disabled={busy}>
                      Continue
                    </button>
                    <button class="btn vote-quit-btn" onclick={() => voteContinue('quit')} disabled={busy}>
                      Quit
                    </button>
                  </div>
                {:else}
                  <p class="muted centered">Waiting for other players…</p>
                {/if}
              </div>
            {/if}

            <!-- Opponent strawman piles (Strohmandeln only) -->
            {#if $gameState.strawmen && !$gameState.continuation}
              {@const opponentIndex = myEngineIndex === 0 ? 1 : 0}
              {@const opponentName = seatName(opponentIndex)}
              {@const opponentPiles = $gameState.strawmen[opponentIndex] ?? []}
              <div class="strawmen-row opponent">
                <div class="strawmen-label">{opponentName}'s piles</div>
                <div class="strawmen-piles">
                  {#each opponentPiles as pile, i (i)}
                    <div class="straw-pile" class:empty={!pile.topCard}>
                      {#if pile.topCard}
                        <div class="straw-top-card" class:red={isRedSuit(pile.topCard.suit)} class:tarock={pile.topCard.suit === 'T'}>
                          <span class="card-rank">{pile.topCard.rank}</span>
                          <span class="card-suit">{pile.topCard.suit === 'T' ? '' : pile.topCard.suit}</span>
                        </div>
                        {#if pile.depth > 0}
                          <div class="straw-depth">+{pile.depth}</div>
                        {/if}
                      {:else}
                        <div class="straw-empty">—</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Current trick (hidden during between-hands voting) -->
            {#if !$gameState.continuation}
            <div class="trick-area">
              <div class="trick-label">Trick {$gameState.publicState.trickNum + 1}</div>
              {#if $gameState.publicState.currentTrick.length > 0}
                <div class="trick-cards">
                  {#each $gameState.publicState.currentTrick as play}
                    <div class="played-card" class:red={isRedSuit(play.card.suit)} class:tarock={play.card.suit === 'T'}>
                      <span class="card-rank">{play.card.rank}</span>
                      <span class="card-suit">{play.card.suit === 'T' ? '' : play.card.suit}</span>
                      <span class="card-player">{seatName(play.playerIndex)}</span>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="trick-empty">—</div>
              {/if}
            </div>
            {/if}<!-- /!continuation -->

            <!-- My strawman piles (Strohmandeln only) -->
            {#if $gameState.strawmen && !$gameState.continuation}
              {@const myPiles = $gameState.strawmen[myEngineIndex] ?? []}
              <div class="strawmen-row mine">
                <div class="strawmen-label">Your piles</div>
                <div class="strawmen-piles">
                  {#each myPiles as pile, i (i)}
                    <div class="straw-pile" class:empty={!pile.topCard}>
                      {#if pile.topCard}
                        <div class="straw-top-card" class:red={isRedSuit(pile.topCard.suit)} class:tarock={pile.topCard.suit === 'T'}>
                          <span class="card-rank">{pile.topCard.rank}</span>
                          <span class="card-suit">{pile.topCard.suit === 'T' ? '' : pile.topCard.suit}</span>
                        </div>
                        {#if pile.depth > 0}
                          <div class="straw-depth">+{pile.depth}</div>
                        {/if}
                      {:else}
                        <div class="straw-empty">—</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Available moves -->
            {#if isMyTurn && $gameState.legalMoves.length > 0}
              <div class="move-section">
                <div class="move-prompt">Choose your move:</div>
                <div class="move-grid">
                  {#each $gameState.legalMoves as move, i (i)}
                    <button
                      class="move-btn"
                      class:red-card={move.type === 'PLAY_CARD' && isRedSuit(move.card.suit)}
                      class:tarock-card={move.type === 'PLAY_CARD' && move.card.suit === 'T'}
                      onclick={() => playMove(move)}
                      disabled={busy}
                    >
                      {moveLabel(move)}
                    </button>
                  {/each}
                </div>
              </div>
            {:else if isMyTurn}
              <p class="muted centered">Loading moves…</p>
            {/if}

            <!-- Full hand -->
            {#if $gameState.myHand.length > 0}
              <div class="hand-section">
                <div class="hand-label">Your hand</div>
                <div class="hand-cards">
                  {#each sortHand($gameState.myHand) as card (`${card.suit}${card.rank}`)}
                    <div
                      class="hand-card"
                      class:red={isRedSuit(card.suit)}
                      class:legal={isMyTurn && isLegalMove(card)}
                      class:tarock={card.suit === 'T'}
                    >
                      <span class="card-rank">{card.rank}</span>
                      <span class="card-suit">{card.suit === 'T' ? '' : card.suit}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="hand-info">
              {#each $gameState.seats as seat (seat.seatIndex)}
                {#if seat.playerId !== myId}
                  <span class="muted">{seat.displayName}: {seat.handSize} cards</span>
                {/if}
              {/each}
            </div>
          {:else}
            <p class="muted centered">Loading game…</p>
          {/if}
        </div>

      {:else}
        <div class="game-placeholder">
          <p class="muted centered">This game has ended.</p>
          <button class="btn accent-sm" onclick={() => goto("/")}>Back to lobby</button>
        </div>
      {/if}
    </main>

    <!-- Right: players + watchers + chat -->
    <aside class="sidebar">

      <!-- At the table -->
      <section class="sidebar-section players-section">
        <h3 class="label">At the table</h3>
        {#if $tableData}
          <!-- Seated -->
          <ul class="player-list">
            {#each Array($tableData.seatCount) as _, i}
              {@const seat = $tableData.seats.find((s) => s.seatIndex === i)}
              <li class="player-row" class:mine={seat?.playerId === myId} class:empty={!seat} class:away={seat && !seat.connected}>
                <span class="seat-num">{i + 1}</span>
                {#if seat}
                  <span class="player-label">
                    {seat.displayName}{seat.isBot ? " 🤖" : ""}
                    {#if seat.playerId === myId}<span class="you">(you)</span>{/if}
                    {#if seat.playerId === $tableData.creatorPlayerId}<span class="creator-dot" title="creator">★</span>{/if}
                    {#if !seat.connected}<span class="away-label">away</span>{/if}
                  </span>
                  {#if seat.ready}<span class="ready-dot">✓</span>{/if}
                {:else}
                  <span class="empty-label">—</span>
                {/if}
              </li>
            {/each}
          </ul>

          <!-- Watchers -->
          {#if $tableData.watchers.length > 0}
            <div class="watchers">
              <span class="watchers-label">Watching:</span>
              {#each $tableData.watchers as w (w.userId)}
                <span class="watcher">{w.displayName}</span>
              {/each}
            </div>
          {/if}
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
  </div>
</div>
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
    align-items: flex-start;
    justify-content: center;
    overflow-y: auto;
    padding: 2rem;
  }

  .waiting-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    max-width: 540px;
    width: 100%;
  }

  .waiting-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #e94560;
    margin: 0;
  }

  .waiting-sub {
    color: #888;
    font-size: 0.9rem;
    margin: 0;
  }

  /* ── Seat grid ───────────────────────────────────────────────────────────── */
  .seat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 0.75rem;
    width: 100%;
  }

  .seat-slot {
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 10px;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: center;
    text-align: center;
    min-height: 90px;
    justify-content: center;
  }

  .seat-slot.filled  { border-color: #1a4a80; }
  .seat-slot.mine    { border-color: #e94560; background: #1e1020; }
  .seat-slot.ready   { border-color: #4caf50; }

  .seat-index { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  .seat-name  { font-size: 0.88rem; font-weight: 600; color: #ddd; }
  .seat-empty { font-size: 0.82rem; color: #444; }
  .seat-state { font-size: 0.72rem; color: #666; }
  .seat-slot.ready .seat-state { color: #4caf50; }

  /* ── Action row ──────────────────────────────────────────────────────────── */
  .action-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }

  .ready-btn {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.55rem 1.25rem;
    font-size: 0.9rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .ready-btn:hover:not(:disabled)  { background: #1a4a80; }
  .ready-btn.active                { background: #1a3a1a; border-color: #4caf50; color: #4caf50; }
  .ready-btn.active:hover          { background: #143214; }
  .ready-btn:disabled              { opacity: 0.45; cursor: default; }

  /* ── Settings panel ──────────────────────────────────────────────────────── */
  .settings-panel {
    width: 100%;
    background: #12192e;
    border: 1px solid #0f3460;
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .settings-panel.readonly {
    opacity: 0.7;
  }

  .settings-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .creator-badge {
    font-size: 0.65rem;
    background: #2a1040;
    color: #b070e0;
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    text-transform: none;
    letter-spacing: 0;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .setting-label {
    font-size: 0.88rem;
    color: #ccc;
  }

  .setting-value {
    font-size: 0.88rem;
    color: #888;
  }

  .select-input {
    min-width: 100px;
  }

  .away-label {
    font-size: 0.65rem;
    color: #555;
    background: #1a2030;
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    margin-left: 0.25rem;
  }

  .player-row.away .player-label { opacity: 0.6; }

  .game-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  /* ── Active game board ────────────────────────────────────────────────────── */
  .game-active {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    width: 100%;
    max-width: 640px;
  }

  .turn-banner {
    text-align: center;
    font-size: 1rem;
    font-weight: 600;
    color: #888;
    padding: 0.6rem 1rem;
    background: #12192e;
    border: 1px solid #0f3460;
    border-radius: 8px;
  }
  .turn-banner.my-turn {
    color: #e94560;
    border-color: #e94560;
    background: #1e1020;
  }

  .scores-row {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .score-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 8px;
    padding: 0.5rem 0.9rem;
    min-width: 70px;
  }
  .score-chip.active-turn {
    border-color: #e94560;
    background: #1e1020;
  }

  .score-name {
    font-size: 0.75rem;
    color: #888;
  }

  .score-val {
    font-size: 1.2rem;
    font-weight: 700;
    color: #e0e0e0;
  }

  .trick-area {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
  }

  .trick-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
  }

  .trick-cards {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .played-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    background: #1a2a40;
    border: 1px solid #1a4a80;
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    min-width: 52px;
  }
  .played-card.red { color: #e94560; border-color: #804060; }

  .card-rank { font-size: 1.1rem; font-weight: 700; }
  .card-suit { font-size: 1.1rem; }
  .card-player { font-size: 0.65rem; color: #555; margin-top: 0.2rem; }

  .played-card.tarock { color: #b070e0; border-color: #4a2a60; }
  .trick-empty { font-size: 1.2rem; color: #333; }

  /* ── Strawman piles (Strohmandeln) ───────────────────────────────────────── */
  .strawmen-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
  }

  .strawmen-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
  }

  .strawmen-piles {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .straw-pile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    min-width: 52px;
  }

  .straw-top-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    background: #1a2a40;
    border: 1px solid #1a4a80;
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    min-width: 52px;
    text-align: center;
  }

  .straw-top-card.red   { color: #e94560; border-color: #804060; }
  .straw-top-card.tarock { color: #b070e0; border-color: #4a2a60; }

  .straw-depth {
    font-size: 0.68rem;
    color: #666;
    letter-spacing: 0.04em;
  }

  .straw-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    color: #2a3a50;
    background: #0d1528;
    border: 1px dashed #1a2a40;
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    min-width: 52px;
    min-height: 48px;
  }

  .move-btn.tarock-card { color: #b070e0; border-color: #4a2a60; }
  .move-btn.tarock-card:hover:not(:disabled) { background: #1a0a30; border-color: #e94560; }

  /* ── Between-hands vote (Strohmandeln) ───────────────────────────────────── */
  .vote-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
    padding: 1.25rem;
    background: #12192e;
    border: 1px solid #1a4a80;
    border-radius: 10px;
  }

  .vote-prompt {
    font-size: 0.95rem;
    font-weight: 600;
    color: #ccc;
    text-align: center;
  }

  .vote-grid {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .vote-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 8px;
    padding: 0.5rem 0.9rem;
    min-width: 80px;
  }

  .vote-chip.voted-continue { border-color: #4caf50; background: #0f2a1f; }
  .vote-chip.voted-quit     { border-color: #e94560; background: #1e1020; }

  .vote-name { font-size: 0.75rem; color: #888; }
  .vote-val  { font-size: 0.88rem; font-weight: 600; color: #ccc; }
  .vote-chip.voted-continue .vote-val { color: #4caf50; }
  .vote-chip.voted-quit .vote-val     { color: #e94560; }

  .vote-actions {
    display: flex;
    gap: 0.75rem;
  }

  .vote-continue-btn {
    background: #0f3a1f;
    border-color: #4caf50;
    color: #4caf50;
    font-weight: 600;
    padding: 0.55rem 1.5rem;
  }
  .vote-continue-btn:hover:not(:disabled) { background: #1a5a30; }

  .vote-quit-btn {
    background: #1e1020;
    border-color: #e94560;
    color: #e94560;
    font-weight: 600;
    padding: 0.55rem 1.5rem;
  }
  .vote-quit-btn:hover:not(:disabled) { background: #2a1030; }

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
  .move-btn.red-card { color: #e94560; border-color: #804060; }
  .move-btn.red-card:hover:not(:disabled) { background: #2a1020; border-color: #e94560; }

  /* ── Full hand display ───────────────────────────────────────────────────── */
  .hand-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
    border-top: 1px solid #0f3460;
    padding-top: 1.25rem;
  }

  .hand-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
  }

  .hand-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: center;
  }

  .hand-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #101828;
    border: 1px solid #1a2a40;
    border-radius: 6px;
    padding: 0.35rem 0.55rem;
    min-width: 40px;
    opacity: 0.5;
    font-size: 0.88rem;
  }

  .hand-card.legal {
    opacity: 1;
    border-color: #e94560;
  }

  .hand-card.red { color: #e94560; }
  .hand-card.tarock { color: #b070e0; border-color: #4a2a60; }
  .hand-card.tarock.legal { border-color: #e94560; }

  .hand-card .card-rank { font-weight: 600; line-height: 1.2; }
  .hand-card .card-suit { font-size: 0.8rem; line-height: 1; }

  .hand-info {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
    font-size: 0.78rem;
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
    padding: 0;
    margin: 0;
  }

  .player-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
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

  .player-label { color: #ccc; flex: 1; }
  .empty-label  { color: #444; }

  .you {
    font-size: 0.72rem;
    color: #666;
    margin-left: 0.2rem;
  }

  .creator-dot {
    font-size: 0.65rem;
    color: #b070e0;
    margin-left: 0.2rem;
  }

  .ready-dot {
    font-size: 0.72rem;
    color: #4caf50;
    margin-left: auto;
  }

  /* ── Watchers ────────────────────────────────────────────────────────────── */
  .watchers {
    font-size: 0.78rem;
    color: #555;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: baseline;
  }

  .watchers-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }

  .watcher {
    color: #666;
    background: #0d1f38;
    border-radius: 3px;
    padding: 0.1rem 0.35rem;
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
