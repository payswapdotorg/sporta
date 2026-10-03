# R607/62-c — the hosted golden-path journey log (fresh browser, public URL, the E2B failover wired)

Worker 62-c · 2026-10-03 00:02–00:11 UTC · deployment `r607-e2b-1`
(`dpl_DExXPovpx24BwkLFfS6gsJucpT76`, revision `89ae99e` = main `f3807d3` + evidence/dev
scripts only — ZERO product-code deltas) · browser automation: agent-browser
(Chromium, headless, fresh context — no cookies, no service-worker state, no
pre-seeded auth).

- **URL base**: `https://sporta-flame.vercel.app` (the production alias).
- **Test identity** (fresh-registered through the public UI): username
  `r607e2b-accept-1790985805`, userId `u-5e3fdf7d42054c489d523cc3902f5945`.
- **The failover wiring on this deployment** (pure env configuration, the
  W914 adapter seams): `MEDIA_TOOLCHAIN=http → https://3971-ikv41gpq99jsnsadltfxr.e2b.app`
  (the E2B media-toolchain worker) + `COMPUTE_PROVIDER=http →
  https://3973-ikv41gpq99jsnsadltfxr.e2b.app` (the E2B full-plane compute
  worker). The boot banner observed in the runtime log: `[sporta] media
  toolchain: HTTP worker at https://3971-ikv41gpq99jsnsadltfxr.e2b.app
  (MEDIA_TOOLCHAIN=http — the admission probe + normalization dispatch over
  real HTTP)`. The `COMPUTE_PROVIDER=http` seam's boot-time live descriptor
  fetch from the E2B compute worker SUCCEEDED (a failed fetch fails the
  singleton build loudly → every route 500s; health answered 200).
- **Console errors observed across the whole journey: 0** (both browsers —
  the golden-path browser and the recovery browser; `agent-browser errors`
  empty on every stage).

## Route/API map of the journey

| Stage | Route / API | Result |
|---|---|---|
| 1. Home | `GET /` | 200 — the shell rendered (screenshot `01-home.png`) |
| 2. Sign-up | `POST /api/auth/register` | 200 → `userId u-5e3fdf7d42054c489d523cc3902f5945` (Neon-backed; roles viewer+creator) → Library (screenshot `02-signup-success-library.png`) |
| 3. Create source | `GET /create` + `GET /api/create/options` | 200 — upload offered (mp4 ≤ 200MB ≤ 120s) (screenshot `03-create-source-step.png`) |
| 3b. Real clip pick | file input | `clip-b1-wide-broadcast.mp4` (1 771 681 B, 30 s, 640×360, sha-256 `3a3c249e…` — the SAME frozen corpus clip as the 2026-09-26 run) |
| 4. Rights | the studio Rights step | operations defaulted analysis+transformation+derivativeGeneration+storage (screenshot `04-rights-step.png`) |
| 5. Realities | the studio Renderer step | **the derived realities honestly NOT offered** — all three disabled with "no producer is registered for this reality on this control plane (the derived-reality encode plane is absent) — never invented" (screenshot `05-realities-honest-unavailable.png`) — THE MEASURED ADMISSION GAP (see the README's gap record: the hosted composition's derived plane is local-toolchain-gated; the E2B compute worker HAS the plane but the hosted admission never offers it) |
| 6. Recipe / compute | the studio steps | style `r607-e2b-acceptance`; compute "Let the platform choose" — the transparency panel shows this deployment's configured plane, adapter `sporta.compute.hosted` (the http adapter whose descriptor was fetched LIVE from the E2B compute worker at boot) (screenshot `06-compute-step.png`) |
| 7. Review + submit | `POST /api/create/upload-sessions` (multipart) | **500 — REFUSED, typed** (screenshot `08-upload-refused-typed.png`; the honest envelope `{"error":{"failureClass":"internal","message":"unexpected server failure","details":{"errorId":"a92fe9d0-…"}}}` captured at `api-captures/upload-refusal-500.json`) — see the honest failure record below: THE CORRECTED ROOT CAUSE |
| 8. Supplementary fixture session (clearly labeled: NOT the acceptance upload leg) | `POST /api/create/sessions` → 201; `POST …/renders` → 202; job polls → 200 | the studio's own Fixture library radio ("Derby night at Kings Park", renderer `anime.prototype`, style `r607-e2b-fixture`, compute `sporta-auto`) — **the render job EXECUTED ON THE E2B COMPUTE WORKER** (the worker's own record: `render-job-sess-u-a16e733f…-1` → succeeded, artifact `1d5d07df…`, 19 733 B image/svg+xml — the compute-adapter failover proven through the hosted app) (screenshot `09-fixture-render-complete.png`) |
| 9. Library | `GET /library` + `GET /api/catalog/library` | 1 row: `sess-u-a16e733f…` "Derby night at Kings Park" (screenshot `10-library-lists-session.png`) |
| 10. Watch / Reality Switcher | `GET /watch?session=…` (+ `?reality=tactical` / `?reality=anime-npr`) | 200 — the four honest per-reality states (Original REQUIRES-UPLOAD; Tactical/3D PRODUCER-UNAVAILABLE — the recorded admission gap; Anime READY · 1 ARTIFACT); the URL-addressable switch held the session constant (screenshots `11`, `13`, `14`) |
| 11. Frame player | the watch page's diagnostics player | the recovered reality's review-format artifact plays frame-by-frame (screenshot `15-watch-frame-player.png`) |
| 12. Jobs | `GET /jobs` | the documented W921 per-instance boundary: "0 sessions with dispatched jobs" — the compute-job LEDGER is per-instance (in-memory); the render DID execute (on the E2B worker + the durable artifact is in R2) but the ledger never invents rows (screenshot `12-jobs-listing.png`) |
| 13. The watch artifact's hash chain | `GET /api/watch/…/outputs/anime-clip-f52a4ff0` | 200 — served content sha-256 == the declared contentHash `1d5d07df…` (19 733 B), `x-sporta-artifact-source: r2` (captured at `api-captures/artifact-before-redeploy.json`) |

