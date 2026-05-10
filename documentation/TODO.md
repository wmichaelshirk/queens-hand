# Slobberhannes — Feature Roadmap

Strategy: lay thin architectural foundations across all four features first,
then build each feature to depth in order.

---

## Phase 0: Architectural Foundations ✓

TypeScript migration, event protocol (BareEvent/GameEvent), server/client boundary,
Convex Auth + guest identity, Convex persistence schema.

---

## Phase 1: Online Play ✓

Lobby + waiting room, game initialisation, reactive state query (`getMyGameState`),
move validation + engine dispatch (`applyMove`), bot moves (ISMCTS internalAction).

---

## Phase 2: Web UI

Completed: app shell, static game state rendering (hand, trick, scores, card backs),
input handling, hand summary panel, rules reference accordion, game identity icons,
game-over screen.

### 2.1 Auth — Google login + magic link
- [ ] Implement Login with Google and magic link. Both should store the user under
      the same email address; either should subsequently work for the same person.

### 2.3 Event-driven UI
- [ ] Animate `CARD_PLAYED` → card slides from hand to trick area
- [ ] Animate `TRICK_WON` → trick slides toward winner
- [ ] `PENALTY_ASSESSED` / `HAND_OVER` / `GAME_OVER` transitions
- [ ] Strohmandeln pile reveal: when a card is flipped from the top of a straw pile
      into a player's hand, display it face-up on the pile for ~1 second before
      animating it into the hand — same pattern as the inter-trick pause already
      implemented for trick clearing

### 2.9 Mid-game quit and kick

#### a) Voluntary quit
- [ ] `convex/games.ts` — `quitGame` mutation: caller must be a seated human in an
      active game; marks that player as having forfeited; ends the game immediately
      (no partial hands); sets `games.status = "finished"` and `games.result` with
      the quitter flagged as a loss (partners, if any, are not penalised)
- [ ] After quit: player is stood up; table returns to waiting state so remaining
      players can start a new game without navigating away
- [ ] Web: "Quit game" button visible only to seated human players during an active
      game; confirmation prompt before sending (avoid fat-finger forfeits)
- [ ] Rating update: treat a quit as a last-place finish for the quitter only; other
      players' results computed from score at the moment of quit (may just void the
      game for everyone until ratings exist)

#### b) Kick vote
- [ ] `convex/games.ts` — `voteKick` mutation: any seated human can cast a kick vote
      against another seated player; once all other seated players have voted to kick
      a target, trigger the same quit logic with the target flagged as the forfeiter
- [ ] Votes are per-game, per-target, per-voter; a voter can retract before the
      threshold is reached
- [ ] Web: UI TBD — options: (1) "Vote to kick" toggle per opponent seat with visible
      tally; (2) "call a vote" modal requiring explicit confirms from all. Decide
      before implementing.
- [ ] Kick unavailable (or auto-succeeds) when only 2 players remain

### 2.10 Detailed per-hand breakdown

**Prerequisite:** Both engines currently emit only aggregate per-player deltas from
`HAND_SCORED`. Trick-level detail must be added at the engine layer before the UI
can display it.

- [ ] Enhance `HAND_SCORED` event payload in both engines to carry trick-level data:
      which player won which tricks, and which penalty events fired per trick
      (Slobberhannes: Q♣ taken, 7♦ taken, last-trick, sweep; Strohmandeln: bid vs.
      actual, pile contributions). This is an engine change, not just a UI change.
- [ ] Expand `lastHandSummary` to include trick-level detail when persisting to the
      games doc (`v.any()` schema — no schema change needed, just populate the field)
- [ ] UI: expandable "show details" within the hand summary panel — collapsed by
      default, one click reveals the trick-by-trick breakdown

