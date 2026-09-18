import { describe, expect, test } from "bun:test";
import { TeamAssignmentPayload } from "@sporta/contracts";
import {
  InvalidAdapterInputError,
  JerseyColorTeamAssigner,
  generateTeamFixture,
} from "../src/index";
import type { TeamFixtureSpec } from "../src/index";

const TEAM_SPEC: TeamFixtureSpec = {
  specId: "test-team",
  seed: 77,
  width: 160,
  height: 120,
  frameCount: 8,
  frameIntervalMs: 40,
  players: [
    {
      trackId: "t1",
      team: "home",
      jersey: { r: 180, g: 30, b: 30 },
      from: { x: 0.2, y: 0.3 },
      to: { x: 0.5, y: 0.35 },
      boxW: 0.06,
      boxH: 0.12,
    },
    {
      trackId: "t2",
      team: "home",
      jersey: { r: 175, g: 35, b: 25 },
      from: { x: 0.7, y: 0.6 },
      to: { x: 0.4, y: 0.55 },
      boxW: 0.06,
      boxH: 0.12,
    },
    {
      trackId: "t3",
      team: "away",
      jersey: { r: 30, g: 60, b: 200 },
      from: { x: 0.55, y: 0.25 },
      to: { x: 0.3, y: 0.5 },
      boxW: 0.06,
      boxH: 0.12,
    },
    {
      trackId: "t4",
      team: "away",
      jersey: { r: 35, g: 55, b: 195 },
      from: { x: 0.8, y: 0.8 },
      to: { x: 0.75, y: 0.2 },
      boxW: 0.06,
      boxH: 0.12,
    },
    // Goalkeeper: distinct kit far from both clusters -> honest unknown.
    {
      trackId: "t5",
      team: "keeper",
      jersey: { r: 240, g: 220, b: 40 },
      from: { x: 0.1, y: 0.45 },
      to: { x: 0.12, y: 0.5 },
      boxW: 0.06,
      boxH: 0.12,
    },
    // Low-signal track: visible in ONE frame with a tiny crop -> honest unknown.
    {
      trackId: "t6",
      team: "low-signal",
      jersey: { r: 180, g: 30, b: 30 },
      from: { x: 0.45, y: 0.85 },
      to: { x: 0.47, y: 0.85 },
      boxW: 0.015,
      boxH: 0.025,
      visibleFromFrame: 3,
      visibleToFrame: 3,
    },
  ],
};

function teamSequence() {
  return generateTeamFixture(TEAM_SPEC).map(({ frame, tracked }) => ({ frame, tracked }));
}

