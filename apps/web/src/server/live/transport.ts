/**
 * THE LIVE SSE TRANSPORT (W915) — the REAL network transport for live
 * SVG-frame streams: HTTP Server-Sent-Events over TCP.
 *
 * WHY THIS TRANSPORT (the honest architecture for THIS deployment target):
 * WebRTC needs a media server this deployment does not have; the product's
 * live streams are SVG frame documents, and SSE is a GENUINE network
 * transport for them — real HTTP streaming with real-time delivery,
 * browser-native consumption (`EventSource`), and a measurable end-to-end
 * latency (per-frame server generation timestamp → client receipt). The
 * in-process W305/W704 loopback path stays what it is (in-process —
 * Simulation F: it is NEVER presented as live network).
 *
 * THE CONTRACT (compute-adapter style — the seams a host composes):
 *
 * - `registerSource` — the dev seed registers a live-authorized session's
 *   real story timeline (the engine outputs + the identity-attested policy);
 * - `subscribe(sessionId)` — opens ONE subscriber on the source's channel:
 *   the channel starts ticking on its FIRST subscriber (real cadence; each
 *   tick is a fresh REAL render through the live producer) and stops when
 *   the last subscriber leaves (no orphaned generation loops);
 * - the subscriber pulls pre-encoded SSE event blocks (`nextEvent`) —
 *   bounded per-subscriber buffer, drop-oldest with COUNTED drops (the
 *   ordinal gap is visible to the consumer; never a silent skip);
 * - `close()` — ends the subscriber; `closeAll()` ends every channel with a
 *   terminal `close` event (test/shutdown hygiene).
 *
 * STATES: `active` (the env gate resolved `SPORTA_LIVE_TRANSPORT=sse`) vs
 * `unavailable` (anything else). The capability response is wired to THIS
 * state — `modes.live.transportKind` is `live-network` only while this
 * transport is actually serving.
 *
 * PURITY: no wall-clock reads (`nowMs` injected), no env reads (the caller
 * resolves the env gate — composition-root rule), no network I/O (the HTTP
 * side is the route's `Response` over this transport's events). The only
 * timers are the injectable scheduler (tests drive it deterministically).
 */
import type { AuthorizationPolicy } from "@sporta/contracts";
import type { AnimeClipStep } from "@sporta/renderer-anime";
import {
  encodeSseJson,
  type LiveCloseDoc,
  type LiveFrameDoc,
  type LiveHelloDoc,
  type LiveWorldFrameDoc,
} from "@/lib/live-sse";
import { createStoryFrameProducer } from "./producer";
import type { LiveFrameMeta } from "./producer";
import { createTacticalFrameProducer } from "./view-model";
import type { LiveTacticalRegistration } from "./view-model";

// ---------------------------------------------------------------------------
// The ports
// ---------------------------------------------------------------------------

/** One registered live source: a live-authorized session's real timeline. */
export interface LiveSourceRegistration {
  sessionId: string;
  /** The session's display label (the control plane's `sourceLabel`). */
  label: string;
  /** The story key (`dev-seed` fixture identity — honestly labeled). */
  storyKey: string;
  /** The real story timeline steps (per-wave engine outputs). */
  steps: readonly AnimeClipStep[];
  /** The identity-attested policy the live rights derive from. */
  policy: AuthorizationPolicy;
  /** The engine's snapshot version (the render admission gate). */
  snapshotVersion: number;
  /** The engine's watermark sequence (the render event cursor). */
  watermarkSequence: number;
  /**
   * L005 (additive): the live TACTICAL view-model registration — when
   * present, the channel's producer is the live tactical view-model (the
   * L002 deterministic tracking source projected to world frames, `world`
   * events on the wire) instead of the story timeline's animated-SVG
   * `frame` events. The transport itself is unchanged (channels,
   * subscribers, bounded buffers, close semantics) — only the producer
   * seam is re-pointed, exactly the L005 scaffold's instruction.
   */
  tactical?: LiveTacticalRegistration;
}

