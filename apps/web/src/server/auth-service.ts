/**
 * The app's auth service (W904) — the real identity flows, in process.
 *
 * `@sporta/identity`'s HTTP transport (`createIdentityServer`) is a `Bun.serve`
 * server, which is wrong for Next.js route handlers. This module therefore
 * drives the SAME real services directly — `InMemoryAccountStore`,
 * `SessionService`, the pure `authorize` policy, `argon2PasswordHasher` — with
 * the SAME semantics identity's transport implements (the register/login/
 * logout/me/switch-role behaviors, the timing-equalized login failure, the
 * grants-not-authority role switch). Every rule mirrored here is pinned
 * against identity's own tests' expectations in apps/web/test/auth.test.ts.
 *
 * Roles are GRANTS, not authority: switching the active role changes the
 * workspace presentation only; every protected action stays authorized
 * server-side against the grants (never the active role).
 */
import { z } from "zod";
import { RoleSchema } from "@sporta/capability";
import type { Role } from "@sporta/capability";
import {
  AccountConflictError,
  InMemoryAccountStore,
  SessionService,
  argon2PasswordHasher,
  authorize,
  toBase64Url,
} from "@sporta/identity";
import type { Account, AccountStore, PasswordHasher } from "@sporta/identity";
import { SESSION_TOKEN_BYTES } from "@sporta/identity";
import type { EntropySource } from "@sporta/identity";
import { defaultEntropySource } from "@sporta/identity";
import { InMemorySessionStore } from "@sporta/identity";
import type { AccountSummary } from "@sporta/identity";

/** The browser session cookie (identity's name — one constant across surfaces). */
export const SPORTA_SESSION_COOKIE = "sporta_session";

/** The client-safe account view (summary + the session's active role). */
export interface AccountView extends AccountSummary {
  /** The session's PRESENTATION role (grants live in `roles` — never here). */
  activeRole: Role | null;
}

/** The login result: the one-time-visible token + its account view. */
export interface LoginResult {
  token: string;
  tokenKind: "bearer";
  expiresAtIso: string;
  account: AccountView;
}

// ---------------------------------------------------------------------------
// Input validation (identity http.ts's schemas, mirrored exactly)
// ---------------------------------------------------------------------------

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,31}$/,
    "username must be 3-32 characters of [a-z0-9._-] and start with a letter or digit",
  );

export const PasswordSchema = z
  .string()
  .min(10, "password must be at least 10 characters")
  .max(200);

const RegisterInput = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
    roles: z.array(RoleSchema).optional(),
  })
  .strict();

const LoginInput = z.object({ username: UsernameSchema, password: z.string().min(1).max(200) });
const SwitchRoleInput = z.object({ role: RoleSchema }).strict();

/** Roles a NEW account may self-select at registration (identity's rule). */
const SELF_REGISTRABLE_ROLES: readonly Role[] = ["viewer", "creator", "analyst"];
/** The default grant a new account receives: the Viewer baseline. */
const DEFAULT_REGISTER_ROLES: readonly Role[] = ["viewer"];

// ---------------------------------------------------------------------------
// The typed auth failure (message + HTTP status, JSON-safe details)
// ---------------------------------------------------------------------------

/** One classified auth refusal (statuses mirror identity's errors.ts). */
export class AuthFlowError extends Error {
  readonly status: number;
  readonly failureClass: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    failureClass: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AuthFlowError";
    this.status = status;
    this.failureClass = failureClass;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** Everything the auth flows need (all injectable; defaults are the REAL ones). */
export interface AuthServiceOptions {
  accounts?: AccountStore;
  /**
   * A pre-built session service (W911: the hosted Neon-backed one). Default:
   * a fresh in-memory session store inside a fresh `SessionService`.
   */
  sessions?: SessionService;
  passwordHasher?: PasswordHasher;
  entropy?: EntropySource;
  nowMs: () => number;
  sessionTtlMs?: number;
}

/** The resolved session an authenticated request carries. */
export interface ResolvedAuthSession {
  account: Account;
  activeRole: Role | null;
}

/** The real auth flows, in process (register / login / logout / me / switch-role). */
export class AuthService {
  readonly accounts: AccountStore;
  readonly sessions: SessionService;
  private readonly passwordHasher: PasswordHasher;
  private readonly nowMs: () => number;
  /** Lazily-created hash an unknown-username login verifies against (timing equalizer). */
  private timingEqualizerHash: string | null = null;

  constructor(options: AuthServiceOptions) {
    this.accounts = options.accounts ?? new InMemoryAccountStore();
    this.sessions =
      options.sessions ??
      new SessionService({
        store: new InMemorySessionStore(),
        nowMs: options.nowMs,
        entropy: options.entropy ?? defaultEntropySource,
        ...(options.sessionTtlMs !== undefined ? { ttlMs: options.sessionTtlMs } : {}),
      });
    this.passwordHasher = options.passwordHasher ?? argon2PasswordHasher;
    this.nowMs = options.nowMs;
  }

  /** Creates an account directly (the dev seed's path — hashed, granted). */
  async createSeedAccount(input: {
    username: string;
    password: string;
    roles: readonly Role[];
  }): Promise<Account> {
    return this.accounts.create({
      username: UsernameSchema.parse(input.username),
      email: undefined,
      passwordHash: await this.passwordHasher.hash(input.password),
      roles: [...input.roles],
      createdAtIso: new Date(this.nowMs()).toISOString(),
    });
  }

