/**
 * Live client tests (W704): the in-process adapter over the REAL W305
 * `LoopbackLiveOutputTransport` — the full open dance (offer → exact-key +
 * answer-side grammar validation → answer → attach), the typed failure map
 * for every W305 class (verbatim evidence in `details.liveFailureClass`),
 * the fail-closed rights path (a policy without `liveDelivery` throws before
 * any offer exists), and the exact-key rejects for unknown fields at every
 * level of the v1 offer grammar (unknown fields are REJECTS, never silent
 * zod strips).
 */
import { describe, expect, test } from "bun:test";
import {
  LiveOutputError,
  LiveOutputIntegrityError,
  LiveOutputNegotiationError,
  LiveOutputProfileMismatchError,
  LiveOutputProtocolError,
  LiveOutputRightsError,
} from "@sporta/webrtc-output";
import type { LiveOutputFailureClass, LoopbackLiveOutputTransport } from "@sporta/webrtc-output";
import { ViewerControlError, isViewerControlError } from "../src/errors.ts";
import type { ViewerFailureClass } from "../src/errors.ts";
import { LIVE_FAILURE_CLASS_MAP } from "../src/live-ports.ts";
import { checkOfferExactKeys, createInProcessLiveClient, mapLiveError } from "../src/live-client.ts";
import { LIVE_PROFILE, makeLiveTransport, noLiveDeliveryPolicy } from "./live-helpers.ts";

/** A fresh client over a fresh REAL transport (the per-open lifetime rule). */
function freshClient(sessionId: string, policy?: Parameters<typeof makeLiveTransport>[0]["policy"]) {
  const made = makeLiveTransport({ sessionId, ...(policy === undefined ? {} : { policy }) });
  return {
    ...made,
    client: createInProcessLiveClient({ createTransport: () => made.transport }),
  };
}

describe("live client — the golden open over the REAL W305 transport", () => {
  test("requestLive validates, answers, and attaches (offer summary verbatim)", async () => {
    const { client, clock } = freshClient("sess-1");
    clock.advance(7_000); // the offer's offeredAtMs domain
    const attached = await client.requestLive("sess-1");
    // The offer view: verbatim fields from the real offer document.
    expect(attached.offer).toEqual({
      protocolVersion: "sporta.live-output/v1",
      sessionId: "sess-1",
      streamId: "live-sess-1",
      trackCount: 1,
      profile: {
        resolution: { w: 1170, h: 880 },
        frameRate: 1,
        codec: "svg",
        container: "svg",
        latencyClass: "live",
      },
      sessionControls: {
        backpressurePolicy: "block",
        linkCapacity: 16,
        retransmitRetention: 8,
      },
    });
    // The answer: a real W305 accept document for this viewer.
    expect(attached.answer.kind).toBe("accept");
    if (attached.answer.kind === "accept") {
      expect(attached.answer.protocolVersion).toBe("sporta.live-output/v1");
      expect(attached.answer.viewerId).toBe("viewer-shell");
    }
    expect(attached.viewerId).toBe("viewer-shell");
    // The attached stream: connected, established, empty accounting (absent
    // metrics absent — nothing has been delivered yet).
    const status = attached.stream.status();
    expect(status.connected).toBe(true);
    expect(status.phase).toBe("established");
    expect(status.accounting).toEqual({
      appliedWindows: 0,
      duplicateWindows: 0,
      skippedWindows: 0,
      accountedOrdinals: 0,
      lastAppliedOrdinal: null,
    });
    expect(status.latencyToLatestWindowMs).toBe(null);
    expect(status.degradationReasons).toEqual([]);
    expect(status.terminal).toBe(null);
  });

  test("a custom viewer id + codec allow-list flow through the endpoint policy", async () => {
    const made = makeLiveTransport({ sessionId: "sess-1" });
    const client = createInProcessLiveClient({
      createTransport: () => made.transport,
      viewerId: "viewer-test-2",
    });
    const attached = await client.requestLive("sess-1");
    expect(attached.viewerId).toBe("viewer-test-2");
    expect(attached.answer.kind === "accept" ? attached.answer.viewerId : null).toBe(
      "viewer-test-2",
    );
  });
});

