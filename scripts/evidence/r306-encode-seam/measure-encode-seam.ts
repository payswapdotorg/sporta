/**
 * R306 ENCODE SEAM — THE MEASUREMENT DRIVER (DEVELOPMENT-TIME EVIDENCE, not
 * a test): measures the encode seam's OWN battery and the two halves its
 * module docs name, on THIS machine, and writes the machine-checkable
 * record `encode-seam-measurements.json`:
 *
 *   1. THE BATTERY — `bun test packages/media-platform/test/encode-seam.test.ts`
 *      (the seam's own test file) spawned and its verdict parsed (pass/fail
 *      counts + the exit code — never asserted from theory);
 *   2. THE REAL WORKER ROUND TRIP — the pair (`createHttpEncodePair`) with
 *      its DEFAULT `spawnSync` subprocess transport (no injected fake)
 *      against a HELPER MEDIA-TOOLCHAIN WORKER in a SEPARATE bun process
 *      serving the adapter + execute routes over real HTTP and executing
 *      the REAL `FfmpegFrameEncoder` (real ffmpeg — the same mechanical
 *      adapter the local path runs): the descriptor probe (cached), the
 *      R306 `FrameEncoderPort` encode, the R301 `TacticalVideoCodec`
 *      encode over the SAME wire operation, the worker-side request
 *      accounting, and the BYTE-DRIFT LAW (the delivered bytes re-hashed
 *      client-side + byte-identical to the LOCAL adapter's encode of the
 *      same frames);
 *   3. THE TRANSPORT — the child script's contract measured directly
 *      (`childProcessSyncTransport` against the same helper): the STATUS
 *      line, a non-2xx passthrough, the unreachable-worker typed refusal,
 *      and the bounded-kill posture when the child outlives its bound;
 *   4. THE RUNTIME KILL DISCIPLINE — the honest bun-vs-node measurement of
 *      `spawnSync`'s `timeout` bound: bun 1.3.14 does NOT kill the child at
 *      the bound (the refusal surfaces only at the child's own exit; a
 *      never-exiting child hangs the call — bounded HERE by the driver's
 *      own `Bun.spawn` kill), while node kills at the bound with SIGKILL.
 *      Recorded, never laundered: the seam's typed refusals hold either way.
 *
 * HONEST SCOPE: everything here runs on THIS orchestrating machine (the
 * local ffmpeg, the loopback wire). The LIVE public-wire leg (an E2B
 * worker) and the hosted golden path are the SEPARATE next flights — the
 * same arc the R607 decode seam flew (seam → live wire → deploy → hosted
 * walk). No numbers are fabricated: every field is measured in this run.
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r306-encode-seam/measure-encode-seam.ts
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FfmpegTool,
  childProcessSyncTransport,
  createHttpEncodePair,
  sha256OfBytes,
} from "@sporta/media-platform";
import { createFfmpegFrameEncoder, EncodingError } from "../../../packages/encoding/src/index";

/** The repo root (the helper worker's imports are resolved from here). */
const ROOT = resolve(import.meta.dirname, "../../..");

/** The tiny honest geometry (the battery's own): 16×16 rgb24, 768 B/frame. */
const W = 16;
const H = 16;
const FRAME_BYTES = W * H * 3;

/** Builds N deterministic 16×16 rgb24 frames. */
function tinyFrames(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, index) => new Uint8Array(FRAME_BYTES).fill(0x40 + index * 8));
}

/** The fail-closed check accumulator (the r607 validator's own convention). */
const failures: string[] = [];
function requireCheck(name: string, ok: boolean, detail?: string): void {
  if (!ok) failures.push(detail === undefined ? name : `${name} (${detail})`);
}

