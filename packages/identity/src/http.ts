/**
 * `createIdentityServer` — the HTTP auth surface (W902).
 *
 * A `Bun.serve` transport following `@sporta/control-api`'s http.ts
 * conventions: a route table, JSON bodies, typed-error → status mapping, and
 * request-id correlation (`x-request-id` echoed or a deterministic
 * `req-<n>` generated). The transport holds no domain logic — every decision
 * comes from the injected ports (account store, session service, policy).
 *
 * Routes (v1):
 *
 * - `POST /v1/auth/register` — create an account (validation + uniqueness)
 * - `POST /v1/auth/login` — verify credentials → issue an opaque session
 * - `POST /v1/auth/logout` — revoke the presented session (idempotent)
 * - `GET  /v1/auth/me` — account summary + role grants + active role
 * - `POST /v1/auth/switch-role` — switch the session's PRESENTATION role
 *
 * Authentication: `Authorization: Bearer <token>` (or the `sporta_session`
 * cookie set at login). Failures are GENERIC — no user or token enumeration:
 * login answers byte-identically for an unknown username and a wrong
 * password (an unknown username still burns one password verification
 * against a timing-equalizer hash, so even the wall-clock cost matches).
 *
 * Status mapping (errors.ts): validation → 400; auth-invalid/unauthenticated
 * → 401; permission-denied → 403; conflict → 409; internal → 500; the
 * transport's own classes unknown-route → 404 and method-not-allowed → 405.
 * Errors always answer `{ error: { failureClass, message, details? } }`.
 *
 * No CORS configuration (same-origin, like the W701 transport).
 */
import { z } from "zod";
import { RoleSchema } from "@sporta/capability";
import type { Role } from "@sporta/capability";
import type { Account, AccountStore, AccountSummary } from "./accounts";
import { InMemoryAccountStore, toAccountSummary } from "./accounts";
import type { EntropySource } from "./clock";
import { createIdentityDefaultClock, defaultEntropySource } from "./clock";
import {
  IdentityAuthInvalidError,
  IdentityPermissionDeniedError,
  IdentityUnauthenticatedError,
  IdentityValidationError,
  asIdentityError,
  isIdentityError,
} from "./errors";
import { argon2PasswordHasher } from "./passwords";
import type { PasswordHasher } from "./passwords";
import { authorize } from "./policy";
import { InMemorySessionStore, SessionService } from "./sessions";
import type { SessionStore } from "./sessions";

/** Transport-level failure classes (app-level classes live in ./errors). */
export type IdentityTransportFailureClass = "validation" | "unknown-route" | "method-not-allowed";

const IDENTITY_TRANSPORT_HTTP_STATUS: Readonly<Record<IdentityTransportFailureClass, number>> = {
  validation: 400,
  "unknown-route": 404,
  "method-not-allowed": 405,
};

/** Roles a NEW account may self-select at registration. */
const SELF_REGISTRABLE_ROLES: readonly Role[] = ["viewer", "creator", "analyst"];

/** The default grant a new account receives: the Viewer baseline. */
const DEFAULT_REGISTER_ROLES: readonly Role[] = ["viewer"];

/** Cookie name for browser sessions. */
export const SESSION_COOKIE = "sporta_session";

// ---------------------------------------------------------------------------
// Input validation (zod, like every other caller-input seam in the repo)
// ---------------------------------------------------------------------------

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
    roles: z.array(RoleSchema).optional(),
  })
  .strict();

