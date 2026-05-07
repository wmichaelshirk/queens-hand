# Lobby & Table — Behaviour Reference

This file describes the intended behaviour of the Lobby and Table UI components and
their backing Convex functions. If observed behaviour differs from what is written here,
update this file first, then update the code to match.

---

## Lobby page (`/`)

### Layout

Three-column grid: **Online players** (200 px) | **Lobby chat** (400 px) | **Tables** (1fr).

Header: game title, editable display name, sign-out button.

### Online players pane

- Lists every player with a presence record whose `lastSeen` is within the last 60 s.
- The current player is highlighted and labelled "(you)".
- Fallback: "No one else is here yet."

### Lobby chat pane

- Shows up to 100 messages, ordered oldest-first.
- Own messages highlighted.
- Auto-scrolls to the bottom when new messages arrive.
- Input + Send button at the bottom.
- Fallback: "No messages yet. Say hi!"

### Tables pane

- **New Table card** — dashed border. Contains:
  - Game-type toggle: Slobberhannes | Strohmandeln.
  - "Create Table" button.
- **Active table cards** (up to 20, most-recent-first):
  - Game name + status badge: `waiting` | `live`.
  - Seat grid: filled seats show player name; empty seats show "─".
  - Seat count `N/max` and min-player note when relevant.
  - "Enter" button if the current player is seated at that table; "Watch" otherwise.

### Presence heartbeat

- `lobby:ping` is called on mount and every 30 s while the lobby is open.
- The lobby ping does **not** pass a `tableId`, so presence shows the player in the
  lobby rather than at a table.
- On sign-out, `lobby:leave` is called to remove the presence row immediately.

### Queries subscribed

| Query | Returns |
|---|---|
| `auth:getMe` | Current player `{ _id, displayName }` or null |
| `lobby:getOnline` | All online players |
| `lobby:getMessages` | Up to 100 lobby chat messages |
| `games:listActiveTables` | Up to 20 waiting/active tables with seats |

### Mutations called

| Mutation | When |
|---|---|
| `auth:ensurePlayer` | Once on auth, creates player record if missing |
| `auth:updateDisplayName` | When the player submits a new display name |
| `lobby:ping` | On mount and every 30 s |
| `lobby:sendMessage` | On chat submit |
| `games:createTable` | On "Create Table" click |

---

## Table page (`/table/[gameId]`)

### Layout

Two-column grid: **Game area** (1fr) | **Sidebar** (280 px).

Header: back button, game title, status badge, player name, sign-out.

### Game area — waiting status

Shown when `status === "waiting"`.

**"X of Y seated" subtitle** — live seat count.

**Seat grid** — responsive, auto-fill with min 130 px cards. One card per seat:
- Label "Seat N" (0-indexed display, small/uppercase).
- Player name if occupied; "Empty" if not.
- Ready indicator: "✓ ready" (green) or "not ready" (muted).
- "Sit here" button — visible only when: seat is empty, current player is not yet
  seated, table is not full, and status is `waiting`.
- Visual states:
  - Default occupied: blue border (`#1a4a80`).
  - Current player's seat: red border (`#e94560`), darker background.
  - Ready seat: green border (`#4caf50`).

**Settings panel** — shown only when the game type exposes options (Strohmandeln has
a scoring-system selector; Slobberhannes currently has none):
- Title: "Table settings" with "[creator]" badge if the viewer is the creator.
- The creator sees editable controls; non-creators see read-only values.
- Each change saves immediately via `games:updateSettings`.

**Action row** — shown only when the current player is seated:

| State | Button text | Button colour |
|---|---|---|
| Fewer than `minSeatCount` players seated | "Waiting for N more players…" (disabled) | muted |
| Enough players, player not ready | "Start game" | default |
| Player is ready | "✓ Ready — click to unready" | green |

- A secondary **"Stand up"** button is always shown alongside.
- Buttons are disabled while a mutation is in flight (`busy` flag).

### Game area — active / finished

- Active: placeholder "Game in progress — table view coming in Phase 1".
- Finished: "This game has ended" + back-to-lobby button.

### Sidebar — Players section

One row per seat (all seats, including empty):
- Seat number badge.
- Player name, or "—" if empty.
- "(you)" label for the current player.
- "★" dot if this player is the table creator.
- "away" label (muted) if the seated player's presence is not connected (last seen > 90 s,
  or presence `tableId` does not match this table).
- "✓" ready indicator, right-aligned.

**Watchers** — shown below the seat list if any watchers are present:
- "Watching:" label followed by a comma-separated list of watcher names.
- A player is a watcher if they have a presence row with `tableId` matching this table
  and are not in `game_seats`.

### Sidebar — Table chat

- Same format as lobby chat; scoped to this table.
- Up to 200 messages returned, ordered oldest-first.
- Auto-scrolls to bottom on new messages.

### Presence heartbeat at the table

- `lobby:ping` is called with `tableId` on mount and every 30 s.
- On unmount, `lobby:ping` is called with `tableId: undefined` to clear the table
  association from the presence record.

### Queries subscribed

| Query | Returns |
|---|---|
| `games:getTable` | Full table data including seats, settings, watchers |
| `games:getTableMessages` | Up to 200 table chat messages |

### Mutations called