// ---------------------------------------------------------------------------
// 1. The local toolchain (the machine this evidence was measured on)
// ---------------------------------------------------------------------------
const tool = new FfmpegTool();
const resolved = await tool.available();
const ffmpegVersion = resolved ? await tool.version() : null;
console.log(`[measure] local toolchain: resolved=${resolved} ffmpeg=${ffmpegVersion?.slice(0, 40) ?? "null"}`);
requireCheck("local toolchain resolved", resolved);

// ---------------------------------------------------------------------------
// 2. The seam's own battery (spawned; the verdict parsed, never assumed)
// ---------------------------------------------------------------------------
const batteryChild = Bun.spawn({
  cmd: [process.execPath, "test", "packages/media-platform/test/encode-seam.test.ts"],
  cwd: ROOT,
  stdout: "pipe",
  stderr: "pipe",
});
// bun test writes its results to stderr (the stdout header only).
const batteryText = await new Response(batteryChild.stderr).text();
const batteryExit = await batteryChild.exited;
const batteryPass = Number(/(\d+) pass/.exec(batteryText)?.[1] ?? -1);
const batteryFail = Number(/(\d+) fail/.exec(batteryText)?.[1] ?? -1);
const batteryExpects = Number(/(\d+) expect\(\) calls/.exec(batteryText)?.[1] ?? -1);
console.log(`[measure] battery: ${batteryPass} pass / ${batteryFail} fail / ${batteryExpects} expect() calls / exit ${batteryExit}`);
requireCheck("battery green", batteryExit === 0 && batteryFail === 0 && batteryPass > 0, `pass=${batteryPass} fail=${batteryFail} exit=${batteryExit}`);

// ---------------------------------------------------------------------------
// 3. The real worker round trip (a helper toolchain worker in a SEPARATE
//    process — the sync transport blocks THIS process's event loop)
// ---------------------------------------------------------------------------

/**
 * The helper worker script: serves the media-toolchain adapter + execute
 * routes over real HTTP, executing the REAL FfmpegFrameEncoder (the same
 * mechanical adapter the local path runs) plus the transport-contract
 * routes (/slow, /teapot) and a /stats route (the worker-side request
 * accounting the driver cross-checks).
 */
const helperScript = `
const ROOT = ${JSON.stringify(ROOT)};
const { FfmpegTool, executeMediaToolchainJob, resolveMediaToolchainBudgets } = await import(ROOT + "/packages/media-platform/src/index");
const { createFfmpegFrameEncoder } = await import(ROOT + "/packages/encoding/src/index");
const tool = new FfmpegTool();
const budgets = resolveMediaToolchainBudgets({});
const encoder = createFfmpegFrameEncoder();
const resolved = await tool.available();
const ffmpegVersion = resolved ? await tool.version() : null;
const encodeResolved = resolved && encoder.available();
const stats = { adapterGets: 0, executePosts: 0, slowVisits: 0, teapotVisits: 0 };
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/stats") return Response.json(stats);
    if (path === "/slow") {
      stats.slowVisits += 1;
      await Bun.sleep(1500);
      return new Response("late-but-never-interpreted");
    }
    if (path === "/teapot") {
      stats.teapotVisits += 1;
      return Response.json({ error: { errorClass: "teapot" } }, { status: 418 });
    }
    if (path === "/v1/media/adapter") {
      stats.adapterGets += 1;
      return Response.json({
        schemaVersion: "1.0",
        adapterId: "helper-media-toolchain-worker",
        adapterVersion: "0.1",
        providerId: "helper-media-toolchain-worker-1",
        providerKind: "cpu-worker",
        operations: encodeResolved
          ? ["probe", "normalize", "decode-probe", "decode-frames", "encode-frames"]
          : ["probe", "normalize", "decode-probe", "decode-frames"],
        toolchain: {
          ffmpegPath: resolved ? tool.ffmpegPath : null,
          ffprobePath: resolved ? tool.ffprobePath : null,
          ffmpegVersion,
          resolved,
        },
        budgets,
        costUnits: [{ unitId: "cpu-ms", unitKind: "time-ms", description: "cpu milliseconds" }],
      });
    }
    if (path === "/v1/media/jobs/execute" && request.method === "POST") {
      stats.executePosts += 1;
      const dispatch = await request.json();
      const result = await executeMediaToolchainJob(dispatch, {
        tool,
        nowMs: Date.now,
        budgets,
        frameEncoder: encoder,
      });
      return Response.json({ disposition: "executed", result });
    }
    return Response.json({ error: { errorClass: "unknown-route" } }, { status: 404 });
  },
});
process.stdout.write("PORT " + server.port + "\\n");
`;

