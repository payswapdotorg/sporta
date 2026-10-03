/**
 * R607 62-c — the STANDALONE full-plane COMPUTE worker for the E2B
 * failover hosting shape (DEVELOPMENT-TIME/EVIDENCE ENTRY, not a test):
 * one `Bun.serve` process serving the W914 compute worker application
 * with the FULL renderer plane — the SAME composition the web app wires
 * in-process (`apps/web/src/server/composition.ts` §2/§2'/§4 and
 * `apps/web/src/server/derived-reality.ts`):
 *
 * - the reference test-card renderer (`sporta.testcard`),
 * - the REAL W502 anime plugin (`anime.prototype`),
 * - the derived-reality plane (R508-R510) when the LOCAL toolchain probes
 *   available (ffmpeg + libx264): `tactical.prototype`, `game-3d.prototype`,
 *   `anime-npr.prototype` through the R306 encoding bridges.
 *
 * WHY THIS ENTRY EXISTS (the measured gap record it serves): the R607
 * hosted acceptance (2026-09-26 + the 62-c E2B flight) measured that the
 * DERIVED-REALITY ENCODE PLANE composes on the web composition ONLY when
 * the WEB RUNTIME's own ffmpeg probes available — on the hosted Vercel
 * Node runtime it does not, so the studio's admission honestly offers no
 * derived-reality producers and the hosted app NEVER dispatches derived
 * renders to an external compute worker (the admission gap — a TL
 * decision, recorded in scripts/evidence/r607-e2b-media-failover/). This
 * entry demonstrates + measures the OTHER half of that design: the
 * external compute worker itself, hosted where the toolchain IS available
 * (an E2B sandbox with ffmpeg), advertising the derived renderers in its
 * LIVE descriptor and executing REAL derived-reality render jobs over the
 * wire — the exact remote execution plane a descriptor-driven admission
 * change would dispatch to.
 *
 * Run (from this package's directory):
 *
 *   bun run scripts/r607-e2b-compute-worker.ts            # 127.0.0.1:3973
 *   PORT=3974 bun run scripts/r607-e2b-compute-worker.ts  # an alternate fixed port
 *   HOSTNAME=0.0.0.0 PORT=3973 bun run scripts/r607-e2b-compute-worker.ts
 *     # bind the public interface (the E2B-sandbox hosting shape — the
 *     # sandbox's port proxy forwards https://{sandboxId}-{port}.e2b.app)
 *
 * Boot output: the honest descriptor (derived from the REAL registry —
 * nothing advertised that cannot resolve) + the derived-plane state. The
 * process stays up until SIGINT/SIGTERM.
 *
 * Routes (see src/http.ts): GET /health, GET /v1/adapter,
 * POST /v1/jobs/execute, GET /v1/jobs/:jobId.
 */
import {
  ComputeWorker,
  createComputeWorkerServer,
  createDefaultOutputSegmentStore,
  createDerivedRealityRenderer,
} from "../src/index";
import type { DerivedRealityRendererPort } from "../src/index";
import { createAnimeOutputPipeline } from "@sporta/output-pipeline";
import { RendererRegistry, createTestCardRenderer } from "@sporta/renderer-contract";
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import {
  Software3DEngine,
  createGame3DRenderer,
  createAnimeNprRenderer,
} from "@sporta/renderer-3d";
import type { GameRealityRenderer } from "@sporta/renderer-3d";
import { createFfmpegH264Codec, createTacticalRenderer } from "@sporta/renderer-tactical";
import { createFfmpegFrameEncoder } from "@sporta/encoding";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env["PORT"] ?? 3973);
// The E2B hosting shape binds the public interface (the sandbox's port
// proxy forwards the public URL to the bound port); the default stays the
// local-real-HTTP boundary.
const HOSTNAME = process.env["HOSTNAME"] ?? "127.0.0.1";

