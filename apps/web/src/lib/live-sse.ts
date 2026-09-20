/**
 * THE LIVE SSE WIRE FORMAT (W915) — the exact Server-Sent-Events grammar the
 * live transport speaks over the real HTTP network.
 *
 * This module is the ONE definition shared by every side (server encoder,
 * test parser, evidence script, and — through the same grammar — the
 * browser's native `EventSource`), so what curl reads and what the browser
 * reads are the same bytes by construction.
 *
 * THE GRAMMAR (a closed subset of the SSE spec — unknown event names are
 * ignored by consumers, never guessed):
 *
 * ```
 * event: hello          ← first event: the stream's real session meta
 * id: <streamId>
 * data: {"sessionId":…,"label":…,"cadenceMs":…,…}
 *
 * event: frame          ← ONE really-generated frame (the payload is JSON)
 * id: <ordinal>         ← the frame ordinal (gap detection: the consumer
 * data: {…}                counts ordinals it never saw — never silent)
 *
 * event: close          ← terminal: the transport closed the stream
 * data: {"reason":…,"deliveredFrames":…,"droppedFrames":…}
 *
 * : keepalive           ← a comment line every 15s of silence (proxy-safe)
 * ```
 *
 * `data:` payloads are JSON objects (one per event; the encoder splits
 * multi-line payloads into consecutive `data:` lines per the SSE spec, and
 * the parser joins them back with `\n`).
 */

/** One SSE event on the wire. */
export interface SseEvent {
  /** The event name (`hello` | `frame` | `close` — the closed vocabulary). */
  event: string;
  /** The event id (the frame ordinal for `frame`; the stream id for `hello`). */
  id?: string;
  /** The event's data (a JSON document string for every event here). */
  data: string;
}

/** The keepalive comment (an SSE comment line — ignored by consumers). */
export const SSE_KEEPALIVE = ": keepalive\n\n";

/** How often the server emits the keepalive when no frame is flowing (ms). */
export const SSE_KEEPALIVE_INTERVAL_MS = 15_000;

/** The closed event-name vocabulary. */
export const LIVE_SSE_EVENTS = ["hello", "frame", "world", "close"] as const;
export type LiveSseEventName = (typeof LIVE_SSE_EVENTS)[number];

/**
 * The `hello` payload: the stream's real session meta.
 */
export interface LiveHelloDoc {
  schemaVersion: "sporta.live-sse/1";
  sessionId: string;
  label: string;
  storyKey: string;
  /**
   * L005: the live source's producer kind (honest labeling — the story
   * timeline's animated-SVG frames, or the live tactical view-model's
   * world-state frames).
   */
  sourceKind: "story" | "tactical";
  /** The transport's real emission cadence (ms between frame events). */
  cadenceMs: number;
  /** The per-subscriber bounded buffer depth (drop-oldest backpressure). */
  bufferDepth: number;
  /** Real server clock at stream open (ms). */
  openedAtMs: number;
}

/** The `frame` payload: one really-generated frame + its real timestamps. */
export interface LiveFrameDoc {
  schemaVersion: "sporta.live-sse/1";
  sessionId: string;
  /** Monotonic frame ordinal on the stream (gap = counted loss). */
  ordinal: number;
  /** The story wave this frame renders (the dev-seed timeline position). */
  storyStepIndex: number;
  /** The story-relative time of that wave (ms). */
  storyAtMs: number;
  /** The complete SVG document (a real render product, `image/svg+xml`). */
  svg: string;
  byteLength: number;
  /** Real server clock read AFTER the render completed (ms). */
  generatedAtMs: number;
  /** The render's real execution duration (ms, server clock). */
  renderDurationMs: number;
}

/**
 * The `world` payload (L005): ONE live tactical view-model frame — the
 * server-side projection of the live world state (entities + identity
 * continuity + honest detection/quality state) the browser tactical
 * renderer consumes. This is the wire shape of the frozen live-reality.md
 * §5 `LiveRenderInput` semantics as delivered to the browser: the
 * `worldState`, the `eventsSincePreviousFrame` and the render clock all
 * ride one document; the renderer's §9 telemetry stubs measure against
 * these fields.
 */
