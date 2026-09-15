/**
 * Session negotiation documents (W305): the offer/answer construction and
 * fail-loud validation helpers.
 *
 * The dance is the WebRTC-shape, vendor-neutral: the host mints an
 * {@link LiveOutputOffer} (tracks declared from the render output profile,
 * VERBATIM — codec/container/resolution/frameRate/latencyClass), the viewer
 * endpoint answers with a typed accept or reject, and the host establishes
 * on the accept. Documents are zod-validated at BOTH boundaries — with the
 * TWO-GRAMMAR posture this contract's own rejection vocabulary requires:
 *
 * - The STRICT wire schema (`LiveOutputOffer`, via `parseLiveOutputOffer`)
 *   is the v1 protocol contract: what a v1 host mints
 *   (`buildLiveOutputOffer` self-validates against it) and what establishes
 *   a session — at least one track, every track of v1's `"video"` kind, the
 *   v1 protocol-version literal. A v1 host cannot mint anything else.
 * - The ANSWER-side intake grammar (`AnswerableLiveOutputOffer`, below) is
 *   what the VIEWER endpoint decides over: offer-SHAPED documents whose
 *   tracks may be empty or of future kinds and whose protocol version may
 *   be foreign — because the rejection reasons `no-video-track` and
 *   `unsupported-protocol-version` are NEGOTIATION outcomes (a peer we
 *   cannot serve is answered with a typed reject), not malformedness. Only
 *   documents that are not offer-shaped at all (wrong field types, missing
 *   session controls, a broken profile) are a typed `protocol-violation`
 *   throw — never a best-effort guess. This mirrors SDP semantics: an
 *   endpoint answers offers it cannot serve; it does not crash on them.
 *
 * RIGHTS (architecture-lock §11, the W301 admission posture): the offer is
 * only minted after a fail-closed rights re-derivation on the injected
 * clock — `deriveRightsCapabilities(policy, new Date(nowMs))` (an explicit
 * millisecond instant — never a bare wall-clock read). Without
 * `canDeliverLive` there is no offer and no session: the gate runs BEFORE
 * the stream opens. The policy is re-derived on every `sendWindow`; a
 * mid-stream lapse terminates the session LOUDLY (class `rights-lapsed`).
 */
import {
  OutputProfile,
  deriveRightsCapabilities,
  type AuthorizationPolicy,
} from "@sporta/contracts";
import { z } from "zod";
import { LiveOutputProtocolError, LiveOutputRightsError } from "./errors";
import {
  LiveOutputAnswer,
  LiveOutputOffer,
  LiveOutputSessionControls,
  type LiveOutputAnswer as LiveOutputAnswerType,
  type LiveOutputOffer as LiveOutputOfferType,
  type LiveOutputRejectionReason,
} from "./types";
import { LIVE_OUTPUT_PROTOCOL_VERSION } from "./types";

/**
 * The ANSWER-side offer intake grammar (see the module doc): the strict wire
 * schema's field validation with the two POLICY dimensions relaxed — the
 * tracks array may be empty or carry future track kinds, and the protocol
 * version may be foreign. Everything else (identity fields, session-control
 * bounds, the output-profile shape, timestamps) is validated as strictly as
 * the wire schema: an offer that fails THIS grammar is not offer-shaped and
 * throws the typed protocol error; an offer that passes it gets the
 * endpoint's typed decision.
 */
const AnswerableLiveOutputOffer = z.object({
  protocolVersion: z.string().min(1),
  sessionId: z.string().min(1),
  streamId: z.string().min(1),
  tracks: z.array(
    z.object({
      trackId: z.string().min(1),
      kind: z.string().min(1),
      profile: OutputProfile,
    }),
  ),
  sessionControls: LiveOutputSessionControls,
  offeredAtMs: z.number(),
});

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
 * The viewer-side decision over an offer: validates the document against the
 * ANSWER-side intake grammar (offer-shaped, any tracks/version — see the
 * module doc), applies the endpoint's policy (supported protocol version, at
 * least one video track, optional codec/latency-class allow-lists), and
 * produces the typed answer document. Documents that are not offer-shaped
 * throw the typed protocol error; policy mismatches produce a typed REJECT
 * answer (negotiation, not fault).
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
  const parsed = AnswerableLiveOutputOffer.safeParse(offerDocument);
  if (!parsed.success) {
    throw new LiveOutputProtocolError(`invalid live output offer: ${parsed.error.message}`, {
      streamId: "unknown",
      failureClass: "protocol-violation",
      document: offerDocument,
    });
  }
  const offer = parsed.data;
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
  // The v1 ANSWER vocabulary can only echo the v1 protocol version (the
  // accept document's `protocolVersion` is the v1 literal — a future v2
  // answer gets its own vocabulary). The allow-list check above already
  // rejected offers the endpoint does not speak; this check keeps the ACCEPT
  // honest for a viewer configured with a FOREIGN expected version whose
  // offer happens to match it: this package can still only ACCEPT in v1.
  if (offer.protocolVersion !== LIVE_OUTPUT_PROTOCOL_VERSION) {
    return reject("unsupported-protocol-version");
  }
  return {
    kind: "accept",
    protocolVersion: LIVE_OUTPUT_PROTOCOL_VERSION,
    viewerId: options.viewerId,
    acceptedAtMs: options.nowMs,
  };
}
