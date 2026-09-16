# Sporta Productization Status

Status as of 2026-09-16 ~09:30 UTC: **IN PRODUCTIZATION — WAVE 7** (W901-W909 + W910-W919 complete; W920 TL final gate remains).

## Current truth

Core W001-W806: complete (50/50).

Productization:

| Item | State | Evidence |
|---|---|---|
| W901 capability contract | COMPLETE | merge 33ad82b; @sporta/capability (105 tests) — TL contract-freeze sign-off recorded |
| W902 identity + multi-role auth | COMPLETE | merge 33ad82b; @sporta/identity (89 tests, real HTTP round-trips, no-existence-oracle control gate) |
| W903 web product shell | COMPLETE | merge 701d2f5; apps/web Next.js 16 shell (48 tests, build+HTTP verified, PWA code-verified) |
| W904 Home/Live/Explore/Library | COMPLETE | wave-2 merge — real capability/catalog-driven surfaces, ux-simulation executable gate over all 8 W901 fixtures |
| W905 watch + Reality Switcher | COMPLETE | merge 8ce7f68 wave — real SVG frame player, session-constant switcher, rights-denied-before-existence |
| W906 Create Studio | COMPLETE | merge aa6ef78 wave — guided flow over real seams end-to-end (options→rights preview→dispatch→progress→publish) |
| W907 role workspaces | COMPLETE | wave-5 merge — five workspaces one identity, grants-only switching (denial byte-identical pre/post switch) |
| W908 UX operational states | COMPLETE | merge 1693ed3 — Simulation A-G executable coverage, search wired to W916, honest auth-expired/provider-degraded states |
| W909 browser E2E | COMPLETE | merge e214fa6 — 8/8 real-browser flows green (run mu3velul, 111 assertions, 0 failed, 0 aborted, exit 0) |
| W910 Vercel deployment | COMPLETE | https://sporta-flame.vercel.app (Hobby, non-commercial boundary documented; reproducible from repo + token) |
| W911 Neon persistence | COMPLETE | Neon project sporta-beta (aws-us-east-1, PG17) live; register→redeploy→login proven on the public URL; health identity=neon/ok |
| W912 R2 artifacts | COMPLETE | bucket sporta-beta-artifacts live; playback serves R2 round-tripped bytes (hash-verified, source-header, redeploy-stable) |
| W913 Upstash transient | COMPLETE | Upstash port + guards (token DB-scoped/unprovisionable from this sandbox — honest port+fallback boundary documented) |
| W914 compute adapter | COMPLETE | createRenderAsync + @sporta/compute-adapter-hosted + /api/compute; real-HTTP dispatch→artifact round-trip evidence |
| W915 real-network live | COMPLETE | SSE transport over real HTTP — auth-before-bytes, measured end-to-end latency, capability honest in all 3 states |
| W916 catalog/content model | COMPLETE | merge d938d13 — reality groups + search + 4-kind visibility (46 tests) |
| W917 rights/publication center | COMPLETE | wave-5 merge (39 tests) |
| W918 operational console | COMPLETE | merge 9a004bf — operator-gated /api/operations panels, safe-only remediations (15 tests) |
| W919 cost/usage guardrails | COMPLETE | merge b6b2af4 — limit ledger + spend alarms → capability degraded + fail-closed admission (503 + retry-after), playback unaffected proven |
| W920 public beta release | NEXT (TL) | final redeploy + golden-path verification from the public URL |

## The three questions

| Question | Current answer | Required gate |
|---|---|---|
| Can a fresh user install and use Sporta? | PARTIAL — the deployed URL serves sign-up/watch/create/roles end-to-end; W909 proves the golden paths in a real browser; final public-URL verification is W920 | G9/G12/G14 |
| Is Sporta deployed on the target low-cost stack? | YES — Vercel (web) + Neon (control plane) + R2 (artifacts) + Upstash (port, honest fallback) live; compute in-process per configuration | G11/G12 |
| Does Sporta have a YouTube-like interface? | YES — nine surfaces live: Home/Live/Explore/Search/Library/Following/Create/Watch/role workspaces, capability-driven, honest states throughout | G9/G10 |

## TL architecture decisions (Wave 2 dispatch)

1. `apps/web` API layer = Next.js route handlers (thin transport) over a server-side composition root constructing services from `@sporta/capability`, `@sporta/identity`, `@sporta/control-api` (+ `@sporta/compute-adapter` client types). SERVER-ONLY imports; client components consume JSON. SWM internals remain forbidden imports.
2. API namespace (frozen): `/api/capability` (A), `/api/auth/*` (A), `/api/catalog/*` (A), `/api/watch/*` (A), `/api/compute/*` (C), server composition root `src/server/` (A creates, B extends for env-driven providers).
3. Data honesty at W904/W905: surfaces render ONLY real capability responses + real control-plane session/render state. A dev-seed may drive the REAL engine (real fixtures through the REAL control-api createSession/createRender — real renders, real outputs), clearly labeled dev-seed; no fabricated content anywhere.
4. Hosting: Vercel Hobby initial web host (documented non-commercial boundary); Cloudflare R2 artifacts; Neon control-plane state; Upstash transient state; compute adapter provider selected by configuration (G2 approved: additive createRenderAsync).
