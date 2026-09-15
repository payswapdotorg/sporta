/**
 * Session negotiation documents (W305): the offer/answer construction and
 * fail-loud validation helpers.
 *
 * The dance is the WebRTC-shape, vendor-neutral: the host mints an
 * {@link LiveOutputOffer} (tracks declared from the render output profile,
 * VERBATIM — codec/container/resolution/frameRate/latencyClass), the viewer
 * endpoint answers with a typed accept or reject, and the host establishes
 * on the accept. Documents are zod-validated at BOTH boundaries
 * (`parseLiveOutputOffer` / `parseLiveOutputAnswer`): a malformed document
 * is a typed `protocol-violation`, never a best-effort guess.
 *
 * RIGHTS (architecture-lock §11, the W301 admission posture): the offer is
 * only minted after a fail-closed rights re-derivation on the injected
 * clock — `deriveRightsCapabilities(policy, new Date(nowMs))` (an explicit
 * millisecond instant — never a bare wall-clock read). Without
 * `canDeliverLive` there is no offer and no session: the gate runs BEFORE
 * the stream opens. The policy is re-derived on every `sendWindow`; a
 * mid-stream lapse terminates the session LOUDLY (class `rights-lapsed`).
 */
import { deriveRightsCapabilities, type AuthorizationPolicy, type OutputProfile } from "@sporta/contracts";
import { LiveOutputProtocolError, LiveOutputRightsError } from "./errors";
import {
  LiveOutputAnswer,
  LiveOutputOffer,
  type LiveOutputAnswer as LiveOutputAnswerType,
  type LiveOutputOffer as LiveOutputOfferType,
  type LiveOutputRejectionReason,
} from "./types";
import { LIVE_OUTPUT_PROTOCOL_VERSION } from "./types";

/** Parse result for a wire document (typed ok/invalid — never a guess). */
export type DocumentParse<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Parses and validates an offer document (unknown input, typed result). */
export function parseLiveOutputOffer(document: unknown): DocumentParse<LiveOutputOfferType> {
  const result = LiveOutputOffer.safeParse(document);
  if (!result.success) {
    return { ok: false, reason: `invalid live output offer: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}

/** Parses and validates an answer document (unknown input, typed result). */
export function parseLiveOutputAnswer(document: unknown): DocumentParse<LiveOutputAnswerType> {
  const result = LiveOutputAnswer.safeParse(document);
  if (!result.success) {
    return { ok: false, reason: `invalid live output answer: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}

/**
 * The host-side rights gate: re-derives the capabilities from the
 * authorization policy at the injected instant and fails closed without
 * `canDeliverLive` (typed `LiveOutputRightsError` — the W301 gate-before-
 * anything posture: no offer, no stream, nothing opened).
 */
export function assertLiveDeliveryRights(
  policy: AuthorizationPolicy | null | undefined,
  nowMs: number,
  streamId: string,
): void {
  // Explicit-millisecond Date — the sanctioned pattern for the contracts'
  // expiry derivation (never a bare `new Date()` wall-clock read).
  const capabilities = deriveRightsCapabilities(policy, new Date(nowMs));
  if (!capabilities.canDeliverLive) {
    throw new LiveOutputRightsError(
      "live delivery requires the canDeliverLive capability (fail-closed rights gate)",
      { streamId, failureClass: "rights-denied" },
    );
  }
}

/** The track descriptor derived from a render output profile (VERBATIM). */
export function trackFromProfile(
  profile: OutputProfile,
  streamId: string,
): { trackId: string; kind: "video"; profile: OutputProfile } {
  return { trackId: `track-${streamId}-video`, kind: "video", profile };
}

/**
 * Mints one offer document. Caller-side gates (rights already asserted by
 * the transport; profile validation is the caller's) — this function is a
 * pure document builder over validated inputs.
 */
export function buildLiveOutputOffer(input: {
  sessionId: string;
  streamId: string;
  profile: OutputProfile;
  sessionControls: {
    backpressurePolicy: "block" | "reject" | "drop-oldest";
    linkCapacity: number;
    maxLinkBytes: number | null;
    maxWatermarkLagMs: number | null;
    retransmitRetention: number;
  };
  offeredAtMs: number;
}): LiveOutputOfferType {
  const offer: LiveOutputOfferType = {
    protocolVersion: LIVE_OUTPUT_PROTOCOL_VERSION,
    sessionId: input.sessionId,
    streamId: input.streamId,
    tracks: [trackFromProfile(input.profile, input.streamId)],
    sessionControls: input.sessionControls,
    offeredAtMs: input.offeredAtMs,
  };
  const parsed = parseLiveOutputOffer(offer);
  if (!parsed.ok) {
    throw new LiveOutputProtocolError(`built an invalid offer: ${parsed.reason}`, {
      streamId: input.streamId,
      failureClass: "protocol-violation",
    });
  }
  return parsed.value;
}

/**
 * The viewer-side decision over an offer: validates the document, applies
 * the endpoint's policy (supported protocol version, at least one video
 * track, optional codec/latency-class allow-lists), and produces the typed
 * answer document. Malformed documents throw the typed protocol error;
 * policy mismatches produce a typed REJECT answer (negotiation, not fault).
 */
export function answerLiveOutputOffer(
  offerDocument: unknown,
  options: {
    viewerId: string;
    nowMs: number;
    /** When set, offers with other protocol versions are rejected. */
    supportedProtocolVersion?: string;
    /** When set, only these codecs are served (typed reject otherwise). */
    supportedCodecs?: readonly string[];
    /** When set, only these latency classes are served. */
    supportedLatencyClasses?: readonly string[];
  },
): LiveOutputAnswerType {
  const parsed = parseLiveOutputOffer(offerDocument);
  if (!parsed.ok) {
    throw new LiveOutputProtocolError(parsed.reason, {
      streamId: "unknown",
      failureClass: "protocol-violation",
      document: offerDocument,
    });
  }
  const offer = parsed.value;
  const reject = (reason: LiveOutputRejectionReason): LiveOutputAnswerType => ({
    kind: "reject",
    reason,
    rejectedAtMs: options.nowMs,
  });
  const expectedVersion = options.supportedProtocolVersion ?? LIVE_OUTPUT_PROTOCOL_VERSION;
  if (offer.protocolVersion !== expectedVersion) {
    return reject("unsupported-protocol-version");
  }
  if (!offer.tracks.some((track) => track.kind === "video")) {
    return reject("no-video-track");
  }
  if (
    options.supportedCodecs !== undefined &&
    !offer.tracks.every((track) => options.supportedCodecs!.includes(track.profile.codec))
  ) {
    return reject("unsupported-codec");
  }
  if (
    options.supportedLatencyClasses !== undefined &&
    !offer.tracks.every((track) =>
      options.supportedLatencyClasses!.includes(track.profile.latencyClass),
    )
  ) {
    return reject("unsupported-latency-class");
  }
  return {
    kind: "accept",
    protocolVersion: offer.protocolVersion,
    viewerId: options.viewerId,
    acceptedAtMs: options.nowMs,
  };
}
