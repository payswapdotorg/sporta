/**
 * The HTTP surface tests (W914 Wave 2): the transport-free handler AND the
 * local `Bun.serve` round trip — the flight's evidence boundary is the
 * same code path (`createComputeWorkerHttpHandler`).
 */
import { describe, expect, it } from "bun:test";
import {
  createComputeWorkerHttpHandler,
  createComputeWorkerServer,
  createHttpExecuteFunction,
} from "../src/index";
import type { ComputeWorker } from "../src/index";
import { HostedJobExecution } from "../src/index";
import { TEST_EPOCH_MS, buildDispatchRequest, createTestWorker, manualClock } from "./helpers";

/** The handler over a REAL worker (fresh per group). */
function handler(): {
  handle: ReturnType<typeof createComputeWorkerHttpHandler>;
  worker: ComputeWorker;
} {
  const worker = createTestWorker();
  return { handle: createComputeWorkerHttpHandler(worker), worker };
}

describe("the transport-free handler", () => {
  it("GET /health answers liveness + identity", async () => {
    const { handle } = handler();
    const response = await handle(new Request("http://worker/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("sporta-compute-worker");
    expect(body.adapterId).toBe("sporta.compute.hosted");
    expect(body.providerId).toBe("sporta-compute-worker-1");
    expect(response.headers.get("x-provider-id")).toBe("sporta-compute-worker-1");
  });

  it("GET /v1/adapter answers the frozen descriptor", async () => {
    const { handle } = handler();
    const response = await handle(new Request("http://worker/v1/adapter"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { supportedRenderers: Array<{ rendererId: string }> };
    expect(body.supportedRenderers.map((r) => r.rendererId)).toEqual([
      "anime.prototype",
      "sporta.testcard",
    ]);
  });

  it("POST /v1/jobs/execute executes a REAL render job over the request", async () => {
    const { handle } = handler();
    const request = await buildDispatchRequest();
    const response = await handle(
      new Request("http://worker/v1/jobs/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { disposition: string; result: unknown };
    expect(body.disposition).toBe("executed");
    expect(HostedJobExecution.safeParse(body.result).success).toBe(true);
    const envelope = HostedJobExecution.parse(body.result);
    expect(envelope.status).toBe("succeeded");
    if (envelope.outputs[0]!.delivery.mode !== "inline") throw new Error("expected inline");
    expect(envelope.outputs[0]!.delivery.content).toContain("<svg");
  });

  it("a non-JSON body answers 400 invalid-body", async () => {
    const { handle } = handler();
    const response = await handle(
      new Request("http://worker/v1/jobs/execute", { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { errorClass: string } };
    expect(body.error.errorClass).toBe("invalid-body");
  });

  it("a structurally invalid dispatch answers 400 invalid-dispatch", async () => {
    const { handle } = handler();
    const response = await handle(
      new Request("http://worker/v1/jobs/execute", {
        method: "POST",
        body: JSON.stringify({ job: { nope: true }, inputs: [] }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { errorClass: string } };
    expect(body.error.errorClass).toBe("invalid-dispatch");
  });

  it("a re-POST answers the duplicate disposition (idempotent by jobId)", async () => {
    const { handle } = handler();
    const request = await buildDispatchRequest();
    const post = () =>
      handle(
        new Request("http://worker/v1/jobs/execute", {
          method: "POST",
          body: JSON.stringify(request),
        }),
      );
    const first = await post();
    const second = await post();
    expect(((await first.json()) as { disposition: string }).disposition).toBe("executed");
    const body = (await second.json()) as { disposition: string; duplicateExecutions?: number };
    expect(body.disposition).toBe("duplicate");
    expect(body.duplicateExecutions).toBe(1);
  });

  it("GET /v1/jobs/:jobId answers the per-job record (404 unknown, never fabricated)", async () => {
    const { handle } = handler();
    const missing = await handle(new Request("http://worker/v1/jobs/nope"));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { errorClass: string } }).error.errorClass).toBe(
      "unknown-job",
    );

    const request = await buildDispatchRequest();
    await handle(
      new Request("http://worker/v1/jobs/execute", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    );
    const record = await handle(new Request(`http://worker/v1/jobs/${request.job.jobId}`));
    expect(record.status).toBe(200);
    const body = (await record.json()) as { state: string; metering: { segmentsStored: number } };
    expect(body.state).toBe("succeeded");
    expect(body.metering.segmentsStored).toBe(1);
  });

  it("unknown routes answer 404; the x-request-id header is echoed", async () => {
    const { handle } = handler();
    const response = await handle(
      new Request("http://worker/no/such/route", { headers: { "x-request-id": "req-echo-1" } }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("req-echo-1");
    const body = (await response.json()) as { error: { errorClass: string } };
    expect(body.error.errorClass).toBe("unknown-route");
  });
});

describe("the local Bun.serve round trip (real HTTP)", () => {
  it("serves the full worker surface on a real socket", async () => {
    const worker = createTestWorker();
    const server = createComputeWorkerServer({ worker, port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      // Health + descriptor.
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      const descriptor = await fetch(`${base}/v1/adapter`);
      expect(descriptor.status).toBe(200);

      // A REAL render job over real HTTP.
      const request = await buildDispatchRequest();
      const executed = await fetch(`${base}/v1/jobs/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(executed.status).toBe(200);
      const body = (await executed.json()) as {
        disposition: string;
        result: { status: string; outputs: Array<{ contentHash: string }> };
      };
      expect(body.disposition).toBe("executed");
      expect(body.result.status).toBe("succeeded");
      expect(body.result.outputs[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // Per-job record over real HTTP.
      const record = await fetch(`${base}/v1/jobs/${request.job.jobId}`);
      expect(record.status).toBe(200);
      expect(((await record.json()) as { state: string }).state).toBe("succeeded");
    } finally {
      server.stop(true);
    }
  });

  it("the HTTP client execute fn drives an adapter against the served worker", async () => {
    const worker = createTestWorker();
    const server = createComputeWorkerServer({ worker, port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const execute = createHttpExecuteFunction(base);
      const request = await buildDispatchRequest();
      const envelope = await execute(request.job as never, request.inputs as never);
      expect(envelope.status).toBe("succeeded");
      // The fail-loud path: an invalid envelope is a lying provider.
      const badExecute = createHttpExecuteFunction(base);
      await expect(badExecute({ ...request.job, jobId: "" } as never, undefined)).rejects.toThrow();
    } finally {
      server.stop(true);
    }
  });
});
