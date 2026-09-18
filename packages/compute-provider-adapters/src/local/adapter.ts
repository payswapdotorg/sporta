/**
 * `LocalComputeAdapter` (R405) — the `provider.local` compute adapter: the
 * SELF-HOSTED execution option — the W914 `ComputeAdapterPort` (via the
 * shared provider ledger, ../common/ledger.ts) over the REAL local process
 * client (./api.ts — one dispatched workload = one `Bun.spawn` subprocess
 * with bounded stdio, the `@sporta/decoding` precedent).
 *
 * ## Credential path: none (honest)
 *
 * `credentialStatus()` answers `not-applicable` — there is no credential,
 * no verification call, and the credential gate passes by construction.
 *
 * ## GPU honesty (the descriptor is DERIVED, never asserted)
 *
 * The descriptor's `providerKind` comes from the INJECTED nvidia-smi probe
 * (./gpu.ts — `detectLocalGpu()` runs the real probe; the async factory
 * {@link createLocalComputeAdapter} runs it for you): available →
 * `gpu-worker` (the detected GPU name recorded as evidence); absent →
 * `cpu-worker`, and a workload whose `resourceHints.computeClass` mentions
 * GPU gets the typed `no-compatible-gpu` refusal at dispatch (the R401
 * vocabulary as data, classed resource-limit — the W104/W303 never-fits
 * posture).
 *
 * ## Descriptor derivation (honest by construction)
 *
 * `supportedRenderers` derives from the COMMAND TABLE (a renderer without
 * a mapped command is never declared), latency classes are the dev-posture
 * honest set (`offline`, `near-live` — a local subprocess genuinely serves
 * sub-second dev workloads), the bounds are the adapter's OWN (concurrency
 * 2 — bounded local subprocesses; deadline 10 s floor / 300 s ceiling),
 * and the one metering unit (`cpu-ms`) is the MEASURED subprocess
 * wall clock (start-to-exit on the injected clock) — no invented numbers.
 */
import type { ComputeAdapterDescriptor, ComputeJobDescription } from "@sporta/compute-adapter";
import { ProviderLedgerAdapter } from "../common/ledger";
import type { ProviderLedgerAdapterOptions } from "../common/ledger";
import { MEASURED_CPU_MS_UNIT, resolveDescriptor } from "../common/descriptors";
import type { DescriptorOverrides } from "../common/descriptors";
import type { ProviderRefusal } from "../common/refusal";
import { providerRefusal } from "../common/refusal";
import { LocalProcessClient } from "./api";
import type { LocalCommandSpec, LocalProcessClientOptions } from "./api";
import { detectLocalGpu, jobRequiresGpu } from "./gpu";
import type { LocalGpuProbe } from "./gpu";

/** The adapter identity (DATA — the provider id, never a vocabulary member). */
export const LOCAL_ADAPTER_ID = "provider.local";

/** The adapter contract version (MAJOR.MINOR). */
export const LOCAL_ADAPTER_VERSION = "1.0";

/** The not-applicable credential gate (no credentials — R405's honest path). */
const NOT_APPLICABLE_GATE = {
  credentialStatus: () => ({
    state: "not-applicable" as const,
    detail: "the local self-hosted adapter needs no credentials",
  }),
  gateRefusal: () => null,
  markVerified: () => undefined,
  markInvalid: () => undefined,
  markUnverifiable: () => undefined,
};

/** Options for {@link LocalComputeAdapter}. */
export interface LocalComputeAdapterOptions
  extends
    Omit<ProviderLedgerAdapterOptions, "descriptor" | "client" | "credentials">,
    Pick<LocalProcessClientOptions, "maxOutputBytes"> {
  /** The renderer→command table (REQUIRED — the descriptor derives from it). */
  commands: Readonly<Record<string, LocalCommandSpec>>;
  /** The injected GPU probe result (omit + use the async factory for the real probe). */
  gpu?: LocalGpuProbe;
  /** Operator descriptor overrides (their declaration, validated not verified). */
  descriptorOverrides?: DescriptorOverrides;
}

