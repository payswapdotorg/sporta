/**
 * The in-process live client (W704): a {@link LiveClient} adapter over a REAL
 * W305 `LoopbackLiveOutputTransport` — the same posture as W702's
 * `./control-client.ts` (headless integration against the actual package
 * semantics, no network).
 *
 * NODE-SIDE by design (NOT part of the served browser module graph — it
 * imports `@sporta/webrtc-output` at runtime): a real browser live transport
 * would sit behind a network (W305's documented in-process seam boundary —
 * no RTCPeerConnection exists in this monorepo). The dev viewer server does
 * NOT bridge live over HTTP: W305 defined no HTTP wire for the live offer
 * dance, and inventing one here would be a new protocol — the honest
 * composition is this in-process adapter (tests, dev wiring).
 *
 * THE OPEN DANCE (`requestLive`), one call:
 *
 * 1. `transport.createOffer()` — the host mints the offer behind W305's
 *    fail-closed `canDeliverLive` gate (a policy without live delivery
 *    throws the typed `LiveOutputRightsError`; the session dies terminally
 *    — no offer, no stream);
 * 2. THE EXACT-KEY CHECK (W704's strictness on top of the grammar): the
 *    offer document may carry EXACTLY the v1 grammar's fields at every
 *    level — an UNKNOWN field is a typed reject (`media-invalid` carrying
 *    `details.liveFailureClass: "protocol-violation"`), never a silent
 *    zod strip-guess;
 * 3. `endpoint.answer(offer, …)` — W305's ANSWER-side zod grammar
 *    (`AnswerableLiveOutputOffer`) + the endpoint policy: protocol version
 *    (v1 only — a foreign version is a typed reject, never a downgrade), at
 *    least one video track, and this viewer's codec allow-list (it presents
 *    SVG frame documents; a non-svg track is a typed
 *    `unsupported-codec` reject). A document that is not offer-shaped at
 *    all throws W305's typed protocol error;
 * 4. `transport.acceptAnswer(answer)` — the host establishes on the accept;
 * 5. `endpoint.connect()` — the consuming `LiveViewerSession`, wrapped as
 *    the {@link LiveStreamHandle}.
 *
 * Every W305 failure is mapped onto the viewer's typed error model with the
 * W305 class VERBATIM in `details.liveFailureClass` (the W702
 * verbatim-evidence pattern — the label/retryability come from the mapped
 * viewer class, the honest class always travels along):
 *
 * | W305 class            | viewer class        |
 * | ---------------------- | ------------------- |
 * | `rights-denied`       | `rights-denied`     |
 * | `rights-lapsed`       | `rights-denied`     |
 * | `transport-failed`    | `network`           |
 * | `negotiation-failed`  | `unsupported-output`|
 * | `negotiation-violation` | `media-invalid`   |
 * | `integrity-violation` | `media-invalid`      |
 * | `protocol-violation`  | `media-invalid`      |
 */
import { LiveOutputError } from "@sporta/webrtc-output";
import type {
  LiveDeliveryEvent,
  LiveOutputOffer,
  LiveViewerSession,
  LoopbackLiveOutputTransport,
} from "@sporta/webrtc-output";
import { ViewerControlError } from "./errors.ts";
import { LIVE_FAILURE_CLASS_MAP } from "./live-ports.ts";
import type {
  LiveAccountingView,
  LiveAttached,
  LiveClient,
  LiveOfferView,
  LiveReconnectReportView,
  LiveStreamHandle,
  LiveStreamStatusView,
} from "./live-ports.ts";

/** Maps a thrown W305/live failure onto the viewer error model (verbatim evidence). */
export function mapLiveError(value: unknown): ViewerControlError {
  if (value instanceof LiveOutputError) {
    const w305Class = value.details.failureClass;
    return new ViewerControlError(LIVE_FAILURE_CLASS_MAP[w305Class], value.message, {
      ...value.details,
      liveFailureClass: w305Class,
    });
  }
  return new ViewerControlError(
    "internal",
    value instanceof Error ? value.message : "unexpected live output failure",
  );
}

// ---------------------------------------------------------------------------
// The exact-key check (W305 v1 grammar mirror — see the module docs)
// ---------------------------------------------------------------------------

