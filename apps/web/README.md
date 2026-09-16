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

W904/W905 made Home, Live, Explore, Library, Watch and the sign-in surface
REAL (capability + catalog driven — see below). What remains deferred says so
honestly (`src/lib/deferred-surfaces.ts`): the Create Studio flow (W906),
Search and Following (W916 — they need the real catalog/content model), and
the home "things you can create" section (W906). No fake data, no simulated
live badges, no mock auth — anywhere.

| Deferred | Arrives with |
| --- | --- |
| Create Studio (upload → recipe → render → publish) | W906 |
| Search results, Following feed | W916 (the real catalog/content model) |
| Anything labelled "live" | W915 (real network transport only — see Simulation F) |
| Hosted persistence (Neon/R2/Upstash backing) | W910–W914 |
| Real install verification on device | requires the HTTPS host from W910 (PWA install requires a secure context) |

## The data plane (W904/W905)

- **API routes** (`src/app/api/`): `/api/capability` (the frozen W901 seam),
  `/api/auth/*` (register/login/logout/me/switch-role), `/api/catalog/*`
  (sessions, library), `/api/watch/*` (watch model, playback-gated stored
  outputs). Thin transports over the server composition root — typed errors
  → statuses, `no-store`, fail-closed.
- **Server composition root** (`src/server/`): constructs the REAL in-process
  services (real control app over the real renderer registry and the real
  W504 output pipeline; real identity stores; the real capability
  composition). Everything is honestly labeled dev backing — in-process,
  restart-wiped. Worker B's hosted providers (Neon/R2/Upstash) replace them
  through exactly this seam.
- **Dev seed** (`src/server/dev-seed.ts`): drives the REAL engine — checked-in
  fixture stories through the real M1→M3 chain, sessions created through the
  real identity gate, renders through the real control plane, outputs stored
  through the real pipeline. Three sessions: an authorized watchable match, a
  "requires render" match, and a REAL rights-denied match (its card reveals
  nothing about its renders). Nothing is fabricated; the seed account's
  password is drawn from real entropy and discarded.
- **Client surfaces** consume fetch/JSON only (`src/lib/client-api.ts`) and
  derive their UX state (`loading | ready | processing | degraded | denied |
  unavailable | failed`) from the real responses (`src/lib/surface-state.ts`)
  — the W901 fixtures pin every deny/degraded path in
  `test/surface-state.test.ts`.

### Running the server (Bun runtime required)

The composition root's graph reaches Bun-native packages (`bun:sqlite` via
`@sporta/session` and `@sporta/output-pipeline`), so the SERVER must run
under Bun: `bun --bun run dev` / `bun --bun run start`. Plain `next start`
would execute under Node (the bin's shebang) and fail to load `bun:sqlite`.
Route handlers keep the heavy graph out of module scope (`src/server/runtime.ts`)
so `bun run build` stays green under Next's Node build workers.

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

- **Client components never import `@sporta/*`** — they consume fetch/JSON
  from this app's own `/api` routes (the TL's Wave-2 frontend boundary).
- **The server composition root DOES** — `src/server/` composes the frozen
  `@sporta/*` packages (server-only; declared `serverExternalPackages` in
  `next.config.ts`).
- `packages/viewer-shell` remains the headless viewer/control-state package;
  this app is the product UI seam, not a replacement for it.
