/**
 * Telemetry event schema tests (W706): the closed vocabulary validates every
 * legal shape, rejects every illegal one with an exact reason, and — the
 * PRIVACY PINS — cannot represent sensitive payloads (authorization
 * policies, artifact/media content, source frames, renderer payloads,
 * free-form detail records, user identifiers) at all: every unknown key is
 * rejected, and every field of every kind is a scalar from a closed
 * vocabulary (no record/array fields exist to hide data in).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  REMEDIATION_HINTS,
  TELEMETRY_EVENT_KINDS,
  TELEMETRY_EVENT_KEYS,
  TELEMETRY_MESSAGE_MAX_LENGTH,
  TELEMETRY_OPERATIONS,
  TELEMETRY_SCHEMA_VERSION,
  parseTelemetryEvent,
  parseTelemetryLine,
  serializeTelemetryEvent,
} from "../src/telemetry-events.ts";
import type { ViewerTelemetryEvent } from "../src/telemetry-events.ts";
import { VIEWER_FAILURE_CLASSES } from "../src/errors.ts";

/** A minimal valid event of each kind (the positive fixtures). */
function validEvents(): ViewerTelemetryEvent[] {
  return [
    {
      schemaVersion: 1,
      kind: "state-transition",
      sequence: 1,
      atMs: 1_736_164_800_000,
      sessionId: "sess-1",
      from: "connecting",
      to: "browsing-sessions",
    },
    {
      schemaVersion: 1,
      kind: "operation-timing",
      sequence: 2,
      atMs: 1_736_164_800_001,
      sessionId: null,
      operation: "connect",
      durationMs: 250,
    },
    {
      schemaVersion: 1,
      kind: "error-occurred",
      sequence: 3,
      atMs: 1_736_164_800_002,
      sessionId: "sess-1",
      operation: "openSession",
      failureClass: "rights-denied",
      message: "session policy does not grant playback",
      remediationHint: REMEDIATION_HINTS["rights-denied"],
    },
    {
      schemaVersion: 1,
      kind: "rebuffer-stall",
      sequence: 4,
      atMs: 1_736_164_800_003,
      sessionId: "sess-1",
      frameIndex: 2,
      frameCount: 6,
      availableFrames: 2,
    },
    {
      schemaVersion: 1,
      kind: "integrity-verified",
      sequence: 5,
      atMs: 1_736_164_800_004,
      sessionId: "sess-1",
      byteLength: 17_551,
      frameCount: 6,
    },
    {
      schemaVersion: 1,
      kind: "user-feedback",
      sequence: 6,
      atMs: 1_736_164_800_005,
      sessionId: "sess-1",
      feedback: "playback-good",
    },
  ];
}

describe("telemetry events — every kind round-trips through the validator", () => {
  test("the six kinds validate and come back deep-equal", () => {
    for (const event of validEvents()) {
      const parsed = parseTelemetryEvent(event);
      expect(parsed.ok, event.kind).toBe(true);
      if (parsed.ok) expect(parsed.event).toEqual(event);
    }
  });

  test("serialization round-trips: JSON line → parse → the same event", () => {
    for (const event of validEvents()) {
      const line = serializeTelemetryEvent(event);
      expect(line).not.toContain("\n");
      const back = parseTelemetryLine(line);
      expect(back.ok, event.kind).toBe(true);
      if (back.ok) expect(back.event).toEqual(event);
    }
  });

  test("the validator's kind list and key allowlists are exactly the closed sets (the schema pin)", () => {
    expect(TELEMETRY_EVENT_KINDS).toEqual([
      "state-transition",
      "operation-timing",
      "error-occurred",
      "rebuffer-stall",
      "integrity-verified",
      "user-feedback",
    ]);
    expect(TELEMETRY_EVENT_KEYS["state-transition"]).toEqual([
      "kind",
      "schemaVersion",
      "sequence",
      "atMs",
      "sessionId",
      "from",
      "to",
    ]);
    expect(TELEMETRY_EVENT_KEYS["operation-timing"]).toEqual([
      "kind",
      "schemaVersion",
      "sequence",
      "atMs",
      "sessionId",
      "operation",
      "durationMs",
    ]);
    expect(TELEMETRY_EVENT_KEYS["error-occurred"]).toEqual([
      "kind",
      "schemaVersion",
      "sequence",
      "atMs",
      "sessionId",
      "operation",
      "failureClass",
      "message",
      "remediationHint",
    ]);
    expect(TELEMETRY_EVENT_KEYS["rebuffer-stall"]).toEqual([
      "kind",
      "schemaVersion",
      "sequence",
      "atMs",
      "sessionId",
      "frameIndex",
      "frameCount",
      "availableFrames",
    ]);
    expect(TELEMETRY_EVENT_KEYS["integrity-verified"]).toEqual([
      "kind",
      "schemaVersion",
      "sequence",
      "atMs",
      "sessionId",
      "byteLength",
      "frameCount",
    ]);
    expect(TELEMETRY_EVENT_KEYS["user-feedback"]).toEqual([
      "kind",
      "schemaVersion",
      "sequence",
      "atMs",
      "sessionId",
      "feedback",
    ]);
  });
});

