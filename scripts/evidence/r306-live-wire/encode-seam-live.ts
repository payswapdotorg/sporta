/**
 * R306 LIVE PUBLIC-WIRE LEG — THE LIVE ENCODE-SEAM DRIVER (DEVELOPMENT-TIME
 * EVIDENCE, not a test): drives the R306 encode seam's client half
 * (`createHttpEncodePair` — BOTH frozen-SYNC encode surfaces, the R306
 * `FrameEncoderPort` AND the R301 `TacticalVideoCodec`) with its DEFAULT
 * bounded `spawnSync` subprocess transport against the E2B sandbox's PUBLIC
 * worker URL at the pinned R306 encode-seam merge — the EXACT network
 * position the hosted Vercel runtime holds when the derived-reality plane
 * composes the injected encode pair over `MEDIA_TOOLCHAIN=http`.
 *
 * What this run PROVES (measured, never asserted from theory):
 *   - the pinned-revision worker advertises the encode seam's FIVE
 *     operations [probe, normalize, decode-probe, decode-frames,
 *     encode-frames] and EXECUTES the ADDITIVE `encode-frames` operation
 *     over the public wire (REAL ffmpeg/libx264 INSIDE the E2B sandbox);
 *   - the pair's ONE cached descriptor probe serves BOTH surfaces (the
 *     cache wall-clock signature: the first probe pays the full child +
 *     public round trip; the subsequent probe answers return without
 *     spawning any child);
 *   - the R306 `FrameEncoderPort` encode over the public wire: the
 *     delivered MP4 bytes re-hashed + re-measured CLIENT-SIDE against the
 *     envelope's own claims (the receiving-boundary law);
 *   - the R301 `TacticalVideoCodec` encode over the SAME wire operation;
 *   - THE BYTE-DRIFT LAW across the public wire: the wire encode's hash vs
 *     the LOCAL adapter's encode of the same frames — measured honestly
 *     (the encoding module's own documented bound: byte-determinism is PER
 *     BUILD; the sandbox's ffmpeg and this machine's ffmpeg are recorded
 *     with the verdict, whatever it measures);
 *   - the ONE-OPERATION ACCOUNTING at the worker: TWO `encode-frames`
 *     POSTs (one per surface) for the happy path + the refusal legs' own
 *     counted dispatches — the ledger identities re-measured over the wire
 *     (stats + the usage drain, two independent reads);
 *   - the transport's TYPED REFUSALS over the public wire: an unreachable
 *     worker URL → the typed `encoder-unavailable` class; the E2B
 *     ephemerality class (a DEAD sandbox's public URL) → the proxy's 502
 *     "The sandbox was not found" passed through the STATUS line and mapped
 *     onto the typed `encode-failed` class; the LIVE worker's honest non-2xx
 *     (it serves no teapot route — its 404 `unknown-route` and 400
 *     `invalid-body` envelopes are recorded verbatim); and a WORKER-SIDE
 *     classified refusal through the REAL pair (a 1 ms media policy → the
 *     real encode executes, then refuses `duration-over-limit` → the typed
 *     `media-invalid`/`frames-invalid` class).
 *
 * HONEST SCOPE: the CLIENT here is this driver (the orchestrating machine),
 * NOT the hosted Vercel runtime — the hosted leg is the SEPARATE hosted
 * golden-path flight (the r607 arc's shape: seam → live wire → deploy →
 * hosted walk).
 *
 * Modes:
 *   --worker-url https://3971-<sandboxId>.e2b.app   REQUIRED — the E2B
 *     worker's public URL (the sandbox must be up; orchestrate-e2b.ts
 *     provisions it).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r306-live-wire/encode-seam-live.ts \
 *     --worker-url https://3971-<sandboxId>.e2b.app
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FfmpegTool,
  childProcessSyncTransport,
  createHttpEncodePair,
  fetchMediaToolchainDescriptor,
  sha256OfBytes,
} from "@sporta/media-platform";
import { assertMediaToolchainAccounting } from "@sporta/compute-adapter-hosted";
import type { MediaToolchainStats } from "@sporta/compute-adapter-hosted";
import { createFfmpegFrameEncoder, EncodingError } from "../../../packages/encoding/src/index";

// ---------------------------------------------------------------------------
// CLI (dev-time: argparse by hand, no deps)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const workerUrlArg = argValue("--worker-url");
if (workerUrlArg === undefined) {
  console.error("FATAL: --worker-url <url> is required (the E2B worker's public URL — no embedded mode in this driver)");
  process.exit(1);
}
const base = workerUrlArg.replace(/\/$/, "");
const outDir = resolve(import.meta.dirname, ".");

/** The worker identity from the provisioning record (sandbox + pinned sha). */
const sandboxRecordPath = join(outDir, "sandbox-record.json");
const sandboxRecord = JSON.parse(readFileSync(sandboxRecordPath, "utf8")) as {
  provider?: {
    sandbox?: { sandboxId?: string };
    pinnedRevision?: { sha?: string };
    toolchain?: { ffmpegVersion?: string | null };
  };
  worker?: { publicUrl?: string; descriptor?: { body?: { toolchain?: { ffmpegVersion?: string | null } } } };
};
const workerIdentity = {
  provider: "E2B",
  sandboxId: sandboxRecord.provider?.sandbox?.sandboxId ?? "unknown",
  pinnedSha: sandboxRecord.provider?.pinnedRevision?.sha ?? "unknown",
  publicUrl: base,
  note: "the pinned R306 encode-seam merge's media-toolchain worker, driven from THIS machine over its public E2B URL — the same network position the hosted runtime's derived-reality plane holds; the revision carries the ADDITIVE encode-frames operation (the worker resolves the REAL FfmpegFrameEncoder)",
};

