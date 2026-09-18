/**
 * The RunPod REST client (R404) — the REAL API surface of the
 * `provider.runpod` adapter: plain `fetch` ONLY (no RunPod SDK, no
 * vendored client code) against the documented public REST pods surface
 * the R404 packet prescribes (`https://api.runpod.ai`, pods — the REST
 * surface, not the GraphQL one), every call through the shared transport
 * (./../common/rest.ts): explicit timeouts, abort → `provider-unavailable`,
 * 401 → `credential-invalid`, 429 → `quota-exhausted`, one retry for
 * idempotent GETs and NONE for the create POST.
 *
 * ## Credential path (documented)
 *
 * `RUNPOD_API_KEY` — the account API key, injected here as the
 * `Authorization: Bearer` header. The value is INJECTED (never read from
 * env here — src/env.ts is the composition root); it travels only in
 * request headers and never reaches logs or error messages.
 *
 * ## Endpoint surface (documented defaults; DATA — configurable)
 *
 * - `GET     {base}/v1/pods` — the pods list: connectivity + credential
 *   verification (one authenticated GET);
 * - `POST    {base}/v1/pods` — create the pod that runs one dispatched
 *   job (body: `{ name, imageName?, job, inputs? }` — the worker image
 *   pulls the dispatch request); answers `{ id }`;
 * - `GET     {base}/v1/pods/{podId}` — the pod record: `runtime` +
 *   `desiredStatus`/`lastStatus` mapped onto queued/running/terminal
 *   (the pod record carries the worker's `jobResult` envelope when the
 *   work finished); a 404 here is PERMANENT — the honest
 *   **pod-not-found** posture: the refusal names the real cause and the
 *   ledger dead-letters the job `internal` with it;
 * - `DELETE  {base}/v1/pods/{podId}` — terminate the pod (best-effort
 *   cancellation; idempotent).
 *
 * ## Pay-as-you-go honesty
 *
 * RunPod pods bill per-second at market prices the adapter CANNOT know:
 * this client meters nothing it did not measure (`compute-ms` only), and
 * the broker registers the `provider.runpod` adapter with NO quoting
 * function — its quotes are honest `null`s, never fabricated prices.
 */
import { z } from "zod";
import type { ComputeJobDescription, ComputeMaterializedInputs } from "@sporta/compute-adapter";
import { ComputeOutputArtifact } from "@sporta/compute-adapter";
import { restCall, errorMessageOf } from "../common/rest";
import type { ProviderCall, ProviderClientStatus, RemoteProviderClient } from "../common/ledger";
import type { ProviderJobResult } from "../common/ledger";
import { providerRefusal } from "../common/refusal";
import type { FetchLike } from "../common/http";

/** The default RunPod REST base (documented public API host). */
export const RUNPOD_API_BASE_DEFAULT = "https://api.runpod.ai";

/** The default per-call timeout (ms) — an explicit bound on every call. */
export const RUNPOD_CALL_TIMEOUT_MS_DEFAULT = 20_000;

/** The default worker image the created pods run (operator-configurable). */
export const RUNPOD_WORKER_IMAGE_DEFAULT = "ghcr.io/payswapdotorg/sporta-compute-worker:latest";

/** Non-empty string helper. */
const nonEmpty = z.string().min(1);

/** The pods-list answer (loose: provider-added fields tolerate). */
const RunPodPodsList = z.object({
  pods: z.array(z.object({ id: nonEmpty }).passthrough()).optional(),
});

/** The pod-create answer: the created pod's identity. */
const RunPodPodCreate = z.object({ id: nonEmpty }).passthrough();

/** The worker's result envelope nested in the pod record (loose). */
const RunPodJobResult = z.object({
  status: z.enum(["succeeded", "failed"]),
  outputs: z.array(ComputeOutputArtifact).optional(),
  consumedInputIds: z.array(nonEmpty).optional(),
  failure: z
    .object({
      errorClass: nonEmpty,
      message: nonEmpty,
      terminal: z.enum(["non-retryable", "timeout", "internal"]),
      retryable: z.boolean(),
    })
    .optional(),
  executionMs: z.number().finite().min(0).optional(),
});

/** One pod's record answer (loose: provider-added fields tolerate). */
const RunPodPodRecord = z.object({
  id: nonEmpty,
  desiredStatus: z.enum(["RUNNING", "EXITED", "STOPPED"]).optional(),
  lastStatus: z.string().optional(),
  jobResult: RunPodJobResult.optional(),
});

/** Options for {@link RunPodRestClient}. */
export interface RunPodRestClientOptions {
  /** The account API key (REQUIRED for a live client). */
  apiKey: string;
  /** The worker image created pods run (default the sporta worker image). */
  workerImage?: string;
  /** The REST base (default {@link RUNPOD_API_BASE_DEFAULT}). */
  apiBase?: string;
  /** The injected fetch (tests replay recorded fixtures; default: real). */
  fetchFn?: FetchLike;
  /** The explicit per-call timeout (default 20 s). */
  timeoutMs?: number;
}

/** The REAL RunPod REST client behind `provider.runpod`. */
export class RunPodRestClient implements RemoteProviderClient {
  readonly endpointFamily = "runpod:pods";
  readonly providerInstanceId: string;

  private readonly apiKey: string;
  private readonly workerImage: string;
  private readonly apiBase: string;
  private readonly fetchFn?: FetchLike;
  private readonly timeoutMs: number;
  private podCounter = 0;

