===== 64-d REPORT BEGIN =====

# Worker 64-d delivery — HF009: the pyannote speaker-diarization benchmark evidence

## Manifest

- Branch: `work/hf009-pyannote-benchmark` (from main @ c51dd1d; never pushed)
- Commit: `rel(64-d): HF009 — the pyannote speaker-diarization benchmark evidence (auth-gated typed refusal, CPU-host, SPR audio executed)`
- Work item: HF009 (docs/work-items/hf-model-portfolio-work-items.md)
- Task profile: `football.commentarySpeakerDiarization`
  (docs/contracts/technology-task-profiles.md, FROZEN — untouched)
- Evidence tree (all committed in-repo):
  - `scripts/evidence/hf-portfolio/hf009/benchmark_pyannote.py` — the benchmark script (preflight EXECUTED on this host: the typed refusal, exit 3; FULL mode ready-to-run + fail-closed, verified refusing exit 2 on a missing pipeline dir)
  - `scripts/evidence/hf-portfolio/hf009/record-benchmark.ts` — the fail-closed validator (EXECUTED, exit 0; negative-tested: a fabricated RTF number refuses with exit 1)
  - `scripts/evidence/hf-portfolio/hf009/benchmark-record.json` — the ledger-shaped HF009 record (provenance echo verbatim + the typed refusal + the executed partial)
  - `scripts/evidence/hf-portfolio/hf009/summary.md` — the markdown summary
  - `scripts/evidence/hf-portfolio/hf009/results/preflight-refusal.json` — the EXECUTED preflight: the 401 wall, the 6-probe map, the ground-truth search
  - `scripts/evidence/hf-portfolio/hf009/results/audio-fixtures.json` — the EXECUTED audio-fixture evidence (2 SPR WAVs, shas + durations + the exact ffmpeg recipe)
