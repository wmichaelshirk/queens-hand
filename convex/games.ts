import { v } from "convex/values";
import {
  mutation, query, internalMutation, internalAction, internalQuery,
  MutationCtx, QueryCtx,
} from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import * as Slobberhannes from "../engines/slobberhannes";
import * as Strohmandeln from "../engines/strohmandeln";
import { chooseMove } from "../ai/ismcts";
import type { Move, Card, BareEvent } from "../types";

function movesEqual(a: Move, b: Move): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "PLAY_CARD" && b.type === "PLAY_CARD")
    return a.card.suit === b.card.suit && a.card.rank === b.card.rank;
  if (a.type === "MAKE_BID" && b.type === "MAKE_BID") return a.bid === b.bid;
  if (a.type === "PASS_BID") return true;
  if (a.type === "MAKE_ANNOUNCEMENT" && b.type === "MAKE_ANNOUNCEMENT")
    return a.announcement === b.announcement;
  return false;
}

const GAME_CONFIG = {
  slobberhannes: { min: 3, max: 6, default: 4 },
  strohmandeln:  { min: 2, max: 2, default: 2 },
} as const;

const GAME_DEFAULT_SETTINGS: Record<string, Record<string, unknown>> = {
  slobberhannes: {},
  strohmandeln:  { scoring: 'Mayr' },
};

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolvePlayer(ctx: MutationCtx, guestUserId: string | undefined) {
  const authUserId = await getAuthUserId(ctx);
  const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
  if (!userId) throw new Error("Not authenticated");
  const player = await ctx.db
    .query("players")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!player) throw new Error("Player record not found");
  return player;
}

async function resolvePlayerForQuery(ctx: QueryCtx, guestUserId: string | undefined) {
  const authUserId = await getAuthUserId(ctx);
  const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
  if (!userId) return null;
  return ctx.db
    .query("players")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// ── Engine adapters ───────────────────────────────────────────────────────────

type GameType = "slobberhannes" | "strohmandeln";

type NormalizedPlayerBreakdown = {
  player: number;
  role:   string | null;  // 'declarer' | 'defender' | 'none' | null
  items:  { label: string; delta: number }[];
  total:  number;
};

interface EngineAdapter {
  start(config: { seats: number; scores: number[] | null; firstPlayer: number; settings: Record<string, unknown> }): { state: any; events: BareEvent[] };
  getLegalMoves(state: any): Move[];
  applyMove(state: any, move: Move): { state: any; events: BareEvent[] };
  getCurrentPlayer(state: any): number;
  getDealer(state: any): number;
  isHandOver(state: any): boolean;
  isGameOver(state: any): boolean;
  getGameResult(state: any): any;
  reDeal(state: any, settings: Record<string, unknown>): { state: any; events: BareEvent[] };
  chooseBotMove(state: any, playerIndex: number): Move;
  getHands(state: any): Card[][];
  getHandBreakdown(state: any): NormalizedPlayerBreakdown[] | null;
}

const slobberAdapter: EngineAdapter = {
  start({ seats, scores, firstPlayer, settings: _settings }) {
    const state = Slobberhannes.dealState({
      scores: scores ?? null,
      dealerIndex: firstPlayer,
      playerCount: seats,
    });
    return { state, events: [] };
  },
  getLegalMoves(state) {
    return Slobberhannes.getLegalMoves(state).map((card) => ({
      type: "PLAY_CARD" as const,
      card,
    }));
  },
  applyMove(state, move) {
    if (move.type !== "PLAY_CARD") throw new Error("Slobberhannes: only PLAY_CARD moves");
    return Slobberhannes.applyMove(state, move.card);
  },
  getCurrentPlayer(state) { return Slobberhannes.getCurrentPlayer(state); },
  getDealer(state) { return (state as Slobberhannes.State).dealer; },
  isHandOver(state) { return Slobberhannes.isHandOver(state); },
  isGameOver(state) { return Slobberhannes.isGameOver(state); },
  getGameResult(state) { return Slobberhannes.getGameResult(state); },
  reDeal(state, _settings) {
    const newState = Slobberhannes.dealState({
      scores: state.scores,
      dealerIndex: (state.dealer + 1) % state.playerCount,
      playerCount: state.playerCount,
    });
    return { state: newState, events: [] };
  },
  chooseBotMove(state, playerIndex) {
    const card = chooseMove(Slobberhannes, state as Slobberhannes.State, playerIndex, {
      iterations: 200,
    });
    return { type: "PLAY_CARD", card };
  },
  getHands(state) { return state.hands as Card[][]; },
  getHandBreakdown(state) {
    const breakdown = Slobberhannes.getHandBreakdown(state as Slobberhannes.State);
    // Penalties are negated so delta < 0 means "bad" consistently across all engines.
    // (A player who took first trick + QoC shows total: -2, each item at delta: -1.)
    return breakdown.map(b => ({
      player: b.player,
      role:   null,
      items:  b.items.map(label => ({ label, delta: -1 })),
      total:  -b.total,
    }));
  },
};

const strahAdapter: EngineAdapter = {
  start({ scores, firstPlayer, settings }) {
    const rawState = Strohmandeln.dealState({
      scores: scores ?? null,
      dealerIndex: firstPlayer,
      scoring: (settings.scoring as Strohmandeln.ScoringSystemName | undefined) ?? "Mayr",
    });
    return Strohmandeln.uncoverStrawmenInitial(rawState);
  },
  getLegalMoves(state) {
    return Strohmandeln.getLegalMoves(state) as Move[];
  },
  applyMove(state, move) {
    return Strohmandeln.applyMove(state, move as any);
  },
  getCurrentPlayer(state) { return Strohmandeln.getCurrentPlayer(state); },
  getDealer(state) { return (state as Strohmandeln.State).dealerIndex; },
  isHandOver(state) { return Strohmandeln.isHandOver(state); },
  isGameOver(state) { return Strohmandeln.isGameOver(state); },
  getGameResult(_state) { return null; },
  reDeal(state, settings) {
    const rawState = Strohmandeln.dealState({
      scores: state.scores,
      dealerIndex: (state.dealerIndex + 1) % 2,
      scoring: (settings.scoring as Strohmandeln.ScoringSystemName | undefined) ?? state.scoring ?? "Mayr",
      handMultiplier: state.nextHandMultiplier,
    });
    return Strohmandeln.uncoverStrawmenInitial(rawState);
  },
  chooseBotMove(state, playerIndex) {
    return chooseMove(Strohmandeln, state as Strohmandeln.State, playerIndex, {
      iterations: 200,
    }) as Move;
  },
  getHands(state) { return state.hands as Card[][]; },
  getHandBreakdown(state) {
    const breakdown = Strohmandeln.computeScoreBreakdown(state as Strohmandeln.State);
    if (!breakdown) return null;
    return breakdown.map(b => ({
      player: b.player,
      role:   b.role,
      items:  b.items,
      total:  b.total,
    }));
  },
};

function getAdapter(gameType: GameType): EngineAdapter {
  return gameType === "slobberhannes" ? slobberAdapter : strahAdapter;
}

// ── Event → chat message ──────────────────────────────────────────────────────

function formatEvents(events: BareEvent[], seatNames: string[]): string[] {
  const name = (i: number) => seatNames[i] ?? `Player ${i + 1}`;
  const msgs: string[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case "CARD_PLAYED":
        msgs.push(`${name(ev.player)} played ${ev.card.rank}${ev.card.suit}`);
        break;
      case "TRICK_RESOLVED":
        msgs.push(`${name(ev.winner)} won the trick`);
        break;
      case "HAND_SCORED": {
        const deltas = ev.deltas.map((d) => `${name(d.player)}: ${d.delta > 0 ? "+" : ""}${d.delta}`).join("  ");
        const totals = ev.runningTotals.map((t, i) => `${name(i)}: ${t}`).join("  ");
        msgs.push(`Hand: ${deltas}  |  Running: ${totals}`);
        break;
      }
      case "GAME_OVER": {
        const losers = ev.losers?.map((i) => name(i)).join(", ");
        msgs.push(losers ? `Game over! Loser(s): ${losers}` : "Game over!");
        break;
      }
      case "BID_MADE":
        msgs.push(`${name(ev.player)} bid: play`);
        break;
      case "BID_PASSED":
        msgs.push(`${name(ev.player)} passed`);
        break;
      case "CARD_REVEALED":
        msgs.push(`${ev.card.rank}${ev.card.suit} revealed from ${name(ev.player)}'s pile ${ev.pile + 1}`);
        break;
    }
  }
  return msgs;
}

