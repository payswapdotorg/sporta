# @sporta/eval-harness — the W801 evaluation harness

The work item's accept criterion made executable: **"repeatable benchmark
suite produces machine-readable reports."**

One declarative, versioned, schema-validated suite config names the benchmark
cases; the runner executes each case **in-process against the REAL evaluator
packages** and produces ONE canonical, versioned, schema-validated,
machine-readable aggregate report — deterministically, with byte-identical
reruns (same binary, honestly scoped).

| Case | Real evaluator (runtime dep) | What it measures |
| --- | --- | --- |
| `w403-replay-comparability` | `@sporta/evaluation` (W403) | Cross-run world-model comparability over the frozen fixture + golden, through the field-classified tolerance comparator. The evaluator's method spawns its own bun subprocesses (cross-RUN means cross-process there); the harness calls its public API in-process. |
| `w503-temporal-consistency` | `@sporta/renderer-evaluation` (W503) | Identity flicker, style (token + byte) stability, geometry drift, temporal artifacts over the clean W502-rendered clip — plus the detection proof (nine injected defects, each must flip the verdict). |
| `w601-scene-conformance` | `@sporta/scene-projection` (W601) | Scene-projection conformance S1–S8 in FULL-EVIDENCE mode (snapshot + events + camera slots supplied; identity/verbatim/byte-identity checks all enabled) over the checked-in scene fixture. |

## Layout

```
fixtures/suite.json                       the checked-in suite config (the suite definition)
fixtures/w601-scene-fixture.json          the W601 case's frozen input (generated; see §W601 fixture)
fixtures/golden/suite-report-golden.json  the checked-in golden report (the drift gate)
scripts/run-once.ts                       runs the suite once; canonical report bytes to stdout
scripts/evaluate.ts                       the CLI (exit 0/1/2; --report; --json)
scripts/regen-golden.ts                   explicit, reviewed golden regeneration (--confirm)
scripts/generate-w601-fixture.ts          explicit, reviewed W601 fixture regeneration (--confirm)
src/suite-config.ts                       declarative config + strict validation (no defaults)
src/runner.ts                             runSuite: executors, crash containment, conjunction
src/cases/w403.ts · w503.ts · w601.ts     the three case executors (real evaluators)
src/report.ts · src/validate.ts           the versioned report shape + fail-loud self-check
src/environment.ts                        honest deterministic environment facts
src/clock.ts                              the injected-clock seam
src/w601-fixture.ts                       the W601 golden-fixture construction (provenance)
```

## Usage

From `packages/eval-harness` (or the repo root with `--suite`):

```bash
bun run evaluate                     # human summary; exit 0 PASS / 1 FAIL / 2 structural
bun run evaluate --report out.json   # additionally write the canonical report bytes
bun run evaluate --json              # print the canonical report to stdout
bun run regen-golden --confirm      # regenerate the golden (REQUIRES review; see below)
bun run regen-w601-fixture --confirm
```

Programmatically:

```ts
import { loadSuiteConfig, runSuite, serializeSuiteReport } from "@sporta/eval-harness";
const report = runSuite(loadSuiteConfig());          // SuiteReport (typed, validated)
const bytes = serializeSuiteReport(report);          // canonical bytes (W403 serializer)
```

## The suite config (declarative, versioned, no defaults)

`fixtures/suite.json` is the checked-in suite definition. Shape (validated by
`validateSuiteConfig`, strict — unknown keys/kinds, missing fields, wrong
types, duplicate names all FAIL LOUD before anything runs):

