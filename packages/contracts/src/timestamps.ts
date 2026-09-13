/**
 * Canonical timestamp contracts.
 *
 * Two clocks exist in Sporta:
 *
 * - the **canonical media timeline** (`eventTimeMs`): the non-negative
 *   position in milliseconds on the normalized session timeline. All events,
 *   observations, and snapshots are keyed to this timeline;
 * - the **wall-clock ingestion time** (`ingestTimeMs`): when a record entered
 *   the platform, as epoch milliseconds, where applicable.
 *
 * Watermarks combine a timeline position with a monotonic sequence number so
 * downstream stages can report progress and lag relative to the canonical
 * media timeline.
 */
import { z } from "zod";

/** Position on the canonical media timeline (non-negative milliseconds). */
export const TimelinePoint = z.object({
  eventTimeMs: z.number().min(0),
});
export type TimelinePoint = z.infer<typeof TimelinePoint>;

/** Wall-clock ingestion time in epoch milliseconds, where applicable. */
export const IngestedAt = z.object({
  ingestTimeMs: z.number(),
});
export type IngestedAt = z.infer<typeof IngestedAt>;

/**
 * Closed interval on the canonical media timeline. `endTimeMs` must be
 * greater than or equal to `startTimeMs`. (This cross-field constraint is
 * enforced by the zod runtime; the exported JSON Schema is structural only.)
 */
export const Interval = z
  .object({
    startTimeMs: z.number().min(0),
    endTimeMs: z.number().min(0),
  })
  .refine((interval) => interval.endTimeMs >= interval.startTimeMs, {
    message: "endTimeMs must be greater than or equal to startTimeMs",
    path: ["endTimeMs"],
  });
export type Interval = z.infer<typeof Interval>;

/**
 * Progress marker on the canonical media timeline: a timeline position plus a
 * monotonically increasing sequence number.
 */
export const Watermark = z.object({
  watermarkMs: z.number().min(0),
  sequence: z.number().int().min(0),
});
export type Watermark = z.infer<typeof Watermark>;
