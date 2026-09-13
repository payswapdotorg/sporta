/**
 * Media session contracts: the unit of processing and its lifecycle.
 *
 * A `MediaSession` identifies one processing context and references an
 * authorization policy (docs/contracts/sports-world-model.md). Lifecycle per
 * docs/contracts/streaming.md:
 * `created -> authorized -> ingesting -> normalizing -> processing ->
 * rendering -> delivering -> completed`, with explicit `failed`/`cancelled`
 * terminal states. Terminal failures are classified, cancellation is
 * idempotent.
 */
import { z } from "zod";
import { Watermark } from "./timestamps";
import { schemaVersionField } from "./versioning";

/** Session lifecycle states (lowercase wire form). */
export const SessionStatus = z.enum([
  "created",
  "authorized",
  "ingesting",
  "normalizing",
  "processing",
  "rendering",
  "delivering",
  "completed",
  "failed",
  "cancelled",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** Source media is either an uploaded file or a live stream. */
export const SourceMediaKind = z.enum(["file", "stream"]);
export type SourceMediaKind = z.infer<typeof SourceMediaKind>;

/** Classification of terminal session failures. */
export const TerminalFailureClass = z.enum([
  "rights-denied",
  "media-invalid",
  "resource-limit",
  "internal",
]);
export type TerminalFailureClass = z.infer<typeof TerminalFailureClass>;

/**
 * One authorized source attached to a session. `declaredRightsPolicyId` must
 * reference the session's authorization policy declared at the ingestion
 * boundary (fail-closed rights, architecture-lock §11).
 */
export const SourceMedia = z.object({
  sourceId: z.string().min(1),
  kind: SourceMediaKind,
  container: z.string().min(1).optional(),
  videoStreams: z.number().int().min(0),
  audioStreams: z.number().int().min(0),
  durationMs: z.number().min(0).optional(),
  declaredRightsPolicyId: z.string().min(1),
});
export type SourceMedia = z.infer<typeof SourceMedia>;

/**
 * The normalized canonical timeline for a session, with the measured offsets
 * of the video and audio clocks relative to it. `driftMeasured` records
 * whether clock alignment has actually been measured (W103 semantics).
 */
export const SessionTimeline = z.object({
  durationMs: z.number().min(0),
  videoClockOffsetMs: z.number(),
  audioClockOffsetMs: z.number(),
  driftMeasured: z.boolean(),
});
export type SessionTimeline = z.infer<typeof SessionTimeline>;

/** Current processing state of a session (stage + progress + failure info). */
export const ProcessingState = z.object({
  stage: z.string().min(1),
  watermark: Watermark.optional(),
  lastError: z.string().optional(),
  terminalFailureClass: TerminalFailureClass.optional(),
});
export type ProcessingState = z.infer<typeof ProcessingState>;

/** A media session: the unit of processing and the root of session-scoped ids. */
export const MediaSession = z.object({
  sessionId: z.string().min(1),
  schemaVersion: schemaVersionField,
  status: SessionStatus,
  authorizationPolicyId: z.string().min(1),
  sources: z.array(SourceMedia).min(1),
  timeline: SessionTimeline,
  processingState: ProcessingState,
  createdAtIso: z.iso.datetime(),
  cancelledAtIso: z.iso.datetime().optional(),
});
export type MediaSession = z.infer<typeof MediaSession>;
