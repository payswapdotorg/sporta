/**
 * @sporta/transport — segment transport between pipeline stages (W104).
 *
 * The bounded-backpressure transport layer behind the streaming contract's
 * stage boundary (docs/contracts/streaming.md; architecture-lock §8 bounded
 * buffers / explicit backpressure, §13 bounded resources):
 *
 * - `channel`: `BoundedChannel` — FIFO channel with a message-capacity and
 *   optional byte budget, explicit `block` / `reject` / `drop-oldest`
 *   backpressure policies (drops are counted, logged, and metered — never
 *   silent), orderly close semantics, microtask-only waiting
 * - `retry`: `withRetries` — deterministic retry engine (pure-arithmetic
 *   exponential backoff, injectable clock, non-retryable failures returned
 *   immediately, `degraded` treated as success, the last error never
 *   swallowed)
 * - `runner`: `StageRunner` — receive → retry-wrapped handler → result
 *   message on the output channel, one info log line per message,
 *   `transport_*` metrics, concurrency without output-order guarantees,
 *   orderly shutdown (drain in-flight, then close the output)
 *
 * Acceptance (W104): segments can flow between stages with bounded memory
 * and retry semantics — exercised end-to-end by `test/runner.test.ts`.
 */
export {
  BoundedChannel,
  CHANNEL_DROPPED_METRIC,
  ChannelClosedError,
  ResourceLimitError,
  type BackpressurePolicy,
  type BoundedChannelOptions,
  type ChannelObservability,
  type ResourceLimitDetails,
} from "./channel";
export {
  validateRetryOptions,
  withRetries,
  type RetryClock,
  type RetryOptions,
  type RetryOutcome,
} from "./retry";
export {
  StageRunner,
  TRANSPORT_METRIC_NAMES,
  type StageRunnerObservability,
  type StageSpec,
} from "./runner";
