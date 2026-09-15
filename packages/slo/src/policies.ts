/**
 * The W802 FAILURE/DEGRADATION POLICY TABLE — the documented mapping from
 * each alert tier to the REAL machinery this repository actually ships
 * (SLOs.md §Degradation playbook mirrors this table; `test/policies.test.ts`
 * pins the mapping's consistency AND that every machinery seam resolves
 * against the real packages — a policy naming machinery that does not exist
 * FAILS THE SUITE, fail-closed).
 *
 * ## The honesty rule of this table
 *
 * Nothing in this codebase watches latency and reconfigures the pipeline by
 * itself: there is no latency-driven control loop. What exists is
 *
 * - **always-on, by construction** (automatic): the bounded queues with
 *   their explicit W104 policies, the W303 bounded-retry/DLQ job protocol,
 *   the W304 never-silent accounting and reorder bound, the W305 typed
 *   no-downgrade rejects — these protect every window whether or not any SLO
 *   is evaluated;
 * - **operator decisions** (never automatic here): enabling the W304
 *   skip-stale degradation, choosing a queue policy, choosing an output
 *   profile / renderer, scaling W303 workers — each is a configuration
 *   change made by a person reacting to the alert evidence.
 *
 * Every {@link DegradationPolicy} row below states which side of that line
 * it is on (`automation`), names the exact package + export that implements
 * the machinery (`machinery`), and what the operator (or the always-on
 * protection) actually does (`action`). No automation is invented; absent
 * machinery is absent (the architecture-lock §8 "measured latency budgets"
 * posture — the SLOs make the budget explicit, humans decide the trade).
 */
import { SloTableInconsistentError } from "./errors";
import { ALERT_CATALOG } from "./alerts";

/** The policy table's identity (echoed by the playbook document). */
export const POLICY_TABLE_ID = "w802-degradation-policies-v1";

/** What it takes to execute the policy in this codebase's current state. */
export type AutomationLevel = "automatic" | "operator-decision";

/** One real, importable seam the policy names (fail-closed pin target). */
export interface MachinerySeam {
  /** The workspace package (must exist and be importable — test-pinned). */
  readonly packageName: string;
  /** The export that implements the seam (must exist at runtime — test-pinned). */
  readonly exportName: string;
  /** What the seam is, in one line (the playbook's per-seam description). */
  readonly seam: string;
}

/** One degradation/failure policy (one playbook entry). */
export interface DegradationPolicy {
  /** Stable machine-readable id, e.g. `"queueing-latency-containment"`. */
  readonly policyId: string;
  /** The alert ids this policy answers (must exist in the catalog — test-pinned). */
  readonly triggers: readonly string[];
  /** The situation the operator is in when the triggers fire. */
  readonly situation: string;
  /** What to do (the documented action). */
  readonly action: string;
  /** Whether executing the policy is automatic or an operator decision (honesty field). */
  readonly automation: AutomationLevel;
  /** The always-on protections already in force for this failure class. */
  readonly automaticProtections: readonly string[];
  /** The real machinery (packages + exports) the policy names — all real, or the suite fails. */
  readonly machinery: readonly MachinerySeam[];
}

