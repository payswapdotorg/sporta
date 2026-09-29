/**
 * The media-toolchain compute worker's HTTP surface (R607 lane B): a
 * transport-framework-free `fetch` handler a `Bun.serve` process
 * (`createMediaToolchainServer` — the LOCAL/SELF-HOSTED real-toolchain
 * worker this sandbox's evidence runs, and the shape an external
 * toolchain worker deployment serves) mounts. One handler, the same code
 * path everywhere — the render profile's `./http.ts` conventions verbatim.
 *
 * Routes (the media-toolchain profile of the adapter-port mapping):
 *
 * - `GET /health` → liveness + identity (`200`, never domain state);
 * - `GET /v1/media/adapter` → the honest capability descriptor (the REAL
 *   toolchain resolution — nothing advertised that cannot be executed);
 * - `POST /v1/media/jobs/execute` → executes ONE media-toolchain dispatch
 *   (body: `MediaToolchainDispatchRequest`) and answers the RESULT
 *   ENVELOPE (`MediaToolchainResult`); determinate refusals (malformed
 *   body, capacity) answer `400`/`503` with
 *   `{ error: { errorClass, message, terminal } }`; a re-POST of an
 *   executed job answers the SAME envelope (`duplicate` disposition —
 *   idempotent by `jobId`);
 * - `GET /v1/media/jobs/:jobId` → the worker-side job record: state +
 *   per-job metering + the envelope once terminal (`404` when unknown —
 *   never fabricated);
 * - `GET /v1/media/usage` → the metering drain (one `ComputeUsageRecord`
 *   per terminally-disposed job);
 * - `GET /v1/media/stats` → the whole-worker metering counters (the
 *   accounting-snapshot surface — `assertMediaToolchainAccounting`'s
 *   identities are checkable ACROSS the wire: stats + the usage drain are
 *   two independent reads that must agree).
 *
 * Every response carries `x-request-id` echo + `x-provider-id` identity.
 * No CORS (same-origin composition), no auth (the W910/W902 boundary
 * wraps this route in a hosted deployment — wire security is audit gap
 * G8, unchanged).
 */
import { MediaToolchainDispatchRequest } from "@sporta/media-platform";
import type { MediaToolchainWorker, MediaToolchainWorkerExecution } from "./media-worker";

/** Options for {@link createMediaToolchainServer}. */
export interface MediaToolchainServerOptions {
  /** The media-toolchain worker application to serve (see ./media-worker.ts). */
  worker: MediaToolchainWorker;
  /** Listen port (`0` = ephemeral — the actual port is on `server.port`). */
  port?: number;
  /** Hostname (default `127.0.0.1` — local-real-HTTP boundary). */
  hostname?: string;
}

/** The shared error-body shape of every non-2xx answer. */
interface HttpErrorBody {
  error: { errorClass: string; message: string; terminal?: string };
}

/** JSON response helper. */
function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Executes a `MediaToolchainWorkerExecution` into its HTTP answer. */
function executionResponse(execution: MediaToolchainWorkerExecution, requestId: string): Response {
  const headers = { "x-request-id": requestId };
  if (execution.kind === "refused") {
    return json(503, { error: execution.reason }, headers);
  }
  const duplicate =
    execution.kind === "duplicate" ? { duplicateExecutions: execution.duplicateExecutions } : {};
  return json(
    200,
    {
      disposition: execution.kind,
      result: execution.result,
      ...duplicate,
    },
    headers,
  );
}

/**
 * The transport-free handler: `(request: Request) => Promise<Response>`.
 * Mount it under `Bun.serve` (local/self-hosted — the real-toolchain
 * worker this evidence drives) or any server adapter.
 */
export function createMediaToolchainHttpHandler(
  worker: MediaToolchainWorker,
): (request: Request) => Promise<Response> {
  let requestSeq = 0;
  return async (request: Request): Promise<Response> => {
    requestSeq += 1;
    const requestId = request.headers.get("x-request-id") ?? `mtw-${requestSeq}`;
    const identity = { "x-provider-id": worker.providerId, "x-adapter-id": worker.adapterId };
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      if (path === "/health" && method === "GET") {
        return json(
          200,
          {
            ok: true,
            service: "sporta-media-toolchain-worker",
            adapterId: worker.adapterId,
            providerId: worker.providerId,
            adapterVersion: (await worker.describe()).adapterVersion,
          },
          { "x-request-id": requestId, ...identity },
        );
      }
      if (path === "/v1/media/adapter" && method === "GET") {
        return json(200, await worker.describe(), { "x-request-id": requestId, ...identity });
      }
      if (path === "/v1/media/jobs/execute" && method === "POST") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          const error: HttpErrorBody = {
            error: { errorClass: "invalid-body", message: "request body is not JSON" },
          };
          return json(400, error, { "x-request-id": requestId });
        }
        const parsed = MediaToolchainDispatchRequest.safeParse(body);
        if (!parsed.success) {
          const error: HttpErrorBody = {
            error: {
              errorClass: "invalid-dispatch",
              message:
                "body is not a valid MediaToolchainDispatchRequest: " +
                parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
              terminal: "non-retryable",
            },
          };
          return json(400, error, { "x-request-id": requestId });
        }
        const execution = await worker.execute(parsed.data);
        return executionResponse(execution, requestId);
      }
      const jobMatch = /^\/v1\/media\/jobs\/([^/]+)$/.exec(path);
      if (jobMatch !== null && method === "GET") {
        const record = worker.getJob(decodeURIComponent(jobMatch[1] ?? ""));
        if (record === null) {
          const error: HttpErrorBody = {
            error: { errorClass: "unknown-job", message: `no executed media job '${jobMatch[1]}'` },
          };
          return json(404, error, { "x-request-id": requestId });
        }
        return json(200, record, { "x-request-id": requestId, ...identity });
      }
      if (path === "/v1/media/usage" && method === "GET") {
        return json(200, worker.usageRecords(), { "x-request-id": requestId, ...identity });
      }
      if (path === "/v1/media/stats" && method === "GET") {
        return json(200, worker.stats(), { "x-request-id": requestId, ...identity });
      }
      const error: HttpErrorBody = {
        error: { errorClass: "unknown-route", message: `no route ${method} ${path}` },
      };
      return json(404, error, { "x-request-id": requestId });
    } catch (err) {
      const error: HttpErrorBody = {
        error: {
          errorClass: "internal",
          message: err instanceof Error ? err.message : String(err),
        },
      };
      return json(500, error, { "x-request-id": requestId });
    }
  };
}

/** A `Bun.serve` wrapper mounting the handler (local/self-hosted). */
export function createMediaToolchainServer(
  options: MediaToolchainServerOptions,
): Bun.Server<undefined> {
  return Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? "127.0.0.1",
    fetch: createMediaToolchainHttpHandler(options.worker),
  });
}
