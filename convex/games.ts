import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const SEAT_COUNTS = { slobberhannes: 4, strohmandeln: 4 } as const;

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
            };
          })
        );

        return {
          _id: game._id as string,
          gameType: game.gameType,
          status: game.status,
          seatCount: game.seatCount,
          createdAt: game.startedAt,
          seats: seats.sort((a, b) => a.seatIndex - b.seatIndex),
        };
      })
    );
  },
});

// ── Mutations ─────────────────────────────────────────────────────────────────

export const createTable = mutation({
  args: {
    gameType: v.union(v.literal("slobberhannes"), v.literal("strohmandeln")),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameType, guestUserId }) => {
    const authUserId = await getAuthUserId(ctx);
    const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
    if (!userId) throw new Error("Not authenticated");
    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!player) throw new Error("Player record not found");

    const gameId = await ctx.db.insert("games", {
      gameType,
      status: "waiting",
      seatCount: SEAT_COUNTS[gameType],
      settings: {},
      startedAt: Date.now(),
    });

    await ctx.db.insert("game_seats", {
      gameId,
      seatIndex: 0,
      playerId: player._id,
    });

    return gameId;
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
        };
      })
    );
    return {
      _id: game._id as string,
      gameType: game.gameType,
      status: game.status,
      seatCount: game.seatCount,
      createdAt: game.startedAt,
      seats: seats.sort((a, b) => a.seatIndex - b.seatIndex),
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

export const joinTable = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const authUserId = await getAuthUserId(ctx);
    const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
    if (!userId) throw new Error("Not authenticated");
    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!player) throw new Error("Player record not found");

    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not open");

    const currentSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    if (currentSeats.some((s) => s.playerId === player._id)) return; // already seated
    if (currentSeats.length >= game.seatCount) throw new Error("Table is full");

    const taken = new Set(currentSeats.map((s) => s.seatIndex));
    let nextIndex = 0;
    while (taken.has(nextIndex)) nextIndex++;

    await ctx.db.insert("game_seats", { gameId, seatIndex: nextIndex, playerId: player._id });
  },
});

export const sendTableMessage = mutation({
  args: {
    gameId: v.id("games"),
    text: v.string(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, text, guestUserId }) => {
    const authUserId = await getAuthUserId(ctx);
    const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
    if (!userId) throw new Error("Not authenticated");
    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!player) throw new Error("Player record not found");

    await ctx.db.insert("table_messages", {
      gameId,
      playerId: player._id,
      displayName: player.displayName,
      text: text.trim().slice(0, 500),
      ts: Date.now(),
    });
  },
});
