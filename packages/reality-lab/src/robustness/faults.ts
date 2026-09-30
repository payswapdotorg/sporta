/**
 * Deterministic fault injection (REL-003) — the seeded fault-schedule
 * builder over the domain pack's fault profiles (§3 "scenario/fault
 * generators").
 *
 * THE LAW: a fault schedule is a pure function of (seed, tickCount,
 * profile) — same inputs ⇒ byte-identical schedule, entries included. The
 * schedule is a TYPED, REPLAYABLE artifact: it embeds the seed, the profile
 * id and every drawn entry (kind, tick, duration, params), is embedded
 * verbatim into the lab run record, and re-injecting it into the simulator
 * reproduces the same faulty trajectory tick for tick.
 *
 * Fault kinds (the §4 simulator list): compute/provider failure, source
 * disagreement, occlusion, processing latency, dropped frames.
 */
import { contentId } from "../hash";
import { LabRng } from "../rng";
import type { FaultKind, FaultParams, FaultProfile } from "../domain/domain-pack";

/** One injected fault occurrence. */
export interface FaultScheduleEntry {
  tickIndex: number;
  faultKind: FaultKind;
  durationTicks: number;
  params: FaultParams;
}

/** A deterministic-from-seed fault schedule (a replayable lab artifact). */
export interface FaultSchedule {
  scheduleId: string;
  seed: string;
  tickCount: number;
  profileId: string;
  /** Sorted by (tickIndex, faultKind) — the order is part of the record. */
  entries: readonly FaultScheduleEntry[];
}

/** All fault kinds, in canonical order (drives draw order and sort order). */
export const FAULT_KINDS: readonly FaultKind[] = [
  "compute-provider-failure",
  "source-disagreement",
  "occlusion",
  "processing-latency",
  "dropped-frames",
];

const DEFAULT_PARAMS: Record<FaultKind, Required<FaultParams>> = {
  "compute-provider-failure": {
    latencyMs: 0,
    disagreementMeters: 0,
    occlusionRadiusM: 0,
    durationTicks: 3,
    dropRateBoost: 0,
  },
  "source-disagreement": {
    latencyMs: 0,
    disagreementMeters: 0.6,
    occlusionRadiusM: 0,
    durationTicks: 5,
    dropRateBoost: 0,
  },
  occlusion: {
    latencyMs: 0,
    disagreementMeters: 0,
    occlusionRadiusM: 3,
    durationTicks: 5,
    dropRateBoost: 0,
  },
  "processing-latency": {
    latencyMs: 250,
    disagreementMeters: 0,
    occlusionRadiusM: 0,
    durationTicks: 4,
    dropRateBoost: 0,
  },
  "dropped-frames": {
    latencyMs: 0,
    disagreementMeters: 0,
    occlusionRadiusM: 0,
    durationTicks: 4,
    dropRateBoost: 0.25,
  },
};

function resolveParams(
  profile: FaultProfile,
  kind: FaultKind,
): { durationTicks: number; params: FaultParams } {
  const declared = profile.params[kind] ?? {};
  const defaults = DEFAULT_PARAMS[kind];
  const durationTicks = declared.durationTicks ?? defaults.durationTicks;
  const params: FaultParams = {
    latencyMs: declared.latencyMs ?? (defaults.latencyMs > 0 ? defaults.latencyMs : undefined),
    disagreementMeters:
      declared.disagreementMeters ??
      (defaults.disagreementMeters > 0 ? defaults.disagreementMeters : undefined),
    occlusionRadiusM:
      declared.occlusionRadiusM ??
      (defaults.occlusionRadiusM > 0 ? defaults.occlusionRadiusM : undefined),
    dropRateBoost:
      declared.dropRateBoost ?? (defaults.dropRateBoost > 0 ? defaults.dropRateBoost : undefined),
    durationTicks,
  };
  return { durationTicks, params };
}

/**
 * Build the deterministic fault schedule for (seed, tickCount, profile):
 * per tick, each fault kind draws once from its own forked stream; a hit
 * starts a fault lasting `durationTicks` (no overlapping draws of the same
 * kind).
 */
export function generateFaultSchedule(options: {
  seed: string;
  tickCount: number;
  profile: FaultProfile;
}): FaultSchedule {
  const { seed, tickCount, profile } = options;
  const entries: FaultScheduleEntry[] = [];
  const streams = new Map<FaultKind, LabRng>(
    FAULT_KINDS.map((kind) => [kind, new LabRng(`${seed}::fault:${kind}`)] as const),
  );
  const blockedUntil = new Map<FaultKind, number>(FAULT_KINDS.map((kind) => [kind, -1] as const));
  for (let tick = 0; tick < tickCount; tick++) {
    for (const kind of FAULT_KINDS) {
      const rate = profile.rates[kind] ?? 0;
      if (rate <= 0) continue;
      if ((blockedUntil.get(kind) ?? -1) >= tick) continue;
      const stream = streams.get(kind);
      if (!stream) continue;
      if (stream.next() < rate) {
        const { durationTicks, params } = resolveParams(profile, kind);
        entries.push({ tickIndex: tick, faultKind: kind, durationTicks, params });
        blockedUntil.set(kind, tick + durationTicks);
      }
    }
  }
  entries.sort(
    (a, b) =>
      a.tickIndex - b.tickIndex ||
      FAULT_KINDS.indexOf(a.faultKind) - FAULT_KINDS.indexOf(b.faultKind),
  );
  const schedule: FaultSchedule = {
    scheduleId: "",
    seed,
    tickCount,
    profileId: profile.profileId,
    entries,
  };
  schedule.scheduleId = contentId({
    kind: "fault-schedule/0.1",
    seed,
    tickCount,
    profileId: profile.profileId,
    entries,
  });
  return schedule;
}

/** The faults ACTIVE at `tick` (started at or before, not yet expired). */
export function activeFaultsAt(
  schedule: FaultSchedule,
  tick: number,
): readonly FaultScheduleEntry[] {
  return schedule.entries.filter(
    (entry) => entry.tickIndex <= tick && tick < entry.tickIndex + entry.durationTicks,
  );
}

/** True when a fault of `kind` is active at `tick`. */
export function hasActiveFault(
  schedule: FaultSchedule | undefined,
  tick: number,
  kind: FaultKind,
): boolean {
  if (!schedule) return false;
  return activeFaultsAt(schedule, tick).some((entry) => entry.faultKind === kind);
}
