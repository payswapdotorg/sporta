/**
 * THE J008/J009 RIGHTS DOMAIN BATTERY — the domain/persistence lane for
 * rights edit/revoke (J008) and audit discoverability (J009):
 *
 * - the effective-policy store round-trips (in-memory AND `bun:sqlite` —
 *   the durable seam the app layer's in-memory W917 stores cannot offer);
 * - the editor: GRANT (creation, re-attested), WIDEN/NARROW (edits,
 *   classified + audited), REVOKE (the contract's own time bound →
 *   DENY_ALL by the REAL derivation), the narrow-only capability ceiling
 *   (an edit can never widen past the creation attestation — the W917
 *   `intersectCaps` rule mirrored), expiry sanity (an already-expired edit
 *   refuses; revoke is the one exception);
 * - the audit trail: APPEND-ONLY, every change recorded (who/what/when/
 *   from/to + the J008 editKind), never rewritten;
 * - the J009 query seam: the role matrix — a rights holder reaches their
 *   OWN sessions' trails, an operator reaches every trail, every other
 *   role gets the honest 403, unauthenticated the honest 401 (uniform, no
 *   existence oracle).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthorizationPolicy } from "@sporta/contracts";
import {
  createRightsAuditQueryService,
  createRightsEditor,
  InMemoryEffectivePolicyStore,
  InMemoryRightsAuditStore,
  RightsEditorValidationError,
  SqliteRightsStore,
  effectiveCapabilitiesOf,
} from "../src/index";
import type { RightsAuditStore, EffectivePolicyStore, RightsEditor } from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_MS = 1_750_000_000_000;

/** A full-rights policy document (the fixture family's shape). */
function fullPolicy(policyId: string, assertedBy: string): AuthorizationPolicy {
  return {
    policyId,
    allowedOperations: [
      "analysis",
      "transformation",
      "liveDelivery",
      "derivativeGeneration",
      "storage",
      "sharing",
    ],
    assertedBy,
  };
}

/** An analysis-only policy (a narrowed set). */
function analysisOnlyPolicy(policyId: string, assertedBy: string): AuthorizationPolicy {
  return {
    policyId,
    allowedOperations: ["analysis"],
    assertedBy,
  };
}

// ---------------------------------------------------------------------------
// The effective-policy + audit store round-trips (both implementations)
// ---------------------------------------------------------------------------

