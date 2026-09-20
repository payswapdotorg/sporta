/**
 * THE CONTRACT + HONESTY TESTS (L002): every emitted observation parses
 * against the frozen-shaped LiveObservation contract (the source
 * self-checks, this pins it externally), coordinates stay inside the
 * Sporta canonical pitch frame, the dual clocks are coherent, undetected
 * entities are honest (carried position, LOW confidence, NO velocity),
 * and the §6 metadata profile is complete.
 */
import { describe, expect, test } from "bun:test";
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";
import {
  LIVE_SOURCE_ADAPTER_ID,
  LiveObservation as LiveObservationSchema,
  createDeterministicLiveSource,
  drainSource,
  parseLiveObservation,
} from "../src/index";
import type { LiveObservation, LiveScenarioConfig, LiveScenarioKind } from "../src/index";

const BASE = {
  sessionId: "sess-l002-contract",
  seed: 7,
  tickCount: 120,
  rateMs: 100,
  playersPerTeam: 11,
  referees: 2,
} as const;

function observationsOf(scenario: LiveScenarioKind | LiveScenarioConfig): LiveObservation[] {
  return drainSource(createDeterministicLiveSource({ ...BASE, scenario }));
}

describe("the frozen-shaped contract (every scenario, every observation)", () => {
  test("every observation parses against the LiveObservation schema", () => {
    for (const scenario of [
      "normal",
      "jitter",
      "delay",
      "drop",
      "out-of-order",
      "reconnect",
    ] as const) {
      for (const observation of observationsOf(scenario)) {
        // parseLiveObservation throws loudly on ANY drift (also self-checked
        // inside the source — this pins it from the outside).
        expect(() => parseLiveObservation(observation)).not.toThrow();
        expect(LiveObservationSchema.safeParse(observation).success).toBe(true);
      }
    }
  });

  test("the sourceType is TRACKING and the schema version is pinned", () => {
    for (const observation of observationsOf("normal")) {
      expect(observation.sourceType).toBe("TRACKING");
      expect(observation.schemaVersion).toBe("sporta.live-observation/1");
    }
  });

  test("sequence is 1-based and event time is the canonical timeline", () => {
    const observations = observationsOf("normal");
    expect(observations[0]!.sequence).toBe(1);
    expect(observations[0]!.eventTimeMs).toBe(0);
    expect(observations[1]!.eventTimeMs).toBe(BASE.rateMs);
    for (const observation of observations) {
      expect(observation.eventTimeMs).toBe((observation.sequence - 1) * BASE.rateMs);
    }
  });

  test("ingest time is never before event time (causal delivery stamps)", () => {
    for (const observation of observationsOf("jitter")) {
      expect(observation.ingestTimeMs).toBeGreaterThanOrEqual(observation.eventTimeMs);
    }
  });

  test("the watermark never exceeds the largest delivered-or-accounted event time", () => {
    // Conservative frontier: the watermark of the FIRST observation is its
    // own event time (normal) or 0 (mid-swap) — never ahead of deliveries.
    const observations = observationsOf("out-of-order");
    let maxEventSeen = -1;
    for (const observation of observations) {
      maxEventSeen = Math.max(maxEventSeen, observation.eventTimeMs);
      expect(observation.watermark.watermarkMs).toBeLessThanOrEqual(maxEventSeen);
      expect(observation.watermark.watermarkMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the canonical pitch frame (Sporta meters)", () => {
  test("every entity position lies inside 105 x 68 with the script margin", () => {
    for (const observation of observationsOf("normal")) {
      for (const entity of observation.entityObservations) {
        expect(entity.position.xMeters).toBeGreaterThanOrEqual(1.5);
        expect(entity.position.xMeters).toBeLessThanOrEqual(PITCH_LENGTH_AXIS_METERS - 1.5);
        expect(entity.position.yMeters).toBeGreaterThanOrEqual(1.5);
        expect(entity.position.yMeters).toBeLessThanOrEqual(PITCH_WIDTH_AXIS_METERS - 1.5);
        if (entity.position.zMeters !== undefined) {
          expect(entity.position.zMeters).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test("the full roster is observed: 22 players + 2 referees + 1 ball per tick", () => {
    const observations = observationsOf("normal");
    for (const observation of observations) {
      expect(observation.entityObservations.length).toBe(25);
      const kinds = observation.entityObservations.map((entity) => entity.kind);
      expect(kinds.filter((kind) => kind === "PLAYER").length).toBe(22);
      expect(kinds.filter((kind) => kind === "REFEREE").length).toBe(2);
      expect(kinds.filter((kind) => kind === "BALL").length).toBe(1);
    }
  });

  test("players carry their team ref; the ball and referees do not", () => {
    for (const observation of observationsOf("normal")) {
      for (const entity of observation.entityObservations) {
        if (entity.kind === "PLAYER") {
          expect(entity.teamRef === "team-home" || entity.teamRef === "team-away").toBe(true);
        } else {
          expect(entity.teamRef).toBeUndefined();
        }
      }
    }
  });

  test("every entity carries a source-local track id", () => {
    for (const observation of observationsOf("normal")) {
      for (const entity of observation.entityObservations) {
        expect(entity.sourceLocalTrackId).toBeDefined();
        expect(entity.sourceLocalTrackId!.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("honest missing data (never fabricated certainty)", () => {
  test("undetected entities: carried position, LOW confidence, NO velocity", () => {
    const observations = observationsOf("normal");
    const undetected = observations
      .flatMap((observation) => observation.entityObservations)
      .filter((entity) => !entity.detected);
    // With a 22+3 roster over 120 ticks, honest misses DO occur.
    expect(undetected.length).toBeGreaterThan(0);
    for (const entity of undetected) {
      expect(entity.confidence).toBeLessThanOrEqual(0.28);
      expect(entity.velocity).toBeUndefined();
      expect(entity.observedAtMs).toBeGreaterThanOrEqual(0); // the honest carried time
    }
    // And detected entities carry real confidences and velocities.
    const detected = observations
      .flatMap((observation) => observation.entityObservations)
      .filter((entity) => entity.detected);
    for (const entity of detected) {
      expect(entity.confidence).toBeGreaterThanOrEqual(0.74 * 0.65 - 0.01);
      expect(entity.velocity).toBeDefined();
    }
  });

  test("the batch confidence is the honest mean of its entities", () => {
    for (const observation of observationsOf("normal").slice(0, 10)) {
      const mean =
        observation.entityObservations.reduce((acc, e) => acc + e.confidence, 0) /
        observation.entityObservations.length;
      expect(Math.abs(observation.confidence - Math.round(mean * 1000) / 1000)).toBeLessThan(0.002);
    }
  });

  test("the provenance is DERIVED (a scripted model — never claimed observed)", () => {
    for (const observation of observationsOf("normal")) {
      expect(observation.provenance).toBe("DERIVED");
    }
  });
});

describe("the §6 source metadata profile", () => {
  test("carries the full honest profile (rate, frame, capabilities, provenance)", () => {
    const source = createDeterministicLiveSource({ ...BASE, scenario: "reconnect" });
    const metadata = source.metadata;
    expect(metadata.adapterId).toBe(LIVE_SOURCE_ADAPTER_ID);
    expect(metadata.sourceKind).toBe("synthetic-deterministic");
    expect(metadata.supportedRateHz).toBe(10);
    expect(metadata.coordinateSystem).toContain("105 x 68");
    expect(metadata.capabilities.length).toBe(6);
    expect(metadata.provenance).toContain("synthetic");
    expect(metadata.authenticationMode).toBe("none");
    expect(metadata.reconnectBehavior).toContain("explicit gap accounting");
    expect(metadata.dropoutClasses).toContain("reconnect-window");
  });

  test("validation fails loud on bad configs (never silent defaults)", () => {
    expect(() => createDeterministicLiveSource({ ...BASE, scenario: "nope" as never })).toThrow();
    expect(() =>
      createDeterministicLiveSource({ ...BASE, scenario: { kind: "jitter", jitterMaxMs: 100 } }),
    ).toThrow(/jitterMaxMs/);
    expect(() =>
      createDeterministicLiveSource({ ...BASE, scenario: { kind: "drop", dropRate: 0.9 } }),
    ).toThrow(/dropRate/);
    expect(() =>
      createDeterministicLiveSource({
        ...BASE,
        scenario: "normal",
        tickCount: 0,
      } as never),
    ).toThrow(/tickCount/);
    expect(() =>
      createDeterministicLiveSource({
        ...BASE,
        scenario: "normal",
        sessionId: "",
      } as never),
    ).toThrow(/sessionId/);
  });
});
