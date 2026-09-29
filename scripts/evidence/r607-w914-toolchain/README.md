# R607 lane B — the W914 media-toolchain unblock (the http compute adapter against a REAL toolchain worker)

Worker B · 2026-09-29 · branch `r607/w914-toolchain-worker` · base `ad71969`
(origin/main). The increment the repo's own R607 row names: *"closing it
requires the W914 http compute adapter against a real toolchain worker or
an ffmpeg-shipping host (beyond the Hobby beta-personal boundary)"* — this
sandbox **ships ffmpeg/ffprobe** (`/usr/bin/ffmpeg`,
`ffmpeg version 7.1.5-0+deb13u1`), so a **local Bun-served HTTP toolchain
worker IS a real toolchain worker**, and the adapter mechanism is proven
end-to-end here.

## The design (what landed, where)

| Piece | Path | Role |
|---|---|---|
| The wire contract | `packages/media-platform/src/toolchain.ts` | the typed, JSON-safe, zod-strict media-toolchain dispatch shapes: `MediaToolchainDispatchRequest` (transport-safe job description + the INLINE base64 `source-media` input), `MediaToolchainResult` (the classified result envelope — success carries the measured probe / the normalized output + the original-reality artifact; failure carries `errorClass`/`terminal`/`failureClass`), `MediaToolchainDescriptor` (honest capability discovery), the fail-closed `MediaToolchainBudgets`. Reuses the Wave-1 `@sporta/compute-adapter` vocabulary VERBATIM (`ComputeRightsPosture`, `ComputeJobConstraints`, `ComputeCostUnit`); the frozen Wave-1 materialized layer is untouched (it refuses `source-media` by design — the media profile defines its own dispatch shape) |
| The worker-side executor | `packages/media-platform/src/toolchain-executor.ts` | `executeMediaToolchainJob`: one dispatch → one REAL operation (ffprobe admission probe / ffmpeg canonical normalize) resolved as a classified envelope — NEVER a throw across the seam, never silence. Re-measures the dispatch's source claims (byte length, then sha-256) and refuses lying claims; fail-closed budgets by MEASUREMENT (outputs discarded on breach); the artifact block carries the hash chain (source → normalized) with `integrity.verified` EARNED by re-hashing the produced bytes. PLUS `InProcessMediaToolchain` — the DEFAULT `MediaToolchainExecutor` (the REAL `FfmpegTool` in this process; the pre-seam pipeline's own operations, byte-identical) |
| The worker application | `packages/compute-adapter-hosted/src/media-worker.ts` | `MediaToolchainWorker`: the honest descriptor (MEASURED `ffmpeg -version` identity; an unresolved toolchain advertises `operations: []` — nothing it cannot execute), jobId-idempotent execution (a re-POST returns the SAME envelope, counted as a duplicate), bounded fail-closed concurrency (ONE ffmpeg at a time — the memory discipline), per-job records, whole-worker metering, ONE `ComputeUsageRecord` (the Wave-1 schema VERBATIM) per terminally-disposed job, and the accounting identities `assertMediaToolchainAccounting` (dispatched === terminal + in-flight; usageRecords === terminal) |
| The HTTP surface | `packages/compute-adapter-hosted/src/media-http.ts` | the transport-free handler + `Bun.serve` wrapper: `POST /v1/media/jobs/execute` → `{disposition, result}` (the result envelope; 400/503 for malformed-body/invalid-dispatch/capacity), `GET /v1/media/adapter` (the honest descriptor), `GET /health`, `GET /v1/media/jobs/:jobId` (the worker-side record), `GET /v1/media/usage` (the metering drain), `GET /v1/media/stats` (the accounting snapshot) |
| The HTTP client | `packages/media-platform/src/toolchain-http.ts` | `createHttpMediaToolchain`: the `MediaToolchainExecutor` whose operations are ONE dispatch each over real HTTP (client-measured claims attached; every answer envelope validated fail-loud; on success the delivered bytes are RE-HASHED and the hash chain verified at the RECEIVING boundary — a lying provider is refused, never trusted; classified failures map onto the media platform's OWN typed errors by the carried `failureClass`, never guessed; transport faults → the typed `FfmpegUnavailableError` — fail-closed) |
| The composition seam | `packages/media-platform/src/toolchain-env.ts` + `apps/web/src/server/composition.ts` | env-driven selection: `MEDIA_TOOLCHAIN=in-process` (the DEFAULT, including unset — `Bun.which`, byte-identical, the typed ffprobe-absent admission refusal stays honest when NO toolchain is configured) \| `MEDIA_TOOLCHAIN=http + MEDIA_TOOLCHAIN_URL=<worker url>` (the SAME operations through the toolchain worker — **the seam the hosted control plane uses with an external toolchain URL**) |
| The entry points | `packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts` (the standalone worker, fixed port 3971) + `scripts/r607-w914-golden-path.ts` (this evidence driver) | development-time/evidence entries, not tests |

`@sporta/control-api`'s public surface is UNTOUCHED (G2 adoption out of
scope, per the work order). No existing schema/class was modified: every
new refusal/envelope class is additive and typed
(`MediaToolchainResourceError`, the closed `MEDIA_TOOLCHAIN_ERROR_CLASSES`
vocabulary, the `ffmpeg-unavailable` boundary class reproduced at the
worker boundary).