export interface LiveWorldFrameDoc {
  schemaVersion: "sporta.live-tactical/1";
  sessionId: string;
  /** Monotonic frame ordinal on the stream (gap = counted loss). */
  ordinal: number;
  /** The view-model's monotonically advancing world version (per observation). */
  worldVersion: number;
  /** The observation's event time (ms on the session timeline — authoritative). */
  eventTimeMs: number;
  /** The source's conservative contiguous watermark at this observation. */
  watermark: { watermarkMs: number; sequence: number };
  /** The source's 1-based emission sequence (visible gaps on drop scenarios). */
  sourceSequence: number;
  /** The source's honest quality at this observation. */
  quality: "nominal" | "degraded";
  /** The batch's own confidence summary (min/mean over the entities). */
  confidence: { min: number; mean: number };
  /** The projected entities — identity CONTINUOUS by entityRef across frames. */
  entities: {
    entityRef: string;
    kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
    teamRef?: string;
    /** Canonical pitch-frame position (105 x 68 m). */
    xMeters: number;
    yMeters: number;
    /** Whether the source detected the entity at THIS event time. */
    detected: boolean;
    confidence: number;
    /** ms since the entity's last DETECTED observation (0 when detected). */
    staleForMs: number;
  }[];
  /**
   * The world events since the previous delivered frame — the honest
   * accounting kind (recovery gaps, quality transitions, entity
   * appear/disappear, detection regain), never fabricated match events.
   */
  eventsSincePreviousFrame: {
    type:
      | "source-recovery"
      | "quality-degraded"
      | "quality-nominal"
      | "entity-appeared"
      | "entity-lost"
      | "entity-regained";
    atMs: number;
    detail?: { entityRef?: string; missedUpdates?: number; gapDurationMs?: number };
  }[];
  /** Real server clock read AFTER the projection completed (ms). */
  generatedAtMs: number;
  /** The projection's real execution duration (ms, server clock). */
  renderDurationMs: number;
  /** The view-model's own telemetry (the §9 counters it can measure). */
  telemetry: {
    /** The source's watermark lag at emission (eventTime − watermark, ms). */
    watermarkLagMs: number;
    /** Entities honestly carried as last-known (undetected this frame). */
    undetectedEntities: number;
    /** Whether this frame was emitted by a fresh replay cycle (labeled). */
    replayCycle: boolean;
  };
}

/** The `close` payload: why the stream ended + the honest accounting. */
export interface LiveCloseDoc {
  reason: "transport-closed" | "source-removed" | "server-shutdown";
  deliveredFrames: number;
  droppedFrames: number;
}

/** Encodes one event as SSE bytes (`\n`-terminated block, blank line after). */
export function encodeSseEvent(event: SseEvent): string {
  let out = `event: ${event.event}\n`;
  if (event.id !== undefined) out += `id: ${event.id}\n`;
  // The SSE spec: a payload with newlines is one `data:` line per line.
  for (const line of event.data.split("\n")) {
    out += `data: ${line}\n`;
  }
  return `${out}\n`;
}

/** Encodes a JSON-payload event (the closed vocabulary this transport uses). */
export function encodeSseJson(
  event: LiveSseEventName,
  id: string | undefined,
  payload: unknown,
): string {
  return encodeSseEvent({ event, id, data: JSON.stringify(payload) });
}

/**
 * A push-friendly SSE parser: feed it the raw text chunks as they arrive off
 * the network; it yields the COMPLETE events (comment/keepalive lines and
 * partial lines are buffered/handled per the SSE grammar). Used by the
 * tests and the evidence script — the browser consumes the same bytes
 * through its native `EventSource`.
 */
export function createSseParser(): {
  write: (chunk: string) => SseEvent[];
  /** Ends the stream; returns a trailing event if the bytes ended mid-block. */
  end: () => SseEvent[];
} {
  let buffer = "";
  const completeBlocks: SseEvent[] = [];

  function parseBlock(block: string): SseEvent | null {
    let event = "message";
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const rawLine of block.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.length === 0 || line.startsWith(":")) continue; // blank/comment
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trimStart();
      } else if (line.startsWith("id:")) {
        id = line.slice("id:".length).trimStart();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataLines.length === 0) return null; // a comment-only block
    return { event, id, data: dataLines.join("\n") };
  }

  return {
    write(chunk: string): SseEvent[] {
      // SSE line endings: CRLF, CR, or LF all terminate a line — normalize
      // first so block boundaries (`\n\n`) are unambiguous.
      buffer += chunk.replace(/\r\n?/g, "\n");
      const emitted: SseEvent[] = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseBlock(block);
        if (parsed !== null) {
          completeBlocks.push(parsed);
          emitted.push(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
      return emitted;
    },
    end(): SseEvent[] {
      const trailing = buffer.length > 0 ? parseBlock(buffer) : null;
      buffer = "";
      return trailing !== null ? [trailing] : [];
    },
  };
}

/** Parses a JSON-payload event (typed cast after the parser validated shape). */
export function ssePayloadOf<T>(event: SseEvent): T {
  return JSON.parse(event.data) as T;
}