/** Derives the honest local descriptor from the command table + GPU probe. */
function localDescriptor(
  commands: Readonly<Record<string, LocalCommandSpec>>,
  gpu: LocalGpuProbe,
  overrides?: DescriptorOverrides,
): ComputeAdapterDescriptor {
  // A renderer without a mapped command is NEVER declared (descriptor
  // honesty by construction — the command table is the truth).
  const supportedRenderers = Object.keys(commands).map((rendererId) => ({ rendererId }));
  return resolveDescriptor(
    { adapterId: LOCAL_ADAPTER_ID, adapterVersion: LOCAL_ADAPTER_VERSION },
    {
      providerKind: gpu.available ? "gpu-worker" : "cpu-worker",
      supportedRenderers,
      supportedLatencyClasses: ["offline", "near-live"],
      maxConcurrentJobs: 2,
      dispatchTimeoutMs: 10_000,
      maxJobDeadlineMs: 300_000,
      minJobDeadlineMs: 10_000,
      costUnits: [MEASURED_CPU_MS_UNIT],
    },
    overrides,
  );
}

/**
 * The `provider.local` adapter (R405): the self-hosted execution option —
 * thin composition of the shared provider ledger + the REAL local process
 * client + the honest GPU admission hook. The full LIVE tier
 * (test/local.test.ts) dispatches trivial REAL workloads end-to-end
 * through this adapter and collects status/events/usage through the W914
 * vocabulary (local execution is always available in the sandbox).
 */
export class LocalComputeAdapter extends ProviderLedgerAdapter {
  private readonly gpuProbe: LocalGpuProbe;

  constructor(options: LocalComputeAdapterOptions) {
    const gpu = options.gpu ?? { available: false, probe: "nvidia-smi" as const };
    const client = new LocalProcessClient({
      commands: options.commands,
      nowMs: options.nowMs,
      ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
    });
    super({
      descriptor: localDescriptor(options.commands, gpu, options.descriptorOverrides),
      client,
      credentials: NOT_APPLICABLE_GATE,
      nowMs: options.nowMs,
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.maxAdmittedJobs !== undefined
        ? { maxAdmittedJobs: options.maxAdmittedJobs }
        : {}),
    });
    this.gpuProbe = gpu;
  }

  /** The honest GPU probe result this adapter's descriptor derives from (DATA). */
  gpu(): LocalGpuProbe {
    return this.gpuProbe;
  }

  /** The credential path is honestly not applicable (R405). */
  override credentialStatus(): { state: "not-applicable"; detail: string } {
    return {
      state: "not-applicable",
      detail: "the local self-hosted adapter needs no credentials",
    };
  }

  /**
   * The GPU admission hook: a workload whose declared resource hints
   * require GPU-class compute against a CPU-only probe answers the typed
   * `no-compatible-gpu` refusal (the R401 vocabulary as data).
   */
  protected override admissionRefusalOf(job: ComputeJobDescription): ProviderRefusal | null {
    const computeClass = job.constraints.resourceHints?.computeClass;
    if (jobRequiresGpu(computeClass) && !this.gpuProbe.available) {
      return providerRefusal(
        "no-compatible-gpu",
        `workload requires GPU-class compute (resourceHints.computeClass '${computeClass}') but no local GPU was detected (probe '${this.gpuProbe.probe}' unavailable) — describe() advertises CPU-only`,
        { transport: { kind: "not-applicable", endpoint: "local:gpu-probe" } },
      );
    }
    return null;
  }
}

/**
 * The async factory that runs the REAL nvidia-smi probe first, then
 * constructs the adapter over the honest result (the constructor accepts
 * an injected probe for deterministic tests).
 */
export async function createLocalComputeAdapter(
  options: Omit<LocalComputeAdapterOptions, "gpu">,
): Promise<LocalComputeAdapter> {
  const gpu = await detectLocalGpu();
  return new LocalComputeAdapter({ ...options, gpu });
}