/** The tiny honest geometry (the r306-encode-seam precedent's own): 16×16 rgb24, 768 B/frame. */
const W = 16;
const H = 16;
const FRAME_BYTES = W * H * 3;

/** Builds N deterministic 16×16 rgb24 frames (the seam precedent's fill law). */
function tinyFrames(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, index) => new Uint8Array(FRAME_BYTES).fill(0x40 + index * 8));
}

/** The encode origin both the wire and the local encode carry (a document field — the adapter's argv derives from geometry/framerate alone). */
const ORIGIN = { rendererId: "r306-live-wire-driver", rendererVersion: "1.0", bridge: "game-3d" };

/** A full wall-clock measurement pair (dev-time measurement code). */
function timedSync<T>(fn: () => T): { value: T; wallMs: number } {
  const startedAt = Date.now();
  const value = fn();
  return { value, wallMs: Math.max(0, Date.now() - startedAt) };
}

/** The fail-closed check accumulator (the r607 validator's own convention). */
const failures: string[] = [];
function requireCheck(name: string, ok: boolean, detail?: string): void {
  if (!ok) failures.push(detail === undefined ? name : `${name} (${detail})`);
}

/** Fetches the worker's stats (the accounting snapshot, over the wire). */
async function fetchStats(): Promise<MediaToolchainStats> {
  const response = await fetch(`${base}/v1/media/stats`);
  if (!response.ok) throw new Error(`stats fetch failed: HTTP ${response.status}`);
  return (await response.json()) as MediaToolchainStats;
}