```jsonc
{
  "suiteKind": "sporta/eval-harness/suite-config@1",  // versioned shape tag
  "suiteId": "sporta-eval-harness-default",
  "suiteVersion": 1,
  "cases": [
    {
      "caseName": "w403-replay-comparability",        // caller-chosen, unique
      "caseKind": "w403-replay-comparability",        // CONTROLLED vocabulary (CASE_KINDS)
      "fixture": { "fixturePath": "../../evaluation/fixtures/w403-fixture.json",
                   "goldenPath": "../../evaluation/fixtures/golden/w403-golden.json" },
      "policy": { "runs": 2 }
    },
    { "caseName": "w503-temporal-consistency", "caseKind": "w503-temporal-consistency",
      "fixture": { "clip": "w503-clean-fixture" },    // the only clip the evaluator ships
      "policy": { "detectionProof": true } },
    { "caseName": "w601-scene-conformance", "caseKind": "w601-scene-conformance",
      "fixture": { "sceneFixturePath": "./w601-scene-fixture.json" },
      "policy": { "evidence": "full" } }
  ]
}
```

Rules with teeth:

- **Unknown case kinds fail loud**, listing the known kinds — a new kind is a
  conscious harness extension (executor + report shape + docs), never a
  silent skip. Case names are caller-chosen but must be unique.
- **No defaults**: every case declares its `fixture` and `policy` explicitly;
  an omitted field is a validation error, never a filled-in value.
- Fixture paths are **relative to the suite config file**; the REPORT carries
  the verbatim declared (relative) values, never resolved absolute paths, so
  report bytes stay machine-independent.
- The validated config is canonicalized (W403 serializer: sorted keys, full
  precision) and hashed (sha256) — the **suite config hash** pins the report
  to the exact config that produced it.

## The runner: containment, conjunction, clocks

`runSuite(loaded, { clock? })` walks the cases in declared order:

- **Crash containment**: an executor that throws (malformed fixture, missing
  file, evaluator exception) becomes a FAILED case result carrying
  `error.errorClass` + `error.message`; the suite CONTINUES and the aggregate
  reports the crash, attributed (`caseName: case crashed: …`). A case that
  cannot run is a structural **FAIL, never a skip** — there is no skip
  vocabulary anywhere in the harness.
- **Aggregate is a strict conjunction**: `aggregate.verdict` is PASS iff
  every case passed. No weights, no score averaging, no partial credit — see
  §Aggregation honesty.
- **The report self-checks** (`assertSuiteReportShape`) before returning:
  unknown keys, echo mismatches, non-conjunction, unattributed failures, and
  non-monotonic clock reads all throw (a harness bug fails loud; it is never
  demoted to a case failure).

### Timings and the injected clock

The repo constitution bans ambient clocks (`Date.now`, `new Date()`,
`performance.now`) everywhere in evaluated paths. The harness therefore
measures case "timings" **in the injected-clock domain only**: an injectable
`SuiteClock` (`now()` seam, the `SessionLifecycle({ now })` precedent) is
read before and after each case and around the suite; the default is a
deterministic step clock anchored at `TEST_EPOCH_MS` (from `@sporta/testing`)
advancing 1 ms per read.

**Honest statement**: these reads are deterministic ordinals of suite
progression, NOT wall-clock durations. Real elapsed-time measurement would
require a wall clock, which the constitution forbids — it is deliberately
not attempted and not faked. (The report deliberately contains no duration
claim anywhere.)

## The report (canonical, versioned, machine-readable)

`REPORT_SCHEMA_TAG = "sporta/eval-harness/suite-report@1"`. Shape:

```jsonc
{
  "reportSchema": "sporta/eval-harness/suite-report@1",
  "suite": { "suiteId": …, "suiteVersion": …, "suiteConfigSha256": …, "config": … },
  "environment": { "packageVersions": { "@sporta/evaluation": "0.1.0", … } },
  "clock": { "startMs": …, "endMs": … },              // injected-clock domain
  "cases": [
    { "caseKind": …, "caseName": …, "verdict": "PASS" | "FAIL",
      "fixture": …, "policy": …,                      // echoed VERBATIM from the config
      "clock": { "startMs": …, "endMs": … },
      "thresholds": …,                                // the evaluator's constants, verbatim
      "measured": …,                                  // measured values, VERBATIM (per-case shape)
      "failureReasons": [ … ],                        // empty iff PASS
      "error": { "errorClass": …, "message": … } }    // present iff the case crashed
  ],
  "aggregate": { "verdict": …, "caseCount": …, "passCount": …, "failCount": …,
                 "failureReasons": [ "caseName: reason", … ] }
}
```

