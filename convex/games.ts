import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const SEAT_COUNTS = { slobberhannes: 4, strohmandeln: 4 } as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolvePlayer(
  ctx: Parameters<Parameters<typeof query>[0]["handler"]>[0],
  guestUserId?: string
) {
  const authUserId = await getAuthUserId(ctx);
  const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
  if (!userId) return null;
  return ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
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
    const player = await resolvePlayer(ctx, guestUserId);
    if (!player) throw new Error("Not authenticated");

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

export const joinTable = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    if (!player) throw new Error("Not authenticated");

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
