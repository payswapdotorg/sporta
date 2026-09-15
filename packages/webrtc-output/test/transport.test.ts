/**
 * `LoopbackLiveOutputTransport` (W305) — the deterministic reference
 * implementation of the live output transport contract: offer/answer
 * establishment behind the fail-closed rights gate, serialized admissions
 * over the W104 bounded link (block / reject / drop-oldest, verbatim),
 * viewer-driven pulls with integrity verification at the delivery boundary,
 * skip-stale degradation (admission AND dequeue) with recovery, the retention
 * ring + reconnect resume, drain/cancel close with the never-silent settle
 * contract, and the W306 telemetry seams — every count exact, every loss
 * accounted, an imbalance fails loud.
 *
 * Harness rules (docs/testing/HARNESS.md): the ONLY clock is the injected
 * `ManualLiveClock` (advanced explicitly to author measured lags); async
 * waiting is microtask draining (`until`/`drainMicrotasks`) — no real timers;
 * every emission is the deterministic `fixtureEmission`.
 */
import { describe, expect, test } from "bun:test";
import type { AuthorizationPolicy } from "@sporta/contracts";
import {
  LiveOutputNegotiationError,
  LiveOutputProfileMismatchError,
  LiveOutputProtocolError,
  LiveOutputRightsError,
} from "../src/errors";
import { LoopbackLiveOutputTransport } from "../src/transport";
import type { LiveDeliveryEvent, LiveWindowSendReceipt } from "../src/types";
import { ManualLiveClock } from "../src/types";
import { summarizeLag } from "../src/telemetry";
import { buildLiveFrameWindow } from "../src/window";
import {
  TEST_EPOCH_MS,
  consumeAll,
  drainMicrotasks,
  fixtureEmission,
  liveDeliveryPolicy,
  mismatchedProfileEmission,
  noLiveDeliveryPolicy,
  wiredLiveOutput,
} from "./helpers";

// ---------------------------------------------------------------------------
// Local helpers (single-event pulls, receipt settling)
// ---------------------------------------------------------------------------

/** Pulls EXACTLY one delivery event, then releases the stream for reuse. */
async function pullOne(
  session: import("../src/viewer").LiveViewerSession,
): Promise<LiveDeliveryEvent> {
  const iterator = session.events();
  const next = await iterator.next();
  await iterator.return?.();
  if (next.done) {
    throw new Error("pullOne: the delivery stream ended before an event arrived");
  }
  return next.value;
}

/** Sends one emission and waits for its receipt (fail-loud on rejection). */
async function send(
  transport: LoopbackLiveOutputTransport,
  ordinal: number,
  watermarkMs: number,
): Promise<LiveWindowSendReceipt> {
  return await transport.sendWindow(fixtureEmission({ ordinal, watermarkMs }));
}

