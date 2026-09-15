# @sporta/slo — the W802 latency SLO machinery (M7)

**Work item W802 (M7):** "SLOs, alert thresholds, and failure/degradation
policies exist." · Owner: Platform · Dependency: W306 (the measured
evidence).

**`SLOs.md` (this package) is the normative document** — objectives, alert
catalog, degradation playbook, known limitations. This README is the honest
boundary index; the code is the executable mirror, pinned row-for-row to
the document by tests (the W503 THRESHOLDS.md convention, both directions —
code and docs never drift apart silently).

## What this package is

The formalization of `@sporta/latency-benchmark`'s measured evidence (W306)
into three executable, versioned tables:

- **16 latency objectives** (`src/slos.ts`, `SLO_DEFINITIONS`, set id
  `w802-slo-v1`): 12 batch-stage objectives — the W306 SLO candidate table
  **adopted verbatim** (pinned equal to `@sporta/latency-benchmark`'s
  `SLO_CANDIDATES`, so the eval-harness case's candidate-breach FAIL is an
  SLO-objective breach gate by construction) — plus 4 frame-stage
  objectives derived from W306's measured frame evidence by a documented
  formula (`FRAME_HEADROOM_RULE`).
- **33 alert definitions** (`src/alerts.ts`, `ALERT_CATALOG`, catalog id
  `w802-alerts-v1`): two severity tiers per SLO — `warning` (headroom
  half-consumed: `ceil(baseline + (target − baseline)/2)`, an early
  operator signal while the objective still holds) and `critical`
  (objective breached: the error budget for the window is exhausted) —
  plus `loss.unexpected-frames` (the never-silent accounting made
  operational). Per SLO only the highest applicable severity fires
  (critical subsumes warning — one row per indicator, never noise).
- **4 degradation policies** (`src/policies.ts`, `DEGRADATION_POLICIES`):
  the alert → machinery playbook. The triggers **partition** the catalog:
  every alert (warnings included) is answered by exactly one policy, and
  every machinery seam is a real, importable export of the named workspace
  package — `test/policies.test.ts` imports the real packages and fails on
  any dangling reference (fail-closed).

## The honest boundary (what this is NOT)

- **Not a monitoring daemon.** Nothing here watches a live system:
  `evaluateSloCompliance` is a PURE function over ONE compliance window
  (one benchmark run). There is no rolling multi-window compliance, no
  burn-rate alerting, no paging — those need the W805 telemetry pipeline
  that does not exist yet (the documented operational gap).
- **Every number lives in the injected-clock benchmark domain** (SLOs.md
  §1, the W306 boundary verbatim): algorithmic latency structure on the
  controlled fixture — watermark-grid waits, bounded-queue sojourns, the
  W303 dispatch wait, the authored render-duration model, the reorder
  hold. NOT wall-clock or real-network SLOs; real-deployment thresholds
  need field measurement.
- **No latency-driven automation exists** — none is invented. The policy
  table's `automation` field is honestly `operator-decision` everywhere:
  the always-on protections (bounded queues, W303 retry/DLQ, never-silent
  accounting, W305 typed no-downgrade rejects) are automatic by
  construction; enabling skip-stale, choosing a queue policy, selecting an
  output profile, scaling workers are operator decisions made on the
  alert evidence.

## Usage

```sh
cd packages/slo
bun run evaluate -- <path-to-latency-report.json>   # exit 0 compliant / 1 at-risk / 2 breached / 3 usage
bun test                                           # the full suite
```

The input is a `sporta/latency-benchmark/report@1` document (the
benchmark's canonical bytes — `bun run benchmark` in that package emits
exactly that). Programmatic:

```ts
import {
  evaluateSloCompliance, parseLatencySloInput, projectBenchmarkReport,
} from "@sporta/slo";

const run = await runLatencyBenchmark();                    // @sporta/latency-benchmark (dev dep)
const input = parseLatencySloInput(projectBenchmarkReport(run.report));
const compliance = evaluateSloCompliance(input);            // verdicts + fired alerts + summary
```

## Package boundary

Runtime dependencies: exactly `zod` (the @sporta/contracts precedent) — the
structural input projection means **no runtime dependency on the benchmark
graph**: a W306 report satisfies the input schema structurally, and the
pin tests (`test/benchmark-integration.test.ts`) run the REAL benchmark and
feed its real report through. The real pipeline packages named by the
policy table (`@sporta/render-orchestration`, `@sporta/gpu-worker`,
`@sporta/processing-queues`, `@sporta/contracts`, `@sporta/webrtc-output`,
`@sporta/viewer-shell`) are DEV dependencies, consumed only by the
consistency tests that prove the named machinery exists. Zero wall-clock
reads, zero RNG anywhere in src or scripts (the constitution) — pinned by
`test/boundary.test.ts` (isolation + constitution source scans).

## Module map

| module | what it owns |
| --- | --- |
| `errors` | the typed fail-loud error surface (codes, JSON-path context) |
| `input` | the versioned, strict zod input schema + the structural projector from W306 reports |
| `slos` | `SLO_DEFINITIONS` — the objectives, every number traceable to the W306 evidence |
| `alerts` | `ALERT_CATALOG` — the thresholds with severity tiers + the pure alert evaluation |
| `policies` | `DEGRADATION_POLICIES` — the alert→machinery playbook (honest automation levels) |
| `evaluate` | `evaluateSloCompliance` — the window verdict + the deterministic human summary |
| `scripts/evaluate.ts` | the operator CLI (report file → compliance report + exit code) |
