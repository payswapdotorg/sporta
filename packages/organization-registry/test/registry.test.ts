/**
 * REL-017 registry tests: versioned records, the eligibility query (only
 * selectable statuses), typed storage errors, and the append-only
 * hash-chained transition log — audit completeness, deep immutability, and
 * the tamper-evident chain.
 */
import { describe, expect, test } from "bun:test";
import {
  GENESIS_HASH,
  RegistryConflictError,
  RegistryNotFoundError,
  RegistryValidationError,
  SELECTABLE_STATUSES,
  canonicalJson,
  createDefaultEntryIdSource,
  createOrganizationRegistry,
  createRegistryDefaultClock,
  createSequentialIdSource,
  isRegistryError,
  isSelectableStatus,
  matchesQuery,
  requestPromotion,
  requestRollback,
  sha256Hex,
  systemActor,
  toIsoUtc,
} from "../src";
import type { OrganizationRecord } from "../src";
import {
  benchmarkStageEvidence,
  examplePolicy,
  newOrgInput,
  orgAtStatus,
  registerOrg,
  walkToStatus,
} from "./fixtures";

const policy = examplePolicy();
const SYSTEM = { actorType: "system", actorId: "test-harness" } as const;

describe("registration", () => {
  test("creates draft v1 with a genesis log entry", async () => {
    const { registry, record } = await registerOrg();
    expect(record.version).toBe(1);
    expect(record.status).toBe("draft");
    expect(record.createdAt).toBe("2025-01-06T12:00:00.001Z"); // deterministic clock
    const log = await registry.transitionLog("org-alpha");
    expect(log.length).toBe(1);
    const genesis = log[0];
    expect(genesis?.operation).toBe("registration");
    expect(genesis?.fromVersion).toBe(0);
    expect(genesis?.toVersion).toBe(1);
    expect(genesis?.fromStatus).toBeNull();
    expect(genesis?.toStatus).toBe("draft");
    expect(genesis?.previousEntryHash).toBe(GENESIS_HASH);
    expect(genesis?.detail).toContain("lab run run-1");
    expect(genesis?.entryId).toBe("entry-1");
  });

  test("a duplicate organizationId is a typed conflict", async () => {
    const { registry } = await registerOrg();
    let thrown: unknown;
    try {
      await registry.register(newOrgInput(), { ...SYSTEM });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RegistryConflictError);
    expect((thrown as { details?: { organizationId?: string } }).details?.organizationId).toBe(
      "org-alpha",
    );
  });

  test("malformed input is a typed validation error with issues", async () => {
    const registry = createOrganizationRegistry();
    let thrown: unknown;
    try {
      await registry.register({ ...newOrgInput(), organizationId: "Not_Kebab" }, { ...SYSTEM });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RegistryValidationError);
    const details =
      (thrown as { details?: { issues?: Array<{ path: string; message: string }> } }).details
        ?.issues ?? [];
    expect(details.some((issue) => issue.path === "organizationId")).toBe(true);
  });

  test("latency percentiles out of order are rejected at the boundary", async () => {
    const registry = createOrganizationRegistry();
    const bad = newOrgInput();
    bad.profile.latency = { p50Ms: 2000, p95Ms: 1500, p99Ms: 2200 };
    await expect(registry.register(bad, { ...SYSTEM })).rejects.toBeInstanceOf(
      RegistryValidationError,
    );
  });
});

