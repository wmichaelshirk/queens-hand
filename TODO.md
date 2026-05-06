# Slobberhannes — Feature Roadmap

Strategy: lay thin architectural foundations across all four features first,
then build each feature to depth in order.

### Known architectural notes (address during Phase 1)

1. **`index.ts`, `benchmark.ts`, and `benchmark_straw.ts` all own a full game loop.**
   All will delegate to the `gameRoom` server module once it exists (Phase 1.1).
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
- [x] `Player` record defined in `convex/schema.ts`: `{ userId, displayName, isBot, isGuest, ratings, createdAt }`
- [x] Session identity handled by Convex Auth (JWT tokens) for registered users;
      guest sessions use a random `guest_<token>` userId stored in localStorage
- [x] Auth wired in `convex/auth.ts` (Google + Resend providers, not yet
      configured — guests are the active login path)
- [x] Guest login implemented: enter a name, get a transient player record with
      no ratings or history

### 0.4 Choose a persistence layer
- [x] Evaluated options; chose **Convex** — TypeScript-native document store
      with reactive queries, built-in auth, and free tier. Eliminates the need
      for a separate realtime layer or RLS policies. See ARCHITECTURE.md.
- [x] Schema defined in `convex/schema.ts`: `players`, `games`, `game_seats`,
      `game_moves`, `game_live_state`, `game_public_state`, `player_hands`,
      `presence`, `lobby_messages`
- [x] No separate `store` interface needed — Convex mutations/queries serve
      that role directly

### 0.5 Research serverless hosting options
- [x] Chose **Convex** for all backend logic (DB, auth, realtime, mutations,
      actions). No separate WebSocket server needed — Convex reactive queries
      push state to clients automatically.
- [x] Chose **Vercel** for the SvelteKit frontend (free tier, auto-deploys
      from GitHub on push to `main`).
- [x] Both are live: backend at `https://fast-albatross-205.convex.cloud`,
      frontend deployed via Vercel connected to `wmichaelshirk/queens-hand`.

---

## Phase 1: Online Play (Convex backend + SvelteKit frontend)

Backend is Convex (mutations, reactive queries, actions). No WebSocket server —
Convex reactive queries push state to clients automatically.

### 1.1 Lobby + waiting room
- [x] Schema: all collections defined in `convex/schema.ts` (including `table_messages`)
- [x] `lobby.ts`: presence heartbeat, online-player list, lobby chat
- [x] `games.ts`: `createTable`, `joinTable`, `listActiveTables`, `getTable`
- [x] `games.ts`: `getTableMessages`, `sendTableMessage` (per-table chat)
- [x] Web: login page, lobby (3-pane: online players / chat / tables), table shell page
- [x] Web: waiting room UI — seat grid, sidebar player list, table chat

### 1.2 Game initialisation
- [ ] `convex/games.ts` — `startGame` internal mutation: called when the last
      seat is filled; deals cards, writes `game_live_state`, `game_public_state`,
      `player_hands`, sets `games.status = "active"`, stores `initialState`
- [ ] Auto-trigger: call `startGame` at the end of `joinTable` when
      `seats.length === game.seatCount`

### 1.3 Reactive game state query
- [ ] `convex/games.ts` — `getMyGameState` query: returns `game_public_state`
      + caller's own `player_hands` row (never another player's hand)
- [ ] Web: subscribe to `getMyGameState` in the table page; replace the
      "game in progress" placeholder with hand + trick + scores

### 1.4 Apply moves
- [ ] `convex/games.ts` — `applyMove` mutation: authenticate caller → verify
      it is their turn → read `game_live_state` → call engine → write
      `game_live_state`, `game_public_state`, each `player_hands` → append
      `game_moves` → if game over: write result, delete live docs; else if
      next seat is a bot: schedule `applyBotMoves` action
- [ ] Web: send `PLAY_CARD` on card click; grey out illegal cards (mirror
      legal-moves logic client-side as a hint; server still validates)

### 1.5 Bot moves
- [ ] `convex/games.ts` — `applyBotMoves` action: loop — call ISMCTS for
      each bot seat → call internal mutation to commit move → stop when it
      is a human player's turn again

---

## Phase 2: Web UI

### 2.1 Web app shell
- [x] SvelteKit app in `web/` deployed to Vercel
- [x] Login, lobby, and table shell pages exist
- [x] Subscribes to reactive Convex queries via `watchQuery` helper

### 2.2 Static game state rendering (blocked on 1.3)
- [ ] Render own hand face-up, opponents' seat slots face-down
- [ ] Render current trick in the centre, scores per seat, turn indicator
- [ ] Cards as SVG or styled elements; suit symbols from engine (♣ ♦ ♥ ♠)

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
