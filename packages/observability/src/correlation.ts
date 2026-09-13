/**
 * Correlation context: the ids that make one media session traceable across
 * every pipeline stage (W007 §3.2, architecture-lock §12).
 *
 * A {@link CorrelationContext} is exactly the id triple the streaming stage
 * contract carries on every `StageMessage` (`sessionId`, `correlationId`,
 * `traceId` — docs/contracts/streaming.md), so a context can be created at
 * session intake, carried through stage messages, and re-extracted with
 * {@link fromStageMessage} at any stage boundary.
 *
 * The default id factory is a deterministic counter (`corr-<n>`/`trace-<n>`)
 * so tests are reproducible; a real deployment injects uuid-style ids.
 */
import type { StageMessage } from "@sporta/contracts";
import type { Logger } from "./logger";

/** The id triple that ties every record of one session together. */
export interface CorrelationContext {
  /** Media session id (the unit of processing and of tracing). */
  sessionId: string;
  /** Correlation id: ties work to its triggering request. */
  correlationId: string;
  /** Trace id: spans the observable processing chain. */
  traceId: string;
}

/**
 * Injectable id generator: returns the uniqueness part; the `corr-`/`trace-`
 * kind prefixes are applied by {@link createCorrelationContext}. The default
 * is a module-scoped deterministic counter; deployments inject uuids.
 */
export type IdFactory = () => string;

let counter = 0;

function defaultIdFactory(): string {
  counter += 1;
  return String(counter);
}

/**
 * Creates a correlation context for a session. With the default factory the
 * ids are deterministic counter-based values (`corr-<n>`, `trace-<n>`, two
 * consecutive draws); with an injected factory the caller controls the ids
 * exactly.
 */
export function createCorrelationContext(
  sessionId: string,
  idFactory: IdFactory = defaultIdFactory,
): CorrelationContext {
  if (typeof sessionId !== "string" || sessionId.length < 1) {
    throw new RangeError("createCorrelationContext requires a non-empty sessionId");
  }
  return {
    sessionId,
    correlationId: `corr-${idFactory()}`,
    traceId: `trace-${idFactory()}`,
  };
}

/**
 * Extracts the correlation context a `StageMessage` carries across a stage
 * boundary (streaming contract: every stage message carries correlation and
 * trace ids), so the receiving stage continues the same trace.
 */
export function fromStageMessage(msg: StageMessage): CorrelationContext {
  return {
    sessionId: msg.sessionId,
    correlationId: msg.correlationId,
    traceId: msg.traceId,
  };
}

/**
 * Returns a child logger carrying the full context plus the emitting stage on
 * every line — the standard "bind once at stage entry, log freely" pattern.
 */
export function bindLogger(logger: Logger, ctx: CorrelationContext, stage?: string): Logger {
  return logger.child({
    sessionId: ctx.sessionId,
    correlationId: ctx.correlationId,
    traceId: ctx.traceId,
    ...(stage === undefined ? {} : { stage }),
  });
}
