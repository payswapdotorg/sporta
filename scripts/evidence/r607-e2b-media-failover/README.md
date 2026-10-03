# R607/62-c — the E2B media failover through the adapter contract + the full hosted acceptance re-proof

Worker 62-c · 2026-10-03 · branch `r607/e2b-media-failover` · base `f3807d3`
(origin/main). The flight the operator dispatched: the R607 closure's open
half — the MEDIA path — via the adapter-contract failover (the operator's
infrastructure rule: *when a blocker is provider-class, move to the next
compatible provider through the EXISTING adapter contract, record the
provider used, never weaken criteria*), with E2B designated as the
ffmpeg-capable compute provider.

## What this run delivers

1. **The E2B media provider, behind the EXISTING adapter contract** (zero
   product-code change): one E2B sandbox (Debian 12 `base` template, apt
   ffmpeg 7:5.1.9 + libx264, bun 1.4.2) hosting the repo's OWN workers on
   the public interface —
   - port **3971**: the media-toolchain worker
     (`packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts`,
     the W914 seam's worker counterpart; a one-line additive HOSTNAME env
     support for the public bind), wired through
     `MEDIA_TOOLCHAIN=http + MEDIA_TOOLCHAIN_URL` — **the seam the hosted
     app's admission probe + Original normalization dispatch through**;
   - port **3973**: the full-plane compute worker
     (`packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts`,
     NEW additive evidence entry — the SAME registry + derived-reality plane
     the web app composes in-process), wired through
     `COMPUTE_PROVIDER=http + COMPUTE_WORKER_URL`.
   The PROVIDER RECORD (name, template, sandbox id, the live capability
   manifests, the measured ffmpeg identity): `provider-record.json`.
2. **The provider proven LIVE over the public wire** (`golden-path.json`):
   the REAL corpus clip's admission probe + normalization executing REAL
   ffmpeg on the E2B sandbox, hash-chained end-to-end, playable,
   same-provider byte-identical, honestly fail-closed against an
   unreachable worker, PLUS a REAL derived-reality render
   (tactical.prototype) executed by the E2B compute worker over the wire
   (the design-support measurement for the recorded admission gap).
3. **The hosted deployment with the failover wired** (deploy
   `dpl_DExXPovpx24BwkLFfS6gsJucpT76`, marker `r607-e2b-1`; redeploy
   `dpl_Cr9SwXQF3prrUACFzRQddhsgCzdo`, marker `r607-e2b-2` — the SAME
   revision): the fresh-browser golden path + the byte-identical recovery
   re-proof, with the fixture-path render EXECUTED ON THE E2B COMPUTE
   WORKER through the hosted app (the compute-adapter failover proven
   end-to-end).
4. **THE MEASURED GAP RECORD** (the honest center of this flight): the
   upload path's FIRST ffmpeg dependency — the R207 real-to-SWM decode —
   is NOT behind any adapter seam, and the derived-reality plane's
   ADMISSION is local-toolchain-gated; both close only through CONTRACT
   CHANGES (TL decisions, not worker improvisations) — the exact gaps and
   the integration designs below.

## THE MEASURED GAP RECORD (the anti-fabrication center — read this first)

The operator's directive assumed the 2026-09-26 hosted 500 ("ffprobe
executable not found on PATH") came from the upload admission's probe. This
run's stack-trace measurement CORRECTS the attribution and identifies the
TWO exact seams that keep the hosted media half closed even with the E2B
provider live and wired:

### Gap 1 — the R207 real-to-SWM decode (the upload path's FIRST blocker, upstream of the E2B seam)

- **The measured refusal** (verbatim, hosted, 2026-10-03 00:04:28Z):
  `Error [UnsupportedMediaError]: ffprobe executable not found on PATH; the
  ffmpeg adapter requires ffmpeg/ffprobe` — stack: `requireBinary ←
  FfmpegDecoderAdapter.probe ← DecodingService.probe ←
  RealToSwmPipeline.run ← createUploadSession` (the full excerpt in
  `hosted/golden-path/journey-log.md`). Typed class `media-invalid`,
  `missingBinary: ffprobe`; nothing stored (Library/Jobs stayed empty).