describe("JerseyColorTeamAssigner (R206)", () => {
  test("assigns every seen track exactly once, in deterministic order", () => {
    const assigner = new JerseyColorTeamAssigner();
    const assignments = assigner.assign(teamSequence());
    expect(assignments.length).toBe(6);
    expect(assignments.map((assignment) => assignment.trackId)).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
    ]);
  });

  test("the two teams partition correctly (label-arbitrariness-proof)", () => {
    const assigner = new JerseyColorTeamAssigner();
    const assignments = assigner.assign(teamSequence());
    const byTrack = new Map(assignments.map((assignment) => [assignment.trackId, assignment]));
    const t1 = byTrack.get("t1")!;
    const t2 = byTrack.get("t2")!;
    const t3 = byTrack.get("t3")!;
    const t4 = byTrack.get("t4")!;
    // Home players share a team; away players share the OTHER team.
    expect(t1.teamId).toBe(t2.teamId);
    expect(t3.teamId).toBe(t4.teamId);
    expect(t1.teamId).not.toBe(t3.teamId);
    for (const assignment of [t1, t2, t3, t4]) {
      expect(assignment.teamId === "home" || assignment.teamId === "away").toBe(true);
      expect(assignment.confidence).toBeGreaterThan(0.6);
      expect(assignment.method).toBe("jersey-color");
    }
  });

  test("HONESTY: the low-signal track yields unknown with LOW confidence — never a guess", () => {
    const assigner = new JerseyColorTeamAssigner();
    const assignments = assigner.assign(teamSequence());
    const lowSignal = assignments.find((assignment) => assignment.trackId === "t6")!;
    expect(lowSignal.teamId).toBe("unknown");
    expect(lowSignal.confidence).toBeLessThanOrEqual(0.2);
    expect(lowSignal.method).toBe("jersey-color");
  });

  test("HONESTY: the distinct-kit goalkeeper lands in unknown (no special handling, documented)", () => {
    const assigner = new JerseyColorTeamAssigner();
    const assignments = assigner.assign(teamSequence());
    const keeper = assignments.find((assignment) => assignment.trackId === "t5")!;
    expect(keeper.teamId).toBe("unknown");
  });

  test("assignments map 1:1 onto the TeamAssignmentPayload contract addition", () => {
    const assigner = new JerseyColorTeamAssigner();
    const assignments = assigner.assign(teamSequence());
    for (const assignment of assignments) {
      const parsed = TeamAssignmentPayload.safeParse({
        kind: "team-assignment",
        trackId: assignment.trackId,
        teamId: assignment.teamId,
        confidence: assignment.confidence,
        method: assignment.method,
      });
      expect(parsed.success).toBe(true);
    }
  });

  test("unseparated kits (identical colors) honestly unknown everyone", () => {
    const sameKitSpec: TeamFixtureSpec = {
      ...TEAM_SPEC,
      specId: "test-same-kit",
      players: TEAM_SPEC.players.slice(0, 4).map((player) => ({
        ...player,
        jersey: { r: 180, g: 30, b: 30 },
      })),
    };
    const assigner = new JerseyColorTeamAssigner();
    const sequence = generateTeamFixture(sameKitSpec).map(({ frame, tracked }) => ({
      frame,
      tracked,
    }));
    const assignments = assigner.assign(sequence);
    expect(assignments.length).toBe(4);
    for (const assignment of assignments) {
      expect(assignment.teamId).toBe("unknown");
      expect(assignment.confidence).toBeLessThanOrEqual(0.2);
    }
  });

  test("fewer than two eligible tracks honestly unknown everyone", () => {
    const singleSpec: TeamFixtureSpec = {
      ...TEAM_SPEC,
      specId: "test-single",
      players: TEAM_SPEC.players.slice(0, 1),
    };
    const assigner = new JerseyColorTeamAssigner();
    const sequence = generateTeamFixture(singleSpec).map(({ frame, tracked }) => ({
      frame,
      tracked,
    }));
    const assignments = assigner.assign(sequence);
    expect(assignments.length).toBe(1);
    expect(assignments[0]!.teamId).toBe("unknown");
  });

  test("deterministic across instances with the same seed; different seeds may label swap, never guess", () => {
    const a = new JerseyColorTeamAssigner({ seed: "seed-a" });
    const b = new JerseyColorTeamAssigner({ seed: "seed-a" });
    const c = new JerseyColorTeamAssigner({ seed: "seed-b" });
    const sequence = teamSequence();
    expect(a.assign(sequence)).toEqual(b.assign(sequence));
    // Home/away labels may flip across seeds (deterministic but arbitrary);
    // the PARTITION must be identical either way.
    const byTrackC = new Map(
      c.assign(sequence).map((assignment) => [assignment.trackId, assignment]),
    );
    const byTrackA = new Map(
      a.assign(sequence).map((assignment) => [assignment.trackId, assignment]),
    );
    for (const trackId of ["t1", "t2", "t3", "t4"]) {
      const ac = byTrackA.get(trackId)!;
      const cc = byTrackC.get(trackId)!;
      const bothCommitted =
        (ac.teamId === "home" || ac.teamId === "away") &&
        (cc.teamId === "home" || cc.teamId === "away");
      if (bothCommitted) {
        expect(
          ac.teamId === cc.teamId ||
            (ac.teamId === "home" && cc.teamId === "away") ||
            (ac.teamId === "away" && cc.teamId === "home"),
        ).toBe(true);
      }
    }
  });

  test("malformed input is refused loudly (untrusted-input law)", () => {
    const assigner = new JerseyColorTeamAssigner();
    const sequence = teamSequence();
    const malformed = [
      ...sequence,
      {
        frame: sequence[0]!.frame,
        tracked: [
          {
            box: { x: 0.1, y: 0.1, w: 0.05, h: 0.1 },
            label: "player",
            confidence: 0.9,
            trackId: "bad id with spaces!",
          },
        ],
      },
    ];
    expect(() => assigner.assign(malformed)).toThrow(InvalidAdapterInputError);
  });

  test("constructor validates options", () => {
    expect(() => new JerseyColorTeamAssigner({ minSamples: 0 })).toThrow(RangeError);
    expect(() => new JerseyColorTeamAssigner({ confidenceThreshold: 0.4 })).toThrow(RangeError);
    expect(() => new JerseyColorTeamAssigner({ maxIterations: 0 })).toThrow(RangeError);
    expect(() => new JerseyColorTeamAssigner({ seed: "" })).toThrow(RangeError);
  });
});
