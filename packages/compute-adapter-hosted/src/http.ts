/**
 * The hosted compute worker's HTTP surface (W914 Wave 2): a
 * transport-framework-free `fetch` handler both a `Bun.serve` process
 * (local/self-hosted — `createComputeWorkerServer`) and a serverless route
 * (the Vercel `apps/web/src/app/api/compute/route.ts`, the frozen Worker-C
 * namespace) can mount — one handler, the same code path everywhere.
 *
 * Routes (the adapter-port mapping the W914 audit sketched):
 *
 * - `GET /health` → liveness + identity (`200`, never domain state);
 * - `GET /v1/adapter` → the worker's frozen capability descriptor;
 * - `POST /v1/jobs/execute` → executes ONE materialized dispatch request
 *   (body: `ComputeDispatchRequest`) and answers the RESULT ENVELOPE
 *   (`HostedJobExecution`); determinate refusals (malformed body, capacity)
 *   answer `400`/`503` with `{ error: { errorClass, message, terminal } }`;
 *   a re-POST of an executed job answers the SAME envelope (`duplicate`
 *   disposition — idempotent by `jobId`);
 * - `GET /v1/jobs/:jobId` → the worker-side job record: state + per-job
 *   metering counters + the envelope once terminal (`404` when unknown —
 *   never fabricated).
 *
 * Every response carries `x-request-id` echo + `x-provider-id` identity.
 * No CORS (same-origin composition), no auth (the W910/W902 boundary wraps
 * this route in the hosted deployment — wire security is audit gap G8).
 */
import { ComputeDispatchRequest } from "@sporta/compute-adapter";
import type { ComputeDispatchRequest as ComputeDispatchRequestDoc } from "@sporta/compute-adapter";
import type { HostedJobExecution as HostedJobExecutionDoc } from "./envelope";
import type { ComputeWorker, ComputeWorkerExecution } from "./worker";
import type { HostedExecuteFn } from "./adapter";
import { HostedJobExecution } from "./envelope";

/** Options for {@link createComputeWorkerServer}. */
export interface ComputeWorkerServerOptions {
  /** The worker application to serve (see ./worker.ts). */
  worker: ComputeWorker;
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

/** Executes a `ComputeWorkerExecution` into its HTTP answer. */
function executionResponse(execution: ComputeWorkerExecution, requestId: string): Response {
  const headers = { "x-request-id": requestId };
  if (execution.kind === "refused") {
    return json(503, { error: execution.reason }, headers);
  }
  const duplicate = execution.kind === "duplicate" ? { duplicateExecutions: execution.duplicateExecutions } : {};
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
 * Mount it under `Bun.serve` (local) or a serverless route (hosted).
 */
export function createComputeWorkerHttpHandler(worker: ComputeWorker): (request: Request) => Promise<Response> {
  let requestSeq = 0;
  return async (request: Request): Promise<Response> => {
    requestSeq += 1;
    const requestId = request.headers.get("x-request-id") ?? `cw-${requestSeq}`;
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
            service: "sporta-compute-worker",
            adapterId: worker.adapterId,
            providerId: worker.providerId,
            adapterVersion: worker.describe().adapterVersion,
          },
          { "x-request-id": requestId, ...identity },
        );
      }
      if (path === "/v1/adapter" && method === "GET") {
        return json(200, worker.describe(), { "x-request-id": requestId, ...identity });
      }
      if (path === "/v1/jobs/execute" && method === "POST") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          const error: HttpErrorBody = {
            error: { errorClass: "invalid-body", message: "request body is not JSON" },
          };
          return json(400, error, { "x-request-id": requestId });
        }
        const parsed = ComputeDispatchRequest.safeParse(body);
        if (!parsed.success) {
          const error: HttpErrorBody = {
            error: {
              errorClass: "invalid-dispatch",
              message:
                "body is not a valid ComputeDispatchRequest: " +
                parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
              terminal: "non-retryable",
            },
          };
          return json(400, error, { "x-request-id": requestId });
        }
        const execution = await worker.execute(parsed.data);
        return executionResponse(execution, requestId);
      }
      const jobMatch = /^\/v1\/jobs\/([^/]+)$/.exec(path);
      if (jobMatch !== null && method === "GET") {
        const record = worker.getJob(decodeURIComponent(jobMatch[1] ?? ""));
        if (record === null) {
          const error: HttpErrorBody = {
            error: { errorClass: "unknown-job", message: `no executed job '${jobMatch[1]}'` },
          };
          return json(404, error, { "x-request-id": requestId });
        }
        return json(200, record, { "x-request-id": requestId, ...identity });
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
export function createComputeWorkerServer(
  options: ComputeWorkerServerOptions,
): Bun.Server<undefined> {
  return Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? "127.0.0.1",
    fetch: createComputeWorkerHttpHandler(options.worker),
  });
}

/**
 * The HTTP CLIENT execute function: builds a {@link HostedExecuteFn} that
 * POSTs the dispatch request to a worker's `POST /v1/jobs/execute` and
 * validates the result envelope fail-loud (an invalid envelope is a lying
 * provider — the adapter dead-letters it, never trusts it).
 */
export function createHttpExecuteFunction(
  workerUrl: string,
  options: { fetchFn?: typeof fetch } = {},
): HostedExecuteFn {
  const doFetch = options.fetchFn ?? fetch;
  const base = workerUrl.replace(/\/+$/, "");
  return async (job, materialized) => {
    // The wire body: the job plus its materialized inputs (the control
    // plane ALWAYS dispatches materialized — a bare job is rejected loudly
    // by the worker's exact-coverage validation).
    const payload =
      materialized === undefined
        ? { job }
        : { job, inputs: materialized };
    const response = await doFetch(`${base}/v1/jobs/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let errorClass = "http-error";
      let message = `worker answered HTTP ${response.status}`;
      try {
        const parsed = (await response.json()) as HttpErrorBody;
        if (parsed?.error?.errorClass !== undefined) errorClass = parsed.error.errorClass;
        if (parsed?.error?.message !== undefined) message = parsed.error.message;
      } catch {
        // keep the generic message
      }
      throw new Error(`${errorClass}: ${message}`);
    }
    const parsed = (await response.json()) as { disposition?: string; result?: unknown };
    const envelope = HostedJobExecution.safeParse(parsed?.result);
    if (!envelope.success) {
      throw new Error(
        "invalid-envelope: worker answered a result that is not a HostedJobExecution: " +
          envelope.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    return envelope.data;
  };
}
