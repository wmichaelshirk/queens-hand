# Architecture & Hosting Decisions

## Project context

Multiple card game engines (Slobberhannes, Strohmandeln) written in TypeScript.
Pure functional engines — `applyMove(state, move)` returns `{ state, events }`.
Two AI implementations: ISMCTS (strong, slower) and Greedy (fast).
Phase 0 (TypeScript migration, event model, type system) is complete.

---

## Requirements

### Functional
- Host game engines as an authoritative server (server applies and validates all moves)
- Real-time state updates pushed immediately to all clients connected to a given game
- State must be filtered per player before delivery — players never see other players' hands
- AI moves computed server-side for any combination of bot/human seats, as specified at game creation
- Support eventual real-time features: table chat, player presence, direct messaging

### Persistence
- **Transient**: table chat, who is currently connected (loss on server restart is acceptable)
- **Permanent**: every game played — initial state, full move sequence, final scores, player records

### Scale & access
- Friends-only, not public
- Dozens of simultaneous tables at peak; a handful is typical

### Constraints
- **$0 until proven out** — free tier only, no credit card required anywhere
- Minimal ops burden — no managing servers, TLS, or deploy pipelines manually
- Must support a web client (Phase 2) and retain the existing CLI client (Phase 1)

---

## Hosting decision: Convex (all-in-one)

Convex is a TypeScript-native backend platform built around reactive queries.
All functions (queries, mutations, actions) are written in TypeScript — no SQL,
no separate Realtime layer to configure, no RLS policies to write.

| Need | Convex feature |
|---|---|
| Permanent DB | Document store with indexed fields (free tier: 1 GB) |
| Auth / identity | Convex Auth (built-in, free) |
| Real-time push to clients | Reactive queries — automatic, no configuration |
| Per-player state filtering | TypeScript query functions (return only what caller should see) |
| Move validation + AI | Mutations (transactional) + Actions (long-running, for ISMCTS) |
| Transient chat & presence | In-memory via Convex presence; or lightweight chat documents |
| Static web hosting | Vercel (free tier, auto-deploys from GitHub) |

### Why Convex over Supabase

Supabase was the initial recommendation. Convex is preferred because:

- **Filtering is TypeScript, not SQL RLS.** A query function that strips other
  players' hands before returning is more natural for a TypeScript codebase than
  writing SQL policy rules.
- **Reactivity is the default.** When a mutation writes new game state, every
  client subscribed to the affected query automatically gets the updated filtered
  result pushed to them. No Realtime subscription layer to configure separately.
- **Document DB is sufficient for all identified use cases.** Game history is
  always fetched by game ID or player ID — simple indexed lookups. Rating updates
  are pure functions applied per-player document at game end; no aggregation
  required. Leaderboards use an index on the `rating` field (`order("desc").take(N)`).

### Alternatives considered

- **Firebase**: familiar, but state filtering per player requires Cloud Functions
  which accumulate cost; data model fights authoritative-server pattern
- **Supabase**: good SQL story, but requires configuring Realtime + RLS separately;
  filtering logic split between TypeScript and SQL
- **Fly.io**: best persistent-server option, but requires credit card on file
- **Render**: free tier spins down after 15 min inactivity; mid-game restart
  drops WebSocket connections
- **Cloudflare Durable Objects**: architecturally ideal (one stateful object per
  game room), but requires paid Workers plan ($5/month)

### Cloudflare Durable Objects — the upgrade path

If the project ever warrants $5/month, Durable Objects are worth revisiting.
Each game room becomes one persistent object: holds all WebSocket connections,
runs the engine, filters and broadcasts state in memory, never touches a DB
for live play. The engine TypeScript is unchanged — only the host changes.

---

## Data model

All collections are Convex documents. Convex IDs are used as foreign keys.
Indexes are declared in `convex/schema.ts`.

### Permanent collections

```typescript
// players
{
  displayName: string,
  isBot:       boolean,
  rating:      number,   // current skill estimate (TrueSkill μ or Glicko-2 rating)
  sigma:       number,   // uncertainty (TrueSkill σ or Glicko-2 deviation)
  gamesPlayed: number,
  createdAt:   number,
}
// indexes: by_rating (for leaderboard)

// games
{
  gameType:     "slobberhannes" | "strohmandeln",
  initialState: any,    // full deal — hands, deck order, settings
  settings:     any,
  startedAt:    number,
  endedAt?:     number,
  result?:      any,    // final scores, winner(s)
}

// game_seats
{
  gameId:     Id<"games">,
  seatIndex:  number,
  playerId:   Id<"players">,
}
// indexes: by_game, by_player

// game_moves  (the permanent record — initial_state + moves = full replay)
{
  gameId:    Id<"games">,
  seq:       number,
  seatIndex: number,
  move:      any,       // { type: "PLAY_CARD", card: {...} } etc.
  ts:        number,
}
// indexes: by_game_seq
```

