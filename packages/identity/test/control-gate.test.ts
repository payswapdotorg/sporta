/**
 * The W701 bridge tests (W902): the identity-gated control facade against the
 * REAL exported control-api (`createControlApp` from `@sporta/control-api`,
 * a devDependency — the gate itself is structural, no runtime dependency).
 *
 * Simulation D semantics under test:
 *
 * - a NON-OWNER's denial is identical whether or not the media session
 *   exists (the control app is never consulted on the deny path — pinned by
 *   a call counter on a wrapping proxy);
 * - output bytes are denied BEFORE the render-output store is consulted
 *   (pinned by a store-call counter);
 * - the caller-supplied authorization policy is IDENTITY-ATTESTED
 *   (`assertedBy` = the verified userId, never the raw caller's claim);
 * - existence is revealed ONLY to the operator grant (404 vs 200).
 */
import { describe, expect, test } from "bun:test";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { deriveRightsCapabilities } from "@sporta/contracts";
import { createControlApp } from "@sporta/control-api";
import type { ControlApp, RenderOutputStore } from "@sporta/control-api";
import type { Role } from "@sporta/capability";
import {
  InMemoryAccountStore,
  InMemorySessionStore,
  SessionService,
  createIdentityControlGate,
  createSequentialEntropySource,
  defaultEntropySource,
} from "../src/index";
import type { GatedControlApp, IdentityControlGate } from "../src/index";
import { IdentityPermissionDeniedError } from "../src/index";

// ---------------------------------------------------------------------------
// A minimal real render-output store (the W504 port, rights re-derived)
// ---------------------------------------------------------------------------

interface StoredSegment {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  content: string;
  byteLength: number;
  contentHash: string;
  manifest: unknown;
}

