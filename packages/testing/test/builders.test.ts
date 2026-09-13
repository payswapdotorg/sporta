/**
 * Builder contract tests (W003): every builder must (1) emit zod-valid
 * documents by default, (2) be deterministic per seed, (3) deep-merge
 * overrides, and (4) reject invalid overrides with the zod error.
 */
import { describe, expect, test } from "bun:test";
import {
  AuthorizationPolicy,
  EventEnvelope,
  MediaSession,
  Observation,
  RenderRequest,
  SCHEMA_VERSION,
  StageMessage,
  WorldSnapshot,
  deriveRightsCapabilities,
} from "@sporta/contracts";
import type {
  MediaSession as MediaSessionDoc,
  Observation as ObservationDoc,
  RenderRequest as RenderRequestDoc,
} from "@sporta/contracts";
import { ZodError } from "zod";
import {
  TEST_EPOCH_ISO,
  TEST_EPOCH_MS,
  buildAuthorizationPolicy,
  buildEventEnvelope,
  buildMediaSession,
  buildObservation,
  buildRenderRequest,
  buildStageMessage,
  buildWorldSnapshot,
  deepMerge,
} from "../src/builders";
import type { DeepPartial } from "../src/builders";

const SEED_A = 42;
const SEED_B = 43;

/**
 * Runtime-guard probe: bypasses the (correctly strict) override typing so the
 * test can exercise the zod validation that must still reject invalid input
 * from untyped callers at runtime.
 */
function asOverrides<T>(value: unknown): DeepPartial<T> {
  return value as DeepPartial<T>;
}

describe("buildMediaSession", () => {
  test("default output is a valid MediaSession (re-parses with the contract schema)", () => {
    const session = buildMediaSession();
    expect(MediaSession.safeParse(session).success).toBe(true);
    expect(session.status).toBe("created");
    expect(session.schemaVersion).toBe(SCHEMA_VERSION);
    expect(session.processingState.stage).toBe("created");
    expect(session.createdAtIso).toBe(TEST_EPOCH_ISO);
  });

  test("source declaredRightsPolicyId references the session policy by default", () => {
    const session = buildMediaSession(undefined, SEED_A);
    expect(session.sources[0]?.declaredRightsPolicyId).toBe(session.authorizationPolicyId);
  });

  test("same seed produces deep-equal sessions", () => {
    expect(buildMediaSession(undefined, SEED_A)).toEqual(buildMediaSession(undefined, SEED_A));
  });

  test("unseeded calls use the fixed default seed (still deterministic)", () => {
    expect(buildMediaSession()).toEqual(buildMediaSession());
    expect(buildMediaSession()).toEqual(buildMediaSession(undefined, 1));
  });

  test("different seeds produce different sessions", () => {
    expect(buildMediaSession(undefined, SEED_A)).not.toEqual(buildMediaSession(undefined, SEED_B));
  });

  test("overrides deep-merge: nested timeline override keeps sibling fields", () => {
    const baseline = buildMediaSession(undefined, SEED_A);
    const overridden = buildMediaSession({ timeline: { durationMs: 12345 } }, SEED_A);
    expect(overridden.timeline.durationMs).toBe(12345);
    expect(overridden.timeline.videoClockOffsetMs).toBe(baseline.timeline.videoClockOffsetMs);
    expect(overridden.sessionId).toBe(baseline.sessionId);
  });

  test("invalid overrides throw the zod error", () => {
    expect(() => buildMediaSession({ sources: [] })).toThrow(ZodError);
    expect(() => buildMediaSession({ sessionId: "" })).toThrow(ZodError);
    expect(() => buildMediaSession(asOverrides<MediaSessionDoc>({ status: "exploded" }))).toThrow(
      ZodError,
    );
  });
});

