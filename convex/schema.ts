import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // ── Permanent collections ──────────────────────────────────────────────

  players: defineTable({
    userId: v.string(),          // Convex Auth user id, or "guest_<token>" for guests
    displayName: v.string(),
    isBot: v.boolean(),
    isGuest: v.optional(v.boolean()),
    // Per-game-type ratings: { slobberhannes: { rating, sigma }, ... }
    ratings: v.record(v.string(), v.object({
      rating: v.number(),
      sigma: v.number(),
      gamesPlayed: v.number(),
    })),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"]),

  games: defineTable({
    gameType: v.union(v.literal("slobberhannes"), v.literal("strohmandeln")),
    status: v.union(v.literal("waiting"), v.literal("active"), v.literal("finished"), v.literal("between_hands")),
    seatCount: v.number(),       // max seats
    minSeatCount: v.number(),    // min seats required to start
    creatorPlayerId: v.id("players"),
    initialState: v.optional(v.any()),
    settings: v.any(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    result: v.optional(v.any()),
    // Used during between_hands phase: votes keyed by enginePlayerIndex (string)
    continuationVotes: v.optional(v.any()),
    // Score summary for the most recently completed hand (shown in UI)
    lastHandSummary: v.optional(v.any()),
  }),

  game_seats: defineTable({
    gameId: v.id("games"),
    seatIndex: v.number(),
    playerId: v.id("players"),
    ready: v.optional(v.boolean()),
  })
    .index("by_game", ["gameId"])
    .index("by_player", ["playerId"]),

  game_moves: defineTable({
    gameId: v.id("games"),
    seq: v.number(),
    seatIndex: v.number(),
    move: v.any(),
    ts: v.number(),
  })
    .index("by_game_seq", ["gameId", "seq"]),

  // ── Live collections (deleted when game ends) ──────────────────────────

  game_live_state: defineTable({
    gameId: v.id("games"),
    state: v.any(),
  })
    .index("by_game", ["gameId"]),

  game_public_state: defineTable({
    gameId: v.id("games"),
    currentTrick: v.array(v.any()),
    scores: v.array(v.number()),
    currentTurn: v.number(),
    trickNum: v.number(),
    phase: v.string(),
  })
    .index("by_game", ["gameId"]),

  player_hands: defineTable({
    gameId: v.id("games"),
    seatIndex: v.number(),
    playerId: v.id("players"),
    hand: v.array(v.any()),
  })
    .index("by_game", ["gameId"])
    .index("by_game_and_player", ["gameId", "playerId"]),

  // ── Lobby presence (heartbeat-based; rows are overwritten, not appended) ─

  presence: defineTable({
    userId: v.string(),
    displayName: v.string(),
    lastSeen: v.number(),
    tableId: v.optional(v.id("games")),
  })
    .index("by_user", ["userId"])
    .index("by_last_seen", ["lastSeen"])
    .index("by_table", ["tableId"]),

  // ── Lobby chat (ephemeral window, capped at 100 messages) ─────────────

  lobby_messages: defineTable({
    playerId: v.id("players"),
    displayName: v.string(),
    text: v.string(),
    ts: v.number(),
  })
    .index("by_ts", ["ts"]),

  // ── Table chat (per-game, cleared when game ends) ──────────────────────
  table_messages: defineTable({
    gameId: v.id("games"),
    playerId: v.id("players"),
    displayName: v.string(),
    text: v.string(),
    ts: v.number(),
  })
    .index("by_game_ts", ["gameId", "ts"]),
});
