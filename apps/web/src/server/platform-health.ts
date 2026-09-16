/**
 * The honest platform snapshot (W907) — the ONE shared implementation behind
 * both `GET /api/platform/health` and the Operator workspace's Operations
 * surface, so the two can never drift.
 *
 * Reports, WITHOUT ever exposing secret values:
 * - the environment tier + the deployment marker (rollback evidence);
 * - which provider each seam is bound to (neon / r2 / upstash vs the
 *   in-memory fallbacks) and a LIVE reachability check for each;
 * - the R2 usage-guardrail seam note (W919 — the free-tier limits the
 *   capability feed will surface once counters exist).
 *
 * This module NEVER turns a check into a claim: an unconfigured provider is
 * reported `unconfigured`, an unreachable one `error`, and neither is
 * presented as healthy.
 */
import { deployMarker, platformEnv, providerAvailability } from "./platform/env";
import { neonClient } from "./platform/db/pg";
import { getHostedRenderOutputStore } from "./platform/r2/hosted";
import { getHostedTransientState } from "./platform/upstash/redis";
import { HOSTED_STORE_DEFAULT_LIMITS } from "./platform/r2/r2-store";

type CheckState = "ok" | "unconfigured" | "error";

export interface ProviderCheck {
  state: CheckState;
  /** Non-secret descriptor (bucket name / provider kind) when configured. */
  detail?: string;
}

async function checkNeon(): Promise<ProviderCheck> {
  const sql = neonClient();
  if (sql === null) return { state: "unconfigured" };
  try {
    await sql`SELECT 1`;
    return { state: "ok", detail: "postgres" };
  } catch {
    return { state: "error", detail: "postgres" };
  }
}

async function checkR2(): Promise<ProviderCheck> {
  const store = getHostedRenderOutputStore();
  if (store === null) return { state: "unconfigured" };
  try {
    // Reading the stats object proves credentials + bucket reachability
    // (404 = empty bucket is still a PASS for the delivery path).
    await store.stats();
    return { state: "ok", detail: store.describe().bucket };
  } catch {
    return { state: "error", detail: store.describe().bucket };
  }
}

async function checkUpstash(): Promise<ProviderCheck> {
  const state = getHostedTransientState();
  if (state.provider === "in-memory") return { state: "unconfigured", detail: "in-memory" };
  try {
    const pong = await state.redis.ping();
    return pong === "PONG"
      ? { state: "ok", detail: "upstash" }
      : { state: "error", detail: "upstash" };
  } catch {
    return { state: "error", detail: "upstash" };
  }
}

/** The full honest platform snapshot (the /api/platform/health document). */
export async function platformSnapshot() {
  const [neon, r2, upstash] = await Promise.all([checkNeon(), checkR2(), checkUpstash()]);
  return {
    env: platformEnv(),
    deployMarker: deployMarker(),
    providers: {
      identity: { ...providerAvailability().identity, check: neon },
      artifacts: { ...providerAvailability().artifacts, check: r2 },
      transientState: { ...providerAvailability().transientState, check: upstash },
    },
    usageGuardrails: {
      note: "R2 free-tier limits (10 GB-month storage, 1M Class A, 10M Class B ops) are enforced via the W504 store bounds; provider usage counters are W919 scope.",
      storeLimits: { ...HOSTED_STORE_DEFAULT_LIMITS } as Record<string, number>,
    },
  };
}
