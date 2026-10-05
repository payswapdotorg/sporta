# R306 hosted re-flight — incarnation 3: the commands AS EXECUTED (typed outcomes)

Every leg below ran in THIS session (2026-10-05, UTC) and is recorded typed —
never fabricated around. Credentials env-only (never echoed in full, never
committed). All commands from the REPO ROOT at the branch `work/r306-hosted-reflight`
(the session found the branch ALREADY CARRYING the two prior-incarnation
commits — the legs below executed at `5424a84e…`, the packet's tip, with this
run's files untracked; they were then landed ADD-only under `incarnation-3/`
on top of `2cf1465`, the prior tip — no force, no overwrite).

## 0) The clone + branch + install

```bash
git clone https://x-access-token:$GITHUB_TOKEN@github.com/payswapdotorg/sporta.git sporta-reflight
cd sporta-reflight && git checkout -b work/r306-hosted-reflight   # from main @ 5424a84e…
bun install        # → 336 packages installed [3.08s] — exit 0
```

## 1) The baseline gates — ALL GREEN (the numbers, as measured)

```bash
bunx eslint .      # → 0 errors (1 pre-existing no-console warning: packages/media-platform/src/service.ts) — exit 0
bunx prettier --check .   # → "All matched files use Prettier code style!" — exit 0
bun test apps/web/test/artifact-ingest-seam.test.ts
                    # → 6 pass / 0 fail / 90 expect() calls [396.00ms]
bun test apps/web/test/golden-path.test.ts
                    # → 14 pass / 0 fail / 282 expect() calls [7.14s]
```

## 2) The provisioning (fresh E2B sandbox, BOTH workers, the pinned tip)

```bash
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r306-hosted-reflight/incarnation-3/orchestrate-e2b.ts
# (executed at the pack root pre-move; identical behavior at the landed path)
# → EXECUTED (sandbox-record.json): sandbox i7wthxzje6u8lomv200hc (fresh),
#    in-sandbox HEAD EXACTLY the pinned 5424a84e… (fail-closed), ffmpeg
#    5.1.9-0+deb12u1 + libx264, bun 1.4.2, 167 packages, BOTH workers healthy
#    (media :3971 + compute :3973 — both start RPC responses lost to the
#    SDK's deadline_exceeded, the measured class; the bounded health waits
#    arbitrated), the media descriptor advertising the FIVE operations, the
#    compute descriptor 200 with the five renderers, keep-alive 2h.
#    Wall: 168 842 ms.
```

## 3) The boot-compute-worker leg (idempotent re-verify + keep-alive extension)

```bash
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r306-hosted-reflight/incarnation-3/boot-compute-worker.ts \
  --sandbox-id i7wthxzje6u8lomv200hc
# → EXECUTED (compute-worker-record.json): the in-sandbox HEAD re-measured
#    EXACTLY the pinned 5424a84e… (fail-closed); the compute worker already
#    healthy (idempotent skip); BOTH public URLs verified from THIS machine
#    (media health 200 + descriptor 200 [the FIVE ops] / compute health 200 +
#    descriptor 200 [the five renderers]); keep-alive re-extended 2h from
#    THIS invocation. Wall: 5 369 ms.
```

## 4) The deploy leg — REFUSED FAIL-CLOSED BEFORE ANY PATCH (typed)

