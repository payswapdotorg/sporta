/**
 * THE SELECTION DIRECTOR TESTS (R407): the auditable selection experience
 * over the R401 in-memory broker (the exact composition the seam
 * prescribes) — proving, deterministically (injected clock, registration
 * order):
 *
 * 1. AUTO: sporta-auto under the caller's bounds resolves the broker's
 *    deterministic policy order and the explanation carries EVERY
 *    provider's quote (verbatim, honest nulls intact) + broker refusal
 *    (verbatim) + preference exclusion (axis vocabulary);
 * 2. EXPLICIT: the user's chosen provider IS the selection — or the
 *    typed `SelectionRefusedError` with every recorded reason (the
 *    broker's silent preferred-provider fallback is DETECTED and
 *    refused: explicit means explicit);
 * 3. THE AXES: privacy (user-controlled zone), VRAM (declared floor,
 *    honest "no declaration" exclusions), capability classes, and the
 *    broker-carried cost/queue/availability axes;
 * 4. FAIL-LOUD: nothing selectable → the broker's own
 *    `ComputeBrokerRefusalError` propagates VERBATIM; malformed
 *    directives/facts → typed validation errors;
 * 5. DETERMINISM: the canonical explanation JSON is byte-identical
 *    across identical runs (the golden-pinning substrate).
 */
import { describe, expect, test } from "bun:test";
import { ComputeBrokerRefusalError, InMemoryComputeBroker } from "@sporta/compute-adapter";
import type { ComputeBrokerProvider } from "@sporta/compute-adapter";
import {
  SelectionDirector,
  SelectionRefusedError,
  SelectionValidationError,
  canonicalSelectionExplanation,
} from "../src/selection";
import type { ProviderSelectionFacts, SelectionExplanation } from "../src/selection";
import { makeDescriptor, manualClock, buildQuoteRequest, StubVerifiableAdapter } from "./helpers";

/** One stub broker provider (unique id per test, please). */
function brokerProvider(
  id: string,
  kind: "in-memory" | "gpu-worker" = "in-memory",
): {
  entry: ComputeBrokerProvider;
  adapter: StubVerifiableAdapter;
} {
  const adapter = new StubVerifiableAdapter({
    descriptor: makeDescriptor({ adapterId: id, providerKind: kind }),
    nowMs: manualClock(),
  });
  return { entry: { providerId: id, adapter }, adapter };
}

/** Facts for one provider (the operator's declarations). */
function facts(
  providerId: string,
  overrides: Partial<ProviderSelectionFacts> = {},
): ProviderSelectionFacts {
  return {
    providerId,
    privacyZone: "provider-cloud",
    ...overrides,
  } as ProviderSelectionFacts;
}

/** A director over the given providers + facts. */
function directorWith(
  providers: Array<{ entry: ComputeBrokerProvider; facts: ProviderSelectionFacts }>,
  overrides: {
    quoting?: Map<
      string,
      { estimatedCostUsd: number | null; estimatedQueueSeconds: number | null }
    >;
  } = {},
) {
  const clock = manualClock();
  const broker = new InMemoryComputeBroker({
    providers: providers.map((provider) => provider.entry),
    ...(overrides.quoting !== undefined
      ? {
          quoting: new Map(
            [...overrides.quoting.entries()].map(([id, estimate]) => [
              id,
              { estimate: () => estimate },
            ]),
          ),
        }
      : {}),
    nowMs: clock,
  });
  const director = new SelectionDirector({
    broker,
    facts: new Map(providers.map((provider) => [provider.facts.providerId, provider.facts])),
    nowMs: clock,
  });
  return { broker, director, clock };
}

