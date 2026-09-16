/**
 * The MATERIALIZED inputs of one dispatch (W914 Wave 2, ADDITIVE to the
 * Wave-1 contract): the payload documents that accompany a job description
 * when it crosses a transport boundary.
 *
 * Wave 1 froze `ComputeJobDescription.inputs` as an addressable MANIFEST
 * (`ref` opaque — the W303 `payloadRef` posture: the protocol never
 * interprets it). A stateless hosted worker (a serverless route that
 * executes one job per request) cannot resolve in-memory refs, so the
 * Wave-2 dispatch carries the manifest's materialized payloads ALONGSIDE
 * the description — the dispatch request this module defines:
 *
 * - the manifest still owns identity (inputId/kind/ref/contentHash/byteSize);
 * - each materialized input names its `inputId` + `kind` and carries a
 *   JSON-safe `payload`, structurally validated HERE only as far as the
 *   contract layer can (the envelope fields every provider needs); the
 *   DOMAIN documents inside stay opaque and are validated by the provider
 *   against `@sporta/contracts`;
 * - coverage is exact: every manifest entry must have exactly one payload,
 *   no payload may name an input the manifest does not declare, and the
 *   payload `kind` must equal the manifest entry's `kind` (a mismatched
 *   payload is a corrupt dispatch, rejected loudly — never interpreted).
 *
 * Kinds this wave:
 *
 * - `swm-snapshot` → `{ snapshotVersion, snapshot }` — the immutable SWM
 *   snapshot plus the engine's `snapshotVersion` (the RenderRequest needs
 *   it and it is not recoverable from the snapshot document itself);
 * - `swm-event-window` → `{ fromSequence, entries }` — the ordered event
 *   stream entries after the snapshot watermark, plus the sequence they
 *   start from (the RenderRequest's `eventsSinceSequence`).
 *
 * `source-media` and `renderer-fixture` inputs are manifestable but not
 * materializable this wave (no source-frame pipeline, no fixture transport
 * — the hosted worker refuses them, honestly, at admission).
 */
import { z } from "zod";
import { ComputeInputKind, ComputeJobDescription } from "./schemas";
import type { ComputeJobDescription as ComputeJobDescriptionDoc } from "./schemas";

/** The payload envelope of one `swm-snapshot` input (the snapshot document stays opaque). */
export const ComputeSwmSnapshotPayload = z
  .object({
    /** The engine's snapshot version (contracts `RenderRequest.snapshotVersion`). */
    snapshotVersion: z.number().int().min(0),
    /** The `WorldSnapshot` document (validated by the provider against `@sporta/contracts`). */
    snapshot: z.unknown(),
  })
  .strict();
export type ComputeSwmSnapshotPayload = z.infer<typeof ComputeSwmSnapshotPayload>;

/** The payload envelope of one `swm-event-window` input (the entries stay opaque). */
export const ComputeSwmEventWindowPayload = z
  .object({
    /** The sequence the window starts after (contracts `RenderRequest.eventsSinceSequence`). */
    fromSequence: z.number().int().min(0),
    /** The ordered `WorldEventStreamEntry` documents (validated by the provider). */
    entries: z.array(z.unknown()),
  })
  .strict();
export type ComputeSwmEventWindowPayload = z.infer<typeof ComputeSwmEventWindowPayload>;

/** One materialized input: the payload of one manifest entry. */
export const ComputeMaterializedInput = z
  .object({
    /** The manifest entry this payload belongs to (must exist, kinds must match). */
    inputId: z.string().min(1),
    /** The manifest entry's kind (must equal the manifest entry's kind). */
    kind: ComputeInputKind,
    /** The JSON-safe payload document (envelope validated here; domain validated by the provider). */
    payload: z.unknown(),
  })
  .strict();
export type ComputeMaterializedInput = z.infer<typeof ComputeMaterializedInput>;

/** The materialized inputs of one dispatch (order follows the manifest on dispatch). */
export const ComputeMaterializedInputs = z.array(ComputeMaterializedInput).min(1);
export type ComputeMaterializedInputs = z.infer<typeof ComputeMaterializedInputs>;

/**
 * The wire request of one hosted dispatch: the transport-safe job
 * description PLUS the materialized payloads of its inputs manifest (the
 * stateless-worker shape — one request executes one job).
 */
export const ComputeDispatchRequest = z
  .object({
    job: ComputeJobDescription,
    inputs: ComputeMaterializedInputs,
  })
  .strict()
  .superRefine((request, ctx) => {
    for (const issue of materializedInputIssues(request.job, request.inputs)) {
      ctx.addIssue({ code: "custom", path: ["inputs"], message: issue });
    }
  });
export type ComputeDispatchRequest = z.infer<typeof ComputeDispatchRequest>;

/**
 * Pure coverage/shape validation of materialized inputs against a job's
 * manifest (used by dispatching adapters, providers, and tests; returns
 * issue strings — empty when the inputs are exactly the manifest, with
 * kind-matching, kind-shaped payloads).
 */
export function materializedInputIssues(
  job: ComputeJobDescriptionDoc,
  inputs: readonly ComputeMaterializedInput[],
): string[] {
  const issues: string[] = [];
  const manifest = new Map(job.inputs.map((input) => [input.inputId, input]));
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.inputId)) {
      issues.push(`duplicate materialized inputId '${input.inputId}'`);
      continue;
    }
    seen.add(input.inputId);
    const entry = manifest.get(input.inputId);
    if (entry === undefined) {
      issues.push(`materialized input '${input.inputId}' is not in the job's manifest`);
      continue;
    }
    if (entry.kind !== input.kind) {
      issues.push(
        `materialized input '${input.inputId}' has kind '${input.kind}' but the manifest declares '${entry.kind}'`,
      );
      continue;
    }
    const payloadIssues = payloadShapeIssues(input);
    issues.push(...payloadIssues);
  }
  for (const entry of job.inputs) {
    if (!seen.has(entry.inputId)) {
      issues.push(`manifest input '${entry.inputId}' has no materialized payload`);
    }
  }
  return issues;
}

/** Kind-aware payload-envelope validation (domain documents stay opaque). */
function payloadShapeIssues(input: ComputeMaterializedInput): string[] {
  switch (input.kind) {
    case "swm-snapshot": {
      const parsed = ComputeSwmSnapshotPayload.safeParse(input.payload);
      return parsed.success
        ? []
        : [`swm-snapshot payload of input '${input.inputId}' is not { snapshotVersion, snapshot }`];
    }
    case "swm-event-window": {
      const parsed = ComputeSwmEventWindowPayload.safeParse(input.payload);
      return parsed.success
        ? []
        : [
            `swm-event-window payload of input '${input.inputId}' is not { fromSequence, entries[] }`,
          ];
    }
    case "source-media":
      return [
        `input '${input.inputId}' has kind 'source-media' which cannot be materialized this wave (no source-frame transport)`,
      ];
    case "renderer-fixture":
      return [
        `input '${input.inputId}' has kind 'renderer-fixture' which cannot be materialized this wave (no fixture transport)`,
      ];
  }
}
