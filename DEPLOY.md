# Deploying the Center web app to Vercel

A static Vite build — no server side, no serverless functions. Vercel builds it
and serves `dist/`.

## Project settings

Vercel reads `vercel.json`, so the defaults it detects are already correct:

| | |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` (type-checks first, then builds) |
| Output directory | `dist` |
| Install command | `npm install` (npm workspaces: `packages/*` resolve from the root) |
| Node version | 20 or newer |

`vercel.json` also rewrites unmatched paths to `index.html`. Without it a hard
refresh on `/students` returns 404, because that route only exists inside the
running app. Real files are still served first, so assets are unaffected.

## Environment variables

Only one, and it is **not secret** — Vite inlines every `VITE_*` value into the
JavaScript it ships, so anything put here is readable by anyone who opens the
site. API keys belong on the backend.

| Variable | Value | Scope |
| --- | --- | --- |
| `VITE_API_URL` | the backend ORIGIN, e.g. `https://center-api.fly.dev` — no trailing slash, no `/api` | Production, Preview |

The app appends `/api` itself. Leave the variable **unset** only if the API is
served from this same origin (local development, the desktop shell, or a Vercel
rewrite — see below).

It is read at **build** time. Changing it in the Vercel dashboard does nothing
until the project is redeployed.

## Two ways to reach the backend

**Direct (default).** The browser calls the backend host itself. The backend
must list this site in `CORS_ALLOWED_ORIGINS`:

```
CORS_ALLOWED_ORIGINS=https://center.vercel.app
```

Include preview deployments only if they are actually used — the pattern
`https://*-yourteam.vercel.app` is supported.

**Proxied.** Leave `VITE_API_URL` unset and let Vercel forward `/api` instead.
No CORS at all, but every request takes an extra hop through Vercel's network
and is subject to its proxy body-size and timeout limits — which matters for
photo uploads and large offline-sync pushes. Add to `vercel.json`, **above** the
existing SPA rewrite:

```json
{ "source": "/api/:path*", "destination": "https://center-api.fly.dev/api/:path*" }
```

## After deploying

1. Add the deployment URL to the backend's `CORS_ALLOWED_ORIGINS` and redeploy
   the backend.
2. Set the backend's `GOOGLE_REDIRECT_URI` to this site's URL (with the trailing
   slash, e.g. `https://center.vercel.app/`) and add the same URL to the Google
   Cloud Console OAuth client's authorised redirect URIs. Google matches it
   exactly — a missing slash is a failed sign-in.
3. Log in, then confirm the sidebar shows a recent sync time. If it reports a
   network error, the origin is missing from `CORS_ALLOWED_ORIGINS`; the browser
   console says so explicitly.