/** The honest status of one live channel (all real counters). */
export interface LiveChannelStatus {
  sessionId: string;
  /** Subscribers currently attached. */
  subscribers: number;
  /** Frames really emitted since the channel opened (0 when idle). */
  framesEmitted: number;
  /** Frames dropped from subscribers' bounded buffers (counted, per channel). */
  droppedFrames: number;
  /** Real clock of the last emission (`null` before the first). */
  lastFrameAtMs: number | null;
  cadenceMs: number;
  bufferDepth: number;
}

/** One consuming subscriber on a live channel. */
export interface LiveSubscriber {
  /** The channel's session id. */
  readonly sessionId: string;
  /**
   * Pulls the next SSE event block (already wire-encoded). Resolves `null`
   * when the stream has ENDED (channel closed / transport shutdown) — the
   * consumer has already received the terminal `close` event.
   */
  nextEvent(): Promise<string | null>;
  /** Detaches the subscriber (idempotent; the channel may keep ticking). */
  close(): void;
  /** This subscriber's honest accounting. */
  stats(): { deliveredFrames: number; droppedFrames: number };
}

/** The transport states feeding the capability response. */
export type LiveTransportState = "unavailable" | "active";

/** The live transport port (the seam the routes + capability compose). */
export interface LiveTransport {
  /** The honest state (env-gated at construction — never re-evaluated). */
  state(): LiveTransportState;
  /** The honest detail line (travels in provider feeds / status routes). */
  detail(): string;
  /** The registered live sources (empty when unavailable). */
  listSources(): LiveSourceRegistration[];
  /** Registers a live source (idempotent by sessionId — last write wins). */
  registerSource(source: LiveSourceRegistration): void;
  /** Removes a source; its channel (if any) ends with `source-removed`. */
  removeSource(sessionId: string): void;
  /**
   * Opens one subscriber. `null` when the transport is unavailable or the
   * session has no registered source (the route maps that honestly).
   */
  subscribe(sessionId: string): LiveSubscriber | null;
  /** The channel's honest status (`null` when never opened). */
  status(sessionId: string): LiveChannelStatus | null;
  /** Ends every channel + subscriber (tests/shutdown). */
  closeAll(): void;
}

/** The injectable scheduler (tests drive ticks deterministically). */
export interface LiveScheduler {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** The REAL scheduler (Node/Bun timers). */
const realScheduler: LiveScheduler = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]),
};

// ---------------------------------------------------------------------------
// The bounded per-subscriber event queue
// ---------------------------------------------------------------------------

/**
 * A bounded FIFO of wire-encoded events with counted drop-oldest overflow.
 *
 * TWO lanes (ordered): CONTROL events (hello/close) are unbounded — the
 * stream's own framing and terminal accounting must always arrive; FRAME
 * events are bounded (drop-oldest, counted) — the backpressure lane.
 */
class BoundedEventQueue {
  private readonly controls: string[] = [];
  private readonly frames: string[] = [];
  private readonly waiters: ((value: string | null) => void)[] = [];
  private ended = false;

  constructor(private readonly capacity: number) {}

  /** Pushes a CONTROL event (hello/close): unbounded, never dropped. */
  pushControl(item: string): void {
    if (this.ended) return;
    this.controls.push(item);
    this.wake();
  }

  /** Pushes a FRAME event: bounded, drop-oldest, counted. */
  push(item: string): void {
    if (this.ended) return;
    if (this.frames.length >= this.capacity && this.capacity > 0) {
      // Drop-oldest backpressure: the LOSS IS COUNTED by the channel (the
      // consumer sees the ordinal gap — never a silent skip).
      this.dropHandler?.();
      this.frames.shift();
    }
    this.frames.push(item);
    this.wake();
  }

  /** Resolves the oldest waiting puller, if any. */
  private wake(): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter(this.take() ?? null);
  }

  /** The next item in order (controls first, then frames). */
  private take(): string | undefined {
    const control = this.controls.shift();
    if (control !== undefined) return control;
    return this.frames.shift();
  }

  /** Ends the queue: pending pullers resolve `null`; further pushes no-op. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  async next(): Promise<string | null> {
    const item = this.take();
    if (item !== undefined) return item;
    if (this.ended) return null;
    return await new Promise<string | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  get depth(): number {
    return this.controls.length + this.frames.length;
  }

  /** Set by the owning subscriber (counted drops). */
  dropHandler: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// The channel (one live source's tick loop + subscribers)
