/**
 * The degradation-policy-table tests: the SLO→alert→policy mapping's
 * CONSISTENCY (no dangling trigger; the triggers PARTITION the 33-entry
 * catalog — every alert, warnings included, answered by exactly one policy),
 * the machinery-seam existence pins (every named package + export is
 * imported FOR REAL from the workspace packages — a policy naming machinery
 * that does not exist fails this suite, fail-closed), the semantic claims the
 * policy prose makes about that machinery (spot-checked against the real
 * exports), the automation honesty pin, and the SLOs.md §5 doc pin
 * (row-for-row, both directions — the W503 THRESHOLDS.md convention).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as contracts from "@sporta/contracts";
import * as gpuWorker from "@sporta/gpu-worker";
import * as processingQueues from "@sporta/processing-queues";
import * as renderOrchestration from "@sporta/render-orchestration";
import * as viewerShell from "@sporta/viewer-shell";
import * as webrtcOutput from "@sporta/webrtc-output";
import {
  DEGRADATION_POLICIES,
  POLICY_TABLE_ID,
  assertPolicyTableInvariants,
  policyById,
  type DegradationPolicy,
  type MachinerySeam,
} from "../src/policies";
import { ALERT_CATALOG } from "../src/alerts";
import { SloTableInconsistentError } from "../src/errors";

const DOC: string = readFileSync(join(import.meta.dir, "..", "SLOs.md"), "utf8");

/**
 * The REAL package registries (dev dependencies): the machinery existence
 * check imports the actual workspace packages — a seam naming a package or
 * export that does not exist fails here, never in production prose.
 */
const REGISTRIES: Readonly<Record<string, object>> = {
  "@sporta/contracts": contracts,
  "@sporta/gpu-worker": gpuWorker,
  "@sporta/processing-queues": processingQueues,
  "@sporta/render-orchestration": renderOrchestration,
  "@sporta/viewer-shell": viewerShell,
  "@sporta/webrtc-output": webrtcOutput,
};

/** Resolves one machinery seam against the real registries (undefined = dangling). */
function resolveSeamExport(seam: MachinerySeam): unknown {
  const registry = REGISTRIES[seam.packageName] as Record<string, unknown> | undefined;
  if (registry === undefined) return undefined;
  return registry[seam.exportName];
}

/** One row of the SLOs.md §5 playbook table. */
interface DocPolicyRow {
  policyId: string;
  triggers: string[];
  automation: string;
  machinery: string[];
}

/** Parses the §5 rows (table rows whose 4th cell is the automation level). */
function parseDocPolicyRows(doc: string): DocPolicyRow[] {
  const rows: DocPolicyRow[] = [];
  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 6) continue;
    if (cells[3] !== "operator-decision" && cells[3] !== "automatic") continue;
    rows.push({
      policyId: cells[1]!,
      triggers: cells[2]!.split(", ").filter((entry) => entry.length > 0),
      automation: cells[3]!,
      machinery: cells[4]!.split(", ").filter((entry) => entry.length > 0),
    });
  }
  return rows;
}

