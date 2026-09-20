/**
 * THE COMPUTE CONNECTION CENTER TESTS (J005) — the first-class destination's
 * full lifecycle over the REAL composition: the REAL ConnectionCenter over
 * the REAL provider adapters (controlled transport — the adapters' own
 * injected-fetch seam), through the REAL route handlers, with a
 * deterministic clock + hermetic stores.
 *
 * The journey-3 accept criteria, each pinned:
 *
 * - first-class destination: the route exists, is URL-addressable
 *   (ROUTES.computeCenter), and answers the status document;
 * - the connect/verify/disconnect lifecycle with TYPED failure states
 *   (verified / invalid / unverified-unreachable — the adapters' honest
 *   vocabularies, never invented);
 * - the Sporta-compute vs BYOC distinction (the status document's plane +
 *   execution zones) and goal-oriented selection language;
 * - NO master passwords: the password class is refused fail-closed, the
 *   refusal is RECORDED, and nothing is stored;
 * - honest unavailable/degraded states (an unreachable provider proves
 *   NOTHING about a credential);
 * - account isolation + connection durability across compositions (the
 *   persistent destination requirement — two servers over ONE sqlite
 *   store file).
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeterministicTestHasher } from "@sporta/identity";
import {
  InMemoryAccountStore,
  InMemorySessionStore,
  SessionService,
  createSequentialEntropySource,
} from "@sporta/identity";
import { InMemoryConnectionStore } from "@sporta/connection-center";
import { SqliteConnectionStore } from "@sporta/connection-center";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { buildComputeConnectionPlane } from "../src/server/compute-connection-plane";
import { parseLocalComputeCommands } from "../src/server/compute-connection-plane";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { ROUTES } from "../src/lib/navigation";
import { GET as computeStatusRoute } from "../src/app/api/account/compute/route";
import { POST as connectRoute } from "../src/app/api/account/compute/connections/route";
import {
  DELETE as disconnectRoute,
} from "../src/app/api/account/compute/connections/[providerId]/route";
import {
  POST as verifyRoute,
} from "../src/app/api/account/compute/connections/[providerId]/verify/route";

/** A deterministic stepping clock (the repo's hermetic rig). */
function steppingClock(): () => number {
  let current = 2_222_222_222_000;
  return () => {
    current += 23;
    return current;
  };
}

// ---------------------------------------------------------------------------
// The controlled provider transport (the adapters' own injected-fetch seam)
// ---------------------------------------------------------------------------

type TransportBehavior = "ok" | "reject-credentials" | "unreachable";

let transportBehavior: TransportBehavior = "ok";
let transportCalls = 0;

const controlledFetch: import("../src/server/compute-connection-plane").ControlledProviderFetch =
  async () => {
    transportCalls += 1;
    if (transportBehavior === "unreachable") {
      throw new TypeError("fetch failed (simulated provider outage)");
    }
    if (transportBehavior === "reject-credentials") {
      return new Response(JSON.stringify({ error: "invalid token" }), { status: 401 });
    }
    return new Response(JSON.stringify({ functions: [] }), { status: 200 });
  };

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

let server: SportaServer;
let scratch = "";
let creatorToken = "";
let outsiderToken = "";

