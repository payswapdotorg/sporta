# R306 hosted re-flight — incarnation 4: the commands AS EXECUTED (typed outcomes)

The session (2026-10-05 UTC) at the branch `work/r306-hosted-reflight-2`
(from main @ 312d2cb, the flight-6 record merge). Credentials env-only from
`/home/z/.sporta-env` (the fresh `vcp_…` token + the fresh E2B key + the
operator PAT — never echoed, never committed).

## 0) The branch + the pack

```bash
cd /home/z/sporta && git checkout -b work/r306-hosted-reflight-2   # from main @ 312d2cb
# the incarnation-4 pack: the drivers re-pinned + guarded (README §drivers)
```

## 1) The token lane verification (first-hand)

```bash
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v2/user
# → 200: login ekonplacide-5312 (the flight account; the prior packet token was 403-dead)
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v9/projects/sporta
# → 200: the project + its env readable; the posture re-read decrypted:
#   MEDIA_TOOLCHAIN=http / COMPUTE_PROVIDER=http / MARKER=r306-ingest-seam-reflight-1
```

## 2) The provisioning (fresh sandbox, BOTH workers, the pinned tip)

```bash
bun run scripts/evidence/r306-hosted-reflight/incarnation-4/orchestrate-e2b.ts
# → EXECUTED (sandbox-record.json): sandbox id0g6thukn787yjakgt19, the in-sandbox
#    HEAD EXACTLY 312d2cb (fail-closed), ffmpeg 5.1.9-0+deb12u1 + bun 1.4.2,
#    BOTH workers healthy (media :3971 + compute :3973 — both start RPCs lost
#    to the SDK's deadline_exceeded, the measured class; the bounded health
#    waits arbitrated), the FIVE media operations + the five compute renderers,
#    keep-alive 2h. Wall: 167 340 ms.
```

## 3) The boot-compute leg (idempotent re-verify + keep-alive extension)

```bash
bun run scripts/evidence/r306-hosted-reflight/incarnation-4/boot-compute-worker.ts \
  --sandbox-id id0g6thukn787yjakgt19
# → EXECUTED (compute-worker-record.json): the in-sandbox HEAD re-measured
#    312d2cb; BOTH public URLs 200; keep-alive re-extended. Wall: 4 341 ms.
```

## 4) The deploy leg — the PATCHes LANDED, the deployment REFUSED (typed)

```bash
bun run scripts/evidence/r306-hosted-reflight/incarnation-4/deploy.ts \
  --sandbox-id id0g6thukn787yjakgt19
# → the preconditions PASSED (HEAD 312d2cb = origin/main; both worker URLs
#    LIVE 200; the posture http/http verified decrypted);
#    the baseline MEASURED (alias root 200 / health 500 0B — the 62-c class);
#    the three PATCHes FIRED 200 + re-read-verified (the env LIVE-ARMED:
#    the fresh sandbox URLs + marker r306-hosted-reflight-1);
#    the CLI deploy REFUSED in 2 931 ms:
#    ✗ Resource is limited - try again in 24 hours (more than 100,
#      code: "api-deployments-free-perday")   ← verbatim in deploy-record.json
#    THE WALK DID NOT RUN; the 4/4 measure NOT taken this session.
```

## 5) The window flight (incarnation 5 — the armed continuation)

```bash
# the daemon (operator-side, double-fork detached; every 15 min it re-extends
# the keep-alive + retries the deploy; on success: THE WALK → validators →
# gates → ADD-only commit → merge --no-ff → push → CI watch):
python3 /home/z/replay2/scripts/dfork_launch.py \
  /home/z/my-project/scripts/r306-window-flight.log \
  bash /home/z/my-project/scripts/r306-window-flight.sh
```
