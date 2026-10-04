# R607 65-j — the E2B hosted re-run: the external toolchain worker + the honest partial

Worker 65-j (flight 16) · 2026-10-04 · branch
`work/r607-e2b-hosted-rerun` · base `300c035` (= origin/main, the pinned sha).
The R607 lane B closure flight: the E2B external toolchain worker stood up
for real, the hosted Vercel re-run wired and attempted — with the honest
typed record of where the provider's quota gate refused it.

## THE HONEST VERDICT (read this first)

**The E2B external toolchain worker is UP, PUBLIC, and VERIFIED** (sandbox
`i0g9kmal3il3lojjarucf`, the repo cloned + checked out at the pinned main
sha `300c035b4cf0…` IN the sandbox, ffmpeg 5.1.9-0+deb12u1 + libx264 + bun
1.4.2, the repo's own `r607-media-toolchain-worker.ts` bound to
`0.0.0.0:3971`, public health `https://3971-i0g9kmal3il3lojjarucf.e2b.app`
HTTP 200). **The seam-level admission PASSED through the remote worker,
MEASURED** (`golden-path-seam.json`: uploadState `stored`, checksum
verified, the worker job `succeeded`, worker execution 86–123 ms; the
Original-leg normalization + the original-reality artifact executed by the
sandbox's real ffmpeg, hash-chained 7/7, playable, same-provider
byte-identical across two runs). **The hosted deploy was REFUSED by the
provider's free-tier quota** (typed `api-deployments-free-per-day`, >100 —
two attempts ~15 min apart; the build payload uploaded, the deployment
creation refused; NOT a token/build failure). **The hosted golden path
re-run therefore did NOT execute** (env changes take effect only on a new
deployment) — and the current production's API plane is MEASURED DOWN
(500 at the composition boot: the 62-c deployment's baked
`COMPUTE_WORKER_URL` points at the long-dead 62-c sandbox; the E2B proxy
answers 502; the fail-loud boot descriptor fetch throws — every API route
500s, the shell pages 200). Nothing was fabricated, nothing laundered: the
deploy record's `deploymentId` is honestly `null`.

## THE EPHEMERALITY DOCTRINE (first-class, now with a live measured proof)

1. The E2B worker URL is **EPHEMERAL evidence**: the sandbox dies at its
   keep-alive (2h here) — this flight's URL is dead by read time. The
   media-half is CLOSED AS EVIDENCE to exactly this extent: a real hosted
   seam (`MEDIA_TOOLCHAIN=http + MEDIA_TOOLCHAIN_URL`, wired on the
   production target, PATCHed 200) + a real external toolchain worker at
   the pinned revision + the admission PASSING through it over the public
   wire, executed twice (byte-identical), recorded. Never more than the
   executed runs prove.
2. **The production posture still needs a persistent worker host** — and
   this flight measured the failure mode of NOT having one, live: the
   2026-10-03 (62-c) production deployment baked an ephemeral E2B sandbox
   URL into its env; the sandbox died hours later; **the hosted API plane
   has been DOWN since** (every API route 500s at boot — the verbatim
   runtime log is in `deploy-record.json`). An ephemeral worker URL in
   production env is a time bomb; the operator's infrastructure choice
   (a persistent ffmpeg host, or a supervisor that re-points the env) is
   the open production decision.
3. When the deploy quota resets, the full recovery procedure is recorded
   and re-runnable (`commands.md` §6) — a fresh sandbox, the two PATCHed
   URLs, the deploy, then the hosted golden path. The upload's honest
   EXPECTED outcome at this pinned sha is recorded too: the R207 decode
   gap (upstream of the E2B-wired admission seam) still refuses the hosted
   upload — closing it is the R607 gap flight A (a contract change, the
   TL's decision; the 62-c record's integration design stands).

## Where the evidence lives

