/**
 * The seeded deterministic football scenario generator (REL-001).
 *
 * THE LAW: same seed ⇒ BYTE-IDENTICAL scenario record — `JSON.stringify`
 * of the record is stable, ids included, because the record is a pure
 * function of (seed, config) with defaults applied BEFORE hashing. No wall
 * clock, no Math.random; the single stochastic decision (which side kicks
 * off) flows from a fork of the master seed.
 *
 * The generator produces the scenario's INITIAL CONDITIONS (formation,
 * kickoff side, ball placement). What happens after kickoff is the World
 * Simulator's job (../simulation/world-simulator) — a scenario is the
 * starting state, not a pre-scripted trajectory.
 */
import { z } from "zod";
import { contentId } from "../hash";
import { LabRng } from "../rng";
import type { ScenarioGenerator, ScenarioRecordBase } from "./domain-pack";
import { FOOTBALL_DOMAIN_PACK_ID, FOOTBALL_DOMAIN_PACK_VERSION } from "./football-ids";

// ---------------------------------------------------------------------------
// Scenario config and record
// ---------------------------------------------------------------------------

export const FootballScenarioConfigSchema = z.object({
  /** Total simulated match duration (both periods), in simulated ms. */
  matchDurationMs: z.number().int().min(10_000).max(3_600_000).default(600_000),
  /** Simulator tick length in simulated ms. */
  tickMs: z.number().int().min(40).max(1_000).default(100),
  /** Squad size per side (v0 lab default: 7-a-side). */
  playersPerSide: z.number().int().min(1).max(11).default(7),
  /** Source quality profile (drives simulator noise/confidence/missingness). */
  sourceProfile: z.enum(["clean", "noisy-broadcast", "degraded"]).default("clean"),
  competitionLabel: z.string().min(1).default("lab-friendly"),
});

export type FootballScenarioConfig = z.infer<typeof FootballScenarioConfigSchema>;

/** A player's deterministic initial condition. */
export interface FootballScenarioPlayer {
  playerId: string;
  team: "home" | "away";
  jersey: number;
  role: "gk" | "df" | "mf" | "fw";
  position: { x: number; y: number };
}

export interface FootballScenarioRecord extends ScenarioRecordBase<FootballScenarioConfig> {
  domainPackId: typeof FOOTBALL_DOMAIN_PACK_ID;
  domainPackVersion: string;
  config: FootballScenarioConfig;
  initialConditions: {
    kickoffTeam: "home" | "away";
    players: readonly FootballScenarioPlayer[];
    ball: { position: { x: number; y: number; z: number } };
    officials: readonly { officialId: string; role: string; position: { x: number; y: number } }[];
    expectedTickCount: number;
  };
}

// ---------------------------------------------------------------------------
// Deterministic formation
// ---------------------------------------------------------------------------

const ROLE_CYCLE: readonly FootballScenarioPlayer["role"][] = ["gk", "df", "mf", "fw"];

function roleForSlot(slot: number): FootballScenarioPlayer["role"] {
  if (slot === 0) return "gk";
  // Spread the outfield slots over df/mf/fw deterministically.
  const outfield = ROLE_CYCLE.slice(1);
  const index = (slot - 1) % outfield.length;
  const role = outfield[index];
  return role ?? "mf";
}

function formationForSide(team: "home" | "away", playersPerSide: number): FootballScenarioPlayer[] {
  const sign = team === "home" ? -1 : 1;
  const players: FootballScenarioPlayer[] = [];
  for (let slot = 0; slot < playersPerSide; slot++) {
    const role = roleForSlot(slot);
    let x: number;
    let y: number;
    if (role === "gk") {
      x = sign * 51.0;
      y = 0;
    } else {
      const depth = slot / Math.max(1, playersPerSide); // 0..1 across the half
      const lane = slot % 3 === 0 ? -1 : slot % 3 === 1 ? 0 : 1;
      x = sign * (8 + 34 * depth);
      y = lane * 18.0;
    }
    players.push({
      playerId: `${team}-${slot + 1}`,
      team,
      jersey: slot + 1,
      role,
      position: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
    });
  }
  return players;
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

function parseConfig(overrides?: Partial<FootballScenarioConfig>): FootballScenarioConfig {
  const parsed = FootballScenarioConfigSchema.safeParse(overrides ?? {});
  if (!parsed.success) {
    throw new RangeError(`football scenario config invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * The football scenario generator: `generate(seed, overrides?)` — SAME SEED
 * ⇒ byte-identical record (the test suite pins this by string equality).
 */
export const footballScenarioGenerator: ScenarioGenerator<
  FootballScenarioRecord,
  FootballScenarioConfig
> = {
  generate(seed: string, overrides?: Partial<FootballScenarioConfig>): FootballScenarioRecord {
    const config = parseConfig(overrides);
    const kickoffTeam = new LabRng(`${seed}::kickoff`).bool() ? "home" : "away";
    const players = [
      ...formationForSide("home", config.playersPerSide),
      ...formationForSide("away", config.playersPerSide),
    ];
    const record: FootballScenarioRecord = {
      scenarioId: "", // content-derived below (config defaults already applied)
      domainPackId: FOOTBALL_DOMAIN_PACK_ID,
      domainPackVersion: FOOTBALL_DOMAIN_PACK_VERSION,
      seed,
      config,
      initialConditions: {
        kickoffTeam,
        players,
        ball: { position: { x: 0, y: 0, z: 0 } },
        officials: [
          { officialId: "official-referee", role: "referee", position: { x: 0, y: 6 } },
          {
            officialId: "official-assistant-1",
            role: "assistant-1",
            position: { x: -30, y: 34.5 },
          },
          {
            officialId: "official-assistant-2",
            role: "assistant-2",
            position: { x: 30, y: -34.5 },
          },
          { officialId: "official-fourth", role: "fourth", position: { x: 0, y: -36 } },
        ],
        expectedTickCount: Math.ceil(config.matchDurationMs / config.tickMs),
      },
    };
    record.scenarioId = contentId({
      generator: "football-scenario/0.1",
      domainPackId: record.domainPackId,
      domainPackVersion: record.domainPackVersion,
      seed,
      config: {
        matchDurationMs: config.matchDurationMs,
        tickMs: config.tickMs,
        playersPerSide: config.playersPerSide,
        sourceProfile: config.sourceProfile,
        competitionLabel: config.competitionLabel,
      },
      kickoffTeam,
    });
    return record;
  },
};

/** Convenience: generate a football scenario in one call. */
export function generateFootballScenario(
  seed: string,
  overrides?: Partial<FootballScenarioConfig>,
): FootballScenarioRecord {
  return footballScenarioGenerator.generate(seed, overrides);
}
