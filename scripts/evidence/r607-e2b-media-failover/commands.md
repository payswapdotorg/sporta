# R607/62-c command classes (verbatim shapes actually executed)

All commands ran from the worker sandbox. Credentials were env-only
(`$VERCEL_TOKEN` / `$E2B_API_KEY` below are the shell variables, never the
values; the committed tree is scanned for the `vcp_`/`e2b_`/`napi_`
prefixes before every commit).

## 1) Base + branch (the task packet's setup, verbatim)

```bash
cd /home/z/my-project && git clone https://github.com/payswapdotorg/sporta.git sporta
cd sporta && git rev-parse HEAD          # → f3807d33f155e208df4ec36f4219296cc9b06b31 (origin/main)
git fetch origin r607/hosted-acceptance-evidence   # the prior evidence pack, read for reference
git checkout -b r607/e2b-media-failover
bun install                              # the repo's own lockfile
```

## 2) The E2B provider provisioning (the designated ffmpeg-capable provider)

```bash
# the evidence drivers' devDependency (root, dev-only — never imported by product packages):
bun add -d e2b@^2.52.0 "@sporta/compute-adapter@workspace:*" \
  "@sporta/compute-adapter-hosted@workspace:*" "@sporta/media-platform@workspace:*" \
  "@sporta/renderer-tactical@workspace:*"

# the provisioning (fresh sandbox; the record lands at provider-record.json):
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-e2b-media-failover/provision-e2b.ts

# re-record/re-verify against the ALREADY-RUNNING sandbox (re-extends keep-alive):
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r607-e2b-media-failover/provision-e2b.ts \
  --sandbox-id <sandboxId>

# the in-sandbox command classes the driver executes (via the e2b node SDK):
#   sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg
#   curl -fsSL https://bun.sh/install | bash
#   HOSTNAME=0.0.0.0 PORT=3971 nohup ~/.bun/bin/bun /sporta/media-worker.js …
#   HOSTNAME=0.0.0.0 PORT=3973 nohup ~/.bun/bin/bun /sporta/compute-worker.js …
# (the worker payloads are single-file `bun build --target=bun` bundles of the
#  repo's own worker entry scripts — no repo checkout, no npm install in-sandbox)

# the public-URL verification (the E2B port proxy):
curl -sS https://3971-<sandboxId>.e2b.app/health
curl -sS https://3971-<sandboxId>.e2b.app/v1/media/adapter     # the live capability manifest
curl -sS https://3973-<sandboxId>.e2b.app/v1/adapter           # the compute worker's manifest
```

## 3) The provider-boundary golden path (the REAL corpus clip over the public wire)

```bash
bun run scripts/evidence/r607-e2b-media-failover/golden-path.ts
# (requires provider-record.json + the sandbox up; writes golden-path.json)
```

## 4) The hosted deployment (the W910 runbook shape, the failover env wiring)

```bash
# the env wiring (PATCH the existing vars / the marker; ids from the project's env list):
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/sporta/env/<envId>?teamId=$VERCEL_TEAM" \
  -H "Content-Type: application/json" \
  -d '{"value":"http","type":"encrypted","target":["production"]}'           # MEDIA_TOOLCHAIN
#   …same shape for MEDIA_TOOLCHAIN_URL / COMPUTE_PROVIDER / COMPUTE_WORKER_URL /
#      SPORTA_MEDIA_STORAGE=/tmp/sporta-media-storage / SPORTA_DEPLOY_MARKER

# the deploy itself (from the REPO ROOT — the fresh clone has no .vercel/ link):
bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN" \
  --project sporta --scope ekonplacidegmailcoms-projects

# the state reads (ids + states only, no values):
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?teamId=$VERCEL_TEAM&app=sporta&limit=2&target=production"
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/sporta/env?teamId=$VERCEL_TEAM"
bunx vercel logs https://sporta-flame.vercel.app --token "$VERCEL_TOKEN" --project sporta
#   (the boot banner + the typed upload refusal's stack — the corrected root cause)
```

## 5) The fresh-browser golden path (real Chromium; the journey log records the stages)

```bash
agent-browser --session r607e2b open https://sporta-flame.vercel.app/
agent-browser --session r607e2b snapshot -i                     # ref-driven interaction
agent-browser --session r607e2b upload @<fileInput> \
  scripts/evidence/spr-corpus-bytes/clip-b1-wide-broadcast.mp4  # the SAME clip as 2026-09-26
agent-browser --session r607e2b screenshot <stage>.png
agent-browser --session r607e2b network requests --filter upload-sessions
agent-browser --session r607e2b console / errors               # zero observed
# the recovery walk re-executed in a FRESH context (--session r607e2brecovery)
```

## 6) The recovery measurement (API-level, hash-verified)

```bash
curl -sS -H "cookie: sporta_session=<browser-token>" "https://sporta-flame.vercel.app/api/auth/me"
curl -sS -H "cookie: sporta_session=<browser-token>" "https://sporta-flame.vercel.app/api/catalog/library"
curl -sS -H "cookie: sporta_session=<browser-token>" "https://sporta-flame.vercel.app/api/watch/<sessionId>"
curl -sS -H "cookie: sporta_session=<browser-token>" \
  "https://sporta-flame.vercel.app/api/watch/<sessionId>/renders/<renderId>/outputs/<segmentId>"
# sha256(served content) == the descriptor's contentHash, before AND after the redeploy

# the E2B worker's OWN record of the hosted render job (the compute-failover proof):
curl -sS https://3973-<sandboxId>.e2b.app/v1/jobs/render-job-<sessionId>-1
```

## 7) The gates (the touched packages)

```bash
cd packages/compute-adapter           && bun test    # the contract suite must stay green
cd packages/compute-adapter-hosted    && bun test    # 104 tests (the new script is a dev entry, not a test)
cd packages/media-platform             && bun test    # the toolchain seam suite
cd packages/compute-adapter-hosted    && bun run typecheck
bunx prettier --check <the touched files>
bunx eslint <the touched files>
```

## 8) Delivery (NO git push — no repo-push token; the TL harvests the workspace)

```bash
git add -A && git commit -m "rel(62-c, checkpoint): <leg>"   # after each leg, on r607/e2b-media-failover
# the final state: the branch + REPORT.md + this evidence pack, delivered via workspace files
```