// ── Game start helper ─────────────────────────────────────────────────────────

async function _startGame(
  ctx: MutationCtx,
  gameId: Id<"games">,
  game: { gameType: GameType; settings: Record<string, unknown>; creatorPlayerId: Id<"players"> },
) {
  // Guard against double-start (race condition from simultaneous markReady)
  const existing = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .unique();
  if (existing) return;

  const allSeats = await ctx.db
    .query("game_seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();

  const seats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

  const adapter = getAdapter(game.gameType);
  const { state, events } = adapter.start({
    seats: seats.length,
    scores: null as number[] | null,
    firstPlayer: Math.floor(Math.random() * seats.length),
    settings: game.settings,
  });

  await ctx.db.insert("game_live_state", { gameId, state });

  const currentPlayer = adapter.getCurrentPlayer(state);
  const startEvents = events.filter((e: BareEvent) => ANIMATION_EVENT_FILTER.has(e.type));
  await ctx.db.insert("game_public_state", {
    gameId,
    currentTrick: state.currentTrick ?? [],
    scores: state.scores ?? [],
    currentTurn: currentPlayer,
    dealer: adapter.getDealer(state),
    trickNum: state.trickNum ?? 0,
    phase: state.phase ?? "playing",
    recentEvents: startEvents,
  });

  const hands = adapter.getHands(state);
  for (let i = 0; i < seats.length; i++) {
    await ctx.db.insert("player_hands", {
      gameId,
      seatIndex: seats[i]!.seatIndex,
      playerId: seats[i]!.playerId,
      hand: hands[i] ?? [],
    });
  }

  await ctx.db.patch(gameId, { status: "active", initialState: state });

  // Insert initial events as chat messages
  const seatNames = await Promise.all(
    seats.map(async (s) => {
      const p = await ctx.db.get(s.playerId);
      return p?.displayName ?? "Unknown";
    })
  );

  if (events.length > 0) {
    const msgs = formatEvents(events, seatNames);
    for (const text of msgs) {
      await ctx.db.insert("table_messages", {
        gameId,
        playerId: game.creatorPlayerId,
        displayName: "Game",
        text,
        ts: Date.now(),
      });
    }
  }

  // Schedule bots if the first player to act is a bot
  if (currentPlayer >= 0) {
    const currentSeat = seats[currentPlayer];
    if (currentSeat) {
      const currentPlayerDoc = await ctx.db.get(currentSeat.playerId);
      if (currentPlayerDoc?.isBot) {
        await ctx.scheduler.runAfter(0, internal.games.applyBotMoves, { gameId });
      }
    }
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export const listActiveTables = query({
  args: {},
  handler: async (ctx) => {
    const games = await ctx.db
      .query("games")
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "waiting"),
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "between_hands"),
        )
      )
      .order("desc")
      .take(20);

    return Promise.all(
      games.map(async (game) => {
        const rawSeats = await ctx.db
          .query("game_seats")
          .withIndex("by_game", (q) => q.eq("gameId", game._id))
          .collect();

        const seats = await Promise.all(
          rawSeats.map(async (seat) => {
            const player = await ctx.db.get(seat.playerId);
            return {
              seatIndex: seat.seatIndex,
              playerId: seat.playerId as string,
              displayName: player?.displayName ?? "Unknown",
              isBot: player?.isBot ?? false,
              ready: seat.ready ?? false,
            };
          })
        );

        return {
          _id: game._id as string,
          gameType: game.gameType,
          status: game.status,
          seatCount: game.seatCount,
          minSeatCount: game.minSeatCount,
          createdAt: game.startedAt,
          seats: seats.sort((a, b) => a.seatIndex - b.seatIndex),
        };
      })
    );
  },
});