// ---------------------------------------------------------------------------

/** One emission the channel fans out (the story SVG frame OR the tactical world frame). */
interface ChannelEmission {
  event: "frame" | "world";
  id: string;
  payload: LiveFrameDoc | LiveWorldFrameDoc;
}

/** One live channel: the source's tick loop and its subscribers. */
class LiveChannel {
  private readonly subscribers = new Map<number, { queue: BoundedEventQueue; dropped: number }>();
  private nextSubscriberId = 1;
  private timer: unknown = undefined;
  private framesEmitted = 0;
  private droppedFrames = 0;
  private lastFrameAtMs: number | null = null;
  private readonly producer: { next: (meta: LiveFrameMeta) => ChannelEmission };
  private closed = false;

  constructor(
    private readonly source: LiveSourceRegistration,
    private readonly transport: {
      nowMs: () => number;
      cadenceMs: number;
      bufferDepth: number;
      scheduler: LiveScheduler;
    },
  ) {
    if (source.tactical !== undefined) {
      // L005: the live tactical view-model producer — the W915 producer
      // seam re-pointed at the view-model (the transport is NOT forked:
      // channels, buffers and close semantics are exactly the same).
      const tactical = createTacticalFrameProducer({
        sessionId: source.sessionId,
        nowMs: transport.nowMs,
        ...source.tactical,
      });
      this.producer = {
        next: (meta: LiveFrameMeta): ChannelEmission => {
          const { frame } = tactical.next(meta);
          return { event: "world", id: String(frame.ordinal), payload: frame };
        },
      };
    } else {
      const story = createStoryFrameProducer({
        sessionId: source.sessionId,
        steps: source.steps,
        policy: source.policy,
        snapshotVersion: source.snapshotVersion,
        watermarkSequence: source.watermarkSequence,
        nowMs: transport.nowMs,
        storyKey: source.storyKey,
      });
      this.producer = {
        next: (meta: LiveFrameMeta): ChannelEmission => {
          const frame = story.next(meta);
          return { event: "frame", id: String(frame.ordinal), payload: frame };
        },
      };
    }
  }

  subscribe(onEnd: () => void): LiveSubscriber {
    const id = this.nextSubscriberId;
    this.nextSubscriberId += 1;
    const queue = new BoundedEventQueue(this.transport.bufferDepth);
    const entry = { queue, dropped: 0 };
    queue.dropHandler = () => {
      entry.dropped += 1;
      this.droppedFrames += 1;
    };
    this.subscribers.set(id, entry);

    const hello: LiveHelloDoc = {
      schemaVersion: "sporta.live-sse/1",
      sessionId: this.source.sessionId,
      label: this.source.label,
      storyKey: this.source.storyKey,
      sourceKind: this.source.tactical !== undefined ? "tactical" : "story",
      cadenceMs: this.transport.cadenceMs,
      bufferDepth: this.transport.bufferDepth,
      openedAtMs: this.transport.nowMs(),
    };
    queue.pushControl(encodeSseJson("hello", this.source.sessionId, hello));

    if (this.timer === undefined) {
      // The FIRST subscriber starts the real cadence loop.
      this.timer = this.transport.scheduler.setInterval(() => {
        void this.tick();
      }, this.transport.cadenceMs);
    }

    const subscriber: LiveSubscriber = {
      sessionId: this.source.sessionId,
      nextEvent: () => queue.next(),
      close: () => {
        if (!this.subscribers.has(id)) return; // idempotent
        this.subscribers.delete(id);
        if (this.subscribers.size === 0) this.stopTicking();
        onEnd();
      },
      stats: () => ({ deliveredFrames: this.framesEmitted, droppedFrames: entry.dropped }),
    };
    return subscriber;
  }

  /** ONE real emission: a fresh render fanned out to every subscriber. */
  tick(): void {
    if (this.closed || this.subscribers.size === 0) return;
    this.framesEmitted += 1;
    const emission = this.producer.next({
      sessionId: this.source.sessionId,
      ordinal: this.framesEmitted,
    });
    this.lastFrameAtMs = this.transport.nowMs();
    const block = encodeSseJson(emission.event, emission.id, emission.payload);
    for (const entry of this.subscribers.values()) entry.queue.push(block);
  }

