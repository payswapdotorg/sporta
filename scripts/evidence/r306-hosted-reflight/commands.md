# R306 HOSTED RE-FLIGHT — the re-runnable command chain (commands as they WILL BE EXECUTED)

PREP ONLY: nothing below has been executed by this commit (69-a1 is the
code-prep task; the TL executes the live legs). Every command runs from the
REPO ROOT; credentials come ONLY from `/home/z/.sporta-env` (env-only, never
echoed, never committed):

```bash
set -a; . /home/z/.sporta-env; set +a
```

## 0) The provisioning (fresh sandbox; or the residue-reuse race — see README)

```bash
# fresh: ONE sandbox + the media worker :3971 (writes sandbox-record.json;
# fails closed unless the in-sandbox HEAD === 5424a84e…):
bun run scripts/evidence/r306-hosted-reflight/provision-sandbox.ts
# re-verify/re-extend the residue sandbox's keep-alive instead (idempotent —
# every identity re-measured from the live binaries; only while it lives):
bun run scripts/evidence/r306-hosted-reflight/provision-sandbox.ts \
  --sandbox-id iuspg21vqeg256a94osir
```

## 1) The companion compute worker :3973 (same sandbox)

```bash
# reads the sandbox id from --sandbox-id or THIS dir's sandbox-record.json
# (writes compute-worker-record.json; re-measures the pinned HEAD fail-closed):
bun run scripts/evidence/r306-hosted-reflight/boot-compute-worker.ts \
  --sandbox-id iuspg21vqeg256a94osir
```

## 2) The production deploy (env re-point + the deployment + verification)

```bash
# discovers the sandbox id from THIS dir's records (or --sandbox-id), derives
# + LIVE-probes both worker URLs, PATCHes the three env vars (marker
# r306-ingest-seam-reflight-1), deploys, verifies both surfaces; writes
# deploy-record.json (+ deploy-files-manifest.json on the API lane).
# The VERCEL lane: the direct VERCEL_TOKEN is probed FIRST (GET /v2/user); a
# dead token falls back to the Composio vercel lane (proxy_execute) — the
# lane used is recorded, never laundered. On a refused build the failed
# deployment's doc + events tail are captured verbatim.
bun run scripts/evidence/r306-hosted-reflight/deploy.ts
# observation-only re-run (no PATCHes, no second deployment — pass the
# measured deployment id):
bun run scripts/evidence/r306-hosted-reflight/deploy.ts --reverify \
  --deployment-id <dpl_…>
```

## 3) THE WALK — the 4/4 closure measure

```bash
# the marker family defaults to r306-ingest-seam-reflight-1; the worker URLs
# default to THIS dir's provisioning records (fail-closed when absent);
# writes hosted-golden-path.json:
bun run scripts/evidence/r306-hosted-reflight/hosted-golden-path.ts \
  --base https://sporta-flame.vercel.app
```

## 4) The fail-closed gates

```bash
# the validator (resolves THIS dir's hosted-golden-path.json from its own
# location; every verdict claim cross-checked against the record's measured
# steps; a tampered record refused with the check named):
bun run scripts/evidence/r306-hosted-reflight/validate-evidence.ts
# the negative battery (outcome-agnostic: one measured field flipped per
# variant, each MUST be refused):
bun run scripts/evidence/r306-hosted-reflight/validate-evidence.ts --negative
```

## The honest order + the doctrine

0 → 1 → 2 → 3 → 4, ~30 minutes end-to-end against a fresh sandbox. The
sandbox is EPHEMERAL (2 h keep-alive from the last leg that touches it): if
the workers 502 ("The sandbox was not found"), re-run §0 + §1 (fresh), then
§2 re-points the env + redeploys, then §3 re-walks. The persistent-worker-host
decision is the operator's standing ask.
