/**
 * THE AUTHORIZED SKILLCORNER LIVE FEED ADAPTER (L009) — the env-driven
 * adapter that feeds the frozen live contract from the provider's
 * AUTHORIZED tracking endpoint when credentials + feed access exist.
 *
 * WHAT IS RECORDED vs WHAT IS UNVERIFIED (the honest split — see
 * ../env.ts and ../profile.ts for the fetched citations):
 * - RECORDED (fetchable without credentials, 2026-09-21): the API base, the
 *   HTTP Basic auth mode (the provider SDK's username/password convention),
 *   the `GET /api/match/{match_id}/tracking` endpoint, and the DRF
 *   `{count,next,previous,results}` pagination envelope the SDK walks;
 * - RECORDED (the provider's published repository): the tracking FRAME core
 *   format the parser validates strictly (see ./response.ts);
 * - UNVERIFIED-UNTIL-CREDENTIALS: the live endpoint's exact frame payload
 *   (may carry fields beyond the recorded core). The adapter's doctrine:
 *   unknown fields are COUNTED BY NAME (never forwarded, never guessed) —
 *   the first live pull surfaces the delta and the record is extended
 *   deliberately (the activation checklist in the status doc).
 *
 * SEAM SHAPE (follows the L007 replay adapter's port surface — the pull
 * based bridge contract): `pullPage()` advances the network cursor (ONE DRF
 * page per call; the caller owns pacing/retry policy — the §6 reconnect
 * behavior is the CALLER'S, never a silent retry here), then `next()` hands
 * the buffered observations out in arrival order, `plannedIngestTimeMs()`
 * exposes the pacing primitive, `stats()` the honest accounting. Every
 * emitted document parses against the STRICT frozen LiveObservation
 * contract — provider fields cannot leak (pinned by tests).
 *
 * PURITY: the constructor does NO I/O and reads NO clock — the HTTP seam
 * (`fetcher`) and the clock (`nowMs`) are INJECTED; tests drive pages from
 * fixtures and pin the exact wire requests (URL + the Basic header).
 */
import type { LiveEntityObservation, LiveObservation } from "@sporta/live-source";
import { batchConfidenceOf } from "@sporta/live-source";
import {
  SKILLCORNER_AUTHORIZED_DEFAULT_PITCH,
  SKILLCORNER_AUTHORIZED_FRAME_INTERVAL_MS,
  parseSkillCornerAuthorizedPage,
  parseSkillCornerAuthorizedTimestampMs,
  type SkillCornerAuthorizedFrameCore,
} from "./response";

/** The adapter identity (mirrors the profile registration). */
export const SKILLCORNER_AUTHORIZED_ADAPTER_ID = "live-authorized.skillcorner-tracking";
export const SKILLCORNER_AUTHORIZED_ADAPTER_VERSION = "0.1.0";
export const SKILLCORNER_AUTHORIZED_DEFAULT_SOURCE_ID = "skillcorner-authorized";

/** The documented confidence priors (the recorded format carries none). */
export const SKILLCORNER_AUTHORIZED_CONFIDENCE_PRIORS = {
  detected: 0.85,
  carried: 0.25,
} as const;

/** The injected HTTP seam (the real global fetch satisfies it structurally). */
export interface AuthorizedFetchLike {
  (
    url: string,
    init: { headers: Record<string, string> },
  ): Promise<{
    status: number;
    json(): Promise<unknown>;
  }>;
}

/** The feed's configuration (all DATA; the fetcher + clock are injected). */
export interface SkillCornerAuthorizedFeedConfig {
  /** The live session this source feeds (rides every observation). */
  sessionId: string;
  /** HTTP Basic username (secret — only ever placed in the auth header). */
  username: string;
  /** HTTP Basic password (secret — only ever placed in the auth header). */
  password: string;
  /** The provider's match id (non-secret; rides the endpoint path). */
  matchId: string;
  /** The API base (non-secret; the recorded default stands). */
  apiBase: string;
  /** The injected HTTP seam — REQUIRED, never a hidden global. */
  fetcher: AuthorizedFetchLike;
  /** The injected clock (ingest stamps + pacing) — REQUIRED for honesty. */
  nowMs: () => number;
  /** The tracked pitch (defaults to the recorded 105x68). */
  pitch?: { lengthMeters: number; widthMeters: number };
  /** The source id (defaults to the authorized provider label). */
  sourceId?: string;
}

