# Queens Hand — Claude Context

## What this project is

Multiple traditional card game engines (Slobberhannes, Strohmandeln) built in TypeScript,
hosted on Convex, with a SvelteKit web frontend served from Vercel.
Friends-only, not public. Free-tier only — no credit card, no managed infra.

Current phase: **Phase 1** — wiring the Convex backend (mutations, reactive queries,
bot actions). The engines are complete. The web lobby shell exists. Auth is wired.

---

## File map

```
engines/slobberhannes.ts   — Slobberhannes game engine (pure functions)
engines/strohmandeln.ts    — Strohmandeln game engine (pure functions)
ai/greedy.ts               — Greedy card-picker (fast, weak - eventually to be removed)
ai/ismcts.ts               — ISMCTS card-picker (strong, slower — used for bots)
lib/engine.ts              — Shared engine utilities
lib/matching.ts            — Suit-matching logic
types.ts                   — Canonical types: Card, Move, GameEvent, BareEvent, EngineResult
convex/schema.ts           — Full Convex schema (source of truth for all collections)
convex/lobby.ts            — Presence heartbeat + lobby chat mutations/queries
convex/auth.ts             — Convex Auth config
convex/http.ts             — HTTP router (auth routes only)
web/                       — SvelteKit frontend (Vercel)
index.ts                   — CLI client (thin; talks to Convex)
benchmark.ts               — Full ISMCTS vs Greedy benchmark
benchmark_straw.ts         — Strohmandeln-specific benchmark
elo.ts                     — Rating update stub (pairwise Elo; TrueSkill upgrade path)
display.ts                 — Terminal rendering helpers
```

---

## Architectural invariants — never break these

1. **Engines are pure functions.** `applyMove(state, move)` returns `{ state, events }`.
   No side effects, no I/O, no randomness after deal. The server calls these; clients never do.

2. **All move validation is server-side.** Clients send `Move` objects to Convex mutations.
   The mutation validates, calls the engine, writes state. Clients are never trusted.

3. **State is filtered per player before delivery.** `game_live_state` (full hands) is
   server-only. Clients receive only `game_public_state` + their own `player_hands` row.
   Never return another player's hand to a client.

4. **Bot moves are server-side actions.** ISMCTS runs inside a Convex Action (outside
   the transaction). The action calls an internal mutation to commit each bot move.
   Bots never have a client connection.

5. **events are prescriptive.** `BareEvent` values emitted by the engine encode full
   outcomes including `CardTransfer[]`. The UI needs no game-specific logic to render
   or animate any event.

---

## Convex collections (from schema.ts)

**Permanent:** `players`, `games`, `game_seats`, `game_moves`
**Live (deleted at game end):** `game_live_state`, `game_public_state`, `player_hands`
**Ephemeral:** `presence`, `lobby_messages`

Ratings are stored per-game-type on the `players` document:
`ratings: { slobberhannes: { rating, sigma, gamesPlayed }, ... }`

---

## Commands

```bash
npm run typecheck     # tsc --noEmit — run this after any TypeScript change
npm run build         # tsc
npm run benchmark     # node dist/benchmark.js  (requires build first)
npx convex dev        # run Convex dev server (separate terminal)
```

---

## What's next (Phase 1 priorities)

In order:

1. `convex/games.ts` — `createGame` mutation: creates `games`, `game_seats`,
   `game_live_state`, `game_public_state`, `player_hands` documents
2. `convex/games.ts` — `getMyGameState` reactive query: returns `game_public_state`
   + caller's own `player_hands` row (never another player's hand)
3. `convex/games.ts` — `applyMove` mutation: validate → engine → write live/public/
   hand docs → append `game_moves` → schedule bot action if next seat is a bot
4. `convex/games.ts` — `applyBotMoves` action: loop ISMCTS → call internal mutation
   per bot move → stop when it's a human's turn
5. `web/` — game table view: subscribe to `getMyGameState`, render hand + trick + scores,
   send `PLAY_CARD` on card click

---

## Rating system

Current stub: pairwise Elo with margin weighting (`elo.ts`).
Planned upgrade: TrueSkill or Glicko-2 (both handle multi-player natively).
Interface is designed so the algorithm can be swapped without schema changes.
Bots get ratings too (useful as calibration anchors); they do not appear on the
human leaderboard.

---

## Constraints

- Free tier only: Convex free tier (1 GB), Vercel free tier
- No credit card anywhere
- Node ≥ 18
- TypeScript strict mode — `tsc --noEmit` must pass before any PR