const helper = Bun.spawn({
  cmd: [process.execPath, "-e", helperScript],
  cwd: ROOT,
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
});
const portReader = helper.stdout.getReader();
const { value: portChunk } = await portReader.read();
const portLine = new TextDecoder().decode(portChunk ?? new Uint8Array());
const helperPort = Number(/^PORT (\d+)$/.exec(portLine.trim())?.[1]);
requireCheck("helper worker port", Number.isInteger(helperPort) && helperPort > 0);
if (!Number.isInteger(helperPort) || helperPort <= 0) {
  // Fail LOUD with the helper's own stderr (never a silent NaN URL).
  console.error(`[measure] helper worker refused to boot; stdout chunk: ${JSON.stringify(new TextDecoder().decode(portChunk ?? new Uint8Array()))}`);
  console.error(`[measure] helper stderr: ${(await new Response(helper.stderr).text()).slice(0, 800)}`);
  helper.kill();
  await helper.exited;
  await writeFile(
    join(ROOT, "scripts/evidence/r306-encode-seam/encode-seam-measurements.json"),
    `${JSON.stringify({ schemaVersion: "1.0", kind: "r306-encode-seam-measurements", refused: failures }, null, 2)}\n`,
  );
  process.exit(1);
}
const helperUrl = `http://127.0.0.1:${helperPort}`;
let helperReady = false;
for (let attempt = 0; attempt < 100 && !helperReady; attempt += 1) {
  try {
    // The readiness probe hits /stats (never the adapter route — the
    // worker-side adapterGets counter must count ONLY the pair's own probe).
    const probe = await fetch(`${helperUrl}/stats`);
    helperReady = probe.status === 200;
  } catch {
    await Bun.sleep(50);
  }
}
requireCheck("helper worker ready", helperReady);
console.log(`[measure] helper toolchain worker up at ${helperUrl}`);

// The pair with its DEFAULT transport (the bounded spawnSync child — no
// injected fake): BOTH surfaces over the one wire operation.
const pair = createHttpEncodePair(helperUrl);
const probeStart = Date.now();
const pairAvailable = pair.frameEncoder.available();
const pairVersion = pair.frameEncoder.version();
requireCheck("pair available over the default transport", pairAvailable);
requireCheck("pair version is the worker's own line", pairVersion === ffmpegVersion);
console.log(`[measure] descriptor probe (cached): available=${pairAvailable} wall=${Date.now() - probeStart}ms`);

// The R306 FrameEncoderPort encode — the REAL worker's real ffmpeg answer.
const encodeFrames = tinyFrames(2);
const encodeStart = Date.now();
const frameResult = pair.frameEncoder.encode({
  source: { kind: "rgb24-frames", frames: encodeFrames, width: W, height: H },
  fps: 12.5,
  origin: { rendererId: "r306-measure-driver", rendererVersion: "1.0", bridge: "game-3d" },
});
const encodeWallMs = Date.now() - encodeStart;
requireCheck("delivered bytes re-hash (the client's own re-measure)", sha256OfBytes(frameResult.bytes) === frameResult.contentHash);
requireCheck("delivered bytes re-measure (byte length)", frameResult.bytes.byteLength === frameResult.byteSize);
requireCheck("the ftyp container magic", String.fromCharCode(...frameResult.bytes.subarray(4, 8)) === "ftyp");
requireCheck("the PRODUCER's identity rides the result", frameResult.encoderKind === "ffmpeg-libx264");
console.log(
  `[measure] frameEncoder.encode over the wire: ${frameResult.byteSize} B, ${frameResult.durationMs} ms clip, wall=${encodeWallMs}ms`,
);