export const DEGRADATION_POLICIES: readonly DegradationPolicy[] = [
  {
    policyId: "queueing-latency-containment",
    triggers: [
      "latency.batch.swm-to-batch.warning",
      "latency.batch.swm-to-batch.critical",
      "latency.batch.batch-queue.warning",
      "latency.batch.batch-queue.critical",
      "latency.batch.w303-schedule.warning",
      "latency.batch.w303-schedule.critical",
    ],
    situation:
      "The queueing stages are growing: work waits before rendering (the watermark-grid wait, " +
      "the batch channel sojourn, or the W303 dispatch wait). In the W306 evidence the " +
      "congestion point under these bounds was the W303 ready queue, not the 8-slot batch " +
      "channel — the per-stage verdicts localize which stage is eating the budget.",
    action:
      "Read the per-stage SLO verdicts to localize the stage. If the growth is sustained: " +
      "(a) raise render capacity — more W303 workers / higher per-worker concurrency, or " +
      "(b) trade stale frames for latency by enabling the W304 skip-stale degradation with a " +
      "maxWatermarkLagMs chosen against the end-to-end objective — an explicit config change " +
      "plus redeploy, never a runtime self-tuning. Once enabled, expect the orchestrator's " +
      "batchesSkippedStale* counters to move and the loss.unexpected-frames alert to become " +
      "the trade-off's honest signal (skipped-stale no longer counts as loss under the " +
      "enabled policy — the alert derivation documents exactly this).",
    automation: "operator-decision",
    automaticProtections: [
      "bounded queues everywhere (W302/W104 explicit policies — block parks the producer, " +
        "reject is typed + counted, drop-oldest is reconciled from the channel's own counter)",
      "the W304 never-silent accounting: every skip/drop/refusal is counted, logged, metered",
    ],
    machinery: [
      {
        packageName: "@sporta/render-orchestration",
        exportName: "evaluateStaleSkip",
        seam: "the pure skip-stale decision (measured lag + head evidence; admission + dequeue)",
      },
      {
        packageName: "@sporta/render-orchestration",
        exportName: "RenderOrchestrator",
        seam: "the degradation config seam (options.degradation, default skipStale: disabled)",
      },
      {
        packageName: "@sporta/gpu-worker",
        exportName: "GpuJobDispatcher",
        seam: "the W303 dispatch/lease protocol — the ready-queue + admitted-job bounds",
      },
      {
        packageName: "@sporta/gpu-worker",
        exportName: "DEFAULT_GPU_LIMITS",
        seam: "the dispatcher's default queue/admission bounds (the capacity knobs)",
      },
    ],
  },
  {
    policyId: "render-throughput-containment",
    triggers: [
      "latency.batch.render-execution.warning",
      "latency.batch.render-execution.critical",
    ],
    situation:
      "Render execution is slower than the objective. In the W306 benchmark domain the " +
      "render duration is the AUTHORED model (400 ms/batch, echoed in every report) — growth " +
      "there means the model changed; in a real deployment it means the actual renderer " +
      "slowed. Either way the objective is the gate.",
    action:
      "Classify first: the W303 worker retry policy bounds the damage " +
      "automatically (the shipped default is the frozen no-retries posture — " +
      "maxAttempts 1; a configured retry policy gets bounded deterministic backoff); " +
      "non-retryable failures are NEVER blind-retried; retry-exhausted and " +
      "deadline-timeout land in the dead-letter queue with the ledger asserted. " +
      "If the renderer is simply slow (no failures): shed demand — select a " +
      "cheaper output profile (resolution/frame-rate/codec via the capability-declared " +
      "supportedOutputProfiles) or scale W303 workers. Profile selection is capability/" +
      "rights-driven today (W703); there is NO latency-driven automatic downgrade — that is " +
      "an operator decision, documented as such.",
    automation: "operator-decision",
    automaticProtections: [
      "W303 bounded retry attempts (frozen no-retries default; a configured policy gets " +
        "bounded deterministic backoff) + DLQ classification (non-retryable never " +
        "blind-retried; retry-exhausted → DLQ; per-job deadline → timeout classification)",
      "render failures counted as batchesRenderFailed with the accounting still balancing",
    ],
    machinery: [
      {
        packageName: "@sporta/gpu-worker",
        exportName: "DEFAULT_WORKER_RETRY",
        seam: "the worker retry policy (bounded attempts, deterministic backoff)",
      },
      {
        packageName: "@sporta/gpu-worker",
        exportName: "assertGpuLedgerConsistency",
        seam: "the DLQ ledger identity (deadLettered === dlqRetained + dlqOverflow, asserted)",
      },
      {
        packageName: "@sporta/contracts",
        exportName: "OutputProfile",
        seam: "the output-profile contract (resolution/frameRate/codec/container/latencyClass)",
      },
      {
        packageName: "@sporta/contracts",
        exportName: "OutputLatencyClass",
        seam: "the latency-class vocabulary (offline | near-live | live)",
      },
      {
        packageName: "@sporta/viewer-shell",
        exportName: "deriveRendererOptions",
        seam: "the W703 capability-driven selection plan (the profile-selection surface)",
      },
    ],
  },
  {
    policyId: "emission-and-delivery-containment",
    triggers: [
      "latency.batch.finish-to-emit.warning",
      "latency.batch.finish-to-emit.critical",
      "latency.batch.end-to-end.warning",
      "latency.batch.end-to-end.critical",
      "latency.frame.swm-store-sojourn.warning",
      "latency.frame.swm-store-sojourn.critical",
      "latency.frame.end-to-end.warning",
      "latency.frame.end-to-end.critical",
    ],
    situation:
      "Post-render latency: outputs wait behind the reorder bound (finish-to-emit), or the " +
      "composition (end-to-end, per batch AND per frame) exceeds the objective. The " +
      "per-stage verdicts localize the consuming stage; these alerts are the user-visible " +
      "symptom.",
    action:
      "Triage by the per-stage table first (the end-to-end objective is the composition, " +
      "never a stage in itself). Delivery-side containment is fail-closed, not degrading: a " +
      "viewer endpoint that cannot sustain the offered latency class REJECTS the offer with " +
      "the typed reason unsupported-latency-class (W305) — it never silently serves a " +
      "downgraded stream that would lie about its latency. The viewer-side symptom of " +
      "delivery latency (playing-while-buffering episodes) is observable as W706 rebuffer-" +
      "stall telemetry events — the join point for W804/W805 analytics. Reorder-bound " +
      "growth is a config question (the reorder bound is explicit), an operator decision.",
    automation: "operator-decision",
    automaticProtections: [
      "the W304 reorder bound (bounded reorder, overflow counted — batchesReorderOverflow)",
      "W305 typed no-downgrade rejects (protocol/codec/latency-class mismatches are typed " +
        "rejections, never silent downgrades)",
    ],
    machinery: [
      {
        packageName: "@sporta/render-orchestration",
        exportName: "DEFAULT_RENDER_LIMITS",
        seam: "the orchestrator's default bounds (queue/reorder — the reorder-hold config)",
      },
      {
        packageName: "@sporta/webrtc-output",
        exportName: "answerLiveOutputOffer",
        seam: "the viewer-side offer decision (typed rejects incl. unsupported-latency-class)",
      },
      {
        packageName: "@sporta/webrtc-output",
        exportName: "LiveOutputRejectionReason",
        seam: "the typed reject vocabulary (no-downgrade grammar)",
      },
      {
        packageName: "@sporta/viewer-shell",
        exportName: "TELEMETRY_EVENT_KINDS",
        seam: "the W706 viewer telemetry kinds (rebuffer-stall — where latency is user-visible)",
      },
    ],
  },
  {
    policyId: "frame-loss-triage",
    triggers: ["loss.unexpected-frames"],
    situation:
      "Frames left the pipeline without being emitted: dropped (queue refusal/eviction), " +
      "cancelled (mid-run stop), or skipped-stale while the degradation was disabled. " +
      "Calibrated to the W306 baseline where every one of these counters measured zero — " +
      "any firing is structural, never background noise.",
    action:
      "Read the orchestrator's never-silent counters to localize the loss path " +
      "(batchesQueueRefused, batchesQueueEvicted, batchesReorderOverflow, batchesRenderFailed, " +
      "batchesAbandoned, and the per-phase skip attribution), then decide: queue-policy choice " +
      "is an operator decision per the streaming contract (block parks the producer, reject " +
      "is typed, drop-oldest sheds); render failures already went through the W303 retry/DLQ " +
      "classification — triage the DLQ entries (non-retryable ones were never retried, by " +
      "rule). If the loss came from an enabled skip-stale trade, the alert did not fire for " +
      "those frames — the skip counters are the trade's honest ledger.",
    automation: "operator-decision",
    automaticProtections: [
      "the W302/W104 explicit queue policies on every bounded queue (block/reject/drop-oldest)",
      "the W304 never-silent accounting: in === rendered + skipped + dropped + cancelled + " +
        "duplicate, asserted at settle — a lying or lossy trace is structurally impossible",
      "the W303 DLQ (bounded, ledgered — deadLettered === dlqRetained + dlqOverflow, asserted)",
    ],
    machinery: [
      {
        packageName: "@sporta/processing-queues",
        exportName: "ProcessingPipeline",
        seam: "the bounded-queue pipeline (the explicit policy vocabulary lives on its stages)",
      },
      {
        packageName: "@sporta/processing-queues",
        exportName: "DeadLetterQueue",
        seam: "the stage-side dead-letter queue (bounded, ledgered)",
      },
      {
        packageName: "@sporta/gpu-worker",
        exportName: "assertGpuLedgerConsistency",
        seam: "the W303 ledger identities incl. the DLQ balance (asserted at settle)",
      },
      {
        packageName: "@sporta/render-orchestration",
        exportName: "RenderOrchestrator",
        seam: "the counter surface that localizes the loss path (never-silent stats)",
      },
    ],
  },
];

