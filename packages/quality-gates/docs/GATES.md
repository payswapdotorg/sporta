# W803 release gates — the normative policy document

**Work item W803 (M7):** "release gates include temporal stability, scene
correctness, and human/automated quality checks."

Canonical executable references: `src/policy.ts` (`GATE_POLICY`,
`GATE_POLICY_VERSION`), `src/human.ts` (`HUMAN_CHECKLIST`), `src/report.ts`
(`evaluateReleaseReadiness`), `src/visual-correctness.ts`
(`evaluateVisualCorrectness` — the R307 gate). The §2 table and §3
checklist are pinned row-for-row to the code by `test/policy-doc.test.ts`
— a change to either side without the other fails the suite (the W503
THRESHOLDS.md convention, both directions).

**Policy version: `w803@2`.** (History: `w803@2` adds the
`visual-correctness` gate — R307, §7 below. `w803@1` carried the original
three gates.)

## 1. What this suite is

The release-gate suite composes the REAL evaluations of the two completed
evaluation packages into one release verdict. It re-implements NOTHING and
defines ZERO new numeric thresholds — the machine gates' thresholds are
REFERENCED from the source packages' own pinned threshold documents
(`@sporta/renderer-evaluation` THRESHOLDS.md, `@sporta/scene-evaluation`
THRESHOLDS.md). The roadmap rule governs: a number without measured
evidence is an aspiration, not an SLO — and not a gate.

## 2. The gate policy table

| gate id | source | blocking |
|---|---|---|
| temporal-stability | @sporta/renderer-evaluation | blocking |
| scene-correctness | @sporta/scene-evaluation | blocking |
| visual-correctness | @sporta/encoding | blocking |
| human-review | @sporta/quality-gates/human | blocking |

All four gates are BLOCKING in `w803@2`: their FAIL (or NOT-RUNNABLE)
makes the release FAIL. The blocking column is explicit policy, never
implied — an advisory gate would be recorded here as `advisory` and never
block (none exist yet; the column exists so adding one is a documented
policy change, not a silent code path).

## 3. The human-review checklist

The checklist items a completed review records (pinned to `HUMAN_CHECKLIST`
in `src/policy.ts`; the record format is documented in `docs/REVIEW.md`):

- `one-rendered-clip-per-renderer-path-inspected`
- `gate-report-read-in-full`
- `sign-off-recorded`

## 4. Verdict semantics (one place: `src/report.ts`)

- **PASS** — every blocking gate PASSes: the machine gates green AND the
  human record complete with every checklist item `pass`.
- **PENDING-HUMAN-REVIEW** — every machine gate PASSes but the human
  record is absent, malformed, or incomplete. Never a PASS, never silent.
- **FAIL** — any blocking gate FAILs or is NOT-RUNNABLE (a gate that
  cannot run is a failed release check, never a skipped one), or the human
  record is complete with a `fail` checklist item.

The accounting is never silent: `gateCount = pass + fail + not-runnable +
pending`, reconciled on every report; a gate that silently vanished would
break the reconciliation, not the honesty.

## 5. Determinism

`evaluateReleaseReadiness` is a deterministic function of its input (the
human-review record; the fixtures the gate runners evaluate are the source
packages' own deterministic fixtures): no clock, no randomness in `src`
(pinned by the constitution source scan). Same input → byte-identical
report, in-process and across subprocesses (SHA-256 compared by
`test/report.test.ts` and `test/subprocess.test.ts`). The
`visual-correctness` gate (§7, `w803@2`) performs REAL bounded media work
(a real engine render + a real ffmpeg encode + a real decode) over the
same deterministic fixture domain — its determinism bound is the encoding
plane's documented per-build byte-determinism (same fixture domain + same
ffmpeg build → same artifact hash → same report).

## 6. Honest boundaries

- The temporal/scene machine gates measure what W503/W605 measure —
  nothing more (composition, policy, accounting; no new thresholds). The
  R307 visual-correctness gate (§7) composes W605/W503's REAL evaluations
  plus the R306 verify plane; its ONE new metric (the spike-pair flicker
  signature, a zero-threshold) carries the measured evidence recorded in
  §7 — the roadmap rule, honored.