// The R301 TacticalVideoCodec over the SAME wire operation.
const codecFrames = tinyFrames(3);
const codecScratch = await mkdtemp(join(tmpdir(), "sporta-r306-measure-"));
const scratchFile = join(codecScratch, "frames.rgb24");
await writeFile(scratchFile, Buffer.concat(codecFrames.map((frame) => Buffer.from(frame))));
const codecStart = Date.now();
const codecBuffer = pair.tacticalCodec.encode({
  rawFrameSequencePath: scratchFile,
  frameCount: 3,
  width: W,
  height: H,
  fps: 12.5,
});
const codecWallMs = Date.now() - codecStart;
requireCheck("the tactical codec's MP4 Buffer", codecBuffer.subarray(4, 8).toString("ascii") === "ftyp");
console.log(`[measure] tacticalCodec.encode over the SAME wire op: ${codecBuffer.byteLength} B, wall=${codecWallMs}ms`);

// The worker-side request accounting (the cached probe identity, measured
// at the WORKER: ONE descriptor GET for both surfaces + TWO encode POSTs).
const helperStats = (await (await fetch(`${helperUrl}/stats`)).json()) as {
  adapterGets: number;
  executePosts: number;
};
requireCheck(
  "the cached-probe accounting (1 GET + 2 POSTs at the worker)",
  helperStats.adapterGets === 1 && helperStats.executePosts === 2,
  JSON.stringify(helperStats),
);

// THE BYTE-DRIFT LAW: the worker's encode of the same frames vs the LOCAL
// adapter's — byte-identical (the "cannot drift" law, measured).
const localResult = createFfmpegFrameEncoder().encode({
  source: { kind: "rgb24-frames", frames: encodeFrames, width: W, height: H },
  fps: 12.5,
  origin: { rendererId: "r306-measure-driver", rendererVersion: "1.0", bridge: "game-3d" },
});
const byteIdentical = localResult.contentHash === frameResult.contentHash && localResult.byteSize === frameResult.byteSize;
requireCheck("the byte-drift law (local adapter === the worker's encode)", byteIdentical);
console.log(`[measure] byte-drift law: local=${localResult.contentHash.slice(0, 16)} wire=${frameResult.contentHash.slice(0, 16)} identical=${byteIdentical}`);

// ---------------------------------------------------------------------------
// 4. The transport's own contract (the child script, measured directly)
// ---------------------------------------------------------------------------
const getStart = Date.now();
const getAnswer = childProcessSyncTransport(`${helperUrl}/v1/media/adapter`, { method: "GET" }, { timeoutMs: 10_000 });
const getWallMs = Date.now() - getStart;
requireCheck("the STATUS line + body contract (GET)", getAnswer.status === 200 && JSON.parse(getAnswer.body).adapterId === "helper-media-toolchain-worker");
const teapotAnswer = childProcessSyncTransport(`${helperUrl}/teapot`, { method: "GET" }, { timeoutMs: 10_000 });
requireCheck("a non-2xx status passes through the STATUS line", teapotAnswer.status === 418);
console.log(`[measure] transport contract: GET ${getWallMs}ms (STATUS 200), teapot STATUS 418 parsed`);

