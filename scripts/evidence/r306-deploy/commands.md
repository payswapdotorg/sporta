# R306 DEPLOY LEG — the re-runnable procedure (commands as EXECUTED)

The r607 deploy precedent (`scripts/evidence/r607-decode-seam-recovery/commands.md`
§3-§6), mirrored at the R306 arc's tip. Every leg below ran and is recorded
(typed outcomes included — never fabricated around).

## 0) The keep-alive re-extension of the LIVE sandbox — EXECUTED FIRST

```bash
source /home/z/.sporta-env
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r306-live-wire/orchestrate-e2b.ts \
  --sandbox-id i5lvv9q3jrumm914o1rca
# → EXECUTED: sandbox i5lvv9q3jrumm914o1rca (REUSED — the live-wire flight's,
#    started 2026-10-04T18:24:56Z), in-sandbox HEAD re-measured EXACTLY the
#    pinned dc2ed8f…, the media worker already healthy on :3971 (idempotent
#    skip), the PUBLIC health + descriptor verified from THIS machine (the
#    FIVE operations incl. encode-frames), keep-alive re-extended to 2 h.
```

## 1) The companion compute worker in the SAME sandbox — EXECUTED

```bash
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r306-deploy/boot-compute-worker.ts \
  --sandbox-id i5lvv9q3jrumm914o1rca
# → EXECUTED (compute-worker-record.json): the r607 lesson mirrored — the
#    COMPUTE_PROVIDER=http posture requires a live compute worker at the
#    composition's fail-loud boot. The in-sandbox HEAD re-measured the pinned
#    dc2ed8f… (fail-closed); the start command's RPC response was LOST to the
#    SDK's deadline_exceeded (the measured class — the worker booted; the
#    bounded health wait arbitrated, 200); the boot log read base64-wrapped
#    (the [m display artifact, the live-wire flight's finding). BOTH public
#    URLs verified from THIS machine: media :3971 (health 200 + descriptor
#    200, the FIVE operations) + compute :3973 (health 200 + descriptor 200,
#    renderers [anime-npr.prototype, anime.prototype, game-3d.prototype,
#    sporta.testcard, tactical.prototype] — the derived-reality plane COMPOSED
#    in-sandbox: the local ffmpeg+libx264 resolved). Keep-alive re-extended
#    again (2 h from THIS invocation). Wall: 64 807 ms.
```

## 2) The env re-point — EXECUTED (three PATCHes, all 200 + re-read matches)

```bash
source /home/z/.sporta-env
# the driver discovers the env var ids live (GET /v9/projects/sporta/env),
# re-reads every CURRENT value DECRYPTED first (verify, do not assume:
# MEDIA_TOOLCHAIN=http + COMPUTE_PROVIDER=http confirmed — the 65-j PATCHes,
# NOT re-fired this flight), then:
#   PATCH v10/projects/sporta/env/iu0c8kUgznFwaH6F  MEDIA_TOOLCHAIN_URL \
#     → https://3971-i5lvv9q3jrumm914o1rca.e2b.app   # 200
#   PATCH v10/projects/sporta/env/hSpnqXIKbF1Tb2J7  COMPUTE_WORKER_URL \
#     → https://3973-i5lvv9q3jrumm914o1rca.e2b.app   # 200
#   PATCH v10/projects/sporta/env/GHJXtTrqEuB1I8pg  SPORTA_DEPLOY_MARKER \
#     → r306-encode-seam-deploy-1                    # 200
# each body: {"value":…,"type":"encrypted","target":["production"]}; each
# value re-read decrypted and confirmed (fail-closed on mismatch).
```

## 3) The production deployment — LANDED (the quota refusal did NOT reproduce)

```bash
VERCEL_TOKEN=$VERCEL_TOKEN E2B_API_KEY=$E2B_API_KEY \
  bun run scripts/evidence/r306-deploy/deploy.ts
# → DEPLOYED (deploy-record.json): the CLI (bunx vercel deploy --prod --yes
#    --project sporta --scope ekonplacidegmailcoms-projects, the token through
#    the process env) exited 0 in 37 227 ms from the repo root at the R306 arc
#    tip (HEAD === origin/main === 6b1c052e…, the tracked tree clean outside
#    the .vercelignore'd evidence paths). The API is the arbiter:
#    dpl_Dgtf629qRgTWEZv6i1DmwCdQmrkt, READY, target production, created
#    1791139630383, ready 1791139661275, URL
#    sporta-o41aj4kf2-ekonplacidegmailcoms-projects.vercel.app — the
#    provider's own meta carries the deployed sha 6b1c052e… (the validator's
#    LIVE cross-check).
#    THE FIRST INVOCATION'S VERIFICATION PASS WAS REFUSED fail-closed (the
#    honest history): its deployment-URL fetch FOLLOWED the 302 into
#    vercel.com's SSO 200 HTML page and recorded a null-marker "health 200"
#    (the Vercel Authentication / Standard Protection shape — the unique
#    deployment URL is not publicly fetchable). The fix: REDIRECT-MANUAL
#    fetches (a redirect is recorded as the redirect it is) + the
#    AUTHENTICATED `vercel curl` probe + the production alias as the public
#    surface. The --reverify invocation re-measured everything and rewrote
#    the record (the PATCHes were NOT re-fired; no second deployment):
VERCEL_TOKEN=$VERCEL_TOKEN E2B_API_KEY=$E2B_API_KEY \
  bun run scripts/evidence/r306-deploy/deploy.ts --reverify \
  --deployment-id dpl_Dgtf629qRgTWEZv6i1DmwCdQmrkt
# → VERIFIED (exit 0): alias root 200 / alias health 200 + marker
#    r306-encode-seam-deploy-1 (attempt 1) / the deployment URL's public
#    shape 302 → vercel.com/sso-api (recorded as the shape it is) / the
#    authenticated probe exit 0 + the same marker.
```