## Where the evidence lives

| Path | Content |
|---|---|
| `golden-path.json` | the PRIMARY machine record of the golden path (external-worker run 4): the fetched descriptor, the source sha, both job records, the manifest/artifact records, the hash-chain verification, the playability probe, the accounting snapshot + the full usage records, the boundary record |
| `runs/external-{1,2,3,4}.txt` | the driver's stdout for the four external-worker runs (the honest measured numbers) |
| `runs/worker-log-{1,2,3,4}.txt` | the standalone worker's own boot + SIGTERM ledger for the same runs (the worker's OWN accounting, independent of the driver's over-the-wire read) |
| `runs/golden-path-run2.json` | run 2's full record (the determinism comparison) |
| `runs/non-degradation-byte-identity.txt` | the in-process-vs-http-worker BYTE-IDENTITY measurement (sha256sum, both seams over the same source) |
| `commands.md` | the verbatim re-runnable command classes |

## RESULTS — the golden path (all numbers MEASURED, nothing simulated)

The topology of the primary evidence: **the standalone worker process**
(`r607-media-toolchain-worker.ts`, port 3971) **and the driver in a
SEPARATE process** dispatching over the real HTTP wire — the exact shape
the hosted control plane would use with an external toolchain worker URL.

| Step | Result (run 4; ranges over runs 1–4 where they vary) | Evidence |
|---|---|---|
| The worker's honest descriptor | RESOLVED: `operations: ["probe","normalize"]`, ffmpeg `/usr/bin/ffmpeg`, ffprobe `/usr/bin/ffprobe`, measured identity `ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026 the FFmpeg developers`, budgets (120 s execution / 200 MB source / 200 MB artifact / **maxConcurrentJobs 1**) | `golden-path.json` `descriptor` |
| The source clip | REAL ffmpeg generation (lavfi testsrc + 440 Hz sine, 2 s, 320×240, 24 fps): 46 076 bytes, sha-256 `4a347893921b2e21fa991d72c217c01b19953db5d72bab0efc36e4574de5bd4b` (cross-verified with `sha256sum` on the bytes) | `runs/non-degradation-byte-identity.txt` |
| Admission (rights → magic-byte → **ffprobe on the received bytes, dispatched to the worker**) | PASS: asset `stored`, `checksumVerified`, duration MEASURED 2000 ms, 1 video + 1 audio stream; worker job `mtjob-be8021c627b73a2c903ef90ab45dca57`; client 91 ms (runs 91–110 ms) / worker execution 67 ms (runs 67–86 ms) | `golden-path.json` `stages.admission` |
| Normalization (**REAL ffmpeg on the worker**, measured manifest) | PASS: worker job `mtjob-9e2700f4231dd71717ace3add24ab707`, ffprobe ×2 + ffmpeg ×1 (metered), client 310 ms (runs 310–323 ms) / worker execution 296 ms (runs 296–308 ms) | `golden-path.json` `stages.normalization` |
| The original-reality artifact | 46 193 bytes, sha-256 `964cec11407a9c688877c4df9119fd8e96bb034039a8da61a965db6691a7afce`; the hash chain verified at THREE levels: the worker envelope (`sourceContentHash` → `contentHash`), the client (delivered bytes re-hashed), the control plane (stored bytes re-read + re-hashed == manifest == artifact) — 7/7 links | `golden-path.json` `hashChain`, `artifact` |
| Playable | TRUE: `moov`@36 BEFORE `mdat`@2823 (the +faststart canonical form), driver-side real ffprobe of the STORED bytes: h264/aac, 2000 ms | `golden-path.json` `playability` |
| The accounting snapshot | `dispatched=2 === succeeded(2) + failed(0) + inFlight(0)`; `usageRecords=2 === terminal(2)`; the usage drain (independent read) agrees (2); metering: probeRuns=3, transcodeRuns=1, inputBytes=92 152, outputBytes=46 193, totalExecutionMs=363; the worker's OWN SIGTERM ledger says the same (`dispatched=2 succeeded=2 failed=0 inFlight=0 usageRecords=2`) | `golden-path.json` `accounting`; `runs/worker-log-4.txt` |
| Determinism (re-runnable) | FOUR runs, four FRESH worker processes: source sha identical, artifact sha identical, moov/mdat offsets identical, accounting shape identical; only timings and job ids vary (measured, recorded per run) | `runs/external-{1,2,3,4}.txt` |
| Non-degradation at the BYTE level | the SAME source through the DEFAULT in-process seam and through the http worker → **byte-identical normalized output** (`964cec…` from both, sha256sum-verified) — routing through the seam changes nothing but the transport | `runs/non-degradation-byte-identity.txt` |
| The honest boundary record | an unresolved-toolchain worker (bogus binary paths) advertises `operations: []` and REFUSES the same probe dispatch with the classified `ffmpeg-unavailable` envelope (`terminal: internal`, `failureClass: internal`, zero tool runs metered) — **the R607 hosted boundary class reproduced deterministically at the worker boundary, honest, nothing faked** | `golden-path.json` `boundaryRecord` |