export const getTable = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return null;

    const rawSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const now = Date.now();
    const seats = await Promise.all(
      rawSeats.map(async (seat) => {
        const player = await ctx.db.get(seat.playerId);
        const presence = player
          ? await ctx.db
              .query("presence")
              .withIndex("by_user", (q) => q.eq("userId", player.userId))
              .unique()
          : null;
        const connected =
          !!presence &&
          presence.tableId === gameId &&
          now - presence.lastSeen < 90_000;
        return {
          seatIndex: seat.seatIndex,
          playerId: seat.playerId as string,
          displayName: player?.displayName ?? "Unknown",
          isBot: player?.isBot ?? false,
          ready: seat.ready ?? false,
          connected,
        };
      })
    );

    // Watchers: presence rows pointing at this table, not in a seat.
    const seatedUserIds = new Set(
      await Promise.all(rawSeats.map(async (s) => {
        const p = await ctx.db.get(s.playerId);
        return p?.userId ?? "";
      }))
    );
    const presenceRows = await ctx.db
      .query("presence")
      .withIndex("by_table", (q) => q.eq("tableId", gameId))
      .collect();
    const watchers = presenceRows
      .filter((p) => now - p.lastSeen < 90_000 && !seatedUserIds.has(p.userId))
      .map((p) => ({ userId: p.userId, displayName: p.displayName }));

    return {
      _id: game._id as string,
      gameType: game.gameType,
      status: game.status,
      seatCount: game.seatCount,
      minSeatCount: game.minSeatCount,
      creatorPlayerId: game.creatorPlayerId as string,
      settings: game.settings,
      createdAt: game.startedAt,
      seats: seats.sort((a, b) => a.seatIndex - b.seatIndex),
      watchers,
      result: (game.result ?? null) as { losers?: number[]; winners?: number[]; scores?: number[] } | null,
    };
  },
});

export const getTableMessages = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const msgs = await ctx.db
      .query("table_messages")
      .withIndex("by_game_ts", (q) => q.eq("gameId", gameId))
      .order("desc")
      .take(500);
    return msgs.reverse();
  },
});