## 4) The verification, measured (fail-closed, both surfaces)

- THE BASELINE (pre-deploy, the first invocation): the superseded r607
  rerun-2 deployment served `https://sporta-flame.vercel.app/api/platform/health`
  → **500 with an empty body** (its baked worker URLs dead since the r607
  sandbox's timeout — the 62-c production-500 incident class LIVE at this
  flight's open; the exact incident this deployment closes).
- THE PUBLIC SURFACE: the production alias root 200; `/api/platform/health`
  **200 with `deployMarker: r306-encode-seam-deploy-1`** (fetches
  redirect-manual; the body's own field list recorded:
  `[deployMarker, env, providers, renderQueue, usageGuardrails]`).
- THE DEPLOYMENT'S OWN SURFACE: the unique deployment URL answers **302 →
  vercel.com/sso-api** to the public fetch (Vercel Authentication — recorded
  as the shape, never laundered as health); the AUTHENTICATED probe
  (`bunx vercel curl <deployment-url>/api/platform/health`, the token through
  the process env) exited **0 with the same marker** — the deployment's own
  runtime answered the health document.
- THE BOOT-TIME COMPUTE DESCRIPTOR FETCH SUCCEEDED (the 62-c incident class
  not reproduced): evidenced by the health route answering 200 AT ALL — the
  composition's fail-loud boot fetches `GET {COMPUTE_WORKER_URL}/v1/adapter`;
  its failure kills the composition and every API route 500s empty (the
  baseline above measured exactly that on the superseded deployment).
- THE MEDIA DESCRIPTOR: the health answer carries NO media-toolchain field
  (its own field list recorded; the media seam is composition-lazy — only
  the COMPUTE descriptor is fail-loud at boot), so the deployed runtime's
  own media fetch is honestly marked `measurable: false` with the
  hosted-golden-path flight named as the end-to-end measurer; measured FROM
  THIS MACHINE over the exact baked URL: health 200 + descriptor 200
  advertising the FIVE operations.
- THE SANDBOX at record-write: both public worker URLs 200 (the measured
  lifetime state in the ephemerality doctrine block).

## 5) The gates — ALL GREEN

```bash
bun run scripts/evidence/r306-deploy/validate-evidence.ts   # exit 0 (fail-closed: the pinned revisions, the PATCH statuses + cross-checked URL values, the baseline 500, the deployment READY+production, the two-surface verification, the four-way marker agreement, the honest media reachability, the ephemerality block, the LIVE provider cross-check incl. the deployed sha, the token scan)
source /home/z/.sporta-env && VERCEL_TOKEN=$VERCEL_TOKEN \
  bash scripts/evidence/r306-deploy/negative-tests.sh       # 6/6 crafted variants refused with the check named (a laundered PATCH status, a laundered deployment state, a fabricated deployment id, a laundered marker, a laundered boot-time fetch, a planted token)
bunx prettier --check .                                     # whole-repo clean
bunx eslint scripts/evidence/r306-deploy/                   # 0 errors
```

## 6) The ephemerality doctrine (the honest posture)

The baked URLs are EPHEMERAL: sandbox `i5lvv9q3jrumm914o1rca` dies at its
keep-alive timeout (2 h from the last orchestration invocation — re-extended
by this flight's legs; `lifecycleOnTimeout: kill`). On its death both public
worker URLs answer the E2B proxy's 502 "The sandbox was not found", the
boot-time compute descriptor fetch fails, and the 500 class returns to THIS
deployment — exactly as it returned to the r607 rerun-2 deployment (this
flight's measured baseline). A PERSISTENT worker host is the operator's
closure decision, named in the status row — never improvised by a worker.
The re-runnable chain: §0 → §1 → §2 → §3 against a fresh sandbox, ~30
minutes end-to-end.