  /** Ends the channel with the terminal close event (reason required). */
  end(reason: LiveCloseDoc["reason"]): void {
    if (this.closed) return;
    this.closed = true;
    this.stopTicking();
    for (const entry of this.subscribers.values()) {
      const close: LiveCloseDoc = {
        reason,
        deliveredFrames: this.framesEmitted,
        droppedFrames: this.droppedFrames,
      };
      entry.queue.pushControl(encodeSseJson("close", undefined, close));
      entry.queue.end();
    }
    this.subscribers.clear();
  }

  status(): LiveChannelStatus {
    return {
      sessionId: this.source.sessionId,
      subscribers: this.subscribers.size,
      framesEmitted: this.framesEmitted,
      droppedFrames: this.droppedFrames,
      lastFrameAtMs: this.lastFrameAtMs,
      cadenceMs: this.transport.cadenceMs,
      bufferDepth: this.transport.bufferDepth,
    };
  }

  private stopTicking(): void {
    if (this.timer !== undefined) {
      this.transport.scheduler.clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

/** Options for {@link createSseLiveTransport}. */
export interface SseLiveTransportOptions {
  /** The env gate, resolved by the CALLER (composition root — no env reads here). */
  active: boolean;
  /** The injected clock (epoch ms). */
  nowMs: () => number;
  /** The real emission cadence in ms (default 500; bounds 100..5000). */
  cadenceMs?: number;
  /** The per-subscriber bounded buffer depth (default 8; min 1). */
  bufferDepth?: number;
  /** The injectable scheduler (tests drive ticks deterministically). */
  scheduler?: LiveScheduler;
}

/**
 * Creates the SSE live transport. The transport keeps registered sources in
 * EVERY state (the registrations are data); `subscribe` serves them only
 * while `active`, and `listSources` reports them only while `active` — the
 * honest unavailable state never lists a source it is not serving.
 */
export function createSseLiveTransport(options: SseLiveTransportOptions): LiveTransport {
  const cadenceMs = clamp(options.cadenceMs ?? 500, 100, 5000);
  const bufferDepth = Math.max(1, options.bufferDepth ?? 8);
  const scheduler = options.scheduler ?? realScheduler;
  const deps = { nowMs: options.nowMs, cadenceMs, bufferDepth, scheduler };
  const sources = new Map<string, LiveSourceRegistration>();
  const channels = new Map<string, LiveChannel>();
  let shutdown = false;

  return {
    state(): LiveTransportState {
      return options.active ? "active" : "unavailable";
    },
    detail(): string {
      return options.active
        ? `SSE live transport — real HTTP streaming at ${cadenceMs}ms cadence (bounded ${bufferDepth}-frame subscriber buffers, drop-oldest counted)`
        : "SSE live transport not configured (SPORTA_LIVE_TRANSPORT absent) — live stays honestly unavailable";
    },
    listSources(): LiveSourceRegistration[] {
      if (!options.active) return [];
      return [...sources.values()];
    },
    registerSource(source: LiveSourceRegistration): void {
      sources.set(source.sessionId, { ...source });
    },
    removeSource(sessionId: string): void {
      sources.delete(sessionId);
      channels.get(sessionId)?.end("source-removed");
      channels.delete(sessionId);
    },
    subscribe(sessionId: string): LiveSubscriber | null {
      if (!options.active || shutdown) return null;
      const source = sources.get(sessionId);
      if (source === undefined) return null;
      let channel = channels.get(sessionId);
      if (channel === undefined) {
        channel = new LiveChannel(source, deps);
        channels.set(sessionId, channel);
      }
      return channel.subscribe(() => {
        const current = channels.get(sessionId);
        if (current !== undefined && current.status().subscribers === 0) {
          // The last subscriber left: the channel stops ticking (kept for
          // its status history until the source goes away).
        }
      });
    },
    status(sessionId: string): LiveChannelStatus | null {
      return channels.get(sessionId)?.status() ?? null;
    },
    closeAll(): void {
      shutdown = true;
      for (const channel of channels.values()) channel.end("transport-closed");
      channels.clear();
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