export const getMyGameState = query({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return null;
    if (
      game.status !== "active" &&
      game.status !== "between_hands" &&
      game.status !== "finished"
    ) return null;

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

    const caller = await resolvePlayerForQuery(ctx, guestUserId);

    // Build seat info with engine player index (position in sorted array)
    const seats = await Promise.all(
      sortedSeats.map(async (seat, enginePlayerIndex) => {
        const player = await ctx.db.get(seat.playerId);
        const handRow = await ctx.db
          .query("player_hands")
          .withIndex("by_game_and_player", (q) =>
            q.eq("gameId", gameId).eq("playerId", seat.playerId)
          )
          .unique();
        return {
          seatIndex: seat.seatIndex,
          playerId: seat.playerId as string,
          displayName: player?.displayName ?? "Unknown",
          isBot: player?.isBot ?? false,
          enginePlayerIndex,
          handSize: (handRow?.hand ?? []).length,
        };
      })
    );

    const mySeat = caller
      ? seats.find((s) => s.playerId === (caller._id as string))
      : null;

    // ── Finished phase: return game-over state for modal ─────────────────────────
    if (game.status === "finished") {
      return {
        publicState: {
          currentTrick: [] as any[],
          scores: (game.lastHandSummary as any)?.runningTotals ?? [],
          currentTurn: -1,
          dealer: 0,
          trickNum: 0,
          phase: "game_over",
          lastCompletedTrick: null as { plays: { playerIndex: number; card: any }[]; winner: number } | null,
          recentEvents: [] as BareEvent[],
        },
        myHand: [] as Card[],
        legalMoves: [] as Move[],
        seats,
        gameType: game.gameType,
        strawmen: null,
        continuation: null,
        lastHandSummary: (game.lastHandSummary ?? null) as {
          deltas: { player: number; delta: number; reason: string }[];
          runningTotals: number[];
          seatNames: string[];
          breakdown: NormalizedPlayerBreakdown[] | null;
          gameTarget: number | null;
          losers: number[] | null;
        } | null,
      };
    }

    // ── Between-hands phase: return vote state only ────────────────────────────
    if (game.status === "between_hands") {
      const cd = (game.result ?? {}) as {
        scores?: number[];
        nextHandMultiplier?: number;
        nextDealerIndex?: number;
        scoring?: string;
      };
      const votes = (game.continuationVotes ?? {}) as Record<string, "continue" | "quit">;
      const myVote = mySeat ? (votes[String(mySeat.enginePlayerIndex)] ?? null) : null;
      return {
        publicState: {
          currentTrick: [] as any[],
          scores: cd.scores ?? [],
          currentTurn: -1,
          dealer: cd.nextDealerIndex ?? 0,
          trickNum: 0,
          phase: "hand_over",
          lastCompletedTrick: null as { plays: { playerIndex: number; card: any }[]; winner: number } | null,
          recentEvents: [] as BareEvent[],
        },
        myHand: [] as Card[],
        legalMoves: [] as Move[],
        seats,
        gameType: game.gameType,
        strawmen: null,
        continuation: { votes, myVote },
        lastHandSummary: (game.lastHandSummary ?? null) as {
          deltas: { player: number; delta: number; reason: string }[];
          runningTotals: number[];
          seatNames: string[];
          breakdown: NormalizedPlayerBreakdown[] | null;
          gameTarget: number | null;
          losers: number[] | null;
        } | null,
      };
    }

    // ── Active phase ───────────────────────────────────────────────────────────

    const publicState = await ctx.db
      .query("game_public_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();
    if (!publicState) return null;

    // Always load live state — needed for legal moves and Strohmandeln strawman data
    const liveState = await ctx.db
      .query("game_live_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();

    const adapter = getAdapter(game.gameType as GameType);

    let myHand: Card[] = [];
    let legalMoves: Move[] = [];

    if (mySeat) {
      const handRow = await ctx.db
        .query("player_hands")
        .withIndex("by_game_and_player", (q) =>
          q.eq("gameId", gameId).eq("playerId", caller!._id)
        )
        .unique();
      myHand = (handRow?.hand ?? []) as Card[];

      if (liveState && publicState.currentTurn === mySeat.enginePlayerIndex) {
        legalMoves = adapter.getLegalMoves(liveState.state);
      }
    }

    // Strawman piles (Strohmandeln only) — indexed by enginePlayerIndex
    let strawmen: Array<Array<{ topCard: Card | null; depth: number }>> | null = null;
    if (game.gameType === "strohmandeln" && liveState) {
      const rawStrawmen: any[][] = liveState.state.strawmen ?? [];
      strawmen = rawStrawmen.map((playerPiles: any[]) =>
        playerPiles.map((pile: { cards: any[] }) => {
          const cards = pile.cards ?? [];
          const topCard = cards.length > 0 ? (cards[cards.length - 1] as Card) : null;
          const depth = Math.max(0, cards.length - 1);
          return { topCard, depth };
        })
      );
    }

    return {
      publicState: {
        currentTrick: publicState.currentTrick,
        scores: publicState.scores,
        currentTurn: publicState.currentTurn,
        dealer: publicState.dealer ?? 0,
        trickNum: publicState.trickNum,
        phase: publicState.phase,
        lastCompletedTrick: (publicState.lastCompletedTrick ?? null) as { plays: { playerIndex: number; card: any }[]; winner: number } | null,
        recentEvents: (publicState.recentEvents ?? []) as BareEvent[],
      },
      myHand,
      legalMoves,
      seats,
      gameType: game.gameType,
      strawmen,
      continuation: null,
      lastHandSummary: (game.lastHandSummary ?? null) as {
        deltas: { player: number; delta: number; reason: string }[];
        runningTotals: number[];
        seatNames: string[];
        breakdown: NormalizedPlayerBreakdown[] | null;
        gameTarget: number | null;
        losers: number[] | null;
      } | null,
    };
  },
});

// ── Mutations ─────────────────────────────────────────────────────────────────

export const createTable = mutation({
  args: {
    gameType: v.union(v.literal("slobberhannes"), v.literal("strohmandeln")),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameType, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const cfg = GAME_CONFIG[gameType];

    const gameId = await ctx.db.insert("games", {
      gameType,
      status: "waiting",
      seatCount: cfg.max,
      minSeatCount: cfg.min,
      creatorPlayerId: player._id,
      settings: GAME_DEFAULT_SETTINGS[gameType] ?? {},
      startedAt: Date.now(),
    });

    return gameId;
  },
});

export const sitDown = mutation({
  args: {
    gameId: v.id("games"),
    seatIndex: v.number(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, seatIndex, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not open");

    const currentSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    if (currentSeats.some((s) => s.playerId === player._id)) return; // already seated
    if (currentSeats.length >= game.seatCount) throw new Error("Table is full");
    if (seatIndex < 0 || seatIndex >= game.seatCount) throw new Error("Invalid seat");
    if (currentSeats.some((s) => s.seatIndex === seatIndex)) throw new Error("Seat is taken");

    await ctx.db.insert("game_seats", {
      gameId,
      seatIndex,
      playerId: player._id,
      ready: false,
    });
  },
});

export const addBot = mutation({
  args: {
    gameId: v.id("games"),
    seatIndex: v.number(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, seatIndex, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not open");
    if (game.creatorPlayerId !== player._id) throw new Error("Only the creator can add bots");

    const currentSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    if (currentSeats.length >= game.seatCount) throw new Error("Table is full");
    if (seatIndex < 0 || seatIndex >= game.seatCount) throw new Error("Invalid seat");
    if (currentSeats.some((s) => s.seatIndex === seatIndex)) throw new Error("Seat is taken");

    // Create a fresh bot player for this seat
    const botId = await ctx.db.insert("players", {
      userId: `bot_${crypto.randomUUID()}`,
      displayName: "Bot",
      isBot: true,
      ratings: {},
      createdAt: Date.now(),
    });

    await ctx.db.insert("game_seats", {
      gameId,
      seatIndex,
      playerId: botId,
      ready: true, // bots never block start
    });
  },
});

export const standUp = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game) return;
    if (game.status === "active") throw new Error("Cannot leave a seat during an active game");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const mySeat = allSeats.find((s) => s.playerId === player._id);
    if (!mySeat) return;

    await ctx.db.delete(mySeat._id);

    const remainingSeats = allSeats.filter((s) => s._id !== mySeat._id);
    if (remainingSeats.length > 0 && game.creatorPlayerId === player._id) {
      const next = remainingSeats
        .filter((s) => {
          // Only transfer to human players
          return true;
        })
        .sort((a, b) => a.seatIndex - b.seatIndex)[0]!;
      await ctx.db.patch(gameId, { creatorPlayerId: next.playerId });
    }
  },
});