describe("telemetry events — the PRIVACY PINS (sensitive fields are unrepresentable)", () => {
  /**
   * Sensitive payload keys a telemetry event must NEVER be able to carry:
   * an authorization policy (any spelling), media/artifact content bytes,
   * frame SVG documents, manifests, source-frame references, free-form
   * detail records, and user identifiers.
   */
  const SENSITIVE_KEYS = [
    "authorizationPolicy",
    "policy",
    "policyId",
    "allowedOperations",
    "content",
    "artifact",
    "artifactBytes",
    "frames",
    "svg",
    "frameSvg",
    "document",
    "manifest",
    "sourceFrames",
    "sourceFrameRefs",
    "details",
    "fields",
    "payload",
    "data",
    "userAgent",
    "userId",
    "user",
    "email",
    "ip",
  ];

  test("NO event kind can carry ANY sensitive key — every unknown field is rejected, by name", () => {
    for (const event of validEvents()) {
      for (const key of SENSITIVE_KEYS) {
        const smuggled: Record<string, unknown> = { ...event, [key]: { anything: "sensitive" } };
        const parsed = parseTelemetryEvent(smuggled);
        expect(parsed.ok, `${event.kind} + ${key}`).toBe(false);
        if (!parsed.ok) {
          expect(parsed.reason).toContain(`unknown '${event.kind}' field '${key}'`);
        }
      }
    }
  });

  test("there is no free-form record field to hide data in: every field of every valid event is a scalar (string | number | null)", () => {
    for (const event of validEvents()) {
      for (const [key, value] of Object.entries(event)) {
        const isScalar = typeof value === "string" || typeof value === "number" || value === null;
        expect(isScalar, `${event.kind}.${key} must be a scalar`).toBe(true);
      }
    }
  });

  test("missing required fields are named in the rejection (no silent defaults)", () => {
    const base = validEvents()[0]!; // state-transition
    // `kind` is checked first by design (an unknown/absent kind answers the
    // kind rejection), so the missing-field pin covers the other fields.
    for (const key of Object.keys(base).filter((key) => key !== "kind")) {
      const partial: Record<string, unknown> = { ...base };
      delete partial[key];
      const parsed = parseTelemetryEvent(partial);
      expect(parsed.ok, `missing ${key}`).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toContain(`missing 'state-transition' field '${key}'`);
    }
  });

  test("a non-object or an unknown kind is rejected", () => {
    expect(parseTelemetryEvent(null).ok).toBe(false);
    expect(parseTelemetryEvent("state-transition").ok).toBe(false);
    expect(parseTelemetryEvent([1, 2]).ok).toBe(false);
    const unknown = parseTelemetryEvent({ kind: "page-view", sequence: 1 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toContain("unknown telemetry event kind");
  });
});

describe("telemetry events — common envelope validation", () => {
  const base = validEvents()[0]!;

  test("schemaVersion must be exactly 1", () => {
    const parsed = parseTelemetryEvent({ ...base, schemaVersion: 2 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("schemaVersion must be 1");
  });

  test("sequence must be a positive integer", () => {
    for (const sequence of [0, -1, 1.5, "1", null]) {
      const parsed = parseTelemetryEvent({ ...base, sequence });
      expect(parsed.ok, `sequence ${String(sequence)}`).toBe(false);
    }
  });

  test("atMs must be a finite number", () => {
    for (const atMs of [Number.NaN, Number.POSITIVE_INFINITY, "1000", null]) {
      const parsed = parseTelemetryEvent({ ...base, atMs });
      expect(parsed.ok, `atMs ${String(atMs)}`).toBe(false);
    }
  });

  test("sessionId must be a non-empty string or null", () => {
    expect(parseTelemetryEvent({ ...base, sessionId: 42 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...base, sessionId: "" }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...base, sessionId: null }).ok).toBe(true);
  });
});

describe("telemetry events — per-kind field validation", () => {
  test("state-transition: from/to must be known statuses and differ", () => {
    const event = validEvents()[0]!;
    expect(parseTelemetryEvent({ ...event, from: "browsing-the-web" }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, to: 7 }).ok).toBe(false);
    const same = parseTelemetryEvent({ ...event, from: "connecting", to: "connecting" });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.reason).toContain("must differ");
  });

  test("operation-timing: closed operation vocabulary + non-negative finite duration", () => {
    const event = validEvents()[1]!;
    expect(parseTelemetryEvent({ ...event, operation: "openSession" }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, operation: "load-output" }).ok).toBe(true);
    expect(parseTelemetryEvent({ ...event, durationMs: -1 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, durationMs: Number.NaN }).ok).toBe(false);
  });

  test("error-occurred: closed operation + failure class vocabularies; message bounds; hint from the table", () => {
    const event = validEvents()[2]!;
    expect(parseTelemetryEvent({ ...event, operation: "navigate" }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, failureClass: "fatal" }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, message: "" }).ok).toBe(false);
    expect(
      parseTelemetryEvent({ ...event, message: "x".repeat(TELEMETRY_MESSAGE_MAX_LENGTH) }).ok,
    ).toBe(true);
    expect(
      parseTelemetryEvent({ ...event, message: "x".repeat(TELEMETRY_MESSAGE_MAX_LENGTH + 1) }).ok,
    ).toBe(false);
    expect(parseTelemetryEvent({ ...event, remediationHint: "just try something" }).ok).toBe(false);
  });

  test("rebuffer-stall: integer, in-range counts (frameIndex < frameCount, availableFrames <= frameCount)", () => {
    const event = validEvents()[3]!;
    expect(parseTelemetryEvent({ ...event, frameIndex: -1 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, frameIndex: 1.5 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, frameIndex: 6 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, frameCount: 0 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, availableFrames: 7 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, availableFrames: -1 }).ok).toBe(false);
  });

  test("integrity-verified: positive integers", () => {
    const event = validEvents()[4]!;
    expect(parseTelemetryEvent({ ...event, byteLength: 0 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, byteLength: 1.5 }).ok).toBe(false);
    expect(parseTelemetryEvent({ ...event, frameCount: 0 }).ok).toBe(false);
  });

  test("user-feedback: closed kind vocabulary", () => {
    const event = validEvents()[5]!;
    expect(parseTelemetryEvent({ ...event, feedback: "playback-great" }).ok).toBe(false);
    expect(
      parseTelemetryEvent({ ...event, feedback: "the subtitles were wrong and my name is…" }).ok,
    ).toBe(false);
  });
});