| Mutation | When |
|---|---|
| `lobby:ping` | On mount (with `tableId`) and every 30 s; on unmount (without `tableId`) |
| `games:sitDown` | On "Sit here" click |
| `games:standUp` | On "Stand up" click |
| `games:leaveTable` | When a non-seated watcher navigates back to the lobby |
| `games:markReady` | On "Start game" / ready button click when not currently ready |
| `games:unready` | On ready button click when currently ready |
| `games:updateSettings` | On each settings control change (creator only) |
| `games:sendTableMessage` | On table chat submit |

---

## Convex functions

### `lobby:ping`

- **Auth**: authenticated user or guest.
- **Args**: `guestUserId?`, `tableId?`
- **Behaviour**: Upserts the caller's presence row — sets `lastSeen = now()`,
  `displayName`, and `tableId` if provided. If `tableId` is omitted the existing
  `tableId` on the row is left unchanged (it is not cleared).
- **Called**: On mount and every 30 s by both Lobby and Table pages.

### `lobby:leave`

- **Auth**: authenticated user or guest.
- **Args**: `guestUserId?`
- **Behaviour**: Deletes the caller's presence row immediately. Called on sign-out.

### `lobby:getOnline`

- **Returns**: All presence rows with `lastSeen` within the last 60 s.

### `lobby:getMessages`

- **Returns**: Up to 100 lobby messages ordered oldest-first.

### `lobby:sendMessage`

- **Auth**: authenticated user or guest.
- **Args**: `text`, `guestUserId?`
- **Behaviour**: Inserts a lobby message. If the total count exceeds 100, the oldest
  message is deleted. Empty (trimmed) messages are silently ignored.

---

### `games:listActiveTables`

- **Returns**: Up to 20 games with `status = "waiting" | "active"`, most-recent-first,
  each including seat info (seatIndex, playerId, displayName, isBot, ready).
  Does **not** include watcher or connection-status data.

### `games:getTable`

- **Args**: `gameId`
- **Returns**: Full table record including:
  - `seats` with `connected` flag (presence row exists, matches this tableId, lastSeen
    within 90 s).
  - `watchers` — presence rows where `tableId` matches and `lastSeen` is within 90 s,
    excluding seated players.
- Returns `null` if the game does not exist.

### `games:getTableMessages`

- **Args**: `gameId`
- **Returns**: Up to 200 messages for this table, ordered oldest-first.

### `games:createTable`

- **Auth**: authenticated user or guest.
- **Args**: `gameType`, `guestUserId?`
- **Behaviour**: Inserts a games row with `status = "waiting"`. `seatCount` and
  `minSeatCount` come from `GAME_CONFIG`:
  - Slobberhannes: min 3, max 6, default 4 seats.
  - Strohmandeln: min 2, max 2 seats.
- Sets `creatorPlayerId` to the caller. Returns the new `gameId`.

### `games:sitDown`

- **Auth**: authenticated user or guest.
- **Args**: `gameId`, `seatIndex`, `guestUserId?`
- **Validation**: Game must be `waiting`; player not already seated; table not full;
  `seatIndex` in range; seat not occupied.
- **Behaviour**: Inserts a game_seats row with `ready = false`. Idempotent if the
  player is already in that exact seat.

### `games:standUp`

- **Auth**: authenticated user or guest.
- **Args**: `gameId`, `guestUserId?`
- **Validation**: Game must not be `active`.
- **Behaviour**: Deletes the caller's game_seats row. If the departing player was the
  creator and other seats remain, transfers the creator role to the first remaining
  player (by seatIndex). Does **not** delete the table.

### `games:leaveTable`

- **Auth**: authenticated user or guest.
- **Args**: `gameId`, `guestUserId?`
- **Behaviour**: Stands the caller up if seated (unless game is active). If no seated
  players remain after the caller leaves, deletes all `table_messages` for the game
  and deletes the games row itself.
- **Use case**: Called when a watcher (non-seated player) navigates away from the table.

### `games:markReady`

- **Auth**: authenticated user or guest.
- **Args**: `gameId`, `guestUserId?`
- **Validation**: Game must be `waiting`; player must be seated.
- **Behaviour**: Sets `ready = true` on the caller's seat. If all seated players are
  now ready **and** the seat count meets `minSeatCount`, sets `games.status = "active"`.
  This is the only trigger for game start.

### `games:unready`

- **Auth**: authenticated user or guest.
- **Args**: `gameId`, `guestUserId?`
- **Validation**: Game must be `waiting`.
- **Behaviour**: Sets `ready = false` on the caller's seat.

### `games:updateSettings`

- **Auth**: authenticated user or guest; must be the table creator.
- **Args**: `gameId`, `settings` (any JSON object), `guestUserId?`
- **Validation**: Game must be `waiting`; caller must be `creatorPlayerId`.
- **Behaviour**: Patches `games.settings` with the provided object.

### `games:sendTableMessage`

- **Auth**: authenticated user or guest.
- **Args**: `gameId`, `text`, `guestUserId?`
- **Behaviour**: Inserts a table_messages row. Text is trimmed and truncated to 500
  characters. Empty text after trimming is still inserted (unlike lobby messages).

---

## Schema summary (lobby & table collections)

| Collection | Purpose | Lifetime |
|---|---|---|
| `presence` | Online heartbeat; tracks which table a player is viewing | Deleted on logout; expires after 60 s of no ping |
| `lobby_messages` | Lobby chat | Capped at 100; oldest pruned automatically |
| `games` | Table / game record | Deleted by `leaveTable` when last player departs |
| `game_seats` | One row per seated player | Deleted on stand-up or leave |
| `table_messages` | Per-table chat | Deleted in bulk when the table is deleted |