Per-case `measured` (what "verbatim" means for each kind):

- **W403** — the evaluator's `EvaluationReport` **except** the per-run
  `canonical` artifact bytes and parsed `artifact` payloads, which are
  dropped (they are the evaluated DATA — multi-KB each, byte-pinned by the
  evaluator's own checked-in golden and sha256-pinned fixture — not the
  measurement). Kept verbatim: run statuses, every pairwise comparison, the
  golden comparison, the failure reasons. A test pins the projection:
  `measured` deep-equals a hand-trimmed copy of the evaluator's direct
  output, so nothing else is altered.
- **W503** — the evaluator's full `TemporalConsistencyReport` (identity,
  style bytes, geometry, artifacts, and every threshold check with its
  measured value), plus the detection-proof results (nine injections, each
  `detected` + its failing metrics).
- **W601** — the evaluator's `SceneConformanceReport` (every check with its
  verdict + detail), verbatim.

Per-case `thresholds` (the applied policy, verbatim from the evaluator's
exports — the report's shape check RE-VERIFIES them against the live
constants, so a threshold drift forces a report regeneration):

- W403: `defaultEpsilon` (`DEFAULT_EPSILON`) + the tolerance document
  reference (`packages/evaluation/TOLERANCE.md`).
- W503: the `THRESHOLDS` object (documented + pinned by the evaluator's own
  THRESHOLDS.md).
- W601: rule-based conformance has no numeric thresholds — the applied rule
  ids (`checkIds`), which must equal the measured checks' ids.

### Canonical serialization

The report's byte form is the **W403 serializer** (`serializeArtifact` from
`@sporta/evaluation`): sorted keys at every level, full float precision
(nothing rounded or coerced), NaN/±Infinity/undefined REJECTED with the JSON
path, 2-space indent + trailing newline. The harness reuses that authority
by import — its canonical form is the repo's canonical form by construction.

### Environment honesty

The environment block is **measured, not asserted**: the harness reads each
runtime dependency's `package.json` from the workspace at run time and
records `name` + `version` (with an integrity check that the read file
declares the expected `@sporta/*` name). Deliberately EXCLUDED:

- **no wall clock / timestamps** — banned by the constitution; the report's
  only time values are injected-clock domain reads;
- **no hostname / user / OS** — machine identity is not evidence and would
  make report bytes machine-dependent;
- **no bun/runtime version** — it varies across environments (local vs CI)
  and would make the checked-in golden fragile; same-binary identity is
  PROVEN byte-wise by the rerun tests, never asserted by a version string;
- **no random run ids** — there is no RNG anywhere in the harness.

What remains (package versions) is deterministic per commit: same worktree →
same environment block, every run, every subprocess.

### Aggregation honesty

The aggregate verdict is a **strict conjunction** — every case must PASS.
There are **no weights** (the config schema has no weight field and rejects
one), **no score averaging** (the W403 e2e mutation test proves a
`scoreAverage` key fails the shape check), and **no skips** (a case that
cannot run is a FAILED case with its error). Every failing case contributes
at least one machine-readable failure reason, attributed by case name —
nothing is ever swallowed.

## Repeatability proof (same-binary, honestly scoped)

Pinned by tests (`test/determinism.test.ts`, `test/cli.test.ts`):

1. **Suite ×2 in-process**: two `runSuite` calls are deep-equal and their
   canonical serializations byte-identical.
2. **Suite ×2 in separate bun subprocesses** (`scripts/run-once.ts`): both
   print byte-identical canonical bytes, equal to the in-process bytes
   (cross-mode identity).
3. **CLI ×2 in separate bun subprocesses** (`--report` + `--json`): the two
   report FILES are byte-identical, equal to the `--json` stdout, equal to
   the in-process canonical bytes, and equal to the checked-in golden's
   canonical form.

