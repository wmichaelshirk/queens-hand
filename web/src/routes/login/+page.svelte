<script lang="ts">
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { isLoggedIn, signIn, signInAsGuest } from "$lib/convex";

  let email = $state("");
  let emailSent = $state(false);
  let authError = $state("");

  let guestName = $state("");
  let guestError = $state("");

  // Redirect if already logged in
  $effect(() => {
    if (browser && $isLoggedIn) goto("/");
  });

  async function loginWithGoogle() {
    authError = "";
    await signIn("google");
  }

  async function loginWithEmail() {
    authError = "";
    if (!email.trim()) return;
    const ok = await signIn("resend", { email: email.trim() });
    if (!ok) emailSent = true;
  }

  async function loginAsGuest() {
    guestError = "";
    if (!guestName.trim()) { guestError = "Enter a name to continue."; return; }
    try {
      await signInAsGuest(guestName.trim());
    } catch (e: any) {
      guestError = e?.message ?? "Something went wrong.";
    }
  }
</script>

<main>
  <div class="card">
    <h1>The Queen's Hand</h1>
    <p class="tagline">Card games with friends</p>

    {#if authError}
      <p class="error">{authError}</p>
    {/if}

    <button class="btn google" onclick={loginWithGoogle}>
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
        <input type="email" placeholder="your@email.com" bind:value={email} required class="input" />
        <button type="submit" class="btn primary">Send sign-in link</button>
      </form>
    {/if}

    <div class="divider"><span>or</span></div>

    <form onsubmit={(e) => { e.preventDefault(); loginAsGuest(); }}>
      {#if guestError}
        <p class="error">{guestError}</p>
      {/if}
      <input type="text" placeholder="Choose a name…" bind:value={guestName} maxlength="32" class="input" />
      <button type="submit" class="btn guest">Play as Guest</button>
    </form>
    <p class="guest-note">Guest sessions don't carry rankings or history.</p>
  </div>
</main>

<style>
  main {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }

  .card {
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

  h1 {
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

  .input {
    background: #0f3460;
    border: 1px solid #1a4a80;
    border-radius: 6px;
    color: #e0e0e0;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    width: 100%;
    outline: none;
    box-sizing: border-box;
  }

  .input:focus {
    border-color: #e94560;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.55rem 1rem;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    white-space: nowrap;
    box-sizing: border-box;
  }

  .btn.google {
    background: #fff;
    border: 1px solid #ddd;
    color: #333;
  }

  .btn.google:hover {
    background: #f5f5f5;
  }

  .btn.primary {
    background: #e94560;
    border: 1px solid #e94560;
    color: #fff;
    margin-top: 0.4rem;
  }

  .btn.primary:hover {
    background: #c73652;
  }

  .btn.guest {
    background: #2a2a3e;
    border: 1px solid #444;
    color: #ccc;
    margin-top: 0.4rem;
  }

  .btn.guest:hover {
    background: #333350;
  }

  .guest-note {
    font-size: 0.78rem;
    color: #555;
    text-align: center;
    margin-top: -0.25rem;
  }

  form {
    display: flex;
    flex-direction: column;
  }
</style>
