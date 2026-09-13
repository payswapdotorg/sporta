/**
 * The uncertainty value pattern for the Sports World Model.
 *
 * The SWM must "allow unknown or uncertain rather than forcing values"
 * (architecture-lock §4: explicit uncertainty rather than invented certainty).
 * Any SWM state slot that is not directly and currently established is
 * represented as `unknown` (no value) or `uncertain` (a candidate value with
 * confidence), never as a silently invented value.
 *
 * This lives in its own module (not inside `world-model.ts`) so the football
 * extension can reuse the pattern without a circular module dependency
 * (football state is referenced by the generic world snapshot).
 */
import { z } from "zod";

/** Whether a state slot is established, unknown, or a candidate. */
export const UncertaintyStatus = z.enum(["known", "unknown", "uncertain"]);
export type UncertaintyStatus = z.infer<typeof UncertaintyStatus>;

const confidenceField = z.number().min(0).max(1).optional();

/**
 * Base uncertainty value: `status` plus an optional `value` (only meaningful
 * when the slot is known or a candidate) and an optional `confidence` in
 * [0, 1].
 *
 * Runtime refinement: `status: "known"` requires a `value`. (This constraint
 * is enforced by the zod runtime; exported JSON Schemas are structural only.)
 */
export const UncertainValue = z
  .object({
    status: UncertaintyStatus,
    value: z.unknown().optional(),
    confidence: confidenceField,
  })
  .superRefine((slot, ctx) => {
    if (slot.status === "known" && slot.value === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: 'a slot with status "known" must carry a value',
      });
    }
  });

/**
 * The uncertainty value pattern as a generic TypeScript type.
 * `T` defaults to `unknown` for generic per-kind state maps.
 */
export type UncertainValue<T = unknown> = {
  status: UncertaintyStatus;
  value?: T;
  confidence?: number;
};

/**
 * Builds a typed uncertainty value schema for a constrained value type, e.g.
 * `uncertainValue(z.enum(["provisional", "confirmed"]))` for the football
 * score status.
 */
export function uncertainValue<const T extends z.ZodType>(value: T) {
  return z
    .object({
      status: UncertaintyStatus,
      value: value.optional(),
      confidence: confidenceField,
    })
    .superRefine((slot, ctx) => {
      if (slot.status === "known" && slot.value === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: 'a slot with status "known" must carry a value',
        });
      }
    });
}
