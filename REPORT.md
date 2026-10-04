# REPORT — the TL delivers the R607 decode-seam recovery (the quota-window re-run at the seam merge)

- Branch: `work/r607-decode-seam-recovery` (from main @ `920c556c18ba984d22d4bea50895b6a173b0a4bd` — the decode-seam merge)
- Evidence tree: `scripts/evidence/r607-decode-seam-recovery/` (ADD-only; no FROZEN-contract or prior-evidence edits)
- Credentials: E2B_API_KEY + VERCEL_TOKEN runtime-env only (`/home/z/.sporta-env`); never committed (validator-scanned, negative-tested)

=== R607 DECODE-SEAM RECOVERY REPORT ===

## 1. The sandbox record (the E2B worker at the seam merge)

- Sandbox `ifw657jm8lpa5feut1xvr` (E2B template `base`, Debian 12, 2 vCPU; 2h keep-alive — EPHEMERAL by design).
- The pinned revision: `920c556c18ba984d22d4bea50895b6a173b0a4bd` — the DECODE-SEAM MERGE (R607 gap flight A: the injected decode-port + the ADDITIVE `decode-probe`/`decode-frames` wire pair). The in-sandbox `git clone` checked out EXACTLY this sha (fail-closed on any other HEAD); `bun install --frozen-lockfile` 167 packages.
- The toolchain measured in-sandbox: ffmpeg `5.1.9-0+deb12u1` + libx264, ffprobe at `/usr/bin/ffprobe`, bun 1.4.2.
- **The descriptor advertises the seam's FOUR operations: `[probe, normalize, decode-probe, decode-frames]`** — verified over the public URL from THIS orchestrating sandbox (the same network position the Vercel runtime holds).
- The companion 3973 compute worker STARTED AND MEASURED on fresh provision (the 65-j orchestration gap, fix-forwarded — the inherited `COMPUTE_PROVIDER=http` posture requires a live compute worker at the composition's fail-loud boot). Two orchestration attempts lost the nohup start commands' RPC responses to the E2B SDK's `deadline_exceeded` while the commands EXECUTED in-sandbox (the workers booted) — the starts are now IDEMPOTENT (health-check-first, start-if-down) with the bounded health wait as the arbiter.

## 2. The live decode-seam leg (the seam's client over the public wire)

- **The W102 demux-level probe document over the wire**: container `mp4`, tracks `[video, audio]`, the video stream index selected — real ffprobe INSIDE the E2B sandbox, 386 ms wall.
- **The bounded frame batch over the wire**: 48 REAL frames (2 s @ 24 fps), 11 059 200 measured bytes (the exact 48 × 230 400 rgb24 byte-math), 320×240 rgb24, monotonic presentation times, the cumulative budget respected, 2 150 ms wall — real ffmpeg decoding inside the sandbox, delivered over the public wire as classified envelopes, every frame's bytes re-measured client-side.
- **The typed fail-closed budget refusal over the wire**: a 100-byte budget → `ResourceLimitError` (the same typed class the local path's callers see). One earlier honest refusal is itself recorded in the ledger: the driver's first run declared an 8 MiB budget for a clip that decodes to 11 MB — the seam's fail-closed frame budget refused TYPED; the driver now mirrors the studio's own 1 GiB `STUDIO_UPLOAD_DECODE_BUDGET_BYTES`.
- **The accounting identities hold**: the usage drain === the dispatched count (two independent reads); the stage deltas exactly [probe +1/1/0, frames +1/1/0, refusal +1/0/1] against the measured starting ledger.

## 3. The deploy (LANDED — the 65-j typed block did not reproduce)

- The env wiring BEFORE the deploy (three PATCHes, all HTTP 200, production target): `MEDIA_TOOLCHAIN_URL` → `https://3971-ifw657jm8lpa5feut1xvr.e2b.app`, `COMPUTE_WORKER_URL` → `https://3973-ifw657jm8lpa5feut1xvr.e2b.app`, `SPORTA_DEPLOY_MARKER` → `r607-decode-seam-rerun-1` (MEDIA_TOOLCHAIN=http + COMPUTE_PROVIDER=http unchanged from the 65-j PATCHes).
- **The deploy LANDED**: `dpl_9i2uAP6kHyTLYmM8pApqppiNrogi`, READY, `sporta-4mtdi6idm-ekonplacidegmailcoms-projects.vercel.app`, serving the production alias `https://sporta-flame.vercel.app`. The 65-j account-wide free-tier refusal (`api-deployments-free-per-day`, >100, at ~08:55Z Oct 4) did NOT reproduce at ~10:48Z — the window had reset. The deployment id is LIVE cross-checked at the provider by the validator (READY + production + the recorded URL; a laundered id is refused — negative-tested).
- **The production-500 incident is CLOSED**: `/api/platform/health` answers 200 with `deployMarker: r607-decode-seam-rerun-1` — the boot-time compute-worker descriptor fetch SUCCEEDS against the live companion worker (the 62-c deployment with the dead baked URL is superseded).

## 4. THE HOSTED GOLDEN PATH — THE CLOSURE (measured)

- **The hosted runtime's OWN dispatch through the seam**: register 200 (fresh `creator`+`viewer` account) → login 200 (session cookie) → **`POST /api/create/upload-sessions` HTTP 201 in ~4.6 s** — the source asset `stored` + `checksumVerified`, the R207 decode EXECUTED OVER THE WIRE (the E2B worker's real ffmpeg), the perception ran on the 48 decoded frames (the honest degradation semantics recorded — calibration-unavailable ×1, candidate-refused ×3, … the pipeline's own honest states for a 2 s test clip), and the media job reached **TERMINAL: `state: succeeded`, `progress: 1`, stages through `normalization-complete`** (the four-reality pipeline's Original leg).
- **The Gap 1 verdict**: the upload leg that refused at `new FfmpegDecoderAdapter()` (ffprobe absent on the hosted runtime) at EVERY pre-seam sha — the 62-c Gap 1, code-measured by the 65-j flight as the honest expectation — now PASSES through the seam exactly as the 62-c integration design specified. The R607 arc (the external toolchain worker → the seam → the hosted dispatch) is closed end-to-end with executed evidence at both clients (the driver over the public wire AND the hosted Vercel runtime itself).
- The worker's final stats: 17 dispatched / 15 succeeded / 2 failed (both typed honest refusals — the frame-budget refusal pair) / 0 in-flight / 20 probe runs / 9 transcodes / 44.3 MB out — `worker-stats.json`, the identities machine-checked.

## 5. The gates

- `validate-evidence.ts` exit 0 (fail-closed: the pinned seam merge, the four-operation profile, the live decode measurements, the LANDED deploy with the LIVE provider cross-check, the hosted closure chain, the token scan) — and **6/6 negative tests refused with the check named** (the fabricated hosted closure, the laundered deployment id, the token-shaped leak, the stats disagreement, the wrong pinned sha, the incomplete operation profile).
- `bunx prettier --check .` whole-repo clean; `bunx eslint` 0 errors on the flight's files.

Stage Summary: R607 is CLOSED end-to-end — the seam (flight A, CI green at 920c556), the live decode-seam leg (measured over the public wire), the LANDED deploy (the quota window reset; the production-500 incident closed), and the hosted golden path (the upload admission through the seam + the terminal succeeded media job). The remaining roadmap: the operator-gated items (R606's human visual gate, L009's provider feed) and the next dispatchable per the repo's roadmap.
