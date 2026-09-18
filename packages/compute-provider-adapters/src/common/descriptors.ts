/**
 * Shared provider-descriptor defaults (R402-R405): the honest baseline
 * every adapter composes — abstract `providerKind`s (never vendor names),
 * the sporta renderer set the deployed workers host (version truth stays
 * with the deployment: `rendererVersions` is omitted, so admission trusts
 * the worker's registry — the W914 worker-descriptor derivation), and the
 * one honest metering unit every shipped descriptor declares.
 *
 * Every bound here is the ADAPTER's OWN bound (documented per adapter):
 * concurrency = in-flight handoffs the adapter will run; deadline bounds
 * = what the adapter accepts; dispatch timeout = the submit-call budget.
 * Operators override via each adapter's `descriptorOverrides` (their
 * declaration, validated but not verified by the adapter).
 */
import type {
  ComputeAdapterDescriptor,
  ComputeCostUnit,
  ComputeRendererSupport,
} from "@sporta/compute-adapter";

/**
 * The sporta renderer set the deployed provider workers host by default:
 * the W502 anime prototype (`anime.prototype`) and the deterministic W501
 * reference card (`sporta.testcard`) — the same registry the W914 hosted
 * worker composes by default. Version truth belongs to the deployment
 * (rendererVersions omitted on purpose).
 */
export const DEFAULT_REMOTE_RENDERERS: readonly ComputeRendererSupport[] = Object.freeze([
  { rendererId: "anime.prototype" },
  { rendererId: "sporta.testcard" },
]);

/**
 * The one honest metering unit every shipped provider descriptor declares:
 * MEASURED execution wall clock (the provider-reported duration when the
 * provider measures one, else the adapter's own first-start→terminal
 * measurement on the injected clock). No provider-native billing currency
 * is metered this wave — a pay-as-you-go price the adapter cannot know is
 * NEVER fabricated (broker quotes stay honest `null`s).
 */
export const MEASURED_COMPUTE_MS_UNIT: ComputeCostUnit = Object.freeze({
  unitId: "compute-ms",
  unitKind: "time-ms",
  description:
    "measured execution wall clock (provider-reported when available; provider-native billing is not metered)",
});

/** The local adapter's honest unit (Bun.spawn measured subprocess wall clock). */
export const MEASURED_CPU_MS_UNIT: ComputeCostUnit = Object.freeze({
  unitId: "cpu-ms",
  unitKind: "time-ms",
  description: "measured local subprocess wall clock (Bun.spawn start-to-exit)",
});

/** The shape of descriptor fields an operator may override (their declaration). */
export type DescriptorOverrides = Partial<
  Pick<
    ComputeAdapterDescriptor,
    | "providerKind"
    | "supportedRenderers"
    | "supportedLatencyClasses"
    | "maxConcurrentJobs"
    | "dispatchTimeoutMs"
    | "maxJobDeadlineMs"
    | "minJobDeadlineMs"
    | "costUnits"
  >
>;

/** Merges honest defaults with operator overrides (never adapter identity). */
export function resolveDescriptor(
  identity: { adapterId: string; adapterVersion: string },
  defaults: Omit<ComputeAdapterDescriptor, "schemaVersion" | "adapterId" | "adapterVersion">,
  overrides?: DescriptorOverrides,
): ComputeAdapterDescriptor {
  return {
    schemaVersion: "1.0",
    adapterId: identity.adapterId,
    adapterVersion: identity.adapterVersion,
    ...defaults,
    ...(overrides ?? {}),
  };
}