### Live collections (active games only; documents deleted when game ends)

```typescript
// game_live_state  (server-only; never returned to clients directly)
{
  gameId:  Id<"games">,
  state:   any,         // complete engine state including all hands
}
// indexes: by_game

// game_public_state  (what all players at the table may see)
{
  gameId:       Id<"games">,
  currentTrick: any[],
  scores:       number[],
  currentTurn:  number,
  trickNum:     number,
  phase:        string,
}
// indexes: by_game

// player_hands  (one document per seat; query filters to caller's own)
{
  gameId:    Id<"games">,
  seatIndex: number,
  playerId:  Id<"players">,
  hand:      any[],
}
// indexes: by_game, by_game_and_player
```

### Transient (chat, presence)

Table chat is stored as lightweight `chat_messages` documents scoped to a game,
or handled via Convex's presence utilities entirely in memory. Loss on restart
is acceptable and expected.

---

## Convex function design

### Reactive query: `getMyGameState`

The client subscribes to this query. Convex re-runs it automatically whenever
`game_public_state` or `player_hands` for this game changes, and pushes the
result to the subscriber. Each player gets their own filtered view.

```typescript
export const getMyGameState = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const seat = await ctx.db.query("game_seats")
      .withIndex("by_game", q => q.eq("gameId", gameId))
      .filter(q => q.eq(q.field("playerId"), identity.subject))
      .first();
    const publicState = await ctx.db.query("game_public_state")
      .withIndex("by_game", q => q.eq("gameId", gameId)).first();
    const myHand = await ctx.db.query("player_hands")
      .withIndex("by_game_and_player", q =>
        q.eq("gameId", gameId).eq("playerId", identity.subject))
      .first();
    return { ...publicState, hand: myHand?.hand ?? [], mySeatIndex: seat?.seatIndex };
  },
});
```

### Mutation: `applyMove`

Transactional. Called once per human turn.

1. Authenticate caller; verify seated and it is their turn
2. Read full state from `game_live_state`
3. Call `engine.applyMove(state, move)` — same pure function as the CLI
4. Write updated `game_live_state`, `game_public_state`, each `player_hands` document
5. Append to `game_moves`
6. If game over: write `result` to `games`, delete live documents
7. If next seat(s) are bots: schedule an Action to compute and apply bot moves

Convex re-runs all affected reactive queries automatically after the mutation
commits. Clients receive their updated filtered state with no additional code.

### Action: `applyBotMoves`

Scheduled by the mutation above when it is a bot's turn. Actions run outside
the transaction and can do heavy computation.

1. Read live state (may call internal mutation to lock)
2. Loop: call `ismcts.chooseMove` or `greedy.chooseCard` for each bot seat
3. Call internal mutation to commit each move and advance state
4. Stop when it is a human player's turn again

ISMCTS iteration count is configurable; target < 5 s per move on Convex's
runtime to stay well within action limits.

---

## Rating system

Rating updates happen at game end inside the `applyMove` mutation (or a
follow-up action). The algorithm is a pure function:

```
newRatings = updateRatings(currentRatings, gameResult)
```

Fetch each player document by ID, compute new `rating` and `sigma`, write back.
No aggregation. The `by_rating` index on `players` makes leaderboard queries
(`order("desc").take(20)`) efficient without any additional infrastructure.

TrueSkill or Glicko-2 are the preferred algorithms (both handle multi-player
natively and carry uncertainty). Margin-weighted pairwise Elo is the fallback
if simpler implementation is needed first.

---

## Frontend framework

No strong preference. Svelte is a good fit (fine-grained reactivity, small
bundle, aligns well with Convex's reactive model). React is familiar. Decision
deferred to Phase 2; the Convex client SDK supports both.

Static assets served from Vercel (free tier, auto-deploys from GitHub on every
push to `main`). Connected via GitHub; `PUBLIC_CONVEX_URL` set in Vercel
environment variables pointing to the production Convex deployment.

---

## What the CLI becomes (Phase 1)

The existing `index.ts` CLI becomes a thin Convex client:

- Subscribes to `getMyGameState` query via Convex's Node.js client
- Sends moves by calling the `applyMove` mutation
- Renders state using the existing `display.ts` functions

The engine code (`engines/`, `ai/`) is shared TypeScript imported directly into
Convex functions — no duplication, no separate build step.

---

## Build sequence (Phase 0.3 → 1.1)

1. **0.3** — Define `Player` and `Session` types in `types.ts`
2. **Convex project** — `npx convex dev`; define schema; deploy to free cloud
3. **Auth** — Wire Convex Auth; magic-link or OAuth for web; token for CLI
4. **`applyMove` mutation** — Core server loop; testable via Convex dashboard
5. **`getMyGameState` query** — Verify reactive push and filtering end-to-end
6. **Bot action** — `applyBotMoves` action; verify AI plays are applied server-side
7. **Web shell (Phase 2.1)** — Minimal page on Vercel; subscribes to query