describe("versioned records", () => {
  test("recordEvidence bumps the version and keeps the status", async () => {
    const { registry } = await registerOrg();
    const v2 = await registry.recordEvidence(
      "org-alpha",
      benchmarkStageEvidence(),
      { ...SYSTEM },
      "benchmark stage submitted",
    );
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    expect(v2.evidence.benchmark?.corpusVersion).toBe("corpus-v1");
    const v1 = await registry.getVersion("org-alpha", 1);
    expect(v1.evidence.benchmark).toBeUndefined(); // v1 immutable, unchanged
    expect((await registry.get("org-alpha")).version).toBe(2);
    expect((await registry.listVersions("org-alpha")).length).toBe(2);
  });

  test("unknown organization / unknown version are typed not-found", async () => {
    const { registry } = await registerOrg();
    await expect(registry.get("nope")).rejects.toBeInstanceOf(RegistryNotFoundError);
    await expect(registry.getVersion("org-alpha", 99)).rejects.toBeInstanceOf(
      RegistryNotFoundError,
    );
    await expect(registry.listVersions("nope")).rejects.toBeInstanceOf(RegistryNotFoundError);
  });

  test("records are handed out deeply frozen", async () => {
    const { registry } = await orgAtStatus("validated");
    const record = await registry.get("org-alpha");
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.evidence.benchmark?.metrics)).toBe(true);
    expect(Object.isFrozen(record.domain.domains)).toBe(true);
    expect(() => {
      (record as { status: string }).status = "production";
    }).toThrow();
  });

  test("list returns latest versions in registration order", async () => {
    const { registry } = await registerOrg();
    await registry.register({ ...newOrgInput(), organizationId: "org-beta" }, { ...SYSTEM });
    const latest = await registry.list();
    expect(latest.map((r) => r.organizationId)).toEqual(["org-alpha", "org-beta"]);
  });
});

describe("the eligibility query (REL-017)", () => {
  test("returns ONLY validated/canary/production organizations", async () => {
    const registry = createOrganizationRegistry();
    await registry.register({ ...newOrgInput(), organizationId: "org-draft" }, { ...SYSTEM });
    await registry.register({ ...newOrgInput(), organizationId: "org-bench" }, { ...SYSTEM });
    await registry.register({ ...newOrgInput(), organizationId: "org-valid" }, { ...SYSTEM });
    await registry.register({ ...newOrgInput(), organizationId: "org-prod" }, { ...SYSTEM });
    await walkToStatus(registry, "org-bench", "benchmarked");
    await walkToStatus(registry, "org-valid", "validated");
    await walkToStatus(registry, "org-prod", "production");

    const eligible = await registry.queryEligible({});
    expect(eligible.map((r) => r.organizationId)).toEqual(["org-valid", "org-prod"]);
    // draft and benchmarked are excluded; validated/canary/production are in.
    expect(eligible.every((r) => isSelectableStatus(r.status))).toBe(true);
    expect(await registry.list()).toHaveLength(4); // all four exist
  });

  test("SELECTABLE_STATUSES is exactly validated/canary/production", () => {
    expect(SELECTABLE_STATUSES).toEqual(["validated", "canary", "production"]);
    expect(isSelectableStatus("validated")).toBe(true);
    expect(isSelectableStatus("canary")).toBe(true);
    expect(isSelectableStatus("production")).toBe(true);
    expect(isSelectableStatus("draft")).toBe(false);
    expect(isSelectableStatus("benchmarked")).toBe(false);
    expect(isSelectableStatus("retired")).toBe(false);
  });

  test("filters by domain / task / mode / renderer / latency / budget / capability", async () => {
    const { registry } = await orgAtStatus("production");
    const record = (await registry.get("org-alpha")) as OrganizationRecord;

    expect(matchesQuery(record, { domain: "football" })).toBe(true);
    expect(matchesQuery(record, { domain: "basketball" })).toBe(false);
    expect(matchesQuery(record, { task: "match" })).toBe(true);
    expect(matchesQuery(record, { task: "documentary" })).toBe(false);
    expect(matchesQuery(record, { mode: "live" })).toBe(true);
    expect(matchesQuery(record, { renderer: "anime" })).toBe(true);
    expect(matchesQuery(record, { renderer: "3d-game" })).toBe(false);
    expect(matchesQuery(record, { maxP95LatencyMs: 1500 })).toBe(true);
    expect(matchesQuery(record, { maxP95LatencyMs: 1499.99 })).toBe(false);
    expect(matchesQuery(record, { maxBudgetPerRunUsd: 1.2 })).toBe(true);
    expect(matchesQuery(record, { maxBudgetPerRunUsd: 1.19 })).toBe(false);
    expect(matchesQuery(record, { requiredCapabilities: ["perception.fusion"] })).toBe(true);
    expect(
      matchesQuery(record, { requiredCapabilities: ["perception.fusion", "render.anime"] }),
    ).toBe(true);
    expect(matchesQuery(record, { requiredCapabilities: ["commentary.wit"] })).toBe(false);

    const viaQuery = await registry.queryEligible({
      domain: "football",
      task: "match",
      maxP95LatencyMs: 1600,
    });
    expect(viaQuery.map((r) => r.organizationId)).toEqual(["org-alpha"]);
    const tooSlow = await registry.queryEligible({ maxP95LatencyMs: 100 });
    expect(tooSlow).toEqual([]);
  });

  test("a retired organization is excluded from eligibility", async () => {
    const { registry } = await orgAtStatus("canary");
    await requestRollback(registry, {
      organizationId: "org-alpha",
      trigger: "hard-slo-failure",
      policy,
    });
    expect(await registry.queryEligible({})).toEqual([]);
  });

  test("an invalid query is a typed validation error", async () => {
    const { registry } = await registerOrg();
    await expect(registry.queryEligible({ maxP95LatencyMs: -1 })).rejects.toBeInstanceOf(
      RegistryValidationError,
    );
  });
});

