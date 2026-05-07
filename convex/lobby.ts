import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const MAX_MESSAGES = 100;
const PRESENCE_TTL_MS = 60_000; // 60 s — users who haven't pinged are "offline"

// ── Presence ──────────────────────────────────────────────────────────────────

// Upsert a presence heartbeat for the current user.
// Call this on mount and every 30 s.
export const ping = mutation({
  args: {
    guestUserId: v.optional(v.string()),
    tableId: v.optional(v.id("games")),
  },
  handler: async (ctx, { guestUserId, tableId }) => {
    const authUserId = await getAuthUserId(ctx);
    const userId = authUserId ?? null;

    const player = userId
      ? await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", userId)).first()
      : guestUserId?.startsWith("guest_")
        ? await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", guestUserId)).first()
        : null;

    if (!player || (!authUserId && !player.isGuest)) return;
    const effectiveUserId = player.userId;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", effectiveUserId))
      .first();

    const now = Date.now();
    const tableIdField = tableId !== undefined ? { tableId } : {};
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: now,
        displayName: player.displayName,
        ...tableIdField,
      });
    } else {
      await ctx.db.insert("presence", {
        userId: effectiveUserId,
        displayName: player.displayName,
        lastSeen: now,
        ...tableIdField,
      });
    }
  },
});

// Remove presence on sign-out so the user disappears immediately.
export const leave = mutation({
  args: { guestUserId: v.optional(v.string()) },
  handler: async (ctx, { guestUserId }) => {
    const authUserId = await getAuthUserId(ctx);
    const effectiveUserId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
    if (!effectiveUserId) return;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", effectiveUserId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
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
  args: { text: v.string(), guestUserId: v.optional(v.string()) },
  handler: async (ctx, { text, guestUserId }) => {
    const authUserId = await getAuthUserId(ctx);

    const player = authUserId
      ? await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", authUserId)).first()
      : guestUserId?.startsWith("guest_")
        ? await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", guestUserId)).first()
        : null;

    if (!player) throw new Error("Not authenticated");
    if (!authUserId && !player.isGuest) throw new Error("Not authenticated");

    const trimmed = text.trim();
    if (!trimmed) return;

    await ctx.db.insert("lobby_messages", {
      playerId: player._id,
      displayName: player.displayName,
      text: trimmed,
      ts: Date.now(),
    });

    // Prune oldest message if over the cap; take(2) avoids a full table scan
    const over = await ctx.db
      .query("lobby_messages")
      .withIndex("by_ts")
      .order("asc")
      .take(MAX_MESSAGES + 1);
    if (over.length > MAX_MESSAGES && over[0]) {
      await ctx.db.delete(over[0]._id);
    }
  },
});