- **The seam fact**: `packages/real-to-swm/src/pipeline.ts:299` constructs
  `new FfmpegDecoderAdapter()` DIRECTLY — a LOCAL-ffmpeg dependency
  (packages/decoding's own subprocess wrapper) with **no env seam, no
  remote dispatch, no injection point**. It runs at step 3 of
  `createUploadSession`, BEFORE the media platform's admission (step 5) —
  the step that IS E2B-wired (`MEDIA_TOOLCHAIN=http`). The E2B media
  provider therefore never receives a dispatch from the hosted upload path.
- **Why it is a contract change**: routing the decode over a remote
  provider requires either (a) a new operation on the media-toolchain wire
  contract (a `decode`/`probe-decode` operation carrying the frame
  extraction semantics — `MediaToolchainOperation` is a closed enum
  `["probe","normalize"]`, the budgets/metering vocabulary would need the
  frame-budget axis, and the pipeline's async frame-iterator consumption
  pattern would need a batch/staged transport), or (b) a remote-capable
  `DecodingService` port (the adapter's interface is local-file-coupled:
  temp files + `AsyncIterable<NormalizedVideoFrame>` streams). Both are
  frozen-contract changes → **a TL decision**.
- **The integration design (delivered for that decision)**: extend the
  media-toolchain profile with a `decode-probe` operation (the wire request
  already carries inline base64 source bytes; the response would carry the
  probe document the R207 pipeline consumes — the SAME shape
  `MediaToolchainProbe` already defines) and a `decode-frames` operation
  with a bounded window (fromMs/toMs/maxTotalBytes ride the request; the
  frames return as a bounded base64 batch — the R207 pipeline's
  `decodeVideo` iteration becomes a single bounded fetch, which its own
  decode budget `STUDIO_UPLOAD_DECODE_BUDGET_BYTES` already implies). The
  composition change is ONE seam: `RealToSwmPipeline` accepts an injected
  decode-port (the same options-injection the repo's discipline uses
  everywhere else), and the web composition wires the E2B http executor.
  Estimated surface: pipeline options + one enum extension + the worker
  executor leg + the client mapping — all additive behind the existing
  W914 contract shape.

### Gap 2 — the derived-reality encode plane's ADMISSION (local-toolchain-gated even when execution is remote)

- **The measured honest states** (hosted, this run): all three derived
  realities disabled in the Create Studio with "no producer is registered
  for this reality on this control plane (the derived-reality encode plane
  is absent) — never invented" (`05-realities-honest-unavailable.png`); the
  Watch reality-switcher's Tactical/3D PRODUCER-UNAVAILABLE states; the
  plan path refuses `producer-unavailable`.
- **The seam fact**: `apps/web/src/server/derived-reality.ts:124` composes
  the plane ONLY when the LOCAL runtime probes ffmpeg+libx264
  (`createFfmpegFrameEncoder()` / `createFfmpegH264Codec()` — both null on
  the hosted Node runtime) → the plane is null → the plugins are never
  registered in the web registry → `derivedRealityProducers` is empty →
  the studio's admission (and `createRenderAsync`'s step-2 renderer
  resolution, which resolves from the LOCAL registry) refuse everything
  derived. The EXECUTION seam is remote-capable (`COMPUTE_PROVIDER=http`
  dispatches to the E2B compute worker — whose own plane IS composed and
  whose live descriptor advertises tactical/game-3d/anime-npr), but nothing
  connects the remote capability to the hosted admission.