- The human gate records that review HAPPENED and WHAT was checked — it
  cannot verify review QUALITY. The checked-in demo record is a pipeline
  self-check, explicitly NOT a human attestation (see `docs/REVIEW.md`).
- The suite evaluates the repo's deterministic fixtures, not production
  traffic; production release gating needs the deployment-side telemetry
  (the W804/W805 recorded operational gap).
- The CLI's demo run uses the checked-in record; a REAL release sign-off
  requires a REAL record (a human reviewer, the checklist, a date).

## 7. The visual-correctness gate (R307 — added in `w803@2`)

Work item R307: "score/clock/event order/player continuity/ball continuity
are correct enough for the supported MVP fixture envelope and temporal
stability is measured." `evaluateVisualCorrectness(artifact, envelope)`
(`src/visual-correctness.ts`) evaluates ONE R306 `EncodedArtifact` (a REAL
MP4 from the encoding plane) against the MVP fixture envelope — the
EXISTING fixtures only (never new ones): the W605 clean match fixture
(`buildCleanMatchFixture`), the W503 clean fixture
(`renderW503CleanFixture`), and the R301/R303/R304 conformance runs (the
W501 `runConformance` harness over the real tactical / game-3d /
anime-npr plugins).

Per-axis statuses are PASS / FAIL / NOT-RUNNABLE, reconciled
(`axisCount = pass + fail + not-runnable`); an axis that cannot run
counts as FAIL for the verdict (the §4 posture). The artifact's sha-256
content hash is pinned in every report. The axes:

- **score / clock / player-identity-continuity / event-ordering /
  ball-continuity** — `@sporta/scene-evaluation`'s own dimension verdicts
  over the envelope's scene fixture (all-zero thresholds — the renderer is
  deterministic); ball continuity is the scene-state dimension (the
  scene-state truth, per-entity entry comparison incl. the ball).
- **temporal-stability** — the `@sporta/renderer-evaluation` POSTURE on
  two planes: (a) the real W503 evaluation over the W503 clean fixture
  (identity/palette stability MEASURED on the render-document plane — its
  own verdict and numbers); (b) the ARTIFACT plane — the artifact's
  actual MP4 frames decoded (real ffmpeg) and measured: per-pair mean
  absolute RGB difference (min/median/max — numbers with provenance:
  which frames, which metric) plus the zero-threshold flicker signature.
- **artifact-integrity** — the R306 verify plane: the container manifest
  validated, the bytes re-hashed to the recorded content hash, and the
  ffprobe cross-check.
- **renderer-conformance** — every supplied R301/R303/R304 conformance
  report must have passed (none supplied ⇒ NOT-RUNNABLE ⇒ FAIL).

The flicker signature and its MEASURED evidence (the roadmap rule — a
number without measured evidence is an aspiration, not a gate): a pair of
decoded frames is a SPIKE pair iff
`pairDiff > max(SPIKE_ABS_FLOOR=10, SPIKE_RATIO=8 × medianPairDiff)`,
where pairDiff is the mean absolute per-channel RGB difference (0-255)
between consecutive frames. The gate requires `spikePairCount === 0`.
Measured on this machine's fixture domain: the CLEAN artifacts (game-3d,
anime-npr, tactical — 320×180@25 and 640×360@12.5) measured max pairDiff
≤ 4.12 with ratio ≤ 2.40 (0 spike pairs everywhere); the INJECTED
frame-flicker fixtures (one inverted frame) measured max ≥ 58.6 with
ratio ≥ 34.2 (exactly 2 spike pairs — the pairs around the corrupted
frame). The constants (10, 8×) sit between with >4× margins on both
sides. Honest boundary: sub-visible flicker (a single-frame deviation
below the absolute floor) is not caught; the injected-defect fixtures are
visible corruptions. The measured baseline moves only with re-measured
evidence (the constants are pinned by test with this table).
