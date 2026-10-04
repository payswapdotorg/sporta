# REPORT — Worker 65-j, flight 16: R607 lane B — the E2B external toolchain worker + the hosted re-run

- Branch: `work/r607-e2b-hosted-rerun` (from main @ `300c035b4cf0a0e89a4a08c465d9d0104a9b3efd`)
- Evidence tree: `scripts/evidence/r607-e2b-hosted-rerun/` (ADD-only; no FROZEN-contract or prior-evidence edits)
- Credentials: E2B_API_KEY + VERCEL_TOKEN runtime-env only (`/home/z/.sporta-env`); never committed (validator-scanned, negative-tested)

=== R607 HOSTED RE-RUN REPORT ===

## 1. The sandbox record (the E2B external toolchain worker)

- Sandbox `i0g9kmal3il3lojjarucf` (E2B template `base`, Debian 12, 2 vCPU; keep-alive 2h — EPHEMERAL by design).
- The pinned revision: `300c035b4cf0a0e89a4a08c465d9d0104a9b3efd` — the repo was `git clone`d INSIDE the sandbox and checked out at exactly this sha (the orchestration fails closed on any other HEAD; verified). `bun install --frozen-lockfile`: 167 packages.
- The toolchain measured in-sandbox: ffmpeg `5.1.9-0+deb12u1` + libx264 (apt), ffprobe at `/usr/bin/ffprobe`, bun 1.4.2.
- The worker: the repo's own `packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts`, started `HOSTNAME=0.0.0.0 PORT=3971` from the checked-out clone. Boot log: `toolchain: RESOLVED — ffmpeg '/usr/bin/ffmpeg' / ffprobe '/usr/bin/ffprobe'`; budgets maxExecutionMs=120000, ONE ffmpeg at a time.
- The PUBLIC URL verified from this orchestrating sandbox (the same network position the Vercel runtime holds): `https://3971-i0g9kmal3il3lojjarucf.e2b.app/health` → HTTP 200 ok=true; `/v1/media/adapter` → HTTP 200, toolchain resolved, operations `[probe, normalize]`.
- The companion 3973 compute worker (the repo's own `r607-e2b-compute-worker.ts`) also live — the inherited `COMPUTE_PROVIDER=http` project posture requires a live compute worker at boot (the descriptor fetch is fail-loud), recorded honestly as infrastructure, not this flight's subject.

## 2. The deploy record (the env wiring EXECUTED; the deploy REFUSED — typed)

- Env wiring (the brief's `vercel env add` command class, PATCH-adapted because the 62-c posture had already created the vars pointing at the now-dead 62-c sandbox): MEDIA_TOOLCHAIN=http, MEDIA_TOOLCHAIN_URL=https://3971-i0g9kmal3il3lojjarucf.e2b.app, COMPUTE_WORKER_URL=https://3973-i0g9kmal3il3lojjarucf.e2b.app, COMPUTE_PROVIDER=http, SPORTA_DEPLOY_MARKER=r607-e2b-rerun-1 — five PATCHes, all HTTP 200, production target.
- The deploy (`bunx vercel deploy --prod --yes --token $VERCEL_TOKEN --project sporta --scope ekonplacidegmailcoms-projects`, from the repo root): **REFUSED twice** by the provider's free-tier daily deployment quota — `Resource is limited - try again in 24 hours (more than 100, code: "api-deployments-free-per-day")`. The CLI retrieved the project and uploaded the 4.8 MB build; the deployment CREATION was refused. NOT a token/permission failure (the env PATCHes + reads all 200), NOT a build failure.
- `deploymentId`: **honestly null** — no deployment landed, so the re-pointed env never took effect (Vercel env values are captured at deploy time), and the hosted runtime NEVER dispatched to this flight's worker.
- The current production MEASURED (the ephemerality doctrine's live proof): the alias serves the 62-c deployment `dpl_Cr9SwXQF…` whose BAKED `COMPUTE_WORKER_URL` is the long-dead 62-c sandbox — the E2B proxy answers 502 and the composition's fail-loud boot descriptor fetch throws: root HTML 200, `/api/platform/health` 500, `POST /api/auth/register` 500 (errorId d01b946e-…; the verbatim runtime log is in deploy-record.json). **The hosted API plane has been down since the 62-c sandbox died — the measured cost of baking an ephemeral worker URL into production.**

## 3. THE GOLDEN PATH VERDICT (measured)

- **The seam-level upload admission PASSED through the remote E2B worker — MEASURED, twice (byte-identical)**: `golden-path-seam.json` (the prior W914 golden-path schema + the workerIdentity block). The admission: the real ffprobe dispatch on the received bytes executed IN the E2B sandbox (worker execution 86–123 ms; client wall 385–415 ms; uploadState `stored`; checksum verified; the worker job `succeeded`; the job ledger cross-checked against the usage drain). The four-reality pipeline's Original leg: the normalization (ffprobe x2 + ffmpeg x1, worker execution 386–480 ms) and the original-reality artifact (46 195 B, sha-256 `802c5c620779a1fe…`, hash chain 7/7 links, playable moov@36<mdat@2824, h264/aac, 2000 ms) — all executed by the sandbox's real ffmpeg over the public wire. The accounting identities hold (dispatched 2 === terminal 2; usage records 2 === terminal; stats === the usage drain, two independent reads agreeing). The fail-closed boundary class reproduces honestly over the wire.
- **The HOSTED golden path re-run did NOT execute** (the honest typed partial): blocked by the deploy refusal — `hosted-golden-path.json` records `blocked-deploy-quota-refused`, the measured current-production state, and the code-measured EXPECTED upload outcome at this pinned sha for the TL's re-run: the hosted upload will refuse at the R207 real-to-SWM decode (`new FfmpegDecoderAdapter()`, no seam, upstream of the E2B-wired admission step — the 62-c Gap 1, unchanged at `300c035`, git-diff-verified this flight). Closing that is the R607 gap flight A (a frozen-contract change — the TL's decision; the 62-c integration design stands).
- The worker's own stats: `worker-stats.json` — dispatched 2 / succeeded 2 / failed 0 / usageRecords 2 / probeRuns 3 / transcodeRuns 1 / in 92 152 B / out 46 195 B / totalExecutionMs 472 (equals the record's accounting block — the validator machine-checks the equality).

## 4. The ephemerality doctrine (recorded first-class)

The E2B worker URL is ephemeral evidence: the sandbox dies at its 2h keep-alive, and this flight MEASURED what happens to a hosted deployment that bakes one — the 62-c production API plane is down RIGHT NOW because its baked worker URL died with its sandbox. The media-half is CLOSED AS EVIDENCE to exactly this extent: the seam (env-wired on the production target), a real external toolchain worker at the pinned revision, and the admission PASSING through it — executed twice, recorded, never simulated. The PRODUCTION posture still needs a persistent worker host (the operator's infrastructure choice); never claim more than the executed runs prove.

## 5. The gates + the honest limits

- `validate-evidence.ts` exit 0 (fail-closed: structure, the admission-PASS ledger cross-check, the hash chain, the honest-null deployment id, the token scan) — **negative-tested 5/5** (`negative-tests.sh`: the fabricated admission-PASS refused, the laundered deploy id refused, the token-shaped leak refused, the stats disagreement refused, the laundered determinism refused; the committed tree passes).
- `bunx prettier --check .` whole-repo clean; `bunx eslint` 0 errors on the new TS.
- What was NOT completed: the Vercel production deploy (the provider's typed free-tier quota refusal — the recovery procedure is recorded and re-runnable in commands.md §6: a fresh sandbox → the two PATCHed URLs → the deploy → the hosted golden path), and therefore the hosted runtime's own dispatch to the E2B worker. What the TL must re-verify first-hand: the sandbox record + the seam golden path against a live worker (re-run orchestrate-e2b.ts + golden-path-seam.ts), the deploy after the quota resets, and the R207-decode refusal attribution when the hosted upload lands.

=== END REPORT ===
