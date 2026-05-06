import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Creates a transient guest player. No auth required.
// The returned userId is a random token the client stores in localStorage
// and passes to lobby mutations. Server-side code verifies isGuest=true
// before accepting it, so clients cannot impersonate real users.
export const createGuest = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, { displayName }) => {
    const name = displayName.trim().slice(0, 32);
    if (!name) throw new Error("Display name required");

    const token = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const userId = `guest_${token}`;

    const playerId = await ctx.db.insert("players", {
      userId,
      displayName: name,
      isBot: false,
      isGuest: true,
      ratings: {},
      createdAt: Date.now(),
    });

    return { playerId, userId, displayName: name };
  },
});
