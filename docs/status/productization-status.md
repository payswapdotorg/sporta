# Sporta Productization Status

Status as of 2026-09-15 ~22:30 UTC: **IN PRODUCTIZATION — WAVE 2**.

## Current truth

Core W001-W806: complete (50/50).

Productization:

| Item | State | Evidence |
|---|---|---|
| W901 capability contract | COMPLETE | merge 33ad82b; @sporta/capability (105 tests) — TL contract-freeze sign-off recorded |
| W902 identity + multi-role auth | COMPLETE | merge 33ad82b; @sporta/identity (89 tests, real HTTP round-trips, no-existence-oracle control gate) |
| W903 web product shell | COMPLETE | merge 701d2f5; apps/web Next.js 16 shell (48 tests, build+HTTP verified, PWA code-verified) |
| W914 compute adapter | Wave-1 COMPLETE (audit + provider-neutral contract); hosted implementation IN_FLIGHT | @sporta/compute-adapter (130 tests) + seam audit; G1/G2 TL decisions recorded |
| W904-W908, W909-W913, W915-W920 | Wave 2+ | dispatching |

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