const LoginInput = z
  .object({
    username: UsernameSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

const SwitchRoleInput = z
  .object({
    role: RoleSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

/** Options for {@link createIdentityServer}. */
export interface IdentityServerOptions {
  /** Account persistence (default: in-memory store). */
  accounts?: AccountStore;
  /** Session persistence (default: in-memory store). */
  sessionStore?: SessionStore;
  /** Password hasher (default: the REAL argon2id via `Bun.password`). */
  passwordHasher?: PasswordHasher;
  /** Clock in epoch ms (default: the deterministic identity epoch clock — production MUST inject real time). */
  nowMs?: () => number;
  /** Session-token entropy (default: REAL platform entropy). */
  entropy?: EntropySource;
  /** Session TTL in ms (default: 7 days). */
  sessionTtlMs?: number;
  /** Listen port; `0` (the default) asks the OS for an ephemeral port. */
  port?: number;
}

/** The client-safe account view (summary + the session's active role). */
export interface AccountView extends AccountSummary {
  /** The session's PRESENTATION role (grants live in `roles` — never here). */
  activeRole: Role | null;
}

/** Canonical route names. */
export type IdentityRoute = "register" | "login" | "logout" | "me" | "switch_role";

interface RouteSpec {
  readonly method: "GET" | "POST";
  readonly segments: readonly string[];
  readonly name: IdentityRoute;
}

const ROUTES: readonly RouteSpec[] = [
  { method: "POST", segments: ["v1", "auth", "register"], name: "register" },
  { method: "POST", segments: ["v1", "auth", "login"], name: "login" },
  { method: "POST", segments: ["v1", "auth", "logout"], name: "logout" },
  { method: "GET", segments: ["v1", "auth", "me"], name: "me" },
  { method: "POST", segments: ["v1", "auth", "switch-role"], name: "switch_role" },
];

type RouteMatch =
  | { kind: "handler"; spec: RouteSpec }
  | { kind: "method-mismatch"; allow: string }
  | { kind: "not-found" };

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function matchRoute(method: string, segments: string[]): RouteMatch {
  const shapes = ROUTES.filter(
    (spec) =>
      spec.segments.length === segments.length &&
      spec.segments.every((literal, index) => literal === segments[index]),
  );
  if (shapes.length === 0) return { kind: "not-found" };
  const handler = shapes.find((spec) => spec.method === method);
  if (handler !== undefined) return { kind: "handler", spec: handler };
  const allow = [...new Set(shapes.map((spec) => spec.method))].sort().join(", ");
  return { kind: "method-mismatch", allow };
}

type BodyResult = { ok: true; value: unknown } | { ok: false; message: string };

async function readJsonBody(request: Request): Promise<BodyResult> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, message: "request body could not be read" };
  }
  if (text.trim().length === 0) {
    return { ok: false, message: "request body is required" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      message: `request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** The session token from `Authorization: Bearer` or the session cookie. */
export function extractToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match !== null) return match[1]!.trim();
  }
  const cookie = request.headers.get("cookie");
  if (cookie !== null) {
    for (const part of cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE) return rest.join("=").trim();
    }
  }
  return "";
}

/**
 * Pure epoch-ms → ISO-8601 UTC conversion (NO wall-clock read — the
 * constitution bans `Date.now`/`performance.now` in library code, not
 * deterministic conversions of an injected instant).
 */
export function toIsoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Creates the identity HTTP server. The returned `Bun.Server` exposes the
 * actual bound port as `server.port`. Stop it with `server.stop(true)`.
 */
export function createIdentityServer(options: IdentityServerOptions = {}): Bun.Server<undefined> {
  const accounts: AccountStore = options.accounts ?? new InMemoryAccountStore();
  const nowMs = options.nowMs ?? createIdentityDefaultClock();
  const sessions = new SessionService({
    store: options.sessionStore ?? new InMemorySessionStore(),
    nowMs,
    entropy: options.entropy ?? defaultEntropySource,
    ...(options.sessionTtlMs !== undefined ? { ttlMs: options.sessionTtlMs } : {}),
  });
  const passwordHasher = options.passwordHasher ?? argon2PasswordHasher;
  let requestSeq = 0;
  // Lazily-created hash an unknown-username login verifies against, so both
  // login-failure branches burn one KDF call (timing-equalized enumeration).
  let timingEqualizerHash: string | null = null;

  function respond(
    status: number,
    payload: unknown,
    requestId: string,
    extraHeaders: Record<string, string> = {},
  ): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json", "x-request-id": requestId, ...extraHeaders },
    });
  }

  function transportFailure(
    failureClass: IdentityTransportFailureClass,
    message: string,
    requestId: string,
    extraHeaders: Record<string, string> = {},
  ): Response {
    const status = IDENTITY_TRANSPORT_HTTP_STATUS[failureClass];
    return respond(status, { error: { failureClass, message } }, requestId, extraHeaders);
  }

  function errorResponse(err: unknown, requestId: string): Response {
    if (isIdentityError(err)) {
      const body: { failureClass: string; message: string; details?: Record<string, unknown> } = {
        failureClass: err.failureClass,
        message: err.message,
      };
      if (Object.keys(err.details).length > 0) body.details = err.details;
      return respond(err.httpStatus, { error: body }, requestId);
    }
    const normalized = asIdentityError(err);
    return respond(
      normalized.httpStatus,
      { error: { failureClass: normalized.failureClass, message: normalized.message } },
      requestId,
    );
  }

  /** Resolves the presented token to (account, session) — generic 401. */
  async function requireSession(
    request: Request,
  ): Promise<{ account: Account; token: string; activeRole: Role | null }> {
    const token = extractToken(request);
    const record = await sessions.resolve(token);
    if (record === null) throw new IdentityUnauthenticatedError();
    const account = await accounts.findByUserId(record.userId);
    if (account === null) throw new IdentityUnauthenticatedError();
    return { account, token, activeRole: record.activeRole };
  }

  function accountView(account: Account, activeRole: Role | null): AccountView {
    return { ...toAccountSummary(account), activeRole };
  }

  async function register(body: unknown, requestId: string): Promise<Response> {
    const parsed = RegisterInput.safeParse(body);
    if (!parsed.success) {
      throw new IdentityValidationError("register input failed validation", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const roles = [...new Set(parsed.data.roles ?? DEFAULT_REGISTER_ROLES)].sort();
    const forbidden = roles.filter((role) => !SELF_REGISTRABLE_ROLES.includes(role));
    if (forbidden.length > 0) {
      throw new IdentityValidationError(
        "registration may only self-select the viewer, creator, and analyst grants (rights-holder and operator are operator-assigned)",
        { roles: forbidden },
      );
    }
    const account = await accounts.create({
      username: parsed.data.username,
      email: undefined,
      passwordHash: await passwordHasher.hash(parsed.data.password),
      roles,
      createdAtIso: toIsoUtc(nowMs()),
    });
    return respond(200, accountView(account, null), requestId);
  }

  async function login(body: unknown, requestId: string): Promise<Response> {
    const parsed = LoginInput.safeParse(body);
    if (!parsed.success) {
      throw new IdentityValidationError("login input failed validation", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const { username, password } = parsed.data;
    const account = await accounts.findByUsername(username);
    if (account === null) {
      // Timing-equalized enumeration defense: burn one verification against
      // a fixed dummy hash, then answer IDENTICALLY to a wrong password.
      timingEqualizerHash ??= await passwordHasher.hash("sporta-timing-equalizer-v1");
      await passwordHasher.verify(password, timingEqualizerHash);
      throw new IdentityAuthInvalidError();
    }
    const verified = await passwordHasher.verify(password, account.passwordHash);
    if (!verified) throw new IdentityAuthInvalidError();
    const issued = await sessions.issue({ userId: account.userId, activeRole: null });
    return respond(
      200,
      {
        token: issued.token,
        tokenKind: "bearer",
        expiresAtIso: toIsoUtc(issued.record.expiresAtMs),
        account: accountView(account, null),
      },
      requestId,
      { "set-cookie": `${SESSION_COOKIE}=${issued.token}; Path=/; HttpOnly; SameSite=Lax` },
    );
  }

  async function logout(request: Request, requestId: string): Promise<Response> {
    const token = extractToken(request);
    if (token.length === 0) throw new IdentityUnauthenticatedError();
    await sessions.revoke(token);
    return respond(200, { revoked: true }, requestId, {
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
  }

  async function me(request: Request, requestId: string): Promise<Response> {
    const { account, activeRole } = await requireSession(request);
    return respond(200, accountView(account, activeRole), requestId);
  }

  async function switchRole(
    request: Request,
    body: unknown,
    requestId: string,
  ): Promise<Response> {
    const { account, token } = await requireSession(request);
    const parsed = SwitchRoleInput.safeParse(body);
    if (!parsed.success) {
      throw new IdentityValidationError("switch-role input failed validation", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const role = parsed.data.role;
    const decision = authorize(account, "account.switch-role", { targetRole: role });
    if (!decision.allowed) {
      throw new IdentityPermissionDeniedError(
        "the account does not hold the requested role (role switching never grants authority)",
        { action: "account.switch-role" },
      );
    }
    const record = await sessions.switchRole(token, role, account.roles);
    return respond(200, accountView(account, record.activeRole), requestId);
  }

  async function handle(request: Request): Promise<Response> {
    const headerId = request.headers.get("x-request-id");
    const requestId =
      headerId !== null && headerId.trim().length > 0
        ? headerId.trim()
        : `req-${(requestSeq += 1)}`;

    const url = new URL(request.url);
    const match = matchRoute(request.method, splitPath(url.pathname));

    if (match.kind === "not-found") {
      return transportFailure(
        "unknown-route",
        `no route for ${request.method} ${url.pathname}`,
        requestId,
      );
    }
    if (match.kind === "method-mismatch") {
      return transportFailure(
        "method-not-allowed",
        `method ${request.method} is not allowed for ${url.pathname}`,
        requestId,
        { allow: match.allow },
      );
    }

    try {
      switch (match.spec.name) {
        case "register": {
          const body = await readJsonBody(request);
          if (!body.ok) return transportFailure("validation", body.message, requestId);
          return await register(body.value, requestId);
        }
        case "login": {
          const body = await readJsonBody(request);
          if (!body.ok) return transportFailure("validation", body.message, requestId);
          return await login(body.value, requestId);
        }
        case "logout":
          return await logout(request, requestId);
        case "me":
          return await me(request, requestId);
        case "switch_role": {
          const body = await readJsonBody(request);
          if (!body.ok) return transportFailure("validation", body.message, requestId);
          return await switchRole(request, body.value, requestId);
        }
      }
    } catch (err) {
      return errorResponse(err, requestId);
    }
    // Exhaustive switch above; unreachable.
    return transportFailure("unknown-route", "unreachable", requestId);
  }

  return Bun.serve({
    port: options.port ?? 0,
    fetch: (request: Request): Promise<Response> => handle(request),
  });
}
