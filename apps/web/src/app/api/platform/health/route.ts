/**
 * GET /api/platform/health — the deployment's honest platform snapshot
 * (W910/W911/W912/W913 evidence surface).
 *
 * The checks live in `server/platform-health.ts` (W907) — the ONE shared
 * implementation behind this route AND the Operator workspace's Operations
 * surface, so the two can never drift. See that module for the honesty rules:
 * this route NEVER turns a check into a claim (an unconfigured provider is
 * `unconfigured`, an unreachable one `error`, neither is "healthy").
 *
 * J007: the control-plane row reports the RUNNING composition's actual
 * backing — the hosted Neon gate when DATABASE_URL is configured, the LOCAL
 * sqlite durable store when the runtime is the real Bun without hosted
 * credentials (a LIVE read through the real store), or the honest
 * in-memory state.
 */
import {
  platformSnapshot,
  controlPlaneOverrideOf,
  identityPlaneOverrideOf,
} from "@/server/platform-health";
import { getSportaServer } from "@/server/runtime";
import { jsonRespond, newRequestId } from "@/server/platform/api-utils";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = newRequestId();
  const server = await getSportaServer();
  await server.ready;
  // J007/J014: the control-plane AND identity rows report the RUNNING
  // composition's actual backing (the env-derived rows cannot see the local
  // sqlite stores the Bun runtime constructed).
  const snapshot = await platformSnapshot({
    ...controlPlaneOverrideOf(server),
    ...identityPlaneOverrideOf(server),
  });
  return jsonRespond(200, snapshot, requestId);
}