describe("live client — the fail-closed rights path (W305's own gate)", () => {
  test("a policy without liveDelivery throws the typed rights error, mapped verbatim", async () => {
    const { client } = freshClient("sess-1", noLiveDeliveryPolicy());
    try {
      await client.requestLive("sess-1");
      throw new Error("expected requestLive to reject");
    } catch (err) {
      expect(isViewerControlError(err)).toBe(true);
      if (!isViewerControlError(err)) throw new Error("unreachable");
      expect(err.failureClass).toBe("rights-denied");
      // NOT retryable — repeating the request cannot conjure the capability.
      expect(["network", "internal", "resource-limit"].includes(err.failureClass)).toBe(false);
      expect(err.details.liveFailureClass).toBe("rights-denied");
      expect(err.details.streamId).toBe("live-sess-1");
      expect(err.message).toContain("canDeliverLive");
    }
  });
});

describe("live client — the session guard", () => {
  test("a transport serving another session is a protocol violation (never a cross-session attach)", async () => {
    const { client } = freshClient("sess-A");
    try {
      await client.requestLive("sess-B");
      throw new Error("expected requestLive to reject");
    } catch (err) {
      expect(isViewerControlError(err)).toBe(true);
      if (!isViewerControlError(err)) throw new Error("unreachable");
      expect(err.failureClass).toBe("media-invalid");
      expect(err.details.liveFailureClass).toBe("protocol-violation");
      expect(err.details.offeredSessionId).toBe("sess-A");
    }
  });
});

describe("live client — the exact-key offer check (unknown fields are typed rejects)", () => {
  test("a REAL W305 offer passes by construction", () => {
    const made = makeLiveTransport({ sessionId: "sess-1" });
    const offer = made.transport.createOffer();
    expect(checkOfferExactKeys(offer)).toBe(null);
  });

  test.each([
    ["root", (offer: Record<string, unknown>) => void (offer.extraRoot = true)],
    [
      "track",
      (offer: Record<string, unknown>) => {
        (offer.tracks as Array<Record<string, unknown>>)[0]!.extraTrack = true;
      },
    ],
    [
      "profile",
      (offer: Record<string, unknown>) => {
        ((offer.tracks as Array<Record<string, unknown>>)[0]!.profile as Record<string, unknown>).extraProfile = true;
      },
    ],
    [
      "resolution",
      (offer: Record<string, unknown>) => {
        const profile = (offer.tracks as Array<Record<string, unknown>>)[0]!.profile as Record<
          string,
          unknown
        >;
        (profile.resolution as Record<string, unknown>).extraResolution = true;
      },
    ],
    [
      "sessionControls",
      (offer: Record<string, unknown>) => {
        (offer.sessionControls as Record<string, unknown>).extraControl = true;
      },
    ],
  ])("an unknown %s field is named in the reject", (_level, mutate) => {
    const made = makeLiveTransport({ sessionId: "sess-1" });
    const offer = made.transport.createOffer() as unknown as Record<string, unknown>;
    mutate(offer);
    const error = checkOfferExactKeys(offer);
    expect(error).not.toBe(null);
    expect(error).toContain("unknown offer field");
    expect(error).toContain("extra");
    expect(error).toContain("the v1 live offer grammar is closed");
  });

  test("non-object documents are rejected structurally", () => {
    expect(checkOfferExactKeys(null)).toContain("must be an object");
    expect(checkOfferExactKeys([1, 2])).toContain("must be an object");
  });

  test("a non-array tracks list is rejected", () => {
    const made = makeLiveTransport({ sessionId: "sess-1" });
    const offer = made.transport.createOffer() as unknown as Record<string, unknown>;
    offer.tracks = "nope";
    expect(checkOfferExactKeys(offer)).toContain("offer.tracks must be an array");
  });

  test("the CLIENT rejects a doctored offer before answering (typed, never a zod strip)", async () => {
    const made = makeLiveTransport({ sessionId: "sess-1" });
    const doctored = {
      createOffer: () => ({ ...made.transport.createOffer(), surpriseField: 1 }),
      viewerEndpoint: (options: { viewerId?: string }) => made.transport.viewerEndpoint(options),
      acceptAnswer: (answer: unknown) => made.transport.acceptAnswer(answer),
    };
    const client = createInProcessLiveClient({
      createTransport: () => doctored as unknown as LoopbackLiveOutputTransport,
    });
    try {
      await client.requestLive("sess-1");
      throw new Error("expected requestLive to reject");
    } catch (err) {
      expect(isViewerControlError(err)).toBe(true);
      if (!isViewerControlError(err)) throw new Error("unreachable");
      expect(err.failureClass).toBe("media-invalid");
      expect(err.details.liveFailureClass).toBe("protocol-violation");
      expect(err.message).toContain("surpriseField");
    }
  });
});