- **Why it is a contract change**: closing it needs either (a) the
  composition to register the derived plugins when the remote compute
  worker's LIVE descriptor advertises the renderers (the admission then
  trusts the fetched descriptor — a change to the R508-R510 honesty
  posture "the plane exists ONLY when the real encode toolchain probes
  available", and the locally-constructed plugin instances would need
  codec/encoder objects that never execute locally), or (b) a
  descriptor-driven producer-declaration seam in the studio/options path
  (`createStudioService`'s `derivedRealityProducers` map + the control
  plane's registry resolution both become remote-aware). Both are semantic
  contract changes → **a TL decision**.
- **The design-support measurement delivered** (proving the remote
  execution half already works): `golden-path.json`
  `derivedRealityRemoteRender` — a REAL `tactical.prototype` dispatch
  executed by the E2B compute worker over the public wire (HTTP 200,
  succeeded, MP4 18 130 B, ftyp-verified, hash-chain verified at the
  receiving boundary, worker metering 286–339 ms execution). The E2B
  compute worker's live descriptor (provider-record.json) advertises
  `anime-npr.prototype, anime.prototype, game-3d.prototype,
  sporta.testcard, tactical.prototype`.

## THE ACCEPTANCE TABLE (every step's verdict + evidence pointer)

| Acceptance step | Result | Evidence |
|---|---|---|
| 0. The E2B provider provisioned (the designated ffmpeg-capable compute provider) | **PASS** — sandbox `ikv41gpq99jsnsadltfxr` (template `base`/`rki5dems9wqfm4r03t7g`, Debian 12, 2 vCPU/512MB, envd 0.6.10); ffmpeg `7:5.1.9-0+deb12u1` + libx264 via apt; bun 1.4.2; both workers live on the public interface; provisioning measured 33 041 ms | `provider-record.json` (`provisioning`) |
| 0b. The provider's live capability manifests (descriptor honesty) | **PASS** — media worker: operations `["probe","normalize"]`, MEASURED ffmpeg identity, resolved toolchain paths; compute worker: the 5-renderer capability list derived from its real registry; both fetched over the PUBLIC wire (HTTP 200) | `provider-record.json` (`workers.*.descriptor`) |
| 1a. The provider's media golden path over the public wire (the EXACT operations the hosted admission + normalization would dispatch) | **PASS** — the REAL 30 s corpus clip (1 771 681 B, sha `3a3c249e…`): admission client 1 275–1 407 ms (worker execution 82–102 ms, 1v/1a, duration 30 040 ms measured); normalization client 7 835–9 195 ms (worker execution 6 255–7 174 ms, ffprobe ×2 + ffmpeg ×1); artifact 2 724 908 B, sha `241d6a6e…`; hash chain 7/7; playable (moov@36, h264/aac); accounting identities hold (dispatched === succeeded+inFlight; usageRecords === terminal; stats/usage agree) | `golden-path.json` |
| 1b. Same-provider determinism (the non-degradation law at the provider boundary) | **PASS** — the same bytes re-dispatched → the SAME sha `241d6a6e…` (byte-identical within the provider); cross-build vs the driver's local ffmpeg 7.1.5 differs (the codec-build difference — recorded honestly, never laundered); cross-SANDBOX identity also measured (the fresh sandbox reproduced the same artifact sha) | `golden-path.json` `nonDegradation` |
| 1c. The derived-reality remote render (design support for Gap 2) | **PASS** — tactical.prototype over the wire: succeeded, MP4 18 130 B, ftyp, hash-chain verified | `golden-path.json` `derivedRealityRemoteRender` |
| 1d. The fail-closed boundary (an unreachable provider) | **PASS (honest)** — the typed `FfmpegUnavailableError` (the E2B proxy's 502 mapped to the honest admission-refusal class; never a faked transform) | `golden-path.json` `boundaryRecord` |
| 2a. Fresh-browser sign-up (hosted, deploy 1) | **PASS** — 200; `userId u-5e3fdf7d42054c489d523cc3902f5945` (Neon-backed) | `hosted/golden-path/02-signup-success-library.png` |
| 2b. Create → upload a REAL clip (admission must run ffprobe + store) | **REFUSED, TYPED — the corrected root cause**: HTTP 500; the server cause `UnsupportedMediaError: ffprobe not found on PATH` originating at the **R207 decode** (`RealToSwmPipeline.run` → `FfmpegDecoderAdapter` — packages/decoding, hardwired local, NO seam) — UPSTREAM of the E2B-wired admission seam; nothing stored (Library/Jobs honestly empty). The E2B media provider is LIVE and wired (the boot banner) but never reached by the upload path | `hosted/golden-path/08-upload-refused-typed.png`; `hosted/api-captures/upload-refusal-500.json`; the stack excerpt in `journey-log.md` |
| 2c. Rights declaration | **PASS** — operations defaulted; the derived preview honestly reflects Gap 2 | `hosted/golden-path/04-rights-step.png` |
| 2d. Compute choice | **PASS** — the http compute plane wired to the E2B worker (the boot-time live descriptor fetch succeeded — health 200 proves it); the transparency panel shows the configured plane | `hosted/golden-path/06-compute-step.png` |
| 2e. Processing + four outputs (Original/Tactical/3D-Game/Anime) | **BLOCKED UPSTREAM (the two recorded gaps)** — the honest states measured: derived realities "not offered: no producer is registered…" (Gap 2); the upload's Original normalization unreachable behind the R207 decode refusal (Gap 1). The provider-side capability is PROVEN (rows 1a/1c) — the missing pieces are the two contract changes | `hosted/golden-path/05-realities-honest-unavailable.png`; `journey-log.md` |
| 2f. Watch (real MP4 playback of the four outputs) | **BLOCKED UPSTREAM** (no upload session exists — the admission stored nothing by design); the supplementary fixture session's Watch PASSes (the review-format artifact, the frame player) — and the artifact that plays was COMPUTED ON E2B | `hosted/golden-path/11/13/14/15` |
| 2g. Reality Switcher (URL-addressable, session constant) | **PASS** — `?reality=tactical` / `?reality=anime-npr`; the four honest per-reality states | `hosted/golden-path/13-watch-switch-tactical-unavailable.png`, `14-watch-url-anime-selected.png` |
| 2h. The compute-adapter failover THROUGH the hosted app (the E2B compute provider executing a real render) | **PASS** — the fixture session's render job `render-job-sess-u-a16e733f…-1` EXECUTED ON THE E2B COMPUTE WORKER (the worker's own record: succeeded, artifact `1d5d07df…`, 19 733 B image/svg+xml); the artifact landed through the app's render-output writer into R2 and served hash-verified | the E2B worker's job record (quoted in `deployment.json`); `hosted/api-captures/artifact-before-redeploy.json` |
| 2i. Library/Jobs | **PASS (honest states)** — Library lists the fixture session; Jobs shows the documented per-instance ledger boundary | `hosted/golden-path/10-library-lists-session.png`, `12-jobs-listing.png` |
| 3. Redeploy (distinct new deployment, same revision) | **PASS** — `dpl_Cr9SwXQF3prrUACFzRQddhsgCzdo` (`r607-e2b-2`), READY, alias serving, marker verified, all providers ok | `deployment.json` `deployments[1]` |
| 4. Recovery: identity | **PASS** — fresh sign-in → SAME `userId`; the pre-redeploy cookie resolves on the new deployment | `hosted/recovery/recovery-proof.md` |
| 4. Recovery: session/library | **PASS** — 1 row before/after (same row) | `hosted/recovery/02-recovery-library.png` |
| 4. Recovery: watch playable | **PASS** — the same renderId; the artifact plays | `hosted/recovery/03-recovery-watch-recovered.png` |
| 4. Recovery: artifacts | **PASS — BYTE-IDENTICAL** — sha-256(served) == declared `1d5d07df…` BEFORE and AFTER; 19 733 B; `x-sporta-artifact-source: r2` both times | `hosted/recovery/recovery-proof.md` (the byte-level table) |
| Console errors (both browsers, all stages) | **0** | both logs |

## The verdict line (honest)

**The E2B provider failover through the EXISTING adapter contract is
DELIVERED and PROVEN at both boundaries it can reach: the repo's own
media-toolchain worker executes the REAL admission probe + Original
normalization of the REAL corpus clip on an E2B sandbox over the public
wire (hash-chained, playable, same-provider byte-identical, honestly
fail-closed), and the repo's own full-plane compute worker — wired through
`COMPUTE_PROVIDER=http` — EXECUTED a real hosted render job dispatched by
the deployed Vercel app (the compute-adapter failover end-to-end, the
artifact landing hash-verified in R2 and recovered byte-identically across
a redeploy). The hosted upload golden path nonetheless REMAINS
MEASURED-BLOCKED — at TWO precisely-recorded contract gaps, not at the
provider: (1) the R207 real-to-SWM decode (the upload path's FIRST ffmpeg
call, `RealToSwmPipeline`'s hardwired local `FfmpegDecoderAdapter`, NO
seam — the true origin of the 2026-09-26 refusal, now stack-trace-proven
and correctly attributed), and (2) the derived-reality plane's ADMISSION
(the web composition's local-toolchain gate keeps the producers map empty
even when the remote E2B worker advertises and can execute them). Both
closures are contract changes — the integration designs are delivered
above for the TL decision; nothing was weakened, nothing faked, nothing
stored on refusal.**

## Where the evidence lives

| Path | Content |
|---|---|
| `provider-record.json` | the E2B provider record (name, template, sandbox, region evidence, toolchain identity, BOTH live capability manifests, the boot logs) |
| `golden-path.json` | the provider-boundary golden path (admission/normalize/hash-chain/playability/non-degradation/remote-derived-render/boundary/accounting — every number measured) |
| `provision-e2b.ts` / `golden-path.ts` | the re-runnable drivers (verbatim command classes in `commands.md`) |
| `deployment.json` | the two deployment ids/urls/revisions/markers + the env wiring + the identities + the fixture probe + the credentials discipline |
| `hosted/golden-path/` | 15 stage screenshots + `journey-log.md` (routes, API responses, the corrected root-cause record) |
| `hosted/api-captures/` | the typed refusal envelope, the watch models before/after, the artifact documents + headers before/after, the library/auth captures |
| `hosted/recovery/` | 4 screenshots + `recovery-proof.md` (the byte-level before/after table) |
| `packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts` | the new additive evidence entry (the full-plane compute worker) |
| `packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts` | the existing worker entry + the one-line additive HOSTNAME env (the public bind) |
| `REPORT.md` (repo root) | the flight report (leg verdicts, the changed-file list, the next measured gap) |

## Credentials discipline

VERCEL_TOKEN and E2B_API_KEY were env-only (loaded per command; never
echoed into logs, never committed). The committed tree was scanned for the
`vcp_` / `e2b_` / `napi_` prefixes before every checkpoint commit — zero
matches. The session cookie values appear only as opaque references in the
worker's scratch captures (single-session beta credentials bound to the
disposable acceptance identity).