**Honest scope**: this is SAME-BINARY, SAME-WORKTREE evidence (the W403
posture). It proves the suite has no hidden nondeterminism (no clock reads,
no RNG, no map-iteration leaks, no unsorted output). It does NOT claim
cross-binary or cross-machine byte-identity — that would require identical
package versions AND identical floating-point behavior everywhere, which is
precisely why the environment block records the versions it ran with.

## The W503 detection proof

With `policy.detectionProof: true`, the W503 case replicates the evaluator
package's own nine-injection proof set (the list
`packages/renderer-evaluation/scripts/evaluate.ts` runs): unexplained
absence, manifest style instability, SVG byte-level style instability,
geometry teleport, watermark regression, disposition flap, applied-sequence
gap, duplicate event attribution, caption window overlap. Each injection is
re-evaluated; every one must flip the verdict to FAIL. One going undetected
fails the case (`detection proof: injection "…" went UNDETECTED`).

## The W601 fixture

The W601 case's input is the checked-in `fixtures/w601-scene-fixture.json`:
the snapshot + event tail + camera-slot selection of the scene-projection
package's golden fixture, built by driving a real `WorldModelEngine`
(injected clock) — the W601 test helpers are test-only, so the construction
is **replicated** in `src/w601-fixture.ts` (the W503 precedent for exactly
this situation). Provenance is pinned three ways by tests: the checked-in
file IS the builder's serialization; the builder is deterministic
(deep-equal reruns); and the scene projected from the file is structurally
deep-equal to `@sporta/scene-projection`'s own checked-in golden SCENE —
the replication is proven faithful at the scene level, not just
structurally. Regeneration is explicit (`bun run regen-w601-fixture
--confirm`) and invalidates the report golden.

## Golden discipline

`fixtures/golden/suite-report-golden.json` is the acceptance baseline: the
fresh suite's canonical bytes must equal the golden's canonical form
(canonical-to-canonical — the golden FILE is Prettier-formatted, which is
lossless, so cosmetic file changes cannot create false drift, while any
semantic change — verdict, measured value, threshold, config hash,
environment version, clock read — is detected; mutation tests pin each
class). Regeneration requires `--confirm` and tech-lead review
(`bun run regen-golden --confirm` verifies Prettier losslessness + a second
subprocess run + an in-process run before writing, and reports whether the
suite-config sha256 changed — a config change must be a separate, reviewed
act).

## Package boundary

Runtime dependencies are `@sporta/*` only — `evaluation`,
`renderer-evaluation`, `scene-projection`, `world-model`, `testing`,
`contracts` (all consumed through their public APIs). No external deps; the
canonical serializer is imported from `@sporta/evaluation`, not duplicated.
No `Math.random`, no `Date.now`, no `new Date()`, no `performance.now`
anywhere in the harness; every time value is an explicit constant or an
injected-clock read.

## Honest limitations

- **Timings are injected-clock ordinals, not durations** (see above) — the
  harness makes no latency claim. Real performance measurement is W802's
  (Latency SLOs) subject, not this harness's.
- **Same-binary repeatability only** — cross-binary/cross-machine
  byte-identity is not claimed (see above).
- **Failure reports may embed resolved absolute paths**: the underlying
  evaluators' error messages (e.g. a missing golden baseline) quote the
  paths they were given. The PASSING report (and therefore every golden) is
  path-free and machine-independent; ad-hoc failing-suite reports are
  transient and were never meant to be portable.
- **The W403 case's measured projection drops the per-run artifact payloads**
  (documented above); the artifacts remain reproducible via the evaluator's
  own CLI and pinned by its own golden.
- **W601 evidence modes**: this harness implements `evidence: "full"` only;
  the conformance harness's standalone (no-evidence) mode is available from
  `@sporta/scene-projection` directly. New modes are conscious extensions.
- **The suite's case universe is the three shipped evaluators** (W806 is the
  final consumer of this aggregate). W802/W803-style evaluators (latency,
  3D-output correctness) will extend the case vocabulary when they land —
  each extension is a conscious act: executor + config vocabulary + report
  shape check + docs + golden regeneration.
