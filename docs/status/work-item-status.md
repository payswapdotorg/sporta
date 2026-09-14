# Sporta Work-Item Status

Evidence ledger. Only the tech lead records status transitions here, and only
after verifying acceptance criteria with executable evidence (commit sha,
tests, CI run). Workers report; the tech lead verifies and records.

Status vocabulary: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETE` (evidence
recorded), `BLOCKED` (reason recorded).

## M0 — Foundation

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W001  | COMPLETE    | S001: merge bc18272 (worker commit e4dfad5, session w001-repo-bootstrap); tech-lead re-ran bun test 1/1, lint clean, typecheck 0, format:check clean; CI run 34731407456 success on main |
| W002  | COMPLETE    | S001: worker commit c35bb90 (session w002-domain-contracts); 47/47 tests green, lint/typecheck/format clean, 13 schemas exported + goldens enforced; COMPATIBILITY.md added |
| W003  | COMPLETE    | S001: worker commit 806e649 (session w003-test-ci-foundation); @sporta/testing deterministic builders/sequences, tests/e2e/m0-pipeline.test.ts vertical slice, HARNESS.md + CONTRIBUTING testing conventions; 328/328 green |
| W004  | COMPLETE    | S001: worker commit b338854 (session w004-session-model); 90 session tests + full-suite green; lifecycle machine, fail-closed rights, in-memory + bun:sqlite repositories |
| W005  | COMPLETE    | S001: worker commit 1870cae (session w005-observation-model); 31 observation tests + full-suite green; store, evidence-linked derivation, deterministic replay with corrections |
| W006  | COMPLETE    | S001: worker commit 2445c7b (session w006-swm-contract); 95 world-model tests + full-suite green; versioned entities, at-T snapshots, bounded reorder, football extension |
| W007  | COMPLETE    | S001: worker commit 41803d1 (session w007-observability); zero-dep logger/correlation/metrics/trace + m0-observability e2e (6-stage correlated trace); 356/356 green |

## M1 — Football perception + commentary

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W101  | COMPLETE    | session w101-source-ingestion; branch 37d59f1; merge f1ed65a; CI success; 395/395 tests, lint/typecheck/format clean; TL review: rights-gate-first ordering, magic-byte-only sniffing, frozen idempotent receipts verified |
| W102  | COMPLETE    | session w102-demux-decode; branch 3c4cd71; merge ee06312; 440/440 tests incl. ffmpeg integration; lint/typecheck/format clean; TL review: policy-in-envelope, finally-unlink on 7 paths, bounded stderr |
| W103  | COMPLETE    | session w103-timeline-sync; branch e9b5807; 544 branch tests, 643 integrated; lint/typecheck/format clean; TL review: affine clocks + exact inverse, two-anchor drift ±1ppm, clamp+anomaly, honest driftMeasured=false fallback |
| W104  | COMPLETE    | session w104-segment-transport; branch 02904cb; merge 68b3aa2; CI run 34747782897 success; 674/674 tests (31 transport), lint/typecheck/format clean; TL review: bounded channel (capacity+bytes, block/reject/drop-oldest, never-silent drop accounting), deterministic injectable-clock retries (non-retryable never blind-retried), StageRunner end-to-end bounded memory + orderly shutdown |
| W201  | COMPLETE    | session w201-detection; branch 20d04b0; 550 branch tests, 595 integrated; lint/typecheck/format clean; TL review: exact benchmark math, contract-derived types, zod-validated emission |
| W202  | COMPLETE    | session w202-ball-tracking (conversation ca6ce0a4, landed 16:32 after 7h+ capacity siege via supervisor fighter); branch 0a4a942; merge fec7c5e; CI success; 765/765 tests (33 ball-tracking), lint/typecheck/format clean; TL review: exact exponential confidence decay 0.5^ceil(gapElapsed/4) on interpolated points, never-extrapolate edges, interpolated positions NOT emitted as observations (W205 boundary honored, OBSERVED provenance only), linearly-accumulating association gate documented, id-switch visible by construction, pure/deterministic, 4-case benchmark set with deep-equal rerun |
| W203  | COMPLETE    | session w203-field-mapping (conversation ee80adf2, landed after 4h capacity siege via supervisor fighter); branch 9d26f55; merge 0b83682; CI success; 732/732 tests (58 field-mapping), lint/typecheck/format clean; TL review: exact 8-point DLT with partial-pivot rank check, canonical h[8]=1 form, adjugate inverse with round-trip guarantee, pure never-clamp projector (inBounds flag, out-of-play honest), fixture camera model with documented pan/zoom/jitter math, OBSERVED-provenance field-mapping observations with stable cameraHomographyRef |
| W204  | COMPLETE    | session w204-identity-tracking (conversation 0559869a, landed 16:38 one-create via relay-armed fighter); branch 421d66f; merge 35a7fe1; CI success; 820/820 integrated tests (55 perception-tracking), lint/typecheck/format clean; TL review: greedy-IoU with deterministic 3-key tie-break (IoU desc, detection order, creation order), track ids never reissued, scene-cut hard boundary (close-all), confidence verbatim passthrough, subjectEntityRefs {entityId,kind} with no invented kinds, no velocity (W205/W206 boundary), image-space center position documented, identity-switch + track-purity benchmark |
| W205  | COMPLETE    | session w205-ball-state (re-dispatch #3, conversation 78500d85, landed 21:59; first attempt's completed work lost to sandbox-TTL expiry — lessons 116/117; token placeholder fixed in all staged prompts); branch 0570608; merge 90f1759; CI success; 916/916 tests (42 ball-state), lint/typecheck/format clean; TL review: centered-difference velocity omitted at ends/gap-jumps/degenerate spans (never extrapolated/zero-filled), confidence passthrough verbatim (W202 decay preserved on interpolated), provenance detected→OBSERVED vs interpolated→INFERRED, velocity key present-only-when-defined, subjectEntityRefs {entityId:"ball",kind:"ball"}, trackId visibility preserved (fragmentation evidence), pure/deterministic, exact benchmark assertions (caught a real centered-difference bug mid-work) |
| W206  | NOT_STARTED | — |
| W207  | COMPLETE    | session w207-stt-adapter (conversation 0697d5ee, landed 19:05 after 2.3h capacity fight incl. one false-VERIFIED void + re-arm); branch 42a09db; merge b02bc3b; CI success; 874/874 tests (54 asr), lint/typecheck/format clean; TL review: provider-neutral AsrBackend seam with lazy z-ai-web-dev-sdk import (package loads offline), WAV encoding for windowed PCM, timestamped TranscriptionUnits with actual-span endMs (never claiming audio that is not there), transcription observations modality "audio" (W209 owns commentary upgrade), confidence omitted-when-absent (never invented), speakerLabel passthrough (W208 owns diarization), bounded AsrError causes |
| W208  | COMPLETE    | session w208-commentary-segmentation (re-dispatch, conversation 2717883c, landed 23:31; first session's turn died silent with sandbox reset — voided, lesson 116 discipline applied); branch 0d6cdfa; merge c596c84; CI success; 968/968 tests (52 commentary-segmentation incl. w207-integration), lint/typecheck/format clean; TL review: rule-based deterministic segmentation (punctuation/speaker/channel/gap, every rule test-pinned), empty units skipped honestly, window-level timing honesty (no invented character timing), modality upgrade audio→commentary claimed as segmentation-not-understanding, provenance DERIVED (deterministic inference), confidence omitted-when-absent, no entity refs (W209 territory), stable seg- ids, pure |
| W209  | NOT_STARTED | — |

## M2 — World model

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W401  | NOT_STARTED | — |
| W402  | NOT_STARTED | — |
| W403  | NOT_STARTED | — |

## M3 — Offline stylized rendering

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W501  | COMPLETE    | session w501-renderer-contract; branch 4750ce3; merge confirmed; 496/496 integrated; lint/typecheck/format clean; TL review: R1-R8 enforced by 13-check harness + negative mocks; reference renderer isolated from SWM core |
| W502  | NOT_STARTED | — |
| W503  | NOT_STARTED | — |
| W504  | NOT_STARTED | — |

## M4 — Real-time pipeline

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W301  | NOT_STARTED | — |
| W302  | NOT_STARTED | — |
| W303  | NOT_STARTED | — |
| W304  | NOT_STARTED | — |
| W305  | NOT_STARTED | — |
| W306  | NOT_STARTED | — |

## M5 — Viewer/product

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W701  | COMPLETE    | session w701-control-api; branch 15cb093; 541/541 tests; real-user HTTP E2E 19/19 (golden path + fail-closed rights + dual-side playback gate); lint/typecheck/format clean |
| W702  | NOT_STARTED | — |
| W703  | NOT_STARTED | — |
| W704  | NOT_STARTED | — |
| W705  | NOT_STARTED | — |
| W706  | NOT_STARTED | — |

## M6 — 3D/game-style renderer

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W601  | NOT_STARTED | — |
| W602  | NOT_STARTED | — |
| W603  | NOT_STARTED | — |
| W604  | NOT_STARTED | — |
| W605  | NOT_STARTED | — |

## M7 — Release hardening

| Item  | Status      | Evidence |
|-------|-------------|----------|
| W801  | NOT_STARTED | — |
| W802  | NOT_STARTED | — |
| W803  | NOT_STARTED | — |
| W804  | NOT_STARTED | — |
| W805  | NOT_STARTED | — |
| W806  | NOT_STARTED | — |
