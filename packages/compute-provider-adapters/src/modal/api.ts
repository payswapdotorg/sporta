/**
 * The Modal REST client (R402) — the REAL API surface of the `provider.modal`
 * adapter: plain `fetch` ONLY (no Modal SDK, no vendored client code — the
 * package README records the provenance) against the documented public
 * endpoint families the R402 packet prescribes (`https://api.modal.co`,
 * functions + tokens), every call through the shared transport
 * (./../common/rest.ts): explicit timeouts, abort → `provider-unavailable`,
 * 401/403 → `credential-invalid`, 429 → `quota-exhausted`, one retry for
 * the idempotent GETs and NONE for the submit POST.
 *
 * ## Credential path (documented, scoped — never a master key)
 *
 * `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` (the Modal-Token-Id /
 * Modal-Token-Secret header pair — a SCOPED modal-token pair; Modal
 * supports function-scoped tokens, and this adapter accepts nothing
 * broader: there is no workspace-admin credential anywhere in this code).
 * The values are INJECTED (never read from env here — src/env.ts is the
 * composition root); they travel ONLY in request headers and are never
 * logged, persisted, or echoed into error messages (safeUrlOf redaction).
 *
 * ## Endpoint surface (documented defaults; DATA — configurable)
 *
 * - `GET  {apiBase}/v1/functions` — the functions endpoint family:
 *   connectivity + credential verification (one authenticated GET);
 * - `POST {apiBase}/v1/functions/{functionRef}/invoke` — spawn the
 *   deployed sporta compute-worker function with the dispatch request
 *   (body: `{ job, inputs? }`); answers `{ invocationId }`;
 * - `GET  {apiBase}/v1/functions/{functionRef}/invocations/{invocationId}`
 *   — the invocation status: `queued | running | succeeded | failed` with
 *   optional `progress`/`stage` while running and the result envelope when
 *   terminal; a 404 here is PERMANENT (the invocation is gone);
 * - `POST {apiBase}/v1/functions/{functionRef}/invocations/{invocationId}/cancel`
 *   — best-effort cancellation (idempotent).
 *
 * Exact-path liveness is verified by the env-gated conditional integration
 * tier (test/modal.integration.test.ts, guard `MODAL_TOKEN_ID`); the
 * recorded fixtures under fixtures/modal/ pin the request/response shapes
 * and the full failure mapping deterministically.
 */
import { z } from "zod";
import type { ComputeJobDescription, ComputeMaterializedInputs } from "@sporta/compute-adapter";
import { ComputeOutputArtifact } from "@sporta/compute-adapter";
import { restCall, errorMessageOf } from "../common/rest";
import type { ProviderCall, ProviderClientStatus, RemoteProviderClient } from "../common/ledger";
import type { ProviderRefusal } from "../common/refusal";
import { providerRefusal } from "../common/refusal";
import type { ProviderJobResult } from "../common/ledger";
import type { FetchLike } from "../common/http";

/** The default Modal REST base (documented public API host). */
export const MODAL_API_BASE_DEFAULT = "https://api.modal.co";

/** The default deployed worker function reference the adapter invokes. */
export const MODAL_WORKER_FUNCTION_DEFAULT = "sporta-compute-worker/main";

/** The default per-call timeout (ms) — an explicit bound on every call. */
export const MODAL_CALL_TIMEOUT_MS_DEFAULT = 20_000;

/** Non-empty string helper. */
const nonEmpty = z.string().min(1);

/** The functions-list answer (loose: provider-added fields tolerate). */
const ModalFunctionsList = z.object({
  functions: z.array(z.object({ functionId: nonEmpty }).passthrough()).optional(),
});

/** The invoke answer: the spawned invocation's identity. */
const ModalInvokeAnswer = z.object({ invocationId: nonEmpty }).passthrough();

