/**
 * `FixtureLiveSource` (W301) — THE supported live input for the acceptance
 * criterion: a deterministic, replayable simulated live feed.
 *
 * A fixture feed is a pre-authored SCHEDULE: one entry per delivery, each
 * carrying the arrival time in injected-clock milliseconds plus the segment
 * itself (payloads reuse the W102 fixture-adapter segment shapes —
 * `NormalizedVideoFrame` / `NormalizedAudioChunk`, upstream timestamps
 * authored verbatim). Delivery timing is VIRTUAL: the source awaits the
 * shared {@link ./clock!LiveClock} until each entry's arrival time, so the
 * consuming service measures arrivals that equal the authored schedule —
 * deterministic, no wall clock, no real waiting, deep-equal on every replay.
 *
 * Honesty boundary: this fixture path is what W301 claims as "supported live
 * input". Real network protocols (RTMP/SRT/WebRTC ingest, …) are NOT claimed
 * here — they arrive in later work items as additional `LiveSource`
 * implementations behind the same seam.
 *
 * Fixture semantics (test-pinned):
 *
 * - entries deliver in schedule order; arrival times must be finite,
 *   non-negative, and NON-DECREASING (a live wire is monotone in arrival);
 * - a duplicate delivery is authored by repeating a segment id in the
 *   schedule — the wire log IS the schedule;
 * - payload-level validation is deliberately NOT done here (the service owns
 *   that; malformed payloads are how the fail-loud path is exercised);
 * - `stop()` ends the iterable after the in-flight delivery (idempotent);
 * - `segments()` is one-shot: a live feed happens once. Replaying the same
 *   authored schedule = constructing a fresh instance from the same spec.
 */
import type { LiveClock } from "./clock";
import { InvalidLiveSessionStateError } from "./errors";
import type { LiveMediaKind, LiveSource, LiveSourceDescription } from "./source";
import type { LiveSegment } from "./types";

/** One authored delivery: arrival time + the segment that arrives. */
export interface FixtureDelivery {
  /** Arrival time on the injected clock (finite, >= 0, non-decreasing). */
  arrivalMs: number;
  /** The delivered segment (upstream id + W102 payload, timestamps verbatim). */
  segment: LiveSegment;
}

/** A deterministic live-feed specification: label + ordered wire log. */
export interface FixtureLiveFeedSpec {
  /** Feed label (used in the source description and admission logs). */
  label: string;
  /** Deliveries in arrival order; repeated segment ids author duplicates. */
  schedule: ReadonlyArray<FixtureDelivery>;
}

/**
 * The deterministic live feed. Construct with the spec and the SHARED
 * injected clock (the same instance the ingest service measures arrivals
 * with, so measured arrivals equal authored arrivals).
 */
export class FixtureLiveSource implements LiveSource {
  readonly description: LiveSourceDescription;

  private readonly schedule: ReadonlyArray<FixtureDelivery>;
  private readonly clock: LiveClock;
  private opened = false;
  private stopped = false;

  constructor(spec: FixtureLiveFeedSpec, clock: LiveClock) {
    if (typeof spec.label !== "string" || spec.label.length < 1) {
      throw new RangeError(`FixtureLiveFeedSpec.label must be a non-empty string`);
    }
    if (!Array.isArray(spec.schedule)) {
      throw new TypeError("FixtureLiveFeedSpec.schedule must be an array of deliveries");
    }
    let previousArrival = -Infinity;
    for (const [index, entry] of spec.schedule.entries()) {
      if (entry === null || typeof entry !== "object") {
        throw new TypeError(`fixture schedule entry ${index} must be an object`);
      }
      if (!Number.isFinite(entry.arrivalMs) || entry.arrivalMs < 0) {
        throw new RangeError(
          `fixture schedule entry ${index} needs a finite, non-negative arrivalMs ` +
            `(got ${String(entry.arrivalMs)})`,
        );
      }
      if (entry.arrivalMs < previousArrival) {
        throw new RangeError(
          `fixture arrival times must be non-decreasing: entry ${index} arrives at ` +
            `${entry.arrivalMs} after ${previousArrival}`,
        );
      }
      previousArrival = entry.arrivalMs;
      const segment = entry.segment;
      if (segment === null || typeof segment !== "object") {
        throw new TypeError(`fixture schedule entry ${index} must carry a segment object`);
      }
      if (typeof segment.segmentId !== "string" || segment.segmentId.length < 1) {
        throw new RangeError(
          `fixture schedule entry ${index} needs a segment with a non-empty string segmentId`,
        );
      }
      if (segment.kind !== "video" && segment.kind !== "audio") {
        throw new RangeError(
          `fixture schedule entry ${index} segment kind must be "video" or "audio" ` +
            `(got ${String(segment.kind)})`,
        );
      }
    }
    this.schedule = spec.schedule.map((entry) => ({
      arrivalMs: entry.arrivalMs,
      segment: entry.segment,
    }));
    this.clock = clock;
    this.description = {
      label: spec.label,
      mediaKinds: mediaKindsOf(this.schedule),
    };
  }

  /**
   * Begins delivery (ONE-SHOT — a live feed is not replayable; a second call
   * throws). Yields each scheduled segment after the shared clock reaches its
   * authored arrival time; ends when the schedule is exhausted or `stop()` is
   * requested (after the in-flight delivery).
   */
  segments(): AsyncIterable<LiveSegment> {
    if (this.opened) {
      throw new InvalidLiveSessionStateError(
        "FixtureLiveSource is a one-shot live feed: construct a fresh instance " +
          "from the same spec to replay the schedule",
      );
    }
    this.opened = true;
    return this.deliver();
  }

  /** Idempotent orderly end-of-stream: no further deliveries. */
  stop(): void {
    this.stopped = true;
  }

  private async *deliver(): AsyncGenerator<LiveSegment> {
    for (const entry of this.schedule) {
      if (this.stopped) return;
      await this.clock.wait(entry.arrivalMs);
      if (this.stopped) return;
      yield entry.segment;
    }
  }
}

/** Announced media kinds in first-appearance order. */
function mediaKindsOf(schedule: ReadonlyArray<FixtureDelivery>): LiveMediaKind[] {
  const kinds: LiveMediaKind[] = [];
  for (const entry of schedule) {
    if (!kinds.includes(entry.segment.kind)) kinds.push(entry.segment.kind);
  }
  return kinds;
}