### 2.11 Rules accessible during active gameplay
- [ ] Add collapsible rules section to the active game table page (below the fold);
      collapsed by default; game-type-aware (shows only the relevant game's rules)

### 2.12 Proper game avatars / icons
- [ ] Replace text-symbol placeholders (Q♣, ★) with proper SVG icons or styled card
      art; use consistently in game picker, lobby cards, table header, waiting room
      title, and game-over screen

### 2.13 CSS theme variables
- [ ] Extract hardcoded hex colours across all Svelte components into CSS custom
      properties on `:root` (e.g. `--color-bg`, `--color-accent`, `--color-danger`,
      `--color-card-face`, `--color-card-back`)
- [ ] Centralise in `web/src/app.css` or a dedicated `theme.css`; components
      reference variables instead of raw hex codes

### 2.14 Separate play log from table chat
- [ ] Move engine event entries (CARD_PLAYED, TRICK_WON, PENALTY_ASSESSED, etc.) out
      of the table chat sidebar and into a dedicated play log panel
- [ ] Play log: scrollable, auto-scroll to latest; collapsed or hidden by default;
      expandable to review recent play
- [ ] Table chat remains for player messages only; the two feeds must never be mixed

---

## Phase 3: Lobby and Multi-Table

Completed: game instance registry (Convex `games` collection), lobby protocol
(createTable, sitDown, standUp, leaveTable, listActiveTables), lobby UI (table list,
create table, bot fill), player identity (Convex Auth + guest sessions).

### 3.4 Spectating a table mid-game

**Backend prerequisite:** `getMyGameState` has no spectator-aware path — non-seated
callers always receive `myHand: []` and the return type cannot express "show all
hands" without a structural change.

- [ ] Refactor `getMyGameState` to support a spectator path: if caller is not seated,
      return `allHands: Card[][]` (all players' hands) — or create a separate
      `getSpectatorGameState` query. Current return type is seat-scoped only.
      (`convex/games.ts:405–550`)
- [ ] Fix the hardcoded 2-player opponent-index assumption in the table page:
      `opponentEngineIdx = myEngineIndex === 0 ? 1 : 0` breaks for non-seated
      visitors and for 3+ player games.
      (`web/src/routes/table/[gameId]/+page.svelte:637`)
- [ ] All seated players' hands must be visible to spectators
- [ ] Spectators must not see the Quit / Continue voting UI that appears between
      hands in Strohmandeln

### 3.5 Game record attribution
- [ ] Guest players (no email, no persistent account) must be recorded in game
      history — `game_seats`, `games.result`, game-over display — with their
      chosen display name suffixed with `(guest)`, e.g. "Alice (guest)"
- [ ] Registered players (Google or email login, with a stable user ID and
      rankings) must be linked by their permanent `userId` in all game records
      so that history and rating history accumulate correctly across sessions
- [ ] Ensure the guest/registered distinction is visible wherever game history
      is displayed (game-over screen, future leaderboard, per-game records)

---

## Phase 4: Rating System

### 4.1 Choose a rating algorithm
- [ ] Standard Elo works only for 1v1 win/loss; not a good fit here
- [ ] Better options:
      - **TrueSkill**: handles multi-player and teams natively, accounts for rating
        uncertainty (σ), works with margins if you bucket outcomes
      - **Glicko-2**: per-player rating + deviation + volatility; handles inactivity
        decay. Does not natively handle team games.
      - **Margin-weighted Elo** (existing stub): pairwise decomposition; weight K by
        score margin. Already partially scaffolded in `elo.ts`.
- [ ] Recommendation: implement margin-weighted pairwise Elo now; design the interface
      so TrueSkill can be swapped in later without changing the storage schema

### 4.2 Implement the rating update
- [ ] Complete `elo.ts` `updateRatings`: currently a stub that returns unchanged
      ratings. Implement pairwise decomposition, margin weight on K, handles tied
      losers (spec in the file's comments).
- [ ] Add `ratingDeviation` field to players table (used if upgrading to Glicko-2)
- [ ] For team games: apply same rating delta to each team member individually; store
      `teamId` on the game record for historical analysis

### 4.3 Record and apply ratings after each game
- [ ] On `GAME_OVER`: insert rating update at the clean hook point inside
      `_finalizeGame()` (`convex/games.ts:1067–1120`), right after
      `adapter.getGameResult()` stores the result — no upstream refactoring needed
- [ ] Bot rating updates: store them (calibration reference); bots do not appear on
      the human leaderboard

### 4.4 Leaderboard
- [ ] `store.getLeaderboard(limit)`: returns top N human players by rating
- [ ] Expose as a server endpoint (HTTP GET)
- [ ] Web: leaderboard screen; console: `/ratings` command

---

## Phase 5: More Games

### Pre-5.1 Engine layer cleanup

- [ ] Fix `ISMCTSEngine.applyMove` return type in `lib/engine.ts:18` — declared as
      `{ state: TState }` but both engines return `EngineResult<TState>`. ISMCTS
      discards events when `simulate=true`, which is fine; the declared type should
      match the actual return shape.

### Pre-5.2 Backend game registry

- [ ] Replace the closed `GameType` union and `getAdapter()` ternary with a registry
      Map: `const engineRegistry = new Map<string, EngineAdapter>()`.
      Adding a new game becomes one `registry.set()` call with no other changes to
      the dispatch layer. (`convex/games.ts:56, 147–149`)
- [ ] Make `schema.ts` `gameType` a generic validated string rather than a closed
      literal union — the current `v.union(v.literal(...))` pattern requires editing
      the schema for every new game. (`convex/schema.ts:26`)
- [ ] Move strawmen extraction into `EngineAdapter`: add
      `getPublicExtras(state): Record<string, unknown> | null`; call it in
      `getMyGameState` instead of the inline game-type branch.
      (`convex/games.ts:516–526`)
- [ ] Add `redealForContinuation(prevState, scores, settings)` to `EngineAdapter`;
      call it from `_startNextHand()` instead of the direct `Strohmandeln.dealState()`
      call. (`convex/games.ts:1211–1217`)

### Pre-5.3 Frontend game config

- [ ] Create `web/src/lib/gameConfig.ts`: a map from gameType string → metadata
      (display name, icon, card sort function, score direction). Replace the 4+
      if/else game-type branches in the table page and lobby with config lookups.
      (table page: lines 379, 407, 725; lobby game-picker: lines 112, 209–215)
- [ ] Extract hand summary score interpretation to a helper `isScoreBad(gameType, delta)`
      instead of baking the sign convention into the template.
      (`web/src/routes/table/[gameId]/+page.svelte:554–555`)

### 5.1 Generalize components before adding new games (see Pre-5.x above)
### 5.2 Bondtolva
### 5.3 Dreier Tarock (54/42)
### 5.4 Konigrufen (simple, Lungau, Upper Austrian)
### 5.5 Trappola

---

## Deferred / Open Questions

- **Auth**: real login (OAuth, magic link) deferred until the lobby is live and there
  are actual users to protect
- **Server/client boundary docs**: document that the console client and the web client
  are peers — both connect to Convex and receive the same event stream. Deferred now
  that the server exists; belongs in ARCHITECTURE.md.
- **Bot ratings on leaderboard**: revisit once real human data exists — bots as
  calibration anchors may be useful ("you are rated above Bot-ISMCTS-1500")
- **Other rule variants**: the multi-player Elo design should be generic enough to
  handle team-based games without schema changes
