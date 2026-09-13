/**
 * Shared in-process E2E harness for the control-api tests (W701).
 *
 * Every test file spins up a REAL `Bun.serve` on port 0 and drives it with
 * real `fetch` — the "real user" path. The observability seams are captured
 * (array-sink logger + `MetricsRegistry`) and the clock is the deterministic
 * `TEST_EPOCH_MS + counter` injection required by the brief.
 */
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { TEST_EPOCH_ISO, TEST_EPOCH_MS } from "@sporta/testing";
import { createControlServer } from "../src/index";

/** Far-future expiry used by policies that must never expire in a test. */
const FAR_FUTURE_ISO = "2099-12-31T23:59:59.000Z";

/** One in-process control server plus its captured seams and clock. */
export interface Harness {
  server: ReturnType<typeof createControlServer>;
  baseUrl: string;
  lines: string[];
  metrics: MetricsRegistry;
  nowMs: () => number;
}

/** Creates a harness on an ephemeral port with captured observability. */
export function createHarness(): Harness {
  const lines: string[] = [];
  const logger = createLogger({
    sink: (line) => {
      lines.push(line);
    },
    now: () => TEST_EPOCH_MS,
  });
  const metrics = new MetricsRegistry();
  let ticks = 0;
  const nowMs = (): number => TEST_EPOCH_MS + (ticks += 1);
  const server = createControlServer({ port: 0, observability: { logger, metrics }, nowMs });
  return { server, baseUrl: `http://127.0.0.1:${server.port}`, lines, metrics, nowMs };
}

/** Parsed log line shape (a subset of `LogRecord`). */
export interface LogLine {
  ts: number;
  level: string;
  msg: string;
  sessionId?: string;
  correlationId?: string;
  stage?: string;
  fields?: Record<string, unknown>;
}

/** All captured lines, parsed as JSON. */
export function parsedLines(harness: Harness): LogLine[] {
  return harness.lines.map((line) => JSON.parse(line) as LogLine);
}

/** Response envelope for a JSON call. */
export interface ApiResponse<T> {
  status: number;
  body: T;
  requestId: string | null;
  headers: Headers;
}

/** Performs one HTTP call and parses the JSON response body. */
export async function callJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    requestId: response.headers.get("x-request-id"),
    headers: response.headers,
  };
}

/** RequestInit helper for a JSON POST body. */
export function postJson(body: unknown, extraHeaders: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...extraHeaders },
  };
}

/** Error body shape returned by every non-2xx response. */
export interface ErrorBody {
  error: {
    failureClass: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Counter value for `name` + exact label match (0 when absent). */
export function counterValue(
  metrics: MetricsRegistry,
  name: string,
  labels: Record<string, string>,
): number {
  const snapshot = metrics.snapshot();
  const series = snapshot.counters.find(
    (counter) =>
      counter.name === name &&
      Object.keys(labels).length === Object.keys(counter.labels).length &&
      Object.entries(labels).every(([key, value]) => counter.labels[key] === value),
  );
  return series?.value ?? 0;
}

/** A policy allowing every operation (far-future expiry). */
export const fullAllowPolicy: AuthorizationPolicy = {
  policyId: "policy-full-allow",
  allowedOperations: [
    "analysis",
    "transformation",
    "liveDelivery",
    "derivativeGeneration",
    "storage",
    "sharing",
  ],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** Analysis-only policy: valid, but derives NO capability (all-denied). */
export const analysisOnlyPolicy: AuthorizationPolicy = {
  policyId: "policy-analysis-only",
  allowedOperations: ["analysis"],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** Analysis + transformation: renders, but canStoreDerivatives is false. */
export const analysisTransformationPolicy: AuthorizationPolicy = {
  policyId: "policy-analysis-transformation",
  allowedOperations: ["analysis", "transformation"],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** Capabilities but no analysis: denied at the lifecycle gate, not the app gate. */
export const capabilitiesWithoutAnalysisPolicy: AuthorizationPolicy = {
  policyId: "policy-caps-without-analysis",
  allowedOperations: ["transformation", "derivativeGeneration", "storage"],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** A full-allow policy that expired exactly at the test epoch. */
export const expiredPolicy: AuthorizationPolicy = {
  ...fullAllowPolicy,
  policyId: "policy-expired",
  expiresAtIso: TEST_EPOCH_ISO,
};

/** Creates a session over HTTP and returns its id. */
export async function createSession(
  baseUrl: string,
  policy: unknown,
  sourceLabel?: string,
): Promise<string> {
  const response = await callJson<{ session: { sessionId: string } }>(
    baseUrl,
    "/v1/sessions",
    postJson({
      authorizationPolicy: policy,
      ...(sourceLabel === undefined ? {} : { sourceLabel }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(`createSession failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.session.sessionId;
}
