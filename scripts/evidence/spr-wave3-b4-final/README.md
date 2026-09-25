# SPR-W3-C — b4 FINAL SWEEP: goal-targeted crowd hunt + hard reclassify gate

Session: w3c (lane C — acquisition), 2026-09-25. Base: `de687ce`
(`spr/w2a/b4-crowd` tip). Source (frozen): the LALIGA 2025/26 MD15
full-match upload `watch?v=93LPZJkCW2w` (~6591 s, itag 230 640×360 HLS
+ itag 140-5 audio), acquired through the recorded chain (bgutil PO-token
provider :4416, TLS relay 127.0.0.1:8128 → gost `a996d235.acsnet.co:443`,
DE exit 169.150.210.53). Liveness proof + chain-equivalence proof:
`chain-proof.txt`.

## OUTCOME: b4 DELIVERED — RECLASSIFIED `crowd-montage` (the pre-recorded
hard-gate branch). The goal-adjacent sweep (20 windows, **1609.8 s** of
prior-coverage-disjoint coverage, 1608 grid cells) flagged 7 crowd runs;
direct per-frame verification checked **53 frames** and verified **zero**
crowd-dominant runs with clean brackets — 49 frames are honest 429-ERRORs
(persistent account-level quota windows; bounded retry budgets exhausted;
none load-bearing; every ERROR listed in the addendum with its raw JSON),
and the only landed YES-run (w1091 1105.84–1106.84, 2.0 s) has a burned
post-bracket. No ≥8 s directly-verified crowd-dominant run exists in the
frozen source's sampled universe → gate closed to the montage:
**`bytes/clip-b4-crowd-montage.mp4`** — 12.0 s / 300 frames / 640×360 /
25 fps / aac 44100 128k, sha256
`6849d5fde6db13870c9ff18a732b9bc950d86e3c89af1ff82f35d66b3f36248f`,
honest `designation: "crowd-montage"`: w2a C4 (media 4232.88–4237.88) +
w2a C5 (media 5552.96–5557.96), 6.0 s each, every 1 fps frame
crowd-dominant with clean NO brackets (per-frame basis `w2a-record`,
sha-matched at run time; the fresh re-verification calls were 429-blocked
at the bounded budget — raw attempt JSONs preserved), joined by ONE hard
cut at verified cut points — no transition frames invented. Full
arithmetic + per-segment provenance: `corpus-b4-addendum.json`.

## 1. Method (all three w2a incidents are the law here too)

1. **Goal-moment detection** (`goal-moments.json`, `roar-spikes.json`):
   full-match itag-140-5 audio (106,666,323 B, sha256 603806d9…e360)
   pulled through the chain (parallel ranged — single long-lived
   connections throttle to ~4 KB/s after the first burst); RMS loudness
   envelope in 0.5 s windows; roar magnitude = peak minus rolling-median
   baseline (±60 s); top-40 spikes (min separation 45 s). Each of the top
   33 moments cross-checked ±10 s against scoreboard-graphics frames:
   itag-230 pull [peak−10, peak+20] → ONE 4×5 grid of the ±10 s envelope →
   ONE single-image VLM call per grid (cells classified
   play/celebration/crowd/graphics/closeup/other); strong roars without
   graphics got ONE follow-up grid [peak+10, peak+19] (late scorer
   graphics trail). 40 candidate moments recorded, 33 cross-checked.
   Calibrated: moment g2728 (media 2727.5) independently reproduces the
   w2a C1 record (crowd 2720.9/2725.9–2726.9, celebration 2728.9+,
   graphics 2730.9/2734.9).
