/**
 * The W306 latency-measurement seams (W305 deliverable): typed, per-window
 * timing records on the injected clock domain, queue-depth observations,
 * and drop counters — the data source the W306 end-to-end latency benchmark
 * consumes. Exposed from both the transport and the viewer session, and
 * carried in the settle result; pinned by test.
 *
 * CLOCK DOMAIN: every timestamp is a reading of the ONE injected
 * `LiveOutputClock` the session was constructed with. Because the interface
 * is structural (`now(): number`), a deployment shares the domain with
 * upstream stages (e.g. the W303 `GpuClock`) by injecting the same instance
 * — the e2e test does exactly this, so emission-to-delivery latencies are
 * comparable with render-stage latencies.
 *
 * WATERMARK-RELATIVE lag is media time (the newest observed watermark minus
 * a window's watermark) and is therefore clock-independent — both surfaces
 * are reported, honestly labeled.
 */
import type { Watermark } from "@sporta/contracts";
import type { LiveWindowDisposition } from "./types";

/**
 * The transport-side timing record for ONE frame window (minted at receipt,
 * mutated at admission/delivery — the settle snapshot is frozen).
 */
export interface LiveWindowTimingRecord {
  windowId: string;
  ordinal: number | null;
  watermark: Watermark;
  /** Protocol-clock reading at `sendWindow` call time. */
  emittedAtMs: number;
  /** Protocol-clock reading at link admission (null when never admitted). */
  admittedAtMs: number | null;
  /** Protocol-clock reading at verified hand-over (null when never delivered). */
  deliveredAtMs: number | null;
  /** Protocol-clock reading at the latest re-delivery (retention replay). */
  redeliveredAtMs: number | null;
  /** Link depth (queued windows) at emission time. */
  linkDepthAtEmission: number;
  /** Measured `deliveredAtMs − admittedAtMs` (link transit latency). */
  transitLagMs: number | null;
  /** Measured `deliveredAtMs − emittedAtMs` (emission→delivery latency). */
  deliveryLagMs: number | null;
  /** Media-time lag at delivery (newest observed watermark − watermark). */
  watermarkLagAtDeliveryMs: number | null;
  /** The window's terminal disposition (the accounting join key). */
  disposition: LiveWindowDisposition;
}

/**
 * The viewer-side arrival record for ONE applied frame window (the viewer
 * session's own telemetry; the surface W704's player consumes).
 */
export interface LiveViewerArrivalRecord {
  windowId: string;
  ordinal: number;
  watermark: Watermark;
  /** Protocol-clock reading when the viewer session surfaced the window. */
  appliedAtMs: number;
  /** Link depth observed at apply (the buffer-depth seam). */
  bufferDepthAtApply: number;
  /** Media-time lag at apply: newest observed watermark − watermark. */
  mediaLagAtApplyMs: number;
  /** Protocol-clock latency-to-latest-watermark: `appliedAtMs − emittedAtMs`. */
  deliveryLatencyMs: number;
}

/** Aggregate lag statistics (max + count; percentiles live on the registry). */
export interface LiveLagSummary {
  count: number;
  maxTransitLagMs: number;
  maxDeliveryLagMs: number;
  maxWatermarkLagAtDeliveryMs: number;
}

/** Summarizes the timing records' measured maxima (pure). */
export function summarizeLag(records: readonly LiveWindowTimingRecord[]): LiveLagSummary {
  let count = 0;
  let maxTransitLagMs = 0;
  let maxDeliveryLagMs = 0;
  let maxWatermarkLagAtDeliveryMs = 0;
  for (const record of records) {
    count += 1;
    maxTransitLagMs = Math.max(maxTransitLagMs, record.transitLagMs ?? 0);
    maxDeliveryLagMs = Math.max(maxDeliveryLagMs, record.deliveryLagMs ?? 0);
    maxWatermarkLagAtDeliveryMs = Math.max(
      maxWatermarkLagAtDeliveryMs,
      record.watermarkLagAtDeliveryMs ?? 0,
    );
  }
  return { count, maxTransitLagMs, maxDeliveryLagMs, maxWatermarkLagAtDeliveryMs };
}