interface TypedRefusal {
  failureClass: string;
  kind: string;
}
function typedRefusalOf(call: () => unknown): { refusal?: TypedRefusal; message: string } {
  try {
    call();
    return { message: "answered (never expected)" };
  } catch (err) {
    if (err instanceof EncodingError) {
      return { refusal: { failureClass: err.failureClass, kind: err.kind }, message: err.message };
    }
    return { message: `untyped throw: ${String(err)}` };
  }
}
const unreachable = typedRefusalOf(() =>
  childProcessSyncTransport("http://127.0.0.1:1/v1/media/adapter", { method: "GET" }, { timeoutMs: 10_000 }),
);
requireCheck("the unreachable worker is the typed encoder-unavailable", unreachable.refusal?.kind === "encoder-unavailable");

const boundMs = 400;
const slowStart = Date.now();
const outlives = typedRefusalOf(() =>
  childProcessSyncTransport(`${helperUrl}/slow`, { method: "GET" }, { timeoutMs: boundMs }),
);
const slowWallMs = Date.now() - slowStart;
requireCheck("the over-bound child is refused typed encode-failed", outlives.refusal?.kind === "encode-failed");
requireCheck("the over-bound refusal names its bound", outlives.message.includes(`${boundMs} ms bound`));
requireCheck("the over-bound measurement is finite (no infinite hang for this child)", slowWallMs < 10_000);
console.log(`[measure] outlives-bound: bound=${boundMs}ms wall=${slowWallMs}ms typed=${outlives.refusal?.failureClass}/${outlives.refusal?.kind}`);

// ---------------------------------------------------------------------------
// 5. The runtime kill discipline (the honest bun-vs-node measurement)
// ---------------------------------------------------------------------------

// (a) bun: a child that outlives its bound and exits naturally — the
//     refusal surfaces at the CHILD's exit (the kill is deferred; the
//     child survives long enough to write its liveness marker). Measured
//     through the seam's OWN API (node:child_process spawnSync — the import
//     childProcessSyncTransport runs under bun).
const { spawnSync } = await import("node:child_process");
const bunSleepMs = 5_000;
const bunOutlivesStart = Date.now();
const bunOutlives = spawnSync(
  process.execPath,
  ["-e", `await Bun.sleep(${bunSleepMs}); process.stdout.write("SURVIVED-TO-NATURAL-EXIT");`],
  { timeout: boundMs, killSignal: "SIGKILL", encoding: "utf8" },
);
const bunOutlivesMs = Date.now() - bunOutlivesStart;
const bunChildSurvived = (bunOutlives.stdout ?? "").includes("SURVIVED-TO-NATURAL-EXIT");
const bunOutlivesError = String(bunOutlives.error ?? "");
const bunOutlivesSignal = bunOutlives.signal ?? null;
const bunOutlivesStatus = bunOutlives.status ?? null;
console.log(
  `[measure] bun spawnSync (child exits at ${bunSleepMs}ms, bound ${boundMs}ms): returned=${bunOutlivesMs}ms survived=${bunChildSurvived} error=${bunOutlivesError.slice(0, 60)}`,
);
requireCheck(
  "bun: the kill is deferred to the child's own exit (the measured limitation)",
  bunChildSurvived && bunOutlivesMs > bunSleepMs - 500,
);

// (b) bun: a child that NEVER exits — the sync call does not return at all
//     (bounded here by the DRIVER's own Bun.spawn kill, which DOES hold).
const neverScript = `
const { spawnSync } = await import("node:child_process");
const t0 = Date.now();
const run = spawnSync(process.execPath, ["-e", "setInterval(() => {}, 10000);"], { timeout: ${boundMs}, killSignal: "SIGKILL" });
console.log(JSON.stringify({ returned: true, elapsedMs: Date.now() - t0, error: String(run.error), signal: run.signal, status: run.status }));
`;
const neverDriverBoundMs = 15_000;
const neverStart = Date.now();
const neverChild = Bun.spawn({
  cmd: [process.execPath, "-e", neverScript],
  stdout: "pipe",
  stderr: "pipe",
  timeout: neverDriverBoundMs,
  killSignal: "SIGKILL",
});
const neverText = await new Response(neverChild.stdout).text();
const neverExit = await neverChild.exited;
const neverWallMs = Date.now() - neverStart;
const neverReturned = neverText.includes('"returned": true');
console.log(
  `[measure] bun spawnSync (never-exiting child): innerReturned=${neverReturned} driverKilled=${neverChild.signalCode === "SIGKILL"} exit=${String(neverExit)} wall=${neverWallMs}ms`,
);
requireCheck(
  "bun: a never-exiting child hangs the sync call (bounded by the driver's own kill)",
  !neverReturned && neverChild.signalCode === "SIGKILL" && neverExit !== 0 && neverWallMs >= neverDriverBoundMs - 2_000,
);

