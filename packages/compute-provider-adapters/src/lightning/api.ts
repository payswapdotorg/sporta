/**
 * The Lightning AI REST client (R403) — the REAL API surface of the
 * `provider.lightning` adapter: plain `fetch` ONLY (no Lightning SDK, no
 * vendored client code) against the documented public endpoint families
 * the R403 packet prescribes (`https://api.lightning.ai`, machines +
 * studios), every call through the shared transport (./../common/rest.ts):
 * explicit timeouts, abort → `provider-unavailable`, 401/403 →
 * `credential-invalid`, 429 → `quota-exhausted`, one retry for idempotent
 * GETs and NONE for the submit POST.
 *
 * ## Credential path (documented)
 *
 * `LIGHTNING_API_KEY` — an ACCOUNT API key (never console credentials,
 * never a password): injected here as the `Authorization: Bearer` header.
 * The value is INJECTED (never read from env here — src/env.ts is the
 * composition root); it travels only in request headers and never reaches
 * logs or error messages.
 *
 * ## Endpoint surface (documented defaults; DATA — configurable)
 *
 * - `GET  {base}/api/v1/machines` — the machines endpoint family:
 *   connectivity + credential verification (one authenticated GET);
 * - `POST {base}/api/v1/studios/{studioId}/jobs` — submit the dispatch
 *   request to the studio's job queue (body `{ job, inputs? }`); answers
 *   `{ jobId }`;
 * - `GET  {base}/api/v1/studios/{studioId}/jobs/{jobId}` — the job status:
 *   `queued | running | succeeded | failed` with optional `progress`/
 *   `stage` and the result envelope when terminal; a 404 here is PERMANENT;
 * - `POST {base}/api/v1/studios/{studioId}/jobs/{jobId}/cancel` —
 *   best-effort cancellation (idempotent).
 *
 * The studio target (`studioId`) is execution-surface configuration: when
 * it is absent, the job calls answer an honest `provider-unavailable`
 * refusal naming the missing configuration (verification still works —
 * the machines endpoint needs no studio). Exact-path liveness is verified
 * by the env-gated conditional integration tier (guard `LIGHTNING_API_KEY`);
 * the recorded fixtures under fixtures/lightning/ pin the shapes.
 */
import { z } from "zod";
import type { ComputeJobDescription, ComputeMaterializedInputs } from "@sporta/compute-adapter";
import { ComputeOutputArtifact } from "@sporta/compute-adapter";
import { restCall, errorMessageOf } from "../common/rest";
import type { ProviderCall, ProviderClientStatus, RemoteProviderClient } from "../common/ledger";
import type { ProviderJobResult } from "../common/ledger";
import { providerRefusal } from "../common/refusal";
import type { FetchLike } from "../common/http";

/** The default Lightning REST base (documented public API host). */
export const LIGHTNING_API_BASE_DEFAULT = "https://api.lightning.ai";

/** The default per-call timeout (ms) — an explicit bound on every call. */
export const LIGHTNING_CALL_TIMEOUT_MS_DEFAULT = 20_000;

/** Non-empty string helper. */
const nonEmpty = z.string().min(1);

/** The machines-list answer (loose: provider-added fields tolerate). */
const LightningMachinesList = z.object({
  machines: z.array(z.object({ machineType: nonEmpty }).passthrough()).optional(),
});

/** The job-submit answer: the queued job's identity. */
const LightningJobAnswer = z.object({ jobId: nonEmpty }).passthrough();

/** One studio job's status answer (loose: provider-added fields tolerate). */
const LightningJobStatus = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  progress: z.number().finite().min(0).max(1).optional(),
  stage: nonEmpty.optional(),
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

/** Options for {@link LightningRestClient}. */
export interface LightningRestClientOptions {
  /** The account API key (REQUIRED for a live client). */
  apiKey: string;
  /** The studio target for job calls (empty = the honest not-configured refusal). */
  studioId?: string;
  /** The REST base (default {@link LIGHTNING_API_BASE_DEFAULT}). */
  apiBase?: string;
  /** The injected fetch (tests replay recorded fixtures; default: real). */
  fetchFn?: FetchLike;
  /** The explicit per-call timeout (default 20 s). */
  timeoutMs?: number;
}

/** The REAL Lightning AI REST client behind `provider.lightning`. */
export class LightningRestClient implements RemoteProviderClient {
  readonly endpointFamily = "lightning:studios";
  readonly providerInstanceId: string;

