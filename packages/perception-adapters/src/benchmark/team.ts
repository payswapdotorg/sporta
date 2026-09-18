/**
 * Deterministic team-identity-family benchmark (R206): runs the
 * jersey-color team assigner against the committed synthetic-diagnostic
 * fixtures and emits a frozen-contract `BenchmarkRun` record.
 *
 * METRICS (label-arbitrariness-proof — home/away labeling is deterministic
 * but arbitrary, so partition quality is measured WITHOUT trusting the
 * labels): `partitionAccuracy` (the better of the two label-to-truth
 * mappings over tracks the assigner committed to home/away),
 * `unknownRate`, `unknownHonestyRate` (tracks whose ground truth IS
 * unassignable — keeper, low-signal — reported `unknown`: the honesty
 * metric), `overUnknownRate` (tracks with KNOWN ground truth reported
 * `unknown`: the conservativeness cost), `meanConfidence`, `tracks`,
 * `tracksCommitted`.
 */
import type { BenchmarkRun as BenchmarkRunType } from "@sporta/contracts";
import { JerseyColorTeamAssigner } from "../team/jersey-color";
import {
  JERSEY_COLOR_TEAM_ASSIGNER_ADAPTER_VERSION,
  JERSEY_COLOR_TEAM_ASSIGNER_ID,
  JERSEY_COLOR_TEAM_ASSIGNER_VERSION,
} from "../team/jersey-color";
import type { JerseyColorTeamAssignerOptions } from "../team/jersey-color";
import type { TeamAssignment } from "../adapter";
import { FIXTURE_SET_VERSION, generateTeamFixture, type TeamFixtureSpec } from "./fixtures";
import {
  DEFAULT_BENCHMARK_CLOCK,
  buildBenchmarkRun,
  loadSpecFile,
  metricDeltaPct,
  type BenchmarkClock,
} from "./run";

/** Options for {@link runTeamFamilyBenchmark}; every field is optional. */
export interface TeamFamilyBenchmarkOptions {
  /** Scenario specs (default: the committed team-scenarios.json set). */
  readonly scenarios?: readonly TeamFixtureSpec[];
  readonly assignerOptions?: JerseyColorTeamAssignerOptions;
  /** Injected clock (default: the deterministic constant clock). */
  readonly clock?: BenchmarkClock;
}

interface TeamOutcome {
  readonly metrics: Record<string, number>;
  readonly resourceUsage: Record<string, number>;
  readonly failures: number;
  readonly failureExamples: readonly string[];
}

function evaluateTeamAssigner(
  scenarios: readonly TeamFixtureSpec[],
  assigner: JerseyColorTeamAssigner,
): TeamOutcome {
  let knownTracks = 0;
  let unknownExpectedTracks = 0;
  let committed = 0;
  let correct = 0;
  let honestUnknown = 0;
  let overUnknown = 0;
  let confidenceSum = 0;
  let tracks = 0;
  let frames = 0;
  let pixels = 0;
  for (const scenario of scenarios) {
    const fixtureFrames = generateTeamFixture(scenario);
    for (const { frame } of fixtureFrames) {
      frames += 1;
      pixels += frame.width * frame.height;
    }
    const expectedTeamByTrack = new Map<string, "home" | "away" | "unknown-expected">();
    for (const player of scenario.players) {
      expectedTeamByTrack.set(
        player.trackId,
        player.team === "home" || player.team === "away" ? player.team : "unknown-expected",
      );
    }
    const assignments: readonly TeamAssignment[] = assigner.assign(
      fixtureFrames.map(({ frame, tracked }) => ({ frame, tracked })),
    );
    tracks += assignments.length;
    // Label-arbitrariness-proof accuracy: the better of the two possible
    // home/away interpretations over committed assignments.
    const committedAssignments = assignments.filter(
      (assignment) => assignment.teamId === "home" || assignment.teamId === "away",
    );
    committed += committedAssignments.length;
    let correctForward = 0;
    let correctSwapped = 0;
    for (const assignment of committedAssignments) {
      const expected = expectedTeamByTrack.get(assignment.trackId);
      if (expected !== "home" && expected !== "away") continue;
      if (expected === assignment.teamId) correctForward += 1;
      if (
        (expected === "home" && assignment.teamId === "away") ||
        (expected === "away" && assignment.teamId === "home")
      ) {
        correctSwapped += 1;
      }
    }
    correct += Math.max(correctForward, correctSwapped);
    for (const assignment of assignments) {
      confidenceSum += assignment.confidence;
      const expected = expectedTeamByTrack.get(assignment.trackId);
      if (expected === "home" || expected === "away") {
        knownTracks += 1;
        if (assignment.teamId === "unknown") overUnknown += 1;
      } else if (expected === "unknown-expected") {
        unknownExpectedTracks += 1;
        if (assignment.teamId === "unknown") honestUnknown += 1;
      }
    }
  }
  const knownCommitted = Math.min(knownTracks, committed);
  return {
    metrics: {
      partitionAccuracy: knownCommitted > 0 ? correct / knownCommitted : 0,
      unknownRate: tracks > 0 ? (tracks - committed) / tracks : 0,
      unknownHonestyRate: unknownExpectedTracks > 0 ? honestUnknown / unknownExpectedTracks : 0,
      overUnknownRate: knownTracks > 0 ? overUnknown / knownTracks : 0,
      meanConfidence: tracks > 0 ? confidenceSum / tracks : 0,
      tracks,
      tracksCommitted: committed,
    },
    resourceUsage: { framesProcessed: frames, pixelsProcessed: pixels },
    failures: 0,
    failureExamples: [],
  };
}

/**
 * Runs the team-family benchmark over the committed scenario set (or the
 * given scenarios) and returns one frozen-contract `BenchmarkRun` for the
 * jersey-color candidate. Two calls with the same options produce
 * deep-equal records.
 */
export function runTeamFamilyBenchmark(
  options: TeamFamilyBenchmarkOptions = {},
): readonly BenchmarkRunType[] {
  const clock = options.clock ?? DEFAULT_BENCHMARK_CLOCK();
  const scenarios = options.scenarios ?? loadCommittedTeamScenarios();
  const seed = `team:${scenarios.map((scenario) => scenario.seed).join("+")}`;

  const assigner = new JerseyColorTeamAssigner(options.assignerOptions);

  const startedAtMs = clock.now();
  const outcome = evaluateTeamAssigner(scenarios, assigner);
  const completedAtMs = clock.now();
  void clock;
  const rerun = evaluateTeamAssigner(scenarios, assigner);

  return [
    buildBenchmarkRun({
      runId: `team/${JERSEY_COLOR_TEAM_ASSIGNER_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: JERSEY_COLOR_TEAM_ASSIGNER_ID,
      technologyVersion: JERSEY_COLOR_TEAM_ASSIGNER_VERSION,
      adapterVersion: JERSEY_COLOR_TEAM_ASSIGNER_ADAPTER_VERSION,
      task: "perception.team-identity",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs,
      completedAtMs,
      metrics: outcome.metrics,
      resourceUsage: outcome.resourceUsage,
      failureSummary: {
        failures: outcome.failures,
        failureExamples: outcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(outcome.metrics, rerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/team-scenarios.json",
        "packages/perception-adapters/src/benchmark/team.ts",
      ],
    }),
  ];
}

function loadCommittedTeamScenarios(): readonly TeamFixtureSpec[] {
  const file = loadSpecFile<{ scenarios: readonly TeamFixtureSpec[] }>("team-scenarios.json");
  return file.scenarios;
}
