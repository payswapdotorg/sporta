# R607 golden-path journey log (fresh browser, public URL)

Worker B · 2026-09-26 22:2x–22:4x UTC · deployment `r607-fix-1`
(`dpl_4h5AQfUqKJ3AqVAtYLwnzBrYfVdJ`, revision `8893926` = 0cc47ae + the
flagged minimal fix) · browser automation: agent-browser (Chromium,
headless, fresh context — no cookies, no service-worker state, no
pre-seeded auth).

- **URL base**: `https://sporta-flame.vercel.app` (the production alias).
- **Test identity** (clearly marked, fresh-registered through the public
  UI): username `r607-accept-1790461857`, password held by the worker
  (never committed). NOTE: the task packet suggested
  `r607-acceptance+<timestamp>@example.com`; the product's registration
  pattern is `[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}` (username semantics, no
  `+`/`@`), so the equivalent clearly-marked username form was used —
  recorded as an adaptation, not a deviation from the fresh-identity
  requirement.
- **Console errors observed across the whole journey: 0** (both
  `agent-browser errors` and the console log stayed empty on every stage).
- **Route/API map of the journey** (all requests observed from the real
  browser):

| Stage | Route / API | Result |
|---|---|---|
| 1. Home | `GET /` | 200 — shell rendered (title "Home", skip-link, PWA manifest) — screenshot `01-home.png` |
| 2. Sign-up | `POST /api/auth/register` | 200 → `userId u-da57c6893aa146439a74cd6ffb4a3014` (Neon-backed; the form self-selects roles viewer+creator) |
| 2b. Sign-in (register auto-login) | `POST /api/auth/login` | 200 + HttpOnly `sporta_session` cookie → redirected to `/library` — screenshot `02-signup-success-library.png` |
| 2c. Library (pre-create) | `GET /library` | honest empty state: "you have not created any sessions yet" |
| 3. Create source | `GET /create` | 200 — studio options `GET /api/create/options` 200: upload offered (mp4 ≤ 200 MB ≤ 120 s), derived realities honestly NOT offered — screenshot `03-create-source-step.png` |
| 3b. Real clip pick | file input `#studio-upload-file` | `clip-b1-wide-broadcast.mp4` (1 771 681 B, 30 s, 640×360, from `scripts/evidence/spr-corpus-bytes/` — authorized corpus) |
| 4. Rights | studio Rights step | operations defaulted analysis+transformation+derivativeGeneration+storage; derived preview ALLOWED Render new realities / ALLOWED Store + play back outputs — screenshot `04-rights-step.png` |
| 5. Realities | studio Renderer step | honest states: all three derived realities disabled with "not offered: no producer is registered for this reality on this control plane (the derived-reality encode plane is absent) — never invented" — screenshot `05-realities-honest-unavailable.png` |
| 6. Recipe / compute | studio steps | style `r607-acceptance`; compute "Let the platform choose" → in-process plane `sporta.compute.hosted` — screenshot `06-compute-step.png` |
| 7. Review + submit | `POST /api/create/upload-sessions` (multipart: file + operations + realities + compute) | **500 — REFUSED at admission** (screenshot `08-upload-refused-honest-error.png`) — see the honest-failure record below |
| 8. Jobs | `GET /jobs` | honest empty state (no session was created — nothing invented) — screenshot `09-jobs-page.png` |
| 9. Library | `GET /library` | honest empty state — screenshot `10-library-after-blocked-upload.png` |
| 10. Watch / four outputs / Reality Switcher over the upload session | — | **BLOCKED UPSTREAM** (no session exists; the admission stored nothing by design) |

## The honest failure record (stage 7) — the measured hosted-plane blocker

The real-browser submission of the real 30 s corpus clip returned HTTP
500 with the studio's honest error line ("unexpected server failure").
The server-side runtime log (Vercel, deployment `r607-fix-1`) records the
exact typed cause:

