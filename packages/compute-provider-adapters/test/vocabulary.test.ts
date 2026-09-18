/**
 * The FAIL-CLOSED vocabulary test (R402-R405 cross-cutting rule): NO
 * provider name appears in ANY closed vocabulary or contract member —
 * provider ids/names are DATA (adapter ids, descriptor fields, error
 * details), never product/domain contract members. This test scans every
 * closed vocabulary the provider adapters consume (the
 * `@sporta/compute-adapter` contract layer, the `@sporta/contracts`
 * failure classes, and this package's own exported vocabularies) for the
 * three vendor names + their adapter-id forms, and pins the DATA surface
 * (the adapter-id constants) as the ONLY place the names live.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TerminalFailureClass } from "@sporta/contracts";
import {
  COMPUTE_BROKER_REFUSALS,
  COMPUTE_FAILURE_CLASSES,
  COMPUTE_JOB_STATES,
  COMPUTE_TERMINAL_DISPOSITIONS,
  ComputeJobEventType,
  ComputeProviderKind,
  ComputeInputKind,
  ComputeCostUnitKind,
} from "@sporta/compute-adapter";
import {
  MODAL_ADAPTER_ID,
  LIGHTNING_ADAPTER_ID,
  RUNPOD_ADAPTER_ID,
  LOCAL_ADAPTER_ID,
  PROVIDER_CREDENTIAL_STATES,
  PROVIDER_REFUSAL_FAILURE_CLASSES,
  PROVIDER_REFUSAL_REASONS,
} from "../src/index";

/** The provider names + id forms that must NEVER be vocabulary members. */
const PROVIDER_NAME_MARKERS = [
  "modal",
  "lightning",
  "runpod",
  "provider.modal",
  "provider.lightning",
  "provider.runpod",
  "provider.local",
] as const;

/** Asserts a closed vocabulary carries no provider-name marker. */
function expectNoProviderNames(vocabulary: readonly string[], label: string): void {
  for (const member of vocabulary) {
    const lower = member.toLowerCase();
    for (const marker of PROVIDER_NAME_MARKERS) {
      expect(
        lower.includes(marker),
        `${label} member '${member}' embeds the provider name '${marker}' (provider names are DATA, never vocabulary members)`,
      ).toBe(false);
    }
  }
}

describe("fail-closed: provider names are DATA, never contract members", () => {
  test("the W914 compute-adapter closed vocabularies carry no provider names", () => {
    expectNoProviderNames(COMPUTE_JOB_STATES, "ComputeJobState");
    expectNoProviderNames(COMPUTE_TERMINAL_DISPOSITIONS, "ComputeTerminalDisposition");
    expectNoProviderNames(ComputeJobEventType.options, "ComputeJobEventType");
    expectNoProviderNames(ComputeInputKind.options, "ComputeInputKind");
    expectNoProviderNames(ComputeProviderKind.options, "ComputeProviderKind");
    expectNoProviderNames(ComputeCostUnitKind.options, "ComputeCostUnitKind");
    expectNoProviderNames(COMPUTE_FAILURE_CLASSES, "ComputeFailureClass");
  });

  test("the R401 broker refusal vocabulary carries no provider names (ids travel as data)", () => {
    expectNoProviderNames(COMPUTE_BROKER_REFUSALS, "ComputeBrokerRefusal");
    // The vocabulary is exactly the closed R401 set.
    expect([...COMPUTE_BROKER_REFUSALS]).toEqual([
      "no-compatible-gpu",
      "quota-exhausted",
      "credential-invalid",
      "budget-exceeded",
      "provider-unavailable",
    ]);
  });

  test("the contracts TerminalFailureClass enum carries no provider names", () => {
    expectNoProviderNames(TerminalFailureClass.options, "TerminalFailureClass");
  });

  test("this package's own vocabularies carry no provider names", () => {
    expectNoProviderNames(PROVIDER_CREDENTIAL_STATES, "ProviderCredentialState");
    expectNoProviderNames(PROVIDER_REFUSAL_REASONS, "ProviderRefusalReason");
    for (const reason of PROVIDER_REFUSAL_REASONS) {
      expectNoProviderNames(
        [PROVIDER_REFUSAL_FAILURE_CLASSES[reason]],
        `the failure-class map key '${reason}'`,
      );
    }
  });

  test("the provider names live ONLY in the exported DATA constants (adapter ids)", () => {
    // The adapter-id constants ARE the data surface: exactly these four,
    // exactly these values.
    expect(MODAL_ADAPTER_ID).toBe("provider.modal");
    expect(LIGHTNING_ADAPTER_ID).toBe("provider.lightning");
    expect(RUNPOD_ADAPTER_ID).toBe("provider.runpod");
    expect(LOCAL_ADAPTER_ID).toBe("provider.local");
  });

  test("the package's domain-source export surface carries no provider-named CONTRACT types", () => {
    // Scan the package's own common/ modules (the contract-adjacent layer)
    // for provider names outside DATA positions: the shared plane must be
    // vendor-free; provider names belong to the per-provider adapter
    // modules (adapter ids, clients) and the composition root only.
    const commonDir = join(import.meta.dir, "..", "src", "common");
    for (const file of [
      "refusal.ts",
      "http.ts",
      "credentials.ts",
      "rest.ts",
      "ledger.ts",
      "descriptors.ts",
    ]) {
      const source = readFileSync(join(commonDir, file), "utf8");
      for (const marker of ["modal", "lightning", "runpod"]) {
        expect(
          source.toLowerCase().includes(marker),
          `src/common/${file} mentions '${marker}' — the shared provider plane is vendor-free by construction`,
        ).toBe(false);
      }
    }
  });
});