- Not committed (by design): the community-1 pipeline weights (NEVER downloaded — the repo is user-conditions-gated; no mirror used), the python venv (/home/z/hf-bench-4 — a NEW venv; no earlier flight's reused), and the extracted WAVs (re-creatable from the committed corpus bytes with the recorded one-line recipe).
- FROZEN contracts untouched; provenance-ledger.json untouched; architecture-lock untouched.
- Guard batteries green: packages/testing hf-ledger.test.ts 8/8;
  packages/perception-benchmark harness.test.ts (the L010 battery) 8/8.

=== HF009 BENCHMARK REPORT ===

## THE HONEST HEADLINE — the model is auth-gated: a typed refusal + an executed partial

The pinned candidate `pyannote/speaker-diarization-community-1` @
`3533c8cf8e369892e6b79ff1bf80f7b0286a54ee` is **USER-CONDITIONS-GATED on
the HF Hub**. The brief's assumption "the community-1 pipeline is NOT
token-gated (verify)" was **VERIFIED FALSE** by the executed probe map:
anonymous access to `config.yaml` and `embedding/model.pt` at the pinned
revision 401s with GatedRepoError — "Access to model
pyannote/speaker-diarization-community-1 is restricted. You must have
access to it and be authenticated to access it. Please log in." The model
card's own Setup section reads "Accept user conditions" + "Create access
token at hf.co/settings/tokens" — a HUMAN action. No HF token exists in
this sandbox (the operator credentials present are GitHub/Composio keys —
they do not authenticate against the HF Hub). Per the brief's honesty
doctrine the delivery is the **typed refusal + the partial** — never a
fabricated benchmark. **NO speaker-turn, determinism, RTF, wall-clock, or
RSS number exists in this flight**, and the record-benchmark.ts gate
refuses any number-shaped value in the measurement blocks (negative-tested
with a fabricated RTF 0.42 → exit 1).

## The model + version + loading recipe

- Candidate (HF002 ledger row, echoed VERBATIM into benchmark-record.json):
  `pyannote/speaker-diarization-community-1` @ revision
  `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee` — model license cc-by-4.0,
  code MIT, commercial use yes; weightsProvenance: "pyannote `community-1`
  pretrained diarization pipeline; training and tuning ran on the GENCI
  Jean Zay supercomputer, per card; training corpora not named";
  datasetProvenance: the twelve named eval benchmarks (AISHELL-4 …
  VoxConverse). Task profile `football.commentarySpeakerDiarization`
  (FROZEN, untouched).
- Code pin: **pyannote-audio 4.0.7 via pip** (recorded from the install),
  torch 2.9.1+cpu + torchaudio 2.9.1 + torchcodec 0.8.0, python 3.12.14
  in a NEW venv at `/home/z/hf-bench-4`. CPU inference; GPU honestly N/A.
  pyannote-metrics 4.1 installed — the DER/JER implementation is present
  and stated, never executed (no ground truth).
- Weights: **NEVER downloaded, never committed, never vendored.** The
  pinned repo is gated (the exact 401 wall text recorded verbatim in
  results/preflight-refusal.json); the ONLY anonymously-readable file is
  the model card README.md. **No third-party mirror of the gated weights
  was used** — an unofficial re-upload would bypass the user-conditions
  gate; the refusal is recorded, not worked around.
- The public-pipeline-components attempt (the brief's duty, EXECUTED):
  `pyannote/segmentation-3.0` (the fallback segmentation) is ALSO gated
  (401); `pyannote/wespeaker-english-resemblynet` does not exist as a
  standalone repo; `speechbrain/spkrec-ecapa-voxceleb` IS anonymously
  reachable but is NOT a component of the ledger candidate — not used as
  a stand-in (a different model would launder the benchmark claim).
- The ready-to-run loading recipe (the model card's own offline-use
  convention): an operator accepts the community-1 user conditions,
  downloads the pipeline at the pinned revision to
  `/home/z/hf-bench-4/hf-model-auth` (token in the environment only —
  never in any repo/log/command line), then
  `Pipeline.from_pretrained(<local dir>)`; the FULL mode fail-closes on a
  missing pipeline dir (verified: exit 2) and records the weight-file
  inventory (sizes + sha256) it runs.

## The audio-fixture story (which clips, licensing, extraction)

1. `fx-001` (CC0 FIFA Beach Soccer 2021 penalty, Wikimedia Commons — the
   repo's authorized licensed gate clip, sha-pinned in
   packages/real-to-swm/fixtures/gate-clips.json): the COMMITTED
   normalized clip is video-only by the manifest's own transform (`-an`
   in normalizeTransform — verified by ffprobe: a single h264 video
   stream). The audio lives ONLY in the ORIGINAL source webm at the
   manifest's canonical URL (source sha256 pin `a4d163a5…cdf131`). This
   flight's fetch of that original was **HTTP-429-rate-limited on all 6
   attempts** from this sandbox egress (upload.wikimedia.org and the
   commons Special:FilePath route, 15-45 s backoff) — an infrastructure
   wall, NOT a licensing wall; the sha-pinned ready-to-run extraction
   recipe is recorded in the preflight evidence. Typed: fx-001 audio
   BLOCKED this flight.
2. SPR corpus clips (in-repo bytes): authorized by the repo's own corpus
   rules — the recorded **R606 registration declaration**
   (analysis/transformation/derivativeGeneration/storage; repo private —
   scripts/evidence/spr-corpus-bytes/README.md). A local
   speaker-diarization benchmark run is ANALYSIS, inside the declared
   scope. EXECUTED extraction with ffmpeg to pyannote's native input:
   - `b8p3.mp4` (the R606 real in-play substrate, source sha verified
     `969af7c6…`) → `ffmpeg -v error -y -i b8p3.mp4 -vn -ac 1 -ar 16000
     -c:a pcm_s16le` → **47.624 s, 16,000 Hz, 1 channel, PCM16,
     1,524,050 B, sha256 ddf9c203…**
   - `clip-b1-wide-broadcast.mp4` (the w3a re-cut, source sha verified
     `3a3c249e…`) → same recipe → **30.070 s, 16 kHz, mono, PCM16,
     962,314 B, sha256 08c2fcfb…**
   The WAVs live OUTSIDE the repo (/home/z/hf-bench-4/audio) and are
   re-creatable from the committed corpus bytes with the recorded
   one-line recipe.
3. `synthetic-diagnostic-01` (the technology-registry fixture):
   ffprobe-verified **NO audio track at all** (video-only h264) — the
   typed gap: the repo's fixture set is structurally unable to exercise
   ANY audio task profile (a fixture observation the HF008 ASR flights
   will hit too).
4. fx-004 (the second gate clip) was NOT used: its 20 s normalized form
   is video-only identically, and its original-source audio fetch would
   hit the same Wikimedia 429 wall — recorded rather than attempted
   serially.

All 4 repo fixture sha pins were verified before use (fail-closed on
drift: the preflight refuses on any pin mismatch).

## The honest metrics (typed where the wall stands)

- **DER/JER: NOT MEASURED (typed)**. No ground-truth speaker annotations
  exist anywhere in the repo for benchmarkable media — the repo-wide
  search is recorded in results/preflight-refusal.json: the
  commentary-segmentation W208 fixture is a SYNTHETIC inline 30-row
  5-speaker test transcript (not an annotation of real media); the ASR
  adapter owns no annotations (speakerLabel is a passthrough contract —
  "W208 owns real diarization" per the source comment);
  real-to-swm/technology-registry fixtures carry spatial/vision
  annotations only; SWM event timelines are derived state; no RTTM file
  exists in-repo. pyannote-metrics 4.1 is installed and the DER/JER path
  is stated exactly (RTTM reference vs hypothesis) — it has zero
  ground-truth rows to score in this sandbox. DER/JER-equivalent metrics
  were therefore NOT recorded, honestly.
- **Speaker-segment timelines (turn counts, durations, speech ratio,
  per-speaker stats): NOT MEASURED (typed refusal — the model never
  ran)**. The summarizer is implemented in the ready-to-run FULL mode.
- **Run-to-run determinism: NOT MEASURED (typed refusal)** — the
  serialized-turn-timeline equality check is implemented.
- **Per-file wall-clock + the real-time factor (RTF): NOT MEASURED
  (typed refusal)** — the repeated-full-pipeline microbenchmark
  (warm-up excluded, identical input, labeled — the HF006 convention)
  is implemented; NO wall-clock or RTF number exists in this flight.
- **Memory: GPU honestly N/A (no GPU on the benchmark host); process RSS
  is the substitute — NOT MEASURED (the model never ran)**. The only
  honest memory figure in this flight is the preflight process RSS
  itself (37.9 MiB — the fixture/preflight work, not inference).
- **The unscored structural comparison against the repo's derived
  event/transcript timelines: NOT MEASURED (the model never ran) — the
  static half IS delivered**: the W208 contract-compatibility review
  (COMPATIBLE-WITH-ADAPTER with typed gaps: no per-turn confidence —
  W209 consumes confidence; cluster labels are not identities; the
  regular timeline may overlap while W208 units are exclusive — the
  card's `exclusive_speaker_diarization` is the intended fit, quality
  unverified). The boundary-alignment computation (turn boundaries vs a
  repo-derived timeline JSON, overlap counts only, labeled UNSCORED
  structural — never a DER/JER number) is implemented in the FULL mode.

## The failure modes (this flight's honest observations)

1. **The auth wall is failure mode #1**: the ledger row records
   `commercialUse: yes` yet the weights are access-controlled — the
   HF002 ledger schema records no distribution gate (recorded for the
   TL: a `distributionGate` field may be wanted; a "yes" license line
   does not mean anonymously fetchable weights).
2. fx-001's audio is only in the 429-blocked original source (the
   committed clip is deliberately audio-less) — the repo's REAL gate
   clip cannot exercise ANY audio task profile without an out-of-repo
   fetch.
