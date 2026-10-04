/**
 * Environment-driven media-toolchain selection (R607 lane B) — the
 * COMPOSITION helper (not domain code): resolves which
 * `MediaToolchainExecutor` a composition root wires into the media
 * platform, from configuration only:
 *
 * - `MEDIA_TOOLCHAIN=in-process` (the DEFAULT, including unset): the REAL
 *   `FfmpegTool` in this process, resolving ffmpeg/ffprobe via
 *   `Bun.which` — the byte-identical default (the non-degradation law).
 *   When the binaries do not resolve, every operation refuses with the
 *   typed `FfmpegUnavailableError` — the honest ffprobe-absent admission
 *   refusal (the R607 hosted finding, unchanged);
 * - `MEDIA_TOOLCHAIN=http`: the SAME REAL operations dispatched over real
 *   HTTP to the toolchain worker at `MEDIA_TOOLCHAIN_URL` (a local
 *   Bun-served `@sporta/compute-adapter-hosted` media worker, or the
 *   EXTERNAL toolchain worker URL a hosted control plane configures —
 *   the seam that closes the hosted media half once such a worker exists
 *   beyond the Hobby boundary).
 *
 * This module reads `process.env` BY DESIGN (composition-root concern;
 * the domain modules — service/normalize/ffmpeg/toolchain-* — read NO
 * globals: clocks are injected, there is no env access, the only I/O is
 * the caller-supplied seams). The default clock is the real wall clock —
 * again a composition-root decision.
 */
import { FfmpegTool } from "./ffmpeg";
import { InProcessMediaToolchain } from "./toolchain-executor";
import { createHttpMediaToolchain } from "./toolchain-http";
import { createHttpDecodePort } from "./decode-http";
import { createHttpEncodePair } from "./encode-http";
import type { DecodingService } from "@sporta/decoding";
import type { HttpEncodePair, SyncHttpTransport } from "./encode-http";
import type { MediaToolchainExecutor } from "./toolchain";

/** The toolchain-selection vocabulary (closed). */
export type MediaToolchainSelection = "in-process" | "http";

/** What the resolver answers. */
export interface ResolvedMediaToolchain {
  /** The selected toolchain mode. */
  toolchain: MediaToolchainSelection;
  /** The worker URL (present iff `toolchain === "http"`). */
  workerUrl: string | null;
  /**
   * The executor the media platform wires in (`undefined` for the default
   * `in-process` selection — the caller may omit it so the service
   * constructs its own default seam; ALWAYS defined for `http`).
   */
  executor: MediaToolchainExecutor | undefined;
  /**
   * The R607 Gap 1 DECODE PORT (the injected seam `RealToSwmPipeline`
   * accepts): the http decode executor when `toolchain === "http"`, and
   * `undefined` for the `in-process` default — the pipeline then constructs
   * its OWN local `FfmpegDecoderAdapter` path, byte-identical to the
   * pre-seam behavior (the non-degradation law). Structurally a
   * `DecodingService` — the exact `RealToSwmDecodePort` shape.
   */
  decodePort: DecodingService | undefined;
  /**
   * The R306 ENCODE PAIR (the injected seam `createDerivedRealityPlane`
   * accepts — the G12 walk's named next gap, the same seam-class the decode
   * seam closed): BOTH frozen-SYNC encode surfaces (the R306
   * `FrameEncoderPort` + the R301 `TacticalVideoCodec`) over the ONE
   * `encode-frames` wire operation, when `toolchain === "http"`; and
   * `undefined` for the `in-process` default — the plane then probes its
   * OWN LOCAL ffmpeg+libx264 toolchain exactly as before, byte-identical
   * (the non-degradation law).
   */
  encodePair: HttpEncodePair | undefined;
  /** The tool the in-process selection resolves (the `Bun.which` answer). */
  tool: FfmpegTool | null;
}

/** Options for {@link resolveMediaToolchainFromEnv}. */
export interface ResolveMediaToolchainOptions {
  /** The environment to read (default `process.env`; tests inject). */
  env?: Record<string, string | undefined>;
  /** The injected wall clock (default `Date.now` — the composition root). */
  nowMs?: () => number;
  /** Override the in-process ffmpeg wrapper (default: a stock `FfmpegTool`). */
  tool?: FfmpegTool;
  /** Override fetch (tests inject). */
  fetchFn?: typeof fetch;
  /** The synchronous transport the http encode pair rides (tests inject). */
  encodeTransport?: SyncHttpTransport;
  /** Override the http dispatch deadline (default 120 000 ms). */
  deadlineMs?: number;
  /** Override the media policy the http dispatches carry (default: R101's bound). */
  mediaPolicy?: { maxDurationMs: number };
}

/** Reads + validates the toolchain selection from the environment. */
export function mediaToolchainSelectionOf(
  env: Record<string, string | undefined> = process.env,
): MediaToolchainSelection {
  const raw = env["MEDIA_TOOLCHAIN"];
  if (raw === undefined || raw === "") return "in-process";
  if (raw === "in-process" || raw === "http") return raw;
  throw new Error(`MEDIA_TOOLCHAIN must be one of "in-process" | "http" (got '${raw}')`);
}

/**
 * Resolves the media toolchain from the environment (see module docs).
 * Throws loudly on an incomplete "http" configuration.
 */
export function resolveMediaToolchainFromEnv(
  options: ResolveMediaToolchainOptions = {},
): ResolvedMediaToolchain {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now;
  const selection = mediaToolchainSelectionOf(env);
  if (selection === "http") {
    const workerUrl = env["MEDIA_TOOLCHAIN_URL"];
    if (workerUrl === undefined || workerUrl === "") {
      throw new Error("MEDIA_TOOLCHAIN=http requires MEDIA_TOOLCHAIN_URL");
    }
    return {
      toolchain: "http",
      workerUrl,
      executor: createHttpMediaToolchain(workerUrl, {
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
        ...(options.mediaPolicy === undefined ? {} : { mediaPolicy: options.mediaPolicy }),
      }),
      // The R607 Gap 1 seam's client half: the SAME worker URL, wired as the
      // R207 pipeline's injected decode port.
      decodePort: createHttpDecodePort(workerUrl, {
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
        ...(options.mediaPolicy === undefined ? {} : { mediaPolicy: options.mediaPolicy }),
      }),
      // The R306 encode seam's client half: the SAME worker URL, wired as
      // the derived-reality plane's injected encode pair.
      encodePair: createHttpEncodePair(workerUrl, {
        ...(options.encodeTransport === undefined ? {} : { transport: options.encodeTransport }),
        ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
        ...(options.mediaPolicy === undefined ? {} : { mediaPolicy: options.mediaPolicy }),
      }),
      tool: null,
    };
  }
  const tool = options.tool ?? new FfmpegTool();
  return {
    toolchain: "in-process",
    workerUrl: null,
    executor: new InProcessMediaToolchain({ tool, nowMs }),
    // The non-degradation law: NO decode port for the in-process default —
    // the pipeline constructs its own LOCAL ffmpeg adapter path.
    decodePort: undefined,
    // The non-degradation law: NO encode pair for the in-process default —
    // the derived-reality plane probes its own LOCAL ffmpeg+libx264
    // toolchain exactly as before (the pre-seam code path, unchanged).
    encodePair: undefined,
    tool,
  };
}