## The honest failure record (stage 7) — THE CORRECTED ROOT-CAUSE ATTRIBUTION

The real-browser submission of the real 30 s corpus clip returned HTTP 500
with the studio's honest error line ("unexpected server failure"). The
server-side runtime log (Vercel, deployment `r607-e2b-1`) records the exact
typed cause — WITH THE STACK:

```
[api] unhandled error (3b5623cc-aae0-46d4-a6b4-e7b9031b865c): Error [UnsupportedMediaError]:
  ffprobe executable not found on PATH; the ffmpeg adapter requires ffmpeg/ffprobe
    at M.requireBinary (…__1yfrpw8._.js)      ← packages/decoding/src/ffmpeg/adapter.ts requireBinary
    at M.probe (…)                             ← the FfmpegDecoderAdapter.probe
    at y.probe (…)                             ← the DecodingService.probe
    at Object.run (…)                          ← RealToSwmPipeline.run — THE R207 DECODE STEP (step 3)
    at eo.createUploadSession (…)              ← the studio service's upload path
  { terminalFailureClass: 'media-invalid', failureClass: 'media-invalid',
    details: { missingBinary: 'ffprobe' } }
```

**The correction this run measures** (vs the 2026-09-26 record): the
2026-09-26 README labeled this refusal "REFUSED AT ADMISSION" — attributing
it to the upload admission's ffprobe (the media platform's seam). The stack
trace now proves the refusal originates ONE STEP EARLIER: at the **R207
real-to-SWM decode probe** (`packages/real-to-swm/src/pipeline.ts:299` —
`new FfmpegDecoderAdapter()`, hardwired, NO adapter seam), which runs
BEFORE the media platform's admission (step 5 of createUploadSession) —
the step that IS E2B-wired and therefore never reached. The typed error
class itself is unchanged and honest (`media-invalid`, `missingBinary:
ffprobe`, nothing stored — no session, no asset, no job: the Library and
Jobs pages stayed honestly empty).

**Consequence for the media half**: the E2B media provider is LIVE, wired,
and proven at the provider boundary (the golden-path record: the REAL clip's
admission probe + normalization executing REAL ffmpeg on the E2B sandbox
over the public wire, hash-chained, playable) — but the hosted upload path
cannot reach it: the R207 decode is a LOCAL-ffmpeg dependency with no
remote seam. Closing it requires a CONTRACT CHANGE (a TL decision — the
recorded gap + the integration design live in this pack's README §the
measured gap). The derived-reality encode plane is likewise gated (the
honest producer-unavailable states above) — the same gap record's second
half.

## The honest states that did NOT change (the prior run's boundaries, re-observed)

- Server boot banners (W911 doctrine): media records / url-source
  registrations / compute connections / analyst annotations are IN-MEMORY
  this run (the deployed runtime blocks the local db directory — mkdir db
  failed ENOENT); the Neon durable control plane + identity carry the
  durability this run proves.
- The compute-JOB ledger is per-instance ("0 sessions with dispatched jobs"
  on a fresh instance — never invented).
- The four-reality MP4 outputs (Original/Tactical/3D-Game/Anime) remain
  honestly unavailable through the hosted upload path (the gap record).
