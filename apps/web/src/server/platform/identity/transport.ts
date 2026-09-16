/**
 * The shared identity transport for `/api/platform/identity/*` (W911).
 *
 * Thin transport over `getHostedIdentity()` — mirrors `@sporta/identity`'s
 * own Bun.serve `http.ts` semantics rule-for-rule (validation, self-selected
 * grants, timing-equalized login, session cookie + bearer, typed errors) so
 * the hosted routes and the package transport behave identically. The W913
 * quota guards add the degraded-state emission (429 + the W901 QuotaState).
 */
import { z } from "zod";
import { AccountConflictError, SESSION_COOKIE } from "@sporta/identity";
import type { Account } from "@sporta/identity";
import type { Role } from "@sporta/capability";
import { ROLES } from "@sporta/capability";
import {
  apiError,
  bearerToken,
  cookieToken,
  jsonRespond,
  newRequestId,
  readJsonBody,
  toIsoUtc,
} from "../api-utils";
import { getHostedIdentity, identityReady } from "./hosted";
import {
  LOGIN_ATTEMPTS_ACCOUNT_QUOTA,
  LOGIN_ATTEMPTS_IP_QUOTA,
  REGISTER_ATTEMPTS_ACCOUNT_QUOTA,
  REGISTER_ATTEMPTS_IP_QUOTA,
  getHostedQuotaGuard,
  requestSubject,
} from "../upstash/hosted";
import { attemptSubject, retryAfterSeconds } from "../upstash/guards";
import { sessionCookieDomain } from "../env";

/** Self-selectable registration grants (identity http.ts rule). */
const SELF_REGISTRABLE_ROLES: readonly Role[] = ["viewer", "creator", "analyst"];
const DEFAULT_REGISTER_ROLES: readonly Role[] = ["viewer"];

// The exact W902 validation rules (identity http.ts) — mirrored, not invented.
const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,31}$/,
    "username must be 3-32 characters of [a-z0-9._-] and start with a letter or digit",
  );

const PasswordSchema = z.string().min(10, "password must be at least 10 characters").max(200);

const RegisterInput = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
    roles: z.array(z.enum(ROLES)).optional(),
  })
  .strict();