```
POST /api/create/upload-sessions
[api] unhandled error (<errorId>): Error [UnsupportedMediaError]:
  ffprobe executable not found on PATH; the ffmpeg adapter requires ffmpeg/ffprobe
  { terminalFailureClass: 'media-invalid', failureClass: 'media-invalid',
    details: { missingBinary: 'ffprobe' } }
```

Classification: **runtime-toolchain-absent**. The Vercel Hobby **Node**
serverless runtime ships no `ffmpeg`/`ffprobe` binary; the real media
pipeline (R101 admission probe → R207 real-to-SWM decode → R306/R508
MP4 encodes) requires the real binaries and fails closed, typed, without
storing anything (the R101 boundary's documented posture — "nothing is
stored on refusal"). Consistent secondary honest states measured on the
same deployment:

- `GET /api/create/options` → `derivedRealities: [tactical, three-d-game,
  anime-npr].offered = false` with the reason "no producer is registered
  for this reality on this control plane (the derived-reality encode
  plane is absent) — never invented" (the encode-toolchain probe found no
  ffmpeg → `createDerivedRealityPlane` returned null → honest
  producer-unavailable).
- Server boot banners (per the W911 doctrine, the Node-runtime in-memory
  fallbacks announced loudly): media records / url-source registrations /
  compute connections / analyst annotations are IN-MEMORY this run.
- The compute plane is `in-process` (`sporta.compute.hosted`) — no
  external compute worker is configured on this project, so renders
  cannot be offloaded to a host that has ffmpeg.

Consequence for the frozen acceptance shape: the upload→rights→compute→
processing→four-outputs→Watch(MP4) chain **cannot execute on this hosted
plane as-is**. The Original MP4 (normalization), Tactical/3D-Game/Anime
MP4 realities (the derived-reality encode plane) all require the real
toolchain. This is a genuine R607 finding, not a worker failure: the
hosted Hobby deployment is the beta-personal control-plane tier; the
media/compute toolchain boundary is the documented architecture's
"metered compute capacity" separation (docs/deployment/free-tier-matrix.md
"Important economic boundary"; deployment-architecture.md hosting policy).

## Supplementary hosted durability probe (clearly labeled: NOT the acceptance journey)

To still measure the hosted recovery machinery with REAL product state
(the acceptance upload leg being blocked upstream), a fixture-source
session was created **through the same public Create Studio UI** (the
studio's own labeled "Fixture library — dev surface" radio; no developer
API call, no manual DB edit, no hidden session — the studio's step UI
itself):

- Fixture source: "Derby night at Kings Park"; renderer `anime.prototype`
  (SVG review-format producer — the honest not-video boundary); style
  `r607-durability-probe`; compute `sporta-auto`.
- One submission created session `sess-u-abb7d38fc2868a3021aa281a3baab9c0`
  (label "Derby night at Kings Park", private), render job
  `render-job-sess-u-abb7d38fc2868a3021aa281a3baab9c0-1`, render
  `r-u-2ce33e9fbd2afe81fea6c968c66d876e`, artifact segment
  `anime-clip-684d4240` (image/svg+xml, 19 733 B, contentHash
  `ad849619db660ad75d2a16e9ba7c638d393971ba9ae1b2c3d78ad96123e8b717`) —
  screenshots `11`–`16`.
- Watch served the recovered reality with the Reality Switcher's four
  honest per-reality states (Original REQUIRES-UPLOAD for this
  fixture-source session; Tactical/3D PRODUCER-UNAVAILABLE; Anime READY ·
  1 ARTIFACT) and the URL-addressable switch (`?reality=anime-npr`,
  `?reality=tactical` — same session held constant).
- The artifact bytes round-tripped from the live R2 store:
  `x-sporta-artifact-source: r2`, served sha-256 == declared
  contentHash.
- Jobs page: "0 sessions with dispatched jobs" — the documented W921
  per-instance boundary (the job ledger is per-instance; a session
  reconstructed on another instance never invents jobs).

The **recovery leg** of this probe (fresh browser + fresh serverless
deployment) is recorded in `../recovery/`.
