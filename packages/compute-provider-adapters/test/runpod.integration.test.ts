/**
 * The `provider.runpod` adapter (R404) — the CONDITIONAL INTEGRATION tier:
 * REAL REST calls to `https://api.runpod.ai` with a REAL account API key,
 * skipped unless `RUNPOD_API_KEY` is configured. Read-only by design
 * (credential verification against the pods endpoint family).
 */
import { describe, expect, test } from "bun:test";
import { RunPodComputeAdapter } from "../src/runpod/adapter";

const GUARD = process.env["RUNPOD_API_KEY"] !== undefined && process.env["RUNPOD_API_KEY"] !== "";

describe.skipIf(!GUARD)("R404 RunPod integration — the real api.runpod.ai (conditional)", () => {
  test("verifyCredentials against the REAL pods endpoint", async () => {
    const adapter = new RunPodComputeAdapter({
      apiKey: process.env["RUNPOD_API_KEY"] ?? "",
      nowMs: () => Date.now(),
    });
    const status = await adapter.verifyCredentials();
    expect(["verified", "invalid", "present-unverified"]).toContain(status.state);
    expect(status.detail).toBeDefined();
  });
});
