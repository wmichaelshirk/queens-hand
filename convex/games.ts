import { v } from "convex/values";
import { mutation, query, internalMutation, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const GAME_CONFIG = {
  slobberhannes: { min: 3, max: 6, default: 4 },
  strohmandeln:  { min: 2, max: 2, default: 2 },
} as const;

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

// ── Queries ───────────────────────────────────────────────────────────────────

export const listActiveTables = query({
  args: {},
  handler: async (ctx) => {
    const games = await ctx.db
      .query("games")
      .filter((q) =>
        q.or(q.eq(q.field("status"), "waiting"), q.eq(q.field("status"), "active"))
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

    // Watchers: presence rows pointing at this table, not in a seat.
    // Presence uses userId strings; seats use player _id. Resolve seated userIds first.
    const seatedUserIds = new Set(
      await Promise.all(rawSeats.map(async (s) => {
        const p = await ctx.db.get(s.playerId);
        return p?.userId ?? "";
      }))
    );
    const now = Date.now();
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
    };
  },
});

export const getTableMessages = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    return ctx.db
      .query("table_messages")
      .withIndex("by_game_ts", (q) => q.eq("gameId", gameId))
      .order("asc")
      .take(200);
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
      settings: {},
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

export const standUp = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Table not found");
    if (game.status === "active") throw new Error("Cannot leave a seat during an active game");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const mySeat = allSeats.find((s) => s.playerId === player._id);
    if (!mySeat) return; // not seated, nothing to do

    await ctx.db.delete(mySeat._id);

    const remainingSeats = allSeats.filter((s) => s._id !== mySeat._id);

    if (remainingSeats.length === 0) {
      // Last person out — delete the table and its messages
      const messages = await ctx.db
        .query("table_messages")
        .withIndex("by_game_ts", (q) => q.eq("gameId", gameId))
        .collect();
      for (const msg of messages) await ctx.db.delete(msg._id);
      await ctx.db.delete(gameId);
      return;
    }

    // Transfer creator if needed
    if (game.creatorPlayerId === player._id) {
      const nextCreator = remainingSeats.sort((a, b) => a.seatIndex - b.seatIndex)[0]!;
      await ctx.db.patch(gameId, { creatorPlayerId: nextCreator.playerId });
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

    // Check if all seated players are ready and we have enough to start
    const updatedSeats = allSeats.map((s) =>
      s._id === mySeat._id ? { ...s, ready: true } : s
    );
    const allReady = updatedSeats.every((s) => s.ready === true);
    if (allReady && updatedSeats.length >= game.minSeatCount) {
      await ctx.db.patch(gameId, { status: "active" });
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

// ── Internal ──────────────────────────────────────────────────────────────────

export const startGameInternal = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    await ctx.db.patch(gameId, { status: "active" });
  },
});