/** The v1 offer grammar's exact fields, at every level (W305 `./types.ts` mirror). */
const OFFER_KEYS = {
  root: ["protocolVersion", "sessionId", "streamId", "tracks", "sessionControls", "offeredAtMs"],
  track: ["trackId", "kind", "profile"],
  profile: ["resolution", "frameRate", "codec", "container", "latencyClass"],
  resolution: ["w", "h"],
  controls: [
    "backpressurePolicy",
    "linkCapacity",
    "maxLinkBytes",
    "maxWatermarkLagMs",
    "retransmitRetention",
  ],
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rejects any key outside `allowed` (fail-loud, naming the exact field) —
 * the "unknown fields stay rejects" rule. Returns `null` when exact.
 */
function exactKeys(value: unknown, allowed: readonly string[], path: string): string | null {
  if (!isPlainObject(value)) return `${path} must be an object`;
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) {
      return `unknown offer field '${path}.${key}' — the v1 live offer grammar is closed (typed reject, never a guess)`;
    }
  }
  return null;
}

/**
 * The exact-key walk over an offer document: every level carries exactly the
 * v1 grammar's fields. A valid W305 offer (built by `buildLiveOutputOffer`)
 * passes by construction — pinned by test; any extra key anywhere rejects.
 */
export function checkOfferExactKeys(document: unknown): string | null {
  const root = exactKeys(document, OFFER_KEYS.root, "offer");
  if (root !== null) return root;
  const offer = document as Record<string, unknown>;
  const tracks = offer.tracks;
  if (!Array.isArray(tracks)) return "offer.tracks must be an array";
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const trackError = exactKeys(track, OFFER_KEYS.track, `offer.tracks[${String(index)}]`);
    if (trackError !== null) return trackError;
    if (!isPlainObject(track)) continue; // the grammar's own type check rejects it
    const profileError = exactKeys(
      track.profile,
      OFFER_KEYS.profile,
      `offer.tracks[${String(index)}].profile`,
    );
    if (profileError !== null) return profileError;
    if (isPlainObject(track.profile)) {
      const resolutionError = exactKeys(
        track.profile.resolution,
        OFFER_KEYS.resolution,
        `offer.tracks[${String(index)}].profile.resolution`,
      );
      if (resolutionError !== null) return resolutionError;
    }
  }
  return exactKeys(offer.sessionControls, OFFER_KEYS.controls, "offer.sessionControls");
}

/** Derives the user-facing offer summary (verbatim fields; see `LiveOfferView`). */
function offerViewOf(offer: LiveOutputOffer): LiveOfferView {
  const videoTrack = offer.tracks.find((track) => track.kind === "video");
  return {
    protocolVersion: offer.protocolVersion,
    sessionId: offer.sessionId,
    streamId: offer.streamId,
    trackCount: offer.tracks.length,
    profile:
      videoTrack === undefined
        ? null
        : {
            resolution: { ...videoTrack.profile.resolution },
            frameRate: videoTrack.profile.frameRate,
            codec: videoTrack.profile.codec,
            container: videoTrack.profile.container,
            latencyClass: videoTrack.profile.latencyClass,
          },
    sessionControls: {
      backpressurePolicy: offer.sessionControls.backpressurePolicy,
      linkCapacity: offer.sessionControls.linkCapacity,
      retransmitRetention: offer.sessionControls.retransmitRetention,
    },
  };
}

// ---------------------------------------------------------------------------
// The stream handle (the consuming session, wrapped)
// ---------------------------------------------------------------------------