function createStore(): RenderOutputStore & {
  add(segment: StoredSegment): void;
  calls: number;
} {
  const segments = new Map<string, StoredSegment>();
  const key = (s: string, r: string, seg: string): string => `${s}|${r}|${seg}`;
  const store: RenderOutputStore & { add(segment: StoredSegment): void; calls: number } = {
    calls: 0,
    add(segment) {
      segments.set(key(segment.sessionId, segment.renderId, segment.segmentId), segment);
    },
    getSegment(query) {
      store.calls += 1;
      const caps = deriveRightsCapabilities(
        query.policy,
        new Date(4102444800000), // far future: policies never expire in these scenarios
      );
      if (caps.canStoreDerivatives !== true) return null;
      const stored = segments.get(key(query.sessionId, query.renderId, query.segmentId));
      return stored === undefined ? null : { ...structuredClone(stored) };
    },
    listSegments(query) {
      store.calls += 1;
      const caps = deriveRightsCapabilities(query.policy, new Date(4102444800000));
      if (caps.canStoreDerivatives !== true) return [];
      return [...segments.values()]
        .filter(
          (segment) =>
            segment.sessionId === query.sessionId && segment.renderId === query.renderId,
        )
        .map(({ segmentId, contentType, byteLength, contentHash }) => ({
          segmentId,
          contentType,
          byteLength,
          contentHash,
        }));
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// The harness: real accounts + sessions + a REAL control app behind the gate
// ---------------------------------------------------------------------------

/** A full-allow rights declaration (what an authorized upload asserts). */
const FULL_ALLOW_DECLARATION: { authorizationPolicy: AuthorizationPolicy; sourceLabel?: string } = {
  authorizationPolicy: {
    policyId: "pol-test-full",
    allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage"],
    assertedBy: "raw-caller-claim", // the W701 trust-boundary claim the gate MUST replace
    sharingScope: "private",
  },
};

interface GateHarness {
  gate: IdentityControlGate;
  control: ControlApp;
  store: ReturnType<typeof createStore>;
  accounts: InMemoryAccountStore;
  sessionService: SessionService;
  createCalls: AuthorizationPolicy[]; // what the gate actually handed the control plane
}

function createGateHarness(): GateHarness {
  const accounts = new InMemoryAccountStore();
  const sessionService = new SessionService({
    store: new InMemorySessionStore(),
    entropy: defaultEntropySource,
    nowMs: () => 1_000_000,
  });
  const store = createStore();
  const app: ControlApp = createControlApp({
    renderOutputStore: store,
    nowMs: () => 1_000_000,
  });
  const createCalls: AuthorizationPolicy[] = [];
  // A recording proxy over the REAL app: the gate fronts this, the app does
  // the work. Recording proves WHICH policy the identity layer attested.
  const recorded: GatedControlApp = {
    createSession: (input, ctx) => {
      createCalls.push(structuredClone(input.authorizationPolicy));
      return app.createSession(input, ctx);
    },
    getSession: (sessionId, ctx) => app.getSession(sessionId, ctx),
    terminateSession: (sessionId, ctx) => app.terminateSession(sessionId, ctx),
    listRenderOutputs: (sessionId, renderId, ctx) =>
      app.listRenderOutputs(sessionId, renderId, ctx),
    getRenderOutput: (sessionId, renderId, segmentId, ctx) =>
      app.getRenderOutput(sessionId, renderId, segmentId, ctx),
  };
  const gate = createIdentityControlGate({
    accounts,
    sessions: sessionService,
    control: recorded,
  });
  return { gate, control: app, store, accounts, sessionService, createCalls };
}

/** Registers an account directly in the store and returns a live token. */
async function registerAndLogin(
  h: GateHarness,
  username: string,
  roles: Role[],
): Promise<{ token: string; userId: string }> {
  const account = await h.accounts.create({
    username,
    email: undefined,
    // The gate authenticates via the SESSION token, not the password; a
    // placeholder hash keeps this suite fast (argon2 is pinned in
    // accounts.test.ts + http.test.ts covers verification end-to-end).
    passwordHash: "test-placeholder-not-a-real-hash",
    roles,
    createdAtIso: "2025-01-06T12:00:00.000Z",
  });
  const issued = await h.sessionService.issue({ userId: account.userId });
  return { token: issued.token, userId: account.userId };
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

describe("identity-attested media-session creation (the W701 bridge)", () => {
  test("a creator creates a session; the policy the control plane receives is ATTESTED by the verified identity", async () => {
    const h = createGateHarness();
    const creator = await registerAndLogin(h, "creator-one", ["viewer", "creator"]);
    const result = (await h.gate.createMediaSession(creator.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string; status: string; authorizationPolicyId: string };
      rightsCapabilities: { canReferenceSourceFrames: boolean };
    };
    expect(result.session.authorizationPolicyId).toBe("pol-test-full");
    expect(result.session.status).toBe("authorized");
    expect(result.rightsCapabilities.canReferenceSourceFrames).toBe(true);
    // THE BRIDGE: the caller's raw claim was REPLACED by the verified id.
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]!.assertedBy).toBe(creator.userId);
    expect(h.createCalls[0]!.assertedBy).not.toBe("raw-caller-claim");
    expect(h.createCalls[0]!.policyId).toBe("pol-test-full");
  });

  test("a VIEWER (no creator grant) cannot create a media session — even with active-role presentation", async () => {
    const h = createGateHarness();
    const viewer = await registerAndLogin(h, "viewer-one", ["viewer"]);
    await h.sessionService.switchRole(viewer.token, "viewer", ["viewer"]);
    await expect(h.gate.createMediaSession(viewer.token, FULL_ALLOW_DECLARATION)).rejects.toThrow(
      /creator, rights-holder, or operator/,
    );
    expect(h.createCalls).toHaveLength(0); // the control plane was never touched
  });

  test("an unauthenticated token cannot create anything", async () => {
    const h = createGateHarness();
    await expect(h.gate.createMediaSession("no-such-token", FULL_ALLOW_DECLARATION)).rejects.toThrow(
      /authentication required/,
    );
  });

  test("a rights-holder and an operator may also create (the matrix's upload column)", async () => {
    const h = createGateHarness();
    const rightsHolder = await registerAndLogin(h, "rh-one", ["rights-holder"]);
    const operator = await registerAndLogin(h, "op-one", ["operator"]);
    const a = (await h.gate.createMediaSession(rightsHolder.token, {
      authorizationPolicy: { ...FULL_ALLOW_DECLARATION.authorizationPolicy, policyId: "pol-rh" },
    })) as { session: { sessionId: string } };
    const b = (await h.gate.createMediaSession(operator.token, {
      authorizationPolicy: { ...FULL_ALLOW_DECLARATION.authorizationPolicy, policyId: "pol-op" },
    })) as { session: { sessionId: string } };
    expect(a.session.sessionId).toMatch(/^sess-\d+$/);
    expect(b.session.sessionId).toMatch(/^sess-\d+$/);
  });
});

describe("Simulation D: denial before existence is revealed", () => {
  test("a NON-OWNER's denial is identical for an existing and a non-existent session", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-d", ["viewer", "creator"]);
    const stranger = await registerAndLogin(h, "stranger-d", ["viewer", "creator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    const realId = created.session.sessionId;

    const denials: IdentityPermissionDeniedError[] = [];
    for (const sessionId of [realId, "sess-does-not-exist"]) {
      try {
        await h.gate.getMediaSession(stranger.token, sessionId);
        throw new Error("expected a denial");
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityPermissionDeniedError);
        denials.push(err as IdentityPermissionDeniedError);
      }
    }
    // Identical class, message, and details — the control plane (and hence
    // existence) never entered the deny path.
    const [forReal, forMissing] = denials;
    expect(forReal!.failureClass).toBe("permission-denied");
    expect(forReal!.httpStatus).toBe(403);
    expect(forReal!.message).toBe(forMissing!.message);
    expect(forReal!.details).toEqual(forMissing!.details);
    expect(forReal!.details).toEqual({ action: "media-session.read" });
    // No existence data leaked into the denial:
    expect(forReal!.message).not.toContain(realId);
    expect(forMissing!.message).not.toContain("sess-does-not-exist");
  });

  test("the control plane is NEVER consulted on a denied read (no existence oracle)", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-o", ["creator"]);
    const stranger = await registerAndLogin(h, "stranger-o", ["creator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    let getSessionCalls = 0;
    const gate = createIdentityControlGate({
      accounts: h.accounts,
      sessions: h.sessionService,
      control: {
        ...h.control,
        getSession: (sessionId: string, ctx?: { requestId?: string }) => {
          getSessionCalls += 1;
          return h.control.getSession(sessionId, ctx);
        },
      },
    });
    await expect(gate.getMediaSession(stranger.token, created.session.sessionId)).rejects.toThrow(
      /not authorized/,
    );
    expect(getSessionCalls).toBe(0); // denied BEFORE the control plane was consulted
  });

  test("existence is revealed ONLY to the operator grant (404 vs 200)", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-x", ["creator"]);
    const operator = await registerAndLogin(h, "op-x", ["operator", "viewer"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    // Operator may read the owner's session (the matrix's operational view):
    const operational = (await h.gate.getMediaSession(
      operator.token,
      created.session.sessionId,
    )) as { session: { sessionId: string } };
    expect(operational.session.sessionId).toBe(created.session.sessionId);
    // And for a non-existent session, the OPERATOR learns it does not exist:
    await expect(h.gate.getMediaSession(operator.token, "sess-missing")).rejects.toThrow(
      /was not found/,
    );
  });

  test("the OWNER reads their own session through the gate", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-r", ["creator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    const read = (await h.gate.getMediaSession(owner.token, created.session.sessionId)) as {
      session: { sessionId: string };
    };
    expect(read.session.sessionId).toBe(created.session.sessionId);
  });

  test("a REVOKED session is a generic authentication failure at the gate", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-v", ["creator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    await h.sessionService.revoke(owner.token);
    await expect(h.gate.getMediaSession(owner.token, created.session.sessionId)).rejects.toThrow(
      /authentication required/,
    );
  });
});

describe("output bytes: denied before exposure", () => {
  test("a non-owner is denied BEFORE the render-output store is consulted; the owner retrieves the bytes", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-b", ["creator"]);
    const stranger = await registerAndLogin(h, "stranger-b", ["creator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    const sessionId = created.session.sessionId;
    h.store.add({
      sessionId,
      renderId: "r-1",
      segmentId: "seg-1",
      contentType: "image/svg+xml",
      content: "<svg>secret-bytes</svg>",
      byteLength: 24,
      contentHash: "b".repeat(64),
      manifest: { kind: "animated-svg" },
    });

    // The stranger is denied BEFORE the store is touched.
    const callsBefore = h.store.calls;
    await expect(
      h.gate.getRenderOutput(stranger.token, sessionId, "r-1", "seg-1"),
    ).rejects.toThrow(/not authorized/);
    expect(h.store.calls).toBe(callsBefore); // ZERO store calls on the deny path

    // The owner reads the actual bytes through the REAL control app.
    const document = (await h.gate.getRenderOutput(owner.token, sessionId, "r-1", "seg-1")) as {
      content: string;
      contentType: string;
    };
    expect(document.content).toBe("<svg>secret-bytes</svg>");
    expect(document.contentType).toBe("image/svg+xml");

    // Listing is gated identically.
    await expect(h.gate.listRenderOutputs(stranger.token, sessionId, "r-1")).rejects.toThrow(
      /not authorized/,
    );
    expect(h.store.calls).toBe(1); // only the owner's retrieval hit the store
  });

  test("the operator may read output bytes of any mediated session", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-c", ["creator"]);
    const operator = await registerAndLogin(h, "op-c", ["operator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    h.store.add({
      sessionId: created.session.sessionId,
      renderId: "r-1",
      segmentId: "seg-1",
      contentType: "image/svg+xml",
      content: "<svg>op-bytes</svg>",
      byteLength: 19,
      contentHash: "c".repeat(64),
      manifest: { kind: "animated-svg" },
    });
    const document = (await h.gate.getRenderOutput(
      operator.token,
      created.session.sessionId,
      "r-1",
      "seg-1",
    )) as { content: string };
    expect(document.content).toBe("<svg>op-bytes</svg>");
  });

  test("an unauthenticated token gets a generic 401-class denial at the output boundary", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-u", ["creator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    const calls = h.store.calls;
    await expect(
      h.gate.getRenderOutput("unknown-token", created.session.sessionId, "r-1", "seg-1"),
    ).rejects.toThrow(/authentication required/);
    expect(h.store.calls).toBe(calls);
  });
});

describe("terminate + grants-vs-active-role invariants at the gate", () => {
  test("only the owner or an operator may terminate", async () => {
    const h = createGateHarness();
    const owner = await registerAndLogin(h, "owner-t", ["creator"]);
    const stranger = await registerAndLogin(h, "stranger-t", ["creator", "analyst"]);
    const operator = await registerAndLogin(h, "op-t", ["operator"]);
    const created = (await h.gate.createMediaSession(owner.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    await expect(
      h.gate.terminateMediaSession(stranger.token, created.session.sessionId),
    ).rejects.toThrow(/not authorized/);
    const terminated = (await h.gate.terminateMediaSession(
      operator.token,
      created.session.sessionId,
    )) as { session: { status: string } };
    expect(terminated.session.status).toBe("cancelled");
  });

  test("a creator that SWITCHED presentation to viewer still creates (grants decide, not the active role)", async () => {
    const h = createGateHarness();
    const creator = await registerAndLogin(h, "creator-s", ["viewer", "creator"]);
    await h.sessionService.switchRole(creator.token, "viewer", ["viewer", "creator"]);
    const result = (await h.gate.createMediaSession(creator.token, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    expect(result.session.sessionId).toMatch(/^sess-\d+$/);
    // And the account's grants were never mutated by the switch:
    const account = await h.accounts.findByUserId(creator.userId);
    expect(account?.roles).toEqual(["viewer", "creator"]);
  });

  test("entropy determinism at the gate: the injected source fully controls the token", async () => {
    const h = createGateHarness();
    const deterministic = new SessionService({
      store: new InMemorySessionStore(),
      entropy: createSequentialEntropySource(),
      nowMs: () => 1,
    });
    const account = await h.accounts.create({
      username: "det",
      email: undefined,
      passwordHash: "x",
      roles: ["creator"],
      createdAtIso: "2025-01-06T12:00:00.000Z",
    });
    const gate = createIdentityControlGate({
      accounts: h.accounts,
      sessions: deterministic,
      control: h.control,
    });
    const tokenA = (await deterministic.issue({ userId: account.userId })).token;
    const tokenB = (await deterministic.issue({ userId: account.userId })).token;
    expect(tokenB).not.toBe(tokenA); // the stream advances (no accidental reuse)
    expect(tokenA).toMatch(/^[A-Za-z0-9_-]+$/);
    const created = (await gate.createMediaSession(tokenA, FULL_ALLOW_DECLARATION)) as {
      session: { sessionId: string };
    };
    expect(created.session.sessionId).toMatch(/^sess-\d+$/);
  });
});
