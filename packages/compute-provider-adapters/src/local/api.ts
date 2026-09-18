/**
 * The LOCAL process client (R405) — the REAL execution surface of the
 * `provider.local` adapter: one dispatched workload becomes one LOCAL
 * SUBPROCESS (`Bun.spawn`, the `@sporta/decoding` ffmpeg precedent:
 * bounded stdio — stdout/stderr piped and read in full, a bounded stderr
 * tail in failures, an explicit output-size budget), measured honestly
 * (wall clock on the injected clock start-to-exit + the real exit code —
 * no invented numbers).
 *
 * The client implements the same `RemoteProviderClient` seam the remote
 * REST clients do (submit/status/cancel) so the SHARED provider ledger
 * drives it identically:
 *
 * - `submit` spawns the mapped command for the job's renderer (the
 *   documented dev posture: run the render/normalize command), hands the
 *   job JSON (plus materialized inputs, when the control plane dispatched
 *   them) to the subprocess on STDIN (commands that do not read stdin are
 *   fine — the write is EPIPE-tolerant), and answers the job id;
 * - `status` polls the REAL process: running while alive; once exited,
 *   the measured outcome (exit 0 → succeeded with the stdout artifact
 *   content-addressed sha-256; nonzero → failed with the real exit code
 *   and the bounded stderr tail; a spawn fault → failed with the real
 *   cause; an over-budget stdout → failed honestly);
 * - `cancel` kills the subprocess (the ledger cancel never loses a job).
 *
 * Input-consumption honesty: a subprocess interface cannot observe which
 * manifest inputs the command consumed — the ledger therefore accounts
 * every input unconsumed-with-reason (never a fabricated `consumed` set).
 */
import type { ComputeJobDescription, ComputeMaterializedInputs } from "@sporta/compute-adapter";
import type { ProviderCall, ProviderClientStatus, RemoteProviderClient } from "../common/ledger";
import type { ProviderJobResult } from "../common/ledger";
import { providerRefusal } from "../common/refusal";

/** One mapped local command (the dev posture's renderer table entry). */
export interface LocalCommandSpec {
  /** The executable to run (resolved through PATH — the real cause surfaces on spawn faults). */
  command: string;
  /** Static argv (the job JSON rides STDIN, not argv). */
  args?: readonly string[];
  /** The stdout artifact's content type (default `text/plain`). */
  contentType?: string;
}

/** The bounded stderr tail size (the @sporta/decoding STDERR_TAIL precedent). */
export const LOCAL_STDERR_TAIL_LIMIT = 2_000;

/** The default stdout artifact budget (the W914 hosted artifact budget). */
export const LOCAL_MAX_OUTPUT_BYTES_DEFAULT = 1_000_000;

/** Options for {@link LocalProcessClient}. */
export interface LocalProcessClientOptions {
  /** The renderer→command table (the descriptor's renderers derive from it). */
  commands: Readonly<Record<string, LocalCommandSpec>>;
  /** The injected clock (epoch-ms; REQUIRED — measured wall clock comes from it). */
  nowMs: () => number;
  /** The stdout artifact byte budget (default 1 MB). */
  maxOutputBytes?: number;
}

/** One measured process outcome (the honest record — no invented numbers). */
interface ProcessOutcome {
  exitCode: number | null;
  spawnError: string | undefined;
  stdout: string;
  stderr: string;
  startedAtMs: number;
  finishedAtMs: number;
}

/** One live process entry. */
interface ProcessEntry {
  proc: ReturnType<typeof Bun.spawn>;
  outcome: Promise<ProcessOutcome>;
}

/**
 * The REAL local execution surface behind `provider.local` — see the
 * module docs. THIS IS THE SELF-HOSTED EXECUTION OPTION: no credentials
 * (`credentialStatus()` answers `not-applicable`), no network, one
 * subprocess per dispatched job.
 */
export class LocalProcessClient implements RemoteProviderClient {
  readonly endpointFamily = "local:subprocess";
  readonly providerInstanceId = "local:subprocess";

  private readonly commands: Readonly<Record<string, LocalCommandSpec>>;
  private readonly nowMs: () => number;
  private readonly maxOutputBytes: number;
  private readonly live = new Map<string, ProcessEntry>();
  private readonly finished = new Map<string, ProcessOutcome>();

