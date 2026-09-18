/**
 * Shared deterministic fixtures for the provider-adapter tests (R402-R405):
 * a fixture transport that REPLAYS the recorded JSON responses pinned under
 * fixtures/ (asserting the requests match the pins), injected clocks, and
 * a valid `ComputeJobDescription` builder. No wall-clock reads in the
 * fixture tier (the local live tier injects the real clock deliberately —
 * measured subprocess wall clock is the honest evidence there).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import { ComputeJobDescription } from "@sporta/compute-adapter";
import type { FetchLike } from "../src/common/http";

export type { FetchLike };

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

/** A controllable clock (deadline tests jump it past the budget). */
export function controlledClock(startMs: number = TEST_EPOCH_MS): {
  nowMs: () => number;
  advance: (ms: number) => void;
} {
  let current = startMs;
  return {
    nowMs: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** A microtask sleep (the fixture tier's poll driver — no macrotasks). */
export const microtaskSleep = (): Promise<void> => Promise.resolve();

/** A real macrotask sleep (the local live tier needs true yields). */
export const realSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One recorded fixture (the pinned artifact under fixtures/<provider>/). */
export interface PinnedFixture {
  scenario: string;
  provenance: { source: string; recordedAt: string; note: string };
  request: { method: string; pathSuffix: string };
  response?: { status: number; body?: unknown };
  networkError?: string;
}

/** Loads one recorded fixture file (fail-loud on a missing pin). */
export function loadFixture(provider: string, scenario: string): PinnedFixture {
  const path = join(import.meta.dir, "..", "fixtures", provider, `${scenario}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as PinnedFixture;
}

/** One recorded transport call (auth values REDACTED — never evidence). */
export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * The recorded-fixture transport: replays the pinned fixtures in order and
 * records every call. A pinned `networkError` throws (the transport-level
 * failure the mapping must classify). Credential header VALUES are never
 * recorded — only their names.
 */
export class FixtureTransport {
  readonly calls: RecordedCall[] = [];
  private readonly queue: PinnedFixture[];

  constructor(fixtures: PinnedFixture[]) {
    this.queue = [...fixtures];
  }

  /** The fetch implementation an adapter is constructed with. */
  readonly fetch: FetchLike = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    // REDACT every credential-ish header value (never evidence, never logs).
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(rawHeaders)) {
      headers[name] = /token|secret|authorization|api[-_]?key/i.test(name) ? "***" : value;
    }
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    this.calls.push({ method, url, headers, body });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(
        `fixture transport exhausted at ${method} ${url} (the test pinned too few responses)`,
      );
    }
    // The request pin: method + path suffix must match the recording.
    expect(
      url.endsWith(next.request.pathSuffix),
      `pinned request mismatch: ${method} ${url} does not end with '${next.request.pathSuffix}' (fixture '${next.scenario}')`,
    ).toBe(true);
    expect(method, `pinned method mismatch for fixture '${next.scenario}'`).toBe(
      next.request.method,
    );
    if (next.networkError !== undefined) {
      throw new TypeError(next.networkError);
    }
    const status = next.response?.status ?? 200;
    const bodyOut = next.response?.body;
    return new Response(bodyOut === undefined ? null : JSON.stringify(bodyOut), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  /** How many transport calls were made (the pre-network gate asserts 0). */
  get callCount(): number {
    return this.calls.length;
  }
}

/** A fetch that hangs until aborted (models a real fetch's abort rejection). */
export const hangingFetch: FetchLike = async (
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === undefined || signal === null) return; // never aborts
    signal.addEventListener("abort", () => {
      reject(new Error("The operation was aborted"));
    });
  });

/** Builds one valid render-job description for the provider adapters. */
export function buildProviderJob(overrides: {
  jobId?: string;
  idempotencyKey?: string;
  rendererId?: string;
  sessionId?: string;
  deadlineMs?: number;
  latencyClass?: "offline" | "near-live" | "live";
  computeClass?: string;
  canReferenceSourceFrames?: boolean;
  sourceMediaInput?: boolean;
}): ComputeJobDescription {
  const job = {
    schemaVersion: "1.0" as const,
    jobId: overrides.jobId ?? "render-job-r40x-1",
    idempotencyKey: overrides.idempotencyKey ?? "idem-r40x-1",
    sessionId: overrides.sessionId ?? "sess-r40x-1",
    correlationId: "corr-r40x-1",
    traceId: "trace-r40x-1",
    renderer: { rendererId: overrides.rendererId ?? "anime.prototype" },
    recipe: {
      styleId: "style.default",
      configSchemaVersion: "1.0",
      config: { tone: "original" },
    },
    inputs: [
      {
        inputId: "input-snapshot-1",
        kind: "swm-snapshot" as const,
        ref: "sporta://swm/snapshot/1",
      },
      ...(overrides.sourceMediaInput
        ? [
            {
              inputId: "input-source-1",
              kind: "source-media" as const,
              ref: "sporta://media/source/1",
            },
          ]
        : []),
    ],
    outputProfile: {
      resolution: { w: 1280, h: 720 },
      frameRate: 30,
      codec: "av1",
      container: "mp4",
      latencyClass: overrides.latencyClass ?? "offline",
    },
    rights: {
      policyRef: "sporta://policy/dev",
      canReferenceSourceFrames: overrides.canReferenceSourceFrames ?? true,
    },
    constraints: {
      deadlineMs: overrides.deadlineMs ?? 60_000,
      ...(overrides.computeClass !== undefined
        ? { resourceHints: { computeClass: overrides.computeClass } }
        : {}),
    },
  };
  const parsed = ComputeJobDescription.safeParse(job);
  if (!parsed.success) {
    throw new Error(
      "test job builder produced an invalid ComputeJobDescription: " +
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

/** Awaits a predicate over repeated polls (real short yields; bounded). */
export async function until<T, S extends T>(
  probe: () => Promise<T>,
  predicate: (value: T) => value is S,
  timeoutMs?: number,
): Promise<S>;
export async function until<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs?: number,
): Promise<T>;
export async function until<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (predicate(value)) return value;
    if (Date.now() > deadline) {
      throw new Error("until(): the predicate never held within the timeout");
    }
    await realSleep(2);
  }
}