describe("live client — negotiation rejects (the endpoint policy, typed answers)", () => {
  test("a non-svg track is a typed unsupported-codec reject (this viewer presents svg)", async () => {
    const made = makeLiveTransport({ sessionId: "sess-1" });
    // Rebuild the transport's offer with a foreign codec by doctoring the
    // offer document between createOffer and the answer (the profile itself
    // stays the transport's real one — only the OFFER lies).
    const doctored = {
      createOffer: () => {
        const offer = made.transport.createOffer() as unknown as {
          tracks: Array<Record<string, unknown>>;
        };
        const profile = offer.tracks[0]!.profile as Record<string, unknown>;
        profile.codec = "vp9";
        profile.container = "webm";
        return offer;
      },
      viewerEndpoint: (options: { viewerId?: string }) => made.transport.viewerEndpoint(options),
      acceptAnswer: (answer: unknown) => made.transport.acceptAnswer(answer),
    };
    const client = createInProcessLiveClient({
      createTransport: () => doctored as unknown as LoopbackLiveOutputTransport,
    });
    try {
      await client.requestLive("sess-1");
      throw new Error("expected requestLive to reject");
    } catch (err) {
      expect(isViewerControlError(err)).toBe(true);
      if (!isViewerControlError(err)) throw new Error("unreachable");
      expect(err.failureClass).toBe("unsupported-output");
      expect(err.details.liveFailureClass).toBe("negotiation-failed");
      expect(err.details.liveRejectionReason).toBe("unsupported-codec");
    }
  });

  test("a foreign protocol version is a typed reject (never a downgrade)", async () => {
    const made = makeLiveTransport({ sessionId: "sess-1" });
    const doctored = {
      createOffer: () => {
        const offer = made.transport.createOffer() as unknown as { protocolVersion: string };
        offer.protocolVersion = "sporta.live-output/v2";
        return offer;
      },
      viewerEndpoint: (options: { viewerId?: string }) => made.transport.viewerEndpoint(options),
      acceptAnswer: (answer: unknown) => made.transport.acceptAnswer(answer),
    };
    const client = createInProcessLiveClient({
      createTransport: () => doctored as unknown as LoopbackLiveOutputTransport,
    });
    try {
      await client.requestLive("sess-1");
      throw new Error("expected requestLive to reject");
    } catch (err) {
      expect(isViewerControlError(err)).toBe(true);
      if (!isViewerControlError(err)) throw new Error("unreachable");
      expect(err.details.liveRejectionReason).toBe("unsupported-protocol-version");
    }
  });
});