## The verdict line (honest)

**The W914 http compute adapter mechanism is PROVEN end-to-end on a real
toolchain plane: a real upload's admission probe AND normalization execute
REAL ffmpeg/ffprobe inside a real Bun-served HTTP worker process, the
original-reality artifact comes back content-addressed and hash-chained
(verified at the worker, the client, and the control plane), playable, and
metered with the accounting identities holding over the wire; the DEFAULT
in-process path is byte-identical (the non-degradation law measured at the
byte level), and the typed ffprobe-absent refusal stays honest at every
boundary where no toolchain resolves.** What this closes locally is the
adapter MECHANISM (the seam + the worker profile + the proof); the HOSTED
(Vercel) re-run remains operator-gated: it needs a `VERCEL_TOKEN` and an
EXTERNAL toolchain worker URL reachable from the hosted runtime — this
sandbox's `127.0.0.1:3971` worker is real but not reachable from Vercel,
and nothing here fakes that.

## The honest boundary statement (operator-gated, never laundered)

The R607 status row's media half ("upload REFUSED at admission with the
typed ffprobe-absent class — the hosted Node serverless runtime ships no
ffmpeg/ffprobe") is now closable by CONFIGURATION, and only by
configuration: deploy with `MEDIA_TOOLCHAIN=http` +
`MEDIA_TOOLCHAIN_URL=<an external toolchain worker URL>` (e.g. this same
`r607-media-toolchain-worker.ts` running on any ffmpeg-shipping host,
reachable from the Vercel runtime). That re-run requires the operator's
`VERCEL_TOKEN` and an external worker — **neither exists in this sandbox,
so the hosted re-run was NOT executed and NOT simulated**; every number in
this evidence pack is from the local real-HTTP plane (a real worker
process, a real socket, a real ffmpeg), clearly labeled as such.

## Known classes / boundaries of this increment

1. **The worker's ledger and store are process-local** (same as the render
   profile at Wave 2): durable idempotency across worker restarts is
   audit gap G7/W913; the R2-backed artifact store is W912 — the inline
   base64 delivery mode is the documented intermediate.
2. **Wire auth on the worker boundary is audit gap G8** (W902/W910): the
   local worker serves unauthenticated by design; the hosted deployment
   wraps it. `capacity` refusals are HTTP 503, `invalid-dispatch`/`invalid-body`
   are 400 — classified, never silent.
3. **One ffmpeg at a time** (`maxConcurrentJobs: 1`): a concurrent
   dispatch is refused determinately (`capacity`, 503, counted) rather
   than queued silently — the memory discipline; raising it is a
   config decision backed by the machine's measured headroom.
4. **The 200 MB/120 s budget defaults** derive from the media platform's
   own frozen R101/R102 bounds (`UPLOAD_CONSTRAINTS`), not from any
   hosted-provider limit — a hosted deployment overrides them via the
   worker's options.
5. **No automatic retries** (the render profile's Wave-2 posture): a
   transport fault resolves the typed `FfmpegUnavailableError` fail-closed
   on the dispatching side; W913 owns recovery.

## The test batteries (non-degradation)

- `packages/compute-adapter-hosted`: **104 pass / 0 fail** (main: 84
  across 8 files; the media-toolchain profile ADDS 20 tests across
  `test/media-toolchain.test.ts` + 1 stats-route case) — the pre-existing
  8 files are UNMODIFIED and green.
- `packages/media-platform`: **28 pass / 0 fail** (main: 16 across 1
  file; the seam ADDS 12 tests in `test/toolchain.test.ts`) —
  `test/media-platform.test.ts` is UNMODIFIED and green.
- `tsc --noEmit` clean for `media-platform`, `compute-adapter-hosted`, and
  `apps/web` (the composition wiring).

## Re-running

See `commands.md` — every command class is verbatim and re-runnable at the
branch tip (worker + driver + batteries + the sha cross-verifications).