3. The synthetic fixture has no audio track — a structural gap for the
   whole audio portfolio wave.
4. NOT OBSERVED (typed — the model never ran): short-clip behavior,
   music/crowd-noise confusion, confidence distribution, speaker-count
   stability on 10-47 s fragments. These are the observations the
   ready-to-run FULL mode will record after the unblock.

## The ledger/record path

- `scripts/evidence/hf-portfolio/hf009/benchmark-record.json` — the
  ledger-shaped HF009 record: the twelve provenance fields echoing the
  pyannote row VERBATIM + the typed refusal (pinned to the executed
  preflight) + the executed partial's pointers + the promotion-gate
  referral.
- `scripts/evidence/hf-portfolio/hf009/record-benchmark.ts` — the
  fail-closed validator: EXECUTED, exit 0. It checks the provenance echo
  against the HF002 ledger, the unchanged candidate gating state, the
  resolving evidence pointers, the refusal's pinning to the EXECUTED
  preflight (the record's refusal type + the 401 wall text vs the
  committed probe map), the NO-FABRICATED-NUMBERS rule (any
  number-shaped value in the quality/latency/memory blocks refuses —
  negative-tested with a fabricated RTF 0.42 → exit 1), the executed
  partial's pinning (the 2 SPR WAV shas/durations, the usability types,
  the fixture statuses), the honest caveats (GPU N/A, RSS substitute,
  CPU wall-clock, the no-mirror principle), and the DER/JER NOT MEASURED
  statements.
