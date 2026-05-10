/**
 * Convex client + auth for SvelteKit.
 *
 * @convex-dev/auth only ships React/Next.js bindings, so we implement the
 * same token-management protocol here using plain Svelte stores and the
 * ConvexClient from "convex/browser".
 *
 * Auth protocol (same as the React package):
 *   1. signIn("google")  → Convex returns a redirect URL; we navigate there.
 *   2. OAuth provider → Convex callback → our app receives ?code=...
 *   3. handleCallback()  → exchanges code for tokens via auth:signIn action.
 *   4. signIn("resend", { email }) → sends magic-link email.
 *   5. User clicks link → same code flow as step 2-3.
 *   6. Tokens stored in localStorage; access token passed to ConvexClient.setAuth.
 */

import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { writable, derived, get } from "svelte/store";
import { PUBLIC_CONVEX_URL } from "$env/static/public";

// ── Token storage keys ────────────────────────────────────────────────────────

const ACCESS_KEY = "qh_access_token";
const REFRESH_KEY = "qh_refresh_token";
const VERIFIER_KEY = "qh_auth_verifier";
const GUEST_KEY = "qh_guest_session";

// ── Auth state stores ─────────────────────────────────────────────────────────

const _accessToken = writable<string | null>(
  typeof window !== "undefined" ? localStorage.getItem(ACCESS_KEY) : null
);

export const isAuthenticated = derived(_accessToken, (t) => t !== null);

// Set to true only once Convex confirms the token is valid on the server side.
// This is the right signal to use for calling ensurePlayer.
export const convexAuthenticated = writable(false);

// ── Guest session ─────────────────────────────────────────────────────────────

export type GuestSession = { playerId: string; userId: string; displayName: string };

function loadGuest(): GuestSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const guestSession = writable<GuestSession | null>(loadGuest());

guestSession.subscribe((s) => {
  if (typeof window === "undefined") return;
  if (s) localStorage.setItem(GUEST_KEY, JSON.stringify(s));
  else localStorage.removeItem(GUEST_KEY);
});

export const isLoggedIn = derived(
  [isAuthenticated, guestSession],
  ([auth, guest]) => auth || guest !== null
);

// True while a magic-link code is being exchanged — auth guard must not redirect during this window.
export const authResolving = writable(false);

// ── Convex client ─────────────────────────────────────────────────────────────

export const convex = new ConvexClient(PUBLIC_CONVEX_URL);

// Wire the token into the Convex client.
//
// Calling setAuth(async () => null) on an already-unauthenticated client causes
// Convex to call tryRestartSocket() internally, which drops any in-flight action
// (like the auth:signIn code-exchange action). Skip the first notification if the
// initial value is null — the client is already unauthenticated by default.
let _authWired = false;

_accessToken.subscribe((token) => {
  if (!_authWired && token === null) {
    // Initial unauthenticated state — Convex client already starts unauthenticated.
    // Calling setAuth here would restart the socket and kill in-flight actions.
    _authWired = true;
    convexAuthenticated.set(false);
    return;
  }
  _authWired = true;

  if (token === null) {
    // Token was cleared after being set (sign-out or server rejection).
    // Clear auth on the Convex client with a no-op callback.
    convexAuthenticated.set(false);
    convex.setAuth(async () => null, () => {});
    return;
  }

  convex.setAuth(async () => token, (serverConfirmed) => {
    convexAuthenticated.set(serverConfirmed);
    if (!serverConfirmed && get(_accessToken) === token) {
      _accessToken.set(null);
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function storeTokens(tokens: { token: string; refreshToken: string } | null) {
  if (tokens) {
    localStorage.setItem(ACCESS_KEY, tokens.token);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    _accessToken.set(tokens.token);
  } else {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    _accessToken.set(null);
  }
}

// ── Auth actions ──────────────────────────────────────────────────────────────

/**
 * Initiate sign-in with a provider.
 *   - "google": redirects to Google OAuth.
 *   - "resend": sends a magic-link email; params must include { email }.
 *
 * Returns true if sign-in completed in-place (magic link OTP path),
 * false if a redirect was issued (OAuth path).
 */
export async function signIn(
  provider: "google" | "resend",
  params: Record<string, string> = {}
): Promise<boolean> {
  const verifier = localStorage.getItem(VERIFIER_KEY) ?? undefined;
  localStorage.removeItem(VERIFIER_KEY);

  // Call the Convex auth:signIn action unauthenticated (no token yet)
  const result: any = await convex.action("auth:signIn" as any, {
    provider,
    params,
    verifier,
  });

  if (result?.redirect !== undefined) {
    if (result.verifier) localStorage.setItem(VERIFIER_KEY, result.verifier);
    window.location.href = result.redirect;
    return false;
  }

  if (result?.tokens !== undefined) {
    storeTokens(result.tokens);
    return result.tokens !== null;
  }

  return false;
}

/**
 * Exchange the ?code= query param from an OAuth / magic-link callback.
 * Call this once on page load from +layout.svelte.
 */
export async function handleCallback(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;

  const verifier = localStorage.getItem(VERIFIER_KEY) ?? undefined;
  localStorage.removeItem(VERIFIER_KEY);

  // Use an HTTP client for this unauthenticated one-shot call.
  // The WebSocket client (convex) restarts its socket during the initial auth
  // handshake, which drops any in-flight WebSocket actions.
  const http = new ConvexHttpClient(PUBLIC_CONVEX_URL);
  try {
    const result: any = await http.action("auth:signIn" as any, {
      provider: undefined,
      params: { code },
      verifier,
    });

    if (result?.tokens) {
      storeTokens(result.tokens);
      return null;
    } else {
      return "Sign-in link was already used or has expired. Request a new one.";
    }
  } catch (e: any) {
    return e?.message ?? "Sign-in failed. Please try again.";
  }
}

export async function signInAsGuest(displayName: string): Promise<void> {
  const session: GuestSession = await convex.mutation("guest:createGuest" as any, { displayName });
  guestSession.set(session);
}

export async function signOut(): Promise<void> {
  const guest = get(guestSession);
  if (guest) {
    await convex.mutation("lobby:leave" as any, { guestUserId: guest.userId }).catch(() => {});
    guestSession.set(null);
    return;
  }
  await convex.mutation("lobby:leave" as any, {}).catch(() => {});
  try {
    await convex.action("auth:signOut" as any, {});
  } catch {
    // Already signed out is fine
  }
  storeTokens(null);
}

// ── Reactive query helper ─────────────────────────────────────────────────────

/**
 * Creates a Svelte readable store that tracks a Convex query reactively.
 * Usage:
 *   const messages = watchQuery(api.lobby.getMessages, {});
 */
export function watchQuery<T>(
  query: any,
  args: Record<string, unknown> = {}
): { subscribe: (fn: (v: T | undefined) => void) => () => void } {
  const store = writable<T | undefined>(undefined);
  let unsub: (() => void) | undefined;

  function subscribe(fn: (v: T | undefined) => void) {
    unsub = convex.onUpdate(query, args, (value: T) => store.set(value));
    return store.subscribe(fn);
  }

  return { subscribe };
}
