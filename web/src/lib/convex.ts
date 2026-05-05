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

import { ConvexClient } from "convex/browser";
import { writable, derived, get } from "svelte/store";
import { PUBLIC_CONVEX_URL } from "$env/static/public";

// ── Token storage keys ────────────────────────────────────────────────────────

const ACCESS_KEY = "qh_access_token";
const REFRESH_KEY = "qh_refresh_token";
const VERIFIER_KEY = "qh_auth_verifier";

// ── Auth state stores ─────────────────────────────────────────────────────────

const _accessToken = writable<string | null>(
  typeof window !== "undefined" ? localStorage.getItem(ACCESS_KEY) : null
);

export const isAuthenticated = derived(_accessToken, (t) => t !== null);

// ── Convex client ─────────────────────────────────────────────────────────────

export const convex = new ConvexClient(PUBLIC_CONVEX_URL);

// Wire the token into the Convex client.
_accessToken.subscribe((token) => {
  convex.setAuth(async () => token, () => { _accessToken.set(null); });
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
export async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;

  const verifier = localStorage.getItem(VERIFIER_KEY) ?? undefined;
  localStorage.removeItem(VERIFIER_KEY);

  const result: any = await convex.action("auth:signIn" as any, {
    provider: undefined,
    params: { code },
    verifier,
  });

  if (result?.tokens) {
    storeTokens(result.tokens);
  }

  // Remove code from URL without reloading
  const clean = new URL(window.location.href);
  clean.searchParams.delete("code");
  window.history.replaceState({}, "", clean.toString());
}

export async function signOut(): Promise<void> {
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
