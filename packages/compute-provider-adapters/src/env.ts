/**
 * The provider-adapter COMPOSITION ROOT (R402-R405): the ONE module that
 * reads `process.env` (the `@sporta/compute-adapter-hosted` `src/env.ts`
 * precedent — the domain adapters read NO env, test/boundary.test.ts pins
 * it) and resolves the four real provider adapters + their credentials
 * from configuration.
 *
 * Credential env names (the ONLY surface that touches them; values are
 * read here and INJECTED — never logged, never persisted):
 *
 * - `provider.modal`: `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` (a scoped
 *   modal-token pair — never a master key);
 * - `provider.lightning`: `LIGHTNING_API_KEY` (an account API key) +
 *   `LIGHTNING_STUDIO_ID` (the job-surface target);
 * - `provider.runpod`: `RUNPOD_API_KEY` (an account API key);
 * - `provider.local`: none (`credentialStatus()` answers `not-applicable`).
 *
 * Every adapter this module hands back carries its honest
 * `credentialStatus()` — absent credentials mean the adapter is in its
 * documented SandboxFallback mode (dispatch refuses `provider-unavailable`
 * with a `devModeHint` before any network call — NEVER faked success).
 */
import { ModalComputeAdapter } from "./modal/adapter";
import { LightningComputeAdapter } from "./lightning/adapter";
import { RunPodComputeAdapter } from "./runpod/adapter";
import { LocalComputeAdapter, createLocalComputeAdapter } from "./local/adapter";
import type { LocalComputeAdapterOptions } from "./local/adapter";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import type { FetchLike } from "./common/http";

/** The environment the composition root reads (injectable for tests). */
export type ProviderEnv = Record<string, string | undefined>;

/** Options for {@link resolveProviderAdaptersFromEnv}. */
export interface ResolveProviderAdaptersOptions {
  /** The environment to read (default `process.env`). */
  env?: ProviderEnv;
  /** The injected clock (REQUIRED — every adapter needs it). */
  nowMs: () => number;
  /** Override the local adapter's command table (REQUIRED for local). */
  localCommands?: LocalComputeAdapterOptions["commands"];
  /** The injected fetch for the remote adapters (default: the real fetch). */
  fetchFn?: FetchLike;
}

/** What the composition root resolves. */
export interface ResolvedProviderAdapters {
  /** The `provider.modal` adapter (SandboxFallback when creds absent). */
  modal: ModalComputeAdapter;
  /** The `provider.lightning` adapter (SandboxFallback when creds absent). */
  lightning: LightningComputeAdapter;
  /** The `provider.runpod` adapter (SandboxFallback when creds absent). */
  runpod: RunPodComputeAdapter;
  /** The `provider.local` adapter (needs a command table — absent when none was supplied). */
  local: LocalComputeAdapter | null;
  /** Every resolved adapter behind the provider-neutral port. */
  adapters: ComputeAdapterPort[];
}

/**
 * Resolves the four real provider adapters from the environment (see the
 * module docs). All four are constructed honestly regardless of
 * credential presence (their `credentialStatus()` and dispatch gates carry
 * the truth); the local adapter needs a command table and is `null`
 * without one.
 */
export async function resolveProviderAdaptersFromEnv(
  options: ResolveProviderAdaptersOptions,
): Promise<ResolvedProviderAdapters> {
  const env = options.env ?? process.env;
  const modal = new ModalComputeAdapter({
    tokenId: env["MODAL_TOKEN_ID"] ?? "",
    tokenSecret: env["MODAL_TOKEN_SECRET"] ?? "",
    nowMs: options.nowMs,
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  });
  const lightning = new LightningComputeAdapter({
    apiKey: env["LIGHTNING_API_KEY"] ?? "",
    studioId: env["LIGHTNING_STUDIO_ID"] ?? "",
    nowMs: options.nowMs,
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  });
  const runpod = new RunPodComputeAdapter({
    apiKey: env["RUNPOD_API_KEY"] ?? "",
    nowMs: options.nowMs,
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  });
  const local =
    options.localCommands !== undefined
      ? await createLocalComputeAdapter({ commands: options.localCommands, nowMs: options.nowMs })
      : null;
  const adapters: ComputeAdapterPort[] = [modal, lightning, runpod];
  if (local !== null) adapters.push(local);
  return { modal, lightning, runpod, local, adapters };
}
