/**
 * r606-visual-gate-prep — the R606 HUMAN VISUAL GATE's preparation driver.
 *
 * The gate itself is the OPERATOR'S eyes (never a worker's): "A human can
 * watch the outputs and identify the same match/event and see meaningful
 * stylistic differences" (docs/roadmap/mvp-reality-engine-roadmap.md, R606).
 * This driver makes the gate PERFORMABLE: it renders the four realities
 * through the REAL pipeline (the golden-path battery's own walk — the same
 * composition, the same pitch-scene clip, the same in-process compute with
 * REAL local ffmpeg) and EXPORTS the four MP4s OUTSIDE the repo for the
 * operator to watch. The repo keeps NO committed media fixture (the
 * standing doctrine) — the outputs are operator-viewing material, the
 * record is the repo's evidence.
 *
 * The walk (the golden-path battery's shape, byte-for-byte semantics):
 *   register → upload (REAL ffmpeg pitch clip) → the media job terminal →
 *   the four render dispatches (anime.prototype + tactical/three-d/
 *   anime-npr.prototype, the user-explicit compute selection) → the jobs
 *   terminal → the watch acquisition → the four kinds' byte-route reads
 *   (sha-256 re-verified, ftyp) → the files saved.
 *
 * Modes:
 *   --out <dir>            REQUIRED — the output dir (OUTSIDE the repo; the
 *                          four MP4s + manifest.json land there; no dead
 *                          default, fail-closed).
 *   --duration-seconds <n> the clip's length (default 2 — the battery's own).
 *   --scene <name>         the clip's scene (default "pitch" — the battery's
 *                          own: three detectable players on a green field).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r606-visual-gate/visual-gate-prep.ts \
 *     --out /home/z/my-project/public/r606
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createDeterministicTestHasher } from "../../../packages/identity/src/index";
import { generateTestMp4, sha256OfBytes } from "../../../packages/media-platform/src/index";
import { createSportaServer, installSportaServerForTests } from "../../../apps/web/src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../../../apps/web/src/server/auth-service";
import { InMemoryRedis } from "../../../apps/web/src/server/platform/upstash/redis";
import { POST as registerRoute } from "../../../apps/web/src/app/api/auth/register/route";
import { POST as uploadSessionRoute } from "../../../apps/web/src/app/api/create/upload-sessions/route";
import { POST as renderRoute } from "../../../apps/web/src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../../../apps/web/src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { GET as mediaJobRoute } from "../../../apps/web/src/app/api/media/jobs/[jobId]/route";
import { GET as watchRoute } from "../../../apps/web/src/app/api/watch/[sessionId]/route";
import { GET as realitiesRoute } from "../../../apps/web/src/app/api/watch/[sessionId]/realities/route";
import { GET as videoRoute } from "../../../apps/web/src/app/api/watch/[sessionId]/realities/[kind]/artifacts/[artifactId]/content/route";
import { videoDescriptorOf } from "../../../apps/web/src/lib/reality-catalog";
import type { SessionArtifactCatalogLike } from "../../../apps/web/src/lib/api-types";

// ---------------------------------------------------------------------------
// CLI (dev-time: argparse by hand, no deps)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const outArg = argValue("--out");
if (outArg === undefined) {
  console.error("FATAL: --out <dir> is required (the operator-viewing output dir — outside the repo)");
  process.exit(1);
}
const outDir = resolve(outArg);
const durationSeconds = Number(argValue("--duration-seconds") ?? "2") || 2;
const sceneArg = argValue("--scene") ?? "pitch";
if (sceneArg !== "bars" && sceneArg !== "pitch" && sceneArg !== "pitch-marked") {
  console.error(`FATAL: --scene must be bars | pitch | pitch-marked (got ${sceneArg})`);
  process.exit(1);
}
const scene: "bars" | "pitch" | "pitch-marked" = sceneArg;
const here = dirname(new URL(import.meta.url).pathname);
const recordPath = join(here, "visual-gate-prep.json");

/** The battery's deterministic stepping clock (the proven walk shape). */
function steppingClock(): () => number {
  let current = 2_222_222_222_000;
  return () => {
    current += 17;
    return current;
  };
}

