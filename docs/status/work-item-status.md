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
| W202  | NOT_STARTED | — |
| W203  | NOT_STARTED | — |
| W204  | NOT_STARTED | — |
| W205  | NOT_STARTED | — |
| W206  | NOT_STARTED | — |
| W207  | NOT_STARTED | — |
| W208  | NOT_STARTED | — |
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
