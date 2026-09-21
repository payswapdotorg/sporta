/**
 * THE L007/L008 BATTERY — the open-data replay adapter + the live-provider
 * TechnologyProfile registrations.
 *
 * FIXTURE HONESTY: every fixture frame below is a FORMAT-FIXTURE — the
 * recorded published schema (fetched from github.com/SkillCorner/opendata
 * 2026-09-21, see src/skillcorner/format) with SYNTHETIC values. NO sample
 * data is committed; the real sampled frames are quoted in the format
 * module's documentation only.
 *
 * The acceptance pins:
 *
 * - provider-field isolation — the emitted batches parse against the STRICT
 *   frozen LiveObservation contract and no provider key survives anywhere;
 * - the EXACT live path — adapter → L004 (live-temporal) → L003 (live-swm)
 *   → the canonical WorldModelEngine, with the D6 replay equality over the
 *   bridged store (the open data rides the same continuity machinery);
 * - replay determinism — same JSONL → byte-identical batches;
 * - the L008 registrations — the frozen TechnologyProfile contract, the
 *   MIT-resolved SkillCorner record, and the EXPLICITLY BLOCKED Metrica
 *   record (blockingLicenseIssues non-empty — the R004 fail-closed rule).
 */
import { describe, expect, test } from "bun:test";
import { parseLiveObservation } from "@sporta/live-source";
import type { LiveObservation } from "@sporta/live-source";
import { blockingLicenseIssues, TechnologyProfile } from "@sporta/contracts";
import { createTemporalBufferEngine } from "@sporta/live-temporal";
import { createLiveSwmUpdater } from "@sporta/live-swm";
import { InMemoryObservationStore } from "@sporta/observation";
import { runWorldFusion } from "@sporta/fusion";
import { WorldModelEngine } from "@sporta/world-model";
import {
  METRICA_SAMPLE_DATA_PROFILE,
  SKILLCORNER_CONFIDENCE_PRIORS,
  SKILLCORNER_OPENDATA_PROFILE,
  SkillCornerFormatError,
  createSkillCornerOpenDataReplay,
  parseSkillCornerJsonl,
  parseSkillCornerTimestampMs,
  registeredLiveProviderProfiles,
} from "../src/index";

const SESSION_ID = "s-open-data";

/** One provider-shaped frame line (FORMAT-FIXTURE — synthetic values). */
function frameLine(input: {
  frame: number;
  timestamp: string | null;
  period: 1 | 2 | null;
  players: Array<{ x: number; y: number; id: number; detected: boolean | null }>;
  ball: { x: number | null; y: number | null; z: number | null; detected: boolean | null };
  possessionPlayerId?: number | null;
  possessionGroup?: string | null;
}): string {
  return JSON.stringify({
    frame: input.frame,
    timestamp: input.timestamp,
    period: input.period,
    ball_data: {
      x: input.ball.x,
      y: input.ball.y,
      z: input.ball.z,
      is_detected: input.ball.detected,
    },
    possession: {
      player_id: input.possessionPlayerId ?? null,
      group: input.possessionGroup ?? null,
    },
    image_corners_projection: {
      x_top_left: null,
      y_top_left: null,
      x_bottom_left: null,
      y_bottom_left: null,
      x_bottom_right: null,
      y_bottom_right: null,
      x_top_right: null,
      y_top_right: null,
    },
    player_data: input.players.map((player) => ({
      x: player.x,
      y: player.y,
      player_id: player.id,
      is_detected: player.detected,
    })),
  });
}

/** The format-fixture match: pre-match nulls, a detected window, an absent
 * player (broadcast), an extrapolated ball, a possession frame, and a period
 * 2 continuation (timestamps reset). */