/** One page-pull's honest result (typed — never a thrown smoothing). */
export type SkillCornerPagePull =
  | {
      kind: "page";
      framesParsed: number;
      framesRefused: number;
      observationsBuffered: number;
      hasNext: boolean;
    }
  | { kind: "exhausted" }
  | { kind: "auth-rejected"; status: number }
  | { kind: "http-error"; status: number }
  | { kind: "network-error"; message: string };

/** The feed's honest accounting (never a silent anything). */
export interface SkillCornerAuthorizedFeedStats {
  pagesFetched: number;
  framesParsed: number;
  framesRefused: number;
  emptyFramesSkipped: number;
  knownUnmappedFieldRows: number;
  unknownFieldKinds: string[];
  authRejections: number;
  networkErrors: number;
  httpErrors: number;
  observationsEmitted: number;
  playerRowsEmitted: number;
  ballRowsEmitted: number;
  carriedRowsEmitted: number;
  bufferDepth: number;
  exhausted: boolean;
}

/** The provider's tracked endpoint path (recorded from the SDK config). */
export function skillCornerTrackingUrl(apiBase: string, matchId: string): string {
  return `${apiBase}/api/match/${encodeURIComponent(matchId)}/tracking`;
}

/** The HTTP Basic header value (the provider SDK's auth convention). */
export function skillCornerBasicAuthHeader(username: string, password: string): string {
  const encoded = btoa(`${username}:${password}`);
  return `Basic ${encoded}`;
}

/**
 * The authorized live feed: a pull-based, buffered observation source over
 * the provider's paginated tracking endpoint. Constructed ONLY from a
 * `ready` env resolution (the composition's env gate — L009); everything
 * else stays honestly BLOCKED at the gate and this class is never built.
 */
export class SkillCornerAuthorizedFeed {
  readonly sourceId: string;
  readonly metadata = {
    adapterId: SKILLCORNER_AUTHORIZED_ADAPTER_ID,
    adapterVersion: SKILLCORNER_AUTHORIZED_ADAPTER_VERSION,
    sourceKind: "authorized-real-feed",
    authenticationMode: "http-basic",
    supportedRateHz: 10,
    provenance:
      "SkillCorner authorized API (skillcorner.com) — broadcast tracking; DERIVED on every batch",
    licenseDataUse:
      "requires contractual authorized-feed access (see the profile's blocked dataset component)",
  } as const;

  readonly #sessionId: string;
  readonly #authorizationHeader: string;
  readonly #matchId: string;
  readonly #apiBase: string;
  readonly #fetcher: AuthorizedFetchLike;
  readonly #nowMs: () => number;
  readonly #originX: number;
  readonly #originY: number;