  /** Issues a session for an existing account (the dev seed's path). */
  async issueSession(input: { userId: string; activeRole?: Role | null }): Promise<LoginResult> {
    const account = await this.accounts.findByUserId(input.userId);
    if (account === null) throw new AuthFlowError(401, "unauthenticated", "no such account");
    const issued = await this.sessions.issue({
      userId: account.userId,
      activeRole: input.activeRole ?? null,
    });
    return {
      token: issued.token,
      tokenKind: "bearer",
      expiresAtIso: new Date(issued.record.expiresAtMs).toISOString(),
      account: this.view(account, issued.record.activeRole),
    };
  }

  /** POST /api/auth/register — create an account (validation + uniqueness). */
  async register(body: unknown): Promise<AccountView> {
    const parsed = RegisterInput.safeParse(body);
    if (!parsed.success) {
      throw new AuthFlowError(400, "validation", "register input failed validation", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const roles = [...new Set(parsed.data.roles ?? DEFAULT_REGISTER_ROLES)].sort();
    const forbidden = roles.filter((role) => !SELF_REGISTRABLE_ROLES.includes(role));
    if (forbidden.length > 0) {
      throw new AuthFlowError(
        400,
        "validation",
        "registration may only self-select the viewer, creator, and analyst grants (rights-holder and operator are operator-assigned)",
        { roles: forbidden },
      );
    }
    try {
      const account = await this.accounts.create({
        username: parsed.data.username,
        email: undefined,
        passwordHash: await this.passwordHasher.hash(parsed.data.password),
        roles,
        createdAtIso: new Date(this.nowMs()).toISOString(),
      });
      return this.view(account, null);
    } catch (err) {
      if (err instanceof AccountConflictError) {
        throw new AuthFlowError(409, "conflict", err.message, { username: err.username });
      }
      throw err;
    }
  }

  /** POST /api/auth/login — verify credentials → issue an opaque session. */
  async login(body: unknown): Promise<LoginResult> {
    const parsed = LoginInput.safeParse(body);
    if (!parsed.success) {
      throw new AuthFlowError(400, "validation", "login input failed validation", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const { username, password } = parsed.data;
    const account = await this.accounts.findByUsername(username);
    if (account === null) {
      // Timing-equalized enumeration defense: burn one verification against a
      // fixed dummy hash, then answer IDENTICALLY to a wrong password.
      this.timingEqualizerHash ??= await this.passwordHasher.hash("sporta-timing-equalizer-v1");
      await this.passwordHasher.verify(password, this.timingEqualizerHash);
      throw new AuthFlowError(401, "auth-invalid", "invalid username or password");
    }
    const verified = await this.passwordHasher.verify(password, account.passwordHash);
    if (!verified) {
      throw new AuthFlowError(401, "auth-invalid", "invalid username or password");
    }
    const issued = await this.sessions.issue({ userId: account.userId, activeRole: null });
    return {
      token: issued.token,
      tokenKind: "bearer",
      expiresAtIso: new Date(issued.record.expiresAtMs).toISOString(),
      account: this.view(account, null),
    };
  }

  /** POST /api/auth/logout — revoke the presented session (idempotent). */
  async logout(token: string): Promise<{ revoked: true }> {
    await this.sessions.revoke(token);
    return { revoked: true };
  }

  /** Resolves a presented token to a live account, or null. */
  async resolve(token: string): Promise<ResolvedAuthSession | null> {
    if (token.length === 0) return null;
    const record = await this.sessions.resolve(token);
    if (record === null) return null;
    const account = await this.accounts.findByUserId(record.userId);
    if (account === null) return null;
    return { account, activeRole: record.activeRole };
  }

  /** POST /api/auth/switch-role — switch the session's PRESENTATION role. */
  async switchRole(token: string, body: unknown): Promise<AccountView> {
    const resolved = await this.resolve(token);
    if (resolved === null) {
      throw new AuthFlowError(401, "unauthenticated", "a valid session is required");
    }
    const parsed = SwitchRoleInput.safeParse(body);
    if (!parsed.success) {
      throw new AuthFlowError(400, "validation", "switch-role input failed validation", {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    const role = parsed.data.role;
    const decision = authorize(resolved.account, "account.switch-role", { targetRole: role });
    if (!decision.allowed) {
      throw new AuthFlowError(
        403,
        "permission-denied",
        "the account does not hold the requested role (role switching never grants authority)",
        { action: "account.switch-role" },
      );
    }
    const record = await this.sessions.switchRole(token, role, resolved.account.roles);
    return this.view(resolved.account, record.activeRole);
  }

  /** The client-safe projection (never the password hash). */
  view(account: Account, activeRole: Role | null): AccountView {
    return {
      userId: account.userId,
      username: account.username,
      email: account.email,
      roles: [...account.roles],
      createdAtIso: account.createdAtIso,
      activeRole,
    };
  }
}

// ---------------------------------------------------------------------------
// Cookie serialization (the transport bits the route handlers own)
// ---------------------------------------------------------------------------

/**
 * The `Set-Cookie` value for a freshly issued session: HttpOnly (never
 * readable by page script), SameSite=Lax, Path=/, and Secure in production.
 */
export function sessionCookie(token: string, secure: boolean): string {
  return `${SPORTA_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The `Set-Cookie` value that clears the session cookie at logout. */
export function clearedSessionCookie(secure: boolean): string {
  return `${SPORTA_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** Extracts the session token from a Request (Bearer header or cookie). */
export function tokenFromRequest(request: Request): string {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match !== null) return match[1]!.trim();
  }
  const cookie = request.headers.get("cookie");
  if (cookie !== null) {
    for (const part of cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SPORTA_SESSION_COOKIE) return rest.join("=").trim();
    }
  }
  return "";
}

/** A high-entropy dev password from the injected entropy source (never logged). */
export function drawSeedPassword(entropy: EntropySource): string {
  return `dev-seed-${toBase64Url(entropy.randomBytes(SESSION_TOKEN_BYTES))}`;
}
