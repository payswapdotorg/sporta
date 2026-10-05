# R306 hosted re-flight — incarnation 4 (the quota-window checkpoint, the LIVE-ARMED state)

Flight 7 of the R306 arc, session 1: the operator re-armed the flight with a
LIVE vercel lane (the fresh `vcp_…` token — the packet's prior token was
typed-dead in incarnation 3) + a fresh E2B key. The chain rode to the deploy
leg and measured the account quota STILL exhausted — the honest checkpoint
this directory records. Incarnation 5 (the sibling) rides the same chain
through the quota window.

## What this session measured (first-hand, typed, never fabricated)

1. **The token lane LIVE** — `GET /v2/user` → 200 (login `ekonplacide-5312`,
   the flight account); `GET /v9/projects/sporta` → 200 (the project + its
   14 env vars readable); the decrypted posture re-read: `MEDIA_TOOLCHAIN=http`
   + `COMPUTE_PROVIDER=http` (the 65-j PATCHes, re-verified live — the exact
   precondition that fail-closed incarnation 3).
2. **The fresh sandbox `id0g6thukn787yjakgt19`** — the pair-provisioning
   shape at the pinned flight-6 record merge `312d2cb` (the ADD-only landing
   whose whole delta is scripts/-evidence-only: the worker code is
   byte-identical to the flight-5 ingest-seam merge's): ffmpeg 5.1.9-0+deb12u1,
   bun 1.4.2, 167 packages, BOTH workers up (media `:3971` health+descriptor
   200, the FIVE operations; compute `:3973` health+descriptor 200, the five
   renderers); keep-alive 2h (re-extended by the boot-compute leg). Records:
   `sandbox-record.json`, `compute-worker-record.json`.
3. **The three PATCHes FIRED 200 + re-read-verified** — `MEDIA_TOOLCHAIN_URL`
   → `https://3971-id0g6thukn787yjakgt19.e2b.app`, `COMPUTE_WORKER_URL` →
   `https://3973-id0g6thukn787yjakgt19.e2b.app`, `SPORTA_DEPLOY_MARKER` →
   `r306-hosted-reflight-1`: **the production env is LIVE-ARMED** with a fresh
   sandbox + the flight's marker (the first PATCHes this flight family has
   landed — incarnation 3 fired ZERO).
4. **The deploy leg REFUSED typed `api-deployments-free-perday`** — the CLI:
   `✗ Resource is limited - try again in 24 hours (more than 100, code:
   "api-deployments-free-per-day")` (verbatim in `deploy-record.json`
   §deploy.refusal.verbatimOutputTail); the account's rolling-day quota STILL
   exhausted at 2026-10-05T13:52Z, the typed window reset standing at
   **2026-10-06T01:31Z**. THE WALK DID NOT RUN this session — the record
   says so.
5. **The pre-deploy production baseline** (the standing incident class):
   alias root 200 / health **500 (0B body)** — the 62-c class live.

## The drivers (this incarnation's honest deltas vs incarnation 3's)

`orchestrate-e2b.ts` + `boot-compute-worker.ts` — the same pair-provisioning
shape re-pinned to `312d2cb` (the flight-6 record merge; the worker code
byte-identical — the ADD-only delta is scripts/-only). `deploy.ts` — the CLI
lane re-pinned to `312d2cb` with the guard upgraded to the flight-branch
shape (origin/main === the flight-6 record merge; HEAD may be a flight
branch whose every changed path vs it is upload-invisible — the upload set
is the pinned tree's, byte-identical) + the record-write sandbox-state read
GUARDED (a missing boot-compute record falls back to the sandbox record —
the crash incarnation 3's copy never hit only because its refusal preceded
the record leg; this session's first refusal hit it and it is FIXED here).
`hosted-golden-path.ts` + `validate-evidence.ts` — byte-identical copies
(the walk logic + the outcome-robust validator, their record paths
self-relative).

## The window flight (incarnation 5, armed by this session)

The `§nextSessionChain` typed by the flight-6 record: at the quota window
provision fresh (or re-extend), re-PATCH the three env vars to the live
sandbox URLs + the flight's marker, deploy, verify both surfaces, THE WALK,
the validators. The window-flight daemon (operator-side,
`/home/z/my-project/scripts/r306-window-flight.sh`, double-fork detached)
drives the incarnation-5 drivers on this branch through the window: every
15 min the keep-alive re-extends + the deploy retries; on success the walk
+ validators + gates + the ADD-only landing (merge --no-ff → main → the PAT
lane → CI watch) fire automatically, fail-closed on every other outcome.

## The ephemerality doctrine (standing)

The sandbox `id0g6thukn787yjakgt19` is honestly left to die at its keep-alive
unless the window daemon re-extends it; the baked-URL death class + the
persistent-worker-host decision stand as the operator's asks.
