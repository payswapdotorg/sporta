# HF009 — the pyannote speaker-diarization benchmark (Worker 64-d, flight 4)

**Work item (verbatim)**: "HF009 — Speaker diarization benchmark — Owner:
Worker A. Acceptance: compare speaker segmentation against
transcript/event timelines; record DER/JER-equivalent metrics and failure
modes."

**Verdict in one line**: the pinned pipeline is **USER-CONDITIONS-GATED on
the HF Hub** — anonymous access 401s at the ledger-pinned revision (the
brief's "NOT token-gated (verify)" assumption was verified FALSE by the
executed probe map) — so the honest delivery is the **typed refusal
(`auth-gated-model`)** + the executed partial: the audio-fixture story
(2 SPR corpus WAVs extracted, sha-recorded), the auth-wall probe map with
the exact 401 text, the repo ground-truth search (DER/JER **NOT
MEASURED** — no speaker annotations exist anywhere), the static W208
contract-compatibility review, and the fail-closed **ready-to-run** FULL
mode for the moment an operator-authenticated pipeline copy exists.
NO turn-timeline, determinism, RTF, wall-clock, or RSS number exists in
this flight — and the validator refuses any that appears.

## The model + runtime

- Candidate (HF002 ledger row, echoed VERBATIM into benchmark-record.json):
  `pyannote/speaker-diarization-community-1` @ revision
  `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee` (model cc-by-4.0, code MIT,
  commercial use yes; task profile `football.commentarySpeakerDiarization`,
  FROZEN).
