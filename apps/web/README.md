# Sporta Web Product Shell (`apps/web`)

The Sporta product frontend — an installable, PWA-capable Next.js 16 application
shell (work order **W903**). It delivers navigation, search, a responsive
layout, an accessibility baseline and PWA plumbing. It is deliberately
**data-free**: every surface that needs real product data says so honestly
instead of faking it.

## What exists today

- **Routes** (`src/app/`): `/` (Home), `/live`, `/explore`, `/search`,
  `/library`, `/following`, `/create`, `/watch`, `/auth/signin`, `/offline`
  and a `not-found` page. The route map is a single pure model
  (`src/lib/navigation.ts`) consumed by both navigations.
- **Navigation shell**: desktop sidebar + header, mobile bottom tab bar (with
  safe-area padding), site footer pinned to the bottom of the viewport, and a
  search seam (plain GET form to `/search` — the query is echoed, nothing is
  executed). The role/profile area is intentionally minimal: accounts do not
  exist yet, so it offers only the real action that exists — signing in.
- **Design system** (`src/app/globals.css`): the "night stadium" identity —
  dark ink canvas with a light-mode variant, pitch-green primary, hand-drawn
  SVG iconography, sporty corner-cut cards. No webfonts, no UI-library
  dependency, no third-party artwork.
- **Accessibility baseline**: skip-to-content link to a focusable `<main>`
  landmark, semantic landmarks (`header`/`nav`/`main`/`footer`), labelled
  search landmark, `aria-current` page highlighting, visible `:focus-visible`
  rings, `prefers-reduced-motion` support, AA-contrast text pairs, and no
  state conveyed by motion alone.
- **PWA**: `public/manifest.webmanifest` (name, short_name, 192/512 `any`
  icons + 512 `maskable` icon, `display: standalone`, theme/background colors),
  PNG icons generated deterministically by `scripts/generate-icons.ts` (pure
  TypeScript PNG encoder — no image tooling needed), and a hand-written
  app-shell service worker with a registrar component.
- **Tests** (`test/`): route-map integrity (model ↔ filesystem), navigation
  model, deferred-surface honesty, manifest validity, service-worker static
  checks and accessibility-wiring checks — all `bun:test`, no jsdom needed.

## What is intentionally deferred (and why)

This shell is the *Product* lane of Wave 1. The capability contract (W901,
parallel lane) did not exist when this was built, so **no capability shapes
are invented here** — no stub APIs, no fake match data, no simulated live
badges, no mock auth. Surfaces that need real data render an honest
"not available yet" placeholder (`src/lib/deferred-surfaces.ts`) that states
what will live there and which work order delivers it.

| Deferred | Arrives with |
| --- | --- |
| Catalog / listings / results (Home, Explore, Search, Library, Following) | W904, consuming the W901 capability contract |
| Watch page + Reality Switcher backed by real renderer capability | W905 |
| Create Studio (upload → recipe → render → publish) | W906 |
| Accounts, roles, real sign-in | W902 |
| Anything labelled "live" | W915 (real network transport only — see Simulation F) |
| Public hosting | W910 (Vercel Hobby is the intended first target) |
| Real install verification on device | requires the HTTPS host from W910 (PWA install requires a secure context) |

## What the service worker does — and does not — cache

`public/sw.js` is hand-written (no Workbox) and versioned
(`sporta-shell-w903-shell-v1`; bump `CACHE_VERSION` to invalidate old caches).

**It caches only the static app shell:**

- On install: `/offline` (the fallback page), `/manifest.webmanifest` and the
  two primary PWA icons — precached with `cache: "reload"` cache-busting.
- On fetch: same-origin `/_next/static/…` build assets, `/icons/*` and the
  manifest, cache-first.
- Page navigations are strictly network-first; if the network fails it serves
  the cached `/offline` page. **Successful page responses are never cached** —
  pages will become data-driven and must never go stale.

**It never caches:** non-GET requests, cross-origin requests, anything under
`/api/` (the future data plane) or `/_next/data/`, or any successful
navigation response. There is no catch-all fetch handler: unmatched requests
pass straight through to the network.

Known limitation: the offline fallback loads without its build-time CSS/JS
chunks (a hand-written SW cannot know the hashed asset names in advance);
those chunks are cached opportunistically after the first online load.

## Running locally

From the repository root (workspace installs), then:

```bash
cd apps/web
bun run dev        # development server (SW registration disabled in dev)
bun run build      # production build
bun run start      # serve the production build
bun run typecheck  # next typegen && tsc --noEmit
bun run icons      # regenerate public/icons/*.png deterministically
```

Tests run from the repository root:

```bash
bun test           # full monorepo suite, includes apps/web/test/*
```

## Boundaries

- This app does **not** import any `@sporta/*` engine package. It is a client
  of stable control/delivery contracts that arrive with the capability plane
  (W901) and data plane (W904+).
- `packages/viewer-shell` remains the headless viewer/control-state package;
  this app is the product UI seam, not a replacement for it.