- `scripts/evidence/hf-portfolio/provenance-ledger.json` — untouched
  (its row schema is pinned by hf-ledger.test.ts; the run is recorded in
  benchmark-record.json, not as a ledger row).

## Limitations

- Zero executed model evidence: the pipeline never ran — the auth wall
  needs an operator action (accept the user conditions + provide an
  authenticated local copy) before ANY turn-timeline/latency/RSS number
  can exist.
- No ground-truth speaker annotations are reachable — DER/JER has an
  unscored ceiling in this sandbox even after the unblock.
- fx-001's audio is blocked by the Wikimedia 429 (infrastructure, not
  licensing); the SPR clips are the only executed audio, and their usage
  scope is the R606 analysis declaration (a private-repo benchmark),
  which the HF015 license review must confirm.
- The static W208 contract review is source-scanned, not run-executed.
- The preflight wall text, probe verdicts and fixture shas are pinned to
  this host's 2026-10-03 execution; the unblock path re-records them on
  the run host.

## Promotion-gate referral

The pyannote candidate remains `candidate` — UNCHANGED. Observed
blockers for HF015: (1) the benchmark DID NOT RUN (typed refusal:
auth-gated-model — an operator action is required before any evidence
can exist); (2) no speaker ground truth is reachable (DER/JER
unmeasurable here even after the unblock — the honest ceiling is
unscored structural evidence); (3) fx-001's audio is only in the
429-blocked original source, and the SPR corpus usage scope (the R606
analysis declaration) needs the HF015 license review's confirmation;
(4) the HF002 ledger row does not record the user-conditions
distribution gate (a schema observation for the TL). This flight
recommends NOTHING; the TL decides at the HF015 gate alone.

## The unblock path (recorded for the TL)

An operator with an hf.co account accepts the community-1 user
conditions, creates a read token OUTSIDE any repo/log (never committed),
downloads the pipeline at the pinned revision to
`/home/z/hf-bench-4/hf-model-auth`, then re-runs
`python3 scripts/evidence/hf-portfolio/hf009/benchmark_pyannote.py
--mode full --pipeline-dir /home/z/hf-bench-4/hf-model-auth`. The
fixtures are already prepared (the two SPR WAVs), the harness is
syntax-checked and import-verified on this host, and the fail-closed
validator will pin the executed numbers exactly as HF006 did.

=== END REPORT ===

===== 64-d REPORT END =====
