# Slobberhannes — Feature Roadmap

Strategy: lay thin architectural foundations across all four features first,
then build each feature to depth in order.

### Known architectural notes (address during TS migration or Phase 1)

1. **`display.js` imports `SUIT_ORDER`/`RANK_ORDER` from the engine directly.**
   `cardSort` will silently produce `NaN` for Tarock trump cards (`suit: 'T'`).
   Fix: pass the order tables as parameters rather than importing them.

2. **ISMCTS hardcodes its engine import.**
   The algorithm is general; only `determinize`, `applyMove`, `getLegalMoves`,
   and `getReward` are game-specific. Extract an `EngineInterface` and inject it
   so ISMCTS is reusable across game engines.

3. **`applyMove` returns bare state, not `EngineResult`.**
   The most load-bearing pending change. All three callers (`index.js`,
   `benchmark.js`, ISMCTS rollouts) will need updating. ISMCTS can discard
   the events array during rollouts — the cost is negligible.

4. **`index.js` and `benchmark.js` both own a full game loop.**
   Both will delegate to the `gameRoom` server module once it exists (Phase 1.1).
   Duplication is expected until then.

---

## Phase 0: Architectural Foundations

Goals: define the event model, server/client boundary, identity model, and
persistence interface before writing any feature code. Everything downstream
depends on getting these right.

### 0.0 Migrate to TypeScript
Migrate while the codebase is small. `types.ts` and `tsconfig.json` already
exist; the engines are pure functions and will convert with minimal friction.

- [x] Add `typescript` as a dev dependency; add `build` and `typecheck` scripts
      to `package.json`
- [x] Convert `engine.js` → `engine.ts`; import and use types from `types.ts`;
      update `applyMove` to return `EngineResult<State>`
- [x] Convert `elo.js` → `elo.ts`
- [x] Convert `display.js` → `display.ts`
- [x] Convert `index.js` → `index.ts`
- [x] Convert `ai/greedy.js` → `ai/greedy.ts`
- [x] Convert `ai/ismcts.js` → `ai/ismcts.ts`
- [x] Confirm `tsc --noEmit` passes with zero errors before moving on

### 0.1 Define the event protocol
- [x] Enumerate all game events that the engine already implies (card played,
      trick won, hand over, game over, penalty assessed, etc.) — done in `types.ts`
- [x] Define a canonical JSON shape for each — `BareEvent` union in `types.ts`;
      `GameEvent<T>` wrapper carries `seq`, `ts`, `gameId`
- [x] Separate durable events from cosmetic events — resolved by making events
      prescriptive (`CardTransfer[]` in `TrickResolvedEvent`); the UI needs no
      game-specific logic to execute any event

### 0.2 Define the server/client boundary
- [x] Moves (client → server) typed as `Move` union in `types.ts`
- [x] Events (server → clients) typed as `GameEvent<BareEvent>` in `types.ts`
- [ ] Document that the console client and the web client are peers — both
      connect to the same server, both receive the same event stream (deferred
      to Phase 1 when the server exists)

### 0.2a Engine event contract (pure functions, no side effects)
- [x] Engine remains purely functional — `EngineResult<TState>` in `types.ts`
      formalises the `{ state, events }` return shape; no callbacks or observers
- [x] Update `engine.js` move functions to actually return `EngineResult` —
      done during 0.0 TypeScript migration

### 0.3 Define user/session identity
- [ ] Define a `Player` record: `{ id, displayName, isBot, createdAt }`
- [ ] Define a `Session` record: `{ id, playerId, gameId, seat, connectedAt }`
- [ ] Decide on ID scheme (UUIDs are fine; no auth required yet — a name +
      random token is enough for the free-tier phase)
- [ ] Note: full auth (OAuth, passwords) is deferred until lobby/online phase