describe("the policy table's structural invariants (the routing table)", () => {
  test("four policies, unique ids, non-empty machinery — the invariants hold", () => {
    assertPolicyTableInvariants();
    expect(DEGRADATION_POLICIES).toHaveLength(4);
    expect(new Set(DEGRADATION_POLICIES.map((policy) => policy.policyId)).size).toBe(4);
    expect(POLICY_TABLE_ID).toBe("w802-degradation-policies-v1");
  });

  test("policyById resolves every id and fails loud on unknowns", () => {
    for (const policy of DEGRADATION_POLICIES) {
      expect(policyById(policy.policyId)).toBe(policy);
    }
    expect(() => policyById("reticulate-splines")).toThrow(SloTableInconsistentError);
  });

  test("the triggers PARTITION the alert catalog: all 33 alerts answered, exactly once each", () => {
    const allTriggers = DEGRADATION_POLICIES.flatMap((policy) => policy.triggers);
    expect(allTriggers).toHaveLength(33);
    expect(new Set(allTriggers).size).toBe(33); // no alert answered twice
    const catalogIds = new Set(ALERT_CATALOG.map((alert) => alert.alertId));
    expect(new Set(allTriggers)).toEqual(catalogIds); // every alert answered
  });

  test("every trigger set is non-empty (a policy that answers nothing is prose)", () => {
    for (const policy of DEGRADATION_POLICIES) {
      expect(policy.triggers.length).toBeGreaterThan(0);
      expect(policy.situation.length).toBeGreaterThan(20);
      expect(policy.action.length).toBeGreaterThan(20);
      expect(policy.automaticProtections.length).toBeGreaterThan(0);
    }
  });

  test("the automation honesty pin: every policy is an operator decision (no invented automation)", () => {
    // Current truth, pinned: nothing in this repository watches latency and
    // reconfigures the pipeline by itself. A future automatic control loop
    // must flip this pin CONSCIOUSLY (and document its trigger conditions).
    for (const policy of DEGRADATION_POLICIES) {
      expect(policy.automation).toBe("operator-decision");
    }
  });
});

describe("the machinery existence pins (fail-closed against the REAL packages)", () => {
  test("every named seam resolves to a real export of the named workspace package", () => {
    for (const policy of DEGRADATION_POLICIES) {
      for (const seam of policy.machinery) {
        const value = resolveSeamExport(seam);
        expect(
          value !== undefined && (typeof value === "function" || typeof value === "object"),
          `${policy.policyId} names ${seam.packageName}:${seam.exportName} — it does not exist (dangling machinery reference)`,
        ).toBe(true);
      }
    }
  });

  test("the check has teeth: a bogus export name does not resolve", () => {
    const bogus: MachinerySeam = {
      packageName: "@sporta/gpu-worker",
      exportName: "definitely-not-an-export",
      seam: "teeth",
    };
    expect(resolveSeamExport(bogus)).toBeUndefined();
  });

  test("the check has teeth: an unknown package does not resolve", () => {
    const bogus: MachinerySeam = {
      packageName: "@sporta/not-a-package",
      exportName: "anything",
      seam: "teeth",
    };
    expect(resolveSeamExport(bogus)).toBeUndefined();
  });

  test("every machinery packageName is one of the imported real registries", () => {
    const names = new Set(
      DEGRADATION_POLICIES.flatMap((policy) => policy.machinery.map((seam) => seam.packageName)),
    );
    for (const name of names) {
      expect(REGISTRIES[name], `unknown package "${name}"`).toBeDefined();
    }
  });
});

describe("the policy prose's semantic claims, pinned against the real exports", () => {
  test("the W303 retry default is the frozen no-retries posture (maxAttempts 1) — as the action text states", () => {
    const retry = gpuWorker.DEFAULT_WORKER_RETRY as { maxAttempts: number };
    expect(retry.maxAttempts).toBe(1);
  });

  test("the typed no-downgrade reject vocabulary includes unsupported-latency-class — as the W305 claim states", () => {
    const reasons = (webrtcOutput.LiveOutputRejectionReason as { options: readonly string[] })
      .options;
    expect(reasons).toContain("unsupported-latency-class");
  });

  test("the viewer telemetry vocabulary includes rebuffer-stall — the W706 symptom the playbook names", () => {
    const kinds = viewerShell.TELEMETRY_EVENT_KINDS as readonly string[];
    expect(kinds).toContain("rebuffer-stall");
  });

  test("the latency-class vocabulary is offline | near-live | live — as the machinery row states", () => {
    const classes = (contracts.OutputLatencyClass as { options: readonly string[] }).options;
    expect([...classes]).toEqual(["offline", "near-live", "live"]);
  });

  test("the W303 capacity knobs (queue + admission bounds) exist on DEFAULT_GPU_LIMITS", () => {
    const limits = gpuWorker.DEFAULT_GPU_LIMITS as {
      maxQueuedJobs: number;
      maxAdmittedJobs: number;
    };
    expect(limits.maxQueuedJobs).toBeGreaterThanOrEqual(1);
    expect(limits.maxAdmittedJobs).toBeGreaterThanOrEqual(1);
  });

  test("the W304 reorder bound exists on DEFAULT_RENDER_LIMITS — the reorder-hold config the playbook names", () => {
    const limits = renderOrchestration.DEFAULT_RENDER_LIMITS as { maxReorderOutputs: number };
    expect(limits.maxReorderOutputs).toBeGreaterThanOrEqual(1);
  });

  test("the whole-dispatcher accounting (incl. the DLQ balance) is the real exported asserter the table names", () => {
    expect(typeof gpuWorker.assertGpuAccounting).toBe("function");
  });
});

