/**
 * REAL HTTP round-trips for the identity auth surface (W902): every test
 * drives a real `Bun.serve` on an ephemeral port with real `fetch` — the
 * "fresh browser" path. The password hasher is the deterministic test hasher
 * for these high-volume suites (the REAL argon2 path is pinned in
 * accounts.test.ts); the clock and entropy are injected where the scenario
 * needs them.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  InMemoryAccountStore,
  InMemorySessionStore,
  authorize,
  createDeterministicTestHasher,
  createIdentityServer,
  createSequentialEntropySource,
} from "../src/index";
import type { AccountView } from "../src/index";

// ---------------------------------------------------------------------------
// The harness: a real server with injected seams
// ---------------------------------------------------------------------------

interface IdentityHarness {
  server: ReturnType<typeof createIdentityServer>;
  baseUrl: string;
  accounts: InMemoryAccountStore;
  sessionStore: InMemorySessionStore;
  clock: { nowMs: () => number; advance: (ms: number) => void };
}

function createHarness(options: { ttlMs?: number } = {}): IdentityHarness {
  const accounts = new InMemoryAccountStore();
  const sessionStore = new InMemorySessionStore();
  let t = 1_000_000;
  const clock = { nowMs: () => t, advance: (ms: number) => (t += ms) };
  const server = createIdentityServer({
    accounts,
    sessionStore,
    passwordHasher: createDeterministicTestHasher(),
    nowMs: clock.nowMs,
    ...(options.ttlMs !== undefined ? { sessionTtlMs: options.ttlMs } : {}),
  });
  return { server, baseUrl: `http://127.0.0.1:${server.port}`, accounts, sessionStore, clock };
}

interface ApiResponse<T> {
  status: number;
  body: T;
  requestId: string | null;
  headers: Headers;
  text: string;
}

async function callJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return {
    status: response.status,
    body,
    requestId: response.headers.get("x-request-id"),
    headers: response.headers,
    text,
  };
}

function post<T>(baseUrl: string, path: string, body: unknown, init: RequestInit = {}) {
  return callJson<T>(baseUrl, path, {
    ...init,
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const PASSWORD = "correct-horse-battery";

let h: IdentityHarness;
beforeAll(() => {
  h = createHarness();
});
afterAll(() => {
  h.server.stop(true);
});

// ---------------------------------------------------------------------------
// register → login → me → logout (the happy path)
// ---------------------------------------------------------------------------

describe("register / login / logout / me — happy path", () => {
  test("register creates the account with the default viewer grant", async () => {
    const response = await post<AccountView>(h.baseUrl, "/v1/auth/register", {
      username: "Ada.Lovelace",
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.body.userId).toMatch(/^u-\d+$/);
    expect(response.body.username).toBe("ada.lovelace"); // normalized (lowercase)
    expect(response.body.roles).toEqual(["viewer"]);
    expect(response.body.activeRole).toBeNull();
    expect(response.body.createdAtIso).toBe("1970-01-01T00:16:40.000Z"); // the injected clock's first tick
  });

  test("register with explicit self-registrable roles stores exactly those grants", async () => {
    const response = await post<AccountView>(h.baseUrl, "/v1/auth/register", {
      username: "grace",
      password: PASSWORD,
      roles: ["analyst", "creator"],
    });
    expect(response.status).toBe(200);
    expect(response.body.roles).toEqual(["analyst", "creator"]); // sorted, deduped
  });

  test("login issues an opaque bearer token for a valid account", async () => {
    const response = await post<{
      token: string;
      tokenKind: string;
      expiresAtIso: string;
      account: AccountView;
    }>(
      h.baseUrl,
      "/v1/auth/login",
      { username: "GRACE", password: PASSWORD }, // normalization applies to lookup too
    );
    expect(response.status).toBe(200);
    expect(response.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body.tokenKind).toBe("bearer");
    expect(response.body.account.username).toBe("grace");
    expect(response.headers.get("set-cookie")).toContain("sporta_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  test("me returns the account summary + grants + active role via the bearer token", async () => {
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "grace",
      password: PASSWORD,
    });
    const response = await callJson<AccountView>(h.baseUrl, "/v1/auth/me", {
      headers: bearer(login.body.token),
    });
    expect(response.status).toBe(200);
    expect(response.body.username).toBe("grace");
    expect(response.body.roles).toEqual(["analyst", "creator"]);
    expect(response.body.activeRole).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  test("the session cookie authenticates me like the bearer token (browser path)", async () => {
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "grace",
      password: PASSWORD,
    });
    const response = await callJson<AccountView>(h.baseUrl, "/v1/auth/me", {
      headers: { cookie: `sporta_session=${login.body.token}` },
    });
    expect(response.status).toBe(200);
    expect(response.body.username).toBe("grace");
  });

  test("logout revokes the session; me afterwards is 401; the cookie is cleared", async () => {
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "grace",
      password: PASSWORD,
    });
    const logout = await post<{ revoked: boolean }>(
      h.baseUrl,
      "/v1/auth/logout",
      {},
      { headers: bearer(login.body.token) },
    );
    expect(logout.status).toBe(200);
    expect(logout.body.revoked).toBe(true);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    const after = await callJson<{ error: { failureClass: string } }>(h.baseUrl, "/v1/auth/me", {
      headers: bearer(login.body.token),
    });
    expect(after.status).toBe(401);
    expect(after.body.error.failureClass).toBe("unauthenticated");
  });

  test("TOKEN STORED HASHED: the session store contains no plaintext token or password", async () => {
    const login = await post<{ token: string; account: { userId: string } }>(
      h.baseUrl,
      "/v1/auth/login",
      {
        username: "grace",
        password: PASSWORD,
      },
    );
    const records = await h.sessionStore.all();
    expect(records.length).toBeGreaterThanOrEqual(1);
    const dump = JSON.stringify(records);
    expect(dump).not.toContain(login.body.token);
    expect(dump).not.toContain(PASSWORD);
    const match = records.find((record) => record.userId === login.body.account.userId);
    expect(match?.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });
});

// ---------------------------------------------------------------------------
// Generic auth failures (no user enumeration)
// ---------------------------------------------------------------------------

describe("generic auth failures (no user enumeration)", () => {
  test("wrong password and unknown username answer BYTE-IDENTICALLY", async () => {
    await post(h.baseUrl, "/v1/auth/register", { username: "enumerated", password: PASSWORD });
    const wrongPassword = await post(h.baseUrl, "/v1/auth/login", {
      username: "enumerated",
      password: "wrong-password-x",
    });
    const unknownUser = await post(h.baseUrl, "/v1/auth/login", {
      username: "never-registered",
      password: "wrong-password-x",
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual({
      error: { failureClass: "auth-invalid", message: "invalid credentials" },
    });
    expect(unknownUser.text).toBe(wrongPassword.text); // byte-identical
  });

  test("revoked, expired, and unknown tokens are INDISTINGUISHABLE at me", async () => {
    await post(h.baseUrl, "/v1/auth/register", { username: "tokens", password: PASSWORD });
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "tokens",
      password: PASSWORD,
    });
    await post(h.baseUrl, "/v1/auth/logout", {}, { headers: bearer(login.body.token) });
    const revoked = await callJson(h.baseUrl, "/v1/auth/me", { headers: bearer(login.body.token) });
    const unknown = await callJson(h.baseUrl, "/v1/auth/me", { headers: bearer("x".repeat(43)) });
    expect(revoked.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.text).toBe(revoked.text);
    expect(revoked.body).toEqual({
      error: { failureClass: "unauthenticated", message: "authentication required" },
    });
  });

  test("me without any token is the same generic 401", async () => {
    const response = await callJson(h.baseUrl, "/v1/auth/me");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { failureClass: "unauthenticated", message: "authentication required" },
    });
  });
});

// ---------------------------------------------------------------------------
// Session expiry (injected clock)
// ---------------------------------------------------------------------------

describe("expired session (injected clock advance)", () => {
  test("me works at ttl-ε and 401s after the injected clock passes the expiry", async () => {
    const short = createHarness({ ttlMs: 60_000 });
    try {
      await post(short.baseUrl, "/v1/auth/register", { username: "temporal", password: PASSWORD });
      const login = await post<{ token: string; expiresAtIso: string }>(
        short.baseUrl,
        "/v1/auth/login",
        {
          username: "temporal",
          password: PASSWORD,
        },
      );
      expect(
        await callJson(short.baseUrl, "/v1/auth/me", { headers: bearer(login.body.token) }),
      ).toMatchObject({ status: 200 });
      short.clock.advance(59_999);
      const still = await callJson(short.baseUrl, "/v1/auth/me", {
        headers: bearer(login.body.token),
      });
      expect(still.status).toBe(200); // live at ttl-ε
      short.clock.advance(1);
      const expired = await callJson(short.baseUrl, "/v1/auth/me", {
        headers: bearer(login.body.token),
      });
      expect(expired.status).toBe(401);
      expect(expired.body).toEqual({
        error: { failureClass: "unauthenticated", message: "authentication required" },
      });
    } finally {
      short.server.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Role switching — allowed/denied/never-authority
// ---------------------------------------------------------------------------

describe("role switching", () => {
  test("switching a HELD role updates the presentation role only", async () => {
    await post(h.baseUrl, "/v1/auth/register", {
      username: "switcher",
      password: PASSWORD,
      roles: ["viewer", "creator"],
    });
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "switcher",
      password: PASSWORD,
    });
    const response = await post<AccountView>(
      h.baseUrl,
      "/v1/auth/switch-role",
      { role: "creator" },
      { headers: bearer(login.body.token) },
    );
    expect(response.status).toBe(200);
    expect(response.body.activeRole).toBe("creator");
    expect(response.body.roles).toEqual(["creator", "viewer"]); // grants untouched (canonical order)

    const me = await callJson<AccountView>(h.baseUrl, "/v1/auth/me", {
      headers: bearer(login.body.token),
    });
    expect(me.body.activeRole).toBe("creator"); // persisted on the session
  });

  test("switching to a role the account does NOT hold is refused (403)", async () => {
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "switcher",
      password: PASSWORD,
    });
    // First land on a held role...
    const held = await post(
      h.baseUrl,
      "/v1/auth/switch-role",
      { role: "creator" },
      {
        headers: bearer(login.body.token),
      },
    );
    expect(held.status).toBe(200);
    // ...then attempt the unheld one.
    const response = await post(
      h.baseUrl,
      "/v1/auth/switch-role",
      { role: "operator" },
      {
        headers: bearer(login.body.token),
      },
    );
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        failureClass: "permission-denied",
        message:
          "the account does not hold the requested role (role switching never grants authority)",
        details: { action: "account.switch-role" },
      },
    });
    const me = await callJson<AccountView>(h.baseUrl, "/v1/auth/me", {
      headers: bearer(login.body.token),
    });
    expect(me.body.activeRole).toBe("creator"); // unchanged by the refusal
  });

  test("an invalid role value is a validation error (400), not a permission one", async () => {
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "switcher",
      password: PASSWORD,
    });
    const response = await post<{ error: { failureClass: string } }>(
      h.baseUrl,
      "/v1/auth/switch-role",
      { role: "wizard" },
      {
        headers: bearer(login.body.token),
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
  });

  test("ROLE SWITCHING NEVER EXPANDS AUTHORITY: an operator-only action stays denied to a creator", async () => {
    const login = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "switcher",
      password: PASSWORD,
    });
    // Actively present the creator workspace...
    const switched = await post<AccountView>(
      h.baseUrl,
      "/v1/auth/switch-role",
      { role: "creator" },
      { headers: bearer(login.body.token) },
    );
    expect(switched.body.activeRole).toBe("creator");
    // ...and the STORED grants still decide server-side:
    const account = await h.accounts.findByUsername("switcher");
    expect(account?.roles).toEqual(["creator", "viewer"]);
    expect(authorize(account, "provider-health.read")).toEqual({
      allowed: false,
      reason: "role-not-granted",
    });
    expect(authorize(account, "media-session.read", { ownerId: "someone-else" })).toEqual({
      allowed: false,
      reason: "not-resource-owner",
    });
    // The active role is not even an input the policy can consume:
    expect(authorize(account, "media-session.create")).toEqual({
      allowed: true,
      via: "grant:creator",
    }); // from the GRANT, not the active role
  });

  test("switch-role requires a session (401 without token)", async () => {
    const response = await post<{ error: { failureClass: string } }>(
      h.baseUrl,
      "/v1/auth/switch-role",
      { role: "viewer" },
    );
    expect(response.status).toBe(401);
    expect(response.body.error.failureClass).toBe("unauthenticated");
  });
});

// ---------------------------------------------------------------------------
// Validation + transport conventions
// ---------------------------------------------------------------------------

describe("validation and transport conventions", () => {
  test("a short username, a short password, and unknown keys are all 400 validation", async () => {
    const shortUser = await post<{ error: { failureClass: string } }>(
      h.baseUrl,
      "/v1/auth/register",
      { username: "ab", password: PASSWORD },
    );
    expect(shortUser.status).toBe(400);
    expect(shortUser.body.error.failureClass).toBe("validation");

    const shortPassword = await post(h.baseUrl, "/v1/auth/register", {
      username: "long-enough",
      password: "short",
    });
    expect(shortPassword.status).toBe(400);

    const unknownKeys = await post(h.baseUrl, "/v1/auth/register", {
      username: "long-enough",
      password: PASSWORD,
      isAdmin: true,
    });
    expect(unknownKeys.status).toBe(400);

    const badRole = await post(h.baseUrl, "/v1/auth/register", {
      username: "long-enough",
      password: PASSWORD,
      roles: ["wizard"],
    });
    expect(badRole.status).toBe(400);
  });

  test("self-registration cannot mint operator or rights-holder grants (privilege escalation)", async () => {
    const response = await post<{ error: { failureClass: string } }>(
      h.baseUrl,
      "/v1/auth/register",
      {
        username: "escalator",
        password: PASSWORD,
        roles: ["operator", "rights-holder"],
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
    expect(await h.accounts.findByUsername("escalator")).toBeNull(); // nothing created
  });

  test("a duplicate username is 409 conflict", async () => {
    const first = await post(h.baseUrl, "/v1/auth/register", {
      username: "clash",
      password: PASSWORD,
    });
    expect(first.status).toBe(200);
    const second = await post<{ error: { failureClass: string } }>(h.baseUrl, "/v1/auth/register", {
      username: "clash",
      password: PASSWORD,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.failureClass).toBe("conflict");
  });

  test("malformed JSON and empty bodies are 400 validation", async () => {
    const malformed = await post<{ error: { failureClass: string } }>(
      h.baseUrl,
      "/v1/auth/register",
      "{not json",
    );
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.failureClass).toBe("validation");
    const empty = await fetch(`${h.baseUrl}/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(empty.status).toBe(400);
  });

  test("unknown route → 404 unknown-route; wrong method → 405 with allow", async () => {
    const unknown = await callJson<{ error: { failureClass: string } }>(h.baseUrl, "/v1/auth/nope");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.failureClass).toBe("unknown-route");
    const wrongMethod = await callJson<{ error: { failureClass: string } }>(
      h.baseUrl,
      "/v1/auth/register",
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.body.error.failureClass).toBe("method-not-allowed");
    expect(wrongMethod.headers.get("allow")).toBe("POST");
  });

  test("x-request-id is echoed back; a deterministic one is generated otherwise", async () => {
    const echoed = await callJson(h.baseUrl, "/v1/auth/me", {
      headers: { "x-request-id": "rid-42" },
    });
    expect(echoed.requestId).toBe("rid-42");
    const generated = await callJson(h.baseUrl, "/v1/auth/me");
    expect(generated.requestId).toMatch(/^req-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Entropy determinism through the HTTP surface
// ---------------------------------------------------------------------------

describe("entropy determinism (end-to-end through HTTP)", () => {
  test("two servers with the SAME injected entropy issue IDENTICAL tokens", async () => {
    const a = createIdentityServer({
      passwordHasher: createDeterministicTestHasher(),
      nowMs: () => 1,
      entropy: createSequentialEntropySource(),
    });
    const b = createIdentityServer({
      passwordHasher: createDeterministicTestHasher(),
      nowMs: () => 1,
      entropy: createSequentialEntropySource(),
    });
    try {
      for (const server of [a, b]) {
        await post(`http://127.0.0.1:${server.port}`, "/v1/auth/register", {
          username: "determinism",
          password: PASSWORD,
        });
      }
      const loginA = await post<{ token: string }>(`http://127.0.0.1:${a.port}`, "/v1/auth/login", {
        username: "determinism",
        password: PASSWORD,
      });
      const loginB = await post<{ token: string }>(`http://127.0.0.1:${b.port}`, "/v1/auth/login", {
        username: "determinism",
        password: PASSWORD,
      });
      expect(loginB.body.token).toBe(loginA.body.token); // same entropy → same token
    } finally {
      a.stop(true);
      b.stop(true);
    }
  });

  test("two logins on one server issue DIFFERENT tokens (real default entropy never repeats)", async () => {
    await post(h.baseUrl, "/v1/auth/register", { username: "entropycheck", password: PASSWORD });
    const first = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "entropycheck",
      password: PASSWORD,
    });
    const second = await post<{ token: string }>(h.baseUrl, "/v1/auth/login", {
      username: "entropycheck",
      password: PASSWORD,
    });
    expect(second.body.token).not.toBe(first.body.token);
  });
});
