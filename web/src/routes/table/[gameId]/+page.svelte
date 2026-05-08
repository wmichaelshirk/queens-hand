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
    result: { losers?: number[]; winners?: number[]; scores?: number[] } | null;
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

  type HandSummary = {
    deltas: { player: number; delta: number; reason: string }[];
    runningTotals: number[];
    seatNames: string[];
  };

  type GameState = {
    publicState: GamePublicState;
    myHand: Card[];
    legalMoves: Move[];
    seats: GameSeat[];
    gameType: string;
    strawmen: StrawmanPileInfo[][] | null;  // [enginePlayerIndex][pileIndex], Strohmandeln only
    continuation: ContinuationState | null;
    lastHandSummary: HandSummary | null;
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

  // Separate card-play moves (handled by clicking hand) from bid/announce moves
  const nonCardMoves = $derived(
    ($gameState?.legalMoves ?? []).filter((m) => m.type !== "PLAY_CARD")
  );

  let showHandSummary = $state(true);
  $effect(() => {
    // Auto-show summary whenever it updates
    if ($gameState?.lastHandSummary) showHandSummary = true;
  });

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
        <span class="game-icon" aria-hidden="true">
          {#if $tableData.gameType === "slobberhannes"}Q♣{:else}★{/if}
        </span>
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
          <h2 class="waiting-title">
            <span class="waiting-game-icon" aria-hidden="true">
              {#if $tableData.gameType === "slobberhannes"}Q♣{:else}★{/if}
            </span>
            {GAME_NAMES[$tableData.gameType]}
          </h2>

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

          <!-- Rules accordion -->
          {#if $tableData}
            <details class="rules-accordion">
              <summary class="rules-summary">
                How to play {GAME_NAMES[$tableData.gameType]}
              </summary>
              {#if $tableData.gameType === "slobberhannes"}
                <div class="rules-body">
                  <p><strong>Players:</strong> 3–6 · <strong>Deck:</strong> 32 cards (7 through Ace, four suits)</p>
                  <p><strong>Goal:</strong> Avoid penalty points. The first player to reach 10 total points loses.</p>
                  <p><strong>Score 1 penalty point for taking:</strong></p>
                  <ul>
                    <li>The <em>first trick</em> of the hand</li>
                    <li>The <em>last trick</em> of the hand</li>
                    <li>The <em>Queen of Clubs</em> (the "Slobberhannes")</li>
                  </ul>
                  <p><strong>The sweep:</strong> If you take all three in one hand, you score 4 points instead of 3.</p>
                  <p><strong>Play:</strong> Must follow the led suit. If you can't, play any card. No trumps — highest card of the led suit wins.</p>
                </div>
              {:else}
                <div class="rules-body">
                  <p><strong>Players:</strong> 2 · <strong>Deck:</strong> 54-card Tarock deck (22 Tarocks + 32 suit cards)</p>
                  <p><strong>Tarocks</strong> (I–XXI plus the Fool ★) are permanent trumps, always beating suit cards.</p>
                  <p><strong>Strawman piles:</strong> Each player has 3 face-down piles of 4 cards. One card per pile is turned up at the start of each trick. Kings and Knights go into your hand; others stay as piles.</p>
                  <p><strong>Bidding:</strong> Forehand may bid "play" (become the Declarer) or pass. If both pass, no Declarer — whoever captures more card points wins.</p>
                  <p><strong>Winning a hand:</strong> The Declarer needs ≥ 36 card points (out of 70). Face cards and high Tarocks are worth points; plain cards are worth less.</p>
                  <p><strong>A draw</strong> (35–35 when no Declarer) doubles the score multiplier for the next hand instead of transferring points.</p>
                  <p><strong>Session:</strong> After each hand, vote to Continue or Quit. No fixed end — play as long as you like.</p>
                </div>
              {/if}
            </details>
          {/if}

        </div>

      {:else if $tableData.status === "active" || $tableData.status === "between_hands"}
        <div class="game-active">
          {#if $gameState}
            <!-- Turn banner -->
            <div class="turn-banner" class:my-turn={isMyTurn}>
              {#if $gameState.continuation}
                Hand complete
              {:else if isMyTurn}
                Your turn
              {:else}
                Waiting for {seatName($gameState.publicState.currentTurn)}…
              {/if}
            </div>

            <!-- Scores row -->
            <div class="scores-row">
              {#each $gameState.seats as seat (seat.seatIndex)}
                <div class="score-chip" class:active-turn={seat.enginePlayerIndex === $gameState.publicState.currentTurn}>
                  <span class="score-name">{seat.displayName}{seat.isBot ? " 🤖" : ""}</span>
                  <span class="score-val">{$gameState.publicState.scores[seat.enginePlayerIndex] ?? 0}</span>
                </div>
              {/each}
            </div>

            <!-- Last hand summary (both games) -->
            {#if $gameState.lastHandSummary && showHandSummary}
              {@const hs = $gameState.lastHandSummary}
              <div class="hand-summary">
                <div class="summary-header">
                  <span class="summary-title">Last hand</span>
                  <button class="summary-dismiss" onclick={() => showHandSummary = false}>✕</button>
                </div>
                <div class="summary-rows">
                  {#each hs.deltas as d (d.player)}
                    {@const isBad = $gameState?.gameType === 'slobberhannes' ? d.delta > 0 : d.delta < 0}
                    {@const isGood = $gameState?.gameType === 'slobberhannes' ? d.delta < 0 : d.delta > 0}
                    <div class="summary-row" class:summary-penalty={isBad} class:summary-bonus={isGood}>
                      <span class="summary-name">{hs.seatNames[d.player] ?? `Player ${d.player + 1}`}</span>
                      <span class="summary-reason">{d.reason}</span>
                      <span class="summary-delta">{d.delta > 0 ? '+' : ''}{d.delta}</span>
                    </div>
                  {/each}
                </div>
                <div class="summary-totals">
                  {#each hs.runningTotals as total, i (i)}
                    <span class="summary-total">{hs.seatNames[i] ?? `P${i + 1}`}: {total}</span>
                  {/each}
                </div>
              </div>
            {/if}

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

            <!-- Opponents (face-down cards) -->
            {#if !$gameState.continuation}
              {@const opponents = $gameState.seats.filter(s => s.playerId !== myId)}
              {#if opponents.length > 0}
                <div class="opponents-row">
                  {#each opponents as seat (seat.seatIndex)}
                    <div class="opponent-area">
                      <span class="opponent-name">{seat.displayName}{seat.isBot ? " 🤖" : ""}</span>
                      <div class="face-down-stack">
                        {#each Array(Math.min(seat.handSize, 10)) as _, ci (ci)}
                          <div class="playing-card face-down" style="--ci: {ci}"></div>
                        {/each}
                        {#if seat.handSize === 0}
                          <span class="no-cards-label">no cards</span>
                        {:else if seat.handSize > 10}
                          <span class="stack-overflow">+{seat.handSize - 10}</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
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
                        <div class="playing-card straw-card" class:card-red={isRedSuit(pile.topCard.suit)} class:card-tarock={pile.topCard.suit === 'T'}>
                          <span class="card-top-left">
                            <span class="cr-rank">{pile.topCard.rank}</span>
                            <span class="cr-suit">{pile.topCard.suit === 'T' ? '★' : pile.topCard.suit}</span>
                          </span>
                          <span class="card-center">{pile.topCard.suit === 'T' ? pile.topCard.rank : pile.topCard.suit}</span>
                          <span class="card-bottom-right">
                            <span class="cr-rank">{pile.topCard.rank}</span>
                            <span class="cr-suit">{pile.topCard.suit === 'T' ? '★' : pile.topCard.suit}</span>
                          </span>
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

            <!-- Current trick -->
            {#if !$gameState.continuation}
              <div class="trick-area">
                <div class="trick-label">Trick {$gameState.publicState.trickNum + 1}</div>
                {#if $gameState.publicState.currentTrick.length > 0}
                  <div class="trick-cards">
                    {#each $gameState.publicState.currentTrick as play}
                      <div class="trick-card-wrap">
                        <div class="playing-card trick-card" class:card-red={isRedSuit(play.card.suit)} class:card-tarock={play.card.suit === 'T'}>
                          <span class="card-top-left">
                            <span class="cr-rank">{play.card.rank}</span>
                            <span class="cr-suit">{play.card.suit === 'T' ? '★' : play.card.suit}</span>
                          </span>
                          <span class="card-center">{play.card.suit === 'T' ? play.card.rank : play.card.suit}</span>
                          <span class="card-bottom-right">
                            <span class="cr-rank">{play.card.rank}</span>
                            <span class="cr-suit">{play.card.suit === 'T' ? '★' : play.card.suit}</span>
                          </span>
                        </div>
                        <span class="trick-player-name">{seatName(play.playerIndex)}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="trick-empty">—</div>
                {/if}
              </div>
            {/if}

            <!-- My strawman piles (Strohmandeln only) -->
            {#if $gameState.strawmen && !$gameState.continuation}
              {@const myPiles = $gameState.strawmen[myEngineIndex] ?? []}
              <div class="strawmen-row mine">
                <div class="strawmen-label">Your piles</div>
                <div class="strawmen-piles">
                  {#each myPiles as pile, i (i)}
                    <div class="straw-pile" class:empty={!pile.topCard}>
                      {#if pile.topCard}
                        <div class="playing-card straw-card" class:card-red={isRedSuit(pile.topCard.suit)} class:card-tarock={pile.topCard.suit === 'T'}>
                          <span class="card-top-left">
                            <span class="cr-rank">{pile.topCard.rank}</span>
                            <span class="cr-suit">{pile.topCard.suit === 'T' ? '★' : pile.topCard.suit}</span>
                          </span>
                          <span class="card-center">{pile.topCard.suit === 'T' ? pile.topCard.rank : pile.topCard.suit}</span>
                          <span class="card-bottom-right">
                            <span class="cr-rank">{pile.topCard.rank}</span>
                            <span class="cr-suit">{pile.topCard.suit === 'T' ? '★' : pile.topCard.suit}</span>
                          </span>
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

            <!-- Non-card moves (bids, announcements) -->
            {#if isMyTurn && nonCardMoves.length > 0}
              <div class="move-section">
                <div class="move-prompt">Choose your action:</div>
                <div class="move-grid">
                  {#each nonCardMoves as move, i (i)}
                    <button class="move-btn" onclick={() => playMove(move)} disabled={busy}>
                      {moveLabel(move)}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Your hand (click to play) -->
            {#if $gameState.myHand.length > 0}
              <div class="hand-section">
                <div class="hand-label">
                  {isMyTurn ? "Your turn — click a card to play" : "Your hand"}
                </div>
                <div class="hand-cards">
                  {#each sortHand($gameState.myHand) as card (`${card.suit}${card.rank}`)}
                    {@const legal = isMyTurn && isLegalMove(card)}
                    <div
                      class="playing-card"
                      class:card-red={isRedSuit(card.suit)}
                      class:card-tarock={card.suit === 'T'}
                      class:card-playable={legal}
                      class:card-dimmed={isMyTurn && !legal}
                      onclick={() => legal && !busy && playMove({ type: 'PLAY_CARD', card })}
                      role="button"
                      tabindex={legal ? 0 : -1}
                      aria-disabled={!legal || busy}
                      onkeydown={(e) => e.key === 'Enter' && legal && !busy && playMove({ type: 'PLAY_CARD', card })}
                    >
                      <span class="card-top-left">
                        <span class="cr-rank">{card.rank}</span>
                        <span class="cr-suit">{card.suit === 'T' ? '★' : card.suit}</span>
                      </span>
                      <span class="card-center">{card.suit === 'T' ? card.rank : card.suit}</span>
                      <span class="card-bottom-right">
                        <span class="cr-rank">{card.rank}</span>
                        <span class="cr-suit">{card.suit === 'T' ? '★' : card.suit}</span>
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

          {:else}
            <p class="muted centered">Loading game…</p>
          {/if}
        </div>

      {:else}
        <!-- Game over screen -->
        <div class="game-over-screen">
          <div class="game-over-icon" aria-hidden="true">
            {#if $tableData?.gameType === "slobberhannes"}Q♣{:else}★{/if}
          </div>
          <h2 class="game-over-title">Game Over</h2>
          {#if $tableData?.result}
            {@const result = $tableData.result}
            {#if result.losers && result.losers.length > 0}
              <p class="game-over-result">
                Loser{result.losers.length > 1 ? 's' : ''}:
                {#each result.losers as engineIdx, i}
                  <strong>{$tableData.seats[engineIdx]?.displayName ?? `Player ${engineIdx + 1}`}</strong>{i < result.losers!.length - 1 ? ', ' : ''}
                {/each}
              </p>
            {/if}
            {#if result.scores && result.scores.length > 0}
              <div class="game-over-scores">
                {#each $tableData.seats as seat, engineIdx (seat.seatIndex)}
                  {@const score = result.scores[engineIdx] ?? 0}
                  <div class="game-over-score-row" class:loser-row={result.losers?.includes(engineIdx)}>
                    <span class="go-name">{seat.displayName}{seat.isBot ? " 🤖" : ""}</span>
                    <span class="go-score">{score}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <p class="muted centered">Game complete.</p>
          {/if}
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

  .game-icon {
    font-size: 1.1rem;
    font-weight: 700;
    color: #4caf50;
    background: #0d2a18;
    border: 1px solid #1a5a30;
    border-radius: 5px;
    padding: 0.1rem 0.45rem;
    letter-spacing: -0.02em;
  }

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
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .waiting-game-icon {
    font-size: 1.3rem;
    font-weight: 700;
    color: #4caf50;
    background: #0d2a18;
    border: 1px solid #1a5a30;
    border-radius: 5px;
    padding: 0.1rem 0.5rem;
  }

  /* ── Rules accordion ─────────────────────────────────────────────────────── */
  .rules-accordion {
    width: 100%;
    background: #0d1e38;
    border: 1px solid #1a3a60;
    border-radius: 10px;
    overflow: hidden;
  }

  .rules-summary {
    cursor: pointer;
    padding: 0.75rem 1rem;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #888;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    user-select: none;
  }
  .rules-summary::-webkit-details-marker { display: none; }
  .rules-summary::before {
    content: '▶';
    font-size: 0.65rem;
    transition: transform 0.2s;
    color: #555;
  }
  details[open] .rules-summary::before { transform: rotate(90deg); }
  .rules-summary:hover { color: #bbb; }

  .rules-body {
    padding: 0.75rem 1.1rem 1rem;
    font-size: 0.85rem;
    color: #aaa;
    line-height: 1.7;
    border-top: 1px solid #1a3a60;
  }

  .rules-body p  { margin: 0 0 0.5rem; }
  .rules-body ul { margin: 0.25rem 0 0.5rem 1.25rem; padding: 0; }
  .rules-body li { margin-bottom: 0.2rem; }
  .rules-body strong { color: #ccc; }
  .rules-body em { color: #e0c060; font-style: normal; }

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

  /* ── Game over screen ────────────────────────────────────────────────────── */
  .game-over-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    padding: 2rem;
    max-width: 420px;
    width: 100%;
  }

  .game-over-icon {
    font-size: 2rem;
    font-weight: 700;
    color: #4caf50;
    background: #0d2a18;
    border: 2px solid #1a5a30;
    border-radius: 10px;
    padding: 0.3rem 0.9rem;
  }

  .game-over-title {
    font-size: 1.6rem;
    font-weight: 700;
    color: #e0e0e0;
    margin: 0;
  }

  .game-over-result {
    font-size: 1rem;
    color: #ccc;
    margin: 0;
    text-align: center;
  }
  .game-over-result strong { color: #e94560; }

  .game-over-scores {
    width: 100%;
    background: #0d1e38;
    border: 1px solid #1a3a60;
    border-radius: 10px;
    overflow: hidden;
  }

  .game-over-score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid #1a2a40;
    font-size: 0.9rem;
  }
  .game-over-score-row:last-child { border-bottom: none; }
  .game-over-score-row.loser-row  { background: #1e0a10; }

  .go-name  { color: #ccc; font-weight: 600; }
  .go-score { color: #e0e0e0; font-weight: 700; font-size: 1.1rem; }
  .loser-row .go-name  { color: #e94560; }
  .loser-row .go-score { color: #e94560; }

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

  /* ── Playing cards ───────────────────────────────────────────────────────── */
  .playing-card {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    justify-content: space-between;
    width: 54px;
    height: 80px;
    background: #f8f5ee;
    border: 1px solid #bbb;
    border-radius: 7px;
    padding: 3px 4px;
    font-family: system-ui, sans-serif;
    color: #1a1a2e;
    user-select: none;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    flex-shrink: 0;
  }

  .playing-card.card-red    { color: #c0392b; }
  .playing-card.card-tarock { color: #6c3fbd; }

  .playing-card.card-playable {
    cursor: pointer;
    transform: translateY(-8px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    border-color: #f1c40f;
    border-width: 2px;
  }
  .playing-card.card-playable:hover {
    transform: translateY(-12px);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
  }
  .playing-card.card-dimmed {
    opacity: 0.32;
    filter: grayscale(20%);
  }

  .playing-card.face-down {
    background: #1a3464;
    border-color: #0f244a;
    cursor: default;
    position: relative;
    overflow: hidden;
  }
  .playing-card.face-down::after {
    content: '';
    position: absolute;
    inset: 4px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    background: repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.04),
      rgba(255, 255, 255, 0.04) 2px,
      transparent 2px,
      transparent 8px
    );
  }

  .playing-card.trick-card  { width: 54px; height: 80px; }
  .playing-card.straw-card  { width: 52px; height: 76px; }

  .card-top-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1;
    gap: 0px;
  }
  .card-bottom-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1;
    transform: rotate(180deg);
    gap: 0px;
    align-self: flex-end;
  }
  .cr-rank { font-size: 0.72rem; font-weight: 800; line-height: 1.1; }
  .cr-suit { font-size: 0.58rem; line-height: 1; }

  .card-center {
    text-align: center;
    font-size: 1.35rem;
    line-height: 1;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }

  /* ── Trick area ──────────────────────────────────────────────────────────── */
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
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-end;
  }

  .trick-card-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
  }
  .trick-player-name {
    font-size: 0.65rem;
    color: #666;
  }

  .trick-empty { font-size: 1.2rem; color: #333; }

  /* ── Opponents row ───────────────────────────────────────────────────────── */
  .opponents-row {
    display: flex;
    gap: 2rem;
    justify-content: center;
    flex-wrap: wrap;
    padding: 0.25rem 0 0.5rem;
  }

  .opponent-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .opponent-name {
    font-size: 0.72rem;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .face-down-stack {
    display: flex;
    align-items: flex-end;
    position: relative;
  }

  .face-down-stack .playing-card.face-down {
    margin-left: -28px;
    transition: none;
  }
  .face-down-stack .playing-card.face-down:first-child {
    margin-left: 0;
  }

  .no-cards-label {
    font-size: 0.75rem;
    color: #444;
    font-style: italic;
  }

  .stack-overflow {
    font-size: 0.72rem;
    color: #666;
    margin-left: 4px;
    align-self: center;
  }

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
  }

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
    border-radius: 7px;
    width: 52px;
    height: 76px;
  }

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

  /* ── Hand section ────────────────────────────────────────────────────────── */
  .hand-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
    border-top: 1px solid #0f3460;
    padding-top: 1.5rem;
  }

  .hand-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
  }

  .hand-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    justify-content: center;
    padding-bottom: 10px; /* room for playable lift */
  }

  /* ── Hand summary ────────────────────────────────────────────────────────── */
  .hand-summary {
    background: #0d1e38;
    border: 1px solid #1a4a80;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
    max-width: 480px;
  }

  .summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .summary-title {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
  }

  .summary-dismiss {
    background: none;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0;
    line-height: 1;
  }
  .summary-dismiss:hover { color: #999; }

  .summary-rows {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .summary-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
  }

  .summary-name  { font-weight: 600; color: #ccc; min-width: 80px; }
  .summary-reason { color: #666; flex: 1; font-style: italic; font-size: 0.8rem; }
  .summary-delta { font-weight: 700; font-size: 0.9rem; min-width: 32px; text-align: right; }

  .summary-row.summary-penalty .summary-delta { color: #e94560; }
  .summary-row.summary-bonus   .summary-delta { color: #4caf50; }
  .summary-row:not(.summary-penalty):not(.summary-bonus) .summary-delta { color: #888; }

  .summary-totals {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    border-top: 1px solid #1a3060;
    padding-top: 0.5rem;
    font-size: 0.8rem;
    color: #888;
  }

  .summary-total { color: #aaa; }

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
