/**
 * Agent Body contract validation tests (REL-004): EVERY required field of
 * the frozen contract is enforced — deleting any one of the fifteen
 * produces a typed `BodyContractError` naming it; malformed fields land in
 * `invalidFields`; the generalist body validates clean; the body's output
 * schema accepts the generalist policy's output.
 */
import { describe, expect, test } from "bun:test";
import {
  BodyContractError,
  FOOTBALL_HARD_INVALIDITY_RULES,
  LabBodyOutputSchema,
  REQUIRED_BODY_FIELDS,
  createGeneralistBody,
  footballDomainPack,
  generalistScriptedHandler,
  validateAgentBody,
  type AgentBodyDefinition,
} from "../src";
import { FOOTBALL_LAB_EVALUATOR_ID, FOOTBALL_LAB_EVALUATOR_VERSION } from "../src";

function validBody(): AgentBodyDefinition {
  return createGeneralistBody({
    domainPackId: footballDomainPack.domainPackId,
    evaluator: {
      evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
      version: FOOTBALL_LAB_EVALUATOR_VERSION,
    },
    hardRuleIds: FOOTBALL_HARD_INVALIDITY_RULES.map((rule) => rule.ruleId),
  });
}

describe("the fifteen frozen-contract fields are all required", () => {
  test("the frozen contract's field list has exactly the fifteen members", () => {
    // bodyId; version; role; domain compatibility; input schema; output
    // schema; tools/capabilities; permissions; memory interfaces;
    // communication interface; action interface; budget; latency limits;
    // evaluator hooks; safety/policy constraints.
    expect(REQUIRED_BODY_FIELDS).toHaveLength(15);
  });

  for (const field of REQUIRED_BODY_FIELDS) {
    test(`missing ${field} ⇒ BodyContractError naming it in missingFields`, () => {
      const broken = { ...validBody() } as Record<string, unknown>;
      delete broken[field];
      let caught: unknown;
      try {
        validateAgentBody(broken);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BodyContractError);
      const typed = caught as BodyContractError;
      expect(typed.missingFields).toContain(field);
      expect(typed.message).toContain("frozen contract");
    });
  }

  test("ALL missing fields are reported collectively (one throw, full list)", () => {
    let caught: unknown;
    try {
      validateAgentBody({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BodyContractError);
    const typed = caught as BodyContractError;
    expect([...typed.missingFields].sort()).toEqual([...REQUIRED_BODY_FIELDS].sort());
  });

  test("a non-object is refused with a typed error", () => {
    expect(() => validateAgentBody(42)).toThrow(BodyContractError);
    expect(() => validateAgentBody(null)).toThrow(BodyContractError);
  });
});

describe("malformed fields land in invalidFields", () => {
  test("a wrong-shape budget", () => {
    const broken = { ...validBody(), budget: { maxCallsPerRun: "many" } };
    let caught: unknown;
    try {
      validateAgentBody(broken);
    } catch (error) {
      caught = error;
    }
    expect((caught as BodyContractError).invalidFields).toContain("budget");
    expect((caught as BodyContractError).missingFields).toEqual([]);
  });

  test("an empty domain-compatibility list (a body must name a domain)", () => {
    const broken = {
      ...validBody(),
      domainCompatibility: { domainPackIds: [], notes: "nope" },
    };
    expect(() => validateAgentBody(broken)).toThrow(BodyContractError);
  });

  test("a non-schema inputSchema", () => {
    const broken = { ...validBody(), inputSchema: 42 };
    let caught: unknown;
    try {
      validateAgentBody(broken);
    } catch (error) {
      caught = error;
    }
    expect((caught as BodyContractError).invalidFields).toContain("inputSchema");
  });

  test("a non-schema outputSchema", () => {
    const broken = { ...validBody(), outputSchema: { not: "a schema" } };
    let caught: unknown;
    try {
      validateAgentBody(broken);
    } catch (error) {
      caught = error;
    }
    expect((caught as BodyContractError).invalidFields).toContain("outputSchema");
  });

  test("a zero-call budget is malformed (a body must be invocable)", () => {
    const broken = { ...validBody(), budget: { maxCallsPerRun: 0, maxCostUsdPerRun: 1 } };
    expect(() => validateAgentBody(broken)).toThrow(BodyContractError);
  });

  test("latency limits must be non-negative numbers", () => {
    const broken = { ...validBody(), latencyLimits: { softMs: -1, hardMs: 100 } };
    expect(() => validateAgentBody(broken)).toThrow(BodyContractError);
  });
});

describe("the generalist body is a clean, complete body", () => {
  test("validates and is returned as-is", () => {
    const body = validBody();
    expect(validateAgentBody(body)).toBe(body);
  });

  test("carries all fifteen fields with the contract's semantics", () => {
    const body = validBody();
    expect(body.bodyId).toBe("generalist-1");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.role.roleId).toBe("generalist");
    expect(body.domainCompatibility.domainPackIds).toContain("football");
    expect(body.tools.length).toBeGreaterThan(0);
    expect(body.permissions.length).toBeGreaterThan(0);
    expect(body.memoryInterfaces).toContainEqual({
      storeId: "org-shared",
      access: "read-write",
    });
    expect(body.communicationInterface.channels.length).toBeGreaterThan(0);
    expect(body.actionInterface.allowedActionIds).toHaveLength(4);
    expect(body.budget.maxCallsPerRun).toBeGreaterThan(0);
    expect(body.latencyLimits.hardMs).toBeGreaterThanOrEqual(body.latencyLimits.softMs);
    expect(body.evaluatorHooks[0]?.evaluatorId).toBe(FOOTBALL_LAB_EVALUATOR_ID);
    expect(body.safetyPolicy.hardRules).toHaveLength(FOOTBALL_HARD_INVALIDITY_RULES.length);
  });

  test("the output schema accepts the generalist policy's output", () => {
    const output = generalistScriptedHandler({
      runId: "run-1",
      tickIndex: 2,
      clockMs: 200,
      period: 1,
      observations: [
        {
          observationId: "obs-evt-ev-0-0",
          kindId: "event-record",
          tickIndex: 2,
          clockMs: 200,
          provenanceClass: "lab-simulation",
          confidence: 0.98,
          payload: {
            eventId: "ev-0-0",
            eventKindId: "kickoff",
            participants: ["home-5", "ball"],
            publishedAtTick: 2,
          },
        },
      ],
      sharedMemory: {},
    });
    expect(LabBodyOutputSchema.safeParse(output).success).toBe(true);
    expect(output.actions[0]?.actionId).toBe("emit-canonical-event");
  });
});
