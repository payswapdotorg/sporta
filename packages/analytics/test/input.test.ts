/**
 * The W804 input boundary tests — THE privacy pin.
 *
 * The REAL W706 validator (`@sporta/viewer-shell` `parseTelemetryEvent`) is
 * the ONE gate through which recorded events enter analytics; anything it
 * rejects (an unknown key — a policy, a payload, a user id — a wider shape,
 * an out-of-vocabulary value) must fail LOUDLY here, carrying W706's own
 * rejection reason verbatim. Analytics never computes over a partial or
 * widened stream.
 */
import { describe, expect, test } from "bun:test";
import { AnalyticsInputError } from "../src/errors.ts";
import { parseRecordedEvents, parseRecordedJsonl, validateRecordedEvent } from "../src/input.ts";
import { Stream, connectAttempt, establish } from "./helpers.ts";
import type { ViewerTelemetryEvent } from "@sporta/viewer-shell";

describe("parseRecordedEvents — the W706 gate", () => {
  test("a valid recorded stream parses to the same events (every kind present)", () => {
    const stream = new Stream();
    connectAttempt(stream, "success");
    establish(stream, "sess-1");
    stream.timing("connect", 42);
    stream.transition("session-detail", "renderer-selection", "sess-1");
    stream.failure("beginRender", "network", "boom", "sess-1");
    stream.transition("session-detail", "error", "sess-1");
    stream.stall({ frameIndex: 3, frameCount: 10, availableFrames: 3 }, "sess-1");
    stream.integrity({ byteLength: 2048, frameCount: 6 }, "sess-1");
    stream.feedback("playback-good", "sess-1");

    const parsed = parseRecordedEvents(stream.events);
    expect(parsed).toEqual(stream.events);
    expect(parsed).toHaveLength(10);
  });

  test("a non-object value fails loudly with the W706 reason and the index", () => {
    try {
      parseRecordedEvents([42]);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnalyticsInputError);
      const input = err as AnalyticsInputError;
      expect(input.index).toBe(0);
      expect(input.reason).toBe("telemetry event must be an object");
      expect(input.message).toContain("index 0");
      expect(input.message).toContain(input.reason);
    }
  });

  test("an unknown event kind fails with W706's verbatim reason", () => {
    try {
      parseRecordedEvents([
        { schemaVersion: 1, kind: "heart-beat", sequence: 1, atMs: 0, sessionId: null },
      ]);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnalyticsInputError);
      expect((err as AnalyticsInputError).reason).toBe(
        "unknown telemetry event kind (got heart-beat)",
      );
    }
  });

  test("a wrong schema version is rejected, never guessed", () => {
    const stream = new Stream();
    const event = {
      ...stream.transition("disconnected", "connecting").events[0]!,
      schemaVersion: 2,
    };
    try {
      parseRecordedEvents([event]);
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as AnalyticsInputError).reason).toBe("schemaVersion must be 1 (got 2)");
    }
  });

  test("a missing closed field is rejected by name", () => {
    const stream = new Stream();
    const event = stream.transition("disconnected", "connecting").events[0]!;
    const partial = { ...event } as Record<string, unknown>;
    delete partial.sessionId;
    try {
      parseRecordedEvents([partial]);
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as AnalyticsInputError).reason).toBe(
        "missing 'state-transition' field 'sessionId'",
      );
    }
  });

  test("out-of-vocabulary scalar values are rejected (statuses, operations, classes, feedback)", () => {
    const stream = new Stream();
    const transition = stream.transition("disconnected", "connecting").events[0]!;
    const timing = stream.timing("connect", 5).events[1]!;
    const failure = stream.failure("beginRender", "network", "m").events[2]!;
    const feedback = stream.feedback("playback-good").events[3]!;
    const cases: Array<{ event: Record<string, unknown>; reason: string }> = [
      {
        event: { ...transition, to: "vaporizing" },
        reason: "to must be a known viewer status (got vaporizing)",
      },
      {
        event: { ...timing, operation: "explode" },
        reason: "operation must be one of connect, load-output, openLive (got explode)",
      },
      {
        event: { ...failure, failureClass: "kaboom" },
        reason: "failureClass must be a known viewer failure class (got kaboom)",
      },
      {
        event: { ...feedback, feedback: "love-it" },
        reason:
          "feedback must be one of playback-good, playback-stalled, playback-poor (got love-it)",
      },
    ];
    for (const { event, reason } of cases) {
      try {
        parseRecordedEvents([event]);
        expect.unreachable(`must throw for ${String(event.kind)}`);
      } catch (err) {
        expect((err as AnalyticsInputError).reason).toBe(reason);
      }
    }
  });
});

