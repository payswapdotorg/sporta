/**
 * Shared test helpers: the checked-in self-check record and the demo
 * release input (built once, shared — the evaluations are pure and never
 * mutate their inputs; the source injectors deep-clone).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDemoReleaseInput } from "../src/release";
import type { ReleaseReadinessInput } from "../src/report";

/** The checked-in self-check record document (the demo run's input). */
export function loadDemoRecord(): unknown {
  return JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "fixtures", "human-review", "w803-fixture-self-check.json"),
      "utf8",
    ),
  );
}

let cachedInput: ReleaseReadinessInput | null = null;

/** The demo release input over the real fixtures (built once, shared). */
export function demoInput(): ReleaseReadinessInput {
  if (cachedInput === null) {
    cachedInput = buildDemoReleaseInput(loadDemoRecord());
  }
  return cachedInput;
}

/** The demo record with ONE checklist result dropped (the incomplete case). */
export function incompleteDemoRecord(): Record<string, unknown> {
  const record = loadDemoRecord() as Record<string, unknown>;
  const results = record.checklistResults as Record<string, unknown>[];
  return {
    ...record,
    checklistResults: results.filter((entry) => entry.itemId !== "release-signoff"),
  };
}

/** The demo record with ONE checklist result flipped to "fail". */
export function rejectingDemoRecord(): Record<string, unknown> {
  const record = loadDemoRecord() as Record<string, unknown>;
  const results = record.checklistResults as Record<string, unknown>[];
  return {
    ...record,
    checklistResults: results.map((entry) =>
      entry.itemId === "release-signoff" ? { ...entry, result: "fail" } : entry,
    ),
  };
}
