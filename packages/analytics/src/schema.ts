/**
 * The W804 report schema (zod v4 — the repo's allowed runtime validation
 * dependency; the W306 report-schema precedent).
 *
 * The report shape is VERSIONED by {@link ANALYTICS_REPORT_SCHEMA_TAG}: any
 * change to the shape bumps the version (an old report fails loud on parse,
 * never partially accepted). `parseAnalyticsReport` is the fail-loud entry:
 * unknown keys, wrong types, negative counts, an unbalanced accounting
 * identity, or inconsistent cross-totals all throw
 * {@link AnalyticsReportValidationError} — the machine-readable report is
 * VALIDATED, never trusted.
 *
 * The schema is STRICT everywhere (exact key sets): a report is itself a
 * closed shape, mirroring the privacy posture of its input — there is no
 * field in which a session id, an error message, or any free-form payload
 * could even be represented.
 */
import { z } from "zod";
import { VIEWER_FAILURE_CLASSES } from "@sporta/viewer-shell";
import type { TimedOperation, UserFeedbackKind, ViewerOperation } from "@sporta/viewer-shell";
import { AnalyticsReportValidationError } from "./errors.ts";
import { FUNNEL_STAGE_IDS } from "./funnel.ts";
import type { DropOffAttributionKind } from "./funnel.ts";
import type { DropOffAttributionRow } from "./report.ts";
import type {
  AccountingBlock,
  BoundaryRow,
  ConnectionBlock,
  FailureClassBucket,
  FunnelSection,
  FunnelStageRow,
  PlaybackHealthBlock,
  ProductAnalyticsReport,
  SessionOutcomeRow,
} from "./report.ts";

/** The report schema version (bump on ANY report shape change). */
export const ANALYTICS_REPORT_SCHEMA_VERSION = 1;

/** The canonical report schema tag (carried verbatim in every report). */
export const ANALYTICS_REPORT_SCHEMA_TAG = "sporta/analytics/report@1";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

const nonNegativeInt = z.number().int().min(0);
const nonEmptyString = z.string().min(1);

const failureClassSchema = z.enum(VIEWER_FAILURE_CLASSES);
const stageIdSchema = z.enum(FUNNEL_STAGE_IDS);

/** The named (non-error) attribution categories (closed set, from `./funnel.ts`). */
const NAMED_ATTRIBUTION_KINDS = [
  "live-path-taken",
  "batch-path-taken",
  "outputs-pending",
  "load-in-progress",
  "selection-cancelled",
  "no-error-observed",
] as const satisfies readonly DropOffAttributionKind[];

const attributionRowSchema: z.ZodType<DropOffAttributionRow> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("error"),
    failureClass: failureClassSchema,
    count: nonNegativeInt,
  }),
  z.strictObject({
    kind: z.enum(NAMED_ATTRIBUTION_KINDS),
    count: nonNegativeInt,
  }),
]);

const timingStatsSchema = z.strictObject({
  count: nonNegativeInt,
  minMs: z.number().finite().min(0),
  maxMs: z.number().finite().min(0),
  meanMs: z.number().finite().min(0),
  p50Ms: z.number().finite().min(0),
  p95Ms: z.number().finite().min(0),
});

// ---------------------------------------------------------------------------
// Section schemas
// ---------------------------------------------------------------------------

const funnelStageRowSchema: z.ZodType<FunnelStageRow> = z.strictObject({
  stage: stageIdSchema,
  reached: nonNegativeInt,
  conversionFromPrevious: z.number().finite().min(0).nullable(),
  evidence: nonEmptyString,
});

const funnelSectionSchema: z.ZodType<FunnelSection> = z.strictObject({
  path: z.enum(["batch", "live"]),
  stages: z.array(funnelStageRowSchema).min(1),
});

const boundaryRowSchema: z.ZodType<BoundaryRow> = z
  .strictObject({
    boundary: nonEmptyString,
    scope: z.enum(["session", "viewer"]),
    unit: z.enum(["sessions", "attempts"]),
    fromStage: nonEmptyString,
    toStage: nonEmptyString,
    dropOffs: nonNegativeInt,
    attribution: z.array(attributionRowSchema),
  })
  .superRefine((row, ctx) => {
    // Every drop-off (cohort or attempt) is attributed exactly once.
    const attributed = row.attribution.reduce((sum, entry) => sum + entry.count, 0);
    if (attributed !== row.dropOffs) {
      ctx.addIssue({
        code: "custom",
        path: ["attribution"],
        message: `boundary '${row.boundary}' attribution sums to ${String(attributed)} but dropOffs is ${String(row.dropOffs)}`,
      });
    }
    if (row.scope === "viewer" && row.unit !== "attempts") {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: "viewer-scope boundaries count attempts",
      });
    }
    if (row.scope === "session" && row.unit !== "sessions") {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: "session-scope boundaries count sessions",
      });
    }
  });