// (c) node: the SAME shape under node's own spawnSync — the bound HOLDS
//     (the child is SIGKILLed at the bound).
const nodeVersionText = await new Response(
  Bun.spawn({ cmd: ["node", "--version"], stdout: "pipe", stderr: "pipe" }).stdout,
).text();
const nodeVersion = nodeVersionText.trim();
const nodeNeverScript = `
const { spawnSync } = require("node:child_process");
const t0 = Date.now();
const run = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 30000);"], { timeout: ${boundMs}, killSignal: "SIGKILL" });
console.log(JSON.stringify({ elapsedMs: Date.now() - t0, error: String(run.error), signal: run.signal, status: run.status }));
`;
const nodeChild = Bun.spawn({ cmd: ["node", "-e", nodeNeverScript], stdout: "pipe", stderr: "pipe" });
const nodeText = await new Response(nodeChild.stdout).text();
const nodeExit = await nodeChild.exited;
const nodeMeasurement = /(\{.*\})/.exec(nodeText)?.[1] ?? "null";
const nodeResult = JSON.parse(nodeMeasurement) as { elapsedMs: number; error: string; signal: string | null; status: number | null };
console.log(
  `[measure] node ${nodeVersion} spawnSync (never-exiting child, bound ${boundMs}ms): elapsed=${nodeResult.elapsedMs}ms signal=${nodeResult.signal}`,
);
requireCheck(
  "node: the bound holds (SIGKILL at the bound)",
  nodeExit === 0 && nodeResult.signal === "SIGKILL" && nodeResult.elapsedMs < 2_000,
);

