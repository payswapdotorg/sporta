# R306 HOSTED RE-FLIGHT — the 4/4 closure measure for the 68 artifact-ingest seam

THE flight the 68 REPORT named: the prior hosted walk
(`scripts/evidence/r306-hosted-golden-path/`) measured **3/4 realities refused
at the render-output ingest boundary** with the TYPED refusal
`encoding refused (artifact-invalid): no artifact "<sha>" is stored` — the
two-runtime split (the compute worker registers ITS OWN store, the app's is
empty, the bytes already delivered inline). Flight 68 closed that class at the
app-side ingest (`apps/web/src/server/derived-reality-media.ts`, merged as
origin/main @ `5424a84e`, CI #337 green — every existing fail-closed check
BEFORE any put, the store's own cross-verified registration, the read-back
under the returned artifactId; the battery 6/6, the validator 22/22 + 7/7
tampered refused — LOCAL-ONLY).

**THIS flight measures what MEASURED happens with the seam IN the deployment**:
fresh E2B sandbox (both workers, the pinned revision checked out in-sandbox) →
the production redeploy baking THIS flight's live worker URLs, marker
`r306-ingest-seam-reflight-1` → the golden-path walk re-flown against the
production alias. The honest expectation under test: the derived kinds'
artifacts LAND through the ingest seam's verify-then-register path
(**4/4 produced + integrity-verified**), or any honest typed refusal is
recorded verbatim — never fabricated, never forced. The local-only claim
lands only when the hosted plane measures it.

## The pinned revision