describe("R407 — sporta-auto: deterministic order + full explanations", () => {
  test("auto selects the first eligible provider and explains every considered one", async () => {
    const cloud = brokerProvider("provider.cloud-a");
    const cloud2 = brokerProvider("provider.cloud-b");
    const { director } = directorWith([
      { entry: cloud.entry, facts: facts("provider.cloud-a") },
      { entry: cloud2.entry, facts: facts("provider.cloud-b") },
    ]);
    const { selection, explanation } = await director.explain(buildQuoteRequest(), {
      mode: "sporta-auto",
    });
    expect(selection.providerId).toBe("provider.cloud-a");
    expect(explanation.mode).toBe("sporta-auto");
    expect(explanation.selectedProviderId).toBe("provider.cloud-a");
    expect(explanation.selectionReason).toContain("first eligible provider");
    expect(explanation.appliedPreference.privacyPosture).toBe("privacy-any");
    // EVERY registered provider is considered, in registration order,
    // each with its verbatim quote (honest nulls intact).
    expect(explanation.considered).toHaveLength(2);
    expect(explanation.considered.map((entry) => entry.providerId)).toEqual([
      "provider.cloud-a",
      "provider.cloud-b",
    ]);
    expect(explanation.considered[0]!.quote).toBeDefined();
    expect(explanation.considered[0]!.quote!.estimatedCostUsd).toBeNull();
    expect(explanation.considered[0]!.quote!.estimatedQueueSeconds).toBeNull();
    // The broker's selection is returned VERBATIM (refusals included).
    expect(selection.refusals).toEqual(selection.refusals);
  });

  test("the broker's typed aggregate propagates VERBATIM when nothing is selectable", async () => {
    const { director } = directorWith([
      { entry: brokerProvider("provider.none").entry, facts: facts("provider.none") },
    ]);
    let thrown: unknown;
    try {
      await director.explain(buildQuoteRequest({ rendererId: "renderer.nobody-has" }), {
        mode: "sporta-auto",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ComputeBrokerRefusalError);
    const refusal = thrown as ComputeBrokerRefusalError;
    expect(refusal.refusals).toHaveLength(1);
    expect(refusal.refusals[0]!.reason).toBe("provider-unavailable");
  });

  test("auto under a cost bound excludes over-budget providers with broker refusals riding", async () => {
    const cheap = brokerProvider("provider.cheap");
    const dear = brokerProvider("provider.dear");
    const { director } = directorWith(
      [
        { entry: dear.entry, facts: facts("provider.dear") },
        { entry: cheap.entry, facts: facts("provider.cheap") },
      ],
      {
        quoting: new Map([
          ["provider.dear", { estimatedCostUsd: 9.5, estimatedQueueSeconds: null }],
          ["provider.cheap", { estimatedCostUsd: 0.5, estimatedQueueSeconds: null }],
        ]),
      },
    );
    const { selection, explanation } = await director.explain(buildQuoteRequest(), {
      mode: "sporta-auto",
      preference: { privacyPosture: "privacy-any", maxEstimatedCostUsd: 1 },
    });
    // Registration order: dear is FIRST but over budget → cheap wins.
    expect(selection.providerId).toBe("provider.cheap");
    const dearEntry = explanation.considered.find((c) => c.providerId === "provider.dear")!;
    expect(dearEntry.brokerRefusal).toBeDefined();
    expect(dearEntry.brokerRefusal!.reason).toBe("budget-exceeded");
    expect(dearEntry.quote!.estimatedCostUsd).toBe(9.5);
  });
});

describe("R407 — user-explicit: the user's choice is the selection", () => {
  test("explicit selection of an eligible provider wins (and is explained)", async () => {
    const a = brokerProvider("provider.cloud-a");
    const b = brokerProvider("provider.cloud-b");
    const { director } = directorWith([
      { entry: a.entry, facts: facts("provider.cloud-a") },
      { entry: b.entry, facts: facts("provider.cloud-b") },
    ]);
    const { selection, explanation } = await director.explain(buildQuoteRequest(), {
      mode: "user-explicit",
      providerId: "provider.cloud-b",
    });
    expect(selection.providerId).toBe("provider.cloud-b");
    expect(explanation.mode).toBe("user-explicit");
    expect(explanation.requestedProviderId).toBe("provider.cloud-b");
    expect(explanation.selectionReason).toContain("explicitly selected");
  });

  test("an explicit selection the broker refused NEVER silently falls back", async () => {
    const a = brokerProvider("provider.cloud-a");
    const b = brokerProvider("provider.cloud-b");
    const { director } = directorWith(
      [
        { entry: a.entry, facts: facts("provider.cloud-a") },
        { entry: b.entry, facts: facts("provider.cloud-b") },
      ],
      {
        quoting: new Map([
          ["provider.cloud-a", { estimatedCostUsd: 0.1, estimatedQueueSeconds: null }],
          ["provider.cloud-b", { estimatedCostUsd: 99, estimatedQueueSeconds: null }],
        ]),
      },
    );
    let thrown: unknown;
    try {
      await director.explain(buildQuoteRequest(), {
        mode: "user-explicit",
        providerId: "provider.cloud-b",
        preference: { privacyPosture: "privacy-any", maxEstimatedCostUsd: 1 },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SelectionRefusedError);
    const refusal = thrown as SelectionRefusedError;
    expect(refusal.requestedProviderId).toBe("provider.cloud-b");
    expect(refusal.refusals[0]!.brokerRefusal).toBeDefined();
    expect(refusal.refusals[0]!.brokerRefusal!.reason).toBe("budget-exceeded");
    expect(refusal.failureClass).toBe("resource-limit");
    // The message names the requested provider and refuses the fallback.
    expect(refusal.message).toContain("provider.cloud-b");
    expect(refusal.message).toContain("never silently falls back");
  });

  test("an explicit selection the descriptor refuses carries the broker's typed reason", async () => {
    const a = brokerProvider("provider.cloud-a");
    const { director } = directorWith([{ entry: a.entry, facts: facts("provider.cloud-a") }]);
    let thrown: unknown;
    try {
      await director.explain(buildQuoteRequest({ rendererId: "renderer.missing" }), {
        mode: "user-explicit",
        providerId: "provider.cloud-a",
      });
    } catch (error) {
      thrown = error;
    }
    // The broker itself fails loud (nothing selectable at all).
    expect(thrown).toBeInstanceOf(ComputeBrokerRefusalError);
  });

  test("an explicit directive without providerId fails validation", async () => {
    const { director } = directorWith([
      { entry: brokerProvider("provider.cloud-a").entry, facts: facts("provider.cloud-a") },
    ]);
    await expect(
      director.explain(buildQuoteRequest(), { mode: "user-explicit" } as never),
    ).rejects.toBeInstanceOf(SelectionValidationError);
  });

  test("an auto directive naming a provider fails validation", async () => {
    const { director } = directorWith([
      { entry: brokerProvider("provider.cloud-a").entry, facts: facts("provider.cloud-a") },
    ]);
    await expect(
      director.explain(buildQuoteRequest(), {
        mode: "sporta-auto",
        providerId: "provider.cloud-a",
      }),
    ).rejects.toBeInstanceOf(SelectionValidationError);
  });
});

describe("R407 — the privacy axis (user-controlled execution zone)", () => {
  test("privacy-local-only excludes every non-user-controlled provider, honestly", async () => {
    const cloud = brokerProvider("provider.cloud-a");
    const homelab = brokerProvider("provider.homelab");
    const { director } = directorWith([
      { entry: cloud.entry, facts: facts("provider.cloud-a", { privacyZone: "provider-cloud" }) },
      {
        entry: homelab.entry,
        facts: facts("provider.homelab", { privacyZone: "user-controlled" }),
      },
    ]);
    const { selection, explanation } = await director.explain(buildQuoteRequest(), {
      mode: "sporta-auto",
      preference: { privacyPosture: "privacy-local-only" },
    });
    expect(selection.providerId).toBe("provider.homelab");
    const cloudEntry = explanation.considered.find((c) => c.providerId === "provider.cloud-a")!;
    expect(cloudEntry.preferenceExclusion).toBeDefined();
    expect(cloudEntry.preferenceExclusion!.axis).toBe("privacy");
    expect(cloudEntry.preferenceExclusion!.message).toContain("user-controlled");
    expect(cloudEntry.preferenceExclusion!.message).toContain("provider-cloud");
  });

  test("an explicit choice excluded by the privacy axis is refused with the axis reason", async () => {
    const cloud = brokerProvider("provider.cloud-a");
    const { director } = directorWith([
      { entry: cloud.entry, facts: facts("provider.cloud-a", { privacyZone: "provider-cloud" }) },
    ]);
    let thrown: unknown;
    try {
      await director.explain(buildQuoteRequest(), {
        mode: "user-explicit",
        providerId: "provider.cloud-a",
        preference: { privacyPosture: "privacy-local-only" },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SelectionRefusedError);
    const refusal = thrown as SelectionRefusedError;
    expect(refusal.refusals[0]!.preferenceExclusion!.axis).toBe("privacy");
    expect(refusal.message).toContain("privacy");
  });

  test("a missing facts entry for a registered provider fails loudly (never guessed)", async () => {
    const a = brokerProvider("provider.cloud-a");
    const clock = manualClock();
    const broker = new InMemoryComputeBroker({ providers: [a.entry], nowMs: clock });
    const director = new SelectionDirector({
      broker,
      facts: new Map(), // EMPTY: the composition bug
      nowMs: clock,
    });
    await expect(
      director.explain(buildQuoteRequest(), { mode: "sporta-auto" }),
    ).rejects.toBeInstanceOf(SelectionValidationError);
  });
});

describe("R407 — the VRAM axis (declared floors, honest unknowns)", () => {
  test("a VRAM floor excludes undeclared and under-floor providers", async () => {
    const big = brokerProvider("provider.big-gpu", "gpu-worker");
    const small = brokerProvider("provider.small-gpu", "gpu-worker");
    const cpu = brokerProvider("provider.cpu-only");
    const { director } = directorWith([
      {
        entry: big.entry,
        facts: facts("provider.big-gpu", { vramMb: 24_576, privacyZone: "user-controlled" }),
      },
      {
        entry: small.entry,
        facts: facts("provider.small-gpu", { vramMb: 8_192, privacyZone: "user-controlled" }),
      },
      { entry: cpu.entry, facts: facts("provider.cpu-only", { privacyZone: "user-controlled" }) },
    ]);
    const { selection, explanation } = await director.explain(
      buildQuoteRequest({ resourceHints: { requiresGpu: true } }),
      {
        mode: "sporta-auto",
        preference: { privacyPosture: "privacy-local-only", vramFloorMb: 16_384 },
      },
    );
    expect(selection.providerId).toBe("provider.big-gpu");
    const smallEntry = explanation.considered.find((c) => c.providerId === "provider.small-gpu")!;
    expect(smallEntry.preferenceExclusion!.axis).toBe("vram");
    expect(smallEntry.preferenceExclusion!.message).toContain("8192");
    const cpuEntry = explanation.considered.find((c) => c.providerId === "provider.cpu-only")!;
    expect(cpuEntry.preferenceExclusion!.axis).toBe("vram");
    expect(cpuEntry.preferenceExclusion!.message).toContain("declares none");
  });

  test("a VRAM floor above the policy sanity bound is rejected loudly (a typo, not a filter)", async () => {
    const a = brokerProvider("provider.cloud-a");
    const { director } = directorWith([{ entry: a.entry, facts: facts("provider.cloud-a") }]);
    await expect(
      director.explain(buildQuoteRequest(), {
        mode: "sporta-auto",
        preference: { privacyPosture: "privacy-any", vramFloorMb: 999_999_999 },
      }),
    ).rejects.toBeInstanceOf(SelectionValidationError);
  });
});

describe("R407 — the capability axis (declared classes)", () => {
  test("a capability-class preference excludes providers that do not declare it", async () => {
    const serverless = brokerProvider("provider.serverless");
    const gpu = brokerProvider("provider.dedicated-gpu", "gpu-worker");
    const { director } = directorWith([
      {
        entry: serverless.entry,
        facts: facts("provider.serverless", { capabilityClasses: ["serverless"] }),
      },
      {
        entry: gpu.entry,
        facts: facts("provider.dedicated-gpu", { capabilityClasses: ["gpu", "dedicated"] }),
      },
    ]);
    const { selection, explanation } = await director.explain(buildQuoteRequest(), {
      mode: "sporta-auto",
      preference: { privacyPosture: "privacy-any", capabilityClass: "serverless" },
    });
    expect(selection.providerId).toBe("provider.serverless");
    const gpuEntry = explanation.considered.find((c) => c.providerId === "provider.dedicated-gpu")!;
    expect(gpuEntry.preferenceExclusion!.axis).toBe("capability");
    expect(gpuEntry.preferenceExclusion!.message).toContain("serverless");
  });
});

describe("R407 — determinism + canonical serialization", () => {
  /** Runs the SAME scenario twice and returns both explanations. */
  async function runTwice(): Promise<[SelectionExplanation, SelectionExplanation]> {
    const build = () => {
      const a = brokerProvider("provider.cloud-a");
      const b = brokerProvider("provider.homelab");
      const { director } = directorWith([
        { entry: a.entry, facts: facts("provider.cloud-a") },
        {
          entry: b.entry,
          facts: facts("provider.homelab", { privacyZone: "user-controlled", vramMb: 16_384 }),
        },
      ]);
      return director;
    };
    const first = await build().explain(buildQuoteRequest(), {
      mode: "sporta-auto",
      preference: { privacyPosture: "privacy-any", maxEstimatedCostUsd: 1 },
    });
    const second = await build().explain(buildQuoteRequest(), {
      mode: "sporta-auto",
      preference: { privacyPosture: "privacy-any", maxEstimatedCostUsd: 1 },
    });
    return [first.explanation, second.explanation];
  }

  test("identical inputs produce byte-identical canonical explanations", async () => {
    const [first, second] = await runTwice();
    expect(canonicalSelectionExplanation(first)).toBe(canonicalSelectionExplanation(second));
  });

  test("the canonical form is sorted-key, no-whitespace JSON", async () => {
    const [first] = await runTwice();
    const canonical = canonicalSelectionExplanation(first);
    expect(canonical).not.toContain(": ");
    expect(canonical).not.toContain(", ");
    // Sorted keys: 'appliedPreference' precedes 'considered' precedes 'decidedAtMs'.
    expect(canonical.indexOf('"appliedPreference"')).toBeLessThan(
      canonical.indexOf('"considered"'),
    );
    expect(canonical.indexOf('"considered"')).toBeLessThan(canonical.indexOf('"decidedAtMs"'));
  });

  test("the explanation survives its own schema round-trip", async () => {
    const [first] = await runTwice();
    const { SelectionExplanation } = await import("../src/selection");
    expect(() => SelectionExplanation.parse(first)).not.toThrow();
  });
});
