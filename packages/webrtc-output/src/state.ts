/**
 * The live output session phase machine (W305).
 *
 * `negotiating -> established -> (degraded <-> established) -> closed`, with
 * typed failure classes on the terminal transition. Every legal transition
 * is counted, logged, and metered; every ILLEGAL transition throws a typed
 * `LiveOutputProtocolError` (fail-closed state — the machine never ends up
 * in an undefined phase through caller misuse).
 *
 * The `degraded` phase is the honest "this session is losing frame windows
 * by policy" signal: it is entered the first time a window is skipped-stale,
 * evicted by the capacity policy, or lost to a reconnect gap, and it
 * RECOVERS to `established` when a window is subsequently delivered within
 * the skip-stale bound (with the policy disabled, any subsequent delivery
 * recovers — the capacity blip passed). Transitions are deterministic
 * functions of the delivery events, never of wall-clock time.
 */
import { LiveOutputProtocolError } from "./errors";
import type { LiveOutputFailureClass, LiveOutputStats } from "./types";
import { LIVE_OUTPUT_METRIC_NAMES } from "./types";
import type { Logger, MetricsRegistry } from "@sporta/observability";

/** The session phase vocabulary (the protocol state machine). */
export const LIVE_SESSION_PHASES = ["negotiating", "established", "degraded", "closed"] as const;
export type LiveSessionPhase = (typeof LIVE_SESSION_PHASES)[number];

/** Why the session entered the degraded phase (machine reasons). */
export type LiveDegradationReason = "skip-stale" | "link-eviction" | "reconnect-gap";

/** The legal transition table (from-phase -> allowed to-phases). */
const TRANSITIONS: Record<LiveSessionPhase, readonly LiveSessionPhase[]> = {
  negotiating: ["established", "closed"],
  established: ["degraded", "closed"],
  degraded: ["established", "closed"],
  closed: [],
};

/**
 * The phase machine. Owns the current phase, the transition counters, and
 * the fail-loud transition validation; logging/metering are wired by the
 * caller (the transport), every transition is recorded in
 * `stats.stateTransitions`.
 */
export class LiveSessionPhaseMachine {
  private phase: LiveSessionPhase = "negotiating";

  constructor(
    private readonly stats: LiveOutputStats,
    private readonly logger: Logger,
    private readonly metrics: MetricsRegistry | undefined,
    private readonly streamId: string,
  ) {}

  /** The current phase. */
  current(): LiveSessionPhase {
    return this.phase;
  }

  /** `true` once the session has reached its terminal phase. */
  get isClosed(): boolean {
    return this.phase === "closed";
  }

  /**
   * Applies one transition. Throws a typed protocol error on an illegal
   * transition; counts, logs, and meters every legal one.
   */
  transition(to: LiveSessionPhase, context: Record<string, unknown>): void {
    const from = this.phase;
    const allowed = TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new LiveOutputProtocolError(`illegal live output session transition ${from} -> ${to}`, {
        streamId: this.streamId,
        failureClass: "protocol-violation",
        from,
        to,
      });
    }
    this.phase = to;
    const key = `${from}->${to}`;
    this.stats.stateTransitions[key] = (this.stats.stateTransitions[key] ?? 0) + 1;
    this.logger.info("live output session phase transition", {
      streamId: this.streamId,
      from,
      to,
      ...context,
    });
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.stateTransitions, { from, to }).inc();
  }

  /**
   * Terminal transition into `closed`. Once closed, the machine ignores
   * further terminal requests (idempotent — the first terminal transition
   * wins) but still refuses non-terminal ones loudly.
   */
  closeTerminal(failureClass?: LiveOutputFailureClass): void {
    if (this.phase === "closed") return;
    this.transition("closed", failureClass === undefined ? {} : { failureClass });
  }
}