```bash
VERCEL_TOKEN=$VERCEL_TOKEN E2B_API_KEY=$E2B_API_KEY \
  bun run scripts/evidence/r306-hosted-reflight/incarnation-3/deploy.ts \
    --sandbox-id i7wthxzje6u8lomv200hc
# (executed at the pack root pre-move, at HEAD 5424a84e…, the tracked tree
#  clean outside the .vercelignore'd scripts/ evidence paths)
# → REFUSED, exit 1, NOTHING PATCHed, NOTHING deployed:
#    - the preconditions PASSED (HEAD === origin/main === 5424a84e…; both
#      worker URLs LIVE: media health+descriptor 200, compute health+descriptor 200);
#    - the pre-deploy production baseline MEASURED: alias root 200 /
#      health 500 (0B body) — the 62-c class LIVE (the superseded r306-deploy
#      deployment's dead baked worker URLs; the env carries the PRIOR
#      incarnation's marker r306-ingest-seam-reflight-1 + its dead sandbox's URLs);
#    - the pre-PATCH decrypted re-read: MEDIA_TOOLCHAIN=undefined
#      COMPUTE_PROVIDER=undefined MARKER=undefined →
#      FATAL: the http posture is NOT set (MEDIA_TOOLCHAIN/COMPUTE_PROVIDER) —
#      the r306-deploy record said it was; refusing to deploy on an unverified posture
#    - the root cause, measured first-hand (this session's own probes):
#      GET /v2/user → 403 {"error":{"code":"forbidden","message":"Not authorized","invalidToken":true}}
#      GET /v9/projects/sporta → 403 (the same body)
#      GET /v9/projects/sporta/env → 403 (the same body)
#      bunx vercel whoami → exit 1: "Error: The token provided via VERCEL_TOKEN
#      environment variable is not valid. Please provide a valid token."
#      THE PACKET'S VERCEL_TOKEN IS TYPED-DEAD — the posture is unverifiable,
#      the PATCHes/deploy/verify are impossible with it.
#    - the LANDED prior-incarnation record (../deploy-record.json at the pack
#      root) additionally measured the account quota: HTTP 402
#      api-deployments-free-per-day, limit 100 / remaining 0 / reset
#      1791253483018 ≈ 2026-10-06T01:31Z — AFTER this flight's deadline; not
#      re-measurable this session (the dead token cannot read the project).
# Record: deploy-record.direct-token.json (the driver's precondition exit
# precedes its own record write — the record was captured from this session's
# first-hand measurements, typed verbatim).
```

## 5) THE WALK — NOT RUN (the honest blocker)

```bash
bun run scripts/evidence/r306-hosted-reflight/incarnation-3/hosted-golden-path.ts \
  --base https://sporta-flame.vercel.app \
  --expected-marker r306-hosted-reflight-1 \
  --media-worker https://3971-i7wthxzje6u8lomv200hc.e2b.app \
  --compute-worker https://3973-i7wthxzje6u8lomv200hc.e2b.app
# → NOT EXECUTED: the walk requires the production deployment carrying the
#    marker r306-hosted-reflight-1 with THIS session's live worker URLs baked;
#    no PATCH and no deployment were possible (§4's blockers). The driver
#    fails closed at boot against any other plane (the current alias serves
#    the superseded deployment: root 200 / health 500 empty body — running
#    the walk there is a crash, not a measurement). THE 4/4 MEASURE WAS NOT
#    TAKEN; nothing is recorded as if it were.
```

## 6) The gates — as runnable at this checkpoint

```bash
# the flight-4 validator against the LANDED flight-4 record (the ADD-only
# law's non-regression proof — the landed record still agrees with itself):
bun run scripts/evidence/r306-hosted-golden-path/validate-evidence.ts          # → exit 0 (expected)
bun run scripts/evidence/r306-hosted-golden-path/validate-evidence.ts --negative  # → 6/6 refused (expected)
# THIS run's own validator: NOT RUNNABLE — its record (incarnation-3/
# hosted-golden-path.json) does not exist because the walk did not run.
bunx prettier --check .        # → whole-repo clean (this session's additions included)
bunx eslint scripts/evidence/  # → 0 errors (this session's additions included)
```

## 7) The production + sandbox state at record-write (2026-10-05T06:51:30Z, measured)

```bash
curl -s -o /dev/null -w "%{http_code}" https://sporta-flame.vercel.app/                     # → 200
curl -s -w "\n%{http_code} (%{size_download}B)" https://sporta-flame.vercel.app/api/platform/health
                                                                                             # → HTTP 500 (0B) — the 62-c class live
curl -s -o /dev/null -w "%{http_code}" https://3971-i7wthxzje6u8lomv200hc.e2b.app/health    # → 200
curl -s -o /dev/null -w "%{http_code}" https://3973-i7wthxzje6u8lomv200hc.e2b.app/health    # → 200
# the sandbox honestly left to die at its keep-alive (the ephemerality
# doctrine — the walk cannot consume it this session)
```
