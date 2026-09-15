/**
 * Protocol documents + the accounting vocabulary (W305): every wire document
 * validates, every malformed document is rejected with a reason, and the
 * never-silent balance assertion throws on EACH imbalance kind (a lying
 * result is impossible by construction — the settle mints only after the
 * assert holds).
 */
import { describe, expect, test } from "bun:test";
import { buildLiveFrameWindow as buildWindow } from "../src/window";
import type { LiveOutputStats } from "../src/types";
import {
  LIVE_OUTPUT_METRIC_NAMES,
  LIVE_OUTPUT_PROTOCOL_VERSION,
  LiveFrameWindow,
  LiveOutputAnswer,
  LiveOutputOffer,
  assertLiveOutputAccounting,
  emptyLiveStats,
} from "../src/types";
import { LIVE_PROFILE, fixtureEmission } from "./helpers";

/** A minimal valid offer document (hand-built wire shape). */
function validOffer(): unknown {
  return {
    protocolVersion: LIVE_OUTPUT_PROTOCOL_VERSION,
    sessionId: "sess-live-out",
    streamId: "live-sess-live-out",
    tracks: [{ trackId: "track-live-sess-live-out-video", kind: "video", profile: LIVE_PROFILE }],
    sessionControls: {
      backpressurePolicy: "block",
      linkCapacity: 8,
      maxLinkBytes: null,
      maxWatermarkLagMs: null,
      retransmitRetention: 4,
    },
    offeredAtMs: 1_736_164_800_000,
  };
}

/** A minimal valid accept-answer document. */
function validAccept(): unknown {
  return {
    kind: "accept",
    protocolVersion: LIVE_OUTPUT_PROTOCOL_VERSION,
    viewerId: "viewer-1",
    acceptedAtMs: 1_736_164_800_010,
  };
}

describe("protocol version", () => {
  test("the version constant is the v1 vocabulary", () => {
    expect(LIVE_OUTPUT_PROTOCOL_VERSION).toBe("sporta.live-output/v1");
  });
});

describe("LiveOutputOffer (zod validation)", () => {
  test("a well-formed offer parses", () => {
    const parsed = LiveOutputOffer.safeParse(validOffer());
    expect(parsed.success).toBe(true);
  });

  test("a wrong protocol version is rejected (no silent downgrade)", () => {
    const doc = { ...(validOffer() as Record<string, unknown>), protocolVersion: "sporta.live-output/v0" };
    expect(LiveOutputOffer.safeParse(doc).success).toBe(false);
  });

  test("an offer with no tracks is rejected", () => {
    const doc = validOffer() as { tracks: unknown };
    doc.tracks = [];
    expect(LiveOutputOffer.safeParse(doc).success).toBe(false);
  });

  test("an offer with a non-video track is rejected (audio is future work)", () => {
    const doc = validOffer() as { tracks: unknown };
    doc.tracks = [{ trackId: "t-audio", kind: "audio", profile: LIVE_PROFILE }];
    expect(LiveOutputOffer.safeParse(doc).success).toBe(false);
  });

  test("zero link capacity is rejected (bounded by construction)", () => {
    const doc = validOffer() as { sessionControls: { linkCapacity: number } };
    doc.sessionControls.linkCapacity = 0;
    expect(LiveOutputOffer.safeParse(doc).success).toBe(false);
  });

  test("a non-positive watermark-lag threshold is rejected", () => {
    const doc = validOffer() as { sessionControls: { maxWatermarkLagMs: number } };
    doc.sessionControls.maxWatermarkLagMs = 0;
    expect(LiveOutputOffer.safeParse(doc).success).toBe(false);
  });
});

describe("LiveOutputAnswer (zod validation)", () => {
  test("a well-formed accept parses with the viewer identity", () => {
    const parsed = LiveOutputAnswer.safeParse(validAccept());
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "accept") {
      expect(parsed.data.viewerId).toBe("viewer-1");
    }
  });

  test("a typed reject parses with a machine reason", () => {
    const parsed = LiveOutputAnswer.safeParse({
      kind: "reject",
      reason: "unsupported-codec",
      rejectedAtMs: 1_736_164_800_020,
    });
    expect(parsed.success).toBe(true);
  });

  test("an unknown rejection reason is rejected", () => {
    const parsed = LiveOutputAnswer.safeParse({
      kind: "reject",
      reason: "just-because",
      rejectedAtMs: 0,
    });
    expect(parsed.success).toBe(false);
  });

  test("an answer of neither kind is rejected", () => {
    expect(LiveOutputAnswer.safeParse({ kind: "maybe" }).success).toBe(false);
  });
});

describe("LiveFrameWindow (zod validation)", () => {
  /** Builds a window via the REAL builder, then mutates it per test. */
  function builtWindow(): Record<string, unknown> {
    const emission = fixtureEmission({ ordinal: 0, watermarkMs: 1_000 });
    const envelope = buildWindow(emission, { streamId: "live-s", ordinal: 0, emittedAtMs: 0 });
    return { ...(envelope.window as unknown as Record<string, unknown>) };
  }

  test("a builder-produced window parses", () => {
    expect(LiveFrameWindow.safeParse(builtWindow()).success).toBe(true);
  });

  test("a content hash that is not 64 lowercase hex digits is rejected", () => {
    const doc = builtWindow();
    doc.contentHash = "ZZZ";
    expect(LiveFrameWindow.safeParse(doc).success).toBe(false);
  });

  test("a window with no frames is rejected", () => {
    const doc = builtWindow();
    doc.frames = [];
    doc.frameCount = 0;
    expect(LiveFrameWindow.safeParse(doc).success).toBe(false);
  });

  test("a negative ordinal is rejected", () => {
    const doc = builtWindow();
    doc.ordinal = -1;
    expect(LiveFrameWindow.safeParse(doc).success).toBe(false);
  });
});