2. **Goal-adjacent window sweep**: 20 windows (17 × 60–99 s + 3 short
   boundary-truncated windows of 36.0/45.0/51.4 s) anchored ~10 s before
   each roar peak (or at the nearest legal position when prior coverage
   clipped the anchor). Disjointness law: time-interval disjointness —
   a segment is usable only if its [start, end] does not intersect ANY
   prior-coverage interval (the 16 w2a windows' exact trueWindows + the
   w6-spr-4 disc windows modeled [t, t+86] with ±4 s pads + b8 +
   the 1979–2213 calibration pull). The current itag-230 manifest is a
   NEW HLS generation (segment boundaries differ from the w2a manifest —
   segment-index alignment is impossible; the time law is the honest
   equivalent). Plan + arithmetic: `verification/window-plan.json`,
   `verification/window-plan-final.json`, `verification/coverage-check.json`.
   Grids: 89 timestamped 4×5 JPEG grids (`grids/`), per-cell classification
   (`verification/grid-vlm/`, 1 call per grid, single image), 1608 cells:
   wide-broadcast 951, closeup 284, pitch-action 276, graphics 66,
   **crowd 25**, other 6.
3. **Direct verification of every crowd-flagged run** (`verification/
   candidates/`): seek-free extraction (full sequential decode + select by
   frame index), ONE image per VLM call, unlink-before-every-attempt,
   strict prompt (YES only when spectators/stands occupy more than half
   the frame), both brackets. A run counts only if EVERY frame is
   crowd-dominant and both brackets are clean.
4. **The hard gate** (lead decision, pre-recorded): no ≥8 s
   directly-verified crowd-dominant run ⇒ b4 RECLASSIFIED as
   `crowd-montage` — 8–12 s cut-based composite from the VERIFIED crowd
   runs (w2a's five rejected candidates' runs + any new verified runs
   from this sweep), joined at verified cut points, per-segment
   provenance (source segment math per join), apad-normalized audio from
   the same full-match itag-140-5, sha256, ffprobe dump, honest
   `designation: "crowd-montage"`.

## 2. Chain-equivalence proof (before any sampling)

My re-pull of w2a candidate C1 territory (media 2713.84–2739.44) was
verified per-frame against the immutable w2a verdict file: **7/7 verdicts
identical** (YES 2720.84/2721.84, NO coach 2722.84, YES
2725.84–2727.84, NO celebrating players 2728.84) — the rebuilt chain,
segment math, seek-free extraction and VLM discipline reproduce the w2a
record on the same media times.

## 3. Deviations + incidents (honest record)

- **Parallel segment fetcher** (the recorded w2a deviation, README §6):
  6 concurrent CONNECT tunnels through the same relay→gost egress, raw
  MPEG-TS concatenation, exact segment math in the window maps. Content
  provenance unchanged (same itag-230 HLS, same exit).
- **Manifest regeneration**: the current playlist is a new HLS generation
  (1216 segments, 6590.80 s) with different segment boundaries than the
  w2a session's — hence the time-interval disjointness law (see §1.2).
  Window maps in `verification/windows/` record the CURRENT manifest's
  exact segment math.
- **Full-audio transport**: single-connection pulls of the 140-5 m4a
  throttle to ~4 KB/s after the first ~700 KB; pulled instead as 51
  parallel ranged chunks (8 workers × 2 MiB, Content-Range verified,
  size-exact reassembly). Transport only; bytes are the platform's own
  m4a (ffprobe duration 6590.844807 s).