// Called when a non-seated watcher navigates back to the lobby.
export const leaveTable = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game) return;

    // Stand up if seated (safety; normally caller is already not seated)
    if (game.status !== "active") {
      const mySeat = await ctx.db
        .query("game_seats")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .filter((q) => q.eq(q.field("playerId"), player._id))
        .unique();
      if (mySeat) await ctx.db.delete(mySeat._id);
    }

    const remainingSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    if (remainingSeats.length === 0) {
      const messages = await ctx.db
        .query("table_messages")
        .withIndex("by_game_ts", (q) => q.eq("gameId", gameId))
        .collect();
      for (const msg of messages) await ctx.db.delete(msg._id);
      await ctx.db.delete(gameId);
    }
  },
});

export const markReady = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not in waiting state");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const mySeat = allSeats.find((s) => s.playerId === player._id);
    if (!mySeat) throw new Error("You are not seated at this table");

    await ctx.db.patch(mySeat._id, { ready: true });

    const updatedSeats = allSeats.map((s) =>
      s._id === mySeat._id ? { ...s, ready: true } : s
    );
    const allReady = updatedSeats.every((s) => s.ready === true);
    if (allReady && updatedSeats.length >= game.minSeatCount) {
      await _startGame(ctx, gameId, {
        gameType: game.gameType as GameType,
        settings: game.settings as Record<string, unknown>,
        creatorPlayerId: game.creatorPlayerId,
      });
    }
  },
});

export const unready = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not in waiting state");

    const mySeat = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .filter((q) => q.eq(q.field("playerId"), player._id))
      .unique();

    if (mySeat) await ctx.db.patch(mySeat._id, { ready: false });
  },
});

export const updateSettings = mutation({
  args: {
    gameId: v.id("games"),
    settings: v.any(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, settings, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Table not found");
    if (game.status !== "waiting") throw new Error("Cannot change settings during an active game");
    if (game.creatorPlayerId !== player._id) throw new Error("Only the creator can change settings");

    await ctx.db.patch(gameId, { settings });
  },
});

export const sendTableMessage = mutation({
  args: {
    gameId: v.id("games"),
    text: v.string(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, text, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);

    await ctx.db.insert("table_messages", {
      gameId,
      playerId: player._id,
      displayName: player.displayName,
      text: text.trim().slice(0, 500),
      ts: Date.now(),
    });
  },
});

export const applyMove = mutation({
  args: {
    gameId: v.id("games"),
    move: v.any(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, move, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "active") throw new Error("Game is not active");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);
    const myEngineIndex = sortedSeats.findIndex((s) => s.playerId === player._id);
    if (myEngineIndex === -1) throw new Error("You are not seated at this game");

    const { nextIsBot, trickJustResolved } = await _applyMoveLogic(ctx, gameId, myEngineIndex, move as Move);

    if (nextIsBot) {
      await ctx.scheduler.runAfter(0, internal.games.applyBotMoves, { gameId });
    }
  },
});

// ── Internal ──────────────────────────────────────────────────────────────────

export const startGameInternal = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;
    await _startGame(ctx, gameId, {
      gameType: game.gameType as GameType,
      settings: game.settings as Record<string, unknown>,
      creatorPlayerId: game.creatorPlayerId,
    });
  },
});

export const applyMoveInternal = internalMutation({
  args: {
    gameId: v.id("games"),
    enginePlayerIndex: v.number(),
    move: v.any(),
  },
  handler: async (ctx, { gameId, enginePlayerIndex, move }) => {
    return _applyMoveLogic(ctx, gameId, enginePlayerIndex, move as Move);
  },
});

