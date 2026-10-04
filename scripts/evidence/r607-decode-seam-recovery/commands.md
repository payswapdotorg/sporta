# R607 decode-seam recovery — the re-runnable procedure (commands as EXECUTED)

The 65-j flight's commands.md §6 recovery path, EXECUTED at the decode-seam
merge. Every leg below ran and is recorded (typed outcomes included —
never fabricated around).

## 1) The fresh sandbox at the seam merge (both workers) — EXECUTED

```bash
source /home/z/.sporta-env
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-decode-seam-recovery/orchestrate-e2b.ts
# → EXECUTED: sandbox ifw657jm8lpa5feut1xvr (fresh), pinned 920c556…,
#    ffmpeg 5.1.9-0+deb12u1 + libx264, bun 1.4.2, 167 packages, the
#    descriptor advertising [probe, normalize, decode-probe, decode-frames],
#    BOTH workers healthy (media :3971 + compute :3973), 2h keep-alive
#    (sandbox-record.json). Two orchestration attempts hit the E2B SDK's
#    deadline_exceeded on the nohup worker starts — the commands EXECUTED
#    in-sandbox (the workers booted) but their RPC responses were lost;
#    the starts are now IDEMPOTENT (health-check-first, start-if-down) and
#    the health wait is the arbiter.
# re-verify/extend an already-running sandbox:
#   E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-decode-seam-recovery/orchestrate-e2b.ts --sandbox-id <id>
```

## 2) The live decode-seam leg — EXECUTED

```bash
bun run scripts/evidence/r607-decode-seam-recovery/decode-seam-live.ts \
  --worker-url https://3971-ifw657jm8lpa5feut1xvr.e2b.app
# → EXECUTED (decode-seam-live.json): the W102 probe document over the wire
#    (mp4, [video, audio], 386ms), the bounded frame batch (48 REAL frames,
#    11 059 200 bytes — the exact 48 × 230 400 rgb24 byte-math, 320x240,
#    2150ms, real ffmpeg INSIDE the sandbox), the typed budget refusal
#    (100-byte budget → ResourceLimitError), the accounting identities
#    (drain === dispatched, the stage deltas: probe +1/1/0, frames +1/1/0,
#    refusal +1/0/1). One earlier honest refusal recorded in the ledger:
#    the first driver run declared an 8 MiB budget for a 2s clip (11 MB
#    decoded) — the seam's fail-closed frame budget refused TYPED; the
#    driver now mirrors the studio's own 1 GiB STUDIO_UPLOAD_DECODE_BUDGET.
```

## 3) The env re-point — EXECUTED (three PATCHes, all 200)

```bash
source /home/z/.sporta-env
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/sporta/env/iu0c8kUgznFwaH6F" \
  -H "Content-Type: application/json" \
  -d '{"value":"https://3971-ifw657jm8lpa5feut1xvr.e2b.app","type":"encrypted","target":["production"]}'   # MEDIA_TOOLCHAIN_URL → 200
# hSpnqXIKbF1Tb2J7 → https://3973-ifw657jm8lpa5feut1xvr.e2b.app (COMPUTE_WORKER_URL → 200)
# GHJXtTrqEuB1I8pg → r607-decode-seam-rerun-1 (SPORTA_DEPLOY_MARKER → 200)
```

## 4) The deploy — LANDED (the quota window had reset)

```bash
bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN" \
  --project sporta --scope ekonplacidegmailcoms-projects
# → DEPLOYED (deploy-record.json): dpl_9i2uAP6kHyTLYmM8pApqppiNrogi, READY,
#    sporta-4mtdi6idm-ekonplacidegmailcoms-projects.vercel.app, production
#    alias https://sporta-flame.vercel.app; the 65-j refusal
#    (api-deployments-free-per-day at ~08:55Z Oct 4) did not reproduce at
#    ~10:48Z. The production-500 incident (the dead 62-c baked
#    COMPUTE_WORKER_URL) is CLOSED: /api/platform/health 200, marker
#    r607-decode-seam-rerun-1.
```

## 5) The hosted golden path — EXECUTED, THE CLOSURE (hosted-golden-path.json)

```bash
bun run scripts/evidence/r607-decode-seam-recovery/hosted-golden-path.ts \
  --base https://sporta-flame.vercel.app
# → PASS (hosted-golden-path.json): register 200 → login 200 (session
#    cookie) → POST /api/create/upload-sessions 201 in ~4.6s — stored +
#    checksum verified, the R207 decode EXECUTED OVER THE WIRE (the E2B
#    worker's real ffmpeg; the exact leg that refused at
#    new FfmpegDecoderAdapter() at every pre-seam sha — the 62-c Gap 1),
#    the perception ran on the 48 decoded frames, and the media job
#    reached TERMINAL: state succeeded, progress 1, stages through
#    normalization-complete (the four-reality Original leg). The
#    code-measured expectation at the seam merge FLIPPED exactly as the
#    seam designed.
```

## 6) The gates — ALL GREEN

```bash
bun run scripts/evidence/r607-decode-seam-recovery/validate-evidence.ts  # exit 0 (fail-closed, incl. the LIVE provider cross-check of the deployment id)
bash  scripts/evidence/r607-decode-seam-recovery/negative-tests.sh       # 6/6 crafted variants refused with the check named
bunx prettier --check .                                                  # whole-repo clean
bunx eslint scripts/evidence/r607-decode-seam-recovery/                  # 0 errors
```
