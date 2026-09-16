/**
 * GET /api/platform/health — the deployment's honest platform snapshot
 * (W910/W911/W912/W913 evidence surface).
 *
 * The checks live in `server/platform-health.ts` (W907) — the ONE shared
 * implementation behind this route AND the Operator workspace's Operations
 * surface, so the two can never drift. See that module for the honesty rules:
 * this route NEVER turns a check into a claim (an unconfigured provider is
 * `unconfigured`, an unreachable one `error`, neither is "healthy").
 */
import { platformSnapshot } from "@/server/platform-health";
import { jsonRespond, newRequestId } from "@/server/platform/api-utils";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = newRequestId();
  const snapshot = await platformSnapshot();
  return jsonRespond(200, snapshot, requestId);
}