- Code pin: **pyannote-audio 4.0.7 via pip** (torch 2.9.1+cpu +
  torchaudio 2.9.1 + torchcodec 0.8.0; python 3.12.14 in a NEW venv at
  `/home/z/hf-bench-4` — no earlier flight's venv reused). CPU inference;
  GPU honestly N/A. pyannote-metrics 4.1 installed (the DER/JER
  implementation: present, stated, never executed — no ground truth).
- THE WALL (executed, verbatim in results/preflight-refusal.json):
  `GatedRepoError: 401 Client Error — "Cannot access gated repo … Access
  to model pyannote/speaker-diarization-community-1 is restricted. You
  must have access to it and be authenticated to access it. Please log
  in."` The model card's own Setup: "Accept user conditions" + "Create
  access token". No HF token exists in this sandbox; accepting conditions
  is a human action. **Weights never downloaded, never committed, never
  vendored — and NO third-party mirror used** (an unofficial re-upload
  would launder the gate; the refusal is recorded, not worked around).

## The executed partial

1. **The audio-fixture story** (results/audio-fixtures.json, 4 fixtures):
   - `sprclip-b8-inplay-original` (b8p3.mp4, 47.6 s): EXECUTED
     `ffmpeg -v error -y -i b8p3.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le`
     → 47.624 s / 16,000 Hz / 1 ch PCM16 / sha256 `ddf9c203…`. Authorized
     by the repo's own corpus rules: the recorded **R606 registration
     declaration** (analysis / transformation / derivative generation /
     storage; repo private) — a local benchmark run is analysis.
   - `sprclip-b1-wide-broadcast` (30.1 s): EXECUTED, same recipe →
     30.070 s / 16 kHz / mono / sha256 `08c2fcfb…`.
   - `fx-001` (CC0, the authorized gate clip): the COMMITTED normalized
     clip is video-only (`-an` is the manifest's own normalizeTransform);
     the audio lives only in the ORIGINAL webm at the manifest's canonical
     URL — this flight's fetch was **HTTP 429-rate-limited on all 6
     attempts** (an infrastructure wall, not a licensing wall); the
     sha-pinned ready-to-run extraction recipe is recorded.
   - `synthetic-diagnostic-01`: ffprobe-verified **NO audio track at all**
     (typed gap — the repo's fixture set cannot exercise ANY audio task
     profile).
   All 4 repo fixture sha pins verified before use (fail-closed on drift).
2. **The auth-wall probe map** (results/preflight-refusal.json): 6
   anonymous HF probes — community-1 `config.yaml` + `embedding/model.pt`:
   **gated (401)**; community-1 `README.md`: public (the only public
   file); `pyannote/segmentation-3.0`: **gated (401)** (the brief's
   fallback component — refused too); `pyannote/wespeaker-english-resemblynet`:
   repo-not-found; `speechbrain/spkrec-ecapa-voxceleb`: public but NOT a
   component of the ledger candidate (not used as a stand-in).
3. **The ground-truth search** (typed): NO speaker ground-truth
   annotations exist in the repo for benchmarkable media — the W208
   commentary-segmentation fixture is a synthetic inline 30-row
   5-speaker TEST transcript (not real-media annotation), the ASR adapter
   owns no annotations (speakerLabel is a passthrough contract),
   real-to-swm/technology-registry fixtures are spatial/vision only, SWM
   timelines are derived state, no RTTM exists anywhere.
4. **The static W208 contract review** (in benchmark-record.json):
   COMPATIBLE-WITH-ADAPTER — community-1's speaker turns map onto
   `CommentaryUnit.speakerLabel` (hard boundary semantics align exactly;
   seconds→ms arithmetic; the card's `exclusive_speaker_diarization` is
   the intended ASR-reconciliation fit), with TYPED GAPS: no per-turn
   confidence (W209 consumes confidence), cluster labels are not
   identities, overlap→exclusive quality unverified.
5. **The ready-to-run FULL mode** (benchmark_pyannote.py): fail-closed on
   a missing pipeline dir; records the weight inventory (sizes + sha256)
   it runs; measures turn timelines (counts, durations, speech ratio,
   per-speaker), run-to-run determinism (serialized-timeline equality),
   per-file wall-clock + **RTF**, VmRSS + ru_maxrss; computes the
   UNSCORED structural alignment against repo-derived timelines; carries
   the stated DER/JER path (zero ground-truth rows). NOT EXECUTED (the
   refusal) — syntax-checked and import-verified on this host.

## What is NOT measured (typed, no numbers exist)

- DER/JER — no ground truth (the search above).
- Speaker-segment timelines, turn counts, speech ratio — the model never
  ran.
- Run-to-run determinism — the model never ran.
- Per-file wall-clock + RTF — the model never ran.
- Inference RSS — the model never ran (GPU honestly N/A in any case).
- The unscored structural comparison vs repo-derived timelines — the
  model never ran (harness ready).

## Failure modes (the honest observations of THIS flight)

1. **The auth wall is failure mode #1**: the ledger row says
   `commercialUse: yes`, yet the weights are access-controlled — the
   HF002 ledger schema records no distribution gate (recorded for the TL:
   a `distributionGate` field may be wanted).
2. fx-001's audio is only in the 429-blocked original source (the
   committed clip is deliberately audio-less).
3. The synthetic fixture has no audio track — a structural gap for the
   whole audio portfolio wave (HF008 ASR flights will hit it too).

## The guard batteries + delivery

- `record-benchmark.ts` (this tree) — EXECUTED, exit 0: provenance echo
  verbatim vs the HF002 ledger; the typed refusal pinned to the EXECUTED
  preflight (the record's refusal type + the 401 wall text vs the
  committed probe map); NO-FABRICATED-NUMBERS (any number-shaped value in
  the quality/latency/memory blocks refuses — negative-tested: a
  fabricated RTF 0.42 refused with exit 1); the executed partial pinned
  (the 2 SPR WAV shas/durations, the usability types, the fixture
  statuses); no promotion.
- packages/testing hf-ledger.test.ts 8/8; packages/perception-benchmark
  harness.test.ts (L010) 8/8 (re-run post-flight, unchanged); eslint 0 on
  the touched TS; prettier clean.
- Branch `work/hf009-pyannote-benchmark` (never pushed). FROZEN
  contracts, provenance-ledger.json, architecture-lock: untouched
  (git-diff-verified). Weights never committed, never vendored; no
  tokens/secrets anywhere.
- NO promotion: gatingState stays `candidate`; the HF015 gate (TL) owns
  it. Observed blockers recorded in benchmark-record.json
  (`promotionGate.blockersObserved`).

## The unblock path (for the TL)

An operator with an hf.co account accepts the community-1 user
conditions, creates a read token OUTSIDE any repo/log (never committed),
downloads the pipeline at the pinned revision to
`/home/z/hf-bench-4/hf-model-auth`, then re-runs
`benchmark_pyannote.py --mode full --pipeline-dir /home/z/hf-bench-4/hf-model-auth`.
The fixtures are already prepared (the two SPR WAVs), the harness is
import-verified, and the validator will then pin the executed numbers
exactly as HF006 did.