describe("the effective-policy + audit stores (J008 persistence)", () => {
  const suites: Array<{
    name: string;
    make: () => EffectivePolicyStore & RightsAuditStore;
    cleanup?: (store: EffectivePolicyStore & RightsAuditStore) => void;
  }> = [
    {
      name: "in-memory",
      make: () => {
        const policies = new InMemoryEffectivePolicyStore();
        const audit = new InMemoryRightsAuditStore();
        // A combined facade over both in-memory implementations.
        const combined = {
          recordAtCreation: policies.recordAtCreation.bind(policies),
          setOverride: policies.setOverride.bind(policies),
          recordedOf: policies.recordedOf.bind(policies),
          overrideOf: policies.overrideOf.bind(policies),
          effectiveOf: policies.effectiveOf.bind(policies),
          hasOverride: policies.hasOverride.bind(policies),
          append: audit.append.bind(audit),
          of: audit.of.bind(audit),
          ofSessions: audit.ofSessions.bind(audit),
          lastOf: audit.lastOf.bind(audit),
          all: audit.all.bind(audit),
        } as EffectivePolicyStore & RightsAuditStore;
        return combined;
      },
    },
    {
      name: "sqlite",
      make: () =>
        new SqliteRightsStore(":memory:") as SqliteRightsStore as EffectivePolicyStore &
          RightsAuditStore,
      cleanup: (store) => (store as unknown as SqliteRightsStore).close(),
    },
  ];

  for (const suite of suites) {
    describe(suite.name, () => {
      test("record + effectiveOf: the creation record answers until an edit exists", () => {
        const policies = suite.make();
        policies.recordAtCreation("sess-1", fullPolicy("pol-full", "creator-1"));
        expect(policies.recordedOf("sess-1")?.policyId).toBe("pol-full");
        expect(policies.effectiveOf("sess-1")?.policyId).toBe("pol-full");
        expect(policies.hasOverride("sess-1")).toBe(false);
        expect(policies.effectiveOf("sess-unknown")).toBeNull();
      });

      test("override + effectiveOf: the edit answers while it exists", () => {
        const policies = suite.make();
        policies.recordAtCreation("sess-1", fullPolicy("pol-full", "creator-1"));
        policies.setOverride("sess-1", analysisOnlyPolicy("pol-narrow", "holder-1"));
        expect(policies.overrideOf("sess-1")?.policyId).toBe("pol-narrow");
        expect(policies.effectiveOf("sess-1")?.policyId).toBe("pol-narrow");
        expect(policies.hasOverride("sess-1")).toBe(true);
        expect(policies.recordedOf("sess-1")?.policyId).toBe("pol-full"); // the ceiling survives
      });

      test("invalid documents refuse fail-loud on write (never partial data)", () => {
        const policies = suite.make();
        expect(() =>
          policies.recordAtCreation("sess-1", {
            policyId: "",
            allowedOperations: [],
            assertedBy: "",
          } as never),
        ).toThrow();
        expect(() => policies.setOverride("sess-1", null as never)).toThrow();
        expect(policies.effectiveOf("sess-1")).toBeNull();
      });

      test("the audit trail is append-only, ordered, and scoped", () => {
        const audit = suite.make();
        audit.append({
          atIso: "2026-01-01T00:00:00Z",
          actorUserId: "u1",
          sessionId: "s1",
          changeKind: "policy",
          editKind: "grant",
          summary: "granted",
          from: null,
          to: { a: 1 },
        });
        audit.append({
          atIso: "2026-01-02T00:00:00Z",
          actorUserId: "u2",
          sessionId: "s1",
          changeKind: "revocation",
          editKind: "revoke",
          summary: "revoked",
          from: { a: 1 },
          to: null,
        });
        audit.append({
          atIso: "2026-01-03T00:00:00Z",
          actorUserId: "u3",
          sessionId: "s2",
          changeKind: "policy",
          editKind: "narrow",
          summary: "narrowed",
          from: null,
          to: null,
        });
        expect(audit.of("s1").length).toBe(2);
        expect(audit.of("s1")[0]!.actorUserId).toBe("u1");
        expect(audit.ofSessions(new Set(["s1", "s2"])).length).toBe(3);
        expect(audit.lastOf("s1")!.editKind).toBe("revoke");
        expect(audit.all().length).toBe(3);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// The editor (J008 domain rules)
// ---------------------------------------------------------------------------

interface EditorFixture {
  policies: InMemoryEffectivePolicyStore;
  audit: InMemoryRightsAuditStore;
  editor: RightsEditor;
  clock: { now: number };
}

function makeEditorFixture(options?: {
  sessions?: (sessionId: string) => { exists: boolean } | null;
}): EditorFixture {
  const policies = new InMemoryEffectivePolicyStore();
  const audit = new InMemoryRightsAuditStore();
  const clock = { now: NOW_MS };
  const editor = createRightsEditor({
    policies,
    audit,
    nowMs: () => clock.now,
    ...(options?.sessions !== undefined ? { sessions: options.sessions } : {}),
  });
  return { policies, audit, editor, clock };
}

describe("the rights editor (J008 grant/widen/narrow/revoke + re-derivation + audit)", () => {
  test("GRANT: the creation record is re-attested with the VERIFIED creator id + audited", () => {
    const fixture = makeEditorFixture();
    const result = fixture.editor.recordCreation(
      "sess-1",
      { userId: "creator-verified" },
      fullPolicy("pol-1", "SOMEONE-ELSE"),
    );
    // The re-attestation rule (W902): a caller never asserts their own assertedBy.
    expect(result.policy.assertedBy).toBe("creator-verified");
    expect(result.capabilities.canStoreDerivatives).toBe(true);
    expect(result.audit.editKind).toBe("grant");
    const entries = fixture.audit.of("sess-1");
    expect(entries.length).toBe(1);
    expect(entries[0]!.actorUserId).toBe("creator-verified");
    expect(entries[0]!.editKind).toBe("grant");
    expect(entries[0]!.from).toBeNull();
    expect(entries[0]!.to).toEqual(result.policy);
  });

  test("NARROW: the edit applies, capabilities RE-DERIVE from the edited rights, the audit classifies", () => {
    const fixture = makeEditorFixture();
    fixture.editor.recordCreation(
      "sess-1",
      { userId: "creator-1" },
      fullPolicy("pol-1", "creator-1"),
    );
    const result = fixture.editor.editPolicy(
      "sess-1",
      { userId: "holder-1" },
      analysisOnlyPolicy("pol-2", "WHATEVER"),
    );
    expect(result.policy.assertedBy).toBe("holder-1");
    // The capabilities re-derived from the EDITED rights (the REAL derivation).
    expect(result.capabilities.canStoreDerivatives).toBe(false); // no derivativeGeneration+storage
    expect(result.capabilities.canReferenceSourceFrames).toBe(false); // no transformation
    expect(result.audit.editKind).toBe("narrow");
    expect(fixture.audit.of("sess-1").length).toBe(2);
    expect(fixture.audit.lastOf("sess-1")!.editKind).toBe("narrow");
  });

  test("WIDEN: the edit is stored + audited as a widen but the CEILING clamps the capabilities (narrow-only)", () => {
    const fixture = makeEditorFixture();
    fixture.editor.recordCreation(
      "sess-1",
      { userId: "creator-1" },
      analysisOnlyPolicy("pol-1", "creator-1"),
    );
    // The rights holder tries to widen past the creation attestation.
    const result = fixture.editor.editPolicy(
      "sess-1",
      { userId: "holder-1" },
      fullPolicy("pol-wide", "holder-1"),
    );
    expect(result.audit.editKind).toBe("widen");
    expect(result.capabilities.canStoreDerivatives).toBe(true); // the EDIT's own derivation…
    // …but the EFFECTIVE capabilities (the ceiling — the W917 intersectCaps
    // rule mirrored) stay clamped at the creation attestation:
    const effective = effectiveCapabilitiesOf(fixture.policies, "sess-1", new Date(NOW_MS));
    expect(effective.canStoreDerivatives).toBe(false);
    expect(effective.canReferenceSourceFrames).toBe(false);
    expect(effective.canShare).toBe(false);
  });

  test("REVOKE: the time-bound policy derives DENY_ALL, the audit records the revocation", () => {
    const fixture = makeEditorFixture();
    fixture.editor.recordCreation(
      "sess-1",
      { userId: "creator-1" },
      fullPolicy("pol-1", "creator-1"),
    );
    const result = fixture.editor.revoke("sess-1", { userId: "holder-1" }, "license withdrawn");
    // The contract's own time bound: the effective policy expires just before now.
    expect(result.policy.expiresAtIso).toBe(new Date(NOW_MS - 1).toISOString());
    expect(result.capabilities).toEqual({
      canReferenceSourceFrames: false,
      canDeliverLive: false,
      canStoreDerivatives: false,
      canShare: false,
    });
    expect(result.audit.editKind).toBe("revoke");
    expect(fixture.audit.lastOf("sess-1")!.changeKind).toBe("revocation");
    // The inspect seam answers revoked with the fail-closed derivation.
    const state = fixture.editor.inspect("sess-1");
    expect(state.revoked).toBe(true);
    expect(state.capabilities.canStoreDerivatives).toBe(false);
    expect(state.lastChange!.editKind).toBe("revoke");
  });

  test("expiry sanity: an already-expired EDIT refuses (revoke is the one exception)", () => {
    const fixture = makeEditorFixture();
    fixture.editor.recordCreation(
      "sess-1",
      { userId: "creator-1" },
      fullPolicy("pol-1", "creator-1"),
    );
    const expired = {
      ...fullPolicy("pol-exp", "holder-1"),
      expiresAtIso: new Date(NOW_MS - 1000).toISOString(),
    };
    expect(() => fixture.editor.editPolicy("sess-1", { userId: "holder-1" }, expired)).toThrow(
      RightsEditorValidationError,
    );
    // The failed edit never landed (no override, no audit entry).
    expect(fixture.policies.hasOverride("sess-1")).toBe(false);
    expect(fixture.audit.of("sess-1").length).toBe(1);
  });

  test("fail-loud: edits/revokes on unknown sessions never fabricate records", () => {
    const fixture = makeEditorFixture({
      sessions: (sessionId) => (sessionId === "sess-real" ? { exists: true } : { exists: false }),
    });
    expect(() =>
      fixture.editor.editPolicy("sess-ghost", { userId: "holder-1" }, fullPolicy("p", "holder-1")),
    ).toThrow(RightsEditorValidationError);
    expect(() => fixture.editor.revoke("sess-ghost", { userId: "holder-1" })).toThrow(
      RightsEditorValidationError,
    );
    expect(fixture.audit.all().length).toBe(0);
  });

  test("fail-loud: editing a session with no rights record at all refuses", () => {
    const fixture = makeEditorFixture(); // no session lookup, no records
    expect(() =>
      fixture.editor.editPolicy("sess-void", { userId: "holder-1" }, fullPolicy("p", "holder-1")),
    ).toThrow(RightsEditorValidationError);
    expect(() => fixture.editor.revoke("sess-void", { userId: "holder-1" })).toThrow(
      RightsEditorValidationError,
    );
  });

  test("inspect answers honest unknowns for unrecorded sessions", () => {
    const fixture = makeEditorFixture();
    const state = fixture.editor.inspect("sess-unrecorded");
    expect(state.effectivePolicy).toBeNull();
    expect(state.isEdit).toBe(false);
    expect(state.revoked).toBe(false);
    expect(state.capabilities.canStoreDerivatives).toBe(false); // fail-closed derivation
    expect(state.lastChange).toBeNull();
  });

  test("re-derivation is TIME-BOUND: an edit that expires later denies later with no new write", () => {
    const fixture = makeEditorFixture();
    fixture.editor.recordCreation(
      "sess-1",
      { userId: "creator-1" },
      fullPolicy("pol-1", "creator-1"),
    );
    fixture.editor.editPolicy(
      "sess-1",
      { userId: "holder-1" },
      {
        ...fullPolicy("pol-2", "holder-1"),
        expiresAtIso: new Date(NOW_MS + 10_000).toISOString(),
      },
    );
    // Before expiry: the derivation allows.
    expect(fixture.editor.inspect("sess-1", NOW_MS).capabilities.canStoreDerivatives).toBe(true);
    // After expiry: the SAME record derives DENY_ALL (fail-closed, no new write).
    expect(fixture.editor.inspect("sess-1", NOW_MS + 20_000).capabilities.canStoreDerivatives).toBe(
      false,
    );
    expect(fixture.editor.inspect("sess-1", NOW_MS + 20_000).revoked).toBe(true);
    expect(fixture.audit.of("sess-1").length).toBe(2); // no extra audit entry for the time passing
  });
});

// ---------------------------------------------------------------------------
// The J009 audit discoverability query seam (the role matrix)
// ---------------------------------------------------------------------------

describe("the rights-audit discoverability query seam (J009)", () => {
  interface QueryFixture {
    audit: InMemoryRightsAuditStore;
    ownership: Map<string, string>;
    query: ReturnType<typeof createRightsAuditQueryService>;
  }

  function makeQueryFixture(): QueryFixture {
    const audit = new InMemoryRightsAuditStore();
    const ownership = new Map<string, string>([
      ["sess-owned", "holder-1"],
      ["sess-other", "someone-else"],
    ]);
    audit.append({
      atIso: "2026-01-01T00:00:00Z",
      actorUserId: "u1",
      sessionId: "sess-owned",
      changeKind: "policy",
      editKind: "grant",
      summary: "granted",
      from: null,
      to: null,
    });
    audit.append({
      atIso: "2026-01-02T00:00:00Z",
      actorUserId: "u2",
      sessionId: "sess-other",
      changeKind: "policy",
      editKind: "narrow",
      summary: "narrowed",
      from: null,
      to: null,
    });
    const query = createRightsAuditQueryService({
      audit,
      ownerIdOf: (sessionId) => ownership.get(sessionId) ?? null,
      sessionIdsOfOwner: (ownerId) =>
        [...ownership.entries()]
          .filter(([, owner]) => owner === ownerId)
          .map(([sessionId]) => sessionId),
    });
    return { audit, ownership, query };
  }

  test("the RIGHTS HOLDER reaches their OWN session's trail (the workspace scope)", () => {
    const fixture = makeQueryFixture();
    const result = fixture.query.auditTrailFor(
      { userId: "holder-1", roles: ["rights-holder"] },
      "sess-owned",
    );
    expect(result.kind).toBe("allowed");
    if (result.kind === "allowed") {
      expect(result.scope).toBe("own");
      expect(result.entries.length).toBe(1);
      expect(result.entries[0]!.sessionId).toBe("sess-owned");
    }
  });

  test("the OPERATOR reaches EVERY trail (the operational view)", () => {
    const fixture = makeQueryFixture();
    const result = fixture.query.auditTrailFor(
      { userId: "op-1", roles: ["operator"] },
      "sess-owned",
    );
    expect(result.kind).toBe("allowed");
    if (result.kind === "allowed") {
      expect(result.scope).toBe("operator");
    }
    const other = fixture.query.auditTrailFor(
      { userId: "op-1", roles: ["operator"] },
      "sess-other",
    );
    expect(other.kind).toBe("allowed");
  });

  test("a rights holder CANNOT reach another owner's trail (the honest 403, uniform — no existence oracle)", () => {
    const fixture = makeQueryFixture();
    const result = fixture.query.auditTrailFor(
      { userId: "holder-1", roles: ["rights-holder"] },
      "sess-other",
    );
    expect(result).toEqual({ kind: "denied", reason: "not-resource-owner", httpStatus: 403 });
    // A session with NO ownership record denies the same way (uniform —
    // whether or not the session exists is not revealed).
    const unknown = fixture.query.auditTrailFor(
      { userId: "holder-1", roles: ["rights-holder"] },
      "sess-may-or-may-not-exist",
    );
    expect(unknown).toEqual({ kind: "denied", reason: "unknown-resource", httpStatus: 403 });
  });

  test("every OTHER role denies 403 (analyst/creator/viewer have no audit workspace)", () => {
    const fixture = makeQueryFixture();
    for (const role of ["analyst", "creator", "viewer"] as const) {
      const result = fixture.query.auditTrailFor(
        { userId: "someone", roles: [role] },
        "sess-owned",
      );
      expect(result).toEqual({ kind: "denied", reason: "not-resource-owner", httpStatus: 403 });
    }
  });

  test("unauthenticated callers deny 401 (the honest HTTP boundary)", () => {
    const fixture = makeQueryFixture();
    expect(fixture.query.auditTrailFor(null, "sess-owned")).toEqual({
      kind: "denied",
      reason: "unauthenticated",
      httpStatus: 401,
    });
    expect(fixture.query.auditTrailInScope(null)).toEqual({
      kind: "denied",
      reason: "unauthenticated",
      httpStatus: 401,
    });
  });

  test("the in-scope listing: operator sees ALL, rights-holder sees OWN, other roles deny 403", () => {
    const fixture = makeQueryFixture();
    const operator = fixture.query.auditTrailInScope({ userId: "op-1", roles: ["operator"] });
    expect(operator.kind).toBe("allowed");
    if (operator.kind === "allowed") {
      expect(operator.entries.length).toBe(2);
      expect(operator.scope).toBe("operator");
    }
    const holder = fixture.query.auditTrailInScope({
      userId: "holder-1",
      roles: ["rights-holder"],
    });
    expect(holder.kind).toBe("allowed");
    if (holder.kind === "allowed") {
      expect(holder.entries.length).toBe(1); // only their own session
      expect(holder.scope).toBe("own");
    }
    const analyst = fixture.query.auditTrailInScope({ userId: "an-1", roles: ["analyst"] });
    expect(analyst).toEqual({ kind: "denied", reason: "role-not-granted", httpStatus: 403 });
  });
});

// ---------------------------------------------------------------------------
// The sqlite durability (restart survival — the W917 honest limitation CLOSED)
// ---------------------------------------------------------------------------

describe("the sqlite rights store durability (the restart-survival seam)", () => {
  let workDir: string;
  let dbPath: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "sporta-rights-"));
    dbPath = join(workDir, "rights.sqlite");
  });
  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("overrides + the audit trail SURVIVE a store restart (the in-memory limitation closed)", () => {
    // Session one: create, edit, revoke — all persisted.
    const first = new SqliteRightsStore(dbPath);
    const editor = createRightsEditor({ policies: first, audit: first, nowMs: () => NOW_MS });
    editor.recordCreation(
      "sess-durable",
      { userId: "creator-1" },
      fullPolicy("pol-1", "creator-1"),
    );
    editor.editPolicy(
      "sess-durable",
      { userId: "holder-1" },
      analysisOnlyPolicy("pol-2", "holder-1"),
    );
    editor.revoke("sess-durable", { userId: "holder-1" });
    first.close();

    // A "restart": a fresh store over the same file.
    const second = new SqliteRightsStore(dbPath);
    expect(second.overrideOf("sess-durable")?.policyId).toBe("pol-2");
    expect(second.effectiveOf("sess-durable")?.expiresAtIso).toBe(
      new Date(NOW_MS - 1).toISOString(),
    );
    // The audit trail survived: 3 entries, oldest first — the newest (the
    // revoke) is the LAST.
    const trail = second.of("sess-durable");
    expect(trail.length).toBe(3);
    expect(trail[2]!.editKind).toBe("revoke");
    // A fresh editor over the restarted store inspects the SAME state.
    const restarted = createRightsEditor({ policies: second, audit: second, nowMs: () => NOW_MS });
    const state = restarted.inspect("sess-durable");
    expect(state.revoked).toBe(true);
    expect(state.capabilities.canStoreDerivatives).toBe(false);
    second.close();
  });
});
