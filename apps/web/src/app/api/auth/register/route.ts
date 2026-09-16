import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";
import {
  REGISTER_ATTEMPTS_ACCOUNT_QUOTA,
  REGISTER_ATTEMPTS_IP_QUOTA,
  requestSubject,
} from "@/server/platform/upstash/hosted";
import {
  RateLimitedError,
  attemptSubject,
  retryAfterSeconds,
} from "@/server/platform/upstash/guards";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register — create an account. Validation, self-selectable
 * grants (viewer/creator/analyst), and username uniqueness follow identity's
 * semantics; the answer is the client-safe account view. No cookie is set
 * (register then sign in, like identity's own transport).
 *
 * W913: registrations are rate-limited per source IP and per attempted
 * account handle (fixed-window counters). Refusal is an honest 429 with the
 * quota state + `Retry-After`.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = await readJsonBody(request);
    const subject = requestSubject(request);
    const handle = attemptSubject(
      typeof body === "object" && body !== null
        ? (body as { username?: unknown }).username
        : undefined,
    );
    const ipAttempt = await server.transientState.quotas.consume(
      REGISTER_ATTEMPTS_IP_QUOTA,
      `ip:${subject}`,
    );
    if (!ipAttempt.allowed) {
      throw new RateLimitedError(
        ipAttempt.state,
        retryAfterSeconds(server.nowMs(), REGISTER_ATTEMPTS_IP_QUOTA.windowSeconds ?? 3600),
      );
    }
    const accountAttempt = await server.transientState.quotas.consume(
      REGISTER_ATTEMPTS_ACCOUNT_QUOTA,
      `acct:${handle}`,
    );
    if (!accountAttempt.allowed) {
      throw new RateLimitedError(
        accountAttempt.state,
        retryAfterSeconds(server.nowMs(), REGISTER_ATTEMPTS_ACCOUNT_QUOTA.windowSeconds ?? 3600),
      );
    }
    const account = await server.auth.register(body);
    return jsonResponse(200, account);
  } catch (err) {
    return errorResponse(err);
  }
}
