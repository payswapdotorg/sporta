# R607 65-j — the E2B hosted re-run: the verbatim command classes (executed)

All commands ran from the worker sandbox at branch
`work/r607-e2b-hosted-rerun` (base `300c035` = origin/main; the pinned sha
the E2B worker checks out). Credentials were env-only
(`source /home/z/.sporta-env` — E2B_API_KEY + VERCEL_TOKEN; the values are
never echoed, never committed; `$VERCEL_TOKEN`/`$E2B_API_KEY` below are the
shell variables, never the values; the committed tree is scanned for the
`e2b_`/`vcp_` prefixes by the validator).

## 1) The E2B external toolchain worker (the orchestration, re-runnable)

```bash
cd /home/z/sporta && git checkout -b work/r607-e2b-hosted-rerun main   # @ 300c035b4cf0…
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-e2b-hosted-rerun/orchestrate-e2b.ts
#   → sandbox i0g9kmal3il3lojjarucf (template base, Debian 12)
#   → in-sandbox: sudo apt-get install -y ffmpeg (5.1.9-0+deb12u1 + libx264)
#                 curl -fsSL https://bun.sh/install | bash (bun 1.4.2)
#                 git clone https://github.com/payswapdotorg/sporta.git /home/user/sporta-repo
#                 git checkout 300c035b4cf0a0e89a4a08c465d9d0104a9b3efd   (the pinned sha)
#                 bun install --frozen-lockfile (167 packages)
#   → worker: cd packages/compute-adapter-hosted && \
#             HOSTNAME=0.0.0.0 PORT=3971 nohup ~/.bun/bin/bun run \
#             scripts/r607-media-toolchain-worker.ts   (the public bind)
#   → sandbox.setTimeout(2h) — the acceptance window
#   writes sandbox-record.json; boot log: "toolchain: RESOLVED — ffmpeg
#   '/usr/bin/ffmpeg' / ffprobe '/usr/bin/ffprobe' … 5.1.9-0+deb12u1"

# re-verify/re-extend against the ALREADY-RUNNING sandbox:
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-e2b-hosted-rerun/orchestrate-e2b.ts \
  --sandbox-id i0g9kmal3il3lojjarucf

# the companion compute worker (the inherited COMPUTE_PROVIDER=http posture
# kept bootable — the composition's boot-time descriptor fetch is fail-loud):
#   cd /home/user/sporta-repo/packages/compute-adapter-hosted && \
#   HOSTNAME=0.0.0.0 PORT=3973 nohup ~/.bun/bin/bun run \
#   scripts/r607-e2b-compute-worker.ts

# the PUBLIC URL verifications (the E2B port proxy), from THIS sandbox:
curl -sS https://3971-i0g9kmal3il3lojjarucf.e2b.app/health          # 200, ok=true
curl -sS https://3971-i0g9kmal3il3lojjarucf.e2b.app/v1/media/adapter # the live descriptor (resolved=true)
curl -sS https://3973-i0g9kmal3il3lojjarucf.e2b.app/health          # 200 (the companion)
```

## 2) The seam golden path (the admission PASS through the remote worker)

```bash
bun run scripts/evidence/r607-e2b-hosted-rerun/golden-path-seam.ts \
  --worker-url https://3971-i0g9kmal3il3lojjarucf.e2b.app
#   writes golden-path-seam.json (the W914 golden-path schema + the
#   workerIdentity block; run twice — the worker restarted between runs
#   because the driver fail-closes on a non-empty ledger)
# determinism: runs/golden-path-seam-run{1,2}.json — the artifact sha
#   byte-identical within the provider (determinism.json)

curl -sS https://3971-i0g9kmal3il3lojjarucf.e2b.app/v1/media/stats \
  > worker-stats.json                     # the worker's own accounting read
```

## 3) The Vercel env wiring (the brief's `env add` class, PATCH-adapted)

The vars already existed (the 62-c posture, pointing at the now-dead 62-c
sandbox) — `vercel env add` refuses duplicates, so the values were PATCHed
in place (the 62-c commands.md §4 precedent; all five answered 200):

```bash
source /home/z/.sporta-env
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/sporta/env/I1QbYbw102O2ybC7" \
  -H "Content-Type: application/json" \
  -d '{"value":"http","type":"encrypted","target":["production"]}'        # MEDIA_TOOLCHAIN
# …same shape:
#   iu0c8kUgznFwaH6F → https://3971-i0g9kmal3il3lojjarucf.e2b.app  (MEDIA_TOOLCHAIN_URL)
#   hSpnqXIKbF1Tb2J7 → https://3973-i0g9kmal3il3lojjarucf.e2b.app  (COMPUTE_WORKER_URL)
#   NgYDMHJ24XhCuX0W → http                                        (COMPUTE_PROVIDER)
#   GHJXtTrqEuB1I8pg → r607-e2b-rerun-1                            (SPORTA_DEPLOY_MARKER)
```

## 4) The deploy (ATTEMPTED, REFUSED — the typed quota; never faked)

```bash
bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN" \
  --project sporta --scope ekonplacidegmailcoms-projects
# → ✗ Resource is limited - try again in 24 hours (more than 100,
#    code: "api-deployments-free-per-day")     [deploy-1.txt]
# retried ~15 min later → the same typed refusal        [deploy-2.txt]
```

## 5) The current production state (measured — the ephemerality proof)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://sporta-flame.vercel.app/                    # 200 (shell)
curl -sS -o /dev/null -w "%{http_code}\n" https://sporta-flame.vercel.app/api/platform/health # 500
curl -sS -X POST https://sporta-flame.vercel.app/api/auth/register \
  -H "content-type: application/json" -d '{"username":"r607e2brerun-probe","password":"…"}'   # 500
bunx vercel logs https://sporta-flame.vercel.app --token "$VERCEL_TOKEN" --project sporta \
  --scope ekonplacidegmailcoms-projects
# → "Error: compute worker descriptor fetch failed: HTTP 502"  (the 62-c
#    deployment's BAKED COMPUTE_WORKER_URL — the dead 62-c sandbox; every
#    API route 500s at the composition boot since that sandbox died)
```

## 6) The recovery path (when the quota resets — the TL's re-run)

```bash
# 1) a FRESH sandbox (this flight's is dead by then — 2h keep-alive):
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-e2b-hosted-rerun/orchestrate-e2b.ts
# 2) PATCH the two URL env vars to the fresh sandbox's public URLs (§3's shape)
# 3) bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN" \
#      --project sporta --scope ekonplacidegmailcoms-projects
# 4) the hosted golden path (sign-up → POST /api/create/upload-sessions) —
#    the upload's honest expected outcome at this pinned sha: REFUSED at the
#    R207 decode (the recorded Gap 1, upstream of the E2B-wired admission
#    seam — see hosted-golden-path.json theExpectedUploadOutcomeAtThisPinnedSha)
```

## 7) The gates

```bash
bun run scripts/evidence/r607-e2b-hosted-rerun/validate-evidence.ts     # exit 0 (fail-closed)
bash  scripts/evidence/r607-e2b-hosted-rerun/negative-tests.sh          # 5 refusals + pass
bunx prettier --check .                                                 # whole-repo clean
bunx eslint scripts/evidence/r607-e2b-hosted-rerun/                     # 0 errors
```
