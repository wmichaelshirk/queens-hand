<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { isAuthenticated, isLoggedIn, guestSession, signIn, signInAsGuest, signOut, convex, watchQuery } from "$lib/convex";
  import { api } from "$convex/_generated/api";

  // ── Auth ──────────────────────────────────────────────────────────────────

  let email = $state("");
  let emailSent = $state(false);
  let authError = $state("");

  let guestName = $state("");
  let guestError = $state("");

  async function loginAsGuest() {
    guestError = "";
    if (!guestName.trim()) { guestError = "Enter a name to continue."; return; }
    try {
      await signInAsGuest(guestName.trim());
    } catch (e: any) {
      guestError = e?.message ?? "Something went wrong.";
    }
  }

  async function loginWithGoogle() {
    authError = "";
    await signIn("google");
  }

  async function loginWithEmail() {
    authError = "";
    if (!email.trim()) return;
    const ok = await signIn("resend", { email: email.trim() });
    if (!ok) emailSent = true; // redirect not issued → email sent
  }

  // ── Player record ─────────────────────────────────────────────────────────

  // Ensure a players row exists after first login (auth users only; guests are created on sign-in)
  $effect(() => {
    if ($isAuthenticated) {
      convex.mutation("auth:ensurePlayer" as any, {}).catch(() => {});
    }
  });

  const me = watchQuery<{ _id: string; displayName: string } | null>(
    "auth:getMe" as any,
    {}
  );

  // ── Presence ──────────────────────────────────────────────────────────────

  // Simple heartbeat-based presence: store online user IDs in memory on the
  // client via Convex Presence pattern. We keep it lightweight for the MVP:
  // each client sends a "ping" mutation every 30 s; the query returns players
  // whose lastSeen is within 60 s.
  let presenceInterval: ReturnType<typeof setInterval>;

  $effect(() => {
    if ($isLoggedIn) {
      const guestUserId = $guestSession?.userId;
      convex.mutation("lobby:ping" as any, { guestUserId }).catch(() => {});
      presenceInterval = setInterval(() => {
        convex.mutation("lobby:ping" as any, { guestUserId }).catch(() => {});
      }, 30_000);
    }
    return () => clearInterval(presenceInterval);
  });

  const onlinePlayers = watchQuery<Array<{ _id: string; displayName: string }>>(
    "lobby:getOnline" as any,
    {}
  );

  // ── Chat ──────────────────────────────────────────────────────────────────

  const messages = watchQuery<
    Array<{ _id: string; displayName: string; text: string; ts: number }>
  >("lobby:getMessages" as any, {});

  let chatText = $state("");
  let chatEl: HTMLDivElement;

  $effect(() => {
    if ($messages && chatEl) {
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  });

  async function sendMessage() {
    const text = chatText.trim();
    if (!text) return;
    chatText = "";
    await convex.mutation("lobby:sendMessage" as any, { text, guestUserId: $guestSession?.userId });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Display name editing ──────────────────────────────────────────────────

  let editingName = $state(false);
  let newName = $state("");

  function startEditName() {
    newName = $me?.displayName ?? "";
    editingName = true;
  }

  async function saveName() {
    if (!newName.trim()) return;
    await convex.mutation("auth:updateDisplayName" as any, { displayName: newName.trim() });
    editingName = false;
  }
</script>

{#if !$isLoggedIn}
  <!-- ── Login screen ─────────────────────────────────────────────────── -->
  <main class="login-wrap">
    <div class="login-card">
      <h1>The Queen's Hand</h1>
      <p class="tagline">Card games with friends</p>

      {#if authError}
        <p class="error">{authError}</p>
      {/if}

      <button class="btn btn-google" onclick={loginWithGoogle}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
        </svg>
        Continue with Google
      </button>

      <div class="divider"><span>or</span></div>

      {#if emailSent}
        <p class="email-sent">
          Check your inbox — a sign-in link has been sent to <strong>{email}</strong>.
        </p>
      {:else}
        <form onsubmit={(e) => { e.preventDefault(); loginWithEmail(); }}>
          <input
            type="email"
            placeholder="your@email.com"
            bind:value={email}
            required
            class="input"
          />
          <button type="submit" class="btn btn-primary">Send sign-in link</button>
        </form>
      {/if}

      <div class="divider"><span>or</span></div>

      <form onsubmit={(e) => { e.preventDefault(); loginAsGuest(); }}>
        {#if guestError}
          <p class="error">{guestError}</p>
        {/if}
        <input
          type="text"
          placeholder="Choose a name…"
          bind:value={guestName}
          maxlength="32"
          class="input"
        />
        <button type="submit" class="btn btn-guest">Play as Guest</button>
      </form>
      <p class="guest-note">Guest sessions don't carry rankings or history.</p>
    </div>
  </main>

{:else}
  <!-- ── Lobby ─────────────────────────────────────────────────────────── -->
  {@const currentPlayer = $me ?? ($guestSession ? { _id: $guestSession.playerId, displayName: $guestSession.displayName } : null)}
  <div class="lobby">

    <!-- Sidebar: who's online + user controls -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>The Queen's Hand</h2>
        {#if currentPlayer}
          <div class="me">
            {#if $guestSession}
              <span class="display-name">{currentPlayer.displayName}</span>
              <span class="guest-badge">guest</span>
            {:else if editingName}
              <input
                class="input input-sm"
                bind:value={newName}
                onkeydown={(e) => e.key === "Enter" && saveName()}
              />
              <button class="btn-link" onclick={saveName}>save</button>
            {:else}
              <span class="display-name">{currentPlayer.displayName}</span>
              <button class="btn-link" onclick={startEditName}>edit</button>
            {/if}
          </div>
        {/if}
        <button class="btn btn-sm" onclick={signOut}>Sign out</button>
      </div>

      <h3>Online now</h3>
      <ul class="player-list">
        {#if $onlinePlayers && $onlinePlayers.length > 0}
          {#each $onlinePlayers as p (p._id)}
            <li class:is-me={p._id === currentPlayer?._id}>
              {p.displayName}
              {#if p._id === currentPlayer?._id}<span class="you-tag">(you)</span>{/if}
            </li>
          {/each}
        {:else}
          <li class="empty">No one else is here yet.</li>
        {/if}
      </ul>
    </aside>

    <!-- Main: lobby chat -->
    <main class="chat-pane">
      <h3>Lobby</h3>

      <div class="messages" bind:this={chatEl}>
        {#if $messages && $messages.length > 0}
          {#each $messages as msg (msg._id)}
            <div class="message" class:own={msg.displayName === currentPlayer?.displayName}>
              <span class="msg-name">{msg.displayName}</span>
              <span class="msg-text">{msg.text}</span>
            </div>
          {/each}
        {:else}
          <p class="empty">No messages yet. Say hi!</p>
        {/if}
      </div>

      <form class="chat-form" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
        <input
          class="input"
          placeholder="Say something…"
          bind:value={chatText}
          onkeydown={onKeydown}
        />
        <button type="submit" class="btn btn-primary">Send</button>
      </form>
    </main>
  </div>
{/if}

<style>
  /* ── Login ──────────────────────────────────────────────────────────────── */
  .login-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }

  .login-card {
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 12px;
    padding: 2.5rem 2rem;
    width: 100%;
    max-width: 380px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .login-card h1 {
    font-size: 1.6rem;
    color: #e94560;
    text-align: center;
  }

  .tagline {
    text-align: center;
    color: #888;
    font-size: 0.9rem;
  }

  .error {
    color: #e94560;
    font-size: 0.85rem;
  }

  .email-sent {
    font-size: 0.9rem;
    color: #aaa;
    text-align: center;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: #555;
    font-size: 0.8rem;
  }

  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: #333;
  }

  /* ── Lobby layout ───────────────────────────────────────────────────────── */
  .lobby {
    display: grid;
    grid-template-columns: 220px 1fr;
    height: 100vh;
  }

  .sidebar {
    background: #16213e;
    border-right: 1px solid #0f3460;
    padding: 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
  }

  .sidebar-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sidebar-header h2 {
    font-size: 1rem;
    color: #e94560;
  }

  .me {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .display-name {
    font-weight: 600;
  }

  .sidebar h3 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
  }

  .player-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .player-list li {
    font-size: 0.9rem;
    padding: 0.25rem 0;
    color: #ccc;
  }

  .player-list li.is-me {
    color: #e94560;
  }

  .you-tag {
    font-size: 0.75rem;
    color: #666;
    margin-left: 0.25rem;
  }

  /* ── Chat pane ──────────────────────────────────────────────────────────── */
  .chat-pane {
    display: flex;
    flex-direction: column;
    padding: 1.25rem;
    gap: 1rem;
    overflow: hidden;
  }

  .chat-pane h3 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }

  .message {
    display: flex;
    gap: 0.5rem;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .message.own .msg-name {
    color: #e94560;
  }

  .msg-name {
    font-weight: 600;
    color: #888;
    white-space: nowrap;
    min-width: fit-content;
  }

  .msg-text {
    color: #ddd;
    word-break: break-word;
  }

  .chat-form {
    display: flex;
    gap: 0.5rem;
  }

  .chat-form .input {
    flex: 1;
  }

  /* ── Shared components ──────────────────────────────────────────────────── */
  :global(.input) {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    width: 100%;
    outline: none;
  }

  :global(.input:focus) {
    border-color: #e94560;
  }

  :global(.input-sm) {
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
  }

  :global(.btn) {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
    white-space: nowrap;
  }

  :global(.btn:hover) {
    background: #1a4a80;
  }

  :global(.btn-primary) {
    background: #e94560;
    border-color: #e94560;
    color: #fff;
    width: 100%;
    margin-top: 0.4rem;
  }

  :global(.btn-primary:hover) {
    background: #c73652;
  }

  :global(.btn-google) {
    background: #fff;
    border-color: #ddd;
    color: #333;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.6rem 1rem;
  }

  :global(.btn-google:hover) {
    background: #f5f5f5;
  }

  :global(.btn-guest) {
    background: #2a2a3e;
    border-color: #444;
    color: #ccc;
    width: 100%;
    margin-top: 0.4rem;
  }

  :global(.btn-guest:hover) {
    background: #333350;
  }

  .guest-note {
    font-size: 0.78rem;
    color: #555;
    text-align: center;
    margin-top: -0.25rem;
  }

  .guest-badge {
    font-size: 0.7rem;
    background: #333;
    color: #888;
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    margin-left: 0.25rem;
  }

  :global(.btn-sm) {
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
  }

  :global(.btn-link) {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 0.8rem;
    text-decoration: underline;
    padding: 0;
  }

  :global(.btn-link:hover) {
    color: #ccc;
  }

  .empty {
    color: #555;
    font-size: 0.85rem;
    font-style: italic;
  }
</style>
