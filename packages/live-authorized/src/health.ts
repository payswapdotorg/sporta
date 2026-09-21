/**
 * THE AUTHORIZED LIVE PROVIDER HEALTH/CAPABILITY SURFACE (L009) — the
 * operator-visible honest answer, built on the env gate (./env.ts).
 *
 * NEVER turns a check into a claim: `blocked` until every binding exists,
 * `ready` when they do — and `ready` still carries the activation
 * checklist reminder (the live frame schema must be verified on the first
 * real pull; the fixtures pin the RECORDED shape only). Secret values
 * never appear — binding names and presence only.
 */
import { authorizedFeedCapability, type AuthorizedEnvLike } from "./env";
import { SKILLCORNER_AUTHORIZED_PROFILE_TECHNOLOGY_ID } from "./profile";
import {
  SKILLCORNER_AUTHORIZED_ADAPTER_ID,
  SKILLCORNER_AUTHORIZED_ADAPTER_VERSION,
} from "./skillcorner/authorized-feed";

/** One provider's honest health row. */
export interface AuthorizedLiveProviderHealth {
  provider: string;
  technologyId: string;
  adapterId: string;
  adapterVersion: string;
  state: "blocked" | "ready";
  missingBindings: string[];
  matchId: string | null;
  apiBase: string;
  note: string;
}

/** The full authorized-live provider panel (deterministic order). */
export interface AuthorizedLiveProviderHealthPanel {
  providers: AuthorizedLiveProviderHealth[];
  summary: {
    ready: number;
    blocked: number;
    note: string;
  };
}

/**
 * The capability/health panel for the authorized live providers (PURE —
 * callers pass the env; the platform layer owns process access).
 */
export function authorizedLiveProviderHealth(
  env: AuthorizedEnvLike,
): AuthorizedLiveProviderHealthPanel {
  const capability = authorizedFeedCapability(env);
  const row: AuthorizedLiveProviderHealth = {
    provider: capability.provider,
    technologyId: SKILLCORNER_AUTHORIZED_PROFILE_TECHNOLOGY_ID,
    adapterId: SKILLCORNER_AUTHORIZED_ADAPTER_ID,
    adapterVersion: SKILLCORNER_AUTHORIZED_ADAPTER_VERSION,
    state: capability.state,
    missingBindings: capability.missingBindings,
    matchId: capability.matchId,
    apiBase: capability.apiBase,
    note: capability.activationNote,
  };
  return {
    providers: [row],
    summary: {
      ready: row.state === "ready" ? 1 : 0,
      blocked: row.state === "blocked" ? 1 : 0,
      note:
        "the authorized live provider panel reports binding presence only — secrets never " +
        "leave the env gate; `ready` still requires the first-pull live frame-schema " +
        "verification (the recorded shape is pinned by fixtures, not by a live sample)",
    },
  };
}
