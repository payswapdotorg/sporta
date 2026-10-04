# R306 hosted golden path — the re-runnable evidence commands

The walk was driven against the LIVE production deployment (`r306-encode-seam-deploy-1`)
with the live sandbox's workers baked. Re-run (from the REPO ROOT) while the plane lives:

```bash
# 1. The walk itself (the driver re-registers a fresh user, re-uploads, re-walks;
#    rewrites hosted-golden-path.json with the FRESH measurements — every number
#    re-measured, never copied):
bun run scripts/evidence/r306-hosted-golden-path/hosted-golden-path.ts \
  --base https://sporta-flame.vercel.app

# 2. The fail-closed validator (12 checks; the record must agree with ITSELF —
#    the verdict's counts, the kinds' exhaustive split, the jobs' terminal
#    states, the accounting's arithmetic):
bun run scripts/evidence/r306-hosted-golden-path/validate-evidence.ts

# 3. The negative battery (6 tampered variants, each MUST be refused):
bun run scripts/evidence/r306-hosted-golden-path/validate-evidence.ts --negative
```

The sandbox is EPHEMERAL: if the workers 502 (the "sandbox was not found" class), re-extend
the keep-alive + re-boot via the r306-live-wire orchestrator and the r306-deploy
boot-compute-worker leg (their own commands.md files), then re-run the walk. The ephemerality
doctrine: the deployment's baked URLs die with the sandbox; the persistent-worker-host
decision remains the operator ask.
