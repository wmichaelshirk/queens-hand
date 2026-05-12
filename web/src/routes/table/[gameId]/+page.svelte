<script lang="ts">
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { page } from "$app/stores";
  import { tick } from "svelte";
  import {
    isLoggedIn, guestSession, signOut,
    convex, watchQuery,
  } from "$lib/convex";
  import { GAME_OPTIONS, GAME_REGISTRY } from "$lib/gameConfig";
  import type { Card, Move, StrawmanPileInfo, AnimEvent } from "$lib/gameTypes";
  import PlayingCard from "$lib/components/PlayingCard.svelte";
  import HandCards from "$lib/components/HandCards.svelte";
  import { whistSort, tarockSort } from "$lib/cardSort";
  import Trick from "$lib/components/Trick.svelte";
  import Pile from "$lib/components/Pile.svelte";
  import PlayerToken from "$lib/components/PlayerToken.svelte";
  import HandResultModal from "$lib/components/HandResultModal.svelte";
  import { getSlotForSeat } from "$lib/tableLayout";
  import { animatePlayedCard, animateTrickToWinner, animateFlipReveal, animatePileReveal, animateCardArrive, wait } from "$lib/cardAnimations";

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
    dealer: number;
    trickNum: number;
    phase: string;
    lastCompletedTrick: { plays: { playerIndex: number; card: { suit: string; rank: string } }[]; winner: number } | null;
    recentEvents: AnimEvent[];
  };

  type ContinuationState = {
    votes: Record<string, "continue" | "quit">;
    myVote: "continue" | "quit" | null;
  };

  type HandSummary = {
    deltas: { player: number; delta: number; reason: string }[];
    runningTotals: number[];
    seatNames: string[];
    breakdown: { player: number; role: string | null; items: { label: string; delta: number }[]; total: number }[] | null;
    gameTarget: number | null;
    losers: number[] | null;
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

  // ── Display state gate ─────────────────────────────────────────────────────
  // displayState is what components render. It trails liveState ($gameState) by
  // one animation batch so the DOM never jumps ahead of the event sequence.
  let displayState = $state<GameState>(null);
  let _animRunning = $state(false);
  let _pendingState: NonNullable<GameState> | null = null;
  let _lastEventKey = '';

  $effect(() => {
    if ($gameState && !displayState) {
      displayState = $gameState;
      _lastEventKey = JSON.stringify($gameState.publicState.recentEvents);
    }
  });

  const isMyTurn = $derived(
    !_animRunning &&
    myEngineIndex >= 0 && $gameState?.publicState.currentTurn === myEngineIndex
  );

  // Separate card-play moves (handled by clicking hand) from bid/announce moves
  const nonCardMoves = $derived(
    (displayState?.legalMoves ?? []).filter((m) => m.type !== "PLAY_CARD")
  );

  const seatSlots = $derived(
    $gameState
      ? $gameState.seats.map(s => ({
          ...s,
          slot: getSlotForSeat(
            myEngineIndex >= 0 ? myEngineIndex : 0,
            s.enginePlayerIndex,
            $gameState!.seats.length
          ),
        }))
      : []
  );

  const topRowSeats = $derived(
    seatSlots
      .filter(s => s.slot === 'top' || s.slot === 'top-left' || s.slot === 'top-right')
      .sort((a, b) => {
        const order: Record<string, number> = { 'top-left': 0, 'top': 1, 'top-right': 2 };
        return (order[a.slot] ?? 1) - (order[b.slot] ?? 1);
      })
  );
  const leftSeats     = $derived(seatSlots.filter(s => s.slot === 'left'));
  const rightSeats    = $derived(seatSlots.filter(s => s.slot === 'right'));
  const myBottomSeat  = $derived(seatSlots.find(s => s.slot === 'bottom'));

  let showHandSummary = $state(false);
  let lastShownSummaryKey = $state<string | null>(null);

  $effect(() => {
    const gs = $gameState;
    if (!gs) return;
    // Only re-show for a summary we haven't already shown/dismissed.
    // Comparing content prevents re-triggering on every reactive update mid-hand.
    if (gs.lastHandSummary) {
      const key = JSON.stringify(gs.lastHandSummary.deltas) + '|' + gs.lastHandSummary.runningTotals.join(',');
      if (key !== lastShownSummaryKey) {
        lastShownSummaryKey = key;
        showHandSummary = true;
      }
    }
    if (gs.continuation) showHandSummary = true;
  });

  // ── Card animations ────────────────────────────────────────────────────────────

  // Gate incoming state updates through the animation system.
  $effect(() => {
    const incoming = $gameState;
    if (!incoming || !displayState) return;

    const key = JSON.stringify(incoming.publicState.recentEvents);
    if (key === _lastEventKey) return;
    _lastEventKey = key;

    if (_animRunning) {
      _pendingState = incoming;
      return;
    }

    void runAnimations(incoming);
  });

  async function runAnimations(toState: NonNullable<GameState>) {
    _animRunning = true;
    try {
      await animateEventSequence(toState.publicState.recentEvents, toState);
    } finally {
      displayState = toState;
      _animRunning = false;
      if (_pendingState) {
        const next = _pendingState;
        _pendingState = null;
        void runAnimations(next);
      }
    }
  }

  async function animateEventSequence(events: AnimEvent[], toState: NonNullable<GameState>) {
    // Piles whose CARD_REVEALED already spawned animateFlipReveal — skip in CARDS_MOVED.
    const animatedPiles = new Set<string>();

    function willMoveToHand(fromIdx: number, player: number, pile: number): boolean {
      return events.slice(fromIdx + 1).some(
        e => e.type === 'CARDS_MOVED' &&
             e.transfers.some(
               t => t.from.zone === 'strawman' &&
                    t.from.player === player &&
                    t.from.pile   === pile,
             ),
      );
    }

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;

      if (ev.type === 'CARD_PLAYED') {
        // Capture card position before displayState updates — check hand first, then pile
        const flipId = `card-${ev.card.suit}${ev.card.rank}`;
        const handCardEl = document.querySelector(
          `[data-hand-area="${ev.player}"] [data-flip-id="${flipId}"]`,
        ) as HTMLElement | null;
        let fromRect = handCardEl?.getBoundingClientRect();

        // Find which pile the card came from (if any) for both position capture and state update
        let cardPile: { player: number; pile: number } | null = null;
        if (displayState!.strawmen) {
          for (let p = 0; p < displayState!.strawmen.length; p++) {
            const piles = displayState!.strawmen[p]!;
            const l = piles.findIndex(
              pl => pl.topCard?.suit === ev.card.suit && pl.topCard?.rank === ev.card.rank,
            );
            if (l >= 0) { cardPile = { player: p, pile: l }; break; }
          }
        }

        // If not found in hand, use pile card position (handles pile-played and opponent cards)
        if (!fromRect && cardPile) {
          const pileCardEl = document.querySelector(
            `[data-pile-player="${cardPile.player}"][data-pile-index="${cardPile.pile}"] [data-flip-id="${flipId}"]`,
          ) as HTMLElement | null;
          fromRect = pileCardEl?.getBoundingClientRect();
        }

        // Advance displayState: card moves from hand/pile to trick
        displayState = {
          ...displayState!,
          myHand: ev.player === myEngineIndex
            ? displayState!.myHand.filter(
                c => !(c.suit === ev.card.suit && c.rank === ev.card.rank),
              )
            : displayState!.myHand,
          strawmen: cardPile && displayState!.strawmen
            ? displayState!.strawmen.map((playerPiles, pi) =>
                pi === cardPile!.player
                  ? playerPiles.map((pile, li) =>
                      li === cardPile!.pile ? { ...pile, topCard: null } : pile,
                    )
                  : playerPiles,
              )
            : displayState!.strawmen,
          publicState: {
            ...displayState!.publicState,
            currentTrick: [
              ...displayState!.publicState.currentTrick,
              { playerIndex: ev.player, card: ev.card },
            ],
          },
        };

        await tick(); // let Svelte render trick card before GSAP reads its position
        animatePlayedCard(ev.card, ev.player, fromRect);
        await wait(450);

      } else if (ev.type === 'TRICK_RESOLVED') {
        await wait(100);
        animateTrickToWinner(ev.winner);
        await wait(600);

        displayState = {
          ...displayState!,
          publicState: {
            ...displayState!.publicState,
            currentTrick: [],
            lastCompletedTrick: toState.publicState.lastCompletedTrick,
            trickNum: toState.publicState.trickNum,
          },
        };

      } else if (ev.type === 'CARD_REVEALED') {
        const k = `${ev.player}-${ev.pile}`;

        if (willMoveToHand(i, ev.player, ev.pile)) {
          // T/K cascade: ghost flips and slides to hand.
          // displayState.topCard stays null — card never "appears" in pile.
          animatedPiles.add(k);
          await animateFlipReveal(ev.player, ev.pile, ev.card, false);
        } else {
          // Normal suit card stays in pile: in-place ghost flip.
          // onMidpoint updates displayState at the 90° edge so Svelte renders
          // the face-up card behind the hidden pile element during phase 2.
          await animatePileReveal(ev.player, ev.pile, ev.card, async () => {
            displayState = {
              ...displayState!,
              strawmen: displayState!.strawmen?.map((playerPiles, pi) =>
                pi === ev.player
                  ? playerPiles.map((pile, li) =>
                      li === ev.pile ? { ...pile, topCard: ev.card } : pile,
                    )
                  : playerPiles,
              ) ?? null,
            };
            await tick();
          });
        }

      } else if (ev.type === 'CARDS_MOVED') {
        for (const t of ev.transfers) {
          if (t.from.zone === 'strawman') {
            const k = `${t.from.player}-${t.from.pile}`;
            if (!animatedPiles.has(k)) {
              // bottom-to-hand: no preceding flip, just slide
              await animateFlipReveal(t.from.player, t.from.pile, t.card, true);
            }
          }
        }

        // Sync hand and pile state from toState after all transfers animated
        displayState = {
          ...displayState!,
          myHand: toState.myHand,
          strawmen: toState.strawmen,
        };

        // Fade in newly arrived hand cards
        await tick();
        for (const t of ev.transfers) {
          if (t.to.zone === 'hand' && t.to.player === myEngineIndex) {
            animateCardArrive(myEngineIndex, t.card);
          }
        }

      } else if (ev.type === 'HAND_SCORED') {
        await wait(200);
        displayState = {
          ...displayState!,
          publicState: {
            ...displayState!.publicState,
            scores: toState.publicState.scores,
          },
        };
      }
    }
  }

  function moveLabel(move: Move): string {
    if (move.type === "PLAY_CARD") return `${move.card.rank}${move.card.suit}`;
    if (move.type === "MAKE_BID") return move.bid;
    if (move.type === "PASS_BID") return "Pass";
    if (move.type === "MAKE_ANNOUNCEMENT") return move.announcement;
    return "?";
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
          {GAME_REGISTRY[$tableData.gameType]?.icon ?? ""}
        </span>
        <span class="table-title">{GAME_REGISTRY[$tableData.gameType]?.name ?? $tableData.gameType}</span>
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
              {GAME_REGISTRY[$tableData.gameType]?.icon ?? ""}
            </span>
            {GAME_REGISTRY[$tableData.gameType]?.name ?? $tableData.gameType}
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
                How to play {GAME_REGISTRY[$tableData.gameType]?.name ?? $tableData.gameType}
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

      {:else if $tableData.status === "active" || $tableData.status === "between_hands" || $tableData.status === "finished"}
        <div class="game-active">
          {#if displayState}
            <!-- Hand result modal — uses live $gameState so it shows immediately on hand end -->
            {#if showHandSummary && ($gameState?.lastHandSummary || $gameState?.continuation)}
              {@const hs = $gameState?.lastHandSummary ?? {
                deltas: [],
                runningTotals: $gameState?.publicState.scores ?? [],
                seatNames: $gameState?.seats.map(s => s.displayName) ?? [],
                breakdown: null,
                gameTarget: null,
                losers: null,
              }}
              <HandResultModal
                summary={hs}
                continuation={$gameState?.continuation ?? null}
                phase={$gameState?.publicState.phase ?? ''}
                {busy}
                onDismiss={() => showHandSummary = false}
                onVote={voteContinue}
              />
            {/if}

            <!-- Three-row table layout -->
              <div class="table-layout">

                <!-- Row 1: top players (0–3), horizontal -->
                {#if topRowSeats.length > 0}
                  <div class="top-row">
                    {#each topRowSeats as seat (seat.seatIndex)}
                      <div data-player-token={seat.enginePlayerIndex}>
                        <PlayerToken
                          name={seat.displayName}
                          isBot={seat.isBot}
                          cardCount={seat.handSize}
                          slot={seat.slot}
                          score={displayState.publicState.scores[seat.enginePlayerIndex] ?? 0}
                          isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
                          isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
                        />
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Row 2: left side | table center | right side -->
                <div class="middle-row">
                  <div class="side-left">
                    {#each leftSeats as seat (seat.seatIndex)}
                      <div data-player-token={seat.enginePlayerIndex}>
                        <PlayerToken
                          name={seat.displayName}
                          isBot={seat.isBot}
                          cardCount={seat.handSize}
                          slot="left"
                          score={displayState.publicState.scores[seat.enginePlayerIndex] ?? 0}
                          isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
                          isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
                        />
                      </div>
                    {/each}
                  </div>

                  <div class="table-center">
                    {#if displayState.strawmen}
                      {@const opponentEngineIdx = myEngineIndex === 0 ? 1 : 0}
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
                        displayState!.seats.length
                      )}
                    />
                  </div>

                  <div class="side-right">
                    {#each rightSeats as seat (seat.seatIndex)}
                      <div data-player-token={seat.enginePlayerIndex}>
                        <PlayerToken
                          name={seat.displayName}
                          isBot={seat.isBot}
                          cardCount={seat.handSize}
                          slot="right"
                          score={displayState.publicState.scores[seat.enginePlayerIndex] ?? 0}
                          isCurrentTurn={seat.enginePlayerIndex === displayState.publicState.currentTurn}
                          isDealer={seat.enginePlayerIndex === displayState.publicState.dealer}
                        />
                      </div>
                    {/each}
                  </div>
                </div>

                <!-- Row 3: current player -->
                <div class="bottom-row">
                  {#if myBottomSeat}
                    <div data-player-token={myBottomSeat.enginePlayerIndex}>
                      <PlayerToken
                        name={myBottomSeat.displayName}
                        isBot={myBottomSeat.isBot}
                        cardCount={0}
                        slot="bottom"
                        score={displayState.publicState.scores[myBottomSeat.enginePlayerIndex] ?? 0}
                        isCurrentTurn={isMyTurn}
                        isDealer={myBottomSeat.enginePlayerIndex === displayState.publicState.dealer}
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
                            ? () => playMove({ type: 'PLAY_CARD', card: topCard })
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
                          <button class="move-btn" onclick={() => playMove(move)} disabled={busy}>
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
                        isMyTurn={isMyTurn}
                        {busy}
                        onplay={(card) => playMove({ type: 'PLAY_CARD', card })}
                        sortFn={$tableData.gameType === 'strohmandeln' ? tarockSort : whistSort}
                      />
                    {/if}
                  </div>
                </div>

              </div>

          {:else}
            <p class="muted centered">Loading game…</p>
          {/if}
        </div>

      {:else}
        <!-- Game over screen -->
        <div class="game-over-screen">
          <div class="game-over-icon" aria-hidden="true">
            {GAME_REGISTRY[$tableData?.gameType ?? ""]?.icon ?? ""}
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
    max-width: 820px;
  }

  /* ── Three-row table layout ──────────────────────────────────────────────── */
  .table-layout {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  /* Row 1: top players, displayed horizontally with spacing */
  .top-row {
    display: flex;
    justify-content: center;
    gap: 3rem;
    flex-wrap: wrap;
  }

  /* Row 2: left side | center table | right side */
  .middle-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
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

  /* Row 3: current player — always full width */
  .bottom-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
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