const FIXTURE_JSONL = [
  // The all-null pre-match head (the real file starts exactly like this).
  frameLine({
    frame: 0,
    timestamp: null,
    period: null,
    players: [],
    ball: { x: null, y: null, z: null, detected: null },
  }),
  frameLine({
    frame: 1,
    timestamp: null,
    period: null,
    players: [],
    ball: { x: null, y: null, z: null, detected: null },
  }),
  // Kickoff window: three players (one extrapolated) + a detected ball.
  frameLine({
    frame: 2,
    timestamp: "00:00:00.20",
    period: 1,
    players: [
      { x: -40.5, y: -10.25, id: 101, detected: true },
      { x: -20.0, y: 5.5, id: 102, detected: true },
      { x: 12.5, y: -2.0, id: 103, detected: false },
    ],
    ball: { x: 0.5, y: 0.25, z: 0.11, detected: true },
  }),
  // Frame 3: player 102 off-screen (absent — broadcast tracking), ball extrapolated with z.
  frameLine({
    frame: 3,
    timestamp: "00:00:00.30",
    period: 1,
    players: [
      { x: -40.2, y: -10.1, id: 101, detected: true },
      { x: 12.8, y: -1.8, id: 103, detected: false },
    ],
    ball: { x: 0.7, y: 0.3, z: 1.84, detected: false },
  }),
  // Frame 4: everyone back + a provider possession hypothesis present.
  frameLine({
    frame: 4,
    timestamp: "00:00:00.40",
    period: 1,
    players: [
      { x: -39.9, y: -9.9, id: 101, detected: true },
      { x: -19.5, y: 5.2, id: 102, detected: true },
      { x: 13.1, y: -1.6, id: 103, detected: false },
    ],
    ball: { x: 0.9, y: 0.4, z: 0.0, detected: true },
    possessionPlayerId: 101,
    possessionGroup: "home team",
  }),
  // Period 2: timestamps reset; the session timeline continues at the
  // data-derived offset (period 1 end 400ms + one 10fps frame = 500ms).
  frameLine({
    frame: 5,
    timestamp: "00:00:00.10",
    period: 2,
    players: [
      { x: 40.0, y: 10.0, id: 101, detected: true },
      { x: 20.0, y: -5.0, id: 102, detected: true },
      { x: -12.0, y: 2.0, id: 103, detected: true },
    ],
    ball: { x: -0.5, y: -0.25, z: 0.12, detected: true },
  }),
  frameLine({
    frame: 6,
    timestamp: "00:00:00.20",
    period: 2,
    players: [
      { x: 39.5, y: 9.8, id: 101, detected: true },
      { x: 19.8, y: -4.9, id: 102, detected: true },
      { x: -11.9, y: 2.1, id: 103, detected: true },
    ],
    ball: { x: -0.6, y: -0.3, z: 0.08, detected: true },
  }),
].join("\n");

/** Drains the whole replay into batches (and counts the pulls). */
function drainReplay(jsonl: string, sessionId = SESSION_ID): LiveObservation[] {
  const replay = createSkillCornerOpenDataReplay({ sessionId, jsonl });
  const batches: LiveObservation[] = [];
  for (let observation = replay.next(); observation !== null; observation = replay.next()) {
    batches.push(observation);
  }
  return batches;
}

describe("the recorded schema (format.ts)", () => {
  test("the real pre-match and mid-match shapes parse (the schema of record)", () => {
    const preMatch = frameLine({
      frame: 0,
      timestamp: null,
      period: null,
      players: [],
      ball: { x: null, y: null, z: null, detected: null },
    });
    const frames = parseSkillCornerJsonl(preMatch);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.player_data).toEqual([]);
    expect(frames[0]!.ball_data.is_detected).toBeNull();
  });

  test("timestamps parse to period milliseconds (HH:MM:SS.ss); null stays null", () => {
    expect(parseSkillCornerTimestampMs("00:42:49.30")).toBe(2569300);
    expect(parseSkillCornerTimestampMs("00:00:00.10")).toBe(100);
    expect(parseSkillCornerTimestampMs(null)).toBeNull();
    expect(parseSkillCornerTimestampMs("")).toBeNull();
  });

  test("unknown provider keys are REFUSED (strict — the recorded schema only)", () => {
    const withExtra = JSON.stringify({
      frame: 0,
      timestamp: null,
      period: null,
      ball_data: { x: null, y: null, z: null, is_detected: null },
      possession: { player_id: null, group: null },
      image_corners_projection: {
        x_top_left: null,
        y_top_left: null,
        x_bottom_left: null,
        y_bottom_left: null,
        x_bottom_right: null,
        y_bottom_right: null,
        x_top_right: null,
        y_top_right: null,
      },
      player_data: [],
      some_future_field: true,
    });
    expect(() => parseSkillCornerJsonl(withExtra)).toThrow(SkillCornerFormatError);
  });

  test("malformed JSON is refused fail-loud with the line number", () => {
    expect(() => parseSkillCornerJsonl("{ not json")).toThrow(/line 1/);
  });
});

