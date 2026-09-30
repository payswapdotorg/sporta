/**
 * External-platform public-surface tests: every runtime export the behavior
 * tests reach only indirectly — the vocabulary constants, the typed error
 * family, the clock/id constitution, the hash primitives, the HTTP status
 * mapping and the neutral error projection — pinned so nothing ships
 * untested.
 */
import { describe, expect, test } from "bun:test";
import { RegistryNotFoundError } from "@sporta/organization-registry";
import type { PlatformFailureClass } from "../src";
import {
  EXTERNAL_SERVICE_VERSION,
  EXTERNAL_SERVICES,
  MCP_TOOLS,
  PLATFORM_DEFAULT_EPOCH_MS,
  PlatformApiError,
  PlatformConflictError,
  PlatformInternalError,
  PlatformJobStateError,
  PlatformNotFoundError,
  PlatformOrganizationPolicyError,
  PlatformValidationError,
  canonicalJson,
  createDefaultConnectionIdSource,
  createPlatformDefaultClock,
  createSequentialIdSource,
  httpStatusForFailureClass,
  isPlatformError,
  sha256Hex,
  toIsoUtc,
  toTypedErrorRecord,
} from "../src";

describe("the versioned service vocabulary", () => {
  test("the ten services are pinned and every result carries the version", () => {
    expect(EXTERNAL_SERVICE_VERSION).toBe(1);
    expect(EXTERNAL_SERVICES).toEqual([
      "searchOrganizations",
      "inspectOrganization",
      "launchLabRun",
      "submitMedia",
      "submitFeed",
      "getJob",
      "cancelJob",
      "getOutput",
      "getEvidence",
      "promoteOrganization",
    ]);
    expect(new Set(EXTERNAL_SERVICES).size).toBe(10);
  });
});

describe("the typed error family", () => {
  test("every constructor carries its stable code and failure class", () => {
    const cases: Array<[PlatformApiError, string, PlatformFailureClass]> = [
      [new PlatformValidationError("v", ["issue"]), "platform.validation", "validation"],
      [new PlatformNotFoundError("n"), "platform.not-found", "not-found"],
      [new PlatformConflictError("c"), "platform.conflict", "conflict"],
      [new PlatformJobStateError("j"), "platform.job-state", "job-state"],
      [new PlatformOrganizationPolicyError("p"), "platform.organization-not-selectable", "policy"],
      [new PlatformInternalError("z"), "platform.internal", "internal"],
    ];
    for (const [error, code, failureClass] of cases) {
      expect(error.code).toBe(code);
      expect(error.failureClass).toBe(failureClass);
      expect(isPlatformError(error)).toBe(true);
      expect(error).toBeInstanceOf(PlatformApiError);
    }
    expect(isPlatformError(new Error("plain"))).toBe(false);
  });

  test("details ride along, JSON-safe", () => {
    const error = new PlatformJobStateError("no output", { jobId: "job-9" });
    expect(error.details).toEqual({ jobId: "job-9" });
    expect(JSON.parse(JSON.stringify(error.details))).toEqual({ jobId: "job-9" });
  });

  test("toTypedErrorRecord projects coded families verbatim and derives upstream codes", () => {
    const coded = toTypedErrorRecord(new PlatformJobStateError("nope", { jobId: "job-1" }));
    expect(coded).toEqual({
      failureClass: "job-state",
      code: "platform.job-state",
      message: "nope",
      details: { jobId: "job-1" },
    });
    // The registry family predates the code convention (failureClass only):
    // the derived code names the upstream constructor honestly.
    const upstream = toTypedErrorRecord(
      new RegistryNotFoundError("organization not found", { organizationId: "org-x" }),
    );
    expect(upstream.code).toBe("upstream.RegistryNotFoundError");
    expect(upstream.failureClass).toBe("not-found");
    expect(upstream.message).toBe("organization not found");
    expect(upstream.details).toEqual({ organizationId: "org-x" });
    // A completely unknown error fails closed to the internal record.
    const unknown = toTypedErrorRecord("garbage");
    expect(unknown).toEqual({
      failureClass: "internal",
      code: "platform.internal",
      message: "garbage",
      details: {},
    });
  });
});

describe("the HTTP status mapping", () => {
  test("every failure class maps to a useful status (fail-closed, never silent)", () => {
    expect(httpStatusForFailureClass("validation")).toBe(400);
    expect(httpStatusForFailureClass("not-found")).toBe(404);
    expect(httpStatusForFailureClass("unauthorized")).toBe(401);
    expect(httpStatusForFailureClass("rights")).toBe(401);
    expect(httpStatusForFailureClass("restriction")).toBe(403);
    expect(httpStatusForFailureClass("policy")).toBe(403);
    expect(httpStatusForFailureClass("conflict")).toBe(409);
    expect(httpStatusForFailureClass("job-state")).toBe(409);
    expect(httpStatusForFailureClass("illegal-transition")).toBe(409);
    expect(httpStatusForFailureClass("lease")).toBe(409);
    expect(httpStatusForFailureClass("store")).toBe(404);
    expect(httpStatusForFailureClass("internal")).toBe(500);
    expect(httpStatusForFailureClass("something-new")).toBe(500); // unknown fails closed
  });
});

describe("the clock/id constitution", () => {
  test("the deterministic default clock ticks from the shared epoch", () => {
    const clock = createPlatformDefaultClock();
    expect(PLATFORM_DEFAULT_EPOCH_MS).toBe(Date.parse("2025-01-06T12:00:00.000Z"));
    expect(clock()).toBe(PLATFORM_DEFAULT_EPOCH_MS + 1);
    expect(clock()).toBe(PLATFORM_DEFAULT_EPOCH_MS + 2);
  });

  test("the sequential id source is deterministic and namespaced", () => {
    const ids = createSequentialIdSource("art");
    expect(ids.nextId()).toBe("art-1");
    expect(ids.nextId()).toBe("art-2");
    expect(createDefaultConnectionIdSource().nextId()).toBe("conn-1");
  });

  test("toIsoUtc formats the epoch", () => {
    expect(toIsoUtc(PLATFORM_DEFAULT_EPOCH_MS)).toBe("2025-01-06T12:00:00.000Z");
  });
});

describe("the hash primitives", () => {
  test("sha256Hex is the standard digest; canonicalJson is deterministic", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("the MCP tool definitions", () => {
  test("every tool names its service 1:1 with a description and input shape", () => {
    for (const tool of MCP_TOOLS) {
      expect(EXTERNAL_SERVICES).toContain(tool.service);
      expect(tool.version).toBe(EXTERNAL_SERVICE_VERSION);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.input.length).toBeGreaterThan(0);
    }
  });
});
