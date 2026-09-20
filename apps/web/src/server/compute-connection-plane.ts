/**
 * THE COMPUTE CONNECTION PLANE (J005) — the composition wiring that turns
 * the four REAL provider adapters (`@sporta/compute-provider-adapters`
 * R402-R405) into `ConnectionPlaneProvider` entries the
 * `@sporta/connection-center` ConnectionCenter (R406) drives.
 *
 * Each entry is DATA + one FACTORY: the factory builds the provider's REAL
 * adapter with the presented credential INJECTED (the value is consumed
 * transiently by the adapter — never stored, never logged, never
 * reported; the record keeps only the sha-256 fingerprint reference).
 *
 * ## The honest entries (per adapter's own documented posture)
 *
 * - `provider.modal` — a scoped Modal-Token pair (`scoped-token-pair`); in
 *   SandboxFallback mode (no credential) the adapter's own credential gate
 *   refuses dispatch and its `credentialStatus()` reports `missing` — never
 *   faked success;
 * - `provider.lightning` — a scoped account API key (`scoped-api-key`); the
 *   optional studio target rides the composition env (`LIGHTNING_STUDIO_ID`
 *   — resolved ONCE here, the composition-root rule);
 * - `provider.runpod` — a scoped account API key (`scoped-api-key`);
 * - `provider.local` — NO credentials (`not-applicable`), included ONLY
 *   when the operator configured a command table
 *   (`SPORTA_LOCAL_COMPUTE_COMMANDS` — a JSON `rendererId → command` map);
 *   a self-hosted option without commands is honestly NOT offered (the
 *   product never invents a command).
 *
 * ## Execution zones (operator DATA — the Sporta-vs-BYOC axis)
 *
 * The three remote providers declare `provider-cloud` (BYOC — the user's
 * own provider account); local declares `user-controlled`. These are the
 * same axes the SelectionDirector's `ProviderSelectionFacts` carry — never
 * provider names in any contract member.
 */
import type { ConnectionPlaneProvider } from "@sporta/connection-center";
import type { AcceptedCredentialPresentation } from "@sporta/connection-center";
import { LightningComputeAdapter } from "@sporta/compute-provider-adapters";
import { LocalComputeAdapter } from "@sporta/compute-provider-adapters";
import { ModalComputeAdapter } from "@sporta/compute-provider-adapters";
import { RunPodComputeAdapter } from "@sporta/compute-provider-adapters";
import type { LocalCommandSpec } from "@sporta/compute-provider-adapters";

/**
 * The injected-fetch seam (structural — the adapters' own `FetchLike`):
 * tests control the provider transport; production passes the real fetch.
 */