describe("the replay adapter — provider-field isolation + normalization", () => {
  const batches = drainReplay(FIXTURE_JSONL);

  test("empty pre-match frames yield no batch (counted, never fabricated)", () => {
    // 7 frames, 2 pre-match empties → 5 batches.
    expect(batches).toHaveLength(5);
    const replay = createSkillCornerOpenDataReplay({ sessionId: SESSION_ID, jsonl: FIXTURE_JSONL });
    replay.next();
    replay.next();
    replay.next();
    replay.next();
    replay.next();
    expect(replay.stats().emptyFramesSkipped).toBe(2);
    expect(replay.stats().batchesEmitted).toBe(5);
    expect(replay.stats().framesParsed).toBe(7);
    expect(replay.stats().exhausted).toBe(true);
  });

  test("every batch parses against the STRICT frozen contract (no provider field survives)", () => {
    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches) {
      expect(() => parseLiveObservation(batch)).not.toThrow();
      const serialized = JSON.stringify(batch);
      // The provider vocabulary never reaches the product contract.
      for (const providerKey of [
        "player_id",
        "is_detected",
        "ball_data",
        "player_data",
        "possession",
        "image_corners_projection",
        "group",
        "frame",
        "timestamp",
        "period",
      ]) {
        expect(serialized.includes(`"${providerKey}"`)).toBe(false);
      }
    }
  });

  test("center-origin meters normalize to the Sporta canonical corner-origin frame", () => {
    const kickoff = batches[0]!;
    const player101 = kickoff.entityObservations.find((row) => row.entityRef === "sc-p-101")!;
    // -40.5 + 52.5 = 12.0; -10.25 + 34 = 23.75.
    expect(player101.position).toEqual({ xMeters: 12, yMeters: 23.75 });
    const ball = kickoff.entityObservations.find((row) => row.entityRef === "sc-ball")!;
    expect(ball.position).toEqual({ xMeters: 53, yMeters: 34.25, zMeters: 0.11 });
  });

  test("is_detected maps VERBATIM to the honest detected flag + the confidence priors", () => {
    const kickoff = batches[0]!;
    const detected = kickoff.entityObservations.find((row) => row.entityRef === "sc-p-101")!;
    expect(detected.detected).toBe(true);
    expect(detected.confidence).toBe(SKILLCORNER_CONFIDENCE_PRIORS.detected);
    const carried = kickoff.entityObservations.find((row) => row.entityRef === "sc-p-103")!;
    expect(carried.detected).toBe(false);
    expect(carried.confidence).toBe(SKILLCORNER_CONFIDENCE_PRIORS.carried);
    expect(carried.velocity).toBeUndefined(); // never invented
    // The extrapolated ball of frame 3 carries z but no velocity either.
    const frame3 = batches[1]!;
    const ball = frame3.entityObservations.find((row) => row.entityRef === "sc-ball")!;
    expect(ball.detected).toBe(false);
    expect(ball.position.zMeters).toBe(1.84);
  });

  test("absent players are simply unobserved that frame (no fabricated rows)", () => {
    const frame3 = batches[1]!;
    expect(frame3.entityObservations.find((row) => row.entityRef === "sc-p-102")).toBeUndefined();
    expect(frame3.entityObservations).toHaveLength(3); // 2 players + the ball
  });

  test("the session timeline: period 1 timestamps map directly; period 2 continues at the data-derived offset", () => {
    expect(batches[0]!.eventTimeMs).toBe(200); // "00:00:00.20"
    expect(batches[1]!.eventTimeMs).toBe(300);
    expect(batches[2]!.eventTimeMs).toBe(400);
    // Period 1 ended at 400ms; the offset = 400 + one 10fps frame = 500.
    expect(batches[3]!.eventTimeMs).toBe(600); // "00:00:00.10" + 500
    expect(batches[4]!.eventTimeMs).toBe(700);
    // Sequences are the 1-based frame numbers (gaps visible, never renumbered).
    expect(batches.map((batch) => batch.sequence)).toEqual([3, 4, 5, 6, 7]);
    // The conservative emission watermark rides each batch (the L004 engine
    // owns the windowing).
    expect(batches[0]!.watermark).toEqual({ watermarkMs: 200, sequence: 3 });
  });

  test("the provider possession hypothesis is accounted, never mapped", () => {
    const replay = createSkillCornerOpenDataReplay({ sessionId: SESSION_ID, jsonl: FIXTURE_JSONL });
    let batch = replay.next();
    while (batch !== null) batch = replay.next();
    expect(replay.stats().framesWithProviderPossession).toBe(1); // frame 4's hypothesis
    expect(JSON.stringify(drainReplay(FIXTURE_JSONL)).includes('"home team"')).toBe(false);
  });

  test("replay determinism: the same JSONL replays byte-identically", () => {
    const first = drainReplay(FIXTURE_JSONL);
    const second = drainReplay(FIXTURE_JSONL);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("the EXACT live path — adapter → L004 → L003 → the canonical SWM", () => {
  test("the open data drives the full live composition with replay continuity", () => {
    const replay = createSkillCornerOpenDataReplay({ sessionId: SESSION_ID, jsonl: FIXTURE_JSONL });
    const engine = WorldModelEngine.create(SESSION_ID, {
      football: {
        pitch: {
          lengthAxisMeters: 105,
          widthAxisMeters: 68,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "first-half", clockMs: 0, stoppage: false },
        score: { home: 0, away: 0, status: { status: "unknown" } },
        possession: { status: "unknown" },
        eventTaxonomyVersion: "1",
      },
      now: () => 0,
    });
    const store = new InMemoryObservationStore();
    const updater = createLiveSwmUpdater({ sessionId: SESSION_ID, engine, store });
    const temporal = createTemporalBufferEngine({ sessionId: SESSION_ID });

    const feed = (drain: ReturnType<typeof temporal.tick>): void => {
      for (const entry of drain.applied) {
        const sourceStats = drain.sources.find((stats) => stats.sourceId === entry.sourceId);
        updater.apply(
          entry.batch,
          sourceStats !== undefined ? { engineWatermark: sourceStats.watermark } : undefined,
        );
      }
    };
    // Time-driven: admit each batch at its planned ingest, tick at 100ms steps.
    let clock = 0;
    let drained = 0;
    while (drained < 5) {
      const planned = replay.plannedIngestTimeMs();
      if (planned !== null && planned <= clock) {
        const observation = replay.next();
        if (observation !== null) {
          feed(temporal.admit(observation));
          drained += 1;
          continue;
        }
      }
      feed(temporal.tick(clock));
      clock += 100;
    }
    feed(temporal.finalize());

    // The canonical SWM holds the replayed entities: 3 players + the ball.
    expect([...engine.entityIds].sort()).toEqual(["sc-ball", "sc-p-101", "sc-p-102", "sc-p-103"]);
    // The ball's LATEST state is frame 6's row (-0.6, -0.3 → 51.9, 33.7);
    // possession is DERIVED canonically (never the provider's hypothesis).
    const snapshot = engine.snapshot();
    const ballPosition = engine.entityAt("sc-ball")!.state.position!.value;
    expect(ballPosition).toEqual({ x: 51.9, y: 33.7 });
    // Every applied batch's entity rows are engine-versioned participants/ball.
    for (const entityId of engine.entityIds) {
      const entity = engine.entityAt(entityId)!;
      expect(["participant", "ball"]).toContain(entity.kind);
      expect(entity.state.position!.status).toBe("uncertain");
    }

    // D6 continuity: a batch runWorldFusion replay over the bridged store
    // reproduces the final state exactly (the open data rides the SAME
    // continuity machinery as the synthetic source).
    const replayEngine = WorldModelEngine.create(SESSION_ID, {
      football: {
        pitch: {
          lengthAxisMeters: 105,
          widthAxisMeters: 68,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "first-half", clockMs: 0, stoppage: false },
        score: { home: 0, away: 0, status: { status: "unknown" } },
        possession: { status: "unknown" },
        eventTaxonomyVersion: "1",
      },
      now: () => 0,
    });
    runWorldFusion({ store, engine: replayEngine, sessionId: SESSION_ID });
    for (const entityId of engine.entityIds) {
      const live = engine.entityAt(entityId)!;
      const replayedEntity = replayEngine.entityAt(entityId)!;
      expect(replayedEntity.kind).toBe(live.kind);
      expect(replayedEntity.lastEventTimeMs).toBe(live.lastEventTimeMs);
      expect(JSON.stringify(replayedEntity.state)).toBe(JSON.stringify(live.state));
      expect(replayedEntity.version).toBe(live.version);
    }
    expect(JSON.stringify(replayEngine.snapshot().football!.possession)).toBe(
      JSON.stringify(snapshot.football!.possession),
    );
  });
});

describe("the L008 TechnologyProfile registrations", () => {
  test("both registrations parse against the FROZEN TechnologyProfile contract", () => {
    for (const profile of registeredLiveProviderProfiles()) {
      const parsed = TechnologyProfile.safeParse(profile);
      expect(parsed.success).toBe(true);
    }
  });

  test("SkillCorner opendata: the REAL candidate — MIT-resolved, no blocking issues", () => {
    const issues = blockingLicenseIssues(SKILLCORNER_OPENDATA_PROFILE);
    expect(issues).toEqual([]);
    expect(SKILLCORNER_OPENDATA_PROFILE.status).toBe("candidate");
    expect(SKILLCORNER_OPENDATA_PROFILE.license.dataset!.licenseId).toBe("MIT");
    expect(SKILLCORNER_OPENDATA_PROFILE.license.dataset!.commercialUse).toBe(true);
    // The three-way record's absent model component is honestly absent.
    expect(SKILLCORNER_OPENDATA_PROFILE.license.model).toBeUndefined();
  });

  test("Metrica sample data: the EXPLICITLY BLOCKED candidate (license unresolved)", () => {
    const issues = blockingLicenseIssues(METRICA_SAMPLE_DATA_PROFILE);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("unresolved");
    expect(METRICA_SAMPLE_DATA_PROFILE.license.dataset!.status).toBe("unresolved");
    expect(METRICA_SAMPLE_DATA_PROFILE.license.dataset!.commercialUse).toBeUndefined();
  });

  test("the registrations carry the §6 surface: capabilities, format, rate, provenance, failure classes", () => {
    for (const profile of registeredLiveProviderProfiles()) {
      expect(Object.keys(profile.capabilities).length).toBeGreaterThan(0);
      expect(profile.inputContract.length).toBeGreaterThan(0);
      expect(profile.provenance.sourceUrl).toContain("github.com");
      expect(profile.failureClasses.length).toBeGreaterThan(0);
    }
    // The rate is documented in the SkillCorner capabilities/input contract
    // surface (10 fps — the recorded README statement).
    expect(SKILLCORNER_OPENDATA_PROFILE.capabilities["replay-source"]).toContain("10 fps");
  });
});