describe("the never-silent balance assertion", () => {
  /** Stats with every roll-up coherent, then mutated per test. */
  function coherent(): LiveOutputStats {
    // 5 in = 2 delivered + 1 admission-skipped + 1 evicted + 1 refused.
    const stats = emptyLiveStats();
    stats.windowsIn = 5;
    stats.receiptsAdmitted = 3;
    stats.receiptsSkippedStale = 1;
    stats.receiptsRefused = 1;
    stats.receiptsDropped = 0;
    stats.receiptsAbandoned = 0;
    stats.refusalsByClass["resource-limit"] = 1;
    stats.windowsDelivered = 2;
    stats.windowsSkippedStaleAtDequeue = 0;
    stats.windowsLinkEvicted = 1;
    stats.windowsFailed = 0;
    stats.windowsAbandonedFromLink = 0;
    stats.windowsInFlight = 0;
    stats.windowsSkippedStale = 1;
    stats.windowsDroppedByPolicy = 1;
    stats.windowsAbandoned = 0;
    return stats;
  }

  test("a coherent ledger passes", () => {
    expect(() => assertLiveOutputAccounting(coherent())).not.toThrow();
  });

  test("a fresh zero ledger passes", () => {
    expect(() => assertLiveOutputAccounting(emptyLiveStats())).not.toThrow();
  });

  test("a receipt imbalance throws", () => {
    const stats = coherent();
    stats.windowsIn = 6;
    expect(() => assertLiveOutputAccounting(stats)).toThrow(/receipt imbalance/);
  });

  test("a refusal-class imbalance throws", () => {
    const stats = coherent();
    stats.refusalsByClass["session-closed"] = 1;
    expect(() => assertLiveOutputAccounting(stats)).toThrow(/refusal-class imbalance/);
  });

  test("an admitted-terminal imbalance throws (delivered + in-flight over-admits)", () => {
    const stats = coherent();
    stats.windowsInFlight = 1;
    expect(() => assertLiveOutputAccounting(stats)).toThrow(/admitted-terminal imbalance/);
  });

  test("a skip roll-up imbalance throws", () => {
    const stats = coherent();
    stats.windowsSkippedStale = 2;
    expect(() => assertLiveOutputAccounting(stats)).toThrow(/skip roll-up imbalance/);
  });

  test("a drop roll-up imbalance throws", () => {
    const stats = coherent();
    stats.windowsDroppedByPolicy = 2;
    expect(() => assertLiveOutputAccounting(stats)).toThrow(/drop roll-up imbalance/);
  });

  test("an abandon roll-up imbalance throws", () => {
    const stats = coherent();
    stats.receiptsAbandoned = 1;
    stats.windowsAbandoned = 0;
    stats.receiptsRefused -= 1;
    stats.refusalsByClass["resource-limit"] = 0;
    // windowsIn must still match the receipts (4 admitted/skipped + 1 abandoned).
    stats.windowsIn = 5;
    expect(() => assertLiveOutputAccounting(stats)).toThrow(/abandon roll-up imbalance/);
  });

  test("the MASTER check is the redundant backstop (a sub-identity fires first)", () => {
    // Algebraically, the master identity is the SUM of the sub-identities:
    // any corruption that breaks the master necessarily breaks a
    // sub-identity first (delivered+inFlight over-admission below is caught
    // by the admitted-terminal check before the master one). The master
    // check stays as defense in depth for roll-ups mutated directly.
    const stats = coherent();
    stats.windowsDelivered = 3;
    stats.windowsInFlight = 1;
    expect(() => assertLiveOutputAccounting(stats)).toThrow(/admitted-terminal imbalance/);
  });
});

describe("metric vocabulary (the W306 data source names)", () => {
  test("every metric name is namespaced and stable", () => {
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsIn).toBe("live_output_windows_in_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsDelivered).toBe("live_output_windows_delivered_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsSkippedStale).toBe("live_output_windows_skipped_stale_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsDroppedByPolicy).toBe("live_output_windows_dropped_by_policy_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsRefused).toBe("live_output_windows_refused_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsAbandoned).toBe("live_output_windows_abandoned_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsFailed).toBe("live_output_windows_failed_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsRedelivered).toBe("live_output_windows_redelivered_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.windowsSkippedAtReconnect).toBe(
      "live_output_windows_skipped_at_reconnect_total",
    );
    expect(LIVE_OUTPUT_METRIC_NAMES.viewerReconnects).toBe("live_output_viewer_reconnects_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.stateTransitions).toBe("live_output_state_transitions_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.sessionEnds).toBe("live_output_session_ends_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.viewerWindowsApplied).toBe("live_output_viewer_windows_applied_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.viewerWindowsDuplicate).toBe("live_output_viewer_windows_duplicate_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.viewerWindowsSkipped).toBe("live_output_viewer_windows_skipped_total");
    expect(LIVE_OUTPUT_METRIC_NAMES.transitLagMs).toBe("live_output_transit_lag_ms");
    expect(LIVE_OUTPUT_METRIC_NAMES.deliveryLagMs).toBe("live_output_delivery_lag_ms");
    expect(LIVE_OUTPUT_METRIC_NAMES.watermarkLagAtDeliveryMs).toBe(
      "live_output_watermark_lag_at_delivery_ms",
    );
    expect(LIVE_OUTPUT_METRIC_NAMES.linkDepth).toBe("live_output_link_depth");
  });
});