/** One invocation's status answer (loose: provider-added fields tolerate). */
const ModalInvocationStatus = z.object({
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

/** Options for {@link ModalRestClient}. */
export interface ModalRestClientOptions {
  /** The scoped Modal-Token-Id (REQUIRED for a live client). */
  tokenId: string;
  /** The scoped Modal-Token-Secret (REQUIRED for a live client). */
  tokenSecret: string;
  /** The REST base (default {@link MODAL_API_BASE_DEFAULT}). */
  apiBase?: string;
  /** The deployed worker function reference (default the sporta worker). */
  workerFunction?: string;
  /** The injected fetch (tests replay recorded fixtures; default: real). */
  fetchFn?: FetchLike;
  /** The explicit per-call timeout (default 20 s). */
  timeoutMs?: number;
}

/** The REAL Modal REST client behind `provider.modal` (see module docs). */
export class ModalRestClient implements RemoteProviderClient {
  readonly endpointFamily = "modal:functions";
  readonly providerInstanceId: string;

  private readonly tokenId: string;
  private readonly tokenSecret: string;
  private readonly apiBase: string;
  private readonly workerFunction: string;
  private readonly fetchFn?: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ModalRestClientOptions) {
    this.tokenId = options.tokenId;
    this.tokenSecret = options.tokenSecret;
    this.apiBase = (options.apiBase ?? MODAL_API_BASE_DEFAULT).replace(/\/+$/, "");
    this.workerFunction = options.workerFunction ?? MODAL_WORKER_FUNCTION_DEFAULT;
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? MODAL_CALL_TIMEOUT_MS_DEFAULT;
    this.providerInstanceId = `modal:${this.workerFunction}`;
  }

  /** The scoped-token auth headers (values never leave this method). */
  private authHeaders(): Record<string, string> {
    return {
      "Modal-Token-Id": this.tokenId,
      "Modal-Token-Secret": this.tokenSecret,
      "content-type": "application/json",
    };
  }

  async verifyCredentials(): Promise<ProviderCall<string>> {
    const result = await restCall(
      {
        url: `${this.apiBase}/v1/functions`,
        method: "GET",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs, retries: 1 },
      {
        endpoint: "modal:functions",
        ok: (status, body) => {
          const parsed = ModalFunctionsList.safeParse(body);
          const count = parsed.success ? (parsed.data.functions?.length ?? 0) : undefined;
          return {
            ok: true,
            value: `authenticated against the functions endpoint (HTTP ${status}${count !== undefined ? `, ${count} function(s) visible` : ""})`,
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
    const result = await restCall<{ invocationId: string }>(
      {
        url: `${this.apiBase}/v1/functions/${encodeURIComponent(this.workerFunction)}/invoke`,
        method: "POST",
        headers: this.authHeaders(),
        // The W914 dispatch request rides the body verbatim (the deployed
        // worker is the hosted compute worker; materialized inputs when the
        // control plane dispatched them).
        body: materialized === undefined ? { job } : { job, inputs: materialized },
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs }, // NO retries — a dispatch never re-POSTs
      {
        endpoint: "modal:functions",
        ok: (status, body) => {
          const parsed = ModalInvokeAnswer.safeParse(body);
          if (!parsed.success) {
            return {
              ok: false,
              refusal: providerRefusal(
                "provider-unavailable",
                `the invoke endpoint answered an unparseable body (HTTP ${status}): ${errorMessageOf(body, "no invocationId")}`,
                { transport: { kind: "http", status, endpoint: "modal:functions" } },
              ),
            };
          }
          return { ok: true, value: parsed.data };
        },
      },
    );
    if (!result.ok) return result;
    return { ok: true, value: { providerJobId: result.value.invocationId } };
  }

  async status(providerJobId: string): Promise<ProviderCall<ProviderClientStatus>> {
    const result = await restCall<ProviderClientStatus>(
      {
        url: `${this.apiBase}/v1/functions/${encodeURIComponent(this.workerFunction)}/invocations/${encodeURIComponent(providerJobId)}`,
        method: "GET",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs, retries: 1 },
      {
        endpoint: "modal:functions",
        notFound: (body) =>
          providerRefusal(
            "provider-unavailable",
            `invocation '${providerJobId}' not found: ${errorMessageOf(body, "gone")}`,
            {
              transport: { kind: "http", status: 404, endpoint: "modal:functions" },
              permanent: true,
            },
          ),
        ok: (status, body) => {
          const parsed = ModalInvocationStatus.safeParse(body);
          if (!parsed.success) {
            return {
              ok: false,
              refusal: providerRefusal(
                "provider-unavailable",
                `the invocation status endpoint answered an unparseable body (HTTP ${status})`,
                { transport: { kind: "http", status, endpoint: "modal:functions" } },
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
    const result = await restCall<void>(
      {
        url: `${this.apiBase}/v1/functions/${encodeURIComponent(this.workerFunction)}/invocations/${encodeURIComponent(providerJobId)}/cancel`,
        method: "POST",
        headers: this.authHeaders(),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs }, // no retries
      {
        endpoint: "modal:functions",
        ok: () => ({ ok: true, value: undefined }),
      },
    );
    return result;
  }
}

/** Re-exported for the adapter's typed surface. */
export type { ProviderRefusal as ModalProviderRefusal };