function withCookie(token: string | null, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token === null ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` }),
    },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function jsonPost(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-compute-center-"));
  const nowMs = steppingClock();
  server = createSportaServer({
    nowMs,
    passwordHasher: createDeterministicTestHasher(),
    transient: { redis: new InMemoryRedis(nowMs), provider: "in-memory" },
    seed: true,
    media: { db: ":memory:" },
    computeCenter: {
      providers: buildComputeConnectionPlane({ nowMs, fetchFn: controlledFetch }).providers,
      executionZones: buildComputeConnectionPlane({ nowMs }).executionZones,
      store: new InMemoryConnectionStore({ nowMs }),
    },
  });
  installSportaServerForTests(server);
  await server.ready;

  const registered = await server.auth.register({
    username: "compute-center-creator",
    password: "a-real-compute-password",
    roles: ["creator", "viewer"],
  });
  creatorToken = (await server.auth.issueSession({ userId: registered.userId })).token;
  const outsider = await server.auth.register({
    username: "compute-center-outsider",
    password: "another-real-password",
    roles: ["viewer"],
  });
  outsiderToken = (await server.auth.issueSession({ userId: outsider.userId })).token;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The destination (first-class, URL-addressable)
// ---------------------------------------------------------------------------

describe("the Compute Center destination (J005)", () => {
  test("is a first-class route in the product navigation model", () => {
    expect(ROUTES.computeCenter).toBe("/account/compute");
  });

  test("an anonymous caller gets the real 401", async () => {
    const response = await computeStatusRoute(withCookie(null, "/api/account/compute"));
    expect(response.status).toBe(401);
  });

  test("the status document carries the distinction, goals and honest postures", async () => {
    const response = await computeStatusRoute(withCookie(creatorToken, "/api/account/compute"));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    // The Sporta-managed plane (the same plane the studio's auto mode uses).
    const sportaPlane = body.sportaPlane as Record<string, unknown>;
    expect(sportaPlane.configured).toBe(true);
    expect(typeof sportaPlane.framing).toBe("string");
    // The BYOC providers — honest never-connected postures, zone-framed.
    const providers = body.providers as Array<Record<string, unknown>>;
    expect(providers.length).toBe(3);
    for (const provider of providers) {
      expect(provider.posture).toBe("never-connected");
      expect(provider.executionZone).toBe("provider-cloud");
      expect(typeof provider.goalFraming).toBe("string");
    }
    // Goal-oriented language, no infrastructure jargon required.
    const goals = body.goals as Array<Record<string, unknown>>;
    expect(goals.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(goals)).not.toMatch(/vram|gpu-cloud|serverless-function/i);
    // The credential policy (the refusal posture).
    const policy = body.credentialPolicy as Record<string, string[]>;
    expect(policy.refusedKinds).toContain("master-password");
  });

  test("the default plane honestly omits local compute when unconfigured", () => {
    const plane = buildComputeConnectionPlane({ nowMs: () => 0 });
    expect(plane.providers.map((provider) => provider.providerId)).toEqual([
      "provider.modal",
      "provider.lightning",
      "provider.runpod",
    ]);
    expect(plane.executionZones.get("provider.local")).toBeUndefined();
  });

  test("a configured local command table adds the self-hosted entry", () => {
    const commands = parseLocalComputeCommands(
      JSON.stringify({ "anime.prototype": { command: "bun", args: ["run", "render.ts"] } }),
    );
    expect(commands).toBeDefined();
    const plane = buildComputeConnectionPlane({
      nowMs: () => 0,
      localCommands: commands!,
      localGpu: { available: false, probe: "nvidia-smi" },
    });
    const local = plane.providers.find((provider) => provider.providerId === "provider.local");
    expect(local).toBeDefined();
    expect(local!.requiresCredential).toBe(false);
    expect(plane.executionZones.get("provider.local")).toBe("user-controlled");
  });

  test("an invalid local command declaration fails loud (never a silent skip)", () => {
    expect(() => parseLocalComputeCommands("not json")).toThrow();
    expect(() => parseLocalComputeCommands(JSON.stringify({ r: { command: "" } }))).toThrow();
    expect(parseLocalComputeCommands(undefined)).toBeUndefined();
    expect(parseLocalComputeCommands("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The connect/verify/disconnect lifecycle (typed states, never invented)
// ---------------------------------------------------------------------------

describe("the connect lifecycle (J005)", () => {
  test("connect with a scoped API key: connected-unverified, NO credential value anywhere", async () => {
    transportBehavior = "ok";
    const response = await connectRoute(
      withCookie(
        creatorToken,
        "/api/account/compute/connections",
        jsonPost({
          providerId: "provider.runpod",
          credential: { kind: "scoped-api-key", apiKey: "rpk_scoped_test_value_123" },
        }),
      ),
    );
    expect(response.status).toBe(201);
    const body = await bodyOf(response);
    expect(body.outcome).toBe("connected");
    const record = body.record as Record<string, unknown>;
    expect(record.state).toBe("connected-unverified");
    const credential = record.credential as Record<string, unknown>;
    expect(credential.kind).toBe("scoped-api-key");
    expect(typeof credential.fingerprint).toBe("string");
    // The VALUE never rides any answer (the no-leak pin).
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("rpk_scoped_test_value_123");
  });

  test("verify with the provider rejecting the credential: connected-invalid (honest)", async () => {
    transportBehavior = "reject-credentials";
    const response = await verifyRoute(
      withCookie(creatorToken, "/api/account/compute/connections/provider.runpod/verify", jsonPost({})),
      { params: Promise.resolve({ providerId: "provider.runpod" }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    const record = body.record as Record<string, unknown>;
    expect(record.state).toBe("connected-invalid");
    expect(record.lastVerifiedState).toBe("invalid");
  });

  test("verify with the provider reachable: connected-verified", async () => {
    transportBehavior = "ok";
    const callsBefore = transportCalls;
    const response = await verifyRoute(
      withCookie(creatorToken, "/api/account/compute/connections/provider.runpod/verify", jsonPost({})),
      { params: Promise.resolve({ providerId: "provider.runpod" }) },
    );
    expect(response.status).toBe(200);
    expect(transportCalls).toBeGreaterThan(callsBefore); // a REAL call happened
    const body = await bodyOf(response);
    const record = body.record as Record<string, unknown>;
    expect(record.state).toBe("connected-verified");
    expect(record.lastVerifiedState).toBe("verified");
  });

  test("verify while the provider is unreachable: the prior verdict stands (an outage proves NOTHING)", async () => {
    transportBehavior = "unreachable";
    const response = await verifyRoute(
      withCookie(creatorToken, "/api/account/compute/connections/provider.runpod/verify", jsonPost({})),
      { params: Promise.resolve({ providerId: "provider.runpod" }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    const record = body.record as Record<string, unknown>;
    // The honest unreachable semantics: the PRIOR observed verdict stands
    // (an outage proves nothing in either direction) and the ATTEMPT is
    // recorded in the entry's detail — never a fabricated verdict, never a
    // silent nothing.
    expect(record.state).toBe("connected-verified");
    expect(record.lastVerifiedState).toBe("verified");
    const history = record.history as Array<Record<string, unknown>>;
    const lastEntry = history[history.length - 1]!;
    expect(String(lastEntry.detail)).toContain("verification attempted");
    transportBehavior = "ok";
  });

  test("re-presenting the SAME credential is a counted duplicate", async () => {
    const response = await connectRoute(
      withCookie(
        creatorToken,
        "/api/account/compute/connections",
        jsonPost({
          providerId: "provider.runpod",
          credential: { kind: "scoped-api-key", apiKey: "rpk_scoped_test_value_123" },
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect((await bodyOf(response)).outcome).toBe("duplicate");
  });

  test("a DIFFERENT credential over the live connection: typed 409 conflict", async () => {
    const response = await connectRoute(
      withCookie(
        creatorToken,
        "/api/account/compute/connections",
        jsonPost({
          providerId: "provider.runpod",
          credential: { kind: "scoped-api-key", apiKey: "rpk_a_different_scoped_key" },
        }),
      ),
    );
    expect(response.status).toBe(409);
    const body = await bodyOf(response);
    expect((body.error as Record<string, unknown>).failureClass).toBe("validation");
  });

  test("disconnect removes the connection (and a second disconnect is the typed 404)", async () => {
    const response = await disconnectRoute(
      withCookie(creatorToken, "/api/account/compute/connections/provider.runpod", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ providerId: "provider.runpod" }) },
    );
    expect(response.status).toBe(200);
    expect((await bodyOf(response)).outcome).toBe("disconnected");

    const second = await disconnectRoute(
      withCookie(creatorToken, "/api/account/compute/connections/provider.runpod", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ providerId: "provider.runpod" }) },
    );
    expect(second.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The master-password refusal (fail-closed, recorded, never stored)
// ---------------------------------------------------------------------------

describe("no master passwords, ever (J005)", () => {
  test("a password-class presentation is refused fail-closed with the typed outcome", async () => {
    const response = await connectRoute(
      withCookie(
        creatorToken,
        "/api/account/compute/connections",
        jsonPost({
          providerId: "provider.modal",
          credential: { kind: "master-password", password: "the-account-master-password" },
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.outcome).toBe("refused-master-password");
    expect(body.presentedKind).toBe("master-password");
    expect(String(body.message)).toContain("never accepted");
    // The presented VALUE never rides the answer.
    expect(JSON.stringify(body)).not.toContain("the-account-master-password");
  });

  test("the refusal left NO connection record (the provider stays never-connected)", async () => {
    const response = await computeStatusRoute(withCookie(creatorToken, "/api/account/compute"));
    const body = await bodyOf(response);
    const modal = (body.providers as Array<Record<string, unknown>>).find(
      (provider) => provider.providerId === "provider.modal",
    );
    expect(modal!.posture).toBe("never-connected");
    expect(modal!.connection).toBeNull();
  });

  test("the refusal IS recorded in the connection audit trail (refused ≠ dropped)", async () => {
    const account = await server.gate.requireAccount(creatorToken);
    const audit = await server.computeCenter.connectionCenter.backingStore.listAudit(
      account.userId,
      10,
    );
    const refusal = audit.find((entry) => entry.outcome === "connect-refused-master-password");
    expect(refusal).toBeDefined();
    expect(refusal!.providerId).toBe("provider.modal");
  });
});

// ---------------------------------------------------------------------------
// Account isolation + the persistent destination
// ---------------------------------------------------------------------------

describe("account isolation + durability (J005)", () => {
  test("another account's status is untouched (isolation by construction)", async () => {
    const response = await computeStatusRoute(withCookie(outsiderToken, "/api/account/compute"));
    const body = await bodyOf(response);
    for (const provider of body.providers as Array<Record<string, unknown>>) {
      expect(provider.posture).toBe("never-connected");
    }
  });

  test("connections persist across compositions over ONE sqlite store (persistent destination)", async () => {
    const dbFile = join(scratch, "compute-connections.db");
    const nowMs = steppingClock();
    const plane = buildComputeConnectionPlane({ nowMs, fetchFn: controlledFetch });
    // The SHARED identity plane (what a durable deployment shares): both
    // compositions see the same account + sessions.
    const accounts = new InMemoryAccountStore();
    const sessions = new SessionService({
      store: new InMemorySessionStore(),
      nowMs,
      entropy: createSequentialEntropySource(),
    });
    const base = {
      nowMs,
      passwordHasher: createDeterministicTestHasher(),
      accounts,
      sessions,
      transient: { redis: new InMemoryRedis(nowMs), provider: "in-memory" as const },
      seed: false,
      media: { db: ":memory:" as const },
      computeCenter: {
        providers: plane.providers,
        executionZones: plane.executionZones,
      },
    };
    // Instance A: connect.
    const serverA = createSportaServer({ ...base, computeCenter: { ...base.computeCenter, db: dbFile } });
    installSportaServerForTests(serverA);
    await serverA.ready;
    const accountA = await serverA.auth.register({
      username: "durable-connections-user",
      password: "a-real-password-again",
      roles: ["creator"],
    });
    const tokenA = (await serverA.auth.issueSession({ userId: accountA.userId })).token;
    const connectResponse = await connectRoute(
      withCookie(
        tokenA,
        "/api/account/compute/connections",
        jsonPost({
          providerId: "provider.lightning",
          credential: { kind: "scoped-api-key", apiKey: "li_scoped_key_for_durability" },
        }),
      ),
    );
    expect(connectResponse.status).toBe(201);

    // Instance B (a DIFFERENT composition — the restart): the connection
    // record is fully addressable through the same routes.
    const serverB = createSportaServer({ ...base, computeCenter: { ...base.computeCenter, db: dbFile } });
    installSportaServerForTests(serverB);
    await serverB.ready;
    const tokenB = (await serverB.auth.issueSession({ userId: accountA.userId })).token;
    const statusResponse = await computeStatusRoute(withCookie(tokenB, "/api/account/compute"));
    expect(statusResponse.status).toBe(200);
    const body = await bodyOf(statusResponse);
    const lightning = (body.providers as Array<Record<string, unknown>>).find(
      (provider) => provider.providerId === "provider.lightning",
    );
    expect(lightning!.posture).toBe("connected-unverified");
    expect(lightning!.connection).not.toBeNull();
    // And the disconnect works from instance B (the full lifecycle survives).
    const disconnectResponse = await disconnectRoute(
      withCookie(tokenB, "/api/account/compute/connections/provider.lightning", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ providerId: "provider.lightning" }) },
    );
    expect(disconnectResponse.status).toBe(200);
    // Cleanup: close the sqlite stores.
    (serverA.computeCenter.connectionCenter.backingStore as SqliteConnectionStore).close();
    (serverB.computeCenter.connectionCenter.backingStore as SqliteConnectionStore).close();
  });
});
