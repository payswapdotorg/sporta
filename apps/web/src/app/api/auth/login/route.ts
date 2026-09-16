import { getSportaServer } from "@/server/runtime";
import { sessionCookie } from "@/server/auth-service";
import { errorResponse, readJsonBody } from "@/server/http-errors";
import {
  LOGIN_ATTEMPTS_ACCOUNT_QUOTA,
  LOGIN_ATTEMPTS_IP_QUOTA,
  requestSubject,
} from "@/server/platform/upstash/hosted";
import {
  RateLimitedError,
  attemptSubject,
  retryAfterSeconds,
} from "@/server/platform/upstash/guards";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — verify credentials and issue an opaque session.
 * Failures are generic and timing-equalized (identity's no-enumeration rule).
 * Success sets the HttpOnly SameSite=Lax session cookie and returns the
 * one-time-visible token + account view.
 *
 * W913: attempts are rate-limited per source IP and per attempted account
 * handle (fixed-window counters in the transient-state port). The limit is
 * consumed BEFORE the credential check (it counts attempts, not successes)
 * and refusal is an honest 429 with the quota state + `Retry-After`.
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
      LOGIN_ATTEMPTS_IP_QUOTA,
      `ip:${subject}`,
    );
    if (!ipAttempt.allowed) {
      throw new RateLimitedError(
        ipAttempt.state,
        retryAfterSeconds(server.nowMs(), LOGIN_ATTEMPTS_IP_QUOTA.windowSeconds ?? 3600),
      );
    }
    const accountAttempt = await server.transientState.quotas.consume(
      LOGIN_ATTEMPTS_ACCOUNT_QUOTA,
      `acct:${handle}`,
    );
    if (!accountAttempt.allowed) {
      throw new RateLimitedError(
        accountAttempt.state,
        retryAfterSeconds(server.nowMs(), LOGIN_ATTEMPTS_ACCOUNT_QUOTA.windowSeconds ?? 3600),
      );
    }
    const result = await server.auth.login(body);
    const secure = process.env.NODE_ENV === "production";
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "set-cookie": sessionCookie(result.token, secure),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