describe("telemetry events — the operation vocabulary is EXACTLY the core's run() operations (source-scan pin)", () => {
  /** Package root: `import.meta.dir` is `<pkg>/test`, so one `dirname` up. */
  const PACKAGE_ROOT = dirname(import.meta.dir);

  /** Extracts the `run("...")` operation names from viewer-core source. */
  function runOperationsOf(source: string): string[] {
    return [...source.matchAll(/\brun\(\s*"([a-zA-Z]+)"/g)].map((match) => match[1] ?? "");
  }

  test("TELEMETRY_OPERATIONS equals the set of run() names in viewer-core.ts (both directions)", () => {
    const source = readFileSync(join(PACKAGE_ROOT, "src/viewer-core.ts"), "utf8");
    const runNames = [...new Set(runOperationsOf(source))].sort();
    expect(runNames.length).toBeGreaterThan(0); // the scan actually scanned
    const vocabulary = ([...TELEMETRY_OPERATIONS] as string[]).sort();
    expect(vocabulary).toEqual(runNames);
  });

  test("the scan has teeth: a planted run() name (missing from or extra to the vocabulary) fails the comparison", () => {
    // A new core operation without a vocabulary entry would drop its error
    // events silently; a stale vocabulary entry is dead weight — both fail
    // the set-equality pin above.
    const planted = 'void run("connect", command) void run("syncPreferences", command)';
    expect(runOperationsOf(planted).sort()).toEqual(["connect", "syncPreferences"]);
    expect((TELEMETRY_OPERATIONS as readonly string[]).includes("syncPreferences")).toBe(false);
    // And the removed dead entry stays removed ("loadOutput" was the dead
    // vocabulary member the audit deleted — the core re-wraps player load
    // failures under the dispatching command's operation).
    expect((TELEMETRY_OPERATIONS as readonly string[]).includes("loadOutput")).toBe(false);
  });
});

describe("telemetry events — the remediation-hint table", () => {
  test("exactly one non-empty hint per failure class (the one-table rule)", () => {
    expect(Object.keys(REMEDIATION_HINTS).sort()).toEqual([...VIEWER_FAILURE_CLASSES].sort());
    for (const hint of Object.values(REMEDIATION_HINTS)) {
      expect(hint.length > 10).toBe(true);
    }
  });

  test("the schema version constant is 1", () => {
    expect(TELEMETRY_SCHEMA_VERSION).toBe(1);
  });
});