const sessionOutcomeRowSchema: z.ZodType<SessionOutcomeRow> = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("playback-started"),
    count: nonNegativeInt,
  }),
  z.strictObject({
    outcome: z.literal("error-terminal"),
    failureClass: failureClassSchema,
    count: nonNegativeInt,
  }),
  z.strictObject({
    outcome: z.literal("no-terminal-error"),
    count: nonNegativeInt,
  }),
]);

const operationCountsSchema: z.ZodType<Record<ViewerOperation, number>> = z.strictObject({
  connect: nonNegativeInt,
  refreshSessions: nonNegativeInt,
  createSession: nonNegativeInt,
  openSession: nonNegativeInt,
  terminateSession: nonNegativeInt,
  beginRender: nonNegativeInt,
  createRender: nonNegativeInt,
  selectRender: nonNegativeInt,
  openLive: nonNegativeInt,
});

const failureBucketSchema: z.ZodType<FailureClassBucket> = z
  .strictObject({
    failureClass: failureClassSchema,
    events: nonNegativeInt,
    byOperation: operationCountsSchema,
    sessionScoped: nonNegativeInt,
    viewerScoped: nonNegativeInt,
    remediationHint: nonEmptyString,
    ownerNote: nonEmptyString,
  })
  .superRefine((bucket, ctx) => {
    if (bucket.sessionScoped + bucket.viewerScoped !== bucket.events) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionScoped"],
        message: `failure class '${bucket.failureClass}' scope split does not sum to events`,
      });
    }
  });

const connectionSchema: z.ZodType<ConnectionBlock> = z.strictObject({
  attempts: nonNegativeInt,
  successes: nonNegativeInt,
  failures: nonNegativeInt,
  timing: timingStatsSchema.nullable(),
});

const playbackHealthSchema: z.ZodType<PlaybackHealthBlock> = z.strictObject({
  rebufferStalls: z.strictObject({
    events: nonNegativeInt,
    sessions: nonNegativeInt,
    frameDeficit: z.strictObject({
      total: nonNegativeInt,
      max: nonNegativeInt,
    }),
  }),
  integrityVerified: z.strictObject({
    events: nonNegativeInt,
    sessions: nonNegativeInt,
    maxByteLength: nonNegativeInt,
    maxFrameCount: nonNegativeInt,
  }),
});

const feedbackSchema: z.ZodType<Record<UserFeedbackKind, number>> = z.strictObject({
  "playback-good": nonNegativeInt,
  "playback-stalled": nonNegativeInt,
  "playback-poor": nonNegativeInt,
});

const timingsSchema: z.ZodType<
  Record<TimedOperation, import("./percentiles.ts").TimingStats | null>
> = z.strictObject({
  connect: timingStatsSchema.nullable(),
  "load-output": timingStatsSchema.nullable(),
  openLive: timingStatsSchema.nullable(),
});

const accountingSchema: z.ZodType<AccountingBlock> = z
  .strictObject({
    eventsIn: nonNegativeInt,
    classified: nonNegativeInt,
    unclassifiable: z.array(
      z
        .strictObject({
          reason: nonEmptyString,
          count: nonNegativeInt,
        })
        .refine((row) => row.count >= 1, "unclassifiable rows are observed-only (count >= 1)"),
    ),
    sequenceAnomalies: nonNegativeInt,
    sessionsObserved: nonNegativeInt,
    partialSessions: nonNegativeInt,
  })
  .superRefine((block, ctx) => {
    // THE never-silent accounting identity — enforced at the schema too.
    const unclassifiableTotal = block.unclassifiable.reduce((sum, row) => sum + row.count, 0);
    if (block.classified + unclassifiableTotal !== block.eventsIn) {
      ctx.addIssue({
        code: "custom",
        path: ["classified"],
        message: `accounting identity violated: ${String(block.classified)} classified + ${String(unclassifiableTotal)} unclassifiable !== ${String(block.eventsIn)} events in`,
      });
    }
    if (block.partialSessions > block.sessionsObserved) {
      ctx.addIssue({
        code: "custom",
        path: ["partialSessions"],
        message: "partial sessions cannot exceed observed sessions",
      });
    }
    const reasons = block.unclassifiable.map((row) => row.reason);
    if (new Set(reasons).size !== reasons.length) {
      ctx.addIssue({
        code: "custom",
        path: ["unclassifiable"],
        message: "unclassifiable reasons must be unique (one row per reason)",
      });
    }
  });

