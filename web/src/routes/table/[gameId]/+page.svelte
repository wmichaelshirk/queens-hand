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
  import type { Card, Move, StrawmanPileInfo, AnimEvent, GameState, GameSeat } from "$lib/gameTypes";
  import HandResultModal from "$lib/components/HandResultModal.svelte";
  import GameTableSlobberhannes from "$lib/components/GameTableSlobberhannes.svelte";
  import GameTableStrohmandeln from "$lib/components/GameTableStrohmandeln.svelte";
  import GameTableDreiertarock from "$lib/components/GameTableDreiertarock.svelte";
  import GameInfoPanel from "$lib/components/GameInfoPanel.svelte";
  import { animatePlayedCard, animateTrickToWinner, animateFlipReveal, animatePileReveal, animateCardArrive, animateDeal, wait } from "$lib/cardAnimations";

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
  let _pendingQueue: NonNullable<GameState>[] = [];
  let _lastEventKey = '';

  $effect(() => {
    if ($gameState && !displayState) {
      const currentKey = JSON.stringify($gameState.publicState.recentEvents);
      const storedKey = browser
        ? (sessionStorage.getItem(`animKey:${gameId}`) ?? '')
        : currentKey;
      if (storedKey === currentKey) {
        // Mid-session refresh: these events were already animated, skip them.
        displayState = $gameState;
        _lastEventKey = currentKey;
      } else {
        // First load: reconstruct pre-animation state so piles start face-down.
        displayState = _preAnimationState($gameState);
        // Don't set _lastEventKey — Effect 2 will animate.
      }
    }
  });

  const isMyTurn = $derived(
    !_animRunning &&
    myEngineIndex >= 0 && $gameState?.publicState.currentTurn === myEngineIndex
  );

  // ── Page-level move dialogs ────────────────────────────────────────────────────

  // "Choice" dialog: single-select (bidding, contract choice).
  // "Declaration" dialog: multi-select (declaring phase announcements + kontras).
  // Both read from live $gameState so they appear as soon as it's your turn,
  // not after animations finish (isMyTurn gates submission, not display).

  const CHOICE_TYPES     = new Set(['MAKE_BID', 'PASS_BID', 'CHOOSE_CONTRACT']);
  const DECLARING_TYPES  = new Set(['MAKE_ANNOUNCEMENT', 'KONTRA', 'PASS_ANNOUNCEMENT']);

  const showChoiceDialog = $derived(
    isMyTurn &&
    ($gameState?.legalMoves ?? []).some(m => CHOICE_TYPES.has(m.type))
  );

  const showDeclarationDialog = $derived(
    isMyTurn &&
    ($gameState?.legalMoves ?? []).some(m => DECLARING_TYPES.has(m.type))
  );

  // Choices available in the choice dialog (bidding / contract choice moves).
  const choiceMoves = $derived(
    ($gameState?.legalMoves ?? []).filter(m => CHOICE_TYPES.has(m.type))
  );

  // Individual options available in the declaration dialog.
  const declarationOptions = $derived(
    ($gameState?.legalMoves ?? []).filter(m => m.type === 'MAKE_ANNOUNCEMENT' || m.type === 'KONTRA')
  );

  let selectedDeclarations = $state<Array<{ type: 'MAKE_ANNOUNCEMENT'; announcement: string } | { type: 'KONTRA'; target: string }>>([]);

  $effect(() => {
    // Reset selections whenever the dialog appears fresh (different legal moves).
    if (showDeclarationDialog) selectedDeclarations = [];
  });

  function toggleDeclaration(move: Move) {
    if (move.type !== 'MAKE_ANNOUNCEMENT' && move.type !== 'KONTRA') return;
    const key = move.type === 'MAKE_ANNOUNCEMENT' ? `ann:${move.announcement}` : `k:${move.target}`;
    const existing = selectedDeclarations.findIndex(d =>
      (d.type === 'MAKE_ANNOUNCEMENT' && move.type === 'MAKE_ANNOUNCEMENT' && d.announcement === move.announcement) ||
      (d.type === 'KONTRA' && move.type === 'KONTRA' && d.target === move.target)
    );
    if (existing >= 0) {
      selectedDeclarations = selectedDeclarations.filter((_, i) => i !== existing);
    } else {
      selectedDeclarations = [...selectedDeclarations, move as { type: 'MAKE_ANNOUNCEMENT'; announcement: string } | { type: 'KONTRA'; target: string }];
    }
  }

  function isSelected(move: Move): boolean {
    if (move.type === 'MAKE_ANNOUNCEMENT')
      return selectedDeclarations.some(d => d.type === 'MAKE_ANNOUNCEMENT' && d.announcement === move.announcement);
    if (move.type === 'KONTRA')
      return selectedDeclarations.some(d => d.type === 'KONTRA' && d.target === move.target);
    return false;
  }

  function submitDeclaration() {
    playMove({ type: 'SUBMIT_DECLARATION', actions: selectedDeclarations });
  }

  function moveLabel(move: Move): string {
    if (move.type === 'MAKE_BID') {
      return move.bid === ($gameState!.publicState.currentBid ?? null) ? 'Hold' : move.bid;
    }
    if (move.type === 'PASS_BID') return 'Pass';
    if (move.type === 'PASS_ANNOUNCEMENT') return 'Pass';
    if (move.type === 'MAKE_ANNOUNCEMENT') return move.announcement;
    if (move.type === 'CHOOSE_CONTRACT') return move.contract;
    if (move.type === 'CHOOSE_TALON') return move.choice === 'first' ? 'First Half' : 'Second Half';
    if (move.type === 'KONTRA') {
      const lvl = (move as any).level ?? 'Kontra';
      return move.target === 'game' ? lvl : `${lvl}: ${move.target}`;
    }
    return '?';
  }

  let showHandSummary = $state(false);
  let lastShownSummaryKey = $state<string | null>(null);
  let modalWasInVoteMode = false;

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
    if (gs.continuation) {
      showHandSummary = true;
      modalWasInVoteMode = true;
    } else if (modalWasInVoteMode) {
      // Everyone voted continue; game already moved on — close without requiring "Got it".
      showHandSummary = false;
      modalWasInVoteMode = false;
    }
  });

  // ── Card animations ────────────────────────────────────────────────────────────

  function formatAnimEvents(events: AnimEvent[], seats: GameSeat[]): string[] {
    const name = (i: number) => seats.find(s => s.enginePlayerIndex === i)?.displayName ?? `Player ${i + 1}`;
    const msgs: string[] = [];
    for (const ev of events) {
      switch (ev.type) {
        case 'CARD_PLAYED':
          msgs.push(`${name(ev.player)} played ${ev.card.rank}${ev.card.suit}`);
          break;
        case 'TRICK_RESOLVED':
          msgs.push(`${name(ev.winner)} won the trick`);
          break;
        case 'HAND_SCORED': {
          const deltas = ev.deltas.map(d => `${name(d.player)}: ${d.delta > 0 ? '+' : ''}${d.delta}`).join('  ');
          const totals = ev.runningTotals.map((t, i) => `${name(i)}: ${t}`).join('  ');
          msgs.push(`Hand: ${deltas}  |  Running: ${totals}`);
          break;
        }
        case 'GAME_OVER': {
          const losers = ev.losers?.map(i => name(i)).join(', ');
          msgs.push(losers ? `Game over! Loser(s): ${losers}` : 'Game over!');
          break;
        }
        case 'BID_MADE':
          msgs.push(`${name(ev.player)} bid: ${ev.bid}`);
          break;
        case 'BID_PASSED':
          msgs.push(`${name(ev.player)} passed`);
          break;
        case 'CARD_REVEALED':
          msgs.push(`${ev.card.rank}${ev.card.suit} revealed from ${name(ev.player)}'s pile ${ev.pile + 1}`);
          break;
        case 'CONTRACT_SET':
          msgs.push(ev.contract === 'Trischaken'
            ? 'Trischaken — every player for themselves'
            : `${name(ev.declarer)} declared ${ev.contract}`);
          break;
        case 'ANNOUNCEMENT_MADE':
          msgs.push(ev.announcement === 'pass'
            ? `${name(ev.player)} passed`
            : `${name(ev.player)} announced ${ev.announcement}`);
          break;
        case 'CARDS_MOVED':
          if (ev.reason === 'talon-exchange') {
            const taken = ev.transfers.filter(t => t.to.zone === 'hand');
            if (taken.length > 0) {
              const player = (taken[0]!.to as { zone: 'hand'; player: number }).player;
              const cards = taken.map(t => `${t.card.rank}${t.card.suit}`).join(' ');
              msgs.push(`${name(player)} took ${cards}`);
            }
          } else {
            for (const t of ev.transfers) {
              if (t.from.zone === 'strawman' && t.to.zone === 'hand') {
                msgs.push(`${t.card.rank}${t.card.suit} → ${name((t.to as { zone: 'hand'; player: number }).player)}'s hand`);
              }
            }
          }
          break;
        case 'DEAL':
          msgs.push(ev.zone === 'hand'
            ? `${name(ev.dealer)} deals ${ev.count} card${ev.count !== 1 ? 's' : ''} to ${name(ev.to)}`
            : `${name(ev.dealer)} deals to ${name(ev.to)}'s pile ${(ev.pile ?? 0) + 1}`);
          break;
      }
    }
    return msgs;
  }

  // Log hand-complete scores to the browser console when status transitions to between_hands.
  let _lastTableStatus = $state<string | undefined>(undefined);
  $effect(() => {
    const status = $tableData?.status;
    if (_lastTableStatus !== 'between_hands' && status === 'between_hands') {
      const scores = $gameState?.publicState.scores ?? [];
      const names = $tableData?.seats.map(s => s.displayName) ?? [];
      const scoreText = scores.map((s, i) => `${names[i] ?? i}: ${s}`).join('  |  ');
      console.log(`Hand complete! Running scores — ${scoreText}`);
    }
    _lastTableStatus = status;
  });

  // Gate incoming state updates through the animation system.
  $effect(() => {
    const incoming = $gameState;
    if (!incoming || !displayState) return;

    const key = JSON.stringify(incoming.publicState.recentEvents);
    if (key === _lastEventKey) return;
    _lastEventKey = key;

    if (incoming.publicState.recentEvents?.length) {
      for (const msg of formatAnimEvents(incoming.publicState.recentEvents, incoming.seats)) {
        console.log(msg);
      }
    }

    if (_animRunning) {
      _pendingQueue.push(incoming);
      return;
    }

    void runAnimations(incoming);
  });

  // Reconstruct the game state as it was before the initial strawman uncovering,
  // so that piles animate from face-down rather than starting in their final state.
  function _preAnimationState(gs: NonNullable<GameState>): NonNullable<GameState> {
    const events = gs.publicState.recentEvents ?? [];

    // If deal events are present, we're animating from an empty state.
    if (events.some(e => e.type === 'DEAL')) {
      const strawmen = gs.strawmen?.map(pp => pp.map(() => ({ depth: 0, topCard: null }))) ?? null;
      const seats = gs.seats.map(s => ({ ...s, handSize: 0 }));
      return { ...gs, myHand: [], strawmen, seats };
    }

    // Otherwise reconstruct pre-uncover state from CARD_REVEALED / CARDS_MOVED only.
    const pileDepthInc = new Map<string, number>();
    const cascadedCards = new Set<string>();
    const revealedPiles = new Set<string>();

    for (const ev of events) {
      if (ev.type === 'CARD_REVEALED') revealedPiles.add(`${ev.player}-${ev.pile}`);
      if (ev.type === 'CARDS_MOVED') {
        for (const t of ev.transfers) {
          if (t.from.zone === 'strawman') {
            const k = `${t.from.player}-${t.from.pile}`;
            pileDepthInc.set(k, (pileDepthInc.get(k) ?? 0) + 1);
            cascadedCards.add(`${t.card.suit}${t.card.rank}`);
          }
        }
      }
    }

    if ((pileDepthInc.size === 0 && revealedPiles.size === 0) || !gs.strawmen) return gs;

    const strawmen = gs.strawmen.map((playerPiles, pi) =>
      playerPiles.map((pile, li) => {
        const k = `${pi}-${li}`;
        if (revealedPiles.has(k) || pileDepthInc.has(k)) {
          return { depth: pile.depth + (pileDepthInc.get(k) ?? 0), topCard: null };
        }
        return pile;
      })
    );
    const myHand = gs.myHand.filter(c => !cascadedCards.has(`${c.suit}${c.rank}`));
    return { ...gs, myHand, strawmen };
  }

  async function runAnimations(toState: NonNullable<GameState>) {
    _animRunning = true;
    try {
      await animateEventSequence(toState.publicState.recentEvents, toState);
    } finally {
      // Set displayState to toState, but suppress topCard for any pile where:
      //   (a) the animation just left topCard=null (card was played from that pile), AND
      //   (b) toState already shows the new card, AND
      //   (c) no CARD_REVEALED arrived in this batch.
      // Without this, the new pile top would flash visible between moves when the reveal
      // was deferred to the next trick (deferredPileReveal engine fix).
      const eventsInBatch = toState.publicState.recentEvents ?? [];
      const revealsInBatch = new Set(
        eventsInBatch
          .filter((e): e is Extract<AnimEvent, { type: 'CARD_REVEALED' }> => e.type === 'CARD_REVEALED')
          .map(e => `${e.player}-${e.pile}`),
      );
      const clearedPublicState = { ...toState.publicState, recentEvents: [] as typeof toState.publicState.recentEvents };
      if (displayState?.strawmen && toState.strawmen) {
        const strawmen = toState.strawmen.map((pp, pi) =>
          pp.map((pile, li) =>
            pile.topCard != null &&
            displayState!.strawmen![pi]?.[li]?.topCard == null &&
            !revealsInBatch.has(`${pi}-${li}`)
              ? displayState!.strawmen![pi]![li]!   // preserve depth from post-CARD_PLAYED state
              : pile,
          ),
        );
        displayState = { ...toState, strawmen, publicState: clearedPublicState };
      } else {
        displayState = { ...toState, publicState: clearedPublicState };
      }
      _animRunning = false;
      if (browser) sessionStorage.setItem(`animKey:${gameId}`, _lastEventKey);
      if (_pendingQueue.length > 0) {
        void runAnimations(_pendingQueue.shift()!);
      }
    }
  }

  async function animateEventSequence(events: AnimEvent[], toState: NonNullable<GameState>) {
    // Piles whose CARD_REVEALED already spawned animateFlipReveal — skip in CARDS_MOVED.
    const animatedPiles = new Set<string>();
    // Tracks how many cards have been dealt to me so far, for slicing toState.myHand.
    let myDealtToMe = 0;

    // Reset displayState to pre-deal appearance before any DEAL animation fires.
    if (events.some(e => e.type === 'DEAL')) {
      displayState = _preAnimationState(toState);
    }

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

      if (ev.type === 'DEAL') {
        await animateDeal(ev.dealer, ev.to, ev.zone, ev.pile ?? 0, ev.count);
        if (ev.zone === 'hand') {
          const updatedSeats = displayState!.seats.map(s =>
            s.enginePlayerIndex === ev.to ? { ...s, handSize: s.handSize + ev.count } : s
          );
          if (ev.to === myEngineIndex) {
            const arrived = toState.myHand.slice(myDealtToMe, myDealtToMe + ev.count);
            myDealtToMe += ev.count;
            displayState = { ...displayState!, myHand: [...displayState!.myHand, ...arrived], seats: updatedSeats };
            await tick();
            for (const c of arrived) animateCardArrive(myEngineIndex, c);
          } else {
            displayState = { ...displayState!, seats: updatedSeats };
          }
        } else if (ev.zone === 'strawman' && displayState!.strawmen) {
          const strawmen = displayState!.strawmen.map((pp, pi) =>
            pi === ev.to
              ? pp.map((pile, li) =>
                  li === (ev.pile ?? 0) ? { ...pile, depth: pile.depth + ev.count } : pile
                )
              : pp
          );
          displayState = { ...displayState!, strawmen };
        }

      } else if (ev.type === 'CARD_PLAYED') {
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
          seats: displayState!.seats.map(s =>
            s.enginePlayerIndex === ev.player ? { ...s, handSize: s.handSize - 1 } : s
          ),
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

        // When a pile-led card's reveal was deferred to the next move, displayState was
        // set to toState at the end of that prior move — making the new topCard visible
        // before this animation runs. Reset to null so the flip starts from face-down.
        if (displayState!.strawmen?.[ev.player]?.[ev.pile]?.topCard != null) {
          displayState = {
            ...displayState!,
            strawmen: displayState!.strawmen!.map((pp, pi) =>
              pi === ev.player
                ? pp.map((pile, li) => li === ev.pile ? { ...pile, topCard: null } : pile)
                : pp
            ),
          };
          await tick();
        }

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

        // Sync hand and pile state. For strawman cascades use incremental
        // update so intermediate animation frames show correct pile depths.
        const hasStrawman = ev.transfers.some(t => t.from.zone === 'strawman');
        if (hasStrawman && displayState!.strawmen) {
          const strawmen = displayState!.strawmen.map((playerPiles, pi) =>
            playerPiles.map((pile, li) => {
              const n = ev.transfers.filter(
                t => t.from.zone === 'strawman' && t.from.player === pi && t.from.pile === li
              ).length;
              return n > 0 ? { ...pile, depth: Math.max(0, pile.depth - n) } : pile;
            })
          );
          const addedToMyHand = ev.transfers
            .filter(t => t.from.zone === 'strawman' && t.to.zone === 'hand' && t.to.player === myEngineIndex)
            .map(t => t.card);
          displayState = {
            ...displayState!,
            myHand: [...displayState!.myHand, ...addedToMyHand],
            strawmen,
            talon: toState.talon,
          };
        } else {
          displayState = {
            ...displayState!,
            myHand: toState.myHand,
            strawmen: toState.strawmen,
            talon: toState.talon,
          };
        }

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

      } else if (ev.type === 'BID_MADE' || ev.type === 'BID_PASSED' || ev.type === 'CONTRACT_SET') {
        displayState = {
          ...displayState!,
          publicState: { ...displayState!.publicState, recentEvents: [ev] },
        };
        await tick();
      } else if (ev.type === 'ANNOUNCEMENT_MADE') {
        // Collect all consecutive ANNOUNCEMENT_MADE events so one speech bubble shows them all.
        const group: AnimEvent[] = [ev];
        while (i + 1 < events.length && events[i + 1]!.type === 'ANNOUNCEMENT_MADE') {
          group.push(events[++i]!);
        }
        displayState = {
          ...displayState!,
          publicState: { ...displayState!.publicState, recentEvents: group },
        };
        await tick();
      }
    }
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

  // ── Options popover ────────────────────────────────────────────────────────────

  let showOptionsPopover = $state(false);
  let optionsWrapperEl = $state<HTMLElement | undefined>(undefined);

  const activeOptions = $derived(
    $tableData
      ? (GAME_OPTIONS[$tableData.gameType] ?? []).map(opt => ({
          label: opt.label,
          currentLabel: opt.choices.find(
            c => c.value === String($tableData!.settings?.[opt.key] ?? opt.default)
          )?.label ?? String($tableData!.settings?.[opt.key] ?? opt.default),
        }))
      : []
  );

  $effect(() => {
    if (!showOptionsPopover) return;
    function onDocClick(e: MouseEvent) {
      if (optionsWrapperEl && !optionsWrapperEl.contains(e.target as Node)) {
        showOptionsPopover = false;
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  });

  // ── Table chat ─────────────────────────────────────────────────────────────────

  type TableMsg = { _id: string; playerId?: string; displayName: string; text: string; ts: number; isAiResponse?: boolean };

  let localMessages = $state<TableMsg[]>([]);
  let sinceTs = $state(Date.now());
  let chatText = $state("");
  let chatEl = $state<HTMLDivElement | undefined>(undefined);

  // Re-subscribes each time sinceTs advances so each delivery contains only new messages.
  $effect(() => {
    const unsub = convex.onUpdate(
      "games:getTableMessages" as any,
      { gameId, sinceTs },
      (newMsgs: TableMsg[]) => {
        if (newMsgs.length > 0) {
          localMessages = [...localMessages, ...newMsgs];
          sinceTs = newMsgs[newMsgs.length - 1].ts;
        }
      }
    );
    return unsub;
  });

  $effect(() => {
    if (localMessages.length > 0 && chatEl) chatEl.scrollTop = chatEl.scrollHeight;
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
        {#if activeOptions.length > 0}
          <div class="title-options-wrapper" bind:this={optionsWrapperEl}>
            <button
              class="table-title title-options-btn"
              onclick={() => showOptionsPopover = !showOptionsPopover}
              aria-expanded={showOptionsPopover}
            >
              {GAME_REGISTRY[$tableData.gameType]?.name ?? $tableData.gameType}
              <span class="title-caret" class:open={showOptionsPopover} aria-hidden="true">▾</span>
            </button>
            {#if showOptionsPopover}
              <div class="options-popover" role="dialog" aria-label="Game options">
                <div class="options-popover-title">Game options</div>
                {#each activeOptions as opt}
                  <div class="options-popover-row">
                    <span class="options-popover-label">{opt.label}</span>
                    <span class="options-popover-value">{opt.currentLabel}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <span class="table-title">{GAME_REGISTRY[$tableData.gameType]?.name ?? $tableData.gameType}</span>
        {/if}
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

            <!-- Choice dialog: single-select (bidding / contract choice) -->
            {#if showChoiceDialog}
              <div class="move-dialog-overlay">
                <div class="move-dialog">
                  <div class="move-dialog-title">Choose your action</div>
                  <div class="move-dialog-grid">
                    {#each choiceMoves as move, i (i)}
                      <button
                        class="move-dialog-btn"
                        class:pass={move.type === 'PASS_BID'}
                        onclick={() => playMove(move)}
                        disabled={busy}
                      >
                        {moveLabel(move)}
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            {/if}

            <!-- Declaration dialog: multi-select (declaring phase) -->
            {#if showDeclarationDialog}
              <div class="move-dialog-overlay">
                <div class="move-dialog">
                  <div class="move-dialog-title">Announce / Kontra</div>
                  {#if declarationOptions.length > 0}
                    <div class="declaration-options">
                      {#each declarationOptions as move, i (i)}
                        <label class="declaration-option" class:selected={isSelected(move)}>
                          <input
                            type="checkbox"
                            checked={isSelected(move)}
                            onchange={() => toggleDeclaration(move)}
                          />
                          <span>{moveLabel(move)}</span>
                        </label>
                      {/each}
                    </div>
                  {:else}
                    <p class="declaration-empty">Nothing to announce.</p>
                  {/if}
                  <button class="move-dialog-submit" onclick={submitDeclaration} disabled={busy}>
                    {selectedDeclarations.length === 0 ? 'Pass' : `Submit (${selectedDeclarations.length})`}
                  </button>
                </div>
              </div>
            {/if}

            <GameInfoPanel
              phase={displayState.publicState.phase}
              contract={displayState.publicState.contract}
              currentBid={displayState.publicState.currentBid}
              declarer={displayState.publicState.declarer ?? null}
              announcements={displayState.publicState.announcements ?? []}
              kontraItems={displayState.publicState.kontraItems ?? []}
              scores={displayState.publicState.scores}
              playerNames={displayState.seats.map(s => s.displayName)}
            />

            {#if displayState.gameType === 'slobberhannes'}
              <GameTableSlobberhannes {displayState} {myEngineIndex} {isMyTurn} {busy} onPlayMove={playMove} />
            {:else if displayState.gameType === 'strohmandeln'}
              <GameTableStrohmandeln {displayState} {myEngineIndex} {isMyTurn} {busy} onPlayMove={playMove} />
            {:else if displayState.gameType === 'dreiertarock'}
              <GameTableDreiertarock {displayState} {myEngineIndex} {isMyTurn} {busy} onPlayMove={playMove} />
            {/if}
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
          {#if localMessages.length > 0}
            {#each localMessages as msg (msg._id)}
              <div class="msg" class:ai={msg.isAiResponse} class:own={!msg.isAiResponse && msg.playerId === currentPlayer?._id}>
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

  .title-options-wrapper {
    position: relative;
  }

  .title-options-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .title-caret {
    font-size: 0.7rem;
    color: #a03040;
    transition: transform 0.15s;
    line-height: 1;
  }

  .title-caret.open {
    transform: rotate(180deg);
  }

  .options-popover {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 200;
    background: #12192e;
    border: 1px solid #0f3460;
    border-radius: 8px;
    padding: 0.65rem 0.85rem;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .options-popover-title {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid #1a2a40;
  }

  .options-popover-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .options-popover-label {
    font-size: 0.82rem;
    color: #999;
  }

  .options-popover-value {
    font-size: 0.82rem;
    font-weight: 600;
    color: #e0e0e0;
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
    align-items: stretch;
    justify-content: center;
    overflow-y: auto;
    padding: 0;
  }

  .waiting-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    max-width: 540px;
    width: 100%;
    padding: 2rem;
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
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: 820px;
    position: relative;
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
  .msg.ai { border-left: 2px solid #c9a84c; padding-left: 0.4rem; font-style: italic; }
  .msg.ai .msg-name { color: #c9a84c; }

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

  /* ── Move dialogs (choice + declaration overlays) ────────────────────────── */
  .move-dialog-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    pointer-events: none;
  }

  .move-dialog {
    background: #12192e;
    border: 1px solid #1a4a80;
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 240px;
    max-width: 380px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    pointer-events: all;
  }

  .move-dialog-title {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #666;
    text-align: center;
  }

  .move-dialog-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }

  .move-dialog-btn {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 0.9rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    min-width: 60px;
    text-align: center;
  }
  .move-dialog-btn:hover:not(:disabled) { background: #1a5a90; border-color: #e94560; }
  .move-dialog-btn:disabled { opacity: 0.45; cursor: default; }
  .move-dialog-btn.pass { color: #888; border-color: #1a3060; }
  .move-dialog-btn.pass:hover:not(:disabled) { color: #ccc; }

  .declaration-options {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .declaration-option {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #1a3060;
    cursor: pointer;
    font-size: 0.9rem;
    color: #ccc;
    transition: border-color 0.12s, background 0.12s;
  }
  .declaration-option:hover { border-color: #2a5090; background: #0d1e38; }
  .declaration-option.selected { border-color: #e94560; background: #1e0a18; color: #fff; }
  .declaration-option input[type="checkbox"] { accent-color: #e94560; width: 15px; height: 15px; }

  .declaration-empty {
    font-size: 0.82rem;
    color: #555;
    font-style: italic;
    text-align: center;
    margin: 0;
  }

  .move-dialog-submit {
    background: #e94560;
    border: 1px solid #e94560;
    border-radius: 6px;
    color: #fff;
    padding: 0.55rem 1rem;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
  }
  .move-dialog-submit:hover:not(:disabled) { background: #c73652; }
  .move-dialog-submit:disabled { opacity: 0.45; cursor: default; }
</style>