### 0.4 Choose a persistence layer
- [ ] Evaluate options for a free-tier, serverless-compatible store:
      - **Supabase** (Postgres + realtime + auth, generous free tier) — best fit
        if we want SQL for stats and realtime for live updates
      - **Cloudflare D1** (SQLite at the edge, free tier) — good if we go
        Cloudflare Workers for hosting
      - **Firebase Firestore** (NoSQL, free tier) — easier live updates, weaker
        query story for stats
      - **SQLite file** (local dev / self-hosted only) — fine for development,
        not viable for multi-user serverless
- [ ] Recommendation: start with SQLite locally behind an abstract
      `store` interface; wire Supabase in when ready to go online
- [ ] Define the `store` interface (functions, not a class):
      `saveGame`, `appendMove`, `getGame`, `getMovesForGame`,
      `getPlayerRating`, `setPlayerRating`, `upsertPlayer`
- [ ] Schema (two tables, simple):
      - `games(id, playerCount, initialState JSON, startedAt, endedAt, result JSON)`
      - `moves(id, gameId, seq, playerId, card JSON, ts)`
      - `players(id, displayName, isBot, rating REAL, ratingDeviation REAL,
        gamesPlayed, createdAt)`

### 0.5 Research serverless hosting options
- [ ] Compare free-tier options for a stateful WebSocket server:
      - **Cloudflare Workers + Durable Objects** — WebSocket-native, free
        generous limits, global edge, no cold-start issue for sockets
      - **Railway** or **Render** — managed Node.js, free tier available,
        easier to reason about, not edge
      - **Fly.io** free tier — persistent containers, good WebSocket support
- [ ] Note: truly serverless (Lambda/Vercel Functions) is a poor fit for
      WebSocket game rooms; prefer a persistent process or Durable Objects
- [ ] Defer final decision until Phase 1; foundation should be host-agnostic

---

## Phase 1: Online Play (Server + WebSocket Transport)

### 1.1 Extract a game server module
- [ ] Create `server/gameRoom.js`: owns one live game instance, validates
      incoming moves, calls engine functions, and handles the `{ state, events }`
      return value — stamps `seq`, persists durable events, broadcasts to clients
- [ ] Move randomness (shuffle) and AI calls into the server; clients never
      see other players' hidden hands