- `5424a84e089db3b96b5f489b3e11f2ed66a56dec` — origin/main, the artifact-ingest
  merge (the 68 flight's tip). EVERY driver here fails closed on any other
  HEAD: `provision-sandbox.ts` (the in-sandbox checkout), `boot-compute-worker.ts`
  (the re-measured clone HEAD), `deploy.ts` (HEAD === origin/main === DEPLOY_SHA,
  the tracked tree clean outside the `.vercelignore`d paths).
- The 68 seam's prior flight record: `scripts/evidence/r306-artifact-ingest/`
  (the local closure battery + validator). The prior hosted walk's record:
  `scripts/evidence/r306-hosted-golden-path/hosted-golden-path.json`.

## The procedure chain (the drivers, in order — see commands.md)

1. **`provision-sandbox.ts`** (adapted from
   `r306-live-wire/orchestrate-e2b.ts`): ONE fresh E2B sandbox, ffmpeg + bun,
   the repo cloned AT the pinned sha, the media-toolchain worker :3971 up +
  the five-operation descriptor verified from THIS machine; writes
  `sandbox-record.json`. Idempotent re-verification: `--sandbox-id <id>`
  (re-measures everything, extends the keep-alive).
2. **`boot-compute-worker.ts`** (adapted from `r306-deploy/`): the companion
   compute worker :3973 in the SAME sandbox (the `COMPUTE_PROVIDER=http`
   posture's fail-loud boot requirement); writes `compute-worker-record.json`.
   Reads the sandbox id from `--sandbox-id` or THIS dir's `sandbox-record.json`.
3. **`deploy.ts`** (adapted from `r306-deploy/deploy.ts`): the env re-point
   (PATCH MEDIA_TOOLCHAIN_URL / COMPUTE_WORKER_URL / SPORTA_DEPLOY_MARKER →
   `r306-ingest-seam-reflight-1`, every value re-read decrypted, fail-closed)
   + the production deployment baking THIS flight's live worker URLs + the
   fail-closed verification (the alias health + the marker). The sandbox id is
   DISCOVERED from THIS dir's provisioning records (or `--sandbox-id`); the
   worker URLs derive from it and are probed LIVE before any PATCH. Writes
   `deploy-record.json` (+ `deploy-files-manifest.json` on the API lane).
   `--reverify --deployment-id <id>` re-runs only the observation + record.
4. **`hosted-golden-path.ts`** (adapted from `r306-hosted-golden-path/`): THE
   WALK — register → login → upload-sessions (the J004 realities form) → the
   one-submission plan (the derived kinds' render jobs) → the catalog walk →
   THE FOUR REALITIES played back (each produced kind's byte route
   integrity-verified: sha, byte length, `ftyp`, ffprobe geometry; each
   refused kind's typed class verbatim) → the worker-side accounting. The
   expected marker family defaults to `r306-ingest-seam-reflight-1`; the
   worker URLs default to THIS dir's provisioning records (fail-closed when
   absent). Writes `hosted-golden-path.json`.
5. **`validate-evidence.ts`** (adapted from `r306-hosted-golden-path/`): the
   fail-closed validator over THIS dir's `hosted-golden-path.json` (resolved
   from the script's own location — the copy works in place); `--negative`
   flips one measured field per variant and asserts each is REFUSED
   (outcome-agnostic: the battery corrupts the record's OWN measured state,
   whatever the walk measured).

## TO BE MEASURED (filled only by the executed run — never pre-filled)

- The sandbox identity + lifetime (sandbox-record.json).
- The compute worker boot + both public descriptors (compute-worker-record.json).
- The env PATCH statuses + the deployment id/state + both-surface verification
  (deploy-record.json).
- **THE 4/4 MEASURE**: each derived kind's produced/refused state, the ingest
  seam's landing or the typed refusal verbatim, the integrity-verified
  playbacks, the worker-side accounting (hosted-golden-path.json).
- The validator's check-by-check verdict (12 checks + the negative battery).

## STATE FOUND AT PREP (honest, typed — recorded before the TL legs)

A prior 69-a1 incarnation died mid-flight WITHOUT committing. This prep found
its uncommitted drivers (adopted only after line-by-line re-verification
against the r306 originals; the pin/marker/record-path adaptations re-checked,
two guards added to deploy.ts) AND its uncommitted EXECUTION residue (the four
`*.json` records on disk here — the prep itself executes nothing):

- sandbox `iuspg21vqeg256a94osir` provisioned 2026-10-05T01:34Z (2 h keep-alive
  → dead ~03:34Z unless re-extended), pinned sha verified in-sandbox.
- the compute worker booted; both public URLs measured live.
- the three env PATCHes landed 200 + re-read (production CURRENTLY carries the
  marker `r306-ingest-seam-reflight-1` + THIS sandbox's worker URLs).
- the direct `VERCEL_TOKEN` measured TYPED-DEAD (403 `invalidToken` verbatim in
  the residue) — the driver's Composio vercel lane (connection
  `ca_31iruA2qEdfl`, proxy_execute) engaged: the deployment creation
  `dpl_8kLxtHfiEcsnuRxwHxwK5Mun6ToX` was ACCEPTED (missing-files retry round
  worked: 3 `.gitignore` files inlined) but the build ERRORED instantly
  (INITIALIZING→ERROR at ~16 s, NO cause captured by the residue).
- THE WALK NEVER RAN (no hosted-golden-path.json exists).

## THE TL LEGS, 2026-10-05 02:08–02:5xZ (the honest flight state — QUOTA-BLOCKED)

The TL raced the live window. Every outcome below is measured, typed verbatim,
never fabricated:

1. **THE BUILD-ERROR CAUSE CAPTURED** (the residue's honest gap, closed): the
   failed deployment's own events (`/v3/deployments/…/events`), read through
   the Composio lane — the build ran `bun install` at `/vercel/path1` on
   `apps/web/package.json` (the duplicate-dependency warnings fingerprint it
   exactly: `@sporta/output-pipeline` at lines 35+54) and REFUSED the
   workspace deps: `error: Workspace dependency "@sporta/asr" not found /
   Searched in "./*"` (bun 1.3.14) — the workspace ROOT (root package.json +
   `packages/*`) was NOT visible at the build's install root. The ORIGINAL
   deployment (`dpl_Dgtf629qRgTWEZv6i1DmwCdQmrkt`, source: cli) ran its
   install ON the repo root ("Checked 303 installs across 270 packages") —
   the build-layout difference is the failure's mechanism, and the upload's
   path-shape is RULED OUT: both deployments' files land identically (the
   platform's own files trees compared; the 93-file delta is the CLI's
   accidental gitignored runtime-data upload — `db/*.db`,
   `db/media-storage/*.mp4`, `tsconfig.tsbuildinfo` — none load-bearing).
2. **ATTEMPT: `rootDirectory: ""` in the deployment body** — the API REFUSED
   the field itself: HTTP 400 `should NOT have additional property
   rootDirectory` (the v13 creation carries no root override; the build root
   comes from the PROJECT's apps/web for API deployments).
3. **ATTEMPT: the diagnostic installCommand** (pwd + the `/vercel/*` listings
   printed into the build events BEFORE the install — the layout ground
   truth, still wired in the driver for the NEXT creation) — REFUSED BEFORE
   CREATION: **HTTP 402 `api-deployments-free-per-day`** — `{"limit":{"total":
   100,"remaining":0,"reset":1791253483018}}` — the account's rolling-day
   deployment quota is EXHAUSTED (the r306 arc's flights + the incarnations'
   retries burned it; exactly ONE deployment exists since 2026-10-05T00:00Z,
   the failed dpl_8kLxt). The quota RESETS at epoch 1791253483018 ≈
   **2026-10-06T01:31Z (~23 h from the refusal)**.
4. **THE FLIGHT IS TYPED-BLOCKED at the deploy leg** until the quota window.
   The chain when it opens: the fresh provisioning legs (THIS sandbox dies at
   its keep-alive timeout — the ephemerality doctrine, honestly left to die),
   then `deploy.ts` (the diagnostic installCommand captures the container
   layout in the build events — the next fix iteration is data-driven), then
   THE WALK + the validators. The operators' levers: wait the window, or lift
   the quota (the Vercel plan decision — joins the standing operator asks
   alongside the persistent-worker-host decision).

The records ARE part of this checkpoint commit (the flight's measured state —
see deploy-record.json (the 402), deploy-record.attempt1.json (the build
ERROR), sandbox-record.json + compute-worker-record.json (the live window's
provisioning), deploy-files-manifest.json (the upload manifest, sha
87fef70e9c20…). Nothing laundered: the walk did NOT run, the 4/4 measure was
NOT taken, and the commit says so.

## The ephemerality doctrine (standing)

The baked URLs are EPHEMERAL: the sandbox dies at its keep-alive timeout and
the 62-c production-500 class returns to any deployment baking ephemeral
worker URLs (the prior flights measured it live, twice and again). The
persistent-worker-host decision remains the operator's, named in REPORT.md —
never improvised by a worker.
