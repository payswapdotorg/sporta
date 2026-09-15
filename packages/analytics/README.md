# @sporta/analytics — the W804 product analytics package

**Work item W804 (M7):** "product funnel and failure metrics are
documented, privacy-scoped, and actionable." Dependencies: W706 (the
telemetry event model — this package's entire input).

Product analytics is a **pure, deterministic, OFFLINE derivation over
RECORDED W706 viewer telemetry event streams**. `computeProductAnalytics`
takes validated events and produces a versioned, zod-validated,
byte-deterministic report: the two-path product funnel, per-boundary
drop-off attribution, the verbatim failure-class histogram with
remediation + owner pointers, playback health, feedback counts, and the
never-silent accounting ledger.

The normative documents:

- **`FUNNEL.md`** — the funnel definition: stages + evidence sources,
  boundary attribution rules, the complete metric catalog with formulas,
  the privacy scope, the documented gaps, and the W805 dashboard seam;
- `TELEMETRY.md` (in `@sporta/viewer-shell`) — W706's privacy-scope
  decision, including the §7 "W804 analytics boundary" (these events are
  the raw material; W706 counts nothing).

## Usage

```sh
cd packages/analytics
bun test          # the full suite
bun run typecheck
```

```ts
import {
  analyzeRecordedStream,
  deserializeAnalyticsReport,
  serializeAnalyticsReport,
} from "@sporta/analytics";

// values: the parsed lines of a W706 JSONL recording (or equivalent)
const report = analyzeRecordedStream(values);
const bytes = serializeAnalyticsReport(report); // canonical, byte-deterministic
const back = deserializeAnalyticsReport(bytes); // re-validated fail-loud
```

The report is also self-validating: `computeProductAnalytics` runs its
own output through `parseAnalyticsReport` (a shape bug fails loud inside
the computation, never reaching a consumer).

## Module map

| Module | Role |
| --- | --- |
| `src/funnel.ts` | the NORMATIVE funnel definition — stages, evidence rules, the boundary table, owner notes (constant tables; the report derives from them) |
| `src/input.ts` | the W706 input boundary — the REAL W706 validator is the ONE gate (wider events fail loudly, naming the field) |
| `src/percentiles.ts` | deterministic nearest-rank timing statistics |
| `src/report.ts` | the report types + `computeProductAnalytics` (pure; never-silent accounting) |
| `src/schema.ts` | the versioned zod report schema + `parseAnalyticsReport` |
| `src/canonical.ts` | byte-deterministic report serialization + the reader |
| `src/errors.ts` | the fail-loud error model (`AnalyticsInputError`, `AnalyticsReportValidationError`, `AnalyticsAccountingError`) |

## Honest boundaries

- **No consent workflow exists.** W706 disclosed the privacy note in the
  viewer UI and stops collecting when no sink is wired, but there is no
  consent/preference workflow anywhere in the system yet. **A deployment
  that enables telemetry collection must put a consent gate in front of
  the sink BEFORE this package's reports are used to make product
  decisions.** That gate is product work this codebase has not done —
  recorded here as a deployment prerequisite, not hand-waved away.
- **Analytics is computed offline over recorded streams.** This package
  contains NO collection, NO network, NO clocks, NO randomness — it is a
  pure function of its input (constitution-clean; source-scan pinned by
  tests). Collection, transport, retention, and dashboards are
  operations' world (W805); W804 owns the product interpretation.
- **The input IS the W706 closed vocabulary.** Anything wider fails
  validation loudly with W706's own reason (the privacy pin; tests run
  the sensitive-key battery). The report is aggregate-only: no session
  ids, no error messages — test-pinned.
- **Funnel stages are limited to what the W706 vocabulary can honestly
  evidence.** Stage counts are independent evidence counts; the
  `selectRender` skip path and truncated windows can produce conversions
  above 1 (see FUNNEL.md §8) — flagged via `partialSessions`, never
  silently normalized.
- **Metrics that need data outside the vocabulary are documented gaps,
  never widened surfaces** — the list is FUNNEL.md §10 (time-in-stage,
  unique users, dropped frames, renderer health, per-render errors,
  opt-in rates, session duration).
- **`atMs` is the injected clock domain** (W706's decision): timings in
  the report characterize the viewer's own measured operations, not
  wall-clock SLOs.

## Testing

`bun test packages/analytics` runs the suite: metric correctness on
constructed REAL-shaped streams (happy paths, every terminal failure
class, partial sessions, unclassifiable-event accounting), the normative
table pins, schema validation (every violation class), determinism
(byte-identical reports), and the privacy boundary pins (wider events
rejected loudly; the report stays aggregate-only). One integration test
generates its stream through the REAL W706 emitter + in-memory sink to
prove the input boundary accepts exactly what W706 produces.