| Path | Content |
|---|---|
| `sandbox-record.json` | the E2B provider record (sandbox id, template, the pinned sha + its checkout verification, the measured ffmpeg/bun identity, the public worker health + live descriptor + boot log, the 2h keep-alive, the companion compute worker) |
| `golden-path-seam.json` | THE ADMISSION-PASS RECORD (the W914 golden-path schema + the `workerIdentity` block: the sandbox id, the pinned sha, the client-honesty field) — admission → normalization → the original-reality artifact → hash chain → playability → accounting → the honest boundary record |
| `determinism.json` | the two runs' byte-identity (same provider) + the cross-build note (the E2B ffmpeg 5.1.9 artifact sha differs from the prior 7.1.5 record — the codec-build class, honestly recorded) |
| `worker-stats.json` | the worker's own `/v1/media/stats` read (must equal the golden-path record's accounting block — the two independent reads agreeing) |
| `deploy-record.json` | the env PATCHes (ids + values + 200s), the two typed deploy refusals, the honestly-null deploymentId, the measured production-down state + the verbatim runtime log, the recovery path |
| `hosted-golden-path.json` | the hosted leg's honest typed record: NOT EXECUTED (blocked-deploy-quota-refused), the measured current-production state, and the code-measured EXPECTED upload outcome at this pinned sha (the R207 decode gap — unchanged since 62-c, git-diff-verified) |
| `orchestrate-e2b.ts` | the re-runnable E2B orchestration (create → install → clone-at-the-pinned-sha → worker → public verify → record → keep-alive) |
| `golden-path-seam.ts` | the re-runnable seam driver (the W914 driver adapted: the E2B public URL required, no embedded mode, the out-path here) |
| `validate-evidence.ts` | the fail-closed validator (structure, the admission-PASS ledger cross-check, the hash chain, the honest-null deploy id, the token scan) |
| `negative-tests.sh` | the five refusals (the fabricated admission-PASS, the laundered deploy id, the token-shaped leak, the stats disagreement, the laundered determinism) + the committed-tree pass |
| `commands.md` | the verbatim command classes executed |
| `runs/` | the orchestration/deploy/driver stdout logs (the measured evidence trail) |

## The acceptance table (this flight's legs)

| Leg | Result | Evidence |
|---|---|---|
| The E2B sandbox provisioned at the PINNED sha | **PASS** — `i0g9kmal3il3lojjarucf` (base/Debian 12; ffmpeg 5.1.9+libx264 via apt; bun 1.4.2; the clone checked out at `300c035b4cf0…`, verified; `bun install --frozen-lockfile` 167 packages) | `sandbox-record.json` |
| The worker live on the PUBLIC interface | **PASS** — health 200/ok, the descriptor resolved (`probe`+`normalize`), the boot log's RESOLVED line; the companion 3973 compute worker live (the inherited posture kept bootable) | `sandbox-record.json` |
| The seam admission PASS through the remote worker | **PASS (MEASURED, x2)** — uploadState `stored`, checksumVerified, the worker job `succeeded` (execution 86–123 ms), the ledger cross-check; the Original leg executed (normalization 386–480 ms, the artifact 46 195 B sha `802c5c62…`, chain 7/7, playable, accounting identities, boundary honest) | `golden-path-seam.json`, `determinism.json`, `worker-stats.json` |
| The Vercel env wiring | **PASS** — 5 PATCHes 200 on the production target (MEDIA_TOOLCHAIN=http, MEDIA_TOOLCHAIN_URL→this sandbox, COMPUTE_WORKER_URL→this sandbox, COMPUTE_PROVIDER=http, the marker r607-e2b-rerun-1) | `deploy-record.json` |
| The deploy | **REFUSED (typed)** — `api-deployments-free-per-day` (>100), two attempts; deploymentId honestly null | `deploy-record.json`, `runs/deploy-{1,2}.txt` |
| The hosted golden path re-run | **NOT EXECUTED (honest)** — blocked by the deploy refusal; the current production measured DOWN at boot (the dead 62-c ephemeral URL) — the ephemerality doctrine's live proof | `hosted-golden-path.json`, `deploy-record.json` |
| The fail-closed validator + negative tests | **PASS** — validator exit 0; 5 crafted variants each refused exit 1 | `validate-evidence.ts`, `negative-tests.sh` |

## Credentials discipline

E2B_API_KEY + VERCEL_TOKEN env-only (`source /home/z/.sporta-env` per
command; never echoed, never committed — the validator's token scan covers
the whole evidence tree for the `e2b_`/`vcp_` token shapes, negative-tested).