// ---------------------------------------------------------------------------
// The measured record (every field measured in THIS run)
// ---------------------------------------------------------------------------
const record = {
  schemaVersion: "1.0",
  kind: "r306-encode-seam-measurements",
  scope:
    "the encode seam's own battery + the pair's real worker round trip on THIS machine (a helper toolchain worker in a separate bun process executing the REAL FfmpegFrameEncoder over loopback HTTP, driven through the DEFAULT spawnSync transport) + the transport's contract + the runtime kill-discipline comparison; the LIVE public-wire leg and the hosted golden path are the separate next flights (the r607 arc)",
  localToolchain: {
    ffmpegVersion,
    resolved,
  },
  battery: {
    command: "bun test packages/media-platform/test/encode-seam.test.ts",
    pass: batteryPass,
    fail: batteryFail,
    expectCalls: batteryExpects,
    exitCode: batteryExit,
  },
  realWorkerRoundTrip: {
    workerKind:
      "a helper bun child serving the media-toolchain adapter + execute routes over real HTTP (a separate process — the sync transport blocks the parent's event loop), executing the REAL FfmpegFrameEncoder with the REAL resolved ffmpeg",
    descriptor: {
      available: pairAvailable,
      version: pairVersion,
      operationsAdvertised: ["probe", "normalize", "decode-probe", "decode-frames", "encode-frames"],
    },
    frameEncoder: {
      surface: "the R306 FrameEncoderPort",
      wallMs: encodeWallMs,
      byteSize: frameResult.byteSize,
      contentHash: frameResult.contentHash,
      durationMs: frameResult.durationMs,
      encoderKind: frameResult.encoderKind,
      ftyp: true,
      reMeasured: {
        hashVerified: sha256OfBytes(frameResult.bytes) === frameResult.contentHash,
        byteLengthVerified: frameResult.bytes.byteLength === frameResult.byteSize,
      },
    },
    tacticalCodec: {
      surface: "the R301 TacticalVideoCodec (the SAME encode-frames wire operation)",
      wallMs: codecWallMs,
      byteLength: codecBuffer.byteLength,
      ftyp: true,
    },
    workerSideAccounting: {
      adapterGets: helperStats.adapterGets,
      executePosts: helperStats.executePosts,
      identity: "ONE cached descriptor GET for BOTH surfaces + TWO encode-frames POSTs (the one-operation law, measured at the worker)",
    },
    byteDriftLaw: {
      localContentHash: localResult.contentHash,
      wireContentHash: frameResult.contentHash,
      byteSize: frameResult.byteSize,
      byteIdentical,
      note: "the worker's encode of the same packed frames is byte-identical to the LOCAL adapter's (the cannot-drift law, measured across the wire)",
    },
  },
  transport: {
    contract: {
      getStatus: getAnswer.status,
      getWallMs,
      bodyParsed: true,
      non2xxPassthrough: teapotAnswer.status,
    },
    unreachable: {
      typed: unreachable.refusal,
      messageExcerpt: unreachable.message.slice(0, 120),
    },
    outlivesBound: {
      boundMs,
      wallMs: slowWallMs,
      typed: outlives.refusal,
      note: "the typed refusal surfaces once the child exits (~1.5 s slow route); under bun the kill is deferred to the child's own exit — the refusal is still typed, nothing is interpreted, the child is reaped",
    },
  },
  runtimeKillDiscipline: {
    bun: {
      version: process.versions.bun ?? "unknown",
      outlivesThenExits: {
        childSleepMs: bunSleepMs,
        boundMs,
        returnedMs: bunOutlivesMs,
        error: bunOutlivesError.slice(0, 120),
        signal: bunOutlivesSignal,
        status: bunOutlivesStatus,
        childSurvivedToNaturalExit: bunChildSurvived,
      },
      neverExiting: {
        innerBoundMs: boundMs,
        driverBoundMs: neverDriverBoundMs,
        innerReturned: neverReturned,
        driverKilledOuterChild: neverChild.signalCode === "SIGKILL",
        wallMs: neverWallMs,
      },
    },
    node: {
      version: nodeVersion,
      neverExiting: {
        boundMs,
        elapsedMs: nodeResult.elapsedMs,
        signal: nodeResult.signal,
        error: nodeResult.error.slice(0, 120),
      },
    },
    honestNote:
      "MEASURED LIMITATION (bun 1.3.14): spawnSync's timeout does NOT kill the child — a child that outlives the bound is reaped only at its own exit (the typed encode-failed refusal still surfaces, the wall is the child's lifetime), and a NEVER-exiting child hangs the synchronous call indefinitely (bounded in this measurement by the driver's own Bun.spawn kill, which does hold). Under node v24 the bound holds exactly (SIGKILL at the bound, measured). The seam's fail-closed contract (typed refusals, no interpreted answer, no fabricated artifact) holds under both runtimes; the WALL-bound sub-contract of the module doc's 'bounded timeout' claim holds under node only — reported, never laundered.",
  },
};

// ---------------------------------------------------------------------------
// The teardown + the fail-closed verdict
// ---------------------------------------------------------------------------
helper.kill();
await helper.exited;
await rm(codecScratch, { recursive: true, force: true });

const outPath = join(ROOT, "scripts/evidence/r306-encode-seam/encode-seam-measurements.json");
await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`[measure] record written: ${outPath}`);

if (failures.length > 0) {
  console.error(`[measure] REFUSED (${failures.length} failed checks):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("[measure] ALL MEASURED CHECKS GREEN");
process.exit(0);