/** A policy that allows live delivery but expires at `expiryMs`. */
function lapsingPolicy(expiryMs: number): AuthorizationPolicy {
  return {
    policyId: "policy-lapsing-live",
    allowedOperations: ["analysis", "liveDelivery"],
    assertedBy: "sporta-test-operator",
    expiresAtIso: new Date(expiryMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Offer minting + the fail-closed rights gate
// ---------------------------------------------------------------------------

describe("createOffer (the fail-closed rights gate)", () => {
  test("a policy without liveDelivery denies: no offer, terminal rights-denied", async () => {
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    const transport = new LoopbackLiveOutputTransport({
      sessionId: "sess-live-out",
      clock,
      outputProfile: (await import("./helpers")).LIVE_PROFILE,
      rightsPolicy: noLiveDeliveryPolicy(),
    });
    expect(() => transport.createOffer()).toThrow(LiveOutputRightsError);
    expect(transport.phase()).toBe("closed");
    const result = await transport.close();
    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("rights-denied");
    // Nothing was ever sent: the ledger is the honest zero.
    expect(result.stats.windowsIn).toBe(0);
    expect(result.balanced).toBe(true);
  });

  test("an expired policy denies on the injected clock (derived, not frozen)", async () => {
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    const transport = new LoopbackLiveOutputTransport({
      sessionId: "sess-live-out",
      clock,
      outputProfile: (await import("./helpers")).LIVE_PROFILE,
      rightsPolicy: lapsingPolicy(TEST_EPOCH_MS - 1),
    });
    expect(() => transport.createOffer()).toThrow(LiveOutputRightsError);
    const result = await transport.close();
    expect(result.failureClass).toBe("rights-denied");
  });

  test("a valid policy mints the offer; an established session refuses to re-mint", async () => {
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    const transport = new LoopbackLiveOutputTransport({
      sessionId: "sess-live-out",
      clock,
      outputProfile: (await import("./helpers")).LIVE_PROFILE,
      rightsPolicy: liveDeliveryPolicy(),
    });
    const offer = transport.createOffer();
    expect(offer.tracks).toHaveLength(1);
    expect(offer.tracks[0]!.kind).toBe("video");
    expect(offer.offeredAtMs).toBe(TEST_EPOCH_MS);
    expect(offer.streamId).toBe("live-sess-live-out");

    // The wired fixture is already ESTABLISHED: createOffer requires the
    // negotiating phase (re-offering is a new session, not a re-mint).
    const wired = wiredLiveOutput({});
    expect(() => wired.transport.createOffer()).toThrow(LiveOutputProtocolError);
  });

  test("a closed session refuses to mint (protocol error)", async () => {
    const wired = wiredLiveOutput({});
    await wired.transport.close({ mode: "cancel" });
    expect(() => wired.transport.createOffer()).toThrow(LiveOutputProtocolError);
  });
});

// ---------------------------------------------------------------------------
// acceptAnswer (establishment)
// ---------------------------------------------------------------------------

describe("acceptAnswer (the establish/reject decision)", () => {
  test("an accept establishes the session (phase + log evidence)", () => {
    const wired = wiredLiveOutput({});
    expect(wired.transport.phase()).toBe("established");
    expect(wired.session.status().phase).toBe("established");
    // A second acceptAnswer is a typed protocol error (phase misuse).
    expect(() =>
      wired.transport.acceptAnswer({
        kind: "accept",
        protocolVersion: "sporta.live-output/v1",
        viewerId: "viewer-1",
        acceptedAtMs: TEST_EPOCH_MS,
      }),
    ).toThrow(LiveOutputProtocolError);
  });

  test("a typed reject answer fails the negotiation terminally", async () => {
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    const transport = new LoopbackLiveOutputTransport({
      sessionId: "sess-live-out",
      clock,
      outputProfile: (await import("./helpers")).LIVE_PROFILE,
      rightsPolicy: liveDeliveryPolicy(),
    });
    // An offer exists (negotiating phase); the viewer answers with a typed
    // reject: the negotiation fails terminally, loudly.
    transport.createOffer();
    expect(() =>
      transport.acceptAnswer({
        kind: "reject",
        reason: "unsupported-codec",
        rejectedAtMs: clock.now(),
      }),
    ).toThrow(LiveOutputNegotiationError);
    const result = await transport.close();
    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("negotiation-failed");
  });

  test("a malformed answer fails terminally with protocol-violation", async () => {
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    const transport = new LoopbackLiveOutputTransport({
      sessionId: "sess-live-out",
      clock,
      outputProfile: (await import("./helpers")).LIVE_PROFILE,
      rightsPolicy: liveDeliveryPolicy(),
    });
    transport.createOffer();
    expect(() => transport.acceptAnswer({ kind: "maybe" })).toThrow(LiveOutputProtocolError);
    const result = await transport.close();
    expect(result.failureClass).toBe("protocol-violation");
  });
});

// ---------------------------------------------------------------------------
// sendWindow + delivery (the happy path — the acceptance core)
// ---------------------------------------------------------------------------

describe("sendWindow → viewer delivery (the happy path)", () => {
  test("three windows flow end-to-end, verbatim, in order, accounted exactly", async () => {
    const wired = wiredLiveOutput({});
    const emissions = [
      fixtureEmission({ ordinal: 0, watermarkMs: 1_000 }),
      fixtureEmission({ ordinal: 1, watermarkMs: 2_000 }),
      fixtureEmission({ ordinal: 2, watermarkMs: 3_000 }),
    ];
    const receipts: LiveWindowSendReceipt[] = [];
    for (const emission of emissions) {
      receipts.push(await wired.transport.sendWindow(emission));
    }
    // Admissions: contiguous ordinals assigned only to admitting windows.
    expect(receipts.map((receipt) => receipt.kind)).toEqual(["admitted", "admitted", "admitted"]);
    expect(receipts.map((receipt) => (receipt.kind === "admitted" ? receipt.ordinal : -1))).toEqual(
      [0, 1, 2],
    );

    const consuming = consumeAll(wired.session);
    const settling = wired.transport.close({ mode: "drain", reason: "stream-complete" });
    const [events, result] = await Promise.all([consuming, settling]);

    // The stream: three windows in ordinal order, then the terminal event.
    expect(events.map((event) => event.kind)).toEqual([
      "window",
      "window",
      "window",
      "session-closed",
    ]);
    for (let i = 0; i < 3; i += 1) {
      const event = events[i]!;
      if (event.kind !== "window") throw new Error("unreachable");
      expect(event.window.ordinal).toBe(i);
      expect(event.redelivered).toBe(false);
      // The payload is the emission's own object, VERBATIM (by reference —
      // never rebuilt, never re-stamped).
      expect(event.payload).toBe(emissions[i]!.output);
      // Presentation timing derives from the payload's OWN timestamps.
      expect(event.window.frames.map((f) => f.presentationTimestampMs)).toEqual(
        emissions[i]!.output.frames.map((f) => f.outputTimestampMs),
      );
    }

    // The settle: completed, balanced, exact counts.
    expect(result.outcome).toBe("completed");
    expect(result.balanced).toBe(true);
    expect(result.stats.windowsIn).toBe(3);
    expect(result.stats.windowsDelivered).toBe(3);
    expect(result.stats.windowsInFlight).toBe(0);
    expect(result.stats.windowsSkippedStale).toBe(0);
    expect(result.stats.windowsDroppedByPolicy).toBe(0);
    expect(result.stats.windowsAbandoned).toBe(0);
    expect(result.stats.windowsFailed).toBe(0);
    expect(result.stats.framesDelivered).toBe(6);
    expect(result.stats.bytesDelivered).toBeGreaterThan(0);

    // The consumer-side never-silent identity.
    const status = wired.session.status();
    expect(status.appliedWindows).toBe(3);
    expect(status.skippedWindows).toBe(0);
    expect(status.accountedOrdinals).toBe(3);
    expect(status.lastAppliedOrdinal).toBe(2);
    expect(status.terminal?.outcome).toBe("completed");

    // Applied windows carry the W304 emission provenance field-for-field.
    const applied = wired.session.applied();
    expect(applied[0]!.window.provenance.batchId).toBe("batch-0");
    expect(applied[0]!.window.provenance.jobId).toBe("render-job-sess-live-out-0");
    expect(applied[0]!.window.provenance.rendererId).toBe("anime.prototype");
    expect(applied[0]!.window.watermark).toEqual(emissions[0]!.provenance.sourceWatermark);
  });

  test("transit and delivery lags are measured on the injected clock", async () => {
    const wired = wiredLiveOutput({});
    const emission = fixtureEmission({ ordinal: 0, watermarkMs: 1_000 });
    const receipt = await wired.transport.sendWindow(emission);
    // Time passes between admission and the viewer's pull — the transport
    // MEASURES it (no wall clock anywhere).
    wired.clock.advance(120);
    const event = await pullOne(wired.session);
    if (event.kind !== "window") throw new Error(`expected a window, got ${event.kind}`);
    expect(receipt.kind).toBe("admitted");
    expect(event.timing.transitLagMs).toBe(120);
    expect(event.timing.deliveryLagMs).toBe(120);
    expect(event.timing.watermarkLagAtDeliveryMs).toBe(0);
    // The telemetry records agree with the delivery event.
    const timing = wired.transport.telemetry()[0]!;
    expect(timing.disposition).toBe("delivered");
    expect(timing.transitLagMs).toBe(120);
    expect(timing.deliveryLagMs).toBe(120);
    const arrival = wired.session.telemetry()[0]!;
    expect(arrival.deliveryLatencyMs).toBe(120);
    // The stats maxima roll up the same measurements.
    const stats = wired.transport.stats();
    expect(stats.maxTransitLagMs).toBe(120);
    expect(stats.maxDeliveryLagMs).toBe(120);
    expect(summarizeLag(wired.transport.telemetry())).toEqual({
      count: 1,
      maxTransitLagMs: 120,
      maxDeliveryLagMs: 120,
      maxWatermarkLagAtDeliveryMs: 0,
    });
  });

  test("the live-status surface reports measured latencies and buffer depth", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 2_000);
    wired.clock.advance(40);
    await pullOne(wired.session); // window 0
    wired.clock.advance(60);
    await pullOne(wired.session); // window 1
    const status = wired.session.status();
    expect(status.appliedWindows).toBe(2);
    expect(status.bufferDepth).toBe(0);
    // latencyToLatestWindowMs: now − the LATEST applied window's emission.
    const latest = wired.session.applied()[1]!;
    expect(status.latencyToLatestWindowMs).toBe(wired.clock.now() - latest.window.emittedAtMs);
    // mediaLagMs: newest observed watermark − the latest applied watermark.
    expect(status.mediaLagMs).toBe(0);
    expect(status.latestObservedWatermark).toEqual({ watermarkMs: 2_000, sequence: 11 });
  });
});

// ---------------------------------------------------------------------------
// State misuse, malformed emissions, profile mismatch (fail-closed at the door)
// ---------------------------------------------------------------------------

describe("fail-closed at the door (misuse, malformed, mismatched)", () => {
  test("sendWindow before establishment throws typed; never enters the ledger", async () => {
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    const transport = new LoopbackLiveOutputTransport({
      sessionId: "sess-live-out",
      clock,
      outputProfile: (await import("./helpers")).LIVE_PROFILE,
      rightsPolicy: liveDeliveryPolicy(),
    });
    await expect(
      transport.sendWindow(fixtureEmission({ ordinal: 0, watermarkMs: 1_000 })),
    ).rejects.toBeInstanceOf(LiveOutputProtocolError);
    expect(transport.stats().windowsRejectedInvalid).toBe(1);
    expect(transport.stats().windowsIn).toBe(0);
  });

  test("a malformed emission throws typed and is counted windowsRejectedInvalid", async () => {
    const wired = wiredLiveOutput({});
    const broken = fixtureEmission({ ordinal: 0, watermarkMs: 1_000 });
    (broken.output as { frames: unknown[] }).frames = [];
    await expect(wired.transport.sendWindow(broken)).rejects.toBeInstanceOf(
      LiveOutputProtocolError,
    );
    expect(wired.transport.stats().windowsRejectedInvalid).toBe(1);
    expect(wired.transport.stats().windowsIn).toBe(0);
  });

  test("a profile mismatch is a terminal negotiation-violation (renegotiation required)", async () => {
    const wired = wiredLiveOutput({});
    await expect(
      wired.transport.sendWindow(mismatchedProfileEmission(0, 1_000)),
    ).rejects.toBeInstanceOf(LiveOutputProfileMismatchError);
    expect(wired.transport.stats().windowsRejectedInvalid).toBe(1);
    const result = await wired.transport.close();
    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("negotiation-violation");
    // A send after the terminal failure is a typed refusal (never a throw).
    const refused = await send(wired.transport, 1, 2_000);
    expect(refused).toMatchObject({ kind: "refused", refusalClass: "session-closed" });
    expect(wired.transport.stats().refusalsByClass["session-closed"]).toBe(1);
  });

  test("a mid-stream rights lapse terminates the session LOUD (rights-lapsed)", async () => {
    const wired = wiredLiveOutput({
      rightsPolicy: lapsingPolicy(TEST_EPOCH_MS + 5_000),
    });
    // Valid at the offer gate and at the first send.
    const first = await send(wired.transport, 0, 1_000);
    expect(first.kind).toBe("admitted");
    // The policy expires; the next send re-derives fail-closed.
    wired.clock.advance(6_000);
    const second = await send(wired.transport, 1, 7_000);
    expect(second).toMatchObject({ kind: "refused", refusalClass: "rights" });
    const result = await wired.transport.close();
    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("rights-lapsed");
    // The in-link window was abandoned, accounted, never silently lost.
    expect(result.stats.windowsIn).toBe(2);
    expect(result.stats.receiptsAdmitted).toBe(1);
    expect(result.stats.windowsAbandonedFromLink).toBe(1);
    expect(result.stats.windowsAbandoned).toBe(1);
    expect(result.stats.windowsInFlight).toBe(0);
  });

  test("a session-limit exhaustion refuses with the typed session-limit class", async () => {
    const wired = wiredLiveOutput({ limits: { maxWindowsInSession: 1 } });
    const first = await send(wired.transport, 0, 1_000);
    expect(first.kind).toBe("admitted");
    const second = await send(wired.transport, 1, 2_000);
    expect(second).toMatchObject({ kind: "refused", refusalClass: "session-limit" });
    expect(wired.transport.stats().refusalsByClass["session-limit"]).toBe(1);
    const result = await wired.transport.close({ mode: "cancel" });
    expect(result.stats.windowsIn).toBe(2);
    expect(result.balanced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Backpressure policies (the W104 link, verbatim)
// ---------------------------------------------------------------------------

describe("backpressure policies", () => {
  test("reject: a full link refuses the send with the typed resource limit", async () => {
    const wired = wiredLiveOutput({ backpressure: "reject", limits: { linkCapacity: 1 } });
    const first = await send(wired.transport, 0, 1_000);
    expect(first.kind).toBe("admitted");
    const second = await send(wired.transport, 1, 2_000);
    expect(second).toMatchObject({ kind: "refused", refusalClass: "resource-limit" });
    if (second.kind === "refused") {
      expect(second.details.policy).toBe("reject");
      expect(second.details.capacity).toBe(1);
      expect(second.details.attemptedBytes).toBeGreaterThan(0);
    }
    const stats = wired.transport.stats();
    expect(stats.windowsIn).toBe(2);
    expect(stats.receiptsAdmitted).toBe(1);
    expect(stats.receiptsRefused).toBe(1);
    expect(stats.refusalsByClass["resource-limit"]).toBe(1);
  });

  test("block: a full link parks the send; the viewer pull unparks it (natural backpressure)", async () => {
    const wired = wiredLiveOutput({ backpressure: "block", limits: { linkCapacity: 1 } });
    const first = await send(wired.transport, 0, 1_000);
    expect(first.kind).toBe("admitted");

    // The second send parks (the chain is blocked on link space).
    let settled = false;
    const parked = wired.transport
      .sendWindow(fixtureEmission({ ordinal: 1, watermarkMs: 2_000 }))
      .then((receipt) => {
        settled = true;
        return receipt;
      });
    await drainMicrotasks(50);
    expect(settled).toBe(false);

    // Time passes while parked; the pull frees space and the parked send
    // admits at the POST-PARK clock reading (the receipt's contract).
    wired.clock.advance(80);
    const window0 = await pullOne(wired.session);
    expect(window0.kind).toBe("window");
    const receipt = await parked;
    expect(settled).toBe(true);
    expect(receipt.kind).toBe("admitted");
    if (receipt.kind === "admitted") {
      expect(receipt.ordinal).toBe(1);
      expect(receipt.admittedAtMs).toBe(TEST_EPOCH_MS + 80);
    }
    const window1 = await pullOne(wired.session);
    expect(window1.kind).toBe("window");
    const result = await wired.transport.close({ mode: "drain", reason: "stream-complete" });
    expect(result.stats.windowsDelivered).toBe(2);
    expect(result.balanced).toBe(true);
  });

  test("drop-oldest: the oldest window is evicted, attributed, and recovered from", async () => {
    const wired = wiredLiveOutput({ backpressure: "drop-oldest", limits: { linkCapacity: 1 } });
    const first = await send(wired.transport, 0, 1_000);
    expect(first.kind).toBe("admitted");
    const second = await send(wired.transport, 1, 2_000);
    expect(second.kind).toBe("admitted");

    // The cross-boundary identity: link evictions === the channel's own drops.
    expect(wired.transport.stats().windowsLinkEvicted).toBe(1);
    expect(wired.transport.linkDropped()).toBe(1);

    const consuming = consumeAll(wired.session);
    const settling = wired.transport.close({ mode: "drain", reason: "stream-complete" });
    const [events, result] = await Promise.all([consuming, settling]);
    // The stream accounts ordinal 0 INLINE (never a silent skip), then the
    // surviving window.
    expect(events.map((event) => event.kind)).toEqual([
      "window-skipped",
      "window",
      "session-closed",
    ]);
    const skip = events[0]!;
    if (skip.kind !== "window-skipped") throw new Error("unreachable");
    expect(skip).toMatchObject({ ordinal: 0, reason: "link-evicted" });
    expect(skip.watermark).toEqual({ watermarkMs: 1_000, sequence: 1 });

    const stats = result.stats;
    expect(stats.windowsIn).toBe(2);
    expect(stats.receiptsAdmitted).toBe(2);
    expect(stats.windowsLinkEvicted).toBe(1);
    expect(stats.windowsDroppedByPolicy).toBe(1);
    expect(stats.windowsDelivered).toBe(1);
    expect(stats.windowsInFlight).toBe(0);
    // Degradation happened and RECOVERED (the policy-disabled catch-up
    // rule); the drain close then settles into `closed`.
    expect(stats.stateTransitions).toEqual({
      "negotiating->established": 1,
      "established->degraded": 1,
      "degraded->established": 1,
      "established->closed": 1,
    });
    // The viewer accounted the eviction (the consumer identity holds).
    const status = wired.session.status();
    expect(status.appliedWindows).toBe(1);
    expect(status.skippedWindows).toBe(1);
    expect(status.accountedOrdinals).toBe(2);
  });

  test("a window that can never fit the byte budget: refused under reject, dropped under drop-oldest", async () => {
    // The fixture window's byte size (the evidence for the budget assertions).
    const probe = buildLiveFrameWindow(fixtureEmission({ ordinal: 0, watermarkMs: 1_000 }), {
      streamId: "live-sess-live-out",
      ordinal: 0,
      emittedAtMs: TEST_EPOCH_MS,
    });
    expect(probe.window.byteSize).toBeGreaterThan(50);

    const refusedWired = wiredLiveOutput({
      backpressure: "reject",
      limits: { maxLinkBytes: 50 },
    });
    const refused = await send(refusedWired.transport, 0, 1_000);
    expect(refused).toMatchObject({ kind: "refused", refusalClass: "resource-limit" });
    if (refused.kind === "refused") {
      expect(refused.details.maxBytes).toBe(50);
      expect(refused.details.attemptedBytes).toBe(probe.window.byteSize);
    }

    const droppedWired = wiredLiveOutput({
      backpressure: "drop-oldest",
      limits: { maxLinkBytes: 50 },
    });
    const dropped = await send(droppedWired.transport, 0, 1_000);
    expect(dropped).toMatchObject({ kind: "dropped", reason: "exceeds-byte-budget" });
    const stats = droppedWired.transport.stats();
    expect(stats.windowsDroppedByPolicy).toBe(1);
    expect(stats.receiptsDropped).toBe(1);
    expect(droppedWired.transport.phase()).toBe("degraded");
    const result = await droppedWired.transport.close();
    expect(result.balanced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Skip-stale degradation (admission + dequeue) and recovery
// ---------------------------------------------------------------------------

describe("skip-stale degradation", () => {
  test("an admission-time skip measures the lag and preserves the original watermark", async () => {
    const wired = wiredLiveOutput({ limits: { maxWatermarkLagMs: 1_500 } });
    await send(wired.transport, 0, 1_000);
    await pullOne(wired.session); // delivered (head 1000, lag 0)
    await send(wired.transport, 1, 5_000);
    await pullOne(wired.session); // delivered (head 5000, lag 0)

    // A window whose watermark trails the head by 3000ms: skipped AT THE
    // DOOR — never admitted, never assigned an ordinal.
    const stale = await send(wired.transport, 2, 2_000);
    expect(stale).toMatchObject({ kind: "skipped-stale" });
    if (stale.kind === "skipped-stale") {
      expect(stale.lagMs).toBe(3_000);
      expect(stale.head).toEqual({ watermarkMs: 5_000, sequence: 11 });
    }
    expect(wired.transport.phase()).toBe("degraded");

    // A fresh window catches up: the session RECOVERS to established.
    const fresh = await send(wired.transport, 3, 6_500);
    expect(fresh.kind).toBe("admitted");
    if (fresh.kind === "admitted") {
      expect(fresh.ordinal).toBe(2); // the skip never consumed an ordinal
    }
    const window = await pullOne(wired.session);
    expect(window.kind).toBe("window");
    expect(wired.transport.phase()).toBe("established");

    const result = await wired.transport.close({ mode: "drain", reason: "stream-complete" });
    expect(result.stats.windowsIn).toBe(4);
    expect(result.stats.receiptsAdmitted).toBe(3);
    expect(result.stats.receiptsSkippedStale).toBe(1);
    expect(result.stats.windowsSkippedStale).toBe(1);
    expect(result.stats.windowsDelivered).toBe(3);
    expect(result.stats.windowsSkippedStaleAtDequeue).toBe(0);
  });

  test("a dequeue-time skip accounts the stale windows INLINE with measured lag", async () => {
    const wired = wiredLiveOutput({ limits: { maxWatermarkLagMs: 1_500 } });
    // No pulls while the sends advance the head: windows 0 and 1 go stale in
    // the link; their fate is decided at DEQUEUE (measured, original
    // watermarks preserved).
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 5_000);
    await send(wired.transport, 2, 8_000);

    const skip0 = await pullOne(wired.session);
    expect(skip0).toMatchObject({ kind: "window-skipped", ordinal: 0, reason: "skipped-stale" });
    if (skip0.kind === "window-skipped") {
      expect(skip0.lagMs).toBe(7_000);
      expect(skip0.watermark).toEqual({ watermarkMs: 1_000, sequence: 1 });
    }
    const skip1 = await pullOne(wired.session);
    expect(skip1).toMatchObject({ kind: "window-skipped", ordinal: 1, reason: "skipped-stale" });
    if (skip1.kind === "window-skipped") {
      expect(skip1.lagMs).toBe(3_000);
    }
    const window2 = await pullOne(wired.session);
    expect(window2.kind).toBe("window");

    const result = await wired.transport.close({ mode: "drain", reason: "stream-complete" });
    const stats = result.stats;
    expect(stats.receiptsSkippedStale).toBe(0);
    expect(stats.windowsSkippedStaleAtDequeue).toBe(2);
    expect(stats.windowsSkippedStale).toBe(2);
    expect(stats.windowsDelivered).toBe(1);
    expect(stats.windowsInFlight).toBe(0);
    // Degraded at the first dequeue skip, recovered by the fresh delivery,
    // closed by the drain settle.
    expect(stats.stateTransitions).toEqual({
      "negotiating->established": 1,
      "established->degraded": 1,
      "degraded->established": 1,
      "established->closed": 1,
    });
    // The viewer saw every admitted ordinal exactly once (2 skips + 1 window).
    const status = wired.session.status();
    expect(status.appliedWindows).toBe(1);
    expect(status.skippedWindows).toBe(2);
    expect(status.accountedOrdinals).toBe(3);
  });

  test("a disabled policy (null) never skips, however large the lag", async () => {
    const wired = wiredLiveOutput({ limits: { maxWatermarkLagMs: null } });
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 60_000);
    const receipt = await send(wired.transport, 2, 2_000);
    expect(receipt.kind).toBe("admitted");
    const consuming = consumeAll(wired.session);
    const settling = wired.transport.close({ mode: "drain", reason: "stream-complete" });
    const [events, result] = await Promise.all([consuming, settling]);
    expect(events.filter((event) => event.kind === "window")).toHaveLength(3);
    expect(result.stats.windowsSkippedStale).toBe(0);
    // Never degraded: the only transitions are the establish and the close.
    expect(result.stats.stateTransitions).toEqual({
      "negotiating->established": 1,
      "established->closed": 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Reconnect, retention, and resume
// ---------------------------------------------------------------------------

describe("reconnect + the retention ring", () => {
  async function deliveredThree(): Promise<ReturnType<typeof wiredLiveOutput>> {
    const wired = wiredLiveOutput({ limits: { retransmitRetention: 2 } });
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 2_000);
    await send(wired.transport, 2, 3_000);
    const consuming = consumeAll(wired.session);
    const settling = wired.transport.close({ mode: "drain", reason: "stream-complete" });
    await Promise.all([consuming, settling]);
    return wired;
  }

  test("retention is bounded; the oldest delivered window is evicted (counted)", async () => {
    const wired = await deliveredThree();
    const stats = wired.transport.stats();
    expect(stats.retentionEvictions).toBe(1);
    expect(stats.windowsRedelivered).toBe(0);
  });

  test("a resume inside retention replays the retained windows as counted duplicates", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 2_000);
    await pullOne(wired.session);
    await pullOne(wired.session);

    wired.session.disconnect();
    const disconnectEvent = await pullOne(wired.session);
    expect(disconnectEvent.kind).toBe("connection-lost");
    expect(wired.session.status().connected).toBe(false);

    const report = wired.session.reconnect(1);
    expect(report).toEqual({ resumeFromOrdinal: 1, replayCount: 1, gapSkipped: 0 });
    expect(wired.session.status().connected).toBe(true);

    // The replayed window is idempotent: a counted duplicate, never re-applied.
    const replay = await pullOne(wired.session);
    expect(replay).toMatchObject({ kind: "window", redelivered: true });
    const status = wired.session.status();
    expect(status.appliedWindows).toBe(2);
    expect(status.duplicateWindows).toBe(1);
    expect(status.accountedOrdinals).toBe(2);
    expect(wired.transport.stats().windowsRedelivered).toBe(1);
  });

  test("a resume older than retention announces the gap BEFORE any replay", async () => {
    const wired = wiredLiveOutput({ limits: { retransmitRetention: 1 } });
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 2_000);
    await pullOne(wired.session); // window 0 applied; retention [0]
    await pullOne(wired.session); // window 1 applied; retention [1]

    wired.session.disconnect();
    const lost = await pullOne(wired.session);
    expect(lost.kind).toBe("connection-lost");

    // Resume from 0: retention holds only [1] — the gap announcement comes
    // FIRST, before the viewer sees any replayed window.
    const report = wired.session.reconnect(0);
    expect(report).toEqual({ resumeFromOrdinal: 0, replayCount: 1, gapSkipped: 1 });
    const first = await pullOne(wired.session);
    expect(first).toMatchObject({
      kind: "reconnect-gap",
      fromOrdinal: 0,
      toOrdinal: 1,
      skippedCount: 1,
    });
    const second = await pullOne(wired.session);
    expect(second).toMatchObject({ kind: "window", redelivered: true });
    if (second.kind === "window") {
      expect(second.window.ordinal).toBe(1);
    }
    // Ordinal 0 was already APPLIED — the gap never double-counts it.
    const status = wired.session.status();
    expect(status.appliedWindows).toBe(2);
    expect(status.skippedWindows).toBe(0);
    expect(status.duplicateWindows).toBe(1);
    expect(status.accountedOrdinals).toBe(2);
  });

  test("a resume older than retention surfaces a counted reconnect-gap", async () => {
    const wired = wiredLiveOutput({ limits: { retransmitRetention: 1 } });
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 2_000);
    await send(wired.transport, 2, 3_000);
    await pullOne(wired.session); // window 0 applied; retention [0] → [1] bound 1
    await pullOne(wired.session); // window 1 applied; retention [1]
    await pullOne(wired.session); // window 2 applied; retention [2]

    wired.session.disconnect();
    await pullOne(wired.session); // connection-lost

    // Resume from 1: retention holds only [2] — ordinals [1, 2) are a GAP.
    const report = wired.session.reconnect(1);
    expect(report).toEqual({ resumeFromOrdinal: 1, replayCount: 1, gapSkipped: 1 });
    expect(wired.transport.stats().windowsSkippedAtReconnect).toBe(1);

    const gap = await pullOne(wired.session);
    expect(gap).toMatchObject({
      kind: "reconnect-gap",
      fromOrdinal: 1,
      toOrdinal: 2,
      skippedCount: 1,
    });
    // Ordinal 1 was already APPLIED before the disconnect: the gap accounts
    // it as seen (never a double count at the consumer).
    const status = wired.session.status();
    expect(status.skippedWindows).toBe(0);
    expect(status.appliedWindows).toBe(3);
    expect(status.accountedOrdinals).toBe(3);
    // The replayed window 2 is a counted duplicate.
    const replay = await pullOne(wired.session);
    expect(replay).toMatchObject({ kind: "window", redelivered: true });
    expect(wired.session.status().duplicateWindows).toBe(1);
  });

  test("a resume point ahead of delivery is a typed protocol violation", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    await pullOne(wired.session);
    wired.session.disconnect();
    await pullOne(wired.session);
    expect(() => wired.session.reconnect(5)).toThrow(LiveOutputProtocolError);
  });
});

// ---------------------------------------------------------------------------
// Close modes + the settle contract
// ---------------------------------------------------------------------------

describe("close (drain / cancel / the settle contract)", () => {
  test("cancel abandons every in-link window with exact accounting", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    await send(wired.transport, 1, 2_000);
    await send(wired.transport, 2, 3_000);

    const result = await wired.transport.close({ mode: "cancel" });
    expect(result.outcome).toBe("stopped");
    expect(result.balanced).toBe(true);
    const stats = result.stats;
    expect(stats.windowsIn).toBe(3);
    expect(stats.receiptsAdmitted).toBe(3);
    expect(stats.windowsAbandonedFromLink).toBe(3);
    expect(stats.windowsAbandoned).toBe(3);
    expect(stats.windowsDelivered).toBe(0);
    expect(stats.windowsInFlight).toBe(0);
    expect(stats.framesDropped).toBe(6);
    expect(stats.bytesDropped).toBeGreaterThan(0);

    // The viewer learns the session ended (one terminal event, nothing else).
    const events = await consumeAll(wired.session);
    expect(events).toEqual([{ kind: "session-closed", outcome: "stopped" }]);
  });

  test("close is idempotent: the second call returns the same settled result", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    const consuming = consumeAll(wired.session);
    const first = await wired.transport.close({ mode: "drain", reason: "stream-complete" });
    await consuming;
    const second = await wired.transport.close();
    expect(second).toEqual(first);
  });

  test("PIN: a terminal failure while a send is parked under block — the settle INCLUDES the parked receipt", async () => {
    // The settle contract ("never a receipt after the result is minted"):
    // a send parked under `block` when the session fails terminally is
    // rejected by the channel close and resolves as an ACCOUNTED abandoned
    // receipt; close() must await it before minting, or the result would
    // undercount the session (a stale snapshot, not the final truth).
    const wired = wiredLiveOutput({ backpressure: "block", limits: { linkCapacity: 1 } });
    const first = await send(wired.transport, 0, 1_000);
    expect(first.kind).toBe("admitted");

    let parkedSettled = false;
    const parked = wired.transport
      .sendWindow(fixtureEmission({ ordinal: 1, watermarkMs: 2_000 }))
      .then((receipt) => {
        parkedSettled = true;
        return receipt;
      });
    await drainMicrotasks(50);
    expect(parkedSettled).toBe(false);

    // The operator revokes the rights mid-stream: terminal, loud. close() is
    // called in the SAME synchronous block — the parked send's closed-under
    // receipt is still a queued microtask, and the settle MUST await it
    // before minting (the race the "never a receipt after the mint" rule
    // exists for).
    wired.transport.revokeDeliveryRights("operator revoked the policy");
    const settling = wired.transport.close();
    const parkedReceipt = await parked;
    expect(parkedReceipt).toMatchObject({ kind: "abandoned", reason: "closed-under" });
    const result = await settling;
    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("rights-lapsed");
    // BOTH sends are in the settled ledger: the in-link abandonment AND the
    // parked send's closed-under receipt.
    expect(result.stats.windowsIn).toBe(2);
    expect(result.stats.receiptsAdmitted).toBe(1);
    expect(result.stats.receiptsAbandoned).toBe(1);
    expect(result.stats.windowsAbandoned).toBe(2);
    expect(result.stats.windowsAbandonedFromLink).toBe(1);
    expect(result.stats.windowsInFlight).toBe(0);
    // The minted result IS the final truth — the live ledger agrees exactly.
    expect(wired.transport.stats()).toEqual(result.stats);
  });

  test("a drain close with a disconnected viewer parks forever (the documented posture)", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    wired.session.disconnect();
    let settled = false;
    void wired.transport
      .close({ mode: "drain" })
      .then((result) => {
        settled = true;
        return result;
      })
      .catch(() => {
        settled = true;
      });
    await drainMicrotasks(300);
    // Nothing can settle it: the viewer is gone and the link still holds the
    // window. The documented posture: call `cancel` instead.
    expect(settled).toBe(false);
  });

  test("reportTransportFailure settles the session terminally (the host seam)", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    wired.transport.reportTransportFailure("the underlying socket died");
    const result = await wired.transport.close();
    expect(result.outcome).toBe("failed");
    expect(result.failureClass).toBe("transport-failed");
    expect(result.stats.windowsAbandonedFromLink).toBe(1);
    expect(result.balanced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Telemetry + the observability wiring
// ---------------------------------------------------------------------------

describe("telemetry + logs (the observability surface)", () => {
  test("every receipt mints a timing record; dispositions track the lifecycle", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    wired.clock.advance(30);
    await send(wired.transport, 1, 2_000);
    const consuming = consumeAll(wired.session);
    const settling = wired.transport.close({ mode: "drain", reason: "stream-complete" });
    await Promise.all([consuming, settling]);

    const records = wired.transport.telemetry();
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.disposition).toBe("delivered");
      expect(record.admittedAtMs).not.toBeNull();
      expect(record.deliveredAtMs).not.toBeNull();
      expect(record.transitLagMs).toBe(record.deliveredAtMs! - record.admittedAtMs!);
      expect(record.deliveryLagMs).toBe(record.deliveredAtMs! - record.emittedAtMs);
    }
    // The second send was emitted after the clock advanced: its emission
    // timestamp is the honest later reading.
    expect(records[1]!.emittedAtMs).toBe(TEST_EPOCH_MS + 30);

    // Every log line is structured JSON with the stream identity (the W007
    // posture) — spot-check the delivery line.
    const deliveredLine = wired.obs.lines().find((line) => line.includes("window delivered"));
    expect(deliveredLine).toBeDefined();
    const parsed = JSON.parse(deliveredLine!) as { fields?: Record<string, unknown> };
    expect(parsed.fields?.streamId).toBe("live-sess-live-out");
    expect(parsed.fields?.ordinal).toBe(0);
  });

  test("the metrics registry carries the W306 metric vocabulary", async () => {
    const wired = wiredLiveOutput({});
    await send(wired.transport, 0, 1_000);
    const consuming = consumeAll(wired.session);
    const settling = wired.transport.close({ mode: "drain", reason: "stream-complete" });
    await Promise.all([consuming, settling]);
    const snapshot = wired.obs.metrics.snapshot();
    const names = new Set(snapshot.counters.map((counter) => counter.name));
    expect(names.has("live_output_windows_in_total")).toBe(true);
    expect(names.has("live_output_windows_delivered_total")).toBe(true);
    expect(names.has("live_output_session_ends_total")).toBe(true);
    expect(names.has("live_output_state_transitions_total")).toBe(true);
    const histograms = new Set(snapshot.histograms.map((histogram) => histogram.name));
    expect(histograms.has("live_output_transit_lag_ms")).toBe(true);
    expect(histograms.has("live_output_delivery_lag_ms")).toBe(true);
  });
});