/** Looks one policy up by id (fail-loud on an unknown id). */
export function policyById(policyId: string): DegradationPolicy {
  const policy = DEGRADATION_POLICIES.find((candidate) => candidate.policyId === policyId);
  if (policy === undefined) {
    throw new SloTableInconsistentError(`no degradation policy named "${policyId}"`);
  }
  return policy;
}

/**
 * Asserts the policy table's structural invariants (pinned by tests; called
 * by nothing at runtime — the table is static): every trigger names a real
 * catalog alert; every critical alert is answered by at least one policy;
 * every policy id is unique.
 */
export function assertPolicyTableInvariants(): void {
  const catalogIds = new Set(ALERT_CATALOG.map((alert) => alert.alertId));
  const seenPolicies = new Set<string>();
  const answeredCriticals = new Set<string>();
  for (const policy of DEGRADATION_POLICIES) {
    if (seenPolicies.has(policy.policyId)) {
      throw new SloTableInconsistentError(`duplicate policyId "${policy.policyId}"`);
    }
    seenPolicies.add(policy.policyId);
    for (const trigger of policy.triggers) {
      if (!catalogIds.has(trigger)) {
        throw new SloTableInconsistentError(
          `policy "${policy.policyId}" triggers unknown alert "${trigger}" — dangling ` +
            "reference (a policy naming machinery or alerts that do not exist is a bug)",
        );
      }
      if (trigger.endsWith(".critical") || trigger === "loss.unexpected-frames") {
        answeredCriticals.add(trigger);
      }
    }
    if (policy.machinery.length === 0) {
      throw new SloTableInconsistentError(
        `policy "${policy.policyId}" names no machinery — an action without a seam is prose`,
      );
    }
  }
  for (const alert of ALERT_CATALOG) {
    if (alert.severity !== "critical") continue;
    if (!answeredCriticals.has(alert.alertId)) {
      throw new SloTableInconsistentError(
        `critical alert "${alert.alertId}" is answered by no policy — every breach tier ` +
          "must map to a documented response",
      );
    }
  }
}
