/**
 * The `resolveTaskProfile` seam (R001) — the runtime resolution of a LOGICAL
 * task profile to a concrete registered technology (technology-plane.md
 * "Configuration": product/domain code refers to logical task profiles,
 * never technology names).
 *
 * Resolution is a PURE function over the current registry profiles, so it is
 * fully deterministic and testable in isolation:
 *
 * 1. Only ACTIVE profiles can resolve (candidate/benchmarked/approved/
 *    canary/production). `deprecated` and `rejected` are terminal lifecycle
 *    exits and never resolve.
 * 2. With NO pins (`prefer`/`fallback` all empty) the highest-status active
 *    profile for the task wins (production > canary > approved >
 *    benchmarked > candidate), tie-broken deterministically by technology
 *    id, then version, then adapter version.
 * 3. With pins, the FIRST resolvable pin wins, `prefer` list before
 *    `fallback` list, in the caller's order. A pin that is malformed,
 *    unknown, task-mismatched, or inactive is recorded as an issue and
 *    skipped — pins never silently resolve to a DIFFERENT technology than
 *    the one requested (fail-closed: the caller pinned deliberately).
 * 4. Pins that all failed while other active profiles exist →
 *    `unresolvable-preference` (the caller's pin is stale, not the task).
 * 5. No active profiles at all → `no-candidate`.
 */
import type { AdapterTaskKind, TechnologyProfile, TechnologyStatus } from "@sporta/contracts";

/** Statuses a resolution may return. Terminal exits never resolve. */
export const ACTIVE_TECHNOLOGY_STATUSES: readonly TechnologyStatus[] = [
  "candidate",
  "benchmarked",
  "approved",
  "canary",
  "production",
];

/** Status preference: higher rank wins (production > ... > candidate). */
export const STATUS_RANK: Readonly<Record<TechnologyStatus, number>> = {
  candidate: 1,
  benchmarked: 2,
  approved: 3,
  canary: 4,
  production: 5,
  deprecated: -1,
  rejected: -1,
};

/** A logical task profile reference, as product code states it. */
export interface TaskProfileRef {
  task: AdapterTaskKind;
  /** Preferred pins, in order: `technologyId@technologyVersion`. */
  prefer?: string[];
  /** Fallback pins, tried only after every preferred pin failed. */
  fallback?: string[];
}

/** One registered profile that resolved the reference. */
export interface ResolvedTaskProfile {
  outcome: "resolved";
  /** The resolved profile (current adapterVersion, effective status). */
  profile: TechnologyProfile;
  /** How it resolved: an explicit pin, or the highest-status default. */
  via: "preference" | "fallback" | "highest-status";
}

/** The task has no active (resolvable) registered profiles at all. */
export interface NoCandidateResolution {
  outcome: "no-candidate";
  task: AdapterTaskKind;
  message: string;
}

/** Pins were given but none could be satisfied (stale or misdeclared pins). */
export interface UnresolvablePreferenceResolution {
  outcome: "unresolvable-preference";
  task: AdapterTaskKind;
  /** Every pin attempted, in order (prefer first, then fallback). */
  attempted: string[];
  /** One issue per attempted pin, in the same order. */
  issues: string[];
  message: string;
}

/** The typed result of {@link resolveTaskProfile}. */
export type TaskProfileResolution =
  ResolvedTaskProfile | NoCandidateResolution | UnresolvablePreferenceResolution;

/** Parse a `technologyId@technologyVersion` pin. */
function parsePin(pin: string): { technologyId: string; technologyVersion: string } | null {
  const at = pin.lastIndexOf("@");
  if (at <= 0 || at === pin.length - 1) return null;
  const technologyId = pin.slice(0, at);
  const technologyVersion = pin.slice(at + 1);
  if (technologyId.length === 0 || technologyVersion.length === 0) return null;
  return { technologyId, technologyVersion };
}

/** Deterministic total order for default resolution ties. */
function compareProfiles(a: TechnologyProfile, b: TechnologyProfile): number {
  return (
    STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
    a.technologyId.localeCompare(b.technologyId) ||
    a.technologyVersion.localeCompare(b.technologyVersion) ||
    a.adapterVersion.localeCompare(b.adapterVersion)
  );
}

/**
 * Resolve a logical task profile against the registry's current profiles
 * (each with its EFFECTIVE status). Pure: no store access, no clock, no
 * randomness.
 */
export function resolveTaskProfileAgainst(
  ref: TaskProfileRef,
  profiles: TechnologyProfile[],
): TaskProfileResolution {
  const active = profiles
    .filter((profile) => profile.task === ref.task)
    .filter((profile) => ACTIVE_TECHNOLOGY_STATUSES.includes(profile.status))
    .sort(compareProfiles);

  if (active.length === 0) {
    return {
      outcome: "no-candidate",
      task: ref.task,
      message: `no active profile registered for task '${ref.task}'`,
    };
  }

  const prefer = ref.prefer ?? [];
  const fallback = ref.fallback ?? [];
  if (prefer.length === 0 && fallback.length === 0) {
    const best = active[0];
    if (best === undefined) {
      return {
        outcome: "no-candidate",
        task: ref.task,
        message: `no active profile registered for task '${ref.task}'`,
      };
    }
    return { outcome: "resolved", profile: best, via: "highest-status" };
  }

  const attempted: string[] = [];
  const issues: string[] = [];
  const tryPins = (pins: string[], via: "preference" | "fallback"): ResolvedTaskProfile | null => {
    for (const pin of pins) {
      attempted.push(pin);
      const parsed = parsePin(pin);
      if (parsed === null) {
        issues.push(`pin '${pin}' is not a valid technologyId@technologyVersion reference`);
        continue;
      }
      const match = active.find(
        (profile) =>
          profile.technologyId === parsed.technologyId &&
          profile.technologyVersion === parsed.technologyVersion,
      );
      if (match === undefined) {
        issues.push(
          `pin '${pin}' does not match an active registered profile for task '${ref.task}'`,
        );
        continue;
      }
      return { outcome: "resolved", profile: match, via };
    }
    return null;
  };

  const viaPreference = tryPins(prefer, "preference");
  if (viaPreference !== null) return viaPreference;
  const viaFallback = tryPins(fallback, "fallback");
  if (viaFallback !== null) return viaFallback;

  return {
    outcome: "unresolvable-preference",
    task: ref.task,
    attempted,
    issues,
    message:
      `none of the ${attempted.length} requested profile pin(s) for task '${ref.task}' ` +
      `could be satisfied (${issues.length} issue(s)); refusing to silently substitute ` +
      `a different technology`,
  };
}
