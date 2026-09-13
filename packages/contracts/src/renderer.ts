/**
 * Renderer contracts: requests, results, and capabilities.
 *
 * A renderer is a versioned plugin behind a stable interface
 * (docs/contracts/renderer.md). It consumes an SWM snapshot plus ordered
 * events and produces encoded output segments with health/quality telemetry.
 * Renderers must expose explicit degradation states and must never output
 * misleading stale state without marking it.
 */
import { z } from "zod";
import { RightsCapabilities } from "./rights";
import { Watermark } from "./timestamps";
import { schemaVersionField } from "./versioning";

/** Latency class of an output profile. */
export const OutputLatencyClass = z.enum(["offline", "near-live", "live"]);
export type OutputLatencyClass = z.infer<typeof OutputLatencyClass>;

/** Encoded output constraints. */
export const OutputProfile = z.object({
  resolution: z.object({
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  }),
  frameRate: z.number().gt(0),
  codec: z.string().min(1),
  container: z.string().min(1),
  latencyClass: OutputLatencyClass,
});
export type OutputProfile = z.infer<typeof OutputProfile>;

/**
 * A render request: everything a renderer needs to produce output from the
 * SWM. `rightsCapabilities` is REQUIRED and must be derived fail-closed from
 * the session's authorization policy (see `deriveRightsCapabilities`);
 * renderers must not assume capabilities they were not granted.
 *
 * `snapshotVersion` selects the immutable SWM snapshot to render from;
 * `eventsSinceSequence` selects the ordered events to apply after the
 * snapshot watermark. `sourceFrameRefs` defaults to empty: source-frame
 * references are optional and only permitted when rights allow.
 */
export const RenderRequest = z.object({
  sessionId: z.string().min(1),
  schemaVersion: schemaVersionField,
  rendererId: z.string().min(1),
  rendererVersion: z.string().min(1),
  styleConfig: z.object({
    styleId: z.string().min(1),
    configSchemaVersion: z.string().min(1),
    config: z.unknown(),
  }),
  snapshotVersion: z.number().int().min(0),
  eventsSinceSequence: z.number().int().min(0),
  outputProfile: OutputProfile,
  rightsCapabilities: RightsCapabilities,
  sourceFrameRefs: z.array(z.string().min(1)).default([]),
});
export type RenderRequest = z.infer<typeof RenderRequest>;

/** One encoded output segment with its position on the session timeline. */
export const OutputSegment = z.object({
  segmentId: z.string().min(1),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  artifactRef: z.string().min(1),
});
export type OutputSegment = z.infer<typeof OutputSegment>;

/** Renderer health at result time: lag plus explicit degradation state. */
export const RendererHealth = z.object({
  lagMs: z.number(),
  degraded: z.boolean(),
  degradationReason: z.string().min(1).optional(),
});
export type RendererHealth = z.infer<typeof RendererHealth>;

/**
 * A render result: encoded output segments, the watermark after rendering,
 * health/quality telemetry, and provenance links back to the SWM snapshot
 * version and the last applied event sequence.
 */
export const RenderResult = z.object({
  sessionId: z.string().min(1),
  rendererId: z.string().min(1),
  outputSegments: z.array(OutputSegment),
  watermarkAfter: Watermark,
  rendererHealth: RendererHealth,
  quality: z
    .object({
      temporalConsistencyScore: z.number().min(0).max(1).optional(),
    })
    .optional(),
  provenance: z.object({
    snapshotVersion: z.number().int().min(0),
    lastEventSequence: z.number().int().min(0),
  }),
});
export type RenderResult = z.infer<typeof RenderResult>;

/** Renderer classes supported by the architecture (architecture-lock §5). */
export const RendererClass = z.enum(["stylized-video", "procedural-3d", "tactical"]);
export type RendererClass = z.infer<typeof RendererClass>;

/**
 * Declared capabilities of a renderer plugin: identity/version (versions are
 * immutable), class, supported output profiles, whether it requires source
 * frames (rights-relevant), and the minimum snapshot version it can consume.
 */
export const RendererCapability = z.object({
  rendererId: z.string().min(1),
  rendererVersion: z.string().min(1),
  rendererClass: RendererClass,
  supportedOutputProfiles: z.array(OutputProfile),
  requiresSourceFrames: z.boolean(),
  minSnapshotVersion: z.number().int().min(0),
});
export type RendererCapability = z.infer<typeof RendererCapability>;