- [ ] `index.js` becomes a "local" client that talks to gameRoom in-process
      (no network yet — this is the seam you'll later replace with WebSocket)

### 1.2 Add a WebSocket transport
- [ ] Add `server/wsServer.js` using the `ws` package (or `socket.io` if
      reconnection / fallback matters)
- [ ] Each connected client gets a session; server routes `PLAY_CARD` messages
      to the correct game room and fans out events
- [ ] Implement basic reconnection: client sends session token on reconnect;
      server replays missed events by `seq` number

### 1.3 Port the console client to use the transport
- [ ] Refactor `index.js` / `display.js` so they consume the event stream
      rather than reading state directly from the engine
- [ ] Console client connects to localhost WebSocket in dev, remote in prod
- [ ] Human input still works via stdin; output driven by events

### 1.4 AI players as server-side bots
- [ ] Bot seats run entirely on the server; no client needed
- [ ] Server calls `ismcts.chooseCard` or `greedy.chooseCard` and injects the
      result as if a client sent `PLAY_CARD`
- [ ] Bot "think time" can be simulated with a short delay for UI feel

### 1.5 Persist game records
- [ ] On game start: write a `games` row with `initialState`
- [ ] On each move: append a `moves` row
- [ ] On game end: update `games.endedAt` and `games.result`

---

## Phase 2: Web UI

### 2.1 Set up the web app shell
- [ ] Create `web/` directory with a minimal SPA (plain HTML/JS or a light
      framework — decide when the time comes; Svelte is a good fit for
      reactive game state)
- [ ] Web app connects to the same WebSocket server as the console client
- [ ] Shared event schema means zero server changes are needed

### 2.2 Static state rendering
- [ ] Render current hands (face-down for opponents, face-up for self),
      current trick, scores, and whose turn it is
- [ ] Cards are SVG or image assets; suit symbols already exist in engine
      (♣ ♦ ♥ ♠)

### 2.3 Animated event handling
- [ ] Map each event type to a UI animation or transition:
      - `CARD_PLAYED` → card slides from player's hand to trick area
      - `TRICK_WON` → trick slides toward winner's collected pile
      - `PENALTY_ASSESSED` → score counter increments with highlight
      - `HAND_OVER` → brief summary overlay before redeal
      - `GAME_OVER` → result screen
- [ ] Events carry enough data for the animation; UI does not need to re-query
      server state after each event

### 2.4 Input handling
- [ ] Click a card → send `PLAY_CARD` to server
- [ ] Illegal cards are greyed out (client-side hint using legal-moves logic
      mirrored from engine — server still validates)

---

## Phase 3: Lobby and Multi-Table

### 3.1 Game instance registry
- [ ] `server/lobby.js`: map of `gameId → gameRoom`; supports creating,
      joining, and listing open games
- [ ] Each game room is independent; the server can host many concurrently
- [ ] Garbage-collect finished rooms after a grace period

### 3.2 Lobby protocol
- [ ] New client message types: `CREATE_GAME`, `JOIN_GAME`, `LIST_GAMES`,
      `LEAVE_GAME`
- [ ] Server broadcasts `GAME_CREATED`, `PLAYER_JOINED`, `GAME_STARTED`
- [ ] Game does not start until all human seats are filled (bots fill the rest)

### 3.3 Lobby UI (web)
- [ ] Game list screen: open tables, player count, rules variant
- [ ] Create table: choose player count, loseAt threshold, bot fill policy
- [ ] Join table by ID or from list

### 3.4 Player identity across tables
- [ ] Client sends `displayName` + `token` on connect; server resolves to
      `playerId` (creates player record if new)
- [ ] Same player can spectate a table they are not seated at (future)

---

## Phase 4: Rating System

### 4.1 Choose a rating algorithm
- [ ] Standard Elo works only for 1v1 win/loss; not a good fit here
- [ ] Better options:
      - **TrueSkill** (Microsoft): handles multi-player and teams natively,
        accounts for rating uncertainty (σ), works with margins if you bucket
        outcomes. Best choice if we want teams in future games.
      - **Glicko-2**: per-player rating + deviation + volatility; handles
        inactivity decay. Better than Elo, easier to implement than TrueSkill.
        Does not natively handle team games.
      - **Margin-weighted Elo** (existing stub): decompose N-player result into
        pairwise matchups; weight K by score margin. Simple to implement,
        already partially scaffolded in `elo.js`.
- [ ] Recommendation: implement margin-weighted pairwise Elo now (build on
      existing stub); design the interface so TrueSkill can be swapped in later
      without changing the storage schema

### 4.2 Implement the rating update
- [ ] Complete `elo.js` `updateRatings`: pairwise decomposition, margin weight
      on K, handles tied losers (existing spec in the file's comments)
- [ ] Add `ratingDeviation` field to players table (used if upgrading to
      Glicko-2 later)
- [ ] For team games (other rule sets): apply the same rating delta to each
      team member individually; store the `teamId` on the game record for
      historical analysis

### 4.3 Record and apply ratings after each game
- [ ] On `GAME_OVER`: fetch current ratings for all seated players, compute
      new ratings, write back via `store.setPlayerRating`
- [ ] Bot rating updates: store them (useful as a calibration reference —
      a human beating a strong bot earns more than beating a weak bot);
      bots do not appear on the human leaderboard by default

### 4.4 Leaderboard
- [ ] `store.getLeaderboard(limit)`: returns top N human players by rating
- [ ] Expose as a server endpoint (HTTP GET, not WebSocket)
- [ ] Web: leaderboard screen; console: `/ratings` command

---

## Deferred / Open Questions

- **Auth**: real login (OAuth, magic link) deferred until the lobby is live
  and there are actual users to protect
- **Hosting decision**: finalize in Phase 1 step 1.5; do not let it block
  Phase 0 work
- **Bot ratings on leaderboard**: revisit once real human data exists — bots
  as calibration anchors may be useful ("you are rated above Bot-ISMCTS-1500")
- **Other rule variants**: the multi-player Elo design should be generic enough
  to handle team-based games without schema changes
