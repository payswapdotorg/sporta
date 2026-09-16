/**
 * Shared deterministic fixtures for the hosted-compute-worker tests (W914
 * Wave 2). No wall clock, no randomness: snapshots/events come from
 * `@sporta/testing`'s seeded builders, the clock is a manual counter, and
 * every render goes through the REAL plugins (anime prototype) and the REAL
 * W504 encoder + in-memory store.
 */
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  createAnimePrototypeRenderer,
} from "@sporta/renderer-anime";
import { InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import type { RenderSegmentStore } from "@sporta/output-pipeline";
import { RendererRegistry, createTestCardRenderer } from "@sporta/renderer-contract";
import { ComputeWorker } from "../src/index";
import type { ComputeWorkerOptions } from "../src/index";
import {
  canonicalJsonOf,
  sha256OfCanonicalJson,
  ComputeDispatchRequest,
} from "@sporta/compute-adapter";
import type { ComputeDispatchRequest as ComputeDispatchRequestDoc } from "@sporta/compute-adapter";

/** The canonical test session. */
export const SESSION_ID = "sess-w914-e2e";

/** A deterministic epoch for the injected clocks. */
export const TEST_EPOCH_MS = 1_700_000_000_000;

/** A manual clock: every read advances by `stepMs` (default 1). */
export function manualClock(startMs: number = TEST_EPOCH_MS, stepMs: number = 1): () => number {
  let current = startMs;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

/** A frozen clock (never advances — for pure-happy-path timing checks). */
export function frozenClock(atMs: number = TEST_EPOCH_MS): () => number {
  return () => atMs;
}

/** The REAL registry the worker tests use (anime + test card). */
export function workerRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registry.register(createAnimePrototypeRenderer());
  registry.register(createTestCardRenderer());
  return registry;
}

/** A REAL W504 store (in-memory — the pre-W912 mode). */
export function workerStore(): RenderSegmentStore {
  return new InMemoryRenderSegmentStore();
}

/** Creates a REAL worker over the default test composition. */
export function createTestWorker(overrides: Partial<ComputeWorkerOptions> = {}): ComputeWorker {
  return new ComputeWorker({
    rendererRegistry: workerRegistry(),
    outputSegmentStore: workerStore(),
    nowMs: manualClock(),
    ...overrides,
  });
}

/** sha-256 of the canonical JSON (the contract's content addressing). */
export async function sha256Of(value: unknown): Promise<string> {
  return sha256OfCanonicalJson(value);
}

/** The canonical JSON byte length (the contract's measurement). */
export function canonicalBytes(value: unknown): number {
  return canonicalJsonOf(value).length;
}

/** Builds one REAL, valid dispatch request for the anime renderer. */
export async function buildDispatchRequest(
  overrides: {
    jobId?: string;
    idempotencyKey?: string;
    rendererId?: string;
    rendererVersion?: string;
    rightsCanReferenceSourceFrames?: boolean;
    deadlineMs?: number;
    snapshot?: WorldSnapshot;
    events?: WorldEventStreamEntry[];
    outputProfileLatencyClass?: "offline" | "near-live" | "live";
    outputProfile?: {
      resolution: { w: number; h: number };
      frameRate: number;
      codec: string;
      container: string;
    };
  } = {},
): Promise<ComputeDispatchRequestDoc> {
  const snapshot = overrides.snapshot ?? buildWorldSnapshot({ sessionId: SESSION_ID });
  const events = overrides.events ?? [
    {
      sequence: snapshot.watermark.sequence + 1,
      snapshotVersionAfter: 1,
      event: buildEventEnvelope({
        sessionId: SESSION_ID,
        eventTimeMs: snapshot.watermark.watermarkMs + 1,
      }),
    },
  ];
  const snapshotPayload = { snapshotVersion: 1, snapshot };
  const eventsPayload = { fromSequence: snapshot.watermark.sequence, entries: events };
  const snapshotContentHash = await sha256Of(snapshotPayload);
  const eventsContentHash = await sha256Of(eventsPayload);
  const request = {
    job: {
      schemaVersion: "1.0",
      jobId: overrides.jobId ?? "render-job-w914-1",
      idempotencyKey: overrides.idempotencyKey ?? "render-w914-key-1",
      sessionId: SESSION_ID,
      correlationId: "corr-w914-1",
      traceId: "trace-w914-1",
      renderer: {
        rendererId: overrides.rendererId ?? ANIME_RENDERER_ID,
        ...(overrides.rendererVersion === undefined
          ? {}
          : { rendererVersion: overrides.rendererVersion }),
      },
      recipe: { styleId: "style-anime-test", configSchemaVersion: "1.0", config: {} },
      inputs: [
        {
          inputId: "swm-snapshot",
          kind: "swm-snapshot",
          ref: `swm-snapshot:${SESSION_ID}:v1`,
          contentHash: snapshotContentHash,
          byteSize: canonicalBytes(snapshotPayload),
        },
        {
          inputId: "swm-events",
          kind: "swm-event-window",
          ref: `swm-events:${SESSION_ID}:from-${snapshot.watermark.sequence}`,
          contentHash: eventsContentHash,
          byteSize: canonicalBytes(eventsPayload),
        },
      ],
      outputProfile: {
        ...(overrides.outputProfile === undefined
          ? ANIME_OUTPUT_PROFILE
          : { ...ANIME_OUTPUT_PROFILE, ...overrides.outputProfile }),
        ...(overrides.outputProfileLatencyClass === undefined
          ? {}
          : { latencyClass: overrides.outputProfileLatencyClass }),
      },
      rights: {
        policyRef: "policy-w914-test",
        canReferenceSourceFrames: overrides.rightsCanReferenceSourceFrames ?? true,
      },
      constraints: { deadlineMs: overrides.deadlineMs ?? 60_000, priority: 0 },
    },
    inputs: [
      { inputId: "swm-snapshot", kind: "swm-snapshot", payload: snapshotPayload },
      { inputId: "swm-events", kind: "swm-event-window", payload: eventsPayload },
    ],
  };
  // Fail loud on any fixture drift: the built request MUST parse against
  // the frozen Wave-2 contract.
  return ComputeDispatchRequest.parse(request);
}

export { ANIME_RENDERER_ID, ANIME_RENDERER_VERSION, ANIME_OUTPUT_PROFILE };