  private readonly apiKey: string;
  private readonly studioId: string;
  private readonly apiBase: string;
  private readonly fetchFn?: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: LightningRestClientOptions) {
    this.apiKey = options.apiKey;
    this.studioId = options.studioId ?? "";
    this.apiBase = (options.apiBase ?? LIGHTNING_API_BASE_DEFAULT).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? LIGHTNING_CALL_TIMEOUT_MS_DEFAULT;
    this.providerInstanceId =
      this.studioId.length > 0 ? `lightning:${this.studioId}` : "lightning:unconfigured";
  }

  /** The bearer auth headers (the key never leaves this method). */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  /** The honest not-configured refusal for job calls without a studio target. */
  private studioMissing(): ProviderCall<never> {
    return {
      ok: false,
      refusal: providerRefusal(
        "provider-unavailable",
        "LIGHTNING_STUDIO_ID is not configured — the studios job surface (submit/status/cancel) cannot be addressed; credential verification against the machines endpoint still works",
        { transport: { kind: "not-applicable", endpoint: "lightning:studios" } },
      ),
    };
  }

  async verifyCredentials(): Promise<ProviderCall<string>> {
    const result = await restCall(
      {
        url: `${this.apiBase}/api/v1/machines`,
        method: "GET",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs, retries: 1 },
      {
        endpoint: "lightning:machines",
        ok: (status, body) => {
          const parsed = LightningMachinesList.safeParse(body);
          const count = parsed.success ? (parsed.data.machines?.length ?? 0) : undefined;
          return {
            ok: true,
            value: `authenticated against the machines endpoint (HTTP ${status}${count !== undefined ? `, ${count} machine type(s) visible` : ""})`,
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
    if (this.studioId.length === 0) return this.studioMissing();
    const result = await restCall<{ jobId: string }>(
      {
        url: `${this.apiBase}/api/v1/studios/${encodeURIComponent(this.studioId)}/jobs`,
        method: "POST",
        headers: this.authHeaders(),
        body: materialized === undefined ? { job } : { job, inputs: materialized },
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs }, // NO retries — a dispatch never re-POSTs
      {
        endpoint: "lightning:studios",
        ok: (status, body) => {
          const parsed = LightningJobAnswer.safeParse(body);
          if (!parsed.success) {
            return {
              ok: false,
              refusal: providerRefusal(
                "provider-unavailable",
                `the studio jobs endpoint answered an unparseable body (HTTP ${status}): ${errorMessageOf(body, "no jobId")}`,
                { transport: { kind: "http", status, endpoint: "lightning:studios" } },
              ),
            };
          }
          return { ok: true, value: parsed.data };
        },
      },
    );
    if (!result.ok) return result;
    return { ok: true, value: { providerJobId: result.value.jobId } };
  }

  async status(providerJobId: string): Promise<ProviderCall<ProviderClientStatus>> {
    if (this.studioId.length === 0) return this.studioMissing();
    const result = await restCall<ProviderClientStatus>(
      {
        url: `${this.apiBase}/api/v1/studios/${encodeURIComponent(this.studioId)}/jobs/${encodeURIComponent(providerJobId)}`,
        method: "GET",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs, retries: 1 },
      {
        endpoint: "lightning:studios",
        notFound: (body) =>
          providerRefusal(
            "provider-unavailable",
            `studio job '${providerJobId}' not found: ${errorMessageOf(body, "gone")}`,
            {
              transport: { kind: "http", status: 404, endpoint: "lightning:studios" },
              permanent: true,
            },
          ),
        ok: (status, body) => {
          const parsed = LightningJobStatus.safeParse(body);
          if (!parsed.success) {
            return {
              ok: false,
              refusal: providerRefusal(
                "provider-unavailable",
                `the studio job status endpoint answered an unparseable body (HTTP ${status})`,
                { transport: { kind: "http", status, endpoint: "lightning:studios" } },
              ),
            };
          }
          const answer = parsed.data;
          if (answer.status === "queued") {
            return { ok: true, value: { phase: "queued" } };
          }
          if (answer.status === "running") {
            return {
              ok: true,
              value: {
                phase: "running",
                ...(answer.progress !== undefined ? { fraction: answer.progress } : {}),
                ...(answer.stage !== undefined ? { stage: answer.stage } : {}),
              },
            };
          }
          const resultEnvelope: ProviderJobResult = {
            status: answer.status,
            outputs: answer.outputs ?? [],
            consumedInputIds: answer.consumedInputIds ?? [],
            ...(answer.failure !== undefined
              ? {
                  failure: {
                    errorClass: answer.failure.errorClass,
                    message: answer.failure.message,
                    terminal: answer.failure.terminal,
                    retryable: answer.failure.retryable,
                  },
                }
              : {}),
            ...(answer.executionMs !== undefined ? { executionMs: answer.executionMs } : {}),
          };
          return { ok: true, value: { phase: "terminal", result: resultEnvelope } };
        },
      },
    );
    return result;
  }

  async cancel(providerJobId: string): Promise<ProviderCall<void>> {
    if (this.studioId.length === 0) return this.studioMissing();
    const result = await restCall<void>(
      {
        url: `${this.apiBase}/api/v1/studios/${encodeURIComponent(this.studioId)}/jobs/${encodeURIComponent(providerJobId)}/cancel`,
        method: "POST",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs }, // no retries
      {
        endpoint: "lightning:studios",
        ok: () => ({ ok: true, value: undefined }),
      },
    );
    return result;
  }
}
