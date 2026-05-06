# Deployment guide

## Prerequisites

- Node 20 (`nvm use 20`)
- A [Convex](https://convex.dev) account (free, no credit card)
- A [Resend](https://resend.com) account for magic-link emails (free tier: 100 emails/day)
- A Google Cloud project for OAuth (free)
- A [Vercel](https://vercel.com) account for the web frontend (free, log in with GitHub)
- `gh` CLI for GitHub: `brew install gh && gh auth login`

---

## 1 — Push to GitHub

```bash
brew install gh      # if not installed
gh auth login
cd /Users/mshirk/Documents/ai/queens-hand
gh repo create queens-hand --public --source . --remote origin --push
```

---

## 2 — Deploy Convex backend

```bash
cd /Users/mshirk/Documents/ai/queens-hand
nvm use 20
npx convex dev       # opens browser to log in; creates project; writes .env.local
```

After first run, `npx convex dev` writes a `.env.local` with `CONVEX_DEPLOYMENT`
and keeps your schema + functions in sync while you develop.

To deploy to production:
```bash
npx convex deploy
```

### Set Convex environment variables

In the Convex dashboard (dashboard.convex.dev → your project → Settings → Environment Variables):

| Key | Value |
|-----|-------|
| `AUTH_GOOGLE_ID` | From Google Cloud Console OAuth credentials |
| `AUTH_GOOGLE_SECRET` | From Google Cloud Console OAuth credentials |
| `AUTH_RESEND_KEY` | From resend.com → API Keys |
| `SITE_URL` | Your Vercel URL (e.g. `https://queens-hand.vercel.app`) |

---

## 3 — Set up Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. APIs & Services → Credentials → Create OAuth 2.0 Client ID
   - Application type: **Web application**
   - Authorised redirect URI: `https://<your-deployment>.convex.site/api/auth/callback/google`
   - (Find `<your-deployment>` in Convex dashboard → your project → Deployment URL)
4. Copy Client ID and Client Secret into Convex env vars above

---

## 4 — Set up Resend (magic-link email)

1. Sign up at [resend.com](https://resend.com)
2. Create an API key with send permissions
3. Add it as `AUTH_RESEND_KEY` in Convex env vars
4. Optionally add a custom sending domain (resend.com guides you through DNS setup)

---

## 5 — Deploy web frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project**
2. Import the `queens-hand` GitHub repo
3. Set **Root Directory** to `web`
4. Vercel auto-detects SvelteKit — no build settings to change
5. Under **Environment Variables**, add:
   - `PUBLIC_CONVEX_URL` = your production Convex URL (e.g. `https://fast-albatross-205.convex.cloud`)
6. Click **Deploy**

Vercel auto-deploys on every push to `main`.

---

## Local development

```bash
# Terminal 1 — Convex dev server (watches convex/ directory)
nvm use 20
npx convex dev

# Terminal 2 — SvelteKit dev server
cd web
cp .env.example .env.local
# Edit .env.local: set PUBLIC_CONVEX_URL to the URL printed by `convex dev`
npm run dev
```

Open http://localhost:5173