describe("the append-only transition log (audit)", () => {
  test("every operation appends; nothing is ever removed or reordered", async () => {
    const { registry } = await registerOrg();
    const lengths: number[] = [];
    lengths.push((await registry.transitionLog()).length); // 1 (registration)
    await requestPromotion(registry, { organizationId: "org-alpha", policy }); // no evidence -> REFUSED
    lengths.push((await registry.transitionLog()).length); // 2 (refusal appended)
    await registry.recordEvidence("org-alpha", benchmarkStageEvidence(), { ...SYSTEM });
    lengths.push((await registry.transitionLog()).length); // 3 (evidence update)
    await requestPromotion(registry, { organizationId: "org-alpha", policy }); // granted now
    lengths.push((await registry.transitionLog()).length); // 4 (promotion)
    expect(lengths).toEqual([1, 2, 3, 4]);
    const log = await registry.transitionLog();
    expect(log.map((entry) => entry.entryId)).toEqual(["entry-1", "entry-2", "entry-3", "entry-4"]);
    // The refused attempt is in the log with no version bump.
    const refusal = log[1];
    expect(refusal?.refusalReason).toBe("gate-failure");
    expect(refusal?.fromVersion).toBe(refusal?.toVersion);
    expect(refusal?.fromStatus).toBe(refusal?.toStatus);
    // And the granted promotion bumped the version.
    const promotion = log[3];
    expect(promotion?.operation).toBe("promotion");
    expect(promotion?.toVersion).toBe(3);
  });

  test("entries carry actor, gate results, from -> to, and timestamp", async () => {
    const { registry } = await orgAtStatus("benchmarked");
    const log = await registry.transitionLog("org-alpha");
    const promotion = log.find((entry) => entry.operation === "promotion");
    expect(promotion?.actor).toEqual({
      actorType: "system",
      actorId: "promotion-policy:rel-promotion:v1",
    });
    expect(promotion?.gateResults.length).toBe(2); // reproducibility + benchmark
    expect(promotion?.fromStatus).toBe("draft");
    expect(promotion?.toStatus).toBe("benchmarked");
    expect(promotion?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("the per-organization slice matches the whole log's filter", async () => {
    const registry = createOrganizationRegistry();
    await registry.register(newOrgInput(), { ...SYSTEM });
    await registry.register({ ...newOrgInput(), organizationId: "org-beta" }, { ...SYSTEM });
    await registry.recordEvidence("org-alpha", benchmarkStageEvidence(), { ...SYSTEM });
    const whole = await registry.transitionLog();
    const alpha = await registry.transitionLog("org-alpha");
    const beta = await registry.transitionLog("org-beta");
    expect(whole.length).toBe(3);
    expect(alpha.length).toBe(2);
    expect(beta.length).toBe(1);
    expect(whole.filter((e) => e.organizationId === "org-alpha")).toEqual([...alpha]);
  });

  test("entries are deeply frozen (history cannot be edited in place)", async () => {
    const { registry } = await orgAtStatus("benchmarked");
    const log = await registry.transitionLog("org-alpha");
    const entry = log[0];
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry?.gateResults)).toBe(true);
    expect(() => {
      (entry as { detail: string }).detail = "rewritten history";
    }).toThrow();
  });

  test("the hash chain verifies across many operations", async () => {
    const { registry } = await orgAtStatus("production");
    expect(await registry.verifyTransitionLog()).toBe(true);
  });

  test("the hash chain covers the full entry (the formula, pinned)", async () => {
    const { registry } = await orgAtStatus("benchmarked");
    const log = await registry.transitionLog("org-alpha");
    let previous = GENESIS_HASH;
    for (const entry of log) {
      expect(entry.previousEntryHash).toBe(previous);
      const { entryHash, ...rest } = entry;
      const recomputed = await sha256Hex(
        canonicalJson({ ...rest, previousEntryHash: entry.previousEntryHash }),
      );
      expect(entryHash).toBe(recomputed);
      previous = entryHash;
    }
  });

  test("an empty log trivially verifies", async () => {
    const registry = createOrganizationRegistry();
    expect(await registry.verifyTransitionLog()).toBe(true);
    expect(await registry.transitionLog()).toEqual([]);
  });
});

describe("injected clock + id source (the constitution)", () => {
  test("the default clock is deterministic: epoch + tick", async () => {
    const clock = createRegistryDefaultClock();
    expect(clock()).toBe(1_736_164_800_001);
    expect(clock()).toBe(1_736_164_800_002);
    expect(toIsoUtc(clock())).toBe("2025-01-06T12:00:00.003Z");
  });

  test("a custom entry-id source is used for log entries", async () => {
    const registry = createOrganizationRegistry({
      entryIds: createSequentialIdSource("audit"),
    });
    await registry.register(newOrgInput(), { ...SYSTEM });
    const log = await registry.transitionLog();
    expect(log[0]?.entryId).toBe("audit-1");
  });

  test("createDefaultEntryIdSource produces entry-N ids", () => {
    const ids = createDefaultEntryIdSource();
    expect(ids.nextId()).toBe("entry-1");
    expect(ids.nextId()).toBe("entry-2");
  });

  test("systemActor names the policy and version", () => {
    expect(systemActor("rel-promotion", 3)).toEqual({
      actorType: "system",
      actorId: "promotion-policy:rel-promotion:v3",
    });
  });
});

describe("the typed error family", () => {
  test("isRegistryError recognizes the family and rejects outsiders", async () => {
    const { registry } = await registerOrg();
    let thrown: unknown;
    try {
      await registry.get("nope");
    } catch (error) {
      thrown = error;
    }
    expect(isRegistryError(thrown)).toBe(true);
    expect(isRegistryError(new Error("plain"))).toBe(false);
    expect(isRegistryError(null)).toBe(false);
    expect(isRegistryError("nope")).toBe(false);
  });
});

describe("canonical JSON + hashing helpers", () => {
  test("canonicalJson sorts keys recursively and strips undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } })).toBe(
      '{"a":{"c":[3,{"z":1}],"d":2},"b":1}',
    );
  });

  test("sha256Hex is the standard digest (pinned against a known vector)", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
