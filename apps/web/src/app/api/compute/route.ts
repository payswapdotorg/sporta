/**
 * The hosted compute worker route (W914 Wave 2) — the frozen Worker-C
 * namespace under `/api/compute`:
 *
 * - `GET /api/compute` — health + the worker's capability descriptor
 *   (`GET /api/compute?descriptor=1` answers ONLY the descriptor document);
 * - `POST /api/compute` — executes ONE materialized render job (body: the
 *   `ComputeDispatchRequest`) and answers the result envelope
 *   (`HostedJobExecution`): a REAL render through the REAL renderer plugin
 *   (registry-resolved), the REAL W504 encoder + render-segment store, with
 *   fail-closed duration/size budgets.
 *
 * The route is a thin composition root over
 * `@sporta/compute-adapter-hosted`'s transport-free handler — the SAME code
 * path the local `Bun.serve` worker runs (the evidence script), so local and
 * deployed behavior differ only in the runtime. The worker imports are
 * DEFERRED (dynamic) so route evaluation — and `next build`'s page-data
 * collection — never executes the workspace package graph; the composition
 * is a per-process singleton (one renderer registry + one in-memory W504
 * store; the R2-backed store is W912 behind the same port).
 *
 * KNOWN LIMITATIONS (this wave, honestly): the in-process store is
 * per-instance (serverless instances do not share it); the Vercel Hobby
 * execution budgets are enforced fail-closed per job (see
 * `@sporta/compute-adapter-hosted/src/budgets.ts`); wire auth is the W910
 * boundary (audit gap G8), not this route; the non-Bun runtime cannot load
 * the `bun:sqlite`-backed store implementations (the in-memory store is
 * this route's composition) — deployed-Vercel validation is a LATER wave;
 * local-real-HTTP is this flight's evidence boundary.
 */
import type { ComputeWorker } from "@sporta/compute-adapter-hosted";

// Always server-rendered on demand (a stateless executor route — never
// statically analyzable, and never evaluated at build time).
export const dynamic = "force-dynamic";

type WorkerHandler = (request: Request) => Promise<Response>;

/** The deferred worker composition (per-process singleton). */
let composition: Promise<{ worker: ComputeWorker; handler: WorkerHandler }> | undefined;

function workerComposition(): Promise<{ worker: ComputeWorker; handler: WorkerHandler }> {
  composition ??= (async () => {
    const hosted = await import("@sporta/compute-adapter-hosted");
    const worker = hosted.createComputeWorker({
      // The default registry (the REAL anime renderer + the reference test
      // card) and the in-memory W504 store are this route's composition;
      // the ONLY place a wall clock is read (the package takes injected
      // clocks).
      rendererRegistry: hosted.createDefaultWorkerRegistry(),
      outputSegmentStore: hosted.createDefaultOutputSegmentStore(),
      nowMs: () => Date.now(),
    });
    return { worker, handler: hosted.createComputeWorkerHttpHandler(worker) };
  })();
  return composition;
}

export async function GET(request: Request): Promise<Response> {
  const { worker, handler } = await workerComposition();
  const url = new URL(request.url);
  if (url.searchParams.get("descriptor") === "1") {
    // The bare capability descriptor (the worker's own `GET /v1/adapter`
    // answer — also exposed through the handler below).
    return Response.json(worker.describe());
  }
  // Health + descriptor in one document (the route's own GET shape).
  return Response.json({
    ok: true,
    service: "sporta-compute-worker",
    adapterId: worker.adapterId,
    providerId: worker.providerId,
    descriptor: worker.describe(),
  });
}

export async function POST(request: Request): Promise<Response> {
  const { handler } = await workerComposition();
  return handler(request);
}