function withCookie(token: string, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      cookie: `${SPORTA_SESSION_COOKIE}=${token}`,
    },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function jsonPost(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function fail(step: string, detail: string): never {
  console.error(`FATAL [${step}]: ${detail}`);
  process.exit(1);
}

const KINDS = ["original", "tactical", "three-d-game", "anime-npr"] as const;

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------
const record: Record<string, unknown> = {
  schemaVersion: 1,
  kind: "r606-visual-gate-prep",
  ts: new Date().toISOString(),
  provenance: {
    note:
      "The R606 gate's preparation: the four realities rendered LOCALLY through the REAL " +
      "pipeline (the golden-path battery's own walk shape — the same composition, the same " +
      "pitch-scene clip, the same in-process compute with REAL local ffmpeg; the hosted " +
      "plane's 4/4 closure is measured separately at scripts/evidence/r306-hosted-reflight/). " +
      "The GATE itself is the operator's eyes; this record is the prep's own honest state.",
    clip: { scene, durationSeconds, generator: "generateTestMp4 (REAL ffmpeg, no committed fixture)" },
  },
  walk: {} as Record<string, unknown>,
  outputs: [] as unknown[],
};

async function main(): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "r606-visual-gate-"));
  try {
    // --- the server (the battery's exact composition) ---
    const server = createSportaServer({
      nowMs: steppingClock(),
      passwordHasher: createDeterministicTestHasher(),
      transient: { redis: new InMemoryRedis(steppingClock()), provider: "in-memory" },
      seed: true,
      media: { db: ":memory:" },
    });
    installSportaServerForTests(server);
    await server.ready;
    const providerId = server.selection?.providerId ?? "";
    if (providerId === "") fail("compose", "the selection plane returned no providerId");
    (record.walk as Record<string, unknown>).providerId = providerId;

    // --- register the clean browser ---
    const username = `r606-gate-${Date.now().toString(36)}`;
    const registerResponse = await registerRoute(
      new Request("http://sporta.test/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password: "r606-visual-gate-password",
          roles: ["creator", "viewer"],
        }),
      }),
    );
    if (registerResponse.status !== 200) fail("register", `HTTP ${registerResponse.status}`);
    const registerBody = (await bodyOf(registerResponse)) as { userId: string };
    const session = await server.auth.issueSession({ userId: registerBody.userId });
    const token = session.token;
    (record.walk as Record<string, unknown>).register = { http: 200, username };

    // --- the REAL clip (the battery's pitch scene) ---
    const clipPath = await generateTestMp4(join(scratch, "r606-clip.mp4"), {
      durationSeconds,
      withAudio: true,
      scene,
    });
    const clipBytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer());
    if (clipBytes.byteLength <= 1024) fail("clip", `too small: ${clipBytes.byteLength} B`);
    (record.provenance as Record<string, unknown>).clipBytes = clipBytes.byteLength;
    (record.provenance as Record<string, unknown>).clipSha256 = sha256OfBytes(clipBytes);

    // --- the upload (the R101/R501 seams) ---
    const form = new FormData();
    form.append(
      "file",
      new File([clipBytes.slice().buffer as ArrayBuffer], "r606.mp4", { type: "video/mp4" }),
    );
    form.append(
      "operations",
      JSON.stringify(["analysis", "transformation", "derivativeGeneration", "storage"]),
    );
    form.append("label", "The R606 visual-gate clip");
    const uploadResponse = await uploadSessionRoute(
      withCookie(token, "/api/create/upload-sessions", { method: "POST", body: form }),
    );
    if (uploadResponse.status !== 201) fail("upload", `HTTP ${uploadResponse.status}`);
    const uploadBody = (await bodyOf(uploadResponse)) as {
      sessionId: string;
      source: { job: { jobId: string; state: string } | null };
      perception: { frameCount: number };
    };
    const sessionId = uploadBody.sessionId;
    const mediaJobId = uploadBody.source?.job?.jobId ?? "";
    if (sessionId === "" || mediaJobId === "") fail("upload", "sessionId or mediaJobId missing");
    (record.walk as Record<string, unknown>).upload = {
      http: 201,
      sessionId,
      mediaJobId,
      perceptionFrameCount: uploadBody.perception?.frameCount ?? null,
    };

    // --- the media job walks to terminal ---
    let mediaState = "";
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const response = await mediaJobRoute(withCookie(token, `/api/media/jobs/${mediaJobId}`), {
        params: Promise.resolve({ jobId: mediaJobId }),
      });
      if (response.status !== 200) fail("media-job", `HTTP ${response.status}`);
      const job = (await bodyOf(response)) as { state: string; terminal: boolean };
      mediaState = job.state;
      if (job.terminal) break;
      await Bun.sleep(25);
    }
    if (mediaState !== "succeeded") fail("media-job", `terminal state ${mediaState}`);
    (record.walk as Record<string, unknown>).mediaJob = { terminalState: mediaState };

    // --- the four render dispatches (the battery's exact set) ---
    const dispatches: { rendererId: string; styleId: string }[] = [
      { rendererId: "anime.prototype", styleId: "golden-path" },
      { rendererId: "tactical.prototype", styleId: "golden-path-derived" },
      { rendererId: "game-3d.prototype", styleId: "golden-path-derived" },
      { rendererId: "anime-npr.prototype", styleId: "golden-path-derived" },
    ];
    const jobIds: string[] = [];
    for (const dispatch of dispatches) {
      const response = await renderRoute(
        withCookie(
          token,
          `/api/create/sessions/${sessionId}/renders`,
          jsonPost({
            rendererId: dispatch.rendererId,
            styleId: dispatch.styleId,
            compute: { mode: "user-explicit", providerId },
          }),
        ),
        { params: Promise.resolve({ sessionId }) },
      );
      if (response.status !== 202) {
        fail("render-dispatch", `${dispatch.rendererId} HTTP ${response.status}`);
      }
      const body = (await bodyOf(response)) as { disposition: string; jobId: string };
      if (body.disposition !== "admitted") {
        fail("render-dispatch", `${dispatch.rendererId} disposition ${body.disposition}`);
      }
      jobIds.push(body.jobId);
    }
    (record.walk as Record<string, unknown>).renderDispatches = dispatches.map(
      (dispatch, index) => ({ ...dispatch, jobId: jobIds[index], http: 202, admitted: true }),
    );

    // --- the jobs walk to terminal ---
    const jobTerminals: { jobId: string; state: string; outputs: number }[] = [];
    for (const jobId of jobIds) {
      let terminal: { state: string; completion?: { outputs?: unknown[] } } | null = null;
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const response = await jobRoute(
          withCookie(token, `/api/create/sessions/${sessionId}/jobs/${jobId}`),
          { params: Promise.resolve({ sessionId, jobId }) },
        );
        if (response.status !== 200) fail("job", `${jobId} HTTP ${response.status}`);
        const job = (await bodyOf(response)) as {
          state: string;
          completion?: { outputs?: unknown[] } | undefined;
        };
        if (job.completion !== undefined) {
          terminal = job;
          break;
        }
        await Bun.sleep(25);
      }
      if (terminal === null) fail("job", `${jobId} never reached completion`);
      if (terminal.state !== "succeeded") {
        fail("job", `${jobId} terminal state ${terminal.state}`);
      }
      jobTerminals.push({
        jobId,
        state: terminal.state,
        outputs: terminal.completion?.outputs?.length ?? 0,
      });
    }
    (record.walk as Record<string, unknown>).jobTerminals = jobTerminals;

    // --- the watch acquisition ---
    const watchResponse = await watchRoute(withCookie(token, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    if (watchResponse.status !== 200) fail("watch", `HTTP ${watchResponse.status}`);
    const watchBody = (await bodyOf(watchResponse)) as {
      playback: { state: string };
    };
    if (watchBody.playback?.state !== "authorized") {
      fail("watch", `playback state ${watchBody.playback?.state}`);
    }
    (record.walk as Record<string, unknown>).watch = {
      http: 200,
      playbackState: watchBody.playback.state,
    };

    // --- the ONE realities acquisition ---
    const realitiesResponse = await realitiesRoute(
      withCookie(token, `/api/watch/${sessionId}/realities`),
      { params: Promise.resolve({ sessionId }) },
    );
    if (realitiesResponse.status !== 200) fail("realities", `HTTP ${realitiesResponse.status}`);
    const realitiesBody = (await bodyOf(realitiesResponse)) as {
      artifacts: SessionArtifactCatalogLike;
    };
    const catalog = realitiesBody.artifacts;
    const entries = catalog.realities ?? [];
    if (entries.length === 0) fail("realities", "the catalog carries no realities");

    // --- the four kinds' byte-route reads → the exported files ---
    const outputs: unknown[] = [];
    for (const kind of KINDS) {
      const entry = entries.find((candidate) => candidate.kind === kind);
      if (entry === undefined) fail("catalog", `the ${kind} reality is missing`);
      if (entry.availability !== "ready") {
        fail("catalog", `the ${kind} reality availability ${entry.availability}`);
      }
      const descriptor = videoDescriptorOf(entry);
      if (descriptor === null || descriptor === undefined) {
        fail("catalog", `the ${kind} reality holds no video-playable descriptor`);
      }
      const path = `/api/watch/${sessionId}/realities/${kind}/artifacts/${descriptor.artifactId}/content`;
      const response = await videoRoute(withCookie(token, path), {
        params: Promise.resolve({
          sessionId,
          kind,
          artifactId: descriptor.artifactId,
        }),
      });
      if (response.status !== 200) fail("read", `${kind} HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("video/mp4")) {
        fail("read", `${kind} content-type ${contentType}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== descriptor.byteSize) {
        fail("read", `${kind} byte length ${bytes.byteLength} != ${descriptor.byteSize}`);
      }
      const servedSha = sha256OfBytes(bytes);
      if (servedSha !== descriptor.integrityHash) {
        fail("read", `${kind} sha mismatch (the store's own re-verification)`);
      }
      const magic = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
      if (magic !== "ftyp") fail("read", `${kind} container magic ${magic}`);
      const savedPath = join(outDir, `${kind}.mp4`);
      await Bun.write(savedPath, bytes);
      outputs.push({
        kind,
        artifactId: descriptor.artifactId,
        byteSize: bytes.byteLength,
        sha256: servedSha,
        http: 200,
        integrityVerified: true,
        containerMagic: magic,
        savedPath,
      });
      console.log(
        `  ${kind.padEnd(13)} ${String(bytes.byteLength).padStart(7)} B  sha ${servedSha.slice(0, 16)}…  → ${savedPath}`,
      );
    }
    record.outputs = outputs;

    // --- the manifest (the operator-viewing dir's own card) ---
    const manifest = {
      kind: "r606-visual-gate",
      ts: record.ts as string,
      gate: {
        question:
          "Watch the four realities. Can you identify the SAME match/event in each, " +
          "and do you see MEANINGFUL stylistic differences between them?",
        criteria: [
          "the same match/event identifiable across all four",
          "meaningful stylistic differences (Tactical / 3D Game / Anime-NPR vs the Original)",
        ],
        verdict: "THE OPERATOR'S — never a worker's (R606, the human visual gate)",
      },
      provenance: record.provenance,
      sessionId,
      outputs,
    };
    await Bun.write(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    // --- the record ---
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`\nThe R606 visual gate is PERFORMABLE: the four realities exported to ${outDir}`);
    console.log(`The record: ${recordPath}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