// The SAME derived-plane composition the web app performs
// (apps/web/src/server/derived-reality.ts — the disposing engine wrapper
// + the REAL plugins), composed ONLY when the local toolchain probes
// available (the honest availability posture — on this worker's host the
// toolchain is expected to resolve; when it does not, the derived
// renderers are simply absent from the descriptor, never advertised).
const frameEncoder = createFfmpegFrameEncoder();
const tacticalCodec = createFfmpegH264Codec();
const derivedPlaneComposed = frameEncoder !== null && tacticalCodec !== null;
const tacticalStagingDir = mkdtempSync(join(tmpdir(), "sporta-e2b-tactical-staging-"));
const gameRenderers: GameRealityRenderer[] = [createGame3DRenderer({}), createAnimeNprRenderer({})];
let derivedRealityRenderer: DerivedRealityRendererPort | undefined;
let tacticalRendererForRegistry: ReturnType<typeof createTacticalRenderer> | undefined;
if (derivedPlaneComposed) {
  const tacticalRenderer = createTacticalRenderer({
    stagingDir: tacticalStagingDir,
    codec: tacticalCodec!,
    nowMs: Date.now,
  });
  tacticalRendererForRegistry = tacticalRenderer;
  derivedRealityRenderer = createDerivedRealityRenderer({
    tacticalRenderer,
    createGameEngine: () => {
      // The web composition's disposing wrapper (one fresh engine per
      // render, owning its staging lifecycle).
      const engine = new Software3DEngine();
      const root = engine.stagingRootPath();
      return {
        describe: () => engine.describe(),
        buildScene: (request, snapshot, events) => engine.buildScene(request, snapshot, events),
        applySceneEvents: (handle, events) => engine.applySceneEvents(handle, events),
        renderScene: (request) => engine.renderScene(request),
        dispose: () => {
          engine.dispose();
          rmSync(root, { recursive: true, force: true });
        },
      };
    },
    frameEncoder: frameEncoder!,
  });
}

// The SAME registry the web app wires: the reference + anime plugins,
// plus the derived-plane plugins when the plane composed (the SAME
// plugin instances the derived renderer drives — one registration truth).
const registry = new RendererRegistry();
registry.register(createTestCardRenderer());
registry.register(createAnimePrototypeRenderer());
if (tacticalRendererForRegistry !== undefined) {
  registry.register(tacticalRendererForRegistry);
  for (const plugin of gameRenderers) {
    registry.register(plugin);
  }
}

// The W504 output pipeline (in-process stores) — the same shape the web
// composition hands the worker (the segment store + the content-addressed
// artifact store encoded MP4s register into).
const pipeline = createAnimeOutputPipeline({ segmentStore: createDefaultOutputSegmentStore() });

const worker = new ComputeWorker({
  rendererRegistry: registry,
  outputSegmentStore: createDefaultOutputSegmentStore(),
  ...(derivedRealityRenderer === undefined ? {} : { derivedRealityRenderer }),
  encodedArtifactStore: pipeline.artifactStore,
  nowMs: Date.now,
});
const server = createComputeWorkerServer({ worker, port: PORT, hostname: HOSTNAME });

const descriptor = worker.describe();
console.log(`[e2b-compute-worker] listening on http://${HOSTNAME}:${server.port}`);
console.log(
  `[e2b-compute-worker] adapter ${descriptor.adapterId} v${descriptor.adapterVersion}, providerKind ${descriptor.providerKind}, maxConcurrentJobs ${descriptor.maxConcurrentJobs}`,
);
console.log(
  `[e2b-compute-worker] supportedRenderers: ${descriptor.supportedRenderers.map((r) => r.rendererId).join(", ")}`,
);
console.log(
  `[e2b-compute-worker] derived-reality plane: ${derivedPlaneComposed ? "COMPOSED (the local ffmpeg+libx264 toolchain resolved — tactical/game-3d/anime-npr render through the R306 bridges)" : "ABSENT (the local toolchain did not resolve — the derived renderers are NOT advertised, never invented)"}`,
);
void tacticalStagingDir;

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  const stats = worker.stats();
  console.log(
    `[e2b-compute-worker] ${signal}: stopping — executed=${stats.jobsExecuted} succeeded=${stats.succeeded} failed=${stats.failed} duplicates=${stats.duplicateExecutions} capacityRefusals=${stats.capacityRefusals} segmentsEncoded=${stats.segmentsEncoded} bytesEncoded=${stats.bytesEncoded} totalExecutionMs=${stats.totalExecutionMs}`,
  );
  server.stop(true);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