export type ControlledProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** The execution-zone axis (the connection plane's operator declarations). */
export type ComputeExecutionZone = "user-controlled" | "provider-cloud" | "sporta-managed";

/** Options for {@link buildComputeConnectionPlane}. */
export interface ComputeConnectionPlaneOptions {
  /** The injected clock (every adapter needs it — the purity rule). */
  nowMs: () => number;
  /** The injected fetch for the remote adapters (tests control transport). */
  fetchFn?: ControlledProviderFetch;
  /** The Lightning studio target (the composition env, resolved once). */
  lightningStudioId?: string;
  /**
   * The local self-hosted command table (REQUIRED for the local entry —
   * absent means the local option is honestly not offered).
   */
  localCommands?: Readonly<Record<string, LocalCommandSpec>>;
  /** The local GPU probe result (the adapter descriptor derives from it). */
  localGpu?: { available: boolean; name?: string; probe: "nvidia-smi" };
}

/**
 * The provider entries + their execution-zone declarations. Same inputs →
 * same plane (the composition is explicit — no hidden state).
 */
export interface ComputeConnectionPlane {
  providers: readonly ConnectionPlaneProvider[];
  executionZones: ReadonlyMap<string, ComputeExecutionZone>;
}

/** Builds the connection plane over the REAL provider adapters. */
export function buildComputeConnectionPlane(
  options: ComputeConnectionPlaneOptions,
): ComputeConnectionPlane {
  const nowMs = options.nowMs;
  const fetchFn = options.fetchFn;

  const modal: ConnectionPlaneProvider = {
    providerId: "provider.modal",
    supportedCredentialKinds: ["scoped-token-pair"],
    requiresCredential: true,
    createAdapter(presentation: AcceptedCredentialPresentation | null) {
      const pair = presentation?.kind === "scoped-token-pair" ? presentation : null;
      return new ModalComputeAdapter({
        tokenId: pair?.tokenId ?? "",
        tokenSecret: pair?.tokenSecret ?? "",
        nowMs,
        ...(fetchFn !== undefined ? { fetchFn } : {}),
      });
    },
  };

  const lightning: ConnectionPlaneProvider = {
    providerId: "provider.lightning",
    supportedCredentialKinds: ["scoped-api-key"],
    requiresCredential: true,
    createAdapter(presentation: AcceptedCredentialPresentation | null) {
      const key = presentation?.kind === "scoped-api-key" ? presentation : null;
      return new LightningComputeAdapter({
        apiKey: key?.apiKey ?? "",
        ...(options.lightningStudioId !== undefined && options.lightningStudioId !== ""
          ? { studioId: options.lightningStudioId }
          : {}),
        nowMs,
        ...(fetchFn !== undefined ? { fetchFn } : {}),
      });
    },
  };

  const runpod: ConnectionPlaneProvider = {
    providerId: "provider.runpod",
    supportedCredentialKinds: ["scoped-api-key"],
    requiresCredential: true,
    createAdapter(presentation: AcceptedCredentialPresentation | null) {
      const key = presentation?.kind === "scoped-api-key" ? presentation : null;
      return new RunPodComputeAdapter({
        apiKey: key?.apiKey ?? "",
        nowMs,
        ...(fetchFn !== undefined ? { fetchFn } : {}),
      });
    },
  };

  const providers: ConnectionPlaneProvider[] = [modal, lightning, runpod];

  // The local self-hosted entry exists ONLY with an operator command table
  // (a self-hosted option without commands is honestly not offered — the
  // product never invents a command).
  if (
    options.localCommands !== undefined &&
    Object.keys(options.localCommands).length > 0
  ) {
    const local: ConnectionPlaneProvider = {
      providerId: "provider.local",
      supportedCredentialKinds: [],
      requiresCredential: false,
      createAdapter() {
        return new LocalComputeAdapter({
          commands: options.localCommands!,
          ...(options.localGpu !== undefined ? { gpu: options.localGpu } : {}),
          nowMs,
        });
      },
    };
    providers.push(local);
  }

  const executionZones = new Map<string, ComputeExecutionZone>([
    ["provider.modal", "provider-cloud"],
    ["provider.lightning", "provider-cloud"],
    ["provider.runpod", "provider-cloud"],
    ...(options.localCommands !== undefined && Object.keys(options.localCommands).length > 0
      ? ([["provider.local", "user-controlled"]] as const)
      : []),
  ]);

  return { providers, executionZones };
}

/**
 * Parses the operator's local command-table declaration
 * (`SPORTA_LOCAL_COMPUTE_COMMANDS` — JSON). Fail-loud on garbage (the
 * composition-root doctrine: an invalid declaration is a typed error,
 * never a silent skip); `undefined` when the variable is absent/empty
 * (the honest "not configured" state).
 */
export function parseLocalComputeCommands(
  raw: string | undefined,
): Readonly<Record<string, LocalCommandSpec>> | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "SPORTA_LOCAL_COMPUTE_COMMANDS is not valid JSON (expected a rendererId → { command, args? } map)",
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("SPORTA_LOCAL_COMPUTE_COMMANDS must be a JSON object");
  }
  const commands: Record<string, LocalCommandSpec> = {};
  for (const [rendererId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as Record<string, unknown>)["command"] !== "string" ||
      (value as Record<string, unknown>)["command"] === ""
    ) {
      throw new Error(
        `SPORTA_LOCAL_COMPUTE_COMMANDS['${rendererId}'] must be { command: string, args?: string[] }`,
      );
    }
    const spec = value as { command: string; args?: unknown };
    commands[rendererId] = {
      command: spec.command,
      ...(Array.isArray(spec.args)
        ? { args: spec.args.filter((arg): arg is string => typeof arg === "string") }
        : {}),
    };
  }
  if (Object.keys(commands).length === 0) {
    throw new Error("SPORTA_LOCAL_COMPUTE_COMMANDS must map at least one renderer command");
  }
  return commands;
}
