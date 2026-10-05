# R306 hosted re-flight — incarnation 3 (the ADD-only continuation)

THE flight is the 4/4 closure measure for the artifact-ingest seam (flight 5,
`scripts/evidence/r306-artifact-ingest/` — the app-side ingest lands the
specific-miss + inline-delivery class locally; flight 4,
`scripts/evidence/r306-hosted-golden-path/`, measured the hosted honest split
1/4 + 3 typed ingest refusals verbatim). This directory is the THIRD
dispatched session's run, landed ADD-only on top of the two prior
incarnations' commits (`a4ebb65` the prep, `2cf1465` the quota-blocked
checkpoint — the pack root's records are THEIRS, never overwritten).

## What this session measured (first-hand, typed, never fabricated)

1. **The baseline gates** (green, at the packet's tip `5424a84e…`):
   `bunx eslint .` 0 errors · `bunx prettier --check .` clean ·
   `apps/web/test/artifact-ingest-seam.test.ts` **6/6, 90 expects** ·
   `apps/web/test/golden-path.test.ts` **14/14** (282 expects).
2. **The fresh sandbox** `i7wthxzje6u8lomv200hc` (the R607 §1
   pair-provisioning shape — `orchestrate-e2b.ts` here): ffmpeg 5.1.9-0+deb12u1
   (+libx264), bun 1.4.2, the repo cloned AT the pinned sha (fail-closed,
   exact), BOTH workers up — media `https://3971-i7wthxzje6u8lomv200hc.e2b.app`
   (health 200 + descriptor 200, the FIVE operations) + compute
   `https://3973-i7wthxzje6u8lomv200hc.e2b.app` (health 200 + descriptor 200,
   the five renderers); 2h keep-alive, re-extended by the boot-compute leg.
   Both worker-start RPC responses were lost to the SDK's deadline_exceeded
   (the measured class — the bounded health waits arbitrated, both 200).
   Records: `sandbox-record.json`, `compute-worker-record.json`.
3. **The deploy leg REFUSED fail-closed before any PATCH** — the packet's
   VERCEL_TOKEN is TYPED-DEAD (403 `{"error":{"code":"forbidden","message":
   "Not authorized","invalidToken":true}}` on `/v2/user`, `/v9/projects/sporta`,
   `/v9/projects/sporta/env`; the CLI: `The token provided via VERCEL_TOKEN
   environment variable is not valid`), so the driver's posture re-read
   returned undefined for every value and it refused — 0 PATCHes fired, 0
   deployments created. The pre-deploy production baseline was measured
   (alias root 200 / health **500 empty body** — the 62-c class LIVE; the env
   currently carries the PRIOR incarnation's marker `r306-ingest-seam-reflight-1`
   + its now-dead sandbox's URLs). Record: `deploy-record.direct-token.json`.
4. **THE WALK DID NOT RUN** — it requires the production deployment carrying
   this packet's marker `r306-hosted-reflight-1` with THIS session's live
   worker URLs baked; no PATCH/deploy was possible. **The 4/4 measure was NOT
   taken — this README says so.** (The walk driver fails closed at boot
   against any other plane; the current alias serves the superseded
   r306-deploy deployment.)

## The blockers (typed, on the record)

- **`vercel-token-dead`** — the packet's token is refused on every Vercel API
  surface (verbatim above). The prior incarnation measured the SAME class
  and worked around it with a Composio vercel lane (connection
  `ca_31iruA2qEdfl`) — a credential NOT in this packet.
- **`api-deployments-free-per-day`** — the LANDED checkpoint's record
  (the pack root's `deploy-record.json`) measured HTTP 402
  `{"limit":{"total":100,"remaining":0,"reset":1791253483018}}`: the
  account's rolling-day deployment quota is exhausted until
  **2026-10-06T01:31Z** — AFTER this flight's midnight-UTC deadline. Not
  re-measurable this session (the dead token cannot even read the project).
- **`composio-lane-credential-absent`** — see above.

## The honest deltas of this run's drivers (vs the originals they clone)

`orchestrate-e2b.ts` ← the R607 pair-provisioning shape pinned at
`5424a84e…`, expecting the FIVE operations, the compute descriptor verified
(the boot-time fetch), the base64 boot-log reads. `boot-compute-worker.ts`
and `deploy.ts` ← the r306-deploy legs re-pinned (deploy takes a REQUIRED
`--sandbox-id`, bakes no ephemeral default; marker `r306-hosted-reflight-1`).
`hosted-golden-path.ts` ← the flight-4 walk with required worker args (no
dead-sandbox defaults) and the re-flight marker; the walk logic is
byte-identical (auditable by diff). `validate-evidence.ts` ← the flight-4
validator with the re-flight marker and an OUTCOME-ROBUST verdict-count
check + negative battery (the flight-4 pair was written against its own 1/4+3
outcome; both shapes and every honest in-between must validate on their own
measured numbers).

## The next session's chain (at the quota window, with a live vercel lane)

See `deploy-record.direct-token.json` §nextSessionChain and the pack root's
README §THE TL LEGS (the prior incarnation's build-error diagnosis — the
workspace-deps layout failure of `dpl_8kLx…` — is the data-driven fix
input). The chain: provision (or re-extend a live sandbox) → the three
PATCHes to the live URLs + the flight's marker → deploy → verify both
surfaces → **THE WALK** → the validators.

## The ephemerality doctrine (standing)

The sandbox `i7wthxzje6u8lomv200hc` is honestly left to die at its keep-alive
timeout (the walk cannot consume it this session; both workers were healthy
at record-write, 2026-10-05T06:51:30Z). The baked-URL death class, the
persistent-worker-host operator decision, and the quota/plan decision all
stand as named operator asks — never improvised by a worker.
