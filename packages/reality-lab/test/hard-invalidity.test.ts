/**
 * The ADR-013 §8 hard invalidity rules (REL-001): every rule fires on a
 * CONSTRUCTED violation, clean claims pass, and the refusals are TYPED
 * RECORDS (evidence returned by the check functions — never exceptions).
 */
import { describe, expect, test } from "bun:test";
import { checkFootballClaims, type HardInvalidityContext, type LabClaim } from "../src";

const context: HardInvalidityContext = {
  runId: "run-1",
  knownEvidenceRefs: new Set(["obs-evt-ev-0-0", "obs-ts-0-home-1", "obs-bf-0"]),
  renderTargetIds: ["tactical", "anime-npr", "three-d-game", "original"],
  scenarioDurationMs: 600_000,
};

const provenance = "lab-simulation" as const;

describe("rule 1 — fabricated canonical event", () => {
  test("fires on an event with ZERO evidence references", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c1",
      eventKindId: "goal",
      clockMs: 1_000,
      evidenceRefs: [],
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("fabricated-canonical-event");
    expect(violations[0]?.claimId).toBe("c1");
    expect(violations[0]?.reason).toContain("ZERO evidence");
  });

  test("fires on an event citing evidence the run never provided", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c2",
      eventKindId: "pass",
      clockMs: 2_000,
      evidenceRefs: ["obs-evt-ev-0-0", "obs-bogus-never-received"],
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.evidence).toEqual({
      eventKindId: "pass",
      unknownEvidenceRefs: ["obs-bogus-never-received"],
    });
  });

  test("a claim citing only received evidence is clean", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c3",
      eventKindId: "kickoff",
      clockMs: 0,
      evidenceRefs: ["obs-evt-ev-0-0"],
      provenanceClass: provenance,
    };
    expect(checkFootballClaims([claim], context)).toEqual([]);
  });
});

describe("rule 2 — fabricated identity presented as fact", () => {
  test("fires when an INFERRED identity is presented as fact", () => {
    const claim: LabClaim = {
      claimKind: "identity-assertion",
      claimId: "c4",
      entityId: "home-7",
      presentedAs: "fact",
      basis: "inferred",
      evidenceRefs: ["obs-ts-0-home-1"],
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("fabricated-identity-as-fact");
    expect(violations[0]?.reason).toContain("INFERRED but presented as fact");
  });

  test("fires when a fact has no evidence at all", () => {
    const claim: LabClaim = {
      claimKind: "identity-assertion",
      claimId: "c5",
      entityId: "home-7",
      presentedAs: "fact",
      basis: "observed",
      evidenceRefs: [],
      provenanceClass: provenance,
    };
    expect(checkFootballClaims([claim], context)).toHaveLength(1);
  });

  test("an honest inference (presented as inference, observed basis) is clean", () => {
    const claim: LabClaim = {
      claimKind: "identity-assertion",
      claimId: "c6",
      entityId: "home-7",
      presentedAs: "inference",
      basis: "observed",
      evidenceRefs: ["obs-ts-0-home-1"],
      provenanceClass: provenance,
    };
    expect(checkFootballClaims([claim], context)).toEqual([]);
  });

  test("an observed fact WITH evidence is clean", () => {
    const claim: LabClaim = {
      claimKind: "identity-assertion",
      claimId: "c7",
      entityId: "home-7",
      presentedAs: "fact",
      basis: "observed",
      evidenceRefs: ["obs-ts-0-home-1"],
      provenanceClass: provenance,
    };
    expect(checkFootballClaims([claim], context)).toEqual([]);
  });
});

describe("rule 3 — violation of declared rights/policy", () => {
  test("fires on an output claim with NO rights basis", () => {
    const claim: LabClaim = {
      claimKind: "output-claim",
      claimId: "c8",
      renderTargetId: "tactical",
      rightsBasis: null,
      artifactLineage: ["run-1"],
      clockMs: 5_000,
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("rights-policy-violation");
    expect(violations[0]?.reason).toContain("NO rights basis");
  });

  test("a declared rights basis passes", () => {
    const claim: LabClaim = {
      claimKind: "output-claim",
      claimId: "c9",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["run-1"],
      clockMs: 5_000,
      provenanceClass: provenance,
    };
    expect(checkFootballClaims([claim], context)).toEqual([]);
  });
});

describe("rule 4 — impossible/unsupported output claim", () => {
  test("fires on an undeclared render target", () => {
    const claim: LabClaim = {
      claimKind: "output-claim",
      claimId: "c10",
      renderTargetId: "holo-deck",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["run-1"],
      clockMs: 5_000,
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("impossible-output-claim");
    expect(violations[0]?.reason).toContain("holo-deck");
  });

  test("fires on a claim at a clock time beyond the scenario duration", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c11",
      eventKindId: "goal",
      clockMs: context.scenarioDurationMs + 1,
      evidenceRefs: ["obs-evt-ev-0-0"],
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("impossible-output-claim");
    expect(violations[0]?.reason).toContain("outside scenario duration");
  });
});

describe("rule 5 — bypassed provenance", () => {
  test("fires when a lab-run claim presents itself as real-observation", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c12",
      eventKindId: "goal",
      clockMs: 1_000,
      evidenceRefs: ["obs-evt-ev-0-0"],
      provenanceClass: "real-observation",
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("provenance-bypass");
    expect(violations[0]?.reason).toContain("only 'lab-simulation' is legal inside a lab run");
  });

  test("fires on historical-replay laundering too", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c13",
      eventKindId: "goal",
      clockMs: 1_000,
      evidenceRefs: ["obs-evt-ev-0-0"],
      provenanceClass: "historical-replay",
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations.map((v) => v.ruleId)).toEqual(["provenance-bypass"]);
  });
});

describe("rule 6 — invalid artifact lineage", () => {
  test("fires on an empty lineage", () => {
    const claim: LabClaim = {
      claimKind: "output-claim",
      claimId: "c14",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      artifactLineage: [],
      clockMs: 5_000,
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("invalid-artifact-lineage");
    expect(violations[0]?.reason).toContain("EMPTY");
  });

  test("fires on a lineage not rooted at the run", () => {
    const claim: LabClaim = {
      claimKind: "output-claim",
      claimId: "c15",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["somebody-elses-run"],
      clockMs: 5_000,
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("does not root at run run-1");
  });
});

describe("the refusal shape (typed records, never throws)", () => {
  test("violations are JSON-safe typed records carrying rule, claim, reason, evidence", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c16",
      eventKindId: "goal",
      clockMs: 1_000,
      evidenceRefs: [],
      provenanceClass: provenance,
    };
    const [violation] = checkFootballClaims([claim], context);
    expect(violation).toBeDefined();
    expect(() => JSON.stringify(violation)).not.toThrow();
    expect(Object.keys(violation ?? {})).toEqual(["ruleId", "claimId", "reason", "evidence"]);
  });

  test("one claim can trip multiple rules (fabrication + impossible clock)", () => {
    const claim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "c17",
      eventKindId: "goal",
      clockMs: 999_999_999,
      evidenceRefs: ["never-provided"],
      provenanceClass: provenance,
    };
    const violations = checkFootballClaims([claim], context);
    expect(violations.map((v) => v.ruleId).sort()).toEqual([
      "fabricated-canonical-event",
      "impossible-output-claim",
    ]);
  });
});
