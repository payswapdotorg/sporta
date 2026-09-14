/**
 * The `LiveSource` seam (W301) — the push/pull-agnostic live input boundary.
 *
 * A live source is ANY injectable input that delivers media segments over
 * time, each carrying its OWN upstream timestamps. NO vendor protocol is
 * hard-wired into this package: real-protocol adapters (RTMP/SRT/WebRTC
 * ingest, …) arrive in later work items and implement this interface behind
 * stable seams (architecture-lock §9 vendor neutrality). The seam itself is
 * deliberately consumption-agnostic:
 *
 * - the service PULLS one segment at a time from the async iterable, so the
 *   platform controls pacing and backpressure stays bounded end to end;
 * - an implementation may be natively pull-based (poll a transport) or
 *   push-based (vendor callbacks) — a push implementation adapts by resolving
 *   `next()` from its own delivery queue; whatever buffering that adaptation
 *   needs is the implementation's concern, NOT this boundary's (the bounded
 *   contract of W301 lives on the OUTPUT channel, where the platform owns it).
 *
 * Timestamp contract: segments arrive with upstream timestamps VERBATIM
 * (W102 normalized payload shapes — `presentationMs` on video frames,
 * `startMs` on audio chunks). The ingest service never rewrites them; W103
 * timeline correlation happens downstream, not here.
 *
 * Lifecycle contract (orderly shutdown): `stop()` MUST cause `segments()` to
 * end — after any in-flight delivery — so the consuming service can drain
 * deterministically. `stop()` is idempotent.
 */

import type { LiveSegment } from "./types";

/** Which media kinds a live feed announces (informational, logged at admission). */
export type LiveMediaKind = "video" | "audio";

/**
 * Static description of a live feed, announced by the source before delivery
 * begins. Purely informational: admission decisions never depend on it — the
 * rights gate reads the authorization policy, and payload validity is checked
 * per segment.
 */
export interface LiveSourceDescription {
  /** Human-readable feed label (logs/metrics correlation aid). */
  label: string;
  /** Media kinds the feed announces, in first-appearance order. */
  mediaKinds: readonly LiveMediaKind[];
}

/**
 * A live media input delivering segments over time. Implementations MUST:
 *
 * - deliver each segment's payload VERBATIM (upstream timestamps untouched);
 * - end the `segments()` iterable after `stop()` (post in-flight delivery);
 * - be one-shot: a live feed happens once; replaying means a fresh instance.
 */
export interface LiveSource {
  /** Feed description, read at admission (before delivery begins). */
  readonly description: LiveSourceDescription;
  /**
   * Begins delivery. Yields segments in arrival order until end-of-stream
   * (schedule exhausted, `stop()` requested, or a source-side failure throws).
   * May be called ONCE — live feeds are not replayable; construct a fresh
   * source to replay an authored schedule.
   */
  segments(): AsyncIterable<LiveSegment>;
  /**
   * Requests orderly end-of-stream (idempotent): the iterable ends after the
   * in-flight delivery; no further segments are delivered.
   */
  stop(): void;
}