describe("live client — the W305 → viewer failure-class map (every class, verbatim evidence)", () => {
  test("the map is TOTAL over the W305 failure vocabulary", () => {
    const w305Classes: LiveOutputFailureClass[] = [
      "rights-denied",
      "rights-lapsed",
      "transport-failed",
      "negotiation-failed",
      "negotiation-violation",
      "integrity-violation",
      "protocol-violation",
    ];
    for (const w305Class of w305Classes) {
      expect(LIVE_FAILURE_CLASS_MAP[w305Class], w305Class).toBeDefined();
    }
    expect(Object.keys(LIVE_FAILURE_CLASS_MAP).sort()).toEqual([...w305Classes].sort());
  });

  test("mapLiveError keeps the W305 class verbatim + maps to the viewer class (pinned per class)", () => {
    const cases: Array<{
      w305Class: LiveOutputFailureClass;
      error: LiveOutputError;
      viewerClass: ViewerFailureClass;
      retryable: boolean;
    }> = [
      {
        w305Class: "rights-denied",
        error: new LiveOutputRightsError("no live delivery rights", {
          streamId: "s",
          failureClass: "rights-denied",
        }),
        viewerClass: "rights-denied",
        retryable: false,
      },
      {
        w305Class: "rights-lapsed",
        error: new LiveOutputRightsError("rights lapsed mid-stream", {
          streamId: "s",
          failureClass: "rights-lapsed",
        }),
        viewerClass: "rights-denied",
        retryable: false,
      },
      {
        w305Class: "transport-failed",
        error: new LiveOutputProtocolError("transport died", {
          streamId: "s",
          failureClass: "transport-failed",
        }),
        viewerClass: "network",
        retryable: true,
      },
      {
        w305Class: "negotiation-failed",
        error: new LiveOutputNegotiationError("offer rejected", {
          streamId: "s",
          failureClass: "negotiation-failed",
        }),
        viewerClass: "unsupported-output",
        retryable: false,
      },
      {
        w305Class: "negotiation-violation",
        error: new LiveOutputProfileMismatchError("profile mismatch", {
          streamId: "s",
          failureClass: "negotiation-violation",
        }),
        viewerClass: "media-invalid",
        retryable: false,
      },
      {
        w305Class: "integrity-violation",
        error: new LiveOutputIntegrityError("hash mismatch", {
          streamId: "s",
          failureClass: "integrity-violation",
        }),
        viewerClass: "media-invalid",
        retryable: false,
      },
      {
        w305Class: "protocol-violation",
        error: new LiveOutputProtocolError("malformed document", {
          streamId: "s",
          failureClass: "protocol-violation",
        }),
        viewerClass: "media-invalid",
        retryable: false,
      },
    ];
    for (const { w305Class, error, viewerClass, retryable } of cases) {
      const mapped = mapLiveError(error);
      expect(isViewerControlError(mapped), w305Class).toBe(true);
      if (!isViewerControlError(mapped)) throw new Error("unreachable");
      expect(mapped.failureClass, w305Class).toBe(viewerClass);
      expect(mapped.details.liveFailureClass, w305Class).toBe(w305Class);
      expect(mapped.details.failureClass, w305Class).toBe(w305Class);
      expect(mapped.details.streamId, w305Class).toBe("s");
      expect(
        ["network", "internal", "resource-limit"].includes(mapped.failureClass),
        `${w305Class} retryable=${retryable}`,
      ).toBe(retryable);
    }
  });

  test("a non-live error maps to internal (never swallowed, never guessed)", () => {
    const mapped = mapLiveError(new Error("plain failure"));
    expect(isViewerControlError(mapped)).toBe(true);
    if (!isViewerControlError(mapped)) throw new Error("unreachable");
    expect(mapped.failureClass).toBe("internal");
    expect(mapped.message).toBe("plain failure");
    const thrownString = mapLiveError("boom");
    if (!isViewerControlError(thrownString)) throw new Error("unreachable");
    expect(thrownString.failureClass).toBe("internal");
    expect(thrownString.message).toContain("unexpected live output failure");
  });
});
