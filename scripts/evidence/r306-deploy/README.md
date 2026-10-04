# R306 DEPLOY LEG — the evidence pack (the arc's flight C)

The R306 encode-seam arc's third flight, the r607 deploy precedent
(`scripts/evidence/r607-decode-seam-recovery/deploy-record.json`) mirrored
at the arc's tip: **the env re-point + the production deployment baking the
LIVE sandbox worker URLs + the fail-closed two-surface verification.**

## The arc (for the reader arriving here)

- **flight A — the seam** (`scripts/evidence/r306-encode-seam/`): the
  derived-reality plane's encode surfaces injectable over the http wire;
  the byte-drift law measured; the typed refusals honest under both
  runtimes. Merged `dc2ed8f`.
- **flight B — the live public wire** (`scripts/evidence/r306-live-wire/`):
  the encode pair measured over the E2B worker's PUBLIC URL from the
  orchestrating machine's network position (the Vercel runtime's own).
  Merged `6b1c052` (the arc tip THIS flight deploys).
- **flight C — THIS PACK**: the deploy. The production deployment now bakes
  BOTH live worker URLs (media :3971 + compute :3973 of sandbox
  `i5lvv9q3jrumm914o1rca`), the marker `r306-encode-seam-deploy-1` is
  curl-visible on production, and the 62-c production-500 incident class
  (a dead baked compute-worker URL killing the composition's fail-loud
  boot) is CLOSED at this deployment — measured as the pre-deploy baseline
  (the superseded r607 deployment's health 500) and closed by the
  verification (health 200 + the marker, on both surfaces).

## Files

- `boot-compute-worker.ts` — boots the companion compute worker
  (`r607-e2b-compute-worker.ts`, :3973) in the live-wire flight's sandbox,
  idempotently (health-check-first), verifying BOTH public URLs from the
  orchestrating machine + re-extending the keep-alive.
- `compute-worker-record.json` — that flight leg's honest record (the
  measured boot-time `/v1/adapter` fetch over the exact URL the deploy
  bakes, the full-plane renderer profile, the boot log base64-wrapped).
- `deploy.ts` — the deploy driver: the preconditions (the repo at the arc
  tip, the worker URLs live RIGHT NOW, the current wiring re-read
  decrypted, the pre-deploy production baseline), the three PATCHes
  (production target, encrypted, ids discovered live), the deployment
  (the CLI; a quota refusal is recorded TYPED and STOPS), the two-surface
  verification, the record. `--reverify` re-measures an already-landed
  deployment without re-firing the PATCHes.
- `deploy-record.json` — THE record (the env wiring incl. every PATCH
  status + the pre-values, the deployment, the baseline, the verification,
  the ephemerality doctrine block, the credentials discipline).
- `validate-evidence.ts` — the fail-closed validator (a tampered/laundered
  record is refused; the LIVE provider cross-check incl. the deployed sha
  when VERCEL_TOKEN is present).
- `negative-tests.sh` — 6 crafted tampered variants, each refused with the
  check named.
- `commands.md` — the re-runnable procedure, commands as EXECUTED.

## The ephemerality doctrine (read before trusting any URL in this pack)

Every URL baked by this deployment is EPHEMERAL (the sandbox dies at its
keep-alive timeout; then both worker URLs 502 and the 500 class returns).
The persistent-worker-host decision is the operator's closure — named in
the status row, never improvised by a worker. See the doctrine block in
`deploy-record.json` and §6 of `commands.md`.
