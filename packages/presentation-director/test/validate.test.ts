/**
 * The fail-closed policy validation tests: every documented rule of
 * `validatePresentationPolicy` has a refusing fixture AND an admitting
 * fixture (unknown keys ignored, the camera layer delegated, the
 * cross-layer rule enforced).
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_DIRECTOR_POLICY, validatePolicy } from "@sporta/camera-director";
import {
  DEFAULT_PRESENTATION_POLICY,
  validatePresentationPolicy,
  type PresentationPolicy,
} from "../src/index";

/** A minimal valid policy body (mutated per test). */
function validBody(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_PRESENTATION_POLICY)) as Record<string, unknown>;
}

describe("the happy path", () => {
  test("the default policy validates", () => {
    const result = validatePresentationPolicy(DEFAULT_PRESENTATION_POLICY);
    expect(result.ok).toBe(true);
  });

  test("a policy with an EMPTY importance table admits when the camera layer rules nothing", () => {
    const body = validBody();
    body.camera = { ...DEFAULT_DIRECTOR_POLICY, eventRules: [] };
    body.eventImportance = [];
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(true);
  });

  test("unknown top-level keys are ignored (forward-compatible documents)", () => {
    const body = validBody();
    body.futureExtension = { anything: true };
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(true);
  });

  test("the admitted value is a normalized clone (fresh objects, never the input)", () => {
    const body = validBody();
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBe(body);
      expect(result.value.eventImportance).not.toBe(body.eventImportance);
    }
  });
});

describe("top-level refusals", () => {
  test("a non-object is refused", () => {
    expect(validatePresentationPolicy(null).ok).toBe(false);
    expect(validatePresentationPolicy("policy").ok).toBe(false);
    expect(validatePresentationPolicy([]).ok).toBe(false);
  });

  test("empty policyId / policyVersion are refused with paths", () => {
    const body = validBody();
    delete body.policyId;
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.startsWith("policy.policyId:"))).toBe(true);
    }
  });
});

describe("the camera layer is delegated to the wrapped seam (never re-implemented)", () => {
  test("an invalid camera policy is refused with the W604 issues", () => {
    const body = validBody();
    body.camera = { ...DEFAULT_DIRECTOR_POLICY, possessionFollow: "not-an-object" };
    const wrapped = validatePolicy(body.camera);
    expect(wrapped.ok).toBe(false);
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok && !wrapped.ok) {
      for (const issue of wrapped.issues) {
        expect(result.issues).toContain(`policy.camera: ${issue}`);
      }
    }
  });

  test("a camera-ruled type WITHOUT an importance row is refused (the cross-layer rule)", () => {
    const body = validBody();
    body.eventImportance = (body.eventImportance as Array<Record<string, unknown>>).filter(
      (row) => row.eventType !== "goal",
    );
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) =>
          issue.includes('rules event type "goal" but the importance table has no row'),
        ),
      ).toBe(true);
    }
  });

  test("an UN-ruled type without a row is admitted (only ruled types must be weighted)", () => {
    const body = validBody();
    body.eventImportance = (body.eventImportance as Array<Record<string, unknown>>).filter(
      (row) => row.eventType !== "pass",
    );
    expect(validatePresentationPolicy(body).ok).toBe(true);
  });
});

describe("event-importance table rules", () => {
  test("a non-array table is refused", () => {
    const body = validBody();
    body.eventImportance = "rows";
    expect(validatePresentationPolicy(body).ok).toBe(false);
  });

  test("a row outside the W209 vocabulary is refused", () => {
    const body = validBody();
    (body.eventImportance as Array<Record<string, unknown>>)[0] = {
      eventType: "scorpion-kick",
      weight: 1,
    };
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("must be one of the W209 event types"))).toBe(
        true,
      );
    }
  });

  test("a weight outside [0, 1] is refused", () => {
    for (const weight of [-0.01, 1.01, Number.POSITIVE_INFINITY]) {
      const body = validBody();
      (body.eventImportance as Array<Record<string, unknown>>)[0] = {
        eventType: "goal",
        weight,
      };
      expect(validatePresentationPolicy(body).ok).toBe(false);
    }
  });

  test("duplicate rows for one type are refused (unambiguous lookup)", () => {
    const body = validBody();
    (body.eventImportance as Array<Record<string, unknown>>).push({
      eventType: "goal",
      weight: 0.9,
    });
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("duplicate row for event type"))).toBe(true);
    }
  });
});

describe("baseline + semantics rules", () => {
  test("baselines outside [0, 1] are refused", () => {
    for (const field of ["baselineImportance", "baselineSemanticScore"]) {
      for (const value of [-0.1, 1.1]) {
        const body = validBody();
        body[field] = value;
        expect(validatePresentationPolicy(body).ok).toBe(false);
      }
    }
  });

  test("the blend weights must sum to EXACTLY 1", () => {
    const body = validBody();
    body.semantics = { importanceWeight: 0.5, emphasisWeight: 0.3, confidenceWeight: 0.1 };
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("must sum to exactly 1"))).toBe(true);
    }
  });

  test("a negative blend weight is refused", () => {
    const body = validBody();
    body.semantics = { importanceWeight: 0.9, emphasisWeight: -0.1, confidenceWeight: 0.2 };
    expect(validatePresentationPolicy(body).ok).toBe(false);
  });

  test("a non-object semantics block is refused", () => {
    const body = validBody();
    body.semantics = null;
    expect(validatePresentationPolicy(body).ok).toBe(false);
  });
});

describe("framing table rules", () => {
  test("an empty framing table is refused", () => {
    const body = validBody();
    body.framing = [];
    expect(validatePresentationPolicy(body).ok).toBe(false);
  });

  test("a framing value outside the vocabulary is refused", () => {
    const body = validBody();
    (body.framing as Array<Record<string, unknown>>)[0] = {
      slotId: "main-touchline",
      framing: "medium",
    };
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes('must be "wide" or "tight"'))).toBe(true);
    }
  });

  test("duplicate framing rows for one slot are refused (ambiguous classification)", () => {
    const body = validBody();
    (body.framing as Array<Record<string, unknown>>).push({
      slotId: "main-touchline",
      framing: "tight",
    });
    const result = validatePresentationPolicy(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("duplicate framing row"))).toBe(true);
    }
  });

  test("a partial framing table ADMITS (coverage is enforced fail-closed at use time)", () => {
    const body = validBody();
    body.framing = [{ slotId: "main-touchline", framing: "wide" }];
    expect(validatePresentationPolicy(body).ok).toBe(true);
  });
});

describe("validation is pure", () => {
  test("the same input yields the same issues", () => {
    const body = validBody();
    body.framing = [];
    const first = validatePresentationPolicy(body);
    const second = validatePresentationPolicy(body);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("the typed error surface", () => {
  test("present refuses an invalid policy with PresentationError(policy-invalid)", async () => {
    const { present, PresentationError } = await import("../src/index");
    const body = validBody() as unknown as PresentationPolicy;
    body.framing = [];
    expect(() => present(body, [], [])).toThrow(PresentationError);
    try {
      present(body, [], []);
    } catch (error) {
      expect((error as InstanceType<typeof PresentationError>).kind).toBe("policy-invalid");
    }
  });
});
