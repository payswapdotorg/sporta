/**
 * The observability seam of the encoding package (the `@sporta/decoding`
 * `noopObservability` precedent): an OPTIONAL logger/metrics seam, silent
 * by default, one structured line per encode + labeled failure counters
 * when a registry is supplied. Never a wall clock in the report plane —
 * the manifest carries the INJECTED clock only.
 */
import type { Logger, MetricsRegistry } from "@sporta/observability";

/** The observability options every encoding entry point accepts. */
export interface EncodingObservability {
  logger?: Logger;
  metrics?: MetricsRegistry;
}

/** The metric names the encoding plane counts (the decoding vocabulary). */
export const ENCODE_METRIC_NAMES = {
  encodesTotal: "encoding_encodes_total",
  encodeFailuresTotal: "encoding_encode_failures_total",
  /** Incremented BY byteLength — the size-evidence pattern. */
  encodeBytesTotal: "encoding_encode_bytes_total",
  encodeFramesTotal: "encoding_encode_frames_total",
} as const;

/** A silent no-op logger (the default seam — nothing is ever lost, nothing is fabricated). */
const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

/** The default (silent) observability seam. */
export function noopObservability(): Required<EncodingObservability> {
  return { logger: silentLogger, metrics: undefined as unknown as MetricsRegistry };
}

/** One structured encode line (when a logger is supplied). */
export function logEncode(
  observability: EncodingObservability | undefined,
  fields: Record<string, unknown>,
): void {
  observability?.logger?.info("encoding: encode", fields);
}

/** Counts one successful encode (when a registry is supplied). */
export function countEncode(
  observability: EncodingObservability | undefined,
  fields: { encoderKind: string; bridge: string; frameCount: number; byteSize: number },
): void {
  const metrics = observability?.metrics;
  if (metrics === undefined) return;
  metrics
    .counter(ENCODE_METRIC_NAMES.encodesTotal, { encoderKind: fields.encoderKind })
    .inc(1);
  metrics
    .counter(ENCODE_METRIC_NAMES.encodeFramesTotal, { encoderKind: fields.encoderKind })
    .inc(fields.frameCount);
  metrics
    .counter(ENCODE_METRIC_NAMES.encodeBytesTotal, { encoderKind: fields.encoderKind })
    .inc(fields.byteSize);
}

/** Counts one failed encode (when a registry is supplied). */
export function countEncodeFailure(
  observability: EncodingObservability | undefined,
  fields: { encoderKind: string; kind: string },
): void {
  observability?.metrics
    ?.counter(ENCODE_METRIC_NAMES.encodeFailuresTotal, {
      encoderKind: fields.encoderKind,
      kind: fields.kind,
    })
    .inc(1);
}