/** Fetches the worker's usage drain (the independent second read). */
async function fetchUsage(): Promise<{ jobId: string; terminalDisposition?: string }[]> {
  const response = await fetch(`${base}/v1/media/usage`);
  if (!response.ok) throw new Error(`usage fetch failed: HTTP ${response.status}`);
  return (await response.json()) as { jobId: string; terminalDisposition?: string }[];
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------
const localTool = new FfmpegTool();
if (!(await localTool.available())) {
  console.error(
    "FATAL: the local ffmpeg/ffprobe toolchain does not resolve — this evidence run requires a toolchain-capable machine (the byte-drift law's local leg; fail-loud, never faked)",
  );
  process.exit(1);
}
const localFfmpegVersion = await localTool.version();

// --- stage 1: the descriptor (the composition's own client) — the pinned
//     revision MUST advertise the encode seam's FIVE operations.
const descriptorRun = await (async () => {
  const startedAt = Date.now();
  const descriptor = await fetchMediaToolchainDescriptor(base);
  return { descriptor, wallMs: Date.now() - startedAt };
})();
const descriptor = descriptorRun.descriptor;
const advertisedOps = [...descriptor.operations].sort();
const expectedOps = ["decode-frames", "decode-probe", "encode-frames", "normalize", "probe"];
requireCheck(
  "the descriptor advertises the encode seam's FIVE operations",
  advertisedOps.join(",") === expectedOps.join(","),
  `[${advertisedOps.join(", ")}]`,
);
requireCheck("the descriptor's toolchain resolved", descriptor.toolchain.resolved === true);
requireCheck(
  "the worker's ffmpeg identity is present",
  typeof descriptor.toolchain.ffmpegVersion === "string" && descriptor.toolchain.ffmpegVersion.length > 0,
);
console.log(
  `[live] descriptor: operations=[${advertisedOps.join(", ")}] resolved=${String(descriptor.toolchain.resolved)} wall=${descriptorRun.wallMs}ms`,
);

// --- stage 2: the pair with its DEFAULT transport (the bounded spawnSync
//     child — no injected fake). The ONE cached descriptor probe serves BOTH
//     surfaces: the FIRST probe pays the child + the public round trip; the
//     subsequent probe answers return WITHOUT spawning any child (measured
//     by the wall-clock cache signature).
const pair = createHttpEncodePair(base);
const firstProbe = timedSync(() => pair.frameEncoder.available());
requireCheck("the pair is available over the default transport", firstProbe.value === true);
const versionProbe = timedSync(() => pair.frameEncoder.version());
const codecAvailProbe = timedSync(() => pair.tacticalCodec.available());
const codecVersionProbe = timedSync(() => pair.tacticalCodec.version());
requireCheck("the pair's version is the worker's own measured line", versionProbe.value === descriptor.toolchain.ffmpegVersion);
requireCheck("the tactical surface is available (the same cached probe)", codecAvailProbe.value === true);
const cacheWalls = [versionProbe.wallMs, codecAvailProbe.wallMs, codecVersionProbe.wallMs];
requireCheck(
  "the cached probe serves both surfaces (the subsequent probes spawn no child)",
  cacheWalls.every((wall) => wall < 25),
  `subsequent walls [${cacheWalls.join(", ")}]ms vs the first probe's ${firstProbe.wallMs}ms`,
);
console.log(
  `[live] pair probe (cached): available=${String(firstProbe.value)} first=${firstProbe.wallMs}ms subsequent=[${cacheWalls.join(", ")}]ms`,
);

// --- stage 3: the STARTING ledger, read honestly (the driver is re-runnable
//     against a warm worker: the accounting stages below verify measured
//     DELTAS — exactly the dispatches this run makes).
const stats0 = await fetchStats();
const usage0 = await fetchUsage();
assertMediaToolchainAccounting(stats0);
const ledger0 = {
  dispatched: stats0.jobsDispatched,
  succeeded: stats0.succeeded,
  failed: stats0.failed,
  usageRecords: usage0.length,
  note: "the STARTING ledger (measured); the stages below assert exact deltas against it — the identities hold identically on a cold or warm worker",
};

function expectDelta(
  label: string,
  stats: MediaToolchainStats,
  dDispatched: number,
  dSucceeded: number,
  dFailed: number,
): void {
  const got = {
    dispatched: stats.jobsDispatched - stats0.jobsDispatched,
    succeeded: stats.succeeded - stats0.succeeded,
    failed: stats.failed - stats0.failed,
  };
  if (got.dispatched !== dDispatched || got.succeeded !== dSucceeded || got.failed !== dFailed) {
    throw new Error(
      `${label} accounting delta: dispatched+${got.dispatched} succeeded+${got.succeeded} failed+${got.failed} (expected +${dDispatched}/+${dSucceeded}/+${dFailed})`,
    );
  }
}

// --- stage 4: the R306 FrameEncoderPort encode OVER THE PUBLIC WIRE (real
//     ffmpeg/libx264 in the E2B sandbox; deterministic tiny rgb24 frames —
//     the r306-encode-seam precedent's geometry).
const encodeFrames = tinyFrames(2);
const encodeRun = timedSync(() =>
  pair.frameEncoder.encode({
    source: { kind: "rgb24-frames", frames: encodeFrames, width: W, height: H },
    fps: 12.5,
    origin: ORIGIN,
  }),
);
const frameResult = encodeRun.value;
const measuredHash = sha256OfBytes(frameResult.bytes);
const hashVerified = measuredHash === frameResult.contentHash;
const byteLengthVerified = frameResult.bytes.byteLength === frameResult.byteSize;
const ftyp = String.fromCharCode(...frameResult.bytes.subarray(4, 8)) === "ftyp";
requireCheck("the delivered bytes re-hash (the client's own re-measure)", hashVerified);
requireCheck("the delivered bytes re-measure (byte length)", byteLengthVerified);
requireCheck("the MP4 container magic (ftyp)", ftyp);
requireCheck("the PRODUCER's identity rides the result", frameResult.encoderKind === "ffmpeg-libx264");
requireCheck(
  "the geometry claims match the dispatched spec",
  frameResult.frameCount === 2 && frameResult.width === W && frameResult.height === H && frameResult.fps === 12.5,
);
console.log(
  `[live] frameEncoder.encode over the public wire: ${frameResult.byteSize} B, ${frameResult.durationMs} ms clip, wall=${encodeRun.wallMs}ms`,
);

const encodeStats = await fetchStats();
expectDelta("frameEncoder encode", encodeStats, 1, 1, 0);

// --- stage 5: the R301 TacticalVideoCodec over the SAME wire operation (the
//     staged raw frame sequence — 3 frames — read client-side, dispatched as
//     ONE encode-frames POST).
const codecFrames = tinyFrames(3);
const codecScratch = await mkdtemp(join(tmpdir(), "sporta-r306-live-"));
const codecStagedPath = join(codecScratch, "frames.rgb24");
await writeFile(codecStagedPath, Buffer.concat(codecFrames.map((frame) => Buffer.from(frame))));
const codecRun = timedSync(() =>
  pair.tacticalCodec.encode({
    rawFrameSequencePath: codecStagedPath,
    frameCount: 3,
    width: W,
    height: H,
    fps: 12.5,
  }),
);
const codecBuffer = codecRun.value;
const codecFtyp = codecBuffer.subarray(4, 8).toString("ascii") === "ftyp";
requireCheck("the tactical codec's MP4 Buffer", codecFtyp && codecBuffer.byteLength > 0);
console.log(
  `[live] tacticalCodec.encode over the SAME wire op: ${codecBuffer.byteLength} B, wall=${codecRun.wallMs}ms`,
);

const codecStats = await fetchStats();
expectDelta("tacticalCodec encode", codecStats, 2, 2, 0);

// --- stage 6: the one-operation accounting at the worker (the happy path):
//     TWO encode-frames POSTs (one per surface) + the pair's ONE cached
//     descriptor GET — the adapter route is NOT metered by the real worker
//     (its metering starts at job dispatch), so the one-GET law is measured
//     by the pair's cache signature (stage 2): the first probe crossed the
//     public wire ONCE for BOTH surfaces; the seam flight's helper-worker
//     counter measured the same law at exactly 1 GET + 2 POSTs.
const usageAfterHappy = await fetchUsage();
const happyAccounting = {
  stats: codecStats,
  deltas: {
    dispatched: codecStats.jobsDispatched - stats0.jobsDispatched,
    succeeded: codecStats.succeeded - stats0.succeeded,
    failed: codecStats.failed - stats0.failed,
  },
  usageDrainCount: usageAfterHappy.length,
  usageRecordsThisRun: usageAfterHappy.slice(usage0.length).map((u) => ({
    jobId: u.jobId,
    terminalDisposition: u.terminalDisposition ?? null,
  })),
  oneOperationLaw: {
    executePosts: codecStats.jobsDispatched - stats0.jobsDispatched,
    descriptorCrossings: 1,
    note: "BOTH surfaces over the ONE encode-frames wire operation: TWO execute POSTs; the pair's descriptor crossed the public wire ONCE (the cached probe's wall signature: first probe " +
      `${firstProbe.wallMs}ms, the three subsequent probe answers [${cacheWalls.join(", ")}]ms — no child spawned)`,
  },
};
requireCheck(
  "the happy path's accounting (TWO execute POSTs, both terminal succeeded)",
  happyAccounting.deltas.dispatched === 2 &&
    happyAccounting.deltas.succeeded === 2 &&
    happyAccounting.deltas.failed === 0 &&
    happyAccounting.usageRecordsThisRun.length === 2 &&
    happyAccounting.usageRecordsThisRun.every((u) => u.terminalDisposition === "succeeded"),
  JSON.stringify(happyAccounting.deltas),
);

// --- stage 7: THE BYTE-DRIFT LAW across the public wire. Two measured
//     dimensions, recorded honestly:
//       (a) the receiving-boundary law — the delivered bytes re-hashed
//           CLIENT-SIDE against the envelope's own claims (MUST hold; the
//           pair enforces it at the boundary, the driver re-measures
//           independently);
//       (b) the local-vs-wire comparison — the LOCAL adapter's encode of the
//           same frames vs the wire encode's hash. The encoding module's own
//           documented bound: byte-determinism is PER BUILD (the x264
//           bitstream embeds the build's core-version SEI; cross-build
//           byte-stability is NOT claimed) — the sandbox's ffmpeg and this
//           machine's ffmpeg are recorded WITH the verdict, whatever it
//           measures.
const localEncoder = createFfmpegFrameEncoder();
const driftLaw: Record<string, unknown> = {
  receivingBoundary: {
    measuredHash,
    claimedHash: frameResult.contentHash,
    hashVerified,
    byteLengthVerified,
    byteSize: frameResult.byteSize,
    law: "the delivered bytes re-hashed client-side === the envelope's own contentHash claim (a lying claim is never interpreted — the pair refuses it typed)",
  },
  localAdapter: {
    available: localEncoder !== null,
    ffmpegVersion: localEncoder === null ? null : localEncoder.version(),
  },
};
if (localEncoder === null) {
  // The 66-b2 lesson: the factory answers null — never assumed away.
  driftLaw["localVsWire"] = {
    measurable: false,
    refusal:
      "the LOCAL FfmpegFrameEncoder did not resolve on this machine — the cross-build comparison is honestly NOT measured (the receiving-boundary law above still is)",
  };
  requireCheck("the local adapter resolves (the byte-drift law's local leg)", false);
} else {
  const localRun = timedSync(() =>
    localEncoder.encode({
      source: { kind: "rgb24-frames", frames: encodeFrames, width: W, height: H },
      fps: 12.5,
      origin: ORIGIN,
    }),
  );
  const localResult = localRun.value;
  const localHashVerified = sha256OfBytes(localResult.bytes) === localResult.contentHash;
  const byteIdentical =
    localResult.contentHash === frameResult.contentHash && localResult.byteSize === frameResult.byteSize;
  driftLaw["localVsWire"] = {
    measurable: true,
    localContentHash: localResult.contentHash,
    wireContentHash: frameResult.contentHash,
    localByteSize: localResult.byteSize,
    wireByteSize: frameResult.byteSize,
    byteIdentical,
    localHashVerified,
    localWallMs: localRun.wallMs,
    wireWallMs: encodeRun.wallMs,
    workerFfmpegVersion: descriptor.toolchain.ffmpegVersion,
    localFfmpegVersion,
    note: byteIdentical
      ? "the wire encode is byte-identical to the LOCAL adapter's encode of the same frames — the cannot-drift law measured across the public wire (both toolchains produced the same bytes)"
      : "the wire encode and the LOCAL adapter's encode of the same frames DIVERGE — the encoding module's own documented bound measured honestly: byte-determinism is PER BUILD (the sandbox's ffmpeg and this machine's ffmpeg are different builds; the x264 bitstream embeds the build's core-version SEI; cross-build byte-stability is NOT claimed). The law that HOLDS is the receiving-boundary law (hashVerified) + the within-build determinism the seam flight measured at the worker (three runs, one sha)",
  };
  requireCheck("the local encode re-hashes (its own boundary law)", localHashVerified);
  console.log(
    `[live] byte-drift law: local=${localResult.contentHash.slice(0, 16)} wire=${frameResult.contentHash.slice(0, 16)} identical=${String(byteIdentical)} (local ffmpeg ${localFfmpegVersion.split(" ")[2] ?? "?"} vs worker ${String(descriptor.toolchain.ffmpegVersion).split(" ")[2] ?? "?"})`,
  );
}

// --- stage 8: THE TYPED REFUSALS over the public wire (every class
//     measured; every verdict recorded verbatim — a refusal is recorded as
//     a refusal).
interface TypedRefusal {
  refused: boolean;
  failureClass: string | null;
  kind: string | null;
  errorClass: string | null;
  messageExcerpt: string;
  wallMs: number;
}
function typedRefusalOf(call: () => unknown): TypedRefusal {
  const startedAt = Date.now();
  try {
    call();
    return {
      refused: false,
      failureClass: null,
      kind: null,
      errorClass: null,
      messageExcerpt: "answered (never expected)",
      wallMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (err) {
    const wallMs = Math.max(0, Date.now() - startedAt);
    if (err instanceof EncodingError) {
      const details = (err.details ?? {}) as Record<string, unknown>;
      return {
        refused: true,
        failureClass: err.failureClass,
        kind: err.kind,
        errorClass: typeof details["errorClass"] === "string" ? details["errorClass"] : null,
        messageExcerpt: err.message.slice(0, 160),
        wallMs,
      };
    }
    return {
      refused: true,
      failureClass: null,
      kind: null,
      errorClass: null,
      messageExcerpt: `untyped throw: ${String(err).slice(0, 140)}`,
      wallMs,
    };
  }
}

// 8a. the WORKER-SIDE classified refusal through the REAL pair (a 1 ms media
//     policy: the real encode EXECUTES at the worker, then the produced clip
//     refuses the policy bound — the typed media-invalid/frames-invalid
//     class; the mirror of the r607 driver's tiny-budget ResourceLimitError).
const refusalPair = createHttpEncodePair(base, { mediaPolicy: { maxDurationMs: 1 } });
const refusalProbeWall = timedSync(() => refusalPair.frameEncoder.available()).wallMs;
const overLimit = typedRefusalOf(() =>
  refusalPair.frameEncoder.encode({
    source: { kind: "rgb24-frames", frames: encodeFrames, width: W, height: H },
    fps: 12.5,
    origin: ORIGIN,
  }),
);
requireCheck("the 1 ms policy encode REFUSED typed", overLimit.refused && overLimit.failureClass === "media-invalid" && overLimit.kind === "frames-invalid", JSON.stringify(overLimit));
requireCheck("the refusal carries the worker's duration-over-limit class", overLimit.errorClass === "duration-over-limit", JSON.stringify(overLimit));
const refusalStats = await fetchStats();
expectDelta("duration-over-limit refusal", refusalStats, 3, 2, 1);
console.log(
  `[live] worker-side refusal: 1ms policy → ${overLimit.failureClass}/${overLimit.kind} (${overLimit.errorClass}) wall=${overLimit.wallMs}ms`,
);

// 8b. the UNREACHABLE worker URL → the typed encoder-unavailable class (the
//     connection-level unreachable: a public-wire-shaped https URL whose
//     host never resolves — DNS-dead; plus the connection-refused local
//     control, the seam battery's own unreachable shape).
const dnsDeadUrl = "https://3971-r306-unreachable-sandbox.invalid";
const dnsDead = typedRefusalOf(() =>
  childProcessSyncTransport(`${dnsDeadUrl}/v1/media/adapter`, { method: "GET" }, { timeoutMs: 10_000 }),
);
requireCheck("the DNS-dead worker URL is the typed encoder-unavailable", dnsDead.refused && dnsDead.kind === "encoder-unavailable", JSON.stringify(dnsDead));
const connRefused = typedRefusalOf(() =>
  childProcessSyncTransport("http://127.0.0.1:1/v1/media/adapter", { method: "GET" }, { timeoutMs: 10_000 }),
);
requireCheck("the connection-refused control is the typed encoder-unavailable", connRefused.refused && connRefused.kind === "encoder-unavailable", JSON.stringify(connRefused));

// 8c. THE EPHEMERALITY CLASS over the public wire: a DEAD sandbox's public
//     URL (the exact shape the r607 flight measured live when its first
//     sandbox died mid-session) — the E2B port proxy answers the 502 "The
//     sandbox was not found" envelope; through the pair it maps onto the
//     typed encode-failed class (a non-2xx answer, never a faked encode).
const deadSandboxUrl = "https://3971-r306deadwiresandbox.e2b.app";
const deadTransport = (() => {
  const startedAt = Date.now();
  const answer = childProcessSyncTransport(`${deadSandboxUrl}/health`, { method: "GET" }, { timeoutMs: 15_000 });
  return { status: answer.status, body: answer.body.slice(0, 200), wallMs: Math.max(0, Date.now() - startedAt) };
})();
requireCheck("the dead sandbox's public URL answers the proxy's 502 (the ephemerality signature)", deadTransport.status === 502, JSON.stringify(deadTransport));
requireCheck(
  "the 502 body is the ephemerality doctrine's own message",
  deadTransport.body.includes("The sandbox was not found"),
  deadTransport.body,
);
const deadPair = createHttpEncodePair(deadSandboxUrl);
const deadProbe = timedSync(() => deadPair.frameEncoder.available());
requireCheck("the dead-sandbox pair answers available()=false (the cached null probe)", deadProbe.value === false);
const deadEncode = typedRefusalOf(() =>
  deadPair.frameEncoder.encode({
    source: { kind: "rgb24-frames", frames: encodeFrames, width: W, height: H },
    fps: 12.5,
    origin: ORIGIN,
  }),
);
requireCheck("the dead-sandbox encode REFUSED typed (never a faked artifact)", deadEncode.refused && deadEncode.failureClass !== null, JSON.stringify(deadEncode));

// 8d. the LIVE worker's honest non-2xx (it serves NO teapot route — what it
//     actually answers is recorded verbatim): the 404 unknown-route envelope
//     through the transport's STATUS-line passthrough, and the same class
//     through the PAIR (a bogus path prefix → the pair's execute POST hits
//     the 404 → the typed encode-failed class carrying unknown-route).
const unknownRoute = (() => {
  const startedAt = Date.now();
  const answer = childProcessSyncTransport(`${base}/no-such-route`, { method: "GET" }, { timeoutMs: 15_000 });
  let errorClass: string | null = null;
  try {
    errorClass = (JSON.parse(answer.body) as { error?: { errorClass?: string } }).error?.errorClass ?? null;
  } catch {
    errorClass = null;
  }
  return { status: answer.status, errorClass, wallMs: Math.max(0, Date.now() - startedAt) };
})();
requireCheck("the live worker's non-2xx passes through the STATUS line (404)", unknownRoute.status === 404, JSON.stringify(unknownRoute));
requireCheck("the 404 body is the worker's unknown-route envelope", unknownRoute.errorClass === "unknown-route", JSON.stringify(unknownRoute));

const invalidBody = (() => {
  const startedAt = Date.now();
  const answer = childProcessSyncTransport(
    `${base}/v1/media/jobs/execute`,
    { method: "POST", body: "this is not a dispatch" },
    { timeoutMs: 15_000 },
  );
  let errorClass: string | null = null;
  try {
    errorClass = (JSON.parse(answer.body) as { error?: { errorClass?: string } }).error?.errorClass ?? null;
  } catch {
    errorClass = null;
  }
  return { status: answer.status, errorClass, wallMs: Math.max(0, Date.now() - startedAt) };
})();
requireCheck("the malformed dispatch POST is refused 400 (invalid-body)", invalidBody.status === 400 && invalidBody.errorClass === "invalid-body", JSON.stringify(invalidBody));

const bogusPathPair = createHttpEncodePair(`${base}/nope`);
const bogusPath = typedRefusalOf(() =>
  bogusPathPair.frameEncoder.encode({
    source: { kind: "rgb24-frames", frames: encodeFrames, width: W, height: H },
    fps: 12.5,
    origin: ORIGIN,
  }),
);
requireCheck("the pair's non-2xx passthrough is the typed encode-failed carrying unknown-route", bogusPath.refused && bogusPath.failureClass === "internal" && bogusPath.kind === "encode-failed" && bogusPath.errorClass === "unknown-route", JSON.stringify(bogusPath));

// 8e. the non-2xx legs do NOT enter the job ledger (the 404s answer at the
//     route level; the 400 fails the dispatch schema before the worker's
//     execute): the dispatched count is still the three dispatches above.
const postRefusalStats = await fetchStats();
expectDelta("the non-2xx legs (no ledger entries)", postRefusalStats, 3, 2, 1);

const typedRefusals = {
  workerSideClassified: {
    case: "a 1 ms media policy bound — the real encode EXECUTED at the worker, then the produced 160 ms clip refused the policy",
    through: "the REAL pair (createHttpEncodePair with mediaPolicy.maxDurationMs=1)",
    refusal: overLimit,
    pairProbeWallMs: refusalProbeWall,
  },
  unreachable: {
    dnsDead: { url: dnsDeadUrl, refusal: dnsDead },
    connectionRefusedControl: { url: "http://127.0.0.1:1/v1/media/adapter", refusal: connRefused },
    note: "the connection-level unreachable worker URL → the TYPED resource-limit/encoder-unavailable class (the same class the local adapter's missing-binary refusal produces)",
  },
  ephemerality: {
    case: "a DEAD sandbox's public URL — the E2B port proxy's 502 (the ephemerality doctrine's own signature, measured live by the r607 flight when its first sandbox died mid-session)",
    transportPassthrough: deadTransport,
    pairProbe: { available: deadProbe.value, wallMs: deadProbe.wallMs },
    pairEncodeRefusal: deadEncode,
  },
  non2xxPassthrough: {
    liveWorker: {
      note: "the pinned worker serves NO teapot route — what it actually answers is recorded verbatim",
      unknownRoute,
      invalidDispatchBody: invalidBody,
    },
    throughThePair: {
      case: "a bogus path prefix — the pair's execute POST hits the worker's 404 unknown-route",
      refusal: bogusPath,
    },
  },
};

// --- stage 9: the FINAL accounting (the ledger identities, two independent
//     reads: stats + the usage drain) + the worker-stats snapshot.
const finalStats = await fetchStats();
const finalUsage = await fetchUsage();
assertMediaToolchainAccounting(finalStats);
expectDelta("final (2 encodes + 1 refusal)", finalStats, 3, 2, 1);
if (finalUsage.length !== finalStats.jobsDispatched) {
  throw new Error(
    `the usage drain (${finalUsage.length}) disagrees with the dispatched count (${finalStats.jobsDispatched})`,
  );
}
await writeFile(join(outDir, "worker-stats.json"), `${JSON.stringify(finalStats)}\n`);

const accounting = {
  startingLedger: ledger0,
  happyPathSnapshot: happyAccounting,
  stats: finalStats,
  usageDrainCount: finalUsage.length,
  usageRecordsThisRun: finalUsage.slice(usage0.length).map((u) => ({
    jobId: u.jobId,
    terminalDisposition: u.terminalDisposition ?? null,
  })),
  stageDeltas: "frameEncoder +1/1/0, tacticalCodec +1/1/0, the duration-over-limit refusal +1/0/1 — the non-2xx legs (404/400) enter NO ledger bucket",
  identities: "dispatched === succeeded + failed + inFlight; usageRecords === succeeded + failed; stats === the usage drain (two independent reads over the public wire)",
};

// ---------------------------------------------------------------------------
// The measured record (every field measured in THIS run)
// ---------------------------------------------------------------------------
const record = {
  schemaVersion: "1.0",
  kind: "r306-live-wire-encode-seam",
  scope:
    "the client is this driver over the PUBLIC E2B wire (the same network position the hosted runtime holds), driving the R306 encode pair (createHttpEncodePair, the DEFAULT bounded spawnSync transport) against the pinned encode-seam merge's media-toolchain worker; the hosted leg is the separate hosted-golden-path flight",
  workerIdentity,
  localToolchain: { ffmpegVersion: localFfmpegVersion, bunVersion: process.versions.bun ?? "unknown" },
  descriptor: {
    operationsAdvertised: advertisedOps,
    operationsExpected: expectedOps,
    toolchain: {
      ffmpegVersion: descriptor.toolchain.ffmpegVersion,
      resolved: descriptor.toolchain.resolved,
    },
    budgets: descriptor.budgets,
    fetchWallMs: descriptorRun.wallMs,
  },
  stages: {
    pairProbe: {
      firstProbeWallMs: firstProbe.wallMs,
      subsequentProbeWallsMs: cacheWalls,
      available: firstProbe.value,
      version: versionProbe.value,
      note: "the ONE cached descriptor probe serves BOTH surfaces — the first probe pays the child + the public round trip; the subsequent probe answers return without spawning any child (the wall-clock cache signature)",
    },
    frameEncoder: {
      surface: "the R306 FrameEncoderPort",
      wallMs: encodeRun.wallMs,
      byteSize: frameResult.byteSize,
      contentHash: frameResult.contentHash,
      durationMs: frameResult.durationMs,
      frameCount: frameResult.frameCount,
      geometry: `${frameResult.width}x${frameResult.height} @ ${frameResult.fps}fps rgb24`,
      encoderKind: frameResult.encoderKind,
      encoderVersion: frameResult.encoderVersion,
      ftyp,
      reMeasured: { hashVerified, byteLengthVerified },
      accounting: { delta: { dispatched: 1, succeeded: 1, failed: 0 } },
    },
    tacticalCodec: {
      surface: "the R301 TacticalVideoCodec (the SAME encode-frames wire operation)",
      wallMs: codecRun.wallMs,
      byteLength: codecBuffer.byteLength,
      ftyp: codecFtyp,
      accounting: { delta: { dispatched: 1, succeeded: 1, failed: 0 } },
    },
  },
  byteDriftLaw: driftLaw,
  typedRefusals,
  accounting,
};

const outPath = join(outDir, "encode-seam-live.json");
await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`);

// The teardown + the fail-closed verdict.
await rm(codecScratch, { recursive: true, force: true });

console.log("=== R306 encode seam LIVE over the public wire (measured) ===");
console.log(`worker:      ${workerIdentity.sandboxId} @ ${workerIdentity.pinnedSha.slice(0, 7)}`);
console.log(`operations:  [${advertisedOps.join(", ")}]`);
console.log(
  `frameEncoder: ${frameResult.byteSize} B, sha ${frameResult.contentHash.slice(0, 16)}…, wall ${encodeRun.wallMs}ms`,
);
console.log(`tacticalCodec: ${codecBuffer.byteLength} B, wall ${codecRun.wallMs}ms`);
const drift = driftLaw["localVsWire"] as { byteIdentical?: boolean; measurable?: boolean };
console.log(
  `byte-drift:  receiving-boundary hashVerified=${String(hashVerified)}; local-vs-wire ${drift.measurable === false ? "NOT MEASURED (honest refusal)" : `byteIdentical=${String(drift.byteIdentical)}`}`,
);
console.log(
  `accounting:  dispatched=${finalStats.jobsDispatched} (Δ+${finalStats.jobsDispatched - stats0.jobsDispatched}) succeeded=${finalStats.succeeded} failed=${finalStats.failed} (drain ${finalUsage.length})`,
);
console.log(
  `refusals:    1ms-policy → ${overLimit.failureClass}/${overLimit.kind} (${overLimit.errorClass}); DNS-dead → ${dnsDead.kind}; dead-sandbox → ${deadEncode.kind} (${deadTransport.status} passthrough); 404-passthrough → ${bogusPath.errorClass}`,
);
console.log(`record:      ${outPath}`);

if (failures.length > 0) {
  console.error(`[live] REFUSED (${failures.length} failed checks):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("[live] ALL MEASURED CHECKS GREEN");
process.exit(0);