describe("the privacy pin — wider events fail loudly, naming the field", () => {
  /**
   * The sensitive-key battery (the W706 pin, from the analytics side): no
   * event kind can carry ANY of these keys — they are unrepresentable in the
   * closed vocabulary, and the shared gate must say so by name.
   */
  const SENSITIVE_KEYS: readonly string[] = [
    "authorizationPolicy",
    "policy",
    "policyDocument",
    "userAgent",
    "userId",
    "username",
    "ip",
    "ipAddress",
    "frames",
    "sourceFrames",
    "frameSvg",
    "segment",
    "segmentDocument",
    "manifest",
    "rendererPayload",
    "payload",
    "details",
    "renderId",
    "rendererId",
    "streamId",
    "userInfo",
    "note",
    "freeText",
  ];

  test("every sensitive key is rejected on every event kind", () => {
    const stream = new Stream();
    establish(stream, "sess-1");
    const kinds: ViewerTelemetryEvent[] = [
      stream.transition("session-detail", "renderer-selection", "sess-1").events[1]!,
      stream.timing("connect", 5, "sess-1").events[2]!,
      stream.failure("beginRender", "network", "m", "sess-1").events[3]!,
      stream.stall({ frameIndex: 0, frameCount: 2, availableFrames: 1 }, "sess-1").events[4]!,
      stream.integrity({ byteLength: 10, frameCount: 2 }, "sess-1").events[5]!,
      stream.feedback("playback-good", "sess-1").events[6]!,
    ];
    let rejected = 0;
    for (const event of kinds) {
      for (const key of SENSITIVE_KEYS) {
        const widened = { ...(event as unknown as Record<string, unknown>), [key]: "anything" };
        try {
          validateRecordedEvent(widened, 0);
          expect.unreachable(`kind ${event.kind} must reject the wider key '${key}'`);
        } catch (err) {
          expect(err).toBeInstanceOf(AnalyticsInputError);
          const reason = (err as AnalyticsInputError).reason;
          expect(reason).toBe(
            `unknown '${event.kind}' field '${key}' — the telemetry vocabulary is closed (privacy by construction; see TELEMETRY.md)`,
          );
          rejected += 1;
        }
      }
    }
    // The battery has teeth: 23 keys × 6 kinds = 138 loud rejections.
    expect(rejected).toBe(SENSITIVE_KEYS.length * kinds.length);
    expect(kinds.map((event) => event.kind)).toEqual([
      "state-transition",
      "operation-timing",
      "error-occurred",
      "rebuffer-stall",
      "integrity-verified",
      "user-feedback",
    ]);
  });

  test("nested widening is impossible — the vocabulary has no record/array field to hide in", () => {
    // Every field is a scalar from a closed enum or a bounded number; a
    // widened value fails the type check, not just the key check.
    const stream = new Stream();
    stream.integrity({ byteLength: 10, frameCount: 2 }, "sess-1");
    const nested = {
      ...(stream.events[0]! as unknown as Record<string, unknown>),
      byteLength: { hidden: "policy bytes" },
    };
    try {
      validateRecordedEvent(nested, 0);
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as AnalyticsInputError).reason).toBe(
        "byteLength must be a finite number (got object)",
      );
    }
  });
});

describe("parseRecordedJsonl — the file-sink wire form", () => {
  test("a recorded JSONL round-trips through the real line parser", () => {
    const stream = new Stream();
    connectAttempt(stream, "success");
    establish(stream, "sess-1");
    const lines = stream.events.map((event) => JSON.stringify(event));
    const parsed = parseRecordedJsonl(lines);
    expect(parsed).toEqual(stream.events);
  });

  test("a blank line is rejected (1-based line number carried)", () => {
    const stream = new Stream();
    establish(stream, "sess-1");
    const lines = [JSON.stringify(stream.events[0]), "   "];
    try {
      parseRecordedJsonl(lines);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnalyticsInputError);
      const input = err as AnalyticsInputError;
      expect(input.message).toContain("line 2");
      expect(input.reason).toBe("blank line");
    }
  });

  test("malformed JSON is rejected with the line number", () => {
    try {
      parseRecordedJsonl(["{not json"]);
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as AnalyticsInputError).message).toContain("line 1");
      expect((err as AnalyticsInputError).reason).toContain("telemetry line is not valid JSON");
    }
  });

  test("valid JSON that is not a W706 event is rejected with the W706 reason", () => {
    const widened = JSON.stringify({
      schemaVersion: 1,
      kind: "user-feedback",
      sequence: 1,
      atMs: 0,
      sessionId: null,
      feedback: "playback-good",
      userId: "u-1", // the widening
    });
    try {
      parseRecordedJsonl([widened]);
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as AnalyticsInputError).reason).toBe(
        "unknown 'user-feedback' field 'userId' — the telemetry vocabulary is closed (privacy by construction; see TELEMETRY.md)",
      );
    }
  });

  test("an empty recording is an empty stream (not an error)", () => {
    expect(parseRecordedJsonl([])).toEqual([]);
  });
});

describe("validateRecordedEvent — the single-event gate", () => {
  test("returns the event unchanged when valid", () => {
    const stream = new Stream();
    const event = stream.feedback("playback-poor", "sess-9").events[0]!;
    expect(validateRecordedEvent(event, 7)).toBe(event);
  });

  test("the index is carried verbatim (the caller's numbering, 0-based here)", () => {
    const stream = new Stream();
    const event = stream.transition("paused", "ended", "sess-1").events[0]!;
    try {
      validateRecordedEvent({ ...event, extra: 1 }, 41);
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as AnalyticsInputError).index).toBe(41);
      expect((err as AnalyticsInputError).message).toContain("index 41");
    }
  });
});
