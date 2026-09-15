/**
 * Session negotiation (W305): the offer/answer document dance, the
 * fail-closed rights gate (architecture-lock §11 — live delivery requires
 * `canDeliverLive`, re-derived on the injected clock), and the viewer-side
 * typed decisions. Malformed documents are typed errors; policy mismatches
 * are typed REJECTS (negotiation, not fault) — never a best-effort guess.
 */
import { describe, expect, test } from "bun:test";
import { isLiveOutputError } from "../src/errors";
import { LiveOutputRightsError } from "../src/errors";
import {
  answerLiveOutputOffer,
  assertLiveDeliveryRights,
  buildLiveOutputOffer,
  parseLiveOutputAnswer,
  parseLiveOutputOffer,
  trackFromProfile,
} from "../src/negotiation";
import { LIVE_OUTPUT_PROTOCOL_VERSION } from "../src/types";
import {
  LIVE_PROFILE,
  TEST_EPOCH_MS,
  expiredLiveDeliveryPolicy,
  liveDeliveryPolicy,
  noLiveDeliveryPolicy,
} from "./helpers";

/** Session controls used by the offer fixtures. */
const CONTROLS = {
  backpressurePolicy: "block" as const,
  linkCapacity: 8,
  maxLinkBytes: null,
  maxWatermarkLagMs: null,
  retransmitRetention: 4,
};

describe("assertLiveDeliveryRights (the fail-closed gate)", () => {
  test("a policy with liveDelivery passes", () => {
    expect(() =>
      assertLiveDeliveryRights(liveDeliveryPolicy(), TEST_EPOCH_MS, "live-s"),
    ).not.toThrow();
  });

  test("a policy without liveDelivery throws the typed rights error", () => {
    expect(() => assertLiveDeliveryRights(noLiveDeliveryPolicy(), TEST_EPOCH_MS, "live-s")).toThrow(
      LiveOutputRightsError,
    );
    try {
      assertLiveDeliveryRights(noLiveDeliveryPolicy(), TEST_EPOCH_MS, "live-s");
    } catch (error) {
      expect(isLiveOutputError(error)).toBe(true);
      if (isLiveOutputError(error)) {
        expect(error.details.failureClass).toBe("rights-denied");
        expect(error.details.streamId).toBe("live-s");
      }
    }
  });

  test("an expired policy denies (fail-closed on the injected clock)", () => {
    expect(() =>
      assertLiveDeliveryRights(expiredLiveDeliveryPolicy(TEST_EPOCH_MS), TEST_EPOCH_MS, "live-s"),
    ).toThrow(LiveOutputRightsError);
    // One millisecond before expiry the policy is still valid — the gate is
    // derived, not frozen.
    const policy: import("@sporta/contracts").AuthorizationPolicy = {
      policyId: "policy-edge",
      allowedOperations: ["liveDelivery"],
      assertedBy: "operator",
      expiresAtIso: new Date(TEST_EPOCH_MS + 1).toISOString(),
    };
    expect(() => assertLiveDeliveryRights(policy, TEST_EPOCH_MS, "live-s")).not.toThrow();
  });

  test("a null policy denies everything", () => {
    expect(() => assertLiveDeliveryRights(null, TEST_EPOCH_MS, "live-s")).toThrow(
      LiveOutputRightsError,
    );
  });
});

describe("parseLiveOutputOffer", () => {
  test("a built offer parses", () => {
    const offer = buildLiveOutputOffer({
      sessionId: "sess-live-out",
      streamId: "live-s",
      profile: LIVE_PROFILE,
      sessionControls: CONTROLS,
      offeredAtMs: TEST_EPOCH_MS,
    });
    const parsed = parseLiveOutputOffer(offer);
    expect(parsed.ok).toBe(true);
  });

  test("garbage fails with a reason (never a guess)", () => {
    const parsed = parseLiveOutputOffer({ nonsense: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain("invalid live output offer");
    }
  });

  test("a wrong-typed field fails", () => {
    const parsed = parseLiveOutputOffer("a string is not an offer");
    expect(parsed.ok).toBe(false);
  });
});

describe("parseLiveOutputAnswer", () => {
  test("an accept parses", () => {
    const parsed = parseLiveOutputAnswer({
      kind: "accept",
      protocolVersion: LIVE_OUTPUT_PROTOCOL_VERSION,
      viewerId: "viewer-1",
      acceptedAtMs: TEST_EPOCH_MS,
    });
    expect(parsed.ok).toBe(true);
  });

  test("a reject parses", () => {
    const parsed = parseLiveOutputAnswer({
      kind: "reject",
      reason: "viewer-unavailable",
      rejectedAtMs: TEST_EPOCH_MS,
    });
    expect(parsed.ok).toBe(true);
  });

  test("garbage fails with a reason", () => {
    const parsed = parseLiveOutputAnswer(42);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain("invalid live output answer");
    }
  });
});