async function _applyMoveLogic(
  ctx: MutationCtx,
  gameId: Id<"games">,
  enginePlayerIndex: number,
  move: Move,
): Promise<{ nextIsBot: boolean; trickJustResolved: boolean }> {
  const game = await ctx.db.get(gameId);
  if (!game || game.status !== "active") return { nextIsBot: false, trickJustResolved: false };

  const liveStateRow = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .unique();
  if (!liveStateRow) return { nextIsBot: false, trickJustResolved: false };

  const allSeats = await ctx.db
    .query("game_seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

  const adapter = getAdapter(game.gameType as GameType);
  const state = liveStateRow.state;

  // Validate it is this player's turn
  const currentEnginePlayer = adapter.getCurrentPlayer(state);
  if (currentEnginePlayer !== enginePlayerIndex) {
    throw new Error(`Not your turn (expected player ${currentEnginePlayer}, got ${enginePlayerIndex})`);
  }

  // Validate the move is legal
  const legalMoves = adapter.getLegalMoves(state);
  const isLegal = legalMoves.some((m) => movesEqual(m, move as Move));
  if (!isLegal) throw new Error("Illegal move");

  const seatNames = await Promise.all(
    sortedSeats.map(async (s) => {
      const p = await ctx.db.get(s.playerId);
      return p?.displayName ?? "Unknown";
    })
  );

  // Apply the move
  const { state: nextState, events } = adapter.applyMove(state, move);

  // Capture the completed trick before state is written (engine clears currentTrick immediately)
  const trickResolvedEvent = events.find(e => e.type === "TRICK_RESOLVED") as
    | { type: "TRICK_RESOLVED"; winner: number }
    | undefined;
  let lastTrickPatch: { plays: { playerIndex: number; card: any }[]; winner: number } | undefined;
  if (trickResolvedEvent && (move as any).type === "PLAY_CARD") {
    lastTrickPatch = {
      plays: [
        ...(state.currentTrick as { playerIndex: number; card: any }[]),
        { playerIndex: adapter.getCurrentPlayer(state), card: (move as any).card },
      ],
      winner: trickResolvedEvent.winner,
    };
  }

  // Insert event messages into chat
  if (events.length > 0) {
    const msgs = formatEvents(events, seatNames);
    for (const text of msgs) {
      await ctx.db.insert("table_messages", {
        gameId,
        playerId: game.creatorPlayerId,
        displayName: "Game",
        text,
        ts: Date.now(),
      });
    }
  }

  // Persist last hand summary so the UI can display it prominently
  const handScoredEvent = events.find((e) => e.type === "HAND_SCORED") as
    | { type: "HAND_SCORED"; deltas: { player: number; delta: number; reason: string }[]; runningTotals: number[] }
    | undefined;
  const gameOverEvent = events.find((e) => e.type === "GAME_OVER") as
    | { type: "GAME_OVER"; finalScores: number[]; losers?: number[] }
    | undefined;
  if (handScoredEvent) {
    await ctx.db.patch(gameId, {
      lastHandSummary: {
        deltas: handScoredEvent.deltas,
        runningTotals: handScoredEvent.runningTotals,
        seatNames,
        breakdown: adapter.getHandBreakdown(nextState),
        gameTarget: (nextState as any).loseAt ?? null,
        losers: gameOverEvent?.losers ?? null,
      },
    });
  }

  // Append to game_moves
  const existingMoves = await ctx.db
    .query("game_moves")
    .withIndex("by_game_seq", (q) => q.eq("gameId", gameId))
    .order("desc")
    .first();
  const seq = (existingMoves?.seq ?? -1) + 1;
  await ctx.db.insert("game_moves", {
    gameId,
    seq,
    seatIndex: sortedSeats[enginePlayerIndex]!.seatIndex,
    move,
    ts: Date.now(),
  });

  // Handle terminal states
  if (adapter.isGameOver(nextState)) {
    await _finalizeGame(ctx, gameId, game.creatorPlayerId, nextState, adapter, sortedSeats);
    return { nextIsBot: false, trickJustResolved: false };
  }

  if (adapter.isHandOver(nextState)) {
    if (game.gameType === "strohmandeln") {
      // Strohmandeln has no fixed session end — pause and ask players whether to continue.
      await _enterBetweenHands(ctx, gameId, game, nextState, sortedSeats, seatNames);
      return { nextIsBot: false, trickJustResolved: false };
    }

    // Other games (Slobberhannes): immediate re-deal
    const { state: newHandState, events: dealEvents } = adapter.reDeal(
      nextState,
      game.settings as Record<string, unknown>
    );

    await ctx.db.insert("table_messages", {
      gameId,
      playerId: game.creatorPlayerId,
      displayName: "Game",
      text: "— New hand —",
      ts: Date.now(),
    });

    if (dealEvents.length > 0) {
      const msgs = formatEvents(dealEvents, seatNames);
      for (const text of msgs) {
        await ctx.db.insert("table_messages", {
          gameId,
          playerId: game.creatorPlayerId,
          displayName: "Game",
          text,
          ts: Date.now(),
        });
      }
    }

    await ctx.db.patch(liveStateRow._id, { state: newHandState });
    await _updatePublicAndHands(ctx, gameId, newHandState, sortedSeats, adapter);

    const nextPlayer = adapter.getCurrentPlayer(newHandState);
    const nextIsBot = await _isBot(ctx, sortedSeats, nextPlayer);
    return { nextIsBot, trickJustResolved: false };
  }

  // Normal move: update live state and public state
  await ctx.db.patch(liveStateRow._id, { state: nextState });
  await _updatePublicAndHands(ctx, gameId, nextState, sortedSeats, adapter, lastTrickPatch, events);

  const nextPlayer = adapter.getCurrentPlayer(nextState);
  const nextIsBot = await _isBot(ctx, sortedSeats, nextPlayer);
  return { nextIsBot, trickJustResolved: lastTrickPatch !== undefined };
}

const ANIMATION_EVENT_FILTER = new Set([
  "CARD_PLAYED", "TRICK_RESOLVED", "CARD_REVEALED", "CARDS_MOVED",
  "BID_MADE", "BID_PASSED", "HAND_SCORED",
]);

async function _updatePublicAndHands(
  ctx: MutationCtx,
  gameId: Id<"games">,
  state: any,
  sortedSeats: Doc<"game_seats">[],
  adapter: EngineAdapter,
  lastTrickPatch?: { plays: { playerIndex: number; card: any }[]; winner: number },
  recentEvents?: BareEvent[],
) {
  const publicRow = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .unique();

  const filteredEvents = (recentEvents ?? []).filter(e => ANIMATION_EVENT_FILTER.has(e.type));

  if (publicRow) {
    await ctx.db.patch(publicRow._id, {
      currentTrick: state.currentTrick ?? [],
      scores: state.scores ?? [],
      currentTurn: adapter.getCurrentPlayer(state),
      dealer: adapter.getDealer(state),
      trickNum: state.trickNum ?? 0,
      phase: state.phase ?? "playing",
      ...(lastTrickPatch !== undefined ? { lastCompletedTrick: lastTrickPatch } : {}),
      recentEvents: filteredEvents,
    });
  }

  const hands = adapter.getHands(state);
  for (let i = 0; i < sortedSeats.length; i++) {
    const seat = sortedSeats[i]!;
    const handRow = await ctx.db
      .query("player_hands")
      .withIndex("by_game_and_player", (q) =>
        q.eq("gameId", gameId).eq("playerId", seat.playerId)
      )
      .unique();
    if (handRow) {
      await ctx.db.patch(handRow._id, { hand: hands[i] ?? [] });
    }
  }
}

async function _isBot(ctx: MutationCtx, sortedSeats: Doc<"game_seats">[], enginePlayerIndex: number): Promise<boolean> {
  if (enginePlayerIndex < 0 || enginePlayerIndex >= sortedSeats.length) return false;
  const seat = sortedSeats[enginePlayerIndex]!;
  const player = await ctx.db.get(seat.playerId);
  return player?.isBot ?? false;
}

async function _finalizeGame(
  ctx: MutationCtx,
  gameId: Id<"games">,
  creatorPlayerId: Id<"players">,
  state: any,
  adapter: EngineAdapter,
  sortedSeats: Doc<"game_seats">[],
) {
  const result = adapter.getGameResult(state);
  await ctx.db.patch(gameId, {
    status: "finished",
    endedAt: Date.now(),
    result,
  });

  // Clean up live collections
  const liveRows = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of liveRows) await ctx.db.delete(row._id);

  const publicRows = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of publicRows) await ctx.db.delete(row._id);

  const handRows = await ctx.db
    .query("player_hands")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of handRows) await ctx.db.delete(row._id);

  // Final message
  let resultText = "Game finished.";
  if (result?.losers?.length) {
    const seatNames = await Promise.all(
      sortedSeats.map(async (s) => {
        const p = await ctx.db.get(s.playerId);
        return p?.displayName ?? "Unknown";
      })
    );
    const loserNames = result.losers.map((i: number) => seatNames[i]).join(", ");
    resultText = `Game over! Loser(s): ${loserNames}`;
  }
  await ctx.db.insert("table_messages", {
    gameId,
    playerId: creatorPlayerId,
    displayName: "Game",
    text: resultText,
    ts: Date.now(),
  });
}