  constructor(options: LocalProcessClientOptions) {
    if (Object.keys(options.commands).length === 0) {
      throw new Error(
        "the local adapter needs at least one mapped renderer command (the descriptor derives its supported renderers from the table)",
      );
    }
    this.commands = options.commands;
    this.nowMs = options.nowMs;
    this.maxOutputBytes = options.maxOutputBytes ?? LOCAL_MAX_OUTPUT_BYTES_DEFAULT;
  }

  /** The credential path is honestly not applicable (no call, no network). */
  async verifyCredentials(): Promise<ProviderCall<string>> {
    return {
      ok: true,
      value: "local execution needs no credentials (not-applicable)",
    };
  }

  /** The mapped command table (the descriptor's renderer source of truth). */
  commandTable(): Readonly<Record<string, LocalCommandSpec>> {
    return this.commands;
  }

  async submit(
    job: ComputeJobDescription,
    materialized?: ComputeMaterializedInputs,
  ): Promise<ProviderCall<{ providerJobId: string }>> {
    const spec = this.commands[job.renderer.rendererId];
    if (spec === undefined) {
      // Defensive: the ledger's admission refuses unmapped renderers before
      // this point (the descriptor derives from the table) — a miss here is
      // an internal inconsistency, answered honestly.
      return {
        ok: false,
        refusal: providerRefusal(
          "provider-unavailable",
          `no local command is mapped for renderer '${job.renderer.rendererId}'`,
          { transport: { kind: "not-applicable", endpoint: "local:subprocess" } },
        ),
      };
    }
    const startedAtMs = this.nowMs();
    const argv = [spec.command, ...(spec.args ?? [])];
    // Record the job's session + renderer truth (artifact metadata + the
    // exact spec the outcome maps back to — never a guessed command).
    this.sessionIds.set(job.jobId, job.sessionId);
    this.rendererIds.set(job.jobId, job.renderer.rendererId);
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(argv, {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });
    } catch (err) {
      // A spawn fault (command not on PATH, exec format…): the REAL cause.
      this.finished.set(job.jobId, {
        exitCode: null,
        spawnError: err instanceof Error ? err.message : String(err),
        stdout: "",
        stderr: "",
        startedAtMs,
        finishedAtMs: this.nowMs(),
      });
      return { ok: true, value: { providerJobId: job.jobId } };
    }
    // The job JSON (+ materialized inputs) rides STDIN; commands that do
    // not read stdin are fine (the write is best-effort, EPIPE-tolerant).
    try {
      const payload = JSON.stringify(
        materialized === undefined ? { job } : { job, inputs: materialized },
      );
      // stdin: "pipe" gives Bun's FileSink; the structural type keeps this
      // free of a "bun" module import (the Bun-global posture).
      const stdin = proc.stdin as { write: (data: string) => unknown; end: () => void } | undefined;
      stdin?.write(payload);
      stdin?.end();
    } catch {
      // The command never reads stdin (echo-like) or exited first: fine.
    }
    // The measured outcome watcher: pipes read CONCURRENTLY with exit
    // (no 64 KB pipe-buffer deadlock — the decoding precedent).
    const outcome = (async (): Promise<ProcessOutcome> => {
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      ]);
      const finishedAtMs = this.nowMs();
      const measured: ProcessOutcome = {
        exitCode,
        spawnError: undefined,
        stdout,
        stderr,
        startedAtMs,
        finishedAtMs,
      };
      this.live.delete(job.jobId);
      this.finished.set(job.jobId, measured);
      return measured;
    })();
    this.live.set(job.jobId, { proc, outcome });
    return { ok: true, value: { providerJobId: job.jobId } };
  }

  async status(providerJobId: string): Promise<ProviderCall<ProviderClientStatus>> {
    const done = this.finished.get(providerJobId);
    if (done !== undefined) {
      return { ok: true, value: { phase: "terminal", result: this.resultOf(providerJobId, done) } };
    }
    if (this.live.has(providerJobId)) {
      return { ok: true, value: { phase: "running" } };
    }
    return {
      ok: false,
      refusal: providerRefusal(
        "provider-unavailable",
        `no local process record '${providerJobId}' (never submitted or already reaped)`,
        { transport: { kind: "not-applicable", endpoint: "local:subprocess" }, permanent: true },
      ),
    };
  }

  async cancel(providerJobId: string): Promise<ProviderCall<void>> {
    const entry = this.live.get(providerJobId);
    if (entry !== undefined) {
      entry.proc.kill();
    }
    return { ok: true, value: undefined };
  }

  /** Builds the measured terminal result (exit codes + bounded tails). */
  private resultOf(providerJobId: string, outcome: ProcessOutcome): ProviderJobResult {
    const executionMs = Math.max(0, outcome.finishedAtMs - outcome.startedAtMs);
    if (outcome.spawnError !== undefined) {
      return {
        status: "failed",
        outputs: [],
        consumedInputIds: [],
        failure: {
          errorClass: "local-process-spawn-failed",
          message: `local command spawn failed: ${outcome.spawnError}`,
          terminal: "non-retryable",
          retryable: false,
        },
        executionMs,
      };
    }
    const byteLength = new TextEncoder().encode(outcome.stdout).length;
    if (byteLength > this.maxOutputBytes) {
      return {
        status: "failed",
        outputs: [],
        consumedInputIds: [],
        failure: {
          errorClass: "local-output-over-budget",
          message: `local process stdout was ${byteLength} bytes (budget ${this.maxOutputBytes}) — no artifact handed back`,
          terminal: "non-retryable",
          retryable: false,
        },
        executionMs,
      };
    }
    if (outcome.exitCode !== 0) {
      const tail = outcome.stderr.slice(-LOCAL_STDERR_TAIL_LIMIT);
      return {
        status: "failed",
        outputs: [],
        consumedInputIds: [],
        failure: {
          errorClass: `local-process-exit-${String(outcome.exitCode)}`,
          message:
            `local command exited with code ${String(outcome.exitCode)}` +
            (tail.length > 0 ? `: ${tail}` : " (no stderr)"),
          terminal: "non-retryable",
          retryable: false,
        },
        executionMs,
      };
    }
    const spec = this.specOf(providerJobId);
    const outputs = [];
    if (outcome.stdout.length > 0) {
      outputs.push(this.artifactOf(providerJobId, outcome, spec));
    }
    return {
      status: "succeeded",
      outputs,
      // A subprocess interface cannot observe input consumption — the
      // ledger accounts every manifest input unconsumed-with-reason.
      consumedInputIds: [],
      executionMs,
    };
  }

  /** The content-addressed stdout artifact (sha-256, W504 convention). */
  private artifactOf(
    providerJobId: string,
    outcome: ProcessOutcome,
    spec: LocalCommandSpec | undefined,
  ) {
    const content = outcome.stdout;
    const digest = new Bun.CryptoHasher("sha256").update(content).digest("hex");
    const command = spec?.command ?? "unknown";
    return {
      schemaVersion: "1.0" as const,
      artifactId: digest,
      contentHash: digest,
      contentType: spec?.contentType ?? "text/plain",
      byteLength: new TextEncoder().encode(content).length,
      // The deterministic manifest of this dev execution (opaque, JSON-safe).
      manifest: {
        kind: "local-subprocess",
        command,
        exitCode: outcome.exitCode,
        executionMs: Math.max(0, outcome.finishedAtMs - outcome.startedAtMs),
      },
      // Session truth was recorded at submit; the fallback is a defensive
      // marker (unreachable in the ledger flow — status only polls submitted jobs).
      metadata: { sessionId: this.sessionIds.get(providerJobId) ?? "local-subprocess" },
      delivery: { mode: "inline" as const, content },
    };
  }

  /** The exact spec the submitted job's renderer mapped to (never a guess). */
  private specOf(providerJobId: string): LocalCommandSpec | undefined {
    const rendererId = this.rendererIds.get(providerJobId);
    if (rendererId === undefined) return undefined;
    return this.commands[rendererId];
  }

  private readonly sessionIds = new Map<string, string>();
  private readonly rendererIds = new Map<string, string>();
}