describe("trackFromProfile", () => {
  test("the track descriptor carries the profile VERBATIM", () => {
    const track = trackFromProfile(LIVE_PROFILE, "live-s");
    expect(track.kind).toBe("video");
    expect(track.trackId).toBe("track-live-s-video");
    expect(track.profile).toEqual(LIVE_PROFILE);
  });
});

describe("buildLiveOutputOffer", () => {
  test("the offer declares one video track and the session controls", () => {
    const offer = buildLiveOutputOffer({
      sessionId: "sess-live-out",
      streamId: "live-s",
      profile: LIVE_PROFILE,
      sessionControls: CONTROLS,
      offeredAtMs: TEST_EPOCH_MS,
    });
    expect(offer.protocolVersion).toBe(LIVE_OUTPUT_PROTOCOL_VERSION);
    expect(offer.tracks).toHaveLength(1);
    expect(offer.tracks[0]!.kind).toBe("video");
    expect(offer.tracks[0]!.profile).toEqual(LIVE_PROFILE);
    expect(offer.sessionControls).toEqual(CONTROLS);
    expect(offer.offeredAtMs).toBe(TEST_EPOCH_MS);
  });

  test("building an offer with invalid controls throws (never emits garbage)", () => {
    expect(() =>
      buildLiveOutputOffer({
        sessionId: "sess-live-out",
        streamId: "live-s",
        profile: LIVE_PROFILE,
        sessionControls: { ...CONTROLS, linkCapacity: 0 },
        offeredAtMs: TEST_EPOCH_MS,
      }),
    ).toThrow(/invalid offer/);
  });
});

describe("answerLiveOutputOffer (the viewer-side decision)", () => {
  function offer(): unknown {
    return buildLiveOutputOffer({
      sessionId: "sess-live-out",
      streamId: "live-s",
      profile: LIVE_PROFILE,
      sessionControls: CONTROLS,
      offeredAtMs: TEST_EPOCH_MS,
    });
  }

  test("a compatible offer is accepted with the echoed protocol version", () => {
    const answer = answerLiveOutputOffer(offer(), { viewerId: "viewer-7", nowMs: TEST_EPOCH_MS });
    expect(answer).toEqual({
      kind: "accept",
      protocolVersion: LIVE_OUTPUT_PROTOCOL_VERSION,
      viewerId: "viewer-7",
      acceptedAtMs: TEST_EPOCH_MS,
    });
  });

  test("an unsupported protocol version is a typed reject (no downgrade)", () => {
    const answer = answerLiveOutputOffer(offer(), {
      viewerId: "viewer-7",
      nowMs: TEST_EPOCH_MS,
      supportedProtocolVersion: "sporta.live-output/v2",
    });
    expect(answer).toEqual({
      kind: "reject",
      reason: "unsupported-protocol-version",
      rejectedAtMs: TEST_EPOCH_MS,
    });
  });

  test("an offer without a video track is a typed reject", () => {
    const doc = { ...(offer() as Record<string, unknown>), tracks: [] };
    const answer = answerLiveOutputOffer(doc, { viewerId: "viewer-7", nowMs: TEST_EPOCH_MS });
    expect(answer).toMatchObject({ kind: "reject", reason: "no-video-track" });
  });

  test("an unsupported codec is a typed reject", () => {
    const answer = answerLiveOutputOffer(offer(), {
      viewerId: "viewer-7",
      nowMs: TEST_EPOCH_MS,
      supportedCodecs: ["vp9"],
    });
    expect(answer).toMatchObject({ kind: "reject", reason: "unsupported-codec" });
  });

  test("a supported codec is accepted", () => {
    const answer = answerLiveOutputOffer(offer(), {
      viewerId: "viewer-7",
      nowMs: TEST_EPOCH_MS,
      supportedCodecs: ["svg", "vp9"],
    });
    expect(answer).toMatchObject({ kind: "accept" });
  });

  test("an unsupported latency class is a typed reject", () => {
    const answer = answerLiveOutputOffer(offer(), {
      viewerId: "viewer-7",
      nowMs: TEST_EPOCH_MS,
      supportedLatencyClasses: ["offline"],
    });
    expect(answer).toMatchObject({ kind: "reject", reason: "unsupported-latency-class" });
  });

  test("a malformed offer throws the typed protocol error", () => {
    expect(() => answerLiveOutputOffer({ broken: true }, { viewerId: "v", nowMs: 0 })).toThrow(
      /invalid live output offer/,
    );
  });
});