// ── Strohmandeln between-hands helpers ────────────────────────────────────────

async function _enterBetweenHands(
  ctx: MutationCtx,
  gameId: Id<"games">,
  game: Doc<"games">,
  handOverState: any,
  sortedSeats: Doc<"game_seats">[],
  seatNames: string[],
) {
  // Store continuation info so the next hand can be re-dealt without the live state
  const continuationData = {
    scores: [...(handOverState.scores ?? [0, 0])],
    nextHandMultiplier: handOverState.nextHandMultiplier ?? 1,
    nextDealerIndex: ((handOverState.dealerIndex ?? 0) + 1) % 2,
    scoring: handOverState.scoring ?? "Mayr",
  };

  // Delete all live rows — they are no longer needed
  const liveRows = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of liveRows) await ctx.db.delete(row._id);

  const handRows = await ctx.db
    .query("player_hands")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of handRows) await ctx.db.delete(row._id);

  const publicRows = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of publicRows) await ctx.db.delete(row._id);

  // Bots always vote "continue" immediately
  const votes: Record<string, "continue" | "quit"> = {};
  for (let i = 0; i < sortedSeats.length; i++) {
    const player = await ctx.db.get(sortedSeats[i]!.playerId);
    if (player?.isBot) votes[String(i)] = "continue";
  }

  await ctx.db.patch(gameId, {
    status: "between_hands",
    result: continuationData,
    continuationVotes: votes,
  });

  const scoreText = seatNames
    .map((name, i) => `${name}: ${handOverState.scores?.[i] ?? 0}`)
    .join("  |  ");
  await ctx.db.insert("table_messages", {
    gameId,
    playerId: game.creatorPlayerId,
    displayName: "Game",
    text: `Hand complete! Running scores — ${scoreText}`,
    ts: Date.now(),
  });

  // If all seats are bots (edge case), start the next hand immediately
  if (Object.keys(votes).length === sortedSeats.length) {
    await _startNextHand(ctx, gameId, game, sortedSeats);
  }
}

