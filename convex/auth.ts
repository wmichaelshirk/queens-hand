import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";
import Resend from "@auth/core/providers/resend";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    Resend({ apiKey: process.env.AUTH_RESEND_KEY! }),
  ],
});

// Ensure a players row exists for the authenticated user.
// Called on first login and returns the player record.
export const ensurePlayer = mutation({
  args: { displayName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) return existing;

    const identity = await ctx.auth.getUserIdentity();
    const name =
      args.displayName ??
      identity?.name ??
      identity?.email?.split("@")[0] ??
      "Player";

    const id = await ctx.db.insert("players", {
      userId,
      displayName: name,
      isBot: false,
      ratings: {},
      createdAt: Date.now(),
    });

    return ctx.db.get(id);
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

export const updateDisplayName = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, { displayName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!player) throw new Error("Player not found");

    await ctx.db.patch(player._id, { displayName });
  },
});
