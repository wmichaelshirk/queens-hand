import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const MAX_MESSAGES = 100;
const PRESENCE_TTL_MS = 60_000; // 60 s — users who haven't pinged are "offline"

// ── Presence ──────────────────────────────────────────────────────────────────

// Upsert a presence heartbeat for the current user.
// Call this on mount and every 30 s.
export const ping = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!player) return;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeen: now, displayName: player.displayName });
    } else {
      await ctx.db.insert("presence", {
        userId,
        displayName: player.displayName,
        lastSeen: now,
      });
    }
  },
});

// Returns players seen within PRESENCE_TTL_MS.
export const getOnline = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    return ctx.db
      .query("presence")
      .withIndex("by_last_seen", (q) => q.gte("lastSeen", cutoff))
      .collect();
  },
});

// ── Chat ──────────────────────────────────────────────────────────────────────

// Returns the last MAX_MESSAGES lobby chat messages, oldest first.
// Reactive — clients receive updates automatically as new messages arrive.
export const getMessages = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("lobby_messages")
      .withIndex("by_ts")
      .order("desc")
      .take(MAX_MESSAGES)
      .then((msgs) => msgs.reverse());
  },
});

// Post a message to the lobby chat.
// Prunes the oldest message when the window exceeds MAX_MESSAGES.
export const sendMessage = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!player) throw new Error("Player record not found");

    const trimmed = text.trim();
    if (!trimmed) return;

    await ctx.db.insert("lobby_messages", {
      playerId: player._id,
      displayName: player.displayName,
      text: trimmed,
      ts: Date.now(),
    });

    // Prune oldest message if over the cap
    const count = await ctx.db
      .query("lobby_messages")
      .collect()
      .then((r) => r.length);
    if (count > MAX_MESSAGES) {
      const oldest = await ctx.db
        .query("lobby_messages")
        .withIndex("by_ts")
        .order("asc")
        .first();
      if (oldest) await ctx.db.delete(oldest._id);
    }
  },
});
