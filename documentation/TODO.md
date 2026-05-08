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
- [x] `lobby.ts`: presence heartbeat (with optional `tableId`), online-player list, lobby chat
- [x] `games.ts`: `createTable`, `sitDown`, `standUp`, `leaveTable`, `markReady`, `unready`,
      `listActiveTables`, `getTable`, `updateSettings`
- [x] `games.ts`: `getTableMessages`, `sendTableMessage` (per-table chat)
- [x] Web: login page, lobby (3-pane: online players / chat / tables), table shell page
- [x] Web: waiting room UI — seat grid, sit/stand/ready controls, creator settings panel,
      sidebar with seated players (connected/away state), watchers list, table chat
- [x] Variable player counts per game type (`GAME_CONFIG`; Slobberhannes 3–6, Strohmandeln 2)
- [x] Creator tracking + transfer on stand-up/leave; game-type options sourced from engine exports

### 1.2 Game initialisation ✓
- [x] `_startGame` internal helper: triggered from `markReady` when all seated
      players are ready; deals cards, writes `game_live_state`, `game_public_state`,
      `player_hands`, sets `games.status = "active"`
- [x] `addBot` mutation: adds an ISMCTS-driven bot player to an empty seat (isBot:
      true, ready: true); bot is auto-created as a fresh player record per seat