  #nextUrl: string | null;
  #buffer: { observation: LiveObservation; ingestTimeMs: number }[] = [];
  #period1LastEventMs: number | null = null;
  #stats: SkillCornerAuthorizedFeedStats = {
    pagesFetched: 0,
    framesParsed: 0,
    framesRefused: 0,
    emptyFramesSkipped: 0,
    knownUnmappedFieldRows: 0,
    unknownFieldKinds: [],
    authRejections: 0,
    networkErrors: 0,
    httpErrors: 0,
    observationsEmitted: 0,
    playerRowsEmitted: 0,
    ballRowsEmitted: 0,
    carriedRowsEmitted: 0,
    bufferDepth: 0,
    exhausted: false,
  };

  constructor(config: SkillCornerAuthorizedFeedConfig) {
    if (typeof config.sessionId !== "string" || config.sessionId.length === 0) {
      throw new RangeError("SkillCornerAuthorizedFeed: sessionId must be a non-empty string");
    }
    for (const field of ["username", "password", "matchId", "apiBase"] as const) {
      if (typeof config[field] !== "string" || config[field].length === 0) {
        throw new RangeError(`SkillCornerAuthorizedFeed: ${field} must be a non-empty string`);
      }
    }
    if (typeof config.fetcher !== "function") {
      throw new RangeError(
        "SkillCornerAuthorizedFeed: fetcher must be injected (no hidden global)",
      );
    }
    if (typeof config.nowMs !== "function") {
      throw new RangeError("SkillCornerAuthorizedFeed: nowMs must be injected (no hidden clock)");
    }
    this.#sessionId = config.sessionId;
    this.#authorizationHeader = skillCornerBasicAuthHeader(config.username, config.password);
    this.#matchId = config.matchId;
    this.#apiBase = config.apiBase;
    this.#fetcher = config.fetcher;
    this.#nowMs = config.nowMs;
    this.sourceId = config.sourceId ?? SKILLCORNER_AUTHORIZED_DEFAULT_SOURCE_ID;
    const pitch = config.pitch ?? SKILLCORNER_AUTHORIZED_DEFAULT_PITCH;
    if (!(pitch.lengthMeters > 0) || !(pitch.widthMeters > 0)) {
      throw new RangeError("SkillCornerAuthorizedFeed: pitch dimensions must be > 0");
    }
    this.#originX = pitch.lengthMeters / 2;
    this.#originY = pitch.widthMeters / 2;
    this.#nextUrl = skillCornerTrackingUrl(this.#apiBase, this.#matchId);
  }

  /** The honest accounting (live — reflects every pull/emission so far). */
  stats(): SkillCornerAuthorizedFeedStats {
    return {
      ...this.#stats,
      unknownFieldKinds: [...this.#stats.unknownFieldKinds],
      bufferDepth: this.#buffer.length,
    };
  }

  /** The next buffered observation's ingest stamp (the pacing primitive). */
  plannedIngestTimeMs(): number | null {
    return this.#buffer.length > 0 ? this.#buffer[0]!.ingestTimeMs : null;
  }

  /**
   * The next observation in arrival order, or `null` when the buffer is
   * empty (the bridge pulls the next page — pull-based, never blocking).
   */
  next(): LiveObservation | null {
    const head = this.#buffer.shift();
    if (head === undefined) return null;
    this.#stats.observationsEmitted += 1;
    this.#accountEmission(head.observation);
    this.#stats.bufferDepth = this.#buffer.length;
    return head.observation;
  }

  /**
   * Pulls ONE DRF page from the provider (the network cursor advances only
   * here). Typed results — an auth rejection, an HTTP error, or a network
   * failure is RETURNED and counted, never smoothed into a partial page and
   * never silently retried (the caller owns the reconnect policy).
   */
  async pullPage(): Promise<SkillCornerPagePull> {
    if (this.#nextUrl === null) {
      this.#stats.exhausted = true;
      return { kind: "exhausted" };
    }
    const url = this.#nextUrl;
    let response: Awaited<ReturnType<AuthorizedFetchLike>>;
    try {
      response = await this.#fetcher(url, {
        headers: {
          authorization: this.#authorizationHeader,
          accept: "application/json",
        },
      });
    } catch (error) {
      this.#stats.networkErrors += 1;
      return { kind: "network-error", message: String(error) };
    }
    if (response.status === 401 || response.status === 403) {
      this.#stats.authRejections += 1;
      return { kind: "auth-rejected", status: response.status };
    }
    if (response.status !== 200) {
      this.#stats.httpErrors += 1;
      return { kind: "http-error", status: response.status };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.#stats.networkErrors += 1;
      return { kind: "network-error", message: `unparseable body: ${String(error)}` };
    }
    // Refuses LOUD on an envelope mismatch (never a partial page).
    const parsed = parseSkillCornerAuthorizedPage(payload);
    this.#nextUrl = parsed.page.next;
    this.#stats.pagesFetched += 1;
    this.#stats.framesParsed += parsed.parsedFrames;
    this.#stats.framesRefused += parsed.refusedFrames;
    this.#stats.knownUnmappedFieldRows += parsed.knownUnmappedFieldRows;
    const unknown = new Set([...this.#stats.unknownFieldKinds, ...parsed.unknownFieldKinds]);
    this.#stats.unknownFieldKinds = [...unknown].sort();
    const ingestTimeMs = this.#nowMs();
    let buffered = 0;
    for (const frame of parsed.frames) {
      const batch = this.#batchOf(frame, ingestTimeMs);
      if (batch === null) {
        this.#stats.emptyFramesSkipped += 1;
        continue;
      }
      this.#buffer.push({ observation: batch, ingestTimeMs });
      buffered += 1;
    }
    if (this.#nextUrl === null && this.#buffer.length === 0) {
      this.#stats.exhausted = true;
    }
    return {
      kind: "page",
      framesParsed: parsed.parsedFrames,
      framesRefused: parsed.refusedFrames,
      observationsBuffered: buffered,
      hasNext: this.#nextUrl !== null,
    };
  }

  /** Ends the feed (idempotent; stats stay readable). */
  close(): void {
    this.#nextUrl = null;
    this.#stats.exhausted = true;
  }

  /** The session-timeline event time (period 2 continues the running frontier). */
  #eventTimeOf(frame: SkillCornerAuthorizedFrameCore): number | null {
    const withinPeriodMs = parseSkillCornerAuthorizedTimestampMs(frame.timestamp);
    if (withinPeriodMs === null) return null;
    if (frame.period === 2) {
      // LIVE continuation: the last-seen period-1 event time is the running
      // frontier (a live feed cannot two-pass the timeline the way the
      // replay adapter does — the difference is recorded in the status doc).
      const frontier = this.#period1LastEventMs;
      return (frontier ?? 0) + SKILLCORNER_AUTHORIZED_FRAME_INTERVAL_MS + withinPeriodMs;
    }
    if (frame.period === 1 && (this.#period1LastEventMs ?? -1) < withinPeriodMs) {
      this.#period1LastEventMs = withinPeriodMs;
    }
    return withinPeriodMs;
  }

  /** Builds one batch from a frame (null when the frame yields no rows). */
  #batchOf(frame: SkillCornerAuthorizedFrameCore, ingestTimeMs: number): LiveObservation | null {
    const eventTimeMs =
      this.#eventTimeOf(frame) ?? frame.frame * SKILLCORNER_AUTHORIZED_FRAME_INTERVAL_MS;
    const rows: LiveEntityObservation[] = [];
    for (const player of frame.player_data) {
      if (player.x === null || player.y === null) continue; // unpositioned — not observed
      const detected = player.is_detected === true;
      rows.push({
        entityRef: `sc-p-${player.player_id}`,
        kind: "PLAYER",
        position: { xMeters: player.x + this.#originX, yMeters: player.y + this.#originY },
        detected,
        sourceLocalTrackId: String(player.player_id),
        confidence: detected
          ? SKILLCORNER_AUTHORIZED_CONFIDENCE_PRIORS.detected
          : SKILLCORNER_AUTHORIZED_CONFIDENCE_PRIORS.carried,
        observedAtMs: eventTimeMs,
      });
    }
    const ball = frame.ball_data;
    if (ball.x !== null && ball.y !== null) {
      const detected = ball.is_detected === true;
      rows.push({
        entityRef: "sc-ball",
        kind: "BALL",
        position: {
          xMeters: ball.x + this.#originX,
          yMeters: ball.y + this.#originY,
          ...(ball.z !== null && ball.z > 0 ? { zMeters: ball.z } : {}),
        },
        detected,
        sourceLocalTrackId: "ball",
        confidence: detected
          ? SKILLCORNER_AUTHORIZED_CONFIDENCE_PRIORS.detected
          : SKILLCORNER_AUTHORIZED_CONFIDENCE_PRIORS.carried,
        observedAtMs: eventTimeMs,
      });
    }
    if (rows.length === 0) return null;
    return {
      schemaVersion: "sporta.live-observation/1",
      sessionId: this.#sessionId,
      sourceId: this.sourceId,
      sourceType: "TRACKING",
      sequence: frame.frame + 1,
      eventTimeMs,
      ingestTimeMs,
      watermark: { watermarkMs: eventTimeMs, sequence: frame.frame + 1 },
      entityObservations: rows,
      confidence: batchConfidenceOf(rows),
      provenance: "DERIVED",
      quality: "nominal",
    };
  }

  /** Counts one EMITTED batch's rows (emission-time, like the L007 adapter). */
  #accountEmission(batch: LiveObservation): void {
    this.#stats.playerRowsEmitted += batch.entityObservations.filter(
      (row) => row.kind === "PLAYER",
    ).length;
    this.#stats.ballRowsEmitted += batch.entityObservations.filter(
      (row) => row.kind === "BALL",
    ).length;
    this.#stats.carriedRowsEmitted += batch.entityObservations.filter(
      (row) => !row.detected,
    ).length;
  }
}