async function _startNextHand(
  ctx: MutationCtx,
  gameId: Id<"games">,
  game: Doc<"games">,
  sortedSeats: Doc<"game_seats">[],
) {
  const currentSeats = await ctx.db
    .query("game_seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  if (currentSeats.length < game.minSeatCount) {
    await _quitGame(ctx, gameId, game.creatorPlayerId);
    return;
  }

  const cd = (game.result ?? {}) as {
    scores: number[];
    nextHandMultiplier: number;
    nextDealerIndex: number;
    scoring: Strohmandeln.ScoringSystemName;
  };

  const rawState = Strohmandeln.dealState({
    scores: cd.scores,
    dealerIndex: cd.nextDealerIndex,
    scoring: cd.scoring ?? "Mayr",
    handMultiplier: cd.nextHandMultiplier ?? 1,
  });
  const { state: newState, events: dealEvents } = Strohmandeln.uncoverStrawmenInitial(rawState);

  await ctx.db.insert("game_live_state", { gameId, state: newState });

  const currentPlayer = Strohmandeln.getCurrentPlayer(newState);
  const handStartEvents = dealEvents.filter((e) => ANIMATION_EVENT_FILTER.has(e.type));
  await ctx.db.insert("game_public_state", {
    gameId,
    currentTrick: newState.currentTrick ?? [],
    scores: newState.scores ?? [],
    currentTurn: currentPlayer,
    dealer: newState.dealerIndex,
    trickNum: newState.trickNum ?? 0,
    phase: newState.phase ?? "bidding",
    recentEvents: handStartEvents,
  });

  const hands = newState.hands as Card[][];
  for (let i = 0; i < sortedSeats.length; i++) {
    await ctx.db.insert("player_hands", {
      gameId,
      seatIndex: sortedSeats[i]!.seatIndex,
      playerId: sortedSeats[i]!.playerId,
      hand: hands[i] ?? [],
    });
  }

  await ctx.db.patch(gameId, {
    status: "active",
    continuationVotes: undefined,
  });

  const seatNames = await Promise.all(
    sortedSeats.map(async (s) => {
      const p = await ctx.db.get(s.playerId);
      return p?.displayName ?? "Unknown";
    })
  );

  if (dealEvents.length > 0) {
    const msgs = formatEvents(dealEvents, seatNames);
    for (const text of msgs) {
      await ctx.db.insert("table_messages", {
        gameId,
        playerId: game.creatorPlayerId,
        displayName: "Game",
        text,
        ts: Date.now(),
      });
    }
  }

  if (currentPlayer >= 0) {
    const currentSeat = sortedSeats[currentPlayer];
    if (currentSeat) {
      const currentPlayerDoc = await ctx.db.get(currentSeat.playerId);
      if (currentPlayerDoc?.isBot) {
        await ctx.scheduler.runAfter(0, internal.games.applyBotMoves, { gameId });
      }
    }
  }
}

async function _quitGame(
  ctx: MutationCtx,
  gameId: Id<"games">,
  creatorPlayerId: Id<"players">,
) {
  await ctx.db.patch(gameId, {
    status: "finished",
    endedAt: Date.now(),
    continuationVotes: undefined,
  });

  // Clean up any remaining live rows (should already be gone, but be safe)
  const liveRows = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of liveRows) await ctx.db.delete(row._id);

  const publicRows = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of publicRows) await ctx.db.delete(row._id);

  const handRows = await ctx.db
    .query("player_hands")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of handRows) await ctx.db.delete(row._id);

  await ctx.db.insert("table_messages", {
    gameId,
    playerId: creatorPlayerId,
    displayName: "Game",
    text: "Session ended. Thanks for playing!",
    ts: Date.now(),
  });
}

export const voteContinue = mutation({
  args: {
    gameId: v.id("games"),
    vote: v.union(v.literal("continue"), v.literal("quit")),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, vote, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "between_hands") throw new Error("Not in between-hands phase");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);
    const myEngineIndex = sortedSeats.findIndex((s) => s.playerId === player._id);
    if (myEngineIndex === -1) throw new Error("You are not seated at this table");

    const votes: Record<string, "continue" | "quit"> = {
      ...((game.continuationVotes ?? {}) as Record<string, "continue" | "quit">),
      [String(myEngineIndex)]: vote,
    };
    await ctx.db.patch(gameId, { continuationVotes: votes });

    // Any quit vote immediately ends the session
    if (Object.values(votes).some((v) => v === "quit")) {
      await _quitGame(ctx, gameId, game.creatorPlayerId);
      return;
    }

    // All players voted continue → start the next hand
    if (Object.keys(votes).length === sortedSeats.length) {
      await _startNextHand(ctx, gameId, game, sortedSeats);
    }
  },
});

export const getBotMoveInfo = internalQuery({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "active") return null;

    const liveStateRow = await ctx.db
      .query("game_live_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();
    if (!liveStateRow) return null;

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

    const adapter = getAdapter(game.gameType as GameType);
    const state = liveStateRow.state;
    const currentEnginePlayer = adapter.getCurrentPlayer(state);

    if (currentEnginePlayer < 0 || currentEnginePlayer >= sortedSeats.length) return null;

    const currentSeat = sortedSeats[currentEnginePlayer]!;
    const currentPlayerDoc = await ctx.db.get(currentSeat.playerId);

    return {
      state,
      enginePlayerIndex: currentEnginePlayer,
      isBot: currentPlayerDoc?.isBot ?? false,
      phase: state.phase,
      gameType: game.gameType,
    };
  },
});

export const applyBotMoves = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    for (let i = 0; i < 60; i++) {
      const info = await ctx.runQuery(internal.games.getBotMoveInfo, { gameId });
      if (!info || !info.isBot || info.phase === "game_over") break;

      const adapter = getAdapter(info.gameType as GameType);
      const move = adapter.chooseBotMove(info.state, info.enginePlayerIndex);

      const result = await ctx.runMutation(internal.games.applyMoveInternal, {
        gameId,
        enginePlayerIndex: info.enginePlayerIndex,
        move,
      });

      if (!result.nextIsBot) break;
      if (result.trickJustResolved) {
        await new Promise<void>(r => setTimeout(r, 1200));
      }
    }
  },
});