describe("buildObservation", () => {
  test("default output is a valid vision observation with provenance observed", () => {
    const observation = buildObservation();
    expect(Observation.safeParse(observation).success).toBe(true);
    expect(observation.modality).toBe("vision");
    expect(observation.provenance).toBe("OBSERVED");
    expect(observation.payload.kind).toBe("detection");
    expect(observation.ingestTimeMs).toBe(TEST_EPOCH_MS);
  });

  test("confidence and detection box stay in their valid ranges", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const observation = buildObservation(undefined, seed);
      const confidence = observation.confidence ?? Number.NaN;
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThan(1);
      if (observation.payload.kind === "detection") {
        const { x, y, w, h } = observation.payload.box;
        for (const value of [x, y, w, h]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test("same seed deep-equal; different seeds differ", () => {
    expect(buildObservation(undefined, SEED_A)).toEqual(buildObservation(undefined, SEED_A));
    expect(buildObservation(undefined, SEED_A)).not.toEqual(buildObservation(undefined, SEED_B));
  });

  test("override wins over the rng-derived value", () => {
    expect(buildObservation({ confidence: 0.9 }, SEED_A).confidence).toBe(0.9);
    expect(buildObservation({ eventTimeMs: 1234 }, SEED_A).eventTimeMs).toBe(1234);
  });

  test("explicit undefined removes an optional field (observation stays valid)", () => {
    const observation = buildObservation({ ingestTimeMs: undefined }, SEED_A);
    expect(observation.ingestTimeMs).toBeUndefined();
    expect(Observation.safeParse(observation).success).toBe(true);
  });

  test("invalid overrides throw the zod error", () => {
    expect(() => buildObservation({ confidence: 1.5 })).toThrow(ZodError);
    expect(() => buildObservation(asOverrides<ObservationDoc>({ provenance: "GUESSED" }))).toThrow(
      ZodError,
    );
    expect(() =>
      buildObservation({
        payload: { kind: "detection", box: { x: 2, y: 0, w: 0, h: 0 }, label: "x" },
      }),
    ).toThrow(ZodError);
  });
});

describe("buildEventEnvelope", () => {
  test("default output is a valid derived event with evidence", () => {
    const event = buildEventEnvelope();
    expect(EventEnvelope.safeParse(event).success).toBe(true);
    expect(event.provenance).toBe("DERIVED");
    expect(event.evidence.observationIds.length).toBeGreaterThan(0);
    expect(event.interval.endTimeMs).toBeGreaterThanOrEqual(event.interval.startTimeMs);
    expect(event.eventTimeMs).toBe(event.interval.endTimeMs);
  });

  test("same seed deep-equal; different seeds differ", () => {
    expect(buildEventEnvelope(undefined, SEED_A)).toEqual(buildEventEnvelope(undefined, SEED_A));
    expect(buildEventEnvelope(undefined, SEED_A)).not.toEqual(
      buildEventEnvelope(undefined, SEED_B),
    );
  });

  test("correctionOf override produces a valid correction envelope", () => {
    const event = buildEventEnvelope({ correctionOf: "evt-target" }, SEED_A);
    expect(event.correctionOf).toBe("evt-target");
    expect(EventEnvelope.safeParse(event).success).toBe(true);
  });

  test("invalid overrides throw the zod error", () => {
    expect(() => buildEventEnvelope({ evidence: { observationIds: [] } })).toThrow(ZodError);
    expect(() => buildEventEnvelope({ interval: { startTimeMs: 10, endTimeMs: 5 } })).toThrow(
      ZodError,
    );
  });
});

describe("buildWorldSnapshot", () => {
  test("default output is a valid snapshot including the football state", () => {
    const snapshot = buildWorldSnapshot();
    expect(WorldSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot.football).toBeDefined();
    expect(snapshot.generatedAtMs).toBe(TEST_EPOCH_MS);
  });

  test("uncertainty is explicit: player position unknown, candidates carry confidence", () => {
    const snapshot = buildWorldSnapshot(undefined, SEED_A);
    const player = snapshot.entities.find((entity) => entity.entityId === "player-7");
    expect(player?.state.pitchPosition?.status).toBe("unknown");
    expect(player?.state.teamRole?.status).toBe("known");
    const ball = snapshot.entities.find((entity) => entity.entityId === "ball-1");
    expect(ball?.state.pitchPosition?.status).toBe("uncertain");
    expect(typeof ball?.state.pitchPosition?.confidence).toBe("number");
    expect(snapshot.football?.score.status.status).toBe("uncertain");
  });

  test("same seed deep-equal; different seeds differ", () => {
    expect(buildWorldSnapshot(undefined, SEED_A)).toEqual(buildWorldSnapshot(undefined, SEED_A));
    expect(buildWorldSnapshot(undefined, SEED_A)).not.toEqual(
      buildWorldSnapshot(undefined, SEED_B),
    );
  });

  test("explicit undefined removes the optional football state", () => {
    const snapshot = buildWorldSnapshot({ football: undefined }, SEED_A);
    expect(snapshot.football).toBeUndefined();
    expect(WorldSnapshot.safeParse(snapshot).success).toBe(true);
  });

  test("invalid overrides throw the zod error", () => {
    expect(() => buildWorldSnapshot({ watermark: { watermarkMs: -1 } })).toThrow(ZodError);
    expect(() =>
      buildWorldSnapshot({
        entities: [
          { entityId: "bad id!", kind: "ball", version: 1, lastEventTimeMs: 0, state: {} },
        ],
      }),
    ).toThrow(ZodError);
  });
});

describe("buildAuthorizationPolicy", () => {
  test("default output is a valid, currently-in-force policy that always allows analysis", () => {
    const policy = buildAuthorizationPolicy();
    expect(AuthorizationPolicy.safeParse(policy).success).toBe(true);
    expect(policy.allowedOperations).toContain("analysis");
    expect(Date.parse(policy.expiresAtIso ?? "")).toBeGreaterThan(TEST_EPOCH_MS);
  });

  test("same seed deep-equal; different seeds differ", () => {
    expect(buildAuthorizationPolicy(undefined, SEED_A)).toEqual(
      buildAuthorizationPolicy(undefined, SEED_A),
    );
    expect(buildAuthorizationPolicy(undefined, SEED_A)).not.toEqual(
      buildAuthorizationPolicy(undefined, SEED_B),
    );
  });

  test("overrides can build an expired policy; the schema rejects empty operations", () => {
    expect(() => buildAuthorizationPolicy({ allowedOperations: [] })).toThrow(ZodError);
    const expired = buildAuthorizationPolicy({ expiresAtIso: "2020-01-01T00:00:00.000Z" }, SEED_A);
    expect(deriveRightsCapabilities(expired, new Date(TEST_EPOCH_MS)).canDeliverLive).toBe(false);
  });
});

describe("buildRenderRequest", () => {
  test("default output is a valid render request with fail-closed derived capabilities", () => {
    const request = buildRenderRequest();
    expect(RenderRequest.safeParse(request).success).toBe(true);
    // Capabilities are derived from a same-seed policy, never invented.
    const policy = buildAuthorizationPolicy(undefined, 1);
    expect(request.rightsCapabilities).toEqual(
      deriveRightsCapabilities(policy, new Date(TEST_EPOCH_MS)),
    );
  });

  test("same seed deep-equal; different seeds differ", () => {
    expect(buildRenderRequest(undefined, SEED_A)).toEqual(buildRenderRequest(undefined, SEED_A));
    expect(buildRenderRequest(undefined, SEED_A)).not.toEqual(
      buildRenderRequest(undefined, SEED_B),
    );
  });

  test("invalid overrides throw the zod error", () => {
    expect(() =>
      buildRenderRequest(
        asOverrides<RenderRequestDoc>({
          rightsCapabilities: { canShare: "yes" },
        }),
      ),
    ).toThrow(ZodError);
    expect(() => buildRenderRequest({ outputProfile: { frameRate: 0 } })).toThrow(ZodError);
  });
});

describe("buildStageMessage", () => {
  test("default output is a valid stage message with correlation and trace ids", () => {
    const message = buildStageMessage();
    expect(StageMessage.safeParse(message).success).toBe(true);
    expect(message.correlationId).toMatch(/^corr-/);
    expect(message.traceId).toMatch(/^trace-/);
    expect(message.resourceBudget).toBeDefined();
  });

  test("same seed deep-equal; different seeds differ", () => {
    expect(buildStageMessage(undefined, SEED_A)).toEqual(buildStageMessage(undefined, SEED_A));
    expect(buildStageMessage(undefined, SEED_A)).not.toEqual(buildStageMessage(undefined, SEED_B));
  });

  test("invalid overrides throw the zod error", () => {
    expect(() => buildStageMessage({ sequence: -1 })).toThrow(ZodError);
    expect(() => buildStageMessage({ watermark: { watermarkMs: -5, sequence: 0 } })).toThrow(
      ZodError,
    );
  });
});

describe("deepMerge", () => {
  test("plain objects merge recursively", () => {
    expect(deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } })).toEqual({
      a: 1,
      b: { c: 9, d: 3 },
    });
  });

  test("arrays and primitives replace wholesale", () => {
    const base: { list: number[]; n: number | string } = { list: [1, 2, 3], n: 1 };
    expect(deepMerge(base, { list: [9], n: "x" })).toEqual({ list: [9], n: "x" });
  });

  test("explicit undefined removes the key", () => {
    const merged: { a?: number; b?: number } = deepMerge({ a: 1, b: 2 }, { b: undefined });
    expect(merged).toEqual({ a: 1 });
  });

  test("undefined overrides return the base unchanged", () => {
    const base = { a: { b: 1 } };
    expect(deepMerge(base, undefined)).toEqual(base);
  });

  test("does not mutate the base", () => {
    const base = { a: { b: 1 } };
    deepMerge(base, { a: { b: 2 } });
    expect(base).toEqual({ a: { b: 1 } });
  });
});
