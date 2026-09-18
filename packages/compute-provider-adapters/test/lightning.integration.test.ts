/**
 * The `provider.lightning` adapter (R403) — the CONDITIONAL INTEGRATION
 * tier: REAL REST calls to `https://api.lightning.ai` with a REAL account
 * API key, skipped unless `LIGHTNING_API_KEY` is configured. Read-only by
 * design (credential verification against the machines endpoint family).
 */
import { describe, expect, test } from "bun:test";
import { LightningComputeAdapter } from "../src/lightning/adapter";

const GUARD =
  process.env["LIGHTNING_API_KEY"] !== undefined && process.env["LIGHTNING_API_KEY"] !== "";

describe.skipIf(!GUARD)(
  "R403 Lightning integration — the real api.lightning.ai (conditional)",
  () => {
    test("verifyCredentials against the REAL machines endpoint", async () => {
      const adapter = new LightningComputeAdapter({
        apiKey: process.env["LIGHTNING_API_KEY"] ?? "",
        studioId: process.env["LIGHTNING_STUDIO_ID"] ?? "",
        nowMs: () => Date.now(),
      });
      const status = await adapter.verifyCredentials();
      expect(["verified", "invalid", "present-unverified"]).toContain(status.state);
      expect(status.detail).toBeDefined();
    });
  },
);
