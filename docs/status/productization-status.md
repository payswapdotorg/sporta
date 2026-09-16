# Sporta Productization Status

Status as of 2026-09-16 ~01:55 UTC: **IN PRODUCTIZATION — WAVE 3** (Wave 2 complete).

## Current truth

Core W001-W806: complete (50/50).

Productization:

| Item | State | Evidence |
|---|---|---|
| W901 capability contract | COMPLETE | merge 33ad82b; @sporta/capability (105 tests) — TL contract-freeze sign-off recorded |
| W902 identity + multi-role auth | COMPLETE | merge 33ad82b; @sporta/identity (89 tests, real HTTP round-trips, no-existence-oracle control gate) |
| W903 web product shell | COMPLETE | merge 701d2f5; apps/web Next.js 16 shell (48 tests, build+HTTP verified, PWA code-verified) |
| W905 watch + Reality Switcher | COMPLETE | merge 8ce7f68 wave — real SVG frame player, session-constant switcher, rights-denied-before-existence |
| W911 Neon persistence | COMPLETE | Neon project sporta-beta (aws-us-east-1, PG17) live; register→redeploy→login proven on the public URL; health identity=neon/ok |
| W912-W913 R2/Upstash | NEXT (Wave 3, Worker B) | R2 bucket + presigned delivery; Upstash queue/quota layer |
| W914 compute adapter | COMPLETE | createRenderAsync + @sporta/compute-adapter-hosted + /api/compute; real-HTTP dispatch→artifact round-trip evidence |
| W906-W908 Create/roles/states | NEXT (Wave 3, Worker A) | W906 Create Studio first |
| W915 real-network live | Wave 3 (Worker C prep) | needs W912/W913 for hosted path |
| W909 browser E2E | Wave 4 | after W906-W908 |
| W907-W908, W909, W915-W920 | Wave 3+ | per dependency graph |

## The three questions

| Question | Current answer | Required gate |
|---|---|---|
| Can a fresh user install and use Sporta? | NO — no public hosted deployment yet (W910 in flight) | G9/G12/G14 |
| Is Sporta deployed on the target low-cost stack? | NO — credentials provisioned, deployment architecture frozen, first deploy pending | G11/G12 |
| Does Sporta have a YouTube-like interface? | PARTIAL — apps/web shell exists with honest data-free surfaces; data-driven surfaces are W904-W905 | G9/G10 |

## TL architecture decisions (Wave 2 dispatch)

1. `apps/web` API layer = Next.js route handlers (thin transport) over a server-side composition root constructing services from `@sporta/capability`, `@sporta/identity`, `@sporta/control-api` (+ `@sporta/compute-adapter` client types). SERVER-ONLY imports; client components consume JSON. SWM internals remain forbidden imports.
2. API namespace (frozen): `/api/capability` (A), `/api/auth/*` (A), `/api/catalog/*` (A), `/api/watch/*` (A), `/api/compute/*` (C), server composition root `src/server/` (A creates, B extends for env-driven providers).
3. Data honesty at W904/W905: surfaces render ONLY real capability responses + real control-plane session/render state. A dev-seed may drive the REAL engine (real fixtures through the REAL control-api createSession/createRender — real renders, real outputs), clearly labeled dev-seed; no fabricated content anywhere.
4. Hosting: Vercel Hobby initial web host (documented non-commercial boundary); Cloudflare R2 artifacts; Neon control-plane state; Upstash transient state; compute adapter provider selected by configuration (G2 approved: additive createRenderAsync).