/** Wraps one W305 `LiveViewerSession` as the core's `LiveStreamHandle`. */
function streamHandleOf(session: LiveViewerSession): LiveStreamHandle {
  let iterator: AsyncIterator<LiveDeliveryEvent> | null = null;
  return {
    async nextEvent(): Promise<LiveDeliveryEvent | null> {
      try {
        // Not consumable: terminally closed, or disconnected awaiting a
        // reconnect (the core knows which from the events it applied — this
        // is the typed "not consumable now" answer, never a silent skip).
        if (session.terminated || !session.connected) {
          // COMPLETE a suspended pull stream before answering null: an
          // async generator suspended at its `yield` keeps W305's
          // one-active-pull guard engaged until it is resumed. Leaving it
          // suspended would make the FIRST post-reconnect pull resume the
          // DYING stream (it only returns) — the restarted consumption loop
          // would exit immediately and the live presentation would freeze
          // silently. `return()` runs the generator's `finally` (releasing
          // the pull guard) so the next `events()` starts a FRESH stream
          // that actually delivers the replay + new windows.
          if (iterator !== null) {
            const finish = iterator.return;
            if (finish !== undefined) await finish.call(iterator);
            iterator = null;
          }
          return null;
        }
        if (iterator === null) iterator = session.events()[Symbol.asyncIterator]();
        const next = await iterator.next();
        if (next.done) {
          iterator = null; // the pull stream ended (connection-lost / session-closed)
          return null;
        }
        return next.value;
      } catch (err) {
        throw mapLiveError(err);
      }
    },
    status(): LiveStreamStatusView {
      try {
        const status = session.status();
        const accounting: LiveAccountingView = {
          appliedWindows: status.appliedWindows,
          duplicateWindows: status.duplicateWindows,
          skippedWindows: status.skippedWindows,
          accountedOrdinals: status.accountedOrdinals,
          lastAppliedOrdinal: status.lastAppliedOrdinal,
        };
        return {
          phase: status.phase,
          connected: status.connected,
          degradationReasons: [...status.degradationReasons],
          bufferDepth: status.bufferDepth,
          latencyToLatestWindowMs: status.latencyToLatestWindowMs,
          mediaLagMs: status.mediaLagMs,
          terminal:
            status.terminal === null
              ? null
              : {
                  outcome: status.terminal.outcome,
                  ...(status.terminal.failureClass === undefined
                    ? {}
                    : { failureClass: status.terminal.failureClass }),
                },
          accounting,
        };
      } catch (err) {
        throw mapLiveError(err);
      }
    },
    reconnect(resumeFromOrdinal: number): LiveReconnectReportView {
      try {
        const report = session.reconnect(resumeFromOrdinal);
        return {
          resumeFromOrdinal: report.resumeFromOrdinal,
          replayCount: report.replayCount,
          gapSkipped: report.gapSkipped,
        };
      } catch (err) {
        throw mapLiveError(err);
      }
    },
    disconnect(): void {
      try {
        session.disconnect();
      } catch (err) {
        throw mapLiveError(err);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** Options for {@link createInProcessLiveClient}. */
export interface InProcessLiveClientOptions {
  /**
   * The factory for the W305 live output transport: ONE transport per open
   * (a live session is `negotiating → established → closed` — W305 defines
   * no re-negotiation), so every `requestLive` draws a FRESH transport. The
   * host-side wiring owns the lifetime and drives `sendWindow` (it keeps
   * its own reference through this closure).
   */
  createTransport: () => LoopbackLiveOutputTransport;
  /** The viewer endpoint id answering offers (default `"viewer-shell"`). */
  viewerId?: string;
  /**
   * The codec allow-list for the endpoint policy (default `["svg"]` — this
   * viewer presents SVG frame documents; a non-svg track is a typed
   * `unsupported-codec` reject).
   */
  supportedCodecs?: readonly string[];
}

/**
 * Creates the in-process live client (see the module docs for the full open
 * dance and the honest node-side boundary).
 */
export function createInProcessLiveClient(options: InProcessLiveClientOptions): LiveClient {
  const createTransport = options.createTransport;
  const viewerId = options.viewerId ?? "viewer-shell";
  const supportedCodecs = options.supportedCodecs ?? ["svg"];
  return {
    async requestLive(sessionId: string): Promise<LiveAttached> {
      try {
        const transport = createTransport();
        // 1. The host's fail-closed rights gate runs INSIDE createOffer (a
        //    policy without canDeliverLive throws the typed rights error).
        const offer = transport.createOffer();
        if (offer.sessionId !== sessionId) {
          throw new ViewerControlError(
            "media-invalid",
            `the live transport serves session ${offer.sessionId}, not ${sessionId}`,
            { liveFailureClass: "protocol-violation", offeredSessionId: offer.sessionId },
          );
        }
        // 2. The exact-key check (unknown fields are typed rejects).
        const keyError = checkOfferExactKeys(offer);
        if (keyError !== null) {
          throw new ViewerControlError("media-invalid", keyError, {
            liveFailureClass: "protocol-violation",
          });
        }
        // 3. W305's answer-side grammar + the endpoint policy (typed
        //    accept/reject; a non-offer-shaped document would throw — the
        //    grammar ran above, so this offer is at least key-exact).
        const endpoint = transport.viewerEndpoint({ viewerId });
        const answer = endpoint.answer(offer, { supportedCodecs });
        if (answer.kind === "reject") {
          throw new ViewerControlError(
            "unsupported-output",
            `the live offer was rejected: ${answer.reason} (this viewer presents ${supportedCodecs.join("/")} frame documents)`,
            { liveFailureClass: "negotiation-failed", liveRejectionReason: answer.reason },
          );
        }
        // 4-5. The host establishes on the accept; the consuming session
        //     connects (one live connection per endpoint).
        transport.acceptAnswer(answer);
        const session = endpoint.connect();
        return {
          stream: streamHandleOf(session),
          offer: offerViewOf(offer),
          answer,
          viewerId,
        };
      } catch (err) {
        if (err instanceof ViewerControlError) throw err;
        throw mapLiveError(err);
      }
    },
  };
}
