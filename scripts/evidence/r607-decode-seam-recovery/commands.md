# R607 decode-seam recovery — the re-runnable procedure (commands as executed)

The 65-j flight's commands.md §6 recovery path, executed at the decode-seam
merge. Every leg below is RE-RUNNABLE; every outcome is MEASURED and
recorded (typed refusals included — never fabricated around).

## 1) The fresh sandbox at the seam merge (both workers)

```bash
source /home/z/.sporta-env
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-decode-seam-recovery/orchestrate-e2b.ts
# → sandbox-record.json (sandboxId, pinned sha 920c556…, the descriptor
#    advertising [probe, normalize, decode-probe, decode-frames], BOTH
#    workers' health + boot logs, 2h keep-alive)
# re-verify/extend an already-running sandbox:
#   E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-decode-seam-recovery/orchestrate-e2b.ts --sandbox-id <id>
```

## 2) The live decode-seam leg (the seam's client over the public wire)

```bash
bun run scripts/evidence/r607-decode-seam-recovery/decode-seam-live.ts \
  --worker-url https://3971-<sandboxId>.e2b.app
# → decode-seam-live.json (the W102 probe document, the bounded frame
#    batch, the typed budget refusal, the accounting identities)
```

## 3) The env re-point (PATCH the two URL vars to the fresh sandbox)

```bash
source /home/z/.sporta-env
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/sporta/env/iu0c8kUgznFwaH6F" \
  -H "Content-Type: application/json" \
  -d '{"value":"https://3971-<sandboxId>.e2b.app","type":"encrypted","target":["production"]}'   # MEDIA_TOOLCHAIN_URL
# …same shape:
#   hSpnqXIKbF1Tb2J7 → https://3973-<sandboxId>.e2b.app  (COMPUTE_WORKER_URL)
#   (MEDIA_TOOLCHAIN=http, COMPUTE_PROVIDER=http, SPORTA_DEPLOY_MARKER
#    already point the right way from the 65-j PATCHes; the marker is
#    bumped to r607-decode-seam-rerun-1)
```

## 4) The deploy (the quota window is the honest variable)

```bash
bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN" \
  --project sporta --scope ekonplacidegmailcoms-projects
# → 65-j measured the typed refusal (api-deployments-free-per-day, ~08:55Z
#    Oct 4, twice); this flight records whatever the window answers — a
#    landed deploymentId or the same typed refusal, honestly either way.
```

## 5) The hosted golden path (when the deploy lands)

```bash
# sign-up → POST /api/create/upload-sessions with the real source media —
# at the seam merge the code-measured expectation FLIPS: the R207 decode
# dispatches over the wire to the live worker (the 62-c Gap 1 closed by
# the seam); the record states what MEASURED happened, not what theory
# promised.
curl -sS https://sporta-flame.vercel.app/api/platform/health   # the boot
#   descriptor fetch must answer 200 now (the live compute worker) — the
#   production-500 incident (the dead 62-c baked URL) closed by the re-point
```

## 6) The gates

```bash
bun run scripts/evidence/r607-decode-seam-recovery/validate-evidence.ts  # exit 0 (fail-closed)
bunx prettier --check .                                                  # whole-repo clean
bunx eslint scripts/evidence/r607-decode-seam-recovery/                  # 0 errors
```