### 1.3 Reactive game state query ✓
- [x] `getMyGameState` query: returns `game_public_state` + caller's own
      `player_hands` row (never another player's hand)
- [x] Table page subscribes to `getMyGameState`; renders hand, trick, scores,
      and turn banner

### 1.4 Apply moves ✓
- [x] `applyMove` mutation: validate caller's turn → call engine via `EngineAdapter`
      → write `game_live_state`, `game_public_state`, each `player_hands` → append
      `game_moves` → if game over: finalize; else if next seat is a bot: schedule
      `applyBotMoves`
- [x] `EngineAdapter` interface unifies Slobberhannes (`Card` bare move) and
      Strohmandeln (`Move` from types.ts); `_applyMoveLogic` shared across both
- [x] Web: move buttons rendered for legal cards; cards sent on click

### 1.5 Bot moves ✓
- [x] `applyBotMoves` internalAction: loops ISMCTS→`applyMoveInternal` while the
      current seat is a bot; stops when it reaches a human player's turn
- [x] Strohmandeln between-hands phase: human players vote Continue/Quit after each
      hand; bots always vote continue; any quit finalises the session

---

## Phase 2: Web UI

### 2.1 Web app shell ✓
- [x] SvelteKit app in `web/` deployed to Vercel; login, lobby, and table pages live
- [x] Subscribes to reactive Convex queries via `watchQuery` helper

### 2.2 Static game state rendering ✓
- [x] Own hand rendered with sorted cards; opponents shown as seat slots
- [x] Current trick displayed; scores per seat; turn banner; strawman piles (Strohmandeln)
- [x] Cards styled as proper playing cards (white/cream background, corner rank+suit, color-coded)
- [x] Opponents' card backs shown as face-down overlapping card stack

### 2.3 Event-driven UI
- [ ] Animate `CARD_PLAYED` → card slides from hand to trick area
- [ ] Animate `TRICK_WON` → trick slides toward winner
- [ ] `PENALTY_ASSESSED` / `HAND_OVER` / `GAME_OVER` transitions
- [ ] (Engine events are already appended to table chat as a text log — this is about visual animation)

### 2.4 Input handling ✓
- [x] Click hand card to play (legal cards raised and highlighted; illegal cards dimmed)
- [x] Bid/announcement actions still use button grid (non-card moves)
- [x] Illegal cards greyed out client-side (server still validates)

### 2.5 Hand summary ✓
- [x] Backend: `lastHandSummary` stored on games doc when HAND_SCORED fires; exposed from `getMyGameState`
- [x] UI: dismissable summary panel shows per-player score deltas + reasons + running totals after each hand
- [x] Color-coded: penalty (red) vs gain (green), game-type-aware
- [x] Strohmandeln: shown prominently during between-hands voting phase

### 2.6 Rules reference ✓
- [x] Collapsible rules accordion on the waiting room page for both games
- [x] Slobberhannes: penalty scoring rules, sweep bonus, suit-following
- [x] Strohmandeln: deck, strawman piles, bidding, scoring, session length

### 2.7 Game identity ✓
- [x] Game icons (Q♣ for Slobberhannes, ★ for Strohmandeln) in table header and waiting room title
- [x] Icons also shown in lobby table cards and game picker buttons

### 2.8 Game over screen ✓
- [x] Proper game-over display with final scores and loser highlight
- [x] `result` exposed from `getTable` query for post-game display

### 2.9 Mid-game quit and kick

#### a) Voluntary quit
- [ ] `convex/games.ts` — `quitGame` mutation: caller must be a seated human in
      an active game; marks that player as having forfeited; ends the game
      immediately (no partial hands); sets `games.status = "finished"` and
      `games.result` with the quitter flagged as a loss (partners, if any, are
      not penalised)
- [ ] After quit: player is stood up (`game_seats` row removed or status = "stood");
      table returns to waiting/lobby state so remaining players can start a new game
      without navigating away
- [ ] Web: "Quit game" button visible only to seated human players during an active
      game; confirmation prompt before sending (avoid fat-finger forfeits)
- [ ] Rating update: when Phase 4 is implemented, treat a quit as a last-place finish
      for the quitter only; other players' results are computed from the score at
      the moment of quit (TBD — may just void the game for everyone until ratings exist)

#### b) Kick vote
- [ ] `convex/games.ts` — `voteKick` mutation: any seated human player can cast a
      kick vote against another seated player; vote is stored on the game or a
      ephemeral `kick_votes` sub-document; once **all other** seated players have
      voted to kick a given target, trigger the same quit logic as above (with the
      target flagged as the forfeiter)
- [ ] Votes are per-game, per-target, per-voter; a voter can retract before the
      threshold is reached
- [ ] Web: UI is TBD — options include (1) a "Vote to kick" button per opponent
      seat that toggles your vote, with a visible tally; (2) a single "call a vote"
      action that opens a modal naming the target and requiring explicit confirms
      from all others. Decide before implementing.
- [ ] Kick should be unavailable (or auto-succeed) when only 2 players remain at
      the table (unanimous = 1 vote)

---

## Phase 3: Lobby and Multi-Table

> Note: Phase 3 was originally scoped for a WebSocket server. The actual
> implementation uses Convex mutations/reactive queries, which handle
> all of the same concerns without a separate server process.

### 3.1 Game instance registry
- [x] Convex `games` collection: each row is an independent game room;
      `createTable`, `listActiveTables`, `getTable`
- [x] Multiple concurrent tables supported by design
- [x] `leaveTable` deletes the table (+ messages) when the last seated
      player leaves; `standUp` alone does not delete

### 3.2 Lobby protocol
- [x] `createTable`, `sitDown`, `standUp`, `leaveTable` cover CREATE/JOIN/LEAVE
- [x] Reactive `listActiveTables` / `getTable` queries replace server broadcasts —
      clients receive updates automatically
- [x] Game starts only when all seated players click "Start game" (`markReady`),
      and only once the minimum player count is reached

### 3.3 Lobby UI (web)
- [x] Game list: open tables with seat count, min players, live/waiting status
- [x] Create table: choose game type; scoring-system option for Strohmandeln
      (sourced directly from engine exports — no duplication)
- [x] Navigate to table as observer (Watch) or return to seated table (Enter)
- [x] Bot fill policy: `addBot` mutation fills empty seats manually; creator
      can add bots before clicking ready

### 3.4 Player identity across tables
- [x] Identity via Convex Auth (registered) or guest session (`guest_<token>`
      in localStorage); player record created on first login
- [x] Watchers: any player can navigate to a table URL and observe/chat
      without holding a seat (tracked via presence `tableId` heartbeat)
- [ ] Spectating a table mid-game (observe active game without a seat)

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
