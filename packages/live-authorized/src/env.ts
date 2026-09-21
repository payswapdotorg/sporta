/**
 * THE ENV-DRIVEN CONFIGURATION GATE (L009) — the honest answer to "can this
 * deployment feed the live contract from a real authorized provider?".
 *
 * THE RECORDED PROVIDER FACTS (fetched 2026-09-21 — see ./profile.ts for the
 * full citations): SkillCorner's authorized API rides
 * `https://skillcorner.com` (the provider's own Python SDK `class_config`
 * `base_url`, PyPI `skillcorner==3.2.0`) with HTTP BASIC authentication
 * from the username/password bindings the SDK itself reads
 * (`SKILLCORNER_USERNAME` / `SKILLCORNER_PASSWORD` — the provider's own env
 * naming convention, adopted verbatim so an operator's existing SDK
 * bindings activate this adapter with zero renaming), and the tracking
 * endpoint is `GET /api/match/{match_id}/tracking` (the SDK's
 * `match_tracking_data` method config).
 *
 * THE HONESTY RULES (pinned by tests):
 * - this module NEVER invents credentials, NEVER defaults a binding, and
 *   NEVER logs or returns a secret VALUE — only binding NAMES and presence;
 * - an unconfigured deployment is `blocked` with the EXACT missing binding
 *   names (the recorded external dependency, never a smoothed "unknown");
 * - a configured deployment is `ready` and carries the resolved,
 *   non-secret configuration (base URL, match id — the username/password
 *   stay behind the config object and are only ever handed to the feed's
 *   Authorization header).
 */
/** The provider binding names (the provider SDK's own env convention). */
export const SKILLCORNER_USERNAME_ENV = "SKILLCORNER_USERNAME" as const;
export const SKILLCORNER_PASSWORD_ENV = "SKILLCORNER_PASSWORD" as const;
export const SKILLCORNER_MATCH_ID_ENV = "SKILLCORNER_MATCH_ID" as const;
export const SKILLCORNER_API_BASE_ENV = "SKILLCORNER_API_BASE" as const;

/**
 * The recorded default API base (the provider SDK's `base_url`, fetched
 * 2026-09-21 — never invented; overridable for proxies/test rigs).
 */
export const SKILLCORNER_DEFAULT_API_BASE = "https://skillcorner.com" as const;

/** The minimal env-reading surface (tests inject plain objects). */
export type AuthorizedEnvLike = Record<string, string | undefined>;

/** The resolved, ready configuration (secrets never leave this object). */
export interface SkillCornerAuthorizedConfig {
  provider: "skillcorner";
  /** HTTP Basic username (secret — only ever used in the auth header). */
  username: string;
  /** HTTP Basic password (secret — only ever used in the auth header). */
  password: string;
  /** The provider's match id to follow (non-secret). */
  matchId: string;
  /** The API base URL (non-secret; the recorded default stands). */
  apiBase: string;
}

/** The honest capability answer for one deployment's env. */
export interface AuthorizedFeedCapability {
  provider: "skillcorner";
  /** `ready` only when EVERY required binding is present and non-empty. */
  state: "ready" | "blocked";
  /** The exact missing binding names (empty when ready) — never a guess. */
  missingBindings: string[];
  /** The non-secret resolved facts (absent when blocked). */
  matchId: string | null;
  apiBase: string;
  /** The activation line an operator can act on (names only, no secrets). */
  activationNote: string;
}

function readBinding(env: AuthorizedEnvLike, name: string): string | undefined {
  const value = env[name];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

/**
 * Resolves the authorized SkillCorner feed configuration from an env (PURE —
 * no process access; callers pass `process.env` at the platform layer).
 * Throws NEVER: an incomplete binding set is the honest `blocked` answer.
 */
export function authorizedSkillCornerConfig(
  env: AuthorizedEnvLike,
): SkillCornerAuthorizedConfig | { blocked: true; missingBindings: string[] } {
  const username = readBinding(env, SKILLCORNER_USERNAME_ENV);
  const password = readBinding(env, SKILLCORNER_PASSWORD_ENV);
  const matchId = readBinding(env, SKILLCORNER_MATCH_ID_ENV);
  const missing: string[] = [];
  if (username === undefined) missing.push(SKILLCORNER_USERNAME_ENV);
  if (password === undefined) missing.push(SKILLCORNER_PASSWORD_ENV);
  if (matchId === undefined) missing.push(SKILLCORNER_MATCH_ID_ENV);
  if (missing.length > 0) return { blocked: true, missingBindings: missing };
  const apiBase = readBinding(env, SKILLCORNER_API_BASE_ENV) ?? SKILLCORNER_DEFAULT_API_BASE;
  let normalizedBase = apiBase;
  while (normalizedBase.endsWith("/")) normalizedBase = normalizedBase.slice(0, -1);
  return {
    provider: "skillcorner",
    username: username!,
    password: password!,
    matchId: matchId!,
    apiBase: normalizedBase,
  };
}

/**
 * The capability/health answer (the L009 gate): `blocked` with the exact
 * missing bindings until credentials + feed access exist, `ready` when the
 * full binding set is present. NEVER carries secret values.
 */
export function authorizedFeedCapability(env: AuthorizedEnvLike): AuthorizedFeedCapability {
  const resolved = authorizedSkillCornerConfig(env);
  if ("blocked" in resolved) {
    return {
      provider: "skillcorner",
      state: "blocked",
      missingBindings: resolved.missingBindings,
      matchId: null,
      apiBase: readBinding(env, SKILLCORNER_API_BASE_ENV) ?? SKILLCORNER_DEFAULT_API_BASE,
      activationNote:
        `set ${resolved.missingBindings.join(", ")} to activate the authorized SkillCorner ` +
        "live feed (HTTP Basic credentials + the provider match id; contractual feed access " +
        "required — see docs/status/l009-authorized-provider-adapter.md)",
    };
  }
  return {
    provider: "skillcorner",
    state: "ready",
    missingBindings: [],
    matchId: resolved.matchId,
    apiBase: resolved.apiBase,
    activationNote:
      "bindings present — the authorized SkillCorner feed can be constructed " +
      "(verify the live frame schema on first pull; see the activation checklist)",
  };
}
