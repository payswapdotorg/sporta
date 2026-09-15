/**
 * The compute-adapter accounting assertions (W914 Wave 1) — the never-silent
 * constitution at the adapter layer, in the W303 `assertGpuAccounting`
 * posture: an imbalance THROWS (`RangeError` naming the identity and the full
 * breakdown) instead of letting a lying result through.
 *
 * The identities (see `ComputeAdapterStats` in ./schemas.ts):
 *
 * 1. `jobsDispatched === admitted + duplicates` — every ledger-populating
 *    dispatch either became a job or was a counted idempotent duplicate;
 * 2. `admitted === succeeded + failed + cancelled + deadLettered + inFlight`
 *    — every admitted job lands in EXACTLY ONE terminal bucket, with the
 *    not-yet-terminal jobs as `inFlight` (0 at settle);
 * 3. `inputsManifested === inputsConsumed + inputsUnconsumed + inputsInFlight`
 *    — every manifested input of every admitted job is accounted exactly
 *    once (consumed, unconsumed-with-reason, or still-in-flight; the
 *    never-silent input ledger);
 * 4. `usageRecords === succeeded + failed + cancelled + deadLettered` —
 *    metering totality: exactly one usage record per terminally-disposed job
 *    (a cancelled-never-executed job carries one too, with zero-valued
 *    quantities — never silent).
 *
 * Boundary refusals (malformed dispatches, admission refusals, rights
 * refusals) carry their OWN counters OUTSIDE the identities — the deliberate
 * W303 divergence, restated: they never entered the ledger, so they are not
 * in the terminal identity; the caller learned the refusal loudly and
 * synchronously.
 */
import type { ComputeAdapterStats } from "./schemas";

/** Each identity's label, spelled out for the assertion messages. */
export const COMPUTE_IDENTITY_LABELS = [
  "jobsDispatched === admitted + duplicates",
  "admitted === succeeded + failed + cancelled + deadLettered + inFlight",
  "inputsManifested === inputsConsumed + inputsUnconsumed + inputsInFlight",
  "usageRecords === succeeded + failed + cancelled + deadLettered",
] as const;

/**
 * Asserts every compute-adapter accounting identity (throws `RangeError`
 * with the identity's label and the full stats breakdown on imbalance).
 * Called internally by the in-memory reference at every settle; exported so
 * tests and operators re-verify any snapshot.
 */
export function assertComputeAccounting(stats: ComputeAdapterStats): void {
  const breakdown = JSON.stringify(stats);
  if (stats.jobsDispatched !== stats.admitted + stats.duplicates) {
    throw new RangeError(
      `compute-adapter identity 1 broken: jobsDispatched ${stats.jobsDispatched} != ` +
        `admitted ${stats.admitted} + duplicates ${stats.duplicates} — ${breakdown}`,
    );
  }
  const terminalSum = stats.succeeded + stats.failed + stats.cancelled + stats.deadLettered;
  if (stats.admitted !== terminalSum + stats.inFlight) {
    throw new RangeError(
      `compute-adapter identity 2 broken: admitted ${stats.admitted} != ` +
        `succeeded ${stats.succeeded} + failed ${stats.failed} + cancelled ${stats.cancelled} + ` +
        `deadLettered ${stats.deadLettered} + inFlight ${stats.inFlight} — ${breakdown}`,
    );
  }
  const accountedInputs = stats.inputsConsumed + stats.inputsUnconsumed + stats.inputsInFlight;
  if (stats.inputsManifested !== accountedInputs) {
    throw new RangeError(
      `compute-adapter identity 3 broken: inputsManifested ${stats.inputsManifested} != ` +
        `inputsConsumed ${stats.inputsConsumed} + inputsUnconsumed ${stats.inputsUnconsumed} + ` +
        `inputsInFlight ${stats.inputsInFlight} — ${breakdown}`,
    );
  }
  if (stats.usageRecords !== terminalSum) {
    throw new RangeError(
      `compute-adapter identity 4 broken: usageRecords ${stats.usageRecords} != ` +
        `terminal jobs ${terminalSum} (metering totality) — ${breakdown}`,
    );
  }
}
