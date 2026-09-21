/**
 * THE MULTI-SOURCE FUSION POLICY (L012 design D5) — the DETERMINISTIC
 * arbitration/tie/fallback configuration. Pure DATA + fail-loud validation
 * (no clock, no env, no RNG — the determinism constitution).
 *
 * The frozen live-reality §7 rule: "Provider precedence is
 * policy/configuration, not hidden renderer logic." This module IS that
 * policy as data: the precedence order, the conflict tolerance basis, the
 * co-observation comparability window. (Source LOSS is not a policy member:
 * it is the L004 engine's own STALLED latch — the fusion layer CONSUMES the
 * per-source state transitions verbatim, never re-detects them.) The
 * engine's arbitration NEVER consults anything else — the same policy +
 * the same inputs always yield the same decisions (pinned by tests).
 */
import { DEFAULT_LIVE_REORDER_WINDOW_MS } from "@sporta/live-swm";

/** The default position tolerance for window-comparable rows (meters). */
export const DEFAULT_CONFLICT_TOLERANCE_M = 1.0;

/**
 * The default maximum plausible speed for entities on FOOT (players,
 * referees — m/s): the tolerance basis for rows `t` ms apart — two rows must
 * be closer than `toleranceM + basis·t/1000` to be agreement. 12 m/s covers
 * the fastest football sprint with margin; a faster-than-plausible
 * displacement between window-comparable rows is DISAGREEMENT, never
 * silently smoothed (D3).
 */
export const DEFAULT_MAX_SPEED_MPS = 12;

/**
 * The default maximum plausible speed for the BALL (m/s): a struck football
 * legitimately flies at 25-35 m/s — using the foot basis for ball rows
 * would flag every fast ball movement as a cross-source conflict (a real
 * false-positive family found while testing against the L002 scripted ball
 * at ~28 m/s). 35 m/s covers the fastest recorded shots with margin.
 */
export const DEFAULT_BALL_MAX_SPEED_MPS = 35;

/**
 * The fusion policy (all DATA — validated by {@link parseFusionPolicy}).
 *
 * THE TWO ORDERS (documented, both deterministic):
 *
 * - the SURVIVOR order (which row the engine keeps on a same-time
 *   conflicting tie) is the CANONICAL REPLAY ORDER — `(sourceId,
 *   sequence)` — pinned by the frozen §8 live-to-replay equality (see the
 *   engine module docs); it is NOT configurable (a precedence override is
 *   a contract-change request);
 * - the PREFERENCE order (`sourcePrecedence` below) is the operator's
 *   documented source preference — REPORTED on every arbitration decision
 *   and carried in the fallback reporting; it never overrides the survivor.
 */
export interface LiveFusionPolicy {
  /**
   * The ordered source PREFERENCE (the frozen §7 "provider precedence is
   * policy/configuration" rule, as data): highest first. REPORTED on every
   * arbitration decision (the preferred source + whether it matches the
   * canonical survivor) and carried in the fallback reporting — it NEVER
   * overrides the canonical survivor (the frozen §8 equality pins the
   * engine's tied-row state; an override is a contract-change request).
   * Sources absent from the list are unpreferred (rank after every listed
   * source).
   */
  sourcePrecedence: readonly string[];
  /** The position tolerance basis in meters (default 1.0). */
  conflictToleranceM: number;
  /** The maximum plausible speed basis for entities on foot, in m/s (default 12). */
  maxSpeedMps: number;
  /** The maximum plausible speed basis for BALL rows, in m/s (default 35). */
  ballMaxSpeedMps: number;
  /**
   * The co-observation comparability window in ms (default: the L004
   * reorder window 250 — rows farther apart are sequential updates, not
   * comparable evidence; the batch `detectSlotConflicts` window rule
   * mirrored).
   */
  conflictWindowMs: number;
}

/** A malformed fusion policy (fail-loud, never a silent default patch). */
export class FusionPolicyValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`live fusion policy refused the input: ${issues.join("; ")}`);
    this.name = "FusionPolicyValidationError";
  }
}

/** The default policy (no configured precedence — everything ties to the lexicographic rule). */
export function defaultFusionPolicy(): LiveFusionPolicy {
  return {
    sourcePrecedence: [],
    conflictToleranceM: DEFAULT_CONFLICT_TOLERANCE_M,
    maxSpeedMps: DEFAULT_MAX_SPEED_MPS,
    ballMaxSpeedMps: DEFAULT_BALL_MAX_SPEED_MPS,
    conflictWindowMs: DEFAULT_LIVE_REORDER_WINDOW_MS,
  };
}

function isFinitePositive(value: unknown, name: string, issues: string[]): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    issues.push(`${name} must be a finite number > 0`);
    return false;
  }
  return true;
}

/**
 * Validates and normalizes a partial policy onto the defaults. Fail-loud on
 * malformed members (a bad policy NEVER silently becomes the default).
 */
export function parseFusionPolicy(policy: Partial<LiveFusionPolicy> | undefined): LiveFusionPolicy {
  const merged: LiveFusionPolicy = { ...defaultFusionPolicy(), ...policy };
  const issues: string[] = [];
  if (!Array.isArray(merged.sourcePrecedence)) {
    issues.push("sourcePrecedence must be an array of source id strings");
  } else {
    const seen = new Set<string>();
    for (const id of merged.sourcePrecedence) {
      if (typeof id !== "string" || id.length === 0) {
        issues.push("sourcePrecedence entries must be non-empty strings");
        break;
      }
      if (seen.has(id)) {
        issues.push(
          `sourcePrecedence lists "${id}" more than once (precedence must be a strict order)`,
        );
        break;
      }
      seen.add(id);
    }
  }
  isFinitePositive(merged.conflictToleranceM, "conflictToleranceM", issues);
  isFinitePositive(merged.maxSpeedMps, "maxSpeedMps", issues);
  isFinitePositive(merged.ballMaxSpeedMps, "ballMaxSpeedMps", issues);
  isFinitePositive(merged.conflictWindowMs, "conflictWindowMs", issues);
  if (issues.length > 0) throw new FusionPolicyValidationError(issues);
  return merged;
}

/**
 * The preference rank of one source: its index in the configured precedence
 * (lower = more preferred), `+precedence.length` when unlisted. Used for
 * the REPORTED preference on arbitration decisions and the fallback
 * reporting — never for the survivor (see the interface docs).
 */
export function precedenceRankOf(
  policy: LiveFusionPolicy,
  sourceId: string,
): { rank: number; tiebreak: string } {
  const index = policy.sourcePrecedence.indexOf(sourceId);
  return { rank: index === -1 ? policy.sourcePrecedence.length : index, tiebreak: sourceId };
}

/**
 * Whether `a` is MORE PREFERRED than `b` (the preference order — total,
 * antisymmetric for distinct ids). Reporting/fallback only; the arbitration
 * survivor follows the canonical replay order (see the interface docs).
 */
export function arbitratesOver(policy: LiveFusionPolicy, a: string, b: string): boolean {
  if (a === b) return false;
  const ra = precedenceRankOf(policy, a);
  const rb = precedenceRankOf(policy, b);
  return ra.rank < rb.rank || (ra.rank === rb.rank && ra.tiebreak < rb.tiebreak);
}