  constructor(options: RunPodRestClientOptions) {
    this.apiKey = options.apiKey;
    this.workerImage = options.workerImage ?? RUNPOD_WORKER_IMAGE_DEFAULT;
    this.apiBase = (options.apiBase ?? RUNPOD_API_BASE_DEFAULT).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? RUNPOD_CALL_TIMEOUT_MS_DEFAULT;
    this.providerInstanceId = "runpod:pods";
  }

  /** The bearer auth headers (the key never leaves this method). */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  async verifyCredentials(): Promise<ProviderCall<string>> {
    const result = await restCall(
      {
        url: `${this.apiBase}/v1/pods`,
        method: "GET",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs, retries: 1 },
      {
        endpoint: "runpod:pods",
        ok: (status, body) => {
          const parsed = RunPodPodsList.safeParse(body);
          const count = parsed.success ? (parsed.data.pods?.length ?? 0) : undefined;
          return {
            ok: true,
            value: `authenticated against the pods endpoint (HTTP ${status}${count !== undefined ? `, ${count} pod(s) visible` : ""})`,
          };
        },
      },
    );
    return result;
  }

  async submit(
    job: ComputeJobDescription,
    materialized?: ComputeMaterializedInputs,
  ): Promise<ProviderCall<{ providerJobId: string }>> {
    this.podCounter += 1;
    const result = await restCall<{ id: string }>(
      {
        url: `${this.apiBase}/v1/pods`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          // The pod name identifies the dispatched job (operator-visible).
          name: `sporta-${job.jobId}`,
          imageName: this.workerImage,
          // The W914 dispatch request rides the body (the worker image
          // executes it and writes its result where the record surfaces it).
          job,
          ...(materialized !== undefined ? { inputs: materialized } : {}),
        },
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs }, // NO retries — a dispatch never re-POSTs
      {
        endpoint: "runpod:pods",
        ok: (status, body) => {
          const parsed = RunPodPodCreate.safeParse(body);
          if (!parsed.success) {
            return {
              ok: false,
              refusal: providerRefusal(
                "provider-unavailable",
                `the pods create endpoint answered an unparseable body (HTTP ${status}): ${errorMessageOf(body, "no pod id")}`,
                { transport: { kind: "http", status, endpoint: "runpod:pods" } },
              ),
            };
          }
          return { ok: true, value: parsed.data };
        },
      },
    );
    if (!result.ok) return result;
    return { ok: true, value: { providerJobId: result.value.id } };
  }

  async status(providerJobId: string): Promise<ProviderCall<ProviderClientStatus>> {
    const result = await restCall<ProviderClientStatus>(
      {
        url: `${this.apiBase}/v1/pods/${encodeURIComponent(providerJobId)}`,
        method: "GET",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs, retries: 1 },
      {
        endpoint: "runpod:pods",
        // The R404 pod-not-found posture: PERMANENT, the REAL cause, and
        // the provider-native error class the ledger dead-letters with.
        notFound: (body) =>
          providerRefusal(
            "provider-unavailable",
            `pod-not-found: pod '${providerJobId}' is gone (${errorMessageOf(body, "the pods endpoint answered 404")})`,
            {
              transport: { kind: "http", status: 404, endpoint: "runpod:pods" },
              permanent: true,
              terminalErrorClass: "pod-not-found",
            },
          ),
        ok: (status, body) => {
          const parsed = RunPodPodRecord.safeParse(body);
          if (!parsed.success) {
            return {
              ok: false,
              refusal: providerRefusal(
                "provider-unavailable",
                `the pod record endpoint answered an unparseable body (HTTP ${status})`,
                { transport: { kind: "http", status, endpoint: "runpod:pods" } },
              ),
            };
          }
          const pod = parsed.data;
          const lastStatus = pod.lastStatus ?? "";
          const running = pod.desiredStatus === "RUNNING" || lastStatus === "RUNNING";
          const exited = pod.desiredStatus === "EXITED" || pod.desiredStatus === "STOPPED";
          if (!exited && running) {
            return { ok: true, value: { phase: "running" } };
          }
          if (!exited && !running) {
            return { ok: true, value: { phase: "queued" } };
          }
          // The pod exited: the work is terminal (the worker's result
          // envelope rides the record; an exited pod WITHOUT one failed
          // honestly — the envelope's failure makes that explicit).
          const jobResult = pod.jobResult;
          const resultEnvelope: ProviderJobResult =
            jobResult !== undefined
              ? {
                  status: jobResult.status,
                  outputs: jobResult.outputs ?? [],
                  consumedInputIds: jobResult.consumedInputIds ?? [],
                  ...(jobResult.failure !== undefined
                    ? {
                        failure: {
                          errorClass: jobResult.failure.errorClass,
                          message: jobResult.failure.message,
                          terminal: jobResult.failure.terminal,
                          retryable: jobResult.failure.retryable,
                        },
                      }
                    : {}),
                  ...(jobResult.executionMs !== undefined
                    ? { executionMs: jobResult.executionMs }
                    : {}),
                }
              : {
                  status: "failed",
                  outputs: [],
                  consumedInputIds: [],
                  failure: {
                    errorClass: "pod-exited-without-result",
                    message: `pod '${providerJobId}' exited (lastStatus '${lastStatus}') without a job result envelope`,
                    terminal: "internal",
                    retryable: false,
                  },
                };
          return { ok: true, value: { phase: "terminal", result: resultEnvelope } };
        },
      },
    );
    return result;
  }

  async cancel(providerJobId: string): Promise<ProviderCall<void>> {
    const result = await restCall<void>(
      {
        url: `${this.apiBase}/v1/pods/${encodeURIComponent(providerJobId)}`,
        method: "DELETE",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs }, // no retries
      {
        endpoint: "runpod:pods",
        ok: () => ({ ok: true, value: undefined }),
      },
    );
    return result;
  }
}