- **ffmpeg stdin hang**: full-audio decode hung until `-nostdin` +
  `stdin=DEVNULL` (the tool shell's never-closing stdin) — discovered,
  fixed, recorded.
- **VLM 429 rate limiting**: persistent quota windows (as in w2a). All
  callers pace (6–8 s) and back off; per the worker instruction the
  per-call 429 retry budget is BOUNDED (default 10 waits, 30–120 s
  backoff; probe/sweep passes used 1–22 depending on role) — after the
  budget a frame is honestly burned as ERROR, documented per frame
  (`gate.errorFrames` in the addendum, raw error JSONs preserved), and
  never load-bearing. Two cross-check calls that failed in the first
  run were re-run and merged (`crosscheck-results.json` records the
  final state; the raw per-call JSONs are in `verification/
  crosscheck/vlm/`). Successful per-frame verdicts are cached by tag;
  no verdict was ever read from a stale file (unlink-before-attempt in
  `tools/vlm1.py`).
- **Quota-exhausted montage verification basis**: where fresh
  re-verification of the montage segments was quota-blocked, each
  segment frame carries its effective verification from the immutable
  w2a per-frame direct-verification record at the exact same media
  time (sha-matched at run time, basis `w2a-record` in
  `verification/montage/b4-gate-output.json`). The w2a rejected
  candidates are the work-order-designated verified segments, and the
  chain-equivalence proof covers the manifest-generation change. The
  single-shot branch (had it fired) reuses the sweep's own landed
  per-frame verdicts (basis `vlm`, raw JSONs in
  `verification/candidates/vlm/`).
- **Sandbox child-reaping**: the sandbox reaps tool-shell children (the
  known bgutil daemonization law); long-running sweep/probe drivers are
  launched via `tools/daemonize.py` (double-fork, reparented to init).
- **Grid class under-calling**: the class taxonomy can miss goals (a
  goal sequence classified as `play` — see g3680, whose cell descriptions
  say "ball hitting the back of the net"). goal-moments.json records both
  the class-based verdict AND the description-derived notes; limitations
  are documented in its method block.

## 4. Coverage accounting (gate 6)

Prior sampled coverage (w2a README + corpus notes): ~2294 s =
~774 s (9 w6-spr-4 windows) + ~1520 s (16 w2a windows) (+39.4 s w4160-wide
non-overlapping part). This sweep: 20 windows, **1610 s** new coverage
(see `verification/coverage-check.json` for the arithmetic), disjoint
from ALL prior coverage by the time law, plus 33 goal cross-check pulls
(~990 s of moment-localization evidence, largely overlapping the sweep
windows themselves and prior coverage around covered-zone moments — NOT
counted as new sampling coverage; their window maps are recorded in
`verification/crosscheck/`).

## 5. Files

- `goal-moments.json` — 40 roar candidates, 33 cross-checked, verdicts +
  method + limitations
- `roar-spikes.json` — the raw envelope spike table
- `grids/` — 89 sweep grids (4×5, 1 fps, media timestamps burned in)
- `verification/windows/` — 20 sweep window maps + grid metadata
- `verification/window-plan.json` / `window-plan-final.json` /
  `coverage-check.json` — the disjointness plan + arithmetic (gate 6)
- `verification/sweep-cells.json` / `sweep-crowd-candidates.json` /
  `sweep-fetch-summary.json` — cell classifications, flagged candidates,
  fetch records
- `verification/grid-vlm/` — 89 per-grid classification JSONs (raw)
- `verification/candidates/` — `verify-results.json` (the direct-verification
  record) + raw per-frame verdict JSONs in `vlm/` (landed calls AND honest
  429-ERROR calls, each with its failure detail)
- `verification/chain-equivalence/` — the C1-territory re-pull window map
  + the 7/7 verdict-identical proof against the immutable w2a record
  (raw JSONs + frames)
- `verification/crosscheck/` — cross-check grids, VLM JSONs, window maps,
  results
- `verification/montage/` — gate decision, assembler output (sha256,
  joins, ffprobe), plans, segment window maps, the exact frames checked,
  raw montage VLM attempt JSONs
- `verification/logs/` — chronological incident logs (probe / sweep-C /
  gate-close; the 429 quota period, verbatim)
- `corpus-b4-addendum.json` — THE DELIVERABLE (b4 or b4-montage entry)
- `chain-proof.txt` — chain rebuild + liveness proof
- `tools/` — the method scripts (fetcher, grids, vlm wrapper, coverage,
  goal detection, cross-check, sweep drivers, montage assembler)
- `bytes/` — the delivered corpus bytes (b4 clip or montage mp4)

## 6. Corpus addendum

`corpus-b4-addendum.json` — the lead integrates it into
`scripts/evidence/spr-wave2-corpus/corpus.json` at the integration
station. corpus.json and all w2a evidence were read-only here (never
edited; verified by `git status` at delivery).