// ---------------------------------------------------------------------------
// The report schema
// ---------------------------------------------------------------------------

/**
 * The complete, strict report schema (see `./report.ts` for the types and
 * `../FUNNEL.md` for the semantics). Any shape change bumps
 * {@link ANALYTICS_REPORT_SCHEMA_VERSION} / {@link ANALYTICS_REPORT_SCHEMA_TAG}.
 */
export const ProductAnalyticsReportSchema: z.ZodType<ProductAnalyticsReport> = z
  .strictObject({
    schemaVersion: z.literal(ANALYTICS_REPORT_SCHEMA_VERSION),
    schemaTag: z.literal(ANALYTICS_REPORT_SCHEMA_TAG),
    vocabulary: z.strictObject({
      telemetrySchemaVersion: z.number().int().min(1),
      funnelSpecVersion: z.number().int().min(1),
    }),
    funnel: z.strictObject({
      batch: funnelSectionSchema,
      live: funnelSectionSchema,
      playbackStartedOverall: nonNegativeInt,
      engagedToPlaybackStarted: z.number().finite().min(0).nullable(),
      batchPlaybackCompleted: nonNegativeInt,
      liveEndedObserved: nonNegativeInt,
    }),
    connection: connectionSchema,
    failures: z.strictObject({
      byClass: z.array(failureBucketSchema).min(1),
      viewerBoundaries: z.array(boundaryRowSchema).min(1),
      sessionBoundaries: z.array(boundaryRowSchema).min(1),
      sessionOutcomes: z.array(sessionOutcomeRowSchema).min(1),
    }),
    playbackHealth: playbackHealthSchema,
    feedback: feedbackSchema,
    timings: timingsSchema,
    accounting: accountingSchema,
  })
  .superRefine((report, ctx) => {
    // The funnel paths are the normative lengths (5 batch stages, 3 live).
    if (report.funnel.batch.stages.length !== 5) {
      ctx.addIssue({
        code: "custom",
        path: ["funnel", "batch", "stages"],
        message: "the batch path has exactly 5 stages (the normative funnel definition)",
      });
    }
    if (report.funnel.live.stages.length !== 3) {
      ctx.addIssue({
        code: "custom",
        path: ["funnel", "live", "stages"],
        message: "the live path has exactly 3 stages (the normative funnel definition)",
      });
    }
    // Both paths' first stage is the shared session-engaged row (same count).
    const batchFirst = report.funnel.batch.stages[0];
    const liveFirst = report.funnel.live.stages[0];
    if (
      batchFirst === undefined ||
      liveFirst === undefined ||
      batchFirst.stage !== "session-engaged" ||
      liveFirst.stage !== "session-engaged" ||
      batchFirst.reached !== liveFirst.reached
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["funnel"],
        message: "both paths must open with the SAME session-engaged row",
      });
    }
    // Every cohort lands in exactly one session outcome.
    const outcomeTotal = report.failures.sessionOutcomes.reduce((sum, row) => sum + row.count, 0);
    if (outcomeTotal !== report.accounting.sessionsObserved) {
      ctx.addIssue({
        code: "custom",
        path: ["failures", "sessionOutcomes"],
        message: "session outcomes must total exactly the observed sessions",
      });
    }
    // The connect-failure count equals the connect-operation error events.
    const connectErrors = report.failures.byClass.reduce(
      (sum, bucket) => sum + bucket.byOperation.connect,
      0,
    );
    if (connectErrors !== report.connection.failures) {
      ctx.addIssue({
        code: "custom",
        path: ["connection", "failures"],
        message: "connection.failures must equal the connect-operation error events",
      });
    }
  });

/**
 * Parses + validates a product analytics report document (fail-loud): any
 * schema violation throws {@link AnalyticsReportValidationError} carrying the
 * zod issues. Never partially accepts a report.
 */
export function parseAnalyticsReport(value: unknown): ProductAnalyticsReport {
  const result = ProductAnalyticsReportSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    });
    throw new AnalyticsReportValidationError(
      `not a valid product analytics report (${String(issues.length)} issues): ${issues.join("; ")}`,
      issues,
    );
  }
  return result.data;
}