const LoginInput = z
  .object({
    username: UsernameSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

function accountView(account: Account, activeRole: Role | null) {
  return {
    userId: account.userId,
    username: account.username,
    email: account.email,
    roles: [...account.roles],
    createdAtIso: account.createdAtIso,
    activeRole,
  };
}

function sessionCookie(token: string): string {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env["NODE_ENV"] === "production") parts.push("Secure");
  const domain = sessionCookieDomain();
  if (domain !== undefined) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

/** POST register — creates a persisted account. */
export async function registerHandler(request: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    await identityReady();
    const identity = getHostedIdentity();
    const parsed = RegisterInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return apiError("validation-error", "register input failed validation", requestId, {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const ip = requestSubject(request);
    const handle = attemptSubject(parsed.data.username);
    const ipAdmission = await getHostedQuotaGuard().consume(
      REGISTER_ATTEMPTS_IP_QUOTA,
      `ip:${ip}`,
    );
    if (!ipAdmission.allowed) {
      return apiError(
        "resource-limit",
        "registration quota exhausted for this subject — retry later",
        requestId,
        { quota: ipAdmission.state, retryAfterSeconds: retryAfterSeconds(Date.now(), 3600) },
        429,
      );
    }
    const accountAdmission = await getHostedQuotaGuard().consume(
      REGISTER_ATTEMPTS_ACCOUNT_QUOTA,
      `acct:${handle}`,
    );
    if (!accountAdmission.allowed) {
      return apiError(
        "resource-limit",
        "registration quota exhausted for this subject — retry later",
        requestId,
        { quota: accountAdmission.state, retryAfterSeconds: retryAfterSeconds(Date.now(), 3600) },
        429,
      );
    }
    const roles = [...new Set(parsed.data.roles ?? DEFAULT_REGISTER_ROLES)].sort();
    const forbidden = roles.filter((role) => !SELF_REGISTRABLE_ROLES.includes(role));
    if (forbidden.length > 0) {
      return apiError(
        "validation-error",
        "registration may only self-select the viewer, creator, and analyst grants (rights-holder and operator are operator-assigned)",
        requestId,
        { roles: forbidden },
      );
    }
    const account = await identity.accounts.create({
      username: parsed.data.username,
      email: undefined,
      passwordHash: await identity.hasher.hash(parsed.data.password),
      roles,
      createdAtIso: toIsoUtc(Date.now()),
    });
    return jsonRespond(200, accountView(account, null), requestId);
  } catch (err) {
    if (err instanceof AccountConflictError) {
      return apiError("conflict", err.message, requestId, { username: err.username });
    }
    return apiError("internal", "register failed", requestId);
  }
}

/** POST login — verifies credentials and issues a session. */
export async function loginHandler(request: Request): Promise<Response> {
  const requestId = newRequestId();
  // Timing-equalized enumeration defense (identity http.ts): a fixed dummy
  // hash burns one KDF on the unknown-username branch.
  let timingEqualizerHash: string | null = null;
  try {
    await identityReady();
    const identity = getHostedIdentity();
    const parsed = LoginInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return apiError("validation-error", "login input failed validation", requestId, {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const ip = requestSubject(request);
    const handle = attemptSubject(parsed.data.username);
    const ipAdmission = await getHostedQuotaGuard().consume(
      LOGIN_ATTEMPTS_IP_QUOTA,
      `ip:${ip}`,
    );
    if (!ipAdmission.allowed) {
      return apiError(
        "resource-limit",
        "login quota exhausted for this subject — retry later",
        requestId,
        { quota: ipAdmission.state, retryAfterSeconds: retryAfterSeconds(Date.now(), 3600) },
        429,
      );
    }
    const accountAdmission = await getHostedQuotaGuard().consume(
      LOGIN_ATTEMPTS_ACCOUNT_QUOTA,
      `acct:${handle}`,
    );
    if (!accountAdmission.allowed) {
      return apiError(
        "resource-limit",
        "login quota exhausted for this subject — retry later",
        requestId,
        { quota: accountAdmission.state, retryAfterSeconds: retryAfterSeconds(Date.now(), 3600) },
        429,
      );
    }
    const { username, password } = parsed.data;
    const account = await identity.accounts.findByUsername(username);
    if (account === null) {
      timingEqualizerHash ??= await identity.hasher.hash("sporta-timing-equalizer-v1");
      await identity.hasher.verify(password, timingEqualizerHash);
      return apiError("auth-invalid", "invalid username or password", requestId);
    }
    const verified = await identity.hasher.verify(password, account.passwordHash);
    if (!verified) {
      return apiError("auth-invalid", "invalid username or password", requestId);
    }
    const issued = await identity.sessions.issue({ userId: account.userId, activeRole: null });
    return jsonRespond(
      200,
      {
        token: issued.token,
        tokenKind: "bearer",
        expiresAtIso: toIsoUtc(issued.record.expiresAtMs),
        account: accountView(account, null),
      },
      requestId,
      { "set-cookie": sessionCookie(issued.token) },
    );
  } catch {
    return apiError("internal", "login failed", requestId);
  }
}

/** Resolves the caller's session — shared by logout/me. */
async function requireSession(
  request: Request,
): Promise<{ account: Account; token: string } | null> {
  const token = bearerToken(request) ?? cookieToken(request);
  if (token === null) return null;
  const identity = getHostedIdentity();
  const record = await identity.sessions.resolve(token);
  if (record === null) return null;
  const account = await identity.accounts.findByUserId(record.userId);
  if (account === null) return null;
  return { account, token };
}

/** POST logout — revokes the presented session. */
export async function logoutHandler(request: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    await identityReady();
    const session = await requireSession(request);
    if (session === null) {
      return apiError("unauthenticated", "no valid session presented", requestId);
    }
    await getHostedIdentity().sessions.revoke(session.token);
    return jsonRespond(200, { ok: true }, requestId, {
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
  } catch {
    return apiError("internal", "logout failed", requestId);
  }
}

/** GET me — the caller's account view (generic 401 when unauthenticated). */
export async function meHandler(request: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    await identityReady();
    const token = bearerToken(request) ?? cookieToken(request);
    if (token === null) {
      return apiError("unauthenticated", "no session presented", requestId);
    }
    const identity = getHostedIdentity();
    const record = await identity.sessions.resolve(token);
    if (record === null) {
      return apiError("unauthenticated", "invalid session", requestId);
    }
    const account = await identity.accounts.findByUserId(record.userId);
    if (account === null) {
      return apiError("unauthenticated", "invalid session", requestId);
    }
    return jsonRespond(200, accountView(account, record.activeRole), requestId);
  } catch {
    return apiError("internal", "session lookup failed", requestId);
  }
}