describe("the invariants guard itself (mutation teeth)", () => {
  const policies = DEGRADATION_POLICIES as unknown as DegradationPolicy[];

  test("a dangling trigger is rejected (a policy naming an alert that does not exist)", () => {
    const original = policies[0]!;
    policies[0] = {
      ...original,
      triggers: [...original.triggers, "latency.batch.nonsense.p99.critical"],
    };
    try {
      expect(() => assertPolicyTableInvariants()).toThrow(SloTableInconsistentError);
    } finally {
      policies[0] = original;
    }
  });

  test("an unanswered alert is rejected (an alert that fires into the void)", () => {
    const original = policies[0]!;
    policies[0] = { ...original, triggers: original.triggers.slice(1) };
    try {
      expect(() => assertPolicyTableInvariants()).toThrow(/answered by no policy/);
    } finally {
      policies[0] = original;
    }
  });

  test("an alert answered by two policies is rejected (ambiguous routing)", () => {
    const original = policies[1]!;
    const borrowed = policies[0]!.triggers[0]!;
    policies[1] = { ...original, triggers: [...original.triggers, borrowed] };
    try {
      expect(() => assertPolicyTableInvariants()).toThrow(/answered by both/);
    } finally {
      policies[1] = original;
    }
  });

  test("a duplicate policyId is rejected", () => {
    const original = policies[1]!;
    policies[1] = { ...original, policyId: policies[0]!.policyId };
    try {
      expect(() => assertPolicyTableInvariants()).toThrow(/duplicate policyId/);
    } finally {
      policies[1] = original;
    }
  });

  test("an action without machinery is rejected (prose, not policy)", () => {
    const original = policies[0]!;
    policies[0] = { ...original, machinery: [] };
    try {
      expect(() => assertPolicyTableInvariants()).toThrow(/names no machinery/);
    } finally {
      policies[0] = original;
    }
  });
});

describe("SLOs.md §5 ↔ DEGRADATION_POLICIES (the doc pin, both directions)", () => {
  const rows = parseDocPolicyRows(DOC);

  test("the document table is present and complete (4 rows)", () => {
    expect(rows).toHaveLength(4);
  });

  test("every document row matches the code row (id, triggers, automation, machinery)", () => {
    expect(rows.map((row) => row.policyId)).toEqual(
      DEGRADATION_POLICIES.map((policy) => policy.policyId),
    );
    for (const row of rows) {
      const policy = policyById(row.policyId);
      expect(row.triggers).toEqual([...policy.triggers]);
      expect(row.automation).toBe(policy.automation);
      expect(row.machinery).toEqual(
        policy.machinery.map((seam) => `${seam.packageName}:${seam.exportName}`),
      );
    }
  });

  test("every code row appears in the document (both directions)", () => {
    const documented = new Set(rows.map((row) => row.policyId));
    for (const policy of DEGRADATION_POLICIES) {
      expect(documented.has(policy.policyId)).toBe(true);
    }
  });
});
